# Workflow State: fail-a-build-whose-bundle-cannot-resolve-itself

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no fork; the PLAN row fixes the artifact-not-sources constraint and the repo already has the gate idiom
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

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
Round 3 was opened by an `asm review round-start` run made to read the trajectory; no round-3 review ran. The cycle closes as superseded by the round-2 F002 handback, not by that round.
Handback (round 2 F002): design.md D2 detects a BARE `require` identifier, and the "Known limit" section asserts the shipped defect left a direct literal call. Both are false for the artifact the gate inspects — production esbuild renames the UMD factory's `require` parameter, so the defect ships as `e("./impl/format")`. Reproduced locally with a UMD fixture under `--bundle --platform=node --minify`. D2's mechanism has to change, so this is not remediation.
Verify gate: one unit test failed on the first run and passed on two consecutive re-runs with no intervening edit — the same infra flake seen earlier in this branch, not reproduced on a clean tree.
The gate was also run against the real production artifact, not only fixtures: `node scripts/check-bundle-requires.mjs` exits 0 on the 1 MB `dist/extension.js`, and reports `./impl/format` when the minified UMD shape is appended to that same file.
Round 3 closes cycle 2 as superseded: its four blockers were accepted and handed back rather than fixed in place. F004, F005 and F007 are one defect — the hand-rolled lexical resolver — and D2 now delegates to TypeScript's binder, whose answers were verified against every disputed case first.
Binder cost on the real artifact (round-3 F006): `node scripts/check-bundle-requires.mjs` over the 1 MB dist/extension.js runs in 0.47s wall clock end to end — cheaper than the hand-rolled scope walk it replaces, so the superlinear-growth concern is answered by measurement rather than by argument.
Arm check on that same artifact, all four shapes appended at once: ./umd-minified, ./scalar-alias and ./decl-factory are reported; ./legit-local — a local binding spelled `require` bound to a plain callback — is not, which is F007 closed in the direction that matters.
Verify gate after the round-3 handback: check-types clean, 6756 unit tests pass, biome check at the 3/14/1 baseline, verify-status 0. One unrelated test in src/extension.worktreeAssembly.test.ts failed once under full-suite load and passed 3/3 standalone and on the re-run — the same infra flake recorded above, not reproduced on a clean tree.
