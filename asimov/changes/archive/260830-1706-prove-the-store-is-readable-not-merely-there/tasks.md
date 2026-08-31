## 1. One predicate, proving what its callers assume

- [x] 1_1 Prove the store is readable, not merely there — verified: pnpm exec vitest run 'src/vault/sqlite.test.ts' && pnpm run check-types && pnpm run test:unit exit 0 — verified: pnpm exec vitest run 'src/vault/sqlite.test.ts' && pnpm run check-types && pnpm run test:unit exit 0 — verified: pnpm exec vitest run 'src/vault/sqlite.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/vault-store-status/spec.md#a-store-that-cannot-be-read-reports-the-same-status-on-every-path <!-- design.md D1, D2 -->
  - **Acceptance**:
    - Outcome: a present but unreadable store reports unreachable on both entry points
    - Verify: unit src/vault/sqlite.test.ts
  - **Plan**:
    1. In `src/vault/storeStamp.ts`, give the generation read a probe that proves each path can be READ rather than merely stat-ed, releasing whatever it opens on every exit. Leave the stamp helper beside it asking what it asks today.
    2. Leave the presence check in `src/vault/sqlite.ts` proving existence — the write deps alias it, and readability is no longer its question.
    3. In `src/vault/storeStamp.test.ts`, cover a store whose sidecar alone cannot be read, the stamp helper's unchanged answer for the same store, and that repeated reads release what they open.
    4. In `src/vault/sqlite.test.ts`, assert the reused and freshly-taken paths agree for a store whose sidecar went unreadable, against two distinct stores so the fresh path is genuinely fresh, and skip through the runner's own facility rather than by returning early. Assert a write to an existing unreadable store still reports a write failure rather than absence.
