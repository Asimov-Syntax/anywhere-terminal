## 1. One predicate, proving what its callers assume

- [x] 1_1 Prove the store is readable, not merely there — verified: pnpm exec vitest run 'src/vault/sqlite.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/vault-store-status/spec.md#a-store-that-cannot-be-read-reports-the-same-status-on-every-path <!-- design.md D1, D2 -->
  - **Acceptance**:
    - Outcome: a present but unreadable store reports unreachable on both entry points
    - Verify: unit src/vault/sqlite.test.ts
  - **Plan**:
    1. In `src/vault/sqlite.ts`, make the default access check prove the process can READ the path rather than only that it exists.
    2. In `src/vault/sqlite.test.ts`, revoke read permission on a store file and assert the status from a cold read and from a read whose snapshot was already retained agree, and that neither reports absence. Skip the case when the running user can still read the file after revocation, reporting the skip rather than passing on it.
