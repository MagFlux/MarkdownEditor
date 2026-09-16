/**
 * session.js — localStorage persistence for the editor's tab session.
 *
 * The store knows the session schema and debounce timing, while the app supplies
 * the current active-tab id and serializable tab records through callbacks.
 */

/**
 * createSessionStore — build session save/load operations for an editor.
 * @param {object} deps Persistence callbacks and storage configuration.
 * @param {Storage} deps.storage Storage implementation, normally localStorage.
 * @param {string} deps.key localStorage key.
 * @param {Function} deps.getActiveTabId Return the active tab id or null.
 * @param {Function} deps.getTabs Return the current tab collection.
 * @returns {{saveSession: Function, saveSessionSoon: Function, loadSession: Function}}
 */
export function createSessionStore({ storage, key, getActiveTabId, getTabs }) {
  let timer = 0;

  /**
   * saveSession — persist the current tabs within the 2 MB session budget.
   * @returns {void}
   */
  function saveSession() {
    try {
      const data = {
        v: 2,
        activeTab: getActiveTabId(),
        tabs: getTabs().map((doc) => ({
          id: doc.id,
          name: doc.name,
          text: doc.input.value,
          dirty: doc.dirty,
          path: doc.path,
        })),
      };
      const serialized = JSON.stringify(data);
      if (serialized.length > 2 * 1024 * 1024) return;
      storage.setItem(key, serialized);
    } catch { /* persistence is best effort */ }
  }

  /**
   * saveSessionSoon — debounce a session save to at most once per 250 ms.
   * @returns {void}
   */
  function saveSessionSoon() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = 0;
      saveSession();
    }, 250);
  }

  /**
   * loadSession — read and validate the versioned session payload.
   * @returns {(object|null)} The parsed v2 session or null.
   */
  function loadSession() {
    try {
      const raw = storage.getItem(key);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return data && data.v === 2 ? data : null;
    } catch { return null; }
  }

  return { saveSession, saveSessionSoon, loadSession };
}
