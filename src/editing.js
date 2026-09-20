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
   * toggleFormat — apply or toggle off an inline format over the current word or selection.
   * @param {string} kind Inline format to apply.
   */
  function toggleFormat(kind) {
    const d = getActiveDoc(), input = d.input, text = d.input.value;
    const a = input.selectionStart;
    const [lineStart, lineEnd] = lineBounds(text, a);
    const line = text.slice(lineStart, lineEnd);
    const [ws, we] = wordAt(line, a - lineStart);
    const det = detectFormat(line, ws, we);
    const span = det ? { fs: det.fs, fe: det.fe } : trimmedSpan(line, ws, we);
    const { fs, fe } = span;
    let newLine, ns, ne;
    const target = line.slice(fs, fe);
    if (kind === "link") {
      if (det && det.fmt === "link") {
        newLine = line.slice(0, fs) + det.inner + line.slice(fe);
        ns = fs; ne = ns + det.inner.length;
      } else {
        const w = target || "link";
        newLine = line.slice(0, fs) + `[${w}](https://)` + line.slice(fe);
        ns = fs + 3 + w.length; ne = ns + 8;
      }
    } else {
      if (det && det.fmt === kind) {
        newLine = line.slice(0, fs) + det.inner + line.slice(fe);
        ns = fs; ne = ns + det.inner.length;
      } else {
        const inner = det ? det.inner : target;
        newLine = line.slice(0, fs) + wrapFor(kind, inner) + line.slice(fe);
        ns = fs; ne = ns + inner.length;
      }
    }
    commit(kind, text.slice(0, lineStart) + newLine + text.slice(lineEnd), lineStart + ns, lineStart + ne);
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
    const newBlock = block.split("\n").map((line) => blockLine(kind, line)).join("\n");
    commit("block " + kind, text.slice(0, startLine) + newBlock + text.slice(endLine), startLine, startLine + newBlock.length);
  }

  /**
   * indentLines — indent or outdent the selected range.
   * @param {number} dir +1 to indent, -1 to outdent.
   */
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

  function indentLines(dir) {
    const d = getActiveDoc(), input = d.input, text = d.input.value;
    const a = input.selectionStart, b = input.selectionEnd;
    const [s, e] = selLineRange(text, a, b);
    const lines = text.slice(s, e).split("\n");
    const newLines = dir > 0
      ? lines.map((line) => (line === "" ? line : "\t" + line))
      : lines.map((line) => line.replace(/^(\t| {1,4})/, ""));
    const joined = newLines.join("\n");
    commit(dir > 0 ? "indent" : "outdent", text.slice(0, s) + joined + text.slice(e), s, s + joined.length);
  }

  return { toggleFormat, toggleBlock, indentLines };
}
