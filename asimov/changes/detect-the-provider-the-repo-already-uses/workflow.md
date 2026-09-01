# Workflow State: detect-the-provider-the-repo-already-uses

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no real fork: § 3.2, § 3.3 and § 4.1 fix the mappings and the order, and the two calls this change did make (a JSONC parser; a switch mechanism § 4.1 leaves unspecified) are recorded as D1 and D5
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
