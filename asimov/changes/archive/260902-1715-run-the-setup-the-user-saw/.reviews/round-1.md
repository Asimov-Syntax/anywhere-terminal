# Review Round 1 — run-the-setup-the-user-saw

- Date: 2026-09-02
- Cycle: 1
- Round: 1
- Mode: discovery
- Scope: range `45dab796..HEAD` (7 commits)
- Head: `2e5573fb6046edf01cc20d20fcfd6ae618ea3398` (working tree dirty only from generated `asimov/changes/run-the-setup-the-user-saw/analytics.json`; review content came from the committed range)
- Reviewable lines: 1281 added/modified production lines across 11 reviewable files
- Note: Large change — accuracy may decrease
- Labels: `security-privacy`; fastlane
- Verify gate: `bun run asm change verify-status run-the-setup-the-user-saw` reports tasks 1_1 through 4_4 `[x] exit 0`; project verification was not re-run by review
- Agents spawned: 6 (data-security, logic ×2, contracts, performance, reuse) + chair self-review and full-flow trace
- Agents skipped: none
- Verdict: **REJECT**
- Counts: 7 BLOCK · 3 WARN · 0 SUGGEST
- Split over gating blockers: 7 feature / 0 machinery
- Review session identity: `ea8b01d7-0032-4405-a0ae-82791e72b715`

## Findings

### F001

- ID: F001
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/setupRunner.ts:164-178`
- title: Selected port names can overwrite setup's authoritative control environment
- evidence: `setupEnvironment()` writes `ANYWHERE_TERMINAL_WORKTREE_PATH`, `ANYWHERE_TERMINAL_MAIN_PATH`, and `ANYWHERE_TERMINAL_BRANCH`, then applies every configured port name with `environment[name] = String(port)`. Provider parsing accepts every mapping key unchanged at `providerKit.ts:522-532`. A checked-in port named `ANYWHERE_TERMINAL_WORKTREE_PATH` therefore replaces the authorized checkout path with a number. A port named `ASIMOV_CHANGE_ID` creates the variable the accepted specification says this extension must not invent. On Windows, case-insensitive environment lookup also makes case variants relevant.
- impact: A selected setup script can receive false identity/path values even though the UI and host redeemed the correct setup step and the runner spawned in the correct cwd. This falsifies the documented environment contract and lets checked-in port metadata alter setup authority outside the command row the user selected.
- suggestedFix: Validate port names as environment-variable names and reserve the Anywhere Terminal/Asimov control namespace (case-insensitively on Windows), then apply authoritative control variables after port values as a defense in depth. Add collision tests including `ANYWHERE_TERMINAL_WORKTREE_PATH` and `ASIMOV_CHANGE_ID`.
- status: accepted
- triage: Accepted. The defect is in the changed application of previously accepted port names to the setup environment, not in the unchanged provider format.
- invariant: Setup identity variables are host-authoritative and cannot be replaced by provider-controlled port declarations.
- boundary inventory:
  - affected: provider port-name parsing; authoritative port-result projection; setup environment overlay; Windows case-folded environment lookup
  - verified safe: shell payload text remains host-held; spawn cwd remains the authorized worktree path; the three Asimov compatibility variables written after the port loop cannot be overwritten by exact-case port keys
  - not safe: the three Anywhere Terminal variables and `ASIMOV_CHANGE_ID`; case variants on Windows

### F002

- ID: F002
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/setupRunner.ts:71-82`
- title: Directory authorization runs outside the aggregate deadline and cancellation signal
- evidence: Terminal opening and child exit are timed, but every step awaits `stillAuthorized(input.authorization)` directly. No close listener or deadline race is active during that filesystem wait. A stalled `lstat`/network filesystem operation can therefore outlive the shared two-hour deadline indefinitely. If the terminal closes while the check is pending and it later resolves true, the code can still spawn a child after cancellation before `waitForExit()` observes the already-closed terminal.
- impact: One setup run can hold the repository mutation coordinator forever and can start work after the user cancelled it, violating the accepted aggregate bound and mutation serialization contract.
- suggestedFix: Create one run-level deadline/cancellation signal before terminal open; race every authorization await against it, stop on close/deadline, and re-check that signal immediately before spawn. Ensure late authorization completions cannot commit a spawn.
- status: accepted
- triage: Accepted and corroborated by the runner specialist. The two-hour bound is an accepted obligation over the whole run, not only timers.
- invariant: Every blocking boundary in a setup run settles or is abandoned under the one aggregate deadline and terminal-close cancellation.
- boundary inventory:
  - affected: pre-step directory authorization and the gap between its completion and spawn
  - verified safe: terminal-open wait and active-child exit wait have remaining-deadline timers
  - not safe: filesystem authorization awaits are neither timed nor cancelled

### F003

- ID: F003
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-performance
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/setupTerminal.ts:157-168`
- title: Every PTY data event rebuilds the entire retained transcript
- evidence: `append()` computes `Buffer.from(this.tail + data)` for every node-pty event and, below the cap, concatenates `this.tail + data` again. Once the tail reaches 1 MiB, each additional event copies and decodes approximately the full 1 MiB. The output-event count and output bytes per two-hour run are unbounded, so E small events cost approximately `O(E × 1 MiB)` copying and GC despite the storage cap.
- impact: A noisy setup command can monopolize the extension host and mutation queue through full-history recomputation per event. This is the accepted data-scale BLOCK class: full recompute on an unbounded event axis.
- suggestedFix: Store bounded byte chunks in a ring/deque and evict incrementally. Decode only the retained boundary needed for replay; never concatenate or re-encode the full tail for each event.
- status: accepted
- triage: Accepted and corroborated by the performance specialist.
- invariant: Retaining a bounded transcript must use bounded incremental work per PTY event.
- boundary inventory:
  - growth axis: PTY output bytes and data-event count per setup run, bounded only by the two-hour deadline
  - affected: tail append and eviction
  - verified safe: retained memory is capped to approximately 1 MiB
  - not safe: CPU and allocation work per event scale with the entire retained tail

### F004

- ID: F004
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-performance
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/extension.ts:597-603`, `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/extension.ts:694-702`
- title: Starting a retry does not retire the prior output handle or transcript
- evidence: A retry creates and runs a new `SetupTerminal`; only after that run settles does `retainSetupOutput()` replace the old map entry. During the whole retry, the prior output id remains redeemable. Replacement merely deletes the registry entry; `SetupTerminal` exposes no disposal path and never calls `TerminalLike.dispose()`, so the old VS Code terminal and transcript remain visible and retained after replacement. Reconciliation performs the same map-only deletion.
- impact: The accepted D4 rule that starting retry retires the prior output handle and transcript is not implemented. Repeated retries create an unbounded number of old terminals/transcripts for one live worktree, and sensitive prior output remains accessible after the operation that was supposed to retire it.
- suggestedFix: Add an idempotent `SetupTerminal.dispose()` that detaches the child, disposes emitter/subscriptions and terminal, and invoke a retirement callback immediately after the service validates/spends the retry token, before queueing the new run. Dispose on replacement and worktree reconciliation as well.
- status: accepted
- triage: Accepted. The registry's one-entry bound does not bound the VS Code terminal resources it drops without disposal.
- invariant: At most one live output capability and retained transcript exists per live worktree, and retry retirement occurs when the retry starts.
- boundary inventory:
  - affected: retry start; output-map replacement; terminal disposal; transcript lifetime; worktree reconciliation
  - verified safe: after a completed replacement only one id remains in the map
  - not safe: old id during retry; prior terminal and transcript after map deletion; retry-count growth axis

### F005

- ID: F005
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/extension.ts:585-612`, `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/extension.ts:1184-1186`
- title: Output authority can cross a removed-and-recreated worktree identity
- evidence: Output records retain only `worktreeId` and terminal. `reconcileSetupOutputs()` deletes them only when that normalized id is absent from one rebuild, and `viewSetupOutput` checks only the opaque id plus surface origin. If an external remove/recreate at the same path occurs between authoritative rebuilds, the present-id set never loses that id; unlike retry records, output carries no incarnation or authorized-directory identity to reject the replacement.
- impact: The originating surface can reveal stale setup output, including secrets, as an action attached to a replacement worktree that never produced it. This violates the live-worktree ownership promised for retained output.
- suggestedFix: Bind output records to the original incarnation or `AuthorizedDirectory` identity. Re-resolve/recheck before reveal and delete plus dispose the record on mismatch. Cover remove/recreate at the same normalized id without an intermediate absent rebuild.
- status: accepted
- triage: Accepted and corroborated by the data-security specialist. Origin scoping prevents cross-surface disclosure but does not prove worktree identity.
- invariant: An output capability is valid only for the original surviving worktree identity and originating surface.
- boundary inventory:
  - affected: present-id reconciliation and reveal-time identity proof
  - verified safe: random opaque id; originating-surface check; ordinary observed disappearance deletes the map entry
  - not safe: same-id replacement with no observed absent state

### F006

- ID: F006
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/setupRunner.ts:227-238`, `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/setupTerminal.ts:171-185`
- title: A throwing PTY kill defeats timeout and close settlement
- evidence: Both the runner's close/timeout callbacks and `SetupTerminal.close()` call `child.kill()` outside `try/finally`. If node-pty throws, the runner callback never reaches `settle({kind:"closed"|"timeout"})`; `SetupTerminal.close()` never notifies close listeners or disposes its writer/subscription. The repository's established `PtySession` catches kill exceptions explicitly because a process may already be dead.
- impact: The shared two-hour timeout or user cancellation can throw from the timer/event callback and leave the setup promise and repository queue unsettled, exactly where the bound is meant to guarantee release.
- suggestedFix: Make kill best-effort inside `try/catch` and put settlement/listener notification and cleanup in `finally`. Avoid the current duplicate kill on close by giving one owner the kill operation.
- status: accepted
- triage: Accepted. This is a separate causal mechanism from F002: the deadline fires, but its own callback can fail before settlement.
- invariant: Cancellation and timeout settlement cannot depend on PTY termination succeeding.
- boundary inventory:
  - affected: runner timeout callback; runner terminal-close callback; pseudoterminal close cleanup
  - verified safe: settlement is otherwise idempotent and clears subscriptions/timer
  - not safe: every kill call precedes settlement/cleanup without exception containment

### F007

- ID: F007
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/worktreeMutationService.ts:1266-1269`, `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/worktreeMutationService.ts:1313-1316`
- title: A create with an empty provisioning selection writes no manifest
- evidence: `provisionedAt` is assigned only when selected entries exist, selected ports produced results, or at least one setup step was selected. The manifest call is guarded by `provisionedAt !== undefined`. The ordinary default create—setup unchecked and no material/port rows selected—therefore skips the writer entirely. Design D5 explicitly requires version 1 after initial setup settles, including an empty selection; `worktree-apply.md` says applying records one create.
- impact: Later removal cannot distinguish “this extension provisioned nothing” from “the administrative record is absent/unreadable” and must degrade the claim. The accepted manifest completeness obligation fails on the safest and commonest selection state.
- suggestedFix: Normalize the new worktree id for every successful create that owns a manifest, write empty arrays when nothing was selected, and keep the existing non-fatal warning behavior. Add the explicit empty-selection witness required by D5.
- status: accepted
- triage: Accepted. This is a direct accepted-design divergence, not an optional telemetry improvement.
- invariant: Every successful create publishes exactly one descriptive manifest, including a truthful empty record.
- boundary inventory:
  - affected: empty selection
  - verified safe: entry-only, port-only, setup-only, mixed selection, and retry paths reach the writer
  - not safe: no selected provisioning item

### F008

- ID: F008
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/worktreeMutationService.ts:607-670`
- title: An unexpected retry coordinator rejection silently burns the rotating capability
- evidence: The retry id is replaced before queueing. If `coordinator.run()` rejects, the rejection branch deletes the retry record and reports nothing through `reportProvisioning`, `report`, or logging. The webview keeps the old retry id, which now no-ops forever. The create path's equivalent rejection reports `fail(messageOf(error))`.
- impact: A transient resolve/coordinator failure permanently removes setup retry with no visible result, leaving a stale button that silently does nothing.
- suggestedFix: Surface a setup-only failure update (or an explicit capability-retired result) in the rejection branch and make the UI remove or rotate the stale action. Preserve fail-closed identity handling.
- status: accepted
- triage: Accepted from the mutation-ordering specialist. This does not bypass authority, so WARN rather than BLOCK.

### F009

- ID: F009
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-performance
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/setupTerminal.ts:147-154`
- title: Live setup output dispatches one synchronous VS Code event per PTY event
- evidence: Every `child.onData` callback immediately calls `writer.fire(data)`. There is no coalescing, flush interval, watermark, or pause/resume despite node-pty event count being unbounded within the two-hour run. The repository's normal terminal path uses `OutputBuffer` to batch and control throughput.
- impact: A command emitting many small chunks can overwhelm the extension host/VS Code terminal sink even after F003 removes full-tail copying.
- suggestedFix: Add bounded batching/coalescing and a pressure policy appropriate to `Pseudoterminal.onDidWrite`, reusing the existing output-throughput rules where compatible.
- status: accepted
- triage: Accepted as a separate sink-dispatch mechanism from F003's retained-tail recomputation.

### F010

- ID: F010
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: asm-review-logic, asm-review-performance
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/setupTerminal.ts:84-90`, `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/setupTerminal.ts:147-154`
- title: A completed final child remains current and subscribed until the terminal closes
- evidence: `attach()` disposes the previous child-data subscription only when the next child attaches. After the final child exits, the runner disposes its exit listener but never detaches the terminal's `childData` or clears `child`. Retained output therefore keeps the final PTY and callback alive, and `handleInput` continues forwarding to the exited child.
- impact: Every retained setup terminal holds unnecessary PTY resources after completion; post-exit input targets a dead process. It also amplifies F004's retry resource growth.
- suggestedFix: Add identity-checked detach/finalize and invoke it in `finally` after each child settles, clearing the data subscription and current child without closing retained output.
- status: accepted
- triage: Accepted and corroborated by logic/performance specialists.

## Adjudication notes

- Full-flow trace covered create form selection → opening-scoped host offer → opaque-id redemption → repository coordinator → Git create → material → authoritative ports → setup terminal open → per-step authority check → POSIX/Windows spawn → gated/ungated `openAfter` → per-step result → manifest → mutation/provisioning result → controller merge → row actions → retry/output capability → rebuild reconciliation.
- Host-held setup authority is sound in the reviewed path: inbound setup actions carry opaque ids only; stale/foreign offers perform no create; selected command text comes from the held offer and is never re-read from provider files.
- Shell payload construction is sound in the reviewed path: POSIX carries the exact script as one `-c` argv element; Windows carries one UTF-16LE Base64 `EncodedCommand` payload.
- Agent ordering is sound: material and ports precede setup; ungated launch overlaps a started setup; gated launch occurs only after complete setup success; no selected setup follows the ordinary launch path.
- Retry identity is sound for execution: token rotation happens before queueing and the queued body rechecks incarnation plus normalized path. F008 concerns silent capability loss on unexpected rejection, not identity bypass.
- The provisioning-result union and controller merge preserve initial material, ports, warnings, and contests across setup-only retry updates; contract specialist found no issue.
- The manifest is not read as execution authority and write failures remain warnings. F007 concerns the missing empty record, not authority escalation.
- Reuse specialist's lock warning was rejected: legitimate manifest writers for one worktree are serialized by the repository coordinator and retry capability is host-local; no concrete concurrent-writer witness established stale publication. Atomic replacement still protects readers from partial JSON.
- Reuse specialist's `PtySession` abstraction warning was not sustained independently: the accepted design deliberately needs one fresh child per step and a setup-specific aggregate run. Concrete lifecycle divergences are recorded as F002, F006, F009, and F010.
- Inline support review found corresponding tests for every changed production region and no changed `.only`/`.skip`, fixture secrets, or behavioral-source contradiction. The existing tests do not cover the blocker witnesses above.

## Sub-agents spawned

- asm-review-data-security: offer authority, shell payload, directory/output identity, manifest security — `gpt-5.6-sol[1M]`
- asm-review-logic: setup runner and terminal lifecycle — `gpt-5.6-terra[1M]`
- asm-review-logic: mutation ordering, retry rotation and reconciliation — `sonnet[1M]`
- asm-review-contracts: setup IPC, host validators and controller merge — `gpt-5.6-terra[1M]`
- asm-review-performance: PTY-output and retained-state growth axes — `gpt-5.6-luna[1M]`
- asm-review-reuse: output/process/LockedFile capability reuse — `gpt-5.6-luna[1M]`

## Re-review identity

- Chair review session: `ea8b01d7-0032-4405-a0ae-82791e72b715`
- Source of truth for the next round: this file and Head `2e5573fb6046edf01cc20d20fcfd6ae618ea3398`
- Per the current Asimov process, verification spawns fresh specialists; specialist session ids are not resume dependencies.
