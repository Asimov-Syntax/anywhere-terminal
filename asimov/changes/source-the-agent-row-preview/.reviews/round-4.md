# Review Round 4 — source-the-agent-row-preview

- **Date**: 2026-08-30
- **Cycle**: 1
- **Mode**: verification (**bounded extension** — past the skill's 3-round cycle budget)
- **Scope**: `git diff fe443c7b..23489918` (2 commits: 685bfc40 recording the round-3 stop, 23489918 the fix)
- **Head**: 23489918 — tree dirty only in `analytics.json` / `.analytics-cursor.json` (skipped class)
- **Reviewable lines**: ~61 in 1 reviewable file (+ tests, + design.md/workflow.md reviewed by the chair inline)
- **Scope lock**: PASSED. Task 2_3 carries an explicit `Boundary` ("the stated hypothesis only. No new capability, no seam extraction, no widening of what a row carries") and every edit traces to a round-3 finding. The design edits are the remediation of S2-R3 and S3-R3 — my own findings — verified below.
- **Round-budget note**: the skill allows max 3 rounds per cycle. This is round 4, run under a bounded extension the coordinator took as the one thrash-stop option within its own authority. Recorded as a deviation, not a finding. The budget exists as a thrash detector, and being past it is itself context for the recommendation below.
- **Agents spawned**: 2 (logic, performance) — cone-scoped to one file and one hypothesis.
- **Verdict**: APPROVE
- **Counts**: 0 BLOCK / 0 WARN / 3 SUGGEST (new this round) · 6 round-3 findings verified fixed · 8 carried as audit-backlog · 1 rejected

---

## The question this round existed to answer

**Is there a fifth boundary on the invariant "no unbounded, history-sized directory walk may run on the preview freshness cadence"? No.**

asm-review-performance ran a dedicated hunt, enumerating every call the service makes on or near the cadence and tracing each to its growth axis:

| Boundary | Growth axis | Status |
|---|---|---|
| Codex `deps.entry()`, SQLite present | single-row `threads` lookup, `LIMIT 1` | structurally capped; only on resolve / eviction / unresolved retry |
| Codex `deps.entry()`, no SQLite | **session history** (recursive DFS) | off the cadence — behind the ladder |
| Claude `deps.entry()` | project count (`readdir` + one `stat` per project dir) + the entry builder's transcript scans | off the cadence — behind the ladder |
| `resolve()` with Codex hint | none — lexical containment | safe |
| `resolve()` without hint | session history | only immediately after a resolved path's `stat` fails; on failure both target and entry are cleared, so it decays rather than re-scanning a pinned dead path |
| Claude `resolve()` | none — accepts the held contained hint or returns unresolved | safe |
| `stat` | one metadata lookup per eligible row | bounded by `recheckMs` |
| `previewFromVault` | rows × rebuilds (call multiplier only) | `nextAt` + in-flight gates prevent filesystem work scaling with projection rate |

Steady state for a healthy resolved row is now exactly one `stat`, plus a bounded tail read only when `(mtimeMs, size)` moved. No `readdir` anywhere.

---

## Round-3 findings — verification results

| ID | Round-3 severity | Status | Evidence |
|---|---|---|---|
| B1-R3 | BLOCK | **fixed** | `if (current.target.kind !== "resolved" \|\| current.entry === undefined)` removes `deps.entry()` from the healthy path. Test `asks the vault nothing when a healthy row is merely re-checked` discriminates: `lookups === 1` across six intervals while `stats === 6`, so the row is still genuinely re-checked rather than passing by going quiet. Pre-fix `lookups` would be 6. |
| W1-R3 | WARN | **fixed — by B1-R3, not by `progressed`** | The author's claim is verified, and it is the correct account. asm-review-logic established the invariant `current.entry === undefined ⟹ current.target.kind !== "resolved"` (entry assigned at one site, cleared at one site, the clear paired with setting `unresolved`), which makes `resolved && entry === undefined` unreachable — the only state separating `progressed` from the old `target.kind === "resolved"` predicate. No input separates them. `progressed` is a correct, intent-expressing no-op, and the author does not claim otherwise. The test he wrote for it is honestly renamed to say what it actually pins. |
| W2-R3 | WARN | **fixed** | `REJECT_RETRY_MS` deleted; the reject handler runs `misses += 1; schedule()`, byte-identical to the unproductive-fulfilment path, so a rejecting entry takes the ordinary ladder and the spec's once-per-interval sentence holds. Test discriminates: at `clock += 1999` the deleted floor would have permitted a second look, so pre-fix `lookups` is 2 against an asserted 1. |
| S1-R3 | SUGGEST | **fixed** | The eviction test now discriminates, and the read-then-block reordering is what makes it so: the stale look returns "the first answer" while the newer `Held` holds "the second answer", so an unconditional re-seat flips the final in-interval assertion and fails. Chair traced the same sequence independently. |
| S2-R3 | SUGGEST | **fixed** | D1a's block now publishes the optional `open` seam. |
| S3-R3 | SUGGEST | **fixed** | The retry sentence moved out of D1a ("How often that scan may run is D2's, not this decision's") into a new `Retry rate` row in D2's table, which is the decision that owns rates. |

**A correction to my own round-3 record.** My B1-R3 boundary inventory listed Claude's `deps.entry()` as "verified safe" because `resolveClaudeSessionPath` scales with project count, not history. The axis judgement was right; calling it safe understated it. `readClaudeEntry` also calls `buildClaudeEntry` (`claudeReader.ts:335-344`), which does a `stat` plus two passes over the transcript — `parseClaudeFile` and `readLatestTailFields`. So a healthy Claude row was paying a `readdir`, a `stat` per project dir, and two transcript scans every 2 s. This commit reduces that to one `stat`, a larger win than B1-R3 claimed.

---

## New findings

## S1-R4 — Vault deletion no longer blanks a resolved row

- **Severity**: SUGGEST · **Confidence**: MEDIUM · **Priority**: P4 · **Agent**: asm-review-logic · **Class**: feature
- **File**: `src/worktree/sessionPreviewService.ts:183-189`
- **Evidence**: Pre-commit, `deps.entry()` ran on every look and `if (!fresh) return forget(current)` cleared `line` and `stamp` when the vault stopped knowing the session. Post-commit that branch is unreachable for a resolved row, so while `stat(target.path)` keeps succeeding the row serves its cached line indefinitely regardless of what the vault says.
- **Impact**: A real behavioural delta introduced by this commit, but inert through the current caller: `preview()` is only invoked for rows the presence projection already built from the vault, so an id whose entry vanished is not asked about. It becomes live only if a future caller asks about ids it did not just source from the vault.
- **SuggestedFix**: None required now. If it ever matters, key the pin to the projection generation rather than re-adding a per-look `deps.entry()` — that would reopen B1-R3.
- **Status**: open · **Triage**: pending

## S2-R4 — The recovery comment names a mechanism this commit removed, and the load-bearing invariant is unstated

- **Severity**: SUGGEST · **Confidence**: MEDIUM · **Priority**: P5 · **Agent**: asm-review-logic · **Class**: feature
- **File**: `src/worktree/sessionPreviewService.ts:205-207`
- **Evidence**: The comment justifies Claude's recovery with "`deps.entry()` re-derives its path by id every look (S1-R2)". After this commit it does not. Recovery works only because line 216 clears `current.entry` in the same breath as line 215 sets `unresolved`. The safety of the pinned entry rests on the invariant `entry === undefined ⟹ target.kind !== "resolved"`, which no comment states and no assertion enforces.
- **Impact**: Correctness today is unaffected. But a maintainer trusting the comment could drop line 216 — it reads as redundant beside 215 — and silently reintroduce resolution from a stale hint, which is the class of bug B1-R3's fix created room for. This is the fragility that motivated the round-3 extraction recommendation, in miniature.
- **SuggestedFix**: Correct the comment to attribute recovery to the clear at 216, and state the pairing invariant beside `Held.entry`.
- **Status**: open · **Triage**: pending

## S3-R4 — The workflow record contradicts the history it precedes

- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P4 · **Agent**: chair · **Class**: feature
- **File**: `asimov/changes/source-the-agent-row-preview/workflow.md` (THRASH STOP note)
- **Evidence**: The note ends "Awaiting the user's choice among the three thrash-stop options; no further fix edits until then." The very next commit (23489918) is a fix edit. The coordinator's reasoning is sound and was stated to review — the user did not answer inside the window, and of the three options exactly one was the coordinator's to take, since risk acceptance requires the user by rule and the handback changes delivery semantics — but none of that reasoning is in the record.
- **Impact**: `workflow.md` is what a later reader and the archive see. As written it says fixes were frozen pending a user decision, immediately before fixes that no recorded decision authorises. **No user decision exists on the three options**, and nothing in this round should be read as one.
- **SuggestedFix**: Amend the note to record what was actually decided, by whom, and on what authority: the user did not answer; the coordinator took the bounded-extension option as the only one within its own authority; the chair's extraction recommendation was left open. Then add the round-4 outcome.
- **Status**: open · **Triage**: pending

---

## Audit backlog

Carried forward, non-gating, not re-reported: round-1 W3, W5, S4, S7, S8, S10; round-2 S3-R2.

**New this round** — `parseClaudeFile` (`src/vault/readers/claudeReader.ts:104-140`) streams a transcript from the head with an early exit once it has both a user and an assistant record; a transcript that never yields both is read in full, unbounded in transcript size. Pre-existing vault code this change does not touch, and after this commit it sits only on the resolution path behind the retry ladder, never on a healthy row's re-check. Recorded rather than reported: flagging unchanged code is outside the rule unless critical, and this is neither critical nor reachable on the cadence.

---

## The extraction recommendation — updated, and why

My round-3 report recommended handback to planning, grounded in the master workflow's clause: "If the inventory keeps expanding across rounds, patch-level fixing has failed." **I am withdrawing that as a recommendation, because the condition I named is no longer met.** The evidence changed:

- The inventory stopped expanding. A dedicated fifth-boundary hunt enumerated every call on or near the cadence and found nothing.
- This fix is structurally unlike rounds 2 and 3. Those changed *how often* the expensive dependency was consulted; this changed *whether* it is consulted at all in steady state, removing it from the hot path rather than rate-limiting it.
- W1-R3 turned out to be fixed *by* B1-R3's structural change rather than by its own patch. A structural fix subsuming a point fix is the signature of a root cause actually being addressed.

What still argues the other way, and is worth weighing rather than dismissing: the seam owns four questions behind one call, and D2 now documents that honestly as two rate rows rather than resolving it; correctness rests on an unstated, unenforced invariant (S2-R4); and four rounds of gating findings on one seam is a real signal about its complexity even after convergence.

My judgement is that the residual is now a **maintainability** concern, best discharged by making the invariant explicit and correcting the misleading comment (S2-R4) — not by splitting the change. That is a change of position on changed evidence, not a concession to the rounds spent.

**This supersedes nothing the user decided, because the user decided nothing.** The three options were put and went unanswered; no `risk-accepted` waiver has been granted here, and none is claimed. If the user still wants the extraction, that remains theirs to choose.

## Sub-agents spawned

| Specialist | Region | Lens | Model |
|---|---|---|---|
| asm-review-logic | `Held.entry`, `progressed`, the `look()` guard, the two handlers | state machine, staleness, races, test discrimination | `opus[1M]` |
| asm-review-performance | the whole cadence call graph across service, readers and projector | fifth-boundary hunt, growth axes | `gpt-5.6-terra[1M]` |


## Author's fix record — round 4 (APPROVE)

Accepted and fixed: **S2-R4**, **S3-R4**. Backlogged: **S1-R4**.

**S2-R4 — the finding was right and its stated mechanism was not, which the fix had to correct.**
The comment did credit a mechanism 2_3 removed. But writing the replacement, the claim that the paired
`entry = undefined` is load-bearing turned out to be false: reverting that line alone fails no test,
because `look`'s guard re-fetches the entry whenever the target is not resolved. Dropping the TARGET is
what carries recovery. So the comment now says that, `clearTarget` is documented as tidiness rather than
mechanism, and the new test is labelled for what it actually pins — it fails when the failed recovery
leaves the target resolved, and does not claim to guard the entry clear.

**S3-R4 — corrected.** The workflow.md note said "no further fix edits until then" immediately before
fix edits. It now records the whole sequence: the options were put to the user, went unanswered, and
option 3 was taken because it was the only one of the three available without them — with the round-4
deviation and the absence of any risk-accepted waiver stated in the same place.

**S1-R4 — audit-backlog.** Real delta and correctly scoped as inert through the current caller: the
projector only asks about rows it already sourced from the vault. Changing it would alter what a row
does on vault deletion after an APPROVE, on a path no caller reaches. It belongs with the seam work if
that is ever taken.

**A defect this round's own test found in the last round's.** The eviction test from 2_3 gated the
reader by a counter, so whichever session read first was blocked — scheduling-dependent, and when the
awaited `codex:other` lost the race the test deadlocked to a 5 s timeout. It passed on the runs I made
and failed under `verify-task`. It now gates by path and waits for the stale read to reach the gate;
run five times consecutively, and still failing against the round-2 predicate. Worth recording because
the round-3 file claims that test as a revert-checked guard: it was, but it was also flaky, and a flaky
guard is a weaker claim than the one I made for it.

**Verify gate:** type check pass, 5124 unit tests pass, `biome check src` byte-identical to the
`1a907750` baseline.
