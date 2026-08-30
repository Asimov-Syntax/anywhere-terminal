# Review Round 3

- Date: 2026-08-31
- Cycle: 2
- Mode: discovery
- Review lane: fastlane
- Escalation flags: security-privacy, re-review
- Scope: range `c732ed7f^..4b807f1078ddc65f6646e8f609be45757ab361d0`
- Head: `4b807f1078ddc65f6646e8f609be45757ab361d0` (tree dirty after the reviewed range: `asimov/changes/assess-a-removal-before-offering-it/analytics.json`)
- Reviewable lines: 648
- Large change: no
- Recorded Verify Gate: caller reports check-types clean, 5,698 unit tests passing across 258 files, `gate:fs-deletion` passing, and 3 Biome errors / 14 warnings reproduced before this change in untouched files; `bun run asm change verify-status assess-a-removal-before-offering-it` reports every task step exit 0. Review ran no project verify command.
- Agents spawned:
  - `asm-review-logic` — removal authorization gate — `gpt-5.6-sol[1M]`
  - `asm-review-performance` — ignored walk budgets — `gpt-5.6-terra[1M]`
  - `asm-review-data-security` — irreversible deletion evidence — `sonnet[1M]`
  - `asm-review-contracts` — assessment check contracts — `gpt-5.6-terra[1M]`
  - `asm-review-logic` — session projection races — `gpt-5.6-luna[1M]`
  - `asm-review-reuse` — helper reuse and cohesion — `gpt-5.6-luna[1M]`
- Support spawned: `asm-finder` — removal evidence full-flow trace — `gpt-5.6-luna[1M]`
- Agents skipped: `asm-review-frontend` — no UI files changed; rendering remains WT-013.4
- Verdict: BLOCK
- Counts: 2 BLOCK, 0 WARN, 0 SUGGEST
- Split: 2 feature blockers, 0 machinery blockers

## Findings

### B4
- Severity: BLOCK
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-performance`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/extension.ts:800`
- Title: The production ignored walk is still outside its approved entry and time budgets
- Evidence: Round-1 B4 persists. `diskIgnoredDeps` calls its injected runner with `{ timeoutMs: budgetMs }`, but the production wrapper is `(args, cwd) => worktreeTreeDeps.runner.run(args, cwd)` and silently drops that third argument, so `git ls-files` runs on the runner's 10,000 ms default rather than the walk's remaining 1,500 ms. Even with that fixed, `ignoredEntries()` awaits the runner's fully buffered stdout and then calls `toString().split("\0")`, materializing the whole listing before `measureIgnoredMaterial` can enforce `MAX_IGNORED_ENTRIES`; the 32 MiB runner buffer can contain millions of tiny records. Each `lstat` is also awaited without a deadline or cancellation, so the post-await clock check prevents a false measured result but does not bound how long the read itself takes. Finally, when the remaining budget is zero, production would pass `timeout: 0`, which Node `execFile` treats as no timeout. Invariant inventory — boundaries searched: deadline ownership, production option forwarding, enumeration process, stdout buffering, record admission, per-entry sizing, timeout translation, result fallback; affected: option forwarding, enumeration/materialization, zero-budget timeout, and individual size reads; verified safe: once control returns to the loop, no more than 5,000 entries are statted and elapsed work is reported `unproven` rather than as a partial measurement; `lstat` correctly avoids following symlinks.
- Impact: The assessment can spend up to the runner's 10-second default enumerating, allocate and split a listing thousands of times larger than the 5,000-entry cap, or wait arbitrarily past the deadline on one filesystem read. The accepted D3/spec claim that the walk is bounded by one entry cap and one elapsed-time cap is false at the production boundary.
- SuggestedFix: Forward `runOptions` through `src/extension.ts`; do not invoke git when the remaining budget is zero; replace the buffered runner path with a streaming, cancellable NUL parser that terminates git at the entry/deadline boundary; and enforce the remaining deadline around each size read. Add production-boundary tests that fail when the wrapper drops the timeout, when more than 5,000 records are materialized, and when a real delayed size read outlives the cap.
- Status: accepted
- Triage: persists from round 1. The severity and invariant are unchanged: the fix was accepted, but its production construction site drops the deadline and the same buffered-enumeration / uncancellable-stat boundaries remain outside the approved budget. AUTHOR TRIAGE (round 3): accepted in full and PARTLY fixed in task 4_4. Two of the four boundaries were plain wiring defects and are closed — `src/extension.ts` forwards `runOptions` (mutation-checked: restoring the two-parameter wrapper fails the new assembly case), and a spent budget now returns `unproven` without starting git, since `execFile` reads a timeout of `0` as no timeout at all. The finding is right about the test that missed this: the module asserts against its own injected fake, so the assertion could not fail no matter what production injected. The new case lives at the assembly boundary for that reason. The other two boundaries are NOT fixed and are not remediation: a streaming, cancellable NUL parser that terminates git at the entry cap needs a runner that can stream, and `GitCommandRunner` returns a fully buffered `Promise<GitCommandResult>` — giving it one is a new capability and a changed D3, which round 2 already established I may not do under the banner of a fix. Same for a per-stat deadline, which needs cancellable `lstat`. This invariant has now survived two fix attempts, so it is a thrash-stop trigger and goes to the user with the options below rather than to a third attempt.

### B5
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `asm-review-data-security`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/extension.ts:769`
- Title: A claimed-session cache can remove a live session from every removal evidence source
- Evidence: `PresenceProjector.claimedSessionIds()` returns the set from the last completed window pass. `projectPanes()` adds an identity to that set before it knows whether the pane has a cwd attributable to any worktree; the changed test explicitly requires a pane outside every worktree to claim its registry session. The removal producer then drops every matching registry record solely on membership in that set. But the separately read `PaneFact[]` carries no session identity and `evaluateRemoval()` attributes a pane only by its current cwd. Therefore a live Claude with registry cwd inside the target and a claiming pane whose cwd is absent/outside the target is omitted from registry evidence and also produces no pane evidence for the target. The same omission occurs when pane evidence changes after the forced rebuild: pane changes are debounced, so the last claimed set can still contain a closed/replaced pane's session while `facts.panes()` already reports the new live set. `Promise.all` does not couple those sources or check a pane/projection generation. Invariant inventory — boundaries searched: forced rebuild, full projection, claim publication, pane debounce, registry read/filter, current pane snapshot, worktree attribution, refusal, confirmable evidence, fingerprint redemption, final git side effect; affected: claim-to-pane coherence and registry suppression; verified safe: before the first pass the empty set refuses conservatively, and a stable same-pane/same-cwd session is counted once; the assembly fake correctly delegates `claimedSessionIds()` to the real projector.
- Impact: On an otherwise clean worktree, `atRisk` can return false and an unforced removal can reach git while a live Claude registry session is rooted in the target. On a forced path, the missing session can also satisfy the held fingerprint. Both bypass the accepted rule that a session not proved idle refuses the irreversible removal.
- SuggestedFix: Publish and consume one coherent session-ownership snapshot, not a bare cached set: include a generation and the matching pane identity/activity, and suppress a registry record only when the same assessment is guaranteed to classify that current pane fact. When the pane cwd is absent or differs, use the registry cwd for worktree attribution while using the pane's proven activity; when the generation changes, degrade to unavailable/refused. Add production-boundary tests for a claimed pane with undefined/outside cwd and for a pane close/session change between projection and assessment.
- Status: accepted
- Triage: accepted, verified, and NOT fixed — handed to the user. The mechanism is exactly as described and I confirmed it against the code: `claimedSessionIds()` is the last COMPLETED pass, an identity is claimed before the pane is attributed to any worktree, and `PaneFact` carries no session identity for the assessment to join on. My own design.md D6 asserts "the degradation is toward refusing"; that is true only before the first pass, and this finding shows a stale or unattributed claim degrades toward PROCEEDING — the opposite, on the one action that cannot be undone. D6 is wrong as written and I am not patching over it. The fix the chair describes — one coherent, generation-bound ownership snapshot carrying pane identity and activity — is a new invariant owner and a new decision, not remediation of D6. That is the same boundary round 2 caught me crossing, so it goes back to planning rather than into a fix commit.

## Accepted risk

None.

## Audit backlog

None.
