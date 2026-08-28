# Review Round 3

- Date: 2026-08-28
- Cycle: 1
- Mode: verification
- Scope: range `fe792fa9880e6065d09035f7d30f13a1b747f628..432b9fcc6de0740d0255d81ba52a74169745b6f9` plus every round-2 finding boundary
- Scope lock: passed — remediation and review metadata only; the sole production edit freezes the already-exported activity table without changing its contents
- Head: `432b9fcc6de0740d0255d81ba52a74169745b6f9` (clean before this round file)
- Reviewable lines: 6 (plus 258 changed test/support lines)
- Verification evidence: caller reports check-types clean, 235 files / 4,735 tests passing, both scale budgets passing, and only four baseline Biome findings outside touched files; review commands were not rerun
- Agents spawned: `asm-review-logic`, `asm-review-contracts`, `asm-review-performance`
- Agents skipped: data-security/frontend/reuse — no corresponding production impact in the verification cone
- Verdict: BLOCK
- Open counts: BLOCK 2, WARN 1, SUGGEST 1
- Fixed this round: 4 round-2 findings, plus the I11/I12 portion of B2
- Cycle cap: reached — cycle 1 has used all three rounds; any next user-initiated review starts cycle 2, global round 4, in discovery mode

## Open findings

### B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + asm-review-logic + asm-review-contracts
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/invariants/sourceSources.ts:134`
- title: Scanner still accepts longer identifiers as test declarations
- evidence: `declarationsIn()` selects `it` or `test` by prefix, then consumes all following identifier characters as a modifier chain. A targeted probe returned `item("[I1] fixture", ...)` as an `it` declaration with modifier `em`, and `testHelper("[I2] fixture", ...)` as a `test` declaration with modifier `Helper`. Comments, strings, templates, and regex literals are now excluded; exact trailing identifier boundaries remain affected.
- impact: An unrelated helper call can keep an invariant covered after the last executable `it`/`test` declaration is removed. B1 persists for the third round through the same hand-written scanner mechanism.
- suggestedFix: Stop patching the lexical scanner and use the TypeScript compiler AST to select exact executable `it`/`test` call expressions. At minimum, enforce an exact boundary after the base name and add negative fixtures for `item`, `itHelper`, `testing`, and `testHelper`.
- status: open — persists from rounds 1 and 2
- triage: accepted in both prior rounds; remediation incomplete

### B2

- ID: B2
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + asm-review-logic + asm-review-contracts
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/worktree/presenceProjector.test.ts:254`; `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/invariants/registry.ts:108`
- title: I1 and I10 still claim coverage without enforcement of their named failure
- evidence: I1's identity-retention test is tagged, but the actual assertion that a failed scan cannot downgrade `activity: running` at line 254 remains untagged; the added second tag covers degradation replay instead. For I10, real-Git integration tags prove Git performs deletion, but the registry comment explicitly admits that adding a production `fs.rm` elsewhere would not fail any tagged test while the row remains `covered`. Boundary inventory searched: failed-read identity/activity retention, degradation replay, host delegation, real-Git mutation, and direct filesystem deletion. Affected: I1 activity retention and I10 extension-wide direct-deletion prohibition. Verified safe this round: I11 and I12; previously safe: I5 and I16.
- impact: I1 can downgrade activity after a failed scan, or production can add direct recursive deletion, while the invariant registry remains green.
- suggestedFix: Tag the existing I1 activity-retention test. Add a source-level invariant/lint rule rejecting direct destructive filesystem APIs in production removal code, with narrow documented exceptions; the real-Git tests remain supplementary evidence.
- status: open — persists from rounds 1 and 2
- triage: accepted in both prior rounds; I11/I12 fixed, I1/I10 incomplete

### W2

- ID: W2
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/bench/scale.bench.ts:105`
- title: Benchmark still reimplements the canonical repository fixture builder
- evidence: The standalone benchmark retains its own repository initialization, Git identity, commit, worktree creation, and teardown rather than sharing the integration fixture.
- impact: Benchmark and integration repository shapes can drift.
- suggestedFix: Extract a runtime-neutral fixture helper in a later planned change and reuse it from both consumers.
- status: open — persists from rounds 1 and 2
- triage: accepted and deliberately not fixed; not risk-accepted

### S2

- ID: S2
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/worktree/presenceProjector.scale.test.ts:95`
- title: One-pane-versus-ten assertion still creates only ten panes
- evidence: The test still invokes the fixed ten-pane `wireAtScale()` fixture and repeats prior count assertions.
- impact: It supplies no evidence for its stated one-versus-ten comparison.
- suggestedFix: Parameterize pane count or remove/rename the redundant case in a later cleanup.
- status: open — persists from rounds 1 and 2
- triage: accepted and deliberately not fixed

## Fixed findings

### B6

- ID: B6
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/extension.worktreeAssembly.test.ts:933`
- title: I14 did not transition to working under an open confirmation
- evidence: The scenario now opens a valid confirmation with an idle agent, transitions the row to running while the dialog is open, submits, and verifies refusal copy, absent retry, and no forced Git operation.
- impact: The exact I14 transition is now covered.
- suggestedFix: none
- status: fixed
- triage: accepted round 2; verified fixed round 3

### B7

- ID: B7
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/extension.worktreeAssembly.test.ts:116`
- title: I15 left registration and filesystem state in agreement
- evidence: The disagreement fixture now deletes the directory while retaining the Git registration, moving exactly one state source.
- impact: The required rebuilt cross-source mismatch is now exercised.
- suggestedFix: none
- status: fixed
- triage: accepted round 2; verified fixed round 3

### B9

- ID: B9
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair + asm-review-performance
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/worktree/presenceProjector.scale.test.ts:103`
- title: D2 test measured reported-session cache rather than pane-key cache
- evidence: The test now resolves pane-0 through the ordinary registry/process path, leaves paneId/ptyPid/cwd unchanged, and counts the snapshot's descendant resolution. With the production proven-key guard removed, cumulative calls reach the failing threshold.
- impact: D2's unchanged-pane `PaneState.proven` cache is now covered.
- suggestedFix: none
- status: fixed
- triage: accepted round 2; verified fixed round 3

### W3

- ID: W3
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair + asm-review-contracts
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/worktree/presenceProjector.ts:80`
- title: Exported activity universe was mutable
- evidence: `TURN_ACTIVITY` is now typed readonly and runtime-frozen; its three mappings and production consumer are unchanged.
- impact: Importers cannot rewrite the production activity mapping.
- suggestedFix: none
- status: fixed
- triage: accepted round 2; verified fixed round 3


---

## Triage — author, round 3

| # | Status | Triage |
|---|---|---|
| B1 | accepted | Verified by probe before triage: `declarationsIn('item("[I1] fixture", 1); testHelper("[I2] fixture", 2);')` returns BOTH as active declarations — `it` + modifier `em`, `test` + modifier `Helper`. The scanner guards the identifier's LEFT boundary and not its right. Third round, same causal mechanism, each time inside my own fix. The chair's call that patch-level repair has failed is correct and I am not arguing it. |
| B2 (I1) | accepted | The activity-retention assertion is untagged: a failed scan that keeps identity but downgrades `running` leaves every I1 tag green. |
| B2 (I10) | accepted | My round-2 close was wrong in kind, not just in degree. Writing the limit into the registry documents the hole; it does not close it, and the row still says `covered`. A real close needs a source-level rule, which is a different kind of artifact from a test. |
| W2, S2 | accepted, not fixed | Unchanged from round 2 — non-blocking, named rather than rushed. |

**Thrash stop reached.** Cycle 1 exhausted its three rounds still carrying blockers, and B1
survived three fix attempts through one mechanism. Handed to the user with the three options
the fix loop allows.
