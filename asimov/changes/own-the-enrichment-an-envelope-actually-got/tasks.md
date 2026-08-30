## 1. An envelope owes what it did not deliver

- [x] 1_1 Record the enrichment a cut-short projection still owes — verified: pnpm exec vitest run 'src/providers/WorktreeHost.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/NO-DELTA.md <!-- design.md D1, D2 -->
  - **Acceptance**:
    - Outcome: a surface reopening after a cut-short projection is served an enriched pass
    - Verify: unit src/providers/WorktreeHost.test.ts
  - **Plan**:
    1. In `src/providers/WorktreeHost.ts`, record that enrichment is still owed when the row-drawing falling edge fires while a projection is in flight; read that alongside the envelope's own enrichment in the owed predicate, and clear it where the envelope's enrichment is recorded.
    2. In `src/providers/WorktreeHost.test.ts`, cover: a falling edge mid-projection followed by a rise asking for an enriched pass; repeated no-op mutations while nothing draws leaving the rise unchanged; and a second rise after a completed enriched pass asking for nothing.
