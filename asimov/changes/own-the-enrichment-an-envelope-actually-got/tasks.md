## 1. An envelope owes what it did not deliver

- [x] 1_1 Record the enrichment a cut-short projection still owes — verified: pnpm exec vitest run 'src/providers/WorktreeHost.test.ts' && pnpm run check-types && pnpm run test:unit exit 0 — verified: pnpm exec vitest run 'src/providers/WorktreeHost.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/NO-DELTA.md <!-- design.md D1, D1a, D2 -->
  - **Acceptance**:
    - Outcome: a surface reopening after a cut-short projection is served an enriched pass, published
    - Verify: unit src/providers/WorktreeHost.test.ts
  - **Plan**:
    1. In `src/providers/WorktreeHost.ts`, record that enrichment is still owed when the row-drawing falling edge fires while a projection is in flight, and read that alongside the envelope's own enrichment in the owed predicate.
    2. In the same file, discharge the obligation at the unit design.md D1a names rather than at the run, and restore it where D1a says an undelivered pass owes it back.
    3. In `src/providers/WorktreeHost.test.ts`, cover: a falling edge mid-projection followed by a rise asking for an enriched pass; a surface reopening BEFORE the parked projection is released, asserting the run terminates and publishes exactly one replacement pass; a rejecting `project()` leaving the next rise still owed; repeated no-op mutations while nothing draws leaving the rise unchanged; and a second rise after a completed enriched pass asking for nothing.
    4. Mutation-check the discharge rule: moving the clear back to the run start, and dropping the restore an undelivered pass owes, must each fail exactly one of the new cases.
