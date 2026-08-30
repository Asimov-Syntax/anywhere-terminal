# Tasks: own-the-first-row-drawing-promotion

- [ ] 1_1 One owner for "enrichment is owed"
  - **Refs**: specs/worktree-agent-presence/spec.md#{a-window-that-begins-drawing-rows-gets-enriched-rows-without-waiting-for-a-scan} <!-- design.md D1, D2 -->
  - **Boundary**: no change to `anyShowing`, `reconcileScan`, or the scan cadence
  - **Acceptance**:
    - Outcome: a surface becoming displayed against a bare envelope triggers the enriching rebuild
    - Verify: unit src/providers/WorktreeHost.test.ts
  - **Plan**:
    1. In `src/providers/WorktreeHost.ts` replace the inline conjunction in the `worktreeViewVisibility` handler with `enrichmentOwed()` and `reconcileRowDrawing()` (design.md D1, D2), dropping the `wasDrawing` snapshot — the question is whether enrichment is owed now, not whether this call changed it.
    2. Call `reconcileRowDrawing()` from `setDisplayed` as well, beside its existing `reconcileShowing`/`reconcileScan` calls.
    3. In `src/providers/WorktreeHost.test.ts`, in the suite that already covers subscribe-without-drawing, cover a retained rows surface becoming displayed against a bare envelope, and assert no extra pass when the envelope is already enriched. Confirm the first case fails before the fix; the second passes today and is a regression guard.

- [ ] 1_2 A rebuild cannot end owing enrichment
  - **Deps**: 1_1
  - **Refs**: specs/worktree-agent-presence/spec.md#{a-window-that-begins-drawing-rows-gets-enriched-rows-without-waiting-for-a-scan} <!-- design.md D3 -->
  - **Boundary**: `join` must stay non-dirtying — a polled scan may not buy a second projection
  - **Acceptance**:
    - Outcome: a promotion landing mid-rebuild is followed by exactly one enriching pass
    - Verify: unit src/providers/WorktreeHost.presence.test.ts
  - **Plan**:
    1. In `src/providers/WorktreeHost.ts` add the loop invariant to `requestProjection`'s run, capturing the pass's own invalidation state before the enrichment obligation touches it (design.md D3).
    2. `src/providers/WorktreeHost.presence.test.ts` already has the deferred harness this needs — `blockingProjector`, beside the single-flight tests. Extend it to record `options.enrich`; today it records only whether a pass was the external-only one.
    3. Drive a promotion during an in-flight bare pass, counting passes rather than reading a row: exactly one further pass, and it enriches. Cover the first-pass case too, where the remembered-enriched flag still reads true.
    4. Cover the two bookkeeping collisions, which the simple mid-pass case cannot reach: a full bare pass with outstanding pane evidence promoted mid-flight must leave the NEXT scan on its external-only path, not reverted to a full pass; and a promotion racing new pane evidence must leave the rerun a full one, not downgraded to skip the panes.
    5. Assert the bound as **one promotion-caused follow-up** — a bare "it terminates" assertion does not discriminate, since today's code also stops after one pass. The poll-join case is already covered by the existing single-flight test; leave it alone rather than restating it.
