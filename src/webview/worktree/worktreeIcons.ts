// src/webview/worktree/worktreeIcons.ts — Inline glyphs the Worktree view adds on
// top of the shared vault set (src/webview/vault/icons.ts, which already owns
// folder / terminal / copy / reveal / resume / chevron / search / refresh).
//
// STATIC, TRUSTED strings only — never worktree- or session-derived — so they are
// safe to insert via innerHTML at the call sites, exactly as icons.ts is (D1).

export const ICON_BRANCH =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="4.5" cy="3.5" r="1.6"/><circle cx="4.5" cy="12.5" r="1.6"/><circle cx="11.5" cy="6" r="1.6"/><path d="M4.5 5.1v5.8"/><path d="M11.5 7.6c0 2.2-2.3 2.9-4.2 3.2"/></svg>';
export const ICON_LOCK =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7"/></svg>';
export const ICON_PLUS =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><line x1="8" y1="3.5" x2="8" y2="12.5"/><line x1="3.5" y1="8" x2="12.5" y2="8"/></svg>';
export const ICON_WARNING =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.5l6 11H2z"/><line x1="8" y1="6.5" x2="8" y2="9.8"/><line x1="8" y1="11.4" x2="8" y2="11.5"/></svg>';
export const ICON_WINDOW =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 6h12"/></svg>';
export const ICON_TRASH =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h10"/><path d="M4.5 5l.7 8.5h5.6L11.5 5"/><path d="M6.3 5V3.5h3.4V5"/></svg>';
