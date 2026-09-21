/**
 * render.js — pure inline/block Markdown → highlight-span renderer.
 *
 * Produces the overlay HTML under the editor textarea: markers, code runs,
 * list bullets, table cells, etc. are wrapped in `<span>` tags so they can be
 * coloured, while the plain-text runs stay untouched so the invisible caret
 * stays aligned under the overlay.
 *
 * Invariant (enforced by test/test.mjs): stripping every `<span>` out of the
 * produced HTML must reproduce the exact source, character-for-character.
 */

/**
 * esc — escape HTML-special characters (& < >) for safe embedding.
 * @param {string} s — the raw text to escape.
 * @returns {string} the escaped text.
 */
export const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

/**
 * matchTok — match a single inline Markdown token at position `i`.
 *
 * Detects the start of an inline construct (`code`, `**bold**`, `*italic*`,
 * `__bold__`, `_italic_`, `~~strike~~`, `<u>…</u>`, `[text](url)`) and returns
 * a `{len, html}` where `html` wraps the markers in `.mark` spans and the body
 * in a style span. `html` must be a lossless span-wrap of the source so the
 * round-trip invariant holds (stripping spans gives back the token).
 *
 * @param {string} t — the full text (a token slice starting at the cursor); we
 *   only ever read from index `i` forward.
 * @param {number} i — the position to inspect for a token start.
 * @returns {{len:number, html:string}|null} the match, or null if no token
 *   starts here (caller falls through to plain-text output).
 */
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
      // The closing tag must be SEARCHED for, not anchored to the body start:
      // an anchored /^<\/u>/ only matches `<u></u>` (empty inner) and silently
      // fell through to plain text for every real `<u>text</u>` token.
      const closeIdx = body.search(/<\/u>/i);
      if (closeIdx > -1) {
        const inner = body.slice(0, closeIdx);
        return {
          len: open[0].length + inner.length + 4,
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

/**
 * isTableSep — decide whether a line is a GFM table separator row.
 *
 * A separator row looks like `:---:`, `---`, `---:`, `:---` (any cell), one or
 * more of them joined by `|`, with only `-`, `:`, `|`, and whitespace elsewhere.
 *
 * @param {string} l — the line to test.
 * @returns {boolean} true if `l` is a valid table separator row.
 */
export function isTableSep(l) {
  if (!l || l.length < 3 || !l.includes("-") || !l.includes("|")) return false;
  if (/[^\s|:|-]/.test(l)) return false;
  const cells = l.trim().replace(/^\||\|$/g, "").split("|");
  return cells.every((c) => /^:?-+:?$/.test(c.trim()));
}

/**
 * renderInline — emit highlight-span HTML for one line of inline text.
 *
 * Walks `t` left-to-right, emitting a `matchTok` span for each inline token and
 * `esc`-escaped plain text for everything else so the round-trip invariant
 * survives. Pipe characters are wrapped in `.mark` when inside a table cell so
 * the cell delimiter is visible but the source text is unchanged.
 *
 * @param {string} t — the inline text (already split out of its block).
 * @param {boolean} [cell=false] — true when `t` is a table cell, so `|` is
 *   marked as a delimiter rather than a literal.
 * @returns {string} the highlight-span HTML for the line's inline content.
 */
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

/**
 * computeBlocks — classify every line of a document into a block type.
 *
 * Walks the lines in order, tracking fenced-code state, and tags each index
 * with one of: `code`, `h1`–`h4`, `hr`, `quote`, `ul`, `ol`. A second pass
 * detects GFM tables: a header row followed by a separator row becomes
 * `th`/`tsep`, and each contiguous `|`-cell row that follows becomes `td`.
 *
 * @param {string[]} lines — the document split on newlines.
 * @returns {(string|null)[]} a same-length array; `cls[i]` is the block class
 *   for line `i`, or null for a plain paragraph line.
 */
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

/**
 * lineToHtml — render one line (given its block class) to highlight HTML.
 *
 * Splits the line into a leading block marker (heading `#`, quote `>`, list
 * bullet, ol number) and the inline content. The marker is wrapped in a
 * `.mark` span, the content is run through `renderInline` (with table-cell
 * pipe marking when `bc` is a table row class), and the whole thing is
 * wrapped in the block's style span (`h1`…`h4`, `quote`, `th`/`td`, etc.).
 * Code and hr lines are fully wrapped in their style span.
 *
 * @param {string} line — the source line (single line, no newlines).
 * @param {string|null} bc — the block class for this line from
 *   `computeBlocks`, or null for a plain paragraph line.
 * @returns {string} the highlight-span HTML for the line.
 */
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

/**
 * highlightToHtml — the main entry: full Markdown text → overlay HTML.
 *
 * Splits `text` on newlines, classifies each line with `computeBlocks`,
 * renders each line with `lineToHtml`, and joins them back with newlines in
 * the same order. Stripping every `<span>` from the result reproduces `text`
 * exactly (round-trip invariant, enforced by test/test.mjs).
 *
 * @param {string} text — the full Markdown source.
 * @returns {string} the overlay HTML (the text re-wrapped in `.mark`/style
 *   spans, with newlines preserved).
 */
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
