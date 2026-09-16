/**
 * dialogs.js — centered in-app dialogs used by the editor.
 *
 * These primitives replace native GTK dialogs and are intentionally independent
 * of editor state. Filesystem-aware overwrite confirmation is supplied through
 * callbacks so the browser fallback remains available.
 */

/**
 * createDialogHandlers — create modal, unsaved-changes, and overwrite dialogs.
 * @param {object} deps Dialog dependencies.
 * @param {Function} deps.isTauri Return whether native filesystem APIs are active.
 * @param {Function} deps.exists Check whether a native destination exists.
 * @returns {{showSaveDiscardDialog: Function, showModalBase: Function, messageModal: Function, confirmOverwrite: Function, confirmOverwriteIfNeeded: Function}}
 */
export function createDialogHandlers({ isTauri, exists }) {
  /**
   * showModalBase — open a centered, focus-trapping in-app modal.
   * @param {object} [opts] Modal options.
   * @returns {{box: Element, finish: Function, promise: Promise<any>}} Modal handle.
   */
  function showModalBase({ label, closeOnBackdrop = false, focusEl } = {}) {
    const backdrop = document.createElement("div");
    backdrop.className = "savedlg-backdrop";
    const box = document.createElement("div");
    box.className = "savedlg";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    if (label) box.setAttribute("aria-label", label);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);

    let done = false;
    const handle = { box, finish: null, promise: null };
    handle.promise = new Promise((resolve) => {
      handle.finish = (value) => {
        if (done) return;
        done = true;
        if (backdrop._onBackdrop) backdrop.removeEventListener("mousedown", backdrop._onBackdrop, true);
        window.removeEventListener("keydown", handle._onKey, true);
        box.removeEventListener("keydown", handle._onTab, true);
        backdrop.remove();
        resolve(value);
      };
      if (closeOnBackdrop) {
        backdrop._onBackdrop = (ev) => { if (ev.target === backdrop) handle.finish(undefined); };
        backdrop.addEventListener("mousedown", backdrop._onBackdrop, true);
      }
      handle._onKey = (ev) => {
        if (ev.key === "Escape") { ev.preventDefault(); handle.finish(undefined); }
      };
      window.addEventListener("keydown", handle._onKey, true);
      handle._onTab = (ev) => {
        if (ev.key !== "Tab") return;
        ev.preventDefault();
        const focusables = Array.from(box.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter((el) => el.offsetParent !== null);
        if (!focusables.length) return;
        const i = focusables.indexOf(document.activeElement);
        const n = ev.shiftKey
          ? (i <= 0 ? focusables.length - 1 : i - 1)
          : (i === -1 ? 0 : (i + 1) % focusables.length);
        focusables[n].focus();
      };
      box.addEventListener("keydown", handle._onTab, true);
      if (focusEl) requestAnimationFrame(() => {
        const el = typeof focusEl === "function" ? focusEl() : focusEl;
        if (el && typeof el.focus === "function") el.focus();
      });
    });
    return handle;
  }

  /**
   * messageModal — show a centered message with configurable buttons.
   * @param {object} [opts] Message and button options.
   * @returns {Promise<any>} The selected button value.
   */
  function messageModal({ title = "Notice", message = "", buttons, kind = "info" } = {}) {
    if (!buttons || !buttons.length) buttons = [{ label: "OK", value: "ok" }];
    const modal = showModalBase({ label: title, closeOnBackdrop: true });
    const { box, finish } = modal;
    const heading = document.createElement("h3");
    heading.textContent = title;
    box.appendChild(heading);
    const body = document.createElement("p");
    body.className = "savedlg-msg";
    if (kind) body.dataset.kind = kind;
    body.textContent = message;
    box.appendChild(body);
    const row = document.createElement("div");
    row.className = "savedlg-btns";
    let primary = null;
    for (const button of buttons) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "btn " + (button.kind || "");
      el.textContent = button.label || "OK";
      el.addEventListener("click", () => finish(button.value));
      row.appendChild(el);
      if (button.kind === "primary") primary = el;
    }
    box.appendChild(row);
    (primary || row.lastElementChild)?.focus();
    return modal.promise;
  }

  /**
   * showSaveDiscardDialog — ask how to handle a dirty document.
   * @param {object} doc The dirty tab document.
   * @param {{clear?: boolean}} [opts] Use last-tab clear wording when true.
   * @returns {Promise<{choice: string}>} The selected action.
   */
  function showSaveDiscardDialog(doc, { clear = false } = {}) {
    const modal = showModalBase({ label: "Unsaved changes" });
    const { box, finish } = modal;
    const title = document.createElement("h3");
    title.textContent = clear ? "Clear this document?" : "Unsaved changes";
    const message = document.createElement("p");
    message.className = "savedlg-msg";
    message.textContent = clear
      ? `“${doc.name}” has unsaved changes. This is the last open tab, so it can’t be closed. Clear it?`
      : `“${doc.name}” has unsaved changes.`;
    const buttons = document.createElement("div");
    buttons.className = "savedlg-btns";
    const choose = (choice) => finish({ choice });
    const add = (label, kind, choice) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn " + kind;
      button.textContent = label;
      button.addEventListener("click", () => choose(choice));
      buttons.appendChild(button);
    };
    box.append(title, message, buttons);
    if (clear) {
      add("Cancel", "", "cancel");
      add("Clear", "danger", "discard");
      add("Save & Clear", "primary", "save");
    } else {
      add("Cancel", "", "cancel");
      add("Discard", "danger", "discard");
      add("Save", "primary", "save");
    }
    buttons.lastElementChild.focus();
    return modal.promise;
  }

  /** Ask before replacing an existing native file. */
  async function confirmOverwrite(path) {
    const choice = await messageModal({
      title: "Overwrite existing file?",
      message: "“" + path + "” already exists. Replace it?",
      buttons: [{ label: "Cancel", value: false }, { label: "Overwrite", kind: "danger", value: true }],
      kind: "warn",
    });
    return choice === true;
  }

  /** Check a native destination and ask before replacing it. */
  async function confirmOverwriteIfNeeded(path) {
    if (!isTauri()) return true;
    if (!(await exists(path))) return true;
    return confirmOverwrite(path);
  }

  return { showSaveDiscardDialog, showModalBase, messageModal, confirmOverwrite, confirmOverwriteIfNeeded };
}
