// Development SOPs command line. Hooks call `context` and `remind`; Claude calls the rest.
import { MongoClient, ObjectId, BSON } from "mongodb";
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const INSTALL_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(INSTALL_DIR, ".env");
const dotenv = existsSync(envFile) ? Object.fromEntries(readFileSync(envFile, "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])) : {};
const OWNER_NAME = process.env.OWNER_NAME || dotenv.OWNER_NAME || "the owner";
const MONGO_URL = process.env.DEVELOPER_SOP_URL || "mongodb://127.0.0.1:27027/developer-sop";
const DATE_KEYS = /(_at|^due|^until|^at)$/;
const ACTIVE = ["planned", "active", "waiting", "blocked"];
const [command, ...args] = process.argv.slice(2);

function readStdin() {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

function parseJson(text) {
  const value = BSON.EJSON.parse(text, { relaxed: true });
  return reviveDates(value);
}

function reviveDates(value) {
  if (Array.isArray(value)) return value.map(reviveDates);
  if (value && typeof value === "object" && !(value instanceof Date) && !(value instanceof ObjectId)) {
    for (const [k, v] of Object.entries(value)) {
      value[k] = DATE_KEYS.test(k) && typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v) : reviveDates(v);
    }
  }
  return value;
}

function flag(name) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const [value] = args.splice(i, 2).slice(1);
  return value;
}

function idFilter(collection, ref) {
  if (collection === "work") return { key: ref };
  if (collection === "sessions") return { session_id: ref };
  return { _id: new ObjectId(ref) };
}

function gitBranch(cwd) {
  try {
    return execFileSync("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch { return null; }
}

function ago(date) {
  if (!date) return "never";
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 90) return `${minutes} min ago`;
  if (minutes < 60 * 36) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} days ago`;
}

function oneLine(text, max = 160) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 3) + "..." : flat;
}

// A resumed or forked session gets a new id, but its transcript still names the earlier sessions
// (in scratchpad paths, file backups and the summary), so their work items are found through it.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const TRANSCRIPT_BYTES = 4 * 1024 * 1024;

function sessionIdsIn(transcriptPath) {
  if (!transcriptPath) return [];
  try {
    const fd = openSync(transcriptPath, "r");
    const buffer = Buffer.alloc(TRANSCRIPT_BYTES);
    const read = readSync(fd, buffer, 0, TRANSCRIPT_BYTES, 0);
    closeSync(fd);
    return [...new Set(buffer.toString("utf8", 0, read).match(UUID) ?? [])];
  } catch { return []; }
}

async function findCurrentWork(db, { cwd, sessionId, transcriptPath }) {
  const branch = cwd ? gitBranch(cwd) : null;
  if (branch && branch !== "main" && branch !== "HEAD") {
    const byBranch = await db.collection("work").findOne({ "branches.name": branch, status: { $in: ACTIVE } });
    if (byBranch) return { work: byBranch, others: [], how: `branch ${branch}` };
  }
  const sessionIds = [...new Set([sessionId, ...sessionIdsIn(transcriptPath)].filter(Boolean))];
  if (sessionIds.length) {
    const touched = await db.collection("work").find({ session_ids: { $in: sessionIds }, status: { $in: ACTIVE } })
      .sort({ updated_at: -1 }).limit(5).toArray();
    if (touched.length) {
      const how = touched[0].session_ids.includes(sessionId) ? "last touched by this session" : "last touched by an earlier part of this conversation";
      return { work: touched[0], others: touched.slice(1), how };
    }
  }
  return { work: null, others: [], how: branch ? `no work item has branch ${branch}` : "no branch" };
}

async function workBlock(db, work) {
  const key = work.key;
  const [decisions, waitingOnOwner, scope, openItems, drafts, watches] = await Promise.all([
    db.collection("decisions").find({ work_key: key, status: "active" }).sort({ created_at: -1 }).limit(5).toArray(),
    db.collection("decisions").find({ work_key: key, status: "active", needs_owner: true, "approved.at": { $exists: false } }).toArray(),
    db.collection("scope_items").find({ work_key: key, outcome: "open" }).toArray(),
    db.collection("open_items").find({ work_key: key, $or: [{ source: "github", "cache.state": { $ne: "CLOSED" } }, { source: "local", status: "open" }] }).toArray(),
    db.collection("drafts").find({ work_key: key, status: { $in: ["draft", "shown", "approved"] } }).toArray(),
    db.collection("watches").find({ work_key: key, status: "running" }).toArray(),
  ]);
  const s = work.current_state || {};
  const lines = [
    `Current work: ${key} --- ${work.title} [${work.status}${work.waiting_on ? `, waiting on ${work.waiting_on}` : ""}]`,
    `Goal: ${oneLine(work.goal ?? "(none written)")}`,
    `State (${ago(s.updated_at)}): done: ${oneLine(s.done ?? "-", 200)} | in flight: ${oneLine(s.in_flight ?? "-", 200)} | next: ${oneLine(s.next ?? "-", 200)}`,
  ];
  if (work.github?.prs?.length || work.github?.issues?.length) {
    lines.push(`GitHub: PRs ${(work.github.prs || []).map((n) => "#" + n).join(" ") || "-"}; issues ${(work.github.issues || []).map((n) => "#" + n).join(" ") || "-"}`);
  }
  if (waitingOnOwner.length) lines.push(`Waiting on ${OWNER_NAME}'s yes: ${waitingOnOwner.map((d) => oneLine(d.statement, 100)).join(" / ")}`);
  if (decisions.length) lines.push(`Decisions: ${decisions.map((d) => oneLine(d.statement, 90)).join(" / ")}`);
  if (scope.length) lines.push(`Scope not yet built, deferred or dropped: ${scope.length} (${scope.slice(0, 3).map((i) => oneLine(i.text ?? i.source.item, 60)).join(" / ")})`);
  const local = openItems.filter((o) => o.source === "local");
  const github = openItems.filter((o) => o.source === "github");
  if (github.length) lines.push(`Open issues: ${github.map((o) => `#${o.github.issue} ${oneLine(o.cache?.title ?? "", 50)}`).join(" / ")}`);
  const promises = local.filter((o) => o.type === "promise");
  const rest = local.filter((o) => o.type !== "promise");
  if (promises.length) lines.push(`Promises made: ${promises.map((o) => oneLine(o.text, 80)).join(" / ")}`);
  if (rest.length) lines.push(`Open questions, waits, risks: ${rest.map((o) => `${o.type}: ${oneLine(o.text, 70)}`).join(" / ")}`);
  if (drafts.length) lines.push(`Drafts not posted: ${drafts.map((d) => `${d.target} for ${d.where ?? "?"} (${d.status})`).join(" / ")}`);
  if (watches.length) lines.push(`Watches running: ${watches.map((w) => `${w.title} until ${w.until.toISOString().slice(0, 16)}Z`).join(" / ")}`);
  return lines;
}

async function context(db) {
  const input = JSON.parse(readStdin() || "{}");
  const sessionId = input.session_id;
  const source = input.source || "startup";
  if (sessionId) {
    await db.collection("sessions").updateOne(
      { session_id: sessionId },
      {
        $setOnInsert: { session_id: sessionId, started_at: new Date(), created_at: new Date(), created_by: "claude", schema_version: 1 },
        $set: { transcript: input.transcript_path, updated_at: new Date(), cwd: input.cwd },
        $inc: { compactions: source === "compact" ? 1 : 0 },
      },
      { upsert: true },
    );
  }
  const { work, others, how } = await findCurrentWork(db, { cwd: input.cwd, sessionId, transcriptPath: input.transcript_path });
  const lines = [`Development SOPs: follow the Development SOPs rules (RULES.md). Session ${sessionId ?? "?"}: pass it as --session on every write.`];
  const chat = await chatFor(db, sessionId, source);
  if (chat) lines.push(...chatBlock(chat));
  if (work) {
    lines.push(`(found by ${how}; the store is the truth for where this work stands, not memory of the conversation)`);
    lines.push(...(await workBlock(db, work)));
    if (others.length) lines.push(`Also active in this conversation: ${others.map((w) => `${w.key} (${ago(w.updated_at)})`).join(", ")}. \`developer-sop show <key>\` prints one.`);
  } else {
    const active = await db.collection("work").find({ status: { $in: ACTIVE } }).sort({ updated_at: -1 }).limit(5).toArray();
    lines.push(`No current work item (${how}). Before the first edit, pick one below or create one with \`developer-sop put work\` (\`developer-sop fields work\` lists what it needs).`);
    for (const w of active) lines.push(`  ${w.key} [${w.status}] ${oneLine(w.title, 70)} --- updated ${ago(w.updated_at)}`);
  }
  if (source === "compact") lines.push("This session was just compacted. Re-read the state above before acting; anything not in it was not recorded.");
  process.stdout.write(lines.join("\n") + "\n");
}

const REMIND_BASH = /^\s*(git\s+(commit|push|tag|merge|rebase|reset)|gh\s+(pr|issue|api|release)|mix\s+ecto|docker\s)/;

function remind() {
  const input = JSON.parse(readStdin() || "{}");
  if (input.tool_name === "Bash" && !REMIND_BASH.test(input.tool_input?.command ?? "")) return;
  const text = [
    "Development SOPs: does this write make or change a decision, scope, promise or draft? Record it first (developer-sop).",
    `Anything irreversible, deferred or dropped needs ${OWNER_NAME}'s yes on record (the Development SOPs rules (RULES.md)).`,
  ].join("\n");
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: text } }));
}

const CONTEXT_CEILING = 200_000;
const TAIL_BYTES = 2 * 1024 * 1024;

// The last reply's usage is what the model was sent, so it is the size of the context right now.
function contextTokens(transcriptPath) {
  if (!transcriptPath) return null;
  try {
    const fd = openSync(transcriptPath, "r");
    const size = fstatSync(fd).size;
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    closeSync(fd);
    const lines = buffer.toString("utf8").split("\n").reverse();
    for (const line of lines) {
      if (!line.includes('"usage"')) continue;
      const usage = parseJson(line)?.message?.usage;
      if (usage) return (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
    }
  } catch { return null; }
  return null;
}

async function prompt(db) {
  const input = JSON.parse(readStdin() || "{}");
  const lines = ["Development SOPs: if this message answers, approves, rejects or changes anything, record it in the store before replying (rule 8)."];
  const tokens = contextTokens(input.transcript_path);
  const chat = db && input.session_id ? await db.collection("chat_states").findOne({ session_ids: input.session_id }) : null;
  if (chat && tokens) await db.collection("chat_states").updateOne({ _id: chat._id }, { $set: { last_tokens: tokens } });
  if (!chat) lines.push("Chat state: none for this chat yet. Write one with `developer-sop chat <key> '{\"kind\":...,\"aim\":...}'` once its purpose is clear.");
  if (tokens && tokens > CONTEXT_CEILING) {
    lines.push(
      `Context is at ${Math.round(tokens / 1000)}K tokens, over the 200K ceiling. First bring the chat state ${chat ? chat.key : "(write one)"} fully up to date. Then answer the owner's message as usual, and end the reply with one question card and nothing else asked beside it: "Clear and reload" (first, the default) or "Compact". Every other open choice is already in the chat state and the work items; do not ask it here. On clear and reload, first step: start a helper chat (mcp__ccd_session__start_session) that sends this chat a message about 1 second later; without it the cleared chat never wakes. Only once it has started: \`developer-sop chat <key> '{"reload_pending":true}'\`, then call mcp__ccd_session_mgmt__clear_session with session_id \"self\" yourself; the owner does not type /clear. Wait for his answer.`,
    );
  }
  process.stdout.write(lines.join("\n") + "\n");
}

async function chatFor(db, sessionId, source) {
  if (sessionId) {
    const own = await db.collection("chat_states").findOne({ session_ids: sessionId });
    if (own) return own;
  }
  if (source !== "clear" && source !== "startup") return null;
  const since = new Date(Date.now() - 6 * 3600 * 1000);
  const pending = await db.collection("chat_states").findOne({ reload_pending: true, updated_at: { $gte: since } }, { sort: { updated_at: -1 } });
  if (!pending) return null;
  await db.collection("chat_states").updateOne({ _id: pending._id },
    { $set: { reload_pending: false, updated_at: new Date() }, $addToSet: { session_ids: sessionId } });
  return { ...pending, reloaded: true };
}

function chatBlock(chat) {
  const list = (label, items, fmt = (x) => x) => (items?.length ? [`${label}:`, ...items.map((x) => `  - ${fmt(x)}`)] : []);
  return [
    `Chat state: ${chat.key} [${chat.kind}]${chat.reloaded ? " --- reloaded after a clear; this is everything the earlier part of the chat kept" : ""}`,
    `Aim: ${chat.aim}`,
    ...list("Threads", chat.threads, (t) => `[${t.status}] ${t.title}${t.work_key ? ` (work ${t.work_key})` : ""}${t.note ? ` --- ${t.note}` : ""}`),
    ...list(`${OWNER_NAME}'s preferences in this chat`, chat.preferences),
    ...list("Learned", chat.learned),
    ...list("Ruled out", chat.ruled_out, (r) => `${r.what} --- ${r.why}`),
    ...list("Files that matter", chat.files, (f) => `${f.path} --- ${f.why}`),
    ...list("Open questions", chat.open_questions),
    `In flight: ${chat.in_flight ?? "-"}`,
    `Next: ${chat.next ?? "-"}`,
  ];
}

const CHAT_FIELDS = ["kind", "aim", "threads", "preferences", "learned", "ruled_out", "files", "open_questions", "in_flight", "next", "reload_pending"];

async function writeChat(db, key, patch, sessionId) {
  const unknown = Object.keys(patch).filter((f) => !CHAT_FIELDS.includes(f));
  if (unknown.length) throw new Error(`chat_states has no field ${unknown.join(", ")}; allowed: ${CHAT_FIELDS.join(", ")}`);
  const now = new Date();
  await db.collection("chat_states").updateOne(
    { key },
    {
      $set: { ...patch, updated_at: now },
      $setOnInsert: { key, created_at: now, created_by: "claude", schema_version: 1 },
      ...(sessionId ? { $addToSet: { session_ids: sessionId } } : {}),
    },
    { upsert: true },
  );
}

async function precompact(db) {
  const input = JSON.parse(readStdin() || "{}");
  const { work } = await findCurrentWork(db, { cwd: input.cwd, sessionId: input.session_id, transcriptPath: input.transcript_path });
  const lines = ["Development SOPs: in the summary, keep the work key and say which decisions, scope outcomes, promises and drafts were NOT yet written to the store."];
  const chat = input.session_id ? await db.collection("chat_states").findOne({ session_ids: input.session_id }) : null;
  if (chat) lines.push(`The chat state ${chat.key} is reloaded after this compaction, so the summary can stay short on anything it holds: ${chat.aim}`);
  if (work) lines.push(`Current work key: ${work.key}. Its stored state was last written ${ago(work.current_state?.updated_at)}.`);
  process.stdout.write(lines.join("\n") + "\n");
}

const SERIES = { context: { prefix: "C", counter: "next_context" }, question: { prefix: "Q", counter: "next_question" } };
const pointLabel = ({ kind, n }) => `${SERIES[kind].prefix}${String(n).padStart(2, "0")}`;

function withBase(doc, sessionId) {
  const now = new Date();
  return {
    ...doc,
    created_at: doc.created_at ?? now,
    updated_at: now,
    created_by: doc.created_by ?? "claude",
    schema_version: 1,
    session_ids: [...new Set([...(doc.session_ids || []), ...(sessionId ? [sessionId] : [])])],
  };
}

function explain(error) {
  const details = error.errInfo?.details;
  if (!details) return error.message;
  const problems = [];
  (function walk(node, field) {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, field));
    if (!node || typeof node !== "object") return;
    if (node.missingProperties) problems.push(`missing ${node.missingProperties.join(", ")}`);
    const enumFailure = node.propertyName && node.details?.find((d) => d.specifiedAs?.enum);
    if (enumFailure) {
      problems.push(`bad value for ${node.propertyName}: ${JSON.stringify(enumFailure.consideredValue)} (allowed: ${enumFailure.specifiedAs.enum.join(", ")})`);
    } else if (node.propertyName && node.details?.some((d) => d.operatorName !== "not")) {
      problems.push(`bad value for ${node.propertyName} (${node.details.map((d) => d.reason ?? d.operatorName).join("; ")})`);
    }
    for (const v of Object.values(node)) if (typeof v === "object") walk(v, node.propertyName ?? field);
  })(details);
  return `refused by the schema: ${[...new Set(problems)].join("; ")}. \`developer-sop fields <collection>\` lists what it needs.`;
}

async function jsonSchema(db, collection) {
  const [info] = await db.listCollections({ name: collection }).toArray();
  if (!info) throw new Error(`no collection ${collection}`);
  return info.options.validator.$jsonSchema;
}

const BASE_FIELDS = ["created_at", "updated_at", "created_by", "schema_version", "session_ids", "tags"];

// What a row needs, read from the live validator, so this never drifts from the schema.
async function fields(db, collection) {
  const schema = await jsonSchema(db, collection);
  const lines = [`${collection}: required ${schema.required.filter((f) => !BASE_FIELDS.includes(f)).join(", ")}`];
  for (const [name, spec] of Object.entries(schema.properties)) {
    if (BASE_FIELDS.includes(name)) continue;
    if (spec.enum) lines.push(`  ${name}: one of ${spec.enum.join(", ")}`);
    else if (spec.properties?.kind?.enum) lines.push(`  ${name}.kind: one of ${spec.properties.kind.enum.join(", ")}`);
    else lines.push(`  ${name}: ${spec.bsonType ?? "any"}`);
  }
  for (const rule of schema.allOf ?? []) {
    const [[field, condition]] = Object.entries(rule.anyOf[0].properties);
    lines.push(`  when ${field} is ${condition.not.enum.join(" or ")}: also ${rule.anyOf[1].required.join(", ")}`);
  }
  if (schema.additionalProperties === false) lines.push("  no other fields");
  return lines.join("\n");
}

// A new answer or wait may replace one already open on the same work item, and nobody re-reads
// old rows while answering. So a decision or an open item is refused until it says what it
// replaces: "replaces": "<id>" (or a list), which closes those rows, or "replaces": "none".
const REPLACEABLE = ["decisions", "open_items"];

async function openRows(db, workKey) {
  const [decisions, items] = await Promise.all([
    db.collection("decisions").find({ work_key: workKey, status: "active" }).sort({ created_at: 1 }).toArray(),
    db.collection("open_items").find({ work_key: workKey, source: "local", status: "open" }).sort({ created_at: 1 }).toArray(),
  ]);
  return [
    ...decisions.map((d) => ({ collection: "decisions", id: d._id, text: `decision: ${oneLine(d.statement, 110)}` })),
    ...items.map((o) => ({ collection: "open_items", id: o._id, text: `${o.type}: ${oneLine(o.text, 110)}` })),
  ];
}

async function rowsReplaced(db, doc) {
  const open = await openRows(db, doc.work_key);
  if (doc.replaces === undefined) {
    if (!open.length) return [];
    throw new Error(`${doc.work_key} already has these open; add "replaces":"<id>" for the one this answers or replaces, or "replaces":"none":\n` +
      open.map((r) => `  ${r.id}  ${r.text}`).join("\n"));
  }
  if (doc.replaces === "none") return [];
  const ids = [doc.replaces].flat().map(String);
  const found = ids.map((id) => open.find((r) => r.id.toString() === id));
  const missing = ids.filter((_, i) => !found[i]);
  if (missing.length) throw new Error(`replaces names ${missing.join(", ")}, which is not an open decision or open item of ${doc.work_key}`);
  return found;
}

async function closeReplaced(db, replaced, newId) {
  for (const row of replaced) {
    const closed = row.collection === "decisions"
      ? { status: "superseded", superseded_by: newId }
      : { status: "closed", closed_by: newId };
    await db.collection(row.collection).updateOne({ _id: row.id }, { $set: { ...closed, updated_at: new Date() } });
  }
}

// The page shows only the fields the schema names, so a work row refuses any other.
async function refuseUnknownWorkFields(db, doc) {
  const known = new Set(["_id", ...Object.keys((await jsonSchema(db, "work")).properties)]);
  const unknown = Object.keys(doc).filter((k) => !known.has(k));
  if (unknown.length) throw new Error(`work has no field ${unknown.join(", ")}; \`developer-sop fields work\` lists them (a plan is a notes row, type plan)`);
}

async function main() {
  if (command === "remind") return remind();
  const client = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 1500 });
  try {
    await client.connect();
  } catch {
    if (command === "prompt") return await prompt(null);
    if (command === "context" || command === "precompact") {
      process.stdout.write("Development SOPs: the store is down (run `developer-sop up`). Follow the Development SOPs rules (RULES.md) anyway.\n");
      return;
    }
    throw new Error("store is down: run `developer-sop up`");
  }
  const db = client.db();
  const sessionId = flag("session");
  const limit = Number(flag("limit") ?? 20);
  const status = flag("status");
  // zsh does not split an unquoted "$SS", so "--session <id>" can arrive as one argument; ignoring
  // it would save the row with no session, and the next session could not find its work.
  const strayFlag = args.find((a) => typeof a === "string" && a.startsWith("--"));
  if (strayFlag && command !== "context") {
    console.error(`developer-sop: unknown argument ${JSON.stringify(strayFlag)}; pass --session and its id as two arguments`);
    process.exitCode = 1;
    await client.close();
    return;
  }
  try {
    switch (command) {
      case "context": return await context(db);
      case "precompact": return await precompact(db);
      case "prompt": return await prompt(db);
      case "chat": {
        const [key, json] = args;
        if (!key) throw new Error("usage: developer-sop chat <key> '<json of fields to set>'   or   developer-sop chat <key>   to print it");
        if (json) { await writeChat(db, key, parseJson(json), sessionId); console.log(`chat state ${key} saved`); return; }
        const chat = await db.collection("chat_states").findOne({ key });
        if (!chat) throw new Error(`no chat state ${key}`);
        console.log(chatBlock(chat).join("\n"));
        return;
      }
      case "put": {
        const [collection, json] = args;
        if (collection === "points" || collection === "walkthroughs")
          throw new Error(`write ${collection} with the step, point and answer commands, so point numbers stay fixed`);
        const doc = withBase(parseJson(json ?? readStdin()), sessionId);
        if (collection === "work") await refuseUnknownWorkFields(db, doc);
        const replaced = REPLACEABLE.includes(collection) ? await rowsReplaced(db, doc) : [];
        const result = await db.collection(collection).insertOne(doc);
        await closeReplaced(db, replaced, result.insertedId);
        if (doc.work_key) await db.collection("work").updateOne({ key: doc.work_key }, { $set: { updated_at: new Date() } });
        return console.log(collection === "work" ? doc.key : result.insertedId.toString());
      }
      case "set": {
        const [collection, ref, json] = args;
        const patch = parseJson(json ?? readStdin());
        if (collection === "points" || collection === "walkthroughs")
          throw new Error(`change ${collection} with the step and answer commands, so point numbers stay fixed`);
        if (collection === "work") await refuseUnknownWorkFields(db, patch);
        const update = { $set: { ...patch, updated_at: new Date() } };
        if (sessionId) update.$addToSet = { session_ids: sessionId };
        const result = await db.collection(collection).updateOne(idFilter(collection, ref), update);
        if (result.matchedCount === 0) throw new Error(`no ${collection} row ${ref}`);
        return console.log(`updated ${collection} ${ref}`);
      }
      case "push": {
        const [collection, ref, field, json] = args;
        const result = await db.collection(collection).updateOne(idFilter(collection, ref),
          { $push: { [field]: parseJson(json) }, $set: { updated_at: new Date() } });
        if (result.matchedCount === 0) throw new Error(`no ${collection} row ${ref}`);
        return console.log(`pushed to ${collection} ${ref}.${field}`);
      }
      case "state": {
        const [key, json] = args;
        if (!key || !json) throw new Error("usage: developer-sop state <work_key> '{\"done\":\"...\",\"in_flight\":\"...\",\"next\":\"...\"}'");
        const state = { ...parseJson(json), updated_at: new Date() };
        const update = { $set: { current_state: state, updated_at: new Date() } };
        if (sessionId) update.$addToSet = { session_ids: sessionId };
        const result = await db.collection("work").updateOne({ key }, update);
        if (result.matchedCount === 0) throw new Error(`no work item ${key}`);
        return console.log(`state written for ${key}`);
      }
      case "find": {
        const [collection, json = "{}"] = args;
        const rows = await db.collection(collection).find(parseJson(json)).sort({ updated_at: -1 }).limit(limit).toArray();
        return console.log(BSON.EJSON.stringify(rows, null, 1, { relaxed: true }));
      }
      case "fields": {
        if (!args[0]) throw new Error("usage: developer-sop fields <collection>");
        return console.log(await fields(db, args[0]));
      }
      case "id": {
        // id <collection> '<filter>' -> one id per line, newest first (a work row's id is its key)
        const [collection, json = "{}"] = args;
        const rows = await db.collection(collection).find(parseJson(json)).sort({ updated_at: -1 }).limit(limit).toArray();
        return console.log(rows.map((r) => (collection === "work" ? r.key : r._id.toString())).join("\n"));
      }
      case "show": {
        const work = await db.collection("work").findOne({ key: args[0] });
        if (!work) throw new Error(`no work item ${args[0]}`);
        return console.log((await workBlock(db, work)).join("\n"));
      }
      case "sync-github": {
        const rows = await db.collection("open_items").find({ source: "github" }).toArray();
        for (const row of rows) {
          const out = execFileSync("gh", ["issue", "view", String(row.github.issue), "--repo", row.github.repo,
            "--json", "title,state,assignees,labels"], { encoding: "utf8", timeout: 20000 });
          const issue = JSON.parse(out);
          await db.collection("open_items").updateOne({ _id: row._id }, { $set: { updated_at: new Date(), cache: {
            title: issue.title, state: issue.state, assignees: issue.assignees.map((a) => a.login),
            labels: issue.labels.map((l) => l.name), synced_at: new Date() } } });
          console.log(`#${row.github.issue} ${issue.state} ${issue.title}`);
        }
        return;
      }
      case "list": {
        const filter = status ? { status } : { status: { $in: ACTIVE } };
        const rows = await db.collection("work").find(filter).sort({ updated_at: -1 }).limit(50).toArray();
        return console.log(rows.map((w) => `${w.key} [${w.status}] ${w.title} --- ${ago(w.updated_at)}`).join("\n"));
      }
      case "step": {
        // step <work_key> <step_id> '{"title":..., "diagram":..., "after":"<step_id>"}'
        const [key, id, json] = args;
        const { after, ...fields } = parseJson(json ?? readStdin());
        if (!(await db.collection("work").findOne({ key }))) throw new Error(`no work item ${key}`);
        const walk = (await db.collection("walkthroughs").findOne({ work_key: key })) ??
          withBase({ work_key: key, steps: [], next_context: 1, next_question: 1 }, sessionId);
        const old = walk.steps.find((s) => s.id === id);
        const step = { ...old, ...fields, id };
        const steps = walk.steps.filter((s) => s.id !== id);
        const at = after ? steps.findIndex((s) => s.id === after) + 1 : old ? walk.steps.indexOf(old) : steps.length;
        if (after && at === 0) throw new Error(`no step ${after} in ${key}`);
        steps.splice(at, 0, step);
        await db.collection("walkthroughs").replaceOne({ work_key: key },
          { ...withBase(walk, sessionId), steps }, { upsert: true });
        return console.log(`step ${id} of ${key}: ${steps.map((s) => s.id).join(" > ")}`);
      }
      case "summary": {
        // summary <work_key> "two lines on what the work is" -> shown above step 1
        const [key, text] = args;
        if (!text) throw new Error("usage: developer-sop summary <work_key> \"<two lines>\"");
        if (!(await db.collection("work").findOne({ key }))) throw new Error(`no work item ${key}`);
        const walk = (await db.collection("walkthroughs").findOne({ work_key: key })) ??
          withBase({ work_key: key, steps: [], next_context: 1, next_question: 1 }, sessionId);
        await db.collection("walkthroughs").replaceOne({ work_key: key },
          { ...withBase(walk, sessionId), summary: text }, { upsert: true });
        return console.log(`summary set for ${key}`);
      }
      case "point": {
        // point <work_key> <step_id> '{"text":..., "kind":"question", "pick":...}' -> prints its label, Q01 or C01
        const [key, step, json] = args;
        const fields = parseJson(json ?? readStdin());
        const kind = fields.kind ?? "context";
        if (!SERIES[kind]) throw new Error(`a point's kind is context or question, not ${kind}`);
        const walk = await db.collection("walkthroughs").findOne({ work_key: key });
        if (!walk?.steps.some((s) => s.id === step)) throw new Error(`no step ${step} in ${key}; add it with step first`);
        const counter = await db.collection("walkthroughs").findOneAndUpdate({ work_key: key },
          { $inc: { [SERIES[kind].counter]: 1 }, $set: { updated_at: new Date() } }, { returnDocument: "before" });
        const n = counter[SERIES[kind].counter];
        await db.collection("points").insertOne(withBase({ status: kind === "question" ? "open" : "info",
          ...fields, kind, work_key: key, step, n }, sessionId));
        return console.log(pointLabel({ kind, n }));
      }
      case "answer": {
        // answer <work_key> <Q14|C03> '{"status":"yes", "answer":"their words", "decision_id":"..."}'
        const [key, label, json] = args;
        const patch = parseJson(json ?? readStdin());
        if ("n" in patch || "kind" in patch || "work_key" in patch) throw new Error("a point's label and work item never change");
        const match = /^([CQ])0*(\d+)$/i.exec(label ?? "");
        if (!match) throw new Error(`name a point as Q14 or C03, not ${label}`);
        const kind = match[1].toUpperCase() === "Q" ? "question" : "context";
        const update = { $set: { ...patch, updated_at: new Date() } };
        if (sessionId) update.$addToSet = { session_ids: sessionId };
        const result = await db.collection("points").updateOne({ work_key: key, kind, n: Number(match[2]) }, update);
        if (result.matchedCount === 0) throw new Error(`no point ${label} in ${key}`);
        return console.log(`${pointLabel({ kind, n: Number(match[2]) })} of ${key} updated`);
      }
      default:
        throw new Error("usage: developer-sop put|set|push|state|find|id|fields|show|list|step|summary|point|answer|sync-github|context|precompact|remind ...");
    }
  } catch (error) {
    console.error(`developer-sop: ${explain(error)}`);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

await main();
