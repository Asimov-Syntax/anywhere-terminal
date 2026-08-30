# Review round 1 — prove-nobody-is-using-this-worktree

- Date: 2026-08-31
- Cycle: 1
- Mode: discovery
- Head reviewed: `b1c94488f2ce62f99f2499fce0985819d803a4f4` (working tree dirty in `asimov/changes/prove-nobody-is-using-this-worktree/analytics.json` and `workflow.md`; explicit range review used committed content only)
- Diff scope: `git diff b65db179~1..HEAD`
- Reviewable lines: 615 added/modified across 10 reviewable files; 760 changed test lines reviewed inline; docs and plan artifacts used as approved context but skipped as review targets
- Verdict: **REJECT**
- Counts: 3 BLOCK · 2 WARN · 0 SUGGEST
- Split over gating blockers: 3 feature / 0 machinery

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-logic | orphan proof production + merge semantics | errors, edge cases, destructive-option safety | `gpt-5.6-sol[1M]` |
| asm-review-data-security | registry records + removal evidence | ownership proof, containment, refusal preservation | `gpt-5.6-terra[1M]` |
| asm-review-contracts | assessment/check wire + consumers | D1/D2 contract projection | `sonnet[1M]` |
| asm-review-performance | registry and proof reads | growth axes, deadlines, critical path | `gpt-5.6-terra[1M]` |
| asm-review-logic | WorktreeHost assessment orchestration | snapshot coherence and promise failure paths | `gpt-5.6-luna[1M]` |
| asm-review-reuse | registry/git-dir extractions | authoritative helper reuse and duplicate policy | `gpt-5.6-luna[1M]` |
| chair | full range | all lenses + full-flow trace | `gpt-5.6-sol[1M]` |

Verify gate evidence is the build's recorded `bun run asm change verify-status prove-nobody-is-using-this-worktree`: tasks 1_1 through 3_3 are marked `[x]` with exit 0. No project verify command was run by the chair. A targeted disposable git probe confirmed that `symbolic-ref --short` preserves `origin/release/2.x`, while `feature` can be an ancestor of fallback `main` but not of the actual `release/2.x` default.

---

## Findings

### [B1] Slash-separated default branches can produce a confident merge proof against the wrong branch

- Severity: BLOCK · Confidence: HIGH · Priority: P1
- Agent: asm-review-logic (corroborated by the second logic reviewer and chair)
- Class: feature
- File: `src/worktree/orphanProofs.ts:130-142`
- Status: open · Triage: pending

**Evidence.** `resolveDefaultBranch` converts the result of `git symbolic-ref --short refs/remotes/origin/HEAD` with `named.slice(named.lastIndexOf("/") + 1)`. A valid result such as `origin/release/2.x` therefore becomes `2.x`, not `release/2.x`. If `refs/heads/2.x` exists, it is accepted directly; if it does not, the resolver can fall through to an unrelated local `main` or `master`. The chair's disposable probe produced `symbolic-ref=origin/release/2.x`, `merge-base --is-ancestor feature main` exit 0, and the same comparison against the actual `release/2.x` exit 1.

**Impact.** `branchMerged` can be `passed` for a branch that is not merged into the repository's actual default. That breaks the proof contract now and would let WT-013.3 offer the irreversible branch-delete option on a false proof.

**Fix.** Validate and strip exactly the known `origin/` prefix, preserving the entire remaining branch name. Add a case with `origin/release/2.x` and a competing `2.x`/`main` ref whose ancestry differs.

---

- Status: accepted
- Triage: Confirmed against real git 2.50.1, not reasoned about. A clone whose default is `release/2.x` reports `origin/release/2.x` from `symbolic-ref --short`; `named.slice(named.lastIndexOf("/") + 1)` yields `2.x`, which is not a local head, so the ladder falls through to `main`/`master`. That is the confident-wrong-proof direction D4 exists to prevent, and it is exactly the class of defect D4 already records having been burned by once (asserting a source's behaviour without probing). Fixing by stripping the exact `origin/` prefix and refusing a `--short` answer that does not carry it.

### [B2] The registry refactor changes which duplicate session blocks removal

- Severity: BLOCK · Confidence: HIGH · Priority: P1
- Agent: asm-review-data-security (corroborated by both logic reviewers, asm-review-reuse, and chair)
- Class: feature
- File: `src/worktree/worktreeBlockers.ts:301-308, 349-357`; prior rule `src/vault/readers/runningSessions.ts:125-147`
- Status: open · Triage: rebuttal rejected

**Evidence.** Before this range, `listRunningClaudeSessions` selected one live record per `sessionId` before containment, using `winsDedupe`: interactive over headless, then newest `startedAt`, then highest PID. The new removal path filters every raw record by target containment and pane claim first, then keeps the first matching record in `dedupeBySessionId`; `SessionRecord` no longer carries the fields needed to reproduce the old winner. A live interactive record outside the target plus a live headless resume record with the same session id inside the target was previously represented by the outside interactive winner and did not refuse; the new existential prefilter retains the inside record and refuses.

The workflow note's rebuttal says the winner cannot change membership because `cwd` is consumed before the new dedupe. That describes the new algorithm but does not compare it with the old one: the accepted boundary is precisely that the old canonical winner was chosen before containment. Moving containment before winner selection is the behavior change.

**Impact.** The hard task boundary and caller brief both require that the live filter and dedupe move unchanged. The new order can make a worktree unremovable while a duplicate live record exists, even when the registry's established canonical record is rooted elsewhere.

**Fix.** Preserve one scan but derive two views: keep the undeduped records for `ownerGone`, and derive the removal-refusal view with the existing canonical live winner before target containment and pane-claim handling. Reuse/export the authoritative selection rule rather than a first-record map.

---

- Status: accepted — HANDBACK, not fixed in this round
- Triage: Confirmed, and my earlier rebuttal (recorded in workflow.md against the same finding raised out of band by `asm-review-reuse`) was WRONG. I reasoned about membership inside the new post-filter algorithm and never checked the old ORDER: `listRunningClaudeSessions` runs `winsDedupe` across every live record user-wide, before any caller looks at containment. So the old winner for a session id was chosen globally and only then tested for containment; the new code tests containment first and keeps the first survivor. A session whose global winner is rooted elsewhere, with a losing duplicate rooted inside the target, now refuses where it did not. That is a change to what refuses, which 2_1's Boundary forbids in as many words.
- Why this is not remediation: every correct fix needs selection metadata `SessionRecord` deliberately does not carry (headless-ness, `startedAt`, `pid`), or a second derived list beside the raw records. Either changes the interface D3 publishes. D3's own text carries both readings — "the removal producer ... derives both the live external evidence and the ownership proof from them" against "`evaluateRemoval` filters the live ones where it used to be handed them" — and choosing between them is a design call, not an implementation one. Per the remediation boundary this is an artifact handback; per fastlane it is never auto-chosen. Parked for `asimov-plan`.

### [B3] New proof-only filesystem work can hold the removal assessment open

- Severity: BLOCK · Confidence: HIGH · Priority: P1
- Agent: asm-review-performance (corroborated by chair)
- Class: feature
- File: `src/extension.ts:757-795, 802-828`; awaited by `src/providers/WorktreeHost.ts:2097-2130`
- Status: open · Triage: pending

**Invariant.** Proof-gated work may withhold only its gated option; every proof-only read must settle within an assessment bound and degrade to `unproven`, never prevent the removal assessment itself from returning.

**Evidence.** Two new boundaries violate it:

1. `paths.prepare(outcome.records.map((s) => s.cwd))` now realpaths every distinct cwd in the raw registry, including dead crash records. The growth axis is user-wide stale session history; the change states no structural cap. Before this range, dead records were discarded before this resolution stage. `ResolvedPathMemo.prepare` awaits every `fsp.realpath` with no deadline.
2. `lockMtime` is a raw `fsp.stat(absPath)` with no deadline. The `try/catch` in `lockProof` maps rejection to `unproven`, but a stalled filesystem promise neither rejects nor resolves.

Both promises feed `facts.proofs`, which is an element of the host's awaited `Promise.all`. A stalled dead-record realpath or lock stat therefore stalls assessment and the serialized removal mutation. The known WT-013.1 debt is materially worse here: the existing ignored-material reader at least races its work against a deadline; these new reads have no deadline at all, and the registry path adds unbounded proof-only operations rather than one bounded call.

**Boundary inventory.** Affected: dead-record path resolution, lock metadata, host Promise orchestration. Verified safe: missing worktrees skip lock/branch reads; git proof commands use the bounded command runner and map timeout/non-0-or-1 exits to `unproven`; proof outcomes remain outside `atRisk`, fingerprint subset, and digest.

**Impact.** A proof can refuse removal in practice by making the assessment never return, violating the proposal's Must-not and the proof-class contract. Stale records also add O(U) realpaths per assessment for U distinct historical cwd values, plus O(R) retained/mapped records.

**Fix.** Do not realpath dead records for the refusal view; retain them as raw evidence and test `alive` before containment in the owner proof. Put proof-only path resolution and lock stat behind an explicit assessment deadline that maps timeout to `unproven`. This need not solve cancellation or abandoned-read dedupe in this change.

---

- Status: accepted — split
- Triage (b), the unbounded reads — ACCEPTED and FIXED this round: `lockMtime` is a raw `fsp.stat` with no deadline, awaited inside the assessment's `Promise.all`, so a stalled mount never reaches the catch that would answer `unproven`. design.md's own failure-surface inventory calls this stat "bounded"; it was not. Bounding it with the existing `afterDelay` deadline makes that claim true and does NOT mint the shared in-flight-read owner WT-013.1 round-5 W3 needs, so W3 stays open and unwaived exactly as the proposal says.
- Triage (a), the realpath fan-out — ACCEPTED, folded into B2's handback: the producer now resolves every raw record's cwd including long-dead ones, where it used to resolve the live deduped set. That growth axis is the same question B2 asks — what the producer derives from the raw records and what reaches `evaluateRemoval` — and answering it separately would pre-empt the design call B2 hands back.

### [W1] A partially unreadable registry can be reported as a complete `ownerGone` pass

- Severity: WARN · Confidence: HIGH · Priority: P2
- Agent: asm-review-data-security (narrowed by chair)
- Class: feature
- File: `src/vault/readers/runningSessions.ts:257-272`; consumed at `src/extension.ts:802-813` and `src/worktree/orphanProofs.ts:84-91`
- Status: open · Triage: pending

**Evidence.** After a successful `readdir`, any matching PID file whose `readFile` rejects is silently skipped, and the raw reader still returns `{ kind: "ok", records }`. The production wrapper forwards that as a successful source read; if no surviving record is a live target owner, `ownerProof` returns `passed`. This finding is limited to read failures. Malformed/invalid payloads remain excluded under task 1_1's approved shared-parser contract.

**Impact.** An EACCES/EIO/transient read failure for a live target record can produce a confident “owner gone” proof from a partial scan. The existing live-refusal reader may keep its compatibility behavior, but the new proof must not promote an incomplete read to evidence of absence.

**Fix.** Preserve the existing records array and live-reader behavior, but carry raw-scan completeness separately. A candidate-file read failure should make the ownership proof source partial/failed so `ownerGone` is `unproven`; validation failures can remain non-records as approved.

---

- Status: accepted
- Triage: Confirmed. `listClaudeSessionRecords` skips a `<pid>.json` whose `readFile` throws and still returns `kind: "ok"`. For the live reader that is unchanged pre-existing behaviour; what is new is the CONSUMER — `ownerGone` reads the remaining set as complete, so one EACCES on a live owner's record yields a confident "nobody is here" about the one action that cannot be undone. Fixing by carrying scan completeness separately so a skipped candidate makes the proof `unproven`, while the live reader and the malformed-payload contract stay exactly as approved. Inside 1_1's accepted contract; touches no D#.

### [W2] Independent lock and merge proofs are serialized behind the whole registry path

- Severity: WARN · Confidence: HIGH · Priority: P3
- Agent: asm-review-performance
- Class: feature
- File: `src/extension.ts:802-804`; `src/worktree/orphanProofs.ts:61-64`
- Status: open · Triage: pending

**Evidence.** `proofs()` first awaits `sessions`, which includes the full registry scan and all cwd resolutions, and only then calls `readOrphanProofs`. Lock aging and merge ancestry do not depend on sessions. The outer host `Promise.all` gives one host continuation, but it cannot restore the inner concurrency: critical-path cost is `T_sessions + T_lock/merge` instead of their maximum.

**Impact.** Stale registry growth delays unrelated proof I/O and widens the interval covered by the assessment's observation check. The observation guard prevents stale evidence from authorizing execution, so this is latency and retry pressure rather than a safety bypass.

**Fix.** Start lock and merge work immediately and join the supplied sessions promise only for `ownerGone`, while preserving the single registry scan and the host's one joined `Promise.all`.

---

- Status: accepted
- Triage: Confirmed by reading the producer I wrote: `const read = await sessions;` precedes `readOrphanProofs`, so the lock and merge reads — which need no registry at all — wait on it. This is a straightforward inversion that serves D7 better rather than changing it: start all three, join the sessions promise only where ownership is evaluated.

## Verified safe

- Only `merge-base --is-ancestor` exits 0 and 1 become `passed`/`failed`; timeout and every other exit become `unproven`.
- No fetch command is issued by the proof ladder.
- Unlocked, branchless, default-branch, and missing-worktree cases take the deliberate `notApplicable` paths described by the caller and approved design.
- Proof outcomes enter `RemovalEvidence` but not `atRisk`, `isIdentityPreservingSubset`, or fingerprint `digest`; the dialog's force guard excludes proof-class unproven rows.
- One registry `readdir` is shared by refusal and ownership proof; no second registry scan was introduced.
- Dead record details do not cross the removal wire; only proof outcomes and the existing live external-session ids do.
- The shared `readWorktreeGitDir` extraction correctly replaces the manifest reader's inline copy and rejects failed, timed-out, or empty git-dir results.
- Changed tests contain no `.only` or `.skip`; the proof, wire, fingerprint, missing-worktree, and single-scan cases are covered. Missing coverage aligns with B1-B3/W1.

## Adjudication notes

- `asm-review-contracts` found the D1/D2 wire and fingerprint exclusions sound. Its comment-only suggestion for catalogue-wide unavailable checks was dropped as non-defect and unreachable on the current result wire.
- The data-security suggestion to treat malformed payloads as partial was narrowed: task 1_1 explicitly approves one shared validator and malformed records skipped by both readers. W1 therefore covers matching candidate files that could not be read, not payloads that fail validation.
- The known WT-013.1 abandoned-read finding was not re-filed by itself. B3 records the evidence delta introduced here: unbounded dead-record realpaths and a raw lock stat now sit on the removal assessment's critical path.


## Author triage (round 1)

Accepted: B1, B3(b), W1, W2 — fixed this round. Accepted: B2 and B3(a) — parked as one artifact handback; they are the same question and neither is remediation. No finding was rejected, and no risk was accepted: only the user can grant that.
