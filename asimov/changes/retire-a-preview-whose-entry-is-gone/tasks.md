## 1. Who knows an entry is gone

- [ ] 1_1 Retire a preview whose session has stopped existing
  - **Deps**: none
  - **Refs**: specs/worktree-agent-presence/spec.md#a-preview-does-not-outlive-the-session-it-describes <!-- design.md D1, D2, D3, D4 -->
  - **Acceptance**:
    - Outcome: a row whose session was deleted stops carrying its preview
    - Verify: unit src/worktree/sessionPreviewService.test.ts
  - **Plan**:
    1. In `src/worktree/sessionPreviewService.ts`, add `{ kind: "gone" }` to `Target` and `entryRecheckMs?: number` to `SessionPreviewDeps`, with `DEFAULT_ENTRY_RECHECK_MS = 30000`.
    2. Add `confirmedAt?: number` to `LookState`, set it whenever `deps.entry` answers with an entry, and carry it through `snapshot`/`commit` with the other owned fields.
    3. In `look`, return `undefined` immediately for a `gone` target before any filesystem work, and re-fetch the entry when the target is resolved but `now() - (confirmedAt ?? -Infinity) >= entryRecheckMs`.
    4. Make every `deps.entry` miss set the target to `{ kind: "gone" }` and call `forget`, replacing the current bare `forget`, so the cleared line and the target no longer disagree.
    5. Let a `gone` target re-confirm on the same interval — the entry lookup runs, and a session that returns resolves and previews again.
