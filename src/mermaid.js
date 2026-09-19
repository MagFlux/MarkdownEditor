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

/* ================= Mermaid SVG cache =================
   syncDom rewrites `d.preview.innerHTML` on every keystroke, which wipes rendered
   `<div class="mermaid-diagram">` holders back to raw `<pre><code>`. The old
   debounced re-render (120 ms) then re-rendered them — the gap between wipe and
   re-render was visible as a flash of raw code (the "flicker"). The fix:
   (a) cache rendered SVG by source text, and (b) synchronously restore any
       already-cached SVG the moment syncDom finishes rewriting innerHTML, so
       the user NEVER sees raw code for a diagram they have already seen rendered.
   (c) skip the debounced render entirely when the mermaid-source key did not
       change, so typing outside a mermaid fence no longer re-runs mermaid at all. */
const _svgCache = new Map();      // source text -> {svg, bindFunctions}
const _inflight = new Map();      // source text -> Promise<{svg, bindFunctions}>
const _SVG_CACHE_MAX = 200;

/**
 * _cacheSvg — remember a rendered SVG in `_svgCache`, evicting the oldest entry
 * once the cache exceeds `_SVG_CACHE_MAX`. Insertion order on a Map is stable;
 * `delete` + `set` refreshes recency on re-cached keys.
 *
 * @param {string} text — the mermaid source that was just rendered.
 * @param {object} entry — the `{svg, bindFunctions}` value to remember.
 */
function _cacheSvg(text, entry) {
  if (_svgCache.has(text)) _svgCache.delete(text);
  _svgCache.set(text, entry);
  while (_svgCache.size > _SVG_CACHE_MAX) {
    const first = _svgCache.keys().next().value;
    if (first === undefined) break;
    _svgCache.delete(first);
  }
}

/**
 * installMermaidStyles — mirror Mermaid's generated SVG stylesheet into the
 * document head so it applies even when an inline SVG `<style>` fails.
 *
 * WHY: Mermaid encodes fills, strokes, markers, filters, label alignment, and
 * sequence-diagram rules in an SVG-internal `<style>` element. Some WebView2
 * builds intermittently fail to apply those nested styles, producing black
 * nodes and missing edges. Copying the same rules into a document-level
 * `<style>` preserves Mermaid's complete cascade without guessing at
 * individual shapes or changing the Linux rendering path. The original SVG
 * style stays in place too, so platforms that do apply it are unaffected.
 *
 * @param {Element|null} holder — a `.mermaid-diagram` element containing one SVG.
 * @returns {void} nothing; missing DOM/style elements are ignored safely.
 */
function installMermaidStyles(holder) {
  if (!holder || typeof document === "undefined" || !document.head) return;
  const svg = holder.querySelector && holder.querySelector("svg");
  const source = svg && svg.querySelector("style");
  if (!svg || !source || !source.textContent) return;
  const id = svg.getAttribute("id");
  if (!id) return;
  const attr = `data-mermaid-style="${id}"`;
  let style = document.head.querySelector(`style[${attr}]`);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("data-mermaid-style", id);
    document.head.appendChild(style);
  }
  if (style.textContent !== source.textContent) style.textContent = source.textContent;
}

/**
 * inlineMermaidFallback — preserved for API compatibility only.
 *
 * WHY: platform-specific per-shape attribute rewriting changed selector
 * precedence and broke valid diagrams on Linux. The generic stylesheet
 * mirror above now handles WebView2 stylesheet failures instead.
 *
 * @param {string} svg — the rendered SVG string from mermaid.
 * @param {"dark"|"default"} _theme — unused; kept for signature compatibility.
 * @returns {string} the original SVG, unchanged.
 */
function inlineMermaidFallback(svg, _theme) {
  return svg;
}

/* Historical per-shape fallback removed. Kept below only as dead context
   until the next cleanup pass deletes this comment block entirely. */
function _unusedInlineMermaidFallbackLegacy(svg, theme) {
  const dark = theme === "dark";
  // Theme fills sampled from mermaid v12 default/dark themeVariables output.
  const nodeFill = dark ? "#1f2020" : "#ECECFF";
  const nodeStroke = dark ? "#81B1DB" : "#9370DB";
  const clusterFill = dark ? "#1f2020" : "#ffffde";
  const actorFill = dark ? "#1f2020" : "#eaeaea";
  const actorStroke = dark ? "#81B1DB" : "#666";
  const lifelineStroke = dark ? "#81B1DB" : "#999";
  const edgeStroke = dark ? "#ccc" : "#333333";
  const labelBg = dark ? "rgba(30,30,30,0.85)" : "rgba(232,232,232,0.8)";
  let out = svg;
  // Flowchart node OUTER boxes: `<rect class="basic label-container">` directly
  // under <g class="node">. Despite the "label-container" name this IS the
  // visible node box (stylesheet: fill #ECECFF / stroke #9370DB). Must be
  // stamped — skipping it leaves solid-black boxes on stylesheet failure.
  out = out.replace(/<(rect)(?![^>]*fill=)([^>]*class="[^"]*\bbasic label-container\b[^>]*)>/g,
    (m, tag, rest) => `<${tag} fill="${nodeFill}" stroke="${nodeStroke}"${rest}>`);
  // Flowchart node INNER backing rects: bare <rect> (no class/fill/stroke)
  // inside <g class="label"> behind the text. Same theme fill/stroke.
  out = out.replace(/<(rect|circle|ellipse)(?![^>]*(?:fill=|class=|stroke=))([^>]*)>/g,
    (m, tag, rest) => `<${tag} fill="${nodeFill}" stroke="${nodeStroke}"${rest}>`);
  out = out.replace(/<(polygon)(?![^>]*fill=)([^>]*class="[^"]*\blabel-container\b[^>]*)>/g,
    (m, tag, rest) => `<${tag} fill="${nodeFill}" stroke="${nodeStroke}"${rest}>`);
  // Bare edge paths (no class/stroke): flowchart-link shapes mermaid emits
  // without a class get the edge stroke + fill none.
  out = out.replace(/<(path)(?![^>]*(?:stroke=|fill=|class=|d="M0))([^>]*)>/g,
    (m, tag, rest) => `<${tag} stroke="${edgeStroke}" fill="none"${rest}>`);
  // Cluster (subgraph) rects.
  out = out.replace(/<(rect)(?![^>]*fill=)([^>]*class="[^"]*\bcluster\b[^"]*"[^>]*)>/g,
    (m, tag, rest) => `<${tag} fill="${clusterFill}" stroke="${nodeStroke}"${rest}>`);
  // Sequence actor boxes: mermaid v12 emits fill="#eaeaea" INLINE (before the
  // class attribute), but the stylesheet overrides it (.actor{fill:#ECECFF} —
  // the light purple in the Linux screenshot). With no stylesheet the inline
  // grey wins and the color is wrong, so REWRITE the inline fill to the theme
  // node fill. Scoped to actor-class rects only (fill may precede class).
  out = out.replace(/<(rect)([^>]*class="[^"]*\bactor\b[^"]*"[^>]*)>/g,
    (m, tag, rest) => rest.includes('fill="#eaeaea"')
      ? `<${tag}${rest.replace('fill="#eaeaea"', `fill="${nodeFill}"`)}`
      : (rest.includes("fill=") ? m : `<${tag} fill="${nodeFill}" stroke="${actorStroke}"${rest}>`));
  // Actor lifelines.
  out = out.replace(/<(line)(?![^>]*stroke=)([^>]*class="[^"]*\bactor-line\b[^"]*"[^>]*)>/g,
    (m, tag, rest) => `<${tag} stroke="${lifelineStroke}"${rest}>`);
  // Sequence message lines: mermaid emits stroke="none" INLINE (the
  // stylesheet's .messageLine0/1{stroke:#333} rule normally overrides it, but
  // with no stylesheet the inline none wins and the line vanishes). Rewrite
  // stroke="none" → the theme stroke. Scoped to messageLine classes only.
  // messageLine1 is the DOTTED reply line (.messageLine1{stroke-dasharray:2,2}
  // in the stylesheet) — also stamp the dasharray so it stays dotted instead
  // of rendering solid.
  out = out.replace(/<(line)([^>]*class="[^"]*\bmessageLine[01]\b[^"]*"[^>]*)stroke="none"([^>]*)>/g,
    (m, tag, before, after) => `<${tag}${before}stroke="${edgeStroke}"${after}>`);
  out = out.replace(/<(line)([^>]*class="[^"]*\bmessageLine1\b[^"]*"[^>]*)(?![^>]*stroke-dasharray)([^>]*)>/g,
    (m, tag, before, after) => `<${tag}${before}stroke-dasharray="2,2"${after}>`);
  // Edge paths: flowchart-link (only when missing a stroke; sequence messages
  // are <line>, handled above).
  out = out.replace(/<(path)(?![^>]*stroke=)([^>]*class="[^"]*\bflowchart-link\b[^"]*"[^>]*)>/g,
    (m, tag, rest) => `<${tag} stroke="${edgeStroke}" fill="none"${rest}>`);
  // Edge-label backings.
  out = out.replace(/<(rect)(?![^>]*fill=)([^>]*class="[^"]*\bedgeLabel\b[^"]*"[^>]*)>/g,
    (m, tag, rest) => `<${tag} fill="${labelBg}"${rest}>`);
  return out;
}

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
 * CACHED: on a cache hit no `mermaid.render` call and no off-screen mount
 * happens at all — the stored `{svg, bindFunctions}` is returned directly.
 * CONCURRENT: while a render is in flight for the same source, callers share
 * the same promise so N concurrent callers collapse into one mermaid.render.
 * Safe under Node (returns `{svg:"",bindFunctions:null}` when `document.body`
 * is absent) — never invokes mermaid.render in that case.
 *
 * @param {string} text — the mermaid source (e.g. `flowchart LR\n A --> B`).
 * @returns {Promise<{svg:string, bindFunctions:Function|null}>} the rendered
 *   SVG and the optional interactive-bindings callback (or an empty string
 *   under Node / if rendering failed in a way we chose to swallow).
 */
async function renderMermaidSvg(text) {
  if (typeof document === "undefined" || !document.body) { return { svg: "", bindFunctions: null }; } // Node/headless: never render
  // Cache hit — no render, no DOM, no timer. This is the fast path behind the
  // flicker fix: `restoreMermaid` walks the DOM and finds the holder already
  // in place with a cached SVG, so mermaid.render is never consulted again.
  const hit = _svgCache.get(text);
  if (hit) return hit;
  // In-flight share — two concurrent callers (e.g. tab A and the PDF export both
  // asking for the same source) collapse into one mermaid.render.
  const shared = _inflight.get(text);
  if (shared) return shared;
  const p = (async () => {
    let theme = "default";
    try { theme = (document.documentElement && document.documentElement.dataset && document.documentElement.dataset.theme === "dark") ? "dark" : "default"; } catch { /* ignore */ }
    try { mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme }); } catch { /* ignore */ }
    const id = "md-mermaid-" + (++_mmSeq) + "-" + Math.floor(Math.random() * 1e6).toString(36);
    // Mermaid needs a laid-out node to measure text (getBBox), so mount a
    // host in the doc, render into it, then fully clean up. Never left behind.
    // The host sits off-screen (absolute, -9999px) with visibility:hidden:
    // hidden elements keep layout (so measurement matches the preview column
    // width below) but never paint. display:none would break measurement;
    // a zero-size host would wrap htmlLabels at 0px and misplace nodes.
    // Each render uses a unique id so concurrent renders never share marker /
    // gradient ids inside the serialized SVG string.
    const container = document.createElement("div");
    container.setAttribute("aria-hidden", "true");
    container.style.cssText = "position:absolute;left:-9999px;top:0;width:960px;visibility:hidden;pointer-events:none;";
    document.body.appendChild(container);
    try {
      const res = await mermaid.render(id, text, container);
      let svg = (typeof res === "string") ? res : ((res && (res.svg || res.str)) || (container && container.innerHTML) || "");
      // Make the inline SVG scale to its container width rather than a fixed
      // mermaid width, so narrow diagrams don't overflow the preview column.
      svg = svg.replace(/<svg/i, '<svg style="max-width:100%;height:auto;display:block;"');
      // Stylesheet-failure fallback is now handled generically by
      // installMermaidStyles() at holder-insertion time (see below). The old
      // per-shape attribute rewriting broke valid diagrams on Linux, so we
      // preserve Mermaid's original markup and cascade here instead.
      const entry = { svg, bindFunctions: (typeof res !== "string" && res.bindFunctions) || null };
      _cacheSvg(text, entry);
      return entry;
    } finally {
      try { container.innerHTML = ""; } catch { /* ignore */ }
      if (container.parentNode) container.parentNode.removeChild(container);
      const leftover = (typeof document !== "undefined" && document.getElementById) ? document.getElementById(id) : null;
      if (leftover && leftover.parentNode) leftover.parentNode.removeChild(leftover);
    }
  })();
  _inflight.set(text, p);
  try { return await p; }
  finally { _inflight.delete(text); }
}

/**
 * renderMermaidInNode — render every mermaid fence inside a live DOM node, in place.
 *
 * Finds every `pre > code.language-mermaid`, swaps its parent `<pre>` for a
 * rendered SVG holder, and applies the interactive bindings. CACHED: a fence
 * whose source is already in `_svgCache` is restored from the cache (no
 * `mermaid.render` call, no off-screen mount). A no-op (safe) when the node
 * has no such fences or is null.
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
    // STALE-RENDER GUARD (Windows/WebView2 artifact fix): syncDom rewrites
    // preview.innerHTML on every keystroke while this async render is in
    // flight. When that happens `pre` is detached from the live DOM — the old
    // code fell through to `node.appendChild(holder)` and left a stale
    // duplicate diagram (boxes/lines echoing the real diagram above it).
    // If `pre` is no longer in `node`, the DOM has moved on: skip instead of
    // appending a ghost.
    if (!pre || !pre.isConnected || !node.contains(pre)) continue;
    const text = code.textContent; // textContent is already entity-decoded
    let out = _svgCache.get(text) || { svg: "", bindFunctions: null };
    if (!out.svg) {
      try { out = await renderMermaidSvg(text); }
      catch (e) { out.svg = `<div class="mermaid-diagram-err">Mermaid render failed: ${esc((e && e.message) || e)}</div>`; }
      // Re-check after the await: another keystroke may have detached `pre`
      // while mermaid was rendering. Same skip — never append a ghost.
      if (!pre.isConnected || !node.contains(pre)) continue;
    }
    const holder = document.createElement("div");
    holder.className = "mermaid-diagram";
    holder.innerHTML = out.svg;
    installMermaidStyles(holder);
    if (pre && pre.parentNode) pre.parentNode.replaceChild(holder, pre);
    // NOTE: no `else appendChild` fallback — appending here is exactly what
    // created the duplicate-diagram ghost. If `pre` is gone, do nothing.
    if (out.bindFunctions) { try { out.bindFunctions(holder); } catch { /* ignore: interactive add-on failed */ } }
  }
}

/**
 * renderMermaidInHtml — render every mermaid fence inside an HTML *string*.
 *
 * This is the export path: marked had escaped `<`/`>` in the source, so the
 * source is entity-decoded before being handed to mermaid. The result is the
 * same HTML string with each `<pre><code class="language-mermaid">…</code></pre>`
 * replaced by a `<div class="mermaid-diagram">…svg…</div>` element. CACHED:
 * sources already in `_svgCache` are spliced in directly (no render). A no-op
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
    const src = decode(m[1]);
    let svg = (_svgCache.get(src) || {}).svg || "";
    if (!svg) {
      try { svg = (await renderMermaidSvg(src)).svg; }
      catch (e) { svg = `<div class="mermaid-diagram-err">Mermaid render failed: ${esc((e && e.message) || e)}</div>`; }
    }
    out.push(`<div class="mermaid-diagram">${svg}</div>`);
    last = m.index + m[0].length;
  }
  out.push(html.slice(last));
  return out.join("");
}

/**
 * restoreMermaid — synchronously restore cached SVGs inside `node`.
 *
 * The anti-flicker fast path. After `syncDom` rewrites `d.preview.innerHTML`,
 * every previously-rendered mermaid fence has been wiped back to raw
 * `<pre><code class="language-mermaid">`. This function walks those fences,
 * looks each one up in `_svgCache`, and — on a hit — substitutes a
 * `<div class="mermaid-diagram">` holder with the cached SVG IN PLACE. Zero
 * `mermaid.render` calls, zero async, zero timers: the diagram is back in the
 * same synchronous tick as the innerHTML write, so the user NEVER sees raw
 * code. Fences whose source is not cached are left alone; the debounced
 * `scheduleMermaidRender` will handle them on the next settle (unchanged path).
 *
 * @param {Element|null} node — the preview subtree just rewritten by syncDom.
 * @returns {number} the number of fences restored from cache (0 → nothing to do).
 */
function restoreMermaid(node) {
  if (!node || !node.querySelectorAll) return 0;
  const blocks = Array.from(node.querySelectorAll("pre > code.language-mermaid"));
  let n = 0;
  for (const code of blocks) {
    const pre = code.closest ? code.closest("pre") : code.parentNode;
    // Same stale guard as renderMermaidInNode: only replace when `pre` is
    // still attached inside `node`. restoreMermaid is synchronous so the
    // window is tiny, but the check is free.
    if (!pre || !pre.isConnected || !node.contains(pre)) continue;
    const text = code.textContent;
    const entry = _svgCache.get(text);
    if (!entry || !entry.svg) continue;
    const holder = document.createElement("div");
    holder.className = "mermaid-diagram";
    holder.innerHTML = entry.svg;
    installMermaidStyles(holder);
    if (pre && pre.parentNode) pre.parentNode.replaceChild(holder, pre);
    if (entry.bindFunctions) { try { entry.bindFunctions(holder); } catch { /* ignore: interactive add-on failed */ } }
    n++;
  }
  return n;
}

/**
 * mermaidSourceKey — build a per-document "did any mermaid source change" key.
 *
 * Walks the raw markdown with a lenient fence regex (``` or ~~~, 3+ chars,
 * "mermaid" as the info-string language followed by an optional info string,
 * lazy body up to a matching closing fence of the same kind on its own line)
 * and returns a string that is a stable fingerprint of every mermaid fence
 * body in the doc. Two docs with the same set of mermaid bodies (same order)
 * produce the same key even if the surrounding prose differs; a change to any
 * body (or the set of bodies) produces a different key. Non-mermaid fences
 * (e.g. `javascript`) are ignored. Empty string when the doc has no mermaid
 * fences. Not a full CommonMark parser — the goal is a cheap "did it change"
 * fingerprint, not strict fence parsing, so it errs on including a bit more
 * than a real parser would (a harmless extra cache-miss render, never fewer).
 *
 * @param {string} md — the raw Markdown source of a tab.
 * @returns {string} the fingerprint (or "" when there are no mermaid fences).
 */
function mermaidSourceKey(md) {
  if (!md) return "";
  const re = /(?:^|\n)(?:`{3,}|~{3,})[ \t]*mermaid(?:[ \t][^\n]*)?\n([\s\S]*?)(?:\n)(?:`{3,}|~{3,})[ \t]*(?=\n|$)/g;
  const parts = [];
  let m;
  while ((m = re.exec(md))) parts.push(m[1]);
  return parts.join("\x00");
}

/**
 * scheduleMermaidRender — debounce-render mermaid inside `d.preview`, but ONLY
 * if at least one mermaid fence's source actually changed since the last
 * schedule.
 *
 * `syncDom` runs on every keystroke; this gate checks the fingerprint of every
 * mermaid body in the doc and bails out early when the key is unchanged. That
 * is the anti-flicker invariant: typing in prose outside a mermaid fence never
 * touches `d.__mmTimer` (so no pending render, no `mermaid.render`, no flash).
 * When the key DID change, it arms the 120 ms debounce (unchanged from before).
 * Note: the gate is only about *scheduling* — `restoreMermaid` (called
 * separately in syncDom) handles the synchronous cache-restore pass.
 *
 * @param {object} d — a per-tab state bag; the fn reads/writes `d.__mmTimer`
 *   and `d.__mmLastKey`, and renders into `d.preview`.
 */
function scheduleMermaidRender(d) {
  const key = mermaidSourceKey(d.input ? d.input.value : "");
  if (key === d.__mmLastKey) return; // no mermaid source change → no render, no flicker
  d.__mmLastKey = key;
  if (d.__mmTimer) clearTimeout(d.__mmTimer);
  d.__mmTimer = setTimeout(() => { d.__mmTimer = 0; renderMermaidInNode(d.preview).catch(() => {}); }, 120);
}

export { mermaidTheme, renderMermaidSvg, renderMermaidInNode, renderMermaidInHtml, restoreMermaid, scheduleMermaidRender };
