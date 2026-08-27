# Review Round 3

- Date: 2026-08-27
- Cycle: 1
- Round: 3
- Mode: verification
- Scope: range `9a042a5..01f193a`
- Head: `01f193ad9845bf064298c125ab5d925dac057925` (the working tree was already dirty in change analytics metadata; those dirty edits were outside the explicit range)
- Scope lock: passed — remediation, tests, review/task records, and generated analytics only
- Reviewable lines: 183
- Agents spawned:
  - asm-review-logic — B1/W3 precedence, cache, epoch, release, and failure paths — opus[1M]
  - asm-review-data-security — report proof, revocation, source-specific opt-in, and consumers — gpt-5.6-terra[1M]
  - asm-review-performance — B7/W2 per-rebuild and retained-history bounds — sonnet[1M]
- Agents skipped:
  - asm-review-contracts — accepted contracts were unchanged; logic/security verified their changed implementation
  - asm-review-frontend — only the narrow `agentSource` formatter consumer changed and was reviewed inline
  - asm-review-reuse — no reuse/cohesion boundary intersects this remediation
- Verdict: BLOCK
- Counts: BLOCK 2 | WARN 0 | SUGGEST 0
- Prior disposition counts: fixed 8 | rejected 1 | persists 1 | new emergency in cone 1
- Cycle note: this is cycle 1's third and final round. A further user-initiated review must start cycle 2 in discovery mode.
- Verification evidence: `bun run asm change verify-status agent-session-hook-identity` records task 6_2 exit 0 with 12 added assertions; the author records clean type-check and 4417 passing unit tests. Required manual task 5_1 still has no record. The review did not rerun project verification commands.

## Current findings

### B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic, asm-review-data-security
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/worktree/presenceProjector.ts:469`
- title: A report is still subordinate to weaker or stale identity outside the absent-only branch
- evidence: Equal-id evidence rank is fixed, but the report is not resolved first. On a cache hit, a claim naming a different agent is discarded and the `{ptyPid,cwd}`-cached identity is returned forever. A same-agent claim updates only `entryId` and `evidence`, preserving the weaker `source`; the initial proven path likewise preserves `outcome.source`, so a normal pane titled `opencode` remains `agentSource: "title"` and is excluded by `hasProvenIdentity`, while the otherwise identical `zsh` pane reaches the absent branch and becomes `source: "report"`. The `failed` branch returns before consulting the standing claim. Finally, when a report-derived source disappears after runtime release/reissue, the cache-hit branch returns the cached report identity because `reported === undefined`, so the revoked proof is not revalidated. These are all boundaries of the prior invariant that a report independently establishes the highest identity source.
- impact: A pane switching from another cached agent to OpenCode keeps the wrong agent/session/title; a valid same-agent report is mislabeled as weak title/launch/registry evidence and can lose proven-identity affordances; an unrelated registry/process failure hides a standing report; and released report evidence can remain displayed indefinitely.
- suggestedFix: Read the current report claim before cache reuse and before weaker resolution. When present, construct the authoritative identity with `agent`, `source: "report"`, `entryId`, and `evidence: "reported"`, treating a changed reported agent/session as a handover. When absent, invalidate or re-resolve any cached `source: "report"` identity rather than returning it. Continue recording independent registry/process degradation without allowing it to suppress the report.
- status: accepted
- triage: accepted, not yet fixed — cycle thrash stop. Every sub-point checks out against the code, and they share one root the incremental patches kept dancing around: the report is consulted at three different places INSIDE the existing precedence instead of ahead of it. The fix hypothesis is single and stated: resolve a standing report first, build the whole identity from it (agent, `source: "report"`, entryId, `reported` evidence), and drop a cached report-derived identity when no report stands. Held for the user's decision under the 3-round cap. || chair's note: persists from rounds 1 and 2. Fixed boundaries: equal-id confirmation now carries reported rank; absent+report creates a row; consumers accept the new source. Still affected: different-agent cache/proven paths, same-agent source precedence, failed weaker reads, and report revocation. The boundary inventory expanded for a third round, so patch-level fixing has not closed the invariant.
- invariant: A standing authenticated report is the first and authoritative identity source for its pane; no weaker source, cache entry, or failed read may override it, and a report-derived identity may not outlive the standing report.
- boundary inventory:
  - affected: cached different agent with unchanged PID/cwd; initial weaker identity naming another agent; same-agent report over title/launch/registry; report present during failed registry/process read; runtime release/reissue/disable removing a standing report
  - verified safe: equal-id confirmation rank; differing same-agent session id; absent outcome with report; contested-session settlement after reported evidence is attached; rendering/signature/icon consumers

### B8

- ID: B8
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-data-security, chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/extension.ts:426`
- title: Disabling OpenCode reporting does not disable already-running OpenCode producers
- evidence: Setting reconciliation clears the lazy environment for future terminals and calls `setDesiredReceiverEnabled(false)`. When Cursor hooks remain authorized, `CursorHookController.applyReconciledAuthority()` keeps the shared runtime enabled and existing terminal tokens valid. Existing OpenCode processes already loaded plugin v3 and retain `ANYWHERE_TERMINAL_AGENT_HOOK_URL`, so `/opencode` reports continue to be accepted after the machine setting is off. There is no source-specific runtime enable gate, report-map clear, or removal notification. If the whole runtime is revoked instead, B1's cache still retains the copied report identity.
- impact: The explicit opt-in does not control reporting for live panes: session ids can continue crossing the loopback observer after the user disables OpenCode reporting, and report-derived row identity is not revoked end to end.
- suggestedFix: Add source-specific OpenCode enablement to the receiver. On disable, reject new `/opencode` requests, clear existing OpenCode reports, notify presence of removals, and make cached report identity fall back/re-resolve. Keep Cursor activity authority independent.
- status: accepted
- triage: accepted, not yet fixed — cycle thrash stop. Confirmed: `applyOpencodeHooks` only stops contributing the env to FUTURE terminals, and while Cursor holds the receiver up the credentials already issued keep accepting `/opencode` posts. The spec makes the setting control reporting on the host, so this is an opt-in gap, not a nicety. Fix hypothesis: a source gate on the receiver plus clearing retained reports and invalidating report-derived identity on disable, leaving Cursor authority untouched. || chair's note: new emergency finding inside the report-source and setting lifecycle impact cone. It is admissible in verification because it crosses the machine-scoped opt-in/privacy boundary. This is a different mechanism from round-1 B5's fixed future-terminal environment capture.
- invariant: The OpenCode machine setting must gate both future producer installation and current receiver authority, including retained reports and projector state.
- boundary inventory:
  - affected: OpenCode on-to-off while Cursor keeps the shared receiver active; already-running plugin; existing token; retained report map and cached row
  - verified safe: future terminals after disable receive no extension OpenCode config directory; disabling when no other source wants the runtime revokes all tokens

## Resolved prior findings

### B2

- ID: B2
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-logic, chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/agentHooks/opencodePlugin.ts:45`
- title: `message.updated` reports a message id as the session id
- evidence: Plugin v3 remains restricted to parentless session events and ignores message/child-session ids.
- impact: Only root session ids can reach reported identity.
- suggestedFix: none.
- status: fixed
- triage: fixed in round 2 and verified unchanged in round 3.

### B3

- ID: B3
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-data-security, asm-review-contracts, chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/agentHooks/hookEnvironment.ts:28`
- title: The hook environment overwrites a per-terminal `OPENCODE_CONFIG_DIR`
- evidence: Final spawn environment remains visible to the contributor and existing terminal values win.
- impact: User-selected configuration is preserved.
- suggestedFix: none.
- status: fixed
- triage: fixed in round 2 and outside the round-3 change cone.

### B4

- ID: B4
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-data-security, asm-review-contracts, chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/agentHooks/opencodePlugin.ts:64`
- title: The awaited report request has no client-side timeout
- evidence: Plugin v3 retains the one-second abort and failure retry behavior.
- impact: A stalled peer cannot indefinitely block the event hook.
- suggestedFix: none.
- status: fixed
- triage: fixed in round 2 and verified unchanged in round 3.

### B5

- ID: B5
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-logic, asm-review-contracts, chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/extension.ts:384`
- title: OpenCode setting changes leave the installed contributor on its old environment
- evidence: The lazy provider remains current for every future terminal; B8 is a separate current-runtime authority mechanism.
- impact: Future terminal environment reflects the setting without contributor replacement.
- suggestedFix: none for the captured-environment mechanism.
- status: fixed
- triage: fixed in round 2; B8 records the distinct existing-terminal receiver boundary.

### B6

- ID: B6
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic, asm-review-contracts
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/extension.ts:418`
- title: Concurrent setting applications can restore an older OpenCode opt-in state
- evidence: Monotonic revision remains in place and only the latest application publishes state.
- impact: Stale async installation cannot restore an older setting.
- suggestedFix: none.
- status: fixed
- triage: fixed in round 2 and verified unchanged in round 3.

### B7

- ID: B7
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-performance, asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/worktree/presenceDeps.ts:99`
- title: The single-flight vault read clears before the sequential pane loop reaches pane two
- evidence: The lookup now lives in the per-rebuild snapshot. Its lazy `sessionsRead` promise builds one newest `(agent,resolved cwd)` index and every sequential pane reads that map; each `openSnapshot()` gets a fresh closure.
- impact: Projection performs at most one O(H) vault read/index build independent of pane count P, with no cross-rebuild staleness.
- suggestedFix: none.
- status: fixed
- triage: fixed in round 3; both logic and performance specialists verified the one-read bound.

### W1

- ID: W1
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-contracts
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/agentHooks/opencodePlugin.ts:60`
- title: The report payload omits the approved event name
- evidence: No evidence delta; accepted D6/interface still specify session-id-only payload and no consumer needs an event name.
- impact: No concrete runtime defect under the accepted mechanism.
- suggestedFix: none in this cycle.
- status: rejected
- triage: rejected since round 1; not re-reported.

### W2

- ID: W2
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair, asm-review-performance, asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/agentHooks/opencodePlugin.ts:40`
- title: Successful-report deduplication grows with root-session history
- evidence: Plugin v3 stores one scalar current id. Failure cleanup is conditional, so an older failed request cannot clear a newer id.
- impact: Retained identity is O(1) in session history and switches/retries correctly.
- suggestedFix: none.
- status: fixed
- triage: fixed in round 3; performance and logic specialists verified the structural bound.

### W3

- ID: W3
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: asm-review-logic, chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/worktree/presenceProjector.ts:321`
- title: Correcting a directory guess restarts the row's age and clears its finish time
- evidence: `startsNewEpoch` now preserves the epoch for the accepted weaker-evidence-to-report correction and starts a new epoch for successive reported session ids. The ambiguous first report after an unreported transition has no additional authoritative signal; the implemented policy matches W3's accepted correction contract.
- impact: Correcting a guess no longer makes the existing pane appear newly started.
- suggestedFix: none under the accepted policy.
- status: fixed
- triage: fixed in round 3. The specialist's alternate weaker-to-reported handover scenario is observationally identical to a correction and introduces no evidence delta that reopens W3.
