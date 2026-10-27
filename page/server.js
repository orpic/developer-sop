import http from "node:http";
import { readFile } from "node:fs/promises";
import { MongoClient } from "mongodb";
import { marked } from "marked";

const client = new MongoClient(process.env.MONGO_URL);
await client.connect();
const db = client.db();
const ACTIVE = ["planned", "active", "waiting", "blocked"];
const REPO = (process.env.REPO_URL || "").replace(/\/$/, "");
const OWNER_NAME = process.env.OWNER_NAME || "the owner";
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const HAND = "Virgil, 'Comic Sans MS', cursive";
// Every page reads these colours: dark by default, light when the system asks. Rules: DESIGN.md.
const DARK = "--bg:#000;--panel:#14171c;--card:#0a0c0f;--deep:#0a0c0f;--line:#3a4049;--fg:#f2f4f7;--dim:#a8b0bb;--acc:#5cb8ff;--warn:#ffb020;--ok:#5fd38d;--bad:#ff6b6b";
const LIGHT = "--bg:#f3f4f6;--panel:#ffffff;--card:#f9fafb;--deep:#fbfbfc;--line:#cfd4dc;--fg:#0f1419;--dim:#4b5563;--acc:#0a6cd4;--warn:#b26a00;--ok:#1a7f45;--bad:#c62828";
const THEME_CSS = `:root{${DARK}}@media (prefers-color-scheme: light){:root{${LIGHT}}}`;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const when = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace("T", " ") + "Z" : "-");
const gh = (n, kind = "pull") => (REPO ? `<a href="${REPO}/${kind}/${n}">#${n}</a>` : `#${n}`);
// A link to a file on main opens that file in VS Code at its first line, as a tab in the window
// already open; the store keeps the GitHub link. Any other link opens in a new tab.
const LOCAL_REPO = process.env.LOCAL_REPO;
const MAIN_FILE = REPO ? new RegExp(`^${escapeRegExp(REPO)}/blob/main/([^#?]+)(?:#L(\\d+))?`) : null;
const ANY_FILE = REPO ? new RegExp(`^${escapeRegExp(REPO)}/blob/[^/]+/([^#?]+)`) : null;
// What each linked piece of code is for (code_intents), read fresh for every page.
let intents = new Map();
async function loadIntents() {
  const rows = await db.collection("code_intents").find({}, { projection: { path: 1, name: 1, intent: 1 } }).toArray();
  intents = new Map(rows.map((r) => [`${r.path}#${r.name}`, r.intent]));
}
const plainName = (tokens) => tokens.map((t) => t.text ?? t.raw ?? "").join("").replace(/`/g, "").trim();
marked.use({ renderer: { link({ href, title, tokens }) {
  const text = this.parser.parseInline(tokens);
  const file = ANY_FILE && ANY_FILE.exec(href);
  const intent = file && intents.get(`${file[1]}#${plainName(tokens)}`);
  const hover = intent ? ` data-intent="${esc(intent)}"` : "";
  const local = LOCAL_REPO && MAIN_FILE && MAIN_FILE.exec(href);
  if (local) {
    const target = `vscode://file${LOCAL_REPO}/${local[1]}:${local[2] ?? 1}`;
    return `<a href="${esc(target)}" class="code-link"${hover} data-where="${esc(`${local[1]}${local[2] ? `:${local[2]}` : ""}`)}">${text}</a>`;
  }
  return `<a href="${esc(href)}" target="_blank" rel="noopener"${hover}${title ? ` title="${esc(title)}"` : ""}>${text}</a>`;
} } });

// Hovering a code link for a moment shows what that code is for, and where it is.
const TOOLTIP = `<div id="tip" role="tooltip"></div><script>
(() => {
  const tip = document.getElementById("tip");
  let timer = null;
  document.addEventListener("mouseover", (e) => {
    const a = e.target.closest("a[data-intent], a[data-where]");
    if (!a || a.contains(e.relatedTarget)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      tip.innerHTML = (a.dataset.intent ? "<div>" + a.dataset.intent.replace(/[&<]/g, (c) => c === "&" ? "&amp;" : "&lt;").replace(/\x60([^\x60]+)\x60/g, "<code>$1</code>") + "</div>" : "")
        + (a.dataset.where ? "<div class=w>" + a.dataset.where + " &middot; opens in VS Code</div>" : "");
      const r = a.getBoundingClientRect();
      tip.style.left = Math.max(8, Math.min(innerWidth - 400, r.left)) + "px";
      tip.style.top = (r.bottom + 8 + 120 > innerHeight ? r.top - 8 - tip.offsetHeight : r.bottom + 8) + "px";
      tip.classList.add("on");
      document.dispatchEvent(new Event("tip-open"));
      if (r.bottom + 8 + tip.offsetHeight > innerHeight) tip.style.top = (r.top - 8 - tip.offsetHeight) + "px";
    }, 300);
  });
  document.addEventListener("mouseout", (e) => {
    const a = e.target.closest("a[data-intent], a[data-where]");
    if (!a || a.contains(e.relatedTarget)) return;
    clearTimeout(timer);
    if (tip.classList.contains("on")) document.dispatchEvent(new Event("tip-close"));
    tip.classList.remove("on");
  });
})();
</script>`;
const TOOLTIP_CSS = `#tip{position:fixed;z-index:50;max-width:390px;padding:10px 12px;border-radius:8px;background:var(--tip-bg);color:var(--tip-fg);border:1px solid var(--tip-line);font:14px/1.45 -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25);opacity:0;transform:translateY(4px);transition:opacity .15s,transform .15s;pointer-events:none}
:root{--tip-bg:var(--panel);--tip-fg:var(--fg);--tip-line:var(--line);--link:var(--fg)}
#tip.on{opacity:1;transform:none}a.code-link,#caption a{color:inherit;text-decoration:underline dotted;text-underline-offset:3px;text-decoration-color:var(--muted)}a.code-link:hover,#caption a:hover{text-decoration-style:solid;text-decoration-color:var(--fg)}#tip code{font-size:13px;opacity:.9}#tip .w{margin-top:6px;font-size:12px;opacity:.7}a.code-link{text-decoration:underline dotted;text-underline-offset:3px}`;
const inline = (text) => marked.parseInline(String(text ?? ""));
const md = (text) => {
  const renderer = new marked.Renderer();
  renderer.code = ({ text: code, lang }) =>
    lang === "mermaid" ? `<pre class="mermaid">${esc(code)}</pre>` : `<pre><code class="language-${esc(lang || "plaintext")}">${esc(code)}</code></pre>`;
  return marked.parse(String(text ?? ""), { renderer });
};

// Classes a step's diagram can use: `new` for what this step adds, `focus` for the part a question is
// about, `dim` for the rest.
const CLASSES = [
  "classDef new fill:#ffec99,stroke:#f08c00,stroke-width:2px,color:#1d1d1b",
  "classDef focus fill:#ffc9c9,stroke:#e03131,stroke-width:3px,color:#1d1d1b",
  "classDef dim opacity:0.35",
];
const diagram = (source) =>
  /^\s*(flowchart|graph)\b/.test(source) ? `${source.trimEnd()}\n${CLASSES.join("\n")}` : source;

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/styles/github.min.css" media="(prefers-color-scheme: light)">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/styles/github-dark.min.css" media="(prefers-color-scheme: dark)">
<style>
@font-face{font-family:Virgil;src:url(/fonts/Virgil-Regular.woff2) format("woff2");font-display:swap}
${THEME_CSS}:root{--muted:var(--dim);--accent:var(--acc);--paper:var(--deep);--card:var(--panel);--focus:var(--ok)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{padding:0 32px 64px}@media (max-width:700px){main{padding:0 16px 48px}}
a{color:var(--accent)}h1{font-size:24px;margin:16px 0 4px}h2{font-size:17px;margin:32px 0 8px;border-bottom:1px solid var(--line);padding-bottom:4px}h3{font:500 10.5px ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:28px 0 8px}
.muted{color:var(--muted)}.pill{display:inline-block;padding:1px 8px;border-radius:10px;border:1px solid var(--line);font-size:12px;margin-right:4px}
.s-active,.s-open{color:var(--accent)}.s-waiting,.s-blocked,.s-undecided{color:var(--warn)}.s-done,.s-yes,.s-changed{color:var(--ok)}.s-abandoned,.s-dropped{color:var(--muted)}.s-no{color:var(--bad)}
table{border-collapse:collapse;width:100%;font-size:14px;display:block;overflow-x:auto}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:8px 0}.need{border-left:3px solid var(--warn)}
pre{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:10px;overflow-x:auto;font-size:13px}pre.mermaid{background:transparent;border:0;text-align:center;margin:0}
code{font-size:13px}.state div{margin:2px 0}.state b{display:inline-block;min-width:80px;color:var(--muted);font-weight:600}
.strip{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:6px 18px;align-items:baseline;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 0;font-size:13px}
.strip .t{font-weight:600;font-size:14px}.strip b{color:var(--muted);font:500 10.5px ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;margin-right:4px}
.step{margin:40px 0 0}.step>h2{font-family:${HAND};font-size:26px;font-weight:400;border:0;margin:0 0 10px}.step>h2 .k{color:var(--muted);font-size:18px;margin-right:10px}
.canvas{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:20px;overflow-x:auto}
.points{list-style:none;margin:18px 0 0;padding:0;display:flex;flex-direction:column;gap:6px;max-width:820px}
.pt .lead{color:var(--fg);font-weight:500}.pt .rest{color:var(--muted)}.pt .body{line-height:1.65}
.pt .body code,#caption code{font:12.5px ui-monospace,Menlo,monospace;color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);border-radius:4px;padding:1px 5px}
.pt .body a,#caption a{color:var(--accent)}
.pt{display:flex;gap:12px;padding:8px 10px;border-radius:8px}.pt,.step{scroll-margin-top:var(--strip,80px)}.pt:target{background:var(--card);outline:2px solid var(--warn)}
.pt .n{font-family:${HAND};font-size:22px;min-width:54px;text-decoration:none;text-align:right;color:var(--muted);line-height:1.2}
.pt.question{background:var(--card);border:1px solid var(--line)}.pt.question .n{color:var(--warn)}
.pt .pick,.pt .ans{font-size:13px;margin-top:4px}.pt .pick b,.pt .ans b{color:var(--muted)}
.pt.dropped .body>p:first-child{text-decoration:line-through;color:var(--muted)}
.pt .n:focus{outline:none}.pt .n:focus-visible{outline:2px solid var(--focus);outline-offset:4px;border-radius:6px}a:focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:4px}
.pt .body>p{margin:0}.pt .body p{margin:0 0 4px}.pt .body ol,.pt .body ul{margin:4px 0;padding-left:22px}
.nc{display:flex;flex-direction:column;align-items:flex-end;gap:4px}.copy{font:12px -apple-system,sans-serif;color:var(--muted);background:none;border:1px solid var(--line);border-radius:5px;padding:0 6px;cursor:pointer;opacity:.6}.copy:hover{opacity:1}.copy.done{color:var(--ok);border-color:var(--ok);opacity:1}details.records{margin-top:56px}details.records>summary{cursor:pointer;color:var(--muted)}
.pt .ctx{margin:4px 0 0}.pt .opts{list-style:upper-alpha;margin:6px 0 0;padding-left:22px;font-size:14px}.pt .opts li{margin:2px 0}.pt .opts li::marker{font-weight:700;color:var(--muted)}.pt .pick{font-size:14px;margin-top:6px}
.summary{font-size:17px;max-width:1100px;margin:20px 0 0;line-height:1.6}
${TOOLTIP_CSS}
.step.side{display:grid;grid-template-columns:auto minmax(360px,1fr);gap:0 32px;align-items:start}.step.side>h2{grid-column:1/-1}
.step.side .canvas{width:max-content}.step.side .points{margin:0}
@media (max-width:1000px){.step.side{display:block}.step.side .canvas{width:auto;max-width:none}.step.side .points{margin-top:14px}}
</style></head><body><main>${body}</main>${TOOLTIP}
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/highlight.min.js"></script>
<script type="module">
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs";
const light = matchMedia("(prefers-color-scheme: light)").matches;
const ink = light ? "#0f1419" : "#f2f4f7", paper = light ? "#fbfbfc" : "#0a0c0f", box = light ? "#ffffff" : "#14171c";
mermaid.initialize({ startOnLoad: false, theme: "base", look: "handDrawn", handDrawnSeed: 7, fontFamily: "${HAND}",
  themeVariables: { fontFamily: "${HAND}", fontSize: "18px", background: paper, primaryColor: box, primaryTextColor: ink,
    primaryBorderColor: ink, secondaryColor: box, tertiaryColor: box, lineColor: ink, textColor: ink, nodeTextColor: ink,
    edgeLabelBackground: paper, clusterBkg: paper, clusterBorder: ink },
  flowchart: { padding: 18, nodeSpacing: 60, rankSpacing: 70 } });
await document.fonts.load("18px Virgil");
await mermaid.run();
// A diagram much narrower than the page sits beside its points instead of above them.
for (const step of document.querySelectorAll(".step")) {
  const svg = step.querySelector(".canvas svg");
  const layout = step.dataset.layout;
  if (!svg || layout === "wide") continue;
  const width = svg.viewBox.baseVal.width;
  const fits = width + 42 <= step.clientWidth - 32 - 360;
  if (fits && (layout === "side" || width < step.clientWidth * 0.6)) {
    step.classList.add("side");
    svg.style.width = width + "px";
  }
}
const strip = document.querySelector(".strip");
if (strip) document.documentElement.style.setProperty("--strip", strip.offsetHeight + 16 + "px");
document.querySelector(location.hash || null)?.scrollIntoView();
window.hljs?.highlightAll();
// Copy a point: click its copy button, or press c while a point is targeted (#C03).
async function copyPoint(button) {
  await navigator.clipboard.writeText(button.dataset.copy);
  button.textContent = "copied";
  button.classList.add("done");
  setTimeout(() => { button.textContent = "copy"; button.classList.remove("done"); }, 1200);
}
document.addEventListener("click", (e) => { const b = e.target.closest(".copy"); if (b) copyPoint(b); });
addEventListener("keydown", (e) => {
  if (e.key !== "c" || e.metaKey || e.ctrlKey || e.altKey || /input|textarea/i.test(e.target.tagName)) return;
  const b = document.querySelector(":target .copy");
  if (b) copyPoint(b);
});
</script></body></html>`;
}

function table(headers, rows) {
  if (!rows.length) return `<p class="muted">None.</p>`;
  return `<table><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`;
}

function flowDiagram(work) {
  const lines = ["flowchart LR", `  W["${work.title.replace(/"/g, "'")}"]`];
  (work.github?.issues || []).forEach((n) => lines.push(`  W --- I${n}(["issue #${n}"])`));
  (work.branches || []).forEach((b, i) => {
    lines.push(`  B${i}["${b.name}${b.pr ? `<br/>PR #${b.pr}` : ""}${b.state ? `<br/>${b.state}` : ""}"]`);
    const base = (work.branches || []).findIndex((o) => o.name === b.base);
    lines.push(base >= 0 ? `  B${base} --> B${i}` : `  W --> B${i}`);
  });
  (work.links || []).forEach((l, i) => lines.push(`  W -. ${l.type} .-> L${i}["${l.work_key}"]`));
  return lines.length > 2 ? `<pre class="mermaid">${esc(lines.join("\n"))}</pre>` : "";
}

const span = (ms) => {
  const m = Math.round(Math.abs(ms) / 60000);
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};
const ago = (d) => (d ? span(Date.now() - new Date(d)) : "");
const STALE_MS = 2 * 86400000;

// The look shared by the home page and /all. Change a colour or a part here and both follow.
const DESIGN_CSS = `
${THEME_CSS}
*{box-sizing:border-box;margin:0}html{background:var(--bg)}body{background:var(--bg);color:var(--fg);font:13px/1.45 -apple-system,BlinkMacSystemFont,"Inter",sans-serif}
a{color:inherit;text-decoration:none}time,b,em,h2,.stat span,footer,.tag{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-variant-numeric:tabular-nums}
header{display:flex;align-items:center;gap:24px}header h1{font-size:14px;font-weight:600;letter-spacing:.03em;margin-right:auto}header h1 a:hover{color:var(--acc)}
.stat{display:flex;align-items:baseline;gap:6px;color:var(--dim)}.stat b{font-size:18px;color:var(--fg);font-weight:500}
.stat span{font-size:11px;text-transform:uppercase;letter-spacing:.08em}.stat.warn b{color:var(--warn)}.stat:hover span{color:var(--fg)}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column}
.panel.attention{border-color:var(--warn)}.panel.attention h2,.panel.attention .row time{color:var(--warn)}
h2{font-size:10.5px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);margin-bottom:8px}
.row{display:flex;gap:10px;padding:7px 0;border-top:1px solid var(--line)}.row:first-child{border-top:0}
.row>span{flex:1;min-width:0}.row:hover>span{color:var(--acc)}.row time,.row .tag{color:var(--dim);font-size:11px;white-space:nowrap}
.dim{color:var(--dim)}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));grid-auto-rows:min-content;gap:8px;align-content:start}
.tile{display:block;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:9px 11px;transition:border-color .12s}
.tile:hover{border-color:var(--acc)}.tile.more{color:var(--dim);text-align:center}
.tile.stale{background:transparent;border-style:dashed}.tile.stale .tt{font-weight:400;color:var(--dim)}.tile.stale .th i{background:transparent;border:1.5px solid var(--dim)}
.th{display:flex;align-items:center;gap:8px}.th i{width:8px;height:8px;border-radius:50%;background:var(--acc);flex:none}
.s-waiting .th i,.s-blocked .th i{background:var(--warn)}.s-planned .th i{background:var(--dim)}.s-done .th i{background:var(--ok)}.s-abandoned .th i{background:var(--dim)}
.tt{flex:1;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.th em{font-style:normal;color:var(--warn);font-size:11px}.th time{color:var(--dim);font-size:11px}
.nx{margin-top:4px;color:var(--dim);font-size:12px}
.clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
footer{display:flex;gap:18px;color:var(--dim);font-size:11px}footer a{margin-left:auto}footer a:hover{color:var(--fg)}
details>summary{cursor:pointer;list-style:none}details>summary::-webkit-details-marker{display:none}details[open]>summary{color:var(--acc)}
ul.plain{list-style:none;padding:0;margin:4px 0 8px}ul.plain li{padding:2px 0;color:var(--dim)}ul.plain li b{color:var(--fg);font-weight:500}
`;

async function loadLists() {
  const [work, needs, questions, openPoints, watches, resources] = await Promise.all([
    db.collection("work").find().sort({ updated_at: -1 }).limit(200).toArray(),
    db.collection("decisions").find({ status: "active", needs_owner: true, "approved.at": { $exists: false } }).toArray(),
    db.collection("open_items").find({ source: "local", status: "open", owner: "owner" }).toArray(),
    db.collection("points").find({ kind: "question", status: "open" }).toArray(),
    db.collection("watches").find({ status: "running" }).toArray(),
    db.collection("resources").find({ cleanup: "pending" }).toArray(),
  ]);
  const openQuestionsByWork = {};
  for (const p of openPoints) openQuestionsByWork[p.work_key] = (openQuestionsByWork[p.work_key] ?? 0) + 1;
  const attention = [
    ...needs.map((d) => ({ text: d.statement, key: d.work_key, tag: "decide" })),
    ...questions.map((q) => ({ text: q.text, key: q.work_key, tag: q.type })),
    ...Object.entries(openQuestionsByWork).map(([key, n]) => ({ text: `${key}: ${n} open question${n > 1 ? "s" : ""}`, key, tag: "page" })),
  ];
  return {
    active: work.filter((w) => ACTIVE.includes(w.status)),
    finished: work.filter((w) => !ACTIVE.includes(w.status)),
    attention, watches, resources, openQuestionsByWork,
  };
}

const stat = (n, label, href, warn) => `<a class="stat${warn && n ? " warn" : ""}" href="${href}"><b>${n}</b><span>${label}</span></a>`;
const listHeader = (l, base) => `<header><h1><a href="/">Development SOPs</a></h1>
${stat(l.attention.length, "requires attention", `${base}#you`, true)}${stat(l.active.length, "active", `${base}#work`)}${stat(l.watches.length, "watching", `${base}#watch`)}${stat(l.resources.length, "to clean", `${base}#clean`, true)}${stat(l.finished.length, "finished", "/all#finished")}</header>`;
const row = (href, text, side, clamp = true) => `<a class="row" href="${href}"><span${clamp ? ` class="clamp"` : ""}>${text}</span><time>${side}</time></a>`;
const panel = (id, title, rows, empty, extra = "") =>
  `<section class="panel ${extra}" id="${id}"><h2>${title}</h2><div class="list">${rows.join("") || `<p class="dim">${empty}</p>`}</div></section>`;
const tile = (w, openQuestions, clamp = true) => {
  const stale = ACTIVE.includes(w.status) && Date.now() - new Date(w.updated_at) > STALE_MS;
  const n = openQuestions[w.key];
  const next = w.waiting_on ? `waiting on ${w.waiting_on}` : ACTIVE.includes(w.status) ? w.current_state?.next ?? "" : w.verdict ?? "";
  return `<a class="tile s-${esc(w.status)}${stale ? " stale" : ""}" href="/work/${esc(w.key)}">
<div class="th"><i></i><span class="tt">${esc(w.title)}</span>${n ? `<em>${n}?</em>` : ""}<time>${ago(w.updated_at)}</time></div>
<div class="nx${clamp ? " clamp" : ""}">${esc(next)}</div></a>`;
};
const watchEnd = (w) => (w.until ? `ends in ${span(new Date(w.until) - Date.now())}` : "");
const shell = (title, css, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${DESIGN_CSS}${css}</style></head><body>${body}</body></html>`;

// One screen, no scroll: each panel shows what fits and links to the rest on /all.
async function homePage() {
  const l = await loadLists();
  return shell("Development SOPs", `
html,body{height:100%;overflow:hidden}
.app{height:100vh;display:grid;grid-template-rows:auto 1fr auto;gap:12px;padding:14px 18px}
.grid{min-height:0;display:grid;grid-template-columns:minmax(260px,1fr) 2.4fr minmax(260px,1fr);gap:12px}
.col{min-height:0;display:flex;flex-direction:column;gap:12px}.panel{min-height:0;flex:1}
.list,.tiles{min-height:0;flex:1;overflow:hidden}.list{display:flex;flex-direction:column}
@media (max-width:1000px){html,body{overflow:auto}.app{height:auto}.grid{grid-template-columns:1fr}}`,
  `<div class="app">${listHeader(l, "")}
<div class="grid">
<div class="col">${panel("you", "Requires attention", l.attention.map((t) => row(`/work/${esc(t.key)}`, esc(t.text), esc(t.tag))), "Nothing requires attention.", "attention")}</div>
<section class="panel" id="work"><h2>Active work &middot; ${l.active.length}</h2><div class="tiles">${l.active.map((w) => tile(w, l.openQuestionsByWork)).join("")}</div></section>
<div class="col">${panel("watch", "Watches running", l.watches.map((w) => row(`/work/${esc(w.work_key)}`, esc(w.title), watchEnd(w))), "No watches.")}
${panel("clean", "To clean up", l.resources.map((r) => row(`/work/${esc(r.work_key)}`, `${esc(r.name)} <span class="dim">${esc(r.kind)}</span>`, "")), "Nothing to clean.")}</div>
</div>
<footer><span>refreshes every minute</span><span>dashed, grey dot = no change in 2 days</span><a href="/all">full list &rarr;</a></footer>
</div><meta http-equiv="refresh" content="60"><script>
// Whatever does not fit in a panel is replaced by one "+N more" link to the full list.
for (const list of document.querySelectorAll(".list, .tiles")) {
  const fits = (el) => el.getBoundingClientRect().bottom <= list.getBoundingClientRect().bottom + 1;
  const items = [...list.children];
  if (items.every(fits)) continue;
  const more = document.createElement("a");
  more.className = list.classList.contains("tiles") ? "tile more" : "row dim";
  more.href = "/all#" + list.closest("section").id;
  list.append(more);
  let hidden = 0;
  const label = () => (more.textContent = "+" + hidden + " more");
  for (const el of items.reverse()) {
    label();
    if (fits(more)) break;
    el.remove();
    hidden++;
  }
  label();
}
</script>`);
}

// Everything, in full, in the same look as the home page. This page scrolls.
async function indexPage() {
  const l = await loadLists();
  const chats = await db.collection("chat_states").find().sort({ updated_at: -1 }).limit(20).toArray();
  return shell("Development SOPs: everything", `
.app{max-width:1400px;margin:0 auto;padding:14px 18px 60px;display:flex;flex-direction:column;gap:14px}
header{position:sticky;top:0;z-index:2;background:var(--bg);padding:10px 0;border-bottom:1px solid var(--line)}
.panel{scroll-margin-top:64px}.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media (max-width:900px){.two{grid-template-columns:1fr}}`,
  `<div class="app">${listHeader(l, "/all")}
${panel("you", `Requires attention &middot; ${l.attention.length}`, l.attention.map((t) => row(`/work/${esc(t.key)}`, esc(t.text), esc(t.tag), false)), "Nothing requires attention.", "attention")}
<section class="panel" id="work"><h2>Active work &middot; ${l.active.length}</h2><div class="tiles">${l.active.map((w) => tile(w, l.openQuestionsByWork, false)).join("") || `<p class="dim">None.</p>`}</div></section>
<div class="two">${panel("watch", `Watches running &middot; ${l.watches.length}`, l.watches.map((w) => row(`/work/${esc(w.work_key)}`, esc(w.title), watchEnd(w), false)), "No watches.")}
${panel("clean", `To clean up &middot; ${l.resources.length}`, l.resources.map((r) => row(`/work/${esc(r.work_key)}`, `${esc(r.name)} <span class="dim">${esc(r.kind)}${r.location ? ` &middot; ${esc(r.location)}` : ""}</span>`, "", false)), "Nothing to clean.")}</div>
${panel("chats", `Chats &middot; ${chats.length}`, chats.map(chatRow), "No chat states yet.")}
<section class="panel" id="finished"><h2>Finished &middot; ${l.finished.length}</h2><div class="tiles">${l.finished.map((w) => tile(w, {}, false)).join("") || `<p class="dim">None.</p>`}</div></section>
</div><script>document.querySelector(location.hash || null)?.scrollIntoView();</script>`);
}

function chatRow(c) {
  const list = (title, items, fmt) => (items?.length ? `<div class="dim">${title}</div><ul class="plain">${items.map((x) => `<li>${fmt(x)}</li>`).join("")}</ul>` : "");
  const size = c.last_tokens ? `${Math.round(c.last_tokens / 1000)}K tokens` : "size unknown";
  return `<details class="row"><summary style="display:flex;gap:10px;width:100%"><span style="flex:1"><b>${esc(c.key)}</b> <span class="dim">${esc(c.kind)} &middot; ${esc(c.aim)}</span></span><time>${size}${c.reload_pending ? ", reload pending" : ""} &middot; ${ago(c.updated_at)}</time></summary>
<div style="padding:8px 0 0 12px">
${list("Threads", c.threads, (t) => `<b>${esc(t.title)}</b> [${esc(t.status)}]${t.work_key ? ` <a href="/work/${esc(t.work_key)}">${esc(t.work_key)}</a>` : ""}${t.note ? ` --- ${esc(t.note)}` : ""}`)}
${list("Preferences", c.preferences, esc)}${list("Learned", c.learned, esc)}
${list("Ruled out", c.ruled_out, (r) => `<b>${esc(r.what)}</b> --- ${esc(r.why)}`)}
${list("Files", c.files, (f) => `<b>${esc(f.path)}</b> --- ${esc(f.why)}`)}
${list("Open questions", c.open_questions, esc)}
<ul class="plain"><li><b>In flight:</b> ${esc(c.in_flight ?? "-")}</li><li><b>Next:</b> ${esc(c.next ?? "-")}</li></ul></div></details>`;
}

const label = (p) => `${p.kind === "question" ? "Q" : "C"}${String(p.n).padStart(2, "0")}`;
// A point's text can hold a short list on its own lines; one line stays inline.
// Code names written without backticks (ExtractBrandFromTitle, brand_id) still read as code, and
// issue numbers become links. Only the parts outside backticks and links are touched.
const CODE_NAME = /(?<![\w`/.])((?:s3:\/\/)?[\w.-]+(?:\/[\w.{}*<>-]+)+\/?|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+|[a-z][a-z0-9]*(?:_[a-z0-9]+)+(?:\.[a-z]+)?)(?![\w/])/g;
const ISSUE = /(^|[\s(])#(\d{3,6})\b/g;
const markCode = (text) => String(text ?? "").split(/(`[^`]*`|\[[^\]]*\]\([^)]*\))/)
  .map((part, i) => (i % 2 ? part : part.replace(CODE_NAME, "`$1`").replace(ISSUE, REPO ? `$1[#$2](${REPO}/issues/$2)` : "$&")))
  .join("");
// The first sentence of a one-paragraph point is its headline; the rest reads as detail under it.
const pointText = (text) => {
  const source = markCode(text);
  if (source.includes("\n")) return marked.parse(source);
  const [lead, ...rest] = source.split(/(?<=[.!?])\s+(?=[A-Z`])/);
  return `<p><span class="lead">${inline(lead)}</span>${rest.length ? ` <span class="rest">${inline(rest.join(" "))}</span>` : ""}</p>`;
};
// The whole point as plain text, for the copy button.
const copyText = (p) => [`${label(p)}${p.title ? ` ${p.title}` : ""}`, p.text,
  ...(p.options || []).map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`),
  p.pick ? `My pick: ${p.pick}` : "", p.answer ? `You: ${p.answer}` : ""].filter(Boolean).join("\n");
const copyButton = (p) => `<button class="copy" data-copy="${esc(copyText(p))}" title="Copy ${label(p)}">copy</button>`;

function point(p) {
  const status = p.kind === "question" || p.status !== "info" ? `<span class="pill s-${p.status}">${p.status}</span>` : "";
  return `<li class="pt ${p.kind} ${p.status}" id="${label(p)}"><div class="nc"><a class="n" href="#${label(p)}">${label(p)}</a>${copyButton(p)}</div><div class="body">
${p.title ? `<p><b>${inline(p.title)}</b> ${status}</p><div class="ctx">${pointText(p.text)}</div>` : `<div>${pointText(p.text)} ${status}</div>`}
${p.options?.length ? `<ol class="opts">${p.options.map((o) => `<li>${inline(o)}</li>`).join("")}</ol>` : ""}
${p.pick ? `<div class="pick"><b>My pick:</b> ${inline(p.pick)}</div>` : ""}
${p.answer ? `<div class="ans"><b>You:</b> ${inline(p.answer)}</div>` : ""}</div></li>`;
}

function walkthrough(walk, points) {
  if (!walk?.steps.length) return `<p class="muted">No walkthrough yet.</p>`;
  return (walk.summary ? `<p class="summary">${inline(walk.summary)}</p>` : "") + walk.steps.map((step, i) => {
    const mine = points.filter((p) => p.step === step.id && p.kind === "context")
      .concat(points.filter((p) => p.step === step.id && p.kind === "question"));
    return `<section class="step" id="${esc(step.id)}" data-layout="${esc(step.layout ?? "auto")}"><h2><span class="k">${i + 1}</span>${esc(step.title)}</h2>
${step.diagram ? `<div class="canvas"><pre class="mermaid">${esc(diagram(step.diagram))}</pre></div>` : ""}
${mine.length ? `<ol class="points">${mine.map(point).join("")}</ol>` : ""}</section>`;
  }).join("");
}

async function workPage(key) {
  await loadIntents();
  const work = await db.collection("work").findOne({ key });
  if (!work) return null;
  const by = { work_key: key };
  const [decisions, scope, open, notes, evidence, artifacts, drafts, watches, resources] = await Promise.all(
    ["decisions", "scope_items", "open_items", "notes", "evidence", "artifacts", "drafts", "watches", "resources"].map((c) =>
      db.collection(c).find(by).sort({ created_at: 1 }).toArray()),
  );
  const walk = await db.collection("walkthroughs").findOne(by);
  const points = await db.collection("points").find(by).sort({ n: 1 }).toArray();
  const questions = points.filter((p) => p.kind === "question");
  const settled = questions.filter((p) => p.status !== "open").length;
  const s = work.current_state || {};
  const openSorted = [...open].sort((a, b) => (a.owner === "owner" ? -1 : 0) - (b.owner === "owner" ? -1 : 0));
  const links = [...(work.github?.issues || []).map((n) => gh(n, "issues")), ...(work.github?.prs || []).map((n) => gh(n))].join(" ");
  return page(work.title, `<div class="strip"><a href="/">SOPs</a><span class="t">${esc(work.title)}</span>
<span class="pill s-${work.status}">${work.status}</span>
${questions.length ? `<span><b>Questions</b> ${settled} of ${questions.length} settled</span>` : ""}
${s.in_flight ? `<span><b>Now</b> ${esc(s.in_flight)}</span>` : ""}${s.next ? `<span><b>Next</b> ${esc(s.next)}</span>` : ""}
${links ? `<span>${links}</span>` : ""}<span class="muted">${when(work.updated_at)}</span>${walk?.steps.length ? `<a href="/work/${esc(key)}/present">Present &#9654;</a>` : ""}</div>
${walkthrough(walk, points)}
<details class="records"><summary>Records: where it stands, decisions, scope, open items, drafts, evidence, notes</summary>
<h3>Where it stands</h3><p>${esc(work.goal ?? "")}</p>${work.verdict ? `<div class="card"><b>Verdict:</b> ${esc(work.verdict)}</div>` : ""}
<div class="state card"><div><b>Done</b> ${esc(s.done ?? "-")}</div><div><b>In flight</b> ${esc(s.in_flight ?? "-")}</div><div><b>Next</b> ${esc(s.next ?? "-")}</div><div class="muted">written ${when(s.updated_at)}</div></div>
${flowDiagram(work)}
<h3>Decisions</h3>${table(["What", "Why", "Type", "Approved"], decisions.map((d) => [
    `${esc(d.statement)}${d.status !== "active" ? ` <span class="muted">(${d.status})</span>` : ""}${d.deferred_to ? `<div class="muted">to ${d.deferred_to.issue ? gh(d.deferred_to.issue, "issues") : esc(d.deferred_to.work_key)}</div>` : ""}`,
    esc(d.why), esc(d.type),
    d.approved?.at ? `${esc(d.approved.by)} ${when(d.approved.at)}${d.approved.words ? `<div class="muted">"${esc(d.approved.words)}"</div>` : ""}` : d.needs_owner ? `<b class="s-waiting">needs your yes</b>` : `<span class="muted">not needed</span>`]))}
<h3>Scope</h3>${table(["Line", "From", "Outcome"], scope.map((i) => [esc(i.text ?? i.source.item), esc(`${i.source.kind} ${i.source.ref}`), `${esc(i.outcome)}${i.pr ? ` ${gh(i.pr)}` : ""}${i.note ? `<div class="muted">${esc(i.note)}</div>` : ""}`]))}
<h3>What's open</h3>${table(["Item", "Type", "Owner", "Status"], openSorted.map((o) => o.source === "github"
    ? [`${gh(o.github.issue, "issues")} ${esc(o.cache?.title ?? "")}`, "issue", esc((o.cache?.assignees || []).join(", ")), esc(o.cache?.state ?? "?")]
    : [`${esc(o.text)}${o.recommendation ? `<div class="muted">my pick: ${esc(o.recommendation)}</div>` : ""}`, esc(o.type), esc(o.owner), esc(o.status)]))}
<h3>Drafts</h3>${table(["For", "Status", "Body"], drafts.map((d) => [`${esc(d.target)}<div class="muted">${esc(d.where ?? "")}</div>`, `${esc(d.status)}${d.posted?.url ? ` <a href="${esc(d.posted.url)}">posted</a>` : ""}`, `<details><summary>show</summary>${md(d.body)}</details>`]))}
<h3>Evidence</h3>${evidence.map((e) => `<div class="card"><b>${esc(e.result_summary)}</b><div class="muted">${esc(e.system)} as ${esc(e.as_user ?? "?")} at ${when(e.ran_at)}</div><pre><code class="language-sql">${esc(e.query)}</code></pre></div>`).join("") || `<p class="muted">None.</p>`}
<h3>Notes</h3>${notes.map((n) => `<details class="card"><summary><b>${esc(n.title)}</b> <span class="muted">${esc(n.type)} --- ${when(n.updated_at)}</span></summary>${md(n.body)}</details>`).join("") || `<p class="muted">None.</p>`}
<h3>Artifacts</h3>${table(["Name", "Kind", "Where", "Runs"], artifacts.map((a) => [esc(a.name), esc(a.kind), esc(a.ref?.path ?? (a.content ? "in store" : "")), String((a.runs || []).length)]))}
<h3>Watches and resources</h3>${table(["Name", "Kind", "Status"], [...watches.map((w) => [esc(w.title), "watch", `${esc(w.status)} until ${when(w.until)}`]), ...resources.map((r) => [esc(r.name), esc(r.kind), esc(r.cleanup)])])}
<h3>Links</h3><p>${links} ${(work.links || []).map((l) => `<a href="/work/${esc(l.work_key)}">${esc(l.type)} ${esc(l.work_key)}</a>`).join(" ")}</p>
</details>`);
}

// Present mode: the same steps and points as a slide show (present.js). The page stays as it is;
// the presentations collection holds only per-step overrides, such as the order boxes are drawn in.
async function presentPage(key) {
  await loadIntents();
  const work = await db.collection("work").findOne({ key });
  if (!work) return null;
  const walk = await db.collection("walkthroughs").findOne({ work_key: key });
  const points = await db.collection("points").find({ work_key: key, status: { $ne: "dropped" } }).sort({ n: 1 }).toArray();
  const deck = await db.collection("presentations").findOne({ work_key: key });
  const steps = (walk?.steps || []).map((s) => ({
    id: s.id, title: s.title, diagram: s.diagram ? diagram(s.diagram) : null,
    points: points.filter((p) => p.step === s.id && p.kind === "context").concat(points.filter((p) => p.step === s.id && p.kind === "question"))
      .map((p) => ({ label: label(p), kind: p.kind, title: p.title ? inline(p.title) : "", copy: copyText(p), html: pointText(p.text)
        + (p.options?.length ? `<ol class="opts">${p.options.map((o) => `<li>${inline(o)}</li>`).join("")}</ol>` : "")
        + (p.pick ? `<div class="pick"><b>My pick:</b> ${inline(p.pick)}</div>` : "")
        + (p.answer ? `<div class="ans"><b>You:</b> ${inline(p.answer)}</div>` : "") })),
  }));
  const overrides = Object.fromEntries((deck?.steps || []).filter((s) => s.order).map((s) => [s.step, s.order]));
  const json = JSON.stringify({ title: work.title, steps, overrides, font: HAND, back: `/work/${key}` }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(work.title)} --- present</title><style>
@font-face{font-family:Virgil;src:url(/fonts/Virgil-Regular.woff2) format("woff2")}
${THEME_CSS}:root{--muted:var(--dim);--accent:var(--acc);--paper:var(--deep);--card:var(--panel);--focus:var(--ok)}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--paper);color:var(--fg);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden}
.deck{display:grid;grid-template-rows:auto minmax(0,1fr) auto;height:100vh}
header{display:flex;align-items:center;gap:14px;padding:8px 20px;font-size:13px;color:var(--muted)}
header a{color:var(--muted);text-decoration:none}header .t{color:var(--fg);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.track{position:absolute;left:0;right:0;top:0;height:3px}#progress{height:3px;background:var(--accent);width:0;transition:width .5s cubic-bezier(.22,.8,.24,1)}
#stage{padding:8px 32px;min-height:0;min-width:0;cursor:pointer;display:flex;overflow:hidden}#stage svg{flex:1;min-height:0;max-height:100%}
#caption{min-height:16vh;max-height:34vh;overflow:auto;display:flex;gap:22px;align-items:flex-start;padding:16px 8vw 22px;border-top:1px solid var(--line);background:var(--bg)}
#caption .lbl{font-family:${HAND};font-size:30px;color:var(--muted);min-width:64px;text-align:right;line-height:1.1}#caption .lbl.question{color:var(--warn)}
#caption .txt{font-size:clamp(17px,1.35vw,22px);max-width:1100px;flex:1;min-width:0;overflow-wrap:anywhere}#caption code{overflow-wrap:anywhere;word-break:break-word}
.cap,#caption{min-width:0}.deck>*{min-width:0}#caption .step-title{font-family:${HAND};font-size:clamp(26px,2.2vw,36px)}
#caption .txt p{margin:0 0 6px}#caption .txt ol,#caption .txt ul{margin:4px 0 6px;padding-left:24px}
#caption .ring{width:22px;height:22px;transform:rotate(-90deg)}#caption .ring circle{fill:none;stroke-width:4}#caption .ring .track{stroke:var(--line)}#caption .ring .left{stroke:var(--accent);stroke-dasharray:94.25;stroke-linecap:round}.deck.paused #caption .ring .left{stroke:var(--warn)}
#caption .lblc{display:flex;flex-direction:column;align-items:flex-end;gap:6px}.deck.side #caption .lblc{align-items:flex-start;flex-direction:row;gap:12px;align-items:center}
.copy{font:12px -apple-system,sans-serif;color:var(--muted);background:none;border:1px solid var(--line);border-radius:5px;padding:1px 7px;cursor:pointer}.copy.done{color:#3ddc84;border-color:#3ddc84}
#caption .opts{margin:6px 0 0;padding-left:26px;list-style:upper-alpha}#caption .pick,#caption .ans{font-size:.9em;margin-top:6px;color:var(--muted)}#caption .pick b,#caption .ans b{color:var(--fg)}
#timer nav{display:flex;align-items:center;gap:4px}nav button{background:none;border:1px solid var(--line);color:var(--fg);border-radius:6px;padding:2px 10px;cursor:pointer;font:inherit}
.keys{opacity:.7}
.cap{position:relative;display:flex;flex-direction:column;min-height:0;border-top:1px solid var(--line);background:var(--bg)}.cap #caption{border-top:0;flex:1}
#timer{display:flex;align-items:center;gap:8px;padding:0 0 10px 8vw;font-size:12px;color:var(--muted)}
#timer svg{width:18px;height:18px;transform:rotate(-90deg)}#timer circle{fill:none;stroke-width:4}#timer .track{stroke:var(--line)}
#timer .left{stroke:var(--accent);stroke-dasharray:94.25;stroke-linecap:round}#timer.paused .left{stroke:var(--warn)}#timer svg{transition:opacity .3s}#timer.idle svg{opacity:0}
#timer kbd{font:inherit;border:1px solid var(--line);border-radius:4px;padding:0 4px}
.deck.side .cap{border-top:0;border-left:1px solid var(--line)}.deck.side #timer{padding:0 32px 18px;flex-wrap:wrap}.deck.side #timer .hint{flex-basis:100%;white-space:normal}#timer .hint{white-space:nowrap}#speed{display:inline-block;min-width:34px;text-align:center}
.present-dim{opacity:.3;transition:opacity .4s}
${TOOLTIP_CSS}
.deck.side{grid-template-columns:minmax(0,1fr) minmax(340px,32vw);grid-template-rows:auto minmax(0,1fr)}
.deck.side header{grid-column:1/-1}.deck.side #caption{max-height:none;min-height:0;border-top:0;flex-direction:column;gap:8px;padding:28px 32px}
.deck.side #caption .lbl{text-align:left}
</style></head><body><div class="track"><div id="progress"></div></div><div class="deck">
<header><a href="/work/${esc(key)}">&larr; page</a><span class="t">${esc(work.title)}</span><span id="counter"></span>
</header>
<div id="stage"></div><div class="cap"><div id="caption"></div>
<div id="timer"><svg viewBox="0 0 36 36"><circle class="track" cx="18" cy="18" r="15"/><circle class="left" cx="18" cy="18" r="15"/></svg>
<nav><button id="prev" title="Back">&larr;</button><button id="play"></button><button id="next" title="Next">&rarr;</button>
<button id="slower" title="Slower">&minus;</button><span id="speed"></span><button id="faster" title="Faster">+</button></nav>
<span class="hint"><kbd>Space</kbd> pause &middot; <kbd>c</kbd> copy &middot; <kbd>&larr;</kbd> <kbd>&rarr;</kbd> step &middot; <kbd>&minus;</kbd> slower &middot; <kbd>+</kbd> faster &middot; <kbd>Esc</kbd> page</span></div></div></div>
<script type="application/json" id="data">${json}</script>
<script type="module" src="/present.js"></script>${TOOLTIP}</body></html>`;
}

const FONT = await readFile(new URL("./fonts/Virgil-Regular.woff2", import.meta.url));
const PRESENT_JS = await readFile(new URL("./present.js", import.meta.url));

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/fonts/Virgil-Regular.woff2") {
      res.writeHead(200, { "content-type": "font/woff2", "cache-control": "max-age=31536000" });
      return res.end(FONT);
    }
    if (url.pathname === "/present.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" });
      return res.end(PRESENT_JS);
    }
    const match = url.pathname.match(/^\/work\/([a-z0-9-]+)(\/present)?$/);
    const html = url.pathname === "/" ? await homePage() : url.pathname === "/all" ? await indexPage() : match ? await (match[2] ? presentPage(match[1]) : workPage(match[1])) : null;
    res.writeHead(html ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
    res.end(html ?? page("Not found", "<h1>Not found</h1>"));
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(String(error.stack));
  }
}).listen(8028);
