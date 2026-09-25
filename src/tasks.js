/**
 * tasks.js — GFM task lists: live checkboxes in the preview, wired back to
 * the Markdown source.
 *
 * marked already renders `- [ ]` / `- [x]` / `1. [X]` (any list depth, inside
 * blockquotes too) as `<input disabled="" type="checkbox">`. This module makes
 * them INTERACTIVE in the live preview only:
 *
 *  - `enhancePreviewTasks(html, md)` re-enables each checkbox and stamps
 *    `data-task="N"` (N = document order) — but ONLY when the ordinal map
 *    `scanTaskItems(md)` agrees with the number of checkboxes in the HTML.
 *    On any disagreement (or a mapping failure) the HTML is returned
 *    UNCHANGED — disabled checkboxes stay inert, so a document the mapper
 *    cannot align can never have a click flip the WRONG source line.
 *  - `toggleTaskAt(md, ordinal, checked)` maps an ordinal to its source line
 *    and flips the `[ ]`/`[x]` state char in place. markdown.js commits that
 *    as ONE undo-able edit; the re-render then rebuilds the checkbox from the
 *    source, so the source stays the single source of truth.
 *
 * WHY the ordinal map goes through `marked.lexer` instead of a hand-rolled
 * source scan: CommonMark decides "is this line a task item?" with the full
 * block parser (nested lists at 4+ spaces, blockquote prefixes, ordered
 * markers…). Any hand-rolled scanner eventually disagrees with marked's
 * rendering — and disagreement is exactly the silent wrong-line-toggle bug.
 * Lexing the same document with the same parser makes the two agree by
 * construction; the residual risk (an item's `raw` not found verbatim, or a
 * matched position that is not at a task line start — e.g. the item's own
 * continuation prose quoting a sibling task) is handled by a strict
 * line-start verification plus the safe "stay inert" fallback above.
 *
 * Exports (HTML/PDF) intentionally do NOT call enhance: they render through
 * `renderMarkdown` alone, so exported files keep marked's inert disabled
 * checkboxes — a static document, not a broken form.
 *
 * Node-importable (test/test.mjs loads it through src/markdown.js): no DOM,
 * no asset imports. Run its regression with `npm run verify-tasks`
 * (test/verifyTasks.mjs) and `npm test` (round-trip + scanner cases).
 */
import { marked } from "marked";

/** TASK_INPUT_SRC — marked's task-checkbox markup. Attribute order is stable
 *  (checked first when set, then disabled, then type), so a single exact
 *  pattern matches every task checkbox and nothing else. */
const TASK_INPUT_SRC = '<input (checked="" )?disabled="" type="checkbox">';

/** TASK_LINE_RE — a source line whose first content is a (possibly
 *  blockquote-prefixed) list marker + a GFM checkbox (`[ ]`, `[x]`, `[X]`)
 *  followed by whitespace or end-of-line. Used ONLY to verify that a located
 *  item `raw` starts on a real task line (rejecting matches that land inside
 *  an item's continuation prose). The blockquote prefix chain mirrors what
 *  marked lexes as a task item (`> - [ ] d`). */
const TASK_LINE_RE = /^(?:[ \t]*>[ \t]?)*[ \t]*(?:[-*+]|\d{1,9}\.)\s+\[[xX ]\](?:\s|$)/;

/**
 * lineStarts — index every line-start offset of `md` (ascending).
 * @param {string} md — the document text.
 * @returns {number[]} Ascending offsets; `lineStarts[0]` is 0.
 */
function lineStarts(md) {
  const out = [0];
  for (let at = md.indexOf("\n"); at !== -1; at = md.indexOf("\n", at + 1)) out.push(at + 1);
  return out;
}

/**
 * lineOf — the 0-based line index containing char offset `at` (binary search).
 * @param {number[]} starts — from `lineStarts`.
 * @param {number} at — a char offset.
 * @returns {number} The line index.
 */
function lineOf(starts, at) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= at) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * isTaskLineAt — does the line containing offset `at` START with a list
 * marker + checkbox? Guards the `raw`-indexOf mapping against matches that
 * land inside an item's own continuation prose (e.g. `- [ ] a` followed by a
 * continuation line that mentions `"- [ ] a"` mid-sentence — the raw of the
 * NEXT item must not map to that prose line).
 * @param {string} md — the document text.
 * @param {number} at — candidate start offset of a task item's raw.
 * @returns {boolean} True when the containing line is a task-item line.
 */
function isTaskLineAt(md, at) {
  const ls = md.lastIndexOf("\n", at - 1) + 1;
  let eol = md.indexOf("\n", ls);
  if (eol === -1) eol = md.length;
  return TASK_LINE_RE.test(md.slice(ls, eol));
}

/**
 * collectTaskItems — walk marked's token tree, gathering every task item in
 * document order. Lists contribute `.items`, blockquotes/paragraphs/list
 * items contribute `.tokens`; recursing through both covers nested lists and
 * quoted lists in document order.
 * @param {Array<object>} tokens — marked token tree (a level of the walk).
 * @param {Array<{raw: string, checked: boolean}>} [acc] — collector.
 * @returns {Array<{raw: string, checked: boolean}>} Task items in document order.
 */
function collectTaskItems(tokens, acc = []) {
  for (const tk of tokens) {
    if (tk.type === "list_item" && tk.task) acc.push({ raw: String(tk.raw || ""), checked: !!tk.checked });
    if (Array.isArray(tk.items)) collectTaskItems(tk.items, acc);
    if (Array.isArray(tk.tokens)) collectTaskItems(tk.tokens, acc);
  }
  return acc;
}

/**
 * scanTaskItems — the source line (0-based) + current checked state of every
 * GFM task item, in document order. This is the ordinal→line bridge between
 * the rendered checkboxes and the source text.
 * @param {string} md — the document text.
 * @returns {Array<{line: number, checked: boolean}>|null} The task items, or
 *   null when the mapping failed (callers must then stay inert — never guess).
 */
export function scanTaskItems(md) {
  let items;
  try { items = collectTaskItems(marked.lexer(md)); } catch { return null; }
  if (!items.length) return [];
  const starts = lineStarts(md);
  const out = [];
  let cursor = 0;
  for (const it of items) {
    if (!it.raw) return null;
    // Locate the item's raw source from the running cursor (document order
    // means every later item starts after the previous one's first line).
    let at = md.indexOf(it.raw, cursor);
    while (at !== -1 && !isTaskLineAt(md, at)) at = md.indexOf(it.raw, at + 1);
    if (at === -1) return null; // raw not found verbatim → desync, stay inert
    out.push({ line: lineOf(starts, at), checked: it.checked });
    cursor = at + 1;
  }
  return out;
}

/**
 * enhancePreviewTasks — make the preview's task checkboxes live.
 *
 * Returns `html` unchanged (inert `disabled` checkboxes) unless: the HTML
 * contains marked's task-checkbox markup AND `scanTaskItems` maps exactly
 * that many items. Each re-enabled checkbox carries `data-task="N"` (its
 * document-order index) so a delegated click listener can ask
 * `toggleTaskAt` for the source line to flip.
 * @param {string} html — the rendered preview HTML (from `renderMarkdown`).
 * @param {string} md — the document source the HTML was rendered from.
 * @returns {string} The enhanced HTML, or the input unchanged when inert.
 */
export function enhancePreviewTasks(html, md) {
  const re = new RegExp(TASK_INPUT_SRC, "g");
  const count = (html.match(re) || []).length;
  if (!count) return html;
  const items = scanTaskItems(md);
  if (!items || items.length !== count) return html; // desync → stay inert
  let n = 0;
  return html.replace(new RegExp(TASK_INPUT_SRC, "g"), (m, checked) =>
    `<input ${checked ? 'checked="" ' : ""}data-task="${n++}" type="checkbox">`
  );
}

/**
 * toggleTaskAt — flip the state char of task item `ordinal` in the source.
 *
 * Re-scans the document (the ordinal→line map must reflect the CURRENT
 * source), then splices `[x]`/`[X]`→`[ ]` or `[ ]`→`[x]` on that line.
 * @param {string} md — the document text.
 * @param {number} ordinal — the `data-task` index of the clicked checkbox.
 * @param {boolean} checked — the checkbox's post-click state (the new truth).
 * @returns {{text: string, caret: number}|null} The new document text and a
 *   collapsed caret just inside the flipped brackets — or null when the
 *   mapping or the line splice fails (caller does nothing).
 */
export function toggleTaskAt(md, ordinal, checked) {
  const items = scanTaskItems(md);
  if (!items || ordinal < 0 || ordinal >= items.length) return null;
  const starts = lineStarts(md);
  const lineNo = items[ordinal].line;
  const ls = starts[lineNo];
  let eol = md.indexOf("\n", ls);
  if (eol === -1) eol = md.length;
  const line = md.slice(ls, eol);
  const m = line.match(/^((?:[ \t]*>[ \t]?)*\s*(?:[-*+]|\d{1,9}\.)\s+\[)([xX ])(\])/);
  if (!m) return null; // the mapped line no longer carries a checkbox → inert
  const caret = ls + m[1].length;
  const nextLine = line.slice(0, m[1].length) + (checked ? "x" : " ") + line.slice(m[1].length + 1);
  return { text: md.slice(0, ls) + nextLine + md.slice(eol), caret };
}
