# Review round 4 — materialize-declared-files-into-a-new-worktree

- Date: 2026-09-01
- Cycle: 2
- Mode: discovery
- Requested lane: fastlane
- Scope: range `73359caa~1..ec0f777e`, the complete contiguous change range supplied by the user
- Head reviewed: `ec0f777e9f32c9c9f22339049a3661196f68895e`
- Checkout Head: `b526c6becf1dea999601576c57d301fc9033d2ee`; post-range work was used only as change context, never as reviewed code
- Working tree: dirty only at `asimov/changes/assemble-one-config-from-several-files/analytics.json`, outside this change and review range
- Reviewable lines: 1,317 production/contract lines; 1,810 test lines reviewed inline; 2,080 skipped artifact/docs lines
- Large change: yes — accuracy may decrease above 800 reviewable lines
- Agents spawned: 6 — data-security, logic, contracts, frontend, performance, reuse
- Agents skipped: none
- Chair: independent full-diff self-review plus full-flow trace
- Verify evidence: `bun run asm change verify-status materialize-declared-files-into-a-new-worktree` records every task 1_1 through 3_2 exit 0. Review did not rerun typecheck, lint, or tests.
- Verdict: **BLOCK**
- Counts: 2 BLOCK / 7 WARN / 1 SUGGEST
- Split over gating blockers: 2 feature / 0 machinery

## Scope and flow trace

Gate 2 is approved, including the 3_1/3_2 task delta that superseded round 3. This is a fresh
discovery round, so the full cumulative change was reviewed rather than only the remediation delta.
The top-risk flow was traced end to end:

`WorktreeCreateDialog selection → WorktreeController post → WorktreeHost opening/offer redemption →
worktreeMutationService queued create → prepareEntryGate/applyEntry → node filesystem binding →
MutationOutcome identity → host ordered posts → controller reconciliation → WorktreeView notice`.

The host-held offer remains the authority and the immediate create/provision merge now occurs. The
remaining blockers are both in the material-refusal invariant: Win32 aliases still bypass the direct
entry classifier, and recursive copy never applies the classifier to descendants.

## Prior accepted finding dispositions

| ID | Round 4 disposition | Deciding evidence |
|---|---|---|
| F002 | **persists** | `readdir` still materializes and completes before any budget check can charge or interrupt it. |
| F004 | **persists** | trailing-dot and trailing-space Win32 aliases still name refused filesystem objects under unmatched basenames. |
| F007 | fixed | node/byte counters now live on the shared `budget.spent` object used by every entry. |
| F016 | **persists** | direct root link entries perform `symlink` with zero node charge and no deadline check. |
| F017 | **persists** | immediate merge works, but the merged notice permanently retains only `orphanedLabel`; it never regains canonical `worktreeId`. |
| F018 | fixed | descendant `details` are flattened into the rendered reason block and warning tone. |
| F019 | **persists** | the resolved/spelled-root mismatch now refuses, but `relative.startsWith("..")` also refuses valid names such as `..cache`. |
| F020 | fixed | an `EEXIST` skip settles its byte precharge to zero. |
| F021 | **persists; escalated to WARN** | new evidence shows the stream can write beyond the cap before reconciliation; this is not only accounting drift. |
| F022 | fixed | `realpath` is required directly by `ApplyFsDeps`; the production binding supplies it. |
| F023 | fixed | normalization is inside the non-empty selection guard and catches rejection locally. |
| F024 | fixed | only the apply-wide caller cancels the shared deadline. |

F011, accepted and closed in round 2, reopens because the changed extraction still left a second
user-visible error conversion owner at the reviewed Head.

---

## F025 — Recursive copies bypass lockfile refusal for descendants

- Severity: BLOCK · Confidence: HIGH · Priority: P1 · Class: feature
- Agent: chair + asm-review-data-security
- File: `src/worktree/provisioning/applyEntries.ts:375-423`; classifier at `src/worktree/provisioning/entryGate.ts:131-139`
- Status: accepted · Triage: accepted. Verified independently of the chair with a production-binding probe: `copy: ["cfg"]` over a source holding `cfg/pnpm-lock.yaml` returned outcome `copied`, listed the lockfile in the destination, and raised no detail. The accepted design is explicit and stronger than the spec Scenario — worktree-apply.md § 2.1 reads "Lockfiles are never copied and never linked, **whether or not a provider names one**", which is exactly the descendant case. Remediation, not handback: no `D#` moves and no invariant owner is minted; D7 already owns the material rule and this extends its application site from the entry to every walked node.

**Evidence.** `refusedMaterial()` runs once for the selected entry. `walk()` dispatches descendants
straight from `lstat` without applying the lockfile classifier. A production-binding scratch probe
selected directory `cfg` containing `cfg/pnpm-lock.yaml`; the step returned `copied`, the destination
lockfile contained the main checkout's bytes, and the budget recorded the write. A symlink descendant
with a refused basename is likewise handled by `copyLink` rather than the material classifier.

**Invariant inventory.** Direct lockfile entries are refused for copy/link, including case and
`/.` spellings. Lockfiles reached as children of a copied directory are affected. Containment,
no-follow source opening, and never-overwrite remain safe but do not enforce this material class.

**Impact.** An untracked or otherwise absent branch lockfile can be copied from main through an
ancestor declaration, violating the approved requirement that lockfiles are never copied whether or
not a provider names one directly. The result reports the directory as copied rather than the
lockfile as refused.

**Suggested fix.** Make the material classifier one shared operation and apply it to every walked
destination before file/directory/symlink dispatch. Add a production-binding witness for a directory
containing a lockfile, not only direct-entry gate tests.

---

## F004 — Win32 trailing-dot and trailing-space aliases still bypass material refusals

- Severity: BLOCK · Confidence: HIGH · Priority: P2 · Class: feature
- Agent: asm-review-data-security
- File: `src/worktree/provisioning/entryGate.ts:131-168`
- Status: accepted, persists from round 2 · Triage: accepted

**Evidence.** The fix classifies `path.basename(path.resolve(...)).toLowerCase()`. On Win32,
`path.resolve` preserves terminal dots/spaces in a component while ordinary filesystem operations
address the alias with them stripped. `pnpm-lock.yaml.`, `pnpm-lock.yaml `, `node_modules.`, and
`node_modules ` therefore miss the set while `lstat`/`open`/`symlink` act on the refused object.

**Invariant inventory.** Backslashes are refused; case is folded; trailing `/.` segments collapse and
are safe. Win32 terminal-dot and terminal-space aliases are affected. This is the same spelling versus
filesystem-identity mechanism as F004, so it retains the original ID.

**Impact.** A provider-controlled declaration can still materialize a lockfile or create the shared
`node_modules` link on a supported Windows filesystem, violating both mandatory refusals.

**Suggested fix.** Fail closed on any Win32 path segment ending in a dot or space before admission,
or canonicalize to the filesystem identity and refuse any spelling whose identity changes. Add one
acceptance witness per alias and per material rule.

---

## F002 — A full directory listing remains outside the time, node, and memory bounds

- Severity: WARN · Confidence: HIGH · Priority: P2 · Class: feature
- Agent: chair + asm-review-logic + asm-review-performance
- File: `src/worktree/provisioning/applyEntries.ts:413-415`
- Status: accepted, persists from round 2 · Triage: accepted

**Evidence.** `await deps.readdir(source)` constructs the whole children array before
`check(children.length)` runs and receives no cancellation signal. A large or stalled listing can
allocate O(N) names and hold the per-repository mutation queue past 60 seconds before zero children
are walked.

**Invariant inventory.** Oversized single files are precharged; an already-expired copy is stopped;
in-flight `pipeline` copies are abortable. Full listing allocation and the listing operation's own
lifetime remain affected.

**Impact.** D10's node/time language does not bound listing memory or pre-check duration, delaying the
create result and every queued mutation behind it.

**Suggested fix.** Enumerate incrementally with `opendir`, charging/checking between reads. If the API
change remains deferred, keep this as an explicit residual rather than describing the walk as fully
bounded.

---

## F017 — The merged create notice never regains its canonical worktree identity

- Severity: WARN · Confidence: HIGH · Priority: P2 · Class: feature
- Agent: asm-review-frontend; chair adjudication over the contracts review
- File: `src/webview/worktree/WorktreeController.ts:1365-1377, 1598-1634` at `ec0f777e`
- Status: accepted, persists from round 2 · Triage: accepted

**Evidence.** The create result arrives with the normalized `worktreeId`, but `rescope` removes it
while the fresh row is absent and keeps only `orphanedLabel`. `handleProvisionResult` now finds that
notice, but spreads it back without restoring `worktreeId`; later reconciliation immediately returns
an id-less result unchanged. The contracts review correctly confirmed that the immediate merge is one
notice, but did not refute this later identity loss.

**Invariant inventory.** Producer normalization is safe; ordered delivery is safe; the initial
orphan-label merge is safe. Reattachment when the row appears is affected, as is coexistence of two
create notices for different worktrees in one repository.

**Impact.** The notice remains repository-scoped instead of moving under its created row. A later
create in the same repository has the same undefined worktree identity and can replace the earlier
notice even though the two creates affected different worktrees.

**Suggested fix.** Preserve canonical identity separately from the temporary render anchor, or
rehydrate `worktreeId` from `orphanedLabel` when reconciliation sees that row appear. Add an assembly
witness spanning create result, provision result, then the rebuild containing the new row.

---

## F026 — The final notice misreports skipped and degraded entries as brought over

- Severity: WARN · Confidence: HIGH · Priority: P2 · Class: feature
- Agent: chair + asm-review-frontend
- File: `src/webview/worktree/WorktreeView.ts:1810-1833`
- Status: accepted · Triage: accepted, in both halves but for different reasons. The DEGRADATION half is a plain contract violation: PLAN WT-012.2 Acceptance requires that where the platform cannot symlink "the entry degrades to a copy and **says so per entry**", and the summary renders it identically to a copy. The SKIPPED half is weaker than the chair frames it — `provisionSummary`'s comment is a deliberate decision that an already-present file is not something to dwell on — but "1 of 1 brought over" for an apply that wrote nothing states an outcome this apply did not produce, so the count is accepted as wrong even though the omission of the reason is defensible.

**Evidence.** `provisionSummary` treats only `refused` and `failed` as non-arrivals, so `skipped` and
`degradedToCopy` both increment `arrived`. A top-level skipped entry renders as “1 of 1 brought over”
without its reason. A requested link degraded to a copy is rendered identically to an ordinary copy.
The changed tests cover refused and descendant-detail rows but no top-level skip or degradation.

**Impact.** The UI can claim material was brought over when it wrote nothing, and hides the contract's
required distinction between a link and a platform-forced copy.

**Suggested fix.** Render outcome-specific counts/rows for copied, linked, degraded-to-copy, skipped,
refused, and failed; include skipped reasons and state degradation explicitly.

---

## F016 — Direct link entries bypass node and deadline accounting

- Severity: WARN · Confidence: HIGH · Priority: P3 · Class: feature
- Agent: chair + asm-review-logic
- File: `src/worktree/provisioning/applyEntries.ts:435-458`
- Status: accepted, persists from round 2 · Triage: accepted

**Evidence.** A root-level link reaches `makeLink()` without `spend()` or `check()`. Chair reproduced
this against `nodeApplyFsDeps`: with `maxNodes: 0`, the step returned `linked`, created the symlink,
and left `budget.spent` at `{nodes:0,bytes:0}`. When no parent needs creation, an already-expired
budget likewise reaches the symlink attempt.

**Invariant inventory.** Directory child double-charging is fixed. Copy nodes and created parent
nodes charge. Direct links and their EEXIST skip arm are affected, including the deadline precheck.

**Impact.** The supposedly exact shared budget permits filesystem operations after its node or
wall-clock limit is exhausted; many direct links can bypass the node count entirely.

**Suggested fix.** Charge/check one node immediately before every direct-link attempt, including the
existing-destination arm, and add exact zero/one boundary witnesses using the production binding.

---

## F021 — Byte reconciliation happens after an over-budget write and measures a stat, not the transfer

- Severity: WARN (escalated from SUGGEST) · Confidence: HIGH · Priority: P3 · Class: feature
- Agent: chair + asm-review-logic
- File: `src/worktree/provisioning/applyEntries.ts:385-387, 506-529`
- Status: accepted, persists from round 2 · Triage: accepted

**Evidence delta for escalation.** Round 2 treated this as accounting honesty. The current fix shows a
stronger impact: `lstat` preauthorizes one size, `copyFileNoFollow` streams without a byte limiter,
returns a pre-stream fd `stat.size`, and only then calls `settleBytes`. A regular file that grows
between these readings or while streamed can write beyond `maxBytes`; even a truthful larger return
would be reconciled only after the excess landed.

**Impact.** The actual write can exceed the accepted apply-wide byte cap while the result still says
`copied`, so this is a failed bound rather than only an imprecise counter.

**Suggested fix.** Count transferred bytes through a limiting transform and abort before crossing the
remaining budget, or cap the stream to the authorized snapshot. Reconcile from measured transfer
bytes, not either stat snapshot.

---

## F027 — Production copy and mkdir do not preserve mode bits under the process umask

- Severity: WARN · Confidence: HIGH · Priority: P3 · Class: feature
- Agent: chair
- File: `src/worktree/provisioning/applyEntries.ts:318-333, 520-529`
- Status: accepted · Triage: accepted. Reproduced against the production binding rather than the fake: under `umask(0o077)`, a source file at mode `0777` arrived at `0700` and the step still returned `copied`. This is the fourth time in this change that a seam exercised only through a fake read as verified, which is recorded in workflow.md Notes as a standing hazard for this change — the fake stores the supplied mode verbatim and can never witness it.

**Evidence.** The production binding passes the source mode to `fs.open(..., mode)` and `fs.mkdir`,
but both creation calls apply the process umask and no later `chmod`/`fchmod` restores the source
bits. A real-filesystem scratch probe under umask `077` copied a source mode `0777` file and produced
mode `0700`, while returning `copied`. The fake stores the supplied mode verbatim, so its mode witness
cannot see this production-only behavior.

**Impact.** The approved D6/worktree-apply contract says mode bits are preserved. Group-readable or
shared executable configuration can silently lose permissions in the worktree.

**Suggested fix.** After exclusive creation, apply the mode from the opened source fd explicitly
(`fchmod`/`chmod`, masked to permission bits as intended); do the same for newly created directories.
Add production-binding mode witnesses under a nonzero umask.

---

## F011 — The new error conversion helper still has a second owner in provisioning

- Severity: WARN · Confidence: HIGH · Priority: P3 · Class: feature
- Agent: asm-review-reuse; chair scope correction
- File: `src/worktree/errorMessage.ts:11`; duplicate at `src/worktree/provisioning/asimovProvider.ts:447` in `ec0f777e`
- Status: accepted, reopened from round 1 · Triage: accepted

**Evidence.** The changed extraction declares one answer for user-visible thrown values and updates
`clearDebris`, `applyEntries`, and `worktreeMutationService`, but the reviewed Head's Asimov provider
still spells `error instanceof Error ? error.message : String(error)` inline for a user-visible
malformed-provider problem. The reuse agent also cited an Orca copy from the later checkout; chair
dropped that boundary because it did not exist at `ec0f777e`.

**Impact.** The same provisioning surface still has two owners for thrown-value display behavior, so a
future fallback or normalization change can make provider parse failures diverge from apply/mutation
failures.

**Suggested fix.** Route the Asimov provider's conversion through `messageOf` and keep the shared helper
as the sole owner at the reviewed revision.

---

## F019 — Valid parent names beginning with `..` are falsely refused

- Severity: SUGGEST · Confidence: HIGH · Priority: P4 · Class: feature
- Agent: asm-review-logic
- File: `src/worktree/provisioning/applyEntries.ts:347-359`
- Status: accepted, persists from round 2 · Triage: accepted

**Evidence.** The remediation changed the silent no-op to a refusal but retained
`relative.startsWith("..")`. An admitted in-root entry such as `..cache/config` has a parent relative
path `..cache` and is refused as outside even though no component equals `..`. Round 2 already named
this companion boundary; the fix closed only the resolved/spelled-root mismatch.

**Impact.** A valid provider declaration is rejected with a false containment reason.

**Suggested fix.** Reject only a path segment exactly equal to `..` (or use a boundary helper that
answers traversal structurally), not any basename with that prefix.

## Inline support review

- No changed test contains `.only` or `.skip`; no diff whitespace errors were found.
- The real-filesystem suite correctly protects the production `realpath` binding and ordinary copy,
  but does not cover descendant material classification, direct-link budget charging, stream-byte
  growth, or umask mode preservation.
- The view suite's current summary fixtures omit top-level skipped and degraded outcomes.
- No test-only finding survives separately; these coverage gaps are evidence attached to the
  behavioral findings above.

## Specialist adjudication notes

- Contracts confirmed F018 and F023 fixed and the immediate half of F017 fixed. Frontend supplied the
  unrefuted later reconciliation boundary, so F017 persists under the original rescope identity
  mechanism.
- Data-security's descendant finding also argued that linking an ancestor can expose a nested
  `node_modules`. The blocking finding is narrowed to the independently proven lockfile descendant
  path; the accepted design expressly names `node_modules` when it is the linked entry root.
- Reuse's Orca-provider boundary was outside the explicit range and was discarded; the Asimov copy
  existed at `ec0f777e` and sustains F011.
- Contracts' two suggestions were not findings: the first was a hypothetical future throw despite a
  currently total `applyEntry` call graph; the second described an intentionally behavior-equivalent
  empty selection.

## Audit backlog

None.

## Accepted risk

None.

## Sub-agents spawned

- `asm-review-data-security`: filesystem containment, material refusals, production binding — `gpt-5.6-sol[1M]`
- `asm-review-logic`: shared budget, deadlines, async/error arms — `gpt-5.6-terra[1M]`
- `asm-review-contracts`: wire/service identity and result contracts — `sonnet[1M]`
- `asm-review-frontend`: selection, ordered merge, reconciliation, notice truth — `gpt-5.6-terra[1M]`
- `asm-review-performance`: descendants/listing growth and queue-holding bounds — `gpt-5.6-luna[1M]`
- `asm-review-reuse`: helper ownership and split cohesion — `gpt-5.6-luna[1M]`
