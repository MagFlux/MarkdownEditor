/**
 * math.js — LaTeX math rendering ($$ block + $ inline) for the preview and
 * both export paths.
 *
 * Owns the STATIC `katex` and `marked` imports (same invariant class as the
 * `mermaid` import in mermaid.js: everything hoists into the single
 * dist/assets/index-*.js — never a dynamic import()). Importing `marked` here
 * means every Markdown→HTML site (live preview via syncDom, HTML export,
 * PDF raster) shares ONE parser instance and one pipeline.
 *
 * The pipeline is PROTECT → PARSE → RESTORE: findMathRanges() scans the raw
 * Markdown and lifts every math span out of marked's reach, replacing it with
 * an `<!--mN-->` placeholder (raw-HTML comments pass through marked
 * untouched), marked.parse runs on the placeholder text (so `_`, `*`, `{}`, `\`
 * inside a formula are never eaten as emphasis/escapes), then each
 * placeholder is swapped for katex.renderToString output. Rendering is fully
 * SYNCHRONOUS — unlike mermaid there is no flicker window and no
 * stale-render race: the preview HTML string arrives complete.
 *
 * Scanner contracts (pinned by test/test.mjs and test/verifyMath.mjs):
 *  - Code is sacred: `$$…$$` / `$…$` inside a fenced code block (``` / ~~~)
 *    or an inline `code span` stays literal — mermaid sources and shell
 *    examples must never turn into math.
 *  - `\$` is an escaped literal dollar and never opens math.
 *  - Inline `$…$` follows Pandoc's rules so prose never misfires: the closer
 *    must have a non-space char immediately before it and must not be
 *    followed by a digit ("costs $5 and $10" stays prose), and the span
 *    cannot cross a line break.
 *  - Whitespace-only blocks ("$$\n\n$$" — the freshly inserted toolbar
 *    scaffold) stay literal until the user types: the math analogue of
 *    mermaid.js's blank-fence guard.
 *  - Invalid LaTeX renders INLINE IN RED (katex throwOnError:false) — the
 *    same UX class as mermaid's inline error box, never a thrown exception.
 *
 * NOTE (test-chain constraint): this file must stay Node-importable
 * (test/test.mjs loads it through src/markdown.js), so the katex CSS asset
 * imports live in src/katexExportAssets.js and are injected from main.js via
 * setKatexExportAssets() — Node ESM cannot resolve .css / ?raw / ?url specs.
 */

import katex from "katex";
import { marked } from "marked";

/** FENCE_OPEN — a ``` / ~~~ fence opener (0–3 space indent, info string allowed). */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/**
 * FENCE_CLOSE — a closing fence line regex: same char, at least as long as
 * the opener, nothing else on the line (backtick/tilde need no regex escape).
 * @param {string} ch — the fence character ("`" or "~").
 * @param {number} len — the opener's run length.
 * @returns {RegExp} Tester for a full fence-closing line.
 */
const FENCE_CLOSE = (ch, len) => new RegExp("^ {0,3}\\" + ch + "{" + Math.max(3, len) + ",}\\s*$");

/**
 * findBlockClose — index of the next unescaped `$$` at/after `from`, or -1.
 * A fence opener seen before the closer leaves the block unclosed (marked
 * would treat the `$$` as literal text and the fence as a fence — the math
 * range must not swallow the fence).
 * @param {string} md — full document text.
 * @param {number} from — scan start (just past the opening `$$`).
 * @returns {number} Index of the closer's first `$`, or -1.
 */
function findBlockClose(md, from) {
  const n = md.length;
  let lineStart = md.lastIndexOf("\n", from - 1) + 1;
  let fenceCh = "", fenceLen = 0;
  let firstLine = true;
  while (lineStart <= n) {
    const eol = md.indexOf("\n", lineStart);
    const le = eol === -1 ? n : eol;
    const line = md.slice(lineStart, le);
    if (fenceCh) {
      if (FENCE_CLOSE(fenceCh, fenceLen).test(line)) { fenceCh = ""; fenceLen = 0; }
    } else {
      const fo = line.match(FENCE_OPEN);
      if (fo) { fenceCh = fo[1][0]; fenceLen = fo[1].length; }
      else {
        const fromCol = firstLine ? from - lineStart : 0;
        let k = line.indexOf("$$", fromCol);
        while (k !== -1) {
          if (line[k - 1] !== "\\") return lineStart + k;
          k = line.indexOf("$$", k + 1);
        }
      }
    }
    if (eol === -1) break;
    lineStart = eol + 1;
    firstLine = false;
  }
  return -1;
}

/**
 * findInlineClose — index of a valid closing `$` for inline math within
 * [from, eol), or -1. Pandoc's rules keep prose dollars literal: the closing
 * `$` must have a non-space char immediately before it and must not be
 * followed by a digit; `\$` inside is an escape, not a closer.
 * @param {string} md — full document text.
 * @param {number} from — scan start (just past the opening `$`).
 * @param {number} eol — index of the line's newline (inline math is same-line).
 * @returns {number} Index of the closer, or -1.
 */
function findInlineClose(md, from, eol) {
  for (let k = from; k < eol; k++) {
    if (md[k] === "\\" && md[k + 1] === "$") { k++; continue; }
    if (md[k] !== "$") continue;
    const prev = md[k - 1];
    if (prev === undefined || /\s/.test(prev)) continue;
    if (/[0-9]/.test(md[k + 1] || "")) continue;
    return k;
  }
  return -1;
}

/**
 * findMathRanges — locate every renderable math span in `md`.
 *
 * Walks the raw text once, skipping fenced code blocks (state tracked
 * line-by-line) and inline code spans (backtick runs matched by length on
 * the same line), collecting `$$…$$` display blocks (may span lines) and
 * `$…$` inline spans. Whitespace-only spans are NOT ranges — they stay
 * literal so the toolbar's fresh `$$\n\n$$` scaffold shows its markers.
 * @param {string} md — full document text.
 * @returns {Array<{start: number, end: number, src: string, display: boolean}>} Ranges in document order.
 */
function findMathRanges(md) {
  const ranges = [];
  const n = md.length;
  let fenceCh = "", fenceLen = 0;
  let i = 0;
  const lineEndOf = (p) => { const nl = md.indexOf("\n", p); return nl === -1 ? n : nl; };

  while (i < n) {
    const ls = md.lastIndexOf("\n", i - 1) + 1;
    const col = i - ls;
    const eol = lineEndOf(i);

    if (fenceCh) {
      // Inside a fence: consume the whole line; a proper close line ends it.
      if (FENCE_CLOSE(fenceCh, fenceLen).test(md.slice(i, eol))) { fenceCh = ""; fenceLen = 0; }
      i = eol + 1;
      continue;
    }

    if (col <= 3) {
      const m = md.slice(i, eol).match(FENCE_OPEN);
      if (m) { fenceCh = m[1][0]; fenceLen = m[1].length; i = eol + 1; continue; }
    }

    const ch = md[i];

    if (ch === "`") {
      // Inline code span: skip the opening run and (if found on this line)
      // everything up to the matching run of the SAME backtick length.
      let run = 0, j = i;
      while (j < n && md[j] === "`") { run++; j++; }
      let k = j, closed = -1;
      while (k < eol) {
        if (md[k] === "`") {
          let r = 0, t = k;
          while (t < n && md[t] === "`") { r++; t++; }
          if (r === run) { closed = k; k = t; break; }
          k = t;
        } else k++;
      }
      i = closed === -1 ? j : k;
      continue;
    }

    if (ch === "\\" && md[i + 1] === "$") { i += 2; continue; } // \$ literal

    if (ch === "$" && md[i + 1] === "$") {
      const close = findBlockClose(md, i + 2);
      if (close !== -1 && md.slice(i + 2, close).trim() !== "") {
        ranges.push({ start: i, end: close + 2, src: md.slice(i + 2, close), display: true });
        i = close + 2;
        continue;
      }
      i += 2; // unclosed or blank — literal
      continue;
    }

    if (ch === "$") {
      const close = findInlineClose(md, i + 1, eol);
      if (close !== -1 && md.slice(i + 1, close).trim() !== "") {
        ranges.push({ start: i, end: close + 1, src: md.slice(i + 1, close), display: false });
        i = close + 1;
        continue;
      }
      i++;
      continue;
    }

    i++;
  }
  return ranges;
}

/** KATEX_OPTS — the shared renderToString options (see module JSDoc for WHY). */
const KATEX_OPTS = {
  displayMode: false,
  throwOnError: false,
  strict: false,
  output: "html",
};

/**
 * katexHtml — render one math span with the shared KaTeX options.
 * @param {{src: string, display: boolean}} range — the math span.
 * @returns {string} KaTeX HTML (spans only; no hidden MathML — html2canvas safety).
 */
function katexHtml(range) {
  return katex.renderToString(range.src, { ...KATEX_OPTS, displayMode: range.display });
}

/**
 * renderMarkdown — the app's single Markdown→HTML pipeline (math included).
 * Drop-in for the previous `marked.parse(text)` call sites. Returns "" for
 * empty input so callers keep their own empty-state markup.
 * @param {string} md — raw Markdown source.
 * @returns {string} HTML with every math span typeset by KaTeX.
 */
export function renderMarkdown(md) {
  if (!md.trim()) return "";
  const ranges = findMathRanges(md);
  if (ranges.length === 0) return marked.parse(md);
  let text = md;
  const tokens = ranges.map((r, k) => "<!--m" + k + "-->");
  // Splice placeholders back-to-front so the recorded offsets stay valid.
  for (let k = ranges.length - 1; k >= 0; k--) {
    text = text.slice(0, ranges[k].start) + tokens[k] + text.slice(ranges[k].end);
  }
  let html = marked.parse(text);
  for (let k = 0; k < ranges.length; k++) {
    const kat = katexHtml(ranges[k]);
    // A block placeholder usually arrives as its own <p> (or a raw HTML
    // block); unwrap the paragraph so display math sits in the flow.
    html = html.split("<p>" + tokens[k] + "</p>").join(kat);
    html = html.split(tokens[k]).join(kat);
  }
  return html;
}

/**
 * containsMath — cheap "does this document contain renderable math?" check.
 * Gates the HTML export's KaTeX-CSS embedding so math-free documents keep
 * exporting exactly as before.
 * @param {string} md — raw Markdown source.
 * @returns {boolean} True when at least one math span would render.
 */
export function containsMath(md) {
  return findMathRanges(md).length > 0;
}

/* ---- export asset injection ----------------------------------------------
   The HTML export must stay a SELF-CONTAINED file ("the preview you see is
   the file you get"), so when a document has math we embed a fully inlined
   KaTeX stylesheet — every woff2 font rewritten to a data: URI. The raw CSS
   text and hashed font URLs come from src/katexExportAssets.js (main.js-only,
   Node-unresolvable) and are injected here at boot. */

let _exportAssets = null;
let _exportCss = null;

/**
 * setKatexExportAssets — inject the browser-only katex assets (called once
 * from main.js; a no-op under Node where the injection never happens).
 * @param {{css: string, fonts: Record<string, string>}} assets — raw katex.min.css text + font-name → bundled URL.
 */
export function setKatexExportAssets(assets) { _exportAssets = assets; }

/**
 * katexExportCss — the self-contained KaTeX stylesheet for HTML export
 * (fonts base64-inlined), memoized. Returns null when the assets were never
 * injected (Node test chain) — callers degrade to unstyled math.
 * @returns {Promise<string|null>} The inlined CSS, or null.
 */
export async function katexExportCss() {
  if (_exportCss) return _exportCss;
  if (!_exportAssets) return null;
  const entries = await Promise.all(
    Object.entries(_exportAssets.fonts).map(async ([name, url]) => {
      const buf = await (await fetch(url)).arrayBuffer();
      return [name, b64(buf)];
    })
  );
  let css = _exportAssets.css;
  for (const [name, data] of entries) {
    css = css.split("fonts/" + name).join("data:font/woff2;base64," + data);
  }
  // Every browser this app ships to supports woff2 (Chromium / WebKitGTK /
  // WebView2), so the css's woff/truetype fallback sources are dead weight —
  // and after the woff2 inlining they'd point at nonexistent files. Strip
  // them so the exported stylesheet has zero external references.
  css = css.replace(/,url\(fonts\/[^)]+\) format\("(?:woff|truetype)"\)/g, "");
  _exportCss = css;
  return css;
}

/**
 * b64 — ArrayBuffer → base64, chunked (String.fromCharCode spread overflows
 * on whole-array calls, and the font set totals a few hundred KB).
 * @param {ArrayBuffer} buf — the font bytes.
 * @returns {string} base64 text.
 */
function b64(buf) {
  const u8 = new Uint8Array(buf);
  let bin = "";
  for (let k = 0; k < u8.length; k += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(k, k + 0x8000));
  return btoa(bin);
}
