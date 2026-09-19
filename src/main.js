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
import { stampSvgStyles, installMermaidStyles } from "./mermaid.js";
import "./style.css";

// Restore the persisted light/dark theme before first paint so the scrollbars,
// panels, and text never flash the wrong palette on launch (the CSS is theme
// driven, so this must run before the app renders anything).
try {
  if (localStorage.getItem("me.theme") === "dark") {
    document.documentElement.dataset.theme = "dark";
  }
} catch { /* no storage — default light */ }

const app = createApp(document.getElementById("app"));

// Initial sample content (only on first run / an empty document)
const sample = [
  "# Welcome to Markdown Editor",
  "",
  "A **lightweight** WYSIWYG editor — write *Markdown* with live formatting.",
  "",
  "## What it does",
  "",
  "- Live **bold**, *italic*, ~~strikethrough~~, `inline code`, and [links](https://example.com)",
  "- The `**markers**` stay dimmed in the editor, so this stays a plain `.md` file",
  "- **Rich paste** — paste HTML from Excel / Word (tables, bold spans) and it converts to Markdown in one undoable step",
  "- **Diagrams** — any ` ```mermaid ` fence renders live, here and in your PDF/HTML export",
  "- **Multi-tab** — **Ctrl+click** anywhere for a new tab; open/save real files on Tauri",
  "- **Export as PDF or HTML** from the hamburger menu — the preview you see is the file you get",
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
  "## Formatting shortcuts",
  "",
  "| Key | Action |",
  "| --- | --- |",
  "| **Ctrl+B / I / U / K** | Bold, italic, underline, link |",
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
  try {
    const probe = document.createElement("style");
    document.head.appendChild(probe);
    let parsed = 0;
    const src = holders.map((h) => h.querySelector("svg > style")).filter(Boolean)[0];
    if (src) {
      const css = src.textContent;
      let i = 0;
      while (i < css.length) {
        const open = css.indexOf("{", i);
        if (open === -1) break;
        const selector = css.slice(i, open).trim();
        let depth = 1, j = open + 1, quote = null;
        while (j < css.length && depth > 0) {
          const ch = css[j];
          if (quote) { if (ch === quote && css[j - 1] !== "\\") quote = null; }
          else if (ch === '"' || ch === "'") quote = ch;
          else if (ch === "{") depth++;
          else if (ch === "}") depth--;
          j++;
        }
        if (depth !== 0) break;
        const body = css.slice(open + 1, j - 1);
        i = j;
        if (!selector || selector.startsWith("@")) continue;
        try { probe.sheet.insertRule(`${selector}{${body}}`, probe.sheet.cssRules.length); parsed++; } catch { /* rejected */ }
      }
    }
    document.head.removeChild(probe);
    lines.push(`cssom: parsed ${parsed} rules from first sheet`);
  } catch (e) { lines.push("cssom: ERROR " + e.message); }
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
