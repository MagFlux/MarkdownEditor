/* Selection + format-detection helpers — pure string functions (no DOM, no Tauri,
   no libraries): extracted verbatim from the old monolithic src/markdown.js so it
   can shrink to just the createApp closure. Behaviour must stay byte-identical:
   the round-trip invariant and the verifyToolbar / verify paste suites depend on
   the exact span bounds (fs/fe) returned here. */
/**
 * format.js — pure selection + format-detection helpers.
 *
 * Zero dependencies, zero DOM, zero Tauri: just string math. These fns power
 * the toolbar's bold / italic / strike / code / underline / link toggles: they
 * find the word/token under the caret, detect whether it already has a
 * markdown format, and compute the exact span to wrap or unwrap. `wordJump`
 * additionally powers the Markdown-aware Ctrl+Arrow word-wise caret move
 * (a whole formatted span counts as one word, markers included).
 * * Invariant: `detectFormat` returns the trimmed span bounds (`fs`/`fe`) that
 * `toggleFormat` splices on — byte-for-byte — so trailing sentence
 * punctuation survives a format toggle.
 */

/* ================= Selection helpers ================= */

/**
 * FORMATTED_PATTERNS — the inline-format span regexes (bold, italic, strike,
 * code, underline, link). Shared by `wordAt` (format detection) and `wordJump`
 * (Markdown-aware Ctrl+Arrow movement) so both agree on what "one formatted
 * word" is.
 */
const FORMATTED_PATTERNS = [
  /`[^`]+`/,
  /\*\*(?:[^*]|\*(?!\*))+\*\*/,
  /__(?:[^_]|_(?!_))+__/,
  /~~(?:[^~]|~(?!~))+~~/,
  /<u>[\s\S]+?<\/u>/,
  /\[[^\]]*\]\([^)]*\)/,
  /(?<!\*)\*(?!\*)[^*\s](?:[^*]*?[^*\s])?\*(?!\*)/,
  /(?<!_)_(?!_)[^_\s](?:[^_]*?[^_\s])?_(?!_)/,
];

/**
 * lineBounds — find the bounds of the line containing `pos`.
 *
 * @param {string} text — the full document text.
 * @param {number} pos — a character offset (caret position).
 * @returns {[number, number]} `[start, end)` of the line.
 */
function lineBounds(text, pos) {
  const s = text.lastIndexOf("\n", pos - 1) + 1;
  let e = text.indexOf("\n", pos);
  if (e === -1) e = text.length;
  return [s, e];
}
/**
 * W — predicate: is `ch` a "word" character (non-whitespace, non-empty)?
 */
function W(ch) { return ch !== undefined && ch !== "" && !/\s/.test(ch); }

/**
 * wordAt — return the formatted span or word/token bounds around offset `off`.
 *
 * Formatted spans are returned whole so spaces inside `**multi word**`,
 * `<u>multi word</u>`, and the other inline formats remain detectable. Plain
 * text still splits tokens on whitespace only (so `**bold**` and a trailing
 * comma are one token; `detectFormat` then re-trims). The offset may be
 * mid-token, at a token edge, or in whitespace between tokens (advances to the
 * next token or retreats to the previous one).
 *
 * @param {string} line — the single line.
 * @param {number} off — the caret offset on the line.
 * @returns {[number, number]} `[start, end)` of the token.
 */
function wordAt(line, off) {
  const n = line.length; if (off < 0) off = 0; if (off > n) off = n;
  for (const pattern of FORMATTED_PATTERNS) {
    for (const match of line.matchAll(new RegExp(pattern.source, "g"))) {
      const start = match.index, end = start + match[0].length;
      if (off >= start && off <= end) return [start, end];
    }
  }
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

/* ================= Markdown-aware Ctrl+Arrow word movement ================= */

/**
 * wordJump — compute the Markdown-aware Ctrl+Arrow caret target.
 *
 * The engines' native word moves are inconsistent AND marker-blind: from
 * `A| **lightweight**` both stop between "lightweight" and the closing `**`,
 * Chromium stops before a trailing sentence period (`live formatting|.`),
 * WebKitGTK skips standalone punctuation runs entirely (`editor| - write` →
 * `editor - write|`), and at a line end native skips the next line's leading
 * marker and lands mid-span (`step|\n- **Diagrams**` → `**Diagrams|**`). So
 * this owns EVERY move with a simple, engine-independent token model:
 *
 *  - A word is a whitespace-delimited run of characters — trailing sentence
 *    punctuation (`formatting.`) rides along with its word, while a
 *    punctuation run between spaces (` - `) is a word of its own.
 *  - A formatted span (`` `code` ``, `**bold**`, `*it*`, `~~s~~`, `<u>u</u>`,
 *    `[link](url)`, `__b__`, `_i_`) is ATOMIC: its markers never split it and
 *    a multi-word span (`**two words**`) survives its internal space. The run
 *    grows across any span that straddles its edge, to a closure.
 *  - Moving RIGHT from inside a word lands at its END (past closing markers
 *    and trailing punctuation); from whitespace it jumps to the end of the
 *    NEXT word. Moving LEFT mirrors to the word's START.
 *  - At a line end the move crosses the newline and stops at the end of the
 *    NEXT line's first word (`step|\n- **Diagrams**` → `step\n-| …`); blank
 *    lines are skipped. Moving LEFT from a line start mirrors to the START of
 *    the previous line's last word.
 *  - Returns null only at the DOCUMENT edges (pos at/after the end moving
 *    right, at/before 0 moving left) — the native move is a no-op there.
 *
 * @param {string} text — the full document text.
 * @param {number} pos — the caret offset in the text.
 * @param {number} dir — +1 (ArrowRight) or -1 (ArrowLeft).
 * @returns {number|null} the new absolute caret offset, or null when the
 *   native move should be used (document edge).
 */
function wordJump(text, pos, dir) {
  const n = text.length;
  /**
   * spansOf — the formatted spans on one line, as [start, end) pairs.
   * @param {string} line — the single line.
   * @returns {Array<[number, number]>} the span list.
   */
  const spansOf = (line) => {
    const out = [];
    for (const pattern of FORMATTED_PATTERNS) {
      for (const match of line.matchAll(new RegExp(pattern.source, "g"))) {
        out.push([match.index, match.index + match[0].length]);
      }
    }
    return out;
  };
  if (dir > 0) {
    if (pos >= n) return null;
    let p = pos;
    for (;;) {
      const [ls, le] = lineBounds(text, p);
      const line = text.slice(ls, le);
      const off = p - ls;
      let q = off;
      if (!W(line[q])) {
        // On whitespace (or at the line end): the word is the one AFTER the
        // gap — on this line if one follows, else cross the newline (blank
        // lines are skipped by the loop).
        while (q < line.length && !W(line[q])) q++;
        if (q >= line.length) {
          if (le >= n) return null; // no further line → document edge
          p = le + 1;
          continue;
        }
      }
      // Grow the word to a closure: the non-whitespace run plus every
      // formatted span straddling its edge (a multi-word span's internal
      // space would otherwise split it; a span butted against the run —
      // e.g. trailing punctuation — extends it).
      let end = q;
      const spans = spansOf(line);
      for (;;) {
        while (end < line.length && W(line[end])) end++;
        let grew = false;
        for (const [s, e] of spans) {
          if (s < end && e > end) { end = e; grew = true; }
        }
        if (!grew) break;
      }
      return ls + end;
    }
  }
  if (pos <= 0) return null;
  let p = pos;
  for (;;) {
    const [ls, le] = lineBounds(text, p);
    const line = text.slice(ls, le);
    const off = p - ls;
    let q = off;
    if (!W(line[q - 1])) {
      // On whitespace (or at the line start): the word is the one BEFORE the
      // gap — on this line if one precedes, else cross the newline backward.
      while (q > 0 && !W(line[q - 1])) q--;
      if (q <= 0) {
        if (ls <= 0) return null; // no earlier line → document edge
        p = ls - 1;
        continue;
      }
    }
    let start = q;
    const spans = spansOf(line);
    for (;;) {
      while (start > 0 && W(line[start - 1])) start--;
      let grew = false;
      for (const [s, e] of spans) {
        if (s < start && e > start) { start = s; grew = true; }
      }
      if (!grew) break;
    }
    return ls + start;
  }
}

/* ================= Format detection / wrapping ================= */
// `wordAt` splits tokens on whitespace only, so a formatted word followed by
// sentence punctuation (e.g. `**bold**` in `- Live **bold**, *italic*…`) comes
// back as a single token WITH that trailing comma. The anchored `^…$` format
// regexes in `detectFormat` then fail, and only the block button (which matches
// the line prefix `- `) lights up. To recover the true format span we strip
// leading/trailing SENTENCE punctuation (`, . ; : ! ?`) from the token edges
// before matching. This is safe because no format marker (`* _ ~ ` < > / [ ]
// ( )`) is in that set — trimming token edges can never eat a marker, and the
// URL inside a link `[…](https://…)` is not at a token edge. The trimmed span
// bounds (`fs`/`fe`) are returned so `toggleFormat` can splice precisely and
// preserve the adjacent punctuation instead of clobbering the whole token.
/**
 * detectFormat — detect whether the token at `[ws, we)` has a Markdown format.
 *
 * Strips leading/trailing SENTENCE punctuation (`, . ; : ! ?`) from the token
 * edges before matching, because `wordAt` only splits on whitespace — so
 * `**bold**` in `- Live **bold**, *italic*…` shows up as one token WITH the
 * trailing comma, which would defeat anchored `^…$` format regexes. The
 * resulting inner span (`fs, fe`) is returned so `toggleFormat` can splice
 * exactly that region, preserving the adjacent punctuation.
 *
 * @param {string} line — the single line.
 * @param {number} ws — the token start offset.
 * @param {number} we — the token end offset.
 * @returns {{fmt:string, inner:string, url?:string, fs:number, fe:number}|null}
 *   the detected format (`bold`/`strike`/`code`/`underline`/`italic`/`link`),
 *   the inner text, the true span `[fs, fe)`, or null if no format is present.
 */
function detectFormat(line, ws, we) {
  const t = line.slice(ws, we);
  const leadM = t.match(/^[.,;:!?]+/);
  const trailM = t.match(/[.,;:!?]+$/);
  const lead = leadM ? leadM[0].length : 0;
  const trail = trailM ? trailM[0].length : 0;
  const fs = ws + lead;
  const fe = we - trail;
  if (fs >= fe) return null;
  const core = line.slice(fs, fe);
  let m;
  if ((m = core.match(/^\*\*(.+?)\*\*$/))) return { fmt: "bold", inner: m[1], fs, fe };
  if ((m = core.match(/^__(.+?)__$/))) return { fmt: "bold", inner: m[1], fs, fe };
  if ((m = core.match(/^~~(.+?)~~$/))) return { fmt: "strike", inner: m[1], fs, fe };
  if ((m = core.match(/^`(.+?)`$/))) return { fmt: "code", inner: m[1], fs, fe };
  if ((m = core.match(/^<u>([\s\S]+?)<\/u>$/))) return { fmt: "underline", inner: m[1], fs, fe };
  if ((m = core.match(/^\*([^\s*].*?)\*$/))) return { fmt: "italic", inner: m[1], fs, fe };
  if ((m = core.match(/^_([^_]+?)_$/))) return { fmt: "italic", inner: m[1], fs, fe };
  if ((m = core.match(/^\[([^\]]*)\]\(([^)]*)\)$/))) return { fmt: "link", inner: m[1], url: m[2], fs, fe };
  return null;
}
// Trimmed token span (sentence punctuation stripped from the edges) — used by
// `toggleFormat`'s "apply a new format to an unmatched token" branch so the
// adjacent sentence punctuation is preserved when wrapping.
/**
 * trimmedSpan — compute the "core" span of a token, without sentence punctuation.
 *
 * Used by `toggleFormat` when the token did NOT already match a format
 * (apply-a-new-format branch). Trims the leading and trailing punctuation so
 * the wrap markers are placed inside the meaningful text, preserving commas /
 * periods / etc. that follow the word.
 *
 * A token composed ENTIRELY of punctuation (`...` etc.) leaves an empty span
 * after trimming — in that case fall back to the raw `[ws, we)` so we still
 * wrap *something* (preserves the old behaviour for this pathological input).
 *
 * @param {string} line — the single line.
 * @param {number} ws — the token start offset.
 * @param {number} we — the token end offset.
 * @returns {{fs:number, fe:number}} the trimmed span `[fs, fe)`.
 */
function trimmedSpan(line, ws, we) {
  const t = line.slice(ws, we);
  const lead = (t.match(/^[.,;:!?]+/) || [""])[0].length;
  const trail = (t.match(/[.,;:!?]+$/) || [""])[0].length;
  // A token composed ENTIRELY of sentence punctuation (`...` etc.) leaves an
  // empty span after trimming — fall back to the raw token so we still wrap
  // *something* (preserves the old behaviour for this pathological input).
  if (lead + trail >= t.length) return { fs: ws, fe: we };
  return { fs: ws + lead, fe: we - trail };
}
/**
 * wrapFor — wrap `inner` with the Markdown markers for a format.
 *
 * @param {string} kind — `bold` | `italic` | `strike` | `underline` | `code`
 *   | `link`.
 * @param {string} inner — the text to wrap.
 * @returns {string} the wrapped text (or `inner` unchanged if `kind` is not
 *   a known format, so the caller's existing behaviour is preserved).
 */
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

export { lineBounds, wordAt, wordJump, detectFormat, trimmedSpan, wrapFor };
