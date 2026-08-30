# Review Round 6: bound-the-looks-one-projection-starts

**Date**: 2026-08-30
**Cycle**: 4
**Mode**: discovery
**Requested execution mode**: fastlane
**Scope**: range `e3ca7673..9e11a56b`
**Head**: `9e11a56b7a14e83e995140e16a64bf18ff5cd372` (explicit range; later commits and the dirty working tree were excluded)
**Reviewable lines**: 85
**Agents spawned**: two `asm-review-logic`, `asm-review-contracts`, `asm-review-performance`; full-flow support by `asm-finder`
**Agents skipped**: `asm-review-data-security` (no changed authority, validation, persistence, path, or external API boundary), `asm-review-frontend` (no changed rendering/client-state code), `asm-review-reuse` (no new helper family, parser, validator, or cohesion split)
**Verdict**: **BLOCK**
**Counts**: 1 BLOCK, 1 WARN, 0 SUGGEST
**Blocker split**: 1 feature / 0 machinery

## Scope and accepted obligations

Gate 2 is approved. Round 5 was superseded before adjudication, so this discovery round independently reviewed D10, D11, and task 4_1, with D8/D9 as the governing preview-retention and fairness context. D10 requires the row-drawing falling edge to clear the current-drawn turn order and fence every in-flight projection that could restore it. D11 requires preview look and held-line read to be one optional all-or-none capability. The explicit range contains only commit `9e11a56b`; unrelated later work and the working tree were not reviewed.

Change artifacts and review files are context, and tests were reviewed inline. The 85 reviewable lines are the production changes in `src/extension.ts`, `src/providers/WorktreeHost.ts`, `src/worktree/presenceDeps.ts`, and `src/worktree/presenceProjector.ts`.

## Risk map

- **Cross-component lifecycle invariant**: the host owns whether any attached surface draws rows; the projector owns the current-drawn turn queue. A falling edge must invalidate every older pass before any later queue write.
- **Async state race**: one projection suspends in snapshot opening, cwd preparation, pane identity, registry reading, session-cwd preparation, title enrichment, and preview enrichment while `forgetDrawOrder()` can run between any two turns of the event loop.
- **Rising/falling handoff**: `projectedEnriched` decides whether reopening requests work; a fenced-off preview pass must not be advertised as completed enrichment.
- **Contract seam**: production and test adapters must supply both preview operations together and every projector adapter must implement the new required reset operation.
- **Growth axes**: `previewOrder` is structurally bounded to distinct currently drawn entry ids, preview invocations are bounded by `previewBudget`, and the preview service's held/outstanding state remains capped independently.

## Full-flow trace

- `extension.ts` creates one `SessionPreviewService`, passes its `{ preview, line }` object through `createPresenceProjectorDeps`, constructs the sole production projector, and injects it into one `WorktreeHost` shared by sidebar, panel, and editor surfaces.
- Surface `visible` and `level` arrive through `worktreeViewVisibility`; provider visibility mutates `displayed`; attachment disposal removes the surface. Every nonterminal mutation reaches `reconcileRowDrawing()`. Multi-surface behavior is correct: the queue is forgotten only when no remaining surface draws rows. Whole-host disposal is terminal and has no surviving projection consumer.
- The host funnels rebuilds, pane evidence, and the five-second external scan through one single-flight `requestProjection()`. `projectOnce()` samples `enrich = anyDrawingRows()` and awaits the projector. A falling edge clears the queue but deliberately does not dirty the host run.
- The projector opens a snapshot, prepares pane cwd claims, resolves pane identities, reads the running-session registry, prepares session cwd claims, attributes rows, then runs title and preview enrichment. `previewFromVault()` reconciles and rotates the queue synchronously before its first await; an edge during its awaited preview reads clears the queue and no later queue write restores it.
- The generation is sampled only immediately before title enrichment, after all earlier suspension points. That leaves the pre-title part of the flow affected by B1-R4. When the generation does move during title enrichment, preview work is skipped correctly inside the projector, but the host still records the pass as enriched from the requested flag, producing W1-R6 on reopen.
- D11 is complete in production and tests. The grouped object is passed intact, its methods close over service state rather than `this`, no partial cast-through construction exists, and both known projector wrappers forward `forgetDrawOrder()`. Optional chaining guards an absent projector; it does not guard a missing required method on a present projector.

## Findings

### B1

- **ID**: B1-R4
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-logic`, corroborated by `chair` and the `asm-finder` flow trace
- **Class**: feature
- **File:line**: `src/worktree/presenceProjector.ts:1080-1183`
- **Title**: The generation fence is sampled after most in-flight falling-edge windows
- **Evidence**: `project()` awaits `openSnapshot()` at line 1081, optional `holdPaneCwds()` at 1097, `projectPanes()` and its nested identity reads at 1131, `snapshot.sessions()` at 1134, and optional `holdSessionCwds()` at 1150 before it samples `drawGeneration` at line 1180. If the last row-drawing surface hides, collapses, or detaches during any of those waits, `WorktreeHost.reconcileRowDrawing()` clears `previewOrder` and increments the generation. When the pass resumes, it samples the already-incremented value, the equality at 1182 succeeds, and `previewFromVault()` repopulates and rotates the queue at 581-602 while no surface draws rows. The title wait is fenced correctly, and every queue write inside `previewFromVault()` is synchronous before its first await, so those later boundaries are safe.
- **Impact**: B1-R4 persists. The queue can again hold ids that are not currently drawn; reopening then grants by the order rebuilt while hidden instead of treating every returned id as an arrival, violating D9, D10, and task 4_1 acceptance.
- **SuggestedFix**: Capture the generation synchronously at `project()` entry, before `openSnapshot()` and every other suspension point, or invalidate the host run on the falling edge so no older pass can write the queue. Add a regression that parks an early dependency such as `openSnapshot()` or `snapshot.sessions()`, lands the falling edge, resumes the pass, and proves no preview call or turn-order rebuild occurs.
- **Status**: open
- **Triage**: accepted in round 4; persists because the new fence closes only the title-enrichment boundary

### W1

- **ID**: W1-R6
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `chair`
- **Class**: feature
- **File:line**: `src/worktree/presenceProjector.ts:1180-1184`; `src/providers/WorktreeHost.ts:1226-1239,1426-1458`
- **Title**: A fenced-off preview pass is still recorded as enriched
- **Evidence**: When a falling edge lands during `titleFromVault()`, the new generation check skips `previewFromVault()` entirely, so the returned rows have not received held lines or permitted preview reads. `projectOnce()` nevertheless sets `projectedEnriched = enrich`, where `enrich` is only the pre-call request flag. If the surface reopens after that pass commits, `enrichmentOwed()` sees `projectedEnriched === true` and does not request a replacement enriched projection. The new projector test calls `forgetDrawOrder()` during the title read but bypasses the host, so it cannot observe this handoff.
- **Impact**: A reopened row-drawing surface can receive an envelope with blank previews and no immediate enrichment request; it waits for a later external scan before any returned row is granted. The queue stays safely empty in this boundary, but the host's rising-edge invariant and the end-to-end task outcome are delayed by a flag that claims work the projector deliberately skipped.
- **SuggestedFix**: Propagate whether preview enrichment actually completed, or otherwise keep the host's enrichment obligation dirty when the generation fence fires. Add a host/projector integration case for title wait -> falling edge -> pass completion -> row reopening, asserting that reopening schedules a fresh enriched projection.
- **Status**: open
- **Triage**: pending

## Cross-round disposition

- **B1-R4**: persists. The falling-edge owner exists, but the in-flight fence does not cover the suspension points before its sample.
- **S1-R3**: fixed. `sessionPreviews` is one optional capability requiring both `preview` and `line`; production, typed stubs, and both cast-through projector adapters are complete.
- No prior `audit-backlog` or `risk-accepted` entries exist.

## Invariant inventory

- **Current-drawn queue membership**: searched rows -> presence, hidden, detach, multiple surfaces, terminal host disposal, a fall before snapshot completion, pane/cwd/registry waits, title wait, synchronous preview setup, awaited preview reads, and projection completion. Host transition coverage, title wait, preview setup/read, and terminal disposal are safe. Every pre-title await is affected by B1-R4.
- **Rising-edge enrichment**: searched a bare published envelope, an already-enriched envelope, a fall during title enrichment, reopen after pass completion, and fall -> rise while a pass remains in flight. Ordinary bare/enriched transitions are safe; a generation-skipped preview pass is affected by W1-R6.
- **Grouped capability**: searched production construction, dependency adaptation, direct projector construction, typed stubs, spread overrides, the two cast-through wrappers, old operation names, and method binding. D11 is safe; no partial-construction path exists in the reviewed commit.
- **One-projection work bound**: searched one/many worktrees, duplicate row identities, reset/reopen, and preview errors. `mayLook` remains a unique-id set capped by `previewBudget`; upstream production identity settlement prevents duplicate look work, and service held/outstanding state remains capped.

## Inline support review

Changed tests contain no `.only` or `.skip`, and changed async work is awaited. The host cases cover the three stated falling transitions, but only assert that `forgetDrawOrder()` was called. The projector race case covers a reset during `titleFromVault()` only. No changed case parks any earlier projector await, which corresponds to B1-R4, and no case composes the generation skip with the host's `projectedEnriched` state and a reopen, which corresponds to W1-R6. All projector stubs named by task 4_1 now implement the required operation.

## Recorded verification evidence

`bun run asm change verify-status bound-the-looks-one-projection-starts` records task 4_1 verified with exit 0 and the focused suite widened without weakened assertions. The caller reports type check, 5,539 unit tests, I10, both esbuild bundles, and `biome check src` at the 0-error/14-warning baseline, plus four killed D10 mutations. None of the recorded mutations moves the generation sample before the earlier awaits or composes a fenced pass with host reopening, so the evidence does not refute B1-R4 or W1-R6. Per review policy, no typecheck, lint, bundle, or test command was rerun.

## Specialist results

- `asm-review-logic` — projector generation and async windows — `gpt-5.6-sol[1M]` — B1-R4.
- `asm-review-logic` — host lifecycle transitions and optional-projector behavior — `gpt-5.6-terra[1M]` — no finding; confirmed every relevant state mutation reaches reconciliation.
- `asm-review-contracts` — grouped preview capability, production wiring, casts, and adapters — `sonnet[1M]` — no finding; confirmed D11 closure and fail-loud required projector method behavior.
- `asm-review-performance` — queue growth, duplicate identities, and projection look bound — `gpt-5.6-luna[1M]` — no finding.
- `asm-finder` — full production caller, lifecycle, suspension, adapter, and disposal trace — `gpt-5.6-luna[1M]` — support only.

---

## Author triage — round 6

**[B1] Generation fence misses pre-title suspension windows**
- **Status**: accepted
- **Triage**: Correct, and my own reasoning to the chair was the defect. I argued only the awaited
  `titleFromVault` could land an edge inside a projection, and fenced from that point forward. But
  `project()` suspends five times before the sample at `:1180` — `openSnapshot()`, `holdPaneCwds()`,
  `projectPanes()`, `snapshot.sessions()`, `holdSessionCwds()` — and an edge in any of them advances
  the generation BEFORE it is read, so the equality check passes and `previewFromVault` rebuilds the
  order with nothing drawing rows. I fenced the smallest window and left the largest open.
- **Remediation, not a handback.** D10 already says the generation is "captured before the enrichment
  block"; capturing it at `project()` entry satisfies that sentence rather than changing it. This is
  a mechanism correction inside an accepted decision, so it stays a fix and D10 is not amended —
  amending it would carry a design delta into the fix range and supersede the round, which is the
  trap round 5 already cost us.

**[W1] A skipped preview pass is still recorded as enriched**
- **Status**: accepted, NOT fixed in this round — carried as a follow-up for the user to schedule
- **Triage**: Confirmed. `projectedEnriched = enrich` records what was REQUESTED, so a pass whose
  preview half the fence skipped still marks the envelope enriched, and `enrichmentOwed()` then
  suppresses the replacement pass on reopen.
- I tried the cheap fix — clearing `projectedEnriched` on the falling edge — and it broke 19 existing
  cases in `WorktreeHost.test.ts`. `reconcileRowDrawing` is deliberately a state settle rather than an
  edge check, so it runs on every mutation while not drawing, and clearing there fires far wider than
  the one edge W1 is about. Reverted rather than papered over.
- Every correct route is a new contract: propagating "did preview enrichment complete" out of
  `project`, or holding an outstanding-enrichment obligation, both add interface. Landing either in
  this range would carry a design delta and supersede the round — which is exactly what round 5 cost.
  W1 is a WARN and non-blocking: the queue stays correctly empty, and the only cost is that a reopened
  window waits for the next external scan instead of re-granting immediately. So it goes back to the
  user as a scheduling decision, not into this fix range.
