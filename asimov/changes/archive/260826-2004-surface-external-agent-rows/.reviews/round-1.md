# Review Round 1

- Date: 2026-08-27
- Cycle: 1
- Mode: discovery
- Scope: working tree
- Reviewable lines: 476
- Large change: no
- Agents spawned:
  - asm-review-logic — projection scheduling and replay state — gpt-5.6-sol[1M]
  - asm-review-contracts — approved D1-D8 presence contracts — gpt-5.6-terra[1M]
  - asm-review-performance — polling and growth bounds — sonnet[1M]
  - asm-review-data-security — local registry validation and trust — gpt-5.6-terra[1M]
  - asm-review-reuse — helper reuse and cohesion — gpt-5.6-luna[1M]
- Agents skipped:
  - asm-review-frontend — no React/webview rendering code changed
- Support agent:
  - asm-finder — end-to-end presence projection flow and callers
- Verdict: BLOCK
- Counts: 2 BLOCK, 2 WARN, 2 SUGGEST
- Verification:
  - Focused changed suites: 6 files / 192 tests passed
  - `pnpm run check-types`: passed
  - `pnpm run test:unit`: 193 files / 3691 tests passed

## Findings

### B1

- ID: B1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; asm-review-logic; asm-review-contracts
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:366`
- Title: External scan discards pending pane evidence
- Evidence: When the five-second scan fires with the 150 ms pane cap armed, lines 366-370 cancel the cap and clear its only pending marker, then line 372 requests `{ external: true, join: true }`. The projector's external-only branch at `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/presenceProjector.ts:465-484` replays `lastWindowPass` and skips `projectPanes`, so it cannot incorporate the pane event the cancelled cap represented. The collision test at `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.presence.test.ts:911-925` asserts only one call, not that the one call is full-mode or carries the changed pane state.
- Impact: A pane identity, activity, closure, or cwd change in the final 150 ms before a poll can be lost indefinitely. Stale window rows, claims, ranks, and ordering continue to publish; a stale claimed session can also suppress a valid external row.
- SuggestedFix: If `capHandle` is present, cancel its timer but request a full projection; if another projection is already in flight, mark the rerun dirty/full rather than joining it as an external-only request. Extend the collision test to assert full mode and updated pane evidence.
- Status: accepted
- Triage (author): The cap-absorption fix traded one defect for a worse one: cancelling the cap and running external-only drops the pane evidence that armed it. My own test asserted only the projection COUNT, never its mode — the same vacuous-test shape that WT-004.1 round 3 caught. Fix: a pending cap makes the scan's projection a FULL one, and a caller carrying pane evidence never joins as external-only.
- Triage: pending user/build triage

### B2

- ID: B2
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; asm-review-contracts
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/presenceProjector.ts:477`
- Title: Successful external scans cannot clear a prior registry degradation
- Evidence: `lastWindowPass.failures` captures every failure from the full pane pass at lines 440-445. An external-only replay copies all of them, including `registry`, into the new `failures` map at lines 477-480. The current registry is then read at line 487, but the success arm at lines 495-505 replaces sessions without deleting the replayed registry failure. This occurs when a full pass needed registry-backed pane resolution during an outage, followed by successful external-only polls.
- Impact: The UI can report the registry as degraded indefinitely after it has recovered, directly violating D4 and the specification's requirement that a successful registry read must not name the registry as degraded. With no later pane/tree event, no full pass exists to heal the stale status.
- SuggestedFix: Replay only failures for sources the external-only pass does not check, currently `panes`; alternatively delete `registry` from `failures` on an `ok` registry outcome. Add a full-failure then successful-external-only recovery test.
- Status: accepted
- Triage (author): Correct and mine. The replay copies every prior failure including `registry`, but the external pass always re-reads the registry, so its own outcome — not the replay — must decide that entry. Contradicts D4 and the spec's successful-read rule outright.
- Triage: pending user/build triage

### W1

- ID: W1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: asm-review-data-security; chair adjudication
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/presenceProjector.ts:324`
- Title: Valid-shaped registry records can fabricate external ownership
- Evidence: The reader accepts a numeric filename but never checks that its numeric stem equals the payload `pid`; it liveness-probes only the payload pid at `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/runningSessions.ts:148-167`. The new external path then trusts that record's `cwd`, `sessionId`, and live payload pid to publish a running row under a worktree. A mismatched `123.json` can therefore claim another live pid and arbitrary worktree cwd while passing current validation.
- Impact: Registry corruption or format drift can create false running rows, win session-id deduplication over a legitimate record, and incorrectly raise a worktree's activity rank. This is downgraded from the specialist's BLOCK because the registry is same-user local state and external rows are non-actionable in this change; the concrete impact is presence integrity, not a crossed authorization boundary.
- SuggestedFix: Parse the pid from the filename and reject a payload whose pid differs; validate non-empty session ids and an absolute cwd before indexing. Add malformed semantic-record tests.
- Status: accepted
- Triage (author): Split. ACCEPTED: a non-empty `sessionId` and an absolute `cwd` are required before a registry record can become a row — an empty session id would publish `rowId: "external:claude:"` and `entryId: "claude:"`, which is a fabricated identity this change newly exposes.
REBUTTED: requiring the `<pid>.json` filename stem to equal the payload pid. That is exactly the record the archived change deliberately kept — `asimov/changes/archive/260826-1811-project-worktree-agent-presence/.reviews/round-3.md` [W4] and the comment at `src/vault/readers/runningSessions.ts` on `byPid` holding a LIST: two live records can claim one pid, and only one of them can be the file named after it. Enforcing the stem would drop the other and reintroduce the identity-by-enumeration-order bug that fix closed. The liveness probe still gates the payload pid.
- Triage: pending user/build triage

### W2

- ID: W2
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: asm-review-performance
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:209`
- Title: Every five-second poll re-sorts every cached worktree even when ranks are unchanged
- Evidence: Every successful projection reaches `commit()` and unconditionally calls `cache.reorder(discoveryDeps.rank)`. `WorktreeCache.reorder` at `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/WorktreeCache.ts:142-145` walks every cached repo and calls `orderWorktrees` over every worktree. The external timer does this on every tick even when the registry set and all ranks are identical.
- Impact: The hot path performs O(W log W) full sorting every five seconds for total cached worktrees W, indefinitely while the view is shown, even though the common no-change scan needs no ordering work.
- SuggestedFix: Have projection/commit expose whether ranks changed, or compare rank snapshots, and call `reorder` only on a rank delta while preserving D8's ordering guarantee.
- Status: rejected
- Triage (author): CORRECTED — first triaged `accepted`, then measured before implementing, and the measurement does not support the fix. Instrumenting `PresenceProjector.rank` shows one idle poll costs exactly 3 lookups for a 3-worktree repository: `bucketOf` short-circuits on the main worktree, so the sort is not the O(W log W) the finding prices it at. The proposed guard costs one lookup per worktree PLUS a rank-key allocation per commit — the same order, with more garbage, and no observable that can distinguish the two at any scale `docs/design/worktree-agent-presence.md` § 7 admits (worktrees are tens). Reconsider if the worktree count per repository ever leaves that range. The counter added to measure this is kept in the test harness.
- Triage: pending user/build triage

### S1

- ID: S1
- Severity: SUGGEST
- Confidence: MEDIUM
- Priority: P4
- Agent: asm-review-performance
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/presenceProjector.ts:330`
- Title: External attribution is O(machine sessions × window worktrees) per poll
- Evidence: `externalRows` calls `attribute` once per indexed machine-wide session, and `attribute` linearly scans all current worktree ids at `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/presenceProjector.ts:133-140`. This work repeats every five seconds.
- Impact: The recurring scan cost grows as S × W for live indexed sessions S and worktrees W. Both axes are externally driven, though expected desktop counts make this an optimization rather than a demonstrated correctness failure.
- SuggestedFix: If measured counts justify it, index normalized worktree roots for longest-prefix attribution instead of scanning all roots per session.
- Status: rejected
- Triage (author): Non-blocking and conditional on measurement the finding does not have. `docs/design/worktree-agent-presence.md` § 7 bounds both axes at tens (sessions surviving the headless filter x this window's worktrees), and `attribute` is prefix comparison only — the same shape the pane pass has run since WT-004.1. Indexing normalized roots would add a structure to maintain for work that is not on any measured hot path. Reconsider if a real worktree or session count ever makes it visible.
- Triage: pending user/build triage

### S2

- ID: S2
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: asm-review-reuse
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/presenceProjector.ts:334`
- Title: External row identity is constructed in two places
- Evidence: Row creation builds `external:${REGISTRY_AGENT}:${session.sessionId}` at line 334, while successful-read eviction independently rebuilds the same string at line 500. The two expressions jointly define the key contract for `externalSeen`.
- Impact: A future change to one expression can stop first-seen entries from matching their eviction keys, retaining stale state or evicting the wrong identity.
- SuggestedFix: Extract an `externalRowId(sessionId)` helper and use it for row creation and eviction.
- Status: accepted
- Triage (author): Right, and cheap. Row creation and eviction build `external:<agent>:<sessionId>` independently; one helper removes the chance of key drift silently disabling eviction.
- Triage: pending user/build triage

## Full-flow trace

- Full mode: pane evidence event -> 150 ms cap -> `requestProjection()` -> current tree ids -> one snapshot -> resolve every pane -> collect claimed session ids -> attribute window rows -> shared indexed registry read -> append unclaimed external rows -> rank -> version-checked cache reorder -> envelope commit -> visible surface publication.
- External-only mode: visible+displayed surface -> five-second timer -> `requestProjection({ external: true, join: true })` -> replay last full pane rows/claims/ranks for the same tree -> current shared registry read -> external rows/degradation -> rank -> cache reorder -> envelope publication.
- Failure paths: registry failure is typed through both pane resolution and external sessions; pane identity retains prior proof, external rows replay the last successful indexed sessions, and `failingSince` preserves first-failure epochs. B2 is the recovery defect in that flow.
- Concurrency/version boundaries verified safe outside B1: one projection run is serialized; pane evidence arriving during a run marks a full rerun; tree-version mismatch prevents committing a projection against a newer tree; disposal cancels both timers.

## Adjudication notes

- D3's resolution of every pane, including panes producing no worktree row, was verified as intentional and correct; no finding is raised for it.
- The data-security specialist's BLOCK was downgraded to WARN because no auth/action boundary is crossed, but the new external-row trust makes the malformed-record integrity defect reachable and user-visible.
- The contracts specialist reported B1 and B2 as WARN; the chair raises both to BLOCK because each can persist indefinitely and directly violates approved acceptance/spec behavior.
