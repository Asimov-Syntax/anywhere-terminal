# Review Round 3 — run-the-setup-the-user-saw

- Date: 2026-09-02
- Cycle: 2
- Round: 3
- Mode: discovery
- Arbiter: yes
- Scope: cumulative range `45dab796..HEAD`
- Head: `d0689ffc6ea395a16143aa91d3fb4764073cd8d2` (working tree dirty only from generated `asimov/changes/run-the-setup-the-user-saw/analytics.json`; review content came from the committed range)
- Reviewable lines: 1550 added/modified production lines across 12 reviewable files
- Note: Large change — accuracy may decrease
- Labels: `security-privacy`; fastlane
- Verify gate: `bun run asm change verify-status run-the-setup-the-user-saw` reports tasks 1_1 through 5_3 `[x] exit 0`. Caller evidence records focused provider/runner/terminal/mutation/extension/controller/assembly suites, full unit tests, type check, all 27 changed-source Biome checks, bundle-require gate, and deletion gate passing; remaining full-Biome failures reproduce on clean `71c8cf2e` only in unchanged files. Review did not rerun project verification.
- Agents spawned: 6 (data-security, logic ×2, contracts, performance, reuse) + chair self-review and full-flow trace
- Agents skipped: none
- Verdict: **REJECT**
- Status: **blocked**
- Counts: 4 open BLOCK · 2 open WARN · 0 open SUGGEST; 8 prior findings fixed
- Split over gating blockers: 4 feature / 0 machinery
- Review session identity: `ea8b01d7-0032-4405-a0ae-82791e72b715`

## Findings

### F001

- ID: F001
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/providerKit.ts:526-545`, `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/worktreeMutationService.ts:485-492`, `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/setupRunner.ts:177-183`
- title: Prototype-sensitive port names still lose their authoritative environment value
- evidence: The remediation rejects invalid and reserved names but accepts `__proto__`, which is a portable, non-reserved identifier. The asimov YAML parser preserves it as an own mapping key, so it reaches `readInlineKeys`. Both `portEnvironment()` and the runner accumulate names into ordinary `{}` objects with `environment[name] = ...`; `__proto__` invokes the inherited setter instead of creating an own property. A targeted probe confirmed an assignment produces `Object.entries([])` and no own property. The port can therefore be offered, allocated, reported and written to the manifest while absent from the setup process environment. The native JSONC parser silently drops the same key before validation, so the two supported adapters also disagree about the accepted declaration.
- impact: F001's invariant remains false for a legal provider declaration: a successfully allocated offerable port need not reach setup under its configured authoritative name.
- suggestedFix: Use null-prototype maps or own-data-property creation through parse/port projection/runner environment assembly, or explicitly reject prototype-sensitive identifiers in the accepted contract. Add native and asimov end-to-end witnesses for `__proto__`, ordinary names, and reserved case variants.
- status: accepted
- triage: Persists from round 1 with materially new boundary evidence. Reserved namespace collisions are fixed, but the same authoritative-port invariant still fails through prototype-sensitive bracket assignment.
- invariant: Every successfully allocated offerable port reaches the child environment as an own property under exactly its configured name, without replacing host-owned setup identity.
- boundary inventory:
  - affected: native JSONC parse; asimov YAML parse; shared provider validation; mutation-service port projection; runner defense-in-depth; child environment enumeration
  - verified safe: ordinary portable names; invalid names; case-insensitive `ANYWHERE_TERMINAL_` and `ASIMOV_` names; host-owned variables are overlaid last
  - not safe: `__proto__` and adapter consistency for prototype-sensitive keys

### F002

- ID: F002
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/setupRunner.ts:49-109`, `:192-289`
- title: Directory authorization runs outside the aggregate deadline and cancellation signal
- evidence: Current code creates cancellation before terminal open, races terminal open and directory authorization through `waitForBoundary`, consumes late resolutions/rejections, and checks cancellation again synchronously before spawn.
- impact: The round-1 queue-hang and post-cancel spawn witnesses are closed.
- suggestedFix: None.
- status: fixed
- triage: Fixed by tasks 5_1/5_2; specialist and chair traces found every named authorization/open/pre-spawn boundary under the run-level signal.

### F003

- ID: F003
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-performance
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/setupTerminal.ts:182-218`
- title: Every PTY data event rebuilds the entire retained transcript
- evidence: Current append uses bounded byte chunks with incremental head eviction and amortized compaction rather than concatenating/re-encoding the retained tail on every event.
- impact: The round-1 full-recompute mechanism is closed. F011 records a different oversized-allocation mechanism.
- suggestedFix: None for F003.
- status: fixed
- triage: Fixed; severity is not transferred to F011 because that is a different causal mechanism.

### F004

- ID: F004
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic, asm-review-performance
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/worktreeMutationService.ts:609-616`, `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/extension.ts:600-627`
- title: Starting a retry does not retire the prior output handle or transcript
- evidence: A valid retry now spends/rotates the token and invokes `retireSetupOutput` before queueing. Retirement removes both maps and calls idempotent terminal disposal. Completed-run replacement and disappearance reconciliation route through the same owner. Assembly evidence records `run → dispose → run`.
- impact: The prior handle, transcript and terminal no longer survive retry start or replacement.
- suggestedFix: None.
- status: fixed
- triage: Fixed across retry start, completed replacement and rebuild disappearance.

### F005

- ID: F005
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/extension.ts:582-627`, `:1200-1210`
- title: Output authority can cross a removed-and-recreated worktree identity
- evidence: Output records now retain the original `AuthorizedDirectory`; reveal rechecks its component identities before output is shown and retires/disposes on mismatch. Origin scoping remains enforced by `SetupTerminal.reveal`. Same-id recreation therefore fails even without an intermediate absent rebuild.
- impact: Stale output cannot be disclosed as output of a replacement worktree. F014 records the remaining non-gating stale-control presentation.
- suggestedFix: None for the authority bypass.
- status: fixed
- triage: Fixed at reveal authority, retry start, replacement and disappearance boundaries.

### F006

- ID: F006
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/setupRunner.ts:300-320`, `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/setupTerminal.ts:265-291`
- title: Kill-triggered immediate exit can win over timeout or terminal-close cancellation
- evidence: Throwing kills are now contained, but cancellation outcome is still established after termination. On deadline, `safeKill(child)` runs before `settle(timeout)`; a synchronous zero-code `onExit` settles success first. On terminal close, `SetupTerminal.close()` kills before notifying close listeners, so the same immediate exit can settle success before cancellation exists. The `Pty` interface and existing immediate-exit tests permit synchronous exit delivery.
- impact: A timed-out or user-cancelled one-step setup can report `succeeded: true`; a gated agent can then start after the setup was cancelled.
- suggestedFix: Record/settle cancellation before attempting termination, and notify runner close listeners before terminal-owned kill. Alternatively, make the exit listener prefer an already-recorded cancellation reason. Add immediate-successful-exit-on-kill tests for deadline and close.
- status: accepted
- triage: Persists from round 1. The throwing-kill witness is fixed, but the same kill-before-settlement mechanism still falsifies cancellation outcome under immediate exit delivery; severity remains stable.
- invariant: Deadline or terminal close wins the run outcome once observed, regardless of how PTY termination reports exit.
- boundary inventory:
  - affected: deadline stop callback; pseudoterminal close; synchronous `onExit`; gated-agent success decision
  - verified safe: kill exceptions cannot prevent cleanup; ordinary asynchronous exit after cancellation reports timeout/closed; settlement is idempotent
  - not safe: kill-triggered synchronous successful exit before cancellation settlement

### F007

- ID: F007
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-logic, asm-review-data-security
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/worktreeMutationService.ts:1207-1209`, `:1282-1287`, `:1331-1334`
- title: A create with an empty provisioning selection writes no manifest
- evidence: Every successful non-reattach create now authorizes the destination, normalizes the result id and reaches `writeManifest` with empty arrays when nothing was selected. Reattach returns before this block and remains unchanged.
- impact: Empty creates publish the truthful descriptive record required by current D5/spec.
- suggestedFix: None.
- status: fixed
- triage: Fixed for empty, selected and reattach mode boundaries.

### F008

- ID: F008
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/worktreeMutationService.ts:663-686`
- title: An unexpected retry coordinator rejection silently burns the rotating capability
- evidence: Identity mismatch and coordinator rejection now emit setup-only failure updates without output or retry ids. The controller replaces setup fields while preserving initial material/ports/contests, clearing stale actions visibly.
- impact: A spent capability no longer remains as a silent stale retry action.
- suggestedFix: None.
- status: fixed
- triage: Fixed across rejection and identity-mismatch paths.

### F009

- ID: F009
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-performance
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/setupTerminal.ts:221-245`
- title: Live setup output dispatches one synchronous VS Code event per PTY event
- evidence: Current code coalesces small events behind an 8 ms timer and flushes at a fixed threshold instead of firing once per PTY callback.
- impact: The per-event synchronous sink dispatch mechanism is closed. F013 records the distinct byte-unit mismatch in the new batching implementation.
- suggestedFix: None for F009.
- status: fixed
- triage: Fixed; batching is active and pending flushes are cleared on disposal.

### F010

- ID: F010
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: asm-review-logic, asm-review-performance
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/setupRunner.ts:138-160`, `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/setupTerminal.ts:96-108`
- title: A completed final child remains current and subscribed until terminal close
- evidence: `runStep` now identity-detaches every settled child in `finally`; `SetupTerminal.detach` disposes the data subscription and clears only the named current child.
- impact: Retained terminals no longer hold or receive input through the completed final PTY.
- suggestedFix: None.
- status: fixed
- triage: Fixed, including foreign-detach protection and idempotent disposal.

### F011

- ID: F011
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-performance, chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/setupTerminal.ts:182-189`, `:295-300`
- title: Oversized PTY events retain their full backing allocation
- evidence: For an event at least 1 MiB, `Buffer.from(data)` allocates the full event and `utf8Tail()` returns `bytes.subarray(start)`. A subarray shares the original backing `ArrayBuffer`; a targeted probe retained a logical 1 MiB slice backed by an 8 MiB allocation. A 100 MiB single event therefore leaves approximately 100 MiB retained behind a transcript that reports a 1 MiB logical length. The oversized-event test checks `byteLength(transcript())`, not backing allocation.
- impact: Retained memory remains unbounded on the PTY event-size growth axis, contradicting the approved 1 MiB bounded-transcript obligation and allowing one output burst to pin arbitrarily large memory for the worktree lifetime.
- suggestedFix: Copy the trimmed tail into an independently bounded allocation, for example `Buffer.from(utf8Tail(...))`, and ensure compaction/partial-tail paths do not retain oversized backing stores. Add a backing-buffer-size witness.
- status: accepted
- triage: New discovery finding. It is a different mechanism from fixed F003: logical incremental work is bounded, but the retained allocation is not.
- invariant: Retained transcript backing memory, not only logical slice length, is structurally capped at approximately 1 MiB.
- boundary inventory:
  - growth axis: bytes in one PTY data event
  - affected: oversized-event tail selection and backing-store lifetime
  - verified safe: logical transcript bytes; ordinary small-event chunk count; incremental eviction
  - not safe: backing allocation retained by `Buffer.subarray`

### F012

- ID: F012
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: asm-review-logic, chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/setupTerminal.ts:139-155`
- title: Closing a replay terminal prevents subsequent output recreation
- evidence: The read-only replay pseudoterminal's `close` callback disposes only its emitter and leaves `this.replayTerminal` set. Every later `reveal()` takes the existing-replay branch, calls `show()` on the closed/disposed terminal and returns true instead of creating a new emitter and replay terminal.
- impact: After closing recreated output once, `View output` stops satisfying D2's explicit promise that closing output later does not invalidate it. A setup failure's required captured-output action can become permanently inert while claiming success.
- suggestedFix: Clear the replay-terminal reference from its close callback with identity protection, so the next reveal creates a fresh read-only terminal. Add close → reveal → close → reveal coverage.
- status: accepted
- triage: New discovery finding on a load-bearing failure-output path.

### F013

- ID: F013
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-performance
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/setupTerminal.ts:6-7`, `:221-245`
- title: Live flush limit measures UTF-16 units instead of bytes
- evidence: `liveChars` and `LIVE_FLUSH_CHARS` count JavaScript UTF-16 code units, while the approved contract states a 64 KiB flush. A batch of 64 KiB euro characters is 192 KiB in UTF-8 and is emitted as one event; tests use ASCII only.
- impact: Non-ASCII output can exceed the accepted per-dispatch byte bound by several times, increasing sink latency and work beyond the stated limit.
- suggestedFix: Track encoded byte length and split by UTF-8 byte size while preserving character boundaries.
- status: accepted
- triage: New non-gating performance mismatch; the event count is bounded, so this is not F009 persisting.

### F014

- ID: F014
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/extension.ts:1200-1209`, `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/webview/worktree/WorktreeController.ts:1414-1424`
- title: Reveal-time authority retirement leaves a permanently stale View output action
- evidence: When directory identity no longer matches, `viewSetupOutput` retires/disposes the host record and returns without sending a setup-only update. The controller clears `setupOutputId` only when a provisioning update arrives. On same-id remove/recreate—the boundary F005 specifically covers—the old row action therefore remains visible and every later click silently finds no host record.
- impact: Security fails closed, but the replacement worktree presents a control that can never succeed and gives no indication that its output capability was retired.
- suggestedFix: Publish a narrowly scoped output-retired update to the originating surface/worktree, or retain enough current setup state to issue a setup-only update that clears only the output id without replaying create fields.
- status: accepted
- triage: New chair-only warning from the full-flow reveal → authority-mismatch → controller trace. It does not reopen F005 because stale output is not disclosed.

## Arbiter dispositions

- F001 — **accepted**. Reserved collision remediation is real, but `__proto__` remains a reachable counterexample through the asimov adapter and ordinary-object projections. Gating.
- F002 — **fixed**. One cancellation owner covers open, authorization and pre-spawn.
- F003 — **fixed**. Full-tail recomputation per event is gone; F011 is a distinct backing-allocation mechanism.
- F004 — **fixed**. Valid retry start, replacement and disappearance dispose the prior output.
- F005 — **fixed**. Original directory authority and surface are rechecked before reveal.
- F006 — **accepted**. Kill exceptions no longer block settlement, but kill-before-settle still lets synchronous successful exit override timeout/close. Gating.
- F007 — **fixed**. Empty and selected fresh creates write manifests; reattach remains outside the path.
- F011 — **accepted**. Oversized-event backing memory is uncapped and directly falsifies the accepted transcript bound. Gating.
- F012 — **accepted**. A normal replay-close sequence permanently breaks required output recreation. Gating.

Four accepted blockers remain; the change is parked with `STATUS: blocked`. No blocker qualifies for `rejected`, `audit-backlog`, or `external-blocker`: each is reproducible from repository code and repairable in-repo.

## Adjudication notes

- Full-flow trace covered offer parsing → host-held redemption → material/ports → environment projection → run-level open/auth/pre-spawn/exit cancellation → POSIX/Windows spawn → terminal chunk retention/live batching → gated/ungated launch → manifest → output/retry capability → controller merge → repeated reveal and worktree replacement.
- F001: data-security evidence overrides the contract specialist's clean report because it supplies a concrete legal name and reachable asimov parse path. Chair probes confirmed ordinary-object assignment loses the own property and YAML preserves the declaration.
- F006: runner specialist evidence overrides the data-security clean disposition because it demonstrates the exact synchronous exit ordering at the changed kill/settlement lines.
- F011/F013: performance specialist's byte/backing-allocation evidence is sustained. A chair probe confirmed `Buffer.subarray` retains the source backing allocation.
- F012: logic specialist and chair independently traced replay close to a stale terminal reference; no test covers a second recreation.
- The mutation specialist's fixed dispositions for F004/F005/F007/F008 are sustained; repository serialization prevents completed setup outputs from replacing each other out of order.
- Contracts and reuse specialists reported no independent findings. Their clean reports do not refute the code-specific findings above.
- Host-held command authority, exact POSIX/Windows payload construction, material/port/setup ordering, gated/ungated agent ordering, retry execution identity, setup-only result merging, and manifest non-authority remain sound.
- Inline support review found no changed `.only`/`.skip`, fixture secrets, or behavioral-source execution contradiction. New blocker witnesses are absent from the current tests.

## Sub-agents spawned

- asm-review-data-security: setup/environment/output identity and manifest security — `gpt-5.6-sol[1M]`
- asm-review-logic: runner cancellation and terminal lifecycle — `gpt-5.6-terra[1M]`
- asm-review-logic: retry/output/manifest orchestration — `sonnet[1M]`
- asm-review-contracts: approved remediation contracts and setup-only merge — `gpt-5.6-terra[1M]`
- asm-review-performance: PTY event/byte/resource growth axes — `gpt-5.6-luna[1M]`
- asm-review-reuse: cancellation/process/buffering/authority ownership — `gpt-5.6-luna[1M]`

## Re-review identity

- Chair review session: `ea8b01d7-0032-4405-a0ae-82791e72b715`
- Source of truth: this file at Head `d0689ffc6ea395a16143aa91d3fb4764073cd8d2`
- Arbiter result: blocked with four accepted in-repo blockers; no further ordinary round is available without the repository's round-extension protocol and user grant.
