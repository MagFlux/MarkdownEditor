# AGENTS.md

Guidance for AI coding agents (and humans) working in this repo. Read this before editing.

## What this is

A single-window, multi-tab Markdown editor. Plain JS (no framework), one DOM, one
source of truth (the textarea). A color/highlight overlay sits under the textarea;
the editor stays a `.md` file with no lock-in. Native shell is Tauri on GTK on Linux
(WebKitGTK), with a browser fallback so the same code runs under `vite preview`.

## Keep the docs current (mandatory for every change)

`AGENTS.md` and `README.md` are the source of truth for how to build, test, and run
this project. **After you make any change** — a new file, a renamed file, a new/changed
script in `package.json`, a new/changed permission or scope in
`src-tauri/capabilities/default.json`, an invariant, a keybind, a limitation, or a
behavior the user sees — **update both `AGENTS.md` and `README.md` in the same
change** so they stay accurate. Do not leave a doc describing the state before your
edit. If a change doesn't affect the documented surface, a quick check that neither
file is now stale is still required before you're done.

## Build / test / run

```bash
npm install

# Web-only (browser) development — enough to develop and test the editor logic
npm run dev            # http://127.0.0.1:5173

# Verification suite (browser Chromium, Playwright). Order is cheap→expensive.
npm test               # 21 round-trip renderer cases (no server, instant)
npm run verify         # UI smoke test (tabs, undo/redo, underline, tables)
npm run verify-undo    # undo/redo UI test (11 cases)
npm run verify-save    # save / close-guard UI test (24 cases)
npm run verify-tauri   # NATIVE Tauri path: stubs __TAURI_INTERNALS__, drives the
                        # real api/IPC (32 cases) — save→in-app picker→write+close,
                        # picker-cancel→stays, save-discard-cancel→stays,
                        # known-path→direct write, open→picker→new tab, open-cancel,
                        # navigate-into-forbidden-dir→crumb stays on last readable.
                        # Needs the built dist.

# Native app (needs Rust + WebKitGTK; make sure `cargo` is on PATH,
# e.g. `export PATH="$HOME/.cargo/bin:$PATH"` in your shell profile)
npx tauri dev          # dev window
npx tauri build        # release binary + bundle artifacts
```

After any edit to `src/`, **run `npm run build`** and confirm the production bundle
still emits a single `dist/assets/index-*.js` (no code-split Tauri-plugin chunks) —
see the invariant below. Then re-run the three verify scripts; all must be green.
For Tauri-native changes also run `npm run verify-tauri`.

## CI/CD (GitHub Actions)

The pipeline lives in `.github/workflows/ci.yml`. Two jobs.

**Triggers** (deliberately *not* on every push, to save runner compute):
- `pull_request` — `opened | synchronize | reopened | ready_for_review`
- `release` — `created`

**Jobs**:

1. **`test`** (ubuntu-latest) — the full Node/Playwright verification suite,
   cheap → expensive: `npm test` → `verify` → `verify-undo` → `verify-save` →
   `verify-tauri`. No Rust. Runs on PR and on release.

2. **`build`** (3-OS matrix) — the expensive one: compiles the Rust shell +
   packages installers via `tauri-apps/tauri-action@v0`:
   - `windows-latest`: `--bundles nsis,msi` (NSIS via `choco`)
   - `macos-14`: `--bundles dmg`
   - `ubuntu-22.04`: `--bundles appimage,deb` (WebKitGTK 4.1, GTK3, appindicator, rsvg)

   Gated on `test` passing **and** `github.event_name == 'release'` (so it
   never runs on PRs or plain pushes). Installers attach to the exact
   `v<version>` release that was just created — see below for the recipe.

### `tauri-action` inputs (what actually works)

| Input | Value | Why |
|---|---|---|
| `projectPath` | `.` (repo root) | The action uses this as the **cwd** for both `tauri build` and `beforeBuildCommand: npm run build`. It also auto-discovers `src-tauri/` by globbing for `tauri.conf.json` (glob: `**/tauri.conf.json`). Setting it to `src-tauri` would make both commands run inside `src-tauri/` where there is no `package.json` → instant failure. |
| `tauriScript` | `npx tauri` | Bare `tauri` is not on PATH. `npx` resolves `@tauri-apps/cli` from the root `node_modules/`. The action's auto-detect would work too, but being explicit avoids the `install -g` fallback. |
| `args` | `--bundles <list>` | Passes through to `tauri build`. Without it, all platforms would attempt `targets: "all"`. |
| `tagName` | `v__VERSION__` | `__VERSION__` is replaced by the action with the version from `tauri.conf.json` (`0.1.0` today). The `v` prefix is literal. |
| `releaseDraft` | `true` | Keeps the release hidden until you manually publish. |

**Do NOT add**: `project` (rejected — use `projectPath`), `artifactName` (rejected),
`releaseCommitish`, or any input not in the action's `action.yml`. The action validates
inputs strictly; an unrecognised key fails the step immediately.

### Optional signing secrets (not set)

Without these the build produces **unsigned** installers:
- `TAURI_SIGNING_PRIVATE_KEY` — for the updater JSON (auto-update)
- `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_CERTIFICATES`, `APPLE_SIGNING_PASSWORD` — macOS Developer ID
- `CSC_LINK`, `CSC_KEY_PASSWORD` — Windows SmartCard cert

Set them in **Settings → Secrets and variables → Actions** (repo level) or
**Organization → Secrets** (org level). They are available to the `build` job only.

## Files that matter

| Path | Role |
|---|---|
| `src/markdown.js` | The entire editor. Tabs, undo/redo, keybinds, save/open, DnD, window-close guard. All logic lives here. |
| `src/icons.js` | Inline-SVG toolbar icons (B I U S code link H1-H3 table + undo/redo/new-tab + mode + theme). |
| `src/style.css` | All styles, light + dark themes. Lightly touches `[data-theme]`. |
| `src/main.js` | Bootstrap: `createApp('#app')` + sample content. |
| `test/test.mjs` | Round-trip invariant (strip `<span>` from overlay HTML must reproduce source). |
| `test/verify.mjs` `test/verifyUndo.mjs` `test/verifySaveOpen.mjs` | Headless Chromium Playwright tests (all live in the `test/` dir). |
| `test/verifyTauriClose.mjs` | **Native-path** harness: injects a `__TAURI_INTERNALS__` stub, drives the real `@tauri-apps` api/IPC (`onCloseRequested` → save/cancel → `fs/write_text_file` / `window/destroy`). No Rust needed. |
| `index.html` | Entry. Loads the single Vite bundle. |
| `vite.config.js` | Dev/preview server pinned to `127.0.0.1` (avoids IPv6 `localhost` mismatch). |
| `src-tauri/tauri.conf.json` | Window, CSP, `frontendDist: ../dist`, `beforeBuildCommand: npm run build`, identifier `com.mssok.markdowneditor`. |
 | `src-tauri/capabilities/default.json` | Permissions: `dialog:default`, `fs:allow-read-text-file`, `fs:allow-write-text-file`, `fs:allow-read-dir`, `core:path:default`, `core:window:allow-destroy`, `opener:default`, scope `["**"]`. |
| `src-tauri/src/main.rs` | Registers `plugin_fs`, `plugin_dialog`, `plugin_opener` on the Tauri builder. |
| `src-tauri/Cargo.toml` | Rust deps + tauri plugins. |
| `.github/workflows/ci.yml` | CI: `test` job (full Playwright suite) + `build` job (3-OS matrix → draft release). See § CI/CD. |

## Hard invariants (do not regress)

1. **Round-trip invariant** — stripping every `<span>` out of the overlay HTML must
   reproduce the exact source, character-for-character. This is what keeps the
   invisible caret aligned under the overlay. `test/test.mjs` enforces this (21 cases).
   Any renderer change must pass it.

2. **Static Tauri imports.** All `@tauri-apps/*` imports are **static top-level
   imports** in `src/markdown.js` (lines 11-14). They must NOT be changed to
   `await import(...)`. In the real Tauri GTK webview, Vite code-split relative
   chunks loaded at runtime fail to resolve, which silently:
   - made `save()` fall through to a `Blob`-download `.click()` that WebKitGTK
     ignores — the tab closed believing it saved (data lost);
   - made `win.onCloseRequested` never wire up — the window closed with unsaved tabs.
   These imports are pure JS in a browser (they only touch `window.__TAURI_INTERNALS__`
   when *called*), so static import is browser-safe. Keep them at the top; keep every
   call wrapped in `isTauri()`.

   **The REAL gate is `isTauri()` (line ~248): it must detect the bundler global
   `__TAURI_INTERNALS__`, not `__TAURI__`.** This is a Vite/bundler build (no
   `withGlobalTauri` in `tauri.conf.json`), so Tauri injects only
   `window.__TAURI_INTERNALS__` — `window.__TAURI__` is absent. If `isTauri()`
   checks only `__TAURI__` it returns false in the real app and every native branch
   silently falls through to the browser no-op (save → dropped Blob download;
   `onCloseRequested` never registers). Keep it as
   `!!(window.__TAURI_INTERNALS__ || window.__TAURI__)`.

 3. **Close-requested must NOT self-close — AND must be allowed to `destroy()`.**
    `onCloseRequested` (~line 1749) relies on the Tauri wrapper contract: the
    wrapper runs
    `await handler(evt); if (!evt.isPreventDefault()) await this.destroy()`.
    Correct handler: on **cancel** → `event.preventDefault()` (window stays); on
    **success** → do *nothing* (wrapper auto-`destroy`s). It must be `async` and
    `await closeApp()`. It must NOT call `win.close()` and must NOT
    `preventDefault()` unconditionally — that re-emit/prevent loop deadlocks the
    window open.

    **The wrapper's `destroy()` → `invoke('plugin:window|destroy')`, so the ACL must
    permit it.** `core:window:default` (via `core:default`) grants
    `allow-is-closable` etc. but **NOT** `allow-destroy`. Without the explicit
    `core:window:allow-destroy` in `src-tauri/capabilities/default.json`, the
    wrapper's `destroy()` is ACL-denied, the promise rejects unhandled, and the
    window never closes after a clean save/discard walk (re-click is a no-op). The
    Playwright harness in `test/verifyTauriClose.mjs` **stubs** `plugin:window|destroy`,
    so it does not enforce this ACL and will not catch the regression — only the
    real app does. Keep `core:window:allow-destroy` in capabilities.

4. **Single close-walk source of truth.** `closeApp()` (in `src/markdown.js`) is the
   only function that walks dirty tabs and prompts (Save / Discard / Keep editing)
   before the window closes. `removeTab`, the `beforeunload` listener, and the
   `onCloseRequested` handler all funnel through it, and prompt order = tab DOM order.
   Don't add a second prompt path.

5. **Save returns a boolean.** `save(tab)` returns `true` only on a real write (Tauri
   `writeTextFile`) or a browser download; it returns `false` on user-cancel or error.
   `closeTab`/`closeApp` must gate removal on that value — a `false` means the tab
   stays.

6. **New tab, not reuse.** `open()` always opens a fresh tab. A blank `Untitled` tab
   is never reused for the just-opened document.

## Conventions

- No build tooling beyond Vite + a single bundle. Do not add a framework (React,
  Vue, etc.). Do NOT introduce dynamic `import()` (code-splitting) of any Tauri
  plugin or module — `src/markdown.js` currently has zero `import(...)` calls and
  must stay that way, so the bundle remains one file that loads in the GTK webview.
- Comments: keep the WHY (especially the invariants above) in-line; they encode
  hard-won debugging history.
- Tauri calls are guarded by `isTauri()` so the same file works in a browser. When
  adding a new native feature, add a browser fallback branch.
- Test-first: when adding editor behavior, extend the relevant `test/verify*.mjs` or
  `test/test.mjs` and confirm it stays green before considering the task done.
- All dialogs (save/cancel prompts, open, and any error/info feedback) render
  **in-app** via `showModalBase`/`messageModal`/`pickPath` — NOT `alert`/`confirm`/
  `prompt` (unreliable in WebKitGTK) and NOT the native `tauri-plugin-dialog`
  rfd GTK picker (never parents/centers its dialogs, so it drifts off-window).
  The in-app modals are centered by construction inside the single webview.

## Known limitations (browser fallback)

- In a plain browser (`vite preview` / `npm run dev`), Save uses a file download
  (WebKitGTK-style no-op aside) and there is no window-close interceptor (the
  `beforeunload` guard is the only guard). All the Tauri-native paths (real
  `save`/`open` dialogs, `onCloseRequested`) must be validated in the actual app —
  the Playwright tests exercise the shared code paths and assert the browser
  fallbacks, not the native ones.
