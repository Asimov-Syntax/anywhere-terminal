## 1. Who knows an entry is gone

- [x] 1_1 Take the conclusive lookup and retire a preview only on a proven absence — verified: pnpm exec vitest run 'src/worktree/sessionPreviewService.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-agent-presence/spec.md#a-preview-does-not-outlive-the-session-it-describes, specs/worktree-agent-presence/spec.md#a-store-is-re-consulted-on-its-own-interval, specs/worktree-agent-presence/spec.md#only-a-proven-absence-retires-a-preview <!-- design.md D1–D6; src/vault/types.ts#VaultEntryLookup -->
  - **Acceptance**:
    - Outcome: a row whose session is proven deleted stops carrying its preview
    - Verify: unit src/worktree/sessionPreviewService.test.ts
  - **Plan**:
    1. In `src/worktree/sessionPreviewService.ts`, widen `SessionPreviewDeps.entry` to answer a three-way `PreviewLookup` mirroring `VaultEntryLookup`, add `{ kind: "gone" }` to `Target`, and add `entryRecheckMs?: number` with `DEFAULT_ENTRY_RECHECK_MS = 30000`.
    2. Add `confirmedAt?: number` to `LookState`, stamp it on conclusive answers only, and carry it through `snapshot`/`commit` with the other owned fields.
    3. In `look`, gate the entry re-fetch on the target needing one OR the interval having elapsed; return early from a `gone` target that is not yet due, scoring it as progress so it stays off the retry ladder.
    4. Route the three statuses: `absent` sets `{ kind: "gone" }`, clears the held entry and forgets the line; `found` stamps `confirmedAt` and, from `gone`, drops the target back to `unresolved` so the ordinary resolve path recovers it; `unknown` commits nothing and returns the line already on the row.
    5. In `src/extension.ts`, map `vaultService.lookupEntry` instead of `getEntry` into `deps.entry`, carrying `absent` and `unknown` through and answering `unknown` for an entry whose agent is outside `VAULT_AGENT_IDS`.
    6. Cover in `src/worktree/sessionPreviewService.test.ts`: a proven absence retires the line and stops all filesystem work; an inconclusive lookup leaves the line intact; a timeout and a failed `stat` still take their existing paths; many looks inside one interval make exactly one entry lookup; a restored entry previews again.
