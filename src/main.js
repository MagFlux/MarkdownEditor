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
  "- Live bold, *italic*, ~~strikethrough~~ and `inline code` as you type",
  "- The `**markers**` stay visible but dimmed, so this stays a plain .md file",
  "- Toggle any format on a highlighted word, or on new text you type",
  "",
  "> Select a word and click a toolbar button — or just start typing `**` to bold.",
  "",
  "1. Press **Ctrl+B** / **Ctrl+I** / **Ctrl+K** to format quickly",
  "2. Use the split view, or switch to edit-only / preview-only",
  "3. Save your document (**Ctrl+S**) to any location",
  "",
  "```",
  "lineOne = \"hello\";",
  "lineTwo   = \"world\";",
  "```",
  "",
  "That's it — a single-file, cross-platform editor built with Tauri.",
].join("\n");

if (app.getDocumentText() === "") {
  app.setDocumentText(sample);
}
app.refresh();
window.editor = app;
