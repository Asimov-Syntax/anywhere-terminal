# Review Round 5 — run-the-setup-the-user-saw

- Date: 2026-09-02
- Cycle: 3
- Round: 5
- Mode: discovery
- Scope: cumulative range `45dab796..HEAD`
- Head: `9b9a585e78e5c16d36f2fe4d905784d2e8d81819` (working tree dirty only from generated `asimov/changes/run-the-setup-the-user-saw/analytics.json`; reviewable production content is unchanged from `7e6af6dd`)
- Scope lock: satisfied — this is the fresh discovery cycle Round 4 routed to, reviewing accepted task 6_1 and cumulative implementation together
- Reviewable lines: 1583 added/modified production lines across 12 reviewable files
- Note: Large change — accuracy may decrease
- Labels: `security-privacy`; fastlane
- Verify gate: `bun run asm change verify-status run-the-setup-the-user-saw` reports tasks 1_1 through 6_1 `[x] exit 0`. Caller evidence records focused and full unit verification, type check, all 27 changed-source Biome checks, build-require gate, and deletion gate passing; unchanged full-Biome failures reproduce on clean `82cb1ba6`. Review did not rerun project verification.
- Agents spawned: 5 (logic, data-security, performance, contracts, reuse) + chair self-review and full-flow trace
- Agents skipped: frontend — no changed frontend production behavior in task 6_1's impact cone
- Verdict: **BLOCK**
- Status: **blocked**
- Counts: 2 open BLOCK · 1 open WARN · 0 open SUGGEST; all six Round-3 target findings fixed
- Split over gating blockers: 2 feature / 0 machinery
- Review session identity: `ea8b01d7-0032-4405-a0ae-82791e72b715`

## Findings

### F001

- ID: F001
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security, asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/providerKit.ts:162-192`, `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/worktreeMutationService.ts:483-491`, `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/setupRunner.ts:177-192`
- title: Prototype-sensitive port names lose their authoritative environment value
- evidence: The current JSONC path uses `parseTree` plus `getNodeValue`, which materializes null-prototype objects at every depth; a chair probe confirmed native `ports.__proto__` is an own enumerable key. The asimov YAML path also preserves it. Mutation projection now uses `Object.create(null)`, and runner environment assembly uses `Object.assign(Object.create(null), base)`, preserving the port as an own child-environment property while host variables still overlay last.
- impact: Native and asimov declarations agree, and an allocated `__proto__` port reaches setup authoritatively.
- suggestedFix: None.
- status: fixed
- triage: Fixed across parse, projection, defense-in-depth and child enumeration boundaries. The earlier probe that showed JSONC loss used `parse()`, not the repository's current `parseTree/getNodeValue` path; current-path evidence refutes persistence.

### F006

- ID: F006
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic, asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/setupRunner.ts:300-320`, `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/setupTerminal.ts:279-307`
- title: Kill-triggered immediate exit can win over timeout or terminal-close cancellation
- evidence: Runner cancellation now calls `settle(timeout|closed)` and disposes the exit subscription before deadline kill. Terminal close notifies cancellation listeners before terminal-owned kill. Synchronous successful exit delivery therefore observes an already-settled cancellation and cannot replace it.
- impact: Timeout/close remains authoritative and a gated agent cannot start from kill-triggered success.
- suggestedFix: None.
- status: fixed
- triage: Fixed for deadline and terminal-close ordering, including immediate synchronous exit on kill.

### F011

- ID: F011
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic, asm-review-performance
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/setupTerminal.ts:190-220`
- title: Oversized PTY events retain their full backing allocation
- evidence: Every trimmed oversized or partial tail is now wrapped in `Buffer.from(...)`, producing an independently bounded backing allocation. The adversarial witness verifies all logically retained chunks have backing stores no larger than 1 MiB.
- impact: The original `Buffer.subarray` backing-store mechanism is closed. F016 records a different mechanism involving references to fully evicted chunks.
- suggestedFix: None for F011.
- status: fixed
- triage: Fixed. The retained-memory invariant still has a newly discovered, independently actionable mechanism under F016; IDs are not merged because the causal mechanism differs.

### F012

- ID: F012
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-logic, asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/setupTerminal.ts:139-165`
- title: Closing a replay terminal prevents subsequent output recreation
- evidence: Replay close now identity-clears `replayTerminal`; the next reveal constructs a fresh emitter/terminal. Coverage exercises close → reveal recreation.
- impact: Repeated `View output` remains available after each replay close.
- suggestedFix: None.
- status: fixed
- triage: Fixed for repeated replay recreation.

### F013

- ID: F013
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-logic, asm-review-performance
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/setupTerminal.ts:6-7`, `:229-257`
- title: Live flush limit measures UTF-16 units instead of bytes
- evidence: Live queues now store Buffers, count encoded bytes, and split output at UTF-8 continuation boundaries. Non-ASCII coverage asserts every emitted string is at most 64 KiB in UTF-8.
- impact: The approved per-dispatch byte bound now holds.
- suggestedFix: None.
- status: fixed
- triage: Fixed for ASCII and non-ASCII byte boundaries without zero-progress loops.

### F014

- ID: F014
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair, asm-review-data-security, asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/extension.ts:1209-1224`, `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/webview/worktree/WorktreeController.ts:1414-1424`
- title: Reveal-time authority retirement leaves a permanently stale View output action
- evidence: On authority mismatch, the host now disposes the output and posts a setup-only update from the retained setup result to the owning surface. The controller clears omitted output/retry ids while preserving initial material/ports/contests.
- impact: The sequential authority-mismatch path no longer leaves a permanently inert control.
- suggestedFix: None for F014.
- status: fixed
- triage: Fixed for the original no-report mechanism. F015 records a distinct stale-generation race introduced by the reporting fix.

### F015

- ID: F015
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security, asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/extension.ts:600-628`, `:1209-1224`
- title: A stale reveal can retire and overwrite a newer output generation
- evidence: `viewSetupOutput` captures output record A, awaits multi-step directory authorization outside the repository coordinator, then retires by `worktreeId` alone. During that await, retry or same-id replacement can install output B. If A's check resolves false, `retireSetupOutput(A.worktreeId)` deletes/disposes B because the worktree map now points to B. The subsequent setup-only update posts A's setup with no output/retry ids; controller merge can then overwrite B's newer setup state and clear its actions.
- impact: A stale View output action can destroy the valid current terminal and replace the current row's setup status with a superseded generation. This violates D4's generation-bound output ownership and the required output/retry path.
- suggestedFix: After authorization resolves, verify that both maps still identify the captured `outputId`/record before retiring or reporting. Make retirement accept an expected output generation and no-op if it was superseded. Add a controlled witness: A reveal check pending → B retained under same worktree → A fails → B terminal/actions/setup remain.
- status: accepted
- triage: New discovery blocker. It is related to F014's remediation path but has a different causal mechanism and materially greater impact, so it receives a new ID.
- invariant: An asynchronous authority result can mutate or report only the exact output generation it checked.
- boundary inventory:
  - affected: reveal authorization await; retry/completed-run replacement; worktree-keyed retirement; setup-only report ordering; controller merge
  - verified safe: sequential mismatch retirement; valid reveal; origin scoping; replacement disposal without concurrent stale reveal
  - not safe: supersession while an old authority check is in flight

### F016

- ID: F016
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-logic, asm-review-performance, chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/setupTerminal.ts:208-225`
- title: Fully evicted transcript chunks remain strongly retained until 256 evictions
- evidence: When an old chunk is fully evicted, `tailHead` advances but the Buffer remains referenced in the array prefix. That prefix is removed only at `tailHead >= 256`. Repeated near-1 MiB events can therefore retain roughly 100–255 MiB of fully discarded buffers while `transcript()` exposes at most 1 MiB. The current backing-allocation test inspects only `tailChunks.slice(tailHead)`, excluding the retained prefix.
- impact: One setup terminal can retain two orders of magnitude more memory than the accepted approximately 1 MiB bound; multiple live worktrees multiply the pressure and can destabilize the extension host.
- suggestedFix: Release each fully evicted slot before advancing the head, such as replacing it with a shared empty buffer, while retaining periodic array compaction. Add a witness that accounts for backing allocations across the entire array, including entries before `tailHead`, after hundreds of medium/large events.
- status: accepted
- triage: New discovery blocker. F011's oversized-slice alias is fixed; this is a different retained-reference mechanism violating the same high-level memory invariant.
- invariant: Fully evicted transcript bytes cease to own backing memory immediately; total retained transcript backing remains approximately 1 MiB.
- boundary inventory:
  - growth axis: number and size of PTY data events before prefix compaction
  - affected: full-chunk eviction and array-prefix lifetime
  - verified safe: logical transcript size; active retained chunks; oversized-tail copies; eventual 256-entry compaction
  - not safe: backing memory held by fully evicted prefix entries before compaction

### F017

- ID: F017
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: asm-review-performance
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/worktree/provisioning/setupTerminal.ts:183-186`, `:229-257`
- title: A single oversized PTY event is fully copied again before live splitting
- evidence: `Buffer.from(data)` materializes the whole event, `queueLiveWrite` queues it, and immediate flush calls `Buffer.concat` over the full queued byte count before splitting into 64 KiB emissions. A 100 MiB event therefore temporarily holds the 100 MiB event buffer plus an approximately 100 MiB concatenation and performs one large synchronous copy.
- impact: Dispatch size is bounded, but peak allocation and synchronous work remain proportional to an individual event's size rather than the flush bound.
- suggestedFix: For input already over the flush threshold, stream UTF-8-safe slices directly to the writer instead of queuing and concatenating the complete event; retain only sub-threshold data for the latency batch.
- status: accepted
- triage: New non-gating performance issue. Peak work is temporary and dispatches remain bounded, so WARN rather than BLOCK.

## Adjudication notes

- Full-flow trace covered native/asimov parse → host offer → authoritative port projection → null-prototype child environment → run cancellation/kill → transcript retention/live byte batching → replay recreation → output authority await → replacement/retirement → setup-only controller merge.
- F001: data-security and contracts clean dispositions are sustained after a current-path chair probe of `parseTree/getNodeValue`; the earlier `parse()` behavior is not the repository path.
- F006/F012/F013: logic and contract specialists independently confirmed fixes and adversarial ordering/UTF-8 witnesses.
- F011: the original alias mechanism is fixed. Specialist concern about evicted prefix references is sustained separately as F016 under the invariant-ID rule for a different causal mechanism.
- F014: the original stale-action mechanism is fixed. Data-security/contracts evidence and chair trace sustain F015 as a separate generation race rather than silently reopening or merging it.
- F016 severity conflict: performance rated the retained-prefix issue WARN while logic rated BLOCK. The chair sustains BLOCK because the accepted approximately 1 MiB backing bound can be exceeded by over 100 MiB per terminal and multiplied across live worktrees; the concrete impact is extension-host destabilization, not merely an inefficient constant.
- Reuse specialist found no independent duplication defect. Custom null-prototype and UTF-8 helpers are cohesive for their accepted owner.
- Host-held command authority, payload construction, material/port/setup ordering, gated/ungated agent sequencing, manifests, retry execution identity, and prior fixed F002-F005/F007-F010 remain sound.
- Inline support review found no changed `.only`/`.skip`, fixture secrets, or behavioral-source contradiction. Current tests do not cover F015's interleaving or F016's evicted-prefix backing memory.

## Sub-agents spawned

- asm-review-logic: cancellation, kill, replay and terminal edge cases — `gpt-5.6-sol[1M]`
- asm-review-data-security: port/environment and output-generation authority — `sonnet[1M]`
- asm-review-performance: retained memory, UTF-8 batching and resource growth — `gpt-5.6-terra[1M]`
- asm-review-contracts: task 6_1 contract and setup-only update semantics — `gpt-5.6-terra[1M]`
- asm-review-reuse: final lifecycle and helper ownership — `gpt-5.6-luna[1M]`

## Re-review identity

- Chair review session: `ea8b01d7-0032-4405-a0ae-82791e72b715`
- Source of truth: this file at Head `9b9a585e78e5c16d36f2fe4d905784d2e8d81819`
- Round 5 was user-approved and reviews the accepted task 6_1 contract in fresh discovery mode; no scope-lock deferral remains.
