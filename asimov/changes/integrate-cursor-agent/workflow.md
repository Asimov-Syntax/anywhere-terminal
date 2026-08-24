# Workflow State: integrate-cursor-agent

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
Replan decision: User selected explicit Resume/Copy store-identity proof while keeping list indexing metadata-only; unmatched project JSONL stays hidden and is used only for exact CLI mirrors or same-project Agent-ID child detail.
Replan evidence: Cursor parent and child project JSONL share no metadata-level parent marker; the reported saved child `81840b03-aaff-4158-8797-a52cce1ae3d2` resolves in the parent's exact project and normalizes to 2 messages plus 49 tool steps.
Validation: 17 warnings remain only on previously verified tasks; revised pending tasks validate without warnings or lease overlap.
Task 9_9: user walked the Extension Development Host smoke and accepted the UI; residual Cursor data-quality issues are deferred to a follow-up change rather than widening this one.
Verify gate run: type check at the recorded markdownLite baseline, `biome check src/` down from 8 errors at HEAD to 0 (formatting only; 80 style warnings remain, 44 of them `useBlockStatements` in `cursorStore.ts`), unit suite 2806 pass.
Round 5 reopen: all seven findings accepted, none rebutted; wave 11 also folds in the user-reported sub-agent identity defect, so accepted preview behaviour moves and Gate 2 was re-earned on the approved plan file rather than a silent build.
Gate 2 (wave 11): user approved the fix plan directly, including opaque registry-scoped child ids (option B) over readable `project:` ids.
Wave 11 evidence: chat `e02838b2-b235-439c-98ee-1ea72905d4f8` issues five `Task` calls; two carry `resume: 82e87c39-…` with no `subagent_type`, and that agent's own transcript holds all three turns — so per-call cards and the `@Task` label are both artefacts of ignoring `args.resume`.
Wave 11 consequence: an unproven CLI store no longer falls back to its project mirror, and `stats.subagentCount` counts agents rather than invocations; both were presented and accepted at plan approval.
Wave 11 verify gate: type check at the recorded `markdownLite.ts:80` baseline, `biome check src/` 0 errors / 84 style warnings, unit suite 2829 pass; per-card nested expansion replaced the shared per-child state, so two duplicate-card tests now expand each card.
Round 6 triage: B18/W15/S10 accepted, W18 accepted-modified (identity keys, since no per-invocation id may cross the wire), W17 rebutted — a structural census of three real project transcripts shows zero `tool_result` blocks, so mirror correlation has nothing to join.
Wave 12 verify gate: type check at the `markdownLite.ts:80` baseline, `biome check src/` 0 errors / 84 style warnings, unit suite 2837 pass; the nested requestId replaced both the generation counter and the orphan ledger from wave 11.
