/**
 * icons.js — inline-SVG toolbar icons (Feather-style strokes).
 *
 * Each export is a complete `<svg>` string that fits the app's toolbar button
 * markup. Shared attributes (`fill="none"`, `stroke="currentColor"`,
 * `stroke-width="2"`, `stroke-linecap="round"`, `stroke-linejoin="round"`) are
 * applied once by the `wrap` helper so the path bodies stay small.
 *
 * The 19 icons in this file cover B / I / S / code / link / save / open /
 * underline / table / new-tab / undo / redo / hamburger-menu / file-doc,
 * the theme (light/dark) toggle, and the three view-mode glyphs
 * (split / edit / preview) shown on the constant-width mode button.
 */

/** wrap — produce the shared `<svg>` shell around an inner path. */
const wrap = (path) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

/** bold — the **Bold** toolbar icon. */
export const bold = wrap(`<path d="M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z"/>`);
/** italic — the *Italic* toolbar icon. */
export const italic = wrap(`<path d="M19 4h-9M14 20H5M15 4 9 20"/>`);
/** strike — the ~~Strikethrough~~ toolbar icon. */
export const strike = wrap(`<path d="M4 12h16M8 8h8M7 16h10"/><path d="M13 5c1.7 0 3 .8 3 2.2M11 19c-1.7 0-3-1-3-2.6"/>`);
/** code — the inline-code toolbar icon. */
export const code = wrap(`<path d="m9 8-4 4 4 4M15 8l4 4-4 4"/>`);
/** link — the [text](url) toolbar icon. */
export const link = wrap(`<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L11.5 7"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5"/>`);
/** save — the Save (disk / floppy) icon. */
export const save = wrap(`<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7"/>`);
/** open — the Open folder icon (used for "open file" on the picker). */
export const open = wrap(`<path d="M4 6h6l2 2h8v11H4z"/>`);
/** underline — the Underline (U with bar) icon. */
export const underline = wrap(`<path d="M6 4v6a6 6 0 0 0 12 0V4"/><path d="M4 20h16"/>`);
/** table — the grid toolbar icon (used for the GFM table action). */
export const table = wrap(`<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M3 14h18M9 4v16M15 4v16"/>`);
/** mermaid — two boxes joined by an elbow connector (the diagram-insert action). */
export const mermaid = wrap(`<rect x="3" y="4" width="7" height="6" rx="1"/><rect x="14" y="14" width="7" height="6" rx="1"/><path d="M6.5 10v7h7.5"/>`);
/** plus — the + icon for "new tab". */
export const plus = wrap(`<path d="M12 5v14M5 12h14"/>`);
/** undo — the curved back-arrow (Ctrl+Z). */
export const undo = wrap(`<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>`);
/** redo — the curved forward-arrow (Ctrl+Y). */
export const redo = wrap(`<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>`);
/** menu — the hamburger (3-bar) icon for the PDF/HTML export menu. */
export const menu = wrap(`<path d="M4 6h16M4 12h16M4 18h16"/>`);
/** theme — a moon, the light/dark toggle icon (SVG so it centers like the rest). */
export const theme = wrap(`<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`);
/** fileDoc — a generic file-with-folded-corner, used in the open/save prompt. */
export const fileDoc = wrap(`<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>`);

/**
 * View-mode glyphs for the constant-width mode button (src/markdown.js). The
 * button is an icon like the rest of the toolbar so its width never changes
 * between modes; its glyph swaps as the mode does. Kept visually-hidden in the
 * button (see .mode-label) but still present for the mode word / a11y.
 */
/** viewSplit — two side-by-side panes (edit | preview). */
export const viewSplit = wrap(`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>`);
/** viewEdit — a pencil over a sheet (edit-only). */
export const viewEdit = wrap(`<path d="M14 4 4 14l-1 5 5-1L18 8z"/><path d="M13 5 19 11"/>`);
/** viewPreview — an eye (preview-only). */
export const viewPreview = wrap(`<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>`);
