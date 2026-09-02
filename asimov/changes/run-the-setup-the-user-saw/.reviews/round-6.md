# Review Round 6 — run-the-setup-the-user-saw

- Date: 2026-09-02
- Cycle: 3
- Round: 6
- Mode: verification
- Scope: remediation range `9b9a585e..40b21f1b`
- Head: `40b21f1b395424aa4670e228cfc628749e977b79`
- Reviewable lines: 31 production lines in the remediation range
- User approval: `cho phép round 6`, recorded before the round opened
- Scope lock: satisfied — task 7_1 is exclusively mandatory remediation evidence for accepted F015–F017 under existing D2/D4 owners; it adds no capability, design/spec contract, external contract, or invariant owner
- Verify gate: task 7_1 `[x] exit 0`; caller evidence records focused 22/22, type check, 289 files / 7183 unit tests, changed-source Biome, bundle-require and filesystem-deletion gates passing. Review did not rerun project verification.
- Agents spawned: 3 (data-security, logic, performance) + chair verification and impact-cone trace
- Agents skipped: contracts, frontend, reuse — the remediation cone changes no wire/schema/UI contract or reusable owner
- Verdict: **APPROVE**
- Counts: 0 BLOCK · 0 WARN · 0 SUGGEST; F015–F017 fixed
- Review session identity: `ea8b01d7-0032-4405-a0ae-82791e72b715`

## Correction to the interrupted first pass

The first Round-6 pass incorrectly treated the existence of task 7_1 as non-remediation work. That was inconsistent with the scope-lock predicate in `master.md`: the lock applies only when the delta contains **non-remediation work**. Task 7_1 contains only the accepted F015/F016/F017 repairs, uses their existing D2/D4 invariant owners and boundary inventories, and adds the Acceptance/Verify fields the build workflow requires for every fix. It mints no new owner or external contract. This corrected round therefore performs verification rather than superseding the cycle.

The CLI round ledger had already been closed as `superseded BLOCK blocking=2` before this reconsideration. The supported CLI has no amend operation, and this chair did not edit or rebuild `build-state.json`. This round file is the corrected adjudication; the caller must reconcile the stale ledger entry through the repository's supported state-integrity path rather than by hand-editing state.

## Findings

### F015

- ID: F015
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/extension.ts:604-618`, `:1209-1229`
- title: A stale reveal can retire and overwrite a newer output generation
- evidence: `retireSetupOutput` now accepts an expected output id and refuses a mismatched current generation. After the asynchronous authority check, `viewSetupOutput` rechecks both maps by captured id and object identity before reveal, retirement, or setup-only reporting. There is no await after that recheck. The controlled witness holds A's authority check, installs B, resolves A false, and proves only A's prior replacement disposal occurred, no stale report was posted, and B still reveals.
- impact: A stale generation cannot dispose or report over a newer output/setup generation.
- suggestedFix: None.
- status: fixed
- triage: Fixed at valid reveal, sequential mismatch, concurrent replacement, retry/completed-run replacement and reconciliation boundaries.
- invariant: An asynchronous authority result mutates or reports only the exact output generation it checked.
- boundary inventory:
  - affected in Round 5: authority await; generation replacement; worktree-keyed retirement; setup-only report/controller merge
  - verified safe now: valid reveal; sequential mismatch retirement/report; concurrent A→B replacement; unconditional authoritative replacement/retry/reconciliation retirement; owning-surface report

### F016

- ID: F016
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-performance, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/setupTerminal.ts:208-226`
- title: Fully evicted transcript chunks remain strongly retained until prefix compaction
- evidence: Every fully evicted slot is replaced with one shared zero-byte Buffer before `tailHead` advances, so the discarded backing store becomes collectible immediately. Periodic prefix compaction remains an array-shape optimization rather than the memory-release boundary. The witness measures backing allocations over the entire chunk array after 200 × 768 KiB events and confirms retained backing remains bounded while the logical transcript is at most 1 MiB.
- impact: Discarded transcript events no longer accumulate 100–255 MiB behind the bounded logical tail.
- suggestedFix: None.
- status: fixed
- triage: Fixed for full, partial, oversized and repeated-event eviction paths.
- invariant: Fully evicted transcript bytes release their backing ownership immediately; retained transcript backing remains approximately bounded by the active tail.
- boundary inventory:
  - growth axis: number and size of PTY events before prefix compaction
  - verified safe now: full-chunk eviction; partial-tail copy; oversized-tail copy; complete-array backing accounting; periodic compaction

### F017

- ID: F017
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair, asm-review-performance, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/setupTerminal.ts:229-272`
- title: A single oversized PTY event is fully copied again before live splitting
- evidence: An event at least 64 KiB now flushes any bounded pending small batch, then passes directly to `writeLive`, which emits UTF-8-safe slices of at most 64 KiB without queueing or whole-event `Buffer.concat`. Small latency batches retain their existing bounded concatenation. The non-ASCII witness proves exact output, per-fire byte bounds and no oversized concat.
- impact: Peak allocation no longer includes a second full-size copy of one oversized event; event order and UTF-8 integrity are preserved.
- suggestedFix: None.
- status: fixed
- triage: Fixed for ASCII/non-ASCII oversized events, pending-small-data ordering, close/dispose and latency/size flush boundaries.

## Impact-cone review

- Output generation: both maps and captured record identity are checked after authority resolution; stale authorized and unauthorized A calls return without touching B. Expected-generation retirement is used only after the async boundary; authoritative retry/replacement/reconciliation retirement remains unconditional.
- Controller merge: no stale update is emitted for a superseded generation. Sequential mismatch still emits the setup-only update needed to clear its own stale controls.
- Transcript memory: full eviction releases array-slot backing immediately; partial and oversized retained tails copy trimmed slices; transcript remains logically capped.
- Live output: oversized events bypass the batch queue after flushing prior small data, preserving order. UTF-8-safe slices make progress and remain at most 64 KiB. Pending timers and queues are cleared on close/dispose.
- No new finding intersects the remediation cone. Recorded verification supplies focused adversarial witnesses and cumulative regression evidence.

## Sub-agents spawned

- asm-review-data-security: output-generation authority and owning-surface report — `gpt-5.6-sol[1M]`
- asm-review-performance: transcript backing and oversized live dispatch — `gpt-5.6-terra[1M]`
- asm-review-logic: generation/retirement/eviction/dispatch edge cases — `sonnet[1M]`

## Re-review identity

- Chair review session: `ea8b01d7-0032-4405-a0ae-82791e72b715`
- Corrected Round-6 source of truth: this file at Head `40b21f1b395424aa4670e228cfc628749e977b79`
