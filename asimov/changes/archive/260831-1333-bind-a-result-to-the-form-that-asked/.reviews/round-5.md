# Review round 5

- Date: 2026-08-31
- Cycle: 3
- Mode: discovery
- Scope: range `eb792a5c~1..HEAD` — complete accepted contract and implementation
- Head: `5875b96996581007e5b0bfecca0320657afb6659`
- Tree: dirty only from review accounting (`analytics.json`)
- Reviewable lines: 678
- Authorization: user-approved continuation recorded by the review control plane
- Agents spawned:
  - `asm-review-contracts` — final opening wire contract — `gpt-5.6-sol[1M]`
  - `asm-review-data-security` — final debris issuance and redemption path — `gpt-5.6-terra[1M]`
  - `asm-review-logic` — final races and fixture audit — `sonnet[1M]`
  - `asm-review-frontend` — final panel lifecycle and send ordering — `gpt-5.6-luna[1M]`
  - `asm-review-performance` — final state bounds — `gpt-5.6-luna[1M]`
- Agents skipped: `asm-review-reuse` — no relevant reimplementation or extraction
- Verdict: WARN
- Counts: 0 BLOCK, 1 WARN, 0 SUGGEST
- Split: 0 feature / 0 machinery gating blockers

## Findings

### W1

- ID: W1
- Severity: WARN
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts`, chair
- Class: feature
- File: `asimov/changes/bind-a-result-to-the-form-that-asked/specs/worktree-panel/spec.md:5`
- Title: The submit request remains outside the one-opening wire contract
- Evidence: The accepted requirement says the panel-minted opening identity is sent on every request belonging to the form. `WorktreeCreateRequestMessage` has no opening field (`src/types/messages.ts:1008`), the shipped submit path posts `worktreeCreate` without one (`src/webview/worktree/WorktreeController.ts:600`), and host admission never checks `liveOpening` (`src/providers/WorktreeHost.ts:1654`). Submit is posted before retirement on the ordered channel, so the legitimate request works, but a delayed or replayed ordinary create carrying `{ kind: "free" }` and no launch capability can still reach `createWorktree` after `worktreeCreateClosed`.
- Impact: The external "every request" contract and D1's no-missing-channel claim are false. The residual behavior can create an unwanted worktree after the form was cancelled. It is not BLOCK: debris deletion remains independently protected by one-time, TTL-bounded, evidence-rechecked fingerprint redemption, and the data-security audit found no retired path that can mint fresh debris authority.
- SuggestedFix: Add required `opening` to `WorktreeCreateRequestMessage`, post the dialog-captured opening on submit, and require `namedOpening(msg.opening)` plus equality with the surface's live opening before create admission. Keep the existing submit-before-retire ordering; no new consumption rule is needed. Add paired witnesses that the live submit runs and the same create after close is refused. If the product intentionally excludes submit from the opening identity, narrow the accepted spec/D1 language explicitly instead of leaving the contradiction.
- Status: accepted
- Triage: Accepted and fixed as task 5_1, not deferred as an ordinary WARN, because of where this change is in its lifecycle. `asm change apply` writes this spec delta into the project's durable specs at archive, so leaving W1 open does not park a known gap — it commits "sent on every request that belongs to that opening" into the permanent spec while `worktreeCreate` demonstrably does not carry one. A false accepted requirement is worse than an unfixed WARN, and this is the last moment it is cheap to correct. Verified all three legs against code before accepting: `messages.ts:1008` has no opening field, `WorktreeController.ts:600` posts none, `WorktreeHost.ts:1654` never consults `liveOpening`. The omission is mine. The chair's severity is also right and I checked the reason independently rather than taking it: replayed debris deletion stays closed by a mechanism this change never touched — `debrisAuthorization.redeem()` deletes the record before returning a verdict ("spent on sight, refusals included"), records are TTL-evicted, and `covers(current, record.evidence)` re-checks the directory as it is now. Residual exposure is an unwanted worktree, not data loss. Taking the chair's fix shape over the specialist's: equality only, keeping `WorktreeView`'s existing post-submit-then-retire ordering, and NO consumption rule — consumption would be a new decision requiring a `D#`, whereas equality is conformance to D1 and D5 as already accepted, which is what keeps this inside the remediation boundary instead of a handback.
- Invariant inventory: every request belonging to a create-form opening is bound to that live opening. Affected boundary: final `worktreeCreate` submit/admission and replay after close. Verified safe: defaults, refs, pull requests, probes, debris issuance, provisioning offers, panel replies, and debris fingerprint redemption.

## Cross-round adjudication

- Round-1 B1: fixed — defaults openings are runtime-validated and monotonic per surface.
- Round-1 / round-3 B2: fixed — `requestWorktreeRefs` is gated on a positive, currently live opening before readers/state writes; refs and forge continuations recheck liveness; no retired replay recreates deletion authority.
- Round-1 B3: fixed — malformed defaults and close identities fail closed.
- Round-1 B4: fixed — successful provisioning reads stay marked until retirement; failures release only their own marker for retry.
- Round-1 B5: fixed at the live-host lifecycle — detach retires all per-surface state and high-water history.
- Round-1 B6: fixed — immutable dialog identity, all disposal paths retire once, and guarded counter advancement preserves successors.
- Dropped cross-repository late-publish finding: fixed — supersession sweeps all repository slots and publication independently rechecks the surface live opening.

## Specialist adjudication

- Contracts: W1 retained. It independently audited the fixture additions and found no vacuous assertion.
- Data/security: no findings after scoped follow-up. It traced the sole `openings.set`, the probe/authorization pre- and post-await checks, and the 7067bd9a fixture/B2 witnesses; it found no retired restoration or issuer route.
- Logic: no findings. It spot-checked roughly 20 of 52 additive fixture hunks and found matching opening/token setup with no changed assertions or wrong reply selection.
- Frontend: no findings. It independently confirmed every shipped create entry posts defaults before refs and that retirement/counter sequencing is coherent.
- Performance: proposed BLOCK for repeated refs reads was rejected because duplicate refs reads and their concurrency predate this change and are not critical security; this review does not report unchanged behavior. No changed-path scale finding survived.

## Process note

Frontend, logic, and data-security reports reached the coordinator out of band rather than the chair; they were relayed and included here. Data-security's first bare nil was not accepted as sufficient evidence: the chair resumed it for explicit coverage of the openings writer, debris issuance path, and fixture rewrite before adjudication.

## Verification evidence

Recorded Verify Gate at this Head: check-types clean; 269 files / 6159 tests, 0 failures; Biome at the pre-existing 3 errors / 14 warnings / 1 info baseline in check mode. The review ran no project verify command.
