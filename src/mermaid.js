/* Mermaid — STATIC import. Invariant (AGENTS.md § Static imports / single bundle):
   it must hoist into the single main bundle (no runtime code-split chunk, which the
   GTK webview can't resolve). Mermaid v12's `import` resolves to
   `dist/mermaid.core.mjs` whose top-level init only needs
   `window.addEventListener`/`removeEventListener` (both present in the test.mjs
   Node stubs), so importing under Node in test.mjs is safe. Actual diagram
   rendering (mermaid.render) is browser-only — it needs a real layout DOM — and
   is always guarded so the headless/Node path never calls it. */
import mermaid from "mermaid";
import { esc } from "./render.js";

/* ================= Mermaid diagram rendering =================
   marked turns a ` ```mermaid ` fence into
   `<pre><code class="language-mermaid">…</code></pre>`. We detect those and swap
   the `<pre>` for the rendered SVG (inline, so both the live preview and the
   html2canvas PDF export capture it; the exported HTML doc inlines the same SVG).
   renderMermaidSvg is the single source: it asks mermaid for the SVG string. */
let _mmSeq = 0;

/**
 * mermaidTheme — pick the mermaid theme matching the app's data-theme.
 *
 * Reads `document.documentElement.dataset.theme`; returns `"dark"` when it is
 * `"dark"`, otherwise `"default"`. Safe under Node (returns `"default"` when
 * `document` is absent).
 *
 * @returns {"dark"|"default"} the mermaid theme name.
 */
function mermaidTheme() {
  let theme = "default";
  try { theme = (document.documentElement && document.documentElement.dataset && document.documentElement.dataset.theme === "dark") ? "dark" : "default"; } catch { /* ignore */ }
  return theme;
}
/**
 * renderMermaidSvg — ask mermaid for the rendered SVG of one diagram source.
 *
 * Mounts an off-screen container, calls mermaid.render, and returns the SVG
 * string. Safe under Node (returns `{svg:"",bindFunctions:null}` when
 * `document.body` is absent) — never invokes mermaid.render in that case.
 *
 * @param {string} text — the mermaid source (e.g. `flowchart LR\n A --> B`).
 * @returns {Promise<{svg:string, bindFunctions:Function|null}>} the rendered
 *   SVG and the optional interactive-bindings callback (or an empty string
 *   under Node / if rendering failed in a way we chose to swallow).
 */
async function renderMermaidSvg(text) {
  if (typeof document === "undefined" || !document.body) { return { svg: "", bindFunctions: null }; } // Node/headless: never render
  let theme = "default";
  try { theme = (document.documentElement && document.documentElement.dataset && document.documentElement.dataset.theme === "dark") ? "dark" : "default"; } catch { /* ignore */ }
  try { mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme }); } catch { /* ignore */ }
  const id = "md-mermaid-" + (++_mmSeq);
  // Mermaid measures against a real (visible) node, so mount it off-screen in the
  // doc, render into it, then fully clean up. Never left behind.
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-100000px;top:0;z-index:-1;visibility:hidden;";
  document.body.appendChild(container);
  try {
    const res = await mermaid.render(id, text, container);
    let svg = (typeof res === "string") ? res : ((res && (res.svg || res.str)) || (container && container.innerHTML) || "");
    // Make the inline SVG scale to its container width rather than a fixed
    // mermaid width, so narrow diagrams don't overflow the preview column.
    svg = svg.replace(/<svg/i, '<svg style="max-width:100%;height:auto;"');
    return { svg, bindFunctions: (typeof res !== "string" && res.bindFunctions) || null };
  } finally {
    if (container.parentNode) container.parentNode.removeChild(container);
    const leftover = (typeof document !== "undefined" && document.getElementById) ? document.getElementById(id) : null;
    if (leftover && leftover.parentNode) leftover.parentNode.removeChild(leftover);
  }
}

/**
 * renderMermaidInNode — render every mermaid fence inside a live DOM node, in place.
 *
 * Finds every `pre > code.language-mermaid`, swaps its parent `<pre>` for a
 * rendered SVG holder, and applies the interactive bindings. A no-op (safe)
 * when the node has no such fences or is null.
 *
 * @param {Element|null} node — the live DOM subtree to walk (the preview or
 *   the off-screen PDF host).
 * @returns {Promise<void>} resolves once every fence has been rendered.
 */
async function renderMermaidInNode(node) {
  if (!node) return;
  const blocks = Array.from(node.querySelectorAll("pre > code.language-mermaid"));
  if (!blocks.length) return;
  for (const code of blocks) {
    const pre = code.closest ? code.closest("pre") : code.parentNode;
    const text = code.textContent; // textContent is already entity-decoded
    let out = { svg: "", bindFunctions: null };
    try { out = await renderMermaidSvg(text); }
    catch (e) { out.svg = `<div class="mermaid-diagram-err">Mermaid render failed: ${esc((e && e.message) || e)}</div>`; }
    const holder = document.createElement("div");
    holder.className = "mermaid-diagram";
    holder.innerHTML = out.svg;
    if (pre && pre.parentNode) pre.parentNode.replaceChild(holder, pre);
    else node.appendChild(holder);
    if (out.bindFunctions) { try { out.bindFunctions(holder); } catch { /* ignore: interactive add-on failed */ } }
  }
}

/**
 * renderMermaidInHtml — render every mermaid fence inside an HTML *string*.
 *
 * This is the export path: marked had escaped `<`/`>` in the source, so the
 * source is entity-decoded before being handed to mermaid. The result is the
 * same HTML string with each `<pre><code class="language-mermaid">…</code></pre>`
 * replaced by a `<div class="mermaid-diagram">…svg…</div>` element. A no-op
 * (returns `html` unchanged) when the string contains no mermaid fences.
 *
 * @param {string} html — the marked-produced HTML string.
 * @returns {Promise<string>} the same string with the mermaid fences rendered.
 */
async function renderMermaidInHtml(html) {
  const re = /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g;
   if (!re.test(html)) { re.lastIndex = 0; return html; }

   /** decode — un-escape the HTML entities a `<pre><code>` fence may have wrapped in. */
   const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  const out = [];
  let last = 0, m;
  while ((m = re.exec(html))) {
    out.push(html.slice(last, m.index));
    let svg;
    try { svg = (await renderMermaidSvg(decode(m[1]))).svg; }
    catch (e) { svg = `<div class="mermaid-diagram-err">Mermaid render failed: ${esc((e && e.message) || e)}</div>`; }
    out.push(`<div class="mermaid-diagram">${svg}</div>`);
    last = m.index + m[0].length;
  }
  out.push(html.slice(last));
  return out.join("");
}

/**
 * scheduleMermaidRender — debounce-render mermaid inside `d.preview`.
 *
 * `syncDom` runs on every keystroke; this collapses a burst into a single
 * render 120 ms after the last call, so typing never fires more than one
 * mermaid pass per settle window.
 *
 * @param {object} d — a per-tab state bag; the fn reads/writes `d.__mmTimer`
 *   and renders into `d.preview`.
 */
function scheduleMermaidRender(d) {
  if (d.__mmTimer) clearTimeout(d.__mmTimer);
  d.__mmTimer = setTimeout(() => { d.__mmTimer = 0; renderMermaidInNode(d.preview).catch(() => {}); }, 120);
}

export { mermaidTheme, renderMermaidSvg, renderMermaidInNode, renderMermaidInHtml, scheduleMermaidRender };
