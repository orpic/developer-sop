// Present mode: a work page's walkthrough as a slide show stepped with the arrow keys.
// Each step's diagram is drawn part by part (a box with the arrow that leads to it), then its
// points are shown one at a time below the diagram. Going back plays the same animation reversed.
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs";

const data = JSON.parse(document.getElementById("data").textContent);
const stage = document.getElementById("stage");
const caption = document.getElementById("caption");
const counter = document.getElementById("counter");
const bar = document.getElementById("progress");

const EASE = "cubic-bezier(.22,.8,.24,1)";
const DRAW_MS_PER_PX = 1.1;
const MIN_DRAW_MS = 260;
const MAX_DRAW_MS = 900;
const MOVE_MS = 700;
const glides = new WeakSet();
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
let speed = 1;
let playing = true;
let autoplayStarted = false;

const light = matchMedia("(prefers-color-scheme: light)").matches;
const ink = light ? "#0f1419" : "#f2f4f7", paper = light ? "#fbfbfc" : "#0a0c0f", box = light ? "#ffffff" : "#14171c";
mermaid.initialize({ startOnLoad: false, theme: "base", look: "handDrawn", handDrawnSeed: 7, fontFamily: data.font,
  themeVariables: { fontFamily: data.font, fontSize: "18px", background: paper, primaryColor: box, primaryTextColor: ink,
    primaryBorderColor: ink, secondaryColor: box, tertiaryColor: box, lineColor: ink, textColor: ink, nodeTextColor: ink,
    edgeLabelBackground: paper, clusterBkg: paper, clusterBorder: ink },
  flowchart: { padding: 18, nodeSpacing: 60, rankSpacing: 70 } });
await document.fonts.load("18px Virgil");

// ---- Reading a rendered diagram: its boxes and arrows, by the ids Mermaid gives them ----------

// Boxes are g.node (or g.rough-node in the hand-drawn look) with ids like flowchart-MJ-0; arrows are
// the paths in .edgePaths with ids like L_MJ_OA_0, and their labels come in the same order.
const NODES = "g.node, g.rough-node";
const nodeKey = (g) => /flowchart-(.+)-\d+$/.exec(g.id)?.[1] ?? g.id;

const cache = new WeakMap();
function parts(svg) {
  if (cache.has(svg)) return cache.get(svg);
  const nodes = new Map();
  for (const g of svg.querySelectorAll(NODES)) if (/flowchart-/.test(g.id)) nodes.set(nodeKey(g), g);
  const keys = [...nodes.keys()].sort((a, b) => b.length - a.length);
  const labels = [...svg.querySelectorAll(".edgeLabels > g.edgeLabel")];
  const edges = [];
  [...svg.querySelectorAll(".edgePaths > path")].forEach((path, i) => {
    const id = path.id;
    const body = id.replace(/^L_/, "").replace(/_\d+$/, "");
    const from = keys.find((k) => body.startsWith(`${k}_`) && keys.includes(body.slice(k.length + 1)));
    if (!from) return;
    const label = labels[i] && labels[i].textContent.trim() ? labels[i] : null;
    edges.push({ id, from, to: body.slice(from.length + 1), path, label, n: Number(/^\s*(\d+)/.exec(label?.textContent ?? "")?.[1] ?? 1e9) });
  });
  const result = { nodes, edges };
  cache.set(svg, result);
  return result;
}

// ---- Building the beats ------------------------------------------------------------------------

const stepsSvg = [];

async function renderStep(i) {
  const { svg } = await mermaid.render(`p${i}`, data.steps[i].diagram);
  const holder = document.createElement("div");
  holder.innerHTML = svg;
  const el = holder.firstElementChild;
  el.removeAttribute("style");
  el.setAttribute("width", "100%");
  el.setAttribute("height", "100%");
  el.setAttribute("preserveAspectRatio", "xMidYMid meet");
  return el;
}

// One beat per new box, with the arrows that lead into it from what is already drawn; arrows
// between boxes already drawn come with the later box. Numbered arrows ("1 asks") set the order.
function diagramBeats(step, svgParts, carried) {
  const shown = new Set([...svgParts.nodes.keys()].filter((k) => carried.has(k)));
  const fresh = [...svgParts.nodes.keys()].filter((k) => !carried.has(k));
  const order = data.overrides[step.id] ?? [];
  const rank = (k) => {
    const o = order.indexOf(k);
    if (o >= 0) return o;
    const touching = svgParts.edges.filter((e) => e.to === k || e.from === k);
    return 1000 + Math.min(...touching.map((e) => e.n), 1e9);
  };
  const beats = [];
  const remaining = [...fresh];
  while (remaining.length) {
    remaining.sort((a, b) => rank(a) - rank(b) || fresh.indexOf(a) - fresh.indexOf(b));
    const key = remaining.shift();
    const edges = svgParts.edges.filter((e) => (e.to === key && shown.has(e.from)) || (e.from === key && shown.has(e.to)));
    shown.add(key);
    beats.push({ kind: "draw", node: key, edges: edges.map((e) => e.id) });
  }
  const leftover = svgParts.edges.filter((e) => !beats.some((b) => b.edges.includes(e.id)) && !(carried.has(e.from) && carried.has(e.to)));
  if (leftover.length && beats.length) beats[beats.length - 1].edges.push(...leftover.map((e) => e.id));
  else if (leftover.length) beats.push({ kind: "draw", node: null, edges: leftover.map((e) => e.id) });
  return beats;
}

const beats = [];
let carried = new Set();
for (let i = 0; i < data.steps.length; i++) {
  const step = data.steps[i];
  const svg = step.diagram ? await renderStep(i) : null;
  stepsSvg.push(svg);
  const svgParts = svg ? parts(svg) : { nodes: new Map(), edges: [] };
  beats.push({ step: i, kind: "enter" });
  if (svg) for (const b of diagramBeats(step, svgParts, carried)) beats.push({ step: i, ...b });
  for (const p of step.points) beats.push({ step: i, kind: "point", point: p });
  carried = new Set(svgParts.nodes.keys());
}

// ---- Drawing --------------------------------------------------------------------------------

const animations = [];
const play = (el, frames, options) => {
  const a = el.animate(frames, { easing: EASE, fill: "both", ...options });
  a.playbackRate = speed;
  animations.push(a);
  return a;
};
const finishAll = () => { for (const a of animations.splice(0)) a.finish(); };

const strokeLength = (el) => { try { return el.getTotalLength(); } catch { return 0; } };
const drawTime = (len) => Math.max(MIN_DRAW_MS, Math.min(MAX_DRAW_MS, len * DRAW_MS_PER_PX));

// A box: each stroke of the hand-drawn outline is drawn in turn, then the fill and the words appear.
function drawNode(g, reverse) {
  const strokes = [...g.querySelectorAll("path")].filter((p) => p.getAttribute("stroke") !== "none" || getComputedStyle(p).stroke !== "none");
  const label = g.querySelector(".label, foreignObject, text");
  let at = 0;
  const steps = [];
  for (const p of strokes) {
    const len = strokeLength(p);
    if (!len) continue;
    p.style.strokeDasharray = `${len}`;
    const ms = drawTime(len) / Math.max(1, strokes.length / 2);
    steps.push([p, [{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: ms, delay: at }]);
    at += ms * 0.6;
  }
  const fills = [...g.querySelectorAll("path")].filter((p) => p.getAttribute("fill") && p.getAttribute("fill") !== "none");
  for (const p of fills) steps.push([p, [{ fillOpacity: 0 }, { fillOpacity: 1 }], { duration: 300, delay: at * 0.8 }]);
  if (label) steps.push([label, [{ opacity: 0, filter: "blur(3px)" }, { opacity: 1, filter: "blur(0)" }], { duration: 380, delay: at * 0.7 }]);
  g.style.visibility = "visible";
  return run(steps, reverse, at + 380);
}

// An arrow is drawn from its start, and its head and label appear as it arrives.
function drawEdge(edge, reverse, delay = 0) {
  const len = strokeLength(edge.path) || 1;
  const ms = drawTime(len);
  edge.path.style.strokeDasharray = `${len}`;
  edge.path.style.visibility = "visible";
  const marker = edge.path.getAttribute("marker-end");
  const steps = [[edge.path, [{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: ms, delay }]];
  if (marker) {
    edge.path.dataset.marker = marker;
    edge.path.removeAttribute("marker-end");
    setTimeout(() => { if (!reverse) edge.path.setAttribute("marker-end", marker); }, (delay + ms * 0.92) / speed);
    if (reverse) edge.path.removeAttribute("marker-end");
  }
  if (edge.label) {
    edge.label.style.visibility = "visible";
    steps.push([edge.label, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: delay + ms * 0.5 }]);
  }
  return run(steps, reverse, delay + ms);
}

function run(steps, reverse, total) {
  const all = steps.map(([el, frames, opt]) => {
    const a = play(el, frames, reverse ? { ...opt, delay: Math.max(0, total - opt.delay - opt.duration) * 0.5, duration: opt.duration * 0.6 } : opt);
    if (reverse) a.reverse();
    return a;
  });
  return Promise.all(all.map((a) => a.finished.catch(() => {})));
}

function hideAll(svg) {
  for (const g of parts(svg).nodes.values()) g.style.visibility = "hidden";
  for (const e of parts(svg).edges) {
    e.path.style.visibility = "hidden";
    if (e.label) e.label.style.visibility = "hidden";
    if (e.path.getAttribute("marker-end")) e.path.dataset.marker = e.path.getAttribute("marker-end");
  }
}

function showInstant(svg, nodes, edgeIds) {
  const p = parts(svg);
  for (const k of nodes) if (p.nodes.get(k)) p.nodes.get(k).style.visibility = "visible";
  for (const e of p.edges) if (edgeIds.has(e.id)) {
    e.path.style.visibility = "visible";
    e.path.style.strokeDashoffset = "0";
    if (e.path.dataset.marker) e.path.setAttribute("marker-end", e.path.dataset.marker);
    if (e.label) e.label.style.visibility = "visible";
  }
}

// What is on screen at a beat: every box and arrow of its step drawn up to and including it.
function stateAt(index) {
  const b = beats[index];
  const svg = stepsSvg[b.step];
  const nodes = new Set(), edges = new Set();
  const p = svg ? parts(svg) : null;
  if (p) {
    const prev = b.step > 0 ? stepsSvg[b.step - 1] : null;
    if (prev) for (const k of parts(prev).nodes.keys()) if (p.nodes.has(k)) nodes.add(k);
    for (const e of p.edges) if (nodes.has(e.from) && nodes.has(e.to) && !beats.some((x) => x.step === b.step && x.edges?.includes(e.id))) edges.add(e.id);
    for (let i = beats.findIndex((x) => x.step === b.step); i <= index; i++) {
      const x = beats[i];
      if (x.kind !== "draw") continue;
      if (x.node) nodes.add(x.node);
      for (const id of x.edges) edges.add(id);
    }
  }
  return { svg, nodes, edges };
}

// ---- Moving between steps: boxes both steps share glide to their new place ----------------------

function boxes(svg) {
  const out = new Map();
  for (const [k, g] of parts(svg).nodes) if (g.style.visibility !== "hidden") out.set(k, g.getBoundingClientRect());
  return out;
}

// A diagram taller than the stage is wide sits beside its caption, so it can use the full height.
const deck = document.querySelector(".deck");
function fitLayout(svg) {
  if (!svg) return deck.classList.remove("side");
  const box = svg.viewBox.baseVal;
  const tall = box.height / box.width > 0.75;
  deck.classList.toggle("side", tall && innerWidth > 1000);
}

async function enterStep(i, fromSvg, reverse) {
  const svg = stepsSvg[i];
  fitLayout(svg);
  const before = fromSvg && fromSvg.isConnected ? boxes(fromSvg) : new Map();
  stage.replaceChildren(...(svg ? [svg] : []));
  if (!svg) return;
  hideAll(svg);
  const state = stateAt(beats.findIndex((b) => b.step === i && b.kind === "enter"));
  showInstant(svg, state.nodes, state.edges);
  const after = parts(svg).nodes;
  const moves = [];
  for (const [k, rect] of before) {
    const g = after.get(k);
    if (!g || g.style.visibility === "hidden") continue;
    const now = g.getBoundingClientRect();
    if (!now.width) continue;
    const dx = rect.left + rect.width / 2 - (now.left + now.width / 2);
    const dy = rect.top + rect.height / 2 - (now.top + now.height / 2);
    const s = rect.width / now.width;
    g.style.transformBox = "fill-box";
    g.style.transformOrigin = "center";
    const glide = play(g, [{ transform: `translate(${dx}px,${dy}px) scale(${s})` }, { transform: "none" }], { duration: MOVE_MS });
    glides.add(glide);
    moves.push(glide);
  }
  for (const e of parts(svg).edges) if (state.edges.has(e.id)) play(e.path, [{ opacity: 0 }, { opacity: 1 }], { duration: MOVE_MS, delay: MOVE_MS * 0.5 });
  if (!before.size) play(svg, [{ opacity: 0, transform: "scale(.98)" }, { opacity: 1, transform: "none" }], { duration: 500 });
  await Promise.all(moves.map((a) => a.finished.catch(() => {})));
}

// ---- The caption under the slide --------------------------------------------------------------

function showCaption(b) {
  const step = data.steps[b.step];
  const p = b.point;
  const html = p
    ? `<div class="lblc"><div class="lbl ${p.kind}">${p.label}</div><svg class="ring" viewBox="0 0 36 36"><circle class="track" cx="18" cy="18" r="15"/><circle class="left" cx="18" cy="18" r="15"/></svg><button class="copy" title="Copy (c)">copy</button></div><div class="txt">${p.title ? `<p><b>${p.title}</b></p>` : ""}${p.html}</div>`
    : `<div class="lbl">${b.step + 1}</div><div class="txt step-title">${step.title}</div>`;
  if (caption.dataset.html === html) return;
  caption.dataset.html = html;
  caption.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(6px)" }], { duration: 120, easing: EASE }).finished.then(() => {
    caption.innerHTML = html;
    if (b.point) ringFor(Math.max(0, holdLeft - (performance.now() - holdStarted)));
    caption.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: EASE });
  });
}

function focusPoint(b) {
  const svg = stepsSvg[b.step];
  if (!svg) return;
  const focus = b.point?.kind === "question";
  for (const g of svg.querySelectorAll(".focus, .dim")) g.classList.toggle("present-dim", focus && g.classList.contains("dim"));
}

// ---- Stepping ---------------------------------------------------------------------------------

let at = -1;
let busy = Promise.resolve();

async function go(to) {
  to = Math.max(0, Math.min(beats.length - 1, to));
  if (to === at) return;
  finishAll();
  const from = at;
  at = to;
  const b = beats[to];
  history.replaceState(null, "", `#${to + 1}`);
  counter.textContent = `${data.steps[b.step].title} --- ${to + 1} / ${beats.length}`;
  bar.style.width = `${((to + 1) / beats.length) * 100}%`;
  showCaption(b);
  const prev = from >= 0 ? beats[from] : null;
  const oneForward = from === to - 1, oneBack = from === to + 1;

  if (!prev || prev.step !== b.step || !(oneForward || oneBack)) {
    const fromSvg = prev ? stepsSvg[prev.step] : null;
    if (prev && prev.step === b.step) {
      hideAll(stepsSvg[b.step]);
    } else {
      await enterStep(b.step, oneForward || oneBack ? fromSvg : null, oneBack);
    }
    if (stepsSvg[b.step]) {
      const s = stateAt(to);
      showInstant(stepsSvg[b.step], s.nodes, s.edges);
    }
    focusPoint(b);
    return;
  }
  const svg = stepsSvg[b.step];
  const moving = oneForward ? b : prev;
  focusPoint(b);
  if (!svg || moving.kind !== "draw") return;
  const p = parts(svg);
  const edges = moving.edges.map((id) => p.edges.find((e) => e.id === id)).filter(Boolean);
  if (oneForward) {
    let t = 0;
    const drawn = [];
    for (const e of edges.filter((e) => e.to === moving.node)) { drawn.push(drawEdge(e, false, t)); t += 120; }
    if (moving.node && p.nodes.get(moving.node)) drawn.push(drawNode(p.nodes.get(moving.node), false));
    for (const e of edges.filter((e) => e.to !== moving.node)) drawn.push(drawEdge(e, false, 200));
    await Promise.all(drawn);
  } else {
    const undrawn = [];
    if (moving.node && p.nodes.get(moving.node)) undrawn.push(drawNode(p.nodes.get(moving.node), true).then(() => { p.nodes.get(moving.node).style.visibility = "hidden"; }));
    for (const e of edges) undrawn.push(drawEdge(e, true).then(() => { e.path.style.visibility = "hidden"; if (e.label) e.label.style.visibility = "hidden"; }));
    await Promise.all(undrawn);
  }
}

// ---- Playing by itself ---------------------------------------------------------------------------

// How long a beat stays on screen at 1x before the next one: long enough to read its caption.
const READ_MS_PER_WORD = 230;
function holdFor(b) {
  if (b.kind === "enter") return 900;
  if (b.kind === "draw") return 450;
  const words = (b.point.title + " " + b.point.html.replace(/<[^>]+>/g, " ")).split(/\s+/).filter(Boolean).length;
  return 1400 + words * READ_MS_PER_WORD + (b.point.kind === "question" ? 1500 : 0);
}

let timer = null;
let holdStarted = 0, holdLeft = 0;
const playButton = document.getElementById("play");
const speedLabel = document.getElementById("speed");
function showControls() {
  playButton.textContent = playing ? "\u275a\u275a" : "\u25b6";
  playButton.title = playing ? "Pause (Space)" : "Play (Space)";
  speedLabel.textContent = `${speed}x`;

}

// The ring at the lower left of the caption empties as the next beat comes closer.
// Two rings show the same countdown: one in the controls row, one beside the point's label,
// where the eyes are while reading.
const rings = () => [document.querySelector("#timer .left"), caption.querySelector(".ring .left")].filter(Boolean);
const RING = 2 * Math.PI * 15;
let ringAnim = null;
let ringAnims = [];
function ringFor(ms) {
  for (const a of ringAnims) a.cancel();
  document.getElementById("timer").classList.toggle("idle", beats[at]?.kind !== "point");
  const done = holdTotal ? 1 - ms / holdTotal : 0;
  ringAnims = rings().map((r) => r.animate([{ strokeDashoffset: RING * done }, { strokeDashoffset: RING }], { duration: Math.max(1, ms), fill: "forwards" }));
  ringAnim = ringAnims[0];
  if (!playing) for (const a of ringAnims) a.pause();
}

let holdTotal = 0;
function schedule(ms, total = ms) {
  clearTimeout(timer);
  holdLeft = ms;
  holdTotal = total;
  holdStarted = performance.now();
  ringFor(ms);
  if (!playing) return;
  timer = setTimeout(() => {
    if (at >= beats.length - 1) { playing = false; showControls(); return; }
    busy = busy.then(() => go(at + 1)).then(() => schedule(holdFor(beats[at]) / speed));
  }, ms);
}

// Only what is still moving is paused, and only that is resumed: play() on a finished animation
// would start it over, and every box already drawn would flash empty and draw again.
let pausedAnimations = [];
function setPlaying(on) {
  playing = on;
  for (const a of ringAnims) on ? a.play() : a.pause();
  if (on) {
    for (const a of pausedAnimations) if (a.playState === "paused") a.play();
    pausedAnimations = [];
  } else {
    // A slide or caption caught mid-fade would freeze half visible, so fades finish; drawing pauses.
    const tip = document.getElementById("tip");
    const running = document.getAnimations().filter((a) => a.playState === "running" && !ringAnims.includes(a) && a.effect?.target !== tip);
    // A step change caught mid-glide would freeze boxes half way to their new place, partly off the
    // slide, so glides finish too.
    const fades = running.filter((a) => glides.has(a) || a.effect?.target === caption || a.effect?.target?.tagName === "svg");
    for (const a of fades) a.finish();
    pausedAnimations = running.filter((a) => !fades.includes(a));
    for (const a of pausedAnimations) a.pause();
  }
  document.getElementById("timer").classList.toggle("paused", !on);
  deck.classList.toggle("paused", !on);
  if (on) schedule(holdLeft, holdTotal);
  else { clearTimeout(timer); holdLeft = Math.max(0, holdLeft - (performance.now() - holdStarted)); }
  showControls();
}

function setSpeed(next) {
  const left = playing ? Math.max(0, holdLeft - (performance.now() - holdStarted)) : holdLeft;
  const ratio = speed / next;
  speed = next;
  for (const a of document.getAnimations()) if (!ringAnims.includes(a)) a.playbackRate = speed;
  schedule(left * ratio, holdTotal * ratio);
  showControls();
  const hint = speedLabel;
  hint.animate([{ color: "var(--accent)" }, { color: "" }], { duration: 900 });
}

// Copy the point on screen: the copy button beside its label, or the c key.
async function copyCaption() {
  const p = beats[at]?.point;
  if (!p) return;
  await navigator.clipboard.writeText(p.copy);
  const button = caption.querySelector(".copy");
  if (!button) return;
  button.textContent = "copied";
  button.classList.add("done");
  setTimeout(() => { button.textContent = "copy"; button.classList.remove("done"); }, 1200);
}
caption.addEventListener("click", (e) => { if (e.target.closest(".copy")) copyCaption(); });

// A step the reader asks for runs at once: anything still drawing, or paused mid-draw, is finished first.
// Moving on closes an open tooltip (its link is about to leave the screen) and, if the tooltip
// was what paused the slide, plays on.
function closeTip() {
  document.getElementById("tip")?.classList.remove("on");
  if (pausedForTip) { pausedForTip = false; setPlaying(true); }
}

const step = (d) => {
  closeTip();
  clearTimeout(timer);
  for (const a of document.getAnimations()) if (!ringAnims.includes(a)) a.finish();
  busy = busy.then(() => go(at + d)).then(() => schedule(holdFor(beats[at]) / speed));
};
addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const i = SPEEDS.indexOf(speed);
  if (e.key === " " || e.key === "k") { e.preventDefault(); if (!e.repeat) setPlaying(!playing); }
  else if (["ArrowRight", "Enter", "PageDown", "ArrowDown"].includes(e.key)) { e.preventDefault(); step(1); }
  else if (["ArrowLeft", "Backspace", "PageUp", "ArrowUp"].includes(e.key)) { e.preventDefault(); step(-1); }
  else if (["+", "=", "]", ">"].includes(e.key)) setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, i + 1)]);
  else if (["-", "_", "[", "<"].includes(e.key)) setSpeed(SPEEDS[Math.max(0, i - 1)]);
  else if (e.key === "Home") step(-at);
  else if (e.key === "End") step(beats.length - 1 - at);
  else if (e.key === "c") copyCaption();
  else if (e.key === "Escape") location.href = data.back;
  else if (e.key === "f") document.documentElement.requestFullscreen?.();
});
// Reading a code tooltip holds the slide; it plays on when the tooltip closes, if it was playing.
let pausedForTip = false;
document.addEventListener("tip-open", () => { if (playing) { pausedForTip = true; setPlaying(false); } });
document.addEventListener("tip-close", () => { if (pausedForTip) { pausedForTip = false; setPlaying(true); } });
document.getElementById("next").onclick = () => step(1);
document.getElementById("prev").onclick = () => step(-1);
playButton.onclick = () => setPlaying(!playing);
document.getElementById("slower").onclick = () => setSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(speed) - 1)]);
document.getElementById("faster").onclick = () => setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(speed) + 1)]);
stage.onclick = () => setPlaying(!playing);

const start = Math.max(0, Number(location.hash.slice(1) || 1) - 1);
autoplayStarted = true;
showControls();
busy = go(start).then(() => schedule(holdFor(beats[at]) / speed));

