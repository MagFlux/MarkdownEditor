/**
 * main.js — bootstrap for the Vite entry.
 *
 * Wires the app to the `#app` mount point, seeds the one-time sample document
 * (only when the document is empty, so an existing file is never clobbered),
 * and exposes the `app` instance on `window.editor` for the test harness.
 * No named functions; this file is top-level bootstrap statements only.
 *
 * Exposes: `window.editor` — the live `createApp` result (for Playwright).
 */
import { createApp } from "./markdown.js";
import { stampSvgStyles, installMermaidStyles, centerForeignObjectLabels, stripSequenceShadows } from "./mermaid.js";
import "./style.css";
// KaTeX styles for the live preview + PDF export. The stylesheet import AND
// the export-asset imports live HERE (main.js-only), never inside the
// src/markdown.js graph: test/test.mjs loads that graph under plain Node,
// which cannot resolve .css / ?raw / ?url specs. main.js is the browser-only
// bootstrap, so it is the one place these can resolve (see katexExportAssets.js).
import "katex/dist/katex.min.css";
import { KATEX_EXPORT_ASSETS } from "./katexExportAssets.js";
import { setKatexExportAssets } from "./math.js";

// Inject the raw katex CSS + bundled font URLs that back the self-contained
// HTML math export (fonts base64-inlined at export time).
setKatexExportAssets(KATEX_EXPORT_ASSETS);

// Restore the persisted light/dark theme before first paint so the scrollbars,
// panels, and text never flash the wrong palette on launch (the CSS is theme
// driven, so this must run before the app renders anything).
try {
  if (localStorage.getItem("me.theme") === "dark") {
    document.documentElement.dataset.theme = "dark";
  }
} catch { /* no storage — default light */ }

const app = createApp(document.getElementById("app"));

// Initial sample content (only on first run / an empty document).
// Showcases every headline feature the app ships, including the recent
// additions — the interactive task list, find & replace, and code
// highlighting — so a first-run user meets them in the preview itself.
const sample = [
  "# Welcome to Markdown Editor",
  "",
  "A **lightweight** WYSIWYG editor — write *Markdown* with live formatting.",
  "",
  "## What it does",
  "",
  "- Live **bold**, *italic*, ~~strikethrough~~, `inline code`, and [links](https://example.com)",
  "- The `**markers**` stay dimmed in the editor, so this stays a plain `.md` file",
  "- **Find & Replace** — `Ctrl+F` searches, `Ctrl+H` replaces (with live match counts, case and regex modes)",
  "- **Task lists** — the checkboxes below are LIVE in the preview; click one and the source flips",
  "- **Code highlighting** — fences with a language render in color, in the preview and in exports",
  "- **Rich paste** — paste HTML from Excel / Word (tables, bold spans) and it converts to Markdown in one undoable step",
  "- **Recent files** — the hamburger menu remembers the last files you open or save",
  "- **Diagrams** — any ` ```mermaid ` fence renders live, here and in your PDF/HTML export",
  "- **Multi-tab** — **Ctrl+click** anywhere for a new tab; open/save real files on Tauri",
  "- **Export** from the hamburger menu (Export… → As PDF / As HTML) — the preview you see is the file you get",
  "",
  "## Your first tasks",
  "",
  "- [x] Open the editor — nice work",
  "- [ ] Click THIS checkbox in the preview: the source flips to `[x]` (and `Ctrl+Z` flips it back)",
  "- [ ] Press **Ctrl+F** and search for *highlight* — watch the live match counter",
  "- [ ] Press **Ctrl+H** and replace a word — one undo step reverts the whole batch",
  "- [ ] Open a real `.md` file and find it again under **hamburger → Recent files**",
  "",
  "## Code, highlighted",
  "",
  "```js",
  "// Fences with a language get syntax colors — here and in the PDF/HTML export.",
  "const greet = (name) => `Hello, ${name}!`;",
  "console.log(greet(\"world\")); // → Hello, world!",
  "```",
  "",
  "## Mermaid, in one fence",
  "",
  "```mermaid",
  "flowchart LR",
  "    A[Write Markdown] --> B{Live preview}",
  "    B -->|Ctrl+S| C[.md]",
  "    B -->|Export| D[PDF / HTML]",
  "```",
  "",
  "Sequence diagrams work the same way:",
  "",
  "```mermaid",
  "sequenceDiagram",
  "    You->>Editor : press Ctrl+B",
  "    Editor-->>You : that word is bolded",
  "```",
  "",
  "## Math, in one block",
  "",
  "$$\\Gamma(z) = \\int_0^\\infty t^{z-1} e^{-t}\\,dt$$",
  "",
  "Inline math works too: $e^{i\\pi} + 1 = 0$ (the Σ toolbar button inserts the block).",
  "",
  "## Formatting shortcuts",
  "",
  "| Key | Action |",
  "| --- | --- |",
  "| **Ctrl+B / I / U / K** | Bold, italic, underline, link |",
  "| **Ctrl+F / Ctrl+H** | Find / find & replace (Enter = next, Esc = close) |",
  "| **Ctrl+Arrow** | Word-wise caret move (formatted spans count as one word) |",
  "| **Ctrl+Z / Ctrl+Y** | Undo / redo |",
  "| **Ctrl+S** | Save (native on Tauri; download in browser) |",
  "| **Ctrl+click** | New tab |",
  "",
  "> Select a word and click a toolbar button — or just start typing `**` to bold.",
  "",
  "That's it — a single-file, cross-platform editor built with Tauri.",
].join("\n");

if (app.getDocumentText() === "") {
  app.setDocumentText(sample);
}
app.refresh();
window.editor = app;
// Expose the mermaid style-stampers for the diagnostics hook + tests.
window.editor.stampSvgStyles = stampSvgStyles;
window.editor.installMermaidStyles = installMermaidStyles;
window.editor.centerForeignObjectLabels = centerForeignObjectLabels;
window.editor.stripSequenceShadows = stripSequenceShadows;

/* ---- Mermaid diagnostics hook (Ctrl+Shift+M) ---------------------------------
   The Windows WebView2 "black nodes" bug is invisible from Linux: we can only
   SIMULATE the stylesheet failure headlessly, never reproduce it. This hook
   reports, in an in-app modal (same centered-modal convention as every other
   dialog — never alert()), what the live DOM actually looks like for each
   rendered diagram: stamped fill/stroke attributes, computed styles, whether
   the SVG <style> and its document-level mirror exist, and how many rules
   stampSvgStyles parsed + applied. On Windows this tells us exactly which
   layer failed. Harmless on every platform; no text mutation. */
document.addEventListener("keydown", async (ev) => {
  if (!(ev.ctrlKey && ev.shiftKey && !ev.altKey && !ev.metaKey)) return;
  if (ev.key !== "M" && ev.key !== "m") return;
  ev.preventDefault();
  const holders = Array.from(document.querySelectorAll(".mermaid-diagram"));
  const lines = [];
  lines.push(`UA: ${navigator.userAgent}`);
  lines.push(`diagrams: ${holders.length}`);
  holders.forEach((h, i) => {
    const svg = h.querySelector("svg");
    const styleEl = svg && svg.querySelector("style");
    const rect = svg && svg.querySelector(".node rect.basic, rect.actor, rect");
    const cs = rect ? getComputedStyle(rect) : null;
    lines.push(
      `#${i}: id=${svg?.getAttribute("id")} svgStyle=${styleEl ? (styleEl.textContent || "").length + "ch" : "none"} ` +
      `mirror=${svg?.id ? !!document.head.querySelector(`style[data-mermaid-style="${svg.id}"]`) : "?"} ` +
      `stamped=${h.__mmStamped ? "yes" : "no"} ` +
      `rect[${rect?.tagName.toLowerCase()}] attr.fill=${rect?.getAttribute("fill") ?? "-"} computed.fill=${cs?.fill ?? "-"}`
    );
  });
  // Count what CSSOM parsing yields right now (the same path stampSvgStyles uses).
  // NOTE: the Windows diagnostics proved CSSOM is UNRELIABLE on WebView2
  // (insertRule rejected every rule → "parsed 0 rules" while stamping did
  // nothing), so this line only reports attribute counts now — the real
  // signal for whether stampSvgStyles landed.
  try {
    const svg0 = holders[0] && holders[0].querySelector("svg");
    lines.push(
      `attrs#0: fill=${svg0 ? svg0.querySelectorAll("[fill]").length : "?"} ` +
      `stroke=${svg0 ? svg0.querySelectorAll("[stroke]").length : "?"} ` +
      `strokeDash=${svg0 ? svg0.querySelectorAll("[stroke-dasharray]").length : "?"}`
    );
  } catch (e) { lines.push("attrs: ERROR " + e.message); }
  // LABEL GEOMETRY layer: the Windows label mis-centering cannot be seen from
  // Linux — this walks every node/actor and reports the actual paint-time
  // geometry of each label against its shape, plus the COMPUTED font the
  // labels paint with. If measure-font != paint-font the shape centers will
  // disagree with the label centers by a few px each; the computed font line
  // names the font that actually painted, which is the whole game.
  try {
    holders.forEach((h, hi) => {
      const svg = h.querySelector("svg");
      if (!svg) return;
      // The stylesheet's root font stack (what labels SHOULD paint with).
      const rootFont = (svg.querySelector("style")?.textContent || "").match(/^#[^{]+\{[^}]*\}/)?.[0]?.slice(0, 110) || "none";
      lines.push(`#${hi} sheetFont: ${rootFont}`);
      let n = 0;
      svg.querySelectorAll("g.node, g.actor").forEach((g) => {
        if (n >= 6) return; // first few labels are enough
        const shape = g.querySelector("rect, polygon, path");
        const fo = g.querySelector("foreignObject");
        const txt = !fo && g.querySelector("text");
        if (!shape || (!fo && !txt)) return;
        n++;
        const s = shape.getBoundingClientRect();
        // NOTE: measure the INNER text element (p / text), NOT the foreignObject
        // — the FO box is placed centered on the shape by construction, so FO
        // centers are always 0; the paint-time inner text position is what the
        // user sees.
        const inner = fo ? (fo.querySelector("p") || fo.firstElementChild) : txt.querySelector("tspan") || txt;
        const t = (inner || fo || txt).getBoundingClientRect();
        const cx = (e2) => +(e2.left + e2.width / 2).toFixed(1);
        const cy = (e2) => +(e2.top + e2.height / 2).toFixed(1);
        const labelEl = fo ? (fo.querySelector("p") || fo) : txt;
        const cs = getComputedStyle(labelEl);
        lines.push(
          `#${hi}.${n} "${(((inner || fo || txt).textContent || "").trim() || "?").slice(0, 16)}" ` +
          `dCx=${+(cx(t) - cx(s)).toFixed(1)} dCy=${+(cy(t) - cy(s)).toFixed(1)} ` +
          `font=${cs.fontFamily.split(",")[0]}/${cs.fontSize}px ` +
          `${fo ? `fo=[${fo.getAttribute("width")},${fo.getAttribute("height")}] innerRect=[${+t.width.toFixed(1)},${+t.height.toFixed(1)}] pStyle=${(fo.querySelector("p")?.getAttribute("style") || "-").slice(0, 40)}` : `anchor=${txt.getAttribute("text-anchor")} x=${txt.getAttribute("x")} w=${+t.width.toFixed(1)}`}` +
          `divStyle=${(fo && fo.firstElementChild?.getAttribute("style") || "-").slice(0, 90)}`
        );
      });
      // SEQUENCE-style plain <text> labels: the actor/message groups do not
      // carry a class that `g.node/g.actor` matches in mermaid v12, so walk
      // every bare <text> whose parent group also draws a shape.
      let tn = 0;
      svg.querySelectorAll("text").forEach((txt) => {
        if (tn >= 4) return;
        const g = txt.closest && txt.closest("g");
        const shape = g && g.querySelector("rect, polygon, path, line, use");
        if (!shape || g.querySelector("foreignObject")) return;
        tn++;
        const s = shape.getBoundingClientRect();
        const inner = txt.querySelector("tspan") || txt;
        const t = inner.getBoundingClientRect();
        const cx = (e2) => +(e2.left + e2.width / 2).toFixed(1);
        const cy = (e2) => +(e2.top + e2.height / 2).toFixed(1);
        // attr vs computed at BOTH text and tspan level — the anchor may be
        // present on one level and lost/mismatched on the other, and only
        // the innermost declaration wins the paint.
        // Nearest-center shape info: the group may hold several shapes and
        // the first in document order is not the label's box (Linux probe:
        // text x=275 but first rect bbox center at 1090) — the re-anchor
        // guard picks the nearest-center shape, so report it here.
        let bestShape = null, bestCx = null, bestD = Infinity;
        g && g.querySelectorAll("rect, polygon, path, line, use").forEach((sh) => {
          const sr = sh.getBoundingClientRect();
          if (!(sr.width || sr.height)) return;
          const scx = sr.left + sr.width / 2;
          const d = Math.abs(scx - cx(t));
          if (!bestShape || d < bestD) { bestShape = sh; bestCx = +scx.toFixed(1); bestD = +d.toFixed(1); }
        });
        lines.push(
          `#${hi}T.${tn} "${(((txt.textContent || "").trim() || "?").slice(0, 16))}" ` +
          `dCx=${+(cx(t) - cx(s)).toFixed(1)} dCy=${+(cy(t) - cy(s)).toFixed(1)} ` +
          `txtAttr=${txt.getAttribute("text-anchor") || "-"} txtCmp=${getComputedStyle(txt).textAnchor} ` +
          `${inner !== txt ? `tsAttr=${inner.getAttribute("text-anchor") || "-"} tsCmp=${getComputedStyle(inner).textAnchor} ` : ``}` +
          `x=${txt.getAttribute("x")} nearestShape=${bestShape ? bestShape.tagName.toLowerCase() + "@" + bestCx + "(d=" + bestD + ")" : "none"} class=${g ? g.getAttribute("class") : null} innerW=${+t.width.toFixed(1)}`
        );
      });
    });
  } catch (e) { lines.push("labels: ERROR " + e.message); }
  const backdrop = document.createElement("div");
  backdrop.className = "savedlg-backdrop";
  const box = document.createElement("div");
  box.className = "savedlg";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  const h3 = document.createElement("h3");
  h3.textContent = "Mermaid diagnostics";
  const pre = document.createElement("pre");
  pre.style.cssText = "white-space:pre-wrap;font-size:12px;max-height:50vh;overflow:auto;margin:.4em 0";
  pre.textContent = lines.join("\n");
  const row = document.createElement("div");
  row.className = "savedlg-btns";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn primary";
  btn.textContent = "Copy";
  btn.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(lines.join("\n")); btn.textContent = "Copied!"; }
    catch { btn.textContent = "Copy failed"; }
    setTimeout(() => backdrop.remove(), 700);
  });
  const close = document.createElement("button");
  close.type = "button";
  close.className = "btn";
  close.textContent = "Close";
  close.addEventListener("click", () => backdrop.remove());
  row.append(btn, close);
  box.append(h3, pre, row);
  backdrop.appendChild(box);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
  document.body.appendChild(backdrop);
  btn.focus();
});
