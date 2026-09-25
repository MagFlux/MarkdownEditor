/**
 * codecolor.js — fenced-code syntax highlighting for the preview (and both
 * exports, which share the same Markdown→HTML pipeline).
 *
 * Uses highlight.js's CORE build (`highlight.js/lib/core`) with ONLY the
 * explicitly imported language grammars registered — never the all-languages
 * barrel, which would balloon the single bundle by ~1 MB for languages this
 * app rarely sees (the core + ~15 grammars it does use add a fraction of
 * that). The import is STATIC (invariants 2 & 8: everything hoists into the
 * one dist/assets/index-*.js — never a dynamic import()).
 *
 * Contract (pinned by test/test.mjs + test/verifyCodeColor.mjs):
 *  - `highlightCode(lang, code)` returns HTML with `<span class="hljs-*">`
 *    token markup, fully HTML-escaped by hljs itself (no raw `<` can ever
 *    leak from a highlighted fence into the preview/export HTML).
 *  - Unregistered / unknown languages (and the empty info string) return
 *    null → the caller keeps marked's default escaped-code output. Unknown
 *    languages must never throw and never change the byte-for-byte shape of
 *    a code block.
 *  - `language-mermaid` is owned by src/mermaid.js (its blank-fence guard
 *    and SVG cache replace the fence wholesale) — always null here.
 *
 * Node-importable (test.mjs loads the math.js graph under plain Node):
 * highlight.js's core is isomorphic (pure string processing, no DOM).
 *
 * Coloring lives in src/style.css (`[data-theme]`-aware, light + dark) and
 * in export.js's EXPORT_PREVIEW_CSS (a fixed light palette for the
 * standalone HTML export; the PDF rasterizes the live DOM colors instead).
 * Run the regression with `npm run verify-codecolor`.
 */
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import rust from "highlight.js/lib/languages/rust";
import go from "highlight.js/lib/languages/go";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import java from "highlight.js/lib/languages/java";
import sql from "highlight.js/lib/languages/sql";
import yaml from "highlight.js/lib/languages/yaml";
import diff from "highlight.js/lib/languages/diff";
import ini from "highlight.js/lib/languages/ini";

/* Register the bundled grammars. Each grammar carries its own aliases, so
   one registration covers the common spellings: js/javascript, ts/typescript,
   py/python, sh/shell/zsh → bash, html/xhtml → xml, c++/cc → cpp,
   golang → go, yml → yaml, jsonc → json, cfg/toml-ish → ini. */
const GRAMMARS = { javascript, typescript, python, json, bash, xml, css, rust, go, c, cpp, java, sql, yaml, diff, ini };
for (const [name, grammar] of Object.entries(GRAMMARS)) hljs.registerLanguage(name, grammar);

/** LANGS — the info strings the highlighter accepts (for docs/tests). */
export const LANGS = Object.keys(GRAMMARS);

/**
 * highlightCode — highlight one fenced-code body.
 * @param {string} lang — the fence's info string's first word (lowercase).
 * @param {string} code — the RAW code text (no trailing newline).
 * @returns {string|null} Highlighted + escaped HTML, or null when the
 *   language is unknown/unowned (caller emits marked's plain escaped code).
 */
export function highlightCode(lang, code) {
  if (!lang || lang === "mermaid") return null;
  if (!hljs.getLanguage(lang)) return null;
  try {
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    // A grammar threw on exotic input — fall back to plain code rather than
    // break the preview (same UX contract as math's inline red / mermaid's
    // error box: rendering never throws the user out of the document).
    return null;
  }
}
