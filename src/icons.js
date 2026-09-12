// Minimal inline-SVG toolbar icons
const wrap = (path) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

export const bold = wrap(`<path d="M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z"/>`);
export const italic = wrap(`<path d="M19 4h-9M14 20H5M15 4 9 20"/>`);
export const strike = wrap(`<path d="M4 12h16M8 8h8M7 16h10"/><path d="M13 5c1.7 0 3 .8 3 2.2M11 19c-1.7 0-3-1-3-2.6"/>`);
export const code = wrap(`<path d="m9 8-4 4 4 4M15 8l4 4-4 4"/>`);
export const link = wrap(`<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L11.5 7"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5"/>`);
export const save = wrap(`<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7"/>`);
export const open = wrap(`<path d="M4 6h6l2 2h8v11H4z"/>`);
export const underline = wrap(`<path d="M6 4v6a6 6 0 0 0 12 0V4"/><path d="M4 20h16"/>`);
export const table = wrap(`<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M3 14h18M9 4v16M15 4v16"/>`);
export const plus = wrap(`<path d="M12 5v14M5 12h14"/>`);
export const undo = wrap(`<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>`);
export const redo = wrap(`<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>`);
