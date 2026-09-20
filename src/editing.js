import { wordAt } from "./format.js";

/**
 * editing.js — formatting mutations for the Markdown editor.
 *
 * The factory keeps text mutation independent from the app shell while the app
 * supplies active-document access, undo commit behavior, and pure helpers.
 */

/**
 * createEditingHandlers — build inline, block, and indentation actions.
 * @param {object} deps Formatting dependencies supplied by createApp.
 * @param {Function} deps.getActiveDoc Return the active tab document.
 * @param {Function} deps.commit Commit a text change and selection as one undo step.
 * @param {Function} deps.lineBounds Find the containing line bounds.
 * @param {Function} deps.detectFormat Detect an existing inline format.
 * @param {Function} deps.trimmedSpan Trim sentence punctuation from a token.
 * @param {Function} deps.wrapFor Wrap text in an inline format.
 * @param {Function} deps.isTableSep Detect a GFM table separator line.
 * @returns {{toggleFormat: Function, toggleBlock: Function, indentLines: Function}}
 */
export function createEditingHandlers({
  getActiveDoc,
  commit,
  lineBounds,
  detectFormat,
  trimmedSpan,
  wrapFor,
  isTableSep,
}) {
  /**
   * toggleFormat — apply, toggle off, or INSERT an inline format.
   *
   * Three regimes:
   * 1. Collapsed caret: toggles OFF only when the caret sits INSIDE an already
   *    formatted token (e.g. `**bo|ld**`). Otherwise it inserts an EMPTY marker
   *    pair at the caret (`****` / `**` / `~~~~` / `<u></u>` / ``` `` ``` /
   *    `[](https://)`) with the caret between the markers, ready to type — it
   *    never bolds the nearest word (before OR after the caret) and never
   *    reuses a neighbouring span that the caret is merely adjacent to.
   * 2. Single-line selection: wraps exactly the selected span, or toggles OFF
   *    when the selection IS (or lies inside) a format span.
   * 3. Multi-line selection: falls back to the line-under-the-caret behaviour
   *    (block formats are the right tool there; inline stays predictable).
   *
   * Every commit is a COLLAPSED caret — never a highlighted selection. After
   * wrapping (word or selection) the caret sits at the end of the inner text,
   * immediately BEFORE the closing marker, so typing continues inside the
   * format without disturbing anything; toggle-OFF puts the caret at the end
   * of the unwrapped span; the empty-marker insertion keeps the caret between
   * the markers.
   * @param {string} kind Inline format to apply.
   */
  function toggleFormat(kind) {
    const d = getActiveDoc(), input = d.input, text = d.input.value;
    const a = input.selectionStart, b = input.selectionEnd;
    const [lineStart, lineEnd] = lineBounds(text, a);
    const line = text.slice(lineStart, lineEnd);
    const la = a - lineStart;
    const collapsed = a === b;
    const multiLine = !collapsed && (b < lineStart || b > lineEnd);
    const sel = (!collapsed && !multiLine) ? { s: la, e: b - lineStart } : null;
    let newLine, care;
    // Width of the opening marker for `kind` — used to place the caret at the
    // end of the inner text (just BEFORE the closing marker) with NO
    // highlighted selection. Toggle-OFF branches have no marker pair left, so
    // their openLen is 0.
    const openLen = ({ bold: 2, italic: 1, strike: 2, underline: 3, code: 1, link: 1 })[kind] || 0;

    if (collapsed || multiLine) {
      // Line-under-the-caret behaviour (regime 1 for a caret; regime 3 fallback
      // for a multi-line selection). `wordAt` may RETREAT to the previous token
      // when the caret sits in whitespace, so the toggle-off check additionally
      // requires the caret offset to be inside the detected format span — a
      // caret after a trailing space must NOT unwrap the span it merely
      // neighbours; it inserts an empty pair instead.
      const [ws, we] = wordAt(line, la);
      const det = detectFormat(line, ws, we);
      const inFmt = collapsed && det && la >= det.fs && la <= det.fe;
      const { fs, fe } = (det && (!collapsed || inFmt)) ? { fs: det.fs, fe: det.fe } : trimmedSpan(line, ws, we);
      const target = line.slice(fs, fe);
      if (!collapsed) {
        // Multi-line selection fallback: historical token-wrap behaviour.
        if (det && det.fmt === kind) {
          newLine = line.slice(0, fs) + det.inner + line.slice(fe);
          care = fs + det.inner.length;
        } else {
          const inner = det ? det.inner : target;
          newLine = line.slice(0, fs) + wrapFor(kind, inner) + line.slice(fe);
          care = fs + openLen + inner.length;
        }
      } else if (inFmt && det.fmt === kind) {
        // Caret inside a matching format: toggle it OFF.
        newLine = line.slice(0, det.fs) + det.inner + line.slice(det.fe);
        care = det.fs + det.inner.length;
      } else if (det) {
        // Caret next to (not inside) a DIFFERENT format: wrap the resolved
        // span with `kind` — historical behaviour for a plain caret whose
        // wordAt resolution landed on an already-formatted neighbour.
        const inner = det.inner;
        newLine = line.slice(0, det.fs) + wrapFor(kind, det.inner) + line.slice(det.fe);
        care = det.fs + openLen + inner.length;
      } else if (ws < la && la < we && /\S/.test(line.slice(ws, we))) {
        // Caret strictly INSIDE a plain word: wrap that word (sentence
        // punctuation at the token edges is preserved via trimmedSpan).
        const { fs, fe } = trimmedSpan(line, ws, we);
        const inner = line.slice(fs, fe);
        newLine = line.slice(0, fs) + wrapFor(kind, inner) + line.slice(fe);
        care = fs + openLen + inner.length;
      } else {
        // Plain caret (empty line, whitespace, or a token edge): insert an
        // EMPTY marker pair AT THE CARET with the caret in the middle — the
        // nearest words are never wrapped. The insertion is padded with one
        // space on a side whose adjacent char is a word char, so a caret at
        // either edge of the gap in `the test` yields `the **** test`
        // exactly, with the cursor between the markers ready for new text.
        const ins = kind === "link" ? "[](https://)" : wrapFor(kind, "");
        const padB = la > 0 && /\S/.test(line[la - 1]) ? 1 : 0;
        const padA = /\S/.test(line[la] || "") ? 1 : 0;
        care = la + padB + openLen;
        newLine = line.slice(0, la) + " ".repeat(padB) + ins + " ".repeat(padA) + line.slice(la);
      }
      // care is line-LOCAL (like fs/la above); commit expects doc-absolute
      // positions, so lineStart is added twice here to keep the caret collapsed
      // at the right spot (commit takes both start and end).
      const abs = lineStart + care;
      commit(kind, text.slice(0, lineStart) + newLine + text.slice(lineEnd), abs, abs);
      return;
    }

    // Single-line selection (regime 2): wrap the EXACT selected span, or toggle
    // OFF when the selection is / is contained in a format span.
    const { s, e } = sel;
    let det = detectFormat(line, s, e);
    if (!det) {
      const [ws, we] = wordAt(line, s);
      const d2 = detectFormat(line, ws, we);
      if (d2 && s >= d2.fs && e <= d2.fe) det = d2;
    }
    if (det && det.fmt === kind) {
      newLine = line.slice(0, det.fs) + det.inner + line.slice(det.fe);
      care = det.fs + det.inner.length;
    } else if (det) {
      const inner = det.inner;
      newLine = line.slice(0, det.fs) + wrapFor(kind, inner) + line.slice(det.fe);
      care = det.fs + openLen + inner.length;
    } else {
      const inner = line.slice(s, e);
      newLine = line.slice(0, s) + wrapFor(kind, inner) + line.slice(e);
      care = s + openLen + inner.length;
    }
    // care is line-LOCAL here too — convert to doc-absolute before committing.
    const abs = lineStart + care;
    commit(kind, text.slice(0, lineStart) + newLine + text.slice(lineEnd), abs, abs);
  }

  /**
   * blockLine — rewrite a single line to or from a block element.
   * @param {string} kind Block kind to apply or strip.
   * @param {string} line The raw source line.
   * @returns {string} The rewritten line.
   */
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

  /**
   * toggleBlock — wrap or unwrap the selected range as a block element.
   * @param {string} kind Block kind to apply or strip.
   */
  function toggleBlock(kind) {
    const d = getActiveDoc(), input = d.input, text = d.input.value;
    const a = input.selectionStart, b = input.selectionEnd;
    const [startLine, endLine] = selLineRange(text, a, b);

    if (kind === "table") {
      const lines = text.split("\n");
      const cur = lineBounds(text, a)[0];
      let row = cur;
      while (row > 0 && (lines[row - 1] || "").includes("|")) row--;
      let endRow = row;
      while (endRow < lines.length && (lines[endRow] || "").includes("|")) endRow++;
      if (endRow - row >= 2 && (lines[row] || "").includes("|") && isTableSep(lines[row + 1] || "")) {
        const before = lines.slice(0, row).join("\n");
        const after = lines.slice(endRow).join("\n");
        const to = (before && after) ? before + "\n" + after : (before || after);
        commit("remove table", to, row > 0 ? before.length : 0, row > 0 ? before.length : to.length);
        return;
      }
      const tbl = `| Column 1 | Column 2 | Column 3 |\n| -------- | -------- | -------- |\n|          |          |          |`;
      const pre = (lines[cur] || "").trim() !== "" ? "\n" : "";
      const to = text.slice(0, startLine) + pre + tbl + "\n" + text.slice(endLine);
      // Cursor in the first body cell so typing starts there immediately
      // (no highlighted selection over the inserted table).
      const row3 = tbl.split("\n")[2];
      const caret = startLine + pre.length + (tbl.length - row3.length) + 2;
      commit("insert table", to, caret, caret);
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
        // Collapsed caret at the end of the (un)wrapped block — no highlight.
        const care = startLine + nb.length;
        commit("unwrap code block", text.slice(0, startLine) + nb + text.slice(endLine), care, care);
        return;
      }
      const nb = "```\n" + block + "\n```";
      // Caret INSIDE the fence: end of the content, right before the "\n```"
      // tail (nb.length - 4, NOT - 3 — -3 lands on the closing-fence line
      // itself). With an empty block the caret thus sits on the blank middle
      // line: "```\n|\n```". Collapsed, no highlight.
      const care = startLine + nb.length - 4;
      commit("wrap code block", text.slice(0, startLine) + nb + text.slice(endLine), care, care);
      return;
    }

    const block = text.slice(startLine, endLine);
    const newBlock = block.split("\n").map((line) => blockLine(kind, line)).join("\n");
    // Collapsed caret at the end of the rewritten block so the user types at
    // the end of the content (no highlighted selection).
    const care = startLine + newBlock.length;
    commit("block " + kind, text.slice(0, startLine) + newBlock + text.slice(endLine), care, care);
  }

  /**
   * selLineRange — line range `[start, end)` covering the current selection,
   * with a WebKitGTK double-click guard. A double-click on the last word of a
   * line in WebKitGTK selects `word\n`, so the selection END lands at column 0
   * of the NEXT line; a selection that ends at column 0 never "owns" that
   * following line (standard editor convention), so we fall back to the
   * PREVIOUS line's end. Without this guard, Tab on a double-clicked list item
   * also indented the next, unselected list item.
   * @param {string} text — full document text.
   * @param {number} a — selectionStart.
   * @param {number} b — selectionEnd.
   * @returns {[number, number]} `[start, end)` of the selected lines.
   */
  function selLineRange(text, a, b) {
    const s = lineBounds(text, a)[0];
    let e = lineBounds(text, b)[1];
    if (b > s && b === lineBounds(text, b)[0]) e = lineBounds(text, b - 1)[1];
    return [s, e];
  }

  /**
   * indentLines — indent or outdent the selected range, INCLUDING blank lines
   * (a Tab on a blank line inserts the indent and Shift+Tab removes it, with
   * the caret visibly moving past it).
   *
   * The result is committed with a COLLAPSED caret (never a highlighted
   * selection): the caret follows its text, i.e. its column within its line
   * is preserved across the added/removed indentation (a column-0 caret stays
   * glued to the inserted prefix — for Tab it sits after the tab, and for
   * Shift+Tab there is nothing before it, so it stays at column 0).
   * @param {number} dir +1 to indent, -1 to outdent.
   */
  function indentLines(dir) {
    const d = getActiveDoc(), input = d.input, text = d.input.value;
    const a = input.selectionStart, b = input.selectionEnd;
    const [s, e] = selLineRange(text, a, b);
    const lines = text.slice(s, e).split("\n");
    const newLines = dir > 0
      ? lines.map((line) => "\t" + line)
      : lines.map((line) => line.replace(/^(\t| {1,4})/, ""));
    const joined = newLines.join("\n");
    // Caret position: preserve its COLUMN within its line across the change.
    const tail = Math.max(a, b);
    const caretIdx = text.slice(s, tail).split("\n").length - 1;
    const colBefore = tail - lineBounds(text, tail)[0];
    let head = s, delta = 0;
    for (let i = 0; i < lines.length; i++) {
      if (i < caretIdx) {
        if (newLines[i] !== lines[i]) delta += newLines[i].length - lines[i].length;
      } else {
        // Caret's own line: map the column through the added/removed prefix.
        const add = newLines[i].length - lines[i].length;
        const colAfter = Math.max(0, Math.min(colBefore + add, newLines[i].length));
        head = s + lines.slice(0, i).join("\n").length + (i > 0 ? 1 : 0) + delta + colAfter;
        break;
      }
    }
    commit(dir > 0 ? "indent" : "outdent", text.slice(0, s) + joined + text.slice(e), head, head);
  }

  return { toggleFormat, toggleBlock, indentLines };
}
