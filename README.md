# Markdown Editor

A lightweight, cross-platform WYSIWYG-style Markdown editor. Documents stay plain `.md` files — the editor only layers a color/highlight overlay on top, so there is no lock-in and no hidden formatting.

Built with **Electron** (native shell) + **Vite** (web frontend). No framework — plain JS, one DOM, one source of truth. [AGENTS.md](AGENTS.md) is the exhaustive engineering reference (invariants, test history, conventions); this README is the readable overview.

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
- **In-app file picker** for save/open (centered, breadcrumbs, Home button, hidden/dot folders reachable) with an overwrite-confirmation prompt; every directory you enter opens with its list at the top; browser fallback throughout

---

## How it works (short)

- An invisible `<textarea>` shares exact font metrics with a pre-rendered highlight `<div>`; the caret never drifts.
- **Round-trip invariant**: stripping every `<span>` from the overlay HTML must reproduce the source character-for-character — that is what keeps the caret aligned (`npm test` enforces it).
- The DOM is the single source of truth; overlay and preview both re-render from it, so undo/redo is a simple stack of snapshots.
- All shell/export/diagram/math libraries are **statically imported** so the production bundle stays a **single `dist/assets/index-*.js`**; every shell call is guarded by `isTauri()` (which must detect `__TAURI_INTERNALS__`). In Electron the preload bridge (electron/preload.cjs) installs that same shell surface backed by real main-process IPC; `src/shellapi.js` is the frontend's vendored wrapper for it.

---

## Project layout

```
MarkdownEditor/
├── index.html                  # entry page, loads the Vite bundle
├── vite.config.js              # dev/preview server on 127.0.0.1 (avoids IPv6 localhost mismatch)
├── electron/
│   ├── main.cjs                # Electron main process: BrowserWindow, app:// protocol (serves dist/),
│   │                           # shell-IPC router (fs read/write/list/exists + home + opener + events) and
│   │                           # the window-close intercept → close-requested walk
│   └── preload.cjs             # renderer bridge: installs window.__TAURI_INTERNALS__ translating the
│                               # plugin:* command contract onto Electron IPC (see src/shellapi.js)
├── scripts/
│   └── electron-dev.cjs        # `npm run electron:dev` — starts vite, waits for the port, launches Electron
├── build/                      # packaging icons (electron-builder buildResources): icon.png/.ico/.icns + sizes
├── electron-builder.yml        # packaging config: NSIS+MSI+portable (win), dmg+zip (mac), AppImage+deb+tar.gz (linux)
├── src/
│   ├── main.js                 # bootstrap: createApp(#app) + sample content (feature-tour welcome doc; + katex css/asset imports)
│   ├── markdown.js             # app shell: createApp() — tabs, undo, keybinds, save/open, DnD, modals, recent-files menu; static shell imports
│   ├── shellapi.js             # shell-IPC layer (Electron): vendored wrappers over __TAURI_INTERNALS__.invoke — fs/path/opener/window contract
│   ├── export.js               # static PDF/HTML export pipeline and native/browser save adapters
│   ├── session.js              # versioned localStorage persistence and debounced saves
│   ├── dialogs.js              # centered in-app modals and overwrite confirmation
│   ├── picker.js               # in-app Save/Open filesystem picker (platform-aware path separator)
│   ├── editing.js              # formatting mutations (inline toggles incl. $…$ math) and indentation factory
│   ├── links.js                # link detection and shell/browser opening factory
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
├── .github/workflows/ci.yml    # CI: test suite + 3-OS build (installers + portables) → GitHub Release
├── LICENSE.md / NOTICE.md      # AGPL-3.0 + third-party notices
└── test/                       # one test file per feature regression (see Tests below)
```

Everything cross-file is a **static import**; further splitting is safe as long as the single-bundle invariant holds and no dynamic `import()` is introduced.

---

## Running in development

```bash
npm install
npm run electron:dev   # native dev window: starts vite, then Electron loads http://127.0.0.1:5173
npm run dev            # browser-only UI at http://127.0.0.1:5173
```

Prerequisites: Node 20+ only (Electron and electron-builder install via npm; `npm install` also fetches the Electron runtime binary).

## Building

```bash
npm run electron:start   # build dist/ and run the packaged-style app locally
npm run electron:build   # build dist/ + electron-builder for THIS platform's targets
```

Artifacts land in `release/` — Windows: `markdown-editor-<v>-x64-setup.exe` (NSIS), `markdown-editor-<v>-x64.msi` (WiX) and `markdown-editor-<v>-windows-x64-portable.exe`; macOS: `markdown-editor-<v>-macos-arm64.dmg` + `markdown-editor-<v>-macos-arm64-portable.zip` (the `.app`, Apple Silicon); Linux: `markdown-editor-<v>-x86_64.AppImage`, `markdown-editor-<v>-amd64.deb` and `markdown-editor-<v>-linux-x86_64-portable.tar.gz` (the linux-unpacked dir; needs the standard desktop libs — the AppImage/deb ship their own Electron runtime). Set `npm run build` outputs first — `electron-builder` packs `dist/` + `electron/` via `electron-builder.yml`.

App icons live in `build/` (`build/icon.png` is what Linux deb/appimage use; `build/icons/` holds the ico/icns and extra sizes). Edit `icon.svg` at the repo root (source art), then regenerate the PNG/ICO/ICNS set into `build/` with any rasterizer. Windows Explorer can cache the old `.exe` glyph — `ie4uinit.exe -show` refreshes it.

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
| New tab (anywhere) | `Ctrl+Click` the window (a `Ctrl+Click` on a tab just activates it) |

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
| `verify-scrollsync` | 17 | block-anchored sync: deep-heading alignment after mermaid/KaTeX regions, per-row table anchors, preview-lead parity, wrap-heavy docs, ratio fallback on desync, end-of-doc convergence (no snap/blend overshoot), elastic follower glide (instant only for tiny deltas), end-region re-correction pans slowly, and the follower never moves again once the glide lands |
| `verify-modescroll` | 8 | mode switch preserves the scroll ratio |
| `verify-modefocus` | 13 | mode click skips its trailing focus only when entering preview |
| `verify-tabclick` | 10 | a click anywhere in a tab (padding included) activates it; re-clicking the active tab is a no-op |
| `verify-tabscroll` | 7 | a tab's scroll positions survive switching away and back |
| `verify-themescroll` | 10 | theme switch preserves scroll; scrollbars flip with the theme |
| `verify-mermaidflicker` | 7 | no raw-code flash on prose keystrokes outside a fence |
| `verify-mermaidstyle` | 38 | mermaid stylesheet-failure fallback + label centering |
| `verify-mermaidfade` | 16 | dark-theme gradient outlines off, no drop shadow |
| `verify-tauri` | 55 | shell-IPC native path (stubs `__TAURI_INTERNALS__`, drives the real wire contract the Electron preload implements); the picker list re-opens at the TOP on every directory entry |
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

**Cutting a release**: the git tag is the version — there are no version files to bump. Draft/publish a release with tag `vX.Y.Z` (numeric prerelease suffix `-N`, `N ≤ 65535`, is allowed; text like `-rc.1` is rejected by the Windows MSI bundler). CI injects the tag into `package.json` before electron-builder runs. Installers + portables built per OS: **Windows** NSIS `.exe` + `.msi` + portable `.exe`; **macOS** `.dmg` + `.zip` portable (Apple Silicon); **Linux** AppImage + `.deb` + `tar.gz` portable.

**Signing**: with no secrets set, installers are unsigned (Gatekeeper/SmartScreen warn on first run). To sign/notarize, set `CSC_LINK`/`CSC_KEY_PASSWORD` (Windows), the macOS identity/notary credentials (or `APPLE_ID`/`APPLE_TEAM_ID`/`APPLE_CERTIFICATES`) as Actions secrets and remove the `mac.identity: null` override in `electron-builder.yml`.

---

## Security notes

- The Electron shell speaks a small fixed IPC surface (`shell:invoke` — file read/write/list/exists, home dir, external URL opener, window destroy). The fs surface is unrestricted by design (any path, including hidden dot-folders — matching the previous shell's `fs:scope ["**"]`). Tighten before shipping to third parties.
- The renderer has **no Node access** (`nodeIntegration: false`); the preload only installs the IPC bridge. `contextIsolation` is deliberately OFF so the bridge and its event callbacks live in one realm — the app loads only local content (`app://` in production, the local vite dev server in dev), and external navigation/window-open is blocked in `electron/main.cjs` (external URLs go to the system handler instead).
- The production CSP (served by the `app://` handler) allows `unsafe-inline` styles because the editor and mermaid inject inline styles; scripts are limited to `'self'`.

### Shell gotchas (do not regress — full detail in AGENTS.md)

- `isTauri()` must detect `__TAURI_INTERNALS__` (installed by `electron/preload.cjs`) or every native branch silently no-ops in the real app.
- All shell/export libraries are **statically imported** — never `await import(...)`; a failed runtime chunk fetch means silent data loss (save becomes a dropped download, the close guard never registers).
- The window-close handler must not self-close or `preventDefault()` unconditionally — cancel → `preventDefault()`, success → do nothing (the wrapper destroys; the main process force-closes).
- `closeApp()` is the single dirty-tab prompt walk; toolbar active-states track the caret via `selectionchange` (never `select`/`keyup` only).
- The app decides the display path in `electron/main.cjs`: **native Wayland whenever `WAYLAND_DISPLAY` exists** (WebKitGTK parity), but on WSLg Wayland cannot paint a first frame at all, so the window force-shows after 2.5 s and the app relaunches once on X11 (`--md-x11`) if no frame ever arrived — the window can never stay invisible. Electron is **pinned to `^40` (Chromium 144)** on purpose: Chromium 146 introduced the X11/XWayland wheel-delta regression (upstream 496255940, still In Progress) that killed real hardware wheels here; note Electron scrubs env vars at startup, so platform overrides are **argv-only** (`npm run electron:start -- --md-x11`).
- On **WSLg** the wheel is rescued at the **X layer**: Chromium's X11/XWayland decode discards real notches (upstream 496255940/41249467 — zero DOM events while the X server delivers every press, probe-verified), so `electron/xwheel-daemon` (**XI2 raw events** — the first, X Record-based attempt proved blind to Chromium's XI2-only windows) captures every notch on the X11 route and `electron/main.cjs` re-injects them as synthetic wheels (`webContents.sendInputEvent`, deltaY sign inverted vs the DOM — live-verified). `src/wheeloverride.js` then drops only the duplicate half when Chromium's own decode also delivers the same notch (engine ≈ ±120 vs synthetic ±100, pair window 40 ms), letting the survivor scroll **natively (smooth)** — exactly one move per notch. The rescue is fully gated: non-X11 launches (incl. Windows/macOS) spawn nothing and run stock Electron; `MD_NATIVE_WHEEL=1` disables the page-side suppression for A/B. Known residual: ~1 notch in 10 sometimes never reaches the X server at all (upstream; possibly a mouse detent skip) and cannot be synthesized.
- Diagnostics keybinds: **Ctrl+Shift+D** opens the live wheel-capture panel (every wheel event + per-pane displacement, Copy-to-clipboard; Esc closes) and **Ctrl+Shift+M** opens the mermaid diagnostics modal — both for bug reports on hardware-specific issues synthetic tests cannot reach.

---

## License

[AGPL-3.0](LICENSE.md) — chosen deliberately: everything shipped (or served) stays open-source. [NOTICE.md](NOTICE.md) lists the bundled dependencies and their licenses (permissive by default; `highlight.js` is BSD-3-Clause, `elkjs` is the one user-approved copyleft exception; Electron is MIT and ships its own Chromium/Node runtime). Adding a dependency? Prefer permissive (MIT/Apache-2.0/BSD), get copyleft user-reviewed, and update `NOTICE.md` in the same change — see [AGENTS.md](AGENTS.md).

## Maintainers / contributors

`AGENTS.md` and this `README.md` are the source of truth for how to build, test, and run this project. **When you change anything user- or tool-visible** — a file, a script, a permission or scope, an invariant, a keybind, a limitation, or any behavior — **update both in the same change** so neither doc describes the state before your edit. Keep the division of labor: this README stays a **condensed overview**; the exhaustive details (invariant rationales, debugging history, behavioral contracts) go in [AGENTS.md](AGENTS.md).
