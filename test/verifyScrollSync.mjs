/**
 * verifyScrollSync.mjs — block-anchored split-view scroll-sync regression.
 *
 * `followScroll` (src/markdown.js) maps the leading pane's position through a
 * per-block anchor curve (src/scrollsync.js) instead of the old linear
 * scrollTop RATIO. Guards pinned here:
 *
 *  1. The anchor map builds for the built-in sample-like document (marked
 *     lexer pairing, lists expanded per item, KaTeX/mermaid fences paired)
 *     and the preview pair table materializes on the first scroll.
 *  2. Editor-lead semantic alignment: putting a given heading's source line
 *     at the editor's top edge puts that same heading's element at (just
 *     under) the preview's top edge — the property the ratio mapping failed
 *     (50% of the editor ≠ 50% of the preview for non-uniform documents).
 *  3. Preview-lead alignment: the mirror direction.
 *  4. Wrap-heavy documents (long single-line paragraphs) stay aligned at
 *     several scroll fractions — the editor-side curve is MEASURED from the
 *     overlay (per-line Range rects), not estimated.
 *  5. Ratio fallback: a document whose preview element count disagrees with
 *     the lexer's anchor count (raw HTML block) degrades to the old ratio
 *     follow (the map never silently guesses).
 *  6. End-of-doc behavior: the anchored curve + clamp CONVERGE at the ends —
 *     editor→bottom parks the preview on the CORRESPONDING block (never
 *     scrolled past it: the old snap/blend cut the table's top off), and
 *     preview→bottom parks the exhausted editor at its own end.
 *  7. Follower GLIDE: a large mapped delta (crossing the mermaid fence) is
 *     approached over several frames (≥4 distinct positions) and still
 *     settles at block parity; a TINY delta stays a single instant write
 *     while a one-line delta glides smoothly; and a realistic wheel walk
 *     (100px notches crossing the fence) never teleports more than ~140px
 *     per frame.
 *
 * Run with `npm run verify-scrollsync`.
 */
import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";

// Self-contained: build, then serve on an isolated port (idempotent).
const S = 400; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { execSync(`kill $(lsof -ti tcp:4619) 2>/dev/null || true`, { stdio: "ignore" }); } catch { /* ignore */ }
execSync("npx vite build", { stdio: "inherit", cwd: process.cwd() });
const srv = spawn("npx", ["vite", "preview", "--port", "4619", "--strictPort"], { stdio: "ignore", cwd: process.cwd(), detached: true, windowsHide: true });
await sleep(1800);

const b = await chromium.launch();
const p = await (await b.newContext()).newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
p.on("console", (m) => { if (m.type() === "error" && !/favicon/i.test(m.text())) errors.push("CONSOLE: " + m.text()); });

let pass = 0, fail = 0;
/** ok — record a pass/fail assertion, optionally appending a diagnosis. */
const ok = (n, c, extra) => { if (c) { pass++; console.log("ok  ", n, extra ? "→ " + extra : ""); } else { fail++; console.log("FAIL", n, extra ? "→ " + extra : ""); } };

await p.goto("http://localhost:4619/", { waitUntil: "networkidle" });
await sleep(500);

/**
 * setDoc — replace the active tab's text and wait for the (debounced) renders.
 * @param {string} md — the document to install.
 */
const setDoc = (md) => p.evaluate((t) => window.editor.setDocumentText(t), md);

/**
 * mapState — the anchor map's debug snapshot (via the app's test hook).
 * @returns {Promise<object|null>} {ok, pairsBuilt, anchors, pairs, ...}
 */
const mapState = () => p.evaluate(() => window.editor.getActiveScrollSyncDebug());

/**
 * topElements — the preview's top-level elements (document order), expanding
 * bare UL/OL lists into their items — the same indexing the anchor map uses.
 * Returned as SERIALIZABLE descriptors (Playwright cannot pass DOM nodes out
 * of evaluate).
 * @returns {Promise<Array<{idx: number, tag: string, cls: string}>>}
 */
const topElements = () => p.evaluate(() =>
  Array.from(window.editor.activeTab.preview.children).flatMap((el) => {
    if ((el.tagName === "UL" || el.tagName === "OL") && !el.className) return Array.from(el.children);
    if (el.tagName === "TABLE") {
      const trs = [];
      for (const sec of el.children) for (const tr of sec.children) if (tr.tagName === "TR") trs.push(tr);
      return trs;
    }
    return [el];
  }).map((el, idx) => ({ idx, tag: el.tagName, cls: String(el.className || "") })));

/**
 * scrollToLineTop — scroll the editor so source line `li` sits `offset` px
 * below the viewport's top edge, using the overlay's MEASURED per-line
 * geometry (Range rects over the overlay's text nodes — the same ground
 * truth the app's curve measures). Fires a genuine scroll (lead = editor).
 * @param {number} li — 0-based source line.
 * @param {number} [offset=0] — extra px below the top edge.
 */
const scrollToLineTop = (li, offset = 0) => p.evaluate(([li2, off]) => {
  const d = window.editor.activeTab;
  const edScroll = d.editorScroll;
  const editorEl = d.editor;
  const md = d.input.value;
  const starts = [0];
  for (let at = md.indexOf("\n"); at !== -1; at = md.indexOf("\n", at + 1)) starts.push(at + 1);
  const segs = [];
  (function walk(node) {
    for (const ch of node.childNodes) {
      if (ch.nodeType === 3) segs.push({ node: ch, text: ch.data });
      else if (ch.nodeType === 1) walk(ch);
    }
  })(editorEl);
  const cum = []; let tot = 0;
  for (const s of segs) { cum.push({ node: s.node, start: tot, end: tot + s.text.length }); tot += s.text.length; }
  const resolve = (pos) => {
    if (pos <= 0) return { node: cum[0].node, offset: 0 };
    for (const c of cum) if (pos < c.end) return { node: c.node, offset: pos - c.start };
    return { node: cum[cum.length - 1].node, offset: cum[cum.length - 1].node.data.length };
  };
  const a = resolve(starts[li2]);
  const endPos = li2 + 1 < starts.length ? starts[li2 + 1] : md.length;
  const b2 = resolve(endPos);
  const r = document.createRange();
  r.setStart(a.node, Math.min(a.offset, a.node.data.length));
  r.setEnd(b2.node, Math.min(b2.offset, b2.node.data.length));
  const rects = r.getClientRects();
  const lineTop = rects.length ? rects[0].top : 0;
  const target = Math.max(0, Math.min(edScroll.scrollHeight - edScroll.clientHeight,
    lineTop - editorEl.getBoundingClientRect().top + off));
  edScroll.scrollTop = target;
  return { li: li2, st: Math.round(edScroll.scrollTop) };
}, [li, offset]);

/**
 * scrollToElTop — scroll the preview so element `idx` (topElements index)
 * sits `offset` px below the viewport's top edge (real scroll; lead = p).
 * @param {number} idx — element index.
 * @param {number} [offset=0] — extra px below the top edge.
 */
const scrollToElTop = (idx, offset = 0) => p.evaluate(([idx2, off]) => {
  const d = window.editor.activeTab;
  const els = Array.from(d.preview.children).flatMap((el) =>
    (el.tagName === "UL" || el.tagName === "OL") && !el.className ? Array.from(el.children) : [el]);
  const el = els[idx2];
  const pv = d.previewScroll;
  const target = Math.max(0, Math.min(pv.scrollHeight - pv.clientHeight,
    el.getBoundingClientRect().top - d.preview.getBoundingClientRect().top + off));
  pv.scrollTop = target;
  return { idx: idx2, st: Math.round(pv.scrollTop) };
}, [idx, offset]);

/**
 * previewTopEl — the topmost preview element visibly crossing the viewport's
 * top edge (its tag + first 40 chars) plus its topElements index. Uses the
 * map's element index space: the SAME expansion collectEls applies (lists →
 * items, tables → rows), so indices stay comparable to the anchor list.
 * @returns {Promise<{idx: number, tag: string, text: string}>}
 */
const previewTopEl = () => p.evaluate(() => {
  const d = window.editor.activeTab;
  const pv = d.previewScroll;
  const pvTop = pv.getBoundingClientRect().top;
  const els = Array.from(d.preview.children).flatMap((el) => {
    if ((el.tagName === "UL" || el.tagName === "OL") && !el.className) return Array.from(el.children);
    if (el.tagName === "TABLE") {
      const trs = [];
      for (const sec of el.children) for (const tr of sec.children) if (tr.tagName === "TR") trs.push(tr);
      return trs;
    }
    return [el];
  });
  for (let i = 0; i < els.length; i++) {
    const r = els[i].getBoundingClientRect();
    if (r.bottom > pvTop + 2) return { idx: i, tag: els[i].tagName, text: (els[i].textContent || "").slice(0, 40) };
  }
  return { idx: -1, tag: "?", text: "" };
});

/**
 * editorTopLine — the topmost source line visibly crossing the editor's top
 * edge (measured from the overlay's real geometry, map-independent).
 * @returns {Promise<number>} 0-based source line.
 */
const editorTopLine = () => p.evaluate(() => {
  const d = window.editor.activeTab;
  const edScroll = d.editorScroll;
  const editorEl = d.editor;
  const md = d.input.value;
  const starts = [0];
  for (let at = md.indexOf("\n"); at !== -1; at = md.indexOf("\n", at + 1)) starts.push(at + 1);
  const segs = [];
  (function walk(node) {
    for (const ch of node.childNodes) {
      if (ch.nodeType === 3) segs.push({ node: ch, text: ch.data });
      else if (ch.nodeType === 1) walk(ch);
    }
  })(editorEl);
  const cum = []; let tot = 0;
  for (const s of segs) { cum.push({ node: s.node, start: tot, end: tot + s.text.length }); tot += s.text.length; }
  const resolve = (pos) => {
    if (pos <= 0) return { node: cum[0].node, offset: 0 };
    for (const c of cum) if (pos < c.end) return { node: c.node, offset: pos - c.start };
    return { node: cum[cum.length - 1].node, offset: cum[cum.length - 1].node.data.length };
  };
  const baseY = editorEl.getBoundingClientRect().top;
  let top = 0;
  for (let i = 0; i < starts.length; i++) {
    const a = resolve(starts[i]);
    const endPos = i + 1 < starts.length ? starts[i + 1] : md.length;
    const b2 = resolve(endPos);
    const r = document.createRange();
    r.setStart(a.node, Math.min(a.offset, a.node.data.length));
    r.setEnd(b2.node, Math.min(b2.offset, b2.node.data.length));
    const rects = r.getClientRects();
    if (!rects.length) continue;
    if (rects[0].top - baseY <= edScroll.scrollTop + 2) top = i; else break;
  }
  return top;
});

/* ==========================================================================
   CASE 1 — the map builds for a feature-dense document (the shape of the
   built-in sample: headings, tight/loose lists, task lists, fenced code,
   mermaid fences, KaTeX display + inline math, a table, a blockquote).
   ========================================================================== */
const denseDoc = [
  "# Doc", "",
  "Intro paragraph with **bold** text.", "",
  "## List section", "",
  "- alpha item", "- beta item", "- gamma item", "",
  "## Tasks", "",
  "- [x] done one", "- [ ] open two", "",,
  "## Code, highlighted", "",
  "```js", "const x = 1;", "```", "",
  "## Mermaid, in one fence", "",
  "```mermaid", "flowchart LR", "    A[Write] --> B{Preview}", "```", "",
  "## Math, in one block", "",
  "$$\\Gamma(z) = \\int_0^\\infty t^{z-1} e^{-t}\\,dt$$", "",
  "Inline math works too: $e^{i\\pi} + 1 = 0$.", "",
  "## Formatting shortcuts", "",
  "| Key | Action |", "| --- | --- |", "| **Ctrl+B** | Bold |", "| **Ctrl+Z** | Undo |", "",
  "> Select a word and click a toolbar button.", "",
  "That's it — a single-file editor.",
  // Filler below so the deep heading can reach the TOP edge of the viewport
  // (a line can only be topmost when at least a viewport height of content
  // remains below it).
  "", "## Following section A", "",
  "Filler paragraph A1 with enough words to occupy real vertical space. ".repeat(4), "",
  "Filler paragraph A2 with enough words to occupy real vertical space. ".repeat(4), "",
  "## Following section B", "",
  "Filler paragraph B1 with enough words to occupy real vertical space. ".repeat(4), "",
  "Filler paragraph B2 with enough words to occupy real vertical space. ".repeat(4), "",
].join("\n");

await setDoc(denseDoc);
await sleep(1600); // mermaid's 120ms debounce + async SVG render must settle
await p.evaluate(() => { window.editor.activeTab.editorScroll.scrollTop = 40; }); // kick the map (buildPairs runs on scroll)
await sleep(500);

const m1 = await mapState();
const els1 = await topElements();
ok("1a anchor map ok for the dense doc", !!m1 && m1.ok, m1 ? "anchors=" + m1.anchors.length : String(m1));
ok("1b preview pair table built (counts agree)", !!m1 && m1.pairsBuilt && !!m1.pairs && m1.pairs.length === m1.anchors.length && m1.anchors.length > 10,
   m1 && m1.pairs ? "pairs=" + m1.pairs.length + " anchors=" + m1.anchors.length : JSON.stringify(m1 && { built: m1.pairsBuilt, pairs: m1.pairs && m1.pairs.length }));
ok("1c anchors' edStart monotone", !!m1 && m1.anchors.every((a, i, arr) => i === 0 || arr[i - 1].edStart < a.edStart));
ok("1d pair tops monotone", !!m1 && !!m1.pairs && m1.pairs.every((q, i, arr) => i === 0 || arr[i - 1].top <= q.top));

/* ==========================================================================
   CASE 2 — editor-lead: put "## Formatting shortcuts" (a line deep in the
   document, after mermaid + KaTeX regions) near the editor's top edge; the
   preview's top element must BE that heading.
   ========================================================================== */
const fmtLine = denseDoc.split("\n").findIndex((l) => l.startsWith("## Formatting"));
await scrollToLineTop(fmtLine, 4);
await sleep(700);
const pv2 = await previewTopEl();
ok("2 editor-lead puts '## Formatting shortcuts' at the preview top", pv2.tag === "H2" && /Formatting shortcuts/.test(pv2.text),
   JSON.stringify(pv2));

/* ==========================================================================
   CASE 3 — preview-lead: scroll the preview so the mermaid DIAGRAM's holder
   is at the top; the editor's top line must be the fence's opening line.
   ========================================================================== */
const elsNow = await topElements();
const mmIdx = elsNow.findIndex((el) => el.cls.includes("mermaid-diagram"));
ok("3a mermaid holder present in the preview", mmIdx >= 0, "idx=" + mmIdx + " cls=" + (mmIdx >= 0 ? elsNow[mmIdx].cls : "?"));
if (mmIdx >= 0) {
  await scrollToElTop(mmIdx, 0);
  await sleep(700);
  const tl3 = await editorTopLine();
  const lines3 = denseDoc.split("\n");
  ok("3b preview-lead lands the editor on the mermaid fence line", tl3 >= 0 && /```mermaid/.test(lines3[tl3]),
     "topLine=" + tl3 + " text=" + JSON.stringify((lines3[tl3] || "").slice(0, 30)));
}

/* ==========================================================================
   CASE 4 — wrap-heavy document (long single-line paragraphs): both
   directions stay block-aligned at several scroll fractions.
   ========================================================================== */
const wrapDoc = Array.from({ length: 16 }, (_, i) =>
  "## Section " + (i + 1) + "\n\nParagraph " + (i + 1) + " " +
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ".repeat(4) + "\n").join("\n");
await setDoc(wrapDoc);
await sleep(700);
let wrapFails = [];
for (const f of [0.15, 0.5, 0.85]) {
  await p.evaluate((fr) => {
    const d = window.editor.activeTab;
    d.editorScroll.scrollTop = Math.round((d.editorScroll.scrollHeight - d.editorScroll.clientHeight) * fr);
  }, f);
  await sleep(500);
  const par4 = await p.evaluate(() => {
    const d = window.editor.activeTab;
    const edScroll = d.editorScroll;
    const editorEl = d.editor;
    const md = d.input.value;
    const starts = [0];
    for (let at = md.indexOf("\n"); at !== -1; at = md.indexOf("\n", at + 1)) starts.push(at + 1);
    const segs = [];
    (function walk(node) {
      for (const ch of node.childNodes) {
        if (ch.nodeType === 3) segs.push({ node: ch, text: ch.data });
        else if (ch.nodeType === 1) walk(ch);
      }
    })(editorEl);
    const cum = []; let tot = 0;
    for (const s of segs) { cum.push({ node: s.node, start: tot, end: tot + s.text.length }); tot += s.text.length; }
    const resolve = (pos) => {
      if (pos <= 0) return { node: cum[0].node, offset: 0 };
      for (const c of cum) if (pos < c.end) return { node: c.node, offset: pos - c.start };
      return { node: cum[cum.length - 1].node, offset: cum[cum.length - 1].node.data.length };
    };
    const baseY = editorEl.getBoundingClientRect().top;
    let top = 0;
    for (let i = 0; i < starts.length; i++) {
      const a = resolve(starts[i]);
      const endPos = i + 1 < starts.length ? starts[i + 1] : md.length;
      const b2 = resolve(endPos);
      const r = document.createRange();
      r.setStart(a.node, Math.min(a.offset, a.node.data.length));
      r.setEnd(b2.node, Math.min(b2.offset, b2.node.data.length));
      const rects = r.getClientRects();
      if (!rects.length) continue;
      if (rects[0].top - baseY <= edScroll.scrollTop + 2) top = i; else break;
    }
    const pv = d.previewScroll;
    const pvTop = pv.getBoundingClientRect().top;
    const els = Array.from(d.preview.children).flatMap((el) =>
      (el.tagName === "UL" || el.tagName === "OL") && !el.className ? Array.from(el.children) : [el]);
    let pvi = 0;
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (r.bottom > pvTop + 2) { pvi = i; break; }
    }
    // block index of the editor's top line (from the map's own anchors)
    const dbg = window.editor.getActiveScrollSyncDebug();
    let blk = -1;
    if (dbg && dbg.ok) dbg.anchors.forEach((a, i) => { if (a.sline <= top) blk = i; });
    return { blk, pvi, top };
  });
  if (par4.blk < 0 || Math.abs(par4.blk - par4.pvi) > 1) wrapFails.push("f=" + f + " ed=" + par4.blk + " pv=" + par4.pvi);
}
ok("4 editor-lead block parity across fractions (wrap-heavy)", wrapFails.length === 0, wrapFails.join(" | ") || "0.15/0.5/0.85 all aligned");

/* ==========================================================================
   CASE 5 — ratio fallback: a raw HTML block that renders MULTIPLE top-level
   elements from ONE lexer token desyncs the element count (anchors=1 token,
   elements=2) → mapOk=false → the old ratio follow still drives the follower.
   The doc repeats the desyncing block so both panes are genuinely scrollable.
   ========================================================================== */
const fbSections = [];
for (let i = 0; i < 8; i++) {
  fbSections.push("## Section " + (i + 1), "", "Paragraph " + (i + 1) + " with words to make it tall. ".repeat(6), "",
    "<div>html " + (i + 1) + "a</div>", "<span>html " + (i + 1) + "b</span>", "");
}
const fallbackDoc = fbSections.join("\n");
await setDoc(fallbackDoc);
await sleep(700);
await p.evaluate(() => { window.editor.activeTab.editorScroll.scrollTop = 40; }); // kick
await sleep(400);
const m5 = await mapState();
ok("5a count-desync doc degrades to ratio fallback (map inert)", !!m5 && (!m5.countsAgree || !m5.ok),
   m5 ? "ok=" + m5.ok + " anchors=" + m5.anchors.length + " liveEls=" + m5.liveEls : String(m5));
const from5 = await p.evaluate(() => Math.round(window.editor.activeTab.previewScroll.scrollTop));
await p.evaluate(() => {
  const d = window.editor.activeTab;
  d.editorScroll.scrollTop = Math.round((d.editorScroll.scrollHeight - d.editorScroll.clientHeight) * 0.6);
});
await sleep(600);
const to5 = await p.evaluate(() => Math.round(window.editor.activeTab.previewScroll.scrollTop));
ok("5b ratio fallback still drives the preview", Math.abs(to5 - from5) > 2, "pv " + from5 + " → " + to5);

/* ==========================================================================
   CASE 6 — end-of-doc behavior: the anchored curve + clamp must CONVERGE at
   the ends, never overshoot. An earlier hard-snap/blend version forced the
   follower to its own scroll end when the lead neared ITS end — that
   scrolled the preview PAST the table's top (the last big section) and the
   heading/table were cut off above the viewport. The contract now:
   6a) editor→bottom: the preview shows the block that actually corresponds
       to the editor's top edge (its heading/table header at/just under the
       fold — block parity ±1), NOT a forced bottom position.
   6b) preview→bottom: the editor is EXHAUSTED — it must be parked at its
       own scroll end (it cannot express the preview's final pad region).
   ========================================================================== */
await setDoc(denseDoc);
await sleep(2200); // let the fresh mermaid render fully settle before the clamps
await p.evaluate(() => { window.editor.activeTab.editorScroll.scrollTop = 40; }); // kick the map
await sleep(600);
await p.evaluate(() => {
  const d = window.editor.activeTab;
  d.editorScroll.scrollTop = d.editorScroll.scrollHeight; // bottom
});
await sleep(600);
const clamp6 = await p.evaluate(() => {
  const d = window.editor.activeTab;
  const md = d.input.value;
  const starts = [0];
  for (let at = md.indexOf("\n"); at !== -1; at = md.indexOf("\n", at + 1)) starts.push(at + 1);
  const segs = [];
  (function walk(n) { for (const c of n.childNodes) { if (c.nodeType === 3) segs.push({ node: c, text: c.data }); else if (c.nodeType === 1) walk(c); } })(d.editor);
  const cum = []; let tot = 0;
  for (const s of segs) { cum.push({ node: s.node, start: tot, end: tot + s.text.length }); tot += s.text.length; }
  const resolve = (pos) => { if (pos <= 0) return { node: cum[0].node, offset: 0 }; for (const c of cum) if (pos < c.end) return { node: c.node, offset: pos - c.start }; return { node: cum[cum.length - 1].node, offset: cum[cum.length - 1].node.data.length }; };
  // the editor's top-edge ROW (the one straddling the fold) and its block
  let topRow = -1;
  for (let i = 0; i < starts.length; i++) {
    const a = resolve(starts[i]);
    const b2 = resolve(i + 1 < starts.length ? starts[i + 1] : md.length);
    const r = document.createRange(); r.setStart(a.node, Math.min(a.offset, a.node.data.length)); r.setEnd(b2.node, Math.min(b2.offset, b2.node.data.length));
    const rects = r.getClientRects();
    if (!rects.length) continue;
    if (rects[0].top - d.editor.getBoundingClientRect().top <= d.editorScroll.scrollTop + 2) topRow = i; else break;
  }
  const dbg = window.editor.getActiveScrollSyncDebug();
  let edBlock = -1;
  if (dbg && dbg.ok) dbg.anchors.forEach((a2, i) => { if (a2.sline <= topRow) edBlock = i; });
  // preview's first element crossing the fold, in the map's element index
  // space — the SAME expansion collectEls uses (lists → items, tables → rows)
  const pvTop = d.previewScroll.getBoundingClientRect().top;
  const els = Array.from(d.preview.children).flatMap((el) => {
    if ((el.tagName === "UL" || el.tagName === "OL") && !el.className) return Array.from(el.children);
    if (el.tagName === "TABLE") {
      const trs = [];
      for (const sec of el.children) for (const tr of sec.children) if (tr.tagName === "TR") trs.push(tr);
      return trs;
    }
    return [el];
  });
  let pvBlock = -1;
  for (let i = 0; i < els.length; i++) {
    const r = els[i].getBoundingClientRect();
    if (r.bottom > pvTop + 2) { pvBlock = i; break; }
  }
  return { pvST: Math.round(d.previewScroll.scrollTop), pMax: Math.round(d.previewScroll.scrollHeight - d.previewScroll.clientHeight), edBlock, pvBlock };
});
ok("6a editor→bottom: preview shows the CORRESPONDING block (no overshoot cut-off)",
   clamp6.edBlock >= 0 && Math.abs(clamp6.edBlock - clamp6.pvBlock) <= 1,
   "editor block " + clamp6.edBlock + " vs preview block " + clamp6.pvBlock + " (pv " + clamp6.pvST + "/" + clamp6.pMax + ")");
await p.evaluate(() => {
  const d = window.editor.activeTab;
  d.previewScroll.scrollTop = d.previewScroll.scrollHeight; // bottom
});
await sleep(600);
const clamp6b = await p.evaluate(() => {
  const d = window.editor.activeTab;
  const eMax = d.editorScroll.scrollHeight - d.editorScroll.clientHeight;
  return { edST: Math.round(d.editorScroll.scrollTop), eMax: Math.round(eMax) };
});
ok("6b preview→bottom parks the EXHAUSTED editor at its own end (±2 lines)", Math.abs(clamp6b.edST - clamp6b.eMax) <= 2 * 23 + 6,
   "edST=" + clamp6b.edST + " eMax=" + clamp6b.eMax);

/* ==========================================================================
   CASE 7 — follower GLIDE: large mapped deltas land over a few frames instead
   of teleporting. Through tall rendered blocks (the mermaid SVG) the anchored
   curve's slope is 3-4× the editor's, so one wheel notch maps to a 150-340px
   follower move; writing it instantly read as a jump. The glide approaches
   the SAME target exponentially (mapping/parity untouched — the final fold
   must still be block-parity aligned). Small deltas must stay INSTANT.
   ========================================================================== */
await scrollToLineTop(20, 0); // settle well before the mermaid fence (line ~24)
await sleep(700);
const glide7a = await p.evaluate(async () => {
  const d = window.editor.activeTab;
  const ed = d.editorScroll, pv = d.previewScroll;
  const startPv = pv.scrollTop;
  // one big jump crossing the whole mermaid fence → a large mapped delta
  ed.scrollTop = Math.min(ed.scrollHeight - ed.clientHeight, ed.scrollTop + 300);
  const samples = [];
  await new Promise((done) => {
    const t0 = performance.now();
    const tick = () => {
      samples.push(pv.scrollTop);
      if (performance.now() - t0 < 650) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
  });
  const distinct = [];
  for (const v of samples) if (!distinct.length || Math.abs(v - distinct[distinct.length - 1]) > 0.5) distinct.push(v);
  return { startPv, samples, distinct: distinct.length, last: samples[samples.length - 1] };
});
await sleep(150); // full settle before the parity read
const parity7a = await (async () => {
  const top = await editorTopLine();
  const el = await previewTopEl();
  const dbg = await mapState();
  let blk = -1;
  if (dbg && dbg.ok) dbg.anchors.forEach((a, i) => { if (a.sline <= top) blk = i; });
  return { blk, pvi: el.idx, tag: el.tag };
})();
ok("7a large mapped delta GLIDES (≥4 distinct frames, settles at block parity)",
   glide7a.distinct >= 4 && Math.abs(glide7a.samples[glide7a.samples.length - 1] - glide7a.samples[glide7a.samples.length - 2]) <= 1
     && parity7a.blk >= 0 && Math.abs(parity7a.blk - parity7a.pvi) <= 1,
   "distinct=" + glide7a.distinct + " pv " + Math.round(glide7a.startPv) + "→" + Math.round(glide7a.last) +
   " | fold block ed=" + parity7a.blk + " pv=" + parity7a.pvi + " (" + parity7a.tag + ")");
const glide7b = await p.evaluate(async () => {
  const d = window.editor.activeTab;
  const ed = d.editorScroll, pv = d.previewScroll;
  // relocate to a pure 1:1 prose region (the intro paragraph) first
  const md = d.input.value;
  const starts = [0];
  for (let at = md.indexOf("\n"); at !== -1; at = md.indexOf("\n", at + 1)) starts.push(at + 1);
  const segs = [];
  (function walk(n) { for (const c of n.childNodes) { if (c.nodeType === 3) segs.push({ node: c, text: c.data }); else if (c.nodeType === 1) walk(c); } })(d.editor);
  const cum = []; let tot = 0;
  for (const s of segs) { cum.push({ node: s.node, start: tot, end: tot + s.text.length }); tot += s.text.length; }
  const resolve = (pos) => { if (pos <= 0) return { node: cum[0].node, offset: 0 }; for (const c of cum) if (pos < c.end) return { node: c.node, offset: pos - c.start }; return { node: cum[cum.length - 1].node, offset: cum[cum.length - 1].node.data.length }; };
  const a = resolve(starts[2]); const b2 = resolve(starts[3]);
  const r = document.createRange(); r.setStart(a.node, a.offset); r.setEnd(b2.node, b2.offset);
  ed.scrollTop = Math.max(0, r.getClientRects()[0].top - d.editor.getBoundingClientRect().top);
  await new Promise((r2) => setTimeout(r2, 900)); // settle the relocation glide
  const sample = async (ms) => {
    const samples = [];
    await new Promise((done) => {
      const t0 = performance.now();
      const tick = () => {
        samples.push(pv.scrollTop);
        if (performance.now() - t0 < ms) requestAnimationFrame(tick); else done();
      };
      requestAnimationFrame(tick);
    });
    const distinct = [];
    for (const v of samples) if (!distinct.length || Math.abs(v - distinct[distinct.length - 1]) > 0.5) distinct.push(v);
    return { distinct: distinct.length, last: samples[samples.length - 1], prev: samples[samples.length - 2] };
  };
  // a TINY delta (≤ GLIDE_MIN_PX) stays a single instant write
  ed.scrollTop += 6;
  const tiny = await sample(250);
  await new Promise((r2) => setTimeout(r2, 900));
  // a ONE-LINE delta (23px > GLIDE_MIN_PX) now GLIDES smoothly and settles
  ed.scrollTop += 23;
  const line = await sample(700);
  return { tiny, line };
});
ok("7b tiny deltas instant (≤2 positions); one-line deltas GLIDE (≥4 frames) and settle",
   glide7b.tiny.distinct <= 2 && Math.abs(glide7b.tiny.last - glide7b.tiny.prev) <= 0.5
     && glide7b.line.distinct >= 4 && Math.abs(glide7b.line.last - glide7b.line.prev) <= 0.5,
   "tiny: distinct=" + glide7b.tiny.distinct + " | one-line: distinct=" + glide7b.line.distinct + " final=" + Math.round(glide7b.line.last));

/* 7c — a REALISTIC wheel walk (4 notches × ~100px, 90ms apart) across the
   mermaid fence must never move the follower more than ~140px between frames:
   the pre-glide instant behavior teleported a single fence-crossing notch
   200-340px in one write, which is the jump this guards. The glided walk
   stays ≤ ~100px/frame and settles at block parity. */
await scrollToLineTop(20, 0);
await sleep(700);
const walk7c = await p.evaluate(async () => {
  const d = window.editor.activeTab;
  const ed = d.editorScroll, pv = d.previewScroll;
  let maxStep = 0, prev = pv.scrollTop;
  await new Promise((done) => {
    let notch = 0;
    const timer = setInterval(() => {
      if (notch >= 4) { clearInterval(timer); return; }
      ed.scrollTop = Math.min(ed.scrollHeight - ed.clientHeight, ed.scrollTop + 100);
      notch++;
    }, 90);
    const t0 = performance.now();
    const tick = () => {
      maxStep = Math.max(maxStep, Math.abs(pv.scrollTop - prev)); prev = pv.scrollTop;
      if (performance.now() - t0 < 900) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
  });
  return { maxStep: Math.round(maxStep) };
});
await sleep(400);
const parity7c = await (async () => {
  const top = await editorTopLine();
  const el = await previewTopEl();
  const dbg = await mapState();
  let blk = -1;
  if (dbg && dbg.ok) dbg.anchors.forEach((a, i) => { if (a.sline <= top) blk = i; });
  return { blk, pvi: el.idx, tag: el.tag };
})();
ok("7c wheel walk across the mermaid fence: no per-notch teleport (≤140px/frame), settles at parity",
   walk7c.maxStep <= 140 && parity7c.blk >= 0 && Math.abs(parity7c.blk - parity7c.pvi) <= 1,
   "max single-frame move=" + walk7c.maxStep + "px | fold block ed=" + parity7c.blk + " pv=" + parity7c.pvi + " (" + parity7c.tag + ")");

/* 7d — the END-REGION RE-CORRECTION must land as a slow PAN. Wheeling the
   preview into its tail pad while the editor is exhausted diverges the panes
   (~118px); the next editor scroll must pull the preview back ~200px — the
   one-off correction that read as a jump at the document's last table. With
   the correction τ it spreads over ≥10 frames (max step ≤80px) and settles
   at block parity. */
await scrollToLineTop(20, 0);
await sleep(600);
const corr7d = await p.evaluate(async () => {
  const d = window.editor.activeTab;
  const ed = d.editorScroll, pv = d.previewScroll;
  ed.scrollTop = ed.scrollHeight; // editor to the end (pv → correspondence ~1964)
  await new Promise((r) => setTimeout(r, 800));
  pv.scrollTop = Math.min(pv.scrollHeight - pv.clientHeight, pv.scrollTop + 118); // preview into the pad (drift)
  await new Promise((r) => setTimeout(r, 700));
  ed.scrollTop = Math.max(0, ed.scrollTop - 100); // ONE editor notch → the re-correction
  let maxStep = 0, prev = pv.scrollTop, n = 0;
  await new Promise((done) => {
    const t0 = performance.now();
    const tick = () => {
      maxStep = Math.max(maxStep, Math.abs(pv.scrollTop - prev)); prev = pv.scrollTop; n++;
      if (performance.now() - t0 < 800) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
  });
  return { maxStep: Math.round(maxStep), n };
});
await sleep(300);
const parity7d = await (async () => {
  const top = await editorTopLine();
  const el = await previewTopEl();
  const dbg = await mapState();
  let blk = -1;
  if (dbg && dbg.ok) dbg.anchors.forEach((a, i) => { if (a.sline <= top) blk = i; });
  return { blk, pvi: el.idx };
})();
ok("7d end-region re-correction lands as a slow pan (≤80px/frame), settles at parity",
   corr7d.maxStep <= 80 && parity7d.blk >= 0 && Math.abs(parity7d.blk - parity7d.pvi) <= 1,
   "correction max step=" + corr7d.maxStep + "px over " + corr7d.n + " frames | fold block ed=" + parity7d.blk + " pv=" + parity7d.pvi);

console.log("   (page errors: " + (errors.length ? JSON.stringify(errors) : "none") + ")");
console.log(`\n${pass} ok / ${fail} fail`);
await b.close();
process.exit(fail ? 1 : 0);