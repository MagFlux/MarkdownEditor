# AGENTS.md

Guidance for AI coding agents (and humans) working in this repo. Read this before editing.

## Hard rules (read first)

- **NEVER `git commit` or `git push` unless the user has EXPLICITLY asked for it,
  in this exchange, in their own words.** Pre-completed checklist items, "the last
  step," or "wrap it up" phrasing do NOT count as an explicit request. Finish your
  work, report what you did and what is uncommitted, and then STOP and wait for the
  user to say go. (This rule exists because the agent once committed and pushed
  without being told to, against the user's wishes.) When unsure, ask first.
- **Never put false attribution in a commit message.** No `Co-Authored-By:
  Claude …`, no `Generated-by`, no "made by an AI" trailer — the user (MagFlux) is
  the sole author. This holds regardless of who initiated the change.

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

**`LICENSE` and `NOTICE` must also stay current** (this is a mandatory todo for every
change, not optional). Whenever a dependency is **added, removed, or changes
version or license** — a new `dependencies`/`devDependencies`/`peerDependencies` entry,
a new Rust crate in `src-tauri/Cargo.toml`, or an upgrade that swaps one license for
another — **update `NOTICE` in the same change** (add/remove/re-license the line, keep
it in the right bucket: MIT, MIT/Apache dual, Apache-2.0-only, other copyleft,
or runtime-only), and
confirm `LICENSE` still correctly describes the project. Never let `NOTICE` describe the
*pre*-change dependency set.

## Licensing (mandatory for every dependency change)

This project is **AGPL-3.0-licensed** (see `LICENSE`; copyright MagFlux, 2026). We chose
**strong copyleft deliberately**: *everything we ship, and anything run over a network,
stays free and open-source* — no one can take our code (or a fork served by it) and
produce a closed-source product. That is heavier than MIT (we can no longer release a
proprietary fork), and that cost is the price of the guarantee the project wants.

Because the **top-level is copyleft**, the old "permissive-only" framing inverts for
dependencies:

- **Permissive libraries** — `MIT`, `Apache-2.0`, `BSD-*`, or **dual-licensed
  `MIT OR Apache-2.0`** (we take the MIT side) — are **freely bundleable and the
  default / preferred choice.** AGPL is the umbrella; permissive code joins the
  combined work under AGPL terms while keeping its own notice. If two libraries solve
  the same job and one is permissive and the other copyleft, use the permissive one.
- **Compatible strong-copyleft** — `GPL-3.0`, `AGPL-3.0`, `EPL-2.0`, `MPL-2.0`, `LGPL-3.0`
  — **may be bundled**; the result is still a single AGPL-3.0 work. Heavier than
  permissive, so make it a *deliberate, user-reviewed* call rather than a default.
  (Current example: `elkjs` is `EPL-2.0` — the DAG-layout engine Mermaid inlines; kept
  as a user-approved, user-reviewed exception, see `NOTICE`.) Re-review before adding
  any new non-permissive one.
- **Source-available / non-free** — `SSPL`, `BUSL`/`BSL`, Elastic, Commons Clause, or any
  *non-OSI* "free" license, or any copyleft whose own text is a **further restriction**
  AGPL §7/§10 treats as incompatible — **STOP and notify the user before using it. Do
  not add it, do not import it, do not commit it.** Explain the specific license and why
  it is not compatible with an AGPL-3.0 bundle, and offer one or more permissive (or
  AGPL-compatible copyleft) alternatives that do the same job. Proceed only after the
  user explicitly approves the exception (and then log it in `NOTICE` in its own
  "non-permissive (user-approved exception)" bucket).

**Before you install or import any new library** — any `npm install <pkg>`, a new
`dependencies`/`devDependencies`/`peerDependencies` entry, or a new Rust crate in
`src-tauri/Cargo.toml` — **check its license first, before you use it:**
- JS: `npm info <pkg> license` (or read `node_modules/<pkg>/package.json` → `license`),
  and also scan *nested* dependencies for anything non-permissive that ships inside.
- Rust: the crate's `Cargo.toml`/crates.io page → `license` field (many are
  `MIT OR Apache-2.0`).

> Two distinctions that still matter:
> - **A shared *system* runtime we merely link to** (WebKitGTK on Linux, LGPL) is
>   allowed by AGPL-3.0 because it's a System Library we do **not** bundle — the app is
>   "the work" and the runtime merely hosts it. An LGPL/GPL **library we bundle as code**
>   (pulled into `node_modules` or compiled in) falls under the copyleft rule above.
> - **AGPL §13 (Remote Network Interaction):** if this ever runs as a *network service*
>   other users touch over a server, we must offer that service's **Corresponding Source**
>   to those users at no charge. Right now this is a local desktop editor (the browser
>   fallback is local too), so §13 is largely moot — but the moment it's hosted, that
>   obligation kicks in. Don't build in a back-end without flagging it.

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
npm run verify-toolbar # toolbar active-states track the caret (18 cases) — bold/underline/
                        # code/H2/plain + click, arrow-key, programmatic, and tab-switch
                        # paths, all with NO text change required.
npm run verify-paste   # rich-paste: an HTML clipboard (Excel/HTML <table>, bold/italic/
                        # underline spans, mixed runs) converts to Markdown and commits as
                        # ONE undo-able edit; plain-text pastes fall through to the browser's
                        # default insert (18 cases).
npm run verify-export  # Export-as-PDF/HTML: hamburger menu open/close/outside-click/Escape,
                        # HTML save via fs writeFile (in-app picker + blob download fallback),
                        # PDF save via html2canvas→jsPDF (A4 multi-page), both cancel paths,
                        # and format-button isolation (30 cases).
npm run verify-scroll  # Split-view scroll-sync regression: a genuine user scroll on the
                        # FOLLOW pane (while its ECHO_MS deadline is still live) is accepted
                        # as a fresh lead immediately — the old time-only window swallowed it
                         # for ~800 ms ("the left side lags / catches up"); value-based echo
                         # matching fixes this (5 cases).
npm run verify-modescroll # Mode-switch (split/edit/preview) preserves the scroll RATIO:
                          # previously the mode button refocused the textarea and the browser
                          # caret-follow snap + followScroll ratchet jumped the view to the
                          # BOTTOM when the caret was at the end. setMode now records the
                          # leaving-mode ratio and restores it on the entering panes after two
                           # rAF ticks; covers split->edit (caret-end stays near top), 55%/50%/
                           # 30% ratio preservation, and the fast-triple-switch race (8 cases).
   npm run verify-modefocus # Mode-click does NOT causatively focus the editor textarea when
                           # it HIDEs (entering preview): the old handler fell through to
                           # activeTab.input.focus() after every action including mode — in
                           # preview mode the hidden textarea (flex:0, width:0) scroll-into-
                           # view fired an eager scroll event on WebKitGTK that followScroll
                           # ratcheted onto the preview pane (user sees "edit stays top,
                           # preview jumps to bottom"). The mode action now does
                           # if (next === "preview") return; (surgical — split/edit targets
                           # still get the normal trailing caret-follow focus), and this test
                           # blurs before each click so it measures CAUSATIVE focus: the
                           # textarea is NOT focused only for edit→preview, IS focused for the
                           # other targets — passing headlessly even where Chromium does not
                           # reproduce the scroll-into-view quirk (13 cases).
 npm run verify-tabclick # Clicking an ALREADY-ACTIVE tab is a no-op: it must not move the
                         # scroll (the old activate did input.focus()+refresh, which refocused
                         # the textarea and scrolled it into view — both panes jumped 90%→~25%)
                         # and must not rewrite the preview DOM (old refresh→syncDom re-ran
                         # marked + the mermaid render). activate() now short-circuits when
                          # doc === activeTab (6 cases).
  npm run verify-tabscroll # Cross-tab scroll PERSISTENCE: switching away from a tab and
                          # coming back must restore that tab's remembered EDITOR and PREVIEW
                          # scroll positions — previously .pane-group{display:none} (style.css)
                          # reset a tab's scrollTop to 0 when it was hidden, so a tab scrolled
                          # to 50% read 0 (top) on return. activate() now captures the leaving
                          # tab's ratios while it's still laid out and re-asserts the entering
                          # tab's remembered ratios after two rAF ticks (mirrors setMode /
                          # openAtTop), stamping the value-based echo guard so the restore
                           # reads as a programmatic write (7 cases: scrollability probe +
                           # Alpha@50% round trip, Beta@25% independence, no cross-tab clobber).
  npm run verify-tauri   # NATIVE Tauri path: stubs __TAURI_INTERNALS__, drives the
                         # real api/IPC (43 cases) — save→in-app picker→write+close,
                        # picker-cancel→stays, save-discard-cancel→stays,
                        # known-path→direct write, open→picker→new tab, open-cancel,
                        # navigate-into-forbidden-dir→crumb stays on last readable,
                        # Home button always present in the picker pathbar and jumps
                        # back to the home dir even after navigating deep, and the
                        # picker ENTERS a hidden (dot) folder (read_dir on the dot-path) —
                        # the UI-level guard for the fs requireLiteralLeadingDot:false fix.
                        # Needs the built dist.

# Native app (needs Rust + WebKitGTK; make sure `cargo` is on PATH,
# e.g. `export PATH="$HOME/.cargo/bin:$PATH"` in your shell profile)
npx tauri dev          # dev window
npx tauri build        # release binary + bundle artifacts
```

After any edit to `src/`, **run `npm run build`** and confirm the production bundle
still emits a single `dist/assets/index-*.js` (no code-split Tauri-plugin chunks) —
see the invariant below. Then re-run the thirteen verify/test steps (`verify`, `verify-undo`,
`verify-save`, `verify-toolbar`, `verify-paste`, `verify-export`, `verify-scroll`,
`verify-modescroll`, `verify-modefocus`, `verify-tabclick`, `verify-tabscroll`, `verify-tauri`, and `npm test`); all must be green.
For Tauri-native changes also run `npm run verify-tauri`.

## CI/CD (GitHub Actions)

The pipeline lives in `.github/workflows/ci.yml`. Two jobs.

**Triggers** (deliberately *not* on every push, to save runner compute):
- `pull_request` — `opened | synchronize | reopened | ready_for_review`
- `release` — `created`

**Jobs**:

 1. **`test`** (ubuntu-latest) — the full Node/Playwright verification suite,
      cheap → expensive: `npm test` → `verify` → `verify-undo` → `verify-save` →
       `verify-toolbar` → `verify-paste` → `verify-export` → `verify-scroll` →
       `verify-modescroll` → `verify-modefocus` → `verify-tabclick` → `verify-tabscroll` → `verify-tauri`. No Rust.
    Runs on PR and on release.

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
  | `test/verify.mjs` `test/verifyUndo.mjs` `test/verifySaveOpen.mjs` `test/verifyToolbar.mjs` `test/verifyPaste.mjs` `test/verifyExport.mjs` `test/verifyScroll.mjs` `test/verifyModeScroll.mjs` `test/verifyModeFocus.mjs` `test/verifyTabClick.mjs` `test/verifyTabScroll.mjs` | Headless Chromium Playwright tests (all live in the `test/` dir). `verifyExport.mjs` covers the PDF/HTML export menu + save/cancel paths (30 cases). `verifyScroll.mjs` is the split-view scroll-sync regression (a real follow-pane scroll inside the ECHO window is accepted immediately — 5 cases). `verifyModeScroll.mjs` is the mode-switch scroll-PRESERVING regression (setMode records the leaving-mode ratio and re-asserts it on the entering panes so the mode button never jumps the view to the document end — 8 cases). `verifyModeFocus.mjs` is the mode-click focus regression (the mode button must causatively skip its trailing textarea focus ONLY when entering preview — the hidden textarea's scroll-into-view ratchets the preview to the bottom; for the preview target the mode action does `if (next === "preview") return;` while split/edit targets keep the normal caret-follow focus — 13 cases). `verifyTabClick.mjs` is the redundant-tab-click regression (activate() short-circuits when `doc === activeTab` so clicking the already-active tab neither moves the scroll nor rewrites the preview DOM / re-renders mermaid — 6 cases). `verifyTabScroll.mjs` is the cross-tab scroll-persistence regression (a tab's editor + preview scroll survive hiding and returning — 7 cases). |
| `test/verifyTauriClose.mjs` | **Native-path** harness: injects a `__TAURI_INTERNALS__` stub, drives the real `@tauri-apps` api/IPC (`onCloseRequested` → save/cancel → `fs/write_text_file` / `window/destroy`). No Rust needed. |
| `index.html` | Entry. Loads the single Vite bundle. |
| `vite.config.js` | Dev/preview server pinned to `127.0.0.1` (avoids IPv6 `localhost` mismatch). Also `build.rollupOptions.output.codeSplitting: false` — prevents jsPDF's internal `await import("dompurify")` from emitting a second chunk so the bundle stays a single `index-*.js` (see invariant 8). |
| `src-tauri/tauri.conf.json` | Window, CSP, `frontendDist: ../dist`, `beforeBuildCommand: npm run build`, identifier `com.mssok.markdowneditor`. Also `plugins.fs.requireLiteralLeadingDot: false` — lets the fs scope `**` match hidden (dot) path segments on Unix so the picker can open `~/.config` etc. (see invariant 7). |
 | `src-tauri/capabilities/default.json` | Permissions: `dialog:default`, `fs:allow-read-text-file`, `fs:allow-write-text-file`, `fs:allow-write-file` (PDF/HTML export), `fs:allow-read-dir`, `core:path:default`, `core:window:allow-destroy`, `opener:default`, scope `["**"]`. |
| `src-tauri/src/main.rs` | Registers `plugin_fs`, `plugin_dialog`, `plugin_opener` on the Tauri builder. |
| `src-tauri/Cargo.toml` | Rust deps + tauri plugins. |
| `.github/workflows/ci.yml` | CI: `test` job (full Playwright suite) + `build` job (3-OS matrix → draft release). See § CI/CD. |
| `LICENSE` | **AGPL-3.0** — the license for *this* project's code (copyright MagFlux, 2026). |
| `NOTICE` | Third-party dependency notices: which bundled deps are permissive (MIT vs. Apache-2.0, incl. the dual-licensed Tauri stack and `mermaid`) vs. the user-approved copyleft exception (`elkjs`, EPL-2.0), the test-only `playwright` (Apache-2.0), and the Linux runtime-only WebKitGTK (LGPL, not bundled). |

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

7. **fs scope must reach hidden (dot) paths.** The in-app picker lists whatever
   `read_dir` returns — that includes dot-dirs like `~/.config`. On Unix the Tauri
   fs-plugin scope defaults to `requireLiteralLeadingDot: true`, whose glob rule
   makes `*`/`**` *not* match path segments that begin with `.`, so navigating into
   a dot-dir is scope-denied (`forbidden path: … allow-read-dir …`) while the very
   dir that *listed* it was allowed. We set `plugins.fs.requireLiteralLeadingDot: false`
   in `src-tauri/tauri.conf.json` so the `fs:scope: ["**"]` pattern matches dot
   segments. The Playwright harness in `test/verifyTauriClose.mjs` scenario H
   asserts the *UI* drives `read_dir` into a dot-path; it **stubs** the fs IPC and
   does not enforce the real scope, so only the actual app enforces the ACL.
    Trade-off: the picker can now reach sensitive dot-dirs (`~/.ssh`, `~/.aws`, …) —
    an intentional, documented choice. Do not re-add a leading-dot filter to the
    picker's `render()`/`goToDir()` without also revisiting this config.

 8. **The bundle must stay a single JS file.** The GTK webview cannot reliably
    resolve a second code-split chunk at runtime (same class of failure as
    invariant 2), so the production build MUST emit exactly one
    `dist/assets/index-*.js`. jsPDF ships a lazy `await import("dompurify")`
    internally that would normally produce a separate chunk; we force it inline
    with `build.rollupOptions.output.codeSplitting: false` in `vite.config.js`.
    After every `npm run build`, confirm the dist has a single `.js` asset.
    `jspdf`, `html2canvas`, and `mermaid` are static top-level imports in `src/markdown.js`
    (browser-safe — they're inert until called), never `await import(...)`.

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

- **Toolbar active-states must track the caret, not just text changes** (do not
  regress). The per-textarea `select` event is unreliable on WebKitGTK — it can
  never fire for a click or arrow-key move there — and the `click` handler
  historically refreshed only the status bar, *not* the buttons, so the B/I/U/S/
  link and H1–H3/quote/list/table buttons stayed stale until the text mutated.
  The live-tracking fix is a document-level **`selectionchange`** listener on the
  active tab (fires for every caret move: click, arrows, paste, undo, tab switch),
  a **`mouseup` + `requestAnimationFrame`** fallback, and re-sync on tab switch via
  `activate()` → `refresh()`. Do not "simplify" back to `select`/`keyup` only;
  the WebKitGTK app will regress to stale buttons.
- **Split-view scroll-sync is value-based echo suppression, not a time-only
  window** (do not regress). In split view the two panes follow each other via
  `followScroll`; each programmatic `scrollTop` write stamps
  `realScroll.__suppE`/`__suppP` with the **exact offset** it set and an `ECHO_MS`
  deadline. `realScroll` ignores a pane scroll *only* while the deadline is *still
  live* AND the pane's `scrollTop` equals the stamped value within `ECHO_EPS`
  (1px). A genuine user scroll lands at a different offset → it is accepted
  immediately even inside the window. A time-only gate (the old bug) swallowed real
   scrolls for up to `ECHO_MS` (~800 ms), producing the "left side lags and catches
   up" symptom. See `test/verifyScroll.mjs` (5 cases).
 - **Mode-switch must preserve the scroll RATIO (do not regress).** Switching view
   modes (split↔edit↔preview) via the mode button refocuses the textarea
   (`activeTab.input.focus()` in the toolbar handler) *and* changes the layout;
   with the caret at the end of the document the browser's scroll-to-caret then
   snaps the visible pane to the BOTTOM, and `followScroll` ratchets the other
   pane with it — previously this read as "switching modes always starts at the
   bottom." `setMode` (in `src/markdown.js`) now records the leaving-mode scroll
   *ratio* **before** the class toggle and re-asserts it on the entering panes
   after two nested `requestAnimationFrame` ticks (wins the race against the focus
   auto-scroll), stamping the value-based `__suppE`/`__suppP` guard on each pane
   so the reflow's scroll event can't ratchet a different value in. A guard skips a
    stale `apply` if the tab or mode changed again inside the rAF window (fast
    double/triple switches). Do not remove those rAF re-asserts or the guard.
    See `test/verifyModeScroll.mjs` (8 cases).
  - **Clicking an already-active tab is a no-op (do not regress).** `activate(doc)`
    (in `src/markdown.js`) must short-circuit with `if (doc === activeTab) return;`
    so an already-active tab re-click does not call `input.focus()` (whose
    browser scroll-into-view scrolled the pane to the caret — both panes jumped,
    e.g. 90% → ~bottom) nor `refresh()` → `syncDom()` (which rewrites both panes'
    innerHTML and re-runs the mermaid render). The session-restore init block relies
    on `activeTab` still being `null` (it stashes the first doc in a `restoreActive`
    temp, never pre-assigns `activeTab`), so that path still falls through and does
    its class-toggle + focus. The same is true for `closeTab` (it passes a *different*
    doc than the stale `activeTab`). Do not re-add a post-return branch that re-fires
     `refresh()` for the self case. See `test/verifyTabClick.mjs` (6 cases).
  - **The mode button must NOT causatively focus the editor textarea when it
    HIDEs (do not regress).** The toolbar click handler ends with a trailing
    `activeTab.input.focus()` that runs after *every* action. When the mode action
    targets **preview** the editor pane is hidden (`.mode-preview .pane-editor
    {flex:0;width:0}` in `style.css`), so keeping that trailing focus call lands a
    focus on a zero-width textarea; on WebKitGTK that fires an EAGER scroll-into-view,
    which `realScroll`→`kickScrollSync`→`followScroll` ratchets onto the *preview*
    pane (the user sees "edit stays top, preview jumps to the bottom"). So the mode
    action does `if (next === "preview") return;` after `setMode(...)` — **skipping
    the trailing focus ONLY for the preview target** while split/edit targets still
    fall through to it (there the textarea is visible and caret-follow is expected).
    This is deliberately *surgical, not a blanket `return`*: a blanket skip breaks
    `verifyModeScroll.mjs`'s caret-mid cases, which depend on the trailing focus for
    edit/split. `test/verifyModeFocus.mjs` (13 cases) blurs `document.activeElement`
    before each click so it measures *causative* focus; it asserts the textarea is
    NOT focused only for edit→preview (2c) and IS focused for split/edit/preview→
    split (1c/3c) — failing the moment the `if` is dropped, in headless Chromium too
    (the scroll-ratio cases there stay at top either way).
 - All dialogs (save/cancel prompts, open, and any error/info feedback) render
  **in-app** via `showModalBase`/`messageModal`/`pickPath` — NOT `alert`/`confirm`/
  `prompt` (unreliable in WebKitGTK) and NOT the native `tauri-plugin-dialog`
  rfd GTK picker (never parents/centers its dialogs, so it drifts off-window).
  The in-app modals are centered by construction inside the single webview.
- **Export-as-PDF/HTML (hamburger menu).** The PDF/HTML actions live in a `.menu-wrap`
  dropdown toggled by the hamburger (`data-action="menu"`), with `data-menu="pdf"` /
  `data-menu="html"` items. HTML export re-renders the markdown to a styled preview and
  writes it; PDF renders that preview off-screen via `html2canvas` (a 780px-wide host
  at `fixed; left:-100000px`, `scale:2`, white bg) and slices the canvas into A4
  (595×842 pt) pages into a `jsPDF` doc. Both save through `pickPath` + Tauri
  `fs.writeFile` (binary) with a browser `Blob`-download fallback — the SAME in-app
  picker as save, never a native print dialog. The outside-click close guard must test
  `ev.target.closest(".menu-wrap")` (the toggle button is a *sibling* of the
  `.menu-dropdown`; testing `.menu-dropdown` treats the button's own click as
  "outside" and closes the menu the instant the toolbar handler opens it).
- **`test/test.mjs` polyfills the browser env for Node.** It stubs `globalThis.window`
  (with `document`, `location.href`, `atob`, `btoa`) so jsPDF's UMD wrapper and
  html2canvas's `CacheStorage.setContext` don't throw when `markdown.js`'s static
  imports load under Node. If you add another browser-global library import, extend the
  same stubs there rather than making it a dynamic import.

## Known limitations (browser fallback)

- In a plain browser (`vite preview` / `npm run dev`), Save uses a file download
  (WebKitGTK-style no-op aside) and there is no window-close interceptor (the
  `beforeunload` guard is the only guard). All the Tauri-native paths (real
  `save`/`open` dialogs, `onCloseRequested`) must be validated in the actual app —
  the Playwright tests exercise the shared code paths and assert the browser
  fallbacks, not the native ones.
