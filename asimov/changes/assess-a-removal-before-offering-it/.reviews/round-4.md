# Review Round 4

- Date: 2026-08-31
- Cycle: 2
- Mode: verification
- Review lane: fastlane
- Escalation flags: security-privacy, re-review
- Scope: range `4b807f1078ddc65f6646e8f609be45757ab361d0..cd2b088c60065589b7d4539db291568b2fd7652e`
- Head: `cd2b088c60065589b7d4539db291568b2fd7652e` (tree dirty after the reviewed range: `asimov/changes/assess-a-removal-before-offering-it/analytics.json`)
- Reviewable lines: 301
- Large change: no
- Scope lock: passed — every semantic change is remediation owned by revised D3/D6 and tasks 5_1/5_2 after Gate 2 was re-earned; no unrelated capability or new invariant owner entered the range
- Recorded Verify Gate: `bun run asm change verify-status assess-a-removal-before-offering-it` reports every task step exit 0. Workflow notes record check-types clean, 5,711 unit tests passing across 258 files, `gate:fs-deletion` passing, and only the reproduced untouched-file Biome baseline. The chair ran no project verify command.
- Agents spawned:
  - `asm-review-data-security` — live-session suppression and irreversible removal — `gpt-5.6-sol[1M]`
  - `asm-review-logic` — ignored-walk deadlines and async failure paths — `gpt-5.6-terra[1M]`
  - `asm-review-performance` — ignored-entry growth and resource ceilings — `sonnet[1M]`
  - `asm-review-reuse` — deadline helper reuse — `gpt-5.6-luna[1M]`
- Support spawned: `asm-finder` — removal-fix behavioral impact cone — `gpt-5.6-luna[1M]`
- Agents skipped:
  - `asm-review-contracts` — no route/schema/external contract change; the internal option/map contracts were covered by logic, performance, and security
  - `asm-review-frontend` — no UI files changed in the remediation range
- Verdict: BLOCK
- Counts: 1 BLOCK, 3 WARN, 0 SUGGEST

## Cross-round disposition

### B4
- Severity: BLOCK
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-performance`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/ignoredMaterial.ts:148`
- Title: The production ignored walk is still outside its approved entry and time budgets
- Evidence: The accepted round-3 boundaries are now closed at their stated mechanisms: the production adapter forwards per-call options; a spent budget starts no child; `GitRunOptions.maxBufferBytes` reaches `execFile.maxBuffer`; overflow fails the command and maps to `unproven`; and each `size()` is raced against the remaining real timer. The construction-time runner ceiling remains the fallback when no override is supplied. The lower-impact deadline-edge and abandoned-I/O growth mechanisms found this round are recorded separately as W2 and W3 because their likelihood/impact and causal mechanisms differ materially from the prior unbounded wait/buffer defect.
- Impact: The round-3 BLOCK mechanism no longer permits a 32 MiB listing or an indefinitely awaited stat to hold this assessment open.
- SuggestedFix: None for B4; address W2/W3 separately.
- Status: fixed
- Triage: fixed in tasks 5_1 and 4_4 across option forwarding, process output ceiling, zero-budget translation, and per-stat waiting. Revised D3 accurately narrows what the caps do not cancel.

## Findings

### B5
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/worktreeBlockers.ts:250`
- Title: A stale idle row can still suppress a pane that is currently running
- Evidence: `classifiablePanes` accepts every in-target pane whose current `PaneFact.activity` is anything except `exited`, so `heldHere()` suppresses the live registry record even when the same pane snapshot says `running`, `waiting`, or `undefined`. The hard-refusal `busyAgents` value is not derived from those current pane facts; it comes from cached presence rows. Pane changes wait behind the 150 ms projection cap in `WorktreeHost.ts`, so an assessment can observe a currently running pane, the prior idle row, and the prior claim at once. It then removes the registry refusal, counts zero busy rows, and returns `confirmable`. On forced re-evaluation, `worktreeFingerprint.ts` compares the unchanged pane id, so the prior idle confirmation can still authorize the removal. The new tests cover absent, missing-cwd, outside-target, exited, and missing-pane claims, but not a corroborated pane whose current activity has changed to running/waiting/unknown. Invariant inventory — boundaries searched: claim publication/cache, current pane snapshot, activity snapshot, cached presence rows, registry suppression, refusal, confirmation evidence, fingerprint redemption, final git side effect; affected: activity coherence between the suppressing pane and the refusal source, plus fingerprint re-evaluation; verified safe: no claim, missing pane, undefined/outside cwd, exited pane, external-read failure, and empty claim map all preserve/refuse conservatively.
- Impact: `git worktree remove` can execute while a window-owned agent is running or waiting, violating project invariant I14 and the security posture that a working agent is never force-removable. The deletion is recursive and irreversible.
- SuggestedFix: Suppress a registry record only when the corroborating current pane is provably idle (`p.activity === "idle"`), or derive the running/waiting refusal from the same current `PaneFact` snapshot before suppression. Running, waiting, and undetermined pane activity must retain the registry record or independently refuse. Add blocker, host, and force re-evaluation cases for idle → running, waiting, and undefined before the debounced projection commits.
- Status: accepted finding persists
- Triage: persists from round 3. The map and target/cwd/pane-existence corroboration fix several B5 boundaries, but the same stale-claim/cached-row mechanism remains at the activity boundary and still reaches the irreversible side effect.
- Author status: accepted
- Triage: accepted after verifying the mechanism rather than the report. Confirmed in the code: `busyAgents` is counted from `input.rows`, which `WorktreeHost.assessRemoval` takes from `presence()` — the debounced projection — while my suppression filter reads `input.panes`, the live snapshot from `facts.panes()`. Two snapshots, and the fix trusted the live one for the wrong question. `classifiablePanes` answers "will this assessment classify the pane", but the clause I wrote — present, in the target, not exited — mirrors the filter that builds `paneIds` for the confirmable report, which is a different question. A pane that is currently running is one this assessment classifies; it is not one whose classification authorizes erasing a live registry record. The fix is one clause: suppress only where the current `PaneFact` is provably `idle`, so `running`, `waiting` and unknown all keep the registry record and refuse. `paneIds` keeps its own filter unchanged, because a running pane is still a pane the report should name. Treated as remediation and not a handback: D6 already decides that a claim we cannot corroborate is not a claim and that both failure directions point toward refusing; the enumerated clause contradicted its own principle, and correcting it mints no invariant owner, adds no capability, and leaves every rejected alternative rejected. D6's wording is corrected to say `idle` rather than `not exited`.

### W2
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-logic`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/ignoredMaterial.ts:137`
- Title: Deadline equality and a late empty listing can still be reported as measured
- Evidence: The pre-entry and post-stat checks use `> MAX_IGNORED_MS`, so an injected stat that resolves when the clock is exactly at 1,500 ms can win `Promise.race`, pass the post-await check, and return a measurement even though D3 says reaching the cap produces `unproven`. Separately, if enumeration completes after the deadline with no entries, the loop body never runs and there is no final elapsed-time check before the measured result. The child timeout normally constrains production enumeration, but callback/timer event-loop ordering can still produce a late successful completion that should not be labelled measured. Invariant inventory — boundaries searched: initial remaining budget, child timeout, entry admission, per-stat race, post-stat validation, empty enumeration, measured return; affected: exact-deadline comparison and finalization after zero yielded entries; verified safe: exhausted initial budget, a never-returning stat, and a stat observed strictly after the cap return `unproven`.
- Impact: The assessment can claim a complete ignored-material measurement after its declared elapsed-time cap has been reached, weakening the truthfulness of the bounded report.
- SuggestedFix: Treat equality as exhausted (`>=`) and perform a final elapsed-time check after enumeration and before reading the manifest/returning `measured`. Add exact-deadline and late-empty-listing cases.
- Status: new
- Triage: untriaged
- Author status: accepted
- Triage: accepted, both halves verified. `deps.now() - startedAt > MAX_IGNORED_MS` admits a read that resolves at exactly the cap, and an enumeration that runs long while yielding NOTHING never enters the loop body, so no deadline check runs at all and the walk reports a measured zero after blowing its budget. The second half is the one that matters: `measured, entries: 0` is the strongest claim this walk can make, and it would be made by a walk that established nothing. In production the adapter's own `timeoutMs` reaches git and would kill it first, so this is reachable through a dep whose enumeration ignores its budget — but D3 puts the deadline on `measureIgnoredMaterial`, not on one adapter, so the check belongs here.

### W3
- Severity: WARN
- Confidence: MEDIUM
- Priority: P2
- Agent: `asm-review-performance`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/ignoredMaterial.ts:148`
- Title: Repeated timed-out stats can accumulate outside the per-assessment cap
- Evidence: The race bounds how long one assessment waits, but cannot cancel the underlying `fs.promises.lstat`. At most one read is abandoned per assessment, yet there is no cross-assessment in-flight deduplication or semaphore. A user can retry removal after each 1.5 s `unproven` result, issuing another stat while the prior one remains blocked on a stale/FUSE/network filesystem. Growth axis: unresolved `lstat` operations per repeated removal assessment; structural bound: none across assessments. Node filesystem work uses the process-wide libuv threadpool, whose default is small.
- Impact: A handful of persistently blocked stats can consume the extension host's filesystem worker pool and stall unrelated filesystem-backed work. The revised D3 correctly says the walk stops waiting, but its claim that the abandoned read costs only its own I/O does not account for repeated process-wide accumulation.
- SuggestedFix: Before issuing another stat, coalesce or reject work behind a shared bounded in-flight registry/semaphore. Keep one outstanding read per path/worktree and return `unproven` without issuing more while it remains unsettled; cap the registry globally as well. This resource policy should be planned explicitly because `lstat` itself remains uncancellable.
- Status: new
- Triage: untriaged
- Author status: accepted, NOT fixed — for the user
- Triage: the mechanism is real and I am not rebutting it: `lstat` takes no signal, so a stalled filesystem leaves one abandoned read per assessment and nothing dedupes them across assessments. What it asks for is a bounded shared read registry or semaphore, which is a new invariant owner — exactly the remediation boundary rounds 2 and 3 caught me crossing — so it is not something to land inside a fix loop. Non-blocking WARN, carried to the user with the approval summary rather than fixed here. Bounding context, not a rebuttal: an assessment issues at most `MAX_IGNORED_ENTRIES` stats and runs on a user action, so the accumulation needs a stalled mount plus repeated removal dialogs.

### W4
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: `asm-review-reuse`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/ignoredMaterial.ts:105`
- Title: `expiresIn` duplicates the repository's existing unref'd deadline helper
- Evidence: The new helper creates an unref'd timeout, exposes an expiry promise, and returns cancellation. `src/worktree/sessionPreviewService.ts:431-445` already implements the same deadline/race primitive as `defaultWait`, including handle cleanup, and uses it to bound an asynchronous filesystem/read operation. Keeping both lets timer cleanup and deadline semantics drift; the exact-boundary mismatch in W2 is an example of why one primitive should own this behavior.
- Impact: Timer cleanup, injected seams, and deadline semantics now have two implementations in the same subsystem, increasing the chance that one bounded read is fixed while the other remains different.
- SuggestedFix: Extract the existing deadline primitive into a shared worktree utility and have both callers map its elapsed promise to their local result types. Keep `GitRunOptions.maxBufferBytes` on the existing runner option bag; that part correctly reuses the established capability.
- Status: new
- Triage: untriaged
- Author status: accepted
- Triage: verified rather than taken on report — `defaultWait` at `src/worktree/sessionPreviewService.ts:430` is the same primitive as `expiresIn`, unref'd timer and all, differing only in what it resolves to. The finding's real point is the one W2 demonstrates: deadline semantics with two owners drift, and one of them was already subtly wrong. Extracted to a shared module and both consumers rewired.

## Accepted risk

None.

## Audit backlog

None.
