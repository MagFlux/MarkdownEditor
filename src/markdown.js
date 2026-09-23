/**
 * markdown.js — the app shell: createApp() builds and wires the whole
 * multi-tab Markdown editor.
 *
 * Owns the createApp() closure — tabs, undo/redo, keybinds, save/open, drag
 * & drop, the window-close guard, in-app modals, toolbar actions, and session
 * persistence — plus the Tauri/IPC wiring (save/open/export, on-close, open
 * URL). Pure helpers (render, mermaid, format, paste), dialogs, and session
 * persistence live in their own
 * static-imported modules and are re-exported below so this file's public shape
 * is unchanged.
 *
 * IMPORTANT (invariants 2 & 8 in AGENTS.md): every @tauri-apps/* import below
 * and the static export imports in export.js must stay static — they have to
 * hoist into the single bundle the GTK webview can load. Never convert them to
 * a dynamic import(); a failed runtime chunk fetch silently disables
 * save/open, export, and the window-close guard.
 */
import * as icons from "./icons.js";
import { marked } from "marked";

/* Tauri integrations are imported STATICALLY (not dynamic import()).
   In the Tauri webview, code-split relative chunks loaded at runtime are
   unreliable under the custom protocol; a failed dynamic import would silently
   disable save/open AND the window-close guard. Static imports hoist these into
   the main bundle so they are always available. They are pure JS in a plain
   browser (they only touch window.__TAURI_INTERNALS__ when called), so importing
   them here is browser-safe. All uses below stay guarded by isTauri(). */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readTextFile as tauriReadTextFile, writeTextFile as tauriWriteTextFile, readDir as tauriReadDir, writeFile as tauriWriteFile, exists as tauriExists } from "@tauri-apps/plugin-fs";
import { homeDir as tauriHomeDir } from "@tauri-apps/api/path";

/* Export libraries — STATIC imports, same invariant as the Tauri plugins above:
   they must hoist into the single main bundle (no runtime code-split chunks),
   or the Tauri GTK webview fails to load them and export would silently die.
   Both are pure client-side JS (render to canvas / PDF bytes) with no native
   counterpart, so importing them in a plain browser is safe too. All uses stay
   guarded so the browser fallback (Blob download) still works under `vite preview`. */

/* Modules — pure helpers extracted into their own files (static imports only; they
   hoist into the same single bundle, same invariant as the Tauri imports above).
  src/markdown.js keeps the createApp closure + native/IPC wiring. */
import { highlightToHtml, isTableSep } from "./render.js";
import { scheduleMermaidRender, restoreMermaid } from "./mermaid.js";
import { renderMarkdown } from "./math.js";
import { lineBounds, wordAt, wordJump, detectFormat, trimmedSpan, wrapFor } from "./format.js";
import { mdFromHtml, mdTableFromHtml, mdCellText, mdInlineMd, mdStyleOf } from "./paste.js";
import { createExportHandlers } from "./export.js";
import { createSessionStore } from "./session.js";
import { createDialogHandlers } from "./dialogs.js";
import { createPathPicker } from "./picker.js";
import { createEditingHandlers } from "./editing.js";
import { createLinkHandlers } from "./links.js";
import { createHistoryHandlers } from "./history.js";

/* Re-exported so `markdown.js` keeps its public shape (test.mjs imports
   `highlightToHtml` from here; the app itself calls it from the closure). */
export { highlightToHtml, computeBlocks, lineToHtml, isTableSep, esc } from "./render.js";
export { renderMermaidInNode, renderMermaidInHtml, restoreMermaid, scheduleMermaidRender, installMermaidStyles, stampSvgStyles, centerForeignObjectLabels, stripSequenceShadows } from "./mermaid.js";
export { lineBounds, wordAt, wordJump, detectFormat, trimmedSpan, wrapFor } from "./format.js";
export { mdCellText, mdTableFromHtml, mdStyleOf, mdInlineMd, mdFromHtml } from "./paste.js";

marked.setOptions({ gfm: true, breaks: false });

/* ================= App factory (multi-tab, undo/redo, tabs, tabs, drag-drop, Tauri opener) ================= */
let uid = 0, docId = 0;

/** isTauri — true when running inside the Tauri webview (not a plain browser). */
function isTauri() {
  if (typeof window === "undefined") return false;
  // A Vite/bundler Tauri app injects `__TAURI_INTERNALS__` (this is where
  // __TAURI_INTERNALS__.invoke lives and where every plugin/API call in this
  // file goes through). `window.__TAURI__` only exists for the vanilla
  // withGlobalTauri setup, so checking that alone (as it once did) made every
  // native call silently fall through to its browser fallback in the real app —
  // e.g. save() used a blob download (ignored by WebKitGTK) and the window-close
  // guard never wired up. Detect the internals global first; also accept the
  // global-tauri marker for completeness. Never true in a plain browser.
  return !!(window.__TAURI_INTERNALS__ || window.__TAURI__);
}

/**
 * createApp — build and mount the entire editor UI into `root`.
 *
 * Creates the toolbar, tab strip, and split panes, defines every tab/lifecycle
 * function in the closure (tabs, save/open, undo/redo, formatting, scroll-sync,
 * keybinds, modals, session persistence), wires the Tauri IPC, and returns the
 * top-level app element. See AGENTS.md invariants 2/3/8 for the invariants the
 * code below relies on (static imports, close-handling, single-bundle).
 * @param {Element} root The container to mount into (e.g. `#app`).
 * @returns {Element} The root `.app` element.
 */
export function createApp(root) {
  const app = document.createElement("div");
  app.className = "app";
  app.dataset.mode = "split";
  root.innerHTML = "";
  root.appendChild(app);

  /* ---- toolbar ---- */
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";
  toolbar.innerHTML = `
    <span class="tb-left">
      <span class="menu-wrap">
        <button class="btn" data-action="menu" data-menu-open="false" title="More actions" aria-haspopup="true" aria-expanded="false">${icons.menu}</button>
        <div class="menu-dropdown" role="menu" aria-label="More actions">
          <button class="menu-item" data-menu="pdf" role="menuitem"><span class="mi-label">Export as PDF&hellip;</span></button>
          <button class="menu-item" data-menu="html" role="menuitem"><span class="mi-label">Export as HTML&hellip;</span></button>
        </div>
      </span>
      <span class="sep"></span>
      <button class="btn" data-action="undo" title="Undo — Ctrl+Z">${icons.undo}</button>
      <button class="btn" data-action="redo" title="Redo — Ctrl+Shift+Z / Ctrl+Y">${icons.redo}</button>
      <span class="sep"></span>
      <button class="btn" data-action="newtab" title="New tab — ctrl+click anywhere for new">${icons.plus}</button>
      <button class="btn" data-action="open" title="Open file into new tab">${icons.open}</button>
      <button class="btn" data-action="save" title="Save — Ctrl+S">${icons.save}</button>
    </span>
    <span class="tb-center">
      <button class="btn" data-fmt="bold" title="Toggle bold — Ctrl+B">${icons.bold}</button>
      <button class="btn" data-fmt="italic" title="Toggle italic — Ctrl+I">${icons.italic}</button>
      <button class="btn" data-fmt="underline" title="Toggle underline — Ctrl+U">${icons.underline}</button>
      <button class="btn" data-fmt="strike" title="Toggle strikethrough">${icons.strike}</button>
      <button class="btn" data-fmt="code" title="Toggle inline code">${icons.code}</button>
      <button class="btn" data-fmt="link" title="Insert / toggle link — Ctrl+K">${icons.link}</button>
      <span class="sep"></span>
      <button class="btn" data-block="h1">H1</button>
      <button class="btn" data-block="h2">H2</button>
      <button class="btn" data-block="h3">H3</button>
      <span class="sep"></span>
      <button class="btn" data-block="quote" title="Toggle blockquote">&rdquo;</button>
      <button class="btn" data-block="ul" title="Toggle bullet list">&bull;&thinsp;&mdash;</button>
      <button class="btn" data-block="ol" title="Toggle numbered list">1.</button>
      <span class="sep"></span>
      <button class="btn" data-block="table" title="Insert table">${icons.table}</button>
      <button class="btn" data-block="codeblock" title="Toggle code block">&lt;/&gt;</button>
      <button class="btn" data-block="mermaid" title="Insert Mermaid diagram">${icons.mermaid}</button>
      <button class="btn" data-block="math" title="Insert math block — $$ … $$">${icons.math}</button>
    </span>
    <span class="tb-right">
      <button class="btn" data-action="mode" title="View — click to cycle Split / Edit / Preview">
        <span class="mode-icon" aria-hidden="true">${icons.viewSplit}</span>
        <span class="mode-label">Split</span>
      </button>
      <button class="btn" data-action="theme" title="Toggle light / dark">${icons.theme}</button>
    </span>`;
  app.appendChild(toolbar);

  /* ---- tab bar ---- */
  const tabBar = document.createElement("div");
  tabBar.className = "tabbar";
  app.appendChild(tabBar);

  /* ---- workspace ---- */
  const workspace = document.createElement("div");
  workspace.className = "workspace";
  app.appendChild(workspace);

   /* ---- status bar ---- */
   const statusbar = document.createElement("div");
   statusbar.className = "statusbar";
   statusbar.innerHTML =
     `<span class="name">untitled</span><span class="sp"></span><span class="lc">Ln 1, Col 1</span><span class="wc">0 words &middot; 0 chars</span><span class="dirty"></span>`;
    app.appendChild(statusbar);

    const status = statusbar.querySelector(".name");
  const lc = statusbar.querySelector(".lc");
  const wc = statusbar.querySelector(".wc");
  const dirtyEl = statusbar.querySelector(".dirty");

  /* ---- tab model — DOM is source of truth; we sync editor + preview + status from it ---- */
  const TABS = [];
  let untitledCount = 0;
  let activeTab = null;
  let raf = 0, suppressInput = false;
  // Deadline (ms) bounding echo detection: realScroll drops a scroll event only
  // while the pane is still within ECHO_MS of the moment we last assigned it AND
  // its offset equals the value we wrote (± ECHO_EPS). So ECHO_MS guards against
  // a LATE async echo re-flipping __lead, not against delaying genuine user
  // scrolls — those land at a different offset and are accepted on the spot.
  // Keep it generous: older WebKitGTK (~2.28) delivers scrollTop-change events
  // noticeably later than Chromium/modern WebKit.
  const ECHO_MS = 800;
  // Tolerance (px) for "this scroll offset is the one we assigned" when telling
  // our programmatic echo apart from a real user scroll. A genuine scroll lands
  // >1px away and is never suppressed; only an exact (± rounding) echo is.
  const ECHO_EPS = 1;
  // Consecutive keystrokes within this window (ms) count as a SINGLE undo step.
  // A pause longer than this finalizes the step so Ctrl+Z reverts it as one unit.
  const COALESCE_MS = 500;
  // Armed briefly after a middle-click close so we can veto the spurious X11
  // primary-selection paste that would otherwise land in the newly focused tab.
  // Set to the timestamp the block expires; the capture-phase intercept below
  // rejects primary-selection pastes while now < midClosePasteBlock. The window
  // is short on purpose — just long enough to outlast the async X11 paste
  // delivery right after a close, so real user pastes are never affected.
  let midClosePasteBlock = 0;
  const MIDCLOSE_PASTE_BLOCK_MS = 400;
  // Capture-phase listener: runs before the textarea's own handlers, so it can
  // veto the paste and prevent the value mutation during the block window.
  document.addEventListener("beforeinput", (ev) => {
    if (ev.inputType === "insertFromPaste" && performance.now() < midClosePasteBlock) {
      ev.preventDefault();
    }
  }, true);
  // Native X11 primary-selection paste is also delivered as a "paste" event;
  // veto it the same way.
  document.addEventListener("paste", (ev) => {
    if (performance.now() < midClosePasteBlock) ev.preventDefault();
  }, true);

  /**
   * makeTab — build one editor tab (DOM + state) and register it in TABS.
   *
   * Creates the tab strip entry and the split editor/preview panes, wires the
   * source-of-truth textarea, sets the initial value (if any) and the typing-burst
   * baselines, then renders + binds it. Returns the doc object (the single source
   * of truth for that tab).
    * @param {string} [name] Tab title; defaults to the next "Untitled N" name.
   * @param {string} [text] Initial Markdown; omitted for a blank tab.
   * @returns {object} The doc object.
   */
  function makeTab(name, text) {
    const doc = {
      id: "t" + (++docId) + Date.now().toString(36),
      name: name || "Untitled",
      path: null,
      dirty: false,
      undo: [], redo: [],
    };

    const tab = document.createElement("div");
    tab.className = "tab";
    tab.innerHTML = `<span class="tname"></span><button class="tclose" title="Close" aria-label="Close tab">&times;</button>`;

    const pane = document.createElement("div");
    pane.className = "pane-group";
    pane.innerHTML = `
      <div class="pane pane-editor">
        <div class="editor-scroll"><div class="editor-col">
          <div class="editor md" aria-hidden="true" data-placeholder="Start writing Markdown&hellip;"></div>
          <textarea class="input" spellcheck="false" placeholder="Start writing Markdown&hellip;" aria-label="Markdown source"></textarea>
        </div></div>
      </div>
      <div class="pane pane-preview">
        <div class="preview-scroll"><div class="preview"></div></div>
      </div>`;

    doc.tab = tab;
    doc.pane = pane;
    doc.input = pane.querySelector(".input");
    doc.editor = pane.querySelector(".editor");
    doc.preview = pane.querySelector(".preview");
    doc.editorScroll = pane.querySelector(".editor-scroll");
    doc.previewScroll = pane.querySelector(".preview-scroll");

    workspace.appendChild(pane);
    tabBar.appendChild(tab);

    if (text !== undefined && text !== null) {
      suppressInput = true;
      doc.input.value = text;
      suppressInput = false;
    }
    doc.dirty = false;
    doc._typeBase = doc.input.value; // baseline for the next typing burst's "from"
    doc._lastVal = doc.input.value;  // input handler baseline: detect no-op events
    syncDom(doc);
    bind(doc);
    TABS.push(doc);
    return doc;
  }

  /** textOf — read the tab's current Markdown source from its textarea. */
  function textOf(d) { return d.input.value; }

  /**
   * syncDom — push the textarea value into the tab's DOM (render + chrome).
   *
   * Re-renders both the overlay (highlightToHtml) and the preview (marked),
   * SYNCHRONOUSLY restores any previously-rendered mermaid SVGs from cache
   * (so a keystroke outside a mermaid fence never flashes raw code — the
   * anti-flicker invariant), schedules a fresh mermaid render only if a
   * mermaid fence's source actually changed, and finally updates the
   * placeholder / dirty dot / tab name. This is the single source of the
   * visible state for a tab.
   * @param {object} d Doc being synced.
   */
  function syncDom(d) {
    const text = d.input.value;
    d.editor.innerHTML = highlightToHtml(text);
    d.preview.innerHTML = text.trim() ? renderMarkdown(text) : `<div class="empty">Nothing to preview yet&hellip;</div>`;
    if (text.trim()) {
      restoreMermaid(d.preview); // sync: put already-rendered SVGs back (no flicker)
      scheduleMermaidRender(d);  // async: render any NEW/changed diagram (gated by key)
    }
    d.editor.classList.toggle("placeholder", !text.trim());
    d.tab.classList.toggle("dirty", d.dirty);
    d.tab.querySelector(".tname").textContent = d.name;
    d.tab.setAttribute("title", d.name + (d.dirty ? " — unsaved" : ""));
  }

  // Track the value the app last WROTE (or user-typed) so we can tell real typing
  // apart from spurious no-op "input" events that WebKitGTK dispatches on focus in
  // some situations (e.g. after tab switch / window activation). A real keystroke
  // always ends with value ≠ d._lastVal; a no-op dispatch leaves it equal.
  /**
   * bind — attach all per-tab event listeners (input, selection, scroll, paste,
   * tab-strip actions, real-scroll sync) to one doc.
   *
   * Runs once per tab at creation. Each listener is guarded by `doc === activeTab`
   * so events from a hidden tab's panes don't leak into the active one. See the
   * selectionchange / realScroll convention notes in AGENTS.md for the WebKitGTK
   * quirks these handlers encode.
   * @param {object} doc The doc whose textarea/panes get wired.
   */
  function bind(doc) {
    doc.input.addEventListener("input", () => {
      if (suppressInput) return;
      const v = doc.input.value;
      if (v === doc._lastVal) return; // spurious / no-op input (WebKitGTK focus quirk)
      doc._lastVal = v;
      doc.dirty = true;
      if (doc === activeTab) {
        doc.redo.length = 0; // new user typing starts a fresh branch — drop the redo stack
        captureTypeSnapshot(doc);
        scheduleTypeSettle(doc);
        setUndoRedoState();
      }
      refresh();
    });
    doc.input.addEventListener("select", () => { if (doc !== activeTab) return; updateActiveStates(); updateStatus(doc); setUndoRedoState(); });
    // keyup covers caret moves made by arrow keys / Home / End that produce NO
    // "input" or "select" event (the select event is unreliable on WebKitGTK).
    doc.input.addEventListener("keyup", () => { if (doc === activeTab) { updateStatus(doc); updateActiveStates(); } setUndoRedoState(); });
    doc.input.addEventListener("keydown", onKeyDown);
    doc.input.addEventListener("blur", () => { if (doc === activeTab) updateActiveStates(); });
    // WebKitGTK escape hatch: if the engine runs Shift+Tab focus traversal
    // DESPITE our capture-phase preventDefault (the keydown reaches JS but the
    // GTK webview still moves focus), the blur lands within a couple hundred
    // ms of the stamp the capture handler wrote (__sTabAt). Pull focus — and
    // the caret — back into the textarea on the next macrotask; focusing it
    // also severs the traversal target the engine selected. Stands down for a
    // modal (its own focus trap owns Tab) so it can never yank out of a dialog.
    doc.input.addEventListener("blur", () => {
      doc.__sSel = [doc.input.selectionStart, doc.input.selectionEnd];
      if (Date.now() - (doc.__sTabAt || 0) > 250) return;
      setTimeout(() => {
        if (doc !== activeTab) return;
        if (document.querySelector(".savedlg-backdrop")) return;
        if (document.activeElement === doc.input) return;
        doc.input.focus();
        if (doc.__sSel) doc.input.setSelectionRange(doc.__sSel[0], doc.__sSel[1]);
      }, 0);
    });
    doc.input.addEventListener("mousedown", () => { if (doc !== activeTab) { activate(doc); } });
    doc.input.addEventListener("click", (ev) => {
      if (ev.ctrlKey || ev.metaKey) openAtCaret();
      else if (doc === activeTab) requestAnimationFrame(() => { if (doc === activeTab) { updateStatus(doc); updateActiveStates(); } });
    });
    // Mouse caret placement. On WebKitGTK the "select" event is unreliable (see
    // the select handler above) and "selectionchange" may not fire either, so we
    // also refresh on mouseup (always delivered) — after a frame so the selection
    // has settled. This is what makes the toolbar light up the instant you click
    // the caret onto formatted text, without having to *change* the text.
    doc.input.addEventListener("mouseup", () => {
      if (doc !== activeTab) return;
      requestAnimationFrame(() => { if (doc === activeTab) { updateStatus(doc); updateActiveStates(); } });
    });
    // Rich paste: if the clipboard carries an HTML fragment we can turn into
    // Markdown (a table, or a bold/italic/underline-wrapped span), commit it as
    // a single undo-able edit instead of dropping raw HTML into the textarea.
    // Plain-text pastes fall through to the browser's default insert, which is
    // exactly what we want.
    doc.input.addEventListener("paste", (ev) => {
      if (performance.now() < midClosePasteBlock) return; // mid-click-close guard
      if (doc !== activeTab) return;
      const html = ev.clipboardData && ev.clipboardData.getData && ev.clipboardData.getData("text/html");
      if (!html) return;
      const md = mdFromHtml(html);
      if (!md) return;
      ev.preventDefault();
      const a = doc.input.selectionStart, b = doc.input.selectionEnd;
      const text = doc.input.value;
      const to = text.slice(0, a) + md + text.slice(b);
      commit("paste", to, a + md.length, a + md.length);
    });
    doc.tab.querySelector(".tname").addEventListener("click", () => activate(doc));
    // Middle-click (button 1) closes the tab, like most editors/browsers.
    // preventDefault stops the browser's default autoscroll on middle mouse.
    // Guarding on button===1 means left/right clicks on the × button still work
    // via their own "click" handler (this one ignores them).
    //
    // X11/Linux quirk: a middle mouse click is ALSO the primary-selection paste
    // gesture. On WebKitGTK/X11 the OS delivers the primary selection to a
    // focused text input even when we preventDefault the mousedown, and the
    // delivery happens AFTER activate() has already refocused the next tab's
    // input. So the paste lands in the OTHER tab — which is why closing tab 2
    // with a middle-click made tab 1 pick up tab 2's text. We block this by
    // arming a short-lived "block paste from a middle-click close" flag here;
    // a capture-phase beforeinput listener (installed below per textbox)
    // rejects any insertFromPaste while that flag is set.
    doc.tab.addEventListener("mousedown", (ev) => {
      if (ev.button !== 1) return;
      ev.preventDefault();
      if (document.activeElement === doc.input) doc.input.blur();
      midClosePasteBlock = performance.now() + MIDCLOSE_PASTE_BLOCK_MS;
      closeTab(doc);
    });
    doc.tab.querySelector(".tclose").addEventListener("click", (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      closeTab(doc);
    });
    // A genuine user scroll on a pane makes the OTHER pane follow it. The trap
    // is that followScroll programmatically sets the follower's scrollTop, and
    // the scroll event that fires for that assignment reaches us ASYNCHRONOUSLY
    // (a queued task), so we must tell it apart from a real user scroll on the
    // same pane. We do it by VALUE, not by time alone: followScroll records
    // {deadline, value} per driven pane, and realScroll drops an event only
    // while it's still within the deadline AND at (≈) the value we assigned
    // (± ECHO_EPS). A genuine user scroll on that pane lands at a different
    // offset, so it passes the value check and is accepted immediately — fixing
    // the old bug where a blind time window delayed every real scroll on the
    // *other* pane for up to ECHO_MS after a lead flip. (A pure time window —
    // "the" prior approach — correctly suppressed the echo but also swallowed
    // every real scroll on the follow pane inside the window, which read as the
    // left/right lag.) Dropping the echo still matters: an echoed event flips
    // which pane is leading, and the ratio→pixel→ratio round-trip between two
    // panes of different heights ratchets the value down frame-by-frame — the
     // "keeps scrolling to the top" drift.
     /**
      * realScroll — handle a scroll event on one pane, suppressing programmatic
      * echos and flipping the lead to the pane the user actually scrolled.
      *
      * Value-based (not time-only): the event is an echo of our own assignment
      * only while its deadline is live AND the pane sits at (≈) the offset we
      * wrote; a genuine user scroll lands at a different offset and is accepted
      * immediately. On a real scroll it sets __lead and kicks the two-pane sync.
      * @param {string} letter "e" (editor) or "p" (preview); identifies the pane.
      */
     function realScroll(letter) {
      if (doc !== activeTab) return;
      const now = performance.now();
      const key = letter === "e" ? "__suppE" : "__suppP";
      const s = doc[key];
      // Echo of OUR assignment: within the deadline AND at ≈ the offset we
      // wrote. (scrollTop can be fractional; ECHO_EPS absorbs rounding.)
      const pane = letter === "e" ? doc.editorScroll : doc.previewScroll;
      if (s && s.deadline > now && Math.abs(pane.scrollTop - s.value) <= ECHO_EPS) return;
      doc.__lead = letter;
      kickScrollSync();
    }
    doc.editorScroll.addEventListener("scroll", () => realScroll("e", doc.editorScroll), { passive: true });
    doc.previewScroll.addEventListener("scroll", () => realScroll("p", doc.previewScroll), { passive: true });
  }

  /**
   * activate — make `doc` the active tab (switch, or no-op if already active).
   *
   * Short-circuits for an already-active tab (see verifyTabClick.mjs). For a
   * cross-tab switch it captures the LEAVING tab's scroll ratios while it is
   * still laid out, flips the active classes, focuses + refreshes the entering
   * tab, and — after two rAF ticks — re-asserts the entering tab's remembered
   * editor/preview scroll positions by ratio, stamping the value-based echo
   * guard on each pane (mirrors setMode / openAtTop). See verifyTabScroll.mjs.
   * @param {object} doc The tab to make active.
   */
  function activate(doc) {
    // Clicking a tab that is ALREADY active is a no-op. The old unconditional
    // input.focus() + refresh() below had two visible side effects on such a
    // click: (1) refocusing the textarea re-ran the browser's scroll-into-view
    // and could ratchet both panes off their current position (scroll jumped,
    // e.g. 90% → ~25%), and (2) refresh() → syncDom() rewrote the preview DOM
    // and re-did the debounced mermaid render (a mermaid diagram on that tab
    // visibly re-rendered on every click). Neither is needed when the tab is
    // already the active one, so short-circuit. Cross-tab switches (doc is a
    // different tab) fall through as below.
    if (doc === activeTab) return;
    // Capture the LEAVING tab's scroll RATIO while its panes are still laid out,
    // because hiding→reshowing resets scrollTop to 0; we store a ratio (not px)
    // since panes re-lay-out to a different height while hidden.
    if (activeTab) {
      /** ratio — a pane's scroll position as a 0..1 fraction of its scrollable range. */
      const ratio = (el) => { const m = el.scrollHeight - el.clientHeight; return m > 0 ? el.scrollTop / m : 0; };
      activeTab.__scrollE = ratio(activeTab.editorScroll);
      activeTab.__scrollP = ratio(activeTab.previewScroll);
    }
    activeTab = doc;
    for (const d of TABS) {
      d.pane.classList.toggle("active", d === doc);
      d.tab.classList.toggle("active", d === doc);
    }
    doc.input.focus();
    refresh();
    saveSessionSoon();
    // Restore the ENTERING tab's remembered position. The display:none→flex
    // reflow already zeroed its scrollTop (and refresh() re-laid-out the
    // content); after two rAF ticks — once that reflow + the focus auto-scroll
    // have settled — put both panes back to their stored ratios. Stamp the
    // value-based echo guard on each pane so restoring a pane can't be misread
    // as a user scroll and kick off the lead/ratchet sync (mirrors setMode and
    // openAtTop). The guard skips a stale restore if the active tab changed
    // again inside the rAF window (a fast A→B→A tap). Tabs with no remembered
    // position (a brand-new tab, or one freshly opened at top) skip this and
    // stay at the top, exactly as before.
    if (doc.__scrollE != null || doc.__scrollP != null) {
      const eKeep = doc.__scrollE || 0;
      const pKeep = doc.__scrollP || 0;
      /** apply — re-assert the entering tab's remembered scroll ratios after the reflow settles. */
      const apply = () => {
        if (doc !== activeTab) return;
        const targets = [[doc.editorScroll, eKeep, "__suppE"], [doc.previewScroll, pKeep, "__suppP"]];
        for (const [sc, keep, key] of targets) {
          const max = sc.scrollHeight - sc.clientHeight;
          if (max <= 0) continue;
          const value = keep * max;
          doc[key] = { deadline: performance.now() + ECHO_MS, value };
          sc.scrollTop = value;
        }
        doc.__lead = null; // a programmatic restore is not a user scroll
      };
      requestAnimationFrame(() => { requestAnimationFrame(apply); });
    }
  }

  // A freshly opened tab must always read from the top. Without this, focusing
  // the textarea (caret at the end of the restored text) plus the 32vh bottom
  // overlay padding lets the webview park the scroll at the bottom.
  /**
   * openAtTop — park a freshly opened tab at the very top of both panes.
   *
   * Resets both scrollTop values and the caret to 0, stamping the value-based
   * echo guard on each pane so the resulting scroll events read as programmatic
   * echoes and can't flip the two-pane lead / ratchet sync. Re-asserts once
   * after rAF so it survives the initial reflow.
   * @param {object} doc The tab to align to top.
   */
  function openAtTop(doc) {
    // Mark our programmatic resets as echoes so the resulting scroll events are
    // treated as our own (≈scrollTop 0) and can't kick off the two-pane sync.
    doc.__suppE = { deadline: performance.now() + ECHO_MS, value: 0 };
    doc.__suppP = { deadline: performance.now() + ECHO_MS, value: 0 };
    doc.editorScroll.scrollTop = 0;
    doc.previewScroll.scrollTop = 0;
    doc.input.setSelectionRange(0, 0);
    requestAnimationFrame(() => {
      doc.__suppE = { deadline: performance.now() + ECHO_MS, value: 0 };
      doc.__suppP = { deadline: performance.now() + ECHO_MS, value: 0 };
      doc.editorScroll.scrollTop = 0;
      doc.previewScroll.scrollTop = 0;
    });
  }

  /** renderTabs — recompute the active / dirty classes on every tab + pane. */
  function renderTabs() {
    for (const d of TABS) {
      d.tab.classList.toggle("active", d === activeTab);
      d.tab.classList.toggle("dirty", d.dirty);
      d.pane.classList.toggle("active", d === activeTab);
    }
  }

  /** newTabName — pick the next per-run "Untitled N" title not already used. */
  function newTabName(existing) {
    let n;
    do {
      n = ++untitledCount;
    } while (existing.some((d) => d.name === `Untitled ${n}`));
    return `Untitled ${n}`;
  }

  /**
   * newTab — create a fresh tab, park it at top, make it active, persist.
   *
   * Always opens a NEW tab (never reuses a blank Untitled — see invariant 6).
    * @param {string} [name] Initial title (defaults to a fresh per-run "Untitled N").
   * @param {string} [text] Initial Markdown (defaults to blank).
   * @param {boolean} [focus=true] Reserved (focus is applied by activate).
   * @returns {object} The new doc object.
   */
  function newTab(name, text, focus = true) {
    const doc = makeTab(name || newTabName(TABS), text !== undefined ? text : "");
    openAtTop(doc);
    activate(doc);
    saveSession();
    return doc;
  }

  const { showSaveDiscardDialog, showModalBase, messageModal, confirmOverwriteIfNeeded } = createDialogHandlers({
    isTauri,
    exists: tauriExists,
  });

  const { pickPath } = createPathPicker({
    showModalBase,
    readDir: tauriReadDir,
    homeDir: tauriHomeDir,
    isTauri,
  });

  /**
   * resetLastTab — empty the last tab in place and reset it to a blank, clean
   * non-dirty state.
   *
   * Used when the user clears the ONE remaining tab (which is never removed —
   * the app always keeps exactly one open). Wipes the typing-burst state, stacks,
   * name/path, and value, then parks it at top and persists.
   * @param {object} doc The (last) tab to clear.
   */
  function resetLastTab(doc) {
    if (doc._typeSettle) { clearTimeout(doc._typeSettle); doc._typeSettle = 0; }
    doc._typeMark = null;
    doc.undo = [];
    doc.redo = [];
    doc.name = newTabName(TABS);
    doc.path = null;
    doc._typeBase = "";
    doc._lastVal = "";
    doc.input.value = "";
    doc.dirty = false;
    if (doc === activeTab) { openAtTop(doc); refresh(); }
    saveSession();
  }

  /**
   * closeTab — close a tab, prompting first if it has unsaved changes.
   *
   * On a dirty tab shows showSaveDiscardDialog (clear-in-place when last). Honors
   * the save() boolean (choice 'save' + save()===false leaves the tab). For the
   * LAST tab it clears in place via resetLastTab rather than removing — the app
   * always has exactly one tab open. Otherwise splices and activates the
   * neighbor, and persists.
   * @param {object} doc The tab to close.
   */
  async function closeTab(doc) {
    if (TABS.indexOf(doc) === -1) return;
    if (doc.dirty) {
      const last = TABS.length === 1;
      const { choice } = await showSaveDiscardDialog(doc, { clear: last });
      if (choice === "cancel") return;
      if (choice === "save") { const ok = await save(doc); if (!ok) return; }
    }
    if (TABS.length === 1) {
      resetLastTab(doc);
      return;
    }
    const idx = TABS.indexOf(doc);
    TABS.splice(idx, 1);
    doc.pane.remove();
    doc.tab.remove();
    const next = TABS[Math.min(idx, TABS.length - 1)];
    activate(next);
    saveSession();
  }

  /**
   * removeTab — low-level removal of a tab (DOM + array).
   *
   * No dirty prompt and no last-tab reset — the caller (closeApp) owns the prompts
   * and the empty state. Falls back activeTab to the last remaining tab.
   * @param {object} doc The tab to splice out and destroy.
   */
  function removeTab(doc) {
    const idx = TABS.indexOf(doc);
    if (idx === -1) return;
    TABS.splice(idx, 1);
    doc.pane.remove();
    doc.tab.remove();
    if (doc === activeTab) activeTab = TABS[TABS.length - 1] || null;
  }

  /**
   * closeApp — walk every tab and prompt-save any dirty one before removal.
   *
   * The single source of truth for the exit-time save prompt (invariant 4): the
   * window-close guard (onCloseRequested), the `beforeunload` listener, and remove
   * all funnel here. Order is active-first then right→left. Resolves true when
   * all tabs are cleared, false if the user cancels / a save fails (the caller
   * then keeps the window open).
   * @returns {Promise<boolean>} true if every tab was cleared, false on cancel/fail.
   */
  async function closeApp() {
    const order = [];
    if (activeTab) order.push(activeTab);
    const rest = TABS
      .filter((d) => d !== activeTab)
      .sort((a, b) => TABS.indexOf(b) - TABS.indexOf(a));
    order.push(...rest);

    for (const doc of order) {
      if (TABS.indexOf(doc) === -1) continue; // already removed
      if (TABS.length === 0) break;
      if (doc.dirty) {
        const { choice } = await showSaveDiscardDialog(doc, { clear: false });
        if (choice === "cancel") return false;
        if (choice === "save") { const ok = await save(doc); if (!ok) return false; }
      }
      removeTab(doc);
    }
    saveSession();
    return true;
  }

  /**
   * refresh — redraw the active tab: sync its DOM and all status chrome.
   *
   * Pushes syncDom (overlay + preview + mermaid), then updates the status bar,
   * toolbar active-states, and the undo/redo button disabled flags.
   */
  function refresh() {
    const doc = activeTab;
    if (!doc) return;
    syncDom(doc);
    updateStatus(doc);
    updateActiveStates();
    setUndoRedoState();
  }
  /** scheduleRefresh — coalesce refresh() calls into one per animation frame. */
  function scheduleRefresh() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; refresh(); });
  }
  // Apply the leading pane's scroll ratio to its follower. Kept idempotent and
  // cheap: called at most once per frame by kickScrollSync while scrolling.
  /**
   * followScroll — apply the leading pane's scroll RATIO to the follower pane.
   *
   * Reads the __lead pane's ratio and writes the follower's scrollTop to match.
   * Stamps the value-based echo guard (deadline + exact target offset) BEFORE
   * the write, so realScroll later recognizes the echo by value+time and doesn't
   * flip the lead back to the follower (the feedback ratchet).
   * @param {object} doc The tab in split view.
   */
  function followScroll(doc) {
    const src = doc.__lead === "e" ? doc.editorScroll : doc.previewScroll;
    const dst = doc.__lead === "e" ? doc.previewScroll : doc.editorScroll;
    const maxA = src.scrollHeight - src.clientHeight;
    if (maxA <= 0) return;
    const ratio = src.scrollTop / maxA;
    const target = ratio * (dst.scrollHeight - dst.clientHeight);
    // Record, for THIS pane, the deadline and the exact offset we're about to
    // drive it to. realScroll later drops a scroll event from this pane only
    // while it's still within the deadline AND at ≈ this value — so a genuine
    // user scroll (a different offset) is accepted immediately. Suppressing the
    // echo by this value+deadline check is what stops it flipping the lead back
    // and start driving the OTHER pane (the feedback ratchet).
    const dstKey = doc.__lead === "e" ? "__suppP" : "__suppE";
    doc[dstKey] = { deadline: performance.now() + ECHO_MS, value: target };
    dst.scrollTop = target;
  }
  let scrollRaf = 0;
  /** kickScrollSync — schedule followScroll once per frame while a pane leads. */
  function kickScrollSync() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      const doc = activeTab;
      // Only follow while a pane is actively being scrolled (a scroll event set
      // __lead within the last frame). When momentum ends no event fires and we
      // do no further work — no persistent per-frame loop.
      if (doc && (doc.__lead === "e" || doc.__lead === "p")) {
        followScroll(doc);
      } else if (doc) {
        doc.__lead = null;
      }
    });
  }
  /** updateStatus — write the active tab's name, Ln/Col, word/char count, and dirty flag. */
  function updateStatus(doc) {
    const text = doc.input.value;
    const a = doc.input.selectionStart;
    const before = text.slice(0, a);
    const ln = (before.match(/\n/g) || []).length + 1;
    const lineStart = before.lastIndexOf("\n") + 1;
    const col = a - lineStart + 1;
    const words = (text.match(/\S+/g) || []).length;
    status.textContent = doc.name || "untitled";
    lc.textContent = `Ln ${ln}, Col ${col}`;
    wc.innerHTML = `${words} word${words === 1 ? "" : "s"} &middot; ${text.length} char${text.length === 1 ? "" : "s"}`;
    dirtyEl.textContent = doc.dirty ? "\u25CF unsaved" : "";
    dirtyEl.className = doc.dirty ? "dirty" : "";
  }
  /** setUndoRedoState — enable/disable the toolbar undo/redo buttons for the active tab. */
  function setUndoRedoState() {
    const d = activeTab; if (!d) return;
    const u = toolbar.querySelector('[data-action="undo"]');
    const r = toolbar.querySelector('[data-action="redo"]');
    u.disabled = d.undo.length === 0 && !d._typeMark; // a pending typing burst counts as undoable
    r.disabled = d.redo.length === 0;
  }

  const { captureTypeSnapshot, flushTypeCommit, scheduleTypeSettle, commit, undo, redo } = createHistoryHandlers({
    getActiveDoc: () => activeTab,
    coalesceMs: COALESCE_MS,
    setUndoRedoState,
    setSuppressInput: (value) => { suppressInput = value; },
    refresh,
  });

  const { toggleFormat, toggleBlock, indentLines } = createEditingHandlers({
    getActiveDoc: () => activeTab,
    commit,
    lineBounds,
    detectFormat,
    trimmedSpan,
    wrapFor,
  });

  const { findLinkToken, tauriOpenUrl, openAtCaret } = createLinkHandlers({
    getActiveDoc: () => activeTab,
    isTauri,
    openUrl: (url, target) => window.open(url, target),
  });

  /**
   * setMode — switch the editor's view mode: split | edit | preview.
   *
   * Updates the constant-width mode button: swaps the `.mode-icon` glyph
   * (icons.viewSplit / viewEdit / viewPreview) and the visually-hidden
   * `.mode-label` word, so the button's width never changes and the centered
   * toolbar group does not re-jostle. Then toggles the mode class + data-mode.
   *
   * Preserves the scroll RATIO of the leaving mode by recording it before the
   * class toggle and re-asserting it on the entering panes after two nested
   * rAF ticks (wins the race against the focus auto-scroll). Stamps the
   * value-based echo-suppression guard (`__suppE`/`__suppP`) so the reflow's
   * scroll event can't ratchet a different value into the other pane. A fast
   * second mode-switch cancels any in-flight stale closure via a tab+mode check
   * inside the rAF.
   * @param {string} m 'split'|'edit'|'preview'.
   */
  function setMode(m) {
    const doc = activeTab;
    /**
     * paneOf — the scrollable panes visible in each mode for tab `d`.
     * @param {object} d — a tab, with `editorScroll` / `previewScroll` refs.
     * @returns {{split: HTMLElement[], edit: HTMLElement[], preview: HTMLElement[]}}
     */
    const paneOf = (d) => ({ split: [d.editorScroll, d.previewScroll], edit: [d.editorScroll], preview: [d.previewScroll] });
    // Capture the scroll RATIO of the pane(s) currently visible (i.e. those
    // in the mode we are LEAVING). When switching to a single-pane mode the
    // focused textarea may be snapped to the caret by the browser's
    // scroll-into-view, and the followScroll chain then drags the OTHER pane
    // with it — in practice this reads as "the view jumped to the bottom"
    // when the caret is at the end. Restore the pre-switch ratio AFTER the
    // class change + the auto-scroll settle (two rAF ticks; mirrors openAtTop).
    const prevMode = app.dataset.mode || "split";
    let keep = null;
    if (doc) {
      let bestMax = 0;
      for (const sc of paneOf(doc)[prevMode]) {
        const max = sc.scrollHeight - sc.clientHeight;
        if (max <= 0) continue;
        if (max > bestMax) { bestMax = max; keep = sc.scrollTop / max; }
      }
    }
    app.dataset.mode = m;
    // The layout hooks are the class selectors .mode-edit / .mode-preview
    // (style.css), so the class must be toggled too — data-mode alone does nothing.
    app.classList.remove("mode-edit", "mode-preview");
    if (m === "edit") app.classList.add("mode-edit");
    if (m === "preview") app.classList.add("mode-preview");
    const label = toolbar.querySelector(".mode-label");
    if (label) label.textContent = { split: "Split", edit: "Edit", preview: "Preview" }[m];
    // Swap the mode glyph too. The button is a constant-width ICON (like the
    // other toolbar buttons), not a variable-width word, so changing it does
    // not resize .tb-right — which would otherwise re-center .tb-center and
    // make the center buttons visibly "jostle" under the cursor (see the
    // .mode-icon / .mode-label rules in style.css). The hidden .mode-label text
    // still drives a11y + tests via `label.textContent`.
    const icon = toolbar.querySelector(".mode-icon");
    if (icon) icon.innerHTML = { split: icons.viewSplit, edit: icons.viewEdit, preview: icons.viewPreview }[m];
    if (doc && keep !== null) {
      const targets = paneOf(doc)[m];
      /**
       * apply — re-assert the entering mode's remembered scroll on its panes
       * once the class-toggle reflow + focus auto-scroll have settled.
       */
      const apply = () => {
        // Guard against a fast second mode-switch in the rAF window: only
        // apply if this mode is still active and the tab still the active tab,
        // or a stale closure would overwrite the newer ratio the user is at.
        if (doc !== activeTab || app.dataset.mode !== m) return;
        for (const sc of targets) {
          const max = sc.scrollHeight - sc.clientHeight;
          if (max <= 0) continue;
          const value = keep * max;
          // Stamp the value-based echo suppression with EXACTLY this offset
          // (ECHO_EPS will treat ≈-equal realScroll events as programmatic)
          // so the reflow's scroll event cannot ratchet a different value
          // into the other pane before we assert ours.
          doc[sc === doc.editorScroll ? "__suppE" : "__suppP"] =
            { deadline: performance.now() + ECHO_MS, value };
          sc.scrollTop = value;
        }
      };
      // rAF#1 lets the new mode's CSS reflow settle; rAF#2 runs after the
      // focus auto-scroll has had a chance to land, so we win the race.
      requestAnimationFrame(() => { requestAnimationFrame(apply); });
    }
  }

  /**
   * toggleTheme — switch the app theme without moving the visible document.
   *
   * Records each pane's scroll ratio before the theme CSS reflows the layout,
   * then restores those ratios after the repaint has settled. The value-based
   * echo guards keep the restore from being treated as a user scroll. Also
   * persists the choice to localStorage so the next launch starts in the same
   * theme (including the themed scrollbars) instead of flashing light first.
   */
  function toggleTheme() {
     const doc = activeTab;
     const oldTheme = document.documentElement.dataset.theme === "dark" ? "dark" : "";
     const nextTheme = oldTheme === "dark" ? "" : "dark";
     const ratio = (sc) => {
       const max = sc.scrollHeight - sc.clientHeight;
       return max > 0 ? sc.scrollTop / max : 0;
     };
     const keep = doc ? { editor: ratio(doc.editorScroll), preview: ratio(doc.previewScroll) } : null;
     document.documentElement.dataset.theme = nextTheme;
     try {
       // Store only the non-default choice (dark) so a fresh profile or a
       // cleared localStorage always lands on light, never a stale value.
       if (nextTheme) localStorage.setItem("me.theme", "dark");
       else localStorage.removeItem("me.theme");
     } catch { /* no storage — theme just won't persist */ }
    // Mermaid diagrams are keyed by (theme + source) and the SVG's baked-in
    // sheet is theme-specific — a toggle MUST re-render them in the new theme,
    // or a dark-rendered diagram would keep its dark sheet + stamped colors in
    // a light app (the "light app, dark diagrams" mismatch). Reset the per-tab
    // fingerprints (they now include the theme) and refresh, so syncDom's
    // restoreMermaid misses, the debounce re-arms, and the new theme renders.
    for (const t of TABS) t.__mmLastKey = null;
    if (doc) refresh();
    if (!doc || !keep) return;
    const apply = () => {
      if (doc !== activeTab || document.documentElement.dataset.theme !== nextTheme) return;
      for (const [sc, fraction, key] of [[doc.editorScroll, keep.editor, "__suppE"], [doc.previewScroll, keep.preview, "__suppP"]]) {
        const max = sc.scrollHeight - sc.clientHeight;
        if (max <= 0) continue;
        const value = fraction * max;
        doc[key] = { deadline: performance.now() + ECHO_MS, value };
        sc.scrollTop = value;
      }
      doc.__lead = null;
    };
    requestAnimationFrame(() => { requestAnimationFrame(apply); });
  }

    /* ---- Export helpers (PDF / HTML) ----
      The implementation lives in export.js; this factory wiring keeps the
      app-owned active document, picker, and native write callbacks local. */
  const exportHandlers = createExportHandlers({
    getActiveDoc: () => activeTab,
    isTauri,
    pickPath,
    confirmOverwriteIfNeeded,
    writeTextFile: tauriWriteTextFile,
    writeFile: tauriWriteFile,
    messageModal,
  });

    /**
     * exportAsHtml — render the current doc to a standalone HTML file.
     *
     * Tauri path: use the in-app save picker for a destination, then
     * `fs.writeFile` the doctyped HTML. Browser path: download a `text/html`
     * blob. Returns true on success, false on user cancel or error.
     * @returns {Promise<boolean>}
     */
    async function exportAsHtml() {
      return exportHandlers.exportAsHtml();
   }

    /**
     * exportAsPdf — render the current doc to a PDF by slicing the rasterized
     * preview into A4 page bands.
     *
     * Each band is a JPEG at 92% quality drawn onto a fresh A4 page (multi-page
     * docs split across `ceil(height / pxPerA4Page)` pages). Tauri path writes
     * the `Uint8Array` via `fs.writeFile`; browser path downloads a `blob`.
     * Returns true on success, false on user cancel or error.
     * @returns {Promise<boolean>}
     */
    async function exportAsPdf() {
      return exportHandlers.exportAsPdf();
   }

    /* ==== Export functions above; save() below unchanged ==== */
    /**
     * save — persist the active (or given) doc to disk.
     *
     * Resolves `true` once the content has been persisted (or handed to the
     * browser download manager); `false` if the user cancelled the Save-As
     * picker or a write failed. Path:
     *  - Tauri + known `doc.path` → write straight back to that file.
     *  - Tauri + no `doc.path`  → in-app Save-As picker, then `fs.writeFile`.
     *  - Browser  → `Blob`-download (WebKitGTK-style).
     *
     * The picker (and "Save failed" modals) are in-app, never the native rfd
     * GTK chooser: rfd's GTK3 backend never calls set_transient_for, so it
     * opens off-window. In-app renders over the app by construction.
     * @param {object} [doc] Target doc; defaults to `activeTab`.
     * @returns {Promise<boolean>} true on success, false on cancel/error.
     */
    async function save(doc) {
     const d = doc || activeTab;
    if (!d) return false;
    const t = d.input.value;
    if (isTauri()) {
      // Static imports — always loaded, no runtime chunk fetch.
      try {
        // Known location: write straight back to that file.
        if (d.path) {
          if (!(await confirmOverwriteIfNeeded(d.path))) return false;
          await tauriWriteTextFile(d.path, t);
          d.dirty = false; syncDom(d); updateStatus(d); saveSession();
          return true;
        }
        // No location known: ask where to store it, then write.
        const { path: p, name } = await pickPath({
          mode: "save",
          defaultFilename: /\.md$/i.test(d.name) ? d.name : (d.name || "untitled") + ".md",
          filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
        });
        if (!p) {
          // User cancelled the in-app Save-As picker. No extra prompt — the cancel
          // already communicates it; just leave the tab dirty and stay put.
          return false;
        }
        if (!(await confirmOverwriteIfNeeded(p))) return false;
        await tauriWriteTextFile(p, t);
        d.name = name || d.name; d.path = p; d.dirty = false;
        syncDom(d); updateStatus(d); saveSession();
        return true;
      } catch (e) {
        const msg = "Tauri save failed: " + ((e && (e.message || e)) || "unknown error");
        await messageModal({
          title: "Save failed",
          message: msg,
          buttons: [{ label: "OK", kind: "primary", value: "ok" }],
          kind: "error",
        });
        return false;
      }
    }
    // Browser → download (the only path that works in a normal webview fallback).
    const el = document.createElement("a");
    el.href = URL.createObjectURL(new Blob([t], { type: "text/markdown" }));
    el.download = /\.md$/i.test(d.name) ? d.name : d.name + ".md";
    el.click();
    d.dirty = false;
    updateStatus(d); renderTabs();
    return true;
  }

  /**
   * openFile — open {name, text, path} as a brand-new tab, activate it, save.
   *
   * ALWAYS opens a new tab — never reuses a tab of the same name or path
   * (invariant 6). The new tab is activated via openAtTop + activate + saveSession.
   * @param {{name: string, text: string, path?: (string|null)}} info File details.
   * @returns {object} The new doc object.
   */
  function openFile({ name, text, path }) {
    const doc = makeTab(name, text);
    doc.path = path || null;
    openAtTop(doc);
    activate(doc);
    saveSession();
    return doc;
  }

  /**
   * open — pick a markdown file and open it in a new tab.
   *
   * Tauri: use the in-app picker (centered over the app) + `fs.readFile`.
   * Browser: a native `<input type="file">` picker (multi-select). Reads text and
   * delegates to openFile (per the "always a new tab" invariant).
   * @returns {Promise<void>}
   */
  async function open() {
     if (isTauri()) {
       // In-app picker — centered over the app (see save() for the why).
       const { path } = await pickPath({
        mode: "open",
        filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
      });
      if (!path) return; // cancelled
      try {
        const txt = await tauriReadTextFile(path);
        const base = String(path).replace(/[\\/]+/g, "/").split("/").pop() || "file.md";
        openFile({ name: base, text: txt, path });
        return;
      } catch (e) {
        await messageModal({
          title: "Open failed",
          message: "Could not open “" + path + "”: " + ((e && (e.message || e)) || "unknown error"),
          buttons: [{ label: "OK", kind: "primary", value: "ok" }],
          kind: "error",
        });
        return;
      }
    }
    const fi = document.createElement("input");
    fi.type = "file"; fi.accept = ".md,.markdown,.txt,.mdx,text/markdown,text/plain";
    fi.multiple = true;
    fi.onchange = () => {
      for (const f of Array.from(fi.files || [])) {
        const r = new FileReader();
        r.onload = () => openFile({ name: f.name, text: r.result });
        r.readAsText(f);
      }
    };
    fi.click();
  }

  /* ---- drag & drop (markdown files) ---- */
  const drag = { over: false, depth: 0 };
  workspace.addEventListener("dragenter", (ev) => {
    ev.preventDefault();
    const types = ev.dataTransfer && Array.from(ev.dataTransfer.types || []);
    if (!types.includes("Files")) return;
    drag.depth += 1; drag.over = true;
    workspace.classList.add("dropping");
  });
  workspace.addEventListener("dragleave", (ev) => {
    ev.preventDefault();
    drag.depth = Math.max(0, drag.depth - 1);
    if (drag.depth === 0) { drag.over = false; workspace.classList.remove("dropping"); }
  });
  workspace.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
  });
  workspace.addEventListener("drop", async (ev) => {
    ev.preventDefault();
    drag.depth = 0; drag.over = false; workspace.classList.remove("dropping");
    const files = ev.dataTransfer && ev.dataTransfer.files;
    if (!files || !files.length) return;
    for (const f of Array.from(files)) {
      if (!/\.(md|markdown|mdx|txt)$/i.test(f.name || "") && f.type !== "text/markdown" && f.type !== "text/plain") continue;
      let path = null, text;
      if (isTauri()) {
        try {
          path = f.path || (f[0] && f[0].path) || null;
       if (path) text = await tauriReadTextFile(path);
        } catch { /* ignore */ }
      }
      if (text === undefined && f.text) { try { text = await f.text(); } catch { continue; } }
      openFile({ name: f.name || "dropped", text, path });
    }
  });

  /* ---- key bindings ---- */
  // Global Ctrl/Meta shortcuts are bound on window (not the textarea) so they
  // fire no matter which element holds focus. WebKitGTK lets focus slip off the
  // overlay textarea, which used to make these dead when focus was elsewhere.
  /**
   * onGlobalKeyDown — window-level modifier keybindings (mod = Ctrl or Meta).
   *
   * Bound on `window` (not the textarea) so they fire regardless of which
   * element holds focus — on WebKitGTK focus can slip off the overlay textarea.
   * Handles: Undo/Redo (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z), bold, italic,
   * underline, save (Ctrl+S), link, open (Ctrl+O), close tab (Ctrl+W), new
    * tab (Ctrl+T). Ctrl/Shift+Arrow word-wise caret moves are NOT bound here —
    * they live in the textarea-local onKeyDown, where wordJump can make them
    * Markdown-aware (a whole formatted span counts as one word) and fall
    * through to the native move when no span is involved.
   * @param {KeyboardEvent} ev The keydown event.
   * @returns {Promise<void>}
   */
  async function onGlobalKeyDown(ev) {
    const mod = ev.ctrlKey || ev.metaKey;
    if (!mod) return;
    const k = (ev.key || "").toLowerCase();

    if (k === "z" && !ev.shiftKey) { ev.preventDefault(); undo(); return; }
    if (k === "y" && !ev.shiftKey) { ev.preventDefault(); redo(); return; }
    if (k === "z" && ev.shiftKey) { ev.preventDefault(); redo(); return; }
    // NOTE: Ctrl/Meta+ArrowLeft/Right are intentionally NOT bound here (they
    // used to be undo/redo aliases). The Ctrl-only word-wise caret move and
    // selection extend live in the textarea-local onKeyDown (wordJump makes
    // them engine-independent and Markdown-aware); Cmd+Arrow stays native for
    // macOS Home/End.

    if (k === "b" && !ev.shiftKey) { ev.preventDefault(); toggleFormat("bold"); return; }
    if (k === "i" && !ev.shiftKey) { ev.preventDefault(); toggleFormat("italic"); return; }
    if (k === "u" && !ev.shiftKey) { ev.preventDefault(); toggleFormat("underline"); return; }
    if (k === "s" && !ev.shiftKey) { ev.preventDefault(); await save(); return; }
    if (k === "k" && !ev.shiftKey) { ev.preventDefault(); toggleFormat("link"); return; }
    if (k === "o" && !ev.shiftKey) { ev.preventDefault(); await open(); return; }
    if (k === "w" && !ev.shiftKey) { ev.preventDefault(); if (activeTab) await closeTab(activeTab); return; }
    if (k === "t" && !ev.shiftKey) { ev.preventDefault(); newTab(undefined, ""); return; }
  }
  window.addEventListener("keydown", onGlobalKeyDown);

  // Tab / Shift+Tab → indent/outdent, captured at the TOP of the DOM pipeline.
  // This is bound on `window` in CAPTURE phase with preventDefault() +
  // stopPropagation() so the editor's own textarea handler does not double-fire,
  // and the browser's default focus traversal (Shift+Tab escaping the editor to
  // the toolbar/other controls on WebKitGTK) never gets a chance to run. When a
  // centered modal (identify by its .savedlg-backdrop) is open we stand down so
  // the modal's own focus trap keeps Tab/Shift+Tab inside the dialog.
  window.addEventListener("keydown", (ev) => {
    if (!isEditorTabKey(ev) || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (document.querySelector(".savedlg-backdrop")) return;
    const d = activeTab;
    if (!d) return;
    if (ev.target !== d.input && document.activeElement !== d.input) return;
    // Stamp the timestamp BEFORE any early return path below: some WebKitGTK
    // builds report Shift+Tab with the legacy X keysym name ISO_Left_Tab
    // instead of "Tab", and some deliver the key but IGNORE preventDefault for
    // focus traversal — the __sTabAt stamp feeds the blur-refocus fallback
    // (bound per-textarea in makeTab) which is the engine-level escape hatch.
    d.__sTabAt = Date.now();
    ev.preventDefault();
    ev.stopPropagation();
    indentLines(ev.shiftKey ? -1 : 1);
  }, true);

  /** isEditorTabKey — true for Tab and the legacy GTK `ISO_Left_Tab` keysym. */
  function isEditorTabKey(ev) {
    return ev.key === "Tab" || ev.key === "ISO_Left_Tab";
  }

  // Toolbar active-states must track the caret the INSTANT it moves — on a real
  // click, arrow/Home/End, paste, undo, etc. — and reflect the formatting at the
  // caret WITHOUT requiring the text to change. The per-textarea "select"/"keyup"/
  // "mouseup" catches are each individually unreliable on WebKitGTK (the select
  // event often never fires there), so the one signal that covers every caret
  // move regardless of *how* it moved is the document-level selectionchange
  // event (fired for all text-inputs, selection, caret moves, programmatic
  // setSelectionRange). We route it to the active tab only, per-frame, so it
  // stays cheap even when a dialog steals focus.
  document.addEventListener("selectionchange", () => {
    const d = activeTab;
    if (!d) return;
    // updateActiveStates reads ONLY d.input.selectionStart (the active textarea's
    // caret), so this is always correct: the buttons reflect the caret of the
    // active editor, whether the caret moved by click, arrow, paste, undo, tab
    // switch, or programmatic setSelectionRange — and it fires with NO text
    // change. Route per-frame to a single queued tick to stay cheap.
    scheduleButtonUpdate(d);
  });
  /**
   * scheduleButtonUpdate — queue a single rAF tick to re-sync toolbar state.
   *
   * Debounces the selectionchange route: multiple caret moves within a single
   * frame produce exactly one status/active-states/undo-redo refresh, and the
   * tick re-validates `d === activeTab` so a newer tab activation cancels it.
   * @param {object} d Doc to refresh (must be `activeTab` when the tick fires).
   */
  function scheduleButtonUpdate(d) {
    if (d.__btnRaf) return;
    d.__btnRaf = requestAnimationFrame(() => {
      d.__btnRaf = 0;
      if (d !== activeTab) return; // a newer tab was activated meanwhile
      updateStatus(d);
      updateActiveStates();
      setUndoRedoState();
    });
  }

  // Editor-local bindings (only meaningful inside the source textarea).
  /**
   * onKeyDown — textarea-local editor keybindings. Enter on an empty
   * list/quote item removes the marker (exit the list); Enter on a non-empty
   * list/quote/ol/ul item continues the next line with the same marker,
   * PRESERVING the parent item's indentation (so a nested bullet's Enter
   * keeps its indent level), and increments ordered-list numbers.
   *
   * Also owns the Markdown-aware Ctrl+Arrow word-wise caret move (with Shift
   * it extends the selection): wordJump treats a word as a whitespace-run —
   * trailing punctuation included, standalone punctuation its own stop — with
   * formatted spans atomic, and crosses line ends to the next line's first
   * word (`step|\n- **Diagrams**` → `step\n-| …`). Only the document edges
   * fall through to the native move (a no-op there).
   *
   * Tab/Shift+Tab used to be bound here, but on WebKitGTK (the Tauri shell on
   * Linux; WebView2 behaves the same on Windows) Shift+Tab escaped the editor
   * to browser focus traversal — it now lives in the CAPTURE-phase window
   * listener directly below, which runs before everything else and is the
   * earliest possible preventDefault point in the DOM pipeline.
   * @param {KeyboardEvent} ev The keydown event (from the source textarea).
   * @returns {Promise<void>}
   */
  async function onKeyDown(ev) {
    const mod = ev.ctrlKey || ev.metaKey;

    // Markdown-aware Ctrl+Arrow word-wise caret move. The engines' native
    // segmentation is inconsistent AND marker-blind: from `A| **lightweight**`
    // both stop between "lightweight" and the closing `**`, Chromium stops
    // before a trailing period (`live formatting|.`), WebKitGTK skips
    // standalone punctuation runs (`editor| - write` → `editor - write|`), and
    // at a line end native skips the next line's leading marker and lands
    // mid-span (`step|\n- **Diagrams**` → `**Diagrams|**`). wordJump owns
    // every move with a deterministic token model: a word is a
    // whitespace-delimited run (trailing punctuation rides along, a standalone
    // ` - ` is its own stop), a formatted span is ATOMIC, and line-crossing
    // stops at the next line's first word (`step\n-| …`). Ctrl is used, NOT
    // Cmd/Meta: on macOS Cmd+Left/Right is Home/End line navigation and must
    // stay native. wordJump returns null only at the document edges, where
    // the native move is a no-op anyway.
    //
    // With Shift the move is a selection gesture that must act on the CARET —
    // the edge the user last moved to — NOT the left/right-most edge: a
    // forward selection (anchor left, caret right) SHRINKS from its right edge
    // on Ctrl+Shift+Left and only grows past the anchor after the caret
    // crosses it (direction flips), exactly like native shift+arrows. The
    // caret/anchor pair comes from the textarea's selectionDirection
    // ("forward"/"backward"); `d.__selAnchor` + `d.__selStamp` cover engines
    // that drop the setSelectionRange direction argument (reporting "none"):
    // the stored gesture anchor is honored only while the live selection is
    // EXACTLY the one this gesture last wrote. A bare (no-Shift) move
    // collapses to the caret edge and jumps — and ends the gesture.
    if (ev.ctrlKey && !ev.altKey && !ev.metaKey && (ev.key === "ArrowRight" || ev.key === "ArrowLeft")) {
      const d = activeTab;
      if (!d) return;
      const input = d.input;
      const dir = ev.key === "ArrowRight" ? 1 : -1;
      const selS = input.selectionStart, selE = input.selectionEnd;
      const dirFlag = input.selectionDirection;
      const gestureLive = !!d.__selStamp && d.__selStamp[0] === selS && d.__selStamp[1] === selE;
      let anchor, caret;
      if (selS === selE) {
        anchor = caret = selS; // collapsed: the caret is the anchor
      } else if (dirFlag === "backward") {
        anchor = selE; caret = selS;
      } else if (dirFlag === "forward") {
        anchor = selS; caret = selE;
      } else if (gestureLive && typeof d.__selAnchor === "number" && (d.__selAnchor === selS || d.__selAnchor === selE)) {
        anchor = d.__selAnchor;
        caret = anchor === selS ? selE : selS;
      } else {
        // Fresh selection of unknown direction (mouse drag / double-click):
        // extend the far edge — the engines' own fallback for this case.
        anchor = dir > 0 ? selS : selE;
        caret = dir > 0 ? selE : selS;
      }
      const target = wordJump(input.value, caret, dir);
      if (target === null) return;
      ev.preventDefault();
      if (ev.shiftKey) {
        d.__selAnchor = anchor;
        d.__selStamp = [Math.min(anchor, target), Math.max(anchor, target)];
        input.setSelectionRange(d.__selStamp[0], d.__selStamp[1], target >= anchor ? "forward" : "backward");
      } else {
        d.__selAnchor = null;
        d.__selStamp = null;
        input.setSelectionRange(target, target, dir > 0 ? "forward" : "backward");
      }
      updateActiveStates();
      updateStatus(d);
      return;
    }

    if (ev.key === "Enter" && !mod) {
      const d = activeTab, input = d.input, text = d.input.value;
      const a = input.selectionStart;
      if (a === input.selectionEnd) {
        const before = text.slice(0, a);
        const lineStart = before.lastIndexOf("\n") + 1;
        const line = before.slice(lineStart);
        const lm = line.match(/^(\s*)(#{1,4}\s|>\s?|[-*+]\s+|\d+\.\s+)/);
        if (lm) {
          const rest = line.slice(lm[0].length);
          if (rest.trim() === "") {
            // empty list/quote item → exit
            ev.preventDefault();
            const to = text.slice(0, lineStart) + text.slice(a);
            commit("finish list/quote", to, lineStart, lineStart);
            return;
          }
          ev.preventDefault();
          // Preserve the parent item's indentation (the "Test3" nested-bullet
          // case): the matched prefix indent must follow the marker onto the
          // new line, not be dropped on the floor.
          const marker = lm[2];
          let newMarker = marker;
          if (/^\d+\.\s+$/.test(marker)) newMarker = (parseInt(marker.match(/^(\d+)\./)[1], 10) + 1) + ". ";
          else if (/^[-*+]\s+$/.test(marker) && marker[0] === "*") newMarker = marker;
          const insert = "\n" + lm[1] + newMarker;
          const to = text.slice(0, a) + insert + text.slice(input.selectionEnd);
          const pos = a + insert.length;
          commit("continue list/quote", to, pos, pos);
          return;
        }
      }
    }
  }

  /* ---- toolbar actions ---- */
  /** setFmtActive — toggle the `.active` class on an inline-format button. */
  function setFmtActive(name, on) { const b = toolbar.querySelector(`[data-fmt="${name}"]`); if (b) b.classList.toggle("active", on); }
  /** setBlockActive — toggle the `.active` class on a block-element button. */
  function setBlockActive(name, on) { const b = toolbar.querySelector(`[data-block="${name}"]`); if (b) b.classList.toggle("active", on); }

  /**
   * updateActiveStates — re-reflect the inline + block format state at the
   * active tab's caret onto the toolbar buttons.
   *
   * Resolves the active word, detects its format, and highlights the matching
   * fmt button (bold/italic/underline/strike/code/link) AND the block button
   * (h1/h2/h3, quote, ul, ol, table). Called per-frame from the selectionchange
   * route so the buttons track every caret move without needing a text change.
   */
  function updateActiveStates() {
    const d = activeTab;
    if (!d) return;
    const text = d.input.value, a = d.input.selectionStart;
    const [ls, le] = lineBounds(text, a);
    const line = text.slice(ls, le);
    const [ws, we] = wordAt(line, a - ls);
    const det = detectFormat(line, ws, we);
    setFmtActive("bold", !!(det && det.fmt === "bold"));
    setFmtActive("italic", !!(det && det.fmt === "italic"));
    setFmtActive("underline", !!(det && det.fmt === "underline"));
    setFmtActive("strike", !!(det && det.fmt === "strike"));
    setFmtActive("code", !!(det && det.fmt === "code"));
    setFmtActive("link", !!(det && det.fmt === "link"));
    const hm = line.match(/^\s*(#{1,4})\s/);
    setBlockActive("h1", !!hm && hm[1].length === 1);
    setBlockActive("h2", !!hm && hm[1].length === 2);
    setBlockActive("h3", !!hm && hm[1].length === 3);
    setBlockActive("quote", /^\s*>/.test(line));
    setBlockActive("ul", /^\s*[-*+]\s+/.test(line));
    setBlockActive("ol", /^\s*\d+\.\s+/.test(line));
    const lines = text.split("\n");
    const cur = ls;
    const onTbl = (lines[cur] || "").includes("|") && isTableSep(lines[cur + 1] || "");
    setBlockActive("table", onTbl);
  }

  const { saveSession, saveSessionSoon, loadSession } = createSessionStore({
    storage: localStorage,
    key: "mdeditor.session.v2",
    getActiveTabId: () => activeTab ? activeTab.id : null,
    getTabs: () => TABS,
  });

  /* ---- Tauri window close confirm ----
    * Close-requested contract (see @tauri-apps/api window.js onCloseRequested):
    * the wrapper does  `await handler(evt); if (!evt.isPreventDefault())
    * await this.destroy();`  i.e. it AUTO-CLOSES the window unless we call
    * preventDefault(). So the ONLY correct way to actually close is to let the
    * handler return WITHOUT preventDefault. The old code called preventDefault()
    * unconditionally AND win.close(); close() re-emits close-requested, the
    * wrapper re-fired our handler (again preventDefault → never destroyed),
    * deadlocking the window open.
    *   - user cancels  → preventDefault()  → wrapper skips destroy → window stays
    *   - walk succeeds → do NOT preventDefault → wrapper calls destroy()
    *   - 2nd request while a dialog is open (re-entry) → preventDefault + ignore
    *
    * Registered SYNCHRONOUSLY using the statically-imported getCurrentWindow —
    * NOT after a dynamic import(). A dynamic import that failed to load its
    * chunk silently skipped this registration, letting the window close with
    * unsaved data. If registration itself throws we fall back to a plain
    * document-level guard so we never close silently. */
  if (isTauri()) {
    let win = null;
    try { win = getCurrentWindow(); } catch { win = null; }
    if (win) {
      let closing = false; // re-entry guard for a second close request mid-walk
      /**
       * win.onCloseRequested — Tauri window close interceptor.
       *
       * The Tauri wrapper's contract: `await handler(evt); if (!evt.isPreventDefault())
       * await this.destroy()`. So the handler should call preventDefault ONLY
       * when the user cancels / an error occurs; on success it must do NOTHING
       * (the wrapper auto-calls destroy). Calling win.close() here would
       * re-emit close-requested, re-fire this handler → preventDefault again →
       * deadlock the window open. Re-entry is guarded (a second close request
       * while the dialog is open is swallowed). If registration itself fails
       * (IPC not ready), fall back to a document-level `beforeunload` guard.
       * @param {object} event The Tauri CloseRequestedEvent.
       */
      win.onCloseRequested(async (event) => {
        if (closing) { event.preventDefault(); return; } // dialog already open — hold
        closing = true;
        let ok = true;
        try { ok = await closeApp(); } catch { ok = false; }
        if (!ok) {
          // cancelled / error → preventDefault → wrapper skips destroy → window stays.
          event.preventDefault();
        }
        // ok === true: do NOT preventDefault → the wrapper runs destroy() and the
        // window actually closes. (win.close() would re-emit the event and the
        // wrapper would re-fire us, preventDefault-ing again → destroy never runs.)
        closing = false;
      }).catch((e) => {
        // Registration failed (IPC not ready). Fall back to a document guard so a
        // stray close can't dump unsaved work.
        window.addEventListener("beforeunload", (ev) => {
          if (TABS.some((d) => d.dirty)) { ev.preventDefault(); ev.returnValue = ""; }
        });
      });
    }
  }
  window.addEventListener("beforeunload", (ev) => {
    if (TABS.some((d) => d.dirty)) { ev.preventDefault(); ev.returnValue = ""; }
    saveSession();
  });

  /* ---- toolbar click ---- */
   const menuBtn = toolbar.querySelector('[data-action="menu"]');
   const menuDropdown = toolbar.querySelector(".menu-dropdown");
   /**
    * setMenuOpen — toggle the hamburger dropdown menu open/closed + ARIA state.
    *
    * Switches the `.open` class (CSS reveals the dropdown) and syncs
    * `data-menu-open` / `aria-expanded` on the toggle button.
    * @param {boolean} open true to open, false to close.
    */
   function setMenuOpen(open) {
    menuDropdown.classList.toggle("open", open);
    menuBtn.setAttribute("data-menu-open", String(open));
    menuBtn.setAttribute("aria-expanded", String(open));
  }
  // Close the menu on any click outside it (the item clicks below still fire
  // first, in the same event round, because this listener is on `document`).
  // Guard is `.menu-wrap` (wraps BOTH the toggle button and the dropdown),
  // NOT `.menu-dropdown` — otherwise the button's own click would be treated
  // as "outside" by the document listener and close the menu right after
  // the toolbar handler reopened it.
  document.addEventListener("click", (ev) => {
    if (!menuDropdown.classList.contains("open")) return;
    if (ev.target.closest(".menu-wrap")) return;
    setMenuOpen(false);
  });
  // Keyboard: Escape closes the open menu.
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && menuDropdown.classList.contains("open")) setMenuOpen(false);
  });

  toolbar.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button"); if (!btn) return;
    const menuId = btn.getAttribute("data-menu");
    const fmt = btn.getAttribute("data-fmt");
    const block = btn.getAttribute("data-block");
    const action = btn.getAttribute("data-action");
    if (menuId) {
      setMenuOpen(false);
      if (menuId === "pdf") exportAsPdf();
      else if (menuId === "html") exportAsHtml();
      if (activeTab) activeTab.input.focus();
      return;
    }
    if (fmt) toggleFormat(fmt);
    else if (block) toggleBlock(block);
    else if (action) {
      if (action === "save") save();
      else if (action === "open") open();
      else if (action === "undo") undo();
      else if (action === "redo") redo();
      else if (action === "newtab") newTab(undefined, "");
      else if (action === "mode") {
        const o = ["split", "edit", "preview"];
        const next = o[(o.indexOf(app.dataset.mode) + 1) % 3];
        setMode(next);
        // Only "preview" hides the editor pane (style.css .mode-preview
        // .pane-editor{flex:0;width:0}). Focusing the zero-width textarea there
        // fires WebKitGTK's EAGER scroll-into-view, and realScroll→kickScrollSync
        // →followScroll ratchets that phantom offset onto the PREVIEW pane — the
        // user sees "edit stays at top but preview lands at the bottom". So for a
        // preview target, skip the trailing activeTab.input.focus() below and let
        // setMode's own ratio-restore drive the entering pane. For split/edit the
        // textarea stays visible and the trailing focus is the normal caret-follow
        // behavior — so we deliberately fall through to it (do NOT return).
        if (next === "preview") return;
      }
      else if (action === "theme") { toggleTheme(); return; }
      else if (action === "menu") { // toggle; stop the app-level ctrl+click/escape from stealing focus
        const open = !menuDropdown.classList.contains("open");
        setMenuOpen(open);
        return;
      }
    }
    if (activeTab) activeTab.input.focus();
  });

  /* ---- ctrl+click anywhere in window → new tab (except when a .md is being dragged) ---- */
  app.addEventListener("click", (ev) => {
    if (!ev.ctrlKey && !ev.metaKey) return;
    if (ev.target.closest("a, button, input, textarea, .tab .tname")) return;
    ev.preventDefault();
    newTab(undefined, "");
  }, true);

  /* ---- init ---- */
  const session = loadSession();
  let started = false;
  if (session && Array.isArray(session.tabs) && session.tabs.length) {
    let activeId = session.activeTab;
    let restoreActive = null;
    for (const t of session.tabs) {
      const doc = makeTab(t.name || "Untitled", typeof t.text === "string" ? t.text : "");
      doc.id = t.id || doc.id;
      doc.path = t.path || null;
      doc.dirty = !!t.dirty;
      if (t.id === activeId) restoreActive = doc;
    }
    // Don't pre-assign activeTab here: activate() short-circuits when its arg is
    // already activeTab, so we hand it a distinct doc and let it do the class-
    // toggle + focus + refresh for the restored tab.
    const toActivate = restoreActive || TABS[0];
    // Ensure a restored long doc opens at the top (Webkit auto-scrolls the
    // focused textarea to the caret, which sits at the end = bottom).
    openAtTop(toActivate);
    activate(toActivate);
    started = true;
  }
  if (!started) {
    const doc = makeTab(newTabName(TABS), "");
    openAtTop(doc);
    activate(doc);
    saveSession();
  }
  refresh();
  saveSession();

  return {
    get tabs() { return TABS; },
    get active() { return activeTab; },
    get activeTab() { return activeTab; },
    get toolbar() { return toolbar; },
    get tabBar() { return tabBar; },
    get workspace() { return workspace; },
    get documentText() { return activeTab ? activeTab.input.value : ""; },
    set documentText(v) { if (activeTab) { suppressInput = true; activeTab.input.value = v; activeTab._typeBase = v; activeTab._lastVal = v; suppressInput = false; activeTab.dirty = false; refresh(); } },
    get name() { return activeTab ? activeTab.name : ""; },
    set name(v) { if (activeTab) { activeTab.name = v || "untitled"; syncDom(activeTab); } },
    getDocumentText: () => (activeTab ? activeTab.input.value : ""),
    setDocumentText: (t) => { if (!activeTab) return; suppressInput = true; activeTab.input.value = t; activeTab._typeBase = t; activeTab._lastVal = t; suppressInput = false; activeTab.dirty = false; refresh(); },
    refresh, scheduleRefresh,
    newTab, closeTab, closeApp, activate,
    save, open,
    exportAsHtml, exportAsPdf,
    openFile,
    toggleFormat, toggleBlock,
    undo, redo, indentLines,
    openAtCaret,
    mdFromHtml, mdTableFromHtml, mdCellText, mdInlineMd, mdStyleOf,
  };
}
