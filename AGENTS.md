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
  Claude …`, no `Generated-by`, no "made by an AI" trailer unless its actually true.

## What this is

A single-window, multi-tab Markdown editor. Blank tabs are numbered `Untitled 1`,
`Untitled 2`, … within each application run; the counter resets on restart. Plain JS
(no framework), one DOM, one
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

This project is **AGPL-3.0-licensed** (see `LICENSE`). We chose
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
npm test               # 26 round-trip + overlay-styling cases (no server, instant)
npm run verify         # UI smoke test (tabs, undo/redo, underline, tables)
npm run verify-undo    # undo/redo UI test (11 cases)
npm run verify-save    # save / close-guard UI test (24 cases)
npm run verify-toolbar # toolbar active-states track the caret (41 cases) — bold/underline/
                       # code/H2/link/italic/strike with and without trailing punctuation,
                       # toggle-OFF comma preservation, multi-word spans, + click, arrow-key,
                       # programmatic, and tab-switch paths, all with NO text change required.
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
  npm run verify-themescroll # Theme-switch scroll preservation + themed scrollbars: changing
                             # light/dark preserves the current editor and preview scroll ratios
                             # in both directions, AND the scrollbar palette flips with the theme
                             # (--sb / scrollbar-color / ::-webkit-scrollbar-thumb luminance is
                             # light in light mode, dark in dark mode — the Windows regression
                             # this guards, where the OS kept painting dark scrollbars in a light
                             # app / light scrollbars in a dark app) (10 cases).
   npm run verify-mermaidflicker # Mermaid anti-flicker: a keystroke in prose OUTSIDE a fence
   # must not flash raw code — the already-rendered holder is present in the SAME
   # synchronous tick as the keystroke (restoreMermaid from _svgCache); a keystroke
   # INSIDE a fence still re-renders after the 120 ms debounce. (7 cases.)
    npm run verify-mermaidstyle # Mermaid stylesheet-failure robustness: node rects carry stamped
    # fill/stroke, messageLine stroke="none" placeholders are overwritten, and after
    # removing EVERY <style> element in the document the computed styles STILL match
    # the theme (the Windows WebView2 black-node regression, simulated) (28 cases,
    # incl. the font-consistency check: the sheet paints the SAME fontFamily stack
    # mermaid measures with — the Windows label-centering fix; oversized-FO
    # labels get flex-recentered; oversized EDGE-label FOs (labelBkg, the
    # Windows "grey box around Ctrl+S / Export" report) are normalized to the
    # painted content on ANY >2px deviation (the oversize VARYS per label, so
    # the old 25% gate fixed "Ctrl+S" but missed a mildly-oversized "Export")).
    npm run verify-mermaidfade # Mermaid dark-theme gradient-outline fade: flowchart node
    # outlines must be a SOLID color, never the left-to-right url(#id-gradient)
    # stroke Mermaid's neo look paints when the dark theme sets useGradient=true
    # (start #ccc → stop dark grey — the right half of every box outline faded
    # into the background). mermaid.initialize now passes
    # themeVariables:{useGradient:false,dropShadow:"none"}; checked in BOTH
    # themes (16 cases: solid stroke + no drop-shadow filter — the Windows
    # "fuzzy borders" report).
   npm run verify-tauri   # NATIVE Tauri path: stubs __TAURI_INTERNALS__, drives the
                         # real api/IPC (49 cases) — save→in-app picker→write+close,
                        # overwrite-confirmation→write, overwrite-cancel→stays,
                        # picker-cancel→stays, save-discard-cancel→stays,
                        # known-path→direct write, open→picker→new tab, open-cancel,
                        # navigate-into-forbidden-dir→crumb stays on last readable,
                        # Home button always present in the picker pathbar and jumps
                        # back to the home dir even after navigating deep, and the
                        # a caret ENTERS a hidden (dot) folder (read_dir on the dot-path) —
                        # the UI-level guard for the fs requireLiteralLeadingDot:false fix.
                        # Needs the built dist.
npm run verify-caret    # Caret placement after editor actions (71 cases): Enter
                        # auto-continuation keeps the parent item's indentation with a
                        # collapsed caret after the marker (ordered/empty-exit too);
                        # Tab indent (incl. BLANK lines) / Shift+Tab outdent commit a
                        # collapsed caret whose column follows the text (no highlight);
                        # inline formats (mid-word, selection, toggle-off, gap-insert)
                        # collapse at the end of the inner span BEFORE the closing
                        # marker; code-fence wrap puts the caret inside the fence
                        # ("```\n|\n```" empty, after content otherwise); table insert
                        # lands the caret in the first body cell; h1 caret at block end;
                        # Markdown-aware Ctrl+Arrow word moves: whitespace-run words
                        # (trailing punctuation rides along, standalone ` - ` is its
                        # own stop), formatted spans atomic, line-crossing stops at
                        # the next line's first word, document edges stay native;
                        # Ctrl+Shift+Arrow selection gestures act on the CARET edge
                        # (shrink/flip like native shift+arrows).

# Native app (needs Rust + WebKitGTK; make sure `cargo` is on PATH,
# e.g. `export PATH="$HOME/.cargo/bin:$PATH"` in your shell profile)
npx tauri dev          # dev window
npx tauri build        # release binary + bundle artifacts
```

After any edit to `src/`, **run `npm run build`** and confirm the production bundle
still emits a single `dist/assets/index-*.js` (no code-split Tauri-plugin chunks) —
see the invariant below. Then re-run the seventeen verify/test steps (`verify`, `verify-undo`,
`verify-save`, `verify-toolbar`, `verify-paste`, `verify-export`, `verify-scroll`,
`verify-modescroll`, `verify-modefocus`, `verify-tabclick`, `verify-tabscroll`, `verify-themescroll`, `verify-mermaidflicker`, `verify-mermaidstyle`, `verify-mermaidfade`, `verify-tauri`, `verify-caret`, and `npm test`); all must be green.
For Tauri-native changes also run `npm run verify-tauri`.

## CI/CD (GitHub Actions)

The pipeline lives in `.github/workflows/ci.yml`. Two jobs.

**Triggers** (deliberately *not* on every push, to save runner compute):
- `pull_request` — `opened | synchronize | reopened | ready_for_review`
- `release` — `created`

**Jobs**:

 0. **`validate-tag`** (ubuntu-latest) — fail-fast gate on `release.created`: the tag must match `^v\d+\.\d+\.\d+(-\d+)?$` with numeric prerelease `<= 65535` (MSI/WiX rejects text like `-rc.1`). Rejects bad tags in seconds before `test`/`build` burn runner time. No-op on PRs (but `test` still `needs` it, so it runs as a fast skip there).

 1. **`test`** (ubuntu-latest) — the full Node/Playwright verification suite,
      cheap → expensive: `npm test` → `verify` → `verify-undo` → `verify-save` →
       `verify-toolbar` → `verify-paste` → `verify-export` → `verify-scroll` →
       `verify-modescroll` → `verify-modefocus` → `verify-tabclick` → `verify-tabscroll` → `verify-mermaidfade` → `verify-tauri`. No Rust.
    Runs on PR and on release.

2. **`build`** (3-OS matrix) — the expensive one: compiles the Rust shell +
   packages installers via `tauri-apps/tauri-action@v0`, then re-packages a
   portable standalone archive per OS from the already-built output (no extra
   compile) and uploads it to the same release via `gh release upload`:
   - `windows-latest`: `--bundles nsis,msi` (NSIS via `choco`) + `*-windows-x64-portable.zip` (raw `markdown-editor.exe` zipped via `Compress-Archive`)
   - `macos-14`: `--bundles dmg` + `*-macos-aarch64-portable.zip` (the `.app` is extracted from the `.dmg` via `hdiutil attach` + `ditto -c -k --keepParent` — `dmg` alone leaves no loose `.app` on disk, so the step mounts the dmg and copies whatever `*.app` it contains)
   - `ubuntu-22.04`: `--bundles appimage,deb` (WebKitGTK 4.1, GTK3, appindicator, rsvg) + `*-linux-x86_64-portable.tar.gz` (raw `markdown-editor` binary; NOT fully self-contained — Tauri links WebKitGTK dynamically, so the target machine must provide the runtime libs `libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1 librsvg2-2` — the AppImage remains the most portable Linux option, the `.deb` pulls these in automatically)

   Gated on `validate-tag` + `test` passing **and** `github.event_name == 'release'` (so it
   never runs on PRs or plain pushes). Installers + portables attach to the exact
   release tag that was just created. The tag (`vX.Y.Z`) is the version: the
   build job strips the `v` and injects it into `src-tauri/tauri.conf.json`
   and `src-tauri/Cargo.toml` (both keep a `0.0.0` placeholder in the repo)
   before `tauri build`, so the bundled app/installers carry the tag.
   Never bump a version file by hand — just cut the release.

### `tauri-action` inputs (what actually works)

| Input | Value | Why |
|---|---|---|
| `projectPath` | `.` (repo root) | The action uses this as the **cwd** for both `tauri build` and `beforeBuildCommand: npm run build`. It also auto-discovers `src-tauri/` by globbing for `tauri.conf.json` (glob: `**/tauri.conf.json`). Setting it to `src-tauri` would make both commands run inside `src-tauri/` where there is no `package.json` → instant failure. |
| `tauriScript` | `npx tauri` | Bare `tauri` is not on PATH. `npx` resolves `@tauri-apps/cli` from the root `node_modules/`. The action's auto-detect would work too, but being explicit avoids the `install -g` fallback. |
| `args` | `--bundles <list>` | Passes through to `tauri build`. Without it, all platforms would attempt `targets: "all"`. |
| `tagName` | `${{ github.event.release.tag_name }}` | The release tag itself (e.g. `v0.1.1`) — the tag is the version, no `__VERSION__` lookup. |
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
| `src/markdown.js` | The app: `createApp()` — tabs, undo/redo, keybinds, save/open, DnD, window-close guard, modals, toolbar actions, session persistence. Keeps the STATIC Tauri imports and wires the extracted export handlers; it re-exports the pure-helper modules below so its public shape is unchanged (`test/test.mjs` imports `highlightToHtml` from here). |
| `src/export.js` | Static PDF/HTML export pipeline: standalone HTML rendering, Mermaid capture, A4 PDF pagination, browser downloads, and native writes through callbacks supplied by `createApp()`. |
| `src/session.js` | Versioned localStorage session persistence and debounced saves, using callbacks for the active tab and serializable tab records. |
| `src/dialogs.js` | Centered in-app modal primitives, unsaved-changes prompts, and overwrite confirmation, with native filesystem checks supplied by callbacks. |
| `src/picker.js` | In-app Save/Open filesystem picker: directory navigation, breadcrumbs, Home/Up controls, extension filtering, selection, and injected filesystem/modal callbacks. Detects the platform path separator from the initial cwd (`\` on Windows, `/` elsewhere) and uses it consistently for all path joining, crumb reconstruction, and go-up navigation — without this, Windows paths like `C:\Users\…` get joined with `/` producing `/C:\Users\…` which the OS rejects (os error 123). |
| `src/editing.js` | Formatting mutation factory: inline and block toggles plus indent/outdent, using injected active-doc, commit, and pure-helper callbacks. |
| `src/links.js` | Link-token detection and Ctrl+click/caret opening factory, with injected active-doc, Tauri gate, and browser fallback. |
| `src/history.js` | Undo/redo history factory, with injected active-doc, typing-flush, input-suppression, and refresh callbacks. |
| `src/render.js` | Pure overlay-highlight renderer: `esc`, `matchTok`, `renderInline`, `isTableSep`, `computeBlocks`, `lineToHtml`, `highlightToHtml` (round-trip invariant enforced by `test/test.mjs`). |
| `src/mermaid.js` | Mermaid SVG rendering: `renderMermaidSvg`, `renderMermaidInNode`, `renderMermaidInHtml`, `restoreMermaid`, `scheduleMermaidRender`. Owns the STATIC `mermaid` import (invariant 2). Also owns the **anti-flicker SVG cache**: `_svgCache` (source → rendered `{svg, bindFunctions}`), `_inflight` (concurrent-render dedup), `restoreMermaid(node)` (synchronous cache-restore after `syncDom` rewrites the preview so an already-seen diagram NEVER flashes raw code), and `mermaidSourceKey(md)` (per-doc "did any fence change" fingerprint that `scheduleMermaidRender` uses to skip render when the source didn't change). Also owns the **stylesheet-failure fallback**: `installMermaidStyles(holder)` (head-mirror + stamp) and `stampSvgStyles(holder)` (CSSOM-parse Mermaid's own sheet → presentation attributes on matching shapes; see invariant § Mermaid stylesheet-failure fallback). `renderMermaidSvg`'s `mermaid.initialize` also pins `themeVariables:{useGradient:false,dropShadow:"none"}` (see invariants § Mermaid dark-theme gradient outlines / § Mermaid drop shadow). |
| `src/format.js` | Pure selection/format helpers: `lineBounds`, `wordAt`, `wordJump` (Markdown-aware Ctrl+Arrow word movement), `detectFormat`, `trimmedSpan`, `wrapFor`. |
| `src/paste.js` | Rich-paste HTML→Markdown: `mdCellText`, `mdTableFromHtml`, `mdStyleOf`, `mdInlineMd`, `mdFromHtml`. |
| `src/icons.js` | Inline-SVG toolbar icons (B I S code link table + save/open + new-tab + undo/redo + hamburger/file-doc + `theme` (light/dark moon) + the three view-mode glyphs `viewSplit` / `viewEdit` / `viewPreview` on the constant-width mode button — `setMode` swaps `.mode-icon`'s innerHTML per mode so the button width never changes and the centered group never jostles). Every toolbar button uses one of these 17px SVGs (a font glyph like `◑` sits on the text baseline and looks vertically off-center — always use an icon). |
| `src/style.css` | All styles, light + dark themes. Lightly touches `[data-theme]`. Owns the per-theme scrollbar palette — `color-scheme`, and the `--sb` / `--sb-hi` thumb vars (light + dark) consumed by `scrollbar-color` and the `::-webkit-scrollbar*` rules, so scrollbars blend with the active theme (see invariant 9). |
| `src/main.js` | Bootstrap: `createApp('#app')` + sample content. |
| `test/test.mjs` | Round-trip invariant (strip `<span>` from overlay HTML must reproduce source). |
  | `test/verifyCaret.mjs` `test/verify.mjs` `test/verifyUndo.mjs` `test/verifySaveOpen.mjs` `test/verifyToolbar.mjs` `test/verifyPaste.mjs` `test/verifyExport.mjs` `test/verifyScroll.mjs` `test/verifyModeScroll.mjs` `test/verifyModeFocus.mjs` `test/verifyTabClick.mjs` `test/verifyTabScroll.mjs` `test/verifyMermaidFlicker.mjs` `test/verifyMermaidStyle.mjs` `test/verifyMermaidFade.mjs`| Headless Chromium Playwright tests (all live in the `test/` dir). `verifyCaret.mjs` is the caret-placement regression (Enter list-continuation keeps indentation + collapsed caret; Tab/Shift+Tab incl. blank lines commit collapsed with the column following the text; inline formats collapse at the inner-span end before the closing marker; code-fence wrap caret inside the fence - `` ```\n|\n``` ``; table caret in first body cell; h1 caret at block end; Markdown-aware Ctrl+Arrow word moves treat a whole formatted span as one word while plain moves fall through native - 71 cases). `verifyExport.mjs` covers the PDF/HTML export menu + save/cancel paths (30 cases). `verifyScroll.mjs` is the split-view scroll-sync regression (a real follow-pane scroll inside the ECHO window is accepted immediately — 5 cases). `verifyModeScroll.mjs` is the mode-switch scroll-PRESERVING regression (setMode records the leaving-mode ratio and re-asserts it on the entering panes so the mode button never jumps the view to the document end — 8 cases). `verifyModeFocus.mjs` is the mode-click focus regression (the mode button must causatively skip its trailing textarea focus ONLY when entering preview — the hidden textarea's scroll-into-view ratchets the preview to the bottom; for the preview target the mode action does `if (next === "preview") return;` while split/edit targets keep the normal caret-follow focus — 13 cases). `verifyTabClick.mjs` is the redundant-tab-click regression (activate() short-circuits when `doc === activeTab` so clicking the already-active tab neither moves the scroll nor rewrites the preview DOM / re-renders mermaid — 6 cases). `verifyTabScroll.mjs` is the cross-tab scroll-persistence regression (a tab's editor + preview scroll survive hiding and returning — 7 cases). `verifyMermaidFlicker.mjs` is the mermaid anti-flicker regression (a keystroke in prose OUTSIDE a fence must NOT flash raw code — the already-rendered holder is present in the same synchronous tick as the keystroke; a keystroke INSIDE a fence still re-renders — 7 cases; the diagram source must be valid mermaid or it never renders and there is nothing to cache). `verifyMermaidStyle.mjs` is the mermaid stylesheet-failure regression (stamped attrs exist, messageLine placeholders overwritten, computed styles survive removing EVERY `<style>` element, and the sheet's font stack + oversized-FO flex centering + text-label re-anchoring + WebKitGTK center-snap + oversized-edge-label FO normalization — 28 cases). `verifyMermaidFade.mjs` is the mermaid dark-theme gradient-outline regression (no linearGradient in the defs, sheet + computed + stamped node stroke all SOLID in both themes, and no drop-shadow filter — 16 cases).|
| `test/verifyTauriClose.mjs` | **Native-path** harness: injects a `__TAURI_INTERNALS__` stub, drives the real `@tauri-apps` api/IPC (`onCloseRequested` → save/cancel → `fs/write_text_file` / `window/destroy`). No Rust needed. |
| `index.html` | Entry. Loads the single Vite bundle. |
| `vite.config.js` | Dev/preview server pinned to `127.0.0.1` (avoids IPv6 `localhost` mismatch). Also `build.rollupOptions.output.codeSplitting: false` — prevents jsPDF's internal `await import("dompurify")` from emitting a second chunk so the bundle stays a single `index-*.js` (see invariant 8). |
| `src-tauri/tauri.conf.json` | Window, CSP, `frontendDist: ../dist`, `beforeBuildCommand: npm run build`, identifier `com.mssok.markdowneditor`. Also `plugins.fs.requireLiteralLeadingDot: false` — lets the fs scope `**` match hidden (dot) path segments on Unix so the picker can open `~/.config` etc. (see invariant 7). |
 | `src-tauri/capabilities/default.json` | Permissions: `dialog:default`, `fs:allow-read-text-file`, `fs:allow-exists`, `fs:allow-write-text-file`, `fs:allow-write-file` (PDF/HTML export), `fs:allow-read-dir`, `core:path:default`, `core:window:allow-destroy`, `opener:default`, scope `["**"]`. |
 | `src-tauri/src/main.rs` | Registers `plugin_fs`, `plugin_dialog`, `plugin_opener` on the Tauri builder and wires `keymap::install()` (Linux). |
 | `src-tauri/src/keymap.rs` | GTK-level Shift+Tab keysym fix: X reports Shift+Tab as `GDK_KEY_ISO_Left_Tab` (0xFE20) and WebKitGTK turns that into a DOM key of "Unidentified", so the JS outdent never ran and GTK moved focus away; this rewrites the keysym to `Tab` (+Shift) on the raw WebKit widget and swallows the original. See invariant "Tab / Shift+Tab are captured…". |
| `src-tauri/Cargo.toml` | Rust deps + tauri plugins. |
| `.github/workflows/ci.yml` | CI: `test` job (full Playwright suite) + `build` job (3-OS matrix → installers + portable archives → draft release). See § CI/CD. |
| `LICENSE` | **AGPL-3.0** — the license for *this* project's code. |
| `NOTICE` | Third-party dependency notices: which bundled deps are permissive (MIT vs. Apache-2.0, incl. the dual-licensed Tauri stack and `mermaid`) vs. the user-approved copyleft exception (`elkjs`, EPL-2.0), the test-only `playwright` (Apache-2.0), and the Linux runtime-only WebKitGTK (LGPL, not bundled). |

## Hard invariants (do not regress)

1. **Round-trip invariant** — stripping every `<span>` out of the overlay HTML must
   reproduce the exact source, character-for-character. This is what keeps the
   invisible caret aligned under the overlay. `test/test.mjs` enforces this (26 cases:
   round-trip + a `.u`-span styling assertion for `<u>…</u>`, because a
   plain-escaped-text fallback also round-trips and would otherwise hide a broken
   token match — the anchored `/^<\/u>/` close-tag regression).
   Any renderer change must pass it.
  Inline overlay styles must not add horizontal padding or margins: code spans
  may change color/background, but their rendered width must remain identical
  to the textarea text or later words will visibly drift under the overlay.

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
  Clearing the last tab in place also allocates the next per-run `Untitled N` name,
  as if a fresh blank tab had been opened.

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
    `jspdf` and `html2canvas` are static top-level imports in `src/export.js`, and
     `mermaid` is a static top-level import in `src/mermaid.js` (browser-safe —
      they're inert until called), never `await import(...)`.

 9. **Scrollbars must blend with the active theme (do not regress — Windows
    scrollbar mismatch).** On Windows the app runs in WebView2, where the OS can
    paint its *own* themed scrollbars over ours — leaving them DARK in a light
    app or LIGHT in a dark app. The fix (in `src/style.css`): (a) `color-scheme`
    is set **per theme** — `light` in `:root`, `dark` in `[data-theme="dark"]` —
    so native platform chrome (including scrollbars on platforms that honor it)
    follows the app, NOT the OS default; (b) `--sb` / `--sb-hi` thumb vars are
    defined per theme (light: `#c7ccd4`/`#a8aeb8`, dark: `#4a5058`/`#5c636d`) and
    consumed by the standard `scrollbar-color: var(--sb) transparent` (Firefox +
    modern browsers) AND the `::-webkit-scrollbar` / `::-webkit-scrollbar-thumb`
    rules (WebKitGTK, WebView2, Chrome). Do not remove the per-theme
    `color-scheme` override or the `--sb` vars — both are load-bearing for the
    "scrollbar matches the theme" guarantee. `test/verifyThemeScroll.mjs`
    (10 cases) asserts the thumb luminance is >0.3 in light and <0.25 in dark,
    reading `--sb`, `scrollbar-color`, and the `::-webkit-scrollbar-thumb`
    background (the thresholds deliberately sit in the gap between the light
    ~0.42–0.62 and dark ~0.08–0.12 sets, so Chromium's habit of resolving the
    `:hover` variant never misclassifies).
    - **Theme is persisted and bootstrapped.** `toggleTheme()` (in `src/markdown.js`)
      writes `localStorage.setItem("me.theme","dark")` on dark and
      `localStorage.removeItem("me.theme")` on light (light is the default; the
      key is absent). `src/main.js` reads `localStorage.getItem("me.theme")==="dark"`
      BEFORE `createApp()` and sets `documentElement.dataset.theme` accordingly, so
      a returning user lands in their last theme. Do not "simplify" this away —
      the theme must survive a restart (the WebKitGTK/WebView2 webview does not
      apply `prefers-color-scheme` to the *app's* choice, only to the OS, so a
      manual toggle is the only reliable signal).

## Conventions

- **Keep each source file small — target ≤ ~1500 SLOC (do not let it creep past).**
  Try not to let any single source file grow comfortably beyond roughly **1500
  source lines of code** (SLOC = non-blank, non-comment-only lines). This is a
  **soft ceiling, not a hard gate**: a file may sit a little over the line, but the
  change that pushes one past it is the right moment to carve out a cohesive chunk
  of logic into its own small module. The codebase already follows this pattern —
  `src/export.js`, `src/session.js`, `src/dialogs.js`, `src/picker.js`,
  `src/editing.js`, `src/links.js`, `src/history.js`, `src/format.js`, `src/paste.js`,
  and `src/mermaid.js` were all split off the original monolith, and `src/markdown.js`
  re-exports them so its public shape is unchanged. When you extract logic, keep
  that re-export surface intact so the module graph (and the `test/test.mjs` import
  of `highlightToHtml` via `src/markdown.js`) keeps working, and keep the *new*
  module under the same ceiling rather than trading one big file for a slightly
  smaller one. Measure SLOC (not raw line count) with `cloc src/` or `tokei` — both
  report source lines excluding blanks and comments.
- No build tooling beyond Vite + a single bundle. Do not add a framework (React,
  Vue, etc.). Do NOT introduce dynamic `import()` (code-splitting) of any Tauri
  plugin or module — `src/markdown.js` currently has zero `import(...)` calls and
  must stay that way, so the bundle remains one file that loads in the GTK webview.
 - Comments: keep the WHY (especially the invariants above) in-line; they encode
   hard-won debugging history.
 - **JSDoc is mandatory and must stay current (do not let it go stale).** Every
   function in `src/*.js` carries a `/** … */` block stating its purpose in plain
   English, plus `@param {Type} name — desc` and `@returns {Type} desc` where
   non-obvious. Every `test/*.mjs` file carries a `/** … */` file-header naming
   the regression it guards and the npm script that runs it. When you **add, rename,
   or change the contract of a function** (its params, return, or the behavior it
   guarantees) — **update its JSDoc in the same change**, and when you add a new
   helper, give it one. Do not leave a JSDoc block describing the *pre*-change
   signature. The inline WHY comments above remain the authoritative record of the
   debugging history; JSDoc is the quick "what does this do / what does it take /
   what does it return" layer on top.
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
    `wordAt` returns a complete inline-format span when the caret is inside
    formatted text containing spaces, so all inline buttons stay active across
    spans such as `**two words**` and `<u>two words</u>`. Code spans are checked
    first, so marker-like text such as `` `**markers**` `` remains code, not bold.
 - **Format detection must survive trailing sentence punctuation (do not
   regress).** `wordAt` splits tokens on whitespace only, so a formatted word
   followed by a comma / period / `; : ! ?` (e.g. `**bold**` in
   `- Live **bold**, *italic*`) comes back as a single token WITH that trailing
   punctuation — the old anchored `^…$` regexes in `detectFormat` then failed
   and only the block button (e.g. `ul`) lit up. The fix: `detectFormat`
   strips SENTENCE punctuation (`[.,;:!?]+`) from both token edges before
   matching, and returns the true span bounds (`fs` / `fe`) alongside
   `fmt` / `inner`. `toggleFormat` splices on `det.fs`/`det.fe` (via
   `trimmedSpan` for the apply-new-format branch) so the adjacent punctuation
   is preserved when removing OR re-wrapping. The punctuation set is safe
   because no format marker (`* _ ~ ` < > / [ ] ( )`) is in it, and a URL
    inside `[text](https://…)` is not at a token edge. `verifyToolbar.mjs`
   (41 cases) covers: caret on `**bold**` / `*italic*` / `~~strike~~` /
    `[…](https://…)` each with a trailing comma, plus a toggle-OFF case
    asserting the comma survives.
  - **Collapsed-caret inline formatting INSERTS an empty marker pair (do not
    regress).** With NOTHING selected, a formatting button must never wrap the
    word nearest the caret: a caret on an empty line, in the whitespace
    between words, or at a plain-token edge inserts an empty marker pair
    (`****` bold / `**` italic / `~~~~` strike / `<u></u>` underline /
    ``` `` ``` code / `[](https://)` link) at the caret with the cursor
    between the markers, ready to type — padded with one space on a side
    whose adjacent char is a word char, so a caret at either edge of the
    single-space gap in `the test` yields exactly `the **** test`. It only
    unwraps when the caret sits INSIDE an already-formatted span (so the lit
    B button honestly toggles `**bold**` off at every intra-span caret,
    including the span edges `wordAt` reports). A caret strictly inside a
    PLAIN word still wraps that word (`bold me` caret mid-`me` →
    `bold **me**`), and a single-line SELECTION is wrapped exactly
    (`select me` sel `me` → `select **me** please`). This is `toggleFormat`
    in `src/editing.js` (regime comments in the source); verified by the
    empty-line / between-words / toggle-off / selection cases in
    `test/verifyToolbar.mjs`. `verifyUndo.mjs` phase 2 keeps the caret
    mid-word so the typed-burst separation still exercises the wrap path.
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
 - **The mode button is constant-width (do not regress).** The toolbar is a flex
   row: `.tb-left` | `.tb-center` (flex:1, `justify-content:center`) | `.tb-right`.
   The mode button sits in `.tb-right`, so if its width ever changes, `.tb-right`
   re-flows and the whole centered formatting group visibly "jostles" under the
   cursor. The mode button therefore shows a **17px inline SVG glyph**
   (`.mode-icon` → `icons.viewSplit` / `viewEdit` / `viewPreview`, swapped by
   `setMode`) — the same constant-width treatment as every other toolbar button —
   and keeps `.mode-label` (the `Split`/`Edit`/`Preview` word) **visually-hidden**
   (a 1px clip) for a11y and for tests that read `mode-label.textContent`. Do not
   put the mode word back on screen (it was 89–116px wide, which is exactly what
   caused the re-centering), and do not size `.tb-right` to the label. If you add
   right-side buttons, keep them the same constant size or the center drifts again.
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
  `data-menu="html"` items — **text-only** (no icons; a past `${icons.fileDoc}` with
  no `.mi-icon` wrapper rendered unconstrained and blew the menu huge on Windows
  WebView2, while WebKitGTK happened to size it small). `style.css` also carries a
  `.menu-item > svg` 16px belt-and-braces rule for any bare SVG child. HTML export
  re-renders the markdown to a styled preview and
  writes it; PDF renders that preview off-screen via `html2canvas` (a 780px-wide host
  at `fixed; left:-9999px`, `scale:2`, white bg — VISIBLE, because html2canvas must
  rasterize real pixels; `-100000px` risked a WebView2 composite ghost) and slices
  the canvas into A4
  (595×842 pt) pages into a `jsPDF` doc. Both save through `pickPath` + Tauri
  `fs.writeFile` (binary) with a browser `Blob`-download fallback — the SAME in-app
  picker as save, never a native print dialog. The outside-click close guard must test
  `ev.target.closest(".menu-wrap")` (the toggle button is a *sibling* of the
  `.menu-dropdown`; testing `.menu-dropdown` treats the button's own click as
  "outside" and closes the menu the instant the toolbar handler opens it).
- **`test/test.mjs` polyfills the browser env for Node.** It stubs `globalThis.window`
  (with `document`, `location.href`, `atob`, `btoa`) so jsPDF's UMD wrapper and
  html2canvas's `CacheStorage.setContext` don't throw when `export.js`'s static
  imports load under Node. If you add another browser-global library import, extend the
   same stubs there rather than making it a dynamic import.
 - **Mermaid anti-flicker cache (do not regress).** `syncDom` rewrites
   `d.preview.innerHTML` on every keystroke — this wipes any previously-rendered
   `<div class="mermaid-diagram">` holder back to a raw `<pre><code
   class="language-mermaid">`, and the old 120 ms debounce then re-rendered it.
   The gap was visible as a brief flash of raw code. The fix (in `src/mermaid.js`)
   has three parts, all required:
   (a) `_svgCache` (source text → `{svg, bindFunctions}`, max 200 entries, LRU);
   (b) `restoreMermaid(node)` — called **synchronously** in `syncDom` right after
   the innerHTML write; walks `pre > code.language-mermaid` fences and substitutes
   a cached holder IN PLACE (zero async, zero timers); fences with no cache entry
   are left alone for the debounced render;
   (c) `mermaidSourceKey(md)` + `scheduleMermaidRender(d)` — when the per-doc
   fingerprint of all fence bodies is unchanged the 120 ms timer is **not** armed
   (no pending `mermaid.render`, no DOM churn); when the source **did** change
   the timer is armed as before (the diagram is legitimately stale).
   Together this means: typing in prose outside a fence is a pure cache-restore
   (no flash); typing inside a fence re-renders normally (120 ms debounce).
   The test fixture diagram in `verifyMermaidFlicker.mjs` uses **valid** mermaid
   (invalid source would cause mermaid to throw and produce no cache entry —
   making the anti-flicker path untestable).
 - **Mermaid stale-render guard (do not regress — Windows ghost diagrams).**
   `renderMermaidInNode` is async: `syncDom` can rewrite `preview.innerHTML`
   while a `mermaid.render` is still in flight, detaching the `pre` it captured.
   The old `else node.appendChild(holder)` fallback then appended the stale SVG
   as a DUPLICATE above the real diagram (boxes/lines echoing the diagram below
   — seen on Windows WebView2 where timing differs). The fix: check
   `pre.isConnected && node.contains(pre)` before AND after the `await`, and
   skip (never append) when detached. `restoreMermaid` carries the same guard.
   The measuring host is `absolute; left:-9999px; width:960px; visibility:hidden`
   (hidden keeps layout for getBBox measurement; `display:none`/zero-size would
   mismeasure; `-100000px` risked a WebView2 composite ghost). Each render uses
   a unique id so concurrent renders never share marker/gradient ids.
 - **Mermaid stylesheet-failure fallback (do not regress — Windows black nodes).**
   Mermaid v12 emits shape colors ONLY as `#id .selector{fill:...}` rules in the
   SVG's `<style>` block — the shapes carry no fill/stroke attributes. On Windows
   WebView2 that block can fail to apply (solid-black flowchart nodes, invisible
   edges, labels floating outside shapes; sequence lifelines/messages vanish).
   `installMermaidStyles(holder)` in `src/mermaid.js` does two things with
   Mermaid's OWN generated CSS — no hardcoded theme values: (a) copies the SVG's
   `<style>` into a document-level `<style data-mermaid-style="SVG_ID">` element
   scoped by the SVG's unique id; (b) calls `stampSvgStyles(holder)`, which
   parses the sheet in PURE JS (brace-depth scan with quote handling; NO CSSOM —
   the Windows diagnostics proved WebView2's `insertRule` rejects EVERY rule of
   a throwaway sheet, so the engine path stamped nothing there) and stamps every
   `prop: value` declaration onto matching shapes as presentation attributes.
   The sheet's `#id` prefix is stripped from each comma-separated compound;
   `@`-rules and `:root`/pseudo rules are skipped (the
   `#id :root{--mermaid-font-family…}` rule is meaningless outside the SVG).
   Presentation attributes lose to
   author CSS, so where the stylesheet applies (Linux/WebKitGTK) rendering is
   pixel-identical; where NO `<style>` applies at all (the observed WebView2
   failure), the attributes carry the diagram. SVG shapes are ALWAYS
   overwritten (last matching rule wins ≈ source order): the inline
   `stroke="none"` placeholders on sequence messageLines ARE replaced, and
   mermaid's own inline actor `fill="#eaeaea"` is replaced by the sheet's
   `#ECECFF` so a stylesheet-failed Windows matches the Linux render — do not
   re-add a "skip existing attributes" check, it is what left Windows actors
   grey while Linux showed lavender. For HTML labels (mermaid's
   foreignObject text) the declaration is applied as an inline STYLE instead
   of an attribute: text-align/color/background have no presentation-attribute
   form, so attributes would be ignored there (the "Windows text not
   centered" report) — existing inline styles mermaid set are not clobbered.
   The mermaid SVG cache and the schedule fingerprint are keyed by
   THEME + source (`mmCacheKey`) — a theme toggle re-renders every diagram in
   the new theme; `toggleTheme()` resets `__mmLastKey` and calls `refresh()`
   for the same reason (a dark-rendered diagram must never keep its dark
   colors in a light app).
   The old per-shape `inlineMermaidFallback` was removed because platform-specific
   attribute rewriting changed selector precedence and broke valid diagrams on
   Linux. `installMermaidStyles` is called in both `renderMermaidInNode` and
   `restoreMermaid` immediately after setting `holder.innerHTML`. A Ctrl+Shift+M
   diagnostics modal (`src/main.js`) reports per-diagram layer state (SVG style
   length, head mirror present, stamped attrs, computed fill) plus stamped-
    attribute counts, so a Windows report can pin down which layer failed;
    it also dumps LABEL GEOMETRY (per node: the label's center vs its shape's
    center, the COMPUTED painted font family/size, the foreignObject size and
    inline styles) — the decisive reading for the Windows label mis-centering.
     `test/verifyMermaidStyle.mjs` (28 cases)
     asserts the stamped attrs exist, that computed styles survive removing
     EVERY `<style>` element from the document, and (font consistency, cases
     5a/5b) that the generated sheet carries the SAME fontFamily stack mermaid
     measures with plus the `p{margin:0}` rule label centering depends on.
  - **Mermaid dark-theme gradient outlines are disabled (do not regress —
    the "box outlines fade left-to-right" report).** Mermaid v12's default
    `neo` look paints flowchart node strokes as a left-to-right
    `linearGradient` (`[data-look="neo"].node rect { stroke:
    url(#id-gradient) }`, stops = `themeVariables.gradientStart` →
    `gradientStop`). The DARK theme sets `useGradient: true` with start
    `#ccc` and stop = a much darker grey, so the right half of every box
    outline faded into the dark background (sequence diagrams never used
    that gradient, which is why only flowcharts were affected; the light
    "default" theme already has `useGradient: false`). The fix:
    `renderMermaidSvg`'s `mermaid.initialize` passes
    `themeVariables: { useGradient: false, dropShadow: "none" }` — the
    SUPPORTED knob Mermaid itself honors (an explicit key in themeVariables
    overrides the theme's default; `calculate` copies every override onto
    the theme object), so the generated sheet emits the solid `nodeBorder`
    stroke and both the stylesheet AND the stamped presentation attributes
    (the WebView2 fallback) carry it. Do not remove that override; if a
    future fix needs gradients back, it must keep dark-theme outlines
    readable. `test/verifyMermaidFade.mjs` (16 cases)
    asserts, in BOTH themes: no `linearGradient` in the SVG defs, the
    sheet's neo node-stroke rule is not `url(...)`, the computed node
    stroke is a solid color, the stamped attribute matches it, the
    dark-theme stroke luminance stays high (>0.5), and the sheet's neo
    node rule carries `filter: none` (no drop-shadow — the Windows
    "fuzzy borders" report, see the next invariant).
  - **Mermaid drop shadow is disabled (do not regress — the Windows "fuzzy
    borders" report).** Every Mermaid theme bakes
    `dropShadow = drop-shadow(1px 2px 2px rgba(185,185,185,1))` into the
    `[data-look="neo"]` node rules, so each box gets a light-grey halo. On
    the app's DARK background that halo reads as a fuzzy, blurred border
    around every box (and WebView2 rasterizes the blur noticeably); on a
    light background it is all but invisible, which is why Linux users
    never flagged it. `renderMermaidSvg`'s `mermaid.initialize` passes
    `themeVariables: { dropShadow: "none" }` (the same supported-knob
    mechanism as `useGradient` above), so the sheet emits `filter: none`
    and the stamped attributes carry `filter="none"` — the
    stylesheet-failure fallback stays in sync. Do not re-enable it without
    revisiting the Windows report.
  - **Mermaid font consistency (do not regress — Windows off-center labels).**
    Mermaid measures label text with the DIAGRAM config's fontFamily default
    (`flowchart`/`sequence`: `"trebuchet ms", verdana, arial, sans-serif`) but
    paints it with `themeVariables.fontFamily`, whose v12 default is a
    DIFFERENT stack (`"Recursive Variable", arial, sans-serif`; "Recursive
    Variable" ships inside mermaid but is not installed on the OS). On Windows
    both faces exist, so boxes get sized with Trebuchet MS metrics while the
    foreignObject/`<text>` labels paint in Arial — different glyph widths and
    ascent → text overflows or floats inside its box, horizontally OR
    vertically depending on the glyphs ("no pattern"). On Linux every face in
    both stacks is missing, so fontconfig resolves BOTH to one substitute and
    the bug is invisible here. The fix (in `renderMermaidSvg`, `src/mermaid.js`):
    `mermaid.initialize({ …, fontFamily: '"trebuchet ms", verdana, arial,
    sans-serif' })` pins the PAINTED sheet font to the same stack mermaid
    measures with — measure == paint on every platform. Do not change or remove
    that fontFamily override without revisiting this note.
  - **Mermaid oversized-foreignObject label centering (do not regress — the
    Windows label floating inside its box).** Even with the font pinned,
    Windows measures the SAME label taller than the painted single line
    (the modal dump showed every flowchart label rendered into a 120x56
    foreignObject whose div paints one ~24px line; on Linux the FO exactly
    fits the content: 24 / 48px). Mermaid centers the FO on the shape but the
    text sits at the TOP of the oversized FO → labels float high/off-center,
    varying per label. `centerForeignObjectLabels(holder)` (called from
    `installMermaidStyles`, after `stampSvgStyles`, and RE-RUN at the
    renderMermaidInNode / restoreMermaid insertion sites AFTER `holder` is
    attached — a detached holder's getBoundingClientRect are all 0, so the
    layout-dependent pass inside installMermaidStyles is a silent no-op;
    this was the "the fix did nothing on Windows" report) measures the
    INNER `<p>`
    line-box height — NOT the div's rect, which Chromium/WebView2 can stretch
    to the FO's full height while the text stays top-anchored — and when the
    painted height is < 75% of the FO's, flips the div to a centered flex
    column (inline styles, so it survives total stylesheet failure). The 25%
    threshold is a guaranteed no-op on Linux (single line 21-24 in 24, wrapped
    42 in 48 — max ~12% slack), so Linux rendering is pixel-identical.
    The SAME pass also re-anchors plain-text actor labels (sequence): mermaid
    places the <text> with x = box CENTER and relies on text-anchor:middle;
    when Windows loses that anchor (computed "start") the text paints
    rightward from the center by half its width — the guard pins
    text-anchor:middle inline only when the text's x coincides (±4px) with
    the sibling rect's center, so deliberately start-anchored labels (notes,
    whose x sits at the box LEFT edge) are never touched. The sibling shape
    may be a rect OR the bare lifeline <line> (Windows v12: actor-text
    groups have class=null and shape=line — 7d). The guard reads the
    PAINTED geometry, not attributes: the trigger is
    |labelPaintedCenter − nearestShapeCenter| ≈ halfTextWidth (±4px) — the
    start-anchor-from-center fingerprint — because the x attr is a LOCAL
    coordinate that transforms can move arbitrarily far from the painted
    position, and the group's first shape in document order need not be the
    label's box (Linux probe: text x=275, first rect bbox center 1090).
    The pin is applied at the
    innermost level — inline style + presentation attribute on the <text>
    AND every <tspan> — because a tspan's own declaration beats anything
    inherited from the <text>, and only the innermost declaration wins the
    paint where the cascade is unreliable.
    The SAME pass CENTER-SNAPS middle-anchored plain-text labels (WebKitGTK
    sequence-actor off-center): WebKit resolves mermaid's
    dominant-baseline:central ≈ half the font's ascent-descent differently
    from Chromium — the Playwright-WebKit probe painted every actor label
    dCy=-8.2px high and dCx=-1.2px left while Chromium painted ≈ 0 — so the
    pass measures the residual to the nearest shape (euclidean, so the tall
    zero-width lifeline never wins) and snaps with a ROUNDED CSS translate
    (integer px keeps glyphs crisp). Two bounds keep it a no-op where the
    paint already agrees: |Δ| ≥ 0.75px to act (subpixel noise) and
    |Δx| ≤ 8+w/2, |Δy| ≤ 8+h to skip deliberate far placements (cluster
      titles); texts with a transform attribute are skipped (a CSS transform
      would override it). Chromium is untouched (its deltas ≈ 0 — case 8d).
      The SAME pass NORMALIZES an oversized EDGE-label foreignObject back to
      its painted content (the Windows "big grey box around edge labels, e.g.
      Ctrl+S / Export" report): an edge label's `div.labelBkg` PAINTS a
      background (sheet `.labelBkg`/`.edgeLabel p` fill = edgeLabelBackground,
      also stamped inline) and the div FILLS its foreignObject (table-cell
      width resolves to the FO width), so on the oversized Windows
      measurement the flex-stretch above made the bg paint the WHOLE box — a
      grey rectangle occluding the edge line — while a tight (Linux) FO
      hugs the text. CRUCIALLY the oversize VARYS PER LABEL: the same
      diagram measured "Ctrl+S" hugely (the 25% height gate caught it) and
      "Export" only mildly (the gate missed it — "you fixed the top one but
      not the bottom one"). So the edge-label branch (a) flex-centers on
      ≥4px painted slack and (b) sets the FO's width/height ATTRIBUTES to
      the painted content size on ANY >2 attr px deviation on EITHER axis —
      growing as well as shrinking (a too-small FO clips) — and offsets x/y
      by HALF the delta (additive to any x/y mermaid itself set), keeping
      the FO centered on its edge point (mermaid centered the whole FO via
      the label group's transform). Scale-aware (painted rects are scaled
      by the SVG viewBox): attr targets = painted * (attrF/paintedF); the
      2px epsilon absorbs ceil() rounding (≤1px) and subpixel noise;
      guarded to sane line heights (`pH < 4` → skip). Scoped to edge labels
      only (`labelBkg` / `span.edgeLabel`) — a node label's div paints
      nothing, so touching those would be a pointless risk to the accepted
      Windows node look (node labels keep the original 25%-gate flex-only
      path). No-op wherever the measurement was already tight (the epsilon
      guards it), and idempotent (the second run measures δ≈0).
      `test/verifyMermaidStyle.mjs` cases 6a/6b + 7a/7b/7c/7d + 8a/8b/8c/8d +
      9a/9b/9c/9d/9e/9f/9g/9h (28 total) assert
      the real render is untouched, oversized synthetics get flexed, and
      centered-x texts get re-anchored while explicit-middle and left-edge
      start anchors are left alone; case 9 pins the edge-label FO
      normalization (real tight render untouched, shrunk-to-content +
      half-delta offsets, text stays painted at the label center,
      idempotent, non-edge labels never touched, MILD 20%-slack oversize
      normalized — the "Export" miss — and width-only oversize normalized
      with the tight height left alone).
 - **Textarea selection is translucent (do not regress — Windows blanking).**
   The visible editor text lives in the overlay; the textarea glyphs are
   `color:transparent`. `.input::selection` must be a TRANSLUCENT wash
   (`rgba(47,111,235,.28)`, dark: `rgba(75,139,255,.38)`), never the opaque
   `var(--sel)` — the opaque rect paints over the overlay text on WebView2 so
   selected text looks blanked out (WebKitGTK composites it underneath, hiding
   the bug on Linux).
 - **No console window on Windows release builds (do not regress).**
   `src-tauri/src/main.rs` carries
   `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` — without
   it the bundled exe spawns a console that must stay open (closing it kills the
    app). Debug builds keep the console for logs.
 - **Tab / Shift+Tab are captured at window level in CAPTURE phase (do not
    regress).** On WebKitGTK/WebView2 Shift+Tab bound on the textarea alone
    escaped the editor to browser focus traversal (another GUI control got
    focus), so the indent/outdent handler now runs on `window` in
    CAPTURE with `preventDefault()` + `stopPropagation()` (the textarea
    `keydown` handler in `onKeyDown` no longer handles Tab — that would
    double-indent). The capture handler stands down while a centered modal
    (`.savedlg-backdrop`) is open so the modal's own focus trap owns Tab.
    Two extra defenses the REAL GTK shell needs (Chromium does not reproduce
    the quirk): (a) `isEditorTabKey()` also accepts the legacy X keysym
    `ISO_Left_Tab` — some WebKitGTK builds report Shift+Tab under that name;
    (b) a blur-refocus fallback in `makeTab` — the capture handler stamps
    `doc.__sTabAt`, and if the engine performs the focus traversal DESPITE
    preventDefault, a `blur` listener fires within 250 ms and pulls focus (and
    the stored caret via `__sSel`) back into the textarea on the next
    macrotask, also standing down for modals. Do not remove either layer.
    (c) the REAL shell root cause, fixed on the RUST side: X maps Shift+Tab
    to the legacy keysym `GDK_KEY_ISO_Left_Tab` (0xFE20), which WebKitGTK
    forwards to the DOM as `KeyboardEvent.key = "Unidentified"` (NOT "Tab")
    — so NO JS handler can ever preventDefault it, GTK's window move-focus
    binding runs, and focus escapes to another GUI control (Chromium does
    not reproduce this; `npx tauri dev` in this tree did, verified with a
    GTK key-injection probe). `src-tauri/src/keymap.rs` connects a
    key-press handler ON THE RAW WEBKIT widget that copies the event, sets
    keyval `GDK_KEY_Tab` (state keeps SHIFT), delivers it directly to the
    webview, and STOPS propagation of the original — the DOM then sees a
    normal `Tab` keydown with shiftKey and everything above works. Keep
    `keymap::install()` wired in `main.rs` setup; do not delete it without
    re-testing shift+tab in the real GTK app. New direct Rust deps
    `gtk` 0.18 + `webkit2gtk` 2 (MIT bindings; lockfile-pinned versions so
    no duplicate crates compile — see src-tauri/Cargo.toml).
 - **Selections ending at COLUMN 0 of a line do not include that line (do not
    regress).** A WebKitGTK double-click on the last word of a line selects
    `word\n`, leaving selectionEnd at column 0 of the NEXT line; without the
    guard, Tab indented the next, unselected list item too. `selLineRange()`
    in `src/editing.js` applies the standard editor convention (fall back to
    the previous line's end) and is used by BOTH `indentLines` and
    `toggleBlock` — keep it in both.
  - **Ctrl+Arrow word moves are MARKDOWN-AWARE (do not regress).** The
    engines' native word segmentation is inconsistent AND marker-blind: from
    `A| **lightweight**` both stop between "lightweight" and the closing `**`,
    Chromium stops before a trailing sentence period (`live formatting|.`),
    and WebKitGTK skips standalone punctuation runs entirely (`editor| - write`
    → `editor - write|`). `onKeyDown` (src/markdown.js) intercepts Ctrl-only
    (+Shift for selection extend) ArrowLeft/Right and `wordJump`
    (src/format.js) owns EVERY move with a deterministic token
    model: a word is a whitespace-delimited run — trailing punctuation
    (`formatting.`) rides along, a standalone ` - ` is its own stop — and a
    formatted span (`**bold**`, `*it*`, `` `code` ``, `~~s~~`, `<u>u</u>`,
    `[link](url)`, `__b__`, `_i_`) is ATOMIC: markers included, and a
    multi-word span (`**two words**`) survives its internal space (the run
    grows across any span straddling its edge, to a closure). Right moves
    land at the word END, left moves at its START. At a LINE END the move
    crosses the newline and stops at the end of the NEXT line's first word
    (`step|\n- **Diagrams**` → `step\n-| **Diagrams**` — native skipped the
    `- ` marker and landed mid-span); from a line start it mirrors to the
    START of the previous line's last word; blank lines are skipped.
    `wordJump` returns null ONLY at the document edges (pos at/after the end
    moving right, at/before 0 moving left) — the native move is a no-op
    there. It binds Ctrl, NOT Cmd/Meta: on macOS
    Cmd+Left/Right is Home/End line navigation and must stay native.
    **Ctrl+Shift+Arrow selection gestures act on the CARET edge, not the
    left/right-most edge (do not regress).** The anchor/caret pair comes
    from `selectionDirection` ("forward" → anchor=selectionStart,
    "backward" → anchor=selectionEnd); `d.__selAnchor` + `d.__selStamp`
    cover engines that drop the setSelectionRange direction argument
    (reporting "none") — the stored gesture anchor is honored only while
    the live selection is EXACTLY the one the gesture last wrote. A forward
    selection SHRINKS from its right edge on Ctrl+Shift+Left, crossing the
    anchor flips the direction and grows the other way, and moving back to
    the anchor collapses to it (native shift+arrow semantics). A bare
    (no-Shift) move collapses to the caret edge, jumps, and ends the
    gesture. Chromium normalizes a "none" direction to forward — the
    direction-less fallback branch only fires on engines that genuinely
    report "none".
    `test/verifyCaret.mjs` cases 6-8 (71 total) pin all of this; the
    plain-word stops 3/7 in `foo bar **baz**` coincide with Chromium's
    native word ends and are load-bearing.


## Known limitations (browser fallback)

- In a plain browser (`vite preview` / `npm run dev`), Save uses a file download
  (WebKitGTK-style no-op aside) and there is no window-close interceptor (the
  `beforeunload` guard is the only guard). All the Tauri-native paths (real
  `save`/`open` dialogs, `onCloseRequested`) must be validated in the actual app —
  the Playwright tests exercise the shared code paths and assert the browser
  fallbacks, not the native ones.
