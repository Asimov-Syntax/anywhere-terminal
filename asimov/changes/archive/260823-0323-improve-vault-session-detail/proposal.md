# Proposal: improve-vault-session-detail

## Why

The vault session-detail overlay wastes its title row on a branch chip and two navigation buttons while burying what users actually reach for — the full working directory, the session id, the transcript path — behind a right-click menu or nowhere at all. Separately, resuming a Claude session silently loses its permission mode: 22 of 120 local transcripts resolve to a missing or stale mode, so the session comes back under the wrong permissions.

## Appetite

M (≤3d)

## Scope

### In scope

- Session-detail header: what the title row carries, and what the meta block below it shows.
- Copying a session's working directory, id, and transcript path from the overlay.
- Restoring the correct Claude permission mode on resume, and invalidating the list cache that would mask the fix.
- Keyboard navigation between user messages, replacing the removed title-row buttons.

### Out of scope

- Permission mode for Codex / OpenCode (they capture `approval` / `sandbox` / `agent`, unaffected by this defect).
- A derived yolo/manual/mixed permission model or a mode switcher (docs/research/20260822-orca-deep-dive/04-launch-resume-permissions.md §4) — a separate feature.
- Validating captured mode values against an allowlist (D1).
- The vault list rows, the context menu, and the subagent popup's own header.

## Risk Level

LOW-MEDIUM — the UI changes are contained in the overlay's header, but the cache-version bump touches every user's first refresh after upgrade and the new key binding sits next to the terminal's own key routing.
