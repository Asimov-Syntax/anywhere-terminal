# Review round 2 — prove-nobody-is-using-this-worktree

- Date: 2026-08-31
- Cycle: 1
- Mode: verification
- Head reviewed: `22a2f831004c3e86509f926bc1599657d68c1028` (explicit commit scope; checkout HEAD was later and the working tree had unrelated analytics edits)
- Diff scope: `git show --format= --find-renames 22a2f831`, plus the round-1 B2, B3(a), and W1 invariant boundaries and the author's impact manifest
- Scope lock: passed — the target commit contains remediation plus task/analytics metadata, with no new capability, semantic contract, or invariant owner
- Reviewable lines: 202 added/modified across 6 reviewable files, including change analytics metadata; 124 added/modified test lines reviewed inline; `tasks.md` was skipped as non-behavioral Markdown context
- Agents spawned: 3 (`asm-review-data-security`, `asm-review-logic`, `asm-review-contracts`)
- Agents skipped: frontend (no UI change), performance (the chair traced the narrowed growth-axis fix; no new growth mechanism), reuse (the one-home extraction is directly in the verification cone and was covered by logic/contracts)
- Verdict: **WARN**
- Counts: 0 BLOCK · 1 WARN · 0 SUGGEST

No project verify command was run by the chair. The caller reports check-types exit 0, 5,859 tests passing, and Biome at the recorded baseline. The post-target workflow record at `e9851f0f` records the target-specific gate as check-types exit 0, 5,855 tests passing, and the same Biome baseline; the count difference comes from the later checkout, not a failing target gate.

## Verification outcomes

### [B2] The registry refactor changes which duplicate session blocks removal

- Severity: BLOCK · Confidence: HIGH · Priority: P1
- Agent: chair, corroborated by `asm-review-logic` and `asm-review-contracts`
- Class: feature
- File: `src/vault/readers/runningSessions.ts:303-315`; `src/extension.ts:784-810`; `src/worktree/worktreeBlockers.ts:323-333`
- Status: fixed
- Triage: verified

**Evidence.** `canonicalLiveSessions` is the prior live-filter plus the same `winsDedupe` loop in its original module. The producer calls it over every record before target containment, reconstructs the selected live records by their unique registry PID, and passes only that canonical view to `evaluateRemoval`. The evaluator now performs containment and pane-claim handling only; it no longer live-filters or dedupes survivors.

**Impact.** The old global winner-before-containment behavior is restored: an interactive canonical record outside the target is not replaced by a losing headless duplicate inside it.

**Suggested fix.** Implemented. Keep the selection rule in `runningSessions.ts` and keep `SessionRecord` free of downstream selection metadata.

### [B3] New proof-only filesystem work can hold the removal assessment open

- Severity: BLOCK · Confidence: HIGH · Priority: P1
- Agent: chair, corroborated by `asm-review-logic`
- Class: feature
- File: `src/extension.ts:784-814`
- Status: fixed
- Triage: B3(a) verified in this commit; B3(b) was fixed by task 4_1 outside this explicit commit scope

**Evidence.** The producer filters to live records before `paths.prepare`, so dead crash records no longer add user-wide stale-history realpaths. Passing only undeduped live records to `ownerProof` is outcome-equivalent to passing dead records too: on a successful read the proof's only record-dependent predicate is existence of a contained `alive` record; complete-with-no-live remains `passed`, partial-with-no-live remains `unproven`, found-live remains `failed`, and failed reads remain `unproven`.

**Impact.** The dead-history fan-out is removed without changing any proof outcome. The commit does not worsen WT-013.1's open abandoned-read/no-cross-assessment-dedupe mechanism; it reduces the realpath inputs that can participate in it.

**Suggested fix.** Implemented. Preserve the undeduped live view for ownership and the canonical live view for refusal.

### [W1] A partially unreadable registry can be reported as a complete `ownerGone` pass

- Severity: WARN · Confidence: HIGH · Priority: P2
- Agent: chair, corroborated by all three specialists on the scoped owner-proof behavior
- Class: feature
- File: `src/vault/readers/runningSessions.ts:263-292`; `src/extension.ts:805-840`; `src/worktree/orphanProofs.ts:125-139`
- Status: fixed
- Triage: verified

**Evidence.** A matching candidate whose `readFile` rejects sets `partial = true`; malformed payloads remain read-and-rejected non-records and do not mark the scan partial. The producer carries the bit beside both views and forwards it to the ownership proof. `ownerProof` returns `failed` first when a contained live record was found, then returns `unproven` rather than `passed` when absence came from a partial scan.

**Impact.** An unreadable candidate can no longer become a confident proof that no owner remains, while evidence of a live owner cannot be weakened by the incomplete scan.

**Suggested fix.** Implemented. Keep scan completeness separate from record validity.

## Findings

### [W3] The central two-view producer is not exercised by the replacement tests

- Severity: WARN · Confidence: HIGH · Priority: P2
- Agent: chair, corroborated by `asm-review-contracts`; `asm-review-logic` independently noted the same uncovered seam
- Class: feature
- File: `src/extension.ts:764-840`
- Status: open
- Triage: pending

**Evidence.** `runningSessions.test.ts` proves the selection helper and partial bit in isolation; `worktreeBlockers.test.ts` and `orphanProofs.test.ts` inject already-correct views directly; `WorktreeHost.actions.test.ts` makes `live` and `canonical` identical with `partial: false`; and the assembly test only counts one registry read against an empty/default registry. Therefore every changed test still passes if the one production closure swaps `live` and `canonical`, replaces the canonical PID selection with all live records, drops `partial`, or resumes realpathing dead records. Task 4_2 explicitly calls for proving that a dead cwd is never resolved, but no changed test can observe the producer's resolution set.

**Impact.** The exact integration seam that closes B2, B3(a), and W1 can regress while the suite stays green. At this boundary that can restore the wrong duplicate refusal, hide a losing live PID from the ownership proof, or turn an incomplete scan back into confident absence before an irreversible removal.

**Suggested fix.** Add a focused producer/assembly test with an interactive canonical record outside the target, a losing live duplicate inside it, a dead record whose cwd resolution is observable, and a partial scan. Assert that refusal reads the outside canonical winner, ownership reads the undeduped live inside record, the partial bit reaches `ownerGone`, and the dead cwd is never resolved.

## Prior findings outside this explicit commit

Round-1 B1, B3(b), and W2 were remediated by task 4_1 before `22a2f831`; this commit-scoped round did not re-review those earlier fix hunks and does not change their round-1 author triage.

## Adjudication notes

- `asm-review-data-security` proposed a BLOCK because `evaluateRemoval` does not treat `SessionRead.partial` as an unavailable external-session refusal. Rejected for this commit: before `22a2f831`, a candidate `readFile` rejection was already omitted from the live refusal input, and the evaluator already decided from the surviving records. This target preserves that explicitly accepted compatibility behavior while adding completeness only for the new `ownerGone` proof. There is no changed impact or new bypass mechanism in the reviewed commit, so the unchanged broader policy is not re-filed here.
- `asm-review-contracts` reported two stale explanatory comments around `WorktreeHostOptions.removalFacts.sessions` and `SessionRecord.alive`. Dropped under the no-formatting/style rule: the runtime types and behavior are correct, and neither comment changes execution or a behavioral source.
- The replacement tests claim the right responsibilities at their module owners: liveness and winner selection belong to `runningSessions.ts`; `evaluateRemoval` consumes a preselected canonical view. W3 is the remaining composition gap, not a request to move those assertions back downstream.
- No changed test adds `.only` or `.skip`.

## Audit backlog

None.

## Accepted risk

None.

---

## Author triage (round 2)

### [W3] The central two-view producer is not exercised by the replacement tests

- Status: accepted
- Triage: Confirmed, and it is the same blind spot this change already paid for once — a module test asserting against its own injected fake cannot see a wrapper that composes them wrongly. Every suite around the closure was handed an already-correct pair, so swapping the views, dropping `partial`, using every live record as canonical, or resuming dead-record resolution all left the suite green. Fixed in 4_3 by giving the composition an owner: `src/worktree/sessionViews.ts` takes the raw records and an injected resolver and returns the two views, and `extension.ts` calls it. All four mutations the finding names are now killed, including "never asks the resolver about a dead record's path", which is what makes B3(a) observable rather than an equivalent mutant at the seam that matters.
