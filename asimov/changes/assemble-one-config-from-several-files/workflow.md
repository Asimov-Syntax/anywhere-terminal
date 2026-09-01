# Workflow State: assemble-one-config-from-several-files

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no real fork: § 3.4, § 4.1 and § 4.2 fix the format, the order and the merge; the calls this change made are D2's three resolution rules and D5's native preference _(only if a real fork; else `[-]`)_
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

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Blueprint: docs/PLAN.md task WT-012.4
Lane: full (standard) — MEDIUM risk: two untrusted checked-in files combined into one model a
later task hands to a shell | flags: new-api-contract, user-visible-ui
Planned at: b0552e78 (re-earned for task 4_1; originally 49c4365e)
- Admission screen: ONE new invariant owner — the merge (extends resolution, native-wins dedupe,
  exclude, provenance). The native file is a FOURTH instance of the shipped `ProviderAdapter`
  pattern, and the dialog's excluded rendering extends an owner WT-012.1 already has. One
  acceptance story, so no split despite Size L.
- FOR BLUEPRINT SYNC, two corrections. § 4.2's literal build order ("start with the extended
  model") starves the native file's own entries under the shared row cap, which defeats the very
  rule that the native entry wins — D3 builds native-first and assembles in § 4.2's order.
  And `worktree-create.md` § 4.3's "mixed provenance is click-to-expand" describes a
  one-row-per-KIND section; the shipped one is one row per ITEM and each row already names its own
  file, so there is nothing collapsed to expand (D6).
- Round-2 F009 of the previous change (the discarded root-failure diagnostic) is NOT folded in: it
  needs an owner for "no provider elected, and here is why" and appears in none of WT-012.4's
  eight acceptance clauses. Follow-up PLAN task.

Plan attack (`asm-oracle`) before Gate 2, on artifacts frozen until it returned. It REFUTED six
claims and left three unresolved; every finding was accepted and none rejected. What changed:

- REFUTED, the budget. Three paths in `asimovProvider.fromOpened` return `problems: [problem(...)]`
  as a raw array and charge nothing. One adapter per read made that harmless; two do not — a native
  draft at exactly the cap plus a malformed inherited file yields a 201st row. D9 routes every
  early return through `report()`, and 2_3 owns it.
- REFUTED, `extends` by adapter membership. `"extends": "orca.yaml"` in a repository carrying only
  `.worktreeinclude` selected orca, got a non-null model, and inherited a file the user never named
  — with no `missingExtends` anywhere. D2 now checks the NAMED FILE's presence before asking the
  adapter for anything.
- REFUTED, self-extension. `"extends": ".vscode/worktree.json"` selected the native adapter itself:
  a recursive resolver loops, a one-level resolver merges the file with itself and duplicates its
  ports and setup steps. § 3.4 already said 3.1–3.3, which excludes the native file — my D2 was
  looser than the blueprint it cites. Framework adapters only.
- REFUTED, "the native entry always wins". Native-first does not save an overlap declared past row
  199 of the native file's OWN list: the cap refuses it and the inherited copy too, so zero rows are
  offered for that path. The ledger row is narrowed to an admitted native entry and the zero-row
  case is a documented, tested outcome rather than a surprise.
- REFUTED, D3 "preserves the outcome". It does not. Scan and row accounts are consumed in build
  order, so a native glob eating all 2,000 names leaves an inherited glob refused where base-first
  would have matched. That IS the intent — the repository's own file outranks what it inherits —
  but it is a change in output, not a wash. Problem order is now chosen explicitly instead of
  falling out of build order.
- REFUTED, 1_2's "suites pass unedited". `orcaProvider.test.ts` and `vscodeTasksProvider.test.ts`
  consume `read()` as a model and must unwrap it. Declared as a suite change instead of promised
  away. Also unified the field name: `extends` everywhere, after an earlier draft called it `base`.
- REFUTED, D6 "satisfied by construction". The shipped UI does not satisfy § 4.3's expand rule — it
  makes it unnecessary. Reworded to supersession. The oracle independently confirmed expansion is
  in no PLAN acceptance clause, so nothing accepted is being cut.
- UNRESOLVED, now closed: `prefer: "native"` was undefined, and answering alone would have returned
  the native inline rows without the base they declare — the way back would not lead back (D5).
  The base/native/exclude triple had no stated expected model (D10). And four PLAN acceptance
  clauses had no task-level gate, which is what task 2_3 now is.

Build notes:

- `src/extension.worktreeAssembly.test.ts` is FLAKY under the full-suite run and this change did not
  cause it: a detached probe worktree at HEAD reproduces it without any of this change's edits, and
  the suite passes 3/3 in isolation (52 tests). It fails only inside `test:unit`, so it is cross-file
  interference under concurrency. It cost 1_1 two verify attempts. Worth its own PLAN task; it is on
  the critical path for every remaining task here.
- And it is not one suite. 1_2's first verify failed in `src/webview/vault/VaultPanel.test.ts`
  instead ("no nested detail request for cursor:project:bucket:child-1"), which this change does not
  touch either. Two unrelated suites flaking under the same runner is the concurrency itself, not
  either suite's logic — so the follow-up task is about how `test:unit` is scheduled, not about
  fixing one file.
- Verify gate: check-types clean, `pnpm exec biome check src` at the recorded 3/14/1 baseline with
  none of the three errors in a file this change touched, `pnpm run gate:fs-deletion` ok,
  `pnpm run test:unit` 279 files / 6544 tests green. The `test:unit` flakiness noted above did not
  reproduce on any of tasks 2_1 through 3_2.

Round 2 superseded, and it was my error, not the chair's. Round 1's four findings were all fixed
inside the accepted contract — the chair confirmed no `D#` changed — but the remediation was given
its own `tasks.md` entry (4_1), and a NEW task entry supersedes a verification round on its own: a
verification range must start at the prior round's recorded Head, and a fix-task scaffold authored in
response to that round always lands after it. There is no range that excludes it.

The entry was never necessary. The fix loop needs the discipline — lease, RED, GREEN, `verify-task`,
commit — not a new row in `tasks.md`, and 4_1's fixes all fell inside paths approved tasks already
owned. Gate 2 is re-earned here for the entry that now exists; the next round is cycle 2's DISCOVERY
round, which is not blocked by an amendment in its range.

BLOCKED after round 3 (cycle 2, final automatic round): F001 case-equivalent path identity and F002
the authorized `extends` snapshot behind a second containment check. Both accepted, both reproduced,
and both now need amended decisions rather than remediation — F002's fix changes `ProviderAdapter.read`,
which is D1. Round 4 needs an explicit user grant. Do not archive.

Round-3 handback executed (thrash-stop option 1, the only one needing no user grant — it cuts no
scope, admits nothing speculative and accepts no risk, so fastlane may choose it). D1 amended and
D11 added, Gate 2 re-earned, tasks 5_1 and 5_2 added. This does NOT reopen the review: round 3 was
the final automatic round and round 4 still needs an explicit user grant. The change must not
archive. The work is done so that a granted round 4 has something to review.

Round-3 handback complete: 5_1 (6faf842b) and 5_2 (8f9e22b7) built, verified, and committed; Verify
Gate re-run clean on the whole tree (types, fs-deletion gate, biome at the 3/14/1 baseline, 6556
unit tests). Both round-3 blockers now have witnesses that were confirmed failing against the prior
mechanism — 5_1's against round 1's own `readFile` pin, not merely against no fix. The change stops
here: `Review done` and every gate after it stay unticked, because round 4 is the user's to grant.

Round-4 handback. F005 (BLOCK) crosses the remediation boundary: D11 states the fold probe as an
existence check, and telling a folding volume from two genuinely distinct files needs resolved
IDENTITY, which the sentence does not permit and which `lstat`'s `unknown` return type cannot
express. D11's mechanism paragraph and its ledger row are amended; Gate 2 is re-earned before build.
F006 rides along — the conservative no-hook default is exactly the witness the amended mechanism
needs, and round 4 proved it reachable against a comment of mine that said otherwise.

The obvious repair for F005 — resolve both spellings and compare — was ATTACKED BY THE ORACLE BEFORE
IT WAS BUILT, and refuted with three witnesses run on this host: a case-toggled symlink makes any
single-file probe answer "insensitive" on a volume that folds nothing; case sensitivity is a
per-volume and, on Windows, per-directory attribute, so one repository-wide boolean is the wrong
SHAPE; and `toLowerCase` is not the volume's fold even when the answer is right (`Straße`/`STRASSE`).
D11 now puts the question to the filesystem about the paths actually being merged and folds nothing
itself. Third attempt at this invariant, which is why it was attacked before landing rather than after.

6_1's `--test-change` record names six files and +53 assertions, wider than the task: the tree stamp
it diffs from predates WT-012.2's round-5 commits, which landed test edits on this same branch in
between. The task itself touched `readProvisioning.test.ts` alone. Same artefact as 4_4's record.
Verify gate re-run after the handback: check-types clean, biome 3 errors / 14 warnings / 1 info
(baseline), 6599 tests pass.

Round-5 handback, and the last one this change makes on D11. Five mechanisms were refuted, the last
two before they were built. The goal's instruction to consult orca/cmux/t3code is what settled it:
`orca/src/relay/git-handler-worktree-ops.ts:140-146` and
`t3code/apps/mobile/src/features/files/filePath.ts:80-82` independently ship the same answer — fold
case on the PLATFORM's path semantics and never probe a volume — and this repository already made
that call for the lockfile rule in `entryGate.ts`. D11 takes it, shares the predicate rather than
spelling it twice, and records the volume-level question as its own change. That reopens round-3 F001
as a visible residual and closes round-5 F009, F010 and F011 by construction, since the identity path
stops touching the filesystem entirely.

Verify gate after 7_1: check-types clean, biome 3 errors / 14 warnings / 1 info (baseline, restored
by hand — the fold predicate's default argument and three import orders regressed it and were fixed
without `--write`), I10 gate ok, 6596 tests pass.

FOLLOW-UP, not closed here and owed a PLAN task of its own: "two declarations name one destination
slot on a volume that folds names". Five mechanisms refuted across rounds 3-5 plus two pre-build
oracle attacks; the invariant needs a no-follow canonical-directory-entry-name primitive that Node
does not expose, which is a different owner and a different acceptance story. This change ships the
platform reading and records the residual.
