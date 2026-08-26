# Review Round 1

- Date: 2026-08-27
- Cycle: 1
- Mode: discovery
- Scope: working tree
- Reviewable lines: 1205
- Large change: yes — accuracy may decrease
- Agents spawned:
  - asm-review-logic — host publication concurrency — gpt-5.6-sol[1M]
  - asm-review-logic — identity projection invariants — gpt-5.6-terra[1M]
  - asm-review-contracts — accepted presence contracts — sonnet[1M]
  - asm-review-performance — pane/session/worktree growth axes — gpt-5.6-terra[1M]
  - asm-review-frontend — tab/host activity parity — gpt-5.6-luna[1M]
  - asm-review-reuse — helper reuse and cohesion — gpt-5.6-luna[1M]
- Agents skipped:
  - asm-review-data-security — no persistence, auth, secrets, public API, or untrusted data-store boundary changed
- Verdict: BLOCK
- Counts: 2 BLOCK, 2 WARN, 2 SUGGEST
- Verification:
  - `pnpm exec vitest run` focused presence suite: 192 passed
  - `pnpm run check-types`: passed
  - `pnpm run test:unit`: 193 files / 3601 tests passed
  - Scratch reverse-completion race: failed as expected (`scannedAt` 100 published instead of rebuild result 200)
  - Scratch cached-request race: failed as expected (`scannedAt` 1 remained instead of pane result 2)
  - Scratch rebuild-TTL boundary: failed as expected (2 `ps` reads instead of 1)

## Findings

### B1

- ID: B1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; asm-review-logic; asm-review-contracts
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:163`
- Title: Broadcast generation races can mismatch or swallow presence
- Evidence: `runProjection()` serializes only pane-triggered work, while `rebuild()` calls `reproject()` directly at line 301. Both calls can stamp the same `publishGeneration` and enter the stateful projector concurrently. If the older pane projection completes first after the rebuild has installed a new tree, it publishes its old-tree result with the new tree; its broadcast then invalidates the rebuild projection, and `rebuild()` broadcasts the stale projection again. Separately, every cached/no-surface `broadcast()` increments `publishGeneration`; a cached `requestWorktreeTree` during an in-flight pane projection invalidates that result without setting `projectionDirty`, so the pane change is never retried. Scratch tests reproduced both orders: the rebuild result `scannedAt: 200` ended as `100`, and a pane result `2` was swallowed by cached result `1`.
- Impact: The host can violate the accepted invariant that every envelope pairs presence with the tree it describes, and can lose a pane activity/identity transition indefinitely until another evidence event occurs. Concurrent entry also races the projector's shared `states`, `ranks`, and `failingSince` maps.
- SuggestedFix: Serialize rebuild-triggered and pane-triggered projection through one coordinator. Version tree snapshots/mutations rather than delivery attempts, commit tree plus presence atomically, and enqueue/retry projection whenever a real newer tree invalidates work. Cached or skipped delivery must not supersede projection work. Add both reverse-completion and cached-request regression tests.
- Status: accepted
- Triage: Confirmed independently. `rebuild()` bypasses `runProjection()`'s single flight, so two projections can enter the stateful projector at once and the older can commit last; and `broadcast()` bumps the generation even when nothing was posted, invalidating an in-flight projection with no retry. Fixing by serialising every entry into the projector through one coordinator, versioning on cache writes instead of delivery attempts, and re-running on invalidation rather than dropping.
- Invariant: Every accepted pane change eventually projects against the current tree, and every published tree/presence pair comes from the same tree version.
- Boundary inventory:
  - Affected: pane projection overlapping whole-tree/scoped rebuild; cached tree request during projection; broadcasts with no showing surface.
  - Verified safe: pane-triggered projection versus pane-triggered projection uses the dirty rerun; disposal drops late completion and cancels the pending cap.

### B2

- ID: B2
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; asm-review-logic
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/presenceDeps.ts:77`
- Title: The process-table TTL still defines the rebuild boundary
- Evidence: `openSnapshot()` captures the running-session promise but not an immutable process-table read. Each sequential pane resolution calls the window-scoped `table.descendantsOf()` separately. `ProcessTableSnapshot` starts a new `ps` read once its successful-read TTL expires, so a slow projection can resolve later panes from a second process-table moment. This directly contradicts accepted D9 and the scenario requiring one process-table read even when a rebuild outlives the cache window. A scratch projection with two panes and a clock advanced by transcript mtime resolution called the injected `ps` executor twice.
- Impact: One presence rebuild can exceed the hard one-read bound and resolve panes against inconsistent process snapshots. The accepted performance and consistency contract is not implemented despite the passing tests.
- SuggestedFix: Capture one immutable process-table outcome for the rebuild and derive every pane's descendants from it. Extend the snapshot API or pass the rebuild's pane roots into snapshot creation; do not call the cross-rebuild TTL-backed lookup independently per pane. Add a production-wiring test that advances time past the TTL between pane resolutions and asserts one executor call.
- Status: accepted
- Triage: Confirmed, and it contradicts this change's own design.md D9, which says in as many words that a TTL cannot satisfy a per-rebuild bound. `openSnapshot()` pinned the registry read but left `descendantsOf` per pane against the TTL-backed table. Fixing by adding a pinned reading to `ProcessTableSnapshot` — one table taken once per rebuild, every pane's descendants derived from it — with a test that crosses the TTL between two pane resolutions.
- Invariant: A single projection performs at most one process-table read, independent of pane count and elapsed projection time.
- Boundary inventory:
  - Affected: sequential multi-pane projection crossing the successful-read TTL.
  - Verified safe: concurrent descendant calls share `inFlight`; fast sequential calls inside the TTL share the cached table; failed reads are not cached.

### W1

- ID: W1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair; asm-review-performance
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/presenceDeps.ts:84`
- Title: Per-pane session resolution repeatedly scans and stats shared snapshot data
- Evidence: The shared registry is only a promise. Every pane without a reusable proven identity invokes `resolveClaudeSession()` over the full live-session array, repeating headless filtering plus subtree/cwd scans. Candidate tie-breaking calls the un-memoized `sessionMtime` at line 89; the production implementation calls `resolveClaudeSessionPath`, which readdir-scans the Claude projects root and stats project candidates before the final transcript stat. With P unresolved/negative panes, S live sessions, and H project directories, one projection performs O(P×S) registry inspections and can perform O(P×S×H) filesystem probes. Proven hot entries bypass this while pid/cwd hold, but negative outcomes are deliberately retried on every rebuild.
- Impact: A title/waiting/idle transition can turn the 150 ms projection path into repeated filesystem work whose cost grows multiplicatively with panes, live sessions, and Claude project directories.
- SuggestedFix: Build snapshot-scoped registry indexes and memoize `sessionMtime` as `Map<sessionId, Promise<number | undefined>>`. Reuse one resolved path/mtime per session for the whole projection; preserve negative retry across projections.
- Status: accepted
- Triage: Accepted in part. The filesystem half is real and cheap to kill: `sessionMtime` re-resolves and re-stats the same transcript for every pane that tie-breaks on it, and `resolveClaudeSessionPath` probes each Claude project directory, so the cost is O(P x S x H) probes on the 150 ms path. Memoising it per snapshot removes that entirely. Rebutting the registry-index half: `resolveClaudeSession`'s per-pane filter is O(S) over the LIVE claude processes in one window — single digits in practice, bounded by panes that ran an agent — so O(P x S) array inspections is not worth changing that function's accepted contract for. Revisit if S ever stops being window-scoped.

### W2

- ID: W2
- Severity: WARN
- Confidence: MEDIUM
- Priority: P3
- Agent: asm-review-contracts
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/presenceProjector.ts:202`
- Title: Shell titles are credited for idle even when they changed no outcome
- Evidence: `activitySourceFor()` reports `title` for every final `idle` state whose title token-matches a shell. It has no access to whether the shell rule actually overrode recent output or semantic-working evidence. A pane with no output and no semantic state is idle regardless of its title, yet the row still says the title produced that activity.
- Impact: The row's evidence provenance can be false, and the UI explains an ordinary idle state as inferred from title evidence even when the title was not causal.
- SuggestedFix: Return the winning activity rule/source with the shared activity projection, or otherwise carry whether the shell rule actually overrode running evidence. Test shell-title idle both with and without live output/semantic evidence.
- Status: accepted
- Triage: Confirmed. `activity === "idle" && isShellName(title)` labels the source `title` for every idle pane with a shell title, including one that was idle anyway — inferring causality from the outcome. Fixing by having the shared projection report which rule won and threading that through the store, so the source names the rule that actually decided, not the state it landed in.

### S1

- ID: S1
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: asm-review-reuse
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/terminal/TerminalActivityTracker.ts:40`
- Title: Share the duplicated title-classification ladder
- Evidence: `TerminalActivityTracker.ts:40-48` and `PaneEvidenceStore.ts:127-137` independently implement the same shell/agent/neutral classification using the same token matchers; only the host adds `undefined -> unknown`.
- Impact: A future classifier change can update one bundle and make the terminal tab disagree with its worktree row despite the current parity tests.
- SuggestedFix: Export one dependency-free title-classification helper from the shared module, preserving `undefined -> unknown`, and use it in both callers.
- Status: accepted
- Triage: Real duplication, and the W2 fix touches the same function, so it lands in the same round rather than leaving a third copy behind. `classifyTitle` moves into `src/shared/paneEvidence.ts` beside the rule it feeds; the store and the webview tracker both call it.

### S2

- ID: S2
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: asm-review-reuse
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/presenceDeps.ts:34`
- Title: Reuse the existing transcript mtime reader
- Evidence: `presenceDeps.ts:34-43` adds a third copy of the same resolve-session-path, stat, and failure-to-undefined routine already present in `TerminalViewProvider.ts:803-813` and `TerminalEditorProvider.ts:774-784`.
- Impact: Claude path resolution or failure behavior can drift between presence projection and the existing session-resolution flows.
- SuggestedFix: Extract a shared reader-layer `sessionMtime` helper and use it from all three call sites; combine this with W1's snapshot-scoped promise memoization.
- Status: accepted
- Triage: Third copy of the same routine. Extracting `claudeSessionMtime` into `src/vault/readers/claudePaths.ts`, which already owns `resolveClaudeSessionPath`, and calling it from presenceDeps and both terminal providers.

## Adjudication notes

- The specialist BLOCK about a rejected `listRunning()` promise was not retained: the production `listRunningClaudeSessions()` contract is explicitly no-throw and D10 deliberately defers a typed registry outcome to WT-004.2. A rejecting injected test seam is not evidence of a reachable production failure in this change.
- The performance specialist's O(P×W) attribution finding was not retained as gating: the nested-worktree scan is bounded by the current pane/worktree snapshots and no measurement showed it violating the blueprint's 10-pane/10-worktree target. It remains a future optimization candidate, not a concrete defect here.
- Frontend review found no activity-parity issue.

## Author triage — round 1

Six findings, all accepted; one accepted in part (W1's registry-index half rebutted, reason recorded above).

B1 and B2 are both failures to enforce decisions this change had already written down: D3.4 said publication is single-flight, and D9 said in as many words that a TTL cannot define a rebuild boundary. The review found the code disagreeing with its own design, which is the finding I most wanted and least expected.
