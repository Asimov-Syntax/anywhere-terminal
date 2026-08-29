# Review Round 3 — source-the-agent-row-preview

- **Date**: 2026-08-30
- **Cycle**: 1
- **Mode**: verification
- **Scope**: `git diff 7a69d253..fe443c7b` (1 commit: fe443c7b "fix(source-the-agent-row-preview): back off an unresolvable row instead of walking the sessions tree")
- **Head**: fe443c7b — working tree clean
- **Reviewable lines**: ~72 across 2 reviewable files (+ tests, + design.md reviewed by the chair inline)
- **Scope lock**: PASSED — see "Scope-lock ruling" below.
- **Agents spawned**: 3 (logic, performance, contracts) — cone-scoped.
- **Verdict**: BLOCK
- **Counts**: 1 BLOCK / 2 WARN / 3 SUGGEST (new this round) · 5 round-2 findings verified fixed · 7 carried as audit-backlog · 1 rejected
- **Split over gating blockers**: 1 feature / 0 machinery
- **Verify gate**: not re-run by review. Cited from the coordinator: type check pass, 5120 unit tests pass, `biome check src` byte-identical to the `1a907750` baseline.
- **Recommendation**: handback to planning. See "Inventory expansion" below — this is the second boundary of one invariant after a patch, and the rate mechanism produced three findings in a single round.

---

## Scope-lock ruling (the author's question 1)

The `design.md` D1a amendment is **remediation, not a design delta.** The test applied: does the decision the `D#` records move? D1a's decision is the coverage set — Claude JSONL plus Codex when its rollout exists, not OpenCode, not Cursor — and that set is unchanged. What changed is D1a's account of a mechanism that an already-accepted fix (round-1 W2) replaced, so the artifact is catching up to reviewed reality rather than proposing direction. The new retry sentence introduces a rate, but D2 already grants the service ownership of "the rate", so no new invariant owner appears: the backoff is a refinement inside an ownership the accepted plan assigns. Corroborated by asm-review-contracts, which independently concluded D1a "remains a coverage decision" and that "no unplanned durable owner, lifecycle, or external contract was introduced".

Recorded as S3-R3: the sentence is filed under a coverage decision when D2 is the decision that owns rates.

---

## Round-2 findings — verification results

| ID | Round-2 severity | Status | Evidence |
|---|---|---|---|
| B1-R2 | BLOCK | **fixed at the reported boundary; invariant survives elsewhere** | The `nextAt`/`misses` gate is sound and the test discriminates (asks land at clock 0 / 4000 / 12000 → 3 resolutions; flat cadence gives 10). Chair-computed schedule: 0s, 4s, 12s, 28s, 60s, 124s, 252s, 508s, 1020s, then every 512s — 14 resolution attempts in the first hour against 1800 pre-fix, a 128x reduction, with an early schedule dense enough to catch an ordinary late-arriving rollout inside ~2 minutes. Ceiling 8.53 min, reached only after ~17 min of continuous failure. **But the same invariant is violated at a second boundary — see B1-R3.** |
| W1-R2 | WARN | **fixed, weakly** | A gate now exists on the rejection path; the test discriminates in both directions (`lookups === 1` at an unchanged clock, `=== 2` at +250 ms). The floor neither decays nor consults `misses` — see W2-R3. |
| W2-R2 | WARN | **fix verified, test does not** | `if (!held.has(entryId))` is the correct predicate. Its regression test does not exercise it — see S1-R3. |
| S1-R2 | SUGGEST | **fixed** | `entry.agent === "codex" ? await resolve(entry, false) : { kind: "unresolved" as const }` is behaviour-preserving for Claude (the old call forced `file = undefined` → `unresolved`) and removes the pointless call. The round-1 manifest row was corrected in place with visible `(S1-R2)` provenance. |
| S2-R2 | SUGGEST | **fixed** | The Proxy seam reproduces a genuine short read, verified standalone: `statSize 511, bytesRead 11`, naive whole-buffer decode tail is NUL padding. Reverting the `bytesRead` slice glues 500 NULs onto the newest record (the fixture has no trailing newline), `JSON.parse` throws, and the walk falls back to the older record — the assertion fails. The 3-arg seam cannot alter the 2-arg production call, and `finally { handle?.close() }` holds for an injected handle. |

**Answered for the author (question 2 — starvation):** the backoff cannot starve a late-resolving row. `misses` zeroes whenever `current.target.kind === "resolved"`, reachable from three paths: a successful `resolve(entry, true)` out of `unresolved`, an already-resolved target whose `stat` succeeds, and a successful Codex no-hint recovery. Eviction also resets it by constructing a fresh `Held`. The reset is reachable from every path where the row becomes healthy. The defect is the opposite one — it resets in cases where it should not (W1-R3).

**Carried forward as `audit-backlog`** (valid, non-gating, not re-reported): round-1 W3, W5, S4, S7, S8, S10; round-2 S3-R2.
**Rejected, not re-reported**: round-1 S9.

---

## New findings

## B1-R3 — The "no unbounded tree walk on the freshness cadence" invariant survives at the `deps.entry()` boundary

- **Severity**: BLOCK · **Confidence**: HIGH · **Priority**: P1
- **Agent**: asm-review-logic (verified independently by the chair)
- **Class**: feature
- **File**: `src/worktree/sessionPreviewService.ts:164` → `src/vault/readers/codexReader.ts:582-583`
- **Invariant**: no unbounded, history-sized directory walk may run on the preview freshness cadence.
- **Evidence**: B1-R2's fix removed the walk from `resolve()`'s miss path. An identical walk remains on the path the fix does not reach. `look()` calls `deps.entry(entryId)` on **every** ungated look, before and independently of `resolve()`. Production wires it (`extension.ts:673`) to `vaultService.getEntry` → `readCodexEntry` (`codexReader.ts:568-594`), which on `status === "no-db" || "no-sqlite3"` calls `findCodexRolloutByFilename(sessionId, sessionsDir)` — the same unbounded recursive DFS over `~/.codex/sessions/**` that B1-R2 was raised about. That fallback is deliberate and supported: `codexReader.ts:565` documents it as the path used "when no SQLite DB exists".
  The backoff cannot engage here, because the row is **healthy**: it resolves, `current.target.kind === "resolved"`, and line 237 zeroes `misses` on exactly that path. So the gate stays at `recheckMs`.
- **Boundary inventory for this invariant** — searched: `resolve()` miss path (Codex), `resolve()` miss path (Claude), `deps.entry()` (Codex), `deps.entry()` (Claude), the `stat`-failure recovery, the reject path, the `uncovered` short-circuit.
  - **Affected**: `deps.entry()` (Codex) on a host with no Codex DB or no `sqlite3` — full history-tree walk per Codex row per `recheckMs`, on healthy rows, indefinitely.
  - **Verified safe**: `resolve()` Codex miss path (now backed off, B1-R2 fixed); `resolve()` Claude (lexical check only, no filesystem work); the `stat`-failure recovery (the `again.path !== target.path` guard at `:186` sends the same-path transient to `misses++`, and a genuine relocation is self-limiting because the new path is then stable); the `uncovered` short-circuit (returns before `deps.entry()`); `deps.entry()` (Claude) — `readClaudeEntry` does a bounded `readdir` of the projects root plus a `stat` per project dir, which is proportional to project count, not to history.
- **Impact**: On a supported configuration, every Codex row costs a recursive walk of a tree that grows monotonically with the user's history and is never pruned, every 2 seconds, for as long as the panel is open — the precise condition B1-R2 blocked, on a boundary the patch did not cover. D2's letter still holds (the 2 s gate caps it against the rebuild rate), but the design's intent — that a quiet scan is cheap — does not.
- **SuggestedFix**: Cache the resolved `PreviewEntry` on `Held` and skip `deps.entry()` while `target.kind === "resolved"` and the stamp is unchanged; the entry is only needed in order to (re)resolve. Alternatively give the service an `entry` variant that does not fall back to the filename walk, letting an unresolvable row stay `unresolved` where the backoff already covers it.
- **Status**: accepted · **Triage**: Correct, and the same invariant at a boundary my patch could not see: I gated `resolve()` and left `deps.entry()` ungated, and a healthy row never engages the backoff. Fixed by the chair's own hypothesis — cache the resolved `PreviewEntry` on `Held` and call `deps.entry()` only when a re-resolve is actually needed.

## W1-R3 — The rate mechanism keys off the target's resulting state, not the work the look performed

- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P2
- **Agent**: asm-review-logic + asm-review-performance (merged by the chair) + chair
- **Class**: feature
- **File**: `src/worktree/sessionPreviewService.ts:237`
- **Evidence**: `current.misses = current.target.kind === "resolved" ? 0 : current.misses + 1;` reads residual state rather than outcome. `forget()` (`:213`) clears `stamp` and `line` but never touches `current.target`. Two instances follow:
  - **(a)** `deps.entry()` returning `null` (`:164-167`) returns having done nothing useful while `current.target` still says `resolved` from an earlier look, so `misses` resets to 0. `readCodexEntry` returns `null` on `status === "query-error"` (`codexReader.ts:593`) — a persistent condition for a locked or corrupt `threads` DB — so such a row is pinned at the 2 s cadence forever and never backs off. Composes with B1-R3.
  - **(b)** A resolution recovered by the full no-hint DFS counts as `resolved`, so `misses` resets even though the look just paid the walk.
- **Chair adjudication**: asm-review-performance rated (b) BLOCK on the grounds that a repeatedly relocated rollout re-pays the walk every 2 s. Downgraded on specific code: the guard at `:186` (`again.kind === "resolved" && again.path !== target.path`) sends the ordinary transient — where the fallback re-finds the same path — to `misses++`, and only a genuinely different path resets. A real relocation is therefore self-limiting: the new path is stable, and subsequent looks `stat` it with no walk. Sustaining the oscillation needs an external process relocating one session's rollout roughly every 2 seconds, which is not ordinary Codex behaviour. Round-2's B1-R2 earned BLOCK because a single ordinary row triggered it; this needs a pathological pattern, so it is WARN — the same standard applied to round-1 W5 and the round-1 symlink finding.
- **Impact**: The backoff cannot engage for two classes of row that are costing work, which is the mechanism's whole purpose.
- **SuggestedFix**: Reset on outcome, not residual state — have `look()` report whether it reached the stamp/read stage (e.g. return `{ line, checked }`) and reset `misses` only when `checked`. Minimum viable for (a): set `current.target = { kind: "unresolved" }` before `forget` in the `!entry` branch.
- **Status**: accepted · **Triage**: Real: `misses` keyed off the target's state rather than whether the look achieved anything, so a `null` entry over a stale `resolved` target reset the counter. The counter now zeroes only when a look actually progressed — an unchanged stamp confirmed, or a read completed.

## W2-R3 — The reject floor neither decays nor consults `misses`, and contradicts the shipped spec

- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P2
- **Agent**: asm-review-logic + asm-review-contracts (merged by the chair) + chair
- **Class**: feature
- **File**: `src/worktree/sessionPreviewService.ts:241-246`
- **Evidence**: The rejection handler writes `current.nextAt = now() + REJECT_RETRY_MS` (a flat 250 ms) and neither reads nor writes `misses`. Three consequences:
  - **Contract**: `specs/worktree-agent-presence/spec.md:63-66` scenario "Presence rebuilding faster than previews change" states "a session is re-examined **at most once per interval**". At the default `recheckMs` of 2000, a persistently rejecting entry is re-examined up to 8 times per interval. The service no longer has the contract its own delta describes.
  - **Rate**: `preview()` is asked once per row per projection at the 150 ms coalescing cap (~6.7 Hz). A 250 ms floor removes roughly 40% of that and never decays, so a degraded vault costs a lookup every 250 ms per row indefinitely.
  - **Interaction**: an entry that had backed off to `misses === 8` (a 512 s gate) and then starts rejecting has that gate collapsed to 250 ms — a row whose lookup degrades from "completes with nothing" to "throws" is retried *more* often, not less. The override is temporary rather than destructive: `misses` is retained, so the accumulated backoff reasserts on the next completed look.
- **Chair note**: this one is partly on the review. Round-2 W1-R2's suggested fix asked for "a few hundred ms" without reconciling it against the once-per-interval scenario in the same change's spec delta. The author implemented the suggestion as given.
- **SuggestedFix**: Decay the reject path too, preserving S5's "sooner than the cadence" property: `current.misses += 1; current.nextAt = now() + REJECT_RETRY_MS * 2 ** Math.min(current.misses, MAX_BACKOFF_SHIFT)` — 250 ms on the first throw, still under the cadence for the first three retries. Then either that satisfies the scenario or the delta needs an explicit sentence defining a failed lookup as its own retry class; do not leave code and spec disagreeing.
- **Status**: accepted · **Triage**: Accepting it against my own S5 fix: the shipped spec says a session is re-examined at most once per interval, and a flat 250 ms floor breaks that eight times over. The spec wins over a SUGGEST. The reject path now takes the same backoff ladder as any other unproductive look, so a rejecting entry is gated at the cadence and decays from there.

## S1-R3 — W2-R2's regression test passes identically against the pre-fix code

- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P4
- **Agent**: asm-review-logic + chair (independently, same trace)
- **Class**: feature
- **File**: `src/worktree/sessionPreviewService.test.ts` — `"lets a newer entry win when eviction races an in-flight read"`
- **Evidence**: At `cap: 1`: `preview("codex:s1")` seats H1 and blocks on the gate; `await preview("codex:other")` seats H2 and evicts `s1`, leaving `held = {other: H2}`; `release()` runs H1's `finally` with `held.get("codex:s1") === undefined`. Pre-fix `else { touch(entryId, current) }` and post-fix `if (!held.has(entryId)) { touch(...) }` both take the `touch` branch in exactly that state. The test exercises the *eviction* limb (S6), which both versions share, never the limb W2-R2 corrected. It was not among the three the author validated by reverting.
- **Impact**: The accepted W2-R2 fix ships with no regression guard; a revert to `held.get(entryId) === current` would go undetected.
- **SuggestedFix**: Create the state the two predicates actually disagree on — let a *newer* `Held` be mapped under the same id while the old one's `finally` runs: start the slow ask, evict it via `codex:other`, advance the clock, start a second `preview("codex:s1")` (creating H1'), then release, and assert the mapped entry is H1'.
- **Status**: accepted · **Triage**: My test did not discriminate and I did not revert-check that one — the same mistake I corrected for the other three. Rewritten so a newer entry holds a different line than the stale one, which is the only way the clobber is observable.

## S2-R3 — D1a's published reader interface omits the shipped `open` seam

- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P5
- **Agent**: asm-review-contracts + chair
- **Class**: feature
- **File**: `asimov/changes/source-the-agent-row-preview/design.md:42-48` vs `src/vault/readers/lastActivity.ts:41-45`
- **Evidence**: D1a's TypeScript block still specifies `readLastActivityLine(transcriptPath, format): Promise<string | null>`; the shipped export takes a third optional `open` parameter. `SessionPreviewDeps.read?(transcriptPath, format)` remains type-compatible because the parameter is optional, so nothing breaks.
- **Impact**: The design block is no longer an accurate account of the exported signature. Documentation drift only — lower than round-2 W3-R2, which mis-described a resolution *mechanism*.
- **SuggestedFix**: Add the optional opener to D1a's block, or move the seam behind an internal wrapper if it is not meant to be part of the exported contract.
- **Status**: accepted · **Triage**: D1a published a signature the code no longer has. Updated.

## S3-R3 — The new retry sentence is filed under a coverage decision

- **Severity**: SUGGEST · **Confidence**: MEDIUM · **Priority**: P5
- **Agent**: chair
- **Class**: feature
- **File**: `asimov/changes/source-the-agent-row-preview/design.md` § D1a
- **Evidence**: The amendment adds "Resolution failures therefore carry their own decaying retry, separate from the `(mtimeMs, size)` gate below" to D1a, whose decision is coverage. D2 is the decision that owns "the stamp, the cache, and the rate", and its table is where every other rate lives.
- **Impact**: A later reader looking for the service's rate rules reads D2's table and does not find the backoff. Not a scope-lock trigger — no new owner appears — but it splits one decision across two `D#`s.
- **SuggestedFix**: Move the sentence into D2's table as a fourth row, leaving D1a the mechanism description and its cost.
- **Status**: accepted · **Triage**: Filed under the wrong decision — the rate belongs in D2's table, which already owns it. Moved.

---

## Inventory expansion — recommendation

Master workflow: "If the inventory keeps expanding across rounds, patch-level fixing has failed — say so and recommend handback to planning."

That threshold is met, and the chair says so rather than opening a fourth round:

- The invariant "no unbounded tree walk on the preview freshness cadence" was raised in round 2 (B1-R2), patched, and is found in round 3 at a second boundary (B1-R3) that the patch's own shape could not reach.
- The rate mechanism the round-2 patch introduced produced three further findings in this single round (W1-R3, W2-R3, plus the S1-R3 test gap), one of which contradicts a spec sentence in the same change.
- The root cause is consistent across all of them: the service is trying to own resolution, freshness, retry rate and failure classification behind one `(entryId) => Promise<string|undefined>` call, and every round adds a rate to that one seam. D2 assigns the service "the rate" as a single question; it is demonstrably four.

**Recommendation**: extract the preview service's resolution-and-rate ownership as its own change, planned to APPROVE independently, so the parent's next discovery scopes the integration seam rather than the whole change. A fourth patch round on this seam is likely to find a fifth boundary.

## Sub-agents spawned

| Specialist | Region | Lens | Model |
|---|---|---|---|
| asm-review-logic | the `nextAt`/`misses` gate, `look()`, the reader seam | state machine, races, error handling | `opus[1M]` |
| asm-review-performance | the backoff versus the tree walk | growth axes, retry schedule, recompute | `gpt-5.6-terra[1M]` |
| asm-review-contracts | D1a amendment, task 2_2, unchanged deltas versus code | scope-lock ruling, artifact alignment | `gpt-5.6-luna[1M]` |


## Author's fix record — round 3 (bounded extension round)

**Vehicle.** The user was asked the thrash-stop question and did not answer within the window. Of the
three options, exactly one is mine to take: risk acceptance requires the user by rule, and the handback
splits this into two changes, which is a delivery-semantics change fastlane never auto-chooses. So this
is option 3 — the chair's own fix hypothesis, no scope growth, recorded as task 2_3 with a Boundary
saying so. **The chair's recommendation of option 1 still stands and is unanswered.** If this round
finds a fifth boundary on the same invariant, option 1 becomes mandatory rather than optional.

Fixed: B1-R3, W1-R3, W2-R3, S1-R3, S2-R3, S3-R3.

**B1-R3.** `Held` now carries the `PreviewEntry` that produced its target, and `deps.entry()` is called
only when there is no usable target to re-check. A healthy row's repeat look asks the vault nothing.

**W2-R3.** The 250 ms floor is gone; a rejecting look takes the same ladder as any other unproductive
one. The accepted `at most once per interval` requirement outranks the round-2 suggestion that produced
the floor — which the chair itself flagged as partly its own.

**S1-R3.** The eviction test is rebuilt so the stale and the newer entry hold different lines, which is
the only way the clobber is observable. It now fails against the round-2 predicate.

**Discrimination, checked by reverting each fix — including the one I skipped last round:**

| Reverted | Failing test |
|---|---|
| entry cached → ask the vault every look | `asks the vault nothing when a healthy row is merely re-checked`, `lets a newer entry win when eviction races an in-flight read` |
| reject floor back to a flat 250 ms | `gates a rejecting lookup at the cadence like any other unproductive look` |
| re-seat back to instance inequality | `lets a newer entry win when eviction races an in-flight read` |
| `progressed` back to `target.kind === "resolved"` | **nothing fails — see below** |

**W1-R3 ships without an independent guard, and I am not claiming one.** Fixing B1-R3 made its state
unreachable: with the entry held beside a resolved target, `deps.entry()` is never called on that path,
so "a null lookup over a stale resolved target" cannot occur. Every remaining path that ends with a
resolved target also progressed. The `progressed` flag is therefore defence and intent, not an
observable behaviour change, and the test I first wrote for it passed against the old predicate too —
so it was renamed to say what it actually pins (a row the vault does not know backs off) rather than
left claiming a guard it is not.

**Verify gate:** type check pass, 5122 unit tests pass, `biome check src` byte-identical to the
`1a907750` baseline.
