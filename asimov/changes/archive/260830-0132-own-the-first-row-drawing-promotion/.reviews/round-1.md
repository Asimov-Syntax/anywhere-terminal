# Review Round 1 — own-the-first-row-drawing-promotion

| Field | Value |
|---|---|
| Date | 2026-08-30 |
| Cycle | 1 |
| Mode | discovery |
| Requested mode | fastlane |
| Scope | commit range `6ed105a9..c43e5ac720820ff2271b79ee1a85b42dc557b68e` |
| Head | `c43e5ac720820ff2271b79ee1a85b42dc557b68e` |
| Tree state | dirty outside the explicit range (`.analytics-cursor.json` and `analytics.json` advanced during review); not reviewed |
| Reviewable lines | 1,267 (74 production TypeScript + 1,193 Asimov review/build metadata); tests reviewed inline |
| Agents spawned | asm-finder (`gpt-5.6-luna[1M]`); asm-review-logic (`opus[1M]`); asm-review-contracts (`sonnet[1M]`); asm-review-performance (`gpt-5.6-terra[1M]`); asm-review-reuse (`gpt-5.6-luna[1M]`) |
| Agents skipped | data-security (no data/auth/input boundary); frontend (no React/webview implementation change) |
| Verdict | APPROVE |
| Counts | BLOCK 0 · WARN 0 · SUGGEST 0 |

> Large change — accuracy may decrease. The line count is dominated by 1,193 lines of generated Asimov analytics/build metadata; the behavioral production diff is 74 lines.

## Scope and classification

- Reviewable: `asimov/changes/active`, change analytics/build records, and `src/providers/WorktreeHost.ts`.
- Tests reviewed inline: `src/providers/WorktreeHost.test.ts` and `src/providers/WorktreeHost.presence.test.ts`.
- Skipped by classification: change markdown/spec artifacts and `docs/PLAN.md`; these were still read as intent and architecture context.
- The committed analytics cursor is valid JSON with one session, 217 uniformly shaped cursor entries, one stamp, and no absolute user path. The remaining build metadata is structurally consistent with the two completed tasks.

## Accepted obligations

Gate 2 is approved. The review therefore treated change design D1–D4, the resolved spec requirement, and tasks 1_1/1_2 Acceptance and Boundary fields as obligations:

- D1: one `enrichmentOwed()` definition owns the conjunction of current row drawing and a bare projection.
- D2: every mutation of `visible`, `level`, or `displayed` reconciles that obligation without a previous-value snapshot.
- D3: a clean pass cannot finish owing enrichment; pass invalidation, pane-evidence acknowledgement, and rerun mode retain their distinct meanings.
- D4: `anyShowing`, scan reconciliation, and the five-second cadence remain unchanged.

No material divergence from those obligations was found.

## Risk map and full-flow trace

The top risk was the single-flight projection loop: a wrong rerun condition could lose a promotion, acknowledge pane evidence incorrectly, downgrade a required full rerun, or create an O(E) projection storm over the live row/session axis.

The traced flow is:

1. `TerminalViewProvider` supplies the window display state, while `WorktreeController.applySubscription()` posts `worktreeViewVisibility` with `rows` or `presence`.
2. `WorktreeHost` mutates only the three row-drawing inputs and routes both mutation sites through `reconcileRowDrawing()`; attach seeds both booleans false and detach can only remove a drawing surface.
3. A standing bare envelope requests `{ external: true, join: true }`, preserving the existing single-flight and poll-join contract.
4. `projectOnce()` samples `anyDrawingRows()` at pass start and translates it to the projector's `enrich` option. The projector replays the pane half on the external-only hot path, refreshes external rows, and conditionally performs title/preview enrichment.
5. After each pass, `wasInvalidated` captures the pass's pre-existing dirty state. A clean full pass still advances pane evidence; a clean bare pass promoted mid-flight schedules one external-only iteration; an invalidated pass keeps its already-required full rerun.
6. Publication remains atomic through the existing projected/tree-version check and single commit/broadcast point. A projector throw keeps the previous envelope and the existing scan provides bounded retry behavior.

The successful enriching follow-up sets `projectedEnriched = true`, so the same obligation cannot re-arm. Repeated display/visibility reports coalesce into the in-flight run and already-enriched envelopes schedule no work. No growth, deduplication, or hot-path defect was found.

## Verification evidence

- Project verification commands were not rerun. `bun run asm change verify-status own-the-first-row-drawing-promotion` reports tasks 1_1 and 1_2 recorded at exit 0. Task 1_1 is marked `scope-changed` only because task 1_2 subsequently modified their shared production file; task 1_2 is `scope-unchanged`.
- The author reports final type check, 5,303 unit tests, the I10 filesystem-deletion gate, and Biome `src` at its unchanged 4-error / 14-warning / 3-info baseline.
- Changed tests add the displayed-rise and already-enriched boundaries plus five deferred-projector cases for initial/later mid-flight promotion, the one-follow-up bound, pane-evidence acknowledgement, and full-rerun preservation.
- No changed test contains `.only` or `.skip`; no existing assertion was removed or weakened; asynchronous race steps await settlement or explicitly release the parked projector.

## Findings

None.

## Adjudication notes

- Chair review found no defect across logic, contracts, performance, reuse, and inline test support.
- Logic raised one medium-confidence P4 suggestion: immediately retry when the enriching pass throws. It was dropped. The accepted failure-surface inventory explicitly preserves the existing behavior in which a projection throw publishes nothing and the window remains late until the next scan. Retrying from `enrichmentOwed()` after every rejection would also remove the five-second failure bound and can create an unbounded hot retry loop under a persistent projector failure, contradicting the change's must-not.
- Contracts verified the mutation inventory and D3 bookkeeping separation. Performance verified at most one promotion-caused O(E) follow-up and no added poll work. Reuse found the helper altitude cohesive with the existing host reconciliation pattern and no duplicate owner.
- The deferred W1 invariant inventory is now closed: completed-pass promotion remains safe; `displayed:false→true`, initial/later mid-flight bare passes, clean full-pass evidence acknowledgement, and pane-evidence invalidation are all covered. Already-enriched and poll-join paths remain non-dirtying.

## Accepted risk

None.

## Audit backlog

None.
