# Workflow State: assemble-one-config-from-several-files

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [-] Gate 1: direction approved — no real fork: § 3.4, § 4.1 and § 4.2 fix the format, the order and the merge; the calls this change made are D2's three resolution rules and D5's native preference _(only if a real fork; else `[-]`)_
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
Blueprint: docs/PLAN.md task WT-012.4
Lane: full (standard) — MEDIUM risk: two untrusted checked-in files combined into one model a
later task hands to a shell | flags: new-api-contract, user-visible-ui
Planned at: 49c4365e2bf1e80aba18ab4186eea3e1bd9f9200
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
