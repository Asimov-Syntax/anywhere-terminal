# Review round 3 — write-only-the-native-config-file

- Date: 2026-09-02
- Cycle: 2
- Mode: verification
- Arbiter: yes
- Scope: range `13424b4c..71784821` — the single round-2 remediation commit `71784821`, reviewed using the change context. Head `71784821dbc0e733a57d2f955a24d39b4d93d713`.
- Working tree: `asimov/changes/write-only-the-native-config-file/analytics.json` is modified and `asimov/changes/prove-entry-reconstruction-on-windows/analytics.json` is untracked; neither is part of the explicit reviewed range beyond the committed telemetry snapshot.
- Scope lock: passed. The delta is remediation plus task/review telemetry. F018's correlation remains dialog-lifetime UI state, adds no wire field or durable state owner, and does not change D1's host-authority boundary.
- Reviewable lines: 217 changed lines across 2 reviewable production files (185 additions, 32 deletions); 319 changed test lines reviewed inline. Change artifacts and other Markdown were context, not production review surface.
- Verify gate: `bun run asm change verify-status write-only-the-native-config-file` records task `3_1` `[x] exit 0`; the caller records the final `verify-task` result as 7011/7011. Review did not re-run project verification. Two targeted scratch probes were created and removed in their commands: F019 observed two candidate resolutions on a stable canonical spelling; F022 observed mode `0644` under umask `0077`, where the process default is `0600`.
- Agents spawned: 3 (frontend, logic, data-security) plus chair self-review. Contracts, performance and reuse were skipped because the verification cone did not require separate lenses.
- Verdict: **BLOCK**
- Status: **blocked**
- Counts: 1 BLOCK · 2 WARN · 2 SUGGEST (5 open findings; 4 prior findings fixed).

## Cross-round filter

| ID | Round 2 | Round 3 | Evidence |
|---|---|---|---|
| F018 | BLOCK accepted | **fixed** | The save answer is correlated locally to the pending save; `carryForward` remaps both ticks and unticks by row kind, subject, mode, source and occurrence, defaults genuinely new rows, and reseeds after a switch. No path, key or script joins the wire. |
| F019 | WARN accepted | **persists** | The explicit `realpath(dir)` is followed by `isResolvedPathInsideRoot(here, ...)`, whose first operation is another `realpath(candidate)`. D7's non-recursive `mkdir`/`lstat` mechanism also remains absent. |
| F020 | WARN accepted | **fixed** | Pending switches are repository-scoped and a cached same-offer redraw no longer clears them; only a different offer answers the switch. |
| F021 | WARN accepted | **fixed for its recorded valid-base witness** | The base in force is now `planned.writes ?? planned.declared`, and disappearance refuses before the edit. The newly introduced untrusted-path boundary is a distinct mechanism, F025. |
| F014 | SUGGEST accepted | **persists partially** | Duplicate posts are prevented, but a repository round-trip redraws a pending save as enabled and inert. |
| F022 | SUGGEST accepted | **persists; escalated to WARN** | The fix passes `0644`, but `LockedFile.stageReplacement` then `chmod(0644)` and overrides a restrictive umask. The evidence delta changes the impact from over-restrictive to potentially over-permissive. |
| F023 | SUGGEST accepted | **persists partially** | A save answer evicts its superseded set; a switch answer does not evict the set keyed by the switched-from offer. |
| F024 | SUGGEST accepted | **fixed** | The contract test now pins the save shape, required provider presence, and `unsaved` refusal reason. |

## Findings

### F025 — A declared base can probe an arbitrary path outside the repository
- Severity: BLOCK · Confidence: HIGH · Priority: P2 · Agent: asm-review-data-security + chair · Class: feature
- File: `src/worktree/provisioning/writeNativeConfig.ts:449-455`
- Evidence: `planned.declared` is the existing JSONC document's untrusted `extends` string. The new F021 branch passes `path.join(repoRoot, base)` directly to `lstat` without containment or adapter-membership validation. `readProvisioning.ts:223-228` deliberately applies the opposite rule: `baseFor` accepts only exact `FRAMEWORK_ORDER` filenames before any open, so `../` and unknown names cannot become filesystem paths. A committed `extends: "../../outside/probe"` now makes Configure report success when that outside entry exists and `unnamed` when it does not.
- Impact: untrusted repository text becomes a user-triggered filesystem-existence oracle outside the repository. It can also admit a save under a base the read side still rejects as `missingExtends`, violating the same read/write agreement D17 exists to preserve.
- SuggestedFix: validate the declared base with the same exact adapter-file membership rule as `baseFor` before any filesystem operation, then revalidate that known candidate through the read side's containment/usable-file boundary rather than raw `lstat`.
- Status: accepted · Triage: Confirmed by reading the code: `planned.declared` is the raw JSONC `extends` value and reaches `lstat(join(repoRoot, base))` with no membership or containment check, while `planned.writes` is host-derived and safe. The read side already owns the authority — `baseFor` accepts a target only when `FRAMEWORK_ORDER.find(a => a.files.includes(target))` matches, which is what makes `../` and an absolute path resolve to nothing without a containment check of their own. The writer will ask the SAME list rather than grow a second copy of the rule, and a base that is not a member is refused as `unnamed`, which is also the answer the next read gives it. Remediation: no `D#` moves and no invariant owner is minted.
- Triage: Accepted by the round-3 arbiter. This is introduced by the remediation delta, lies inside F021's behavioral cone, crosses the change's untrusted-provider-text boundary, and can falsify D17 on the load-bearing save path. It is gating, not audit backlog.

### F019 — D7 still has two candidate resolutions, and its directory-creation text still contradicts D16
- Severity: WARN · Confidence: HIGH · Priority: P3 · Agent: chair + asm-review-logic · Class: feature
- File: `src/worktree/provisioning/writeNativeConfig.ts:377-389`
- Evidence: line 379 resolves `dir` into `here`; line 388 passes `here` to `isResolvedPathInsideRoot`, which calls `realpath(current)` at `src/utils/resolvedPathBoundary.ts:107`. A targeted probe using a canonical spelling observed `asked: 2` and a refusal, proving the new witness's `asked === 1` result depends on `os.tmpdir()` changing spelling (for example `/var` to `/private/var`) rather than on one resolution. Separately, D7 still mandates non-recursive `mkdir` + EEXIST tolerance + `lstat`, while the absent-directory path still reaches `LockedFile`'s recursive `mkdir`.
- Impact: the local half of F019 is not closed and the regression witness is filesystem-spelling dependent. No supported non-adversarial escape is established: the retained target uses the first result, and D16 explicitly delegates the adversarial inode-vs-string swap. The accepted design nevertheless claims a mechanism the code does not implement.
- SuggestedFix: make one helper return the resolved candidate it checked, or add a predicate for an already-resolved candidate, and derive `target` from that exact value. Hand the artifacts back to plan to remove or narrow D7's `mkdir`/`lstat` prescription against D16; do not add a partial race defense that D16 already establishes cannot close the invariant.
- Status: accepted · Triage: Accepted, and NOT fixed here — this is the artifact handback. D7 mandates a non-recursive `mkdir` with EEXIST handling plus `lstat`; D16 scopes the local adversarial inode-versus-string race out. Implementing D7's mechanism would be theatre against a race the design says is out of scope, and the second `realpath` inside `isResolvedPathInsideRoot` cannot be removed without deciding which of the two texts governs. The chair agrees this belongs to plan. Carried into the handback together with the D16 split task, which is `docs/PLAN.md`'s and therefore the blueprint's to own.
- Triage: Persists from round 2. The first half was attempted but still resolves twice. The second half is an artifact contradiction, not a request to implement descriptor anchoring in this change. D7 and D16 must be reconciled before a later cycle can claim a clean review.

### F022 — First creation overrides a restrictive process umask
- Severity: WARN · Confidence: HIGH · Priority: P3 · Agent: chair · Class: feature
- File: `src/worktree/provisioning/writeNativeConfig.ts:468-474`
- Evidence: the create branch calls `stageReplacement(next, 0o644)`. `LockedFile.stageReplacement` opens with that mode and then, because the argument is defined, calls `handle.chmod(mode)` at `src/agentHooks/install/lockedJsonFile.ts:131-135`. `chmod` is not narrowed by umask. A targeted probe under umask `0077` created the file as `0644`; the process default `0644 & ~0077` is `0600`. The added test at `writeNativeConfig.test.ts:578-585` passes under the ordinary `0022` umask only because both values happen to be `0644`.
- Impact: the prior too-private mode is replaced by a mode that can be broader than the user's process policy. That changed impact justifies the round-2 SUGGEST becoming a WARN.
- SuggestedFix: pass the already-masked mode (`0o644 & ~process.umask()`) or give `LockedFile` an explicit create-default path that lets the open-time umask apply without the later chmod; add a restrictive-umask witness.
- Status: accepted · Triage: Accepted. The round-2 fix traded one wrong mode for another: `stageReplacement(next, 0o644)` makes `LockedFile` chmod exactly `0644`, which umask does not narrow, so a process under `umask 0077` gets a file broader than its own policy. The mode will be masked before it is passed. Remediation.
- Triage: Persists from round 2 with an evidence-based severity escalation: the mechanism now risks over-permission rather than merely an inconvenient private mode.

### F014 — A pending save becomes enabled and inert after a repository round-trip
- Severity: SUGGEST · Confidence: HIGH · Priority: P4 · Agent: chair + asm-review-frontend + asm-review-logic · Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1481-1501`
- Evidence: pressing Configure stores `pendingSave[repo]` and disables the one shared button. Drawing another repository sets `saveButton.disabled = false`. Returning before the answer redraws the cached original offer; because there is no pending switch, line 1483 enables the button and line 1501 appends it, while `pendingSave` remains because the offer id is unchanged. Activation then silently returns at lines 1296-1302.
- Impact: duplicate writes are prevented, but the accepted busy/confirmed-state requirement is not truthful across the repo picker: the enabled control does nothing.
- SuggestedFix: after classifying an answer, derive `saveButton.disabled` from `pendingSave.has(draft.repoId)` on every redraw and witness save A → repo B → repo A before A's answer.
- Status: accepted · Triage: Accepted. The per-repository `pendingSave` record is right; the shared button's `disabled` is not derived from it on redraw, so returning to a repository with a save outstanding shows an enabled control whose handler silently returns. Derived on every redraw instead. Remediation.
- Triage: Persists partially from round 2. The same-repository double-press path is fixed; repository-scoped presentation is not.

### F023 — Switch answers still retain superseded selection sets
- Severity: SUGGEST · Confidence: HIGH · Priority: P5 · Agent: chair + asm-review-frontend + asm-review-logic · Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1479-1510`
- Evidence: a distinct offer answering a switch deletes `pendingSwitch`, but `checkedByOffer.delete(...)` runs only for `saved.offerId`. The switched-from offer is no longer held by the controller or host and cannot be drawn or submitted, yet its set remains. Repeated source switches therefore keep adding one unreachable row-capped set per switch for the dialog lifetime.
- Impact: F023 is fixed for saves but not switches. The practical impact remains low and dialog-lifetime, so severity stays SUGGEST.
- SuggestedFix: when a distinct offer answers `switched`, delete the selection keyed by that switched-from offer after capturing any state still needed for the redraw.
- Status: accepted · Triage: Accepted. Save answers evict the superseded offer's selection and switch answers do not, so repeated switches retain one unreachable set per offer for the dialog's lifetime. The eviction is the same statement in both cases. Remediation.
- Triage: Persists partially from round 2; save supersession is evicted, switch supersession is not.

## Arbiter dispositions

- F025 — **accepted**. The path is sourced from untrusted provider text, reaches `lstat` outside the adapter whitelist and repository boundary, and affects the load-bearing save result. Exact unblock condition: validate the declared base through the same bounded authority used by the read side and add a witness that `../`/unknown values cause no outside probe and no write.

## Verified sound

- F018's row correlation is remediation, not an artifact handback: it is local to one dialog, no path/script/key joins the save request, D1's outbound authority boundary is unchanged, and the state dies with the dialog. `source` and occurrence are justified by non-deduplicated provider rows.
- F018 carries both ticks and unticks across save success, no-op and refusal responses; genuinely new rows take new defaults; a switch answer deliberately reseeds.
- F020's pending-switch state survives repo-picker cached-offer redraws and clears only on a distinct answer.
- F021's recorded disappearance witness is closed for a valid declared adapter base; F025 is a separate validation mechanism introduced by broadening that probe.
- F024's added type-level contract witnesses cover the new save shape, `present`, and `unsaved` vocabulary.
- The reported `extension.worktreeAssembly.test.ts` load flake is outside this remediation cone, reproduces on clean HEAD, and is correctly recorded as a Knowledge candidate rather than treated as a regression here.
- Not adding the D16 split task directly to `docs/PLAN.md` is not a builder defect; the blueprint owns that file. The still-owed artifact handback must ask that owner to reconcile D7/D16 and add the independent descriptor-anchored writer dependency.

## Sub-agents spawned

- asm-review-frontend: dialog selection, pending save/switch state, redraw modes and eviction — `gpt-5.6-sol[1M]`
- asm-review-logic: remediation state machine, carry-forward and filesystem/test witnesses — `gpt-5.6-terra[1M]`
- asm-review-data-security: filesystem boundary, D7/D16/D17 and remediation classification — `sonnet[1M]`
