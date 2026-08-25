# Workflow State: unify-vault-detail-contract

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [x] Review done _(user-initiated; `[-]` + reason if skipped)_
- [x] Gate: implementation approved
- [-] Blueprint sync complete — no blueprint for this change

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source + lane below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: full (standard), class: refactor — spans vault readers, VaultService and the webview preview | flags: cross-boundary
Gate 1 skipped: direction settled by two rounds of independent review before planning; scope confirmed by the requester. Evidence and rejected alternatives live in discovery.md.
Renderer unification, the original request, is a no-op: the timeline renderer is already agent-neutral. Recorded here because the change id no longer reads that way.
Unblocked: the load-more defect fix landed as de9f995 (archived at asimov/changes/archive/260825-0319-separate-detail-completeness-signals/). All artifacts re-verified against that commit — eleven finalizeDetail call sites, three surviving metadata-only literals, OpenCode reading through one withSqliteSnapshot with an existence probe rather than readSqliteFn. Its two-axis rule is now a base spec requirement, so design.md cites it instead of restating it.
Specs are not NO-DELTA despite the refactor class: making contentKind required is a real external contract addition, so it carries one delta.
Unresolved: one full-suite run during 2_1's verify reported a single failure (1 of 2890) and did not name it in retained output. Not reproduced in 17 further runs on this tree nor 6 on a clean HEAD worktree, so it is neither attributed to this change nor cleared. If it recurs, capture the test name before treating any 2_1 evidence as settled.
Task 1_1's suite-change record names src/vault/readers/opencodeReader.detail.test.ts, which this change never edited: a concurrent session left its own round-4 fixture fix uncommitted in the tree while 1_1 was mid-flight. It is now its own commit (d9156cd), and only the detail.test.ts half is this change's.
Review round 1: 0 BLOCK, 2 WARN, both accepted and fixed as task 3_1; no finding rebutted, so no re-review round was needed to adjudicate one. Master session id for a future round: a7595505460065897.
W2's tightened assertion was initially unexercised — mutating `limitedDetail` to emit `truncated: false` passed the whole suite, because the two Cursor limited-path tests deep-equal against `limitedDetail` itself and move with it. Fixed by routing both metadata-only details through `expectDetailContract`, which is a plain statement of the contract rather than a comparison against the constructor.
Verify gate lint: `pnpm run lint` is `biome check --write --unsafe src/`, an auto-fix form, so the gate ran `biome check src/` — the same rule set in check mode. It exits 0 with the 13 warnings a clean HEAD worktree also reports, and no errors. The six errors the gate first found were this change's own import order and formatting; they were fixed with safe fixes only (no `--unsafe`) before the gate was observed.
Deferred, offered at Gate 2 and not taken into scope: renaming cursorTranscript's and the cursorIde composer's `truncated` field (source omission) so it stops colliding with VaultSessionDetail.truncated (pageability) one assignment apart at cursorReader.ts:712 and cursorIdeReader.ts:517. Correct today; same family of trap as the bug just fixed, but outside this change's lease.
Deferred, larger payoff than this change: extract the shared safe-I/O primitives (bounded read, containment check, safe-id validation) the four readers repeat across ~600 lines. Needs its own change and its own security review.
