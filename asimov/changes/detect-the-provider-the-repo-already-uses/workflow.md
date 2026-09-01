# Workflow State: detect-the-provider-the-repo-already-uses

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no real fork: § 3.2, § 3.3 and § 4.1 fix the mappings and the order, and the two calls this change did make (a JSONC parser; a switch mechanism § 4.1 leaves unspecified) are recorded as D1 and D5
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

Blueprint: docs/PLAN.md task WT-012.3
Lane: full (standard) — MEDIUM risk: three untrusted checked-in files parsed into text a later task
hands to a shell | flags: user-visible-ui, new-dependency, new-api-contract
Planned at: ec0f777e
- Two escalation flags added beyond PLAN's `user-visible-ui`: `new-dependency` (`jsonc-parser` is the
  change's only new runtime dep, taking the extension from two to three) and `new-api-contract`
  (`worktreeProvisionSwitch` is a new wire message, and `ProvisionProvider.file` becomes `files[]`).
- Admission screen, re-run after discovery: ONE new invariant owner — which provider file supplies
  the model and what becomes of the others. The two adapters are pure functions behind one seam, not
  owners, and the switch reuses the offer machinery WT-012.1 already owns. No split proposed.
- Scope held to the Design Ref: `.vscode/worktree.json`, `extends` and the merge rule are WT-012.4's,
  and D3's `DETECTION_ORDER` is a single array WT-012.4 inserts into.
- `worktree-provisioning.md` § 3.3 defers argument quoting to "§ 2.4", and that document HAS no
  § 2.4 — § 2 carries no subsections and states no quoting rule. D4 fills the gap; the dangling
  reference goes to blueprint sync.
- FOR BLUEPRINT SYNC, two corrections to `docs/design/worktree-provisioning.md`: § 3.2's "split on
  newlines" for orca's `scripts.setup` is wrong (D7 — a block scalar is one shell program, and orca
  itself runs it as one), and § 2's `ProvisionProvider.file` cannot name orca's two files (D8).

Plan attack (`asm-oracle`) before Gate 2, on artifacts frozen until it returned. It REFUTED two
ledger rows and left two unresolved; every finding was accepted and none rejected. What changed:

- REFUTED, the scan budget. `scanNames` allocates its counter per glob, so `a/*.md` and `b/*.md`
  over two directories of 2,001 non-matching names each scan ~4,002 names while emitting NO rows —
  the row cap never engages, because nothing matched. The first draft asserted a global bound that
  did not exist. D9 splits rows and scanned names into two accounts, both shared across every source.
- REFUTED, command injection. D4 quoted `args` and left `command` verbatim. A VS Code `type:
  "process"` task runs with no shell, so `./bin/build; touch /tmp/x` is a legal literal executable
  name there — and rendering it verbatim into text WT-012.11 hands to `sh -c` turns one safe task
  into two commands. D4 now quotes the command unless the entry declares itself `type: "shell"`.
- WRONG, the extraction. `problem()` and `entriesFor` stamp `ASIMOV_PROVIDER_FILE` into every problem
  and every entry, so "move them unchanged" would have made orca rows claim they came from
  `asimov/worktree.yaml` — with the whole Asimov suite still green, because that is what it asserts.
  D2 now passes a `ProviderContext`, and the task's acceptance is the kit's own non-Asimov tests;
  the unedited Asimov suite is the regression half only.
- WRONG, D5's "unchanged". The host admits one provisioning read per (repo, opening) and holds that
  marker until retirement, so a same-opening switch either joins a finished read or clears the very
  marker that stops duplicates. Clearing it without a new identity lets two switches answer out of
  order and the EARLIER choice overwrite the later one. D5 now carries a dialog-minted `switch`
  sequence with latest-wins, and 3_2 owns it separately from the webview half.
- WRONG, orca's setup. § 3.2's line-splitting turns `if [ -f package.json ]; then / pnpm install /
  fi` into three steps, two of which are syntax errors alone. D7 keeps the block as one step.
- Two ledger rows left UNRESOLVED and now closed: the safe-open sequence was not in the extraction
  (D2 takes it), and "nothing executes" rested on capability-absence in an injected interface, which
  constrains what is passed and not what a module may import — task 3_5 is the witness.
- Task 3_2's Verify covered a third of its own Plan: a dialog-only run passes while the host never
  re-resolves. Split into 3_2 (host lifecycle) and 3_3 (webview), each gated on its own layer.

Build notes:

- 1_2 needed `asimovProvider.ts` in its lease and 2_1 needed `providerKit.ts`: a charged row account
  is only correct if every append goes through it, and the first adapter to need `ProviderAdapter`
  is the one that declares it. Plan paths updated, acceptance untouched.
- `readProvisioning` skips a losing adapter's `read` and probes its files for presence instead.
  D3 only needs presence, and building rows for a section nobody is shown would spend the shared
  scan account on nothing.
- Two 3_2 mutants survive: dropping the opening re-check inside the switch read, and dropping the
  opening from the ceiling key. `retireOpening`'s sweep independently catches both, so neither is
  isolated by the suite. Written into the source rather than papered over — the same overlap
  `provisionReading` already documents.
- The assembly suite's `REPO` outlives a test, so 3_4's walks clear the provider files first;
  detection is about which files exist, and a leftover from another walk decides it silently.

Round 1 remediation:

- All seven findings accepted, none rebutted. Three BLOCKs were re-verified against the source
  before triage rather than taken on the chair's word, and F001 went further than the report:
  releasing the switch ceiling is not merely unsafe, it is unnecessary, because the dialog's
  sequence only ever increases.
- 4_1 carries all seven and `validate` warns it names ten files. Kept as ONE task: the fixes share
  `providerKit.ts` and the three adapters, so separate entries would lease the same files, and each
  extra entry costs a review round the split buys nothing back.
- F002 is the interesting one. 1_2's own comment says "every append is charged, so the count cannot
  drift from the collections it claims to bound" — and the appends charged without ever refusing.
  Enforcement moves inside the append API so the comment becomes true.
- One 4_1 mutant survives: dropping the `break` from the VS Code task loop. With enforcement in the
  append, the model is identical either way — the break bounds wasted iterations over
  repository-controlled input, not the rows. Kept and said so rather than writing a test that
  asserts an implementation detail.
- F005's fix moved a message. A glob refused before its `readdir` now says it is past the scan
  budget instead of naming a directory too large to scan, because nothing measured that directory.
  1_2's assertion was updated for that reason and declared with `--test-change`.

Round 2 (cycle 2, discovery) — WARN, 0 blockers. All seven round-1 findings confirmed fixed, and
the disclosed `break` mutant was ruled not a finding: provider input is capped at 256 KiB and the
load-bearing output bound is enforced by `addRow`.

- F008 accepted, and the CLAIM was fixed rather than the wording narrowed. 4_1's Outcome said every
  finding had a witness that fails before the fix, which was untrue of F004 and F007 — a duplicate
  produces the same output, so the D4 assertions passed while the duplicate existed. That is why
  duplication is dangerous and why a behavioural test cannot see it. 4_2 adds the structural
  witnesses instead, confirmed failing against the round-1 source state before being committed.
- F009 accepted as a FOLLOW-UP, not remediation. Now that every adapter answers `null` for an
  unresolvable root, the dispatcher returns `emptyModel()` and the root diagnostic is dropped, so an
  uninspectable checkout looks like an unconfigured one. Carrying it needs an owner for "no provider
  elected, and here is why" — a new invariant owner, past the remediation boundary, and landing it
  as a fix would supersede this cycle. NEEDS ITS OWN PLAN TASK.

Follow-ups for the blueprint, needing their own PLAN tasks (not done here):
- F009 above.
- rpc § 2.4's two missing halves: re-presenting a fresh model after a stale offer, and detecting
  provider files that change under a still-held offer.

