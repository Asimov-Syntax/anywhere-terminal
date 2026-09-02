# Workflow State: write-only-the-native-config-file

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [ ] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [ ] `asm change validate` passes
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
- CORRECTION to 1_3's `--test-change` record, which is immutable once written. It claims `git diff -w`
  on the three re-wrapped test files is empty. It is not: `biome format` adds a trailing comma when it
  breaks a literal across lines, and `-w` does not ignore commas. The claim the record was making is
  nonetheless true, and this is the check that establishes it — stripping whitespace AND commas, all
  three files hash identically to their committed versions, so no assertion in them changed.
- 1_3 corrected while 1_4 was being wired, and the defect was mine rather than the design's. Its
  `extends` rule emitted a base only for a provider that is NOT active — but a switch re-reads with
  that provider preferred, so the source the user took is `active` in the model they are looking at
  when they press Configure. A save straight after a switch would have recorded nothing, which is the
  one acceptance clause the switch exists to satisfy. D6's table never carried the clause; tasks.md
  step 1_3.2 and the code did. The rule is now: the named source, or the active one when none is
  named, never the native file (self-extension, § 3.4), and never a `present` that is empty. What
  makes an unchanged base a no-op is the writer's idempotence (D10), not a guess in this function.
- The corrected test replaced an assertion that PINNED the wrong rule, so the suite would have kept
  passing over the defect. Re-arming with the old predicate fails two cases; `verify-task` refuses a
  task already ticked, so 1_3's evidence stamp predates this fix and 1_4's full-suite run is what
  carries it. Recorded here because the stamp cannot say it.
- 1_5 removed `provider` from the save message rather than sending it. D1 enumerates what a save
  carries and a source is not on it: the named offer already records which provider was active, so a
  wire field beside it is a second answer free to disagree with the offer the user is looking at. It
  was worse than redundant — the host threaded it into the post-write re-read, which would have
  re-resolved the extended source instead of the native file just written. `divergenceOf` now reads
  `active` and takes two arguments.
- Arm-checked at 1_5: breaking the controller's `postMessage` leaves every dialog test green and
  fails only the two controller cases. That is the oracle's finding #8 reproduced, and the reason
  those two drive the shipped button through the real `createDialogDeps` rather than calling
  `onProvisionSave` by hand.
- zsh does not word-split unquoted variables. A verification helper written as
  `run(){ vitest $FILES }` passes the whole list as ONE filename, matches nothing, and prints a
  clean-looking `filter:` line with no failures. Four arm-checks read as green before this was
  caught; re-run with the paths inline, all four bite.
- Review cycle 1 / round 1 returned BLOCK: 2 blockers, 10 warnings, 5 suggestions. All 17 accepted,
  none rebutted, plus one author-raised blocker (A1) the chair did not report. Triage is in
  `.reviews/round-1.md`.
- HANDBACK rather than a fix loop. Thirteen of the eighteen are remediation and could land as fix
  commits today. FOUR cannot, and the obligation test is what separates them: F002 and F008 both
  need a refusal this system has no word for — D9 enumerates `unavailable | outside | malformed |
  unwritable`, `ProvisionProblem.reason` enumerates five values that all describe a READ failing,
  and every one of them lies about a source file that went away or a write that was refused. F006
  asks what Configure MEANS when nothing diverges, which D6's table and D10's idempotence answer
  differently. A1 asks what the form may offer while a switch is outstanding, which D8 does not
  speak to at all. Each mints or moves a decision, so plan re-earns Gate 2 before build resumes.
- The cycle closes as superseded. Round numbering is global to this change and does not reset.
- The chair confirmed sound what I had built to be sound: the D8 host gate byte-identical to the
  switch handler, `present` filled at every construction site, complete message registration across
  all four lists, no webview string reaching a filesystem destination, permission preservation. The
  blockers are in the seams between those, not in them.
- Plan attack 2 refuted SEVEN ledger rows and the wave shape. Three refutations share one root:
  `LockedFile` serializes an inode while every other operation names a string, so a rename-plus-symlink
  at the resolved spelling redirects the lock, the temporary, the read and the commit — and `withLock`
  creates the lock BEFORE its callback, so no re-assertion inside it helps. `/dev/fd/<dirfd>/child` is
  not usable on this host. That needs `openat`/`mkdirat`/`renameat` anchored to a directory descriptor.
- FOLLOW-UP OWED, needs a PLAN task I did not create: a change owning descriptor-anchored file writing
  for every `LockedFile` caller, which this change should then depend on. D16 scopes the adversarial
  parent-swap race OUT of WT-012.5 rather than claiming a close this module cannot implement, which is
  what makes wave 2 buildable now. I did not add the PLAN task myself — PLAN.md structure is the
  blueprint's to own and I have permission only for my own task's Status row.
- I told the user mid-session that injecting `mkdir` through `LockedFileDependencies` made D7
  implementable. It does not: the lock file is created before the callback, and a second swap remains
  possible before `readFile`/`link`/`rename`. Corrected to the user and superseded by D16.
- D4 narrowed on evidence rather than restated: insertion preserves interior comments, deletion does
  not — deleting index 1 of `/* A */ "a", /* B */ "b", /* C */ "c"` yields `/* B */ "c"`, taking a KEPT
  element's comment. And removals must be applied in DESCENDING index order; my own probe showed
  ascending original indices `1` then `2` over `[a,b,c,d]` removing `b` and `d`.
- D14's `took` was withdrawn entirely, not fixed. A webview boolean is forgeable both ways, the host
  already admits every switch so it can derive the fact itself, and sticky-across-redraws is wrong for
  net intent. D18 derives it from the opening's baseline instead, and nothing new goes on the wire.
- Wave shape refuted too: 2_4 changed whether 2_1's refusal branch was reachable, and 2_1 could not add
  a refusal reason and stay type-green without the exhaustive refusal Record another task leased.
  Wave 2 is now fully sequential, which is what the dependencies actually were.

- Knowledge candidate: jsonc-parser 3.3.1 `modify(text, [key, i], undefined)` CORRUPTS the document when
  `i` is the last element of a SINGLE-LINE array — `{"copy": [".env", ".env.local"]}` minus index 1 comes
  back as `{"copy": [".env""]}`, unparseable. | Surprise: D4 chose element-granular edits precisely
  because the narrow form was probed safe; it is safe for multi-line arrays and non-last indices only, and
  the earlier probe used a multi-line fixture. | Evidence:
  src/worktree/provisioning/writeNativeConfig.ts#applyEdit | Consumer: plan|debug | Action: any edit
  planned through `modify` on an array must be checked against the value it was for before it is written.
- 2_2 deviation, within D4's decision rather than changing it: each key's edit is applied narrowly, then
  the result is parsed and compared with the value the edit was for; a mismatch falls back to replacing
  that one key's whole value, and a mismatch there too refuses `unwritable`. D4's claim (bytes outside the
  span unchanged) still holds wherever the narrow form works; where the library cannot do it, one array's
  comments are lost in exchange for a document that parses. Witnessed both ways.
- 2_2 seam left for 2_3: `divergenceOf` takes `tookSource` and the host passes a literal `false` until
  2_3 wires D18's baseline comparison. Until then a save records the offer's own item changes and never a
  bare source take.
- 2_3, stated rather than claimed: routing the three provisioning offer posts through the guarded
  `deliver` has NO behavioural witness of its own today, because nothing runs after the post at any of
  those sites — a throw was already contained by each chain's `.catch`. What D19's invariant actually
  rests on is the recovery: the offer store re-mints on every issue, so a dropped delivery leaves the
  form holding an evicted id, and F007's refresh is what answers it. That composition is the test.
- 2_3 step 6, already satisfied: `TerminalViewProvider.worktree.test.ts` has carried the
  `worktreeProvisionSave` wire sample without `provider` since 1_5, so this task added no sample.
- 2_4 steps 2 and 6, already satisfied and so not re-done: the form never sent a source-change flag —
  D14's `took` was refuted at plan time and never implemented — so `WorktreeController.ts` needed no
  change and its test no addition. The take-then-configure interleaving is witnessed in
  `WorktreeCreateDialog.test.ts`, where the control lives.
- Round-2 F018's suggested MECHANISM was wrong and the finding still stood. It proposed carrying the
  previous selection forward "intersected with the new model's ids"; `offerStore.issue` remints every
  selectable id from an `itemSequence` that never restarts, so that intersection is always empty. The
  rows are matched by what they ARE instead — kind, subject, mode, `source` and occurrence index.
  `source` and occurrence are load-bearing: two providers may declare the same script and
  `providerKit` appends setup rows without deduplicating.
- Plan attack (`asm-oracle`, HIGH) classified the F018 fix as remediation rather than a handback: the
  correlation is local to the dialog, no path or script joins the wire, D1's outbound authority
  boundary is untouched, and the state stays dialog-lifetime UI state beside `checkedByOffer`.
- Knowledge candidate: `src/extension.worktreeAssembly.test.ts` fails a DIFFERENT test on each
  full-suite run under machine load and passes 55/55 alone. | Surprise: it reproduced identically on
  a clean detached worktree at HEAD with no diff, so three `verify-task` runs locked a task the diff
  could not have broken. | Evidence: `extension.worktreeAssembly.test.ts:575` fires
  `void host.handleMessage(...)`, `:608-613` pumps a fixed 40 zero-delay timers, `:1498-1510` waits
  for ANY `.wt-notice` while admitting an unrelated one already exists, and `:38-43` vs `:435-458`
  share one module-global `REPO` that `beforeEach` never resets. | Consumer: debug | Action: an
  assembly-test failure naming a test the diff cannot reach is checked against a clean-HEAD full-suite
  run before it is treated as a regression.
