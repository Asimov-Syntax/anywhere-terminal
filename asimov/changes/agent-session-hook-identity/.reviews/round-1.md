# Review Round 1

- Date: 2026-08-27
- Cycle: 1
- Round: 1
- Mode: discovery
- Scope: range `0d3d2fe..0f16ea7`
- Head: `0f16ea72041b0d5a2f195c4c993508a26165df63` (the working tree was already dirty in change analytics metadata; those dirty edits were outside the explicit range)
- Reviewable lines: 1261
- Size note: Large change — accuracy may decrease.
- Agents spawned:
  - asm-review-logic — report propagation, cached identity, setting transitions, and async state — opus[1M]
  - asm-review-contracts — producer/receiver/vault/projector contracts and accepted obligations — gpt-5.6-terra[1M]
  - asm-review-data-security — token-bound receiver, untrusted report body, config preservation, and fail-open behavior — sonnet[1M]
  - asm-review-performance — report/cache growth axes and vault lookup costs — gpt-5.6-luna[1M]
  - asm-review-reuse — hook lifecycle abstractions and duplicated vault selection — gpt-5.6-luna[1M]
  - asm-finder — terminal-environment and report-to-render flow trace — gpt-5.6-luna[1M]
- Agents skipped:
  - asm-review-frontend — no changed frontend rendering or client-state implementation
- Verdict: REJECT
- Counts: BLOCK 7 | WARN 2 | SUGGEST 0
- Verification evidence: `bun run asm change verify-status agent-session-hook-identity` records exit 0 for tasks 1_1 through 4_2; workflow notes record type-check and 4401 unit tests passing. Required manual task 5_1, proving a live OpenCode report resolves to the same vault session, has no record. The review did not rerun project verification commands.

## Current findings

### B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic, asm-review-contracts
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/worktree/presenceProjector.ts:446`
- title: Self-reported identity is consulted only after cached or weaker identity succeeds
- evidence: `identify()` returns `state.proven` while PID and cwd are unchanged before calling `deps.reportedSession`, and the report lookup itself is nested inside `outcome.kind === "proven"`. A launched OpenCode pane is therefore cached from launch/directory evidence before the first plugin event, later reports and second-session reports never replace it, and a valid report from OpenCode started in an otherwise unproven shell is ignored entirely. `extension.ts:351-375` also supplies no `onReport` callback to invalidate the pane or request projection. The accepted task plan explicitly requires reading the report before resolving (`tasks.md:88`).
- impact: The primary feature is unreliable or absent in its normal flow: the agent's exact session does not become the row identity, cannot outrank the directory guess, and cannot update when the pane starts another session.
- suggestedFix: Treat the receiver's report as first-class identity before the cache and before weaker resolution. Include the current reported entry id in the pane cache key or invalidate on change, allow a valid report to establish the reporting agent without launch/title proof, and wire report arrival to schedule projection.
- status: accepted
- triage: Confirmed by reading `identify()`: the proven tuple is keyed on pty pid + cwd, neither of which moves when OpenCode boots and posts, so the report lands after the pane is already cached and is never read again. That is the feature's normal flow, not an edge. Fixing both halves — the report is consulted before the cache short-circuit and a report arrival schedules a projection. One boundary from the inventory is deliberately NOT fixed here: 'OpenCode started from a plain shell with no launch/title proof'. D4 makes a report a fourth kind of *evidence* for which session a pane is on, not a way to prove an agent is there at all; letting it prove agent-ness needs a fourth `WorktreeAgentRow["agentSource"]` beyond launch/registry/title, which is accepted design and row contract, so it is a plan handback rather than something to invent mid-build. In practice the pane is already recognised — rank 4 matches the `opencode` title, which is what the preceding debug session's rows were resolving by.
- invariant: An authenticated self-report is independent, highest-ranked identity evidence and must supersede cached or weaker evidence for the same terminal.
- boundary inventory:
  - affected: report after initial launch/directory projection; second reported session in unchanged pane; OpenCode started from a plain shell with no launch/title proof; poll-driven rebuilds
  - verified safe: a report already present before the first projection when another source also proves the agent; contested-session settlement after `reported` evidence has actually reached a row

### B2

- ID: B2
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-logic, chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/agentHooks/opencodePlugin.ts:51`
- title: `message.updated` reports a message id as the session id
- evidence: The generated plugin falls back from `properties.sessionID` to `properties.info.id` without discriminating the event type. OpenCode's event contract defines `message.updated.properties.info` as a `Message`, whose `id` is the message id and whose session key is `sessionID`; `session.updated.properties.info` is a `Session`. Therefore every `message.updated` lacking a top-level `sessionID` can POST `msg_...` as `{ sessionID }`, and each distinct message id bypasses the per-session Set. The test covers only a synthetic `session.updated` info block.
- impact: The receiver stores a non-existent `opencode:msg_...` vault entry as highest-ranked evidence, so the row can lose its title and drill-down and overwrite a previously correct session report after normal message activity.
- suggestedFix: Discriminate on `event.type`; read `info.sessionID` for message events and `info.id` only for session events, then bump `OPENCODE_PLUGIN_VERSION` so the corrected generated file replaces stale installations.
- status: accepted
- triage: Verified against OpenCode's own source, not inference: `packages/sdk/js/src/gen/types.gen.ts` types `EventMessageUpdated.properties` as `{ info: Message }`, and `Message.id` is `msg_...`. The fix narrows the producer further than suggested — it reports only from `session.created`/`session.updated` whose `info.parentID` is absent, which also stops a task sub-agent's child session (Session.parentID, types.gen.ts:537) from clobbering the row.
- invariant: Every producer dialect must normalize to the vault's actual session identifier before it can receive `reported` evidence rank.
- boundary inventory:
  - affected: `message.updated`; resumed sessions; repeated message updates; dedup behavior for message ids
  - verified safe: events carrying a valid top-level `properties.sessionID`; `session.updated` where `info.id` is a session id

### B3

- ID: B3
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-data-security, asm-review-contracts, chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/agentHooks/hookEnvironment.ts:23`
- title: The hook environment overwrites a per-terminal `OPENCODE_CONFIG_DIR`
- evidence: `installOpenCodePlugin()` checks only the extension host's `process.env`, then `withHookEnvironment()` unconditionally spreads its fixed `OPENCODE_CONFIG_DIR`. `SessionManager.ts:484-491` merges per-session `options.env` first and the hook contribution last, so a terminal-specific user value that was not present in the extension host is replaced. The approved scenario requires the value already selected for the terminal to reach OpenCode unchanged.
- impact: Enabling the feature can silently replace the user's selected OpenCode configuration directory, violating the configuration-preservation contract and potentially changing plugins/models/settings for that terminal.
- suggestedFix: Decide whether to contribute `OPENCODE_CONFIG_DIR` at final spawn-environment assembly, preserving any existing nonblank value. The contributor API may need access to the pending spawn environment, or the merge must make the user value authoritative while still protecting the credential variables.
- status: accepted
- triage: The accepted spec settles it: 'Reporting preserves the user's own OpenCode configuration' forfeits the report **for that terminal**, and the check reads the extension host's `process.env` instead. `SessionManager.createSession` also merges the hook contribution last, after `options.env`. No producer sets the variable per terminal today, so this is latent rather than live — accepted anyway because the invariant should be local to the merge, not a coincidence between two layers.
- invariant: A user-selected OpenCode configuration directory at any terminal environment layer must outrank the extension-owned plugin directory.
- boundary inventory:
  - affected: per-session/profile/worktree launch environment overrides; any caller passing `CreateSessionOptions.env`
  - verified safe: a nonblank value inherited directly by the extension host's `process.env`; no pre-existing value

### B4

- ID: B4
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-data-security, chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/agentHooks/opencodePlugin.ts:38`
- title: The awaited report request has no client-side timeout
- evidence: The plugin's awaited `fetch()` has no abort signal or timeout. The catch handles refusal/reset, but a loopback peer that accepts the connection and never answers leaves the event handler pending indefinitely. The accepted requirement says an identity observer must not block or delay past its timeout when the receiver is unavailable or timed out.
- impact: A stalled extension host or reused/stuck loopback listener can block OpenCode's awaited event processing instead of failing open.
- suggestedFix: Add a short `AbortController`/`AbortSignal.timeout` to the generated request, swallow timeout like other report failures, remove the id from the dedup Set for retry, and bump the plugin version.
- status: accepted
- triage: 'Identity observers fail open' names timing out as a case the observer must not impose on the agent; an awaited `fetch` with no abort signal is exactly that hole.
- invariant: Every producer-side observer operation must have its own enforced completion bound and must release the agent action when that bound expires.
- boundary inventory:
  - affected: accepted TCP connection with no response; paused/hung receiver; response body that never completes
  - verified safe: missing listener/connection refusal; synchronous fetch errors; normal receiver responses

### B5

- ID: B5
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-logic, asm-review-contracts, chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/extension.ts:379`
- title: OpenCode setting changes leave the already-installed contributor on its old environment
- evidence: `withHookEnvironment(contributor, opencodeEnvironment)` captures the current object. `applyOpencodeHooks()` later reassigns `opencodeEnvironment`, but `CursorHookController.applyReconciledAuthority()` invokes `setContributor()` only when authority changes from absent to granted. When Cursor already keeps the runtime authorized, OpenCode off-to-on leaves future terminals without the plugin directory, and on-to-off keeps injecting it.
- impact: The machine-scoped opt-in setting does not control reporting for future panes in a common configuration; enabling may do nothing and disabling may continue loading the reporter and sending session ids.
- suggestedFix: Make the fixed contribution lazy/current at each `create()` or mutate a stable contribution object deliberately. Do not blindly swap contributor objects, because `SessionManager.setCursorHookContributor()` revokes every live credential on reference changes.
- status: accepted
- triage: `withHookEnvironment` closes over the object `opencodeEnvironment` pointed at when the contributor was installed, and `applyOpencodeHooks` rebinds the variable. Resolving the environment lazily per terminal fixes it without revoking live credentials.
- invariant: Every future terminal's environment must reflect the current OpenCode reporting setting, independent of why the shared receiver is already authorized.
- boundary inventory:
  - affected: off-to-on while Cursor hooks keep the receiver active; on-to-off while Cursor hooks keep it active; install failure followed by later setting changes
  - verified safe: initial activation; setting changes that also transition receiver authority from absent to present or present to absent

### B6

- ID: B6
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/extension.ts:409`
- title: Concurrent setting applications can restore an older OpenCode opt-in state
- evidence: Each configuration event launches `void applyOpencodeHooks()`. An enable call reads `true` and awaits plugin filesystem I/O; a later disable call completes immediately and turns reporting off; then the older enable call resumes and writes the enabled environment and `receiverWanted=true`. Unlike `CursorHookController`, this async reconciliation has no revision guard or serialization.
- impact: A rapid toggle can leave reporting enabled after the user switched it off, crossing the explicit opt-in/privacy boundary and racing plugin writers.
- suggestedFix: Serialize OpenCode reconciliation or attach a monotonic revision and discard stale async completions before mutating `opencodeEnvironment` or receiver authority.
- status: accepted
- triage: Two unawaited reconciliations can land out of order. A monotonic revision guard is cheap and local.
- invariant: The latest machine-setting revision alone may publish reporting authority and terminal environment.
- boundary inventory:
  - affected: enable followed by disable during install; overlapping enable calls; install failure/success completing out of order
  - verified safe: non-overlapping setting changes and initial activation with a stable value

### B7

- ID: B7
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: asm-review-performance, asm-review-logic, asm-review-reuse, chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/extension.ts:654`
- title: Session fallback performs a full uncached vault read per pane
- evidence: Each `sessionUnderCwd` call awaits `vaultService.list()` and scans all entries for newest `(agent,cwd)`. `VaultService.list()` is explicitly a full non-persisted read of every store (`VaultService.ts:531-536`). Because the callback is invoked from per-pane identity resolution, `P` fallback panes can trigger `P × O(H)` store reads/scans over vault history `H`; PID/cwd changes re-enter the path. Equivalent newest-by-cwd loops also exist in both terminal providers.
- impact: Presence projection latency grows with total historical sessions and pane count, and several non-Claude panes can sequentially reread every agent store before the worktree tree is published.
- suggestedFix: Put newest `(agent,cwd)` selection behind one shared vault-level indexed/cached helper, single-flight one list/lookup per projection, and reuse it from the terminal providers rather than duplicating full-history scans.
- status: accepted
- triage: Accepted with the fix narrowed. `VaultService.list()` is `readAll(null)` — a full uncached read of every store — and N panes missing a session id run N of them in one rebuild. The narrowing: a per-projection single-flight, which is the same per-rebuild bound `openSnapshot` already enforces (presenceDeps.ts D9), not the new shared index the report proposes. Noted for the record: this lookup entered in 2130d94, not in this change; it is in the reviewed range and cheap to bound, so it is fixed here rather than deferred.
- invariant: Pane projection work must be bounded by live panes and indexed current-state lookups, not multiply full-recompute all historical vault entries.
- boundary inventory:
  - affected: first projection of each proven non-Claude pane without a report; pane PID/cwd changes; multiple fallback panes; large Claude/Codex/Cursor/OpenCode histories
  - verified safe: panes with a valid report; panes with an existing registry entry id; cached proven identities before invalidation; bounded title cache eviction

### W1

- ID: W1
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-contracts
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/agentHooks/opencodePlugin.ts:41`
- title: The report payload omits the approved event name
- evidence: The producer serializes only `{ sessionID }`, and `parseAgentSessionReport()` accepts only that field. The approved spec says the report shall carry the reporting agent's session identifier and the name of the event that produced it; the implementation and its tests instead assert session-id-only payloads.
- impact: Producer and receiver do not implement the accepted message contract, leaving future diagnostics/versioning without the approved discriminator and making the approved artifacts contradictory with the shipped behavior.
- suggestedFix: Reconcile the accepted D6/spec conflict explicitly; if the spec remains authoritative, send and validate a bounded `eventName` while continuing to discard every content-bearing field.
- status: rejected
- triage: Rebuttal. The requirement is titled 'A session report carries no conversation content' and its operative clause is the `MUST NOT` list; 'carries only the session identifier and the name of the event that produced it' is the ceiling that clause enforces, not a floor a producer must fill. Sending strictly less than the ceiling cannot violate it. The mechanism authority agrees and is the later artifact: D6 says 'the session id and nothing else', and the accepted Interfaces block types `AgentSessionReport` with exactly `terminalId`, `agent`, `sessionId`. Adding an event name would widen the payload for no reader — nothing in the receiver, the projector, or any row consumes it.

### W2

- ID: W2
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: asm-review-performance
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/fix-worktree-untitled/src/agentHooks/opencodePlugin.ts:31`
- title: Successful report deduplication grows with session history
- evidence: The generated plugin retains every successfully reported id in an unbounded `Set` and never removes one. The growth axis is distinct ids seen during one long-lived OpenCode plugin/server process; after `S` sessions the Set retains `S` ids. B2 additionally makes message ids enter this same collection.
- impact: A long-lived OpenCode process accumulates historical ids indefinitely; with the current event parser it can grow per message rather than per session.
- suggestedFix: First normalize only real session ids, then remove ids on a reliable session lifecycle event or use a documented bounded TTL/LRU retention policy.
- status: accepted
- triage: Subsumed by B2's fix: once only a root session's id can be reported, the retained set is one id per session the terminal actually runs.
