# Workflow State: verify-cross-layer-scale

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [x] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source + lane below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-007.1
Lane: full (standard) — cross-layer verification spanning model, presence, host, and webview | flags: re-review
Mode: fastlane — Gate 1 auto-selected D1 Option B (tagged titles + a declaration-parsing meta-test) over a doc table or an import-time registry.
Oracle round: 5 BLOCK, 2 WARN — all 7 accepted, 0 rebutted. Artifacts rewritten before Gate 2; two oracle sub-claims corrected against evidence (waves already serialized 4_1/4_2, and review is mandatory here via the re-review flag, not optional).
Blueprint status is deliberately NOT set to done by this change: docs/PLAN.md:358 makes WT-006.3 depend on WT-006.2, which is in_progress in another session, so WT-007.1 depends on it transitively while its acceptance says every invariant (D9). WT-007.1 stays in_progress with the frozen deferred set naming what remains.
Discovery corrected itself twice mid-pass, both recorded in discovery.md: the render cap is implemented (not dead), and the WT-006.2 dependency is transitive (missed on a direct-deps reading).
src/agentHooks/install/managedEntryLedger.ts carries the same NUL defect as the D7 files and is left alone — peer-owned.
5_1 resolved inside its Boundary after all: the worktreeAssembly race was ours (assemble() waited a fixed 40 turns; now waits on the rendered-row condition). The ManagedConfigInstaller/claudeConfigAdapter timeouts that looked like a second, peer-owned flake did not recur in any of the five verifying runs — they were load induced by the very spinning this fix removed. No retry flag, no widened timeout, no lease on the peer tree.
Verify Gate lint: 4 findings remain under `biome check src/`, all reproduced on a clean detached worktree of main and all in files this change does not touch — SnapshotPersistence.ts, fileTreeRpc.integration.test.ts, VaultService.customName.test.ts, worktreeFormat.ts. Findings in this change's own files were fixed, not suppressed; `--write` was scoped to this diff's files and `--unsafe` never used.
bench:scale is a plain bun process, not a vitest worker: inside a worker a bare `git --version` costs ~80 ms against ~10 ms outside, which alone put the model rebuild over its 150 ms budget. Both budgets pass outside — presence 0.1 ms, model ~35 ms. The bound and the fixture size did not move (D2).
Audit finding, recorded against design.md D9: DEFERRED_BY_WT_006_2 is EMPTY — every § 8.4 invariant is reachable without the peer-owned tree, so D9's peer-ownership leg does not bite. Its transitive-dependency leg (docs/PLAN.md:358) still does.
Round 1 verdict REJECT (11 BLOCK, 2 WARN); all accepted, none rebutted, fixed in task 6_1. B1 was the one that mattered and it was mine: the declaration scan was a regex over raw text, so a commented-out it() counted as live coverage — and the scan's own regression fixture ASSERTED that it should, in the file whose only job is to keep the others honest.
B2 partially closed and the remainder stated rather than hidden: I16 retagged onto the two projector tests that actually prove nothing is opened (the reducer test only proved propagation and is now untagged and renamed to say so); I11's third clause got the test it never had; I5 and I1 gained their publish-side and registry-side tags. I10 and I12 were re-read against their stimulus and left as they are — I10's argv test does prove delegation to git, though it cannot see an fs.rm added elsewhere, and that limit is real.
Round 2 REJECT (5 BLOCK), round 3 BLOCK (2) — all accepted, none rebutted across three rounds. Cycle 1 hit its cap still carrying B1, which had then survived three fix attempts through ONE mechanism: a hand-written scanner that miscounted comments (r1), literals (r2), and longer identifiers like `item(` and `testHelper(` (r3), each time certified correct by the fixture written with it. The user was asked to choose among the fix loop's three thrash-stop options and was away; under fastlane I took the recommended one — handback, and a designed fix.
design.md D1 revised and D10 added at that handback: the declaration scan parses via `ts.createSourceFile` and walks CallExpression nodes instead of scanning characters (typescript 5.9.3 was already a devDependency), and I10 is closed by a source rule rather than by a comment admitting the gap. All three rounds' negative fixtures are kept — what they prove now is that the mechanism no longer needs them.
The D10 rule is deliberately scoped to src/worktree/** plus WorktreeHost.ts. Six production modules elsewhere delete files they wrote themselves — a clipboard temp file, an injected shell-integration script, session storage, the vault cache, a sqlite temp, and the peer-owned locked-JSON writer. A rule failing on those would be a rule about fs.rm, not about I10.
NOT closed, and not to be read as approved: cycle 1 is exhausted, so the round-3 blockers have had no reviewer verdict since being fixed. W2 (bench fixture duplication) and S2 (redundant pane-count test) remain accepted-but-unfixed by choice. Any further review opens cycle 2, round 4, in discovery mode.

- Round 4 opened cycle 2 in discovery mode (rounds 4-6 available) and returned REJECT: 4 BLOCK,
  2 WARN, 2 SUGGEST. Every BLOCK was reproduced before triage — none accepted on the chair's word.
- B12 is the fourth way D1 has been wrong, and the first non-lexical one: `describe.skip` and a
  locally shadowed `it` are real, correctly parsed call sites that never execute. The parser was
  necessary and never sufficient; "a declaration exists" was never the property worth checking.
  design.md D1 carries the fourth row and the two rules that close it.
- B13 cost a test file: `extension.crossLayer.test.ts` mirrored the `onStatus` routing branch by
  hand because its lighter harness could not run `activate()`. Its I6/I7 tests moved into
  `extension.worktreeAssembly.test.ts` and the file is deleted. Red-demoed: making production
  routing drop non-working states now fails both I6 tests, and used to fail neither.
- Deviation from task 7_1's Boundary: none. The alternative fix — extracting a production routing
  helper — was considered and rejected in favour of the harness move, which needed no production
  edit.
- W4's `afterEach` is the first teardown this assembly file has ever had. Every case leaked an
  AgentHookRuntime and its loopback server. This is a candidate cause of the PTY_LOAD_FAILED
  order-instability carried over from the previous change, not a confirmed fix for it.
- W2 (bench fixture duplicating `worktreeMutations.integration.test.ts`) is accepted and NOT fixed.
  Recorded as author-deferred, not risk-accepted: only the user can grant that status. It has now
  been deferred in two cycles.
- Lint baseline was re-measured after a false diff: `/tmp/lintbase` inherited biome 2.5.10 from the
  main checkout while this worktree runs 2.4.5. Compared with one binary and one config, the
  finding set is IDENTICAL to clean `main` — this change introduces none.
- Review still NOT closed and not to be read as approved: the round-4 fixes have had no reviewer
  verdict. Cycle 2 has rounds 5 and 6 available.

### Cycle 2 round 5 — BLOCK, thrash stop, handback (state at compaction)

- Round 5 verdict BLOCK: 2 blockers (B2, B12), 2 warnings (W4, W2), 0 suggestions. Fixed that
  round: B13, B14, S2, S3, B2/I3, and the F1/I9 + F2/I5 addendum. Triage is in `.reviews/round-5.md`.
- **Thrash stop declared**: I10 survived two designed fix attempts, and D1's scanner has failed in
  five consecutive rounds through five different mechanisms.
- **User decisions (explicit, this session):**
  1. Thrash stop → **option 1**, hand back to `asimov-plan` for a designed fix.
  2. **Narrow the blueprint acceptance clause** for WT-007.1 per the oracle's four explicit
     guarantees — keep I2 and I10, cut the implicit claim that a machine proves each tagged
     assertion necessarily fails for every possible violation of its English stimulus.
  3. **W2 → fix**, not risk-accepted. No blocker in this change is risk-accepted.
- An `asm-oracle` consultation was user-requested. Its full reasoning, both empirical probes, the
  measured Program cost, the I2 composition recipe, the W4 `vi.resetModules()` trap, and the
  peer-overlap analysis are written to `discovery.md` § "Round-5 handback" — they do not survive
  the session otherwise.
- **Handback is NOT yet executed.** No artifact has been revised and no fix code written since
  `aa031e0`. Next agent: reopen Gate 2 (untick `Gate 2: plan approved`, `Review done`,
  `Gate: implementation approved`), revise `docs/PLAN.md` WT-007.1 Acceptance, `design.md` D1
  (vitest reporter), D10 (symbol acquisition + fail-closed + the "reachable" wording fix), D5 (I2
  composition), then add tasks for W4 and W2. Cycle 2 has round 6 remaining.
- Review remains NOT closed and NOT approved. Nothing in this session ticked any gate.
