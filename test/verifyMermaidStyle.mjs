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
 *      idempotent, and non-edge (node) labels never touched.
 *
 * Run with `npm run verify-mermaidstyle` (28 cases).
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

console.log("   (page errors: " + (errors.length ? JSON.stringify(errors) : "none") + ")");

console.log(`\n${pass} ok / ${fail} fail`);
await b.close();
try { process.kill(-srv.pid); } catch { /* already dead */ }
if (errors.length) fail = 1;
process.exit(fail ? 1 : 0);
