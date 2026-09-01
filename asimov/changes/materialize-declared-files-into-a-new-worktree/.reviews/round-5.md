# Review round 5 — materialize-declared-files-into-a-new-worktree

- Date: 2026-09-01
- Cycle: 3
- Mode: discovery
- Requested lane: fastlane
- Scope: noncontiguous ranges `73359caa~1..ec0f777e` and `b526c6be..fa5a8d6c`; commits between them belong to `assemble-one-config-from-several-files` and were excluded
- Fresh material: `b526c6be..fa5a8d6c`; the first range supplied cumulative change context and the full-flow baseline
- Head reviewed: `fa5a8d6cbded22469a970ee9ed106104a0b155ef`
- Working tree: production code was clean at the reviewed Head; review-protocol analytics and an unrelated `assemble-one-config-from-several-files` round artifact appeared during the review and remained outside this review's writes
- Reviewable lines: 1,496 cumulative production/contract lines, 179 fresh; 2,114 cumulative test lines reviewed inline, 304 fresh
- Large change: yes — accuracy may decrease above 800 reviewable lines
- Agents spawned: 6 — data-security, logic, contracts, frontend, performance, reuse
- Agents skipped: none
- Chair: independent full-diff self-review, full-flow trace, one production-binding byte-budget probe, and one POSIX identity probe
- Verify evidence: `bun run asm change verify-status materialize-declared-files-into-a-new-worktree` records tasks 1_1 through 4_4 exit 0. Review did not rerun typecheck, lint, or any test suite.
- Verdict: **WARN**
- Counts: 0 BLOCK / 3 WARN / 2 SUGGEST
- Split over gating blockers: 0 feature / 0 machinery

## Scope and full-flow trace

Round 5 is correctly a new discovery round: tasks 4_1 through 4_4 changed `tasks.md`, so the prior
cycle's verification contract was superseded. The cumulative top-risk flow was traced end to end:

`WorktreeCreateDialog selection → WorktreeController post → WorktreeHost offer lookup and id
resolution → worktreeMutationService queued create → prepareEntryGate/admitEntry → applyEntry
copy/link walk → nodeApplyFsDeps → MutationOutcome and ordered host posts → controller merge and
reconciliation → WorktreeView row/repository notice`.

The host-held offer still prevents webview-supplied paths from reaching the filesystem. Direct and
recursive lockfile refusals now cover the Win32 alias bypass, link attempts charge a node, successful
streamed copies reconcile actual bytes, exclusive creation restores source modes, and skipped and
degraded top-level outcomes are rendered distinctly. The remaining defects sit on the failed-stream
accounting boundary and the create-notice reattachment boundary.

## Prior finding dispositions

| ID | Round 5 disposition | Deciding evidence |
|---|---|---|
| F002 | **persists** | `readdir` still materializes the complete child array before `check(children.length)` and has no cancellation signal. This is the explicitly recorded listing residual. |
| F004 | fixed | Win32 trailing-dot/space/default-stream aliases now fold before the lockfile and root-link lookups. F028 is a separate over-refusal side effect on filesystems where those names are distinct. |
| F011 | fixed | Both provisioning adapters now call `messageOf`; the structural owner test covers the former inline shape. |
| F016 | fixed | `makeLink()` calls `spend()` before both the symlink attempt and its `EEXIST` arm. |
| F017 | **persists** | The fallback dedupe key closes the two-create collision, but `rescope()` still cannot restore a dropped `worktreeId` when the new row appears. |
| F019 | fixed | Parent escape detection now tests an exact `..` component, so `..cache` is admitted. |
| F021 | **persists** | The limiter bounds one transfer, but a failed transfer leaves partial bytes while retaining only the stale precharge, and later entries reuse that undercharged shared budget. |
| F025 | fixed | `walk()` refuses lockfile-named regular-file and symlink descendants before any byte charge. |
| F026 | fixed | A top-level skip no longer counts as written and a degraded link is named separately. |
| F027 | fixed | The production binding explicitly restores file and directory mode bits after exclusive creation. |

---

## F021 — A failed limited transfer leaves partial bytes outside the shared budget

- Severity: WARN · Confidence: HIGH · Priority: P1 · Class: feature
- Agent: chair + asm-review-data-security + asm-review-logic
- File: `src/worktree/provisioning/applyEntries.ts:420-434,559-599`
- Status: accepted, persists from round 2 · Triage: accepted

**Evidence.** `spendBytes(node.size)` precharges the outer `lstat` estimate. The production
`Transform` can forward one or more chunks, then reject when a later chunk makes `written > limit`.
The caller reconciles only success and `EEXIST`; every other rejection keeps the stale precharge even
though D9 deliberately leaves the partial destination standing. The caller then continues with later
entries on the same `budget.spent` object.

A targeted scratch probe used the production binding with the exact reachable race represented by a
stale outer `lstat`: a 150 KiB live source, a 1-byte precharge, a 100 KiB apply cap, then a 60 KiB
second entry. The first result was `failed` and left 65,536 bytes; the second was `copied` and left
61,440 bytes. Total destination content was 126,976 bytes against a 102,400-byte cap, while
`budget.spent.bytes` reported only 61,441.

**Invariant inventory.** Static oversized files are refused before opening; a successful transfer
returns actual bytes; `EEXIST` refunds the precharge; an individual growing-file transfer cannot
forward beyond its supplied ceiling. A transfer that fails after forwarding bytes is affected, and
so is every later entry sharing the undercharged budget. Deadline abort and other post-write I/O
errors have the same accounting shape, although an expired shared deadline prevents later work.

**Impact.** D10's apply-wide byte cap remains false on a reachable production error path. Partial
content plus later successful entries can exceed the cap even though the first step reports failure.
The direct binding test proves only that a limiter rejects; because the fake owns a separate copy and
ignores `limit`, no existing apply-level witness sees the undercharge.

**Suggested fix.** Return or attach the exact forwarded byte count on every termination path and
settle it before the failed step returns, or conservatively consume the remaining ceiling when a
limited transfer fails after opening. Add a production-binding apply witness where one chunk lands,
a later chunk breaches the ceiling, and the next entry cannot consume those bytes again.

**Severity adjudication.** Specialists proposed BLOCK. F021 keeps WARN under cross-round severity
stability: its established impact was already an apply-wide byte-cap violation, and this evidence
narrows the surviving path to a growing source plus a failed transfer rather than increasing impact,
likelihood, or reachability.

---

## F017 — A create notice still never regains its canonical row identity

- Severity: WARN · Confidence: HIGH · Priority: P1 · Class: feature
- Agent: chair + asm-review-contracts + asm-review-frontend
- File: `src/webview/worktree/WorktreeController.ts:1619-1655`
- Status: accepted, persists from round 2 · Triage: accepted

**Evidence.** `showActionResult()` now dedupes by `worktreeId ?? orphanedLabel`, which correctly keeps
two newly created worktrees from replacing one another. But `rescope()` still drops `worktreeId` when
the row is absent and immediately returns unchanged whenever `worktreeId === undefined`. On the next
tree response, `reconcile()` calls `rescope(r, worktrees)`, but there is therefore no branch that
recognizes `orphanedLabel` as a now-present canonical id and restores `worktreeId`.

**Invariant inventory.** Ordered create-result then provision-result delivery is safe; the immediate
merge is safe; two new creates in one repository now keep separate notices. Reconciliation after the
new worktree row appears is affected. `WorktreeView.placeResults()` can attach only a result carrying
`worktreeId` to that row, so the id-less notice remains at the repository anchor and remains counted
against the orphan cap.

**Impact.** The create/provisioning notice does not move under the worktree it describes once that row
exists, and a live worktree's notice can later be evicted as an orphan. Task 4_3 explicitly required
keeping canonical identity separately from the render anchor; the fallback dedupe key closes only the
collision half.

**Suggested fix.** Retain canonical identity in a field separate from the temporary orphan label, or
rehydrate `worktreeId` when reconciliation sees that `orphanedLabel` id in the incoming row set. Add
the round-4 requested assembly witness: create result → provision result → tree rebuild containing
the new row → notice attached to that row.

---

## F002 — A full directory listing remains outside the time, node, and memory bounds

- Severity: WARN · Confidence: HIGH · Priority: P2 · Class: feature
- Agent: chair; carried from prior chair + logic + performance agreement
- File: `src/worktree/provisioning/applyEntries.ts:453-455`
- Status: accepted, persists from round 2 · Triage: accepted residual

**Evidence.** `await deps.readdir(source)` constructs the complete children array before the node
budget check runs and receives no cancellation signal. A large or stalled listing can allocate O(N)
names and hold the per-repository mutation queue past the 60-second deadline before zero children are
walked.

**Invariant inventory.** Single-file precharge, in-flight copy abortion, direct-link charging, node
walk charging, and bounded detail rows are safe. The listing allocation and listing operation's own
lifetime remain affected.

**Impact.** D10 still does not bound listing memory or the duration of that operation, delaying the
create result and mutations queued behind it.

**Suggested fix.** Keep the recorded residual until the seam can move from `readdir` to incremental
`opendir`, charging and checking between reads. This round does not treat the known `ApplyFsDeps`
and fake change required by that fix as an oversight.

---

## F028 — Win32 alias folding falsely refuses distinct POSIX filenames

- Severity: SUGGEST · Confidence: HIGH · Priority: P3 · Class: feature
- Agent: chair + asm-review-data-security + asm-review-contracts
- File: `src/worktree/provisioning/entryGate.ts:153-164,173-185`
- Status: accepted · Triage: accepted (task 5_1)

**Triage.** The Darwin probe settles it against my round-4 judgement: three coexisting inodes mean
these spellings are one object only where the platform makes them one, so folding them everywhere
refuses a name POSIX considers distinct. Fixed by gating the trailing-dot, trailing-space and
`::$DATA` folds on Win32 path semantics. The case fold is NOT touched — it predates this round and
D10 accepted it on its own terms.

**Evidence.** `filesystemIdentity()` strips trailing dots/spaces and `::$DATA` unconditionally. Task
4_1 justified those transforms as Win32 filesystem identity, but on POSIX they are literal filename
bytes. A Darwin scratch probe created `pnpm-lock.yaml`, `pnpm-lock.yaml.`, and
`pnpm-lock.yaml::$DATA` simultaneously; all three had different inodes and different contents. The
classifier nevertheless folds the latter two to the first for both direct admission and descendants.

**Impact.** A legitimate POSIX entry or descendant with one of those narrow names is refused as a
lockfile (and a root link named `node_modules.` or `node_modules ` is likewise refused) even though it
is not the filesystem object the material rule protects. The behavior is safe-failing and the names
are exceptional, so this follows round-4 F019's false-refusal precedent as SUGGEST rather than a
gating defect.

**Suggested fix.** Apply trailing-dot/space/default-stream folding only when the destination
filesystem has Win32 semantics. Preserve the accepted existing case-fold decision unless its own
filesystem-sensitivity is deliberately redesigned. Add a non-Windows witness that the dotted and
stream-suffixed names remain distinct.

---

## F029 — Direct and recursive lockfile refusal still have two classification owners

- Severity: SUGGEST · Confidence: HIGH · Priority: P4 · Class: feature
- Agent: asm-review-reuse; chair adjudication
- File: `src/worktree/provisioning/entryGate.ts:173-181`
- Status: accepted · Triage: accepted (task 5_1)

**Triage.** Accepted at the chair's severity, not the specialist's: I verified independently that
the two owners are behaviourally identical today, so this is a maintenance shape rather than a live
defect. It is still worth closing — the direct/recursive split is exactly the seam rounds 2 and 4
watched drift. `refusedMaterial` delegates, and `oneOwner.test.ts` gets the structural witness the
finding asks for, proven by reverting.

**Evidence.** `refusedLockfile()` folds the basename, checks `LOCKFILES`, and returns
`LOCKFILE_REASON`. Immediately below it, `refusedMaterial()` independently folds the basename,
checks the same set, and returns the same reason. Direct entries use the second owner while recursive
files and symlinks use the first.

**Impact.** Current behavior is identical, so the specialist's proposed BLOCK is refuted. The split
still leaves the same lockfile invariant with two edit sites after multiple rounds were caused by
direct and recursive classification drifting apart.

**Suggested fix.** Have `refusedMaterial()` call `refusedLockfile(resolvedDestination)` first, then
retain only the mode-specific `node_modules` rule locally. A structural owner witness is appropriate
because a correct duplicate has no behavioral difference for an ordinary output test to detect.

## Inline support review

- No fresh test contains `.only` or `.skip`; both scoped ranges pass `git diff --check`.
- Fresh real-filesystem tests correctly witness descendant lockfile refusal, Win32 aliases, mode
  restoration, direct-link charging, and direct binding rejection at a byte ceiling.
- The byte-ceiling test calls `nodeApplyFsDeps.copyFileNoFollow` directly and cannot witness shared
  accounting after a failed partial transfer; the fake's separate copy ignores the optional limit.
- The new controller test witnesses only two-create dedupe, not the later rebuild that should restore
  the row anchor.

## Specialist adjudication notes

- Data-security and logic independently corroborated F021; the chair's production-binding probe
  supplied the concrete apply-wide overrun. Their BLOCK severities were reduced to the established
  F021 WARN because the surviving path is narrower than the round-4 impact, not stronger.
- Contracts and frontend independently corroborated F017. The immediate collision is fixed, but the
  accepted reattachment boundary remains unchanged.
- Data-security and contracts independently rejected the unconditional POSIX fold. The finding is
  narrowed to the fresh dot/space/default-stream transforms; the previously accepted case-fold rule
  is not re-litigated here.
- Reuse's duplicate-classifier BLOCK was reduced to SUGGEST because both sites currently call the
  same fold, set and reason and therefore have no present behavioral divergence.
- Frontend's proposed outcome-kind summary finding was rejected: WT-012.2 Acceptance specifically
  requires per-entry degradation and reporting refusals/failures, not separate aggregate copy/link
  counts, and D8 deliberately defines descendant details as display-ready path plus reason without a
  kind field.
- Frontend's proposed render-signature finding was rejected as unreachable in the shipped flow: one
  create posts one provisioning result, and a later create under the same identity first replaces the
  old result with an unprovisioned mutation outcome, which changes the signature before its new
  provisioning result arrives.
- Performance reported no new finding beyond the explicitly carried F002 residual.

## Audit backlog

None.

## Accepted risk

None.

## Sub-agents spawned

- `asm-review-data-security`: filesystem identity, recursive material refusal, production copy safety — `gpt-5.6-sol[1M]`
- `asm-review-logic`: shared budget, streaming error paths, fake/production seam — `gpt-5.6-terra[1M]`
- `asm-review-contracts`: accepted D4-D10 and round-4 closure contracts — `sonnet[1M]`
- `asm-review-frontend`: create-notice identity, reconciliation, and outcome truthfulness — `gpt-5.6-terra[1M]`
- `asm-review-performance`: descendant/byte growth axes and queue-hold bounds — `gpt-5.6-luna[1M]`
- `asm-review-reuse`: classifier, copy binding, and error-helper ownership — `gpt-5.6-luna[1M]`
