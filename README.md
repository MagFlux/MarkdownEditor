# Markdown Editor

A lightweight, cross-platform WYSIWYG-style Markdown editor. Documents stay plain `.md` files — the editor only layers a color/highlight overlay on top, so there is no lock-in and no hidden formatting.

Built with **Tauri** (native shell) + **Vite** (web frontend). No framework — plain JS, one DOM, one source of truth.

---

## Features

- **Split / Edit / Preview** view modes
- **Multi-file tabs** — open, close and reorder documents independently (Ctrl+T for a new tab, `×` to close, Ctrl+W to close the active tab)
- **Custom undo / redo stack** — per-tab, with `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` and `Ctrl+Left` / `Ctrl+Right` aliases
- **Inline formatting**: bold, italic, **underline** (`<u>`), strikethrough, `` code ``, and links — toggled on a selection or the current word (Ctrl+B / I / U / K)
- **Block formatting**: H1–H3, quotes, `ul` / `ol`, code fences, and GFM tables
- **Live toolbar state** — the formatting buttons (B / I / U / S / code / link, and H1–H3 / quote / list / table) light up to match the formatting at the **caret** the instant it moves, whether you click, use the arrow keys, paste, undo, or switch tabs. They do not require you to select or change the text first.
- **Drag-and-drop** `.md` files straight onto the window (opens them in a new tab)
- **Ctrl+click a link** in the source to open it in the default browser
- **Tab / Shift+Tab** to indent / outdent list & code lines
- **Enter** auto-continues list items and numbered lists; press Enter on an empty list item to exit the list
- **Session persistence** — tabs and their contents are saved to `localStorage` so a crash or close does not lose work
- **Unsaved-changes guard** — confirms before closing a tab or window with uncommitted edits
- **Light / Dark** theme
- Saves & opens from the filesystem via Tauri's `fs` plugin, using an **in-app file picker** (centered over the window; the native rfd GTK picker drifts off-window) with a browser-file-input fallback so the web app still works in the browser. The picker has a clickable path breadcrumb plus an **always-visible Home button** (and Up) so you can jump back to your home directory no matter how far you have navigated. Hidden (dot-prefixed) folders are reachable on Unix — the fs scope's `**` glob matches dot-path segments (via `plugins.fs.requireLiteralLeadingDot: false` in `src-tauri/tauri.conf.json`), so you can open/save inside `~/.config`, `~/dev/.github`, etc.

---

## How it works (short)

- An invisible `<textarea>` sits on top of a pre-rendered `<div>`. The editor content and the textarea share exact font metrics, so the visible caret never drifts.
- The renderer is in `src/markdown.js` — `computeBlocks()` classifies each line (heading, list, quote, code, table…) and `lineToHtml()` turns a line into highlighted spans.
- **Invariant**: stripping every `<span>` tag out of the produced HTML must reproduce the exact source text. This is what keeps the caret aligned; all renderer changes must preserve it. There is a round-trip test that checks this.
- The DOM (the textarea) is the single source of truth. The "overlay" and the "preview" are both re-rendered from it on every change — the reverse direction never happens, so undo/redo is a simple stack of text snapshots.
- Tauri plugins for filesystem I/O (the in-app file picker reads directories via `plugin-fs`, opens/closes windows via the core API), opening links, and window lifecycle are **statically imported** at the top of `src/markdown.js` (they are pure JS until called), and every call is guarded by `isTauri()`. This is deliberate: in the real Tauri GTK webview, *dynamically* imported plugin chunks can fail to resolve, causing `save()` to silently fall through to a no-op download and `onCloseRequested` to never register — both silently corrupt or lose work. A static import guarantees the code is always in the bundle. The **real** gate is `isTauri()` itself: this is a Vite/bundler build (no `withGlobalTauri`), so Tauri injects `window.__TAURI_INTERNALS__`, **not** `window.__TAURI__`; `isTauri()` must detect the former or every native branch falls through to the browser no-op in the actual app (see the gotchas below).

---

## File layout

```
MarkdownEditor/
├── index.html                  # entry page, loads the Vite bundle
├── vite.config.js              # dev/preview server on 127.0.0.1 (avoids IPv6 localhost mismatch)
├── package.json
├── src/
│   ├── main.js                 # bootstrap: createApp(#app) + sample content
│   ├── markdown.js             # the whole editor app (tabs, undo, keybinds, save/open, DnD)
│   ├── icons.js                # inline-SVG toolbar icons (B I U S code link H1-H3 table + undo redo …)
│   └── style.css               # all styles, light + dark themes, editor/preview/tab bar
├── src-tauri/
│   ├── tauri.conf.json         # Tauri config (window, bundle, plugin wiring)
│   ├── Cargo.toml              # Rust deps: tauri, plugin-fs, plugin-dialog, plugin-opener
│   ├── capabilities/default.json  # permissions (fs, dialog, opener)
│   ├── src/main.rs             # tauri::Builder + plugin init
│   └── icons/                  # .png / .ico / .icns bundle icons
├── .github/workflows/ci.yml    # CI: test suite + 3-OS build → draft GitHub Release
└── test/
    ├── test.mjs                # round-trip invariant (no server, instant)
    ├── verify.mjs              # UI smoke test (screenshots → test/verify/)
    ├── verifyUndo.mjs          # undo/redo UI test
    ├── verifySaveOpen.mjs      # save / open / close-guard UI test
    └── verifyTauriClose.mjs    # native Tauri path (stubs __TAURI_INTERNALS__, no Rust)
```

`src/markdown.js` is the single biggest file — everything editor-related lives there. Splitting it is a reasonable next refactor if the app grows.

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

The release binary itself lives at `src-tauri/target/release/markdown-editor` (or `markdown-editor.exe` on Windows) — you can copy that to any machine with the same OS/arch and the system dependencies (WebKitGTK on Linux) and it will run without Node.

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
| Undo | `Ctrl+Z` or `Ctrl+←` |
| Redo | `Ctrl+Shift+Z`, `Ctrl+Y`, or `Ctrl+→` |
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

- **Undo / redo UI test** — drives a real Chromium instance across 11 cases (undo, redo, multi-step, toolbar buttons, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y / Ctrl+← / Ctrl+→) and asserts the text after each step.

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

- **Native (Tauri) path test** — instead of a browser fallback, this injects the exact `window.__TAURI_INTERNALS__` the real app gets and drives the **genuinely imported** `@tauri-apps` api. It fires a `close-requested` event and asserts, across 43 cases: the save-then-close walk (Save → in-app Save-As picker → a real `fs/write_text_file` to the chosen path with the document's exact contents **and** the window actually closes, no `preventDefault`); picker-cancel keeps the window open with nothing written; a tab that already has a path → direct write (no picker); `open()` → in-app open picker → `fs/read_text_file` into a fresh tab (vs. picker-cancel creating no tab); navigating the picker into an out-of-scope/forbidden directory → the crumb **stays on the last readable directory** with a "Cannot read …" error (it never adopts the failed path); the **Home button** — always present in the picker's pathbar — jumps the picker back to the user's home dir even after navigating several levels deep; and the picker **enters a hidden (dot) folder** (drives `read_dir` into `~/.config`), the UI-side guard for the `requireLiteralLeadingDot: false` fs-scope fix. Needs the built `dist/`; no Rust toolchain required.

  ```bash
  npm run verify-tauri
  ```

All of these exit non-zero on any failure or console error, so they can be wired into CI.

---

## CI / Releases

The GitHub Actions pipeline (`.github/workflows/ci.yml`) does **not** run on
every push (saves runner compute). It runs on:

| Event | Triggers | What it does |
|---|---|---|
| A new or updated PR | `pull_request: opened, synchronize, reopened, ready_for_review` | `test` only — the full Playwright suite (no installers) |
| You cut a release | `release: created` | `test` first; if green, three `build` jobs in parallel → installers attached to the release |

### Cut a release

1. Bump `version` in `src-tauri/tauri.conf.json` (e.g. `0.1.0` → `0.1.1`), commit & push to `main`.
2. From the repo's **Releases** page, go to **Draft a new release** → enter the tag `v0.1.1` (must match the version in `tauri.conf.json` plus a `v` prefix) → **Publish** (or `git tag v0.1.1 && git push --tags`).
3. On `release: created`, the `test` job runs first. If green, the three build jobs run in parallel via `tauri-apps/tauri-action@v0`:
   - **Windows** (`windows-latest`) → `nsis` (`.exe`) + `msi`
   - **macOS** (`macos-14`) → `dmg`
   - **Linux** (`ubuntu-22.04`) → `appimage` + `deb`

   Installers are attached to the same `v<version>` release you just cut.

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
| `npm run verify-tauri` | Native Tauri path test (stubs `__TAURI_INTERNALS__`, real api/IPC, 43 cases incl. picker Home button + hidden-folder navigation) |
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

## Maintainers / contributors

`AGENTS.md` and this `README.md` are the source of truth for how to build, test, and run this project. **When you change anything user- or tool-visible** — a file, a `package.json` script, a permission or scope in `src-tauri/capabilities/default.json`, an invariant, a keybind, a limitation, or any behavior — **update both `AGENTS.md` and `README.md` in the same change** so neither doc describes the state before your edit.
