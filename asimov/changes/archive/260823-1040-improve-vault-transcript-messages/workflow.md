# Workflow State: improve-vault-transcript-messages

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [ ] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [ ] `asm change validate` passes
- [ ] Gate 2: plan approved

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
Lane: full (standard) — user-visible UI spanning readers, IPC and webview, plus a new launch path | flags: none
Gate 1: classify-and-collapse for injected records; handoff-prompt launch for Continue; Markdown+JSON+Raw copy.
Rejected at Gate 1: forking a Claude transcript at a message by writing a truncated file into ~/.claude/projects (exact, but Claude-only and fragile against schema drift).
Six `requirement is long` validator warnings accepted: each is one contract whose length is an enumeration, not fused concerns.
`claude --prefill` does not exist in claude 2.1.239 despite the orca research note — the continue prompt is positional and auto-submits.

Message locator is a WeakMap element→item binding, not the planned `data-msg-index`: a re-rendered run replaces elements, so an index would silently copy the wrong message.
Codex has no per-record id, so `recordLine` addresses by PHYSICAL line and the reader stamps that ordinal non-enumerably while streaming — the head+tail window drops the middle, and a re-serialized record would not match the file's own bytes.
Lint gate run as `npx biome check src/` (check mode); the repo's `lint` script is the `--write --unsafe` auto-fix form. 13 warnings remain, all pre-existing — the 6 in `vaultPanel.css` reproduce identically on a detached HEAD worktree.
Review round 1 is PARTIAL: the chair was stopped mid-run so it would not adjudicate a tree about to change under it. Two specialists had reported (8 findings, all accepted, fixed in 6_3–6_6); there is no chair verdict, so a full round must be re-run before approval.
Continue now carries the entry's captured run settings (model + permission posture), not just the prompt — a continued session was silently dropping to the agent's default permission mode (7_1, user feedback).
6_6's declared Verify was corrected from `unit src/vault/readers/recordLine.test.ts` to the two reader detail suites — the predicates it changes live in the readers, so the original could not exercise its own Outcome.
Review round 2 rejected with 4 BLOCK / 7 WARN / 2 SUGGEST; B1-B4, W1-W7 and S1 accepted for task 10_x, S2 rebutted because continuation presence detection intentionally differs from the memoized OpenCode semver probe.
Session c2e95097-c96a-4d04-905e-ba28876311b6 showed Claude's `interruptedMessageId` record as a user message; task 11_1 classifies it as a notice before re-review.
Review round 3 blocked on B3 and retained W4/W6 plus new W8/W9/S3; all accepted for final tasks 12_1-12_2. S2 was sustained as rejected.
