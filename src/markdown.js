import * as icons from "./icons.js";
import { marked } from "marked";

/* Tauri integrations are imported STATICALLY (not dynamic import()).
   In the Tauri webview, code-split relative chunks loaded at runtime are
   unreliable under the custom protocol; a failed dynamic import would silently
   disable save/open AND the window-close guard. Static imports hoist these into
   the main bundle so they are always available. They are pure JS in a plain
   browser (they only touch window.__TAURI_INTERNALS__ when called), so importing
   them here is browser-safe. All uses below stay guarded by isTauri(). */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readTextFile as tauriReadTextFile, writeTextFile as tauriWriteTextFile, readDir as tauriReadDir } from "@tauri-apps/plugin-fs";
import { homeDir as tauriHomeDir } from "@tauri-apps/api/path";
import { openUrl as tauriOpenUrlApi } from "@tauri-apps/plugin-opener";

marked.setOptions({ gfm: true, breaks: false });

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

/* ================= Inline Markdown → highlight spans =================
   Invariant: stripping every <span> tag out of the produced HTML must reproduce the
   exact source (character-per-character), so the invisible textarea stays aligned
   under the overlay and the caret never drifts.                              */
function matchTok(t, i) {
  const c = t[i];
  if (c === "`") {
    const j = t.indexOf("`", i + 1);
    if (j > i + 1)
      return {
        len: j - i + 1,
        html: `<span class="mark">\`</span><span class="code">${esc(t.slice(i + 1, j))}</span><span class="mark">\`</span>`,
      };
    return null;
  }
  if (c === "*") {
    const seg = t.slice(i);
    if (seg.startsWith("**")) {
      const close = seg.indexOf("**", 2);
      if (close > 2)
        return {
          len: close + 2,
          html: `<span class="mark">**</span><span class="b">${esc(seg.slice(2, close))}</span><span class="mark">**</span>`,
        };
    }
    const close = seg.indexOf("*", 1);
    if (close > 1)
      return {
        len: close + 1,
        html: `<span class="mark">*</span><span class="i">${esc(seg.slice(1, close))}</span><span class="mark">*</span>`,
      };
    return null;
  }
  if (c === "_" || c === "~") {
    if (c === "_") {
      const seg = t.slice(i);
      if (seg.startsWith("__")) {
        const close = seg.indexOf("__", 2);
        if (close > 2)
          return { len: close + 2, html: `<span class="mark">__</span><span class="b">${esc(seg.slice(2, close))}</span><span class="mark">__</span>` };
      }
      const close = seg.indexOf("_", 1);
      if (close > 1)
        return { len: close + 1, html: `<span class="mark">_</span><span class="i">${esc(seg.slice(1, close))}</span><span class="mark">_</span>` };
      return null;
    }
    const seg = t.slice(i);
    if (seg.startsWith("~~")) {
      const close = seg.indexOf("~~", 2);
      if (close > 2)
        return { len: close + 2, html: `<span class="mark">~~</span><span class="s">${esc(seg.slice(2, close))}</span><span class="mark">~~</span>` };
    }
    return null;
  }
  if (c === "<" && /^<u>/i.test(t.slice(i))) {
    const open = /^<u>/i.exec(t.slice(i));
    if (open) {
      const body = t.slice(i + open[0].length);
      const close = /^<\/u>/i.exec(body);
      if (close) {
        const inner = body.slice(0, close.index);
        return {
          len: open[0].length + inner.length + close[0].length,
          html: `<span class="mark">&lt;u&gt;</span><span class="u">${esc(inner)}</span><span class="mark">&lt;/u&gt;</span>`,
        };
      }
    }
  }
  if (c === "[") {
    const m2 = /^\[[^\]]*\]\([^)]*\)/.exec(t.slice(i));
    if (m2 && m2.index === 0) {
      const raw = t.slice(i, i + m2[0].length);
      const mm = raw.match(/^\[([^\]]*)\]\(([^)]*)\)$/);
      const alt = mm ? mm[1] : "", url = mm ? mm[2] : "";
      return {
        len: raw.length,
        html: `<span class="mark">[</span><span class="lnk">${esc(alt)}</span><span class="mark">](</span><span class="lnk">${esc(url)}</span><span class="mark">)</span>`,
      };
    }
    return null;
  }
  return null;
}

/* ================= Block detection ================= */
function isTableSep(l) {
  if (!l || l.length < 3 || !l.includes("-") || !l.includes("|")) return false;
  if (/[^\s|:|-]/.test(l)) return false;
  const cells = l.trim().replace(/^\||\|$/g, "").split("|");
  return cells.every((c) => /^:?-+:?$/.test(c.trim()));
}

function renderInline(t, cell) {
  let out = "", i = 0, n = t.length;
  while (i < n) {
    const m = matchTok(t, i);
    if (m) { out += m.html; i += m.len; }
    else {
      if (cell && t[i] === "|") out += '<span class="mark">|</span>';
      else out += esc(t[i]);
      i++;
    }
  }
  return out;
}

export function computeBlocks(lines) {
  const cls = new Array(lines.length).fill(null);
  let inCode = false;
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*(`{3,}|~{3,})/.test(l)) {
      inCode = !inCode; cls[i] = "code"; i++; continue;
    }
    if (inCode) { cls[i] = "code"; i++; continue; }
    let m;
    if ((m = l.match(/^(#{1,4})\s+/))) cls[i] = "h" + m[1].length;
    else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) cls[i] = "hr";
    else if (/^\s*>/.test(l)) cls[i] = "quote";
    else if (/^\s*[-*+]\s+/.test(l)) cls[i] = "ul";
    else if (/^\s*\d+\.\s+/.test(l)) cls[i] = "ol";
    i++;
  }
  // GFM-style tables: header row + separator row (+ optional data rows)
  for (i = 0; i + 1 < lines.length; i++) {
    const l0 = lines[i];
    if (!l0 || !l0.includes("|") || cls[i] || cls[i + 1]) continue;
    if (!isTableSep(lines[i + 1])) continue;
    cls[i] = "th"; cls[i + 1] = "tsep";
    for (let j = i + 2; j < lines.length; j++) {
      const l = lines[j];
      if (!l || !l.trim() || !l.includes("|")) break;
      if (cls[j]) break;
      cls[j] = "td";
    }
  }
  return cls;
}

export function lineToHtml(line, bc) {
  if (!line) return "";
  if (bc === "code") return `<span class="cl">${esc(line)}</span>`;
  if (bc === "hr") return `<span class="hr">${esc(line)}</span>`;
  let markerLen = 0;
  const mm =
    /^#{1,4}\s/.test(line) ? line.match(/^#{1,4}\s*/) :
    /^\s*>/.test(line) ? line.match(/^\s*>\s?/) :
    /^\s*[-*+]\s+/.test(line) ? line.match(/^\s*[-*+]\s+/) :
    /^\s*\d+\.\s+/.test(line) ? line.match(/^\s*\d+\.\s+/) : null;
  if (mm) markerLen = mm[0].length;
  const marker = line.slice(0, markerLen);
  const content = line.slice(markerLen);
  const isHead = ["h1", "h2", "h3", "h4"].includes(bc);
  const markerHtml = marker ? `<span class="mark">${esc(marker)}</span>` : "";
  const cell = ["th", "tsep", "td"].includes(bc);
  const contentHtml = isHead ? `<span class="hd">${renderInline(content)}</span>` : renderInline(content, cell);
  let inner = markerHtml + contentHtml;
  if (isHead) inner = `<span class="${bc}">${inner}</span>`;
  if (bc === "quote") inner = `<span class="q">${inner}</span>`;
  if (cell) inner = `<span class="${bc}">${inner}</span>`;
  return inner;
}

export function highlightToHtml(text) {
  const lines = text.split("\n");
  const cls = computeBlocks(lines);
  const parts = [];
  for (let i = 0; i < lines.length; i++) {
    parts.push(lineToHtml(lines[i], cls[i]));
    if (i < lines.length - 1) parts.push("\n");
  }
  return parts.join("");
}

/* ================= Selection helpers ================= */
function lineBounds(text, pos) {
  const s = text.lastIndexOf("\n", pos - 1) + 1;
  let e = text.indexOf("\n", pos);
  if (e === -1) e = text.length;
  return [s, e];
}
function W(ch) { return ch !== undefined && ch !== "" && !/\s/.test(ch); }
function wordAt(line, off) {
  const n = line.length; if (off < 0) off = 0; if (off > n) off = n;
  if (!W(line[off]) && !W(line[off - 1])) {
    let i = off - 1; while (i >= 0 && !W(line[i])) i--;
    if (i >= 0) { let s = i; while (s > 0 && W(line[s - 1])) s--; return [s, i + 1]; }
    let j = off; while (j < n && !W(line[j])) j++;
    if (j < n) { let e = j; while (e < n && W(line[e])) e++; return [j, e]; }
    return [off, off];
  }
  const anchor = W(line[off]) ? off : off - 1;
  let s = anchor; while (s > 0 && W(line[s - 1])) s--;
  let e = anchor; while (e < n && W(line[e])) e++;
  return [s, e];
}

/* ================= Format detection / wrapping ================= */
function detectFormat(line, ws, we) {
  const t = line.slice(ws, we);
  let m;
  if ((m = t.match(/^\*\*(.+?)\*\*$/))) return { fmt: "bold", inner: m[1] };
  if ((m = t.match(/^__(.+?)__$/))) return { fmt: "bold", inner: m[1] };
  if ((m = t.match(/^~~(.+?)~~$/))) return { fmt: "strike", inner: m[1] };
  if ((m = t.match(/^`(.+?)`$/))) return { fmt: "code", inner: m[1] };
  if ((m = t.match(/^<u>([\s\S]+?)<\/u>$/))) return { fmt: "underline", inner: m[1] };
  if ((m = t.match(/^\*([^\s*].*?)\*$/))) return { fmt: "italic", inner: m[1] };
  if ((m = t.match(/^_([^_]+?)_$/))) return { fmt: "italic", inner: m[1] };
  if ((m = t.match(/^\[([^\]]*)\]\(([^)]*)\)$/))) return { fmt: "link", inner: m[1], url: m[2] };
  return null;
}
function wrapFor(kind, inner) {
  switch (kind) {
    case "bold": return `**${inner}**`;
    case "italic": return `*${inner}*`;
    case "strike": return `~~${inner}~~`;
    case "underline": return `<u>${inner}</u>`;
    case "code": return `\`${inner}\``;
    case "link": return `[${inner || "link"}](https://)`;
  }
  return inner;
}

/* ================= Rich-paste conversion (HTML clipboard → Markdown) =================
   Pure helpers, no DOM globals beyond `document` (which exists in both the browser
   and the Tauri webview, so these are safe to call from anywhere in the app).

   The goal: when the user Ctrl+V's rich content (Excel table, Word bolded
   paragraph, web snippet) into the Markdown editor, we convert the `text/html`
   clipboard payload to a readable Markdown representation and commit it as a
   single, undo-able edit. If there is no recognised HTML, we fall through to
   the browser's default paste (plain text still works).

   Cell text: whitespace is normalised (tabs, newlines → space) so the output
   fits on one line. Cells that carry `**` / `*` / `<u>` markers keep them so
   the preview renders them.
*/
function mdCellText(node) {
  // Collect textContent (incl. nested styled children) but normalise runs of
  // whitespace and turn embedded newlines into a single space. Returns {bold,
  // italic, underline, text}.
  let bold = false, italic = false, underline = false;
  let text = "";
  (function walk(n) {
    if (n.nodeType === 3) { text += n.nodeValue; return; }
    if (n.nodeType !== 1) return;
    const tag = n.tagName && n.tagName.toUpperCase();
    if (tag === "B" || tag === "STRONG") bold = true;
    if (tag === "I" || tag === "EM") italic = true;
    if (tag === "U") underline = true;
    const st = n.getAttribute && n.getAttribute("style") || "";
    if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(st)) bold = true;
    if (/font-style\s*:\s*italic/i.test(st)) italic = true;
    if (/text-decoration:\s*[^;]*underline/i.test(st)) underline = true;
    for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
  })(node);
  text = text.replace(/\s+/g, " ").trim();
  if (!text) return "";
  let out = text;
  if (underline) out = `<u>${out}</u>`;
  if (italic) out = `*${out}*`;
  if (bold) out = `**${out}**`;
  return out.replace(/\|/g, "\\|");
}

function mdTableFromHtml(root) {
  // Walk the first <table> descendant, build the same GFM layout the in-app
  // "table" toolbar button produces, but with the real cell contents in it.
  const tbl = root.tagName === "TABLE" ? root : root.querySelector("table");
  if (!tbl) return null;
  // Build a 2-D grid: for each visual row, list of cell texts. Cells may span
  // multiple <tr> rows (rowspan) but Excel rarely uses that; we treat each
  // <tr> as one grid row and each cell as one column.
  const rows = [];
  const trs = tbl.querySelectorAll("tr");
  trs.forEach((tr) => {
    const cells = [];
    tr.querySelectorAll("td, th").forEach((c) => cells.push(mdCellText(c)));
    if (cells.length) rows.push(cells);
  });
  if (!rows.length) return null;
  // Normalise: all rows must have the same column count. Pad with "".
  const cols = Math.max(...rows.map((r) => r.length));
  const grid = rows.map((r) => r.concat(new Array(cols - r.length).fill("")));
  const line = (r) => `| ` + r.map((c) => (c === "" ? " " : c)).join(" | ") + ` |`;
  const sepLine = `| ` + new Array(cols).fill("------").join(" | ") + ` |`;
  const body = grid.slice(1).map(line).join("\n");
  return line(grid[0]) + "\n" + sepLine + (body ? "\n" + body : "");
}

function mdStyleOf(node) {
  // Inherited bold / italic / underline for a text node: the union of the flags
  // carried by the node's ancestors (its own tag plus the style attribute, where
  // common — this mirrors how mdCellText detects styling). Walk up the chain so
  // e.g. "bi" inside <b>…</b> inherits bold.
  let b = false, i = false, u = false;
  for (let n = node && node.parentElement; n && n.nodeType === 1; n = n.parentElement) {
    const tag = n.tagName && n.tagName.toUpperCase();
    if (tag === "B" || tag === "STRONG") b = true;
    if (tag === "I" || tag === "EM") i = true;
    if (tag === "U") u = true;
    const st = n.getAttribute && n.getAttribute("style") || "";
    if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(st)) b = true;
    if (/font-style\s*:\s*italic/i.test(st)) i = true;
    if (/text-decoration:[^;]*underline/i.test(st)) u = true;
  }
  return { b, i, u };
}

function mdInlineMd(root) {
  // Flatten an inline subtree into Markdown, preserving bold / italic /
  // underline. Walks the DOM in document order, records each text node's style
  // (bold, italic, underline) and then merges adjacent text nodes that share the
  // same style so we can wrap each *run* once (e.g. "plain **bold** after").
  //
  // Returns a string, or null when there is no visible text.
  const runs = [];
  (function walk(n) {
    if (n.nodeType === 3) {
      const s = mdStyleOf(n);
      const text = (n.nodeValue || "").replace(/\s+/g, " ");
      // Merge with the previous run if identical style.
      const key = s.b + "|" + s.i + "|" + s.u;
      const last = runs[runs.length - 1];
      if (last && last.key === key) last.text += text;
      else runs.push({ key, text, b: s.b, i: s.i, u: s.u });
      return;
    }
    if (n.nodeType !== 1) return;
    // Skip table children — those are handled separately by mdFromHtml.
    if (n.querySelector && n.querySelector("table")) return;
    for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
  })(root);
  if (!runs.length) return null;
  const out = runs.map((r) => {
    const t = r.text.trim();
    if (!t) return "";
    let md = t;
    if (r.u) md = `<u>${md}</u>`;
    if (r.i) md = `*${md}*`;
    if (r.b) md = `**${md}**`;
    return md;
  }).filter((s) => s !== "");
  return out.length ? out.join(" ") : null;
}

function mdFromHtml(html) {
  // Best-effort conversion of a clipboard HTML blob to Markdown. Returns a
  // string on success, or null when there is nothing recognisable, in which case
  // the caller must fall back to the browser's default paste (plain text still
  // works, and the tab is untouched).
  //
  //   - any <table> element → a GFM table block
  //   - the rest (top-level inline content) → one line with bold / italic /
  //     underline preserved per the in-editor style (mdInlineMd)
  //
  // Mixed content (e.g. "intro **bold** body then a table") is legal Markdown:
  // a paragraph followed by a table, blank line between.
  if (!html || !/</.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blocks = [];
  const seen = new Set();
  // Tables first (in document order). We walk the body's children; any <table>
  // that is a direct child or nested one level deep is converted.
  const inlineNodes = [];
  doc.body.childNodes.forEach((n) => {
    if (n.nodeType !== 1) { inlineNodes.push(n); return; }
    if (n.tagName === "TABLE" || (n.querySelector && n.querySelector("table"))) {
      const tbl = n.tagName === "TABLE" ? n : n.querySelector("table");
      if (tbl && !seen.has(tbl)) {
        seen.add(tbl);
        const md = mdTableFromHtml(tbl);
        if (md) blocks.push(md);
      }
      return;
    }
    inlineNodes.push(n);
  });
  if (inlineNodes.length) {
    const parts = inlineNodes.map((n) => mdInlineMd(n)).filter(Boolean);
    if (parts.length) blocks.push(parts.join(" "));
  }
  if (!blocks.length) return null;
  return blocks.join("\n\n");
}

/* ================= App factory (multi-tab, undo/redo, tabs, tabs, drag-drop, Tauri opener) ================= */
const LS_KEY = "mdeditor.session.v2";
let uid = 0, docId = 0;

function isTauri() {
  if (typeof window === "undefined") return false;
  // A Vite/bundler Tauri app injects `__TAURI_INTERNALS__` (this is where
  // __TAURI_INTERNALS__.invoke lives and where every plugin/API call in this
  // file goes through). `window.__TAURI__` only exists for the vanilla
  // withGlobalTauri setup, so checking that alone (as it once did) made every
  // native call silently fall through to its browser fallback in the real app —
  // e.g. save() used a blob download (ignored by WebKitGTK) and the window-close
  // guard never wired up. Detect the internals global first; also accept the
  // global-tauri marker for completeness. Never true in a plain browser.
  return !!(window.__TAURI_INTERNALS__ || window.__TAURI__);
}

export function createApp(root) {
  const app = document.createElement("div");
  app.className = "app";
  app.dataset.mode = "split";
  root.innerHTML = "";
  root.appendChild(app);

  /* ---- toolbar ---- */
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";
  toolbar.innerHTML = `
    <button class="btn" data-fmt="bold" title="Toggle bold — Ctrl+B">${icons.bold}</button>
    <button class="btn" data-fmt="italic" title="Toggle italic — Ctrl+I">${icons.italic}</button>
    <button class="btn" data-fmt="underline" title="Toggle underline — Ctrl+U">${icons.underline}</button>
    <button class="btn" data-fmt="strike" title="Toggle strikethrough">${icons.strike}</button>
    <button class="btn" data-fmt="code" title="Toggle inline code">${icons.code}</button>
    <button class="btn" data-fmt="link" title="Insert / toggle link — Ctrl+K">${icons.link}</button>
    <span class="sep"></span>
    <button class="btn" data-block="h1">H1</button>
    <button class="btn" data-block="h2">H2</button>
    <button class="btn" data-block="h3">H3</button>
    <button class="btn" data-block="quote" title="Toggle blockquote">&rdquo;</button>
    <button class="btn" data-block="ul" title="Toggle bullet list">&bull;&thinsp;&mdash;</button>
    <button class="btn" data-block="ol" title="Toggle numbered list">1.</button>
    <button class="btn" data-block="table" title="Insert table">${icons.table}</button>
    <button class="btn" data-block="codeblock" title="Toggle code block">&lt;/&gt;</button>
    <span class="sep"></span>
    <button class="btn" data-action="undo" title="Undo — Ctrl+Z / Ctrl+&larr;">${icons.undo}</button>
    <button class="btn" data-action="redo" title="Redo — Ctrl+Shift+Z / Ctrl+Y / Ctrl+&rarr;">${icons.redo}</button>
    <span class="sep"></span>
    <button class="btn" data-action="newtab" title="New tab — ctrl+click anywhere for new">${icons.plus}</button>
    <button class="btn" data-action="open" title="Open file into new tab">${icons.open}</button>
    <button class="btn" data-action="save" title="Save — Ctrl+S">${icons.save}</button>
    <span class="spacer"></span>
    <button class="btn" data-action="mode" title="Cycle Split / Edit / Preview">View &middot; <span class="mode-label">Split</span></button>
    <button class="btn" data-action="theme" title="Toggle light / dark">&#9681;</button>`;
  app.appendChild(toolbar);

  /* ---- tab bar ---- */
  const tabBar = document.createElement("div");
  tabBar.className = "tabbar";
  app.appendChild(tabBar);

  /* ---- workspace ---- */
  const workspace = document.createElement("div");
  workspace.className = "workspace";
  app.appendChild(workspace);

   /* ---- status bar ---- */
   const statusbar = document.createElement("div");
   statusbar.className = "statusbar";
   statusbar.innerHTML =
     `<span class="name">untitled</span><span class="sp"></span><span class="lc">Ln 1, Col 1</span><span class="wc">0 words &middot; 0 chars</span><span class="dirty"></span>`;
    app.appendChild(statusbar);

    const status = statusbar.querySelector(".name");
  const lc = statusbar.querySelector(".lc");
  const wc = statusbar.querySelector(".wc");
  const dirtyEl = statusbar.querySelector(".dirty");

  /* ---- tab model — DOM is source of truth; we sync editor + preview + status from it ---- */
  const TABS = [];
  let activeTab = null;
  let raf = 0, suppressInput = false;
  // Duration (ms) during which a follower pane's own scroll events are treated
  // as the ECHO of our programmatic scrollTop assignment, not as a fresh user
  // scroll. Must outlast the async delivery of that scroll event in WebKitGTK.
  // Older WebKitGTK (2.28) has noticeably slower event delivery than Chromium/
  // modern WebKit, so use a generous window. The cost is negligible — we only
  // suppress scroll events on the pane we *just* drove; any user input on that
  // pane during the window is re-armed on the next tick, not lost.
  const ECHO_MS = 800;
  // Consecutive keystrokes within this window (ms) count as a SINGLE undo step.
  // A pause longer than this finalizes the step so Ctrl+Z reverts it as one unit.
  const COALESCE_MS = 500;
  // Armed briefly after a middle-click close so we can veto the spurious X11
  // primary-selection paste that would otherwise land in the newly focused tab.
  // Set to the timestamp the block expires; the capture-phase intercept below
  // rejects primary-selection pastes while now < midClosePasteBlock. The window
  // is short on purpose — just long enough to outlast the async X11 paste
  // delivery right after a close, so real user pastes are never affected.
  let midClosePasteBlock = 0;
  const MIDCLOSE_PASTE_BLOCK_MS = 400;
  // Capture-phase listener: runs before the textarea's own handlers, so it can
  // veto the paste and prevent the value mutation during the block window.
  document.addEventListener("beforeinput", (ev) => {
    if (ev.inputType === "insertFromPaste" && performance.now() < midClosePasteBlock) {
      ev.preventDefault();
    }
  }, true);
  // Native X11 primary-selection paste is also delivered as a "paste" event;
  // veto it the same way.
  document.addEventListener("paste", (ev) => {
    if (performance.now() < midClosePasteBlock) ev.preventDefault();
  }, true);

  function makeTab(name, text) {
    const doc = {
      id: "t" + (++docId) + Date.now().toString(36),
      name: name || "Untitled",
      path: null,
      dirty: false,
      undo: [], redo: [],
    };

    const tab = document.createElement("div");
    tab.className = "tab";
    tab.innerHTML = `<span class="tname"></span><button class="tclose" title="Close" aria-label="Close tab">&times;</button>`;

    const pane = document.createElement("div");
    pane.className = "pane-group";
    pane.innerHTML = `
      <div class="pane pane-editor">
        <div class="editor-scroll"><div class="editor-col">
          <div class="editor md" aria-hidden="true" data-placeholder="Start writing Markdown&hellip;"></div>
          <textarea class="input" spellcheck="false" placeholder="Start writing Markdown&hellip;" aria-label="Markdown source"></textarea>
        </div></div>
      </div>
      <div class="pane pane-preview">
        <div class="preview-scroll"><div class="preview"></div></div>
      </div>`;

    doc.tab = tab;
    doc.pane = pane;
    doc.input = pane.querySelector(".input");
    doc.editor = pane.querySelector(".editor");
    doc.preview = pane.querySelector(".preview");
    doc.editorScroll = pane.querySelector(".editor-scroll");
    doc.previewScroll = pane.querySelector(".preview-scroll");

    workspace.appendChild(pane);
    tabBar.appendChild(tab);

    if (text !== undefined && text !== null) {
      suppressInput = true;
      doc.input.value = text;
      suppressInput = false;
    }
    doc.dirty = false;
    doc._typeBase = doc.input.value; // baseline for the next typing burst's "from"
    doc._lastVal = doc.input.value;  // input handler baseline: detect no-op events
    syncDom(doc);
    bind(doc);
    TABS.push(doc);
    return doc;
  }

  function textOf(d) { return d.input.value; }

  function syncDom(d) {
    const text = d.input.value;
    d.editor.innerHTML = highlightToHtml(text);
    d.preview.innerHTML = text.trim() ? marked.parse(text) : `<div class="empty">Nothing to preview yet&hellip;</div>`;
    d.editor.classList.toggle("placeholder", !text.trim());
    d.tab.classList.toggle("dirty", d.dirty);
    d.tab.querySelector(".tname").textContent = d.name;
    d.tab.setAttribute("title", d.name + (d.dirty ? " — unsaved" : ""));
  }

  // Track the value the app last WROTE (or user-typed) so we can tell real typing
  // apart from spurious no-op "input" events that WebKitGTK dispatches on focus in
  // some situations (e.g. after tab switch / window activation). A real keystroke
  // always ends with value ≠ d._lastVal; a no-op dispatch leaves it equal.
  function bind(doc) {
    doc.input.addEventListener("input", () => {
      if (suppressInput) return;
      const v = doc.input.value;
      if (v === doc._lastVal) return; // spurious / no-op input (WebKitGTK focus quirk)
      doc._lastVal = v;
      doc.dirty = true;
      if (doc === activeTab) {
        doc.redo.length = 0; // new user typing starts a fresh branch — drop the redo stack
        captureTypeSnapshot(doc);
        scheduleTypeSettle(doc);
        setUndoRedoState();
      }
      refresh();
    });
    doc.input.addEventListener("select", () => { if (doc !== activeTab) return; updateActiveStates(); updateStatus(doc); setUndoRedoState(); });
    // keyup covers caret moves made by arrow keys / Home / End that produce NO
    // "input" or "select" event (the select event is unreliable on WebKitGTK).
    doc.input.addEventListener("keyup", () => { if (doc === activeTab) { updateStatus(doc); updateActiveStates(); } setUndoRedoState(); });
    doc.input.addEventListener("keydown", onKeyDown);
    doc.input.addEventListener("blur", () => { if (doc === activeTab) updateActiveStates(); });
    doc.input.addEventListener("mousedown", () => { if (doc !== activeTab) { activate(doc); } });
    doc.input.addEventListener("click", (ev) => {
      if (ev.ctrlKey || ev.metaKey) openAtCaret();
      else if (doc === activeTab) requestAnimationFrame(() => { if (doc === activeTab) { updateStatus(doc); updateActiveStates(); } });
    });
    // Mouse caret placement. On WebKitGTK the "select" event is unreliable (see
    // the select handler above) and "selectionchange" may not fire either, so we
    // also refresh on mouseup (always delivered) — after a frame so the selection
    // has settled. This is what makes the toolbar light up the instant you click
    // the caret onto formatted text, without having to *change* the text.
    doc.input.addEventListener("mouseup", () => {
      if (doc !== activeTab) return;
      requestAnimationFrame(() => { if (doc === activeTab) { updateStatus(doc); updateActiveStates(); } });
    });
    // Rich paste: if the clipboard carries an HTML fragment we can turn into
    // Markdown (a table, or a bold/italic/underline-wrapped span), commit it as
    // a single undo-able edit instead of dropping raw HTML into the textarea.
    // Plain-text pastes fall through to the browser's default insert, which is
    // exactly what we want.
    doc.input.addEventListener("paste", (ev) => {
      if (performance.now() < midClosePasteBlock) return; // mid-click-close guard
      if (doc !== activeTab) return;
      const html = ev.clipboardData && ev.clipboardData.getData && ev.clipboardData.getData("text/html");
      if (!html) return;
      const md = mdFromHtml(html);
      if (!md) return;
      ev.preventDefault();
      const a = doc.input.selectionStart, b = doc.input.selectionEnd;
      const text = doc.input.value;
      const to = text.slice(0, a) + md + text.slice(b);
      commit("paste", to, a + md.length, a + md.length);
    });
    doc.tab.querySelector(".tname").addEventListener("click", () => activate(doc));
    // Middle-click (button 1) closes the tab, like most editors/browsers.
    // preventDefault stops the browser's default autoscroll on middle mouse.
    // Guarding on button===1 means left/right clicks on the × button still work
    // via their own "click" handler (this one ignores them).
    //
    // X11/Linux quirk: a middle mouse click is ALSO the primary-selection paste
    // gesture. On WebKitGTK/X11 the OS delivers the primary selection to a
    // focused text input even when we preventDefault the mousedown, and the
    // delivery happens AFTER activate() has already refocused the next tab's
    // input. So the paste lands in the OTHER tab — which is why closing tab 2
    // with a middle-click made tab 1 pick up tab 2's text. We block this by
    // arming a short-lived "block paste from a middle-click close" flag here;
    // a capture-phase beforeinput listener (installed below per textbox)
    // rejects any insertFromPaste while that flag is set.
    doc.tab.addEventListener("mousedown", (ev) => {
      if (ev.button !== 1) return;
      ev.preventDefault();
      if (document.activeElement === doc.input) doc.input.blur();
      midClosePasteBlock = performance.now() + MIDCLOSE_PASTE_BLOCK_MS;
      closeTab(doc);
    });
    doc.tab.querySelector(".tclose").addEventListener("click", (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      closeTab(doc);
    });
    // A genuine user scroll on a pane makes the OTHER pane follow it. The trap
    // is that followScroll programmatically sets the follower's scrollTop, and
    // the scroll event that fires for that assignment reaches us ASYNCHRONOUSLY
    // (a queued task) — so by the time it lands we can't tell it apart from the
    // user. Value-matching the assignment fails on WebKitGTK (the value read
    // back isn't the value we wrote), so we suppress the follower's echo with a
    // TIME WINDOW instead: right after we set the follower we mark it "being
    // driven", and any scroll event from it inside that window is our echo and
    // is dropped. Without this, the echoed event flips which pane is leading,
    // and the ratio→pixel→ratio round-trip between two panes of different
    // heights ratchets the value down frame-by-frame — the "keeps scrolling to
    // the top" drift. Suppression breaks the feedback loop the instant it forms.
    // Window must outlast the async delivery of the follower's scroll event.
    // In WebKitGTK this can be noticeably slower than in Chromium/Blink, and the
    // user's reported symptom (lead:e ↔ lead:p flicker) indicates the echo event
    // is arriving later than in Chromium. Use a generous window; this only
    // suppresses scroll events on the pane we JUST drove, so any user scroll in
    // that span is re-armed on the very next tick — not lost, just delayed.
    function realScroll(letter) {
      if (doc !== activeTab) return;
      const now = performance.now();
      const key = letter === "e" ? "__suppE" : "__suppP";
      if (doc[key] > now) return; // we just drove this pane → it's our echo
      doc.__lead = letter;
      kickScrollSync();
    }
    doc.editorScroll.addEventListener("scroll", () => realScroll("e", doc.editorScroll), { passive: true });
    doc.previewScroll.addEventListener("scroll", () => realScroll("p", doc.previewScroll), { passive: true });
  }

  function activate(doc) {
    activeTab = doc;
    for (const d of TABS) {
      d.pane.classList.toggle("active", d === doc);
      d.tab.classList.toggle("active", d === doc);
    }
    doc.input.focus();
    refresh();
    saveSessionSoon();
  }

  // A freshly opened tab must always read from the top. Without this, focusing
  // the textarea (caret at the end of the restored text) plus the 32vh bottom
  // overlay padding lets the webview park the scroll at the bottom.
  function openAtTop(doc) {
    // Mark our programmatic resets as echoes so the resulting scroll events are
    // treated as our own and can't kick off the two-pane sync.
    doc.__suppE = performance.now() + ECHO_MS;
    doc.__suppP = performance.now() + ECHO_MS;
    doc.editorScroll.scrollTop = 0;
    doc.previewScroll.scrollTop = 0;
    doc.input.setSelectionRange(0, 0);
    requestAnimationFrame(() => {
      doc.__suppE = performance.now() + ECHO_MS;
      doc.__suppP = performance.now() + ECHO_MS;
      doc.editorScroll.scrollTop = 0;
      doc.previewScroll.scrollTop = 0;
    });
  }

  function renderTabs() {
    for (const d of TABS) {
      d.tab.classList.toggle("active", d === activeTab);
      d.tab.classList.toggle("dirty", d.dirty);
      d.pane.classList.toggle("active", d === activeTab);
    }
  }

  function newTabName(existing) {
    let n = 1;
    while (existing.some((d) => d.name === `Untitled ${n}`)) n++;
    return `Untitled ${n}`;
  }

  function newTab(name, text, focus = true) {
    const doc = makeTab(name || newTabName(TABS), text !== undefined ? text : "");
    openAtTop(doc);
    activate(doc);
    saveSession();
    return doc;
  }

  // Show the "unsaved changes" dialog for a tab with dirty content.
  // Returns 'save' | 'discard' | 'cancel'. When `clear` is true the primary
  // action clears the last tab in place (rather than closing it) and the Cancel
  // button is read-only (the tab can't be removed).
  // Ask how to handle a tab with unsaved changes. Resolves:
  //   { choice: 'save'|'discard'|'cancel' }
  // `clear` = we are on the LAST tab (can't remove it), so the primary action
  // reads "Clear this document?" and the Cancel button is the only way out.
  function showSaveDiscardDialog(doc, { clear = false } = {}) {
    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.className = "savedlg-backdrop";
      const box = document.createElement("div");
      box.className = "savedlg";
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      box.setAttribute("aria-label", "Unsaved changes");
      const title = document.createElement("h3");
      title.textContent = clear ? "Clear this document?" : "Unsaved changes";
      const msg = document.createElement("p");
      msg.className = "savedlg-msg";
      msg.textContent = clear
        ? `“${doc.name}” has unsaved changes. This is the last open tab, so it can’t be closed. Clear it?`
        : `“${doc.name}” has unsaved changes.`;
      const btns = document.createElement("div");
      btns.className = "savedlg-btns";
      box.append(title, msg, btns);
      backdrop.appendChild(box);
      document.body.appendChild(backdrop);

      const mkBtn = (label, cls, onPick) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn " + cls;
        b.textContent = label;
        b.addEventListener("click", () => pick(onPick));
        btns.appendChild(b);
        return b;
      };

      let done = false;
      const cleanup = () => {
        backdrop.removeEventListener("mousedown", onBackdrop, true);
        window.removeEventListener("keydown", onKey, true);
        box.removeEventListener("keydown", onTab, true);
        backdrop.remove();
      };
      const pick = (choice) => { if (done) return; done = true; cleanup(); resolve({ choice }); };

      const cancelBtn = mkBtn("Cancel", "", "cancel");
      if (clear) {
        mkBtn("Clear", "danger", "discard");
        mkBtn("Save & Clear", "primary", "save");
      } else {
        mkBtn("Discard", "danger", "discard");
        mkBtn("Save", "primary", "save");
      }

      // Clicking the dimmed backdrop counts as Cancel.
      const onBackdrop = (ev) => { if (ev.target === backdrop) pick("cancel"); };
      backdrop.addEventListener("mousedown", onBackdrop, true);
      // Escape cancels; Tab is trapped inside the dialog.
      const onKey = (ev) => { if (ev.key === "Escape") { ev.preventDefault(); pick("cancel"); } };
      window.addEventListener("keydown", onKey, true);
      const onTab = (ev) => {
        if (ev.key !== "Tab") return;
        ev.preventDefault();
        const list = Array.from(btns.querySelectorAll("button")).filter((b) => !b.disabled);
        if (!list.length) return;
        const i = list.indexOf(document.activeElement);
        const n = ev.shiftKey
          ? (i <= 0 ? list.length - 1 : i - 1)
          : (i === -1 ? 0 : (i + 1) % list.length);
        list[n].focus();
      };
      box.addEventListener("keydown", onTab, true);

      // Put initial focus on the primary (right-most) button.
      requestAnimationFrame(() => {
        const last = btns.lastElementChild;
        if (last) last.focus();
        else cancelBtn.focus();
      });
    });
  }

  /* ---- shared in-app modal ----
   * Replaces native `tauri-message` (and the rfd GTK save/open pickers). The
   * reason: `tauri-plugin-dialog` passes the parent window to rfd on Linux,
   * but rfd-0.16's GTK3 backend NEVER calls `gtk_window_set_transient_for` or
   * `gtk_window_set_position(GTK_WIN_POS_CENTER_ON_PARENT)` — the dialog opens
   * wherever the WM places it, unrelated to the app's location. An in-app
   * modal lives inside the single webview and is therefore centered on the app
   * window by construction. Browser-safe too (runs under `vite preview`).
   *
   * Returns a handle: { box, finish(value), promise } synchronously. `finish`
   * is idempotent — it removes the DOM, wires the escape/backdrop listeners
   * out, and resolves `promise` once. Callers build their content into `box`
   * *before* returning.
   */
  function showModalBase({ label, closeOnBackdrop = false, focusEl } = {}) {
    const backdrop = document.createElement("div");
    backdrop.className = "savedlg-backdrop";
    const box = document.createElement("div");
    box.className = "savedlg";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    if (label) box.setAttribute("aria-label", label);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);

    let done = false;
    let resolved = false;
    const handle = { box, finish: null, promise: null };
    handle.promise = new Promise((resolve) => {
      handle.finish = (value) => {
        if (done) return;
        done = true;
        if (backdrop._onBackdrop) backdrop.removeEventListener("mousedown", backdrop._onBackdrop, true);
        window.removeEventListener("keydown", handle._onKey, true);
        box.removeEventListener("keydown", handle._onTab, true);
        backdrop.remove();
        resolved = true;
        resolve(value);
      };

      if (closeOnBackdrop) {
        backdrop._onBackdrop = (ev) => { if (ev.target === backdrop) handle.finish(undefined); };
        backdrop.addEventListener("mousedown", backdrop._onBackdrop, true);
      }

      handle._onKey = (ev) => {
        if (ev.key === "Escape") { ev.preventDefault(); handle.finish(undefined); }
      };
      window.addEventListener("keydown", handle._onKey, true);

      handle._onTab = (ev) => {
        if (ev.key !== "Tab") return;
        ev.preventDefault();
        const focusables = Array.from(box.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter((el) => el.offsetParent !== null);
        if (!focusables.length) return;
        const i = focusables.indexOf(document.activeElement);
        const n = ev.shiftKey
          ? (i <= 0 ? focusables.length - 1 : i - 1)
          : (i === -1 ? 0 : (i + 1) % focusables.length);
        focusables[n].focus();
      };
      box.addEventListener("keydown", handle._onTab, true);

      if (focusEl) {
        requestAnimationFrame(() => {
          const el = (typeof focusEl === "function" ? focusEl() : focusEl);
          if (el && typeof el.focus === "function") el.focus();
        });
      }
    });
    return handle;
  }

  /* Simple centered message box: one message, one (or more) button row.
   * Options:
   *   { title, message, buttons: [{ label, kind?: 'primary'|'danger'|'', value }],
   *     kind?: 'info'|'error'|'warn' }
   * Resolves with the `value` of the clicked button (or undefined if dismissed
   * by backdrop / Escape).
   */
   function messageModal({ title = "Notice", message = "", buttons, kind = "info" } = {}) {
     if (!buttons || !buttons.length) buttons = [{ label: "OK", value: "ok" }];
     const modal = showModalBase({ label: title, closeOnBackdrop: true });
     const { box, finish } = modal;

     const h = document.createElement("h3");
     h.textContent = title;
     box.appendChild(h);

     const p = document.createElement("p");
     p.className = "savedlg-msg";
     if (kind) p.dataset.kind = kind;
     p.textContent = message;
     box.appendChild(p);

     const row = document.createElement("div");
     row.className = "savedlg-btns";
     let primaryEl = null;
     for (const b of buttons) {
       const el = document.createElement("button");
       el.type = "button";
       el.className = "btn " + (b.kind || "");
       el.textContent = b.label || "OK";
       el.addEventListener("click", () => finish(b.value));
       row.appendChild(el);
       if (b.kind === "primary") primaryEl = el;
     }
     box.appendChild(row);

     if (primaryEl) primaryEl.focus();
     else row.lastElementChild && row.lastElementChild.focus();

     return modal.promise;
   }

   /* ---- In-app Path Picker (Save-As / Open) ----
    * A minimal centered folder browser + filename row. Works under `vite preview`
    * (browser: the caller is responsible for a <input type=file> fallback) and
    * under Tauri (`plugin:fs|read_dir`). No native GTK dialog opens, so the
    * picker is centered on the app window by construction — see `showModalBase`
    * for the why (rfd's GTK3 backend never parents/centers its dialogs).
    *
    * Resolve shape:
    *   { path: "/abs/path.md", name: "path.md" }   — user accepted
    *   { path: null }                                — user cancelled
    *
    * Options:
    *   mode            : 'save' | 'open'
    *   defaultFilename : string  (pre-filled in the name row, save-only)
    *   defaultDir      : string  (initial cwd; defaults to homeDir())
    *   filters         : [{ name, extensions: [...] }]  (save mode only; used to
    *                                                       dim non-matching files)
    */
    function pickPath(opts = {}) {
     const mode = opts.mode === "open" ? "open" : "save";
     const filterSet = new Set(
       (opts.filters || [{ name: "File", extensions: ["md", "markdown", "txt"] }])
         .reduce((acc, f) => acc.concat(f.extensions || []), [])
         .map((e) => String(e).replace(/^\./, "").toLowerCase())
         .filter(Boolean)
     );
     const matchesExt = (name) => {
       const s = String(name);
       const dot = s.lastIndexOf(".");
       if (dot < 1) return false;
       return filterSet.has(s.slice(dot + 1).toLowerCase());
     };

     return new Promise(async (resolve) => {
       const modal = showModalBase({
         label: mode === "save" ? "Choose a location to save to" : "Open a file",
       });
       const { box, finish } = modal;

       const h = document.createElement("h3");
       h.textContent = mode === "save" ? "Save to…" : "Open…";

        const pathbar = document.createElement("div");
        pathbar.className = "picker-pathbar";

        // A small interactive control button that renders consistently across
        // both light and dark themes (WebKitGTK renders emoji as flat/missing
        // glyphs; an inline SVG with `currentColor` always matches the text
        // color and stays visible). Used for the Home / Up navigation buttons.
        if (!window.__pickCtrlGlyphs) {
          window.__pickCtrlGlyphs = {
            HOME: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10l9-7 9 7v11a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z"/></svg>',
            UP: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
          };
        }
        const makeCtrl = (glyphKey, label, onClick) => {
          const el = document.createElement("span");
          el.className = "ctrl";
          el.setAttribute("role", "button");
          el.tabIndex = 0;
          el.title = label;
          el.setAttribute("aria-label", label);
          el.innerHTML = window.__pickCtrlGlyphs[glyphKey];
          el.addEventListener("click", onClick);
          el.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onClick(); }
          });
          return el;
        };

        const list = document.createElement("ul");
       list.className = "picker-list";
       list.setAttribute("role", "listbox");

       let nameInput = null;
       const nameRow = document.createElement("div");
       nameRow.className = "picker-name";
       if (mode === "save") {
         const lab = document.createElement("label");
         lab.textContent = "Name:";
         nameInput = document.createElement("input");
         nameInput.type = "text";
         nameInput.value = opts.defaultFilename || "untitled.md";
         nameInput.setAttribute("spellcheck", "false");
         nameRow.append(lab, nameInput);
       }

       const status = document.createElement("div");
       status.className = "picker-status";
       status.setAttribute("aria-live", "polite");

       const setStatus = (text, kind) => {
         status.textContent = text || "";
         if (kind) status.dataset.kind = kind; else status.removeAttribute("data-kind");
       };

       const row = document.createElement("div");
       row.className = "savedlg-btns";
       const cancelBtn = document.createElement("button");
       cancelBtn.type = "button";
       cancelBtn.className = "btn";
       cancelBtn.textContent = "Cancel";
       const confirmBtn = document.createElement("button");
       confirmBtn.type = "button";
       confirmBtn.className = "btn primary";
       confirmBtn.textContent = mode === "save" ? "Save" : "Open";
       row.append(cancelBtn, confirmBtn);

       if (mode === "save") box.append(h, pathbar, list, nameRow, status, row);
       else                 box.append(h, pathbar, list, status, row);

       let cwd = opts.defaultDir || null;
       if (!cwd) {
         try { cwd = await tauriHomeDir(); } catch (_) { cwd = null; }
       }
       if (cwd) { try { cwd = decodeURIComponent(String(cwd)); } catch (_) {} }
       cwd = String(cwd || "/").replace(/\/+$/, "") || "/";

       const state = { cwd, picked: null };
       let listToken = 0;
       let settled = false;

       const done = (result) => {
         if (settled) return;
         settled = true;
         finish();
         resolve(result);
       };

        const renderCrumb = () => {
          pathbar.innerHTML = "";
          // Home and Up are ALWAYS present: the Home button is the "escape hatch"
          // back to the user's home dir no matter how deep (or how far off home)
          // the user has navigated. Up is inert at "/" (no parent to go to).
          const homeBtn = makeCtrl("HOME", "Home directory", () => goToHome());
          const upBtn = makeCtrl("UP", "Go up", () => goToUp());
          pathbar.appendChild(homeBtn);
          pathbar.appendChild(upBtn);
          const parts = state.cwd.split("/").filter(Boolean);
          if (state.cwd === "/" || parts.length === 0) {
            // We're at the filesystem root: show it as a plain current-location
            // label (not a button — there's nothing above it and Home already
            // covers "escape to a useful place").
            const c = document.createElement("span");
            c.textContent = "/";
            c.className = "crumb-cur";
            pathbar.appendChild(c);
            return;
          }
          for (let i = 0; i < parts.length; i++) {
           const c = document.createElement("span");
           c.textContent = parts[i];
           c.dataset.crumb = "/" + parts.slice(0, i + 1).join("/");
           if (i === parts.length - 1) c.classList.add("crumb-cur");
           c.addEventListener("click", () => goToDir(c.dataset.crumb));
           pathbar.appendChild(c);
           const sep = document.createElement("span");
           sep.className = "sep"; sep.textContent = "/";
           pathbar.appendChild(sep);
         }
         // Remove the trailing separator (visual polish).
         const last = pathbar.lastElementChild;
         if (last && last.classList.contains("sep")) pathbar.removeChild(last);
       };

        const render = (entries) => {
          list.innerHTML = "";
          if (!Array.isArray(entries) || !entries.length) {
            const li = document.createElement("li");
            li.textContent = "(no folders or files here)";
            li.style.color = "var(--fg-dim)";
            li.style.cursor = "default";
            list.appendChild(li);
            setStatus("Empty: " + state.cwd);
            return;
          }
          const norm = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: "base" });
          const isDir = (e) => e.isDirectory || e.is_directory || e.is_dir;
          const isFile = (e) => e.isFile || e.is_file;
          const dirs = entries.filter((e) => e && isDir(e)).sort(norm);
          const files = entries.filter((e) => e && isFile(e)).sort(norm);
         const frag = document.createDocumentFragment();
         for (const d of dirs) {
           const li = document.createElement("li");
           li.setAttribute("role", "option");
           li.dataset.name = d.name;
            li.innerHTML = '<span class="glyph">\u25B8</span><span class="dir"></span>';
           li.lastElementChild.textContent = d.name;
           li.addEventListener("click", () => goToDir(state.cwd + "/" + d.name));
           frag.appendChild(li);
         }
         for (const f of files) {
           const li = document.createElement("li");
           li.setAttribute("role", "option");
           li.dataset.name = f.name;
           const dim = mode === "save" && !matchesExt(f.name);
            li.innerHTML = '<span class="glyph">\u2013</span><span class="fname"></span>';
           li.lastElementChild.textContent = f.name;
           if (dim) li.style.color = "var(--fg-dim)";
            li.addEventListener("click", () => {
              state.picked = f.name;
              if (mode === "save") nameInput.value = f.name;
              list.querySelectorAll("li.sel").forEach((x) => x.classList.remove("sel"));
              li.classList.add("sel");
            });
            li.addEventListener("dblclick", () => confirmFile(f.name));
            frag.appendChild(li);
          }
          list.appendChild(frag);
          setStatus(dirs.length + " folder" + (dirs.length === 1 ? "" : "s"), "ok");
        };

         const goToDir = async (dir) => {
           const token = ++listToken;
           // Only surface "Loading…" once a read has been in flight >2s. Fast
           // (local) loads then never flash it — this kills the status text
           // jitter when navigating between directories.
           const loadingTimer = setTimeout(() => {
             if (token === listToken) setStatus("Loading…");
           }, 2000);
           let entries;
           try { entries = await tauriReadDir(dir); }
           catch (e) {
             clearTimeout(loadingTimer);
             if (token !== listToken) return;
             // Read failed (e.g. a forbidden path). Keep state.cwd and the crumb
             // on the last readable directory — do NOT adopt the failed path.
             setStatus("Cannot read " + dir + " — " + ((e && (e.message || e)) || "error"), "error");
             return;
           }
           clearTimeout(loadingTimer);
           if (token !== listToken) return;
           // Only commit the path after a successful read.
           state.cwd = dir;
           state.picked = null;
           renderCrumb();
           render(entries);
           setStatus("");
         };

        const goToUp = () => {
          if (state.cwd === "/") return;
          const dir = state.cwd.split("/").slice(0, -1).join("/") || "/";
          goToDir(dir);
        };

        // Jump the picker to the user's home directory. Resolved lazily so the
        // home is always the caller's real $HOME, however deep we've navigated.
        // Guarded by isTauri() because homeDir() is a Tauri IPC call (in a plain
        // browser it would reject); the button is still shown — tapping it in a
        // browser simply no-ops (the picker only exists in the Tauri build anyway).
        const goToHome = async () => {
          if (!isTauri()) return;
          let home = null;
          try { home = await tauriHomeDir(); } catch (_) { home = null; }
          if (!home) return;
          try { home = decodeURIComponent(String(home)); } catch (_) {}
          home = String(home).replace(/\/+$/, "") || "/";
          goToDir(home);
        };

       const confirmFile = (name) => {
         const full = state.cwd + "/" + name;
         done({ path: full, name });
       };

       const onConfirm = () => {
         if (mode === "save") {
           const v = (nameInput.value || "").trim();
           if (!v) { setStatus("Name is required", "warn"); nameInput.focus(); return; }
           if (/\//.test(v)) {
             // The user typed an absolute or relative path in the name row —
             // honor it literally (the Tauri scope is ** anyway).
             done({ path: v, name: v.split("/").filter(Boolean).pop() || v });
             return;
           }
           if (state.picked && state.picked === v) { done({ path: state.cwd + "/" + v, name: v }); return; }
           done({ path: state.cwd + "/" + v, name: v });
           return;
         }
         // open mode: must have selected a file
         if (!state.picked) { setStatus("Select a file first", "warn"); return; }
         confirmFile(state.picked);
       };

       confirmBtn.addEventListener("click", onConfirm);
       cancelBtn.addEventListener("click", () => done({ path: null }));
       if (nameInput) {
         nameInput.addEventListener("keydown", (ev) => {
           if (ev.key === "Enter") { ev.preventDefault(); onConfirm(); }
         });
       }

       renderCrumb();
       goToDir(state.cwd);

       // Default focus to the name input (save) or the list (open).
       const focusTarget = mode === "save" ? nameInput : list;
       if (focusTarget && focusTarget.focus) requestAnimationFrame(() => focusTarget.focus());
     });
   }

  // Empty the LAST tab's content and reset it to a fresh, clean, non-dirty state.
  // Called after the user confirms they want to clear the last tab.
  function resetLastTab(doc) {
    if (doc._typeSettle) { clearTimeout(doc._typeSettle); doc._typeSettle = 0; }
    doc._typeMark = null;
    doc.undo = [];
    doc.redo = [];
    doc.name = "Untitled";
    doc.path = null;
    doc._typeBase = "";
    doc._lastVal = "";
    doc.input.value = "";
    doc.dirty = false;
    if (doc === activeTab) { openAtTop(doc); refresh(); }
    saveSession();
  }

  // Close a tab, asking first if it has unsaved changes. If it is the last tab
  // we never actually remove it — we clear it in place (after confirming), so the
  // app always has exactly one tab open.
  async function closeTab(doc) {
    if (TABS.indexOf(doc) === -1) return;
    if (doc.dirty) {
      const last = TABS.length === 1;
      const { choice } = await showSaveDiscardDialog(doc, { clear: last });
      if (choice === "cancel") return;
      if (choice === "save") { const ok = await save(doc); if (!ok) return; }
    }
    if (TABS.length === 1) {
      resetLastTab(doc);
      return;
    }
    const idx = TABS.indexOf(doc);
    TABS.splice(idx, 1);
    doc.pane.remove();
    doc.tab.remove();
    const next = TABS[Math.min(idx, TABS.length - 1)];
    activate(next);
    saveSession();
  }

  // Low-level removal of a tab (DOM + array). No dirty prompt, no last-tab
  // reset — the caller (closeApp) owns the prompts and the empty-state.
  function removeTab(doc) {
    const idx = TABS.indexOf(doc);
    if (idx === -1) return;
    TABS.splice(idx, 1);
    doc.pane.remove();
    doc.tab.remove();
    if (doc === activeTab) activeTab = TABS[TABS.length - 1] || null;
  }

  // Walk every open tab — active first, then the rest right-most → left-most —
  // prompting to save any dirty one, then removing it. Used on app exit, where
  // tabs are genuinely removed (unlike closeTab, which never drops the last one).
  // Resolves true when all tabs are cleared; false if the user cancels (the
  // caller then keeps the window open).
  async function closeApp() {
    const order = [];
    if (activeTab) order.push(activeTab);
    const rest = TABS
      .filter((d) => d !== activeTab)
      .sort((a, b) => TABS.indexOf(b) - TABS.indexOf(a));
    order.push(...rest);

    for (const doc of order) {
      if (TABS.indexOf(doc) === -1) continue; // already removed
      if (TABS.length === 0) break;
      if (doc.dirty) {
        const { choice } = await showSaveDiscardDialog(doc, { clear: false });
        if (choice === "cancel") return false;
        if (choice === "save") { const ok = await save(doc); if (!ok) return false; }
      }
      removeTab(doc);
    }
    saveSession();
    return true;
  }

  function refresh() {
    const doc = activeTab;
    if (!doc) return;
    syncDom(doc);
    updateStatus(doc);
    updateActiveStates();
    setUndoRedoState();
  }
  function scheduleRefresh() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; refresh(); });
  }
  // Apply the leading pane's scroll ratio to its follower. Kept idempotent and
  // cheap: called at most once per frame by kickScrollSync while scrolling.
  function followScroll(doc) {
    const src = doc.__lead === "e" ? doc.editorScroll : doc.previewScroll;
    const dst = doc.__lead === "e" ? doc.previewScroll : doc.editorScroll;
    const maxA = src.scrollHeight - src.clientHeight;
    if (maxA <= 0) return;
    const ratio = src.scrollTop / maxA;
    const target = ratio * (dst.scrollHeight - dst.clientHeight);
    // Suppress this pane's echo scroll event for ECHO_MS so it does NOT flip
    // the lead and start driving the OTHER pane (the feedback ratchet). Store a
    // deadline; realScroll drops any event from this pane while now < deadline.
    const dstKey = doc.__lead === "e" ? "__suppP" : "__suppE";
    doc[dstKey] = performance.now() + ECHO_MS;
    dst.scrollTop = target;
  }
  let scrollRaf = 0;
  function kickScrollSync() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      const doc = activeTab;
      // Only follow while a pane is actively being scrolled (a scroll event set
      // __lead within the last frame). When momentum ends no event fires and we
      // do no further work — no persistent per-frame loop.
      if (doc && (doc.__lead === "e" || doc.__lead === "p")) {
        followScroll(doc);
      } else if (doc) {
        doc.__lead = null;
      }
    });
  }
  function updateStatus(doc) {
    const text = doc.input.value;
    const a = doc.input.selectionStart;
    const before = text.slice(0, a);
    const ln = (before.match(/\n/g) || []).length + 1;
    const lineStart = before.lastIndexOf("\n") + 1;
    const col = a - lineStart + 1;
    const words = (text.match(/\S+/g) || []).length;
    status.textContent = doc.name || "untitled";
    lc.textContent = `Ln ${ln}, Col ${col}`;
    wc.innerHTML = `${words} word${words === 1 ? "" : "s"} &middot; ${text.length} char${text.length === 1 ? "" : "s"}`;
    dirtyEl.textContent = doc.dirty ? "\u25CF unsaved" : "";
    dirtyEl.className = doc.dirty ? "dirty" : "";
  }
  function setUndoRedoState() {
    const d = activeTab; if (!d) return;
    const u = toolbar.querySelector('[data-action="undo"]');
    const r = toolbar.querySelector('[data-action="redo"]');
    u.disabled = d.undo.length === 0 && !d._typeMark; // a pending typing burst counts as undoable
    r.disabled = d.redo.length === 0;
  }

  // Typing is NOT a discrete action like formatting — it streams one input event
  // per keystroke. We coalesce a whole burst (a run of keystrokes within
  // COALESCE_MS) into a single undo step: snapshot the text+caret once at the
  // start of the burst (capture) and, after the user pauses (a settle timer),
  // push that one snapshot. flushTypeCommit is the single choke point for
  // "a programmatic text change is about to happen" — it settles any pending
  // burst so commit()/undo()/redo() can clear or pop the stack consistently.
  // _lastFlushTs gates capture() so a burst that starts within COALESCE_MS of a
  // commit/undo/redo is treated as a continuation, not a brand-new step (this
  // is what stops Ctrl+Z from reverting only part of a freshly-typed word).
  // Capture one snapshot at the start of a typing burst on `d` (only if none is
  // already pending). The "from" state comes from d._typeBase — the text as of the
  // LAST settled state — because at the moment an "input" event fires the live
  // value is ALREADY post-insertion (insertText/type deliver the change before the
  // event). Reading the live value here would record the new text as "from" and
  // undo would be a no-op. _typeBase is maintained everywhere else a settled text
  // changes the document (commit, undo, redo, open, programmatic set).
  function captureTypeSnapshot(d) {
    if (d._typeMark) return;
    d._typeMark = { from: d._typeBase, fromSelS: d.input.selectionStart, fromSelE: d.input.selectionEnd };
  }
  // Push the pending burst on `d` as one undo step (baseline → current), clear it,
  // and cancel its settle timer. After pushing, the current text becomes the new
  // settled baseline so a later burst is a fresh step. Call before any
  // programmatic stack change (commit, undo, redo).
  function flushTypeCommit(d) {
    if (d && d._typeSettle) { clearTimeout(d._typeSettle); d._typeSettle = 0; }
    if (d && d._typeMark) {
      d.undo.push({
        label: "type",
        from: d._typeMark.from, fromSelS: d._typeMark.fromSelS, fromSelE: d._typeMark.fromSelE,
        to: d.input.value, selS: d.input.selectionStart, selE: d.input.selectionEnd,
      });
      if (d.undo.length > 400) d.undo.shift();
      d._typeMark = null;
      d._typeBase = d.input.value;
    }
  }
  // After typing, wait COALESCE_MS of quiet and THEN push the burst as one step.
  function scheduleTypeSettle(d) {
    if (d._typeSettle) clearTimeout(d._typeSettle);
    d._typeSettle = setTimeout(() => {
      d._typeSettle = 0;
      if (!d._typeMark) return;
      flushTypeCommit(d);
      if (d === activeTab) setUndoRedoState();
    }, COALESCE_MS);
  }
  /* ---- undo / redo (custom stack; DOM = source of truth) ---- */
  function commit(label, to, selS, selE) {
    const d = activeTab;
    if (!d) return;
    flushTypeCommit(d); // settle a pending typing burst into the stack first
    d.undo.push({
      label, from: d.input.value,
      fromSelS: d.input.selectionStart, fromSelE: d.input.selectionEnd,
      to, selS, selE,
    });
    if (d.undo.length > 400) d.undo.shift();
    d.redo.length = 0;
    suppressInput = true;
    d.input.value = to;
    suppressInput = false;
    d.input.setSelectionRange(selS, selE);
    d.dirty = true;
    d._typeBase = d.input.value; // new settled state; next typing burst snapshots from here
    d._lastVal = d.input.value; // programmatic write; input handler baseline
    refresh();
  }
  function undo() {
    const d = activeTab;
    if (!d) return;
    flushTypeCommit(d);
    if (!d.undo.length) return;
    const act = d.undo.pop();
    d.redo.push(act);
    suppressInput = true;
    d.input.value = act.from;
    suppressInput = false;
    d.input.setSelectionRange(act.fromSelS, act.fromSelE);
    d.dirty = true;
    d._typeBase = d.input.value; // this is now a settled state; next burst snapshots from here
    d._lastVal = d.input.value; // programmatic write; input handler baseline
    refresh();
  }
  function redo() {
    const d = activeTab;
    if (!d) return;
    flushTypeCommit(d);
    if (!d.redo.length) return;
    const act = d.redo.pop();
    d.undo.push(act);
    suppressInput = true;
    d.input.value = act.to;
    suppressInput = false;
    d.input.setSelectionRange(act.selS, act.selE);
    d.dirty = true;
    d._typeBase = d.input.value; // settled state; next typing burst snapshots from here
    d._lastVal = d.input.value; // programmatic write; input handler baseline
    refresh();
  }

  /* ---- formatting toggles ---- */
  function toggleFormat(kind) {
    const d = activeTab, input = d.input, text = d.input.value;
    const a = input.selectionStart;
    const [lineStart, lineEnd] = lineBounds(text, a);
    const line = text.slice(lineStart, lineEnd);
    const [ws, we] = wordAt(line, a - lineStart);
    const det = detectFormat(line, ws, we);
    let newLine, ns, ne;
    if (kind === "link") {
      if (det && det.fmt === "link") {
        newLine = line.slice(0, ws) + det.inner + line.slice(we);
        ns = ws; ne = ns + det.inner.length;
      } else {
        const w = line.slice(ws, we) || "link";
        newLine = line.slice(0, ws) + `[${w}](https://)` + line.slice(we);
        ns = ws + 3 + w.length; ne = ns + 8;
      }
    } else {
      if (det && det.fmt === kind) {
        newLine = line.slice(0, ws) + det.inner + line.slice(we);
        ns = ws; ne = ns + det.inner.length;
      } else {
        const inner = det && det.fmt ? det.inner : line.slice(ws, we);
        newLine = line.slice(0, ws) + wrapFor(kind, inner) + line.slice(we);
        ns = ws; ne = ns + inner.length;
      }
    }
    commit(kind, text.slice(0, lineStart) + newLine + text.slice(lineEnd), lineStart + ns, lineStart + ne);
  }

  function blockLine(kind, line) {
    const m = line.match(/^\s*(#{1,4}\s|>\s?|[-*+]\s+|\d+\.\s+)/);
    const marker = m ? m[0] : "";
    const contentLine = line.slice(marker.length);
    const isSame =
      (kind === "h1" && /^\s*#\s/.test(line)) ||
      (kind === "h2" && /^\s*##\s/.test(line)) ||
      (kind === "h3" && /^\s*###\s/.test(line)) ||
      (kind === "quote" && /^\s*>/.test(line)) ||
      (kind === "ul" && /^\s*[-*+]\s+/.test(line)) ||
      (kind === "ol" && /^\s*\d+\.\s+/.test(line));
    if (isSame) return contentLine;
    switch (kind) {
      case "h1": return "# " + contentLine;
      case "h2": return "## " + contentLine;
      case "h3": return "### " + contentLine;
      case "quote": return "> " + contentLine;
      case "ul": return "- " + contentLine;
      case "ol": return "1. " + contentLine;
    }
    return line;
  }

  function toggleBlock(kind) {
    const d = activeTab, input = d.input, text = d.input.value;
    const a = input.selectionStart, b = input.selectionEnd;
    const startLine = lineBounds(text, a)[0];
    const endLine = lineBounds(text, b)[1];

    if (kind === "table") {
      // detect GFM table: a line with `|` and no block markers AND the line right below is a separator
      const lines = text.split("\n");
      const cur = lineBounds(text, a)[0];
      let row = cur;
      while (row > 0 && (lines[row - 1] || "").includes("|")) row--;
      let endRow = row;
      while (endRow < lines.length && (lines[endRow] || "").includes("|")) endRow++;
      if (endRow - row >= 2 && (lines[row] || "").includes("|") && isTableSep(lines[row + 1] || "")) {
        // remove the whole table (keep the trailing newline if present)
        const hasTable = true;
        const before = lines.slice(0, row).join("\n");
        const after = lines.slice(endRow).join("\n");
        const to = (before && after) ? before + "\n" + after : (before || after);
        commit("remove table", to, row > 0 ? before.length : 0, row > 0 ? before.length : to.length);
        return;
      }
      const tbl = `| Column 1 | Column 2 | Column 3 |\n| -------- | -------- | -------- |\n|          |          |          |`;
      const pre = (lines[cur] || "").trim() !== "" ? "\n" : "";
      const post = "\n";
      const to = text.slice(0, startLine) + pre + tbl + post + text.slice(endLine);
      commit("insert table", to, startLine + pre.length, startLine + pre.length + tbl.length);
      return;
    }

    if (kind === "codeblock") {
      const block = text.slice(startLine, endLine);
      const arr = block.split("\n");
      const first = (arr[0] || "").trim(), last = (arr[arr.length - 1] || "").trim();
      if (/^(```|~~~)/.test(first) || /^(```|~~~)/.test(last)) {
        if (/^(```|~~~)/.test(arr[0].trim())) arr.shift();
        if (arr.length && /^(```|~~~)/.test(arr[arr.length - 1].trim())) arr.pop();
        const nb = arr.join("\n");
        commit("unwrap code block", text.slice(0, startLine) + nb + text.slice(endLine), startLine, startLine + nb.length);
        return;
      }
      const nb = "```\n" + block + "\n```";
      commit("wrap code block", text.slice(0, startLine) + nb + text.slice(endLine), startLine, startLine + nb.length);
      return;
    }

    const block = text.slice(startLine, endLine);
    const newBlock = block.split("\n").map((l) => blockLine(kind, l)).join("\n");
    commit("block " + kind, text.slice(0, startLine) + newBlock + text.slice(endLine), startLine, startLine + newBlock.length);
  }

  function indentLines(dir) {
    const d = activeTab, input = d.input, text = d.input.value;
    const a = input.selectionStart, b = input.selectionEnd;
    const s = lineBounds(text, a)[0];
    const e = lineBounds(text, b)[1];
    const lines = text.slice(s, e).split("\n");
    const newLines = dir > 0
      ? lines.map((l) => (l === "" ? l : "\t" + l))
      : lines.map((l) => l.replace(/^(\t| {1,4})/, ""));
    commit(dir > 0 ? "indent" : "outdent", text.slice(0, s) + newLines.join("\n") + text.slice(e), s, s + newLines.join("\n").length);
  }

  /* ---- link open (Ctrl+Click on the source, or a URL / [..](..) token) ---- */
  function findLinkToken(text, pos) {
    // [..](url)
    {
      const i = text.lastIndexOf("[", pos);
      const open = i >= 0 && (i === pos || /\s|^/.test(text[i - 1] || ""));
      if (open) {
        const close = text.indexOf("](", i);
        if (close !== -1 && close - i < 200) {
          const end = text.indexOf(")", close);
          if (end !== -1 && end - i < 400) {
            const tok = text.slice(i, end + 1);
            const m = tok.match(/^\[([^\]]*)\]\(([^)]*)\)$/);
            if (m) return { url: m[2], text: m[1] };
          }
        }
      }
    }
    // bare URL around pos
    {
      const L = text.slice(
        text.lastIndexOf("\n", pos - 1) + 1,
        (idx => idx === -1 ? text.length : idx)(text.indexOf("\n", pos)),
      );
      const off = pos - (text.lastIndexOf("\n", pos - 1) + 1);
      const trimmed = L.trim();
      if (/\S/.test(trimmed)) {
        const m = trimmed.match(/(^|\s)((?:https?:\/\/|mailto:)[^\s]+|www\.[^\s]+)/i);
        if (m && off > 0 && off < L.length) {
          const urlStart = L.indexOf(m[2]);
          if (off >= urlStart && off <= urlStart + m[2].length) {
            return { url: m[2], text: m[2] };
          }
        }
      }
    }
    return null;
  }

  async function tauriOpenUrl(url) {
    if (!isTauri()) return false;
    try {
      await tauriOpenUrlApi(url);
      return true;
    } catch { return false; }
  }

  async function openAtCaret() {
    const d = activeTab, input = d.input, text = d.input.value;
    const a = input.selectionStart;
    const tok = findLinkToken(text, a);
    if (!tok) return;
    let url = tok.url;
    if (/^mailto:/i.test(url)) {
      if (await tauriOpenUrl(url)) return;
      window.open(url);
      return;
    }
    if (/^\/\//i.test(url)) url = "https:" + url;
    else if (/^www\./i.test(url)) url = "https://" + url;
    else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = "https://" + url;
    if (await tauriOpenUrl(url)) return;
    window.open(url, "_blank");
  }

  function setMode(m) {
    app.dataset.mode = m;
    // The layout hooks are the class selectors .mode-edit / .mode-preview
    // (style.css), so the class must be toggled too — data-mode alone does nothing.
    app.classList.remove("mode-edit", "mode-preview");
    if (m === "edit") app.classList.add("mode-edit");
    if (m === "preview") app.classList.add("mode-preview");
    const label = toolbar.querySelector(".mode-label");
    if (label) label.textContent = { split: "Split", edit: "Edit", preview: "Preview" }[m];
  }

  /* ---- save / open ----
   * Resolves `true` once the content has been persisted (or handed to the
   * browser download manager), `false` if the user cancelled a Save-As dialog.
   * - Tab already has a `path` → write straight to that file, no dialog.
   * - No `path` yet → show the in-app Save-As picker; on pick, remember the path.
   *
   * Why an in-app picker and not the native `save` dialog: tauri-plugin-dialog
   * hands the parent window to rfd on Linux, but rfd's GTK3 backend never calls
   * set_transient_for / CENTER_ON_PARENT, so the OS file-chooser opens wherever
    * the window manager places it — not over the app. The picker (and the
    * "Save failed" / "Open failed" error modals) are rendered inside the webview
   * and are therefore centered on the app by construction.
   */
  async function save(doc) {
    const d = doc || activeTab;
    if (!d) return false;
    const t = d.input.value;
    if (isTauri()) {
      // Static imports — always loaded, no runtime chunk fetch.
      try {
        // Known location: write straight back to that file.
        if (d.path) {
          await tauriWriteTextFile(d.path, t);
          d.dirty = false; syncDom(d); updateStatus(d); saveSession();
          return true;
        }
        // No location known: ask where to store it, then write.
        const { path: p, name } = await pickPath({
          mode: "save",
          defaultFilename: /\.md$/i.test(d.name) ? d.name : (d.name || "untitled") + ".md",
          filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
        });
        if (!p) {
          // User cancelled the in-app Save-As picker. No extra prompt — the cancel
          // already communicates it; just leave the tab dirty and stay put.
          return false;
        }
        await tauriWriteTextFile(p, t);
        d.name = name || d.name; d.path = p; d.dirty = false;
        syncDom(d); updateStatus(d); saveSession();
        return true;
      } catch (e) {
        const msg = "Tauri save failed: " + ((e && (e.message || e)) || "unknown error");
        await messageModal({
          title: "Save failed",
          message: msg,
          buttons: [{ label: "OK", kind: "primary", value: "ok" }],
          kind: "error",
        });
        return false;
      }
    }
    // Browser → download (the only path that works in a normal webview fallback).
    const el = document.createElement("a");
    el.href = URL.createObjectURL(new Blob([t], { type: "text/markdown" }));
    el.download = /\.md$/i.test(d.name) ? d.name : d.name + ".md";
    el.click();
    d.dirty = false;
    updateStatus(d); renderTabs();
    return true;
  }

  // Always open in a NEW tab and switch to it — never replace the current tab,
  // even if a tab with the same name or path is already open.
  function openFile({ name, text, path }) {
    const doc = makeTab(name, text);
    doc.path = path || null;
    openAtTop(doc);
    activate(doc);
    saveSession();
    return doc;
  }

  async function open() {
    if (isTauri()) {
      // In-app picker — centered over the app (see save() for the why).
      const { path } = await pickPath({
        mode: "open",
        filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
      });
      if (!path) return; // cancelled
      try {
        const txt = await tauriReadTextFile(path);
        const base = String(path).replace(/[\\/]+/g, "/").split("/").pop() || "file.md";
        openFile({ name: base, text: txt, path });
        return;
      } catch (e) {
        await messageModal({
          title: "Open failed",
          message: "Could not open “" + path + "”: " + ((e && (e.message || e)) || "unknown error"),
          buttons: [{ label: "OK", kind: "primary", value: "ok" }],
          kind: "error",
        });
        return;
      }
    }
    const fi = document.createElement("input");
    fi.type = "file"; fi.accept = ".md,.markdown,.txt,.mdx,text/markdown,text/plain";
    fi.multiple = true;
    fi.onchange = () => {
      for (const f of Array.from(fi.files || [])) {
        const r = new FileReader();
        r.onload = () => openFile({ name: f.name, text: r.result });
        r.readAsText(f);
      }
    };
    fi.click();
  }

  /* ---- drag & drop (markdown files) ---- */
  const drag = { over: false, depth: 0 };
  workspace.addEventListener("dragenter", (ev) => {
    ev.preventDefault();
    const types = ev.dataTransfer && Array.from(ev.dataTransfer.types || []);
    if (!types.includes("Files")) return;
    drag.depth += 1; drag.over = true;
    workspace.classList.add("dropping");
  });
  workspace.addEventListener("dragleave", (ev) => {
    ev.preventDefault();
    drag.depth = Math.max(0, drag.depth - 1);
    if (drag.depth === 0) { drag.over = false; workspace.classList.remove("dropping"); }
  });
  workspace.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
  });
  workspace.addEventListener("drop", async (ev) => {
    ev.preventDefault();
    drag.depth = 0; drag.over = false; workspace.classList.remove("dropping");
    const files = ev.dataTransfer && ev.dataTransfer.files;
    if (!files || !files.length) return;
    for (const f of Array.from(files)) {
      if (!/\.(md|markdown|mdx|txt)$/i.test(f.name || "") && f.type !== "text/markdown" && f.type !== "text/plain") continue;
      let path = null, text;
      if (isTauri()) {
        try {
          path = f.path || (f[0] && f[0].path) || null;
       if (path) text = await tauriReadTextFile(path);
        } catch { /* ignore */ }
      }
      if (text === undefined && f.text) { try { text = await f.text(); } catch { continue; } }
      openFile({ name: f.name || "dropped", text, path });
    }
  });

  /* ---- key bindings ---- */
  // Global Ctrl/Meta shortcuts are bound on window (not the textarea) so they
  // fire no matter which element holds focus. WebKitGTK lets focus slip off the
  // overlay textarea, which used to make these dead when focus was elsewhere.
  async function onGlobalKeyDown(ev) {
    const mod = ev.ctrlKey || ev.metaKey;
    if (!mod) return;
    const k = (ev.key || "").toLowerCase();

    if (k === "z" && !ev.shiftKey) { ev.preventDefault(); undo(); return; }
    if (k === "y" && !ev.shiftKey) { ev.preventDefault(); redo(); return; }
    if (k === "z" && ev.shiftKey) { ev.preventDefault(); redo(); return; }
    if (ev.key === "ArrowLeft") { ev.preventDefault(); undo(); return; }
    if (ev.key === "ArrowRight") { ev.preventDefault(); redo(); return; }

    if (k === "b" && !ev.shiftKey) { ev.preventDefault(); toggleFormat("bold"); return; }
    if (k === "i" && !ev.shiftKey) { ev.preventDefault(); toggleFormat("italic"); return; }
    if (k === "u" && !ev.shiftKey) { ev.preventDefault(); toggleFormat("underline"); return; }
    if (k === "s" && !ev.shiftKey) { ev.preventDefault(); await save(); return; }
    if (k === "k" && !ev.shiftKey) { ev.preventDefault(); toggleFormat("link"); return; }
    if (k === "o" && !ev.shiftKey) { ev.preventDefault(); await open(); return; }
    if (k === "w" && !ev.shiftKey) { ev.preventDefault(); if (activeTab) await closeTab(activeTab); return; }
    if (k === "t" && !ev.shiftKey) { ev.preventDefault(); newTab("Untitled", ""); return; }
  }
  window.addEventListener("keydown", onGlobalKeyDown);

  // Toolbar active-states must track the caret the INSTANT it moves — on a real
  // click, arrow/Home/End, paste, undo, etc. — and reflect the formatting at the
  // caret WITHOUT requiring the text to change. The per-textarea "select"/"keyup"/
  // "mouseup" catches are each individually unreliable on WebKitGTK (the select
  // event often never fires there), so the one signal that covers every caret
  // move regardless of *how* it moved is the document-level selectionchange
  // event (fired for all text-inputs, selection, caret moves, programmatic
  // setSelectionRange). We route it to the active tab only, per-frame, so it
  // stays cheap even when a dialog steals focus.
  document.addEventListener("selectionchange", () => {
    const d = activeTab;
    if (!d) return;
    // updateActiveStates reads ONLY d.input.selectionStart (the active textarea's
    // caret), so this is always correct: the buttons reflect the caret of the
    // active editor, whether the caret moved by click, arrow, paste, undo, tab
    // switch, or programmatic setSelectionRange — and it fires with NO text
    // change. Route per-frame to a single queued tick to stay cheap.
    scheduleButtonUpdate(d);
  });
  function scheduleButtonUpdate(d) {
    if (d.__btnRaf) return;
    d.__btnRaf = requestAnimationFrame(() => {
      d.__btnRaf = 0;
      if (d !== activeTab) return; // a newer tab was activated meanwhile
      updateStatus(d);
      updateActiveStates();
      setUndoRedoState();
    });
  }

  // Editor-local bindings (only meaningful inside the source textarea).
  async function onKeyDown(ev) {
    const mod = ev.ctrlKey || ev.metaKey;

    if (ev.key === "Tab" && !mod) {
      ev.preventDefault();
      indentLines(ev.shiftKey ? -1 : 1);
      return;
    }

    if (ev.key === "Enter" && !mod) {
      const d = activeTab, input = d.input, text = d.input.value;
      const a = input.selectionStart;
      if (a === input.selectionEnd) {
        const before = text.slice(0, a);
        const lineStart = before.lastIndexOf("\n") + 1;
        const line = before.slice(lineStart);
        const lm = line.match(/^\s*(#{1,4}\s|>\s?|[-*+]\s+|\d+\.\s+)/);
        if (lm) {
          const rest = line.slice(lm[0].length);
          if (rest.trim() === "") {
            // empty list/quote item → exit
            ev.preventDefault();
            const to = text.slice(0, lineStart) + text.slice(a);
            commit("finish list/quote", to, lineStart, lineStart);
            return;
          }
          ev.preventDefault();
          const marker = lm[1];
          let newMarker = marker;
          if (/^\d+\.\s+$/.test(marker)) newMarker = (parseInt(marker.match(/^(\d+)\./)[1], 10) + 1) + ". ";
          else if (/^[-*+]\s+$/.test(marker) && marker[0] === "*") newMarker = marker;
          const insert = "\n" + newMarker;
          const to = text.slice(0, a) + insert + text.slice(input.selectionEnd);
          const pos = a + insert.length;
          commit("continue list/quote", to, pos, pos);
          return;
        }
      }
    }
  }

  /* ---- toolbar actions ---- */
  function setFmtActive(name, on) { const b = toolbar.querySelector(`[data-fmt="${name}"]`); if (b) b.classList.toggle("active", on); }
  function setBlockActive(name, on) { const b = toolbar.querySelector(`[data-block="${name}"]`); if (b) b.classList.toggle("active", on); }

  function updateActiveStates() {
    const d = activeTab;
    if (!d) return;
    const text = d.input.value, a = d.input.selectionStart;
    const [ls, le] = lineBounds(text, a);
    const line = text.slice(ls, le);
    const [ws, we] = wordAt(line, a - ls);
    const det = detectFormat(line, ws, we);
    setFmtActive("bold", !!(det && det.fmt === "bold"));
    setFmtActive("italic", !!(det && det.fmt === "italic"));
    setFmtActive("underline", !!(det && det.fmt === "underline"));
    setFmtActive("strike", !!(det && det.fmt === "strike"));
    setFmtActive("code", !!(det && det.fmt === "code"));
    setFmtActive("link", !!(det && det.fmt === "link"));
    const hm = line.match(/^\s*(#{1,4})\s/);
    setBlockActive("h1", !!hm && hm[1].length === 1);
    setBlockActive("h2", !!hm && hm[1].length === 2);
    setBlockActive("h3", !!hm && hm[1].length === 3);
    setBlockActive("quote", /^\s*>/.test(line));
    setBlockActive("ul", /^\s*[-*+]\s+/.test(line));
    setBlockActive("ol", /^\s*\d+\.\s+/.test(line));
    const lines = text.split("\n");
    const cur = ls;
    const onTbl = (lines[cur] || "").includes("|") && isTableSep(lines[cur + 1] || "");
    setBlockActive("table", onTbl);
  }

  let sessionTimer = 0;
  function saveSessionSoon() {
    if (sessionTimer) return;
    sessionTimer = setTimeout(() => { sessionTimer = 0; saveSession(); }, 250);
  }
  function saveSession() {
    try {
      const data = {
        v: 2,
        activeTab: activeTab ? activeTab.id : null,
        tabs: TABS.map((d) => ({ id: d.id, name: d.name, text: d.input.value, dirty: d.dirty, path: d.path })),
      };
      const s = JSON.stringify(data);
      if (s.length > 2 * 1024 * 1024) return;
      localStorage.setItem(LS_KEY, s);
    } catch { /* ignore */ }
  }
  function loadSession() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d || d.v !== 2) return null;
      return d;
    } catch { return null; }
  }

  /* ---- Tauri window close confirm ----
    * Close-requested contract (see @tauri-apps/api window.js onCloseRequested):
    * the wrapper does  `await handler(evt); if (!evt.isPreventDefault())
    * await this.destroy();`  i.e. it AUTO-CLOSES the window unless we call
    * preventDefault(). So the ONLY correct way to actually close is to let the
    * handler return WITHOUT preventDefault. The old code called preventDefault()
    * unconditionally AND win.close(); close() re-emits close-requested, the
    * wrapper re-fired our handler (again preventDefault → never destroyed),
    * deadlocking the window open.
    *   - user cancels  → preventDefault()  → wrapper skips destroy → window stays
    *   - walk succeeds → do NOT preventDefault → wrapper calls destroy()
    *   - 2nd request while a dialog is open (re-entry) → preventDefault + ignore
    *
    * Registered SYNCHRONOUSLY using the statically-imported getCurrentWindow —
    * NOT after a dynamic import(). A dynamic import that failed to load its
    * chunk silently skipped this registration, letting the window close with
    * unsaved data. If registration itself throws we fall back to a plain
    * document-level guard so we never close silently. */
  if (isTauri()) {
    let win = null;
    try { win = getCurrentWindow(); } catch { win = null; }
    if (win) {
      let closing = false; // re-entry guard for a second close request mid-walk
      win.onCloseRequested(async (event) => {
        if (closing) { event.preventDefault(); return; } // dialog already open — hold
        closing = true;
        let ok = true;
        try { ok = await closeApp(); } catch { ok = false; }
        if (!ok) {
          // cancelled / error → preventDefault → wrapper skips destroy → window stays.
          event.preventDefault();
        }
        // ok === true: do NOT preventDefault → the wrapper runs destroy() and the
        // window actually closes. (win.close() would re-emit the event and the
        // wrapper would re-fire us, preventDefault-ing again → destroy never runs.)
        closing = false;
      }).catch((e) => {
        // Registration failed (IPC not ready). Fall back to a document guard so a
        // stray close can't dump unsaved work.
        window.addEventListener("beforeunload", (ev) => {
          if (TABS.some((d) => d.dirty)) { ev.preventDefault(); ev.returnValue = ""; }
        });
      });
    }
  }
  window.addEventListener("beforeunload", (ev) => {
    if (TABS.some((d) => d.dirty)) { ev.preventDefault(); ev.returnValue = ""; }
    saveSession();
  });

  /* ---- toolbar click ---- */
  toolbar.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button"); if (!btn) return;
    const fmt = btn.getAttribute("data-fmt");
    const block = btn.getAttribute("data-block");
    const action = btn.getAttribute("data-action");
    if (fmt) toggleFormat(fmt);
    else if (block) toggleBlock(block);
    else if (action) {
      if (action === "save") save();
      else if (action === "open") open();
      else if (action === "undo") undo();
      else if (action === "redo") redo();
      else if (action === "newtab") newTab("Untitled", "");
      else if (action === "mode") { const o = ["split", "edit", "preview"]; setMode(o[(o.indexOf(app.dataset.mode) + 1) % 3]); }
      else if (action === "theme") { const dark = document.documentElement.dataset.theme === "dark"; document.documentElement.dataset.theme = dark ? "" : "dark"; }
    }
    if (activeTab) activeTab.input.focus();
  });

  /* ---- ctrl+click anywhere in window → new tab (except when a .md is being dragged) ---- */
  app.addEventListener("click", (ev) => {
    if (!ev.ctrlKey && !ev.metaKey) return;
    if (ev.target.closest("a, button, input, textarea, .tab .tname")) return;
    ev.preventDefault();
    newTab("Untitled", "");
  }, true);

  /* ---- init ---- */
  const session = loadSession();
  let started = false;
  if (session && Array.isArray(session.tabs) && session.tabs.length) {
    let activeId = session.activeTab;
    for (const t of session.tabs) {
      const doc = makeTab(t.name || "Untitled", typeof t.text === "string" ? t.text : "");
      doc.id = t.id || doc.id;
      doc.path = t.path || null;
      doc.dirty = !!t.dirty;
      if (t.id === activeId) activeTab = doc;
    }
    if (!activeTab) activeTab = TABS[0];
    // Ensure a restored long doc opens at the top (Webkit auto-scrolls the
    // focused textarea to the caret, which sits at the end = bottom).
    openAtTop(activeTab);
    activate(activeTab);
    started = true;
  }
  if (!started) {
    const doc = makeTab("Untitled", "");
    openAtTop(doc);
    activate(doc);
    saveSession();
  }
  refresh();
  saveSession();

  return {
    get tabs() { return TABS; },
    get active() { return activeTab; },
    get activeTab() { return activeTab; },
    get toolbar() { return toolbar; },
    get tabBar() { return tabBar; },
    get workspace() { return workspace; },
    get documentText() { return activeTab ? activeTab.input.value : ""; },
    set documentText(v) { if (activeTab) { suppressInput = true; activeTab.input.value = v; activeTab._typeBase = v; activeTab._lastVal = v; suppressInput = false; activeTab.dirty = false; refresh(); } },
    get name() { return activeTab ? activeTab.name : ""; },
    set name(v) { if (activeTab) { activeTab.name = v || "untitled"; syncDom(activeTab); } },
    getDocumentText: () => (activeTab ? activeTab.input.value : ""),
    setDocumentText: (t) => { if (!activeTab) return; suppressInput = true; activeTab.input.value = t; activeTab._typeBase = t; activeTab._lastVal = t; suppressInput = false; activeTab.dirty = false; refresh(); },
    refresh, scheduleRefresh,
    newTab, closeTab, closeApp, activate,
    save, open,
    openFile,
    toggleFormat, toggleBlock,
    undo, redo, indentLines,
    openAtCaret,
    mdFromHtml, mdTableFromHtml, mdCellText, mdInlineMd, mdStyleOf,
  };
}
