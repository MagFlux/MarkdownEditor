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
import "./style.css";

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
