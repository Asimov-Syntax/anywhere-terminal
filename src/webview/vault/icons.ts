// src/webview/vault/icons.ts — Inline UI glyphs for the AI-vault panel.
//
// No codicon font is bundled — the webview uses inline SVGs, matching
// FileTreePanel. These are STATIC, TRUSTED strings only (never session data), so
// they are safe to insert via innerHTML at the call sites (D1).

export const ICON_FOLDER =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 4h4l1.3 1.3H14.5v8h-13z"/></svg>';
export const ICON_RESUME =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M5 3.4v9.2l7-4.6z"/></svg>';
export const ICON_SEARCH =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/></svg>';
export const ICON_RECENT =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4.5v3.7l2.4 1.4"/><path d="M2.6 8a5.4 5.4 0 1 1 1.6 3.8"/><path d="M2.4 12v-2.3h2.3"/></svg>';
export const ICON_AGENT =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" aria-hidden="true"><circle cx="5.5" cy="5" r="2"/><circle cx="11" cy="6" r="1.6"/><path d="M1.8 13c0-2 1.6-3.3 3.7-3.3S9.2 11 9.2 13"/><path d="M9.6 13c0-1.5 1.1-2.6 2.6-2.6 1.4 0 2 0.9 2 2.2"/></svg>';
export const ICON_REFRESH =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.3 7a5.3 5.3 0 1 0-.3 3"/><path d="M13.5 3v3h-3"/></svg>';
export const ICON_CHEVRON_DOWN =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';
// Jump-to-top: a bar over an up chevron. Jump-to-bottom: a down chevron over a bar.
export const ICON_SCROLL_TOP =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 3.5h8"/><path d="M4.5 9l3.5-3.5L11.5 9"/></svg>';
export const ICON_SCROLL_BOTTOM =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 7l3.5 3.5L11.5 7"/><path d="M4 12.5h8"/></svg>';
export const ICON_ARCHIVE =
  '<svg viewBox="0 0 16 16" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="12" height="3"/><path d="M3 6v7h10V6"/><line x1="6.5" y1="9" x2="9.5" y2="9"/></svg>';
export const ICON_OPEN =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" aria-hidden="true"><path d="M9 2H4v12h8V5z"/><path d="M9 2v3h3"/></svg>';
export const ICON_REVEAL =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 5h4l1.3-1.3H10V5h4.5l-1 8.5h-12z"/></svg>';
export const ICON_COPY =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="1"/><path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2"/></svg>';
export const ICON_TERMINAL =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="1"/><path d="M4 6l2.5 2L4 10"/><line x1="8" y1="10.5" x2="11" y2="10.5"/></svg>';
export const ICON_RENAME =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 2.5l3 3L6 13l-3.5.5L3 10z"/><line x1="9" y1="4" x2="12" y2="7"/></svg>';
export const ICON_CLOSE =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>';
export const ICON_MAXIMIZE =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2.5h4v4"/><path d="M13.5 2.5l-4.5 4.5"/><path d="M6.5 13.5h-4v-4"/><path d="M2.5 13.5l4.5-4.5"/></svg>';
export const ICON_RESTORE =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 3l-4 4m0-4v4h4"/><path d="M3 13l4-4m0 4v-4H3"/></svg>';
