/**
 * paste.js — rich-paste conversion (HTML clipboard → Markdown).
 *
 * Pure DOM/string helpers (`DOMParser` runs against a detached doc; safe in
 * the browser, the Tauri webview, and Node with stubs). Goal: when the user
 * Ctrl+V's rich content (Excel table, Word bolded paragraph, web snippet)
 * into the editor, the `text/html` clipboard payload is converted to a
 * readable Markdown representation and committed as a single, undo-able
 * edit. If there is no recognised HTML, the caller falls through to the
 * browser's default paste (plain text still works).
 *
 * Cell text: whitespace is normalised (tabs, newlines → space) so the output
 * fits on one line. Cells that carry `**` / `*` / `<u>` markers keep them so
 * the preview renders them.
 */

/* ================= Rich-paste conversion (HTML clipboard → Markdown) ================= */

/**
 * mdCellText — collapse one table cell into Markdown, preserving bold /
 * italic / underline flags carried anywhere in the cell subtree.
 *
 * Whitespace is normalised (tabs, newlines, multiple spaces → single space)
 * so the result fits on one line. Pipe characters are escaped so they
 * cannot be misread as table-cell separators in the GFM row.
 *
 * @param {Node} node — a `<td>` / `<th>` cell to walk.
 * @returns {string} the Markdown for the cell (may include `**bold**`,
 *   `*italic*`, `<u>…</u>` runs), or `""` when the cell has no visible text.
 */
function mdCellText(node) {
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

/**
 * mdTableFromHtml — convert the first `<table>` under `root` to a GFM table.
 *
 * Builds the same GFM layout the in-app "table" toolbar button produces,
 * except with the real cell contents in it. Rows shorter than the widest row
 * are padded with empty cells. The first `<tr>` becomes the header row, the
 * separator line, then the body rows.
 *
 * @param {Element} root — the `<table>` to convert, or any ancestor that
 *   contains one.
 * @returns {string|null} the GFM table, or `null` when there is no `<table>`
 *   or the table has no usable rows.
 */
function mdTableFromHtml(root) {
  const tbl = root.tagName === "TABLE" ? root : root.querySelector("table");
  if (!tbl) return null;
  // Cells that span multiple <tr> via rowspan are treated as one cell per
  // <tr> per column (no multi-row merging); each <td>/<th> is one column.
  const rows = [];
  const trs = tbl.querySelectorAll("tr");
  trs.forEach((tr) => {
    const cells = [];
    tr.querySelectorAll("td, th").forEach((c) => cells.push(mdCellText(c)));
    if (cells.length) rows.push(cells);
  });
  if (!rows.length) return null;
  /** Widest row length, in cells. */
  const cols = Math.max(...rows.map((r) => r.length));
  /** Rows padded with empty cells to a uniform `cols` width. */
  const grid = rows.map((r) => r.concat(new Array(cols - r.length).fill("")));
  /** One row of cells → a GFM `| a | b |` table line. */
  const line = (r) => `| ` + r.map((c) => (c === "" ? " " : c)).join(" | ") + ` |`;
  const sepLine = `| ` + new Array(cols).fill("------").join(" | ") + ` |`;
  const body = grid.slice(1).map(line).join("\n");
  return line(grid[0]) + "\n" + sepLine + (body ? "\n" + body : "");
}

/**
 * mdStyleOf — inherited bold / italic / underline style for a text node.
 *
 * Walks up the ancestor chain (the node's parentElement and every parent
 * above it) and reports the union of the flags carried by any ancestor —
 * via both the tag name (`<b>`, `<i>`, `<u>`) and the `style` attribute
 * (font-weight, font-style, text-decoration:underline). This mirrors the
 * detection `mdCellText` uses for cell content.
 *
 * @param {Node} node — a text node (or element, but typically a text node
 *   walked out of `mdInlineMd`).
 * @returns {{b:boolean, i:boolean, u:boolean}} the union of the ancestor style flags.
 */
function mdStyleOf(node) {
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

/**
 * mdInlineMd — flatten an inline DOM subtree into Markdown, preserving
 * bold / italic / underline.
 *
 * Walks the subtree in document order collecting each text node and its
 * ancestor style. Adjacent runs with identical style are merged so the
 * markers wrap each *run* once (e.g. "plain **bold** after"). A node whose
 * subtree contains a `<table>` is skipped here — tables are handled by
 * `mdFromHtml` / `mdTableFromHtml` instead.
 *
 * @param {Element} root — the inline subtree to walk.
 * @returns {string|null} a Markdown line, or `null` when there is no visible text.
 */
function mdInlineMd(root) {
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
  /** Each text run re-wrapped in its `<u>` / `*` / `**` markers, in order. */
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

/**
 * mdFromHtml — best-effort conversion of a clipboard HTML blob to Markdown.
 *
 * Returns a Markdown string on success, or `null` when there is nothing
 * recognisable (in which case the caller falls back to the browser's default
 * paste and leaves the tab untouched).
 *
 * Rules of thumb:
 *   - any `<table>` element (direct child of body, or nested one level deep)
 *     → a GFM table block (`mdTableFromHtml`);
 *   - the rest (top-level inline content) → one line with bold / italic /
 *     underline preserved per the in-editor style (`mdInlineMd`).
 *
 * Mixed content (e.g. "intro **bold** body then a table") is legal Markdown:
 * a paragraph followed by a table, blank-line between.
 *
 * @param {string} html — the raw `text/html` clipboard payload.
 * @returns {string|null} the Markdown conversion, or `null`.
 */
function mdFromHtml(html) {
  if (!html || !/</.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blocks = [];
  const seen = new Set();
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

export { mdCellText, mdTableFromHtml, mdStyleOf, mdInlineMd, mdFromHtml };
