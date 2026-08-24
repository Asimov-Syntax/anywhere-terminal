# Workflow State: integrate-cursor-agent

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [x] Gate 1: direction approved _(only if a real fork; else `[-]`)_
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

<!-- Blueprint source + lane below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: full (standard) — adds a new coding-agent integration across process launch, session detection, transcript/vault handling, and UI | flags: unresolved-unknown, cross-boundary
Gate 1: Terminal-first hybrid selected — metadata Vault + launch/resume/continue + best-effort hook status/approval; ACP and private transcript decoding deferred.
Discovery: User requested durable comparison of Orca, cmux, and t3code.
Oracle triage: User approved all seven corrections; selected Resume is now proof-gated and hook/cache/lifecycle contracts are pinned.
Handoff authorization: User instructed automatic asimov-build after planning, followed by asimov-review-start with at most three review-fix rounds.
Verification baseline: `pnpm run check-types` has one pre-existing error in untouched `src/webview/vault/markdownLite.ts:80`; task checks must reject any additional TypeScript error.
Final review: Three authorized rounds completed; accepted round-3 findings were fixed and fully verified without opening a fourth review.
User feedback: Cursor must match the existing Vault contract — row activation previews; Resume remains explicit. Both Cursor Agent CLI history and Cursor IDE Composer history are now in scope.
Replan: The accepted metadata-only design was invalidated after structural proof that bounded local CLI `store.db` decoding and IDE `state.vscdb` preview are feasible.
Review cap: User explicitly authorized round 4 and one follow-up review after the two review-fix waves.
Handback: Round-4 B9 conflicts with the installed schema — 13/13 schema-1 `meta.json` files omit `agentId`; proving it requires explicit `store.db` access, which list indexing forbids.
