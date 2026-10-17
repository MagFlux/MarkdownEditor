/**
 * before-pack.cjs — pack-time preparation for electron-builder (the
 * `beforePack` hook) AND the local-dev wheel-daemon compiler.
 *
 * One rule, two jobs: a packaged build must contain EVERYTHING it needs.
 *
 * 1. dist/ GUARD (fail the packaging). electron-builder packs the `files`
 *    list from electron-builder.yml — `dist/` + `electron/` — where dist/ is
 *    the Vite bundle the shell serves over `app://`. `dist/` is GITIGNORED,
 *    so a fresh checkout has none, and an
 *    electron-builder run whose caller forgot the frontend build happily
 *    packs an app.asar holding just electron/*.cjs + package.json; the app
 *    then dies at boot with "The built frontend (dist/index.html) was not
 *    found." Exactly that shipped as v1.0.0 (every platform): the CI build
 *    job called `npx electron-builder` DIRECTLY instead of
 *    `npm run electron:build` (which runs `npm run build` first), and
 *    electron-builder does not build the frontend itself. This hook makes
 *    that mistake impossible — the packaging fails loudly, before any
 *    installer is written, with the fix in the message.
 *
 * 2. X-wheel daemon compile (Linux only). `electron/xwheel-daemon` is the
 *    XI2 capture process the shell spawns on the X11 route (the WSLg wheel
 *    saga — see AGENTS.md and src/wheeloverride.js). It is a BUILD ARTIFACT
 *    (gitignored, compiled by gcc; not a Node native module, so
 *    `npmRebuild` stays false), so it must be compiled BEFORE the app files
 *    are collected — `asarUnpack` then lifts the ELF out of the asar
 *    (spawning from inside an asar cannot work). Tolerant of a missing gcc:
 *    an absent daemon just means "wheel rescue off".
 *
 * WHY `beforePack` and NOT `beforeBuild`: electron-builder only consults
 * `beforeBuild` inside `installAppDependencies`, which RETURNS EARLY when
 * `npmRebuild: false` (our config) — so the old `beforeBuild:` entry in
 * electron-builder.yml was dead code and every packaged Linux artifact
 * shipped without its rescue daemon (and CI's logs never showed the
 * "[before-build] …" line that supposedly came from it). `beforePack` is
 * emitted by platformPackager's `doPack` for every platform pack, BEFORE
 * the app-file walk, regardless of the rebuild flags (verified in
 * app-builder-lib 26.x).
 *
 * Wiring:
 *   - electron-builder.yml: `beforePack: ./scripts/before-pack.cjs`
 *     (the module's exported `beforePack` function runs the guard + the
 *     daemon compile).
 *   - package.json `electron:dev` / `electron:start` prepend
 *     `node scripts/before-pack.cjs` — direct-run mode = daemon compile
 *     ONLY (a dev session has no dist/; the guard would be wrong there).
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const DIST = path.join(root, "dist");
const DAEMON_SRC = path.join(root, "electron", "xwheel-daemon.c");
const DAEMON_BIN = path.join(root, "electron", "xwheel-daemon");

/**
 * assertDist — refuse to package an app that cannot boot: the Vite bundle
 * must exist (`dist/index.html` plus the hashed entry chunk it loads).
 * @param {string} [distDir] The dist root to inspect (tests point this at a
 *   temp fixture instead of the real dist/).
 * @returns {void} Throws a build-failing Error when the bundle is missing or
 *   incomplete; the message names the exact fix.
 */
function assertDist(distDir = DIST) {
  const index = path.join(distDir, "index.html");
  let haveIndex = false;
  try { haveIndex = fs.statSync(index).isFile(); } catch { /* reported below */ }
  if (!haveIndex) {
    throw new Error(
      `Frontend bundle missing: ${index} does not exist.\n` +
      "Packaging now would ship an app that dies at boot with \"The built " +
      "frontend (dist/index.html) was not found.\" (the v1.0.0 installers). " +
      "Build it first:\n" +
      "  npm run build            # vite build -> dist/\n" +
      "  npm run electron:build   # the full flow (vite build + electron-builder)"
    );
  }
  // index.html loads exactly one hashed script chunk (vite.config.js pins
  // codeSplitting:false — the single-bundle invariant); a dist that lost its
  // assets/ tree is just as unbootable as a missing index.html.
  let assets = [];
  try { assets = fs.readdirSync(path.join(distDir, "assets")); } catch { /* reported below */ }
  if (!assets.some((f) => /^index-.*\.js$/.test(f))) {
    throw new Error(
      "Frontend bundle incomplete: no dist/assets/index-*.js entry chunk " +
      `found under ${distDir}.\n` +
      "index.html loads that chunk, so this dist boots to a blank window. " +
      "Re-run `npm run build` and check it emitted the single index-*.js " +
      "asset (vite.config.js pins codeSplitting:false)."
    );
  }
}

/**
 * compileWheelDaemon — (re)compile electron/xwheel-daemon from its C source.
 * Linux only (the rescue targets X11; Windows/macOS have no X server to
 * read) and tolerant of a missing gcc — an absent binary simply disables
 * the wheel rescue, it must never fail the build.
 * @returns {boolean} true when the daemon binary exists afterwards.
 */
function compileWheelDaemon() {
  if (process.platform !== "linux") {
    console.log("[before-pack] xwheel-daemon: not Linux — skip");
    return false;
  }
  try {
    execFileSync("gcc", ["-O2", "-o", DAEMON_BIN, DAEMON_SRC, "-lX11", "-lXi"], { stdio: "inherit" });
    console.log("[before-pack] xwheel-daemon compiled");
    return true;
  } catch {
    console.warn("[before-pack] gcc missing — xwheel-daemon not built (wheel rescue disabled)");
    return false;
  }
}

/**
 * beforePack — the electron-builder hook (see the file header for why this
 * hook rather than `beforeBuild`). Runs before the app-file walk of every
 * platform pack: guard the built frontend, then refresh the wheel daemon so
 * it exists in time for `asarUnpack` to lift it out of the asar.
 * @returns {Promise<void>}
 */
async function beforePack() {
  assertDist();
  console.log(`[before-pack] frontend bundle present (${path.join(DIST, "index.html")})`);
  compileWheelDaemon();
}

module.exports = { beforePack, assertDist, compileWheelDaemon };

// Direct run (`electron:dev` / `electron:start` prepend it): compile the
// daemon for the dev session and stop — no dist/ guard outside packaging.
if (require.main === module) compileWheelDaemon();
