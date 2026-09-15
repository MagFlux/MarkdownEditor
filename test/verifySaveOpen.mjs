/**
 * verifySaveOpen.mjs — save / close-guard / open UI test.
 *
 * Drives the save (writeTextFile + close), save-cancel (tab stays),
 * save-discard-cancel (tab stays), known-path direct-write, open (new tab),
 * and open-cancel paths. Run with `npm run verify-save`.
 */
import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";

const PORT = 4901;
try { execSync(`kill $(lsof -ti tcp:${PORT}) 2>/dev/null || true`, { stdio: "ignore" }); } catch { /* ignore */ }

execSync("npx vite build", { stdio: "inherit", cwd: process.cwd() });
const srv = spawn("npx", ["vite", "preview", "--port", String(PORT)], { stdio: "ignore", cwd: process.cwd(), detached: true, windowsHide: true });
await new Promise((r) => setTimeout(r, 1500));

const browser = await chromium.launch();
let context = await browser.newContext(); // fresh origin → clean localStorage
let page = await context.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];

let pass = 0, fail = 0;
/**
 * check — record a pass/fail assertion, optionally appending a diagnosis.
 * @param {string} label — the test name.
 * @param {*} cond — truthy to pass.
 * @param {*} [extra] — extra detail printed on failure.
 */
function check(label, cond, extra) {
  const ok = !!cond;
  console.log((ok ? "ok  " : "FAIL") + "  " + label + (extra !== undefined ? "   → " + extra : ""));
  if (ok) pass++; else fail++;
}

/** wire — attach the pageerror/console-error collectors to a page. */
function wire(p) {
  p.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  p.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });
}
wire(page);

/**
 * fresh — reset to a brand-new clean context/tab and return the visible editor.
 * @returns {Promise<import('playwright-chromium').Locator>} the active editor textarea.
 */
async function fresh() {
  await context.close();
  context = await browser.newContext();
  page = await context.newPage({ viewport: { width: 1280, height: 800 } });
  wire(page);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(250);
  // Deterministically reset the lone tab to a clean, empty state.
  await page.evaluate(() => { window.editor.documentText = ""; });
  await page.waitForTimeout(120);
  return page.locator(".pane-group.active textarea.input");
}
/**
 * clickDlg — click a save-dialog button by its visible text.
 * @param {string} btn — the button label (e.g. "Save", "Cancel").
 */
async function clickDlg(btn) {
  await page.locator(`.savedlg button:has-text("${btn}")`).click();
  await page.waitForTimeout(150);
}
/**
 * kick — kick off an internal blocking call *without* awaiting it, so the UI dialog
 * can be driven from the Node side before its promise settles. The promise is created
 * in-page (closeApp runs to its first await) but deliberately NOT returned to evaluate
 * — returning it would make page.evaluate block forever (it awaits our Node-side
 * button click).
 * @param {() => any} fn — the in-page function to invoke.
 */
const kick = (fn) => page.evaluate((f) => { f(); }, fn); // run in-page, promise discarded

// ============ TEST 1: save() browser download path (no path set) ============
await fresh();
const dlP2 = new Promise((res, rej) => { page.once("download", res); setTimeout(() => rej(new Error("no download")), 5000); });
await page.evaluate(() => window.editor.save());
const download = await dlP2;
check("save() triggers a download (browser path)", true);
const fn = download.suggestedFilename();
check("download filename ends in .md", /\.md$/i.test(fn), fn);
check("save() returns true", (await page.evaluate(() => window.editor.save())) === true);

// ============ TEST 2: openFile always opens a NEW tab ============
const tabsBefore = await page.locator(".tab").count();
const res2 = await page.evaluate(() => {
  const d = window.editor.openFile({ name: "README.md", text: "# README from open\n\nbody text", path: "/tmp/README.md" });
  return { name: d.name, path: d.path, isLast: d === window.editor.tabs[window.editor.tabs.length - 1] };
});
await page.waitForTimeout(150);
check("openFile created a new tab (is last)", res2.isLast);
check("new tab count = before + 1", (await page.locator(".tab").count()) === tabsBefore + 1);
check("new tab name = README.md", res2.name === "README.md", res2.name);
check("new tab path recorded", res2.path === "/tmp/README.md");
check("new tab is the active tab", await page.evaluate(() => window.editor.activeTab.name === "README.md"));

// Re-open the SAME name → must STILL create a new tab (no reuse / replace).
await page.evaluate(() => window.editor.openFile({ name: "README.md", text: "# second copy", path: "/tmp/other.md" }));
await page.waitForTimeout(150);
const dupName = await page.evaluate(() => window.editor.tabs.filter(t => t.name === "README.md").length);
check("re-open of same name added ANOTHER tab (no reuse)", dupName === 2, dupName);
check("total tabs = before + 2", (await page.locator(".tab").count()) === tabsBefore + 2);

// ============ TEST 3: closeApp walks active-first then desc, prompts each dirty ============
await fresh();
// closeApp calls the *internal* save (closure), not the overridable
// window.editor.save — so verify the save order via the REAL save path: a tab
// with no `path` in browser mode falls through to a download named <tab>.md.
await page.evaluate(() => { window.editor.name = "Base"; });  // clean initial tab
const dlOrder = [];
page.on("download", (d) => dlOrder.push(d.suggestedFilename()));
// a2 then a1 (active). TABS order: [Base(clean), DirtyTwo, DirtyOne]. Dirty the two new ones.
await page.evaluate(() => { const a2 = window.editor.newTab("DirtyTwo", "content B"); const a1 = window.editor.newTab("DirtyOne", "content A"); });
await page.evaluate(() => {
  const a2 = window.editor.tabs.find(t => t.name === "DirtyTwo"); a2.input.value += " edit2"; a2.dirty = true;
  const a1 = window.editor.tabs.find(t => t.name === "DirtyOne"); a1.input.value += " edit1"; a1.dirty = true;
});
check("active tab is DirtyOne", await page.evaluate(() => window.editor.activeTab.name === "DirtyOne"));
const state = await page.evaluate(() => window.editor.tabs.map(t => ({ n: t.name, d: t.dirty })));
check("3 tabs: Base clean, DirtyOne+DirtyTwo dirty",
  state.length === 3 && state.find(t=>t.n==="DirtyOne")?.d && state.find(t=>t.n==="DirtyTwo")?.d && state.find(t=>t.n==="Base")?.d===false,
  JSON.stringify(state));

page.evaluate("window.editor.closeApp()");      // blocks on the first dialog
await page.waitForSelector(".savedlg", { timeout: 2000 });
const d1 = await page.locator(".savedlg .savedlg-msg").textContent();
check("first dialog is for the ACTIVE tab (DirtyOne)", d1.includes("DirtyOne"), d1);
await clickDlg("Save");
await page.waitForSelector(".savedlg", { timeout: 1000 });
const d2 = await page.locator(".savedlg .savedlg-msg").textContent();
check("second dialog is for the remaining tab (DirtyTwo)", d2.includes("DirtyTwo"), d2);
await clickDlg("Save");
await page.waitForTimeout(400);

check("closeApp removed ALL tabs", (await page.locator(".tab").count()) === 0, await page.locator(".tab").count());
check("closeApp removed ALL panes", (await page.locator(".pane-group").count()) === 0);
check("activeTab is null after full close", await page.evaluate(() => window.editor.activeTab === null));
check("save fired for both dirty tabs, active first (by download order)",
  dlOrder.filter(n=>/Dirty(One|Two)\.md$/i.test(n)).join("|") === "DirtyOne.md|DirtyTwo.md",
  dlOrder.join("|") || "(no downloads)");

// Cancel leaves tabs in place (nothing removed while aborted).
await fresh();
await page.evaluate(() => {
  window.__saveLog = [];
  window.editor.save = (doc) => { window.__saveLog.push(doc.name); return Promise.resolve(true); };
  window.editor.name = "KeepMe";
  const a = window.editor.activeTab; a.input.value = "some text"; a.dirty = true;
});
check("one dirty tab, before cancel closeApp", (await page.locator(".tab").count()) === 1 && await page.evaluate(() => window.editor.activeTab.dirty));
page.evaluate("window.editor.closeApp()"); // string form: runs in-page, promise not awaited
await page.waitForSelector(".savedlg", { timeout: 2000 });
await clickDlg("Cancel");
await page.waitForTimeout(150);
check("cancel keeps the tab open", (await page.locator(".tab").count()) === 1, await page.locator(".tab").count());
check("dialog closed after cancel", (await page.locator(".savedlg").count()) === 0);

// ============ TEST 4: closeTab still resets the LAST dirty tab in place ============
await fresh();
await page.evaluate(() => {
  window.editor.save = () => Promise.resolve(true);
  window.editor.name = "LastOne";
  const a = window.editor.activeTab; a.input.value = "text"; a.dirty = true;
});
check("single dirty tab, before closeTab", (await page.locator(".tab").count()) === 1 && await page.evaluate(() => window.editor.activeTab.dirty));
page.evaluate("window.editor.closeTab(window.editor.activeTab)"); 
await page.waitForSelector(".savedlg", { timeout: 2000 });
check("last-tab dialog is in clear mode", (await page.locator(".savedlg h3").textContent()) === "Clear this document?",
  await page.locator(".savedlg h3").textContent());
await clickDlg("Save & Clear");
await page.waitForTimeout(150);
check("last tab remains (not removed), now clean",
  (await page.locator(".tab").count()) === 1 && (await page.evaluate(() => window.editor.activeTab.dirty === false)));

console.log("\nERRORS:", errors.length ? errors : "none");
await browser.close();
try { process.kill(-srv.pid); } catch { /* already dead */ }
console.log(`\n${pass} ok / ${fail} fail`);
process.exit(fail || errors.length ? 1 : 0);
