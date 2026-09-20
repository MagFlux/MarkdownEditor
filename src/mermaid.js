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
const _svgCache = new Map();      // (theme + source) -> {svg, bindFunctions}
const _inflight = new Map();      // (theme + source) -> Promise<{svg, bindFunctions}>
const _SVG_CACHE_MAX = 200;

/**
 * mmCacheKey — composite SVG-cache key: the mermaid THEME plus the fence
 * source. The theme MUST be part of the key: the sheet baked into the SVG
 * (and therefore every stamped presentation attribute) is theme-specific, so
 * a diagram rendered while the app was dark must not be reused after the
 * user toggles back to light (the "light app, dark diagrams" state — exactly
 * the Windows/Linux mismatch report). With the theme in the key, a toggle
 * makes every lookup miss and `scheduleMermaidRender` (whose fingerprint also
 * mixes the theme) re-arms, so diagrams re-render in the new theme.
 * @param {string} text — the mermaid fence source.
 * @returns {string} `<theme>\x00<source>`.
 */
function mmCacheKey(text) {
  return mermaidTheme() + "\x00" + text;
}

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
 * attrName — map a camelCase CSS property to its SVG presentation-attribute
 * name (`stroke-dasharray` stays lowercase; `strokeWidth` → `stroke-width`).
 * @param {string} prop — the CSS property name from a CSSStyleDeclaration.
 * @returns {string} the attribute name to stamp.
 */
function attrName(prop) {
  return prop.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
}

/**
 * stampSvgStyles — bake Mermaid's own generated CSS into presentation
 * attributes on the rendered SVG, parsed in pure JS.
 *
 * WHY: Mermaid v12 emits shape colors ONLY as `#id .selector{fill:...}` rules
 * inside the SVG's <style> block — the shapes carry no fill/stroke attributes.
 * On Windows WebView2 that block can fail to apply (solid-black flowchart
 * nodes, invisible sequence messages whose inline stroke="none" then wins),
 * while on WebKitGTK it applies fine. Any fix must therefore be a no-op where
 * the stylesheet works and a faithful re-application of THE SAME RULES where
 * it doesn't. Hand-written per-shape fallbacks change selector precedence and
 * broke valid diagrams on Linux — this does not guess: it parses Mermaid's own
 * stylesheet directly in JS (NO CSSOM) and re-issues every declaration as a
 * presentation attribute via setAttribute. Presentation attributes sit BELOW
 * all author CSS in the cascade, so wherever the stylesheet applies, behavior
 * is pixel-identical; where it doesn't, the attributes carry the diagram.
 *
 * NO CSSOM: the Windows diagnostics (Ctrl+Shift+M) proved that on WebView2
 * `insertRule` rejected EVERY rule of the throwaway sheet (`cssom: parsed 0
 * rules`), so the engine path stamped nothing. JS parsing is deterministic on
 * every platform: brace-depth scan with quote handling (a naive `{` split
 * corrupts on declaration values that contain braces), skip @-rules, strip the
 * sheet's `#id` prefix from each comma-separated compound, skip `:root`/pseudo
 * rules (e.g. the `#id :root{--mermaid-font-family…}` custom-property rule,
 * meaningless outside the SVG), then split declarations on `;` and stamp each
 * `prop: value`. Idempotent: skips holders already stamped with the same
 * source text.
 *
 * @param {Element|null} holder — a `.mermaid-diagram` element containing one SVG.
 * @param {string} [src] — the mermaid source (cache key for idempotency).
 * @returns {number} the number of declarations stamped (0 → nothing to do).
 */
function stampSvgStyles(holder, src) {
  if (!holder || typeof document === "undefined") return 0;
  if (src && holder.__mmStamped === src) return 0;
  const svg = holder.querySelector && holder.querySelector("svg");
  const styleEl = svg && svg.querySelector("style");
  if (!svg || !styleEl || !styleEl.textContent) return 0;
  holder.__mmStamped = src || true;
  const css = styleEl.textContent;
  let stamped = 0;
  let i = 0;
  // Scan for top-level `selector{decls}` pairs. NOT a `{` split — values like
  // `rgba(232,232,232,0.8)` and quoted strings must not break the scan.
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open === -1) break;
    const selector = css.slice(i, open).trim();
    // Find the matching close brace, skipping any inside quoted strings.
    let depth = 1, j = open + 1, quote = null;
    while (j < css.length && depth > 0) {
      const ch = css[j];
      if (quote) { if (ch === quote && css[j - 1] !== "\\") quote = null; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}") depth--;
      j++;
    }
    if (depth !== 0) break; // unbalanced tail — stop
    const body = css.slice(open + 1, j - 1);
    i = j;
    if (!selector || selector.startsWith("@")) continue; // @keyframes etc. carry no shape styling
    for (const rawSel of selector.split(",")) {
      // Strip the unique `#svg-id` prefix Mermaid scopes every rule with.
      const local = rawSel.trim().replace(/^#[A-Za-z_][\w-]*/, "").trim();
      if (!local) continue; // the bare `#id{...}` root rule — skip
      // Skip anything still carrying a pseudo we can't match (incl. :root).
      if (/::|:root/.test(local)) continue;
      let targets;
      try { targets = svg.querySelectorAll(local); } catch { continue; } // invalid outside SVG scope
      if (!targets || !targets.length) continue;
      for (const decl of body.split(";")) {
        const colon = decl.indexOf(":");
        if (colon === -1) continue;
        const prop = decl.slice(0, colon).trim().toLowerCase();
        const val = decl.slice(colon + 1).trim();
        if (!prop || !val || prop.startsWith("--")) continue;
        const attr = attrName(prop);
        for (const el of targets) {
          // HTML labels (mermaid's foreignObject text) are NOT SVG shapes:
          // properties like text-align / color / background-color have no
          // presentation-attribute form, so setAttribute() would be ignored
          // and labels would render left-aligned with the wrong color when
          // the stylesheet fails (the "text not centered" report). For those
          // elements apply the declaration as an inline STYLE instead — the
          // exact value the sheet declares — but never clobber an inline
          // style mermaid itself set.
          if (!(el instanceof SVGElement)) {
            if (!el.style.getPropertyValue(prop)) {
              el.style.setProperty(prop, val);
              stamped++;
            }
            continue;
          }
          // SVG shapes: ALWAYS overwrite. Presentation attributes lose to
          // author CSS, so on platforms where the sheet applies (Linux)
          // nothing changes; where it doesn't, the attributes carry the
          // sheet's values — including replacing mermaid's own placeholders
          // (messageLine stroke="none") and inline defaults the sheet
          // overrides (sequence actor fill="#eaeaea" → the sheet's #ECECFF,
          // matching the Linux screenshot). Later matching rules overwrite
          // earlier ones, approximating the cascade's source order.
          el.setAttribute(attr, val);
          stamped++;
        }
      }
    }
  }
  return stamped;
}

/**
 * installMermaidStyles — make a freshly inserted diagram holder robust against
 * a platform that fails to apply the SVG-internal stylesheet.
 *
 * Two layers, both derived from Mermaid's OWN generated CSS (no hardcoded
 * theme values): (1) mirror the SVG <style> into a document-level <style>
 * scoped by the SVG's unique id — cheap, preserves the full cascade including
 * pseudo-elements and animations on engines that parse it; (2) stamp the
 * parsed rules onto the shapes as presentation attributes (see
 * stampSvgStyles) — survives even when NO <style> element in the document
 * applies, which is the observed WebView2 failure mode. Layer 2 uses only
 * presentation attributes, so on platforms where the stylesheet applies
 * (Linux/WebKitGTK) the result is pixel-identical either way.
 *
 * @param {Element|null} holder — a `.mermaid-diagram` element containing one SVG.
 * @param {string} [src] — the mermaid source, for the idempotency check.
 * @returns {void} nothing; missing DOM/style elements are ignored safely.
 */
function installMermaidStyles(holder, src) {
  if (!holder || typeof document === "undefined" || !document.head) return;
  const svg = holder.querySelector && holder.querySelector("svg");
  const source = svg && svg.querySelector("style");
  if (!svg || !source || !source.textContent) return;
  const id = svg.getAttribute("id");
  if (id) {
    const attr = `data-mermaid-style="${id}"`;
    let style = document.head.querySelector(`style[${attr}]`);
    if (!style) {
      style = document.createElement("style");
      style.setAttribute("data-mermaid-style", id);
      document.head.appendChild(style);
    }
    if (style.textContent !== source.textContent) style.textContent = source.textContent;
  }
  try { stampSvgStyles(holder, src); } catch { /* keep whatever applied so far */ }
  try { centerForeignObjectLabels(holder); } catch { /* keep whatever applied so far */ }
}

/**
 * centerForeignObjectLabels — vertically center each HTML label inside its
 * foreignObject when the content DOESN'T fill the allocated box.
 *
 * WHY (Windows label mis-centering, second layer): mermaid sizes every HTML
 * label box from getBBox MEASUREMENTS taken in the off-screen measure host;
 * on Windows the measured height can exceed the painted one-line content
 * (the Windows diagnostics dump showed ALL flowchart labels rendered into
 * 120x56 foreignObjects whose painted div is a single ~24px line — on Linux
 * the same diagram renders FO height 24/48 matching the content exactly).
 * Mermaid centers the FO on the shape, but the text sits at the TOP of the
 * oversized FO → the user sees the label floating high/off-center inside
 * its box, varying per label. The deterministic fix is engine-independent:
 * when the label's inner line-box height is less than 75% of the FO height,
 * switch the label div to a centered flex column — the text
 * then centers itself inside WHATEVER box mermaid allocated. On Linux the
 * content always fills the FO (single line 21-24px in a 24px FO, wrapped
 * 42px in 48px), so the 25% threshold never triggers there — a pure no-op.
 * Applied as inline styles, so it works even when every stylesheet fails.
 *
 * @param {Element|null} holder — a `.mermaid-diagram` element containing one SVG.
 * @returns {number} the number of labels re-centered (0 → nothing to do).
 */
function centerForeignObjectLabels(holder) {
  if (!holder || typeof document === "undefined" || !holder.querySelectorAll) return 0;
  let n = 0;
  holder.querySelectorAll("foreignObject").forEach((fo) => {
    const div = fo.firstElementChild;
    if (!div) return;
    // Measure the INNER text block (the <p>), not the div itself: some
    // engines stretch the root div/table to the foreignObject's full height
    // inside the FO (Chromium/WebView2 do; WebKit does not), so the div rect
    // can equal the FO height while the text inside still sits top-anchored.
    // The p's line-box height is the honest "painted content" measurement.
    const p = div.querySelector("p") || div.firstElementChild;
    const pH = (p || div).getBoundingClientRect().height;
    const fH = fo.getBoundingClientRect().height;
    if (!(fH > 0) || (fH - pH) < fH * 0.25) return; // content fills the box → nothing to do
    div.style.height = "100%";
    div.style.display = "flex";
    div.style.flexDirection = "column";
    div.style.alignItems = "center";
    div.style.justifyContent = "center";
    n++;
  });
  // PLAIN-TEXT actor/box labels (sequence diagrams): mermaid positions the
  // <text> with x = box CENTER and relies on text-anchor:middle to center
  // the glyphs (byTspan/byText inline-styles it or the sheet carries it).
  // On Windows that anchor is lost (computed textAnchor falls back to
  // "start"), so the text paints rightward FROM the center — the visible
  // "+halfTextWidth" right-shift. When the x coordinate coincides with the
  // sibling rect's center (within 4px) and the engine isn't already
  // middle-anchoring, pin text-anchor: middle inline — a no-op wherever the
  // anchor already works (start-anchored labels like notes put x at the box
  // LEFT edge, which is never the rect center, so they stay untouched).
  holder.querySelectorAll("text").forEach((txt) => {
    const g = txt.closest && txt.closest("g");
    if (!g || g.querySelector("foreignObject")) return;
    // The sibling shape may be a rect (actor box) or just the lifeline/arrow
    // <line>/<path> — the Windows dump showed actor labels hanging off a
    // class=null group whose only shape is a line; its bbox center is the
    // same x mermaid intended. Only x-coincidence (±4px) decides, so
    // start-anchored labels at a shape's LEFT edge (notes) never match.
    const shape = g.querySelector("rect, polygon, path, line, use");
    if (!shape) return;
    if (getComputedStyle(txt).textAnchor === "middle") return;
    const rs = shape.getBoundingClientRect();
    const dx = parseFloat(txt.getAttribute("x"));
    if (!isFinite(dx)) return;
    const rcx = rs.left + rs.width / 2;
    if (Math.abs(dx - rcx) > 4) return;
    // Comment on which shape: anchor=middle at x=center — no repositioning.
    txt.style.textAnchor = "middle";
    n++;
  });
  return n;
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
  // Composite (theme + source) key: a diagram rendered in the other theme is
  // NOT a hit — its baked-in sheet (and stamped attributes) are theme-specific.
  const key = mmCacheKey(text);
  // Cache hit — no render, no DOM, no timer. This is the fast path behind the
  // flicker fix: `restoreMermaid` walks the DOM and finds the holder already
  // in place with a cached SVG, so mermaid.render is never consulted again.
  const hit = _svgCache.get(key);
  if (hit) return hit;
  // In-flight share — two concurrent callers (e.g. tab A and the PDF export both
  // asking for the same source) collapse into one mermaid.render.
  const shared = _inflight.get(key);
  if (shared) return shared;
  const p = (async () => {
    const theme = mermaidTheme();
    // FONT CONSISTENCY (Windows label-centering fix): Mermaid v12 measures
    // label text with the DIAGRAM config's fontFamily default — flowchart/
    // sequence use '"trebuchet ms", verdana, arial, sans-serif' — but paints
    // it with themeVariables.fontFamily, whose v12 default is a DIFFERENT
    // stack ('"Recursive Variable", arial, sans-serif'; "Recursive Variable"
    // is not bundled/shipped, so the paint resolves to the next fallback).
    // On Windows BOTH faces exist (Trebuchet MS vs Arial) but their glyph
    // widths and ascent metrics differ, so labels overflow / sit off-center
    // inside boxes sized for the other font — horizontally OR vertically
    // depending on the glyphs ("no pattern"). On Linux every stack in both
    // lists is missing, so fontconfig resolves BOTH to one substitute and
    // the bug is invisible. Pinning fontFamily to the SAME stack both sides
    // use removes the mismatch (measure == paint on every platform).
    try { mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme, fontFamily: '"trebuchet ms", verdana, arial, sans-serif' }); } catch { }
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
      _cacheSvg(key, entry);
      return entry;
    } finally {
      try { container.innerHTML = ""; } catch { /* ignore */ }
      if (container.parentNode) container.parentNode.removeChild(container);
      const leftover = (typeof document !== "undefined" && document.getElementById) ? document.getElementById(id) : null;
      if (leftover && leftover.parentNode) leftover.parentNode.removeChild(leftover);
    }
  })();
  _inflight.set(key, p);
  try { return await p; }
  finally { _inflight.delete(key); }
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
    let out = _svgCache.get(mmCacheKey(text)) || { svg: "", bindFunctions: null };
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
    installMermaidStyles(holder, text);
    if (pre && pre.parentNode) pre.parentNode.replaceChild(holder, pre);
    // RE-CENTER HTML LABELS AFTER INSERTION: centerForeignObjectLabels (via
    // installMermaidStyles) measures the holder's rects, and every
    // getBoundingClientRect on a DETACHED holder returns 0. The
    // layout-dependent pass therefore must run here, with the holder live in
    // the document, or it is a silent no-op (the Windows off-center bug).
    try { centerForeignObjectLabels(holder); } catch { /* keep what applied */ }
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
    let svg = (_svgCache.get(mmCacheKey(src)) || {}).svg || "";
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
    const entry = _svgCache.get(mmCacheKey(text));
    if (!entry || !entry.svg) continue;
    const holder = document.createElement("div");
    holder.className = "mermaid-diagram";
    holder.innerHTML = entry.svg;
    installMermaidStyles(holder, text);
    if (pre && pre.parentNode) pre.parentNode.replaceChild(holder, pre);
    // Layout-dependent label re-centering can only run with the holder
    // attached (detached rects are all 0) — mirror renderMermaidInNode.
    // Must stay synchronous (after replaceChild, before returning) so the
    // anti-flicker contract holds: no async, no timers.
    try { centerForeignObjectLabels(holder); } catch { /* keep what applied */ }
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
  // Fingerprint = THEME + fence sources: a theme toggle must re-render the
  // diagrams even though no mermaid source changed (see mmCacheKey).
  const key = mermaidTheme() + "\x00" + mermaidSourceKey(d.input ? d.input.value : "");
  if (key === d.__mmLastKey) return; // no theme/source change → no render, no flicker
  d.__mmLastKey = key;
  if (d.__mmTimer) clearTimeout(d.__mmTimer);
  d.__mmTimer = setTimeout(() => { d.__mmTimer = 0; renderMermaidInNode(d.preview).catch(() => {}); }, 120);
}

export { mermaidTheme, renderMermaidSvg, renderMermaidInNode, renderMermaidInHtml, restoreMermaid, scheduleMermaidRender, installMermaidStyles, stampSvgStyles, centerForeignObjectLabels };
