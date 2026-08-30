# Workflow State: reuse-a-snapshot-while-the-store-is-unchanged

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(no fork: stamp-gated reuse is the only option that keeps `absent` honest)_
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
Lane: full
Planned at: 4e401984
Flags: security-privacy (a stale reuse would surface as a false `absent`, deleting a live row's preview)
Origin: round-1 W2 of `snapshot-a-live-store-atomically`, which is blocked from archiving until this lands. Measured there: 522 MB store, 951 ms engine snapshot vs 5 ms APFS clone (~190x), ~2.5 s projected for the known 1.4 GB OpenCode store.
Reuse-first: `storeStamp.ts` (`stampStoreFiles`/`sameStamps`) is the shipped invalidation key the list cache already trusts — adopted rather than reinvented, including its documented exclusion of `-shm`.
Validate warning triaged: the requirement is long (933 chars) because the reuse clause and the atomicity clause it depends on are one contract; splitting them would separate a rule from its precondition.

