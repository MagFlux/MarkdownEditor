/**
 * scrollsync.js — block-anchored split-view scroll sync.
 *
 * WHY: the split view's two panes do NOT have proportional heights. The left
 * pane is the source text (monospace, one overlay line per source line — a
 * heading line is exactly one box tall), while the right pane renders the
 * Markdown as HTML (30px h1, reflowed paragraphs, KaTeX blocks, mermaid SVGs).
 * A linear scrollTop RATIO maps the extremes correctly but the middle drifts
 * badly: on a heading/table-rich document, scrolling the editor to 50% puts
 * the preview several sections past the same content. `followScroll` in
 * markdown.js used to do exactly that; it now delegates here.
 *
 * The map: for the ACTIVE document, lex it with the SAME `marked` instance the
 * preview renders with, and pair each top-level "solid" token with the
 * rendered child element of `.preview` at the same document index (heading /
 * paragraph / code / table / blockquote / hr / html → 1 element; a list →
 * items.length elements, because `collectEls` expands bare UL/OL lists into
 * their <li> children and marked renders list items as elements in order).
 * Counts agree by construction. On ANY disagreement (a raw-HTML block that
 * emitted a different element shape, an exotic shell, a mid-parse document)
 * every mapping call returns null and markdown.js falls back to the old
 * linear-ratio math — a wrong anchor is never silently used.
 *
 * The EDITOR side of the curve is a deliberate BUDGET model, not layout:
 *   edStart(i) = Σ(secAbove + ownLines) × EDITOR_LINE_PX over earlier anchors
 * (each source line is EXACTLY one overlay line — the editor never reflows
 * content-height per line box). The preview side comes from the LIVE rendered
 * offsets (getBoundingClientRect per paired element), measured lazily and
 * cheaply re-validated per scroll frame; a cache refresh keys on the text,
 * the pane's scroll extent, and a first-element position probe, so late
 * arrivals (mermaid's 120 ms debounce render), resizes and theme changes
 * invalidate it for the price of one getBoundingClientRect.
 *
 * Residual error is bounded by the slack inside ONE block and never
 * accumulates across the document: the interpolation inside an anchor's span
 * is anchored at its START, so tall-estimate drift cannot compound.
 */
import { marked } from "marked";

/** EDITOR_LINE_PX — the editor's fixed line box: 15px/23px monospace
 *  (src/style.css `.editor, .input`). Update both if that ever changes. */
export const EDITOR_LINE_PX = 23;

/**
 * createScrollSync — one mapping state per editor tab.
 *
 * Owns the anchor map (rebuilt only when the text changes) plus a cache of
 * the live preview's paired element offsets (validated + reused on use).
 * All methods are no-throw: any internal failure degrades to `mapOk=false` →
 * the caller uses ratio fallback.
 * @returns {object} {noteText, buildPairs, mapEdToPv, mapPvToEd, isOk, debug}
 */
export function createScrollSync() {
  let text = null;      // md the anchor map was built from
  let mapOk = false;    // false → every map call returns null (ratio fallback)
  let anchors = [];     // {sline, ownLines, edStart, edEndOwn}
  let elsRef = null;    // the live preview elements paired with `anchors`
  let elsText = null;   // the text the pair cache was accepted for
  let pairsCache = null;// [{top, bottom}] per anchor, in preview-content px
  let pairsPvMax = 0;   // pvScroll scroll max at cache time (cheap staleness probe)
  let _curveKey = "";   // "<text>|<clientWidth>" the curve was built for
  let _lineTops = null; // per-source-line measured content tops

  return { noteText, buildPairs, mapEdToPv, mapPvToEd, isOk: () => mapOk, debug };

  /**
   * noteText — (re)build the anchor map for `md`. Cheap (one lex + a linear
   * sweep); called from syncDom on every render. Text-identical calls are the
   * common path and do no work. Throws are swallowed (a lexer revision failing
   * on exotic input degrades to the ratio fallback, never an editor crash).
   * @param {string} md — the document text (empty is fine → mapOk=false).
   */
  function noteText(md) {
    if (md === text) return;
    text = md;
    elsText = null; // structural change invalidates the pair cache
    try { mapOk = build(md); } catch { mapOk = false; }
  }

  /**
   * build — lex `md`, locate every solid token in the source with a running
   * cursor + strict line-start checks (so repeated token text can never map a
   * later anchor to an earlier line). Anchors carry sline/ownLines only; the
   * editor-side curve (edStart/edEndOwn) is derived later per wrap state in
   * buildEdCurve, because a long source line wraps to SEVERAL 23px rows.
   * @param {string} md — document text.
   * @returns {boolean} true when a usable map was built.
   */
  function build(md) {
    if (!md || !md.trim()) return false;
    const toks = marked.lexer(md);
    const starts = [0];
    for (let at = md.indexOf("\n"); at !== -1; at = md.indexOf("\n", at + 1)) starts.push(at + 1);
    const list = [];
    let cursor = 0, prevLastLine = -1;

    /** push — append one anchor located at source offset `at` whose raw
     *  spans `own` content lines (trailing separator newlines already
     *  stripped by the caller). Fails (false) on any overlap with the
     *  previous anchor's span — the count/line agreement guarantee. */
    const push = (type, at, own) => {
      const line = lineOfAt(starts, at);
      if (line <= prevLastLine) return false; // would overlap the previous span
      list.push({ sline: line, ownLines: own, edStart: 0, edEndOwn: 0 });
      prevLastLine = line + own - 1;
      return true;
    };

    // NOTE: `build` expands BOTH list tokens (per item) and table tokens
    // (per row: header + separator as one anchor, then each body row) into
    // multiple anchors — `collectEls` expands each rendered <ul>/<ol> into
    // its <li> children and each <table> into its <tr> descendants, so the
    // anchor list must carry one anchor per rendered row element to keep
    // the counts aligned (and per-row alignment inside tables, whose rows
    // render at very different heights when text wraps).
    for (const t of toks) {
      if (t.type === "space") continue;
      // Locate the token's raw at/after the running cursor, strictly at a
      // line start (document order makes the first match the real one).
      let at = md.indexOf(t.raw, cursor);
      while (at !== -1 && at > 0 && md[at - 1] !== "\n") at = md.indexOf(t.raw, at + 1);
      if (at === -1) return false; // cannot locate → desync → ratio fallback
      const tLine = lineOfAt(starts, at);
      // A list renders as items.length elements; a table as 1 + rows.length
      // (the header <tr>; the source's separator line renders no element).
      // (An item/row whose position cannot be derived fails the whole map
      // → ratio fallback, never a wrong anchor.)
      let parts;
      if (t.type === "list" && t.items && t.items.length) {
        parts = t.items.map((it) => ({ raw: it.raw, type: "list_item" }));
      } else if (t.type === "table") {
        parts = [
          { line: tLine, own: 2, type: "table_header" }, // header + separator lines
          ...(t.rows || []).map((r, k) => ({ line: tLine + 2 + k, own: 1, type: "table_row" })),
        ];
      } else {
        parts = [{ raw: t.raw, type: t.type }];
      }
      for (let pi = 0; pi < parts.length; pi++) {
        const part = parts[pi];
        let found;
        if (part.line != null) {
          // Arithmetic position (table rows): must exist and stay in order.
          if (part.line >= starts.length) return false;
          found = starts[part.line];
        } else if (pi === 0) {
          found = at; // the first part IS located at the token start
        } else {
          found = md.indexOf(part.raw, cursor);
          while (found !== -1 && found > 0 && md[found - 1] !== "\n") found = md.indexOf(part.raw, found + 1);
          if (found === -1) return false; // item raw not locateable → fallback
        }
        let own;
        if (part.own != null) {
          own = part.own;
        } else {
          // A raw's TRAILING newline run is separator, not content: list-item
          // raws end with "\n" (tight) or "\n\n" (loose, the blank between
          // items). Strip that run so ownLines counts the item's real lines
          // and the NEXT anchor's line is never inside this anchor's span —
          // that overlap would fail the map (see push's guard).
          const trail = part.raw.length - part.raw.replace(/\n+$/, "").length;
          own = Math.max(1, (part.raw.match(/\n/g) || []).length + 1 - trail);
        }
        if (!push(part.type, found, own)) return false;
        cursor = found + Math.max(1, part.raw ? part.raw.length : 1);
      }
    }
    if (!list.length) return false;
    anchors = list;
    return true;
  }

  /**
   * buildPairs — accept a DOM snapshot of the preview and measure the
   * per-anchor offsets. Reuses the cache when the text, the pane's scroll
   * extent and the first element's position are all unchanged; re-measures
   * fully (a few dozen getBoundingClientRect reads, no interleaved writes)
   * otherwise — that is the invalidation for late mermaid renders, resizes
   * and re-renders. Also (re)measures the editor curve when the text or the
   * pane width changed (see measureLineTops).
   * @param {HTMLElement} preview — the `.preview` content wrapper.
   * @param {HTMLElement} pvScroll — the `.preview-scroll` viewport.
   * @param {HTMLElement} [editorEl] — the `.editor` overlay (curve probe).
   * @param {HTMLElement} [edScroll] — the `.editor-scroll` viewport.
   * @returns {{pairs: Array<{top:number,bottom:number}>, pvMax: number}|null}
   *   The pair table plus the preview scroll max (content px), or null when
   *   the counts disagree / the pane is hidden (→ ratio fallback).
   */
  function buildPairs(preview, pvScroll, editorEl, edScroll) {
    if (!mapOk || !preview || !pvScroll) return null;
    if (pvScroll.clientHeight <= 0 || preview.clientWidth <= 0) return null; // hidden pane
    const pvMax = pvScroll.scrollHeight - pvScroll.clientHeight;
    const base = contentBase(preview, pvScroll);
    if (base == null) return null;
    if (pairsCache && elsText === text && pairsPvMax === pvMax) {
      // Cheap staleness probe: the cached node must still be IN this preview
      // (syncDom rewrites innerHTML — old refs are dead) and still sit where
      // we recorded it.
      const el0 = elsRef && elsRef[0];
      if (el0 && el0.isConnected && preview.contains(el0)) {
        const r = el0.getBoundingClientRect();
        if (r && Math.abs(r.top - base - pairsCache[0].top) <= 1) {
          ensureEdCurve(editorEl, edScroll);
          return { pairs: pairsCache, pvMax };
        }
      }
    }
    const els = collectEls(preview);
    if (els.length !== anchors.length) return null; // count desync → fallback
    const pairs = [];
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (!r) return null;
      pairs.push({ top: Math.round(r.top - base), bottom: Math.round(r.bottom - base) });
    }
    if (!pairsSane(pairs)) return null;
    elsRef = els;
    elsText = text;
    pairsCache = pairs;
    pairsPvMax = pvMax;
    ensureEdCurve(editorEl, edScroll);
    return { pairs, pvMax };
  }

  /* ---- editor-side measured curve ---- */

  /**
   * ensureEdCurve — (re)measure the editor's real per-line geometry when the
   * text or the pane width changed (see measureLineTops for the exactness
   * contract), then pin every anchor to its lines' measured positions.
   * No-throw: a failed measurement keeps any previous curve; maps degrade
   * gracefully.
   * @param {HTMLElement} [editorEl] — the `.editor` overlay element.
   * @param {HTMLElement} [edScroll] — the `.editor-scroll` viewport.
   */
  function ensureEdCurve(editorEl, edScroll) {
    if (!mapOk || !anchors.length || !text || !editorEl || !edScroll) return;
    if (editorEl.clientWidth <= 0 || editorEl.clientHeight <= 0) return; // hidden pane
    const key = text + "|" + editorEl.clientWidth;
    if (_curveKey === key && _lineTops) return;
    try {
      const m = measureLineTops(editorEl, edScroll, text);
      if (!m || !m.tops.length) return;
      _curveKey = key;
      _lineTops = m.tops;
      const n = m.tops.length - 1;
      for (const a of anchors) {
        a.edStart = m.tops[Math.min(a.sline, n - 1)];
        a.edEndOwn = m.tops[Math.min(a.sline + a.ownLines, n)];
      }
    } catch { /* keep any previous curve */ }
  }

  /**
   * mapEdToPv — editor scroll position → preview scrollTop target.
   * @param {number} y — the editor's top-of-viewport content position
   *   (scrollTop; the measured curve lives in the same content px).
   * @param {{pairs: Array, pvMax: number}} P — from buildPairs.
   * @returns {number|null} the target preview scrollTop, or null (fallback).
   */
  function mapEdToPv(yBudget, P) {
    if (!mapOk || !anchors.length) return null;
    const { pairs } = P;
    const i = findEdSeg(yBudget);
    if (i === -1) {
      // Before the first anchor: the lead-in (file-top blank lines) maps
      // proportionally onto the preview's own lead-in.
      const e0 = anchors[0].edStart;
      if (e0 <= 0) return 0;
      return clamp01(yBudget / e0) * pairs[0].top;
    }
    const a = anchors[i], p = pairs[i];
    if (yBudget < a.edEndOwn) {
      // Inside this anchor's own lines: interpolate across the rendered span.
      const f = clamp01((yBudget - a.edStart) / Math.max(1, a.edEndOwn - a.edStart));
      return p.top + f * (p.bottom - p.top);
    }
    if (i + 1 < anchors.length) {
      // The separator rows between this anchor's last content line and the
      // next anchor: interpolate across the rendered gap.
      const k = anchors[i + 1].edStart - a.edEndOwn;
      if (k <= 0) return p.bottom;
      const f = clamp01((yBudget - a.edEndOwn) / k);
      return p.bottom + f * Math.max(0, pairs[i + 1].top - p.bottom);
    }
    // After the last anchor: map proportionally into the preview's tail.
    const total = budgetTotal();
    const f = clamp01((yBudget - a.edEndOwn) / Math.max(1, total - a.edEndOwn));
    return p.bottom + f * Math.max(0, P.pvMax - p.bottom);
  }

  /**
   * mapPvToEd — preview scrollTop → editor scroll position target (inverse).
   * @param {number} y — the preview scroll offset in CONTENT px.
   * @param {{pairs: Array, pvMax: number}} P — from buildPairs.
   * @returns {number|null} the target in the curve's coordinate space (the
   *   caller subtracts the leading pad to get an editor scrollTop), or null.
   */
  function mapPvToEd(y, P) {
    if (!mapOk || !anchors.length) return null;
    const { pairs } = P;
    const i = findPvSeg(y, pairs);
    if (i === -1) {
      const t0 = pairs[0].top;
      if (t0 <= 0) return 0;
      return clamp01(y / t0) * anchors[0].edStart;
    }
    const a = anchors[i], p = pairs[i];
    if (y < p.bottom) {
      // Inside the rendered element: px → budget fraction (linear across the
      // element's rendered span, so scrolling stays continuous).
      const span = p.bottom - p.top;
      const f = span > 0 ? clamp01((y - p.top) / span) : 0;
      return a.edStart + f * (a.edEndOwn - a.edStart);
    }
    if (i + 1 < anchors.length) {
      const gap = pairs[i + 1].top - p.bottom;
      if (gap <= 0) return anchors[i + 1].edStart;
      const f = clamp01((y - p.bottom) / gap);
      const k = anchors[i + 1].edStart - a.edEndOwn;
      return a.edEndOwn + f * k;
    }
    const pvTail = Math.max(1, P.pvMax - p.bottom);
    const total = budgetTotal();
    const f = clamp01((y - p.bottom) / pvTail);
    return a.edEndOwn + f * (total - a.edEndOwn);
  }

  /** budgetTotal — the full editor budget height (all rows), or 0 before
   *  the curve is built (maps are only called with a fresh buildPairs). */
  function budgetTotal() {
    return _lineTops && _lineTops.length ? _lineTops[_lineTops.length - 1] : 0;
  }

  /** debug — expose internals so tests/diagnostics can read the map state. */
  function debug() {
    return {
      ok: mapOk, textLen: text ? text.length : -1, pairsBuilt: !!elsText,
      curveKey: _curveKey, lineTop0: _lineTops ? Math.round(_lineTops[0]) : null,
      totalBudget: _lineTops ? Math.round(_lineTops[_lineTops.length - 1]) : null,
      anchors: anchors.map((a) => ({ sline: a.sline, own: a.ownLines, edStart: Math.round(a.edStart), edEndOwn: Math.round(a.edEndOwn) })),
      pairs: pairsCache ? pairsCache.map((p) => ({ top: Math.round(p.top), bottom: Math.round(p.bottom) })) : null,
    };
  }

  /* ---- segment finders (binary search on the piecewise curve) ---- */

  /** findEdSeg — last anchor index with edStart ≤ y (-1 if before the first). */
  function findEdSeg(y) {
    let lo = 0, hi = anchors.length - 1, res = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (anchors[mid].edStart <= y) { res = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return res;
  }

  /** findPvSeg — last anchor whose element top ≤ y (-1 if before the first). */
  function findPvSeg(y, pairs) {
    let lo = 0, hi = pairs.length - 1, res = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[mid].top <= y) { res = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return res;
  }
}

/* ---- preview element map (pure, exported for tests) ---- */

/**
 * measureLineTops — the REAL content-y of every source line's first row,
 * measured from the editor overlay (the overlay is a glyph-faithful mirror
 * of the textarea, wraps included — same technique as find.js's caret
 * measurement, which walks the overlay's text nodes because the overlay
 * round-trips the source exactly).
 *
 * A Range is collapsed (then spanned) per source line and its rects give
 * the line's top; wrapped lines simply yield several rows and the NEXT
 * line's measured top is however far down the flow put it — no wrap model
 * at all, the browser's own layout is the curve.
 * @param {HTMLElement} editorEl — the `.editor` overlay div.
 * @param {HTMLElement} edScroll — the `.editor-scroll` viewport (content
 *   origin reference).
 * @param {string} md — the document text (line starts come from it).
 * @returns {{tops: number[], total: number}|null} content-y per line (and
 *   the content-y just past the last line) — null when the pane is hidden
 *   or the walk finds nothing.
 */
export function measureLineTops(editorEl, edScroll, md) {
  if (!editorEl || !edScroll || !md) return null;
  if (editorEl.clientWidth <= 0 || editorEl.clientHeight <= 0) return null; // hidden pane
  // (node, offset) resolver over the overlay's text nodes; concatenated
  // textContent === source (round-trip invariant), so source positions map
  // 1:1 onto (node, offset) pairs.
  const segs = [];
  (function walk(node) {
    for (const ch of node.childNodes) {
      if (ch.nodeType === 3) segs.push({ node: ch, text: ch.data });
      else if (ch.nodeType === 1) walk(ch);
    }
  })(editorEl);
  if (!segs.length) return null;
  const cum = [];
  let total = 0;
  for (const s of segs) { cum.push({ node: s.node, start: total, end: total + s.text.length }); total += s.text.length; }
  const resolve = (pos) => {
    if (pos <= 0) return { node: cum[0].node, offset: 0 };
    for (const c of cum) if (pos < c.end || (pos === c.end && c === cum[cum.length - 1])) {
      return { node: c.node, offset: Math.min(pos - c.start, c.node.data.length) };
    }
    const last = cum[cum.length - 1];
    return { node: last.node, offset: last.node.data.length };
  };
  const base = contentBase(editorEl, edScroll); // screen-y of content origin
  if (base == null) return null;
  const starts = [0];
  for (let at = md.indexOf("\n"); at !== -1; at = md.indexOf("\n", at + 1)) starts.push(at + 1);
  const tops = new Array(starts.length + 1);
  let prevTop = null;
  for (let i = 0; i < starts.length; i++) {
    const a = resolve(starts[i]);
    const endPos = i + 1 < starts.length ? starts[i + 1] : md.length;
    const b = resolve(endPos);
    const r = document.createRange();
    try {
      r.setStart(a.node, Math.min(a.offset, a.node.data.length));
      r.setEnd(b.node, Math.min(b.offset, b.node.data.length));
    } catch { tops[i] = prevTop != null ? prevTop + EDITOR_LINE_PX : 0; continue; }
    const rects = r.getClientRects();
    let top = prevTop != null ? prevTop + EDITOR_LINE_PX : base === null ? 0 : null;
    // The line's top = the FIRST rect's top (the range begins at the line's
    // first char). Fallback (no rects — should not happen): one row down.
    if (rects.length) top = rects[0].top - base;
    else if (prevTop != null) top = prevTop + EDITOR_LINE_PX;
    else top = 0;
    tops[i] = top;
    prevTop = top;
  }
  // Content-y just past the document (the last line's bottom): the overlay's
  // own content height minus its trailing pad is the exact end; measure via
  // a caret range at the very end of the text.
  const endRes = resolve(md.length);
  let totalY;
  try {
    const r = document.createRange();
    r.setStart(endRes.node, Math.min(endRes.offset, endRes.node.data.length));
    r.setEnd(endRes.node, Math.min(endRes.offset, endRes.node.data.length));
    const rects = r.getClientRects();
    totalY = rects.length ? rects[0].top - base : (prevTop != null ? prevTop + EDITOR_LINE_PX : 0);
  } catch { totalY = prevTop != null ? prevTop + EDITOR_LINE_PX : 0; }
  tops[starts.length] = totalY;
  return { tops, total: totalY };
}

/**
 * collectEls — the live preview elements (document order). Expands:
 *  - bare UL/OL lists into their <li> children (marked renders list ITEMS as
 *    elements in both shapes: a tight list is ONE <ul> holding them, a loose
 *    list is one <ul> per item), and
 *  - tables into their flattened <tr> descendants (thead's row, then each
 *    tbody row — the source's separator line renders no element of its own).
 * Mirrors what `build` counts via `elCountOf`.
 * @param {HTMLElement} preview — the `.preview` content wrapper.
 * @returns {Element[]} ELEMENT children in document order.
 */
export function collectEls(preview) {
  const out = [];
  for (const el of preview.children) {
    if (isExpandableList(el)) out.push(...el.children);
    else if (el.tagName === "TABLE") {
      for (const sec of el.children) {
        for (const tr of sec.children) if (tr.tagName === "TR") out.push(tr);
      }
    } else out.push(el);
  }
  return out;
}

/**
 * isExpandableList — does this element look like marked's list output?
 * A bare UL/OL (no className) whose element children are all LI. This is ALSO
 * the shape of a raw-HTML-block `<ul><li>` — harmless: its token anchors as
 * ONE element while this expands to N, the count check in `buildPairs`
 * FAILS, and the caller falls back to ratio (by design).
 * @param {Element} el — a child of `.preview`.
 * @returns {boolean} true when it should be expanded to its list items.
 */
function isExpandableList(el) {
  if (el.tagName !== "UL" && el.tagName !== "OL") return false;
  if (el.className) return false;
  const kids = el.children;
  for (let i = 0; i < kids.length; i++) if (kids[i].tagName !== "LI") return false;
  return kids.length > 0;
}

/**
 * contentBase — the screen-y of the preview's content origin, so an element's
 * CONTENT offset is `elRect.top − base` (constant across scroll positions —
 * both sides move together). base = pvScroll's border-box top (its content
 * origin at scrollTop 0) − the CURRENT scrollTop:
 *   screenY(c) = containerTop + (c − scrollTop)  →  c = screenY − containerTop + scrollTop
 * so subtracting `containerTop − scrollTop` converts any screen y to c.
 * `pairs[i]` values can then be compared with a preview scrollTop directly.
 * @param {HTMLElement} preview — the content wrapper (existence probed only).
 * @param {HTMLElement} pvScroll — the scroll viewport.
 * @returns {number|null} base, or null if unavailable.
 */
export function contentBase(preview, pvScroll) {
  if (!preview || !pvScroll) return null;
  const rect = preview.getBoundingClientRect();
  if (rect.height <= 0) return null;
  return pvScroll.getBoundingClientRect().top - pvScroll.scrollTop;
}

/**
 * elCountOf — how many top-level `.preview` elements ONE token renders to
 * (the mirror of what `collectEls` expands): 1, a list → one element per
 * `items` entry, a table → 1 header row + one element per data row.
 * @param {object} t — a marked token.
 * @returns {number} expected element count (0 for a degenerate list).
 */
export function elCountOf(t) {
  if (t.type === "list") return t.items && t.items.length ? t.items.length : 0;
  if (t.type === "table") return 1 + (t.rows ? t.rows.length : 0);
  return 1;
}

/** isBlankLine — is source line `i` (0-based) whitespace-only? */
function isBlankLine(md, starts, i) {
  const s = starts[i];
  const eol = md.indexOf("\n", s);
  return md.slice(s, eol === -1 ? md.length : eol).trim() === "";
}

/** lineOfAt — the 0-based line index containing char offset `at`. */
function lineOfAt(starts, at) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= at) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** pairsSane — offsets must be ordered and non-negative-ish (a wrapper's
 *  top padding makes the first pair start at ≥ 0; anything else is a shape
 *  we cannot trust). */
function pairsSane(pairs) {
  if (!pairs.length) return false;
  if (pairs[0].top < -1) return false;
  for (let i = 1; i < pairs.length; i++) if (pairs[i].top < pairs[i - 1].top) return false;
  return true;
}

/** clamp01 — clamp n into [0, 1]. */
function clamp01(n) { return n < 0 ? 0 : n > 1 ? 1 : n; }
