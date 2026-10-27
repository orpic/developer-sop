// Development SOPs store: collections, validators and indexes. Safe to run again:
// existing collections get their validator updated, indexes are created if missing.
const dbx = db.getSiblingDB("developer-sop");

const base = {
  created_at: { bsonType: "date" },
  updated_at: { bsonType: "date" },
  created_by: { enum: ["claude", "owner"] },
  session_ids: { bsonType: "array", items: { bsonType: "string" } },
  tags: { bsonType: "array", items: { bsonType: "string" } },
  schema_version: { bsonType: "int" },
};
const baseRequired = ["created_at", "updated_at", "created_by", "schema_version"];
const workKey = { bsonType: "string", pattern: "^[a-z0-9][a-z0-9-]*$" };

function schema(required, properties, extra = {}) {
  return { $jsonSchema: { bsonType: "object", required: [...baseRequired, ...required],
    properties: { ...base, ...properties }, ...extra } };
}

const collections = {
  work: schema(["key", "title", "kind", "status"], {
    key: workKey,
    title: { bsonType: "string", minLength: 3 },
    kind: { enum: ["change", "investigation", "prod_watch", "backfill", "eval", "research", "review",
                   "e2e", "incident", "spike", "chore", "archive"] },
    status: { enum: ["planned", "active", "waiting", "blocked", "done", "abandoned"] },
    goal: { bsonType: "string" },
    branches: { bsonType: "array", items: { bsonType: "object", required: ["name"] } },
    github: { bsonType: "object" },
    current_state: { bsonType: "object" },
    waiting_on: { bsonType: "string" },
    verdict: { bsonType: "string" },
  }),
  decisions: schema(["work_key", "statement", "why", "type", "decided_by", "needs_owner", "status"], {
    work_key: workKey,
    statement: { bsonType: "string", minLength: 5 },
    why: { bsonType: "string", minLength: 3 },
    type: { enum: ["scope_drop", "defer", "irreversible", "affects_others", "design", "naming", "process",
                   "working_rule"] },
    needs_owner: { bsonType: "bool" },
    status: { enum: ["active", "superseded", "reversed"] },
  }),
  scope_items: schema(["work_key", "source", "outcome"], {
    work_key: workKey,
    source: { bsonType: "object", required: ["kind", "ref"],
              properties: { kind: { enum: ["issue", "spec", "plan", "tasks"] } } },
    outcome: { enum: ["open", "built", "built_as", "deferred", "dropped"] },
  }),
  open_items: schema(["work_key", "source"], {
    work_key: workKey,
    source: { enum: ["github", "local"] },
    type: { enum: ["question", "promise", "wait", "risk"] },
  }),
  notes: schema(["work_key", "type", "title", "body"], {
    work_key: workKey,
    type: { enum: ["plan", "findings", "investigation", "research", "runbook", "state_history",
                   "explainer", "handoff", "meeting", "inventory"] },
  }),
  evidence: schema(["work_key", "system", "query", "ran_at", "result_summary"], {
    work_key: workKey,
    system: { enum: ["prod_postgres", "redshift", "new_relic", "athena", "cloudwatch", "s3", "daytona",
                     "gh", "local", "other"] },
  }),
  artifacts: schema(["work_key", "name", "kind"], {
    work_key: workKey,
    kind: { enum: ["script", "result", "log", "diff", "payload", "fixture", "screenshot", "dataset",
                   "bundle", "config"] },
  }),
  drafts: schema(["work_key", "target", "body", "status"], {
    work_key: workKey,
    target: { enum: ["pr_body", "pr_title", "issue_body", "issue_comment", "review", "review_reply",
                     "slack", "commit_message", "email", "plan", "chat"] },
    status: { enum: ["draft", "shown", "approved", "posted", "abandoned"] },
  }),
  watches: schema(["work_key", "title", "started_at", "until", "status"], {
    work_key: workKey, status: { enum: ["running", "over"] },
  }),
  watch_events: schema(["watch_id", "item_id", "event", "at"], {
    event: { enum: ["NEW", "END", "FLAG", "STALL", "READ_FAILED", "READ_RECOVERED", "RESTART", "OVER", "CHANGE"] },
  }),
  resources: schema(["work_key", "kind", "name", "cleanup"], {
    work_key: workKey,
    kind: { enum: ["daytona_sandbox", "daytona_snapshot", "docker_stack", "worktree", "branch", "bundle",
                   "background_job", "s3_object", "test_user", "file"] },
    cleanup: { enum: ["pending", "done", "keep"] },
  }),
  sessions: schema(["session_id"], { session_id: { bsonType: "string" } }),
  // One per work item: the steps of the explainer, in order. Each step is a diagram and its points.
  walkthroughs: schema(["work_key", "steps", "next_context", "next_question"], {
    work_key: workKey,
    next_context: { bsonType: "int", minimum: 1 },
    next_question: { bsonType: "int", minimum: 1 },
    steps: { bsonType: "array", items: { bsonType: "object", required: ["id", "title"], properties: {
      id: workKey,
      title: { bsonType: "string", minLength: 2 },
      diagram: { bsonType: "string" },
      layout: { enum: ["auto", "side", "wide"] },
    } } },
    summary: { bsonType: "string", maxLength: 400 },
  }),
  // What a piece of code is for, in one or two plain sentences, shown when its link is hovered.
  // One row per file and name; every page that links it reuses the row.
  code_intents: schema(["path", "name", "intent"], {
    path: { bsonType: "string", minLength: 3 },
    name: { bsonType: "string", minLength: 1 },
    intent: { bsonType: "string", minLength: 10, maxLength: 400 },
  }),
  // Present mode's overrides for one work item: per step, the order its boxes are drawn in.
  // With no row, the slides are worked out from the walkthrough alone.
  presentations: schema(["work_key", "steps"], {
    work_key: workKey,
    steps: { bsonType: "array", items: { bsonType: "object", required: ["step"], properties: {
      step: workKey,
      order: { bsonType: "array", items: { bsonType: "string" } },
    } } },
  }),
  // One per chat: what the chat holds that the store does not, so it can be cleared and reloaded.
  // Updated in place; a list is replaced whole, so dropped items are forgotten, not piled up.
  chat_states: schema(["key", "kind", "aim"], {
    key: workKey,
    kind: { enum: ["goal", "research", "explore", "broad", "support"] },
    aim: { bsonType: "string", minLength: 5 },
    threads: { bsonType: "array", items: { bsonType: "object", required: ["title", "status"], properties: {
      title: { bsonType: "string" },
      status: { enum: ["active", "parked", "done", "dropped"] },
      work_key: workKey,
      note: { bsonType: "string" },
    } } },
    preferences: { bsonType: "array", items: { bsonType: "string" } },
    learned: { bsonType: "array", items: { bsonType: "string" } },
    ruled_out: { bsonType: "array", items: { bsonType: "object", required: ["what", "why"] } },
    files: { bsonType: "array", items: { bsonType: "object", required: ["path", "why"] } },
    open_questions: { bsonType: "array", items: { bsonType: "string" } },
    in_flight: { bsonType: "string" },
    next: { bsonType: "string" },
    reload_pending: { bsonType: "bool" },
    last_tokens: { bsonType: "int" },
  }),
  // A point under a step, shown as C01 (context) or Q01 (question). Its number never changes and
  // the row is never deleted: a point that is no longer wanted gets status "dropped".
  points: schema(["work_key", "n", "step", "text", "kind", "status"], {
    work_key: workKey,
    n: { bsonType: "int", minimum: 1 },
    step: workKey,
    text: { bsonType: "string", minLength: 2 },
    kind: { enum: ["context", "question"] },
    status: { enum: ["info", "open", "yes", "no", "changed", "undecided", "dropped"] },
  }),
};

// Required-when rules. Mongo's $jsonSchema has no if/then, so each is "not this case, or has the field".
function requiredWhen(field, values, required) {
  return { anyOf: [{ properties: { [field]: { not: { enum: values } } } }, { required }] };
}
collections.work.$jsonSchema.allOf = [
  requiredWhen("status", ["waiting", "blocked"], ["waiting_on"]),
  requiredWhen("status", ["done", "abandoned"], ["verdict"]),
];
collections.decisions.$jsonSchema.allOf = [requiredWhen("type", ["defer"], ["deferred_to"])];
collections.points.$jsonSchema.allOf = [requiredWhen("kind", ["question"], ["pick"])];
collections.scope_items.$jsonSchema.allOf = [requiredWhen("outcome", ["deferred", "dropped"], ["decision_id"])];
collections.open_items.$jsonSchema.allOf = [
  requiredWhen("source", ["github"], ["github"]),
  requiredWhen("source", ["local"], ["text", "type", "owner", "status"]),
];

const existing = dbx.getCollectionNames();
for (const [name, validator] of Object.entries(collections)) {
  if (existing.includes(name)) {
    dbx.runCommand({ collMod: name, validator, validationLevel: "strict", validationAction: "error" });
  } else {
    dbx.createCollection(name, { validator, validationLevel: "strict", validationAction: "error" });
  }
}

dbx.work.createIndex({ key: 1 }, { unique: true });
dbx.work.createIndex({ status: 1, updated_at: -1 });
dbx.work.createIndex({ "github.prs": 1 });
dbx.work.createIndex({ "github.issues": 1 });
dbx.work.createIndex({ "branches.name": 1 });
dbx.decisions.createIndex({ work_key: 1, status: 1 });
dbx.decisions.createIndex({ needs_owner: 1, "approved.at": 1 });
dbx.decisions.createIndex({ "affects.who": 1 });
dbx.scope_items.createIndex({ work_key: 1, outcome: 1 });
dbx.open_items.createIndex({ work_key: 1, source: 1, status: 1 });
dbx.open_items.createIndex({ "github.repo": 1, "github.issue": 1 });
dbx.notes.createIndex({ work_key: 1, type: 1 });
dbx.notes.createIndex({ title: "text", body: "text" });
dbx.evidence.createIndex({ work_key: 1, ran_at: -1 });
dbx.artifacts.createIndex({ work_key: 1, kind: 1 });
dbx.drafts.createIndex({ work_key: 1, status: 1 });
dbx.watches.createIndex({ status: 1, until: 1 });
dbx.watch_events.createIndex({ watch_id: 1, at: 1 });
dbx.resources.createIndex({ cleanup: 1, kind: 1 });
dbx.sessions.createIndex({ session_id: 1 }, { unique: true });
dbx.chat_states.createIndex({ key: 1 }, { unique: true });
dbx.chat_states.createIndex({ session_ids: 1 });
dbx.chat_states.createIndex({ reload_pending: 1, updated_at: -1 });
dbx.walkthroughs.createIndex({ work_key: 1 }, { unique: true });
dbx.presentations.createIndex({ work_key: 1 }, { unique: true });
dbx.code_intents.createIndex({ path: 1, name: 1 }, { unique: true });
if (dbx.points.getIndexes().some((i) => i.name === "work_key_1_n_1")) dbx.points.dropIndex("work_key_1_n_1");
dbx.points.createIndex({ work_key: 1, kind: 1, n: 1 }, { unique: true });
dbx.points.createIndex({ work_key: 1, step: 1, n: 1 });

print("developer-sop collections: " + dbx.getCollectionNames().sort().join(", "));
