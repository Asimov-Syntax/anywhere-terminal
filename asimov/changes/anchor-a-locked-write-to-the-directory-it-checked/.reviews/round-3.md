# Review round 3 — anchor-a-locked-write-to-the-directory-it-checked

- Date: 2026-09-02
- Cycle: 2
- Mode: discovery
- Arbiter: yes
- Requested scope: range `5af4d3fd..HEAD`
- Head: `e12ec9613eaf4a4a62441af1e1240f6f5b909d6c` (explicit committed range; working tree also had modified generated `analytics.json`, modified `docs/PLAN.md`, and untracked prior review artifact `.reviews/round-2.md`, all outside the reviewed range)
- Reviewable lines: 153
- Large change: no
- Verdict: **REJECT**
- Status: **blocked**
- Counts: 3 BLOCK · 0 WARN · 1 SUGGEST
- Split over gating blockers: 3 feature · 0 machinery
- Verify evidence: `bun run asm change verify-status anchor-a-locked-write-to-the-directory-it-checked` records tasks 1_1 and 1_2 exit 0. The chair ran no project verify command. Two isolated real-filesystem probes were created and deleted in the same command: one confirmed landed/no-op/refused writes report a lock that remains at the path while ordinary and already-unlinked releases do not; the second confirmed that renaming the held lock makes the reported canonical path absent and lets a second writer acquire it immediately.

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-data-security | filesystem ownership, no-follow, release identity | storage and security | `gpt-5.6-sol[1M]` |
| asm-review-logic | leaked-lock outcome and publication flow | state, errors, async outcomes | `gpt-5.6-terra[1M]` |
| asm-review-contracts | result union and webview problem rendering | contracts and design patterns | `sonnet[1M]` |
| asm-review-logic | bigint coercion and open error vocabulary | platform and race logic | `gpt-5.6-terra[1M]` |
| asm-review-reuse | filesystem identity comparison | reuse and drift | `gpt-5.6-luna[1M]` |
| asm-finder | callers, renderers, and full production flow | impact trace | runtime default |
| chair | full range | all applicable lenses and full-flow trace | `gpt-5.6-sol[1M]` |

Skipped specialist lenses: frontend (the changed host data reaches an existing renderer, covered by contracts and chair full-flow review) and performance (single-file operations are structurally bounded; the added cost is one `lstat` only for opted-in reads).

## Cross-round dispositions

### [F001] Lock-release state is not orthogonal to the write outcome

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; corroborated in round 1 by asm-review-logic, asm-review-contracts, and asm-review-reuse
- Class: feature
- File: `src/worktree/provisioning/writeNativeConfig.ts:62`
- Status: fixed
- Triage: D4 and `NativeConfigWrite` now carry `lockLeaked` on both result arms, and the writer folds the callback into landed, no-op, and refused outcomes. The original success-only mechanism no longer exists. New findings below concern different causal mechanisms.

### [F002] The approved “lock is gone” scenario requires the opposite of the implementation

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair
- Class: feature
- File: `src/agentHooks/install/lockedJsonFile.ts:264`
- Status: fixed
- Triage: The amended spec and D4 now correctly exclude `ENOENT` with held `nlink === 0n`; the real-filesystem probe confirmed that case leaves the canonical pathname free and produces no `lockLeaked`.

## Findings

### [F003] A generic release failure is mislabeled as this save’s exact live lock

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; corroborated by asm-review-data-security
- Class: feature
- File: `src/worktree/provisioning/writeNativeConfig.ts:543`
- Status: accepted
- Triage: The callback must distinguish an owned lock still present at the canonical pathname from absence, identity mismatch, and indeterminate inspection. Only the first case may become `lockLeaked` and an instruction to remove that path.

**Evidence.** `releaseLock` returns `false` for every condition other than a confirmed successful release: canonical `ENOENT` while the held inode still has links, canonical identity mismatch, and inspection errors all reach the same callback. Lines 542-546 convert every one of those states into `lockLeaked: lockPath`. A real-filesystem probe renamed the acquired lock to a sibling before release. The result reported the original canonical path, `lstat` proved that path absent, the moved owned inode remained live, and a second `withLock` entered immediately through the now-free canonical name. The changed substitution witness at `lockedJsonFile.test.ts:179-197` also explicitly expects the callback to name a canonical path that now contains a different file.

**Impact.** The UI can instruct the user to remove a nonexistent path or an unrelated actor’s replacement lock. If another writer has acquired the now-free canonical path, following the instruction can delete that writer’s live lock and break serialization. This falsifies D4/spec language that the reported path is the lock this save took and that it is “still there.”

**Suggested fix.** Give release a typed disposition. Emit leaked-lock metadata only when the canonical pathname is confirmed to still name the held identity and unlink of that same pathname failed. Treat canonical absence as free regardless of the held inode’s other links; do not name identity mismatches or indeterminate paths as owned locks. Replace the substitution test’s report expectation with the safe disposition.

**Invariant inventory.** Invariant: user-removal guidance may name only the canonical pathname that still names this holder’s lock. Searched canonical same-identity/unlink success, same-identity/unlink failure, absent with `nlink === 0n`, absent with `nlink > 0n`, identity mismatch, and stat/lstat failure. Affected: absent with links, identity mismatch, and indeterminate inspection. Verified safe: successful unlink; already-unlinked `ENOENT` with `nlink === 0n`; same-identity unlink refusal really does leave the named owned lock present.

### [F004] The host can discard a confirmed leaked-lock result before publication

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; corroborated by asm-review-logic
- Class: feature
- File: `src/providers/WorktreeHost.ts:2529`
- Status: accepted
- Triage: A confirmed lock leak needs a reporting path independent of a successful model reread and stale-model replacement. Preserve the current refusal/write facts and exact actionable lock report even when the refreshed model cannot be produced.

**Evidence.** After `writeNativeConfig` has returned `lockLeaked`, the new mapping is reached only after `await options.readProvisioning(repo.mainPath)` succeeds. A rejection flows to the empty catch at line 2539, so neither the original write/refusal outcome nor the live lock path is published. The same `publish` closure silently rejects the result when a newer switch has advanced `provisionSwitch`; the newer action can then see only `unavailable`, because the leaked lock prevents acquisition, and never receives the exact path already known by the older result.

**Impact.** A real live lock can permanently wedge subsequent saves while the only component holding its actionable pathname silently drops it. That directly violates the amended requirement that every save which took and could not release a lock names it to the user.

**Suggested fix.** Separate post-save refresh failure/staleness from lock-leak delivery. Merge the leak into a current offer or another user-visible channel that does not overwrite newer model state, and fall back to the shown model when reread fails. Add witnesses for a rejected reread and for a newer switch arriving after a save has acquired and leaked its lock.

**Invariant inventory.** Invariant: once the writer confirms an owned live lock, every still-live user interaction path must retain its exact actionable report. Searched successful reread/current offer, reread rejection, disposed surface, and a newer switch superseding model publication. Affected: reread rejection and newer-switch suppression. Verified safe: successful reread with the same live offer. A disposed surface has no remaining renderer and is not itself the defect.

### [F005] A landed save is also rendered as “Not saved”

- Severity: BLOCK
- Confidence: HIGH
- Priority: P2
- Agent: chair; corroborated by asm-review-contracts
- Class: feature
- File: `src/providers/WorktreeHost.ts:205`
- Status: accepted
- Triage: The problem classification must represent “saved but still locked” separately from `unsaved`, or the summary reducer must exclude that lock-only condition from its “Not saved” conclusion.

**Evidence.** `leakedLock` correctly puts “was saved, but it is still locked” in `detail` when `wrote === true`, but always assigns `reason: "unsaved"`. The production renderer at `src/webview/worktree/WorktreeCreateDialog.ts:735` maps a model whose problems are all `unsaved` to the visible summary “Not saved.” A landed write whose refreshed model has no rows or other problems therefore presents two contradictory user-facing outcomes: “Not saved” in the summary and “was saved” in the detail. The new host test asserts only the detail string and does not exercise the renderer classification.

**Impact.** The amended D4/spec obligation that the reported write outcome remain truthful is still false in a real renderer. The user cannot tell whether the configuration bytes landed, which is the exact distinction the round-1 handback required the new contract to preserve.

**Suggested fix.** Add a representable lock-only problem classification or carry the landed/no-op state through the model so `bringSummary` can render it truthfully. Add a renderer-level witness for landed-plus-leaked and no-op-plus-leaked outcomes.

## Suggestions

### [F006] Filesystem identity equality now has two changed implementations

- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: asm-review-reuse
- Class: feature
- File: `src/utils/regularFileRead.ts:105`
- Status: accepted
- Triage: Non-gating cleanup after the blockers: share one bigint-normalizing filesystem identity helper between the changed regular-file and locked-file paths.

**Evidence.** The diff adds an inline `BigInt(dev)`/`BigInt(ino)` comparison in `openRegularFile` while changing the private `sameIdentity` in `lockedJsonFile.ts:292-296` to the same semantics.

**Impact.** Future identity-rule changes can drift between two safety-sensitive boundaries.

**Suggested fix.** Move the bigint-normalizing pair comparison to a small filesystem utility and use it from both changed sites. Do not widen this change merely to rewrite unrelated identity code without its own accepted scope.

## Verification question outcomes

- Real production `stat/lstat({ bigint: true })` fields are bigint on the changed capture paths; `BigInt(bigint)` is exact. Ordinary Node `Stats` values are integral numbers, so coercion itself does not throw, but precision already lost before coercion cannot be recovered. No changed production path feeds such rounded values into the ownership/no-follow comparisons.
- The bigint coercion itself does not make distinct captured bigint identities equal. Inode reuse or a filesystem that supplies non-unique ids can still do so, which is the deliberate non-adversarial bound recorded in D5 rather than a coercion defect.
- `openRegularFile`’s pre-open `lstat` runs only for the new `noFollow` opt-in. The sole pre-existing production caller, `provisioningDeps.readBounded`, passes no third argument and retains its open-driven errno vocabulary and symlink-following behavior. `LockedFile.readText` now receives `ENOENT` from the pre-open `lstat` and still classifies it as absence through the unchanged `isNotFound` path.
- Appended refusal detail is not hidden or truncated by the production renderer: it is assigned through `textContent`, wraps rather than ellipsizes, and remains beside the original refusal sentence. F005 is instead a contradictory classification in the same renderer.
- No changed production code claims directory-substitution safety. The no-follow comment states its identity window and D5 bounds; D2/WT-012.21 remain the owners of directory-shaped work.

## Arbiter dispositions

- **F003 — accepted.** The real-filesystem rename witness proves the displayed canonical path can be absent while the owned inode survives elsewhere and another writer enters. This is a load-bearing violation of the exact-lock reporting contract.
- **F004 — accepted.** The new lock metadata is reachable only after a fallible reread and current-offer publication; both can drop the sole actionable path. This directly falsifies the every-outcome reporting requirement.
- **F005 — accepted.** The production summary derives “Not saved” from the newly assigned `unsaved` reason even when the changed detail says the write landed. This directly falsifies the truthful-write-outcome requirement.

No gating blocker is external, rejected, or eligible for audit backlog. Round 3 therefore parks the change with status blocked.

---

## Author triage (round 3)

**[F003] Status: accepted.** Verified against the code myself before acting: `releaseLock`
(`lockedJsonFile.ts:258-275`) returns `false` for FOUR distinct situations — an indeterminate
inspection failure, `ENOENT` with `nlink > 0n` (this holder's lock was renamed away, so the canonical
name is empty), an identity mismatch (a DIFFERENT writer's live lock now holds the name), and a
genuine non-ENOENT unlink failure. Only the last means "your lock is still there and stuck". I
collapsed all four into `lockLeaked: lockPath`. On the mismatch branch the UI would tell the user to
delete another writer's LIVE lock, which destroys the mutual exclusion the lock exists to provide.
That is worse than saying nothing, and it is mine.

**[F004] Status: accepted.** The report is published only on the success path of the reread; a
rejected reread drops it through an empty catch.

**[F005] Status: accepted.** I fixed the detail sentence in round 1 and not the classification the
renderer actually summarises. `WorktreeCreateDialog.ts:735` maps an all-`unsaved` problem set to
"Not saved" while the detail says "was saved" — the exact contradiction F001 asked me to remove,
still true in the UI. A fix inside the round-1 contract is not available: it needs either a new
user-facing problem classification or a renderer change.

**[F006] Status: accepted, deferred to the new change** — the identity helper is duplicated because
the second copy was added by this change's leaf work; the shared helper belongs with the typed
release disposition.

### Thrash stop, and the split it forces

The invariant "a leaked lock reaches the user, truthfully" has now survived TWO fix attempts — the
original task 1_2, and the round-1 handback that restated the contract. That is the thrash-stop
condition, and the remediation boundary decides the rest: F003's fix requires `releaseLock` to return
a TYPED DISPOSITION rather than a boolean, which mints a new invariant owner on the primitive both
config writers depend on, and F005 requires a user-facing classification this change's spec does not
own. Neither is remediation.

Taking option 1 (designed fix as its own change), which the standing goal pre-authorises as
`tách change / replan`. Concretely:

- The lock-reporting story is REMOVED from this change and its code reverted. Shipping it as it
  stands would be actively harmful, not merely incomplete — F003 points users at other writers' live
  locks — so reverting is the correct disposition, not a cosmetic descope.
- This change keeps task 1_1 only: bigint ownership identities and the bounded no-follow leaf read.
  Both were confirmed safe by the reviewers in BOTH cycles, and both fix real defects.
- A new blueprint task owns lock-release reporting properly, starting from the typed disposition, and
  carries F003, F004, F005 and F006 as its inputs.

Options 2 and 3 of the thrash stop are the user's and are NOT taken here: no risk is accepted, and no
extension round is requested.
