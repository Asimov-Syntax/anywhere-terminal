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

### Handback executed — Gate 2 reopened

- Gate 2, `All tasks done`, and the Verify Gate are unticked. The gate evidence described a tree
  whose D1 mechanism and D10 rule are both being replaced, so it no longer describes what ships.
  `Review done` and `Gate: implementation approved` were never ticked and stay that way.
- What changed, and where the reasoning lives: `docs/PLAN.md` WT-007.1 Acceptance (narrowed to the
  four guarantees a machine actually delivers), `design.md` D1 (vitest reporter), D10 (symbol
  acquisition, fail-closed, and the "reachable from the removal path" overclaim), D5 (the I2
  composition), plus tasks for W4 and W2. Evidence: `discovery.md` § "Round-5 handback".
- Gate 2 re-earned under fastlane. One mechanism claim was probed before it entered the design, not
  after: a Vitest reporter setting `process.exitCode` in `onTestRunEnd` exits the run non-zero
  (measured 7), and the runner marks `describe.skipIf`, `runIf`, and a runtime `ctx.skip()` as
  skipped while `it.fails` reports `passed` with `options.fails === true`. Evidence in discovery.md
  § "Round-5 handback" 2b. The oracle settled what to read; it did not settle how the gate fails.

### Round-5 designed fix built — tasks 8_1..8_5, Verify Gate re-run

- Verify Gate: check-types clean; 234 files / 4733 tests pass; `pnpm run gate:fs-deletion` ok
  (29 modules in scope, 7 bypass spellings proven visible, ~1.6 s); bench 0.1 ms / 30.8 ms, both
  under budget; `verify-status` exit 0.
- Lint re-measured against a clean detached worktree of `main` with THIS worktree's biome 2.4.5
  (the version-drift lesson): finding sets are identical. Baseline additionally reports two format
  errors in `src/cursor/CursorHookController.test.ts` and `CursorHookInstaller.test.ts`, which
  landed on main after this branch and do not exist here. This change introduces no lint finding.
- `pnpm run gate:fs-deletion` is registered in `asimov/project.md` § Commands, so it runs in every
  future Verify Gate rather than only in the task that added it.
- Two things were probed rather than assumed, both because a five-round history says mechanism
  claims here do not survive on plausibility: a reporter setting `process.exitCode` in
  `onTestRunEnd` does fail the run (exit 7), and `deactivate()` really closes the hook endpoint —
  the old teardown disposed the runtime directly, which closed the socket either way and so made
  the fix unfalsifiable. That is now its own assertion.
- Red demos run and reverted: `it.skipIf(true)` on every `[I3]` test → coverage failure, exit 1;
  a named-import `rm` added to `src/worktree/worktreeMutations.ts` → gate exit 1; the I2
  classification assertion flipped to `agentSource: "launch"` → fails, so it reads a real value.
- Review NOT closed and NOT approved. Cycle 2 has round 6 remaining; the round-5 blockers are
  fixed but have had no reviewer verdict.

### Cycle 3 round 6 — BLOCK (1 B, 2 W), all accepted and fixed in 9_1

- The chair agreed the handback superseded cycle 2 and opened this as cycle 3's discovery round.
- B15 reproduced before triage: four acquisitions the new gate passed at exit 0 — a quoted binding
  key, a destructuring assignment, an `as any` cast, and an `any`-typed alias. The gate's own
  fixture mechanism reported all four as blind spots the moment they were written down.
- The defect was NOT the checker approach. The checker resolved every spelling that reached it;
  four never did, because member-name extraction was reimplemented inline at each AST shape. It is
  now one `memberName` for name positions and one `elementKey` for index positions — the two were
  conflated, which is why `fs.promises[member]` came back as the key "member" and resolved to
  nothing.
- The fail-open on `any` was the worse half and it was mine: D10 says fail closed, the file says so
  in a comment, and the code three lines below treated an unresolved symbol as a pass. Both
  unresolved cases are rejections now, and `pass-erased-unrelated.ts` keeps that from widening.
- W5 (native path separators) and W6 (a throwing deactivate skipping the disposal loop) accepted
  and fixed. W6 is the failure path of the round-5 W4 fix reopening the leak that fix closed.
- Verify Gate re-run: check-types clean, 234 files / 4733 tests, gate ok (29 modules, **11**
  spellings proven visible), bench 0.1 ms / 32.6 ms, lint identical to the main baseline,
  `verify-status` exit 0.
- Review still NOT closed and NOT approved. Cycle 3 has rounds 2 and 3 available.

### Cycle 3 round 7 — BLOCK, thrash stop, second handback for I10

- Round 7 verdict BLOCK: B15 (nested destructuring assignment) and W7 (fail-closed rejecting
  unrelated erased APIs). Both accepted, both reproduced before triage. W5 and W6 confirmed fixed.
- **Thrash stop declared**: the same invariant survived two fix attempts (tasks 8_2 and 9_1).
  The user chose option 1 — hand back to `asimov-plan` for a designed fix.
- W7 is the round-5 false-positive direction reintroduced by the fix for the opposite direction.
  A rule wrong in both directions at once is the thing D10's own code comment calls disqualifying.
- Diagnosis: round 6 blamed name extraction being reimplemented per shape. True, and insufficient
  — the ENUMERATION is the defect. D10 has enumerated *binding forms*, which is open-ended, and
  four rounds each found new members of that set.
- Stated for the record: there is no filesystem-deletion defect in production. All 29 in-scope
  modules are clean every round. B15 is a hole in a guard, not a live bug.
- Gate 2 re-earned under fastlane (user: "fastlane nhé, plan -> build -> review tự động").
  D10's mechanism moves from enumerating binding forms to reading types at references, and
  fail-closed gains the provenance W7 asked for. One task, 10_1.
- 10_1 built. The gate now reads types at references instead of enumerating binding forms, and
  fail-closed is decided by an expression's chain rather than by the member's name. One bounded
  hop follows a variable's initializer, because `const anyFs: any = fs.promises` erases provenance
  at the declaration rather than at the use — a parameter has no initializer, which is what keeps
  W7's unrelated erased APIs passing.
- Fixtures: 12 flag- (all rejected) and 5 pass- (none rejected), from 7 and 2 at round 5.
- Verify Gate: check-types clean, 234 files / 4733 tests, gate exit 0 in 1.48 s, bench 0.1 ms /
  32.4 ms, lint identical to the main baseline (13 warnings + 1 info), verify-status exit 0.

### Cycle 4 round 9 — REJECT, second thrash stop on I10, claim narrowed

- Round 8 returned SUPERSEDED with no verdict: I sent a mechanism change into a verification round
  after telling the round-6 chair that exactly this closes a cycle. A round was spent on my error.
- Round 9 (discovery): 3 BLOCK, 2 WARN, 1 SUGGEST. All accepted; W8's second clause rebutted with a
  measurement — skipping every node under a type ancestor still catches all 12 `flag-` fixtures, so
  the reported visibility count was not inflated by type annotations.
- **B17 settles the argument.** TypeScript's type identity is structural, so a destructive fs
  function passed through a structurally-compatible local type no longer resolves to
  `@types/node/fs`. No type-based rule can be sound. Soundness needs reaching-definitions value
  flow — a static analyzer, not a verification task.
- Thrash stop: I10 survived three fix attempts across four mechanisms. Handback taken under
  fastlane, and the TARGET is inverted — every previous handback tried to make the rule stronger,
  which produced defects in the false-positive direction (W7, then W9). This one makes the CLAIM
  weaker and asserts the gaps instead of denying them.
- Not risk-accepted: only the user grants that, and it has not been granted.
- Gate 2 re-earned under fastlane. One task, 11_1: the rule shrinks, and its gaps become `gap-`
  fixtures the gate asserts rather than prose nobody checks.
- 11_1 built. The erased-type branch, the provenance walk and the shared cycle state are deleted —
  they existed only to support the withdrawn soundness claim, and they are what produced W7, W9 and
  S10. Scanning is restricted to executable positions (W8). Fixtures: 10 `flag-` caught, 5 `pass-`
  clean, 4 `gap-` asserted to stay open.
- Writing the gap fixtures caught an error in my own evidence: the first `gap-call-produced.ts` was
  REJECTED, because `return fs.promises.rm` inside the same file is itself a reference. The gap is
  real only when the producer lives outside the scanned scope, so the factory moved to an unasserted
  helper. A gap fixture that passes for the wrong reason would have documented a limit that is not
  the limit.
- Verify Gate: check-types clean, 234 files / 4733 tests, gate exit 0 in 1.35 s, bench 0.1 ms /
  26.9 ms, lint identical to the main baseline, verify-status exit 0.
- 12_1 built, closing round-10 B19 and W8/W10/W11/W12/S13. D10's five stacked revisions are REPLACED
  by one contract instead of a sixth revision — the earlier normative SHALLs still certified the
  universal claim round 9 withdrew, which is the defect B19 names. The gate's header, success and
  failure text now report the search rather than the property, and `asimov/project.md` carried the
  same overclaim in its one-line description.
- The I10 registry row keeps `status: "covered"` and now states the standard it means: passing
  behavioural evidence, not proof of a universal negative. Its `stimulus` is narrowed to a change the
  evidence actually turns red, because a `gap-` spelling would not. Oracle consulted on exactly this
  question (option (b) of four) and concurred; its wording for the row and the success line is used.
- Two probes, because W10 and W11 said the gap fixtures proved the wrong limit and they were right.
  With the helper annotated `typeof fs.promises.rm`, adding `CallExpression` to the visited kinds now
  CLOSES `gap-call-produced` — before, it stayed open through structural erasure, so it never
  isolated the call-produced cause. Deleting a `gap-` fixture now fails the gate (W12).
- My own W8 fixture was wrong twice before it was right: `typeof ambient` and `rm.name` in value
  positions are genuine executable references, and the rule was correct to report them. The fixture
  had to stop using the names at all for the claim to be about declarations.
- Correction to the previous Verify Gate note: the lint baseline was built from `origin/main`, which
  is 59 commits STALE. The two extra format errors came from `src/cursor/CursorHook*.test.ts`, files
  `ce2e8010` REMOVED from main before this branch — not files that landed after it. Rebuilt against
  local `main` with one biome binary (2.4.5 both sides; the throwaway worktree resolves 2.3.14 and
  reports 4 warnings, which is the version-drift trap): main 13 warnings + 1 info, HEAD 13 + 1.
  Identical — 32 added files, no new finding.
- Verify Gate re-run after 12_1: check-types clean, 234 files / 4733 tests, gate exit 0, bench 0.1 ms
  presence / 33.2 ms model, lint identical to local main, verify-status exit 0.
