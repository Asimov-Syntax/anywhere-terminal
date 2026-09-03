# Workflow State: wait-for-the-git-call-each-assertion-reads

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [ ] All tasks done (`tasks.md`)
- [ ] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: light
Planned at: 08b43f8a

Blueprint: none
Lane: light
Must not: change production code, or weaken an assertion.
Why now: two siblings converted this defect one site at a time (`wait-for-the-prune-the-assertion-reads`, `wait-for-the-repair-the-assertion-reads`), each after the site actually failed a gate. Within one hour a third and a fourth site failed the same way — `:2896` then `:2977` — each blocking an unrelated change's verify. Converting one site per failure does not converge, so the whole class is converted at once here. The qualifying evidence is the class's, not each site's: `settle()` returns on DOM and argv quiescence, and the host crosses several awaits before it issues git, so every wait immediately followed by an argv or launch assertion is the same defect whether or not it has flaked yet.
Scope: only waits immediately followed by an assertion reading `argv` or `launched`. A wait followed by a NEGATIVE assertion (`expect(launched).toEqual([])`) is deliberately left bare — no condition exists to wait for, and converting it would be the weakening this Boundary forbids.

Inventory correction: the first pass claimed nine conversions and had converted eight; the second opinion counted the diff and found the `lock` and `unlock` waits at `:1166` and `:1174` still bare though they qualify. Ten sites are converted now.
Own regression, caught by this task's own verify: waiting on `gitCalls("add")` at `:1471` returned BEFORE the launch the same test asserts on, so the launch landed inside the next test and failed it on the previous test's entry. `settleUntil` returns the moment its predicate holds, so the predicate must be the LAST observable a test's assertions read, not the first. Two predicates are compound for that reason (`:1477` add-and-launch, `:3000` repair-and-reported-outcome).
Follow-up, not fixed here: `src/worktree/deleteBranch.test.ts:187` creates a real repository and runs many synchronous git processes on vitest's default 5 s per-test timeout, while `gitCommandRunner` allows any single command 10 s (`gitCommandRunner.ts:9-10`). It timed out on two consecutive verifies of this task and is green on a clean tree at HEAD and twice on this tree outside `verify-task`; no code, module-state, git-lock, or temp-path mechanism connects it to this diff. The smallest honest fix is a ~15 s timeout on that one test, above the runner's own bound — it belongs to whoever owns that file, not to this lease.
