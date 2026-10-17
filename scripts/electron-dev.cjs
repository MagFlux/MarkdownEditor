/**
 * electron-dev.cjs — `npm run electron:dev` orchestrator.
 *
 * Starts the Vite dev server (npm run dev), waits until port 5173 answers,
 * then launches Electron with VITE_DEV_SERVER_URL set so electron/main.cjs
 * loads the dev URL instead of app://dist/index.html (extra CLI arguments
 * are forwarded: `npm run electron:dev -- --md-x11`). Plain Node built-ins
 * only — no concurrently-style extra dependency.
 *
 * RELAUNCH-AWARE TEARDOWN (do not regress): the app's WSLg paint watchdog
 * can `app.relaunch([".", "--md-x11"])` + exit when the first frame cannot
 * be painted (see electron/main.cjs) — and the relaunched process is NOT
 * this orchestrator's child. The historical blind `killVite()` on child
 * exit then killed the dev server while the relaunched window was about to
 * load it: a blank window. So on child exit we briefly probe for another
 * electron of this repo; when one appears (the handoff), vite stays alive
 * and teardown happens only after no instance remains. Win32 keeps the
 * simple path — no wayland there, the relaunch never fires.
 */
const { spawn, execSync } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const PORT = 5173;
const ROOT = path.join(__dirname, "..");

/**
 * wait — sleep for `ms` milliseconds.
 * @param {number} ms The delay.
 * @returns {Promise<void>}
 */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * portOpen — whether something is listening on the dev port.
 * @param {number} port The port to probe.
 * @returns {Promise<boolean>} true when connectable.
 */
function portOpen(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port });
    sock.on("connect", () => { sock.destroy(); resolve(true); });
    sock.on("error", () => resolve(false));
  });
}

/**
 * countElectronInstances — how many Electron processes of THIS repo run
 * (any instance, including a paint-watchdog relaunch). Win32: 0 (no probe;
 * the relaunch never happens there).
 * @returns {Promise<number>} instance count.
 */
function countElectronInstances() {
  if (process.platform === "win32") return Promise.resolve(0);
  try {
    const marker = path.join(ROOT, "node_modules", "electron");
    const out = execSync("ps -eo pid=,args=", { encoding: "utf8" });
    return Promise.resolve(out.split("\n").filter((l) => l.includes(marker)).length);
  } catch { return Promise.resolve(0); }
}

/**
 * detectRelaunch — give a just-exited instance a moment to hand over to a
 * relaunched one (the watchdog relaunch spawns within ~a second).
 * @returns {Promise<boolean>} true when a new instance appeared.
 */
async function detectRelaunch() {
  if (process.platform === "win32") return false;
  for (const ms of [250, 400, 700, 1200, 1600]) {
    await wait(ms);
    if (await countElectronInstances() > 0) return true;
  }
  return false;
}

try { execSync(`kill $(lsof -ti tcp:${PORT}) 2>/dev/null || true`, { stdio: "ignore" }); } catch { /* nothing to kill */ }

const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  cwd: ROOT,
  stdio: "inherit",
  detached: true,
  windowsHide: true,
});

let shuttingDown = false;
/** killVite — terminate the dev server (idempotent). */
function killVite() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { process.kill(-vite.pid); } catch { /* already gone */ }
}

/** main — wait for the dev server, launch Electron, wire teardown. */
async function main() {
  // Wait for the dev server (up to ~30 s), then start the Electron window.
  let ready = false;
  for (let i = 0; i < 150 && vite.exitCode === null; i++) {
    if (await portOpen(PORT)) { ready = true; break; }
    await wait(200);
  }
  if (!ready) {
    console.error("electron:dev — vite dev server did not come up on port " + PORT);
    killVite();
    process.exit(1);
  }

  const electronPath = require("electron");
  const electron = spawn(electronPath, [".", ...process.argv.slice(2)], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, VITE_DEV_SERVER_URL: "http://127.0.0.1:" + PORT },
    windowsHide: true,
  });

  electron.on("exit", async (code) => {
    if (await detectRelaunch()) {
      console.log("[electron:dev] relaunch detected — keeping the dev server alive");
      while (await countElectronInstances() > 0) await wait(1000);
      killVite();
      process.exit(0);
    }
    killVite();
    process.exit(code === null ? 0 : code);
  });
}

main().catch((err) => {
  console.error("electron:dev failed:", err && (err.stack || err));
  killVite();
  process.exit(1);
});
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { killVite(); process.exit(0); });
}
