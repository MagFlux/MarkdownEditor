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
- **Commit messages, when a commit IS requested, follow the CONVENTIONAL
  COMMITS format (always).** First line = `<type>(optional scope):
  <description>` — lowercase type, lowercase imperative description, no
  trailing period, ≤ ~72 chars. Types: `feat` (new user-facing feature or a
  non-breaking behavior change), `fix` (bug fix), `docs` (documentation),
  `test` (tests only), `refactor` (no behavior change), `perf`, `build`,
  `ci`, `chore`, `style`, `revert`. A scope naming the touched area is
  encouraged when it narrows the message (`fix(editor):`, `fix(picker):`);
  a wide-reach change may omit it (`docs: …`). Breaking changes get `!`
  before the colon (`feat!:` / `fix!:`) — the semver mapping falls out of
  the type: `feat` → minor, `fix`/`chore`/`docs`/… → patch, `!` → major.
  The description casing is ALL LOWERCASE (a tag-like fragment — matching
  the Conventional Commits/commitlint defaults; git's kernel style
  capitalizes the first word, we deliberately do not, and NOBODY uses ALL
  UPPERCASE). Then a blank line, then the body is a bulleted list (`- `) of
  the changes made: one bullet per logical change, plain lowercase text —
  name the files/areas touched and the tests added or updated (incl. the
  AGENTS.md/README.md doc sync when it happened). This format applies only
  to commits the user explicitly asked for; it never licenses a commit
  (rule 1 above). Example:

  ```text
  fix(picker): pin the picker list to the top when entering a directory

  - src/picker.js: render() resets the list's scrollTop before the innerHTML
    swap (a folder entered after scrolling down opened MID-LIST)
  - test/verifyTauriClose.mjs: scenario I pins the reset; fails with the pin
    removed
  - AGENTS.md: picker scrollTop contract noted in the file table
  ```

## What this is

A single-window, multi-tab Markdown editor. Blank tabs are numbered `Untitled 1`,
`Untitled 2`, … within each application run; the counter resets on restart. Plain JS
(no framework), one DOM, one
source of truth (the textarea). A color/highlight overlay sits under the textarea;
the editor stays a `.md` file with no lock-in. Native shell is **Electron**
(`electron/main.cjs` + `electron/preload.cjs`; the frontend is served over the
privileged `app://` protocol in production and the vite dev server in dev), with a
browser fallback so the same code runs under `vite preview`.

> **Historical note**: the shell was originally Tauri (Rust + WebKitGTK on Linux).
> The Electron conversion kept the frontend untouched by moving the *wire
> contract* to Electron: the preload installs the same
> `window.__TAURI_INTERNALS__.invoke` surface the Playwright harnesses stub
> (`test/verifyTauriClose.mjs`), the `plugin:*` commands are answered by
> main-process IPC routers in `electron/main.cjs`, and `src/shellapi.js` vendors
> the wrapper semantics of the old `@tauri-apps/*` packages (which are no longer
> dependencies — only their command names and byte-level semantics survive).
> Mentions of "Tauri-shaped" contracts in this file describe that wire contract.

## Keep the docs current (mandatory for every change)

`AGENTS.md` and `README.md` are the source of truth for how to build, test, and run
this project. **After you make any change** — a new file, a renamed file, a new/changed
script in `package.json`, a new/changed IPC command or permission in
`electron/main.cjs` / `electron-builder.yml`, an invariant, a keybind, a limitation, or a
behavior the user sees — **update both `AGENTS.md` and `README.md` in the same
change** so they stay accurate. Do not leave a doc describing the state before your
edit. If a change doesn't affect the documented surface, a quick check that neither
file is now stale is still required before you're done.

**Division of labor between the two docs (keep it that way).** `README.md` is the
**condensed, readable overview** — what the app does, how to build/run/test it at a
glance, and a one-line-per-guard test table. `AGENTS.md` (this file) is where **all
the details live** — every invariant's full rationale, the debugging history behind
each regression guard, per-file contracts, and the exact behavioral contracts. When
documenting a change: the exhaustive WHY/history goes in `AGENTS.md`, and
`README.md` gets at most a one-line summary that points here. Never grow
`README.md` back into a second exhaustive reference — it was deliberately condensed
(and gets re-condensed) so it stays readable; detail belongs in this file.

**`LICENSE.md` and `NOTICE.md` must also stay current** (this is a mandatory todo for
every change, not optional). Whenever a dependency is **added, removed, or changes
version or license** — a new `dependencies`/`devDependencies`/`peerDependencies` entry,
or an upgrade that swaps one license for
another — **update `NOTICE.md` in the same change** (add/remove/re-license the line,
keep it in the right bucket: MIT, MIT/Apache dual, Apache-2.0-only, other copyleft,
or runtime-only), and
confirm `LICENSE.md` still correctly describes the project. Never let `NOTICE.md`
describe the
*pre*-change dependency set.

## Licensing (mandatory for every dependency change)

This project is **AGPL-3.0-licensed** (see `LICENSE.md`). We chose
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
  as a user-approved, user-reviewed exception, see `NOTICE.md`.) Re-review before adding
  any new non-permissive one.
- **Source-available / non-free** — `SSPL`, `BUSL`/`BSL`, Elastic, Commons Clause, or any
  *non-OSI* "free" license, or any copyleft whose own text is a **further restriction**
  AGPL §7/§10 treats as incompatible — **STOP and notify the user before using it. Do
  not add it, do not import it, do not commit it.** Explain the specific license and why
  it is not compatible with an AGPL-3.0 bundle, and offer one or more permissive (or
  AGPL-compatible copyleft) alternatives that do the same job. Proceed only after the
  user explicitly approves the exception (and then log it in `NOTICE.md` in its own
  "non-permissive (user-approved exception)" bucket).

**Before you install or import any new library** — any `npm install <pkg>` or a new
`dependencies`/`devDependencies`/`peerDependencies` entry — **check its license
first, before you use it:**
- JS: `npm info <pkg> license` (or read `node_modules/<pkg>/package.json` → `license`),
  and also scan *nested* dependencies for anything non-permissive that ships inside.

> Two distinctions that still matter:
> - **A shared *system* runtime we merely link to** (e.g. the OS GTK/KDE/X11
>   libraries the packaged Electron uses on Linux) is allowed by AGPL-3.0 because
>   it's a System Library we do **not** bundle — the app is "the work" and the
>   runtime merely hosts it. (Electron itself — Chromium/Node — IS bundled, so it
>   must be permissive or AGPL-compatible; it is MIT. Debian-the-.deb additionally
>   pulls standard system libs as dependencies; that is package management, not
>   redistribution of a copyleft work of ours.)
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
npm run verify-save    # save / close-guard UI test (26 cases) — includes the first-run
                       # document and a freshly opened file both starting with the CARET
                       # at offset 0 (openAtTop runs after activate; see the caret convention)
npm run verify-toolbar # toolbar active-states track the caret (56 cases) — bold/underline/
                       # code/H2/link/inline-math/italic/strike with and without trailing punctuation,
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
npm run verify-math    # Math (KaTeX): live preview renders $$ block + $ inline math
                        # (synchronous, no flicker); code regions and prose dollars
                        # ("$5 and $10") stay literal; blank $$ scaffold shows markers;
                        # invalid LaTeX paints red; HTML export embeds the SELF-CONTAINED
                        # katex stylesheet (fonts as data: URIs) only when math is present;
                        # PDF export rasterizes math without errors (21 cases).
npm run verify-scroll  # Split-view scroll-sync regression: a genuine user scroll on the
                        # FOLLOW pane (while its ECHO_MS deadline is still live) is accepted
                        # as a fresh lead immediately — the old time-only window swallowed it
                         # for ~800 ms ("the left side lags / catches up"); value-based echo
                         # matching fixes this; the follow assertions now check CONTENT-matched
                         # block parity (the block-anchored sync replaced ratio mapping) (5 cases).
npm run verify-scrollsync # Block-anchored split-view scroll sync: the anchor map builds for a
                          # feature-dense doc (lists per item, tables per row, code/mermaid/KaTeX
                          # fences, blockquote) with monotone curve + pair tops; editor-lead puts
                          # a deep heading's SOURCE line at the preview's top edge (after
                          # mermaid+KaTeX, where ratio mapping was ~2 sections off); preview-lead
                          # lands the editor exactly on the mermaid fence line; wrap-heavy
                          # long-paragraph docs stay block-aligned at 15%/50%/85%; a count-desync
                          # (raw HTML block) degrades to the ratio fallback which still drives the
                          # follower; at the ends the anchored curve + clamp CONVERGE (no snap,
                          # no blend — both overshot and cut the table's top; the exhausted
                          # follower parks at its own end); the follower GLIDES every delta
                          # above ~10px (the elastic follow: a ~100px wheel notch pans over
                          # ~200ms at τ=80, tiny sub-line adjustments stay instant), and the
                          # END-REGION re-correction (preview wheeled into its tail pad while
                          # the editor sat exhausted, then one editor notch) lands as a slow
                          # pan (τ=150) instead of the jump, and the follower is bit-still
                          # after the glide lands (the float-position stall fix; 17 cases).
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
 npm run verify-tabclick # Tab-click behavior: clicking an ALREADY-ACTIVE tab is a no-op — it must not
                         # move the scroll (the old activate did input.focus()+refresh, which refocused
                         # the textarea and scrolled it into view — both panes jumped 90%→~25%)
                         # and must not rewrite the preview DOM (old refresh→syncDom re-ran
                         # marked + the mermaid render); activate() short-circuits when
                         # doc === activeTab. ALSO pins the WHOLE-TAB click target: activation
                         # binds to the entire .tab element (padding included — the old
                         # .tname-only binding left the tab's padding dead while the cursor
                         # still pointed), the × close button still wins via its own
                         # stopPropagation, and the redundant-click no-op holds for a padding
                         # click too (10 cases).
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
   npm run verify-dialogscroll # Open/Save/Export dialog scroll preservation: opening the in-app
                            # file picker (Save/Open toolbar buttons, Ctrl+S/Ctrl+O, Export… items)
                            # must NEVER move the open document's vertical position — neither
                            # pane, while the dialog is up nor after it closes. The toolbar
                            # buttons' trailing focus() used to run causatively AFTER the
                            # picker mounted (the button press had already blurred the
                            # textarea), so the engine's caret-into-view scroll parked the
                            # pane at the caret — the document bottom for a caret at the end
                            # ("when the open/save dialog opens the current file scrolls to
                            # the bottom"). The trailing focus now stands down under a
                            # .savedlg-backdrop and is scroll-held (focusKeepScroll,
                            # preventScroll) for save/open; every in-app picker runs through
                            # pickPathKeepScroll (capture pane ratios before the modal
                            # exists, re-assert them echo-stamped after it closes, hand
                            # typing focus back preventScroll on a cancel — the close
                            # flicker was the reveal scroll racing the rAF restore).
                            # Native path with a self-contained __TAURI_INTERNALS__ stub
                            # (31 cases: real-mouse clicks on both buttons, caret-at-end 5%
                            # and caret-above-viewport 50%, Ctrl+S/Ctrl+O, cancel returns
                            # focus+position, open-confirm new tab + old-tab position +
                            # the new file's caret at the beginning, Save-As fresh +
                            # overwrite flows, Export… picker, and a format-button
                            # control that keeps its causative focus).
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
    # the theme (the Windows WebView2 black-node regression, simulated) (38 cases,
    # incl. the font-consistency check: the sheet paints the SAME fontFamily stack
    # mermaid measures with — the Windows label-centering fix; oversized-FO
    # labels get flex-recentered; oversized EDGE-label FOs (labelBkg, the
    # Windows "grey box around Ctrl+S / Export" report) are normalized to the
    # painted content on ANY >2px deviation (the oversize VARYS per label, so
    # the old 25% gate fixed "Ctrl+S" but missed a mildly-oversized "Export");
    # multi-line <br/> labels (sequence notes) are NEVER center-snapped — the
    # "note text jumbled" report, case 11;
    # the sequence diagram's MARKUP drop-shadow filter attrs are stripped
    # (feDropShadow bypasses the dropShadow themeVariable — the "hard shadow
    # under every sequence shape" report, both platforms)).
    npm run verify-mermaidfade # Mermaid dark-theme gradient-outline fade: flowchart node
    # outlines must be a SOLID color, never the left-to-right url(#id-gradient)
    # stroke Mermaid's neo look paints when the dark theme sets useGradient=true
    # (start #ccc → stop dark grey — the right half of every box outline faded
    # into the background). mermaid.initialize now passes
    # themeVariables:{useGradient:false,dropShadow:"none"}; checked in BOTH
    # themes (21 cases: solid stroke + no drop-shadow filter — the Windows
    # "fuzzy borders" report — plus the THEME PREWARM: both palettes are
    # cached before the first toggle, which then restores synchronously with
    # no raw fence and no async reflow, and an edit in one theme re-warms the
    # changed source in the other).
   npm run verify-tauri   # SHELL-IPC native path (script name kept from the Tauri era):
                         # stubs __TAURI_INTERNALS__ and drives the real wire contract the
                         # Electron preload implements — the same install the app ships
                         # (55 cases) — overwrite-confirmation→write, overwrite-cancel→stays,
                        # picker-cancel→stays, save-discard-cancel→stays,
                        # known-path→direct write, open→picker→new tab, open-cancel,
                        # navigate-into-forbidden-dir→crumb stays on last readable,
                        # Home button always present in the picker pathbar and jumps
                        # back to the home dir even after navigating deep, and the
                        # a caret ENTERS a hidden (dot) folder (read_dir on the dot-path) —
                        # the UI-level guard that nothing filters dot-entries (invariant 7) —
                        # and scenario I: EVERY directory entry (folder click, Up,
                        # Home, crumb click) pins the picker list's scrollTop back to 0 —
                        # the <ul> is long-lived, so a stale offset survived the
                        # innerHTML swap and a folder entered after scrolling down
                        # opened MID-LIST (render() now resets before the swap);
                        # verified to FAIL with the pin removed.
                        # Needs the built dist.
npm run verify-caret    # Caret placement after editor actions (92 cases): Enter
                        # auto-continuation keeps the parent item's indentation with a
                        # collapsed caret after the marker (ordered/empty-exit too);
                        # Tab indent (incl. BLANK lines) / Shift+Tab outdent commit a
                        # collapsed caret whose column follows the text (no highlight);
                        # inline formats (mid-word, selection, toggle-off, gap-insert)
                        # collapse at the end of the inner span BEFORE the closing
                        # marker; code-fence AND ```mermaid fence wraps put the caret
                        # inside the fence ("```\n|\n```" / "```mermaid\n|\n```" empty,
                        # after content otherwise); math-block insert lands the caret
                        # ON the blank middle line of "$$\n\n$$" (empty caret line
                        # replaced in place, non-empty line keeps its prose with the
                        # block below — the table branch's contract); INSERT-ONLY pins:
                        # a table/math click inside an existing table/math block
                        # inserts a second scaffold and keeps
                        # the caret line's prose (nothing is ever removed), a fence
                        # click on a fence line re-wraps; table insert
                        # lands the caret in the first body cell; h1 caret at block end;
                        # Markdown-aware Ctrl+Arrow word moves: whitespace-run words
                        # (trailing punctuation rides along, standalone ` - ` is its
                        # own stop), formatted spans atomic, line-crossing stops at
                        # the next line's first word, document edges stay native;
                        # Ctrl+Shift+Arrow selection gestures act on the CARET edge
                        # (shrink/flip like native shift+arrows).
npm run verify-find     # Find & Replace bar (48 cases): Ctrl+F/H open with focus
                        # (find / replace field), Esc closes and refocuses the editor with a COLLAPSED caret (it clears any selected text: a match close parks the caret just after the hit — stay put, nothing selected; a 0-match close collapses the pre-open selection to its start),
                        # preview-only mode DISABLES the feature entirely: Ctrl+F/H are
                        # swallowed (no app bar, no native find), an open bar closes
                        # when preview is entered WITHOUT focusing the hidden textarea,
                        # and find works again after returning to split/edit,
                        # live `i/n` count; every user-driven query change (edit, Aa/.*, open)
                        # immediately SELECTS the current match (editor typing keeps the
                        # count live without yanking the selection), Enter/F3 next · Shift+Enter/Shift+F3 prev with
                        # WRAP-AROUND, Aa case toggle, `.*` regex toggle (invalid
                        # regex = inline red "bad pattern", never a modal), Replace
                        # = select-then-replace with ONE undo step + advance,
                        # Replace-all = ONE undo step for the whole batch, regex
                        # `$1…$9` substitutions, literal-mode special chars, selection
                        # prefill (single-line), recompute across tab switches.
npm run verify-tasks    # GFM task lists (12 cases): `- [ ]`/`- [x]`/`1. [ ]`/quoted
                        # items render as LIVE checkboxes in the preview; a click
                        # flips the state char in the SOURCE and commits ONE
                        # undo-able edit (Ctrl+Z reverts, Ctrl+Shift+Z re-applies,
                        # the re-render rebuilds the checkbox from source); a
                        # `[ ]` inside a fenced code block is NOT re-enabled
                        # (code is sacred); the editor overlay paints the marker
                        # with a `.task` span.
npm run verify-recent   # Recent files menu (12 cases): native open (openFile w/
                        # path) and native save record entries; dedupe moves the
                        # most-recent to the top; submenu shows the last 5; clicking an
                        # entry opens the file in a NEW tab (invariant 6) and
                        # reads it through the fs stub; a STALE entry (unreadable)
                        # shows the in-app "Open failed" modal AND is dropped;
                        # entries persist across a reload (localStorage
                        # "me.recentPaths"); the browser fallback hides the section.
npm run verify-codecolor # Fenced-code highlighting (7 cases): a registered-language
                        # fence renders with hljs-* token spans in the preview and
                        # PAINTS the light-palette color; unknown-language fences
                        # keep marked's plain escaped shape; the mermaid fence is
                        # never highlighted (mermaid.js replaces it); highlighted
                        # output stays HTML-escaped (no injection); the editor
                        # overlay never contains hljs markup (round-trip stays
                        # render.js's domain).

# Electron shell (Chromium bundled; no Rust/toolchain — Node is enough)
npm run electron:dev   # dev window: vite dev server + Electron loading http://127.0.0.1:5173 (prefers X11 — paints immediately on WSLg)
npm run electron:start # build dist/ then run the app (app:// protocol)
npm run electron:build # build dist/ + electron-builder for THIS platform's targets
```

After any edit to `src/`, **run `npm run build`** and confirm the production bundle
still emits a single `dist/assets/index-*.js` (no code-split chunks) —
see the invariant below.

**Run the tests your change can actually affect (targeted testing), not the whole
suite by default.** The suite is long; a full local run on every edit is slow and
the CI pipeline (below) already runs the ENTIRE suite on every PR and release, so
nothing escapes validation. Locally: re-run `npm test` (instant, Node) plus the
specific `verify-*` suite(s) whose contracts your edit touches — a picker/dialog
change runs `verify-save` + `verify-dialogscroll`, a scroll/focus change runs the
scroll-sync/mode/tab suites, an export change runs `verify-export`, and so on.
Run the FULL suite locally only for a release-grade milestone (e.g. before a
release tag or a broad refactor). The complete roster, cheap → expensive
(`verify`, `verify-undo`, `verify-save`, `verify-toolbar`, `verify-paste`,
`verify-export`, `verify-math`, `verify-scroll`, `verify-dialogscroll`,
`verify-scrollsync`, `verify-modescroll`, `verify-modefocus`, `verify-tabclick`,
`verify-tabscroll`, `verify-themescroll`, `verify-mermaidflicker`,
`verify-mermaidstyle`, `verify-mermaidfade`, `verify-tauri`, `verify-caret`,
`verify-find`, `verify-tasks`, `verify-recent`, `verify-codecolor`, and
`npm test`) — all must be green in CI.
For shell-IPC changes (src/shellapi.js, electron/preload.cjs, electron/main.cjs)
also run `npm run verify-tauri` (targeted, since it needs the built dist) — plus a
real-shell smoke check (`npm run electron:start` under a display / xvfb) when the
main-process side changed.

## CI/CD (GitHub Actions)

The pipeline lives in `.github/workflows/ci.yml`. Two jobs.

**Triggers** (deliberately *not* on every push, to save runner compute):
- `pull_request` — `opened | synchronize | reopened | ready_for_review`
- `release` — `created`

**Jobs**:

 0. **`validate-tag`** (ubuntu-latest) — fail-fast gate on `release.created`: the tag must match `^v\d+\.\d+\.\d+(-\d+)?$` with numeric prerelease `<= 65535` (MSI/WiX rejects text like `-rc.1`). Rejects bad tags in seconds before `test`/`build` burn runner time. No-op on PRs (but `test` still `needs` it, so it runs as a fast skip there).

 1. **`test`** (ubuntu-latest) — the full Node/Playwright verification suite,
      cheap → expensive: `npm test` → `verify` → `verify-undo` → `verify-save` →
       `verify-toolbar` → `verify-paste` → `verify-export` → `verify-math` →
       `verify-scroll` → `verify-dialogscroll` → `verify-scrollsync` →
       `verify-modescroll` → `verify-modefocus` → `verify-tabclick` →
       `verify-tabscroll` → `verify-themescroll` → `verify-mermaidflicker` →
       `verify-mermaidstyle` → `verify-mermaidfade` → `verify-caret` →
       `verify-find` → `verify-tasks` → `verify-recent` → `verify-codecolor` →
       `verify-tauri`. No Electron binary needed (the suites drive the bundle and
       stub the shell bridge), so the job sets `ELECTRON_SKIP_BINARY_DOWNLOAD=1`
       during `npm ci` to skip that download.
    Runs on PR and on release. This is the safety net for local development:
    agents are expected to run only the TARGETED suites for their change locally
    (see the "Run the tests your change can actually affect" note above); the
    full roster runs here on every PR.

2. **`build`** (3-OS matrix) — the expensive one: `npm ci` (Electron included),
   injects the tag version into `package.json`, then runs
   `npm run electron:build` — the SAME script a local release build uses
   (`vite build` → `electron-builder --publish never`), so the frontend bundle
   is built FIRST. NEVER swap that out for a bare `npx electron-builder`:
   `dist/` is gitignored, a fresh checkout has none, and electron-builder packs
   whatever `files` matches without building anything — v1.0.0 shipped exactly
   that way (an asar holding only `electron/*.cjs`; every installer and
   portable of every OS booted to "The built frontend (dist/index.html) was
   not found."), which is why the `beforePack` hook
   (scripts/before-pack.cjs) now hard-fails such a package. Every installer
   and portable comes
   straight out of electron-builder's `release/` output dir (targets configured in
   `electron-builder.yml`, no separate re-packaging step — the old Tauri pipeline's
   dmg-mounting/tar/zip hops are gone) — and uploads it to the same release via
   `gh release upload`:
   - `windows-latest`: NSIS `markdown-editor-<v>-x64-setup.exe`, WiX MSI `markdown-editor-<v>-x64.msi` (a stable `upgradeCode` in the config so upgrades replace the old install) + portable `markdown-editor-<v>-windows-x64-portable.exe` (electron-builder's portable target). electron-builder downloads NSIS/WiX itself — no choco step.
   - `macos-14` (Apple Silicon): `markdown-editor-<v>-macos-arm64.dmg` + `markdown-editor-<v>-macos-arm64-portable.zip` (the `zip` target = the portable `.app`)
   - `ubuntu-22.04`: `markdown-editor-<v>-x86_64.AppImage`, `markdown-editor-<v>-amd64.deb` (+ a generated `markdown-editor.desktop` with `StartupWMClass=markdown-editor`, maintained via `desktopName` + `linux.syncDesktopName`) + `markdown-editor-<v>-linux-x86_64-portable.tar.gz` (the `linux-unpacked` dir — needs the standard desktop libs like every unpacked Electron; the AppImage/deb ship the full runtime). NO apt package installs — Electron bundles Chromium/Node; only the usual shared desktop libs matter at runtime.

   The blockmap sidecars (`*.blockmap`) and `builder-effective-config.yaml` are
   intentionally NOT uploaded (updater internals/config dump).

   Gated on `validate-tag` + `test` passing **and** `github.event_name == 'release'` (so it
   never runs on PRs or plain pushes). Installers + portables attach to the exact
   release tag that was just created. The tag (`vX.Y.Z`) is the version: the
   build job strips the `v` and injects it into `package.json` (`0.0.0`
   placeholder in the repo) before electron-builder runs, so the bundled
   app/installers carry the tag. Never bump a version file by hand — just cut
   the release.

### electron-builder specifics (what actually works)

| Key | Value | Why |
|---|---|---|
| `files` | `dist/**/*`, `electron/**/*`, `!node_modules/**` | Only the built bundle + the shell scripts get packed. The editor's runtime libs (marked/katex/mermaid/…) live in **devDependencies** — they are inlined into the single Vite bundle, so there is nothing to ship from `node_modules` (verified: the packed `app.asar` contains zero `node_modules` entries and yet is fully self-contained). |
| `electronDist` | `node_modules/electron/dist` | electron-builder reuses the Electron already installed by `npm ci` instead of re-downloading its own copy (saves ~150 MB per CI run). npm's Electron postinstall must have run (it is skipped when `ELECTRON_SKIP_BINARY_DOWNLOAD=1` — the test job sets that; the build job must NOT). |
| `npmRebuild` | `false` | No native modules — skip the rebuild pass entirely. Careful: `beforeBuild` hooks are ONLY consulted inside that pass (`installAppDependencies` returns early), so a `beforeBuild:` entry never runs under this setting — that is why the pack-time work lives in `beforePack` (see the next row). |
| `beforePack` | `./scripts/before-pack.cjs` | The pack-time hook, emitted by every platform pack BEFORE the app-file walk: it (a) hard-fails the packaging when `dist/index.html` or the `dist/assets/index-*.js` entry chunk is missing — the v1.0.0 class where a bare electron-builder call shipped an asar with no frontend and every user saw "The built frontend (dist/index.html) was not found." — and (b) compiles `electron/xwheel-daemon` before the file walk so `asarUnpack` really lifts the ELF out (the old `beforeBuild:` hook never ran, so CI's Linux artifacts had no daemon at all). |
| `executableName` | `markdown-editor` | The raw binary name inside AppImage/deb/tar.gz and the Windows exe (the old Tauri binary name, kept for release-artifact parity). |
| `desktopName` + `linux.syncDesktopName` | `markdown-editor.desktop` / `true` | Syncs the generated `.desktop`'s `StartupWMClass` with Electron's app_id so GNOME/KDE taskbars associate the running window (electron-builder warns loudly without it; the old Tauri shell had the same via `StartupWMClass={{exec}}`). |
| artifact names | per-target in the yml | lowercase kebab names (`markdown-editor-<v>-<platform>-…`); `${arch}` is electron-builder's (`x64` win, `arm64` mac, `x86_64` linux AppImage; the deb uses `amd64` by hand). |

### Optional signing secrets (not set)

Without these the build produces **unsigned** installers:
- macOS Developer ID / notary (mac `identity` is forced to `null` in the config; remove that + set the secrets to sign)
- `CSC_LINK`, `CSC_KEY_PASSWORD` — Windows code-signing cert

Set them in **Settings → Secrets and variables → Actions** (repo level) or
**Organization → Secrets** (org level). They are available to the `build` job only.

## Files that matter

| Path | Role |
|---|---|
| `src/markdown.js` | The app: `createApp()` — tabs, undo/redo, keybinds, save/open, DnD, window-close guard, modals, toolbar actions, session persistence, plus the **scroll-holding dialog helpers** (`capturePaneScroll` / `restorePaneScroll` / `focusKeepScroll` / `pickPathKeepScroll` — every in-app picker runs through the wrapper so open/save/export never move the document, and the save/open trailing toolbar focus is preventScroll + backdrop-gated; see the invariant "Opening the Save/Open/Export picker…") and the **menu structure**: a "Recent files…" toggle (hover sub-menu — `setSubmenuOpen`/`closeSubmenus`, a 250ms close grace period so the diagonal move toggle→submenu doesn't kill it, radio behavior between the two submenus, entries rebuilt on every open; shows the last `RECENT_MAX` = 5 files from localStorage `me.recentPaths`, or a disabled "(No recent files)" placeholder; record on native open/save, `openRecent` → new tab, stale entries dropped after the in-app "Open failed" modal) and an "Export…" toggle whose submenu holds the existing PDF/HTML items — there is deliberately NO Find menu item (Ctrl+F/Ctrl+H are the find entry points). Keeps the STATIC shell imports (via `src/shellapi.js`) and wires the extracted export handlers; it re-exports the pure-helper modules below so its public shape is unchanged (`test/test.mjs` imports `highlightToHtml` from here); the DnD drop handler resolves a dropped File's disk path through `shellapi.pathForFile` (Electron removed `File.path`; see shellapi.js). |
| `src/shellapi.js` | The shell-IPC layer (Electron; vendored replacement for the old `@tauri-apps/*` wrappers). Implements the EXACT wire contract the Playwright harnesses stub: `invoke` over `window.__TAURI_INTERNALS__` + the `plugin:fs|*` (read_text_file → BYTES; write_text_file/write_file with the destination path URL-encoded in `options.headers.path`; read_dir; exists), `plugin:path|resolve_directory` (homeDir, ordinal 21), `plugin:opener|open_url/open_path`, `plugin:event|listen/unlisten`, and the `getCurrentWindow()` facade with the `onCloseRequested` wrapper contract (`await handler(evt); if (!evt.isPreventDefault()) await this.destroy()`) + `pathForFile` (drag-drop File→path via the preload's `webUtils.getPathForFile`). Node-importable (no top-level `window` access); static import (invariants 2 & 8). |
| `electron/main.cjs` | The Electron main process (the desktop shell): BrowserWindow (1200×780, min 720×400 — the old tauri.conf.json values; no menu on Windows/Linux, standard app/edit menus on macOS), the privileged **`app://` protocol** that serves `dist/` with correct MIME + CSP (file:// would CORS-break the ES-module bundle), the `shell:invoke` IPC router answering every `plugin:*` command (fs read/write/list/exists, home dir, opener, window destroy/close, event listen/unlisten registry), the window-close intercept (block OS close → deliver `tauri://close-requested` to the renderer when a listener is registered; close directly when the app hasn't registered yet), `plugin:window|destroy` = **force close** (`win.destroy()` — skips beforeunload, exactly the old shell's destroy semantics; the walk has already saved the session via `closeApp()`'s own `saveSession()`), navigation hardening (will-navigate/setWindowOpenHandler → external URLs go to `shell.openExternal`), and the error-return protocol (`{ok, data}` / `{ok:false, shellError}`) that keeps picker error messages verbatim. Also decides the ozone platform in-main: **native Wayland whenever `WAYLAND_DISPLAY` exists** (mirrors WebKitGTK/GTK3, which ran native Wayland here) — NOT `hint=auto`, whose XDG_SESSION_TYPE-based auto-pick silently resolves to X11/XWayland on WSLg (empty session type); **development runs (`VITE_DEV_SERVER_URL` set) prefer X11** — vite/HMR behave identically over XWayland and it avoids the doomed WSLg wayland paint AND its relaunch handoff (see electron-dev.cjs); an explicit `--ozone-platform=wayland` still wins. Argv-only escape hatches: `--md-x11` or `--ozone-platform=x11` (Electron **scrubs** env vars during startup — verified via `/proc/<pid>/environ` — so env-based overrides are dead; argv survives). On THIS WSLg host native Wayland **cannot paint a first frame at all** (verified with AND without the GPU process: `ready-to-show` never fires, a force-shown window stays dead) — so `createWindow` force-shows after 2.5 s ("ready-to-show did not arrive") and relaunches once with `--md-x11` after 8 s if no first frame arrived; the window can never end up invisible forever. Also pins **Electron ^40 (Chromium 144.0.7559)** deliberately: Chromium 146 introduced the X11 XI2 smooth-scroll valuator re-baselining regression (upstream 496255940, In Progress; `GetMouseWheelOffsetFromXEvent` returns 0 for button-4/5 devices that carry a scroll class), killing real hardware wheels under X11/XWayland — the only workable display path on this host. See the main.cjs comment before ANY Electron version bump; re-test real wheels on WSLg with a valuator-class mouse when the pin moves — the pin alone did NOT cure this host's dead notches (they persisted on Chromium 144); the in-X11 rescue below is what did. **Wheel-rescue wiring** (the WSLg wheel saga's shell half): on the X11 route with `DISPLAY` set, `startWheelDaemon` spawns `electron/xwheel-daemon` with the window id from `getNativeWindowHandle()` (LE-uint32; it is Electron's CONTENT child X window), maps each `btn=…` stdout line into a synthetic `webContents.sendInputEvent` wheel **with deltaY INVERTED vs the DOM** (verified live: inputData +100 arrives at the page as −100; a down-notch sends −100 so the page sees +100), dedupes same-button reports within 12 ms, marks the page `window.__MD_RESCUE = 1` (the gate `src/wheeloverride.js` keys on — set on the child's `spawn` EVENT, never up-front: a bad path surfaces only asynchronously, and a prematurely-set flag would leave the pair suppression half-armed with no synthetic wheels to pair with, so real notches arriving with the synthetic signature (deltaMode 0, |deltaY| 100) could be swallowed as phantom pair-halves; re-set on `did-finish-load`), and respawns the daemon up to 3× with a 1.5 s backoff if it dies (observed once: Xlib's default error-exit on a BadWindow race — the daemon now sets `XSetErrorHandler` to ignore). Non-X11 launches (no `DISPLAY`, Wayland route, other OSes) spawn nothing and go stock. Accepted residual: roughly one notch in ten never reaches the X server's event stream at all (upstream of the app — WSLg forwarding or a mouse detent skip) and cannot be synthesized. Also runs **software compositing by default** (`app.disableHardwareAcceleration()`, opt back in with `MD_ELECTRON_GPU=1`; plus `--disable-gpu` under Wayland-without-`/dev/dri`) on this WSLg host: the GPU path stalls scroll-animation creation so wheel deltas die before the renderer, while software rendering scrolls from notch 1 everywhere. Debug aid: `ELECTRON_TRACE=1` journals the whole close chain AND the wheel-rescue traffic to stderr. |
| `electron/preload.cjs` | The renderer bridge: installs the `window.__TAURI_INTERNALS__`-shaped shell global (`invoke`, `transformCallback`/callback registry, `metadata.currentWindow.label`, event dispatcher for main-delivered `shell:event` messages, `__TAURI_EVENT_PLUGIN_INTERNALS__`) and the `__shellGetPathForFile` helper (`webUtils.getPathForFile` — Electron removed `File.path`). Listens are intercepted renderer-side to key callbacks by event name, mirroring the test stubs (which ignore target kinds). Runs with `contextIsolation: false` + `nodeIntegration: false` + `sandbox: false` so bridge callbacks live in the page's realm (no bridge serialization of Uint8Array payloads); the page itself still gets no Node. |
| `electron/xwheel-daemon.c` | **The X11 wheel-rescue daemon** (the WSLg wheel saga's capture half — page half in `src/wheeloverride.js`): subscribes to **XI2 raw button events** (`XI_RawButtonPress`, `XIAllMasterDevices`, selected on the X root) — NOT X Record — because Record watches *core* event deliveries and Chromium selects XI2 events only, so no core delivery ever occurs over its windows and Record stayed blind while the clicks were right there (verified: Record captured XTest clicks over core-selecting probe windows but ZERO over the app). Raw events are broadcast to every subscriber independent of window event selection, so every notch is visible. Output: `btn=<4|5> inside=<0|1> x=<rx> y=<ry> t=<servertime> dev=<id>`; gating resolves the pointer's **deepest** window (descending XQueryPointer — a root query returns only the top-level shell) then walks `XQueryTree` ancestry against the Electron window id passed as argv (Electron's handle is its content child window — exact-id matching would miss). `XSetErrorHandler` swallows transient X errors (a BadWindow race in the tree walk once killed the process silently — seen as a mid-session capture death, now also covered by the shell's respawn). Compiled by `scripts/before-pack.cjs` (gcc, Linux only), packed via `asarUnpack` (ELFs don't run from asar; the shell's `resolveDaemonPath` remaps `app.asar → app.asar.unpacked` UNCONDITIONALLY when packaged — an asarUnpack'd file is STILL visible through the asar fs shim, so the old existsSync-based "still inside the asar?" test never fired and spawn() died with `ENOTDIR`: the rescue was silently off in every packaged build that DID include the daemon, and absent in the CI ones). Absent the binary: rescue off, the app is unchanged. |
| `electron-builder.yml` | Packaging config: `appId` com.mssok.markdowneditor, `productName` "Markdown Editor", `executableName` markdown-editor, `electronDist: node_modules/electron/dist`, `npmRebuild: false`, `files` (dist + electron only), `beforePack` (./scripts/before-pack.cjs — the pack-time dist guard + wheel-daemon compile; NOT `beforeBuild`, which only runs inside the npmRebuild pass that `npmRebuild: false` skips), `asarUnpack` (the daemon ELF must exist outside the asar to spawn), output `release/`, and the per-OS targets (win nsis/msi/portable with stable MSI `upgradeCode`; mac dmg/zip + `identity: null` under no signing secrets; linux appimage/deb/tar.gz, `desktopName` + `syncDesktopName`). |
| `src/export.js` | Static PDF/HTML export pipeline: standalone HTML rendering, Mermaid capture, A4 PDF pagination, browser downloads, and native writes through callbacks supplied by `createApp()`. Markdown→HTML goes through `renderMarkdown()` (math.js) so exported documents are typeset AND code-highlighted; the HTML export embeds the self-contained KaTeX stylesheet (fonts as data: URIs) ONLY when `containsMath()` says the document has math. Owns `EXPORT_PREVIEW_CSS` (exported for the Node test chain) — a fixed LIGHT palette that includes the `.hljs-*` token rules so exported HTML keeps code colors. |
| `src/session.js` | Versioned localStorage session persistence and debounced saves, using callbacks for the active tab and serializable tab records. |
| `src/dialogs.js` | Centered in-app modal primitives, unsaved-changes prompts, and overwrite confirmation, with native filesystem checks supplied by callbacks. |
| `src/picker.js` | In-app Save/Open filesystem picker: directory navigation, breadcrumbs, Home/Up controls, extension filtering, selection, and injected filesystem/modal callbacks. Detects the platform path separator from the initial cwd (`\` on Windows, `/` elsewhere) and uses it consistently for all path joining, crumb reconstruction, and go-up navigation — without this, Windows paths like `C:\Users\…` get joined with `/` producing `/C:\Users\…` which the OS rejects (os error 123). **Every directory render pins the list's `scrollTop` to 0** (do not regress): the `.picker-list` `<ul>` is created once per picker and only its content is rebuilt per directory, and browsers retain a scrollable's `scrollTop` across an innerHTML swap (the offset is only clamped against the NEW content at the next layout) — so a directory entered after scrolling the previous one down opened mid-list. `render()` resets before the swap; the Playwright repro in `test/verifyTauriClose.mjs` scenario I fails with the pin removed. |
| `src/editing.js` | Formatting mutation factory: inline toggles (incl. the inline-math `$…$` toggle with its `dollarClash` guards — currency spans are never wrapped, display `$$…$$` is a hard no-op) and the INSERT-ONLY block actions — table scaffold, codeblock/mermaid fence wrap, math `$$` block (never removes; every click inserts) — plus the historical h1–h3/quote/list toggles and indent/outdent, using injected active-doc, commit, and pure-helper callbacks. |
| `src/links.js` | Link-token detection and Ctrl+click/caret opening factory, with injected active-doc, shell gate (`shellapi.openUrl` → Electron `shell.openExternal`), and browser fallback. |
| `src/history.js` | Undo/redo history factory, with injected active-doc, typing-flush, input-suppression, and refresh callbacks. |
| `src/render.js` | Pure overlay-highlight renderer: `esc`, `matchTok`, `renderInline`, `isTableSep`, `computeBlocks`, `lineToHtml`, `highlightToHtml` (round-trip invariant enforced by `test/test.mjs`). Also paints the GFM task marker (`- [ ]`/`- [x]` right after a list bullet → a `.task` mark span, accent-colored; the span strips back to the literal `[ ]`, and slicing it out of the inline content stops `matchTok` seeing a false link-token `[`). |
| `src/mermaid.js` | Mermaid SVG rendering: `renderMermaidSvg`, `renderMermaidInNode`, `renderMermaidInHtml`, `restoreMermaid`, `scheduleMermaidRender`, `scheduleMermaidPrewarm`, `prewarmMermaidThemes`, `mermaidCacheStats`. Owns the STATIC `mermaid` import (invariant 2). Also owns the **anti-flicker SVG cache**: `_svgCache` (theme + source → rendered `{svg, bindFunctions}`), `_inflight` (concurrent-render dedup), `restoreMermaid(node)` (synchronous cache-restore after `syncDom` rewrites the preview so an already-seen diagram NEVER flashes raw code), `mermaidSourceKey(md)` (per-doc "did any fence change" fingerprint that `scheduleMermaidRender` uses to skip render when the source didn't change), and the **theme PREWARM** (`prewarmMermaidThemes` renders every seen diagram in the inactive theme off-screen so the first light/dark toggle is a synchronous cache hit — no raw fence, no post-restore reflow — with `withRenderLock` serializing real `mermaid.render` calls because Mermaid's theme config is global; `scheduleMermaidPrewarm` debounces it from `refresh()`; `mermaidCacheStats` exposes per-theme counts for tests). Also owns the **blank-fence guard**: `renderMermaidInNode` and `renderMermaidInHtml` skip whitespace-only fence source — mermaid cannot parse an empty fence, so the freshly inserted toolbar ` ```mermaid ` scaffold previews (and exports) as a plain code block instead of a "Mermaid render failed" error box. Also owns the **stylesheet-failure fallback**: `installMermaidStyles(holder)` (head-mirror + stamp) and `stampSvgStyles(holder)` (CSSOM-parse Mermaid's own sheet → presentation attributes on matching shapes; see invariant § Mermaid stylesheet-failure fallback), plus `stripSequenceShadows(holder)` (strips the sequence diagram's inline `url(#…-drop-shadow)` filter attributes — see invariant § Mermaid drop shadow). `renderMermaidSvg`'s `mermaid.initialize` also pins `themeVariables:{useGradient:false,dropShadow:"none"}` (see invariants § Mermaid dark-theme gradient outlines / § Mermaid drop shadow). |
| `src/format.js` | Pure selection/format helpers: `lineBounds`, `wordAt`, `wordJump` (Markdown-aware Ctrl+Arrow word movement), `detectFormat`, `trimmedSpan`, `wrapFor`. `FORMATTED_PATTERNS` includes the inline-math `$…$` pattern with the same Pandoc guards as the math.js scanner, so detection and preview always agree. |
| `src/paste.js` | Rich-paste HTML→Markdown: `mdCellText`, `mdTableFromHtml`, `mdStyleOf`, `mdInlineMd`, `mdFromHtml`. |
| `src/math.js` | LaTeX math rendering (`$$…$$` display + `$…$` inline, KaTeX): `renderMarkdown` (the single Markdown→HTML pipeline used by syncDom AND both exports), `containsMath`, `katexExportCss` (+ `setKatexExportAssets` injection). Owns the STATIC `katex` + `marked` imports AND the marked `code` renderer override that adds fenced-code highlighting through codecolor.js — replicating marked's default output byte-for-byte (same entity set incl. `&quot;`/`&#39;`) when `highlightCode` declines, so unhighlighted documents stay byte-comparable. PROTECT→PARSE→RESTORE: `findMathRanges` lifts math into `<!--mN-->` placeholders, marked parses, KaTeX replaces. Scanner skips fences + inline code, honors `\$`, applies Pandoc's inline rules (closer not space-preceded / not digit-followed), opens display `$$` only in block position or followed by non-space (the inline button's fresh empty pair can never pair with a later block), and leaves whitespace-only blocks (the toolbar scaffold) literal. Rendering is synchronous — none of mermaid's flicker/race machinery applies. MUST stay Node-importable (test.mjs loads it): no .css/?raw/?url imports here (codecolor.js is pure string processing, so it IS importable). |
| `src/find.js` | Floating NON-MODAL Find & Replace bar (`Ctrl+F` find / `Ctrl+H` replace — the hamburger's Find item was REMOVED; the keybinds and the bar are the entry points): `createFindHandlers({getActiveDoc, commit, workspace, echoMs, followFromEditor, isPreviewMode})`. The feature is DISABLED in preview-only mode (that mode hides the raw source it searches): `open()` no-ops when `isPreviewMode()` is true, and `close({focusEditor:false})` lets `setMode("preview")` shut an open bar without focusing the zero-width textarea. Literal search = the query regex-ESCAPED and run as a global RegExp (exec's `m.index` is reported on the ORIGINAL string, so case-folding length quirks can never corrupt offsets); `.*` toggles raw regex; invalid regex = inline red input + "bad pattern" count, never a throw/modal. Navigation (`Enter`/`F3` next, `Shift+Enter`/`Shift+F3` prev) wraps around and selects the match in the textarea; because the textarea is `overflow:hidden` inside `.editor-scroll`, the bar MEASURES the caret position by walking the overlay's text nodes (valid — the overlay round-trips the source) and writes `.editor-scroll.scrollTop` itself, stamping the value-based echo guard (`__suppE`) so the programmatic write never flips the lead — in SPLIT view the reveal then calls the injected `followFromEditor` hook (markdown.js sets `__lead="e"` and runs the SAME `followScroll` machinery a real editor scroll uses: block-anchored map + echo stamp + glide) so the preview pane FOLLOWS the found match; when the match is already comfortably visible nothing moves (preserving the sanctioned end-of-doc follower drift, invariant 14e). Focus stays in the bar (rapid Rep-Rep-Rep; the selection paints unfocused in Chromium/WebKit). Because an unfocused textarea paints NO caret glyph (and on WebKitGTK no reliable `::selection` wash either), the bar paints BOTH directly on the overlay: a synthetic blinking `.find-caret` inside the active tab's `.editor-col` at the current match's end AND a `.find-match` highlight (one translucent rect per line fragment, each EXPANDED to the editor's computed line-height so it matches the native selection's full line box — raw Range rects are the tighter glyph box) in the same color as `.input::selection` — repositioned on every count update + document `focusin`, moved between tabs, hidden when the editor itself is focused (its real caret takes over), the bar closes, or there is no current match. Replace = one undo step (`commit("replace", …)`, VS-Code select-then-replace convention); Replace-all = ONE undo step for the batch, spliced back-to-front; regex `$1…$9` substitutions supported. Every user-driven query change (query edit, Aa/.* toggle, open) follows recompute() with `revealCurrent()` so the CURRENT match is immediately SELECTED and scrolled into view — the `i/n` count always corresponds to visibly selected text; editor typing while the bar is open updates the count but does not yank the selection away from the line being edited. `noteTextChanged()` is called from `refresh()` so the count stays live; the bar stands down while a `.savedlg-backdrop` modal is open and never runs during session restore. |
| `src/tasks.js` | GFM task lists: `enhancePreviewTasks(html, md)` re-enables marked's inert `<input disabled type="checkbox">` checkboxes and stamps `data-task="N"` (document order) — but ONLY when `scanTaskItems(md)` maps exactly that many items; on any mismatch the html is returned UNCHANGED (stays inert — a document the mapper can't align can never have a click flip the WRONG line). `scanTaskItems(md)` walks marked's OWN lexer (`list_item.task`/`checked`/`raw`) so nesting/quotes/ordered markers agree with the renderer by construction, then maps each item's raw to its source LINE via `indexOf` with a strict line-start verification (rejects matches landing inside an item's continuation prose). `toggleTaskAt(md, ordinal, checked)` flips the state char on that line (blockquote-prefixed lines included) and returns `{text, caret}` for ONE `commit("toggle task")`. Export paths intentionally do NOT enhance (they call `renderMarkdown` alone) — exported files keep inert disabled checkboxes. Node-importable. |
| `src/scrollsync.js` | Block-anchored split-view scroll sync: `createScrollSync()` builds ONE per-tab mapping state. `noteText(md)` (called from `syncDom`) lexes the document with the SAME marked instance the preview renders with and locates every top-level solid token (expanding lists per item and tables per row — `collectEls` expands bare `<ul>/<ol>` into their `<li>` children and `<table>` into its flattened `<tr>` descendants) via a running cursor + strict line-start checks; anchors are `{sline, ownLines}` (a raw's TRAILING newline run is separator, not content — stripping it is what keeps list items from overlapping the next anchor's span). `buildPairs(preview, pvScroll, editor, edScroll)` measures the paired preview elements' offsets in CONTENT px (independent of scroll position) and pins each anchor's `edStart`/`edEndOwn` from `measureLineTops` — the editor side is the overlay's REAL per-line geometry (Range rects per line, wraps included — no character-count estimate), cached per (text, pane width). `mapEdToPv`/`mapPvToEd` binary-search the piecewise curve; ANY failure (count desync from a raw-HTML block, hidden pane, mid-parse) returns null and `followScroll` (markdown.js) falls back to the old linear-ratio math — a wrong anchor is never silently used. Exports `EDITOR_LINE_PX` (23 — keep in sync with style.css), `collectEls`, `contentBase`, `measureLineTops`. Node-importable (DOM helpers only run in the browser path). |
| `src/icons.js` | Inline-SVG toolbar icons (B I S code codeblock link mathInline table mermaid math + save/open + new-tab + undo/redo + hamburger/file-doc + `theme` (light/dark moon) + the three view-mode glyphs `viewSplit` / `viewEdit` / `viewPreview` on the constant-width mode button — `setMode` swaps `.mode-icon`'s innerHTML per mode so the button width never changes and the centered group never jostles). Every toolbar button uses one of these 17px SVGs (a font glyph like `◑` sits on the text baseline and looks vertically off-center — always use an icon). |
| `src/codecolor.js` | Fenced-code syntax highlighting via highlight.js's CORE build (`highlight.js/lib/core`) with ONLY explicitly imported grammars registered (js/ts, python, json, bash, xml/html, css, rust, go, c/cpp, java, sql, yaml, diff, ini — ~87 KB added to the bundle; the all-languages barrel would be ~1 MB). `highlightCode(lang, code)` returns hljs's `<span class="hljs-*">` HTML (hljs escapes the code itself — no raw `<` can leak) or NULL for unregistered/unknown/mermaid languages (caller emits marked's plain escaped code). `ignoreIllegals:true` + a try/catch mean a grammar throwing on exotic input degrades to plain code, never a broken preview. Static import (invariants 2 & 8); Node-importable. |
| `src/katexExportAssets.js` | Browser-ONLY katex asset imports (raw `katex.min.css?raw` + all 20 woff2 `?url`s) — imported solely from `main.js`, never from the markdown.js graph: test/test.mjs loads that graph under plain Node, which cannot resolve .css/?raw/?url specs. Injected into math.js via `setKatexExportAssets()` at boot; backs the self-contained HTML math export. |
| `src/wheeldiag.js` | Passive live **wheel diagnostics panel** (`Ctrl+Shift+D`, wired in `src/main.js`; Esc closes). Built for the Linux "2–4 wheel notches dead, then scrolling catches up" report that NO synthetic input can reproduce (CDP mouseWheel and XTest button presses both scroll from notch 1 — synthetic devices lack the XI2 smooth-scroll valuator real mice report, so they exercise different Chromium input paths). Deliberately a NON-MODAL floating panel (not the centered-modal convention) because the user must wheel the panes while it is open: it records every wheel event reaching the renderer (deltaX/Y, deltaMode, hit target, inter-event dt) plus each pane's actual displacement 32 ms and 300 ms later (one notch's smooth-wheel animation and the follower's glide both settle inside that), and a Copy button emits the session as a bug-report text. Passive by construction — capture-phase `{ passive: true }` wheel listener, never preventDefault, no DOM while closed. `src/main.js` toggles it on Ctrl+Shift+D (capture-phase keydown, same guard shape as the Ctrl+Shift+M block). `electron/preload.cjs` exposes `window.__SHELL_ENV` `{waylandDisplay, ozoneHint, nativeWheel}` so the panel's env line reports the compositor session (absent in a browser → "browser-fallback"). |
| `src/wheeloverride.js` | **Wheel-pair duplicate suppression** (the WSLg wheel saga's page half; capture half in `electron/xwheel-daemon.c`). Saga condensed: real wheel notches vanished before the page (capture panel logged none) while the X server delivered every press — Chromium's X11 decode discards them (family: 496255940 XI2 valuator deferral; 41249467; 421694708). The shell rescue injects each captured notch as a synthetic `mouseWheel`, but when Chromium's own decode ALSO delivers that notch the page receives a PAIR — engine ≈ ±120 vs synthetic exactly ±100 (our signature), 6–25 ms apart, order varies — and applying both made scrolling ~2× fast and jumpy. This module (a) does **not** preventDefault or apply anything manually — events flow to Chromium's normal smooth-scroll path (native feel; the earlier manual application was instant/jumpy), and (b) suppresses only the SECOND half of a same-sign pair whose opposite-kind partner arrived within `PAIR_MS = 40`, so exactly one application happens per notch (synth-only notches apply natively; engine-only notches apply normally). Gated on `window.__MD_RESCUE` (set by `electron/main.cjs` only while the rescue daemon runs) — on every other platform/launch the module is inert, 100 % stock wheel handling. Manual A/B escape: `MD_NATIVE_WHEEL=1` → `window.__SHELL_ENV.nativeWheel` skips even the suppression. |
| `src/style.css` | All styles, light + dark themes. Lightly touches `[data-theme]`. Owns the per-theme scrollbar palette — `color-scheme`, and the `--sb` / `--sb-hi` thumb vars (light + dark) consumed by `scrollbar-color` and the `::-webkit-scrollbar*` rules, so scrollbars blend with the active theme (see invariant 9). |
| `src/main.js` | Bootstrap: `createApp('#app')` + sample content — the first-run welcome document doubles as a feature tour: an interactive GFM checklist (click a box in the preview → the source flips), a `Ctrl+F`/`Ctrl+H` find hint, a highlighted `js` fence, mermaid + math blocks, and a shortcut table (the seeding is empty-document-only, so restored sessions are never clobbered). Also the ONLY place allowed to import the katex `.css` / `?raw` / `?url` asset specs (see katexExportAssets.js) — it imports the stylesheet for the live preview and injects the export assets into math.js. |
| `test/test.mjs` | Round-trip invariant (strip `<span>` from overlay HTML must reproduce source) + the math-pipeline cases (delimiter rules, code-region guards, blank-scaffold guard, error styling), the task-list mapping cases (lexer ordinal→line agreement incl. prose-mention and indented-code guards, toggle round-trip, desync-stay-inert), the code-highlighting cases (hljs spans, no raw-`<` leak, marked byte-shape for unknown/mermaid, export palette), and the packaging-guard cases (scripts/before-pack.cjs's `assertDist` against empty / index-less / complete dist fixtures, plus the hook's exported `beforePack` shape electron-builder resolves) — Node, no browser. |
  | `test/verifyCaret.mjs` `test/verify.mjs` `test/verifyUndo.mjs` `test/verifySaveOpen.mjs` `test/verifyToolbar.mjs` `test/verifyPaste.mjs` `test/verifyExport.mjs` `test/verifyMath.mjs` `test/verifyScroll.mjs` `test/verifyDialogScroll.mjs` `test/verifyModeScroll.mjs` `test/verifyModeFocus.mjs` `test/verifyTabClick.mjs` `test/verifyTabScroll.mjs` `test/verifyMermaidFlicker.mjs` `test/verifyMermaidStyle.mjs` `test/verifyMermaidFade.mjs`| Headless Chromium Playwright tests (all live in the `test/` dir). `verifyCaret.mjs` is the caret-placement regression (Enter list-continuation keeps indentation + collapsed caret; Tab/Shift+Tab incl. blank lines commit collapsed with the column following the text; inline formats (and the inline-math `$…$` toggle: wrap/toggle-off/empty-pair incl. the display-math no-op and currency no-wrap pins) collapse at the inner-span end before the closing marker; code-fence AND ```mermaid fence wrap caret inside the fence - `` ```\n|\n``` `` / `` ```mermaid\n|\n``` ``; math-block insert caret ON the blank middle line of "$$\n\n$$"; INSERT-ONLY pins — a table/math click inside an existing table/math block inserts a second scaffold and never removes, a non-empty caret line keeps its prose with the scaffold pushed below, a fence click on a fence line re-wraps instead of unwrapping; table caret in first body cell; h1 caret at block end; Markdown-aware Ctrl+Arrow word moves treat a whole formatted span as one word while plain moves fall through native - 92 cases). `verifyExport.mjs` covers the PDF/HTML export menu + save/cancel paths (30 cases) plus the menu shrink-to-fit width (2 cases, M1c/M1d — the dropdown hugs the widest entry, no 190px floor). `verifyScroll.mjs` is the split-view scroll-sync regression (a real follow-pane scroll inside the ECHO window is accepted immediately; the follow assertions now check CONTENT-matched block parity via the live DOM + the app's `getActiveScrollSyncDebug()` hook — 5 cases). `verifyDialogScroll.mjs` is the dialog scroll-preservation regression on the NATIVE path (self-contained `__TAURI_INTERNALS__` stub, real mouse presses): opening the in-app picker through both toolbar buttons (caret-at-end 5% and caret-above-viewport 50%), Ctrl+S/Ctrl+O, and the Export… menu must not move EITHER pane while up or after close; cancel returns typing focus AND the held position (preventScroll — the close-flicker fix); open-confirm opens the new tab at top with the old tab's ratio preserved on return; Save-As fresh + overwrite-modal paths hold position; a format-button control keeps its causative focus (30 cases). `verifyScrollSync.mjs` is the block-anchored scroll-sync regression (anchor map builds for a feature-dense doc — lists per item, tables per row — with monotone curve/pair tops; editor-lead puts a deep heading's source line at the preview's top edge; preview-lead lands the editor exactly on the mermaid fence line; wrap-heavy docs stay block-aligned at several fractions; a count-desync doc degrades to the ratio fallback which still drives the follower; at the ends the anchored curve + clamp converge (no snap/blend overshoot — the exhausted follower parks at its own end); large mapped deltas GLIDE over several frames and settle at block parity while tiny sub-line deltas stay instant, and the end-region re-correction lands as a slow pan — 16 cases). `verifyModeScroll.mjs` is the mode-switch scroll-PRESERVING regression (setMode records the leaving-mode ratio and re-asserts it on the entering panes so the mode button never jumps the view to the document end — 8 cases). `verifyModeFocus.mjs` is the mode-click focus regression (the mode button must causatively skip its trailing textarea focus ONLY when entering preview — the hidden textarea's scroll-into-view ratchets the preview to the bottom; for the preview target the mode action does `if (next === "preview") return;` while split/edit targets keep the normal caret-follow focus — 13 cases). `verifyTabClick.mjs` is the tab-click regression (the already-active tab no-op: activate() short-circuits when `doc === activeTab` so re-clicking it neither moves the scroll nor rewrites the preview DOM / re-renders mermaid; PLUS the whole-tab click target — a click on the tab's PADDING, not just the .tname span, activates the tab, the × close button still wins via stopPropagation, and the redundant-click no-op holds through a padding click too — 10 cases). `verifyTabScroll.mjs` is the cross-tab scroll-persistence regression (a tab's editor + preview scroll survive hiding and returning — 7 cases). `verifyMermaidFlicker.mjs` is the mermaid anti-flicker regression (a keystroke in prose OUTSIDE a fence must NOT flash raw code — the already-rendered holder is present in the same synchronous tick as the keystroke; a keystroke INSIDE a fence still re-renders — 7 cases; the diagram source must be valid mermaid or it never renders and there is nothing to cache). `verifyMermaidStyle.mjs` is the mermaid stylesheet-failure regression (stamped attrs exist, messageLine placeholders overwritten, computed styles survive removing EVERY `<style>` element, and the sheet's font stack + oversized-FO flex centering + text-label re-anchoring + WebKitGTK center-snap — which never touches a MULTI-LINE label, the `<br/>` note jumble fix — + oversized-edge-label FO normalization + sequence markup-shadow strip — 38 cases). `verifyMermaidFade.mjs` is the mermaid dark-theme gradient-outline regression (no linearGradient in the defs, sheet + computed + stamped node stroke all SOLID in both themes, no drop-shadow filter, and the theme PREWARM: both palettes cached before the first toggle, which restores synchronously — plus an in-fence edit in dark re-warming the new source for light so the next toggle is still synchronous — 21 cases). `verifyMath.mjs` is the KaTeX math regression (live preview renders `$$` display + `$` inline math synchronously and survives a preview rewrite; code regions / prose dollars / the blank `$$\n\n$$` scaffold stay literal; invalid LaTeX paints red; HTML export embeds the self-contained font-inlined katex stylesheet ONLY when math is present; PDF export rasterizes math — 21 cases). `verifyFind.mjs` is the Find & Replace bar regression (48 cases: Ctrl+F/H opens the floating bar with focus in the find/replace field, Esc closes with the STAY-PUT rule (a current match keeps the view AND the found word selected exactly where the search left it — Esc must never jump the page back to the pre-search position; a 0-match close restores the pre-open selection), and the GLOBAL Escape handler (markdown.js, window-capture, registered before the bar's listeners so bar Escs are consumed by find.js and stand down via find.isOpen()) clears any selected text when the bar is CLOSED — press Esc again after closing to deselect — standing down for centered modals (checked BEFORE the modal's own handler removes the backdrop) and the open hamburger menu, the live i/n count tracks edits and every user-driven query change immediately SELECTS the current match (revealCurrent; editor typing keeps the count live WITHOUT yanking the selection), Enter/F3 next · Shift+Enter/Shift+F3 prev with wrap-around ([0,5)→[110,115) pins), the Aa case toggle, the .* regex toggle with inline red on an invalid pattern, Replace = select-then-replace as ONE undo step with advance, Replace-all = ONE undo step for the whole batch (and 0/0 after), regex $1 substitutions (lo(r)em → $1X), literal-mode special chars, single-line selection prefill, recompute across tab switches, the split-view PREVIEW-FOLLOW (case 9: jumping to a far match scrolls BOTH panes — the bar's reveal calls the injected `followFromEditor` hook so `followScroll` drives the preview through the block-anchored map; an already-visible match leaves both panes alone), and the PREVIEW-MODE DISABLE (case 10: an open bar stays open through split→edit but closes on entering preview without focusing the hidden textarea and hides its caret/highlight, Ctrl+F/H are swallowed with `defaultPrevented` — no app bar and no native find — and find works again after returning to split; and the synthetic highlight uses the native selection's full LINE-BOX height, line-grid aligned, so Ctrl+F does not shrink it — case 7a3) — 48 cases). `verifyTasks.mjs` is the GFM task-list regression (live checkboxes in the preview; clicking flips the source line and commits ONE undo-able edit, re-render rebuilds the checkbox from source, a checkbox inside a fenced code block stays inert, the overlay paints a .task marker span — 12 cases). `verifyRecent.mjs` is the recent-files menu regression on the native path with a self-contained __TAURI_INTERNALS__ stub (record on open/save, dedupe + most-recent-first, cap 5, click opens a NEW tab and reads through the fs stub — which must serve BYTES because plugin-fs readTextFile does Uint8Array.from + TextDecoder, stale entries show the in-app Open failed modal and are dropped, entries persist across reload via localStorage, and the browser fallback hides the section — 12 cases). `verifyCodeColor.mjs` is the fenced-code highlighting regression (registered-language fences carry hljs-* spans and paint the palette color in the preview, unknown-language fences stay plain escaped code, the mermaid fence renders as a diagram holder and is never highlighted, output stays HTML-escaped, the editor overlay never contains hljs markup — 7 cases).|
| `test/verifyTauriClose.mjs` | **Shell-IPC native-path** harness (name kept from the Tauri era): injects a `__TAURI_INTERNALS__` stub with the same `plugin:*` command set the Electron preload implements, and drives the real wire contract (`onCloseRequested` → save/cancel → `fs/write_text_file` / `window/destroy`). No Electron install needed. |
| `index.html` | Entry. Loads the single Vite bundle. |
| `vite.config.js` | Dev/preview server pinned to `127.0.0.1` (avoids IPv6 `localhost` mismatch). Also `build.rollupOptions.output.codeSplitting: false` — prevents jsPDF's internal `await import("dompurify")` from emitting a second chunk so the bundle stays a single `index-*.js` (see invariant 8). |
| `package.json` | `main: electron/main.cjs` (the Electron app entry), `desktopName: markdown-editor.desktop` (drives the Linux desktop-entry WMClass sync via `linux.syncDesktopName`), `author: MagFlux` (the .deb Maintainer), `version: "0.0.0"` placeholder (CI injects the release tag). Scripts: `electron:dev` / `electron:start` (both prepend `scripts/before-pack.cjs` — fresh wheel daemon) / `electron:build` (+ the test roster). **All runtime libraries (marked, katex, mermaid, highlight.js, …) live in `devDependencies`** — Vite inlines them into the single bundle, and electron-builder packs only `dist/` + `electron/` (see the electron-builder specifics table), so NOTHING is copied from `node_modules` into the installers. |
 | `build/` + `icon.svg` | **Electron build resources + app icon set.** `icon.svg` (repo root) is the source art; `build/` holds the derived icons — `build/icon.png` (512×512; consumed by electron-builder's Linux targets — it derives the hicolor sizes), `build/icons/icon.ico` (Windows NSIS/MSI + the exe resource), `build/icons/icon.icns` (macOS), plus 32/64/128/256 PNGs. They were carried over 1:1 from the old `src-tauri/icons/` set at the Electron conversion; if the source art changes, regenerate the derived set with any rasterizer into `build/` (sizes are pure derived data — there is no `tauri icon` step any more). Windows Explorer can cache a stale `.exe` glyph — `ie4uinit.exe -show` or reboot before blaming the artifact. |
 | `scripts/electron-dev.cjs` | `npm run electron:dev` orchestrator: spawns vite (port 5173, strict), polls until the port answers, then launches Electron with `VITE_DEV_SERVER_URL` set (extra argv forwarded: `npm run electron:dev -- --md-x11`) and **relaunch-aware teardown**: the app's WSLg paint watchdog can relaunch electron into a process that is NOT this orchestrator's child (`electron/main.cjs`, wayland→x11) — the old blind `killVite()` on child exit killed the dev server out from under the relaunched window (**blank dev window**, reproduced live). It now probes ~4 s for another electron of this repo; on a handoff it keeps vite alive and tears down only once no instance remains (win32 keeps the simple path — no wayland there). Plain Node built-ins only. |
| `scripts/before-pack.cjs` | **The pack-time hook + dev prepend** (dual-mode, both documented in its header): as electron-builder's `beforePack` hook (`electron-builder.yml`) it runs before every platform pack's app-file walk and (a) **hard-FAILS the packaging** when the Vite bundle is missing or incomplete (`dist/index.html` + the hashed `dist/assets/index-*.js` entry chunk — a dist-less package boots to "The built frontend (dist/index.html) was not found.", which is exactly what the v1.0.0 installers did: the CI build job called `npx electron-builder` without building the frontend), and (b) compiles `electron/xwheel-daemon` (`gcc -O2 … -lX11 -lXi`; Linux only, tolerant of a missing gcc — an absent daemon = "rescue off") early enough for `asarUnpack` to lift the ELF out of the asar. WHY `beforePack` and not `beforeBuild`: the latter is only consulted inside electron-builder's `installAppDependencies`, which RETURNS EARLY under `npmRebuild: false` — the old `beforeBuild:` entry never ran at all (hence the CI Linux artifacts had no daemon). Run directly (`node scripts/before-pack.cjs` — prepended by `electron:start` / `electron:dev`) it compiles the daemon ONLY: a dev session has no `dist/`, so the guard would be wrong there (~0.2 s; no stale-binary risk). A build artifact, not a Node native module (`npmRebuild: false` unchanged). `test/test.mjs` pins the guard (empty / incomplete / complete fixtures). |
| `.github/workflows/ci.yml` | CI: `test` job (full Playwright suite) + `build` job (3-OS matrix → installers + portable archives → draft release). See § CI/CD. |
| `LICENSE.md` | **AGPL-3.0** — the license for *this* project's code. |
| `NOTICE.md` | Third-party dependency notices: which bundled deps are permissive (MIT vs. Apache-2.0 vs. BSD-3-Clause — `highlight.js` — incl. Electron itself, MIT, and `mermaid`) vs. the user-approved copyleft exception (`elkjs`, EPL-2.0), and the test-only `playwright` (Apache-2.0). |

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

2. **Static shell imports.** All shell-IPC imports (`src/shellapi.js`) are **static
   top-level imports** in `src/markdown.js` / `src/links.js`. They must NOT be
   changed to `await import(...)`. A failed dynamic import silently:
   - made `save()` fall through to a `Blob`-download `.click()` that a non-browser
     shell ignores — the tab closed believing it saved (data lost);
   - made `win.onCloseRequested` never wire up — the window closed with unsaved tabs.
   These imports are pure JS in a browser (they only touch `window.__TAURI_INTERNALS__`
   when *called*), so static import is browser-safe. Keep them at the top; keep every
   call wrapped in `isTauri()`.

   **The REAL gate is `isTauri()` (line ~248): it must detect the shell global
   `__TAURI_INTERNALS__`, not `__TAURI__`.** Electron's preload
   (`electron/preload.cjs`) installs exactly `window.__TAURI_INTERNALS__`
   (there is no `window.__TAURI__`). If `isTauri()`
   checks only `__TAURI__` it returns false in the real app and every native branch
   silently falls through to the browser no-op (save → dropped Blob download;
   `onCloseRequested` never registers). Keep it as
   `!!(window.__TAURI_INTERNALS__ || window.__TAURI__)`.

  3. **Close-requested must NOT self-close — AND must be allowed to `destroy()`.**
     `onCloseRequested` (~line 1749) relies on the shell wrapper contract (vendored
     in `src/shellapi.js`): the wrapper runs
     `await handler(evt); if (!evt.isPreventDefault()) await this.destroy()`.
     Correct handler: on **cancel** → `event.preventDefault()` (window stays); on
     **success** → do *nothing* (wrapper auto-`destroy`s). It must be `async` and
     `await closeApp()`. It must NOT call `win.close()` and must NOT
     `preventDefault()` unconditionally — that re-emit/prevent loop deadlocks the
     window open.

     **The wrapper's `destroy()` → `invoke('plugin:window|destroy')` must reach the
     shell's force-close.** In `electron/main.cjs` the destroy handler sets
     `win.__forceClose` and calls `win.destroy()` — a FORCE close that skips the
     renderer's `beforeunload` (exactly the old shell's `destroy()` semantics; the
     walk has already persisted the session via `closeApp()`'s own `saveSession()`,
     so skipping `beforeunload` is safe). The main process also intercepts the OS
     close (`win.on('close')`): it `preventDefault()`s and delivers
     `tauri://close-requested` to the renderer when a listener registered;
     with NO listener registered yet (close during startup) it closes directly,
     mirroring the old shell. NEVER route a sanctioned close through a plain
     `win.close()`: the app's unconditional `beforeunload` guard would cancel
     closes with dirty tabs (e.g. the Discard walk leaves dirty tabs) and wedge
     the window open. The `closed` handler must use the webContents id captured
     at CREATION — reading `win.webContents` inside `closed` throws "Object has
     been destroyed" (an uncaught main-process exception dialog that blocks the
     quit — surfaced exactly that way during the conversion). The
     Playwright harness in `test/verifyTauriClose.mjs` **stubs** `plugin:window|destroy`,
     so it does not exercise the main-process wiring; a real-shell smoke run
     (e.g. `ELECTRON_TRACE=1 xvfb-run npx electron .` + a window.close() probe) does.

4. **Single close-walk source of truth.** `closeApp()` (in `src/markdown.js`) is the
   only function that walks dirty tabs and prompts (Save / Discard / Keep editing)
   before the window closes. `removeTab`, the `beforeunload` listener, and the
   `onCloseRequested` handler all funnel through it, and prompt order = tab DOM order.
   Don't add a second prompt path.

5. **Save returns a boolean.** `save(tab)` returns `true` only on a real write (shell
   `writeTextFile` via `src/shellapi.js` → Electron fs) or a browser download; it
   returns `false` on user-cancel or error.
   `closeTab`/`closeApp` must gate removal on that value — a `false` means the tab
   stays.

6. **New tab, not reuse.** `open()` always opens a fresh tab. A blank `Untitled` tab
   is never reused for the just-opened document.
  Clearing the last tab in place also allocates the next per-run `Untitled N` name,
  as if a fresh blank tab had been opened.

7. **Hidden (dot) paths stay reachable.** The in-app picker lists whatever
   `read_dir` (shellapi → Electron main fs) returns — that includes dot-dirs like
   `~/.config`, and nothing in either layer filters them: node's `readdir` shows
   dot entries naturally, and the deliberate choice to allow reaching sensitive
   dot-dirs carries over from the shell conversion (the old Tauri shell needed
   `requireLiteralLeadingDot: false` for the same guarantee; Electron has no
   equivalent knob to accidentally regress). Keep it that way: do NOT add a
   leading-dot filter to the picker's `render()`/`goToDir()`. The Playwright
   harness in `test/verifyTauriClose.mjs` scenario H asserts the *UI* drives
   `read_dir` into a dot-path; it **stubs** the fs IPC and
   does not enforce any real scope — in the real Electron app the scenario was
   smoke-verified against the actual `readdir` handler (see the ELECTRON_TRACE
   probe note in the `electron/main.cjs` table row).
   Trade-off (intentional, documented): the picker can reach sensitive dot-dirs
   (`~/.ssh`, `~/.aws`, …).

8. **The bundle must stay a single JS file.** A runtime code-split chunk is the
    one failure class no shell can recover from (a failed chunk fetch silently
    disables save/open/the close guard, invariant 2), so the production build
    MUST emit exactly one `dist/assets/index-*.js`. jsPDF ships a lazy
    `await import("dompurify")` that Rollup would otherwise code-split into a
    second runtime chunk; we force it inline with
    `build.rollupOptions.output.codeSplitting: false` in `vite.config.js`.
    After every `npm run build`, confirm the dist has a single `.js` asset.
    `jspdf` and `html2canvas` are static top-level imports in `src/export.js`,
     `mermaid` is a static top-level import in `src/mermaid.js`, and `katex` +
     `marked` are static top-level imports in `src/math.js` (browser-safe —
      they're inert until called), never `await import(...)`. KaTeX's fonts are
      ASSET files (woff2, emitted to dist/assets by Vite from the katex CSS
      url() refs), not JS chunks — they do not violate this invariant.

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


 10. **The math pipeline is PROTECT → PARSE → RESTORE and the scanner's code
     guards are load-bearing (do not regress).** `renderMarkdown` (src/math.js)
     is the SINGLE Markdown→HTML path for the preview and both exports; its
     scanner (a) skips fenced code blocks and inline code spans — a `$$x$$`
     inside a mermaid fence or shell example must never typeset, (b) honors
     `\$` escapes, (c) applies Pandoc's inline rules (closing `$` must be
     non-space-preceded AND not digit-followed, so "costs $5 and $10" stays
     prose), and (d) leaves whitespace-only `$$` blocks literal (the freshly
     inserted toolbar scaffold shows its markers — mermaid's blank-fence
     guard, math edition). Math rendering is fully SYNCHRONOUS
     (`katex.renderToString`), so none of mermaid's flicker/cache/stale-render
     machinery is needed — do not "helpfully" add async caching here. The
     katex CSS asset imports (.css / `?raw` / `?url`) may ONLY live in
     src/main.js + src/katexExportAssets.js (test.mjs loads the markdown.js
     graph under Node, which cannot resolve those specs) — `src/math.js` must
     stay Node-importable, receiving them via `setKatexExportAssets()`. The
     HTML export embeds the self-contained stylesheet (fonts as data: URIs,
     woff/truetype fallbacks stripped) ONLY when `containsMath()` is true;
     math-free exports must stay byte-comparable to the pre-math pipeline.

 11. **The Find & Replace bar is floating and NON-MODAL (do not regress).**
      `src/find.js` builds an absolutely-positioned `.findbar` inside the
      workspace — NOT a `showModalBase` modal: a modal traps focus and blocks
      editing, while a find bar must let the user keep typing (VS Code
      convention). The bar's Escape handler is capture-phase and stands down
      while a `.savedlg-backdrop` modal is open (a centered dialog always
      outranks it); `Ctrl+F`/`Ctrl+H` in `onGlobalKeyDown` stand down the same
      way. **Preview-only mode DISABLES Find & Replace outright (do not
      regress).** The feature searches the raw Markdown source, and
      `.mode-preview` hides that source pane — leaving it enabled would only
      select invisible text. `createFindHandlers` receives an
      `isPreviewMode` callback (`app.dataset.mode === "preview"`); `open()`
      is a no-op there, `onGlobalKeyDown` swallows `Ctrl+F`/`Ctrl+H` (so the
      engine's native find does not open either), and `setMode("preview")`
      closes any open bar FIRST via `find.close({focusEditor:false})`. The
      skip-refocus flag is load-bearing: the textarea is zero-width in
      preview, and focusing it re-creates the eager scroll-into-view that the
      mode button's own preview-target focus skip exists for (invariant
      "The mode button must NOT causatively focus the editor textarea when it
      HIDEs"). `verifyFind.mjs` case 10 pins all of it.
      The menu item branch must `return` BEFORE the trailing
      `activeTab.input.focus()` — that trailing focus would yank focus straight
      back out of the bar's find input. Revealing a match MUST go through the
      bar's own overlay-text-node measurement + `.editor-scroll.scrollTop`
      write stamped with `__suppE` (the textarea is `overflow:hidden`, so the
      engines do not scroll an unfocused caret into view, and an unstamped
      write would become a "user scroll" and ratchet the preview pane — the
      same feedback-ratchet class the scroll-sync invariants guard). The
      reveal then drives the PREVIEW pane through the injected
      `followFromEditor` hook (markdown.js sets `__lead="e"` and runs
      `followScroll` — the same block-anchored machinery a real editor scroll
      uses), so in split view the preview follows the found match; the hook is
      called ONLY when the editor pane actually moved (an already-visible match
      leaves both panes alone — the sanctioned end-of-doc follower drift is
      never re-corrected). The
      `searchEl` `input` listener must call `recompute()` with NO arguments —
      a bare `recompute` passes the EVENT as `keepIdx` (truthy) and a stale
      index survives query edits — and follow it with `revealCurrent()`, so
      every user-driven query change (query edit, Aa/.* toggle, opening the
      bar) immediately SELECTS the current match: the `i/n` count always
      corresponds to visibly selected text. `noteTextChanged` (editor typing
      while the bar is open) deliberately does NOT auto-select — the
      selection/scroll must stay where the user is editing. Because the bar
      holds focus, the textarea
      paints NO caret glyph — the bar therefore paints a synthetic blinking
      `.find-caret` (2px, inside the active tab's `.editor-col` at the
      current match's end) AND a `.find-match` highlight (one translucent
      rect per line fragment of the match, engine-independent because an
      UNFOCUSED textarea paints no caret glyph and no reliable `::selection`
      wash on WebKitGTK) — both repositioned by every count update + a
      document `focusin` listener, `append`-moved between tabs, and hidden
      whenever the editor textarea itself is focused (the real caret/selection
      take over), the bar closes, or there is no current match. **The
      `.find-match` fragments are EXPANDED to the editor's computed
      line-height (centered on the Range rect's glyph box) so the synthetic
      highlight is exactly as tall as the native `::selection` wash it
      replaces** — `Range.getClientRects()` returns the tight ~17px glyph box
      while the textarea selection paints the full 23px line box, so painting
      the raw range height made the highlight visibly shrink the moment
      Ctrl+F stole focus (and grow back when the bar closed). Every fragment
      of a wrapped/multi-line match is aligned to the same line grid;
      `verifyFind.mjs` case 7a3 pins the height + top alignment. close()
      applies STAY-PUT: a current match keeps the view AND the found word
      SELECTED (restoring the pre-open selection there would jump the page
      back); a NO-current-match close restores the pre-open selection (only
      when the text hasn't changed since open). Esc's CLEAR-SELECTION rule
      lives in the GLOBAL handler (markdown.js, window capture, registered
      before the bar's listeners so bar Escs stand down via find.isOpen()
      — and standing down for centered modals, checked BEFORE the modal's
      own handler removes the backdrop, and the open hamburger menu): Esc
      with the bar CLOSED clears any selected text (press Esc again after
      closing the bar to deselect). Every replacement goes through
      `commit()` (one undo step; replace-all = one step for the batch).

 12. **Task-list enhancement is syncDom-ONLY and must stay inert on desync
      (do not regress).** `enhancePreviewTasks` runs in `syncDom`'s preview
      path only — `renderMarkdown` (the export pipeline) must NEVER emit
      `data-task` or re-enabled checkboxes, or exported files become broken
      interactive forms (pinned by test.mjs). The enhancement is gated on
      `scanTaskItems` mapping EXACTLY the number of checkboxes in the html;
      on any mismatch (or a null mapping) the html passes through UNCHANGED —
      inert checkboxes beat a wrong-line toggle every time. The ordinal→line
      map goes through marked's OWN lexer (not a hand-rolled scan) with a
      line-start verification, so it can never disagree with the renderer
      about which lines are tasks.

 13. **highlight.js stays a SCOPED core import (do not regress).**
      `src/codecolor.js` imports `highlight.js/lib/core` and registers ONLY
      the explicitly imported grammars — never the default `highlight.js`
      barrel (≈1 MB) and never a dynamic `import()` (invariants 2 & 8). The
      math.js `code` renderer override must keep marked's DEFAULT output
      shape byte-for-byte when highlighting declines (unknown language, no
      info string, mermaid): `<pre><code…>ESCAPED\n</code></pre>\n` with
      marked's entity set — so math-free, unhighlighted documents stay
      byte-comparable. `language-mermaid` is always declined here; mermaid.js
      owns those fences (including the blank-fence guard). All hljs output is
      hljs-escaped — never post-process it into raw HTML.

14. **Split-view follow is BLOCK-ANCHORED, not ratio-linear (do not regress).**
    The two panes do not have proportional heights (source lines are fixed
    23px boxes; the preview's h1/tables/KaTeX/mermaid reflow), so the old
    linear scrollTop-ratio mapping drifted badly mid-document (scroll the
    editor to a deep heading and the preview sat 2+ sections away).
    `followScroll` (src/markdown.js) now drives the follower through the
    per-block anchor map built by `src/scrollsync.js`; its rules:
    (a) The anchor map is built ONLY from `marked.lexer` on the same text the
    preview renders, located with a running cursor + strict LINE-START
    checks, and expanded: per list ITEM (collectEls expands bare UL/OL into
    their <li> children — a list token contributes items.length anchors) and
    per TABLE ROW (header + separator as one anchor, then one per data row;
    the separator line renders no element). A token raw's TRAILING newline
    run is separator, not content (stripping it keeps item anchors from
    overlapping the next anchor's span — that overlap fails the whole map).
    Per-row expansion is what keeps tall table rows (they wrap in the narrow
    column) from snapping the follower mid-table.
    (b) The EDITOR side of the curve is the overlay's MEASURED per-line
    geometry (`measureLineTops`: one Range per source line over the
    overlay's text nodes — the same trusted technique find.js uses; the
    overlay round-trips the source so a line's rect IS its scroll position,
    wraps included). Never replace it with a character-count wrap estimate:
    the canvas char-width probe mis-measures and word-wrap slack compounds
    (~5 rows of drift on the sample doc alone).
    (c) The PREVIEW side is the live rendered offsets, measured in CONTENT
    px (elRect.top − (containerRect.top − scrollTop)) so they are
    scroll-independent and directly comparable with a scrollTop; the cache
    revalidates per frame via the pane's scroll extent + the first element's
    position (that is what heals late mermaid SVGs, resizes and re-renders).
    (d) ANY failure (element↔anchor count desync, hidden pane, build
    throw) returns null and followScroll uses the EXACT old ratio math —
    degraded behavior is unchanged, never a guessed anchor.
    (e) NO end-of-doc snap, NO end-of-doc blend: the anchored curve + the
    clamp must CONVERGE at the ends on their own — the target for the lead's
    final position is the content that actually corresponds, clamped into
    the follower's range. Two earlier implementations were tried and BOTH
    were wrong the same way: a 50px hard SNAP and then a 200px BLEND forced
    the follower to its own scroll end when the lead neared ITS end — that
    scrolls the preview PAST the last big section's top (a table) and the
    heading/table are cut off above the viewport ("weird snapping" /
    "still cut off at ## Formatting shortcuts"). The follower reaches its
    own end only when the correspondence does; when the lead scrolls into a
    region the follower cannot express (the follower is exhausted at its
    scroll end), the follower stays parked — the residual drift there is
    inherent (the panes' content heights differ; nothing can match it).
    Do not re-add a snap or a blend without revisiting those reports.
    (f) The value-based echo guard (`__suppE`/`__suppP` stamps with deadline
    + exact target) is stamped for BOTH paths (anchored and ratio) — the
    echo-suppression/lead-flip contract of invariant "value-based echo
    suppression" still applies verbatim.
    (g) Follower deltas LAND AS A GLIDE (glideFollower, markdown.js).
    Through tall rendered blocks (mermaid SVG, KaTeX display, table rows) the
    anchored curve's slope is 3-4× the editor's, so one wheel notch maps to a
    150-340px follower move; writing it instantly read as a teleport ("the
    jumps"). The glide approaches the SAME target exponentially (base
    τ=80ms — the elastic follow; at τ=40 a ~100px notch landed in ~120ms
    with a third of the motion in the first frame, which read as "small
    jumps aren't smooth") over a few frames — the mapping, the targets and
    block parity are untouched, only the write mechanism changes. Deltas
    ≤ GLIDE_MIN_PX (10px: sub-line adjustments) and reduced-motion users
    write instantly; everything else glides, INCLUDING one-line keyboard
    scrolls and ~100px wheel notches. Contracts:
    every per-frame write refreshes the pane's echo stamp FIRST (value = the
    offset being written, deadline refreshed, plus a glide `gid`), so the
    frames' own scroll events stay suppressed echoes; a new lead event
    RE-TARGETS the glide in place (no restart) and followScroll cancels the
    LEAD pane's glide (its position now belongs to the user — this is the
    takeover path when the user grabs the pane that was gliding); a stamp
    from any other writer (setMode ratio restore, tab-switch restore,
    find.js reveal, openAtTop) carries NO gid — the loop sees the mismatch
    and STANDS DOWN instead of fighting that writer; **a genuine (non-echo)
    scroll event on a pane cancels that pane's glide IMMEDIATELY in
    realScroll** — the takeover is otherwise asynchronous (realScroll →
    kickScrollSync → rAF → followScroll) and in that one-frame window an
    in-flight glide keeps writing value-stamped echoes toward its STALE
    target, clobbering the user's fresh position (a preview-lead landing
    ~1 line past the target; surfaced when the correction τ made a prior
    glide outlive the test's step). The loop terminates on arrival, an
    800ms cap, tab switch, or cancel — no persistent per-frame work.
    **Arrival is measured against the glide's FLOAT position state
    (`g.pos`), never against the pane's live scrollTop** — engines that
    quantize scrollTop writes to integers (WebKitGTK on X11, WebView2,
    headless Chromium) turn the sub-pixel tail increments
    (`current + remain×0.204`) back into the SAME integer once the
    remaining distance is under ~2.5px, so a read-back glide STALLS there:
    the arrival test never fires, the loop silently spins rAF no-ops, and
    the 800ms cap then force-writes the residual 1-2px as ONE visible jump
    ~0.8s after the pane already looked stopped (the "follower stops, then
    nudges a few px in the scroll direction a second later" report —
    reproduced headlessly at t=346ms stop → t=846ms snap). The float walk
    converges regardless of how the pane quantizes each write, so arrival
    fires normally, the loop still terminates on arrival (its final write
    is ≤1px — part of the glide), and the cap stays a true backstop. The
    per-frame dt is CLAMPED at 100ms so a janked frame cannot leap the
    exponential — this also keeps the glide's `animated` accumulator
    (Σdt, exposed via `getActiveScrollSyncDebug().glide`) a true measure
    of CONVERGENCE (τ·ln(delta)) rather than wall time, which is what
    case 7e asserts on: a fixed wall-clock settle point cannot distinguish
    a healthy glide from a stalled one (both look "still" for a while),
    and a fixed sleep before a probe can bleed a still-running τ=150
    correction leg into the probe (the notch then RE-TARGETS it and
    inherits its slow τ — measured 688ms = 150·ln(84) on an otherwise
    healthy run). 7e therefore polls the glide state to termination and
    asserts animated ≤ 500ms for its base-τ notch, then 1.4s of
    post-termination stillness. A
    LARGE delta (≥ CORRECTION_MIN_PX) arriving after the lead has been
    idle ≥ IDLE_CORRECTION_MS is a RE-CORRECTION — re-entering the
    correspondence after the exhausted end region (the preview was wheeled
    into its tail pad while the editor sat at its max; the next editor
    scroll must pull it back ~200px, exactly at a document's last big
    section, where at the base τ the landing read as "it just jumps").
    Corrections start with CORRECTION_TAU_MS (150) and keep it across
    re-targets; a burst (followScroll <150ms apart) always uses the base τ,
    so the continuous follow never lags more than ~v·τ. Do not write the
    follower pane directly anywhere else without re-stamping, or the glide
    will keep fighting you.
    `test/verifyScrollSync.mjs` (17 cases) + `test/verifyScroll.mjs` (5
    cases) pin it; `window.editor.getActiveScrollSyncDebug()` exposes the
    map state (anchors, pair table, countsAgree) for tests/diagnostics.

15. **Packaging must build its inputs, and the pack-time hook enforces it
    (do not regress).** electron-builder BUILDS NOTHING: it packs whatever
    `files` matches, silently, even when a pattern matches nothing. So every
    packaging path must run the frontend build first — `npm run
    electron:build` (vite build + electron-builder) is the only sanctioned
    command, locally and in CI (`.github/workflows/ci.yml` `build` job). The
    regression that produced this rule: v1.0.0's CI build job called `npx
    electron-builder` directly, `dist/` is gitignored (so the fresh checkout
    had none), and every installer/portable for every OS shipped an asar
    holding just `electron/*.cjs` — the app booted to "The built frontend
    (dist/index.html) was not found." Two protections now exist. (a)
    `scripts/before-pack.cjs` is wired as electron-builder's **`beforePack`**
    hook (NOT `beforeBuild`: that hook is only consulted inside
    `installAppDependencies`, which returns early under `npmRebuild: false` —
    the old `beforeBuild:` entry never ran once, which is separately why the
    CI-built Linux packages had no wheel daemon). It hard-FAILS the packaging
    when `dist/index.html` or the hashed `dist/assets/index-*.js` entry chunk
    is missing, naming the fix; `test/test.mjs` pins the guard against empty /
    incomplete / complete fixtures. (b) The same hook compiles
    `electron/xwheel-daemon` *before* the app-file walk, so `asarUnpack`
    actually lifts the ELF out; the runtime must then resolve it:
    `resolveDaemonPath` (electron/main.cjs) remaps
    `app.asar → app.asar.unpacked` UNCONDITIONALLY when packaged — an
    asarUnpack'd file is still visible through the asar fs shim, so the old
    existsSync-based "is it still inside the asar?" test never fired,
    `spawn()` got an asar-internal path and died with `ENOTDIR` (the rescue
    was silently off in packaged builds; verified with a packaged xvfb smoke
    run — `ELECTRON_TRACE=1` must show the daemon spawning, not
    `spawn failed`). For the same "don't half-arm it" reason the page flag
    `window.__MD_RESCUE` is set on the child's `spawn` EVENT, never up-front
    (src/wheeloverride.js's pair suppression is only sound while synthetic
    wheels actually exist). Local dev prepends the hook script in daemon-only
    mode (`node scripts/before-pack.cjs` — no dist guard there; a dev session
    has no `dist/`).

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
  Vue, etc.). Do NOT introduce dynamic `import()` (code-splitting) of any shell-IPC
  or export module — `src/markdown.js` currently has zero `import(...)` calls and
  must stay that way, so the bundle remains one file that loads everywhere.
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
- Shell calls are guarded by `isTauri()` so the same file works in a browser. When
  adding a new native feature, add a browser fallback branch.
- Test-first: when adding editor behavior, extend the relevant `test/verify*.mjs` or
  `test/test.mjs` and confirm it stays green before considering the task done.

 - **Toolbar active-states must track the caret, not just text changes** (do not
   regress). The per-textarea `select` event is unreliable on WebKitGTK — it can
   never fire for a click or arrow-key move there — and the `click` handler
   historically refreshed only the status bar, *not* the buttons, so the B/I/U/S/
   link / inline-math and H1–H3/quote/list/table buttons stayed stale until the text
   mutated.
   The live-tracking fix is a document-level **`selectionchange`** listener on the
   active tab (fires for every caret move: click, arrows, paste, undo, tab switch),
   a **`mouseup` + `requestAnimationFrame`** fallback, and re-sync on tab switch via
   `activate()` → `refresh()`. Do not "simplify" back to `select`/`keyup` only;
   the WebKitGTK app will regress to stale buttons.
    `wordAt` returns a complete inline-format span when the caret is inside
    formatted text containing spaces, so all inline buttons stay active across
    spans such as `**two words**`, `<u>two words</u>` and `$e^{i\pi} + 1 = 0$`.
    Code spans are checked first, so marker-like text such as `` `**markers**` ``
    remains code, not bold — and `` `$x$` `` remains code, not inline math.
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
   (56 cases) covers: caret on `**bold**` / `*italic*` / `~~strike~~` /
    `[…](https://…)` / `$x^2$` each with a trailing comma, plus a toggle-OFF case
    asserting the comma survives.
  - **Collapsed-caret inline formatting INSERTS an empty marker pair (do not
    regress).** With NOTHING selected, a formatting button must never wrap the
    word nearest the caret: a caret on an empty line, in the whitespace
    between words, or at a plain-token edge inserts an empty marker pair
    (`****` bold / `**` italic / `~~~~` strike / `<u></u>` underline /
    ``` `` ``` code / `[](https://)` link) at the caret with the cursor
    between the markers, ready to type — padded with one space on a side
    whose adjacent char is a word char, so a caret at either edge of the
    single-space gap in `the test` yields exactly `the **** test` (and
    `the $$ test` for the inline-math button). It only
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
  - **The inline-math toggle has dollar-collision guards the other formats do
    not need (do not regress).** `$` is also prose currency, so
    `toggleFormat("inlinemath")` must never create a `$$` run mid-prose:
    `dollarClash` in `src/editing.js` refuses to wrap any span that contains a
    `$` or butts one (currency `$5,000` — the empty marker pair is inserted at
    the caret instead), and when the caret sits INSIDE a `$$…$$` display span
    the button is a hard NO-OP (wrapping there would corrupt the display
    pair). The toolbar button must light ONLY where the preview will actually
    typeset: the `inlinemath` pattern in `FORMATTED_PATTERNS` /
    `detectFormat` mirrors the math.js scanner's Pandoc rules exactly
    (opener not `\`/`$`-preceded, non-space content both sides, closer not
    digit-followed) — so `costs $5 and $10`, `` `$x$` `` (code wins) and
    `$$y$$` (display, not inline) never light it. The companion scanner rule
    in `src/math.js`: a `$$` opens DISPLAY math only in block position
    (whitespace-only before it on the line) or followed by a non-space char —
    a mid-prose `$$` followed by whitespace (the fresh empty inline pair) can
    never pair with a later block. Pinned by `verifyToolbar.mjs` + `verifyCaret.mjs`
    cases 3e–3h + `test.mjs`.
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
     `refresh()` for the self case. See `test/verifyTabClick.mjs` (10 cases).
  - **The whole tab is the activation click target (do not regress).** The
    activation click binds to `doc.tab` (the entire `.tab` element), NOT to its
    `.tname` span only: the tab paints itself clickable everywhere (`.tab {
    cursor: pointer }` and the hover background cover the 12px left padding and
    the empty stretch between name and ×), so a click there must behave like a
    click on the name — the old `.tname`-only binding left those areas dead
    ("the pointer changes over the tab, but the click only registers on the tab
    text"). Two load-bearing details: (a) the × close button's own click
    handler `stopPropagation()`s, which is what keeps a close click from ALSO
    firing the tab-level activation — do not remove that; (b) the global
    Ctrl+click→new-tab capture handler (markdown.js) excludes the WHOLE `.tab`
    (not `.tab .tname`): a Ctrl+click on any part of a tab means "switch to it",
    so the result is identical per pixel instead of "text = activate, padding =
    spawn a new tab + activate". Ctrl+clicking the tab-bar background (not on a
    tab) still opens a new tab. Pinned by `test/verifyTabClick.mjs` case 3
    (padding click activates; redundant padding click keeps the no-op contract).
  - **Opening a file puts the caret at the BEGINNING (do not regress).** Assigning
    `textarea.value` leaves the selection at the END of the new value per the HTML
    spec, so any code path that installs a whole document must pin the caret back
    to offset 0 (`parkCaretStart` in `src/markdown.js`). `openFile` / `newTab` /
    session restore go through `openAtTop`, which resets both panes' scrollTop AND
    the caret — and it now runs AFTER `activate()`: `activate`'s `input.focus()`
    is what can settle the selection at the end (the textarea was assigned while
    the new tab was still hidden), so the caret pin must land last, and
    `openAtTop`'s rAF re-assert re-pins it once more after the initial reflow. The
    programmatic `documentText` setter and `setDocumentText()` also call
    `parkCaretStart` after assigning — the first-run welcome document is seeded
    through `setDocumentText`, and before this pin a fresh profile opened with
    the caret on the document's last line (the "opened a new file and the cursor
    is at the end" report). Pinned by `verify-save` (first-run document +
    `openFile`) and `verify-dialogscroll` case 7d (real picker → Open confirm).
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
  - **Opening the Save/Open/Export picker must NOT move the scroll (do not
    regress), and closing it must not FLICKER either.** The toolbar's trailing
    `activeTab.input.focus()` used to run for the save/open actions too; because
    the button press had ALREADY blurred the textarea, that focus was causative,
    and the engine's caret-into-view scroll parked `.editor-scroll` at the caret
    (document bottom for an end-of-doc caret — "when the open/save dialog opens
    the current file scrolls all the way to the bottom"; the top for a caret
    ABOVE the viewport — same bug, opposite direction). Three layers now hold
    the position, all in `src/markdown.js`:
    (a) the trailing focus STANDS DOWN while any `.savedlg-backdrop` is mounted
    (the dialog owns the keyboard; the native picker mounts its backdrop
    synchronously inside the click) and for save/open runs
    `focusKeepScroll(activeTab)` instead (browser-fallback OS dialog path too);
    (b) every in-app picker (save(), open(), and export.js's PDF/HTML pickers)
    goes through `pickPathKeepScroll` — capture BOTH panes' ratios BEFORE the
    modal exists, re-assert them echo-stamped (`restorePaneScroll`, two rAF
    ticks — same shape as setMode/activate/toggleTheme) after it closes, and on
    a no-new-tab close hand typing focus back with
    `input.focus({ preventScroll: true })`; everyday format actions keep the
    plain causative focus (caret-follow is the sanctioned behavior there);
    (c) `preventScroll` is load-bearing for the close path: a plain focus()
    fires the reveal scroll FIRST (the pane jumps for 1-2 frames and the rAF
    restore pulls it back = the "panes flicker like a movement happened" report
    on close; preventScroll removes the jump AND the flicker, leaving the rAF
    restore as a safety net only). The open-confirm path deliberately does NOT
    refocus (openFile activates the new tab); the toolbar `menuId` (Export)
    branch stands down under a backdrop and uses `focusKeepScroll` for the
    download fallback. Do not write the follower panes bare here — the restores
    stamp the value-based echo guard (`__suppE`/`__suppP`) like every other
    sanctioned writer, and a tab switch inside the rAF window skips the restore
    (activate() owns per-tab ratios). `test/verifyDialogScroll.mjs` (30 cases,
    native path with a self-contained `__TAURI_INTERNALS__` stub, real-mouse
    clicks) pins: both toolbar buttons (caret-at-end 5% + caret-above 50%),
    Ctrl+S/Ctrl+O, cancel → focus + position restored, open-confirm → new tab +
    old-tab ratio preserved on return, Save-As fresh write + overwrite-modal
    flows, the Export… picker, and a format-button control that keeps its
    causative focus.
  - All dialogs (save/cancel prompts, open, and any error/info feedback) render
   **in-app** via `showModalBase`/`messageModal`/`pickPath` — NOT `alert`/`confirm`/
   `prompt` (unreliable in the WebKitGTK-era shells) and NOT any native OS dialog
   (an OS picker neither parents to our window nor matches the app theme).
   The in-app modals are centered by construction inside the single webview.
- **Export-as-PDF/HTML (hamburger menu).** The menu is a `.menu-wrap` dropdown
  toggled by the hamburger (`data-action="menu"`) with TWO hover submenus:
  "Recent files…" (entries rendered into `.submenu[data-sub="recent"]` on
  every open) and "Export…" (`.submenu[data-sub="export"]`) whose
  `data-menu="pdf"` / `data-menu="html"` items are — **text-only** (no icons; a past `${icons.fileDoc}` with
  no `.mi-icon` wrapper rendered unconstrained and blew the menu huge on Windows
  WebView2, while WebKitGTK happened to size it small). `style.css` also carries a
  `.menu-item > svg` 16px belt-and-braces rule for any bare SVG child. HTML export
  re-renders the markdown to a styled preview and
  writes it; PDF renders that preview off-screen via `html2canvas` (a 780px-wide host
  at `fixed; left:-9999px`, `scale:2`, white bg — VISIBLE, because html2canvas must
  rasterize real pixels; `-100000px` risked a WebView2 composite ghost) and slices
  the canvas into A4
  (595×842 pt) pages into a `jsPDF` doc. Both save through `pickPath` + shell
  binary fs writes (`writeFile`) with a browser `Blob`-download fallback — the SAME in-app
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
   THEME + source (`mmCacheKey`) — a theme toggle renders every diagram in
   the new theme; `toggleTheme()` resets `__mmLastKey` and calls `refresh()`
   for the same reason (a dark-rendered diagram must never keep its dark
   colors in a light app).
   **BOTH themes are prewarmed at load (do not regress — the "preview jumps
   around the first time I change themes" report).** Since the cache is
   theme-keyed, the first toggle used to miss every entry: the preview showed
   raw fences until the 120 ms debounce re-rendered them, and those SVGs
   changed the preview's height AFTER `toggleTheme`'s scroll-ratio restore
   had run — the visible jump. `refresh()` now calls
   `scheduleMermaidPrewarm()` (debounced 400 ms, idempotent once warm), which
   runs `prewarmMermaidThemes()`: it snapshots the sources already cached in
   the ACTIVE theme (exactly the diagrams the user has seen, including hidden
   open tabs — no Markdown parsing, so keys match `code.textContent`
   byte-for-byte) and renders each in the INACTIVE theme off-screen via
   `renderMermaidSvg(src, otherTheme)`. The first toggle is then a
   SYNCHRONOUS `restoreMermaid` cache hit, in the toggle's own tick, so there
   is no raw-fence flash and the ratio restore sees the final layout.
   `themeOverride` only affects the cache key + `mermaid.initialize`; the
   visible `data-theme` is never touched during prewarm. `refresh()` runs on
   every edit / commit / undo / tab activation / theme toggle, so the pass is
   **not open-only**: a fence edited while in one theme is re-rendered there
   by the normal 120 ms debounce and then warmed for the other theme, keeping
   the next toggle synchronous (a continuous typing burst merely defers the
   400 ms debounce until the user pauses). Real
   `mermaid.render` calls are SERIALIZED through `withRenderLock` because
   mermaid's theme config and diagram-config scope are GLOBAL — prewarming
   makes an opposite-theme render overlap with user edits routine, and an
   interleaved `initialize` could repaint the in-flight diagram in the wrong
   palette. The prewarm pass yields a macrotask between diagrams so a
   user-triggered render (keystroke → debounce) jumps ahead of the background
   work, and it re-scans after the pass so a multi-diagram render that
   finished mid-pass is still covered. `mermaidCacheStats()` exposes
   per-theme entry counts (`window.editor.mermaidCacheStats` in `src/main.js`
   + tests); `verifyMermaidFade.mjs` pins both-theme warmth and the
   synchronous first toggle.
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
    readable. `test/verifyMermaidFade.mjs` (21 cases)
    asserts, in BOTH themes: no `linearGradient` in the SVG defs, the
    sheet's neo node-stroke rule is not `url(...)`, the computed node
    stroke is a solid color, the stamped attribute matches it, the
    dark-theme stroke luminance stays high (>0.5), and the sheet's neo
    node rule carries `filter: none` (no drop-shadow — the Windows
    "fuzzy borders" report, see the next invariant); it also pins the
    theme PREWARM (both palettes cached before the first toggle, which
    restores synchronously with no raw fence) AND that a fence edited
    while in one theme warms the NEW source for the other theme, with
    the next toggle still synchronous.
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
    The SEQUENCE diagram needs one more layer: its `neo` look paints the
    shadow in MARKUP — an inline `filter="url(#id-drop-shadow)"` attribute
    (feDropShadow dx=4 dy=4 stdDeviation=0, white @ 6%) on every actor
    rect, activation, cylinder and loop box. An inline attribute overrides
    the sheet, so the shadow survived the themeVariable override on BOTH
    platforms (the "hard shadow under every sequence shape" report).
    `stripSequenceShadows(holder)` (called from `installMermaidStyles`)
    strips every filter attribute whose value references `…-drop-shadow`
    (EXACT suffix — the state diagram's `-drop-shadow-small` circle shadow
    is a different mechanism and stays), scoped by content to SVGs
    containing a `rect.actor`; the now-unreferenced `<filter>` def is
    inert and left alone. Pure DOM surgery (detached-safe, idempotent).
    `test/verifyMermaidStyle.mjs` case 10 pins it.
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
      MULTI-LINE labels are NEVER snapped (the "<br/> jumble" report): a
      label containing `<br/>` (sequence notes, multi-line messages) is
      split by mermaid into SEVERAL sibling <text> lines in the SAME group
      all anchored to the SAME shape, each deliberately offset by dy=1em —
      measured per line, most fall inside the snap window, so the old code
      translated up to N−1 of them ONTO the shape center and overprinted
      the block (every note line jumbled at the same spot; raw mermaid
      renders `<br/>` fine — this was entirely our post-processing). The
      guard: when a sibling text in the same group shares the text's
      euclidean-nearest shape, the line is part of a deliberate multi-line
      block and is left exactly where mermaid put it; true single-line
      labels (one text per shape — actor names) still snap (case 8
      unaffected).
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
      9a/9b/9c/9d/9e/9f/9g/9h (38 cases in the file incl. the sequence
      shadow strip, case 10, and the multi-line `<br/>` guard, case 11) assert
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
 - **Tab / Shift+Tab are captured at window level in CAPTURE phase (do not
    regress).** The indent/outdent handler runs on `window` in CAPTURE with
    `preventDefault()` + `stopPropagation()` (the textarea
    `keydown` handler in `onKeyDown` no longer handles Tab — that would
    double-indent). Under Electron (Chromium) the plain browser focus traversal
    still exists — the capture handler is what makes Tab indent/outdent INSIDE
    the document at all. The handler stands down while a centered modal
    (`.savedlg-backdrop`) is open so the modal's own focus trap owns Tab.
    Two defense layers (kept from the WebKitGTK-era shell; harmless in Chromium):
    (a) `isEditorTabKey()` also accepts the legacy X keysym
    `ISO_Left_Tab` (defensive against engines reporting it);
    (b) a blur-refocus fallback in `makeTab`: the capture handler stamps
    `doc.__sTabAt`, and if the engine performs the focus traversal DESPITE
    preventDefault, a `blur` listener fires within 250 ms and pulls focus (and
    the stored caret via `__sSel`) back into the textarea on the next
    macrotask, also standing down for modals. Do not remove either layer.
    (Historical note: the WebKitGTK shell ALSO needed a Rust-side keysym fix —
    X remaps Shift+Tab to `GDK_KEY_ISO_Left_Tab`, which WebKitGTK delivered as
    `KeyboardEvent.key = "Unidentified"` — implemented in `src-tauri/src/keymap.rs`,
    deleted with the Electron conversion: Chromium receives a normal `Tab`
    keydown with shiftKey from the OS.)
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
    `test/verifyCaret.mjs` cases 6-8 (81 total) pin all of this; the
    plain-word stops 3/7 in `foo bar **baz**` coincide with Chromium's
    native word ends and are load-bearing.


## Known limitations (browser fallback)

- In a plain browser (`vite preview` / `npm run dev`), Save uses a file download
  and there is no window-close interceptor (the `beforeunload` guard is the only
  guard). All the shell-native paths (real fs writes, the `onCloseRequested` walk)
  must be validated in the actual Electron app — the Playwright tests exercise the
  shared code paths and assert the browser fallbacks, not the native ones; a
  real-shell smoke run (xvfb + a window.close() probe, `ELECTRON_TRACE=1`) covers
  the bridge and the close walk end-to-end (see the `electron/main.cjs` row).
