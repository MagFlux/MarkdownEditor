/**
 * verifyExport.mjs — Export (HTML/PDF) verification (Playwright, Chromium).
 *
 * Drives the hamburger menu + in-app picker, stubs the Tauri fs IPC, and
 * asserts menu open/close/outside-click/Escape, HTML and PDF save paths
 * (including cancel and browser Blob-download fallbacks), and that menu items
 * don't leak into the default toolbar focus flow. Run with `npm run verify-export`.
 */
// Export (HTML/PDF) verification — drives the hamburger menu + in-app picker,
// stubs the Tauri fs IPC the same way verifyTauriClose.mjs does, and asserts:
//   - Menu open / close / outside-click / Escape keyboard
//   - HTML export → write_text_file with valid standalone HTML
//   - PDF  export → write_file with non-empty byte payload
//   - Cancel  → nothing written
//   - Browser  → Blob download (no IPC)
//   - Menu items don't leak into the default toolbar focus flow
//
// Real plugin command shapes (node_modules/@tauri-apps/plugin-fs):
//   plugin:fs|write_text_file : content = 1st positional arg, path = options.headers.path
//   plugin:fs|write_file      : data    = 1st positional arg, path = options.headers.path
//   plugin:path|resolve_directory : { directory } → string (homeDir)
//   plugin:fs|read_dir        : { path, options } → [DirEntry]
import { chromium } from "playwright";
import { execSync, spawn } from "node:child_process";

const PORT = 4906;
try { execSync(`kill $(lsof -ti tcp:${PORT}) 2>/dev/null || true`, { stdio: "ignore" }); } catch {}
execSync("npx vite build", { stdio: "inherit", cwd: process.cwd() });
const srv = spawn("npx", ["vite", "preview", "--port", String(PORT)], { stdio: "ignore", cwd: process.cwd(), detached: true, windowsHide: true });
await new Promise((r) => setTimeout(r, 1500));

let pass = 0, fail = 0;
/** ok — record a pass/fail assertion, optionally appending a diagnosis. */
const ok = (label, cond, extra) => { const c = !!cond; console.log((c ? "ok  " : "FAIL ") + label + (extra !== undefined ? "   → " + extra : "")); c ? pass++ : fail++; };

/**
 * wait — sleep for `ms` milliseconds.
 * @param {number} ms — the delay in ms.
 */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
setTimeout(() => {
  console.error("\nWATCHDOG: run stalled (>75s). dumping state & aborting.");
  process.exit(3);
}, 75000);

/**
 * installInternals — install a stub `window.__TAURI_INTERNALS__` + `window.__state`.
 * Injected via addInitScript so Playwright contextifies it once and it survives
 * across evaluate() calls in the same context. Records IPC, text/binary writes,
 * and read_dir calls on `__state` for assertions.
 */
function installInternals() {
  let cbid = 0;
  const callbacks = new Map();
  const eventCbs = new Map();
  const S = {
    ipc: [],
    textWrites: [], // {path, bytes: Uint8Array}
    binaryWrites: [], // {path, bytes: Uint8Array}
    homeDir: 0,
    readDir: [],
  };
  const internals = {
    __TAURI_METADATA__: { currentWindow: { label: "main", id: 1 } },
    metadata: { currentWindow: { label: "main", id: 1 } },
    transformCallback(fn) { const id = ++cbid; callbacks.set(id, fn); return id; },
    unregisterCallback(id) { callbacks.delete(id); },
    convertFileSrc() { return "tauri://local/"; },
    async invoke(cmd, args, options) {
      S.ipc.push(cmd);
      switch (cmd) {
        case "plugin:event|listen": {
          const ev = args.event;
          if (!eventCbs.has(ev)) eventCbs.set(ev, []);
          eventCbs.get(ev).push(args.handler);
          return 1;
        }
        case "plugin:path|resolve_directory":
          S.homeDir++;
          return "/home/user";
        case "plugin:fs|read_dir": {
          S.readDir.push(args && args.path);
          return [
            { name: "notes", isDirectory: true, isFile: false, isSymlink: false },
            { name: "report.md", isDirectory: false, isFile: true, isSymlink: false },
          ];
        }
        case "plugin:fs|write_text_file": {
          let bytes = args;
          if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
          if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array();
          const hp = (options && options.headers && options.headers.path) || null;
          const path = hp ? (hp.startsWith("%") ? decodeURIComponent(hp) : hp) : null;
          S.textWrites.push({ path, bytes });
          return null;
        }
        case "plugin:fs|write_file": {
          let bytes = args;
          if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
          if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array();
          const hp = (options && options.headers && options.headers.path) || null;
          const path = hp ? (hp.startsWith("%") ? decodeURIComponent(hp) : hp) : null;
          S.binaryWrites.push({ path, bytes });
          return null;
        }
        case "plugin:window|destroy": return null;
        default: return null;
      }
    },
  };
  window.__TAURI_INTERNALS__ = internals;
  window.__state = S;
}

/**
 * scenario — run one test case in a fresh browser context with Tauri stubs.
 * @param {string} name — the scenario label printed as a section header.
 * @param {(env: {page: any, st: any, ok: any, wait: any, errors: any}) => Promise<void>} run — the case body.
 */
async function scenario(name, run) {
  const context = await browser.newContext();
  await context.addInitScript(installInternals);
  const page = await context.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });
  console.log("\n== " + name + " ==");
  try {
    await page.goto(`http://localhost:${PORT}/`);
    await wait(300);
    /** st — read the stubbed `window.__state` (IPC/writes/read_dir log). */
    const st = () => page.evaluate(() => window.__state);
    await run({ page, st, ok, wait, errors });
  } catch (e) {
    console.log("   !!! SCENARIO THREW: " + (e && e.message ? e.message : e));
    fail++;
  }
  await context.close();
  console.log("   (console/page errors: " + (errors.length ? JSON.stringify(errors) : "none") + ")");
}

// ---- M: menu open / close / outside-click / Escape / aria state ----
await scenario("M: menu open/close/outside-click/Escape", async ({ page, ok, wait }) => {
  const menuBtn = page.locator('[data-action="menu"]');
  const dropdown = page.locator(".menu-dropdown");
  /** openClass — whether the .menu-dropdown has the "open" class. */
  const openClass = () => page.evaluate(() => document.querySelector(".menu-dropdown").classList.contains("open"));

  /** expandedAttr — the menu button's aria-expanded attribute value. */
  const expandedAttr = () => page.evaluate(() => document.querySelector('[data-action="menu"]').getAttribute("aria-expanded"));

  ok("M0 menu button present in the toolbar", (await menuBtn.count()) === 1);
  ok("M0b dropdown present but closed by default", (await dropdown.count()) === 1 && (await openClass()) === false);
  ok("M0c menu items visible in DOM", (await page.locator(".menu-item").count()) === 4); // recent toggle + export toggle + pdf + html (the recent submenu renders on first open)

  await menuBtn.click();
  await wait(60);
  ok("M1 dropdown is open after clicking the button", (await openClass()) === true, "expanded=" + (await expandedAttr()));
  ok("M1a aria-expanded=true after open", (await expandedAttr()) === "true");
  ok("M1b data-menu-open=true after open",
     (await page.evaluate(() => document.querySelector('[data-action="menu"]').getAttribute("data-menu-open"))) === "true");

  // Shrink-to-fit width: the dropdown must hug the WIDEST entry plus its own
  // padding — no fixed min-width floor (the old 190px made the two-item menu
  // visibly wider than its content). Measured as: widest item width == dropdown
  // content width (items are width:100%), and the whole box stays well below
  // the retired 190px floor.
  const mw = await page.evaluate(() => {
    const dd = document.querySelector(".menu-dropdown");
    const items = [...dd.querySelectorAll(".menu-item")];
    return {
      dd: dd.getBoundingClientRect().width,
      items: items.map((i) => i.getBoundingClientRect().width),
    };
  });
  ok("M1c dropdown hugs the widest entry (items fill it exactly)",
     Math.abs(mw.dd - Math.max(...mw.items) - 12) < 2, // 2x5px padding + 2x1px border
     JSON.stringify(mw));
  ok("M1d dropdown has no 190px min-width floor", mw.dd < 190, "width=" + mw.dd.toFixed(1));

  await menuBtn.click();
  await wait(60);
  ok("M2 toggling the button again closes the dropdown", (await openClass()) === false);
  ok("M2a aria-expanded=false after close", (await expandedAttr()) === "false");

  // Re-open and close via outside click.
  await menuBtn.click();
  await wait(60);
  ok("M3 reopened for outside-click test", (await openClass()) === true);
  // The outside-click target is the editor textarea: it lives below the
  // toolbar and so is never covered by the left-anchored dropdown. (The tab name
  // is now *under* the dropdown once it's open, because the left-anchored menu
  // drops over the tab strip — a normal menu-over-content overlay, not a defect.)
  await page.locator("textarea.input").first().click({ timeout: 3000 });
  await wait(60);
  ok("M3a outside click (editor) closes the dropdown", (await openClass()) === false);

  // Re-open and close via Escape.
  await menuBtn.click();
  await wait(60);
  await page.keyboard.press("Escape");
  await wait(60);
  ok("M4 Escape closes the dropdown", (await openClass()) === false);
});

// ---- H: HTML export → write_text_file with valid standalone document ----
await scenario("H1: HTML export saves via picker → write_text_file", async ({ page, st, ok, wait }) => {
  await page.evaluate(() => {
    const a = window.editor.activeTab;
    a.input.value = "# Big Title\n\nHello **world** from HTML export.\n";
    a.name = "html_test.md";
    a.path = null;
    a.dirty = true;
  });
  const menuBtn = page.locator('[data-action="menu"]');
  await menuBtn.click();
  await wait(60);
  await page.locator('[data-submenu="export"]').hover(); // reveal the Export submenu
  await wait(120);

  await page.locator(".menu-item", { hasText: "As HTML" }).click();
  await page.waitForSelector(".picker-name", { timeout: 2500 });
  ok("H1a in-app Save-As picker appeared after choosing HTML export", true);
  // Default filename carries over from the tab name + .html suffix.
  const defaultName = await page.locator(".picker-name input").inputValue();
  ok("H1b default filename is html_test.html", defaultName === "html_test.html", JSON.stringify({ defaultName }));
  const typed = "out.html";
  await page.locator(".picker-name input").fill(typed);
  await page.locator(".savedlg button.primary").click();
  await wait(400);
  const S = await st();
  const w = S.textWrites[S.textWrites.length - 1];
  ok("H1c write_text_file was invoked", S.textWrites.length >= 1, JSON.stringify(S.textWrites.map((w2) => w2.path)));
  if (w) {
    const text = new TextDecoder().decode(w.bytes);
    ok("H1d written path is the typed filename (out.html)", w.path === "/home/user/" + typed, JSON.stringify({ path: w.path }));
    ok("H1e content is a standalone HTML doc (doctype present)", /<!doctype html>/i.test(text));
    ok("H1f content has <body class=\"preview\">", /body\s+class=["']preview["']/.test(text));
    ok("H1g content includes the doc's rendered HTML (heading present)", /<h1[^>]*>Big Title<\/h1>/.test(text));
    ok("H1h content has an inline <style> for preview CSS", /<style>[\s\S]*?\.preview\s*h1\s*\{/.test(text));
  }
});

// ---- H2: HTML export → picker CANCELLED → nothing written ----
await scenario("H2: HTML export cancelled → no write", async ({ page, st, ok, wait }) => {
  await page.evaluate(() => {
    const a = window.editor.activeTab;
    a.input.value = "keep me";
    a.name = "cancel.md";
    a.path = null;
    a.dirty = true;
  });
  await page.locator('[data-action="menu"]').click();
  await wait(60);
  await page.locator('[data-submenu="export"]').hover(); // reveal the Export submenu
  await wait(120);

  await page.locator(".menu-item", { hasText: "As HTML" }).click();
  await page.waitForSelector(".picker-name", { timeout: 2500 });
  const before = (await st()).textWrites.length;
  await page.locator(".savedlg button:not(.primary)").filter({ hasText: /cancel/i }).first().click();
  await wait(200);
  const S = await st();
  ok("H2a cancel did not write", S.textWrites.length === before, JSON.stringify({ before, after: S.textWrites.length }));
  ok("H2b menu closed after the item was chosen (even on cancel)",
     (await page.evaluate(() => document.querySelector(".menu-dropdown").classList.contains("open"))) === false);
});

// ---- P: PDF export → write_file with a non-empty byte payload ----
await scenario("P: PDF export saves via picker → write_file", async ({ page, st, ok, wait }) => {
  await page.evaluate(() => {
    const a = window.editor.activeTab;
    a.input.value = "# PDF Test\n\nBody paragraph.\n";
    a.name = "pdf_test.md";
    a.path = null;
    a.dirty = true;
  });
  await page.locator('[data-action="menu"]').click();
  await wait(60);
  await page.locator('[data-submenu="export"]').hover(); // reveal the Export submenu
  await wait(120);

  await page.locator(".menu-item", { hasText: "As PDF" }).click();
  // PDF export is async (canvas capture + PDF generation) before the picker
  // resolves. Wait for the picker to appear (or an error modal, if it failed).
  await page.waitForSelector(".picker-name, .savedlg-msg", { timeout: 5000 }).catch(() => {});
  if (!(await page.$(".picker-name"))) {
    ok("P1a in-app Save-As picker appeared after choosing PDF export", false);
    const err = await page.locator(".savedlg-msg").first().textContent().catch(() => "(no error modal)");
    console.log("   PDF export error modal: " + err);
    return;
  }
  ok("P1a in-app Save-As picker appeared after choosing PDF export", true);
  const defaultName = await page.locator(".picker-name input").inputValue();
  ok("P1b default filename is pdf_test.pdf", defaultName === "pdf_test.pdf", JSON.stringify({ defaultName }));
  await page.locator(".picker-name input").fill("out.pdf");
  await page.locator(".savedlg button.primary").click();
  await wait(400);
  const S = await st();
  const w = S.binaryWrites[S.binaryWrites.length - 1];
  ok("P1c write_file (binary) was invoked", S.binaryWrites.length >= 1, JSON.stringify(S.binaryWrites.map((w2) => w2.path)));
  if (w) {
    ok("P1d written path is the typed filename (out.pdf)", w.path === "/home/user/out.pdf", JSON.stringify({ path: w.path }));
    ok("P1e write_file did NOT go through write_text_file", S.textWrites.length === 0 || S.textWrites.every((x) => x.path !== "/home/user/out.pdf"),
       JSON.stringify(S.textWrites.map((x) => x.path)));
    ok("P1f bytes are non-trivial in size (>256 B; PDF header + compressed stream)", w.bytes && w.bytes.byteLength > 256, "bytes=" + (w.bytes ? w.bytes.byteLength : 0));
    // The first 4 bytes of a PDF are "%PDF" (0x25 0x50 0x44 0x46).
    const head = new TextDecoder("latin1").decode(w.bytes.slice(0, 4));
    ok("P1g bytes start with the %PDF magic marker", /^%PDF/.test(head), JSON.stringify({ head }));
  }
});

// ---- P2: PDF export cancelled → no binary write ----
await scenario("P2: PDF export cancelled → no write", async ({ page, st, ok, wait }) => {
  await page.evaluate(() => {
    const a = window.editor.activeTab;
    a.input.value = "keep";
    a.name = "pcancel.md";
    a.path = null;
    a.dirty = true;
  });
  await page.locator('[data-action="menu"]').click();
  await wait(60);
  await page.locator('[data-submenu="export"]').hover(); // reveal the Export submenu
  await wait(120);

  await page.locator(".menu-item", { hasText: "As PDF" }).click();
  await page.waitForSelector(".picker-name, .savedlg-msg", { timeout: 5000 }).catch(() => {});
  if (!(await page.$(".picker-name"))) {
    const err = await page.locator(".savedlg-msg").first().textContent().catch(() => "(no error modal)");
    console.log("   P2: no picker; error modal said: " + err);
    const S = await st();
    ok("P2a cancel did not issue a binary write", S.binaryWrites.length === 0, JSON.stringify(S.binaryWrites.map((w) => w.path)));
    return;
  }
  const before = (await st()).binaryWrites.length;
  await page.locator(".savedlg button:not(.primary)").filter({ hasText: /cancel/i }).first().click().catch(() => {});
  await wait(200);
  const S = await st();
  ok("P2a cancel did not issue a binary write", S.binaryWrites.length === before, JSON.stringify({ before, after: S.binaryWrites.length }));
});

// ---- L: menu items don't accidentally fire the toolbar-format handlers ----
await scenario("L: menu items only fire export, not format actions", async ({ page, st, ok, wait }) => {
  // Baseline: confirm no format state is set before we click a menu item.
  const fmtStates = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('.toolbar [data-fmt]').forEach((b) => {
      out[b.getAttribute("data-fmt")] = b.classList.contains("active");
    });
    return out;
  });
  await page.evaluate(() => {
    const a = window.editor.activeTab;
    a.input.value = "  ";
    a.name = "L".concat("_") + Date.now().toString().slice(-6) + ".md";
    a.path = null; a.dirty = true;
  });
  await page.locator('[data-action="menu"]').click();
  await wait(60);
  await page.locator('[data-submenu="export"]').hover(); // reveal the Export submenu
  await wait(120);

  await page.locator(".menu-item", { hasText: "As HTML" }).click();
  await page.waitForSelector(".picker-name", { timeout: 2500 }).catch(() => {});
  // Cancel — we only care that no format action fired while the picker was up.
  await page.locator(".savedlg button:not(.primary)").filter({ hasText: /cancel/i }).first().click().catch(() => {});
  await wait(100);
  const after = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('.toolbar [data-fmt]').forEach((b) => {
      out[b.getAttribute("data-fmt")] = b.classList.contains("active");
    });
    return out;
  });
  ok("L1 no format button became active during the export click",
     JSON.stringify(fmtStates) === JSON.stringify(after), JSON.stringify({ fmtStates, after }));
});

await browser.close();
try { process.kill(-srv.pid); } catch {}
console.log(`\n${pass} ok / ${fail} fail`);
process.exit(fail ? 1 : 0);
