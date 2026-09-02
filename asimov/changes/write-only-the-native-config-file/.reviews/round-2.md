# Review round 2 — write-only-the-native-config-file

- Date: 2026-09-02
- Cycle: 2
- Mode: discovery
- Scope: the change's own commits inside `750bd053~1..HEAD` — wave 1 (`a82ccc85..60139492`, 8 commits) plus wave 2 (`c1ac4bfe..HEAD`, 5 commits), reviewed as ONE change per the caller's brief. Head `13424b4c`.
- Scope note: the requested range's first-parent side crosses merge `c1ac4bfe`, which brings in `delete-a-branch-only-under-a-guard` (`deleteBranch.ts`, `removalChecks`, `WorktreeRemoveDialog`, `worktreeMutationService`, `orphanProofs`, `BranchDeleteRequest`/`WorktreeBranchDeleteOutcome`, and the `deleteBranch` hunks in `extension.ts` / `WorktreeHost.ts` / `messages.ts` / `WorktreeController.ts`). That work belongs to another change and was reviewed to completion there; it is excluded here and every specialist was told to ignore it. Nothing in this round reports on branch deletion.
- Working tree: `workflow.md` modified (change artifact, not reviewable) and one untracked `analytics.json` belonging to a different change. Otherwise clean.
- Reviewable lines: ~1100 added/modified across 9 reviewable files. NOTE: **Large change — accuracy may decrease.**
- Verify gate: `bun run asm change verify-status` reports 1_1–1_5 and 2_1–2_4 all `[x] exit 0`. Not re-run here.
- Agents spawned: 6 (data-security, logic ×2, contracts, frontend, performance) + chair self-review and full-flow trace. `asm-review-reuse` not spawned: round 1's two reuse findings (F011, F015) are both closed in this diff and the wave-2 delta adds no new helper, parser or split — the reuse surface is verified inline below.
- Verdict: **BLOCK**
- Counts: 1 BLOCK · 3 WARN · 4 SUGGEST (8 findings; 1 carried forward, 7 new)
- Split over gating blockers: 1 feature / 0 machinery.

## Cross-round filter

Round 1 findings F001–F017 plus the author-raised A1. Dispositions verified against this diff:

| ID | Round 1 | Now | Evidence |
|---|---|---|---|
| F001 | BLOCK accepted | **fixed at the boundaries D16 does not scope out**; residual split to F019 | `isResolvedPathInsideRoot` now guards the ENOENT branch (it walks to the nearest resolving ancestor and joins the tail lexically, and refuses a dangling or outward link), and the target's own `lstat` symlink refusal moved inside the lock. The re-derive window persists — see F019 |
| F002 | BLOCK accepted | fixed | `divergenceOf` sets `unnamedSource`; `writeNativeConfig` refuses `unnamed` (`writeNativeConfig.ts:421-423`), and D17 re-confirms the base inside the lock (`:432-438`) |
| F003 | WARN accepted | fixed | the `lstat`, the symlink verdict and `mode = stat.mode & 0o777` are all inside `file.withLock` (`writeNativeConfig.ts:395-409`) |
| F004 | WARN accepted | fixed | edits are element-granular (`planEdits` `:292-323`), with a checked whole-key fallback (`applyEdit` `:223-236`) |
| F005 | WARN accepted | fixed | witness rewritten in task 2_2; verify-status records the replacement and what it now asserts |
| F006 | WARN accepted | fixed | `needed = divergence.tookSource \|\| (declaredBase === undefined && edits.length > 0)` (`planEdits:336`) — a form that changed nothing writes no file |
| F007 | WARN accepted | fixed | the `shown === undefined` branch now re-reads and re-offers (`WorktreeHost.ts`, save case) |
| F008 | WARN accepted | fixed | `ProvisionProblem.reason` gained `unsaved`; `refusedSave` maps only `malformed` to `malformed` |
| F009 | WARN accepted | fixed | `if (deps.onProvisionSave !== undefined) bringField.appendChild(saveRow)` |
| F010 | WARN accepted | fixed | `planEdits` accepts `value === undefined` with no errors as the empty object |
| F011 | WARN accepted | fixed | parses through `providerKit.readJsonc` |
| F012 | WARN accepted | fixed | `onlyKeys(msg, ["type","repoId","opening","switch","offerId","kept"])` — no `provider` |
| F013 | SUGGEST accepted | fixed as triaged | task 2_1 added the `DETECTION_ORDER` head witness |
| F014 | SUGGEST accepted | **persists from round 1 (second half)** | the `aria-describedby` half landed; the "busy or confirmed state" half did not — see below |
| F015 | SUGGEST accepted | fixed | imports `isNotFound` from `lockedJsonFile` |
| F016 | SUGGEST accepted | fixed | `m.kept.length <= MAX_MODEL_ROWS` |
| F017 | SUGGEST accepted | fixed | one `PreparedRoot` and one `Opens` map per read |
| A1 (author) | accepted | fixed on the switch-row path; recurs at a new boundary as F020 | `awaitingSwitch` + `saveRow.remove()` close the taken-a-source path; the repo picker reopens it |

## Findings

### F018 — A save response discards the selection the user made
- Severity: BLOCK · Confidence: HIGH · Priority: P1 · Agent: chair + asm-review-frontend · Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1358-1380`
- Invariant: a tick the user set survives every redraw the user did not cause by changing that tick.
  - Boundary categories searched: keystroke re-derive, repo-picker move, same-offer redraw, new-offer redraw (switch), new-offer redraw (save success), new-offer redraw (save no-op), new-offer redraw (save refused).
  - Boundaries affected: all three save-response redraws.
  - Boundaries verified safe: keystroke re-derive and repo-picker move (both pinned by the `[W2]` tests, which pass because the offer id is unchanged); the switch redraw, where reseeding is correct because the model is a different source's.
- Evidence: `checkedByOffer` is keyed by `offerId`. The host answers **every** save — success, no-op and refusal alike — by calling `offers.issue`, which mints a fresh id and evicts the old one, then delivering it. `syncBringOver` therefore takes the `ticked === undefined` branch and reseeds from `bringRows(offer.model).filter(r => r.checked)` — the model's defaults, not the user's set. `bringRows` gives setup steps `checked: false` (`:551-560`) and entries `checked: loses === undefined` (mostly `true`).
  - After a **refused** save the re-read model is unchanged, so every entry the user unticked comes back ticked. The user unticks `.env`, presses `Configure…`, reads "Not saved", and `.env` is silently re-selected — pressing Create then copies it.
  - After any save, a ticked `Run setup` row is cleared, while the note beside the button says "Setup steps and ports apply to this create only" — telling the user that tick still governs this create when the press has just discarded it.
- Impact: the control that exists to record the user's choice silently reverses part of it, in the same flow, with no message. This is round 1's own `[W2]` invariant ("losing a choice silently is a defect whether or not anything acts on it") reappearing at the one boundary the change introduced, and no test covers it — the six Configure cases assert the posted request, never the state afterwards.
- SuggestedFix: when the arriving offer is the answer to a save this form issued, carry the previous offer's set forward intersected with the new model's ids, and reseed from defaults only for an offer that is not a save response. Witness: untick an entry, refuse the save, assert the row is still unticked; tick a setup step, succeed the save, assert it is still ticked.
- Status: accepted · Triage: the defect is real and the witness is exactly right; the suggested MECHANISM is not. Ids cannot be intersected across offers — `offerStore.issue` remints every selectable id from an `itemSequence` that never restarts, so the old set and the new model share nothing and the intersection is always empty. The rows must be matched by what they ARE. Plan attack (asm-oracle, HIGH) confirms this is remediation rather than a handback: the correlation lives inside the dialog, no path or script goes on the wire, D1's outbound authority boundary is untouched, and the state stays dialog-lifetime UI state beside `checkedByOffer` — no new invariant owner. It also supplies the correction the naive descriptor misses: `source` and an occurrence index are load-bearing, because two providers may declare the same script and `providerKit` appends setup rows without deduplicating.

### F019 — D7's "resolved once" is still two resolutions, and its `mkdir` mechanism is absent
- Severity: WARN · Confidence: HIGH · Priority: P3 · Agent: chair + asm-review-data-security · Class: feature
- File: `src/worktree/provisioning/writeNativeConfig.ts:372-385`
- Evidence: D7 clause 1 states the parent is "resolved ONCE, checked against the resolved repository root ... and **every subsequent operation names the resolved path** — the one resolution that was checked, never a second one taken afterwards", and further that "the directory is created non-recursively tolerating EEXIST, `lstat`ed and refused when it is a link, and only then resolved and checked". The code calls `isResolvedPathInsideRoot(dir, prepared, deps)` — which resolves `dir` internally and discards the result — and then calls `deps.realpath(dir)` a second time, building `target` from that second, unchecked result. There is no non-recursive `mkdir`, no `lstat` of `.vscode`, and no EEXIST tolerance anywhere in the module; the absent-directory branch hands creation to `LockedFile`'s recursive `mkdir` with the comment "beneath a parent already checked".
- Impact: the security invariant still holds non-adversarially — an already-planted `.vscode` symlink is refused by the boundary helper, which resolves it and finds it outside the root — so this is not an open bypass. But D16 scopes out only what needs descriptor-anchored `openat`/`renameat`; collapsing two `realpath` calls into one is entirely local and needs none of that. The approved design and the shipped code now disagree about a mechanism, and round 1's F001 triage cited exactly this `mkdir` path as the part D7's reproduction missed, so the next reader has no way to tell which text is current.
- SuggestedFix: have the boundary helper return the resolved candidate (or resolve once here and check the resolved string), and name that one value in `target`. Then either implement D7's non-recursive `mkdir` + `lstat` or amend D7 to record that D16 subsumed it.
- Status: accepted
- Triage: Accepted, split in two and only one half is remediation. The DOUBLE RESOLUTION is a defect
  and a local one: resolving `.vscode` once and naming that value everywhere needs no descriptor
  anchoring and no helper signature change — resolve first, check the resolved string, build `target`
  from it. Fixed. The MISSING `mkdir`/`lstat` mechanism is not remediation: D7 wrote it to close the
  parent-swap race, and D16 later took that race out of this change's scope on the finding that no
  string-named sequence can close it. Implementing a mechanism whose stated purpose has been scoped
  out would be theatre, and amending D7 is design work this task cannot do. Carried into the handback
  with F018 so plan settles D7's text against D16 once.

### F020 — The repo picker restores `Configure…` while the switch it was hidden for is still unanswered
- Severity: WARN · Confidence: HIGH · Priority: P2 · Agent: asm-review-frontend · Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1343-1370`
- Evidence: taking a source sets `awaitingSwitch = true` and removes `saveRow`. Moving the repo picker to a repository with no offer runs `syncBringOver(undefined)`, which clears `drawnOfferId` but leaves `awaitingSwitch` untouched and has no per-repository pending state. `WorktreeController` caches the last offer per repo (`provisionOffers`), so moving back re-supplies the **same** offer message; `drawnOfferId` is now `null`, so the `drawnOfferId === offer.offerId` early return does not fire, the redraw runs, `awaitingSwitch = false`, and `saveRow` is appended again — all while the switch is still in flight.
- Impact: D15's own failure mode, reachable by two clicks of the repo picker. A save pressed there mints the higher sequence, records the superseded source, and makes the outstanding switch fail its re-check and vanish unreported — the exact pair of consequences A1 was accepted for.
- SuggestedFix: key the pending-switch state by `repoId` (and opening) rather than one form-wide flag, and clear it only on an offer id that differs from the one the switch was taken against.
- Status: accepted
- Triage: Accepted, remediation, and mine — D15's decision is unchanged, the flag simply has the wrong
  scope. One form-wide boolean cannot express "this repository's switch is unanswered" when the picker
  moves between repositories that each hold their own cached offer. Keyed by repository and by the
  offer the switch was taken against, which is also what makes a re-delivery of the SAME offer stop
  counting as the answer.

### F021 — A base the document already declares is never revalidated, and `unnamedSource` is waived by its mere presence
- Severity: WARN · Confidence: MEDIUM · Priority: P3 · Agent: asm-review-data-security · Class: feature
- File: `src/worktree/provisioning/writeNativeConfig.ts:342, 421, 432`
- Evidence: `planned.named` is `declaredBase !== undefined || writes !== undefined`, so the `unnamed` refusal (`:421`) never fires once the target holds any `extends`. The D17 existence probe (`:432`) is guarded by `if (planned.writes !== undefined)`, and `writes` is set only for a base this call is about to write. A base the file already declares is therefore neither confirmed to exist nor reconciled with the source the offer was built from. Reachable path: the native file holds `extends: "asimov/worktree.yaml"`; the user switches to orca, so `prefer="orca"` makes orca active; orca's file is removed between the assembly read and `publish`'s presence probe, so `present` is empty and `unnamedSource` is true with no `extends`; the exclusions computed from orca's entries are committed under the asimov base.
- Impact: the save records the user's choice against a base that is not the one they were looking at — the exclusions may name paths the declared base never declares, and the source change the user actually made is not recorded. This is narrower than D12's "one exclusion becomes every exclusion": a base is still present, so inherited entries survive. Confidence MEDIUM because the trigger is the same read-then-probe race D11 documents rather than an ordinary state.
- SuggestedFix: probe the base actually in force, not only the one being added — when `planned.writes === undefined && declaredBase !== undefined`, `lstat` it under the same lock and refuse `unnamed` on ENOENT. Separately, refuse when `unnamedSource` is true and `declaredBase !== divergence.extends`.
- Status: accepted
- Triage: Accepted, remediation. D17 already says the base is confirmed inside the lock immediately
  before the write; it does not say "only a base this call adds", and reading it that way is what left
  a declared base unprobed. Widening the probe to the base actually in force implements D17 rather
  than changing it. The second half — refusing when the source that supplied the offer cannot be named
  and the document names a different one — is D12's own claim applied to the state D12 describes.

### F014 — The save control still has no busy or confirmed state (persists from round 1)
- Severity: SUGGEST · Confidence: HIGH · Priority: P4 · Agent: asm-review-frontend · Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1216-1231`
- Evidence: round 1's `aria-describedby` half landed (`:1205`). The second half did not: the click handler has no in-flight guard, so each press increments the shared `switchSeq` and posts another save. A double press starts two writes; the lock serializes them and the second raises the ceiling, so the first save's publish is dropped and only the later answer is shown. Nothing on screen distinguishes "sent" from "not pressed" until an offer arrives.
- Impact: unchanged from round 1 — the user cannot tell whether the press was heard. Severity held at SUGGEST per severity stability; the double-press concurrency is the same mechanism (no in-flight state on the control), not a new one, and its outcome is benign because the write is idempotent.
- SuggestedFix: hold a pending flag from the press until the answering offer arrives, and reflect it on the control.
- Status: accepted
- Triage: Accepted (SUGGEST), remediation, and now fixed rather than carried a second time: a finding
  that persists across rounds because it was ranked non-blocking twice is one nobody ever fixes. The
  press holds a pending state until the answering offer arrives, which also removes the double-press
  path.

### F022 — A first-created `.vscode/worktree.json` lands at `0o600`
- Severity: SUGGEST · Confidence: HIGH · Priority: P4 · Agent: asm-review-data-security · Class: feature
- File: `src/worktree/provisioning/writeNativeConfig.ts:451`
- Evidence: the create branch calls `file.stageReplacement(next, undefined)`; `LockedFile.stageReplacement` opens the temporary as `open(temporaryPath, "wx", mode ?? 0o600)` and skips its `chmod` when `mode` is undefined (`lockedJsonFile.ts:131-135`), and `commit("create")` links that inode into place. The replace branch does preserve bits. A narrower case: `mode` can be defined while `existing` is `undefined` (present at `lstat`, gone at `readText`), and the create branch still discards it.
- Impact: a repository-tracked file created not group- or other-readable, unlike every sibling. Git records only the exec bit, so the committed mode is unaffected; the exposure is limited to the local working tree — containers or CI reading the checkout as another uid. Not a leak (it is more restrictive), but it is a mode nobody chose, and D3's "takes the default" reads as the process default rather than `0600`.
- SuggestedFix: `file.stageReplacement(next, mode ?? 0o644)` and let the umask narrow it.
- Status: accepted
- Triage: Accepted (SUGGEST), remediation. `0o600` is not a mode anyone chose — it is `LockedFile`'s
  temporary-file default leaking through a create that passed no mode. D3 says the file takes the
  default, meaning the process default.

### F023 — `checkedByOffer` keeps one Set per offer for the dialog's lifetime
- Severity: SUGGEST · Confidence: HIGH · Priority: P5 · Agent: asm-review-performance · Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1259, 1379`
- Evidence: every save and every switch issues a fresh offer id and `checkedByOffer.set(offer.offerId, ticked)` adds an entry; nothing is ever deleted. Growth axis: one Set of at most `MAX_MODEL_ROWS` (200) short ids per save-or-switch, per open dialog.
- Impact: bounded in practice by the modal's lifetime — the map is a closure local and is collected with the dialog on submit or cancel — and by the number of times a person can press two buttons. Reported as SUGGEST rather than the BLOCK the specialist proposed: the axis is per-interaction inside one short-lived form, not per-user, per-session or per-history, so there is no unbounded accumulation to gate on. If F018 is fixed by carrying the previous set forward, eviction of the superseded entry falls out of the same change.
- SuggestedFix: retain only the current offer's set (and, for F018, the one being carried forward).
- Status: accepted
- Triage: Accepted (SUGGEST), remediation, and it does fall out of F018's fix as the chair predicted:
  carrying one selection forward means there is one set to keep, so the superseded entry is dropped
  where it is superseded.

### F024 — The new wire surface is not pinned by the contract test
- Severity: SUGGEST · Confidence: HIGH · Priority: P5 · Agent: chair (Phase 2.5) + asm-review-contracts · Class: feature
- File: `src/types/messages.contract.test.ts`
- Evidence: this change is flagged `new-api-contract` and adds `WorktreeProvisionSaveMessage`, a required `ProvisionProvider.present`, and the `unsaved` reason. Neither wave touched `messages.contract.test.ts` — its only edits in the reviewed range come from the merged-in branch-deletion change. Routing IS pinned: `TerminalViewProvider.worktree.test.ts` carries a `worktreeProvisionSave` SAMPLE and that map is exhaustive over `WORKTREE_MESSAGE_TYPES`, so the type cannot be added without one.
- Impact: low. `present` and `unsaved` are enforced by the compiler at every construction and consumption site, and the routing gap is closed by the exhaustive sample map. The gap is only that the file whose job is to pin the wire shape does not mention the change's own additions.
- SuggestedFix: add the save message and the two field additions to the contract test.
- Status: accepted
- Triage: Accepted (SUGGEST), remediation. Routing is pinned and the fields are compiler-enforced, so
  this closes a documentation gap rather than a hole — but the file whose job is to pin the wire not
  mentioning the change's own additions is exactly how the next addition goes unpinned too.

## Verified sound (no finding)

Recorded so the next round does not re-hunt them.

- **Chained removals on a corrupt intermediate recover.** Probed against the pinned 3.3.1: removing index 1 then index 0 of `{"copy": ["a", "b"]}` yields `{"copy": ["]}` and does **not** throw, so `applyEdit`'s `holds()` check fails and the whole-key fallback — applied to the ORIGINAL `text`, not the corrupted intermediate — recovers. Multi-line last-element removal and single-element single-line removal are both correct. The D4 amendment's check is placed where it needs to be.
- **`kept`'s `MAX_MODEL_ROWS` bound cannot reject a legitimate save.** `full()` budgets entries, ports, setup and problems against the same 200-row cap, and `kept` is a subset of the rendered rows.
- **The D8 ordering gate.** Ceiling taken synchronously before the write and re-checked before the publish; `offerKey` and `slot` are both keyed by surface+repo+opening, so cross-repo and cross-opening leakage is structural.
- **`tookSource` across open→save, open→switch→save, open→switch→back→save, open→save→save.** All four correct, and the "no baseline" branch is unreachable — the only path that issues a first offer records the baseline in the same `.then()` before `offers.issue`, and a save with no offer falls into the re-read branch.
- **Teardown.** `retireOpening` sweeps `provisionReading`, `provisionSwitch` and `provisionBaseline` under one `${key} ` prefix and calls `offers.forgetSurface(key)`.
- **No webview value reaches a path, key or file text.** `kept` is consumed only as set membership; `repoId` selects a `cache.read().repos` record; the only string reaching `path.join(repoRoot, …)` at `:434` is one of the adapters' compile-time file constants.
- **Failure atomicity.** Both commits are single atomic operations on a fully written temporary; every pre-commit refusal returns before staging exists; `discard()` runs in a `finally` and unlinks only after dev/ino identity.
- **`refusedSave` cannot accumulate.** It appends to a freshly re-read model, not to a retained one.
- **`openOnce`'s `opens as Authorized` cast.** The map is local to one `readProvisioning` call and keyed by the exact provider-file spelling; no cached entry can cross reads.

## Sub-agents spawned

- asm-review-data-security: `writeNativeConfig.ts` + wiring — filesystem boundary, lock discipline, mode, input provenance — `opus[1M]`
- asm-review-logic: `writeNativeConfig.ts` — edit planning, jsonc-parser behaviour, idempotence — `gpt-5.6-terra[1M]`
- asm-review-logic: `WorktreeHost.ts` — save/switch ordering, baseline derivation, teardown — `sonnet[1M]`
- asm-review-contracts: `messages.ts` + validators — wire contract, registration, `present`, `unsaved` — `gpt-5.6-terra[1M]`
- asm-review-frontend: `WorktreeCreateDialog.ts` + `WorktreeController.ts` — control lifecycle, selection state, a11y — `gpt-5.6-luna[1M]`
- asm-review-performance: `readProvisioning.ts` + host/dialog state — growth axes, per-save cost — `gpt-5.6-luna[1M]`
- asm-review-reuse: skipped — round 1's reuse findings are closed and the delta adds no new helper, parser or split.
