# Asimov Review Round 4

- Date: 2026-08-30
- Cycle: 4
- Round: 4
- Mode: discovery
- Requested mode: fastlane
- Scope: commit range `4e401984..ffab7133e1e9a311eed7a42364b8eaede2a1ffcb`
- Head: `ffab7133e1e9a311eed7a42364b8eaede2a1ffcb`
- Tree: dirty outside the explicit range; current analytics/workflow/active-state updates, `skills-lock.json`, four unrelated reformatted tests, and unrelated audit/research documents were excluded
- Reviewable lines: 2,402, including 1,828 lines of generated Asimov analytics/build metadata; 1,069 added test lines reviewed inline
- Size note: Large change — accuracy may decrease
- Flags: security-privacy
- Recorded verification cited, not rerun: check-types clean, 5,442 unit tests, I10 gate ok; `biome check src` 0 errors / 14 warnings / 0 infos with the documented unrelated baseline drift
- Agents spawned:
  - `asm-review-logic` — admission accounting, handoff and eviction races — `opus[1M]`
  - `asm-review-performance` — distinct-store growth, byte/count bounds and retry cost — `gpt-5.6-terra[1M]`
  - `asm-review-data-security` — stale-absence safety and sensitive temp-file lifetime — `sonnet[1M]`
  - `asm-review-logic` — borrow/release/dispose/idle full lifecycle — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — D1-D5, status mappings and hard task outcomes — `gpt-5.6-luna[1M]`
  - `asm-review-reuse` — freshness/lifecycle ownership and capacity-shape cohesion — `gpt-5.6-luna[1M]`
  - `asm-finder` — caller, consumer, absence and shutdown flow inventory — support search, `gpt-5.6-luna[1M]`
- Agents skipped:
  - `asm-review-frontend` — no React, webview, rendering, client-state or accessibility changes
- Verdict: BLOCK
- Counts: 2 BLOCK / 1 WARN / 0 SUGGEST
- Split over gating blockers: 1 feature / 1 machinery

## Risk map and full-flow trace

- Correctness hot path: every `readSqlite`/`withSqliteSnapshot` call selects Node or CLI, proves database presence, reads a coherent generation, leases a retained equal-generation snapshot, queries it, and releases in `finally`. No stale-hit or false-absence defect survived this round.
- Correctness cold path: the engine creates an atomic snapshot, the generation is re-read, only a stable before/after generation is retainable, and snapshot/open failures map to `db-unreachable` or `query-error`, never successful empty rows.
- Coalescing path: a caller joins an in-flight snapshot only when its own usable generation equals the flight's start generation; a mismatch waits with a bound and rechecks disposal before producing independently.
- Consumers: Codex/OpenCode/Cursor list, detail, point-lookup and identity paths preserve the status distinction. Confirmed `absent` results can suppress/remove live rows, so D1/D4 remain security-relevant; the changed generation and status paths fail closed.
- Capacity/lifetime path: distinct store paths grow per user/session history; retained count/bytes are structurally capped, but the transition from synchronous admission to asynchronous handoff/deletion is not. That seam owns the two blockers below.
- Shutdown path: extension deactivation closes the default pool, drains admitted borrows and leases, then deletes `liveEntries`; the admitted-work barrier itself held under review.

## Prior finding disposition

- B1, B2, B3, B4, B5, W1, W2, W3, W4 and W5: fixed and confirmed in the current range.
- B6: fixed at its stated invariant. The retained-map count/byte decision, victim selection and insertion now execute without a suspension point, including supersession and the oversized early return. B7 is a new handoff/lifetime race created after that decision, not persistence of the original read-check-insert race.
- W6: the original mechanism is fixed narrowly: failed deletions remain owned, are entered in a retry set and are charged after failure. B8 is a distinct post-decision and unknown-size mechanism showing that the broader hard live-byte outcome still does not hold.
- R3: remains rejected; the coherent generation read has a valid pre-write linearization interval.

## Findings

### B7

- ID: B7
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic` (corroborated by chair)
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/snapshotPool.ts:172,227-229,263-285`
- Title: Concurrent admission can delete a snapshot before its producing borrow receives the lease
- Evidence: `admitWithinOneTurn()` inserts a new entry with `leases === 0`, then `produce()` resolves; the producing caller increments the lease only in the later continuation of `this.lease(await flight.promise)`. A distinct-store producer can run its synchronous admission first, select that just-produced zero-lease entry as LRU, remove it, and `discard()`/`destroy()` its directory before the first caller resumes. The logic specialist reproduced the existing four-producer sizing-barrier scenario with `maxEntries: 1`: all four `borrow()` calls resolved, but three returned `lease.file` paths were already absent. The committed concurrency test checks only `retainedCount`, so it passes without opening or statting the returned files.
- Invariant: every successful borrow must establish reader ownership before any supersession, capacity eviction, idle eviction or disposal path may destroy its file. Boundary inventory searched: retained hot hit, producer's first handoff, same-generation joiners, distinct-store concurrent admission, supersession, oversized one-shot, LRU eviction, idle eviction, release and disposal. Affected: the producer's first handoff under concurrent distinct-store admission. Verified safe: already-established leases; retained hits; joined callers after the entry promise has settled; shutdown waits after lease accounting exists.
- Impact: concurrent vault list/detail/lookup work can receive a successful lease to a deleted SQLite snapshot. The subsequent Node or CLI query fails as `query-error`, making live vault reads intermittently unreadable under exactly the concurrency B6's tests create and violating D3's no-deletion-under-readers contract.
- SuggestedFix: establish a birth/handoff lease before publishing the entry as evictable, or track a not-yet-handed-off state that `discard()` cannot destroy and that the first release clears. Extend both concurrent-admission tests to assert every returned `lease.file` remains readable until its own release.
- Status: new
- Triage: pending

### B8

- ID: B8
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `chair` (corroborated by `asm-review-performance` and `asm-review-logic`)
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/snapshotPool.ts:194-217,227-229,263-285,368-397`
- Title: The no-reservation admission shape cannot enforce the hard live-byte budget
- Evidence: the synchronous block subtracts a victim's bytes before its disk is releasable, inserts the newcomer, and only afterwards awaits `discard()`. If the victim is leased, its disk remains until release but is counted nowhere. If deletion fails, `undeletedBytes` is charged only after the newcomer has already committed. The new W6 test itself demonstrates the missed invariant: with a 250-byte cap and 100-byte snapshots, refreshing A leaves retained A' (100) plus undeleted A (100); admitting B evicts and subtracts A', inserts B at an apparent 200 bytes, then A' deletion fails and the real owned total becomes 300. `retainedCount === 1` still passes. Further admissions can add failed evicted and one-shot snapshots without bound. Separately, a failed `take()` reaches `destroy()` before sizing, and a failed `sizeOf()` explicitly records `entry.bytes = 0`; if deletion also fails, a partial/full sensitive snapshot enters the undeleted ledger with zero weight.
- Invariant: every byte of snapshot disk the pool still owns must remain charged from creation/handoff through actual deletion, and admission must not publish a newcomer against space that an asynchronous cleanup has not freed. Boundary inventory searched: retained entries, first handoff, evicted active leases, pending deletion, failed deletion, retry, oversized one-shots, production failure, sizing failure, idle sweep, supersession and disposal. Affected: evicted leased entries, pending/failed victim deletion, failed production before sizing and failed sizing. Verified safe: synchronous retained-map count and retained-byte counters when every selected victim is already physically gone; successful retry releases charged undeleted bytes.
- Impact: repeated deletion/size failures grow temp disk with the distinct-store history axis despite the configured 1 GiB cap, and can leave full-content session snapshots behind with zero accounting. This fails D3 and task 4_2's hard backpressure outcome. The evidence delta from round-3 W6 is that the attempted fix's exact test reaches 300/250 while green: patch-level accounting has not produced a bounded design.
- SuggestedFix: hand the capacity/lifetime mechanism back to planning rather than add another local counter. Use one bounded-by-construction live ownership model: reserve/charge pending and leased bytes before publishing, or serialize cleanup plus admission and queue/refuse new production when real space has not been freed. Failed/unsized partial snapshots need conservative charging. Tests must assert actual owned live bytes across pending, leased and undeleted states, not only `retainedCount`. The current explicit no-reservation/no-serialization shape cannot satisfy the accepted hard-live-byte contract.
- Status: new
- Triage: pending

### W7

- ID: W7
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `chair` (corroborated in part by `asm-review-contracts`)
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/snapshotPool.ts:303-319,391-424`
- Title: Idle retries stop when failed cleanup is the only state left
- Evidence: `evictIdle()` retries the existing undeleted set before evicting retained entries. If deletion of the final retained entry then fails, the method adds it to `undeleted` and immediately stops the interval because `retained.size === 0`; no later idle sweep retries it. A failed deletion on release of an unretained one-shot likewise never starts a sweeper when no retained entry exists. The next attempt therefore waits for another admission or shutdown, despite D3/task 4_2 stating retries occur on admissions and idle sweeps. The five-attempt ceiling itself is intentional and was not reported.
- Invariant: while an undeleted entry remains retry-eligible, the cleanup scheduler must have a bounded path to revisit it even when no reusable entry remains. Boundary inventory searched: admission retry, idle retry before eviction, failure during final idle eviction, one-shot release, terminal attempt cap and shutdown. Affected: final-idle and one-shot failures in an otherwise quiet pool. Verified safe: later admissions retry; disposal retries and reports persistent failure.
- Impact: a transient EBUSY/EIO after the last retained snapshot can leave sensitive session data in the temp directory for the rest of an idle extension-host lifetime, instead of consuming the promised bounded retry attempts.
- SuggestedFix: keep a bounded/backed-off cleanup timer or queue alive while retry-eligible undeleted entries exist, and stop only when the set is empty or every entry reaches the intentional attempt ceiling.
- Status: new
- Triage: pending

## Inline support review

- Changed production behavior has corresponding focused pool, SQLite and generation tests; no `.only`, `.skip`, disabled case, unawaited async assertion, secret-bearing fixture or destructive seed was introduced.
- The B6 concurrency tests discriminate suspension between the retained-capacity decision and insertion, but omit the returned lease lifetime assertion exposed by B7.
- The W6 test asserts an exact retained count, but does not expose or assert actual live owned bytes; its own sequence crosses the configured byte budget as described in B8.
- Generated analytics include the same author email already present in Git commit metadata; no additional credential, token or secret exposure was found.

## Rejected or merged specialist candidates

### R4

- ID: R4
- Proposed: BLOCK / HIGH / P1
- Agent: `asm-review-performance`
- Title: All in-flight and leased snapshots must fit the retained budget
- Status: partially merged into B8; otherwise rejected
- Triage: the concrete evicted/pending-owned byte gap is in B8. The proposed 1,000-store concurrent scan is not the repository flow: Cursor's candidate walk is sequential, and the accepted count cap is explicitly for retained entries. The report therefore does not claim every transient production must fit the retained count cap.

### R5

- ID: R5
- Proposed: BLOCK / HIGH / P2
- Agent: `asm-review-performance`
- Title: Every admission rescans an unbounded undeleted set
- Status: merged into B8's shape handback, not separately gating
- Triage: the retry scan becomes unbounded only because the owned-failure set can grow outside the live-byte model. A bounded retry queue is part of B8/W7's remedy; reporting the downstream O(N) cost separately would double-count the same causal state.

### R6

- ID: R6
- Proposed: WARN / HIGH / P1
- Agent: `asm-review-contracts`
- Title: Failed deletions do not count against the entry budget
- Status: rejected
- Triage: D3 caps retained entry count and live owned bytes; task 4_2 and the caller brief explicitly require failed deletions to count against live bytes, not the retained-entry count.

### R7

- ID: R7
- Proposed: WARN / HIGH / P2-P3
- Agents: `asm-review-contracts`, `asm-review-logic`
- Title: Retry attempts permanently stop after five failures
- Status: rejected in that form; idle-scheduler portion merged into W7
- Triage: the caller explicitly states retries are bounded by attempt count, so the five-attempt ceiling is intentional. W7 preserves the distinct defect that eligible attempts are never scheduled when only undeleted state remains.

### R8

- ID: R8
- Proposed: SUGGEST / MEDIUM / P4
- Agent: `asm-review-reuse`
- Title: Stamp construction loops are duplicated
- Status: rejected
- Triage: the two short loops deliberately own different error policies: permissive list-cache stamping versus fail-closed coherent generation proof. Path-set and equality ownership are already shared; no concrete drift defect was established.

### R9

- ID: R9
- Proposed: WARN / MEDIUM / P4
- Agent: `asm-review-data-security`
- Title: Persistent shutdown deletion failure is only logged
- Status: rejected
- Triage: disposal reports failure and extension deactivation logs it; no accepted contract requires a user notification during host shutdown, and a notification is not a reliable cleanup mechanism.

### R10

- ID: R10
- Proposed: SUGGEST / MEDIUM / P5
- Agent: `asm-review-data-security`
- Title: The shipped list cache still uses permissive single-pass stamping
- Status: dropped as unchanged code
- Triage: the range only centralizes its path list. Re-reviewing the shipped cache's existing rigor is outside this change absent a critical security regression.

---

## Author triage — cycle 4 / round 4

**[B7] Concurrent admission can delete a snapshot before its borrow receives the lease** — Status: accepted
Triage: correct, and it also condemns my own test. 4_1 asserted `retainedCount` — a proxy — while the
reviewer's probe asserted the property that actually matters and found three returned leases whose
files were already gone. A lease must be taken at publication, before the entry can be anyone's
victim, and the concurrency tests must assert every returned lease is still readable until its own
release.

**[B8] The no-reservation admission shape cannot enforce the hard live-byte budget** — Status: accepted, and it is the shape finding I asked for
Triage: correct, and I am taking the recommendation rather than adding another counter. Bytes are
subtracted from victims before their disk is releasable and the newcomer is inserted before deletion
completes, so "live bytes" is an estimate wearing the costume of a hard cap. Three cycles of local
counters have not made it one.
Measured on this machine, which is what makes the cut obvious: Cursor CLI per-chat stores are 60 KB
each and there are 72 of them (~4 MB in total), while `opencode.db` is 1.4 GB, Cursor IDE's
`state.vscdb` is 122 MB and Codex's `state_5.sqlite` is 400 KB. The unbounded-count axis that forced
LRU and byte accounting is composed ENTIRELY of files too small to matter, and the files that matter
are a fixed set of one per agent. The machinery exists to referee a competition between the two, and
that competition was never real.

**[W7] Idle retries stop when failed cleanup is the only state left** — Status: accepted
Triage: correct. `evictIdle` stops the sweeper on `retained.size === 0` even with retry-eligible
entries outstanding, and a failed one-shot release never starts one, so a transient failure can hold
session data for the rest of an idle host's life.

### Disposition — handback, and the machinery is cut rather than patched

Fourth cycle, and B8 explicitly directs the mechanism back to planning. The replacement is bounded by
construction instead of by enforcement:

- Retention becomes opt-in per call site. The readers of the fixed primary stores (codex, opencode,
  cursor IDE) retain; the per-chat Cursor path does not, because a 60 KB snapshot is not worth
  retaining and its unbounded count is the only reason capacity accounting existed.
- The retained set is therefore keyed by a fixed, small set of store paths computed from fixed
  locations. No LRU, no byte budget, no capacity eviction, no reservation — the bound is "one
  snapshot per agent", stated and true, rather than enforced and false.
- B7 dissolves along with cross-store eviction: with no LRU there is no foreign victim, and the
  remaining same-store supersession is closed by taking the lease at publication.
- W7 survives as a smaller obligation: keep retrying while anything undeleted remains.

This is a cut in mechanism, not in guarantee. Reuse is still gated on a coherent generation (D1,
confirmed fixed in cycle 3), still never answers `absent` from a stale snapshot, and still deletes
nothing under a reader.
