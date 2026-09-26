# Markdown Editor

A lightweight, cross-platform WYSIWYG-style Markdown editor. Documents stay plain `.md` files — the editor only layers a color/highlight overlay on top, so there is no lock-in and no hidden formatting.

Built with **Tauri** (native shell) + **Vite** (web frontend). No framework — plain JS, one DOM, one source of truth. [AGENTS.md](AGENTS.md) is the exhaustive engineering reference (invariants, test history, conventions); this README is the readable overview.

---

## Features

- **Split / Edit / Preview** view modes, **multi-file tabs** (`Ctrl+T` new, `Ctrl+W` / `×` close)
- **Inline formatting** — bold, italic, underline, strikethrough, code, links (`Ctrl+B/I/U/K`); a plain caret inserts an empty marker pair, a mid-word caret wraps that word, a selection wraps exactly
- **Find & Replace** — floating non-modal bar (`Ctrl+F` find, `Ctrl+H` replace); live match count, the current match is auto-selected and highlighted as you type; `Esc` stays on the hit instead of jumping back (`Enter`/`F3` next, `Shift+Enter`/`Shift+F3` prev, wrap-around), case toggle, regex mode with `$1` substitutions; replace and replace-all each commit as ONE undo step; in split view the preview pane follows the editor to the revealed match
- **GFM task lists** — `- [ ]` / `- [x]` render as live checkboxes in the preview; clicking flips the source line in one undo-able step (exports keep them inert)
- **Recent files** — hamburger → "Recent files…" opens a hover sub-menu with the last 5 opened/saved files (persisted); a click reopens the file in a new tab, stale entries fail and are dropped. "Export…" groups the PDF/HTML export items in its own sub-menu
- **Code highlighting** — fenced code blocks with a known language (js/ts, python, json, bash, html, css, rust, go, c/cpp, java, sql, yaml, diff, ini/toml) render with syntax colors in the preview and both exports; unknown languages stay plain code
- **Block formatting** — H1–H3, quotes, lists, code fences, GFM tables, Mermaid and math scaffolds (Σ button). Inserters are **insert-only**: a second click inserts another scaffold, never removes
- **LaTeX math (KaTeX)** — `$$…$$` display blocks and inline `$…$` typeset in the live preview and both exports (the HTML export embeds the KaTeX fonts, so it renders offline). Pandoc-style rules keep prose like `costs $5 and $10` literal; invalid LaTeX shows in red
- **Mermaid diagrams** — `` ```mermaid `` fences render live in the preview and are captured in exports; errors show inline in red
- **Live toolbar state** — every format button lights up to match the caret instantly (clicks, arrow keys, paste, undo, tab switch); code spans and display math take precedence where they should
- **Markdown-aware caret moves** — `Ctrl+←/→` jump a whole word (formatted spans count as one word, trailing punctuation rides along); add `Shift` to extend/shrink from the caret edge
- **Enter / Tab smart editing** — Enter auto-continues list items with indentation; Tab / Shift+Tab indent/outdent (blank lines too), always committing a collapsed caret
- **Rich paste** — an HTML clipboard (Excel/Word table, bold/italic/underline spans) converts to Markdown in one undo-able step
- **Export** — hamburger → "Export…" → "As PDF…" / "As HTML…"; renders your live preview into a self-contained `.html` (math fonts embedded) or multi-page A4 `.pdf`
- **Drag-and-drop** `.md` files onto the window; **Ctrl+click** a link in the source to open it
- **Session persistence** (`localStorage`) + an **unsaved-changes guard** on tab/window close
- **Light / Dark** theme (persisted, restored on start); scroll positions are preserved across tab/mode/theme switches and while the Save/Open/Export dialog is open (and on its close — no flicker); scrollbar colors follow the theme
- **Content-anchored scroll sync** — in split view the preview follows the editor by BLOCK, not by scroll fraction: scroll to a heading (even deep in a document full of diagrams/tables/math) and the same heading sits at the top of the preview; either pane can lead; end-of-document positions snap together
- **In-app file picker** for save/open (centered, breadcrumbs, Home button, hidden/dot folders reachable) with an overwrite-confirmation prompt; browser fallback throughout

---

## How it works (short)

- An invisible `<textarea>` shares exact font metrics with a pre-rendered highlight `<div>`; the caret never drifts.
- **Round-trip invariant**: stripping every `<span>` from the overlay HTML must reproduce the source character-for-character — that is what keeps the caret aligned (`npm test` enforces it).
- The DOM is the single source of truth; overlay and preview both re-render from it, so undo/redo is a simple stack of snapshots.
- All Tauri/export/diagram/math libraries are **statically imported** so the GTK webview never loads a code-split chunk and the production bundle stays a **single `dist/assets/index-*.js`**; every Tauri call is guarded by `isTauri()` (which must detect `__TAURI_INTERNALS__`).

---

## Project layout

```
MarkdownEditor/
├── index.html                  # entry page, loads the Vite bundle
├── vite.config.js              # dev/preview server on 127.0.0.1 (avoids IPv6 localhost mismatch)
├── src/
│   ├── main.js                 # bootstrap: createApp(#app) + sample content (feature-tour welcome doc; + katex css/asset imports)
│   ├── markdown.js             # app shell: createApp() — tabs, undo, keybinds, save/open, DnD, modals, recent-files menu; static Tauri imports
│   ├── export.js               # static PDF/HTML export pipeline and native/browser save adapters
│   ├── session.js              # versioned localStorage persistence and debounced saves
│   ├── dialogs.js              # centered in-app modals and overwrite confirmation
│   ├── picker.js               # in-app Save/Open filesystem picker (platform-aware path separator)
│   ├── editing.js              # formatting mutations (inline toggles incl. $…$ math) and indentation factory
│   ├── links.js                # link detection and Tauri/browser opening factory
│   ├── history.js              # undo/redo history factory
│   ├── find.js                 # floating non-modal Find & Replace bar (literal + regex, one-undo replace-all)
│   ├── tasks.js                # GFM task lists: preview checkbox enhancement + ordinal→source mapping
│   ├── scrollsync.js           # block-anchored split-view scroll sync (marked-lexer anchors + measured overlay geometry)
│   ├── codecolor.js            # fenced-code syntax highlighting (highlight.js core + ~16 grammars)
│   ├── render.js               # overlay-highlight renderer (esc, computeBlocks, lineToHtml, highlightToHtml)
│   ├── mermaid.js              # mermaid SVG rendering + anti-flicker cache + stylesheet-failure fallback
│   ├── format.js               # selection + format detect/wrap helpers (lineBounds, wordAt, detectFormat, …)
│   ├── paste.js                # rich-paste HTML→Markdown (mdFromHtml, mdTableFromHtml, …)
│   ├── math.js                 # LaTeX math ($$ block + $ inline, KaTeX): renderMarkdown pipeline + export-CSS builder
│   ├── katexExportAssets.js    # browser-only katex ?raw/?url imports (main.js only) for the HTML math export
│   ├── icons.js                # inline-SVG toolbar icons
│   └── style.css               # all styles, light + dark themes, editor/preview/tab bar
├── src-tauri/
│   ├── tauri.conf.json         # Tauri config (window size, bundle, plugin wiring, CSP)
│   ├── Cargo.toml              # Rust deps: tauri, plugin-fs, plugin-dialog, plugin-opener
│   ├── capabilities/default.json  # permissions (fs, dialog, opener)
│   ├── src/main.rs             # tauri::Builder + plugin init (no console window on Windows release builds)
│   ├── icons/                  # generated bundle icons (`npx tauri icon icon.svg`); the .ico needs the FULL
│   │                           # 32×32 + 256×256 layered set (a degenerate one breaks the Windows build)
│   └── icon.svg                # icon source art — edit this, then regenerate the whole icons/ dir
├── .github/workflows/ci.yml    # CI: test suite + 3-OS build (installers + portables) → draft GitHub Release
├── LICENSE.md / NOTICE.md      # AGPL-3.0 + third-party notices
└── test/                       # one test file per feature regression (see Tests below)
```

Everything cross-file is a **static import**; further splitting is safe as long as the single-bundle invariant holds and no dynamic `import()` is introduced.

---

## Running in development

```bash
npm install
npx tauri dev          # native dev window (also compiles Rust; first run is slow)
npm run dev            # browser-only UI at http://127.0.0.1:5173
```

Prerequisites: Node 20+, Rust + your OS's Tauri packages (macOS: Xcode CLT; Linux: WebKitGTK/gtk/librsvg; Windows: WebView2 + MSVC). Rust must be on `PATH` (`export PATH="$HOME/.cargo/bin:$PATH"`).

## Building

```bash
npx tauri build
```

Artifacts land in `src-tauri/target/release/bundle/` (`.app`/`.dmg` on macOS, `.deb`/`.rpm`/`.AppImage` on Linux, `.msi`/`.exe` on Windows); the raw binary is `src-tauri/target/release/markdown-editor[.exe]`. GitHub releases also attach portable archives per OS. The Linux portable needs system WebKitGTK/GTK (the AppImage is the most self-contained option):

```bash
sudo apt-get install -y libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1 librsvg2-2
```

Window title/size/icons/identifier live in `src-tauri/tauri.conf.json` (default 1200×780, min 720×400). App icons come from `src-tauri/icons/` — regenerate the whole set with `npx tauri icon icon.svg` after editing the source art (the bare `.exe`/AppImage icon is embedded into the binary at Rust build time and picked from `icons/icon.ico`; Windows Explorer can cache the old glyph — `ie4uinit.exe -show` refreshes it).

## Shortcut reference

| Action | Shortcut |
|---|---|
| Bold / Italic / Underline / Link | `Ctrl+B` / `Ctrl+I` / `Ctrl+U` / `Ctrl+K` |
| Find / Replace | `Ctrl+F` / `Ctrl+H` (next `Enter`/`F3`, prev `Shift+Enter`/`Shift+F3`, close `Esc`) |
| Save / New tab / Close tab | `Ctrl+S` / `Ctrl+T` / `Ctrl+W` |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y` |
| Word-wise caret move / selection | `Ctrl+←` / `Ctrl+→` (+ `Shift`; formatted spans count as one word) |
| Indent / Outdent | `Tab` / `Shift+Tab` |
| Open link at caret | `Ctrl+Click` |
| New tab (anywhere) | `Ctrl+Click` the window |

---

## Testing

Every guard is a standalone Playwright (or Node) script; all exit non-zero on any failure. **The full "why" behind each guard — the regression it pins and the debugging history — lives in [AGENTS.md](AGENTS.md).**

```bash
npx playwright install chromium   # one-time
npm test                          # round-trip invariant + math pipeline (Node, instant)
npm run verify                    # UI smoke test (tabs, undo, tables)
```

**Run targeted, not everything.** The suite is long, and CI runs the FULL roster
on every PR and release. Locally, run `npm test` plus only the `verify-*` suites
your change touches (the mapping is listed in [AGENTS.md](AGENTS.md)); save the
full local run for release-grade milestones.

| Script | Cases | Guards |
|---|---|---|
| `verify-undo` | 11 | undo/redo UI walk |
| `verify-save` | 24 | save / close-guard dialogs, dirty-tab walk order |
| `verify-toolbar` | 56 | toolbar active-states track the caret; inline-math guards (code/display/currency precedence) |
| `verify-paste` | 18 | HTML clipboard → Markdown, single undo step |
| `verify-export` | 32 | PDF/HTML export menu + save/cancel paths |
| `verify-math` | 21 | KaTeX preview rendering; self-contained HTML export; PDF raster |
| `verify-scroll` | 5 | split-view scroll-sync accepts a real follow-pane scroll instantly; follow lands on the content-matched block |
| `verify-dialogscroll` | 30 | opening the Save/Open/Export picker never moves the document (toolbar buttons, Ctrl+S/O, cancel keeps focus+position, close doesn't flicker) |
| `verify-scrollsync` | 16 | block-anchored sync: deep-heading alignment after mermaid/KaTeX regions, per-row table anchors, preview-lead parity, wrap-heavy docs, ratio fallback on desync, end-of-doc convergence (no snap/blend overshoot), elastic follower glide (instant only for tiny deltas), end-region re-correction pans slowly |
| `verify-modescroll` | 8 | mode switch preserves the scroll ratio |
| `verify-modefocus` | 13 | mode click skips its trailing focus only when entering preview |
| `verify-tabclick` | 6 | re-clicking the active tab is a no-op |
| `verify-tabscroll` | 7 | a tab's scroll positions survive switching away and back |
| `verify-themescroll` | 10 | theme switch preserves scroll; scrollbars flip with the theme |
| `verify-mermaidflicker` | 7 | no raw-code flash on prose keystrokes outside a fence |
| `verify-mermaidstyle` | 38 | mermaid stylesheet-failure fallback + label centering |
| `verify-mermaidfade` | 16 | dark-theme gradient outlines off, no drop shadow |
| `verify-tauri` | 49 | native Tauri path (stubs `__TAURI_INTERNALS__`, real api/IPC) |
| `verify-caret` | 92 | caret placement after every edit action, never a highlighted selection |
| `verify-find` | 38 | Find & Replace bar: open/close/focus, count, wrap navigation, case/regex toggles, one-undo replace & replace-all, `$1` groups, split-view preview-follow on reveal |
| `verify-tasks` | 12 | task-list checkboxes render live, click flips the source in ONE undo step, code-fence checkboxes stay inert |
| `verify-recent` | 12 | recent-files menu: record on open/save, dedupe, cap 10, click opens a new tab, stale entries drop |
| `verify-codecolor` | 7 | fenced-code tokens highlight in the preview, unknown/mermaid stay plain, token colors paint |

---

## CI / Releases

The pipeline (`.github/workflows/ci.yml`) does **not** run on every push (saves compute):

| Event | What runs |
|---|---|
| PR (`opened/synchronize/reopened/ready_for_review`) | the full Playwright `test` job |
| Release created | `validate-tag` → `test` → three parallel build jobs (Windows/macOS/Linux installers + portables) attached to the release |

**Cutting a release**: the git tag is the version — there are no version files to bump. Draft/publish a release with tag `vX.Y.Z` (numeric prerelease suffix `-N`, `N ≤ 65535`, is allowed; text like `-rc.1` is rejected by the Windows MSI bundler). CI injects the tag into `tauri.conf.json`/`Cargo.toml` before building.

**Signing**: with no secrets set, installers are unsigned (Gatekeeper/SmartScreen warn on first run). To sign, add `TAURI_SIGNING_PRIVATE_KEY` (updater), `APPLE_ID`/`APPLE_TEAM_ID`/`APPLE_CERTIFICATES`/`APPLE_SIGNING_PASSWORD` (macOS notarisation), and/or `CSC_LINK`/`CSC_KEY_PASSWORD` (Windows) to the repo's Actions secrets.

---

## Security notes

- `src-tauri/capabilities/default.json` grants `fs`/`dialog`/`opener` with `scope: ["**"]` — any path, including hidden dot-folders (intentional, via `plugins.fs.requireLiteralLeadingDot: false`). Tighten before shipping to third parties.
- The CSP allows `unsafe-inline` styles because the editor injects inline styles on the overlay.

### Tauri gotchas (do not regress — full detail in AGENTS.md)

- `isTauri()` must detect `__TAURI_INTERNALS__` (not `__TAURI__`) or every native branch silently no-ops in the real app.
- All Tauri/export libraries are **statically imported** — never `await import(...)`; the GTK webview fails to resolve split chunks (silent data loss: save becomes a dropped download, the close guard never registers).
- The window-close handler must not self-close or `preventDefault()` unconditionally — cancel → `preventDefault()`, success → do nothing (the wrapper destroys).
- `closeApp()` is the single dirty-tab prompt walk; toolbar active-states track the caret via `selectionchange` (never `select`/`keyup` only — unreliable on WebKitGTK).

---

## License

[AGPL-3.0](LICENSE.md) — chosen deliberately: everything shipped (or served) stays open-source. [NOTICE.md](NOTICE.md) lists the bundled dependencies and their licenses (permissive by default; `highlight.js` is BSD-3-Clause, `elkjs` is the one user-approved copyleft exception; the Linux WebKitGTK runtime is a system library, not bundled). Adding a dependency? Prefer permissive (MIT/Apache-2.0/BSD), get copyleft user-reviewed, and update `NOTICE.md` in the same change — see [AGENTS.md](AGENTS.md).

## Maintainers / contributors

`AGENTS.md` and this `README.md` are the source of truth for how to build, test, and run this project. **When you change anything user- or tool-visible** — a file, a script, a permission or scope, an invariant, a keybind, a limitation, or any behavior — **update both in the same change** so neither doc describes the state before your edit. Keep the division of labor: this README stays a **condensed overview**; the exhaustive details (invariant rationales, debugging history, behavioral contracts) go in [AGENTS.md](AGENTS.md).
