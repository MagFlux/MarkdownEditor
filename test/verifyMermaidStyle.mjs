/**
 * verifyMermaidStyle.mjs — Mermaid diagrams must stay readable even when the
 * SVG-internal stylesheet fails to apply (the Windows WebView2 "black nodes"
 * regression).
 *
 * The fix (src/mermaid.js): installMermaidStyles() mirrors the SVG <style> into
 * a document-level <style>, AND stampSvgStyles() parses Mermaid's own generated
 * CSS with the engine and re-applies it as presentation attributes on the
 * shapes. Presentation attributes lose to author CSS, so where the stylesheet
 * applies (Linux/WebKitGTK) nothing changes; where NO <style> element applies
 * at all, the attributes carry the diagram.
 *
 * This test asserts, for a rendered flowchart + sequence pair:
 *   1. node rects carry stamped fill/stroke matching Mermaid's theme values;
 *   2. sequence messageLine0 carries a real stroke (its inline stroke="none"
 *      placeholder was overwritten);
 *   3. after removing EVERY <style> element in the document (simulating the
 *      WebView2 failure), computed styles still match the theme — i.e. the
 *      diagram is NOT black/invisible;
 *   4. re-stamping the same holder is a no-op (idempotency);
 *   5. the generated sheet carries the fontFamily stack mermaid measures
 *      with (font consistency — the Windows label mis-centering fix) and
 *      the p{margin:0} rule vertical centering depends on;
 *   6. label divs whose painted content is far shorter than their
 *      foreignObject are flipped to centered flex (real Linux render is
 *      untouched — the content fills its FOs there);
 *   7. plain-text labels painting with the start-anchor-from-center
 *      fingerprint get text-anchor:middle pinned at the innermost
 *      text/tspan level (any shape type, transform-proof);
 *   8. middle-anchored labels whose painted center sits off their nearest
 *      shape are center-snapped with a rounded CSS translate (WebKitGTK
 *      dominant-baseline quirk) — no-op where the paint already agrees;
 *   9. an oversized EDGE-label foreignObject (the Windows "grey box around
 *      Ctrl+S / Export" report — the labelBkg div paints its bg over the
 *      whole oversized FO, and the oversize VARYS per label, so the old 25%
 *      gate fixed "Ctrl+S" but missed a mildly-oversized "Export") is
 *      normalized to the painted content on ANY >2px deviation (grow or
 *      shrink) with half-delta x/y offsets — tight FOs untouched,
 *      idempotent, and non-edge (node) labels never touched;
 *  10. the sequence diagram's MARKUP shadow (inline
 *      `filter="url(#id-drop-shadow)"` attrs — feDropShadow — on every
 *      actor rect/activation/loop, invisible to the dropShadow
 *      themeVariable) is stripped so sequences match the flat crisp look,
 *      keeping the state diagram's `-drop-shadow-small` and non-sequence
 *      SVGs untouched (idempotent);
 *  11. multi-line `<br/>` labels are NEVER center-snapped (the "note text
 *      jumbled" report): mermaid splits a `<br/>` label into sibling
 *      <text> lines sharing one shape, each deliberately dy=1em apart —
 *      the old snap measured each line against the shared shape and
 *      overprinted up to N−1 of them onto the shape center. The real
 *      `<br/>` note renders 4 distinct evenly-spaced lines with no
 *      transform, a synthetic multi-line block is untouched, and a
 *      single-line label in the same SVG still snaps (case 8 intact).
 *
 * Run with `npm run verify-mermaidstyle` (38 cases).
 *
 * Run with `npm run verify-mermaidstyle`.
 */
import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";

const S = 450; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { execSync(`kill $(lsof -ti tcp:4607) 2>/dev/null || true`, { stdio: "ignore" }); } catch { /* ignore */ }
execSync("npx vite build", { stdio: "inherit", cwd: process.cwd() });
const srv = spawn("npx", ["vite", "preview", "--port", "4607", "--strictPort"], { stdio: "ignore", cwd: process.cwd(), detached: true, windowsHide: true });
await sleep(1800);

const b = await chromium.launch();
const p = await (await b.newContext()).newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
p.on("console", (m) => { if (m.type() === "error" && !/favicon/i.test(m.text())) errors.push("CONSOLE: " + m.text()); });

let pass = 0, fail = 0;
/** ok — record a pass/fail assertion, optionally appending a diagnosis. */
const ok = (n, c, extra) => { if (c) { pass++; console.log("ok  ", n, extra ? "→ " + extra : ""); } else { fail++; console.log("FAIL", n, extra ? "→ " + extra : ""); } };

await p.goto("http://localhost:4607/", { waitUntil: "networkidle" });
await sleep(400);

await p.evaluate(() => {
  window.editor.setDocumentText(
    "# Style robustness\n\n" +
    "```mermaid\nflowchart LR\n    A[Write Markdown] --> B{Live preview}\n```\n\n" +
    "```mermaid\nsequenceDiagram\n    You->>Editor : press Ctrl+B\n    Editor-->>You : that word is bolded\n```\n"
  );
});
await sleep(S * 3); // debounce + render

// ---------------------------------------------------------------------------
// CASE 1 — the stamping happened: node rect carries mermaid's theme fill.
// ---------------------------------------------------------------------------
const stamped = await p.evaluate(() => {
  const fc = document.querySelectorAll(".mermaid-diagram")[0];
  const rect = fc.querySelector(".node rect.basic");
  return { fill: rect.getAttribute("fill"), stroke: rect.getAttribute("stroke") };
});
ok("1a flowchart node rect has stamped fill", /rgb\(236,\s*236,\s*255\)|#ECECFF/i.test(stamped.fill || ""), JSON.stringify(stamped));
ok("1b flowchart node rect has stamped stroke", /rgb\(147,\s*112,\s*219\)|#9370DB/i.test(stamped.stroke || ""), JSON.stringify(stamped));

// ---------------------------------------------------------------------------
// CASE 2 — the messageLine stroke="none" placeholder was overwritten.
// ---------------------------------------------------------------------------
const msg = await p.evaluate(() => {
  const seq = document.querySelectorAll(".mermaid-diagram")[1];
  const line = seq.querySelector("line.messageLine0");
  const dotted = seq.querySelector("line.messageLine1");
  return { stroke: line.getAttribute("stroke"), dash: dotted.getAttribute("stroke-dasharray") };
});
ok("2a messageLine0 stroke is themed (not none)", /rgb\(51,\s*51,\s*51\)|#333/i.test(msg.stroke || ""), JSON.stringify(msg));
ok("2b messageLine1 keeps its dasharray", !!msg.dash, JSON.stringify(msg));

// ---------------------------------------------------------------------------
// CASE 3 — total stylesheet failure: remove EVERY <style> in the document.
// Computed styles must STILL be the theme (proof the attributes carry it).
// ---------------------------------------------------------------------------
await p.evaluate(() => { document.querySelectorAll("style").forEach((s) => s.remove()); });
await sleep(300);
const dead = await p.evaluate(() => {
  const fc = document.querySelectorAll(".mermaid-diagram")[0];
  const rect = fc.querySelector(".node rect.basic");
  const seq = document.querySelectorAll(".mermaid-diagram")[1];
  const line = seq.querySelector("line.messageLine0");
  return {
    nodeFill: getComputedStyle(rect).fill,
    msgStroke: getComputedStyle(line).stroke,
    styleCount: document.querySelectorAll("style").length,
  };
});
ok("3a all styles removed", dead.styleCount === 0, JSON.stringify(dead));
ok("3b node fill survives without any stylesheet", /rgb\(236,\s*236,\s*255\)/i.test(dead.nodeFill), JSON.stringify(dead));
ok("3c message stroke survives without any stylesheet", /rgb\(51,\s*51,\s*51\)/i.test(dead.msgStroke), JSON.stringify(dead));

// ---------------------------------------------------------------------------
// CASE 4 — idempotency: a second install on the same holder adds no attrs.
// Uses window.editor's re-exported stampSvgStyles (no dynamic import() of a
// source path — that would 404 under vite preview and pollute the error list).
// ---------------------------------------------------------------------------
const idem = await p.evaluate(() => {
  const holder = document.querySelectorAll(".mermaid-diagram")[0];
  const before = holder.innerHTML.length;
  if (window.editor.stampSvgStyles) window.editor.stampSvgStyles(holder, "recheck-key-" + Date.now());
  return { changed: Math.abs(holder.innerHTML.length - before) > 40, has: !!window.editor.stampSvgStyles };
});
ok("4a re-stamp with same source is a no-op", idem.has && !idem.changed, JSON.stringify(idem));

// ---------------------------------------------------------------------------
// CASE 5 — font consistency (Windows off-center labels): the SVG stylesheet
// mermaid generates MUST carry the same fontFamily stack that mermaid's
// calculateTextDimensions measures with ('"trebuchet ms", verdana, arial,
// sans-serif'). Mermaid's v12 default themeVariables.fontFamily is a
// DIFFERENT stack ('"Recursive Variable", arial…'), which exists on Windows
// as two physically different fonts (Trebuchet MS painted-by-measure vs
// Arial painted-by-sheet) — labels then overflow/off-center their boxes.
// Passing fontFamily in OUR initialize bakes the measure stack into the
// sheet (asserted here); on Linux the override is a no-op (all faces of
// both stacks are missing there anyway) but must not change colors.
// ---------------------------------------------------------------------------
// forces a re-render in the same theme. The alive-copy "<style>" is rebuilt by
// restoreMermaid's cache path? No — style elements live INSIDE the svg markup
// which the cache re-inserts, but CASE 3 removed the AGGREGATE document
// mirrors too; re-set the doc so every fence is freshly restored/restyled.
const fonts = await p.evaluate(async () => {
  window.editor.setDocumentText(
    "# Font consistency\n\n" +
    "```mermaid\nflowchart LR\n    A[Left] --> B[Right]\n```\n"
  );
  await new Promise((r) => setTimeout(r, 1600));
  const svg = document.querySelector(".mermaid-diagram svg");
  const css = svg ? svg.querySelector("style")?.textContent || "" : "";
  const rootRule = css.match(/^#[^{]+\{[^}]*\}/);
  return {
    rootFont: rootRule ? rootRule[0].slice(0, 140) : null,
    trebuchet: /trebuchet ms/.test(rootRule ? rootRule[0] : ""),
    pRule: /p\{margin:0;\}/.test(css),
  };
});
ok("5a sheet paints the measure fontFamily (trebuchet stack)", fonts.trebuchet, JSON.stringify(fonts));
ok("5b p{margin:0} present in the sheet (label vertical centering depends on it)", fonts.pRule, JSON.stringify(fonts));

// ---------------------------------------------------------------------------
// CASE 6 — label centering inside foreignObject (Windows oversized FO fix):
// mermaid can allocate a label box TALLER than the painted single-line
// content (observed on Windows: every flowchart label got a 120x56 FO whose
// div paints one ~24px line). centerForeignObjectLabels() flips such a
// label's div to a centered flex column — a no-op where the content already
// fills the FO (as on Linux). Asserts: (a) the real render needs no flex
// (content ≈ FO height, inline centering NOT applied); (b) a synthetic
// oversized FO gets flex + centered content.
// ---------------------------------------------------------------------------
const foCheck = await p.evaluate(() => {
  // Real Linux render: single-line FOs (content ≈ FO height) must NOT flex.
  const real = Array.from(document.querySelectorAll(".mermaid-diagram foreignObject"))
    .map((fo) => fo.firstElementChild ? fo.firstElementChild.style.display : null);
  const touched = real.filter((d) => d === "flex").length;
  // Synthetics reproducing the Windows condition: a 56px and a 200px FO each
  // holding a single ~24px line; plus a tight 24px FO that must stay table.
  const host = document.createElement("div");
  host.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg">' +
    '<foreignObject width="120" height="56"><div xmlns="http://www.w3.org/1999/xhtml" style="display:table;white-space:nowrap;line-height:1.5;text-align:center;width:120px;"><span><p>Oversized</p></span></div></foreignObject>' +
    '<foreignObject width="120" height="200"><div xmlns="http://www.w3.org/1999/xhtml" style="display:table;white-space:nowrap;line-height:1.5;text-align:center;width:120px;"><span><p>Taller box</p></span></div></foreignObject>' +
    '<foreignObject width="120" height="24"><div xmlns="http://www.w3.org/1999/xhtml" style="display:table;white-space:nowrap;line-height:1.5;text-align:center;width:120px;"><span><p>Tight</p></span></div></foreignObject>' +
    '</svg>';
  document.body.appendChild(host);
  window.editor.centerForeignObjectLabels(host);
  const fos = Array.from(host.querySelectorAll("foreignObject"));
  const bigFlexed = fos.slice(0, 2).map((fo) => fo.firstElementChild.style.display === "flex");
  const tightUntouched = fos[2].firstElementChild.style.display !== "flex";
  host.remove();
  return { realTouched: touched, realCount: real.length, bigFlexed, tightUntouched };
});
ok("6a real Linux render untouched (content fills its FOs)", foCheck.realTouched === 0, JSON.stringify(foCheck));
ok("6b oversized FOs flex-centered; tight FO untouched", foCheck.bigFlexed.every(Boolean) && foCheck.tightUntouched, JSON.stringify(foCheck));

// ---------------------------------------------------------------------------
// CASE 7 — plain-text actor labels centered by re-anchoring (sequence
// diagrams): mermaid places the actor label <text> with x = box CENTER and
// relies on text-anchor:middle; on Windows the anchor is lost (computed
// "start"), painting the text rightward from the center by half its width.
// centerForeignObjectLabels pins text-anchor:middle INLINE when a label's
// x coincides with the sibling rect's center. Asserts: (a) a synthetic
// centered-but-start text is re-anchored to middle; (b) an explicitly
// middle-anchored text (the normal mermaid CSS case) is untouched;
// (c) a start-anchored text whose x sits at the box LEFT edge (notes) is
// untouched.
// ---------------------------------------------------------------------------
const anchorCheck = await p.evaluate(() => {
  const host = document.createElement("div");
  host.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" style="width:600px;height:80px">' +
    '<g><rect x="10" y="10" width="120" height="40" /><text x="70" y="35">BoxCenter</text></g>' +      // x == rect center → re-anchor
    '<g><rect x="210" y="10" width="120" height="40" /><text x="270" y="35" style="text-anchor:middle">Explicit</text></g>' + // already middle → untouched
    '<g><rect x="410" y="10" width="120" height="40" /><text x="415" y="35">Note start</text></g>' +   // x == left edge → untouched
    '<g><line x1="80" y1="60" x2="80" y2="120" /><text x="80" y="60">Lifeline</text></g>' +             // Windows shape=line pattern → re-anchor
    '</svg>';
  document.body.appendChild(host);
  const midBefore = Array.from(host.querySelectorAll("text"))[1].style.cssText;
  window.editor.centerForeignObjectLabels(host);
  const [a, b, c, l] = Array.from(host.querySelectorAll("text"));
  const r = {
    re: a.style.textAnchor,
    mid: b.style.cssText === midBefore,
    midBefore,
    note: c.style.textAnchor,
    life: l.style.textAnchor,
    computedA: getComputedStyle(a).textAnchor,
  };
  host.remove();
  return r;
});
ok("7a centered-x + start text re-anchored to middle", anchorCheck.re === "middle", JSON.stringify(anchorCheck));
ok("7b already-middle text untouched (inline cssText unchanged)", anchorCheck.mid, JSON.stringify(anchorCheck));
ok("7c left-edge start text (notes) untouched", !anchorCheck.note, JSON.stringify(anchorCheck));
ok("7d line-only group (Windows actor pattern) re-anchored", anchorCheck.life === "middle", JSON.stringify(anchorCheck));

// ---------------------------------------------------------------------------
// CASE 8 — CENTER SNAP (WebKitGTK sequence-actor off-center): WebKit resolves
// mermaid's dominant-baseline:central ~8px differently from Chromium and adds
// ~1px anchor subpixel error, so middle-anchored actor labels paint up-and-
// left. centerForeignObjectLabels now snaps middle-anchored labels onto their
// nearest shape's center with a ROUNDED CSS translate — no-op where the paint
// already agrees (Chromium). Asserts: (a) a middle text painted ~8px above
// its box gets snapped (painted center within 1.5px of box center);
// (b) an already-centered middle text gets NO transform; (c) a start-anchored
// note text is untouched; (d) the real Chromium render carries no transform
// (its deltas are ≈ 0).
// ---------------------------------------------------------------------------
const snapCheck = await p.evaluate(() => {
  const host = document.createElement("div");
  host.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" style="width:600px;height:120px">' +
    '<g><rect x="10" y="10" width="120" height="40" /><text x="70" y="10" style="text-anchor:middle" dominant-baseline="central">High</text></g>' +
    '<g><rect x="210" y="10" width="120" height="40" /><text x="270" y="30" style="text-anchor:middle" dominant-baseline="central">Centered</text></g>' +
    '<g><rect x="410" y="10" width="120" height="40" /><text x="415" y="30" style="text-anchor:start">Note start</text></g>' +
    '</svg>';
  document.body.appendChild(host);
  window.editor.centerForeignObjectLabels(host);
  const [high, centered, note] = Array.from(host.querySelectorAll("text"));
  const box1 = host.querySelectorAll("g rect")[0].getBoundingClientRect();
  const tr = (high.querySelector("tspan") || high).getBoundingClientRect();
  const snapDy = +((tr.top + tr.height / 2) - (box1.top + box1.height / 2)).toFixed(1);
  const r = {
    snapped: snapDy <= 1.5,
    snapDy,
    centeredTouched: !!centered.style.transform,
    noteTouched: !!note.style.transform,
    highTransform: high.style.transform,
  };
  host.remove();
  // real Chromium render: deltas are ≈0 → no snap transforms applied
  const real = Array.from(document.querySelectorAll(".mermaid-diagram text"))
    .filter((tx) => { const g = tx.closest("g"); return g && !g.querySelector("foreignObject"); });
  r.realTransforms = real.filter((tx) => tx.style.transform).length;
  return r;
});
ok("8a displaced middle text snapped onto its shape center", snapCheck.snapped, JSON.stringify(snapCheck));
ok("8b already-centered middle text untouched (no transform)", !snapCheck.centeredTouched, JSON.stringify(snapCheck));
ok("8c start-anchored note text untouched", !snapCheck.noteTouched, JSON.stringify(snapCheck));
ok("8d real Chromium render untouched (no snap transforms)", snapCheck.realTransforms === 0, JSON.stringify(snapCheck));

// ---------------------------------------------------------------------------
// CASE 9 — EDGE-LABEL BG NORMALIZATION (Windows "big grey box around edge
// labels" report, e.g. Ctrl+S / Export): an edge label's div.labelBkg PAINTS
// a background and FILLS its foreignObject (table-cell width resolves to the
// FO width), so ANY oversized Windows measurement paints a grey box that
// occludes the edge line, while a tight (Linux) FO hugs the text. Crucially
// the oversize VARYS PER LABEL — the first fix gated on the 25% height rule,
// which caught the hugely-measured "Ctrl+S" but missed the mildly-oversized
// "Export" ("you fixed the top one but not the bottom one").
// centerForeignObjectLabels now (a) flex-centers on ≥4px painted slack and
// (b) normalizes the FO width/height ATTRIBUTES to the painted content on
// ANY deviation > 2 attr px on either axis (growing as well as shrinking),
// with half-delta x/y offsets so the FO stays centered on its edge point.
// Asserts: (a) the real Chromium render (tight FOs) is untouched by a re-run;
// (b) a synthetic oversized EDGE label (FO 120x56, label-g transform centered
// like mermaid's) is shrunk to ≈ the painted content with the half-delta
// x/y offsets and the text stays painted at the label's center; (c) a second
// run is a no-op (idempotent); (d) an oversized NON-edge (node) label is NOT
// shrunk (scope guard — it paints no background); (e) a MILD height oversize
// (30 vs 24 — 20% slack, skipped by the old gate) is normalized too; (f) a
// WIDTH-only oversize is normalized while the tight height is left alone.
// ---------------------------------------------------------------------------
// The doc above has no labelled edge — load one for the real-render case.
await p.evaluate(() => {
  window.editor.setDocumentText(
    "# Edge labels\n\n" +
    "```mermaid\n" +
    "flowchart LR\n" +
    "    A[Write Markdown] --> B{Live preview}\n" +
    "    B -->|Ctrl+S| C[.md]\n" +
    "```\n"
  );
});
await sleep(S * 3); // debounce + render
const edgeShrink = await p.evaluate(() => {
  // Real render FIRST: edge-label FOs there are tight (content fills) → a
  // re-run of the pass must not touch their geometry at all.
  const realFo = document.querySelector(".mermaid-diagram g.edgeLabel foreignObject");
  const rdReal = (fo) => ({ w: fo.getAttribute("width"), h: fo.getAttribute("height"), x: fo.getAttribute("x"), y: fo.getAttribute("y") });
  const realBefore = rdReal(realFo);
  window.editor.centerForeignObjectLabels(realFo.closest(".mermaid-diagram"));
  const realAfter = rdReal(realFo);
  const mkEdge = (w, h, text) =>
    `<g class="label" transform="translate(${-w / 2},${-h / 2})">` +
    `<foreignObject width="${w}" height="${h}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" class="labelBkg" style="display:table-cell;white-space:nowrap;line-height:1.5;text-align:center;background-color:rgba(232,232,232,0.5);">` +
    `<span class="edgeLabel"><p style="margin:0">${text}</p></span></div></foreignObject></g>`;
  const mkNode = (w, h, text) =>
    `<foreignObject width="${w}" height="${h}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="display:table;white-space:nowrap;line-height:1.5;text-align:center;">` +
    `<span><p style="margin:0">${text}</p></span></div></foreignObject>`;
  const host = document.createElement("div");
  host.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" style="width:600px;height:200px">' +
    mkEdge(120, 56, "Ctrl+S") + mkNode(120, 56, "Node label") + '</svg>';
  document.body.appendChild(host);
  const foE = host.querySelector("g.label foreignObject");
  const foN = host.querySelectorAll("foreignObject")[1];
  window.editor.centerForeignObjectLabels(host);
  const rd = (fo) => ({
    w: fo.getAttribute("width"), h: fo.getAttribute("height"),
    x: fo.getAttribute("x"), y: fo.getAttribute("y"),
  });
  const e1 = rd(foE), n1 = rd(foN);
  // Painted centering: the p must sit at the label-g origin (= the edge point
  // mermaid centers on) — compare against the p rect vs the label g's rect.
  const g = host.querySelector("g.label");
  const gr = g.getBoundingClientRect();
  const pr = foE.querySelector("p").getBoundingClientRect();
  const cdx = Math.abs((pr.left + pr.width / 2) - (gr.left + gr.width / 2));
  const cdy = Math.abs((pr.top + pr.height / 2) - (gr.top + gr.height / 2));
  // Idempotency: a second run must not move the shrunk FO again.
  window.editor.centerForeignObjectLabels(host);
  const e2 = rd(foE);
  host.remove();
  // MILD oversize (the "Export" miss): FO only 6px taller than the content
  // (30 vs 24 — 20% slack) and width-oversized; the old 25% height gate
  // skipped it entirely, leaving the grey box. The catch-all normalize must
  // fix BOTH axes. Plus a WIDTH-only oversize (tight height).
  const host2 = document.createElement("div");
  host2.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" style="width:600px;height:200px">' +
    mkEdge(120, 30, "Export") + mkEdge(200, 24, "Wide only") + '</svg>';
  document.body.appendChild(host2);
  const [foM, foW] = host2.querySelectorAll("foreignObject");
  window.editor.centerForeignObjectLabels(host2);
  const m1 = rd(foM), w1 = rd(foW);
  host2.remove();
  return { realBefore, realAfter, e1, n1, e2, cdx: +cdx.toFixed(1), cdy: +cdy.toFixed(1), m1, w1 };
});
ok("9a real render (tight FOs) untouched by a re-run", JSON.stringify(edgeShrink.realBefore) === JSON.stringify(edgeShrink.realAfter), JSON.stringify(edgeShrink.realAfter));
ok("9b synthetic oversized edge label FO shrunk to painted content", +edgeShrink.e1.h >= 20 && +edgeShrink.e1.h <= 30 && +edgeShrink.e1.w <= 70 && +edgeShrink.e1.w > 0, JSON.stringify(edgeShrink.e1));
ok("9c shrunk edge FO re-centered (x/y = half the removed slack)", edgeShrink.e1.x !== null && edgeShrink.e1.y !== null && +edgeShrink.e1.x > 0 && +edgeShrink.e1.y > 0, JSON.stringify(edgeShrink.e1));
ok("9d label text stays painted at the FO/label center", edgeShrink.cdx <= 2 && edgeShrink.cdy <= 2, JSON.stringify(edgeShrink));
ok("9e second run is a no-op (idempotent)", edgeShrink.e1.w === edgeShrink.e2.w && edgeShrink.e1.h === edgeShrink.e2.h, JSON.stringify({ before: edgeShrink.e1, after: edgeShrink.e2 }));
ok("9f oversized NON-edge label NOT shrunk (paints no bg)", +edgeShrink.n1.w === 120 && +edgeShrink.n1.h === 56 && edgeShrink.n1.x === null, JSON.stringify(edgeShrink.n1));
ok("9g MILD height oversize (20% slack) is normalized too — the 'Export' miss", +edgeShrink.m1.h >= 20 && +edgeShrink.m1.h <= 30 && +edgeShrink.m1.w <= 70, JSON.stringify(edgeShrink.m1));
ok("9h width-only oversize normalized (height left alone)", +edgeShrink.w1.w < 200 && +edgeShrink.w1.w > 20 && edgeShrink.w1.h === "24" && +edgeShrink.w1.x === Math.round((200 - +edgeShrink.w1.w) / 2) && edgeShrink.w1.y === null, JSON.stringify(edgeShrink.w1));

// ---------------------------------------------------------------------------
// CASE 10 — SEQUENCE MARKUP SHADOW STRIP (dark-theme "hard shadow under every
// sequence shape" report, seen on BOTH platforms): the sequence `neo` look
// paints its shadow as an inline `filter="url(#id-drop-shadow)"` ATTRIBUTE
// (feDropShadow dx=4 dy=4 stdDeviation=0, white @ 6%) on every actor rect,
// activation, cylinder and loop box. themeVariables:{dropShadow:"none"} only
// reaches the SHEET; the inline attribute overrides it, so the shadow
// survives on every platform. stripSequenceShadows() strips every filter
// attribute referencing `…-drop-shadow` (EXACT suffix — the state diagram's
// `-drop-shadow-small` filter stays) in SVGs that contain a `rect.actor`
// (sequence only). Asserts: the real sequence render has NO filter attrs
// left, a synthetic mixed holder keeps the small-shadow filter and a
// non-sequence holder is untouched, and the pass is idempotent.
// ---------------------------------------------------------------------------
await p.evaluate(() => {
  window.editor.setDocumentText(
    "# Sequence shadows\n\n" +
    "```mermaid\n" +
    "sequenceDiagram\n" +
    "    You->>Editor : press Ctrl+B\n" +
    "    Editor-->>You : that word is bolded\n" +
    "```\n"
  );
});
await sleep(S * 3); // debounce + render
const seqShadow = await p.evaluate(() => {
  const holder = document.querySelector(".mermaid-diagram");
  const svg = holder.querySelector("svg");
  // The strip runs synchronously inside installMermaidStyles at insertion
  // time, so the real render already carries the fix: mermaid's feDropShadow
  // DEF is still emitted (now unreferenced — inert) but NO element keeps a
  // filter attribute. Assert both.
  const defPresent = !!svg.querySelector("filter feDropShadow");
  const before = svg.querySelectorAll("[filter]").length;
  const stripped = window.editor.stripSequenceShadows(holder);
  const after = svg.querySelectorAll("[filter]").length;
  const again = window.editor.stripSequenceShadows(holder);
  // Synthetic: sequence holder with TWO exact-suffix refs + one small one.
  const mixed = document.createElement("div");
  mixed.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg">' +
    '<rect class="actor" filter="url(#x-drop-shadow)"/>' +
    '<rect class="note" filter="url(#x-drop-shadow-small)"/>' +
    '<g filter="url(#x-drop-shadow)"></g></svg>';
  document.body.appendChild(mixed);
  const nMixed = window.editor.stripSequenceShadows(mixed);
  const mixedAfter = Array.from(mixed.querySelectorAll("[filter]")).map((e) => e.getAttribute("filter"));
  mixed.remove();
  const other = document.createElement("div");
  other.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg">' +
    '<rect class="node" filter="url(#y-drop-shadow)"/></svg>';
  document.body.appendChild(other);
  const nOther = window.editor.stripSequenceShadows(other);
  const otherFilters = other.querySelectorAll("[filter]").length;
  other.remove();
  return { defPresent, before, stripped, after, again, nMixed, nOther, otherFilters };
});
ok("10a mermaid still emits the feDropShadow def (now unreferenced/inert)", seqShadow.defPresent === true, `defPresent=${seqShadow.defPresent}`);
ok("10b real sequence render has NO filter attributes (stripped at insertion)", seqShadow.before === 0 && seqShadow.after === 0 && seqShadow.stripped === 0, JSON.stringify({ before: seqShadow.before, after: seqShadow.after, stripped: seqShadow.stripped }));
ok("10c second strip run is a no-op (idempotent)", seqShadow.again === 0, `again=${seqShadow.again}`);
ok("10d synthetic: BOTH exact -drop-shadow refs stripped, -drop-shadow-small kept", seqShadow.nMixed === 2, JSON.stringify({ nMixed: seqShadow.nMixed }));
ok("10e non-sequence holder untouched (no rect.actor)", seqShadow.nOther === 0 && seqShadow.otherFilters === 1, JSON.stringify({ nOther: seqShadow.nOther, otherFilters: seqShadow.otherFilters }));

// ---------------------------------------------------------------------------
// CASE 11 — MULTI-LINE (<br/>) LABEL GUARD (the "note text jumbled" report):
// mermaid RENDERS `<br/>` fine — it splits the label into SEVERAL sibling
// <text> lines in the SAME group, all anchored to the SAME shape (one
// rect.note), each deliberately offset by dy=1em. The center snap measured
// each line INDEPENDENTLY against that shared shape, and most lines sit
// within its |Δy| ≤ 8+h window, so up to N−1 lines were translated ONTO the
// shape center and overprinted (user screenshot: every note line jumbled at
// the same spot). The fix: when a sibling text in the same group shares the
// text's nearest shape, the line is part of a deliberate multi-line block
// and is NEVER snapped. Asserts: (a) the real `<br/>`-note render carries 4
// distinct, evenly spaced lines with NO snap transform; (b) a synthetic
// mermaid-shaped note block (4 sibling texts + one shared rect) is left
// exactly where mermaid put it; (c) a TRUE single-line label in the same
// SVG still snaps (case 8's WebKitGTK actor fix survives the guard).
// ---------------------------------------------------------------------------
await p.evaluate(() => {
  window.editor.setDocumentText(
    "# br note\n\n" +
    "```mermaid\n" +
    "sequenceDiagram\n" +
    "Note right of John: Bob thinks a long<br/>long time, so long<br/>that the text does<br/>not fit on a row.\n" +
    "```\n"
  );
});
await sleep(S * 3); // debounce + render
const brNote = await p.evaluate(() => {
  const holder = document.querySelector(".mermaid-diagram");
  const lines = Array.from(holder.querySelectorAll("text.noteText"));
  const centers = lines.map((t) => {
    const r = (t.querySelector("tspan") || t).getBoundingClientRect();
    return +(r.top + r.height / 2).toFixed(1);
  });
  let minGap = Infinity;
  for (let i = 1; i < centers.length; i++) minGap = Math.min(minGap, centers[i] - centers[i - 1]);
  return {
    count: lines.length,
    transforms: lines.filter((t) => t.style.transform).length,
    minGap: minGap === Infinity ? null : +minGap.toFixed(1),
  };
});
ok("11a real <br/> note renders 4 sibling lines", brNote.count === 4, JSON.stringify(brNote));
ok("11b no note line carries a snap transform", brNote.transforms === 0, JSON.stringify(brNote));
ok("11c note lines keep distinct mermaid spacing (no overprint)", brNote.minGap !== null && brNote.minGap > 10, `minGap=${brNote.minGap}`);

const brSynth = await p.evaluate(() => {
  // Mermaid-shaped multi-line note: ONE rect + FOUR sibling middle-anchored
  // texts spaced dy=17 inside the same group (the real v12 note structure),
  // plus a TRUE single-line label in its own group (an actor).
  const host = document.createElement("div");
  const line = (y, txt) => `<text x="485" y="${y}" style="text-anchor:middle" dominant-baseline="middle">${txt}</text>`;
  host.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" style="width:600px;height:200px">' +
    '<g><rect x="410" y="10" width="150" height="88"/>' + line(40, "Bob thinks a long") + line(57, "long time, so long") + line(74, "that the text does") + line(91, "not fit on a row.") + '</g>' +
    '<g><rect x="10" y="10" width="120" height="40"/><text x="70" y="10" style="text-anchor:middle" dominant-baseline="central">High</text></g>' +
    '</svg>';
  document.body.appendChild(host);
  window.editor.centerForeignObjectLabels(host);
  const notes = Array.from(host.querySelectorAll("g:first-child text"));
  const ys = notes.map((t) => { const r = (t.querySelector("tspan") || t).getBoundingClientRect(); return +(r.top + r.height / 2).toFixed(1); });
  const gaps = [];
  for (let i = 1; i < ys.length; i++) gaps.push(+(ys[i] - ys[i - 1]).toFixed(1));
  const single = Array.from(host.querySelectorAll("g"))[1].querySelector("text");
  const sr = (single.querySelector("tspan") || single).getBoundingClientRect();
  const box1 = host.querySelectorAll("g rect")[1].getBoundingClientRect();
  const snapDy = +((sr.top + sr.height / 2) - (box1.top + box1.height / 2)).toFixed(1);
  host.remove();
  return {
    noteTransforms: notes.filter((t) => t.style.transform).length,
    gaps,
    gapsOk: gaps.every((g) => Math.abs(g - 17) <= 2),
    singleSnapped: Math.abs(snapDy) <= 1.5,
    snapDy,
  };
});
ok("11d synthetic multi-line block untouched by the snap", brSynth.noteTransforms === 0 && brSynth.gapsOk, JSON.stringify(brSynth));
ok("11e single-line label in the same svg STILL snaps (case 8 fix intact)", brSynth.singleSnapped, JSON.stringify(brSynth));

console.log("   (page errors: " + (errors.length ? JSON.stringify(errors) : "none") + ")");

console.log(`\n${pass} ok / ${fail} fail`);
await b.close();
try { process.kill(-srv.pid); } catch { /* already dead */ }
if (errors.length) fail = 1;
process.exit(fail ? 1 : 0);
