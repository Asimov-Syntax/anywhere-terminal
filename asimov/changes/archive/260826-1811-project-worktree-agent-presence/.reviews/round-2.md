# Review Round 2

- Date: 2026-08-27
- Cycle: 1
- Mode: verification
- Scope: working tree remediation since round 1
- Scope lock: passed — task 4_1 and its tests are remediation only; no new capability, contract, or design scope was added
- Reviewable lines: 211
- Agents spawned:
  - asm-review-logic — B1 coordinator and publication impact cone — gpt-5.6-sol[1M]
  - asm-review-performance — B2 and W1 growth/rebuttal verification — gpt-5.6-terra[1M]
  - asm-review-contracts — W2/S1/S2 provenance and reuse verification — sonnet[1M]
- Agents skipped:
  - asm-review-data-security — remediation does not touch persistence, auth, secrets, or validation boundaries
  - asm-review-frontend — shared activity behavior is covered through the contracts cone; no React/render implementation changed
  - asm-review-reuse — S1/S2 extraction verification is covered through the contracts cone
- Verdict: BLOCK
- Counts: 1 BLOCK, 2 WARN, 0 SUGGEST open; 4 prior findings fixed
- Verification:
  - Focused remediation suite: 7 files / 182 tests passed
  - `pnpm run check-types`: passed
  - `pnpm run test:unit`: 193 files / 3622 tests passed
  - Scratch pending-tree delivery: failed as expected — a cached request published a new tree with presence naming a removed worktree
  - Scratch joined publication: failed as expected — one coordinated projection cycle emitted two identical pushes

## Findings

### B1

- ID: B1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; asm-review-logic
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:304`
- Title: Broadcast generation races can mismatch or swallow presence
- Evidence: The remediation fixed projector concurrency: every projector entry now funnels through `requestProjection()`, a tree-version move marks the run dirty, and stale work re-runs. Publication is still outside that coordinator. `rebuild()` writes the cache and increments `treeVersion` before awaiting projection. During that await, `reconcileShowing()` at line 291 and a cached `requestWorktreeTree` at line 403 directly post `currentMessage()`, which combines the newly written cache with the previous `projected` value. Watch-failure `applyRepo` writes create the same window. RebuildGate serializes per scope, not globally, so whole-tree and repository rebuilds can also move `treeVersion` independently; publication carries no `projectedVersion` check. A scratch reproduction removed `/repo-wt/b`, parked the rebuild projection, then issued a cached request: the emitted tree no longer contained `/repo-wt/b`, while `presence.rowsByWorktreeId` still named it.
- Impact: Consumers can still receive tree and presence from different versions, violating the accepted envelope contract. The affected entry modes include whole-tree and repo rebuilds, watch-failure cache writes, forced/workspace rebuilds, cached requests, and showing-edge direct serves.
- SuggestedFix: Make tree plus presence a versioned committed envelope. Either stage tree mutations until projection succeeds, or retain `projectedVersion` and prohibit every post while it differs from `treeVersion`. Centralize the final version check and publication in the coordinator so `broadcast`, cached requests, and `reconcileShowing` cannot bypass it.
- Status: accepted
- Triage: persists from round 1 after partial remediation
- Author-Status: accepted
- Author-Triage: Confirmed. Round 1 made the PROJECTION consistent and left DELIVERY inconsistent: `rebuild()` mutates the cache before awaiting the projection, and three paths read `cache.read()` directly inside that window — a cached `requestWorktreeTree`, `reconcileShowing`'s single-surface serve, and the watch-failure `applyRepo`. Fixing by committing tree and presence as one envelope: nothing is delivered from the live cache, and the coordinator is the only thing that commits, only when the presence it holds describes the tree version it holds.
- Invariant: Every accepted pane/tree change eventually projects against the current tree, and every published tree/presence pair comes from the same tree version.
- Boundary inventory:
  - Fixed: pane-versus-pane and pane-versus-rebuild projector concurrency; stale projection dirty rerun; cached delivery no longer invalidates or swallows in-flight work; disposal drops late completion.
  - Still affected: direct cached delivery during a pending tree projection; `reconcileShowing` during that window; concurrent whole-tree/repo rebuild scopes; watch-failure cache writes before projection commit.

### B2

- ID: B2
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; asm-review-performance
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/pty/processTableSnapshot.ts:148`
- Title: The process-table TTL still defines the rebuild boundary
- Evidence: `ProcessTableSnapshot.open()` now captures one table outcome and returns synchronous lookups derived only from it. `presenceDeps.openSnapshot()` lazily opens that reading once per projection and every pty-backed pane uses it; the per-call `descendantsOf()` path is not used. Tests cross the TTL between sequential panes and assert one executor call, and pin failure, unsupported, invalid-pid, and successful lookup behavior.
- Impact: The round-1 inconsistency and repeated-`ps` defect is removed.
- SuggestedFix: None.
- Status: fixed
- Triage: verified at the read, cache hot/cold, failure, unsupported, invalid-pid, and multi-pane TTL boundaries
- Invariant: A single projection performs at most one process-table read, independent of pane count and elapsed projection time.

### W1

- ID: W1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair; asm-review-performance
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/session/resolveClaudeSession.ts:58`
- Title: Per-pane session resolution repeatedly scans shared registry data
- Evidence: The filesystem half is fixed: a snapshot-scoped promise map resolves each transcript mtime once, including concurrent and `undefined` outcomes, and the map is recreated next projection so negatives retry. The registry-index rebuttal is rejected. `listRunningClaudeSessions()` enumerates the user-config-wide `~/.claude/sessions` directory at `runningSessions.ts:100-162`; it has no window, repository, or pane filter. Each unresolved/negative pane then filters that full array for headless entries, process-subtree membership, and cwd at `resolveClaudeSession.ts:58-80`. The remaining growth is O(P×S), where P is panes in this window and S is all live Claude registry sessions under the user configuration, including other windows and repositories. The claimed structural bound to panes in this window does not exist.
- Impact: Negative/unresolved panes deliberately retry and repeatedly scan a globally growing live-session set on presence projections. The expensive O(P×S×H) filesystem multiplier is gone, but the multiplicative registry traversal remains.
- SuggestedFix: Build snapshot-scoped non-headless indexes by PID and normalized cwd from the one shared registry read, then resolve each pane from those indexes while retaining the per-projection mtime cache and cross-projection negative retry.
- Status: accepted
- Triage: persists from round 1 in part; mtime half fixed, registry-index rebuttal rejected
- Author-Status: accepted — round-1 rebuttal withdrawn
- Author-Triage: The rebuttal was wrong and the overrule is correct. I claimed S was window-scoped; `listRunningClaudeSessions` reads `~/.claude/sessions`, which is user-wide — every live Claude session on the machine, unrelated to this window or this workspace. O(P x S) had no structural bound at all, and "single digits in practice" was an assumption about the user's habits dressed up as an argument. Fixing by indexing the registry once per snapshot: `resolveClaudeSession` takes a `RunningSessionIndex` rather than a raw list, headless entries drop at index time instead of per pane, and pid/cwd lookups become O(1).
- Severity note: remains WARN. The global scope clarifies the missing bound but does not change the round-1 mechanism or demonstrated impact enough to override severity stability.

### W2

- ID: W2
- Severity: WARN
- Confidence: MEDIUM
- Priority: P3
- Agent: asm-review-contracts
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/shared/paneEvidence.ts:113`
- Title: Shell titles are credited for idle even when they changed no outcome
- Evidence: `explainLiveActivity()` now returns the winning rule and reports `shell-title` only when a shell title overrode semantic/output work. Quiet shell panes report `quiet`; waiting still wins; exited panes remain exited. The projector derives `activitySource` from the returned rule. Exhaustive tests assert agreement with `projectLiveActivity` across all 32 evidence combinations.
- Impact: Activity provenance now names the causal rule.
- SuggestedFix: None.
- Status: fixed
- Triage: verified across waiting, shell-title, semantic, output, quiet, and exit combinations

### S1

- ID: S1
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: asm-review-contracts
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/shared/paneEvidence.ts:63`
- Title: Share the duplicated title-classification ladder
- Evidence: `classifyTitle` now exists once in the shared module. The store and webview tracker both call it after the same bounded title normalization, with `undefined -> unknown` preserved for the host.
- Impact: The tab and worktree row no longer own drift-prone classification copies.
- SuggestedFix: None.
- Status: fixed
- Triage: verified across both production callers and the webview bundle boundary

### S2

- ID: S2
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: asm-review-contracts
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/claudePaths.ts:175`
- Title: Reuse the existing transcript mtime reader
- Evidence: `claudeSessionMtime` now owns the resolve-then-stat behavior once and is used by presenceDeps and both terminal providers. The extracted behavior preserves no-options resolution and `undefined` on path/stat failure; no import cycle or webview dependency was introduced.
- Impact: The three resolution flows now share one reader implementation.
- SuggestedFix: None.
- Status: fixed
- Triage: verified across all three production call sites

### W3

- ID: W3
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: chair; asm-review-logic
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:218`
- Title: Joined projection callers each publish the same completed result
- Evidence: The pane-cap path attaches its own `broadcast()` continuation to `requestProjection()`, while rebuild callers broadcast after awaiting the same promise. When a pane projection is joined by a forced rebuild and performs the dirty rerun, both callers broadcast after the final clean result. A scratch reproduction emitted two identical messages carrying `scannedAt: 3` from one coordinated projection cycle.
- Impact: One logical presence cycle can generate duplicate IPC pushes and duplicate render checks, so projection is single-flight but publication is not coalesced.
- SuggestedFix: Move publication into the coordinator and publish once after its final clean iteration. Callers should request work without attaching independent broadcast continuations.
- Status: open
- Triage: untriaged
- Author-Status: accepted
- Author-Triage: Confirmed. Both the pane-cap callback and the rebuild attach their own `broadcast()` to `requestProjection()`, so two callers joining one cycle each publish its single result. Single-flight projection is not single-flight publication. Fixed with B1: the coordinator publishes once, after its final clean iteration, and no caller attaches a publication continuation.

## W1 rebuttal ruling

Rejected for the registry-index half. The mtime memoization is accepted and verified, but `S` is not window-scoped: the reader enumerates every live Claude PID entry under the user configuration. "Single digits in practice" is not a structural bound. W1 therefore remains open at its original WARN severity.

## Adjudication notes

- The performance specialist proposed escalating W1 to BLOCK after confirming the registry is global. Severity remains WARN because this is the same unchanged growth mechanism and no new measured impact justifies overriding cross-round severity stability.
- B1 keeps its original ID. The boundary inventory expanded within the same publication/versioning mechanism; the projector-entry fix is real, but patching only concurrency left publication outside the atomic boundary.


## Author triage — round 2

Three open findings, all accepted; the round-1 W1 rebuttal is withdrawn.

B1 and W3 are one mistake seen from two sides: round 1 serialized the projection and left publication alone, so the coordinator governed what was computed but not what was sent. Both are fixed by moving publication into the coordinator and giving it a single versioned envelope to publish.

W1 is the more useful correction. I rebutted it by asserting a bound the code does not have; the reviewer read the registry and found it is user-wide. The fix is the indexing round 1 asked for.