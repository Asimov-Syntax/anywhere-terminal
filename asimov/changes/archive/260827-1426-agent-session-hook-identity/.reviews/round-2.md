# Review Round 2

- Date: 2026-08-27
- Cycle: 1
- Round: 2
- Mode: verification
- Scope: range `0f16ea7..9a042a5`
- Head: `9a042a59a303511c4b066078fa7cbf8a99d89425` (the working tree was already dirty in change analytics metadata; those dirty edits were outside the explicit range)
- Scope lock: passed — the range contains round-1 remediation, tests, review/task records, and generated analytics only; no new capability or semantic contract was added
- Reviewable lines: 304
- Agents spawned:
  - asm-review-logic — B1/B2/B4/B5/B6 report lifecycle and state impact cone — opus[1M]
  - asm-review-contracts — B3/B4/B5/B6 contracts and W1 rebuttal — gpt-5.6-terra[1M]
  - asm-review-performance — B7/W2 growth-axis verification — sonnet[1M]
- Agents skipped:
  - asm-review-data-security — no new security boundary; the narrow configuration/timeout fixes were covered by contracts and chair
  - asm-review-frontend — no frontend implementation changed
  - asm-review-reuse — no reuse/cohesion finding intersects the remediation cone
- Verdict: BLOCK
- Counts: BLOCK 2 | WARN 2 | SUGGEST 0
- Prior disposition counts: fixed 5 | rejected 1 | persists 3 | new in cone 1
- Verification evidence: `bun run asm change verify-status agent-session-hook-identity` records task 6_1 exit 0 and 17 added assertions; the author records clean type-check and 4409 passing unit tests. Required manual task 5_1 still has no record. The review did not rerun project verification commands. A targeted promise-order probe confirmed that the `pending.then(clear)` pattern starts two reads for two sequential awaits.

## Current findings

### B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/worktree/presenceProjector.ts:453`
- title: A confirming report still keeps directory rank, and an unproven pane still cannot use the report
- evidence: The cache-hit fix returns immediately when `reported === state.proven.entryId`, without changing `state.proven.evidence` to `reported`. Thus a pane that guessed the correct id from cwd and later reports that same id remains ranked `directory`; when another proven pane shares the guess, `settleContestedSessions` still sees a top-rank tie and disowns both. The new test covers only a differing stale/live id. The other prior boundary is also unchanged: both report reads require an already-proven `state.proven`/`outcome`, while the accepted worktree-presence spec says agent identity sources are ranked report, launch, registry/process, then title and says a report can be the source proving the agent (`specs/worktree-agent-presence/spec.md:5-9`). D4 describes session evidence but does not withdraw that normative source order.
- impact: The approved one-reporter-versus-directory-claimant scenario still fails when the directory guess already equals the reported session, and a valid report cannot identify an OpenCode process whose launch/title sources are absent. The core report-as-highest-evidence invariant remains only partially implemented.
- suggestedFix: Whenever a report exists, upgrade evidence to `reported` even when its entry id matches the cache. Implement the accepted report agent-source boundary, including the row source contract, or hand the change back to planning and supersede this cycle if the approved requirement is to be changed rather than implemented.
- status: accepted
- triage: accepted, both boundaries fixed. The equal-id path now re-stamps `reported` evidence rather than returning early — the chair is right that a correct guess was the dangerous case, because a tie hands the session to neither pane. The agent-source boundary is implemented rather than handed back: `agentSource` gains `report`, `hasProvenIdentity` counts it, and a report standing on a pane nothing else recognises proves the agent — the report arrives from inside the agent under a credential issued to that terminal for that run, and its map is cleared when the terminal exits. || chair's note: persists from round 1. Fixed boundaries: differing late report, second differing session, report-triggered projection, title/vault refresh, and contested settlement once `reported` evidence is attached. Still affected: equal-id confirmation and report-as-agent-source with no weaker proof. The recorded partial rebuttal is not accepted because the approved spec explicitly names report as the highest agent-identity source.
- invariant: An authenticated self-report must independently establish its approved identity source and must carry `reported` rank even when it confirms rather than changes the guessed session id.
- boundary inventory:
  - affected: late report equal to cached directory entry; contested same-id claim with one reporter; plain-shell report with no launch/registry/title proof
  - verified safe: late report with a differing entry id; a second differing report in the same pane; report already present before first proven projection; projection notification and vault retitling

### B7

- ID: B7
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-performance
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/extension.ts:621`
- title: The single-flight vault read clears before the sequential pane loop reaches pane two
- evidence: `projectPanes` processes panes sequentially and awaits `identify()` inside its `for` loop (`presenceProjector.ts:645-656`). `listSessionsOnce()` registers `pending.then(clear, clear)` before returning the promise. When the list settles, that clear reaction runs before the awaiting pane resumes, so `sessionsInFlight` is already undefined when the next pane calls the fallback. A targeted scratch probe of the same pattern produced `sequential reads=2`; no added test covers multiple fallback panes or call count.
- impact: `P` fallback panes still perform `P` sequential full uncached reads of all vault stores and scans over history `H`; the original `P × O(H)` projection latency is unchanged.
- suggestedFix: Bind the list promise/result to the projection snapshot or explicitly load/index the vault once at the projection boundary and share it across all pane identities. Do not clear on promise settlement when the actual consumers are sequential.
- status: accepted
- triage: accepted; the earlier single-flight was the wrong shape and the chair's probe is right — panes are awaited one after another, so the slot cleared between them. The lookup moved onto the per-rebuild snapshot: `openSnapshot` now builds a newest-per-(agent, directory) index from one vault read and every pane in that rebuild answers from it, which is the bound `processTable`/`listRunning` already keep in that file. || chair's note: persists from round 1. The helper only coalesces concurrent callers, but the production impact cone contains sequential callers.
- invariant: One projection may perform at most one full vault-store read for all fallback panes, independent of pane count.
- boundary inventory:
  - affected: two or more sequential non-Claude/no-report panes in one projection; large vault history; pane cache invalidation causing fallback re-entry
  - verified safe: truly concurrent overlapping callers share the promise; resolve/reject clears the slot without retaining a failed promise; panes with report or registry entry bypass the fallback

### W2

- ID: W2
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair, asm-review-performance
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/agentHooks/opencodePlugin.ts:40`
- title: Successful-report deduplication still grows with root-session history
- evidence: B2's fix correctly excludes message and child-session ids, but the generated plugin still retains every distinct root session id in an unbounded `Set` with no eviction, TTL, or replacement. The original W2 growth axis was distinct sessions `S` in one long-lived OpenCode process; after `S` root sessions the Set still retains `S` entries.
- impact: The severe per-message multiplier is fixed, but long-lived OpenCode processes still accumulate session-history ids indefinitely.
- suggestedFix: Retain only the current/last successfully reported root session id, or use a structurally bounded TTL/LRU if older ids must remain deduplicated.
- status: accepted
- triage: accepted; the Set is gone. The plugin remembers one id — the session the terminal is currently on — so the growth axis is closed rather than reduced. || chair's note: persists from round 1. The accepted B2 narrowing reduces the multiplier but does not satisfy W2's named structural bound, so the previous WARN severity remains stable.

### W3

- ID: W3
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: asm-review-logic, chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/worktree/presenceProjector.ts:456`
- title: Correcting a directory guess restarts the row's age and clears its finish time
- evidence: A differing late report replaces `state.proven.entryId`. `stamp()` then treats two defined, differing entry ids as a new epoch, resetting `startedAt`, activity timestamps, and `finishedAt`. In this path the pane did not start a new agent/session at report time; the projector merely corrected its earlier guess. The added late-report test asserts entry id and title only.
- impact: A long-running or recently idle pane appears freshly started and loses its completion time when its exact report arrives.
- suggestedFix: Distinguish an evidence-rank correction from a real session transition when stamping epochs. Preserve timestamps when the same pane/agent/source upgrades from weaker evidence to `reported`, and add a timestamp assertion to the late-report test.
- status: accepted
- triage: accepted. `startsNewEpoch` now treats weaker-evidence → `reported` for the same agent as a correction rather than a handover; two successive reports naming different sessions still start a new epoch. || chair's note: new finding inside B1's behavioral impact cone; admissible in verification because the remediation directly changes this state transition.

## Resolved prior findings

### B2

- ID: B2
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-logic, chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/agentHooks/opencodePlugin.ts:45`
- title: `message.updated` reports a message id as the session id
- evidence: Plugin v2 now admits only `session.created`/`session.updated`, rejects sessions with `parentID`, and ignores every message/part event. The generated version bump ensures the installed v1 source is replaced.
- impact: Message ids and task child-session ids no longer overwrite terminal identity.
- suggestedFix: none — invariant verified across session, message, child-session, and version-replacement paths.
- status: fixed
- triage: fixed in round 2.

### B3

- ID: B3
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-data-security, asm-review-contracts, chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/agentHooks/hookEnvironment.ts:28`
- title: The hook environment overwrites a per-terminal `OPENCODE_CONFIG_DIR`
- evidence: `SessionManager` now passes the final pending spawn environment into the contributor, and `withHookEnvironment` omits a fixed key when that environment already carries a nonempty value. Credential variables remain contributed last and authoritative.
- impact: A terminal-selected OpenCode configuration directory reaches the process unchanged while report credentials remain per-run.
- suggestedFix: none — invariant verified at the final spawn merge.
- status: fixed
- triage: fixed in round 2.

### B4

- ID: B4
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-data-security, asm-review-contracts, chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/agentHooks/opencodePlugin.ts:61`
- title: The awaited report request has no client-side timeout
- evidence: Plugin v2 supplies a one-second `AbortSignal.timeout`; transport failure and abort both release the awaited event handler and delete the id so a later qualifying event may retry.
- impact: A loopback peer that accepts but never answers no longer blocks OpenCode indefinitely.
- suggestedFix: none — the producer-side completion bound is enforced.
- status: fixed
- triage: fixed in round 2. Receiver-side fail-open 200s are intentionally indistinguishable from acceptance, but retries with the same invalid credential would not succeed and do not reopen B4.

### B5

- ID: B5
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-logic, asm-review-contracts, chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/extension.ts:384`
- title: OpenCode setting changes leave the installed contributor on its old environment
- evidence: The contributor now calls a provider for the current `opencodeEnvironment` at every terminal `create()`, so it no longer captures the object installed under an earlier setting value.
- impact: Future terminals see the current setting without contributor replacement or live credential revocation.
- suggestedFix: none — lazy contribution verified for on/off changes while Cursor independently keeps the receiver active.
- status: fixed
- triage: fixed in round 2.

### B6

- ID: B6
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic, asm-review-contracts
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/extension.ts:418`
- title: Concurrent setting applications can restore an older OpenCode opt-in state
- evidence: Each application captures a monotonic revision and returns before publishing environment or receiver authority when superseded. The last-started setting application is the only one that can commit state.
- impact: Older asynchronous plugin installation cannot restore reporting after a newer disable.
- suggestedFix: none — overlapping enable/disable ordering verified.
- status: fixed
- triage: fixed in round 2.

### W1

- ID: W1
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-contracts
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/agentHooks/opencodePlugin.ts:60`
- title: The report payload omits the approved event name
- evidence: The contracts specialist re-raised the same spec sentence, but no evidence changed from round 1. The accepted later mechanism is explicit: design D6 says the producer sends the session id and nothing else, and its accepted interface contains exactly terminalId, agent, and sessionId. No receiver, store, projector, or row consumes event name.
- impact: No concrete runtime or safety defect remains under the accepted identity-only mechanism.
- suggestedFix: none in this review. A future wording cleanup may reconcile the spec ceiling with D6, but changing the accepted contract would be new scope.
- status: rejected
- triage: round-1 rebuttal upheld under the cross-round rule: rejected findings remain rejected absent an evidence delta and are not re-reported as open.
