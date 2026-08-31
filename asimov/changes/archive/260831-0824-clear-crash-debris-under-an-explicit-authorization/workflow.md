# Workflow State: clear-crash-debris-under-an-explicit-authorization

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
- [x] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-012.12
Lane: full (standard) — the one create path that deletes | flags: security-privacy
Planned at: cf4492aa

Gate 1: no fork — `worktree-create.md` § 2.2 already fixes every bound, and WT-012.0 landed the wire
types. Direction auto-chosen under fastlane.
Auto-decision: debris classification replaces `dispositionOf`'s registration proxy rather than being
added beside it — the proxy is wrong for a pruned checkout, which is WT-012.15's, not debris (D1).
Auto-decision: a sibling authorization store rather than generalizing removal's fingerprint store —
no shared comparison logic, and the removal store guards the riskier action (D2).
Auto-decision: the delete site is allowlisted in the I10 gate rather than moved outside its scope —
passing by hiding inverts what the gate is for (D4).

Handback (1_6): the wire has no carrier for a debris authorization. `worktreeCreateResolution`
carries `ResolvedDisposition`, which the previous change deliberately narrowed so a probe answer
holds nothing a delete could be built from, and no other message lets the host issue one — so the
webview cannot populate `DestinationDisposition.debris.authorization`. Tasks 1_1-1_5 are committed
and the host half is complete; 1_6 needs a new host-to-webview carrier, which is a `new-api-contract`
change needing its own D# rather than a fix inside this task.
Gate 2 re-earned at f28549b9 after the 1_6 handback: D6 adds the carrier, the delta gains the
"issued only when asked for" requirement, and 1_6 splits into the wire (1_6) and the dialog (1_7).
Auto-decision: a separate request rather than widening the probe answer — the probe fires on every
settled edit, so a token on it would mint deletes for paths nobody asked to delete (D6).

Auto-decision (1_7): recover is offered only where the create would actually take the skipped
candidate — under `reattach` the create acts on the registration's own path, so that candidate is a
directory this create never touches and offering to delete it would be round-3 B3 with a delete
attached. `worktree-create.md` § 2.0's "composes with any branch mode" holds for every mode whose
destination is the derived one.
Auto-decision (1_7): accepting the offer is what asks for the authorization, so what will be removed
is stated from the entries the token was digested over — one read, so the list shown and the list
bound cannot differ. The offer names the directory before acceptance; the contents after.
Verify gate: `pnpm exec biome check src` is at the inherited baseline (3 errors / 14 warnings /
1 info — `src/agentHooks`, `src/cursor`, `src/vault`, `src/webview/*.css`, `worktreeFormat.ts`), none
in files this change touches. The first `test:unit` run failed one test and a re-run on the same tree
passed 6061/6061 — the known `src/vault/snapshotPool.test.ts` flake, untouched by this change.
Review: 1 cycle, 3 rounds. Round 1 REJECT (7 BLOCK / 2 WARN), round 2 verification (1 BLOCK /
2 WARN), round 3 WARN with 0 blockers — exit condition met, no thrash stop. Every accepted BLOCK
fix is mutation-verified; no finding needed a new or changed `D#`.
Follow-up (round-3 W2, non-gating): issuance is not generation-bound at the host/service boundary,
so a withdrawn request's `issueDebrisAuthorization` can overwrite the store record a newer,
correctly-correlated request already committed. Fails closed — redemption refuses and the dialog
re-prompts — so no unapproved deletion or false success. Binding it mints an ordering owner across
`WorktreeHost` -> `issueDebrisAuthorization` -> `debrisAuthorizations`, so it belongs to its own
change, not a fix commit in this cycle.
