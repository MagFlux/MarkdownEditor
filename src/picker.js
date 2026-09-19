/**
 * picker.js — in-app filesystem picker for Save and Open operations.
 *
 * Directory reads and home resolution are injected so the picker remains a
 * small UI service while the app retains control of native/browser routing.
 */

/**
 * createPathPicker — build a Save/Open picker backed by Tauri fs calls.
 * @param {object} deps Picker dependencies.
 * @param {Function} deps.showModalBase In-app modal factory.
 * @param {Function} deps.readDir Native directory reader.
 * @param {Function} deps.homeDir Native home-directory resolver.
 * @param {Function} deps.isTauri Native-runtime predicate.
 * @returns {{pickPath: Function}} The picker operation.
 */
export function createPathPicker({ showModalBase, readDir, homeDir, isTauri }) {
  /**
   * pickPath — show a centered Save/Open filesystem picker.
   * Detects the platform path separator from the initial cwd (backslash on
   * Windows, forward-slash elsewhere) and uses it consistently for all path
   * joining, crumb reconstruction, and go-up navigation. Without this, Windows
   * paths like "C:\Users\…" get joined with "/" producing "/C:\Users\…" which
   * the OS rejects (os error 123).
   * @param {object} [opts] Mode, filename, directory, and extension filters.
   * @returns {Promise<{path:string|null,name?:string}>} Selected path or cancel.
   */
  function pickPath(opts = {}) {
    const mode = opts.mode === "open" ? "open" : "save";
    const extensions = new Set((opts.filters || [{ extensions: ["md", "markdown", "txt"] }])
      .flatMap((filter) => filter.extensions || [])
      .map((ext) => String(ext).replace(/^\./, "").toLowerCase()).filter(Boolean));
    const matchesExt = (name) => {
      const dot = String(name).lastIndexOf(".");
      return dot > 0 && extensions.has(String(name).slice(dot + 1).toLowerCase());
    };

    return new Promise(async (resolve) => {
      const modal = showModalBase({ label: mode === "save" ? "Choose a location to save to" : "Open a file" });
      const { box, finish } = modal;
      const heading = document.createElement("h3");
      heading.textContent = mode === "save" ? "Save to…" : "Open…";
      const pathbar = document.createElement("div");
      pathbar.className = "picker-pathbar";
      const list = document.createElement("ul");
      list.className = "picker-list";
      list.setAttribute("role", "listbox");
      const nameRow = document.createElement("div");
      nameRow.className = "picker-name";
      let nameInput = null;
      if (mode === "save") {
        const label = document.createElement("label");
        label.textContent = "Name:";
        nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.value = opts.defaultFilename || "untitled.md";
        nameInput.setAttribute("spellcheck", "false");
        nameRow.append(label, nameInput);
      }
      const status = document.createElement("div");
      status.className = "picker-status";
      status.setAttribute("aria-live", "polite");
      const setStatus = (text, kind) => {
        status.textContent = text || "";
        if (kind) status.dataset.kind = kind; else status.removeAttribute("data-kind");
      };
      const actions = document.createElement("div");
      actions.className = "savedlg-btns";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "btn";
      cancel.textContent = "Cancel";
      const confirm = document.createElement("button");
      confirm.type = "button";
      confirm.className = "btn primary";
      confirm.textContent = mode === "save" ? "Save" : "Open";
      actions.append(cancel, confirm);
      box.append(heading, pathbar, list);
      if (nameInput) box.append(nameRow);
      box.append(status, actions);

      let cwd = opts.defaultDir || null;
      if (!cwd) { try { cwd = await homeDir(); } catch (_) { cwd = null; } }
      if (cwd) { try { cwd = decodeURIComponent(String(cwd)); } catch (_) {} }
      // Detect the platform path separator from the initial cwd. Windows paths
      // like "C:\Users\…" use "\"; everything else uses "/". All path joining
      // below must use SEP or we produce mixed-slash paths ("/C:\Users\…") that
      // Windows rejects with os error 123.
      const SEP = String(cwd || "").includes("\\") ? "\\" : "/";
      const ROOT = SEP === "\\" ? "" : "/";
      cwd = String(cwd || SEP).replace(new RegExp("[" + SEP.replace("\\", "\\\\") + "]+$"), "") || SEP;
      const state = { cwd, picked: null };
      let token = 0;
      let settled = false;
      const done = (result) => {
        if (settled) return;
        settled = true;
        finish();
        resolve(result);
      };
      if (!window.__pickCtrlGlyphs) {
        window.__pickCtrlGlyphs = {
          HOME: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10l9-7 9 7v11a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z"/></svg>',
          UP: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
        };
      }
      const control = (key, label, action) => {
        const el = document.createElement("span");
        el.className = "ctrl";
        el.setAttribute("role", "button");
        el.tabIndex = 0;
        el.title = label;
        el.setAttribute("aria-label", label);
        el.innerHTML = window.__pickCtrlGlyphs[key.toUpperCase()];
        el.addEventListener("click", action);
        el.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); action(); }
        });
        return el;
      };
      const goToDir = async (dir) => {
        const current = ++token;
        const loadingTimer = setTimeout(() => {
          if (current === token) setStatus("Loading…");
        }, 2000);
        let entries;
        try { entries = await readDir(dir); }
        catch (error) {
          clearTimeout(loadingTimer);
          if (current === token) setStatus("Cannot read " + dir + " — " + ((error && (error.message || error)) || "error"), "error");
          return;
        }
        clearTimeout(loadingTimer);
        if (current !== token) return;
        state.cwd = dir;
        state.picked = null;
        renderCrumb();
        render(entries);
        setStatus("");
      };
      const goHome = async () => {
        if (!isTauri()) return;
        let home = null;
        try { home = await homeDir(); } catch (_) { return; }
        if (!home) return;
        try { home = decodeURIComponent(String(home)); } catch (_) {}
        goToDir(String(home).replace(/[\\/]+$/, "") || SEP);
      };
      const goUp = () => {
        if (state.cwd === ROOT || state.cwd === SEP) return;
        const parent = state.cwd.split(SEP).slice(0, -1).join(SEP);
        // On Windows "C:" alone is the drive root; on Unix "" means "/".
        goToDir(parent || (SEP === "\\" ? state.cwd.split(SEP)[0] + SEP : "/"));
      };
      const renderCrumb = () => {
        pathbar.innerHTML = "";
        pathbar.append(control("home", "Home directory", goHome), control("up", "Go up", goUp));
        const parts = state.cwd.split(SEP).filter(Boolean);
        if (!parts.length) {
          const root = document.createElement("span");
          root.className = "crumb-cur";
          root.textContent = SEP === "\\" ? state.cwd : "/";
          pathbar.append(root);
          return;
        }
        parts.forEach((part, index) => {
          const crumb = document.createElement("span");
          crumb.textContent = part;
          // On Windows the first segment is the drive ("C:") — join from there
          // without a leading slash. On Unix prepend "/" as before.
          const prefix = SEP === "\\" ? "" : "/";
          crumb.dataset.crumb = prefix + parts.slice(0, index + 1).join(SEP);
          if (index === parts.length - 1) crumb.className = "crumb-cur";
          crumb.addEventListener("click", () => goToDir(crumb.dataset.crumb));
          pathbar.append(crumb);
          if (index < parts.length - 1) {
            const separator = document.createElement("span");
            separator.className = "sep";
            separator.textContent = SEP;
            pathbar.append(separator);
          }
        });
      };
      const confirmFile = (name) => done({ path: state.cwd + SEP + name, name });
      const render = (entries) => {
        list.innerHTML = "";
        if (!Array.isArray(entries) || !entries.length) {
          const empty = document.createElement("li");
          empty.textContent = "(no folders or files here)";
          empty.style.color = "var(--fg-dim)";
          empty.style.cursor = "default";
          list.append(empty);
          setStatus("Empty: " + state.cwd);
          return;
        }
        const isDir = (entry) => entry && (entry.isDirectory || entry.is_directory || entry.is_dir);
        const isFile = (entry) => entry && (entry.isFile || entry.is_file);
        const sorted = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: "base" });
        const fragment = document.createDocumentFragment();
        for (const entry of entries.filter(isDir).sort(sorted)) {
          const item = document.createElement("li");
          item.setAttribute("role", "option");
          item.dataset.name = entry.name;
          item.innerHTML = '<span class="glyph">\u25B8</span><span class="dir"></span>';
          item.lastElementChild.textContent = entry.name;
          item.addEventListener("click", () => goToDir(state.cwd + SEP + entry.name));
          fragment.append(item);
        }
        for (const entry of entries.filter(isFile).sort(sorted)) {
          const item = document.createElement("li");
          item.setAttribute("role", "option");
          item.dataset.name = entry.name;
          item.innerHTML = '<span class="glyph">\u2013</span><span class="fname"></span>';
          item.lastElementChild.textContent = entry.name;
          if (mode === "save" && !matchesExt(entry.name)) item.style.color = "var(--fg-dim)";
          item.addEventListener("click", () => {
            state.picked = entry.name;
            if (nameInput) nameInput.value = entry.name;
            list.querySelectorAll("li.sel").forEach((selected) => selected.classList.remove("sel"));
            item.classList.add("sel");
          });
          item.addEventListener("dblclick", () => confirmFile(entry.name));
          fragment.append(item);
        }
        list.append(fragment);
        setStatus(entries.filter(isDir).length + " folder" + (entries.filter(isDir).length === 1 ? "" : "s"), "ok");
      };
      const onConfirm = () => {
        if (mode === "save") {
          const value = (nameInput.value || "").trim();
          if (!value) { setStatus("Name is required", "warn"); nameInput.focus(); return; }
          if (/[\\/]/.test(value)) { done({ path: value, name: value.split(/[\\/]/).filter(Boolean).pop() || value }); return; }
          done({ path: state.cwd + SEP + value, name: value });
          return;
        }
        if (!state.picked) { setStatus("Select a file first", "warn"); return; }
        confirmFile(state.picked);
      };
      confirm.addEventListener("click", onConfirm);
      cancel.addEventListener("click", () => done({ path: null }));
      nameInput?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); onConfirm(); }
      });
      renderCrumb();
      goToDir(state.cwd);
      const focusTarget = mode === "save" ? nameInput : list;
      if (focusTarget && focusTarget.focus) requestAnimationFrame(() => focusTarget.focus());
    });
  }
  return { pickPath };
}
