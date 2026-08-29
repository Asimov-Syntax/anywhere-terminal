# Review Round 2 — source-the-agent-row-preview

- **Date**: 2026-08-30
- **Cycle**: 1
- **Mode**: verification
- **Scope**: `git diff f19874e8..7a69d253` (1 commit: 7a69d253 "fix(source-the-agent-row-preview): close round-1 blockers and accepted warnings")
- **Head**: 7a69d253 — working tree clean
- **Reviewable lines**: ~162 changed across 4 reviewable files (+ 1 spec delta reviewed by the chair inline)
- **Scope lock**: PASSED. Every source change traces to an accepted round-1 finding; `tasks.md` gains task 2_1 (remediation record, task-completion metadata is not scope); the one `codexReader.ts` line widens `pickRolloutPath`'s visibility, which reduces ownership rather than creating a new invariant owner. No new capability, no design delta.
- **Agents spawned**: 4 (logic, data-security, performance, contracts) — cone-scoped, per the verification contract.
- **Verdict**: BLOCK
- **Counts**: 1 BLOCK / 3 WARN / 3 SUGGEST (new this round) · 11 round-1 findings verified fixed · 6 carried as audit-backlog · 1 rejected
- **Split over gating blockers**: 1 feature / 0 machinery
- **Verify gate**: not re-run by review. Cited from the coordinator: type check pass, 5116 unit tests pass, `biome check src` byte-identical to the `1a907750` baseline (5 errors / 14 warnings / 3 infos, none in files this change touches).

---

## Round-1 findings — verification results

| ID | Round-1 severity | Status | Evidence |
|---|---|---|---|
| B1 | BLOCK | **fixed** | Delta restated clause-by-clause against `asimov/specs/agent-session-index/spec.md:51-66`. Subject back to "The system"; `SHALL NOT persist or cache any transcript content beyond the two bounded previews` restored; "under the extension's storage" restored; "NEVER transmitted off the machine" restored; the "governs the listing path only" re-scoping sentence removed. Exactly one MAY added. Nothing new smuggled in. |
| B2 | BLOCK | **fixed** | `Target` is now `{kind:"uncovered"} \| {kind:"unresolved"} \| {kind:"resolved",...}`. `uncovered` short-circuits before `deps.entry()`, permanently and with no syscall; `unresolved` is retried on cadence. No path pins a failed resolution. Verified by `previews a session whose transcript only appears later` and `keeps costing nothing for an uncovered source however often it is asked`, both against real temporary files. |
| W1 | WARN | **fixed** | `forget()` clears `stamp` and `line`. Code, test (`drops the preview when the transcript is gone`), design.md § Failure surface and the `worktree-agent-presence` delta now all say the same thing. Clearing the stamp is load-bearing, not an overcorrection — keeping it would make the next matching `stat` return `undefined` permanently via the unmoved-stamp branch. |
| W2 | WARN | **fixed** | The local `isInside` no longer owns Codex resolution; the branch calls the now-exported `pickRolloutPath`, fallback included. Verified by `finds a codex rollout the index did not name, by the repo's own fallback`. |
| W4 | WARN | **fixed** | `const { bytesRead } = await handle.read(...)` + `buf.toString("utf8", 0, bytesRead)`. The specialist reproduced the pre-fix failure with a scratch probe (truncate between `stat` and `read` → `bytesRead: 80` against `requested: 1025`, 945 NULs glued onto the newest record). See S2-R2 for the testability correction. |
| W6 | WARN | **fixed** | Resolved in both directions. The delta now says "for a session whose transcript it can locate by id", and that is truthful of both branches: `readClaudeEntry` (`claudeReader.ts:450-467`) and `readCodexEntry` (`codexReader.ts:568-594`) each resolve by id on every call, so `deps.entry()` IS the by-id step and `entry.sessionPath` is its freshly-derived output. The vault's D9 ("the host re-derives this path by id, never trusting it") is satisfied — the service containment-checks the host's own derivation rather than a webview path. |
| S1 | SUGGEST | **fixed** | `start = Math.max(0, size - window - 1)` + `if (!reachedHead && !text.startsWith("\n"))`. New test `keeps a record that ends exactly on the cap's window boundary` exercises it at the cap, where there is no next doubling. |
| S2 | SUGGEST | **fixed** | `window = Math.min(window * 2, MAX_WINDOW_BYTES)`. Cumulative bytes per call remain ≈2 MB, constant in transcript size. |
| S3 | SUGGEST | **fixed** | `PreviewEntry.agent: VaultAgentId`, narrowed at the wiring site by `VAULT_AGENT_IDS.find(...)`; an unrecognised provider is answered `null` rather than reaching a coverage branch. |
| S5 | SUGGEST | **fixed, with a regression** | `checkedAt` is no longer advanced by a failed look. The intent holds; the implementation removed the floor entirely — see W1-R2. |
| S6 | SUGGEST | **fixed, with a regression** | A completed read is no longer stranded. The re-seat introduced a clobber — see W2-R2. |

**Carried forward as `audit-backlog`** (valid, non-gating, not re-reported): W3 (lexical containment without `realpath` — repo-wide across `claudePaths.ts` ×3, `codexReader.ts:1065` and the service), W5 (LRU thrash above 256 rows), S4 (signature field separators), S7 (sequential worktree batches), S8 (delegated/subagent rows uncovered), S10 (preview duplicates the title on a short session).

**Rejected, not re-reported**: S9. The coordinator's reasoning is accepted — the projector's dep is mocked, so a projector-level assertion would only prove a stub returned two strings, which is why the verification lives in the service against a real file.

---

## New findings

## B1-R2 — The two fixes together walk the entire Codex sessions tree every 2 s, forever

- **Severity**: BLOCK · **Confidence**: HIGH · **Priority**: P1
- **Agent**: asm-review-performance (corroborated by chair)
- **Class**: feature
- **File**: `src/worktree/sessionPreviewService.ts:126-134` → `src/vault/readers/codexReader.ts:1070-1094`
- **Evidence**: Neither fix causes this alone; their composition does. **B2's fix** made `unresolved` a retryable state — an entry that fails to resolve re-runs `resolve()` on every ask past `recheckMs` (2000 ms), indefinitely, and `checkedAt` IS advanced on that path (the look resolves, it does not reject), so the retry recurs forever at a steady 0.5 Hz. **W2's fix** routed resolution through `pickRolloutPath`, whose miss path is `findCodexRolloutByFilename` — a recursive DFS over the whole sessions tree (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`) that returns early only on a hit; **a miss walks every directory and compares every dirent**. A Codex entry whose `threads.rollout_path` is NULL or uncontained passes `null` as the `thread` argument and goes straight to that scan.
  This is genuinely new, not a pre-existing cost newly noticed: `readCodexEntry` (`codexReader.ts:568-594`) takes the SQL path and calls `findCodexRolloutByFilename` **only** in the `no-db` / `no-sqlite3` branch, so before this commit the scan was paid once per user-initiated detail open, never on a passive per-row cadence. There is no negative cache, no backoff, and no memoisation between retries.
- **Impact**: Growth axis: the Codex sessions tree, which grows monotonically with the user's history and is never pruned by this extension. One unresolvable Codex row on screen is enough — a year of use is ~365 date directories and thousands of dirents re-walked every two seconds, as background I/O the user never asked for, on a panel that refreshes itself. This is the exact class D2 exists to prevent, and W5's "implausible row population" defence does not apply: the trigger is a single row, not 256. Claude rows are unaffected (their `resolve` does only a lexical check); `uncovered` sources short-circuit correctly.
- **SuggestedFix**: Give `unresolved` a backoff distinct from the freshness cadence — an exponential or fixed longer interval for resolution attempts (a session that has no transcript now rarely acquires one within 2 s), or memoise a negative scan result against the sessions tree's own mtime so a miss is not re-walked until the tree changes. The cheap form: track consecutive resolution failures on `Held` and multiply the retry interval.
- **Status**: accepted · **Triage**: Correct, and neither fix caused it alone — the composition is mine. `unresolved` retrying on the freshness cadence is only safe when resolution is cheap, and W2's fix made the Codex miss path a recursive walk of a monotonically growing tree. Fixed with a per-entry backoff on consecutive resolution failures, distinct from the freshness interval, so one unresolvable row costs a walk at a decaying rate rather than 0.5 Hz forever.

## W1-R2 — The rejection path removes the rate limit entirely

- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P2
- **Agent**: asm-review-logic
- **Class**: feature
- **File**: `src/worktree/sessionPreviewService.ts:212-218`
- **Evidence**: `look(...).then(line => { current.checkedAt = now(); return line; }, () => forget(current))` — `checkedAt` is advanced only on fulfilment. It initialises to `Number.NEGATIVE_INFINITY`, so `now() - current.checkedAt < recheckMs` is never true and the fast path at `:205` never fires. Enumerating what can actually reject inside `look()`: `defaultStat` catches and returns `null`; `readLastActivityLine` catches everything and returns `null`; `findCodexRolloutByFilename` `continue`s on `readdir` failure and never throws; the Claude branch awaits nothing. The one live rejection source is `deps.entry()`, wired at `extension.ts:674` to `vaultService.getEntry`. The service's own test demonstrates the mechanism: `retries on the next ask rather than waiting out an interval it never used` performs two full executions at an unchanged `clock`.
- **Impact**: A persistently rejecting vault lookup turns into an unthrottled retry storm — N rows × ~6.7 asks/s (the 150 ms projection cap) against the failing dependency, with no backoff — which is the invariant D2 is written to hold ("the number of filesystem calls the previews cost SHALL NOT grow with the rate at which presence rebuilds"). Before this commit `.catch(() => current.line)` plus an unconditional `finally` capped it at one attempt per interval per row. S5 asked for a faster retry than a full interval; it got no floor at all.
- **Chair note**: WARN, not BLOCK. The mechanism is proven by the shipped test, but the trigger — `vaultService.getEntry` rejecting rather than returning `null` — is not demonstrated to occur; both file-backed adapters catch internally and return `null`.
- **SuggestedFix**: Keep S5's intent with a floor: on rejection set `current.checkedAt = now() - recheckMs + RETRY_FLOOR_MS` for a few-hundred-ms floor, and extend the retry test to assert the second ask is refused at an unchanged clock but allowed after the floor.
- **Status**: accepted · **Triage**: Right: S5 asked for a faster retry than a full interval and I gave it no floor at all. The gate becomes an explicit `nextAt` that both paths set — a rejection schedules a short floor, a fulfilment schedules the cadence or the backoff.

## W2-R2 — The S6 re-seat can overwrite a newer `Held` with the stale one

- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P3
- **Agent**: asm-review-logic
- **Class**: feature
- **File**: `src/worktree/sessionPreviewService.ts:225-230`
- **Evidence**: The `finally` calls `touch(entryId, current)` whenever `held.get(entryId) !== current`, testing inequality only — never whether the mapped instance is newer. Reachable sequence: H1 in flight for id E; enough other ids are asked to evict E; a new ask for E finds nothing mapped, builds H2, `touch`es it and starts its own `look` (H2's `checkedAt` is `-Infinity`, so it always does full work); H1's `finally` then sees `held.get(E) === H2 !== H1` and `touch(E, H1)` replaces H2. Two consequences: during the overlap the map does not point at H2, so H2's `inflight` is invisible and further asks start additional reads — the one-read-per-session dedup at `:202` is defeated; and whichever instance loses the final flip has its `stamp`, `line` and `checkedAt` discarded, so a completed successful read can be replaced by an instance holding none.
- **Impact**: Duplicate transcript reads and a dropped preview for one interval. The clobber is new in this commit — the pre-fix code stranded the result instead of overwriting a newer one.
- **Chair note**: WARN, not BLOCK, and consistent with how W5 was adjudicated: reachability is confined to the >256-entry regime whose row population this panel does not plausibly reach.
- **SuggestedFix**: Re-seat only when the id is genuinely unmapped (`else if (!held.has(entryId))`), or have `preview()` re-read `held.get(entryId)` after the await so a fresh instance wins deterministically.
- **Status**: accepted · **Triage**: My re-seat tested inequality when it needed to test absence. Re-seating only when the id is unmapped restores the stranding — which is the correct loss, since a newer instance does its own work.

## W3-R2 — design.md D1a now describes something other than what ships

- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P3
- **Agent**: asm-review-contracts
- **Class**: feature
- **File**: `asimov/changes/source-the-agent-row-preview/design.md` § D1a
- **Evidence**: D1a states a Codex entry "carries `sessionPath` from `rollout_path` and is file-backed only when that resolves (`codexReader.ts:141-165`)". After the W2 fix that is no longer the rule: `pickRolloutPath` falls back to a by-uuid filename scan, so a Codex session with a stale or absent `rollout_path` IS file-backed and does get a preview — which is the whole point of the fix, and is what the new test `finds a codex rollout the index did not name, by the repo's own fallback` asserts. design.md was not updated in this commit.
- **Impact**: The accepted design artifact now understates the shipped coverage and mis-describes the resolution mechanism. It is the document a later change reads to learn what this seam does, and it is also the artifact that would have made B1-R2's cost visible at design time — the fallback's scan is invisible in D1a's account.
- **SuggestedFix**: Amend D1a to describe resolution as "the index's path when contained, else the repo's by-uuid scan", and note the scan's cost so the retry cadence question (B1-R2) is settled in the design rather than in the service.
- **Status**: accepted · **Triage**: D1a describes a mechanism the accepted W2 fix replaced, so the artifact is now false. Amended rather than handed back: D1a's decision (coverage is file-backed sources only, and that is a stated limit) does not move — what changes is its account of how a Codex rollout is located, which this review directed, plus the scan's cost, which is new information rather than a new decision. Flagged in the fix record so the chair can rule otherwise.

## S1-R2 — The stat-failure recovery is dead code for Claude, and the manifest row overstates it

- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P4
- **Agent**: asm-review-logic (corroborated by chair)
- **Class**: feature
- **File**: `src/worktree/sessionPreviewService.ts:119, 161-162`
- **Evidence**: `resolve(entry, false)` sets `const file = useHint ? entry.sessionPath : undefined`, so for `agent === "claude"` it always returns `{kind:"unresolved"}`. Therefore `again.kind === "resolved"` is always false on that branch, `stamp` is always `null`, and the guard `again.path !== target.path` is never evaluated for Claude. Every test under `resolution is a moment, not a verdict` uses a Codex fixture; there is no Claude equivalent.
- **Impact**: The manifest row *"resolved, file moved → re-resolves and reads the new path in one ask"* holds for Codex only. Claude still recovers — `look()` calls `deps.entry()` first on every pass and `readClaudeEntry` re-derives the path by id each time — but on the **second** ask, so a moved Claude transcript costs about two intervals (≈4 s) rather than one, plus one pointless `resolve` call per failure. B2's invariant is unaffected: nothing is pinned.
- **SuggestedFix**: Either narrow the recovery block to the Codex branch and say so, or give Claude a real no-hint resolution. Correct the manifest row to name Codex, and add a Claude moved-transcript test.
- **Status**: accepted · **Triage**: Correct on both counts, including that my own impact-manifest row overstated it. The recovery block is Codex-only in fact, so it says so in code now, and the manifest row is corrected to name the two-ask Claude path.

## S2-R2 — W4's short read IS deterministically testable; the author's caveat is too pessimistic

- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P4
- **Agent**: asm-review-logic
- **Class**: feature
- **File**: `src/vault/readers/lastActivity.ts:60-62`
- **Evidence**: The author's record says a short read "is not reachable deterministically from a unit test without stubbing `node:fs`". A scratch probe disproved it with no mocks: open the handle, call `handle.stat()`, `fs.truncate()` the file, then `handle.read(buf, 0, buf.length, start)` returned `bytesRead: 80` against `requested: 1025`, leaving 945 NULs in the zero-filled `Buffer.alloc`. The pre-fix whole-buffer decode appended those to the newest record, whose `JSON.parse` then threw and skipped it. Confirmed the suite contains no `bytesRead`, truncation, or short-read case.
- **Impact**: The fix is correct, but nothing pins it — a refactor back to `buf.toString("utf8")` regresses silently, losing the newest message rather than raising an error. The author flagged this honestly; the premise it rested on does not hold, so the gap is cheap to close.
- **SuggestedFix**: Add a test in the truncate-between-`stat`-and-`read` shape above, asserting the reader returns the record surviving in the tail rather than `null`.
- **Status**: accepted · **Triage**: My stated reason was wrong — the probe proves it. Landing the test the chair's method makes possible: a proxy handle that truncates between the reader's own `stat` and `read`, which needs one optional seam rather than stubbing `node:fs`.

## S3-R2 — `findCodexRolloutByFilename`'s suffix match can in principle cross-resolve

- **Severity**: SUGGEST · **Confidence**: MEDIUM · **Priority**: P5
- **Agent**: asm-review-data-security (severity adjudicated down from WARN by the chair)
- **Class**: feature
- **File**: `src/vault/readers/codexReader.ts:1071-1072`, reached from `src/worktree/sessionPreviewService.ts:128-133`
- **Evidence**: The scan matches `dirent.name.endsWith("-" + sessionId + ".jsonl")`, so an id that is another id's `-`-preceded suffix would resolve to the wrong session's rollout. The preview service calls the newly exported `pickRolloutPath` directly, without the `isSafeCodexId` guard every other route applies (`codexReader.ts:1272`, `1310`).
- **Chair adjudication**: downgraded on three pieces of evidence. (1) The guard is not actually bypassed in effect — `readCodexEntry` gates `isSafeCodexId(sessionId)` at `codexReader.ts:572`, so `deps.entry()` cannot hand the service an id that would have failed it. (2) `isSafeCodexId` is `/^[A-Za-z0-9-]+$/`, which would not have prevented a suffix collision anyway; its purpose is the SQL interpolation at `codexReader.ts:1103`, which this path never reaches. (3) The collision needs one id to be a strict `-`-preceded suffix of another, impossible between fixed-length UUIDs, and the property is pre-existing — `readCodexDetail` has served the identical scan for as long as it has existed. Unchanged behaviour newly reached, not introduced here. No traversal is possible: the id is never path-joined, only compared against dirents inside a walk rooted at the sessions dir.
- **Impact**: With a well-formed Codex store, none. Robustness only.
- **SuggestedFix**: Add the `isSafeCodexId` guard at the new call site for defence in depth, and consider anchoring the match on the full `rollout-<timestamp>-<uuid>.jsonl` shape.
- **Status**: audit-backlog · **Triage**: Accepting the chair's own adjudication: not bypassable in effect, impossible between fixed-length UUIDs, and `readCodexDetail` has served the identical scan since it existed. Adding a guard inside a shared reader helper on a fix round changes a function three other call sites use, to close a hole none of them has. Backlogged with the W3 realpath work, which touches the same file.

---

## Author-flagged items — chair's answers

1. **"W4 ships without a dedicated regression test."** Accurate as to the gap, but the stated reason does not hold — the short read is deterministically reproducible without stubbing `node:fs` (S2-R2). The fix itself is correct by inspection and the failure mode it prevents was reproduced.
2. **"B2's recovery re-resolves without the hint; check it cannot loop or cross-resolve."** It cannot loop: `look()` has no loop construct and no re-entry — at most one `entry()`, one `resolve(true)`, one `stat`, one `resolve(false)`, one `stat`, one `read`. A `Held` may oscillate `resolved → unresolved → resolved` across successive asks, but each ask is bounded and rate-limited by `checkedAt`. It cannot cross-resolve in practice (S3-R2). Two corrections to the record: the no-hint re-resolve is **dead code for Claude**, so "recovers on the first ask after the move" is a Codex-only claim (S1-R2); and the no-hint path is what makes B1-R2's tree walk reachable from a transient `stat` failure on an otherwise healthy row.

## Sub-agents spawned

| Specialist | Region | Lens | Model |
|---|---|---|---|
| asm-review-logic | service rewrite + reader window arithmetic | state machine, races, error handling, bounds | `opus[1M]` |
| asm-review-data-security | `resolve()`, `pickRolloutPath` export, wiring, spec restatement | path safety, guard parity, privacy posture | `gpt-5.6-terra[1M]` |
| asm-review-performance | the B2 × W2 interaction | growth axes, retry cadence, recompute | `sonnet[1M]` |
| asm-review-contracts | spec restatement vs base and vs code | delta well-formedness, artifact agreement | `gpt-5.6-luna[1M]` |


## Author's fix record — round 2

Fixed: B1-R2, W1-R2, W2-R2, W3-R2, S1-R2, S2-R2. Backlogged: S3-R2 (chair's own adjudication).

**B1-R2.** `checkedAt` is replaced by an explicit `nextAt` that every outcome sets, plus a `misses`
counter. A look ending without a resolved target increments it and schedules
`recheckMs * 2^min(misses, 8)`; a resolved look zeroes it and returns the entry to the freshness
cadence. Resolving and re-checking are now two questions with two rates, which is the distinction the
finding identified as missing. Discrimination checked, not assumed: with the backoff reverted to a flat
`recheckMs`, `backs an unresolvable row off instead of scanning every interval` fails.

**W1-R2.** The rejection path sets `nextAt = now() + 250 ms` — sooner than the cadence, which is what
S5 asked for, but a floor rather than nothing. The old test asserted the missing limit, so it was
rewritten to assert both halves. Reverting the floor fails it.

**W2-R2.** The re-seat tests `!held.has(entryId)` instead of instance inequality, so a newer entry for
the same id wins and the stale one is dropped.

**S1-R2.** The no-hint recovery is now explicitly `entry.agent === "codex"`, with the reason in a
comment: the hint is all the Claude branch has, so dropping it there could only ever answer
`unresolved`. The round-1 manifest row is corrected in place — it claimed one-ask recovery for a path
that is Codex-only.

**S2-R2.** My premise was wrong and the finding is right. The test lands by the chair's method, needing
one optional `open` parameter on the reader (test seam, defaulted, nothing in production passes it): a
proxy handle whose `stat` overstates the size reproduces the short read exactly, with no mocking of the
read itself. Reverting `buf.toString("utf8", 0, bytesRead)` to `buf.toString("utf8")` fails it.

**W3-R2 — an artifact edit made inside a fix round, flagged deliberately.** D1a now describes
`pickRolloutPath`'s two-step resolution and states what the uuid scan costs, and the Risk Map gains the
row for it. I judged this remediation rather than a handback: D1a's *decision* — coverage is
file-backed sources only, and that is a stated limit — does not move; what moved is its account of a
mechanism this review's own accepted W2 fix replaced, plus a cost that was previously invisible. If the
chair reads that as a changed `D#`, say so and it goes back through plan.

**Verify gate re-run:** type check pass, 5120 unit tests pass, `biome check src` byte-identical to the
`1a907750` baseline.
