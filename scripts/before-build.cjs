/**
 * before-build.cjs — electron-builder `beforeBuild` hook.
 *
 * Compiles the X-wheel daemon (electron/xwheel-daemon.c) into
 * electron/xwheel-daemon when building on Linux: it is the input rescue the
 * shell spawns on the X11 route (the WSLg wheel saga — see the AGENTS.md
 * main.cjs row and src/wheeloverride.js). Uses plain gcc; this is a build
 * artifact, NOT a Node native module (npmRebuild stays false, the bundle
 * stays one file — the daemon is an auxiliary process, not a module).
 *
 * Other platforms (Windows/macOS) have no X11 wheel to rescue — skip, and do
 * not fail the pixel build when gcc is missing: the app tolerates an absent
 * daemon (rescue simply is off; Chromium's own wheel path remains).
 *
 * Run: electron-builder.yml `beforeBuild: scripts/before-build.cjs`.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const src = path.join(root, "electron", "xwheel-daemon.c");
const out = path.join(root, "electron", "xwheel-daemon");

if (process.platform !== "linux") {
  console.log("[before-build] xwheel-daemon: not Linux — skip");
  process.exit(0);
}
try {
  execFileSync("gcc", ["-O2", "-o", out, src, "-lX11", "-lXi"], { stdio: "inherit" });
  console.log("[before-build] xwheel-daemon compiled");
} catch (e) {
  console.warn("[before-build] gcc missing — xwheel-daemon not built (rescue disabled)");
}
process.exit(0);
