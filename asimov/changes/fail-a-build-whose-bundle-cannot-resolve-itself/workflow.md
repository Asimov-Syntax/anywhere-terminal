# Workflow State: fail-a-build-whose-bundle-cannot-resolve-itself

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [x] Gate 1: direction approved — user chose warn-not-fail for bare/absolute; the relative class keeps the guarantee
- [x] `asm change validate` passes
- [ ] Gate 2: plan approved

## Implement

- [ ] All tasks done (`tasks.md`)
- [ ] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: docs/PLAN.md task WT-011.12`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-011.12
Lane: light
Planned at: c8b8ecc4
Lane: light — S, one new gate script plus wiring | flags: infra
- Adoption is `clean-now` (automated-rule reference): `dist/extension.js` at planning time carries only node builtins and `vscode`, so the rule passes on landing. No baseline, no ratchet.
- Specs are NO-DELTA: a build-time gate changes nothing the shipped extension does.
- Gate 2 taken under fastlane on the standing goal, with the user away.
- The gate was proven against the REAL artifact, not only fixtures: appending `require("./impl/format")` to `dist/extension.js` made it exit 1 naming the path it would have resolved to, and restoring the file returned it to 0. `dist/` is build output and was left byte-identical.
- Round-7 handback replan. The premise audit is the decision: D2's edge-once obligation is not true of the shipped artifact (3555 applications for 3489 pairs) and three rounds failed to discharge it, so it is replaced by a work ceiling that abandons the pass rather than an asymptotic claim. Instrumented counters on `dist/extension.js`: flows 13,823, factVisits 22, argScans 52 — the cubic axis the chair measured is 187,000x removed from what the real bundle does.
- Abandoning the D2 pass is safe because after D6 the failing class no longer depends on it: every relative specifier a require call can carry is a bundle string literal, so the sweep is a superset there and propagation now feeds only warnings § Coverage makes no claim for. Task 8_4 witnesses this rather than asserting it.
Round 3 was opened by an `asm review round-start` run made to read the trajectory; no round-3 review ran. The cycle closes as superseded by the round-2 F002 handback, not by that round.
Handback (round 2 F002): design.md D2 detects a BARE `require` identifier, and the "Known limit" section asserts the shipped defect left a direct literal call. Both are false for the artifact the gate inspects — production esbuild renames the UMD factory's `require` parameter, so the defect ships as `e("./impl/format")`. Reproduced locally with a UMD fixture under `--bundle --platform=node --minify`. D2's mechanism has to change, so this is not remediation.
Verify gate: one unit test failed on the first run and passed on two consecutive re-runs with no intervening edit — the same infra flake seen earlier in this branch, not reproduced on a clean tree.
The gate was also run against the real production artifact, not only fixtures: `node scripts/check-bundle-requires.mjs` exits 0 on the 1 MB `dist/extension.js`, and reports `./impl/format` when the minified UMD shape is appended to that same file.
Round 3 closes cycle 2 as superseded: its four blockers were accepted and handed back rather than fixed in place. F004, F005 and F007 are one defect — the hand-rolled lexical resolver — and D2 now delegates to TypeScript's binder, whose answers were verified against every disputed case first.
Binder cost on the real artifact (round-3 F006): `node scripts/check-bundle-requires.mjs` over the 1 MB dist/extension.js runs in 0.47s wall clock end to end — cheaper than the hand-rolled scope walk it replaces, so the superlinear-growth concern is answered by measurement rather than by argument.
Arm check on that same artifact, all four shapes appended at once: ./umd-minified, ./scalar-alias and ./decl-factory are reported; ./legit-local — a local binding spelled `require` bound to a plain callback — is not, which is F007 closed in the direction that matters.
Verify gate after the round-3 handback: check-types clean, 6756 unit tests pass, biome check at the 3/14/1 baseline, verify-status 0. One unrelated test in src/extension.worktreeAssembly.test.ts failed once under full-suite load and passed 3/3 standalone and on the re-run — the same infra flake recorded above, not reproduced on a clean tree.
Verify gate after the round-4 handback: check-types clean, 6763 unit tests pass, biome at the 3/14/1 baseline, verify-status 0. Sweep arm check on the real artifact: the conditional alias, the .call factory, the constant argument and the object-carried loader are all reported when appended to dist/extension.js, and the unmodified artifact still exits 0.
- Round-5 handback replan. Gate 1 asked the user the one product fork (bare/absolute: delete, warn, or keep failing) because fastlane never auto-chooses a scope cut; the user chose warn-not-fail. Gate 2 taken under the standing goal's grant to replan.
- Plan attack before Gate 2, on frozen artifacts. It REFUTED C1, C2 and C4 and left one unresolved; every finding accepted, none rejected. C2 is the one that mattered: the occurrence-scoped exemption I had just written to replace the refuted value-keyed allowlist was itself unsound — `require("".concat("./x"))` sits in a String.prototype argument position, so the exemption would have hidden it while call detection ignored the outer CallExpression too. Fixed by deleting the exemption mechanism outright rather than refining it: the six bare relative prefixes become a stated limit on six fixed strings, and every other prefixed literal is swept wherever it sits. Measured: still zero survivors on the real artifact.
- C1 refuted D6's scope against the PLAN wording — "a relative `require`" is not "a relative literal", and a `TemplateExpression` with a relative head escapes both mechanisms. That is the UMD-factory shape this change exists to catch, so it gained an owner as D7 rather than being recorded as a limit. Zero relative-headed templates in the real artifact, so it can fail rather than warn.
- C4 caught two witnesses that could not establish their own acceptance: 6_3 asserted a CLI exit code from a unit test against a module that does not decide it (the exit rule is now extracted and witnessed directly), and 6_4 proposed wall-clock timings for an asymptotic claim — the existing timing assertion passed while the fanout was still quadratic, which is the proof that timing cannot witness it. Now a deterministic edge-application count.
- C3 left the retention of D2 unresolved: if nothing consumes a warning, the machinery is dead weight and option A (delete) would be right. Recorded rather than argued away — the consumer is the developer running `pnpm run package` for a release, who sees the gate's output in that terminal, and 6_4's cost work is still owed because the D2 pass runs regardless of the severity it emits. If a future round finds that output is never read, deleting D2 is the honest follow-up.
- Round-6 handback. Three blockers, all mine, and two of them fallout from 6_1 widening detection without widening what consumes it: `classify` kept its own `startsWith(".")` class test (F016) and the new Win32 spellings flowed into a host-native resolver (F017). F006 persisted because my 6_4 fix made only callee-target arrivals incremental, and my witness varied only callee targets — it could not fail on the mixed case it was meant to bound. Gate 2 re-taken under the standing goal.
- F017's mechanism is taken from a sibling rather than invented, per the standing instruction: orca dispatches path flavour on the SPELLING and never on `process.platform` (git-handler.ts:128-134, git-handler-worktree-ops.ts:133-136). Adjusted because resolving through `path.win32` yields win32-shaped paths a POSIX filesystem cannot stat — the Win32 spelling is normalized to its POSIX equivalent instead, so one resolver answers both.
- No round 7 opened. The chair reported the review cap reached; the next review is a new cycle's discovery round after this replan.
