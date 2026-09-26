/**
 * find.js — floating, non-modal Find & Replace bar for the active editor tab.
 *
 * Why NOT a modal: the centered modal primitives (dialogs.js) trap focus and
 * block editing. A find bar must let the user keep the editor context while
 * searching (VS Code-style), so this is an absolutely-positioned panel inside
 * the workspace (which is already `position:relative`), revealed by the `.open`
 * class. Esc closes it; a centered modal (`.savedlg-backdrop`) always outranks
 * it — the bar stands down while one is open.
 *
 * Contracts (pinned by test/verifyFind.mjs, run with `npm run verify-find`):
 *  - The ACTIVE tab's textarea is the only search target; switching tabs
 *    recomputes the match list against the new document (count follows).
 *  - Matching is literal by default (the query is regex-ESCAPED and run as a
 *    global RegExp — regex `exec` reports `m.index` on the ORIGINAL string, so
 *    case-folding length quirks like "İ".toLowerCase() can never corrupt the
 *    match offsets) with an Aa case toggle; `.*` switches to raw regex mode.
 *    An invalid regex paints the find input red and the count says so — never
 *    a thrown exception, never a modal.
 *  - Navigation (Enter/F3 next, Shift+Enter/Shift+F3 prev) WRAPS around and
 *    selects the match in the textarea. The layout quirk this module exists
 *    for: the textarea is `overflow:hidden` inside the scrolling
 *    `.editor-scroll` container, so the engine does NOT scroll the caret into
 *    view when the textarea is unfocused. revealOffset() therefore walks the
 *    overlay's text nodes (the overlay is a lossless re-render of the source —
 *    the round-trip invariant guarantees offsets line up) to measure the
 *    match's y position and writes `.editor-scroll.scrollTop` itself, stamping
 *    the value-based echo guard (`__suppE`) so the programmatic scroll cannot
 *    be mistaken for a user scroll and ratchet the preview pane (the same
 *    convention setMode/toggleTheme use).
 *  - The current match is always SELECTED: every user-driven query change
 *    (typing in the find field, the Aa/.* toggles, opening the bar) follows
 *    recompute() with revealCurrent(), so the count `i/n` always corresponds
 *    to visibly selected text on screen. Editor TYPING while the bar is open
 *    updates the count but does not yank the selection/scroll away from the
 *    line being edited.
 *  - Focus discipline: navigation and replace KEEP focus in the bar (rapid
 *    Rep-Rep-Rep works; the selection still paints in Chromium/WebKit even
 *    unfocused). Because an unfocused textarea paints NO caret glyph, the bar
 *    paints a synthetic blinking `.find-caret` inside the active tab's
 *    `.editor-col` at the current match's end (updateCaret, called from every
 *    count update + a document focusin listener), and hides it the instant
 *    the editor textarea itself is focused — the real caret takes over.
 *    Opening the bar (Ctrl+F / the menu item) focuses the find
 *    input and pre-fills it from a single-line selection.
 *  - Replace = ONE undo step (`commit("replace", …)`); Replace-all = ONE undo
 *    step for the whole batch (`commit("replace all N", …)`). In regex mode
 *    `$1`…`$9` group substitutions are honored (`$$` is a literal dollar).
 *  - Esc is TWO-layered. With the bar OPEN: close it and STAY PUT — the
 *    found word stays highlighted, the view exactly where the search left
 *    it (restoring the pre-open selection would jump the page back — the
 *    reported Esc-jump bug). With the bar CLOSED: the GLOBAL Escape handler
 *    in markdown.js clears any selected text (find.js owns Esc only while
 *    the bar is open — the global handler stands down via `find.isOpen()`;
 *    pressing Esc a second time after closing the bar is what deselects).
 *  - The bar never mutates text on its own while closed.
 */

/** MAX_MATCHES — hard cap on tracked matches so a pathological document (or a
 * `a*`-style regex) can never wedge the UI. Navigation/count simply stop at
 * the cap; the user sees the cap number and can still narrow the query. */
const MAX_MATCHES = 20000;

/**
 * escRe — escape every RegExp metacharacter so a literal query matches itself.
 * @param {string} s — the raw query.
 * @returns {string} The regex-source-safe escape of `s`.
 */
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * createFindHandlers — build the Find & Replace bar and its actions.
 * @param {object} deps App-owned state and persistence callbacks.
 * @param {Function} deps.getActiveDoc Return the active tab document.
 * @param {Function} deps.commit Commit a text change as ONE undo step
 *   `(label, to, selS, selE)` — supplied by history.js via markdown.js.
 * @param {Element} deps.workspace The workspace element (position:relative)
 *   the bar is appended to.
 * @param {number} deps.echoMs The echo-suppression deadline (ECHO_MS) used
 *   when stamping programmatic scroll writes.
 * @param {Function} [deps.followFromEditor] Optional split-view hook: called
 *   after the bar has programmatically repositioned the editor pane so the
 *   preview pane follows to the corresponding position (markdown.js drives it
 *   through the block-anchored followScroll machinery, stamping its own echo
 *   guard). A no-op outside split view; absent in tests that don't need it.
 * @returns {{open: Function, close: Function, toggle: Function, step: Function, replaceOne: Function, replaceAll: Function, noteTextChanged: Function, isOpen: Function}} Find actions.
 */
export function createFindHandlers({ getActiveDoc, commit, workspace, echoMs, followFromEditor }) {
  let bar = null;            // lazily built .findbar element
  let visible = false;
  let regexMode = false;
  let caseSensitive = false;
  let matches = [];          // [{start, end, caps: string[]|null}]
  let idx = -1;              // current match index into matches
  let error = "";            // non-empty → invalid regex (bad pattern)
  let lastDoc = null;        // doc the match list was computed against
  let openText = null;       // editor value when the bar opened (close-restore)
  let openSel = null;        // editor selection when the bar opened
  let searchEl = null, replaceEl = null, countEl = null;
  let caretEl = null;    // the synthetic blinking caret (see ensureCaret)
  let matchWrap = null;  // overlay highlight container (see ensureMatchWrap)

  /**
   * ensureBar — build the bar DOM once and wire its listeners.
   * Buttons/text glyphs are plain text (the bar is a panel, not a toolbar
   * button — the constant-width SVG rule only governs the toolbar).
   */
  function ensureBar() {
    if (bar) return;
    bar = document.createElement("div");
    bar.className = "findbar";
    bar.setAttribute("role", "search");
    bar.setAttribute("aria-label", "Find and replace");
    bar.innerHTML = `
      <div class="find-row">
        <input class="finput" data-f="find" type="text" placeholder="Find" spellcheck="false" aria-label="Find">
        <span class="fcount" aria-live="polite">0/0</span>
        <button class="fbtn" data-fa="prev" type="button" title="Previous match — Shift+Enter">&uarr;</button>
        <button class="fbtn" data-fa="next" type="button" title="Next match — Enter">&darr;</button>
        <button class="fbtn" data-fa="close" type="button" title="Close — Esc">&times;</button>
      </div>
      <div class="find-row">
        <button class="fbtn fopt" data-fo="case" type="button" title="Match case" aria-pressed="false">Aa</button>
        <button class="fbtn fopt" data-fo="regex" type="button" title="Regular expression" aria-pressed="false">.*</button>
        <input class="finput finput-re" data-f="replace" type="text" placeholder="Replace with" spellcheck="false" aria-label="Replace with">
        <button class="fbtn" data-fa="replace" type="button" title="Replace current match">Rep</button>
        <button class="fbtn" data-fa="replaceall" type="button" title="Replace all matches">All</button>
      </div>`;
    workspace.appendChild(bar);
    searchEl = bar.querySelector('[data-f="find"]');
    replaceEl = bar.querySelector('[data-f="replace"]');
    countEl = bar.querySelector(".fcount");

    // A click ANYWHERE can move focus in/out of the editor textarea — the
    // highlight + synthetic caret must hand off to the real selection/caret
    // (and back) instantly.
    document.addEventListener("focusin", paintAll);

    // Bar-local keys: Enter/Shift+Enter navigate; Esc closes (and stops the
    // document-level Escape handler from doing it twice). F3 is deliberately
    // NOT handled here — the document-level listener owns it so it also works
    // while focus sits in the editor with the bar open.
    bar.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(); return; }
      if (ev.key === "Enter" && !ev.ctrlKey && !ev.metaKey && !ev.altKey &&
          (ev.target === searchEl || ev.target === replaceEl)) {
        ev.preventDefault();
        step(ev.shiftKey ? -1 : 1);
      }
    });
    bar.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button");
      if (!btn) return;
      const fa = btn.getAttribute("data-fa");
      const fo = btn.getAttribute("data-fo");
      if (fa === "close") close();
      else if (fa === "prev") step(-1);
      else if (fa === "next") step(1);
      else if (fa === "replace") replaceOne();
      else if (fa === "replaceall") replaceAll();
      else if (fo === "case") { caseSensitive = !caseSensitive; btn.setAttribute("aria-pressed", String(caseSensitive)); btn.classList.toggle("active", caseSensitive); recompute(); revealCurrent(); }
      else if (fo === "regex") { regexMode = !regexMode; btn.setAttribute("aria-pressed", String(regexMode)); btn.classList.toggle("active", regexMode); recompute(); revealCurrent(); }
    });
    // NOTE: a bare `recompute` here would receive the Event as its keepIdx
    // argument (truthy → the stale index survives a query edit). Always call
    // it with NO arguments — and follow with revealCurrent() so the current
    // match is SELECTED as the query changes (VS Code behavior).
    searchEl.addEventListener("input", () => { recompute(); revealCurrent(); });

    // Document-level keys while the bar is open. Escape uses capture so it
    // can close the bar even when focus is in the editor (the textarea's own
    // handlers never touch Escape); the modal guard keeps the bar from
    // competing with a centered dialog's own Escape.
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "F3" && visible) {
        ev.preventDefault();
        step(ev.shiftKey ? -1 : 1);
        return;
      }
      if (ev.key === "Escape" && visible) {
        if (document.querySelector(".savedlg-backdrop")) return;
        close();
      }
    }, true);
  }

  /**
   * computeMatches — every match of `query` in `text` as `{start,end,caps}`.
   * One RegExp path for both modes: literal queries are escaped first (see
   * module JSDoc for why exec's original-string index beats indexOf).
   * @param {string} text — the document text.
   * @param {string} query — the find query (may be empty).
   * @param {boolean} useRegex — treat `query` as a raw regular expression.
   * @param {boolean} caseSensitive — false folds case with the `i` flag.
   * @returns {{matches: Array<{start:number, end:number, caps:(string[]|null)}>, error: string}} Matches and an error message ("" when ok).
   */
  function computeMatches(text, query, useRegex, caseSensitive) {
    const out = [];
    if (!query) return { matches: out, error: "" };
    let re;
    try { re = new RegExp(useRegex ? query : escRe(query), caseSensitive ? "g" : "gi"); }
    catch { return { matches: out, error: "bad pattern" }; }
    let m, guard = 0;
    while ((m = re.exec(text)) !== null) {
      // Zero-length matches (e.g. regex `a*` on "b") are not selectable —
      // advance past them instead of looping forever.
      if (m[0].length === 0) { re.lastIndex++; if (re.lastIndex > text.length) break; continue; }
      out.push({ start: m.index, end: m.index + m[0].length, caps: m.length > 1 ? m.slice(1) : null });
      if (out.length >= MAX_MATCHES) break;
      if (++guard > MAX_MATCHES * 4) break; // paranoid bail for exotic patterns
    }
    return { matches: out, error: "" };
  }

  /**
   * expandReplacement — substitute `$n` capture groups into a replacement.
   * Literal mode replacements are verbatim (no `$` processing).
   * @param {string} repl — the replacement template.
   * @param {string[]|null} caps — the captured groups of the match (regex mode).
   * @returns {string} The concrete replacement text.
   */
  function expandReplacement(repl, caps) {
    if (!caps) return repl;
    return repl.replace(/\$(\d)|\$\$/g, (whole, d) => (whole === "$$" ? "$" : (caps[+d - 1] ?? "")));
  }

  /**
   * textPoint — the viewport rect of the collapsed caret at source `offset`,
   * measured on the overlay (which round-trips the source exactly, so text
   * node offsets line up with source offsets).
   * @param {object} d — the active doc.
   * @param {number} offset — the source offset to measure.
   * @returns {DOMRect|null} The collapsed rect, or null when unmeasurable.
   */
  function textPoint(d, offset) {
    const overlay = d.editor;
    let remaining = offset, node = null, nodeOffset = 0;
    const walker = document.createTreeWalker(overlay, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const len = t.nodeValue.length;
      if (remaining <= len) { node = t; nodeOffset = remaining; break; }
      remaining -= len;
    }
    if (!node) return null;
    const range = document.createRange();
    range.setStart(node, nodeOffset);
    range.collapse(true);
    const r = range.getBoundingClientRect();
    if (!r || !r.height) return null; // detached / zero-layout — nothing to do
    return r;
  }

  /**
   * revealOffset — scroll `.editor-scroll` so the source `offset` is visible.
   *
   * Measures the caret point with `textPoint` and writes the scroll
   * container's scrollTop — stamped with the echo guard so this programmatic
   * write can't be mistaken for a user scroll. Skips the write when the line
   * is already comfortably visible.
   *
   * SPLIT VIEW: when the editor pane actually moves, `followFromEditor`
   * (injected by markdown.js) drives the preview pane to the corresponding
   * position through the same block-anchored machinery a real editor scroll
   * uses — so a match revealed far down the document brings BOTH panes to it
   * (the reported gap: the preview used to sit still while the editor jumped
   * between hits). When the match is already comfortably visible the editor
   * doesn't move, and neither does the preview — preserving the sanctioned
   * end-of-document follower drift (invariant 14e) instead of re-correcting.
   * @param {object} d — the active doc.
   * @param {number} offset — the source offset to bring into view.
   */
  function revealOffset(d, offset) {
    const r = textPoint(d, offset);
    if (!r) return;
    const sc = d.editorScroll;
    const top = r.top + sc.scrollTop - sc.getBoundingClientRect().top;
    const margin = Math.min(120, sc.clientHeight / 4);
    if (top >= sc.scrollTop + margin && top <= sc.scrollTop + sc.clientHeight - margin) return;
    const max = sc.scrollHeight - sc.clientHeight;
    const target = Math.max(0, Math.min(top - sc.clientHeight / 3, max));
    // Stamp the value-based echo guard BEFORE the write (same convention as
    // followScroll/setMode): realScroll drops this pane's echo event because
    // the offset matches what we wrote, so this programmatic write never
    // flips the lead — the preview follow below is explicit, not an echo.
    d.__suppE = { deadline: performance.now() + echoMs, value: target };
    sc.scrollTop = target;
    if (followFromEditor) followFromEditor();
  }

  /**
   * ensureCaret — lazily create the synthetic caret element.
   *
   * WHY it exists: the bar deliberately keeps focus (so Enter keeps
   * navigating), and an UNFOCUSED textarea paints its translucent selection
   * wash but NO caret glyph — after opening the bar the editor caret
   * "disappears", which reads as lost position. This element is a 2px
   * blinking caret painted in the overlay column at the current match's END
   * (where the real caret logically sits, since the match is a forward
   * selection), shown ONLY while the editor textarea is NOT focused — the
   * moment the user clicks into the document the real caret takes over and
   * this hides. It is appended to the ACTIVE tab's `.editor-col` (a sibling
   * of the overlay, never inside it), so syncDom's innerHTML rewrites never
   * wipe it and it scrolls with the content.
   * @returns {Element} The caret element (created once per app run).
   */
  function ensureCaret() {
    if (caretEl) return caretEl;
    caretEl = document.createElement("div");
    caretEl.className = "find-caret";
    caretEl.style.display = "none";
    return caretEl;
  }

  /**
   * updateCaret — position (or hide) the synthetic caret after any state
   * change. Moves the element between tabs (one bar, one caret) and hides it
   * whenever there is nothing sensible to point at: bar closed, no match at
   * `idx`, regex error, or the editor textarea holding focus (its real
   * caret shows instead).
   */
  function updateCaret() {
    const d = getActiveDoc();
    const m = matches[idx];
    if (!visible || !d || !m || error || document.activeElement === d.input) { hideCaret(); return; }
    ensureCaret();
    const r = textPoint(d, m.end);
    const col = d.editor.parentNode;
    if (!r || !col) { hideCaret(); return; }
    const colRect = col.getBoundingClientRect();
    caretEl.style.left = (r.left - colRect.left) + "px";
    caretEl.style.top = (r.top - colRect.top) + "px";
    caretEl.style.height = r.height + "px";
    caretEl.style.display = "block";
    // appendChild MOVES the element between tabs — one bar, one caret, and
    // it always ends up inside the ACTIVE tab's editor column.
    if (caretEl.parentNode !== col) col.appendChild(caretEl);
  }

  /** hideCaret — park the synthetic caret out of sight (bar closed / editing). */
  function hideCaret() {
    if (caretEl) caretEl.style.display = "none";
  }

  /**
   * spanRects — viewport client rects for the source range [start, end),
   * measured on the overlay (a lossless re-render of the source, so source
   * offsets map onto its text nodes). Returns one rect per painted line
   * fragment, so a match that wraps (or spans lines) highlights every line
   * it touches.
   * @param {object} d — the active doc.
   * @param {number} start — the source offset of the range start.
   * @param {number} end — the source offset of the range end.
   * @returns {DOMRect[]} The non-empty client rects.
   */
  function spanRects(d, start, end) {
    const overlay = d.editor;
    const locate = (offset) => {
      let remaining = offset;
      const walker = document.createTreeWalker(overlay, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        const len = t.nodeValue.length;
        if (remaining <= len) return [t, remaining];
        remaining -= len;
      }
      return null;
    };
    const a = locate(start), b = locate(end);
    if (!a || !b) return [];
    const range = document.createRange();
    range.setStart(a[0], a[1]);
    try { range.setEnd(b[0], b[1]); } catch { return []; }
    return Array.from(range.getClientRects()).filter((r) => r.width > 0.5 && r.height > 0);
  }

  /**
   * ensureMatchWrap — lazily create the current-match highlight container.
   *
   * WHY this exists INSTEAD of relying on the textarea selection: the editor
   * text lives in the OVERLAY (the textarea's glyphs are transparent), and an
   * UNFOCUSED textarea does not reliably paint its `::selection` wash — on
   * WebKitGTK the match therefore appeared un-highlighted even though
   * `setSelectionRange` had selected it. This container paints one
   * `.find-match` rectangle per line fragment of the current match DIRECTLY
   * on the overlay, engine-independently, in the same translucent selection
   * color. Like the synthetic caret it is a sibling of the overlay inside
   * `.editor-col` (never inside it), so syncDom's innerHTML rewrites never
   * wipe it, and it scrolls with the content. It is hidden while the editor
   * itself holds focus — there the REAL selection wash paints (focused
   * selections always do), and double-painting would only muddy the tint.
   * @returns {Element} The wrapper (created once per app run).
   */
  function ensureMatchWrap() {
    if (matchWrap) return matchWrap;
    matchWrap = document.createElement("div");
    matchWrap.className = "find-match-wrap";
    matchWrap.style.display = "none";
    return matchWrap;
  }

  /**
   * updateMatch — paint (or hide) the current-match highlight after any
   * state change. Rebuilds the rect children each call (a match rarely spans
   * more than a couple of line fragments), moves the wrapper between tabs
   * (one bar, one highlight), and hides it on: bar closed, no current match,
   * regex error, or the editor textarea holding focus.
   */
  function updateMatch() {
    const d = getActiveDoc();
    const m = matches[idx];
    if (!visible || !d || !m || error || document.activeElement === d.input) { hideMatch(); return; }
    ensureMatchWrap();
    const col = d.editor.parentNode;
    const rects = spanRects(d, m.start, m.end);
    if (!col || !rects.length) { hideMatch(); return; }
    const colRect = col.getBoundingClientRect();
    // Rebuild children (a handful of divs — cheap, and handles wrapped
    // matches whose fragment count changes between updates).
    matchWrap.innerHTML = "";
    const MAX_RECTS = 64; // sane cap; a longer multi-line match highlights its head
    for (let i = 0; i < rects.length && i < MAX_RECTS; i++) {
      const r = rects[i];
      const el = document.createElement("div");
      el.className = "find-match";
      el.style.left = (r.left - colRect.left) + "px";
      el.style.top = (r.top - colRect.top) + "px";
      el.style.width = r.width + "px";
      el.style.height = r.height + "px";
      matchWrap.appendChild(el);
    }
    matchWrap.style.display = "block";
    if (matchWrap.parentNode !== col) col.appendChild(matchWrap);
  }

  /** hideMatch — park the current-match highlight (bar closed / editing). */
  function hideMatch() {
    if (matchWrap) matchWrap.style.display = "none";
  }

  /** paintAll — one funnel for every visual state change: the highlight
   *  rect(s) and the synthetic caret always agree with the current match. */
  function paintAll() {
    updateMatch();
    updateCaret();
  }

  /**
   * recompute — rebuild the match list from the active tab's current text.
   *
   * `keepIdx` tries to preserve the current match index across text changes
   * (replace flows); otherwise the index snaps to the match containing the
   * caret, else the first match at/after the caret, else the last match.
   * recompute() itself NEVER moves the editor selection — the callers that
   * represent a USER ACTION in the bar (query edit, Aa/.* toggle, open)
   * follow it with `revealCurrent()` so the current match is selected, while
   * editor-typing updates (`noteTextChanged`) intentionally do not, so the
   * caret/scroll stay where the user is editing.
   * @param {boolean} [keepIdx=false] Keep the current index when still valid.
   */
  function recompute(keepIdx = false) {
    if (!visible || !searchEl) return;
    const d = getActiveDoc();
    if (!d) { matches = []; idx = -1; error = ""; updateCount(); return; }
    if (d !== lastDoc) keepIdx = false; // a different tab: index is meaningless
    lastDoc = d;
    const res = computeMatches(d.input.value, searchEl.value, regexMode, caseSensitive);
    matches = res.matches;
    error = res.error;
    if (!matches.length) idx = -1;
    else if (!keepIdx || idx >= matches.length) {
      const caret = d.input.selectionStart;
      let i = matches.findIndex((m) => caret >= m.start && caret <= m.end);
      if (i === -1) {
        i = matches.findIndex((m) => m.start >= caret);
        if (i === -1) i = matches.length - 1; // caret after the last match
      }
      idx = i;
    }
    updateCount();
  }

  /** updateCount — paint the `i/n` count (or the regex error) into the bar,
   *  and repaint the match visuals (highlight + caret; every idx change
   *  funnels here). */
  function updateCount() {
    if (!countEl) return;
    countEl.textContent = error || `${matches.length ? idx + 1 : 0}/${matches.length}`;
    if (searchEl) searchEl.classList.toggle("err", !!error);
    paintAll();
  }

  /**
   * revealCurrent — select the CURRENT match in the editor.
   *
   * Called after every user-driven query change (typing in the find field,
   * Aa/.* toggles, opening the bar): the current match is immediately
   * SELECTED and scrolled into view, so the count `i/n` always corresponds
   * to highlighted text on screen (VS Code behavior). Deliberately NOT
   * called from noteTextChanged — editor typing while the bar is open must
   * not yank the caret/scroll away from the line the user is editing; there
   * the index follows the text but the selection stays put. A no-op without
   * a current match.
   */
  function revealCurrent() {
    if (matches.length && idx >= 0) reveal(idx);
    else updateCaret(); // no match to select — just refresh the caret state
  }

  /**
   * step — move to the next/previous match (wrapping) and reveal it.
   * @param {number} dir — +1 next, -1 previous.
   */
  function step(dir) {
    if (!visible) return;
    recompute();
    if (!matches.length) { idx = -1; updateCount(); return; }
    const next = ((idx === -1 ? 0 : idx + dir) + matches.length) % matches.length;
    reveal(next);
  }

  /**
   * reveal — select match `i` in the textarea, scroll it into view, update
   * the count. Does NOT steal focus (rapid keyboard navigation from the bar).
   * @param {number} i — index into `matches`.
   */
  function reveal(i) {
    const d = getActiveDoc();
    const m = matches[i];
    if (!d || !m) return;
    d.input.setSelectionRange(m.start, m.end, "forward");
    revealOffset(d, m.start);
    idx = i;
    updateCount();
  }

  /**
   * replaceOne — replace the currently selected match.
   * VS Code convention: if the selection is not exactly the current match,
   * the first click merely SELECTS that match; the next click replaces it
   * and advances to the following match. One undo step per replacement.
   */
  function replaceOne() {
    if (!visible) return;
    const d = getActiveDoc();
    if (!d) return;
    recompute();
    const m = matches[idx];
    if (!m) return;
    if (d.input.selectionStart !== m.start || d.input.selectionEnd !== m.end) {
      reveal(idx); // select it first; the next click (or Enter) replaces
      return;
    }
    const text = d.input.value;
    const repl = expandReplacement(replaceEl.value, m.caps);
    commit("replace", text.slice(0, m.start) + repl + text.slice(m.end), m.start + repl.length, m.start + repl.length);
    // The commit re-rendered the doc; rebuild the list and land on the match
    // that now occupies `idx` (the one after the removed one).
    recompute(true);
    if (matches.length) reveal(Math.min(idx, matches.length - 1));
    else { idx = -1; updateCount(); }
  }

  /**
   * replaceAll — replace every match in ONE undo step. Splices back-to-front
   * so recorded offsets stay valid (same discipline as math.js's placeholder
   * splicing). Regex `$n` substitutions apply per match.
   */
  function replaceAll() {
    if (!visible) return;
    const d = getActiveDoc();
    if (!d) return;
    recompute();
    if (!matches.length) return;
    const text = d.input.value;
    let out = text;
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      out = out.slice(0, m.start) + expandReplacement(replaceEl.value, m.caps) + out.slice(m.end);
    }
    const n = matches.length;
    commit("replace all " + n, out, d.input.selectionStart, d.input.selectionStart);
    recompute(true);
  }

  /**
   * open — show the bar (built on first use), pre-fill from a single-line
   * selection, recompute against the active tab, and focus the find (or
   * replace) input with its contents pre-selected for quick retyping.
   * @param {{focusReplace?: boolean}} [opts] Focus the replace field (Ctrl+H).
   */
  function open({ focusReplace = false } = {}) {
    ensureBar();
    visible = true;
    bar.classList.add("open");
    const d = getActiveDoc();
    openText = d ? d.input.value : null;
    openSel = d ? [d.input.selectionStart, d.input.selectionEnd] : null;
    if (d && openSel && openSel[1] > openSel[0]) {
      const picked = d.input.value.slice(openSel[0], openSel[1]);
      if (!picked.includes("\n")) searchEl.value = picked; // single-line only
    }
    recompute();
    revealCurrent(); // select the current match immediately (VS Code behavior)
    const el = focusReplace ? replaceEl : searchEl;
    el.focus();
    el.select();
  }

  /**
   * close — hide the bar and hand focus back to the editor, restoring the
   * selection the user had before opening — but ONLY if the text hasn't
   * changed since (a stale offset could land somewhere surprising).
   */
  /**
   * close — hide the bar and hand focus back to the editor.
   *
   * STAY-PUT: when a current match exists at close time (navigated to, or
   * auto-selected by the query), the pre-open restore is SKIPPED — the view
   * and the match selection stay exactly where the search left them, so the
   * found word remains highlighted with the editor focused (restoring the
   * pre-open selection would jump the page back — the "Esc jumps the page"
   * bug). With NO current match, the pre-open selection is restored — but
   * ONLY if the text hasn't changed since open (a stale offset could land
   * somewhere surprising). Clearing the selection is NOT close's job: the
   * GLOBAL Escape handler in markdown.js does that once the bar is closed
   * (Esc a second time = deselect).
   */
  function close() {
    if (!bar) return;
    // Capture BEFORE clearing: a current match at close time means the user
    // navigated to it (or the query auto-selected it) — the view is already
    // there, so SKIP the pre-open restore and keep the match selected.
    const hadMatch = !!(matches.length && idx >= 0 && matches[idx]);
    visible = false;
    bar.classList.remove("open");
    matches = [];
    idx = -1;
    lastDoc = null;
    hideMatch(); // the bar is gone — the editor's focus() below restores the real caret
    hideCaret();
    const d = getActiveDoc();
    if (d) {
      if (!hadMatch && openText !== null && d.input.value === openText && openSel) {
        d.input.setSelectionRange(openSel[0], openSel[1]);
      }
      d.input.focus();
    }
    openText = null;
    openSel = null;
  }

  /** toggle — open the bar when closed, close it when open (a future keybind). */
  function toggle() { if (visible) close(); else open(); }

  /**
   * noteTextChanged — notification hook that the active tab's text (or its
   * active-tab status) changed. markdown.js calls this from refresh(), which
   * every mutation path funnels through, so the live count stays honest
   * while the bar is open. A no-op while the bar is closed.
   */
  function noteTextChanged() {
    if (!visible) return;
    recompute(true);
  }

  /** isOpen — whether the bar is currently visible (tests / keybind routing). */
  function isOpen() { return visible; }

  return { open, close, toggle, step, replaceOne, replaceAll, noteTextChanged, isOpen };
}
