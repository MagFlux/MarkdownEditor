# Markdown Editor

A lightweight, cross-platform WYSIWYG-style Markdown editor. Documents stay plain `.md` files — the editor only layers a color/highlight overlay on top, so there is no lock-in and no hidden formatting.

Built with **Tauri** (native shell) + **Vite** (web frontend). No framework — plain JS, one DOM, one source of truth.

---

## Features

- **Split / Edit / Preview** view modes
- **Multi-file tabs** — open, close and reorder documents independently (new blank tabs, including the replacement after closing the last tab, are named `Untitled 1`, `Untitled 2`, … per application run; Ctrl+T for a new tab, `×` to close, Ctrl+W to close the active tab)
- **Custom undo / redo stack** — per-tab, with `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`
- **Word-wise caret moves** — `Ctrl+Left` / `Ctrl+Right` jump the caret a whole word in the arrow's direction; add `Shift` (`Ctrl+Shift+Left` / `Ctrl+Shift+Right`) to extend/shrink the selection a whole word at a time. The moves are Markdown-aware and engine-independent: a word is a whitespace-delimited run — trailing punctuation (`formatting.`) rides along, a standalone ` - ` is its own stop — and a formatted span (`**bold**`, `` `code` ``, `[link](url)`, …) is atomic, markers included, so `Ctrl+Right` from `A| **lightweight**` lands at `A **lightweight**|`. At a line end the move crosses the newline and stops after the next line's first word (`step|\n- **Diagrams**` → `step\n-| **Diagrams**`)
- **Inline formatting**: bold, italic, **underline** (`<u>`), strikethrough, `` code ``, and links — wrapping the exact selected text, the current word when the caret is inside it, or — with a plain caret (empty line, between words, at a token edge) — inserting an empty `**`+`**` pair with the caret between the markers, ready to type (Ctrl+B / I / U / K)
- **Block formatting**: H1–H3, quotes, `ul` / `ol`, code fences, and GFM tables
- **Mermaid diagrams** — a `` ```mermaid `` fence renders as a live SVG diagram in the preview (and is captured in HTML/PDF export). Rendered with [mermaid](https://mermaid.js.org) using the current app theme; a syntax error shows an inline red error box with the failing source.
- **Live toolbar state** — the formatting buttons (B / I / U / S / code / link, and H1–H3 / quote / list / table) light up to match the formatting at the **caret** the instant it moves, whether you click, use the arrow keys, paste, undo, or switch tabs. Multi-word inline spans are detected throughout their contents, code spans take precedence over marker-like text inside them, and the buttons do not require you to select or change the text first.
- **Rich paste** — paste an HTML clipboard (an Excel/Word table, a bold/italic/underline span, or a mix) and it converts to Markdown (`<table>` → GFM table, `<b>` → `**…**`, `<i>` → `*…*`, `<u>` → `<u>…</u>`), committed as a single undo-able edit. Plain-text pastes are left to the browser.
- **Export as PDF / HTML** — via the hamburger menu (top-right of the toolbar). Renders your live preview and saves it as a self-contained `.html` or a multi-page A4 `.pdf` (via `jsPDF` + `html2canvas`). Uses the same in-app save dialog as Save — pick a location and the file is written there; in a plain browser it falls back to a download.
- **Drag-and-drop** `.md` files straight onto the window (opens them in a new tab)
- **Ctrl+click a link** in the source to open it in the default browser
- **Tab / Shift+Tab** to indent / outdent list, code, and blank lines (blank lines indent too; the caret follows its line's column — no text is highlighted, and block-format/table/codeblock buttons commit with a collapsed caret at the end of the block, never a selection)
- **Enter** auto-continues list items (preserving the parent item's indentation, so a nested bullet keeps its indent level) and numbered lists; press Enter on an empty list item to exit the list
- **Session persistence** — tabs and their contents are saved to `localStorage` so a crash or close does not lose work
- **Unsaved-changes guard** — confirms before closing a tab or window with uncommitted edits
- **Light / Dark** theme; switching themes preserves the current vertical position in both editor and preview panes. Scrollbar colors follow the active theme (light thumb in light mode, dark thumb in dark mode) so they blend on any OS — including Windows WebView2, where the OS otherwise paints its own themed scrollbars (per-theme `color-scheme` + `--sb`/`--sb-hi` vars in `src/style.css`). The last theme is persisted (`localStorage: me.theme`) and restored on start.
- Saves & opens from the filesystem via Tauri's `fs` plugin, using an **in-app file picker** (centered over the window; the native rfd GTK picker drifts off-window) with a browser-file-input fallback so the web app still works in the browser. The picker has a clickable path breadcrumb plus an **always-visible Home button** (and Up) so you can jump back to your home directory no matter how far you have navigated. Hidden (dot-prefixed) folders are reachable on Unix — the fs scope's `**` glob matches dot-path segments (via `plugins.fs.requireLiteralLeadingDot: false` in `src-tauri/tauri.conf.json`), so you can open/save inside `~/.config`, `~/dev/.github`, etc.
- Native saves and exports check the destination first and show an in-app **Overwrite existing file?** prompt before replacing an existing file. Cancel leaves the document dirty and performs no write.

---

## How it works (short)

- An invisible `<textarea>` sits on top of a pre-rendered `<div>`. The editor content and the textarea share exact font metrics, so the visible caret never drifts.
- The renderer is in `src/render.js` — `computeBlocks()` classifies each line (heading, list, quote, code, table…) and `lineToHtml()` turns a line into highlighted spans.
- **Invariant**: stripping every `<span>` tag out of the produced HTML must reproduce the exact source text. This is what keeps the caret aligned; all renderer changes must preserve it. There is a round-trip test that checks this, plus a styling assertion that `<u>text</u>` really emits a `.u` span (an escaped-plain-text fallback would also round-trip, so the span check is what catches a broken token match).
- The DOM (the textarea) is the single source of truth. The "overlay" and the "preview" are both re-rendered from it on every change — the reverse direction never happens, so undo/redo is a simple stack of text snapshots. Inline overlay styles preserve each source character's horizontal width; code highlighting must not add horizontal padding that would shift later text.
- Tauri plugins for filesystem I/O (the in-app file picker reads directories via `plugin-fs`, opens/closes windows via the core API), opening links, and window lifecycle are **statically imported** at the top of `src/markdown.js`; the PDF/HTML export libraries `jsPDF` and `html2canvas` are static imports in `src/export.js`, and the diagram renderer `mermaid` is a static import at the top of `src/mermaid.js` (all pure JS until called). Tauri calls are guarded by `isTauri()`. This is deliberate: in the real Tauri GTK webview, *dynamically* imported chunks can fail to resolve, causing `save()` to silently fall through to a no-op download and `onCloseRequested` to never register — both silently corrupt or lose work. Static imports also keep the production bundle a **single `index-*.js` file**; jsPDF ships an internal `await import("dompurify")` that would otherwise emit a second chunk, so `vite.config.js` sets `build.rollupOptions.output.codeSplitting: false`. The **real** Tauri gate is `isTauri()`: this is a Vite/bundler build (no `withGlobalTauri`), so Tauri injects `window.__TAURI_INTERNALS__`, **not** `window.__TAURI__`; `isTauri()` must detect the former or every native branch falls through to the browser no-op in the actual app (see the gotchas below).

---

## File layout

```
MarkdownEditor/
├── index.html                  # entry page, loads the Vite bundle
├── vite.config.js              # dev/preview server on 127.0.0.1 (avoids IPv6 localhost mismatch)
├── package.json
├── src/
│   ├── main.js                 # bootstrap: createApp(#app) + sample content
│   ├── markdown.js             # app shell: createApp() — tabs, undo, keybinds, save/open, DnD, modals; static Tauri imports
│   ├── export.js               # static PDF/HTML export pipeline and native/browser save adapters
│   ├── session.js              # versioned localStorage persistence and debounced saves
│   ├── dialogs.js              # centered in-app modals and overwrite confirmation
│   ├── picker.js               # in-app Save/Open filesystem picker (platform-aware path separator)
│   ├── editing.js              # formatting mutations and indentation factory
│   ├── links.js                # link detection and Tauri/browser opening factory
│   ├── history.js              # undo/redo history factory
│   ├── render.js               # overlay-highlight renderer (esc, computeBlocks, lineToHtml, highlightToHtml)
│   ├── mermaid.js              # mermaid SVG rendering (static `mermaid` import) + anti-flicker SVG cache + stale-render guard + stylesheet-failure fallback (head mirror + CSSOM presentation-attribute stamping)
│   ├── format.js               # selection + format detect/wrap helpers (lineBounds, wordAt, detectFormat, …)
│   ├── paste.js                # rich-paste HTML→Markdown (mdFromHtml, mdTableFromHtml, …)
│   ├── icons.js                # inline-SVG toolbar icons (B I S code link table + save/open + new-tab + undo/redo + hamburger/file-doc + theme + view-mode glyphs; the hamburger export menu itself is text-only)
│   └── style.css               # all styles, light + dark themes, editor/preview/tab bar
├── src-tauri/
│   ├── tauri.conf.json         # Tauri config (window, bundle, plugin wiring)
│   ├── Cargo.toml              # Rust deps: tauri, plugin-fs, plugin-dialog, plugin-opener
│   ├── capabilities/default.json  # permissions (fs, dialog, opener)
│   ├── src/main.rs             # tauri::Builder + plugin init (no console window on Windows release builds)
│   └── icons/                  # .png / .ico / .icns bundle icons
├── .github/workflows/ci.yml    # CI: test suite + 3-OS build (installers + portables) → draft GitHub Release
├── LICENSE                     # AGPL-3.0
├── NOTICE                      # third-party dependency notices
└── test/
    ├── test.mjs                # round-trip invariant (no server, instant)
    ├── verify.mjs              # UI smoke test (screenshots → test/verify/)
    ├── verifyUndo.mjs          # undo/redo UI test
    ├── verifySaveOpen.mjs      # save / open / close-guard UI test
    ├── verifyToolbar.mjs       # toolbar active-states track the caret (41 cases)
    ├── verifyPaste.mjs         # rich-paste HTML→Markdown (18 cases)
    ├── verifyExport.mjs        # PDF/HTML export (menu + save/cancel, 30 cases)
    ├── verifyScroll.mjs        # split-view scroll-sync lag fix (5 cases)
    ├── verifyModeScroll.mjs    # mode-switch scroll-PRESERVING (8 cases)
    ├── verifyModeFocus.mjs     # mode-click focus skipped only entering preview (13 cases)
    ├── verifyTabClick.mjs      # redundant tab-click is a no-op (6 cases)
    ├── verifyTabScroll.mjs     # cross-tab scroll persistence (7 cases)
    ├── verifyThemeScroll.mjs   # theme-switch scroll preservation + themed scrollbars (10 cases)
    ├── verifyMermaidFlicker.mjs # mermaid anti-flicker: keystroke outside fence does not flash raw code (7 cases)
    ├── verifyMermaidStyle.mjs  # mermaid stylesheet-failure robustness + label centering (20 cases)
    ├── verifyCaret.mjs         # caret placement after editor actions (61 cases)
    └── verifyTauriClose.mjs    # native Tauri path (stubs __TAURI_INTERNALS__, no Rust)
```

`src/markdown.js` is the app shell — the `createApp()` core (tabs, keybinds, save/open, DnD, native/IPC wiring). Formatting mutations, link handling, and undo/redo are factored into the static factories `src/editing.js`, `src/links.js`, and `src/history.js`; the PDF/HTML pipeline lives in `src/export.js`, and versioned session persistence lives in `src/session.js`. All are static cross-file imports, so the production bundle still emits the required single `dist/assets/index-*.js` (no runtime code-split chunks). Further splitting is safe as long as the single-bundle invariant holds and no dynamic `import()` is introduced.

---

## Running in development

### Prerequisites

- Node.js 20+ / npm 10+
- Rust + the Tauri prerequisites for your OS:
  - **macOS**: Xcode CLT (`xcode-select --install`)
  - **Linux**: WebKitGTK, glib, gtk, librsvg (your distro's Tauri page lists the exact packages)
   - **Windows**: WebView2 (preinstalled on Win 10/11), MSVC Build Tools

  Make sure the Rust toolchain is on `PATH` (so `tauri dev`/`tauri build` can call
  `cargo`) — typically `export PATH="$HOME/.cargo/bin:$PATH"` in your shell profile.

### Steps

```bash
cd MarkdownEditor
npm install
npx tauri dev          # = npm run dev (vite) in one pane, Rust app in another
```

On first run it builds the frontend, installs Rust deps, and compiles the app. Subsequent runs are much faster.

To work on only the web UI in a browser (no native window):

```bash
npm run dev            # opens http://127.0.0.1:5173
```

---

## Building a deployable executable

```bash
npm install
npx tauri build
```

This runs `npm run build` (Vite production bundle into `dist/`), then `cargo build --release`, then packages a signed/distributed binary using the `bundle.targets` config (default: `all`).

Output locations:

| OS | Where the artifact lands |
|----|--------------------------|
| macOS | `src-tauri/target/release/bundle/macos/Markdown Editor.app` (+ `.dmg`, `.tar.gz`) |
| Linux | `src-tauri/target/release/bundle/deb/*.deb`, `.../rpm/*.rpm`, `.../appimage/*.AppImage` (whichever tools are installed) |
| Windows | `src-tauri/target/release/bundle/msi/*.msi`, `.../nsis/*.exe` |

The release binary itself lives at `src-tauri/target/release/markdown-editor` (or `markdown-editor.exe` on Windows) — you can copy that to any machine with the same OS/arch and the system dependencies and it will run without Node.

### Portable standalones (from GitHub Releases)

Each release also attaches a portable archive per OS (no install step — just unpack and run):

- Windows: `*-windows-x64-portable.zip` → `markdown-editor.exe` (WebView2 is preinstalled on Win 10/11).
- macOS: `*-macos-aarch64-portable.zip` → `Markdown Editor.app` (drag anywhere, double-click).
- Linux: `*-linux-x86_64-portable.tar.gz` → `markdown-editor` binary.

Yes — the Linux portable is **not** fully self-contained. Tauri renders via the system WebKitGTK, which is dynamically linked rather than bundled, so the target machine must provide it (same reason the CI build installs `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`). If it is missing the binary fails at startup with a `libwebkit2gtk` load error. Install the runtime libs first, e.g. on Ubuntu/Debian:

```bash
sudo apt-get install -y libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1 librsvg2-2
```

then:

```bash
tar -xzf markdown-editor-*-linux-x86_64-portable.tar.gz
./markdown-editor
```

If you cannot install system libraries, use the `*.AppImage` instead — it bundles most dependencies and remains the most portable Linux option. The `.deb` declares these as package dependencies and pulls them in automatically.

### Use only what you need

To speed up CI or reduce disk, narrow the bundle targets in `src-tauri/tauri.conf.json`:

```json
"bundle": { "targets": ["dmg"] }            // macOS
"bundle": { "targets": ["nsis"] }           // Windows installer
"bundle": { "targets": ["appimage"] }       // Linux
```

### Customizing the window / app id

Everything about the native shell (title, size, icons, identifier) is in `src-tauri/tauri.conf.json`. Update `productName`, `identifier`, and the `icons` array before shipping to a real user.

---

## Shortcut reference

| Action | Shortcut |
|---|---|
| Bold | `Ctrl+B` |
| Italic | `Ctrl+I` |
| Underline | `Ctrl+U` |
| Link | `Ctrl+K` |
| Save | `Ctrl+S` |
| New tab | `Ctrl+T` |
| Undo | `Ctrl+Z` |
| Redo | `Ctrl+Shift+Z` or `Ctrl+Y` |
| Word-wise caret move / selection | `Ctrl+←` / `Ctrl+→` (add `Shift` to extend; formatted spans count as one word) |
| Indent / Outdent | `Tab` / `Shift+Tab` |
| Open link at caret | `Ctrl+Click` |
| Close active tab | `Ctrl+W` (confirms if unsaved) |
| Close | `×` on the tab (confirms if unsaved) |

---

## Testing

- **Round-trip invariant** — the core renderer guarantee (overlay HTML stripped of `<span>` tags must reproduce the exact source).

  ```bash
  npm test
  ```

  Covers: bold, italic, strike, code, underline, links, mixed lines, H1–H3, quotes, `ul` / `ol`, code fences, tables, plain text.

- **UI smoke test (headless Chromium)** — builds, serves, and drives the app with Playwright. Exercises tabs, undo/redo, underline, and table insertion; screenshots land in `test/verify/`.

  ```bash
  npx playwright install chromium   # one-time
  npm run verify
  ```

- **Undo / redo UI test** — drives a real Chromium instance across 11 cases (undo, redo, multi-step, toolbar buttons, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y) and asserts the text after each step.

  ```bash
  npm run verify-undo
  ```

- **Save / open / close-guard UI test** — 24 assertions covering new/last-tab dirty prompts, the multi-tab save-then-discard walk (in the correct order), "keep editing" cancelling the close, and the last-tab clear prompt.

  ```bash
  npm run verify-save
  ```

- **Toolbar active-states test** — 18 assertions that the formatting buttons (bold / underline / code, and H1–H3 / plain) track the *caret* the instant it moves, with **no text change required**: programmatically placing the caret at the start/middle/end of a formatted line, moving it with the keyboard (End), and re-syncing on tab switch all update the right button and clear the rest.

  ```bash
  npm run verify-toolbar
  ```

- **Rich-paste test** — 18 assertions that pasting an **HTML clipboard** converts to Markdown and commits as a single undo-able edit: an Excel/HTML `<table>` becomes a GFM table (header + separator + rows, bold cells kept as `**…`), a `<b>`/`<i>`/`<u>` span becomes `**…**` / `*…*` / `<u>…</u>`, and a mixed run like `plain <b>bold</b> after` keeps only the bold part wrapped. Plain-text pastes (no `text/html`) are **not** intercepted, so the browser inserts the raw text unchanged.

  ```bash
  npm run verify-paste
  ```

- **Export-as-PDF/HTML test** — 30 assertions on the hamburger **Export** menu and its two save paths: the menu opens / closes / closes on outside-click / closes on Escape; **Export as HTML** re-renders the preview and, in-app, saves through `pickPath` + Tauri `fs.writeFile` (binary) to the chosen path — with a browser `Blob`-download fallback — and **Export as PDF** rasterizes the preview off-screen via `html2canvas` (scale 2, white bg, 780 px wide) and slices the canvas into A4 pages into a `jsPDF` doc (multi-page), again saving through the in-app picker. Both cancel paths leave the doc untouched and close the dialog, and the B/I/U/S formatting buttons stay **de-activated** after an export (exporting never selects or mutates the text).

  ```bash
  npm run verify-export
  ```

- **Scroll-sync lag fix** — 5 assertions that, in split view, a genuine scroll on the *follow* pane — the one that was driven by our last programmatic `scrollTop` assignment — is accepted as a fresh lead **immediately**. The old time-only echo window treated every scroll event on that pane within `ECHO_MS` as our own echo, so a real user scroll was swallowed for ~800 ms ("the left side lags and catches up"). The fix records the exact offset we wrote; `realScroll` suppresses a match **only** while the deadline is live AND the offset equals the assigned value (± 1 px), so a genuine scroll (a different offset) passes on the spot. Both directions are covered: scroll editor → 0.50 (stamps the preview echo), then scroll preview → 0.85 while the window is still hot, and assert the editor follows to the ratio-matched offset instantly; the mirror (preview → 0.30 → editor → 0.72) is likewise asserted.

  ```bash
  npm run verify-scroll
  ```

- **Mode-switch scroll-preservation** — 8 assertions that switching view mode via the toolbar's split/edit/preview button preserves the vertical scroll *ratio* instead of jumping the new view to the document bottom. The bug: the mode button refocusses the textarea, so with the caret at the end the browser auto-scrolls to the caret (bottom) and the split-view `followScroll` ratchet drags the other pane along — the user always landed at the bottom after a mode switch. The fix (`setMode` in `src/markdown.js`) records the leaving-mode ratio *before* applying the mode class, then re-asserts it on the newly-visible pane(s) after two nested `requestAnimationFrame` ticks (which beats the focus-auto-scroll race), stamping the value-based echo guard so the reflow can't ratchet a different value in. A stale-reassert guard skips the correction if the user switched modes (or tabs) again inside the rAF window, so fast split→edit→preview triple-taps don't leave a stale value. Covers: split→edit / edit→preview / →split at the top with the caret at the end (stays near the top, **not** the bottom — 3 cases), ratio carry-over split→edit at 55% and at 50%-with-caret-mid, and preview→split at 30% (3 cases), plus the "back at split after 3 fast clicks" mode assertion and the fast-triple-switch no-stale-overwrite guard (2 cases).

  ```bash
  npm run verify-modescroll
  ```

 - **Mode-click focus is skipped only when the mode hides the editor** — 13 assertions for the toolbar's mode (Split/Edit/Preview) button. The bug: the toolbar click handler ends with a trailing `activeTab.input.focus()` that runs after *every* action; when the mode action targets **preview** the editor pane becomes zero-width (`.mode-preview .pane-editor{flex:0;width:0}`), so that focus lands on the hidden textarea and — on WebKitGTK — an eager scroll-into-view is picked up by `realScroll`→`kickScrollSync`→`followScroll` and ratcheted onto the *preview* pane (the user saw "edit stays top, preview jumps to bottom"). The fix is **surgical**: the mode action does `if (next === "preview") return;` so the trailing focus is skipped *only* for the preview target, while split/edit targets still keep the normal caret-follow focus (keeping the editor focused there is expected, and it's what the `verify-modescroll` caret-mid cases depend on). A blanket `return` would have regressed those cases, so the guard is preview-only. The test blurs `document.activeElement` *before* each click to measure *causative* focus, then asserts: for edit→preview the textarea is **not** focused, while for split→edit and preview→split it **is** focused; the scroll ratio is preserved at the top and ~35% mid-doc. Headless Chromium does not reproduce the scroll-into-view quirk (its scroll assertions pass either way), so the focus assertions are the cross-platform discriminator — they fail the moment the `if` is dropped.

  ```bash
  npm run verify-modefocus
  ```

- **Redundant tab-click is a no-op** — 6 assertions that clicking a tab that is *already active* changes nothing. The bug: an already-active tab re-click ran the full `activate()` path — `input.focus()` (whose browser scroll-into-view snap moved both panes to the caret, e.g. 90% → ~bottom) then `refresh()` → `syncDom()`, which rewrote both panes' innerHTML and re-triggered the mermaid render — so flicking the active tab made the view jump and re-rendered any diagram on the page. The fix (`activate` in `src/markdown.js`) short-circuits with `if (doc === activeTab) return;` so a self-re-click is a pure no-op. Coverage: both panes scrolled to ~90% stay within 5% after three redundant clicks (2 cases), a probe attribute on the live preview node survives (proof the preview DOM was *not* rewritten — 1 case), and the mermaid diagram is still rendered with an unchanged count (1 case). The session-restore init path keeps working because `activeTab` is still `null` when the first tab activates (it uses a `restoreActive` temp instead of pre-assigning), so that legitimate first-activate still runs its class-toggle + focus.

  ```bash
  npm run verify-tabclick
  ```

- **Cross-tab scroll persistence** — a tab's vertical scroll position must *survive* switching away and back. The bug: hiding a tab uses `.pane-group { display: none }` (`src/style.css`), and the browser resets a `display:none`→shown scroll container's `scrollTop` to `0` — so a tab scrolled to 50% read 0 (top) on return. The fix (`activate` in `src/markdown.js`) captures the *leaving* tab's editor + preview scroll **ratios** while that tab is still laid out, then — after the entering tab becomes visible and `refresh()` has run — re-asserts the entering tab's remembered ratios on both panes after two rAF ticks (mirroring `setMode`/`openAtTop`), stamping the value-based `__suppE`/`__suppP` echo guard on each so the programmatic restore can't be misread as a user scroll or kick the split-view follow. A guard (`if (doc !== activeTab) return`) drops a stale re-assert if the tab changed again inside the rAF window. Coverage: both panes of a tall tab (with a rendered mermaid diagram) scrolled to ~50% (1 case) stay within 5% of 50% after switching to Beta and back (2 cases), a second tab Beta holds a *different* ~25% ratio (1 case) through its own round trip (1 case), while Alpha still holds its ~50% afterwards — proving no cross-tab clobber (1 case), plus a scrollability sanity probe (1 case).

  ```bash
  npm run verify-tabscroll
  ```

  - **Theme-switch scroll preservation + themed scrollbars** — 10 assertions in two halves. **Scroll:** switching Light→Dark and Dark→Light preserves the current editor and preview vertical scroll *ratios* in both directions (both panes stay within 5% of their pre-switch position — 4 cases). **Scrollbars:** the scrollbar palette must flip with the theme — the `--sb` thumb var, the standard `scrollbar-color` thumb stop, and the `::-webkit-scrollbar-thumb` background all resolve to a *light* color in light mode and a *dark* color in dark mode (6 cases). This guards the Windows regression where WebView2's OS chrome painted its own themed scrollbars — dark scrollbars in a light app, light scrollbars in a dark app. The fix (in `src/style.css`) sets a per-theme `color-scheme` (`light` / `dark`) so native chrome follows the app, and defines `--sb` / `--sb-hi` thumb colors per theme consumed by both `scrollbar-color` and the `::-webkit-scrollbar*` rules. Assertions read resolved luminance and sit their thresholds in the clear gap between the light (~0.42–0.62) and dark (~0.08–0.12) sets, so Chromium's habit of resolving the `:hover` variant never misclassifies.

    ```bash
    npm run verify-themescroll
    ```

- **Mermaid anti-flicker** — a keystroke in prose **outside** a ` ```mermaid ` fence must never flash raw code. The old flow was `syncDom` → `d.preview.innerHTML = marked.parse(...)` (which re-creates all `pre > code.language-mermaid` fences back to raw text) → 120 ms debounce → `mermaid.render`. Any keystroke in the prose section wiped the already-rendered SVG holder; the re-render only arrived after 120 ms, producing a visible flash of raw code. The fix (in `src/mermaid.js`) has two co-operating parts: **(a)** after every successful `mermaid.render`, the SVG string + the `bindFunctions` closure are stored in a `_svgCache` keyed by the exact fence source; **(b)** in `syncDom`, immediately after `d.preview.innerHTML = marked.parse(...)`, a synchronous call to `restoreMermaid(d.preview)` walks every `pre > code.language-mermaid` element and substitutes the cached `<div class="mermaid-diagram">` holder in place — zero async, zero timers. A separate `mermaidSourceKey(md)` gate in `scheduleMermaidRender` skips the 120 ms timer entirely when the fence source didn't change. Coverage (`npm run verify-mermaidflicker`, 7 cases): the diagram holder is present in the same synchronous tick as a prose keystroke (no raw code visible at any poll); typing inside the fence source invalidates the cache and the 120 ms debounce re-renders; the cache survives a tab switch and return; two distinct fences cache and restore independently; and a prose keystroke does not fire a redundant `mermaid.render` call. The test fixture uses valid mermaid (`A[Start] --> B[End]`) — invalid source would throw and populate no cache entry, making the anti-flicker path untestable. A **stale-render guard** in `renderMermaidInNode` (plus `restoreMermaid`) checks `pre.isConnected && node.contains(pre)` before and after the async `mermaid.render` and skips instead of appending when detached — previously the `else node.appendChild(holder)` fallback appended a stale duplicate diagram above the real one on Windows WebView2. A **stylesheet-failure fallback** (`installMermaidStyles` + `stampSvgStyles` in `src/mermaid.js`) does two things with Mermaid's OWN generated CSS — no hardcoded theme values: (1) mirrors the SVG `<style>` into a document-level `<style data-mermaid-style="…">` scoped by the SVG's unique id; (2) parses the sheet in pure JS (brace-depth scan with quote handling; deliberately NO CSSOM — the Windows diagnostics proved WebView2's `insertRule` rejected every rule of a throwaway sheet, so the engine path stamped nothing) and stamps every `prop: value` onto matching shapes as presentation attributes. Presentation attributes lose to author CSS, so where the stylesheet applies (Linux/WebKitGTK) rendering is pixel-identical; where NO `<style>` applies at all (the observed Windows WebView2 failure), the attributes carry the diagram. SVG shapes are always overwritten (so mermaid's inline `stroke="none"` placeholders and grey actor defaults are replaced by the sheet's real values, keeping a stylesheet-failed Windows identical to Linux), and HTML labels inside foreignObject get their declarations as inline styles, so text centers and colors correctly even without a working stylesheet. The SVG cache and render gate are keyed by theme + source, so toggling light/dark re-renders every diagram in the new theme. The mermaid render pins `mermaid.initialize({ fontFamily: '"trebuchet ms", verdana, arial, sans-serif' })` so the PAINTED label font (the generated sheet's `themeVariables.fontFamily`) is the same stack mermaid MEASURES label text with — without it Windows paints HTML labels in Arial while boxes were sized with Trebuchet MS metrics (off-center labels), and Linux collapses both to one fontconfig substitute which hid the bug. Covered by `npm run verify-mermaidstyle` (20 cases: stamped attrs, total-`<style>`-removal survival, font consistency, `p{margin:0}`, oversized-foreignObject flex centering, text-label re-anchoring via the painted start-anchor-from-center fingerprint (any shape type, transform-proof), WebKitGTK center-snap, idempotency).

   ```bash
   npm run verify-mermaidflicker
   ```

- **Mermaid stylesheet robustness** — diagrams must stay readable even if the platform never applies the SVG-internal `<style>` (Windows WebView2 black-node regression). After removing EVERY `<style>` element in the document, node fills and message strokes still match the theme via stamped presentation attributes. The generated sheet also carries the SAME fontFamily stack mermaid measures label text with (the Windows label-centering fix). A Ctrl+Shift+M diagnostics modal reports the live state of each layer (SVG style length, head mirror present, stamped attrs, computed fill) plus per-label geometry (label center vs shape center, computed painted font) so a Windows report can pin down which layer failed. When a label's painted line box is far shorter than the foreignObject mermaid allocated for it, the label div is flipped to a centered flex column so the text centers in whatever box was measured (the pass runs after the holder is attached to the DOM — a detached holder's rects are all 0 and the fix would silently no-op).

   ```bash
   npm run verify-mermaidstyle
   ```

- **Native (Tauri) path test** — instead of a browser fallback, this injects the exact `window.__TAURI_INTERNALS__` the real app gets and drives the **genuinely imported** `@tauri-apps` api. It fires a `close-requested` event and asserts, across 43 cases: the save-then-close walk (Save → in-app Save-As picker → a real `fs/write_text_file` to the chosen path with the document's exact contents **and** the window actually closes, no `preventDefault`); picker-cancel keeps the window open with nothing written; a tab that already has a path → direct write (no picker); `open()` → in-app open picker → `fs/read_text_file` into a fresh tab (vs. picker-cancel creating no tab); navigating the picker into an out-of-scope/forbidden directory → the crumb **stays on the last readable directory** with a "Cannot read …" error (it never adopts the failed path); the **Home button** — always present in the picker's pathbar — jumps the picker back to the user's home dir even after navigating several levels deep; and the picker **enters a hidden (dot) folder** (drives `read_dir` into `~/.config`), the UI-side guard for the `requireLiteralLeadingDot: false` fs-scope fix. Needs the built `dist/`; no Rust toolchain required.

  ```bash
  npm run verify-tauri
  ```

- **Caret placement after editor actions** — 25 assertions that every edit committed this session lands its caret where a typist expects it, never as a highlighted selection. Coverage: Enter on a nested bullet/ordered item continues the marker **with the parent's indentation** (a skipped-tab regression) and the empty-item Enter still exits the list; Tab indents a whole line *and blank lines* with the caret's column preserved and always a **collapsed** selection (same for Shift+Tab, including the column-0 case); inline bold over a mid-word caret or a selection collapses the caret at the end of the inner text right **before the closing `**`** (`bold **test**` with caret after the final `t`), toggle-OFF lands after the unwrapped span, and the caret-in-a-gap case still inserts the empty marker pair while keeping the caret between the markers; code-fence wrap puts the caret **inside** the fence — on the blank middle line for an empty block (````` ```\n|\n``` ````), after the content before the `\n``` ` tail otherwise; table insert leaves the caret in the first body cell; and the h1 button leaves the caret at the end of the rewritten block.

  ```bash
  npm run verify-caret
  ```

All of these exit non-zero on any failure or console error, so they can be wired into CI.

---

## CI / Releases

The GitHub Actions pipeline (`.github/workflows/ci.yml`) does **not** run on
every push (saves runner compute). It runs on:

| Event | Triggers | What it does |
|---|---|---|
| A new or updated PR | `pull_request: opened, synchronize, reopened, ready_for_review` | `test` only — the full Playwright suite (no installers) |
| You cut a release | `release: created` | `test` first; if green, three `build` jobs in parallel → installers + portables attached to the release |

### Cut a release

The git tag is the single source of truth for the version — there are no version files to bump by hand (`src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` keep a `0.0.0` placeholder; CI injects the tag version into both before `tauri build`).

1. From the repo's **Releases** page, go to **Draft a new release** → enter the tag `v0.1.1` → **Publish** (or `git tag v0.1.1 && git push --tags`). Allowed tags: `vX.Y.Z` (e.g. `v0.1.4`) or `vX.Y.Z-N` with numeric `N <= 65535` (e.g. `v0.1.4-1`). Text prereleases like `v0.1.4-rc.1` are rejected — the Windows MSI bundler (WiX) requires a numeric-only prerelease.
2. On `release: created`, a `validate-tag` gate runs first (seconds, fails fast on a bad tag before any build time is spent), then the `test` job. If green, the three build jobs run in parallel via `tauri-apps/tauri-action@v0` (installers) plus a portable-packaging step (no extra compile — re-packages the already-built output, uploaded with `gh release upload`):
   - **Windows** (`windows-latest`) → `nsis` (`.exe`) + `msi` + `*-windows-x64-portable.zip` (raw `markdown-editor.exe`, no install)
   - **macOS** (`macos-14`) → `dmg` + `*-macos-aarch64-portable.zip` (the `.app` bundle via `ditto`, no install)
   - **Linux** (`ubuntu-22.04`) → `appimage` + `deb` + `*-linux-x86_64-portable.tar.gz` (raw `markdown-editor` binary)

   Installers + portables are attached to the same `v<version>` release you just cut. The Linux portable still needs system WebKitGTK/GTK on the target machine — the AppImage remains the most portable Linux option. The macOS/Windows portables are unsigned, so Gatekeeper/SmartScreen will warn on first run.

### Signing

With no secrets set, builds produce **unsigned** installers (fine for personal use;
macOS Gatekeeper / SmartScreen will warn). To produce signed, notarised / update-able
releases, add these to **Settings → Secrets and variables → Actions**:

| Secret | Purpose |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Enables the updater JSON (auto-update) |
| `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_CERTIFICATES`, `APPLE_SIGNING_PASSWORD` | macOS Developer ID + notarisation |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | Windows SmartCard / code-signing cert |

## Handy scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server (browser-only UI at `http://127.0.0.1:5173`) |
| `npm run build` | Production Vite bundle into `dist/` |
| `npm test` | Round-trip renderer invariant |
| `npm run verify` | Headless UI smoke test (needs Playwright) |
| `npm run verify-undo` | Headless undo/redo UI test (11 cases, needs Playwright) |
| `npm run verify-save` | Headless save/close-guard UI test (24 cases, needs Playwright) |
 | `npm run verify-toolbar` | Headless toolbar active-state test: B/I/U/S/code/link/H1–H3 track the caret click/arrow/programmatic, incl. trailing-comma tokens, multi-word spans, code-span precedence, and toggle-OFF comma preservation; also guards collapsed-caret formatting — a plain caret (empty line, between words, token edge) inserts an EMPTY marker pair with the caret between the markers (never wraps a neighbouring word), a caret inside a format span toggles off, a mid-word caret wraps that word, and a single-line selection wraps exactly (41 cases, needs Playwright) |
| `npm run verify-paste` | Headless rich-paste test: HTML clipboard → Markdown, 1 undo step (18 cases, needs Playwright) |
| `npm run verify-export` | Headless PDF/HTML export test: menu + save/cancel + format isolation (30 cases, needs Playwright) |
| `npm run verify-scroll` | Headless split-view scroll-sync test: a real follow-pane scroll inside the echo window is accepted at once (5 cases, needs Playwright) |
| `npm run verify-modescroll` | Headless mode-switch test: split/edit/preview preserves the scroll ratio (8 cases, needs Playwright) |
 | `npm run verify-modefocus` | Headless mode-click focus test: the mode button skips its trailing focus *only* when entering preview (the hidden textarea's scroll-into-view); split/edit targets still get caret-follow focus (13 cases, needs Playwright) |
| `npm run verify-tabclick` | Headless redundant-tab-click test: an already-active tab re-click is a no-op (scroll preserved, preview DOM untouched, mermaid not re-rendered) (6 cases, needs Playwright) |
| `npm run verify-tabscroll` | Headless cross-tab scroll-persistence test: a tab's editor + preview scroll survive leaving and returning (no cross-tab clobber) (7 cases, needs Playwright) |
 | `npm run verify-mermaidflicker` | Headless mermaid anti-flicker test: a keystroke in prose outside a fence does NOT flash raw code — the holder is restored synchronously from cache in the same tick; a keystroke inside the fence still re-renders (7 cases, needs Playwright) |
| `npm run verify-mermaidstyle` | Headless mermaid stylesheet-failure test: stamped attrs exist, `stroke="none"` placeholders overwritten, computed styles survive removal of EVERY `<style>` element, the sheet paints the same fontFamily mermaid measures with, oversized label boxes get flex-recentered, and plain-text labels painting with the start-anchor-from-center fingerprint (center displaced by half their width from the nearest shape) re-anchored to text-anchor:middle via the painted start-anchor fingerprint, middle-anchored labels center-snapped with a rounded translate (WebKitGTK dominant-baseline quirk) (20 cases, needs Playwright) |
| `npm run verify-tauri` | Native Tauri path test (stubs `__TAURI_INTERNALS__`, real api/IPC, overwrite confirmation, picker Home button + hidden-folder navigation) |
| `npm run verify-caret` | Headless caret-placement test (61 cases): Enter list-continuation keeps indentation with a collapsed caret; Tab/Shift+Tab (incl. blank lines) commit without highlighting and the caret column follows the text; inline formats collapse at the end of the inner span before the closing marker; code-fence wrap caret sits inside the fence; table insert caret in the first body cell; Markdown-aware Ctrl+Arrow word moves — whitespace-run words (trailing punctuation rides along, standalone ` - ` its own stop) with formatted spans atomic, line-crossing stops at the next line's first word, only document edges fall through native |
| `npx tauri dev` | Native dev window (alias: `npm run app`) |
| `npx tauri build` | Deployable executable + bundle artifacts (alias: `npm run app:build`) |

---

## Security notes

- `src-tauri/capabilities/default.json` grants `fs`, `dialog`, and `opener` to the main window with `scope: ["**"]` — i.e. any path. If you plan to ship this to third parties, tighten the scope to specific directories or add an allow-list in a custom command.
- The CSP in `tauri.conf.json` currently allows `unsafe-inline` for styles. This is because the editor injects inline styles on the overlay. If you remove inline styles, you can drop that.

### Tauri integration gotchas (do not regress)

- **`isTauri()` must detect `__TAURI_INTERNALS__`, not `__TAURI__`.** This is a Vite/bundler build (no `withGlobalTauri` in `tauri.conf.json`), so Tauri injects `window.__TAURI_INTERNALS__` and *not* `window.__TAURI__`. If `isTauri()` checks only `__TAURI__` it returns false in the real app and **every** native branch silently falls through to the browser no-op: `save()` becomes a dropped `Blob` download, and `onCloseRequested` never registers (the window closes with unsaved tabs). Keep it as `!!(window.__TAURI_INTERNALS__ || window.__TAURI__)`. This was the actual root cause of "save silently does nothing" and "close guard missing".
- **All Tauri plugins must be statically imported** (top of `src/markdown.js`). Do NOT switch them back to `await import("@tauri-apps/plugin-*")`. The GTK webview does not reliably resolve Vite code-split chunks for these modules, and the resulting silent failures were:
  - `save()` falling through to a `Blob`-download `.click()` that WebKitGTK ignores — the tab then closed thinking it saved (data lost).
  - `win.onCloseRequested` never wiring up — the window closed with unsaved tabs and no prompt.
- **The window-close handler must NOT self-close.** Tauri's `onCloseRequested` wrapper runs `await handler(evt); if (!evt.isPreventDefault()) await this.destroy()`. So the correct handler is `async`: **on cancel** → `event.preventDefault()` (window stays); **on success** → do nothing (the wrapper calls `destroy()`). It must NOT call `win.close()` and must NOT `preventDefault()` unconditionally — `close()` re-emits `close-requested`, the wrapper re-fires the handler (which `preventDefault()`s again), and `destroy()` never runs → the window deadlocks open.
- Every native call is wrapped in `isTauri()` so the same file still runs in a plain browser (where save uses a file download and there is no window-close interceptor).
- **Toolbar active-states must track the caret, not just text changes.** The per-textarea `select` event is **unreliable on WebKitGTK** — it can silently never fire for a click or arrow-key move there (it fired fine under Chromium while developing), and the `click` handler historically only refreshed the status bar, *not* the buttons. So the buttons used to flip only when the text changed. The fix listens to the document-level `selectionchange` event (fires for *every* caret move, regardless of mechanism) on the active tab, with a `mouseup` + `requestAnimationFrame` refresh as a fallback, and re-syncs on tab switch via `activate()` → `refresh()`. Don't "simplify" by relying on `select`/`keyup` alone.
-- `src/markdown.js:closeApp()` is the single source of truth for the "prompt for every dirty tab before the window closes" walk. `removeTab`, a `beforeunload` listener, and the `onCloseRequested` handler all funnel through it, so the prompt order (save order = tab DOM order) is guaranteed.

---

## License

- **License**: [AGPL-3.0](LICENSE). We chose a strong copyleft deliberately: everything we ship, and anything run over a network, stays free and open-source. You may not take this code (or a fork) into a proprietary product.
- **Third-party notice**: [NOTICE](NOTICE) lists bundled dependencies and which license each is under — permissive (MIT / Apache-2.0 / BSD, incl. the dual-licensed Tauri stack and `mermaid`) vs. the user-approved copyleft exception (`elkjs`, EPL-2.0) — plus the test-only `playwright` (Apache-2.0) and the Linux-only system WebKitGTK runtime (LGPL, not bundled).
- **Compatibility note**: the top-level AGPL-3.0 license is the umbrella. Permissive dependencies join the combined work under AGPL terms while keeping their own notice; the compatible copyleft exceptions (`elkjs`, EPL-2.0) and the unmodified shared runtime WebKitGTK (LGPL) do not conflict with AGPL-3.0. The **LGPL** system WebKitGTK we merely link to is a System Library we don't bundle, and it therefore does not force any additional copyleft on this project.
- **Adding a dependency?** Per [AGENTS.md](AGENTS.md), prefer permissive (MIT / Apache-2.0 / BSD) libraries. Copyleft (GPL-3.0, AGPL-3.0, EPL-2.0, MPL-2.0, LGPL-3.0) is *compatible with AGPL-3.0* but should still be a deliberate, user-reviewed call. Source-available / non-free (SSPL, BUSL, Elastic, Commons Clause) and any license with further restrictions AGPL §7/§10 treats as incompatible must be flagged to the maintainer before use. Then update `NOTICE` in the same change.

---

## Maintainers / contributors

`AGENTS.md` and this `README.md` are the source of truth for how to build, test, and run this project. **When you change anything user- or tool-visible** — a file, a `package.json` script, a permission or scope in `src-tauri/capabilities/default.json`, an invariant, a keybind, a limitation, or any behavior — **update both `AGENTS.md` and `README.md` in the same change** so neither doc describes the state before your edit.
