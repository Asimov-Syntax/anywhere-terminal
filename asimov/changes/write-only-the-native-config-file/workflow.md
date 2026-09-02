# Workflow State: write-only-the-native-config-file

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [ ] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [ ] `asm change validate` passes
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

Blueprint: docs/PLAN.md task WT-012.5
Lane: full (standard) — MEDIUM-HIGH risk: the first control that writes a checked-in file,
sitting beside files that must stay byte-identical | flags: user-visible-ui, new-api-contract
Planned at: a82ccc85
- Admission screen: ONE new invariant owner — the writer of `.vscode/worktree.json`. The dialog
  control and the wire message are surfaces on it, and all five PLAN acceptance clauses are
  properties of the same write. One acceptance story, so no split at Size M.
- No Gate 1 fork. The blueprint gives `[Configure...]` one sentence (§ 6) and no UI shape, so the
  shape was taken from what the shipped form can already express. The alternative — a separate
  editor for the native file — admits capability this task was not asked for, which fastlane may
  not auto-choose. Recorded as D6.
- Reuse taken rather than built: `LockedFile` (`src/agentHooks/install/lockedJsonFile.ts`) for the
  lock-temp-rename discipline, `jsonc-parser`'s `modify`/`applyEdits` for comment preservation,
  `offerStore` for id resolution, and the `worktreeProvisionSwitch` publish path for the re-offer.
- Knowledge candidate: `readOnly.test.ts` is a completeness gate, not only a deny-list — a new
  module anywhere in `src/worktree/provisioning/` fails the suite until it is declared in
  READ_PATH or NOT_READ_PATH. | Surprise: expected the writer to be barred from the directory; it
  is admitted, provided it declares itself. | Evidence:
  src/worktree/provisioning/readOnly.test.ts "names every module of the read path" | Consumer:
  plan | Action: any change adding a module there budgets the declaration as a build step.
- Scaffold trap, hit twice today: `change new` writes a literal `Blueprint: none` Notes line, and
  the archive preflight reads the FIRST `Blueprint:` line in the file. Leaving it above the real
  one made WT-012.4's archive refuse. Replaced in place rather than appended.
- Plan attack (`asm-oracle`) ran on frozen artifacts and returned EIGHT findings, four of them
  blockers. Every one accepted, none rejected. Three ledger rows I had written `supported` came back
  `refuted` or `unresolved`. What changed:
- REFUTED, D6's "only two divergences are reachable". False of the shipped form: ports render ticked
  and ARE untickable, setup steps are tickable, and native inline entries are untickable
  (`WorktreeCreateDialog.ts:502-540`). Three user-expressible states were being discarded in
  silence. D6 now records what the native file can express — inherited entry to `exclude`, native
  inline entry removed from `copy`/`link`, source to `extends` — and STATES the two it cannot.
  Setup steps are refused on a safety ground rather than an expressiveness one: § 7 makes the
  unticked box the rule, and a saved preference is a pre-ticked box next time.
- REFUTED, D7's containment. The oracle reproduced the bypass on this host: check the parent, swap
  `.vscode` for a symlink pointing outside the repository, and `LockedFile` created the file
  outside. The parent is now resolved ONCE and every later operation names the resolved path, and a
  symlinked target — which the parent check never covered at all — is refused.
- REFUTED, a first `extends` having a file to name. `ProvisionProvider.files` is the adapter's
  DECLARED list, not a finding, and orca is one provider over two independently optional files. A
  repository carrying only `.worktreeinclude` would have been given `extends: "orca.yaml"`, which
  the read side then reports as `missingExtends` — the save breaking the thing it recorded.
  Deriving from an entry's `source` fails on a present-but-empty file. D11 adds `present` to the
  wire type, which is why `new-api-contract` is now on the Lane line.
- REFUTED, D3 twice. `atomicReplace(text, undefined)` stages at `0o600` and the rename makes that
  inode the file — probed, a `0644` configuration came back `0600`. And the lock covered only the
  commit, so two saves that both read first produce serialized renames and a lost update. The lock
  now spans the whole read-modify-write and the existing mode is read and passed.
- REFUTED, D4's "by construction". Against the pinned 3.3.1 a trailing comment MOVES to the element
  inserted after it, a malformed document is mutated and left malformed, and a non-array `exclude`
  throws. Only the outside-the-span property is claimed now, its witness compares against spans
  obtained independently from `modify` so an implementation cannot nominate a whole-file span, and
  a document that does not parse or carries a wrong-shaped key is refused unwritten.
- REFUTED, D8. The save carried no `opening` and no sequence, so a save begun against offer A could
  finish after a switch to B published and overwrite the later visible choice. It now enters the
  same gate the switch obeys, checked before the write and again before the publish.
- REFUTED, task 1_4 (now 1_5). `WorktreeCreateDialog` does not post anything — `WorktreeController.
  createDialogDeps` owns the wire. The dialog test would have passed with nothing wired in
  production. The controller and its test are in the lease.
- UNRESOLVED, now closed: `repoId` is itself a path, so the root is taken from
  `cache.read().repos` and the message's string only selects a record; and the failure matrix
  covered only the existing-file rename branch, not `create`.
- D9 narrowed by the same attack: `LockedFile` returns the same `undefined` for a held lock and an
  uncreatable directory, so there is one `unavailable` reason rather than a `locked` that would be
  a guess.
