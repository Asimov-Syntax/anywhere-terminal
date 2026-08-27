# Review Round 5

- Date: 2026-08-27
- Cycle: 2
- Round: 5
- Mode: discovery
- Scope: commit `b9633b1cd803bdb773819e53e5f857f5a1d7cc5c` only
- Head: `b9633b1cd803bdb773819e53e5f857f5a1d7cc5c` (explicit commit scope; the checkout was dirty only in `asimov/changes/launch-agent-in-worktree/.analytics-cursor.json` and `asimov/changes/launch-agent-in-worktree/analytics.json`, outside the commit-only diff)
- Change context: `launch-agent-in-worktree` — Gate 2 approved; D10 and tasks 7_1–7_4 are accepted obligations
- Cycle context: new discovery cycle after cycle 1 exhausted its fix loop and returned B1/B5/B6 to planning
- Reviewable lines: 176 added lines across reviewable production/state files; tests reviewed inline
- Large-change note: not triggered
- Agents spawned:
  - asm-review-logic — launch identity, generation, degraded and async boundaries — `gpt-5.6-sol[1M]`
  - asm-review-contracts — wire, admission, D10 and task contracts — `gpt-5.6-terra[1M]`
  - asm-review-frontend — frozen dialog state and render exclusion — `sonnet[1M]`
  - asm-review-performance — cache lookup and rebuild/render hot paths — `gpt-5.6-luna[1M]`
  - asm-finder — end-to-end launch/resume/create and cache rebuild flow trace — `gpt-5.6-luna[1M]`
- Agents skipped:
  - asm-review-data-security — no persistence, auth, secret, or external-input boundary beyond the launch admission contract covered by logic/contracts
  - asm-review-reuse — no new reusable capability, parser/encoder duplication, or cohesive file split
- Verdict: BLOCK
- Counts: 2 BLOCK | 2 WARN | 0 SUGGEST
- Verification evidence: `bun run asm change verify-status launch-agent-in-worktree` reports tasks 1_1 through 7_4 recorded at exit 0. The author reports type check clean, 4,380 tests passing, and Biome clean apart from 13 pre-existing warnings in untouched files. No project verify command was run during review.
- Deliberate boundaries: `WorktreeRepo.generation` optionality is fail-closed at admission; per-repository invalidation is implemented; excluding generation from the render signature is internally coherent; and create-then-launch is honestly described as outside the generation guard and bounded to the path created in the same mutation body. Those decisions are not findings.

## Findings

### B5

- ID: B5
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeController.ts:524`
- title: Resume Here captures the replacement generation after the webview-to-host boundary
- evidence: `resumeHere()` posts only `{worktreeId,rowId,entryId}` and carries no generation from the panel state that the user acted on. The host then calls `launch()` without an `asked` value at `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:1030`, so the default at line 1049 reads the host's current generation only after the asynchronous postMessage boundary. A repository rebuild can replace a same-id registration after the row was shown but before the host receives the click; `matchedRow()` can still match the same session row because its cwd/path and entry id are unchanged, and the host records the replacement as the requested generation. The changed spec requires a launch to quote the token its row carried; the impact manifest's message-receipt default does not do that.
- impact: Resume Here can start the session in a replacement worktree that the rendered action was not chosen against. The final handoff check only proves the replacement stayed stable after receipt, not that it is the registration selected by the user.
- suggestedFix: Carry the panel's current repository generation on `worktreeResumeHere`, require it synchronously in the host, and pass that quoted value into `launch()` for the final recheck. Add a regression where a same-id/same-head/same-branch re-list lands between the rendered click context and host admission.
- status: open
- triage: persists from round 4 with an evidence delta. The fresh-launch admission promise boundary is fixed, but the same late-capture invariant remains at Resume Here's webview-to-host boundary. Severity remains BLOCK because the same replacement handoff is reachable.
- invariant: A worktree-scoped launch must carry the selected worktree identity across every asynchronous transport, eligibility, and resolution boundary through the final side-effect handoff.
- boundary inventory:
  - affected: Resume Here when the host rebuilds the repository after the panel state the user acts on but before message receipt; same-id replacement can preserve the published session row
  - verified safe: menu launch quotes the dialog-open generation; menu launch rejects a rebuild under an open dialog; fresh launch and Resume Here reject generation movement during executable/session resolution; create-then-launch is an explicit separate boundary

### B7

- ID: B7
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:649`
- title: A degraded retained listing is re-stamped as an admissible registration
- evidence: On a degraded repo listing, `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/WorktreeCache.ts:79-85` retains the last-good `worktrees` array but assigns a new generation because no registration was re-observed. `generationOf()` nevertheless returns that new number for every retained non-missing worktree without checking `repo.degraded` or global git availability. Once the degraded tree is published, a newly opened launch dialog quotes the new generation and passes `admissibleGeneration()`, and Resume Here also defaults to it. A deletion or same-path replacement that occurred while listing failed is therefore treated as current.
- impact: Fresh launch and Resume Here can spawn in a missing or replacement directory after discovery has explicitly said it could not verify the registration. Advancing the token invalidates old intents, but re-authorizing the retained records with the new token defeats the fail-closed identity guarantee.
- suggestedFix: Keep advancing generation on degraded applies so existing intents are invalidated, but make registration admission return `undefined` for a degraded containing repo or globally unavailable git. Do not mint a new admissible worktree intent until a successful listing clears degradation. Cover fresh and Resume Here against a degraded retained listing followed by a replacement.
- status: open
- triage: new in cycle 2 discovery. This is inside D10's degraded-apply behavior and the launch identity flow, but differs from B5/B6: the causal mechanism is minting authority from an explicitly unverified retained snapshot.
- invariant: A generation may invalidate prior registration authority, but a failed observation cannot create new authority for registrations it did not observe.
- boundary inventory:
  - affected: per-repo degraded listing with retained worktrees; global git-unavailable retained tree; fresh launch opened after degradation; Resume Here after degradation
  - verified safe: intents spanning a successful or degraded apply are invalidated; missing records return no generation; successful current listings admit; untouched sibling repositories retain their own generation

### W6

- ID: W6
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-frontend
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeController.test.ts:690`
- title: The rework still omits regression coverage for distinct identity boundaries
- evidence: The commit adds exact menu-dialog tests for a superseding offer and generation, plus a host test for a same-listing fresh launch. It does not open the create form under offer A, publish offer B, and submit to exercise `frozenCreateOffer`; it does not cover Resume Here carrying/refusing the rendered registration across message admission; it does not cover degraded retained registrations; and task 7_2's sibling-repository handoff scenario is represented only by a cache-generation unit assertion, not the host launch flow. The author's impact manifest claims both panel entry paths and all reachable sites are verified, which overstates the committed tests.
- impact: The suite can stay green if the create freeze regresses or if the two blocking identity boundaries remain open. This change follows four prior rounds where green tests did not cover the exact race, so the omitted causal paths are material.
- suggestedFix: Add controller coverage for create offer A → offer B → submit; host/assembly coverage for Resume Here's quoted generation across a same-listing rebuild; degraded retained-listing refusal; and a launch surviving an unrelated repository rebuild.
- status: open
- triage: persists from round 4 with reduced and updated scope. Menu dialog freezing and fresh same-listing handoff are now covered; create, Resume transport, degraded admission, and sibling handoff remain uncovered. Severity remains WARN.

### W7

- ID: W7
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: asm-review-performance, chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:700`
- title: Launch admission repeats full-tree cache materialization instead of carrying one admitted lookup
- evidence: A fresh launch now calls `cache.read()` through `actionPath()`, `admissibleGeneration()`, the separate `generationOf()` passed to `launch()`, final `actionPath()`, and final `generationOf()`. Each `cache.read()` iterates all repositories and copies every worktree array at `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/WorktreeCache.ts:174-182`. This is five O(repositories + worktrees) traversals/materializations for one click, and the separate post-admission generation read also diverges from D10's stated `admissibleLaunch`-returns-the-intent shape.
- impact: Large multi-repository workspaces pay avoidable repeated full-tree allocation on each launch/resume handoff, and the contract remains structurally easier to regress into checking one cache value and acting on another.
- suggestedFix: Expose one cache lookup returning the current worktree, path, repo state, and generation; have synchronous admission return that admitted intent and carry its generation to handoff. Re-resolve once at handoff rather than materializing the whole tree repeatedly.
- status: open
- triage: new in cycle 2 discovery. WARN rather than BLOCK because launches are user-triggered and no latency measurement shows failure, but the work grows with uncapped workspace repository/worktree count and is introduced on the safety-critical path.

## Prior sustained outcomes

- B1 — fixed in this commit for dialogs opened before an offer/tree refresh: menu launch and create submit use frozen dialog context rather than the live offer field.
- B6 — fixed for launches already admitted before a successful identical re-list: cache generation does not collide like `head:branch`.
- B2, W1, W2, W3, W4, S2 — previously fixed and remain outside the new defects above.
- B3, B4, W5 — rejected/out of scope in cycle 1; not re-reported.

## Audit backlog

### S1

- ID: S1
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: asm-review-reuse, asm-review-frontend
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/worktreeDialogShell.ts:38`
- title: Continue and worktree dialogs maintain parallel modal lifecycles
- evidence: The duplicated focus, Escape, disposal, and focus-restoration lifecycles predate this commit.
- impact: Lifecycle fixes can drift between dialog families.
- suggestedFix: Consider a separate refactor that generalizes the worktree shell for Continue.
- status: audit-backlog
- triage: carried forward, non-gating

### AB1

- ID: AB1
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair, asm-review-frontend
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeView.ts:290`
- title: The prune dialog remains outside `closeDialog` ownership
- evidence: `openPruneDialog()` opens its dialog without assigning the returned disposer. This path predates and is outside the scoped commit.
- impact: A later dialog can stack over an open prune confirmation and leave its listener/focus trap mounted.
- suggestedFix: Address prune dialog ownership in the change that owns that pre-existing path.
- status: audit-backlog
- triage: carried forward, non-gating

### AB2

- ID: AB2
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-contracts
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/LaunchBuilder.ts:234`
- title: Entry-backed Continue still ignores an explicit posture for a zero-choice agent
- evidence: `permissionArgs()` returns an empty list for an agent with no permission choices before consulting a supplied choice. This older Continue path is unchanged and outside the explicit commit.
- impact: The posture truthfulness rule is not universal across the older Continue path, but WT-005.3 did not introduce or worsen it.
- suggestedFix: In a change owning Continue admission, validate an explicit choice before the empty-choice fallback.
- status: audit-backlog
- triage: carried forward, non-gating

---

## Triage (author, round 5)

### [B5] Resume Here captures the replacement generation after the transport boundary
**Status**: accepted
**Triage**: Correct, and it is the same defect shape the whole rework was for — I fixed the two
paths round 4 named and left the third alone because round 4 had not named it. The window is
narrower than the dialog's (a menu click, not a user-held dialog), but "narrower" is not an
argument, and the fix is the same one already built for the other paths.

### [B7] A degraded retained listing is re-stamped as an admissible registration
**Status**: accepted
**Triage**: Correct, and this one is mine from 7_1. I advanced the generation on a degraded
apply deliberately, and wrote a test asserting it — reasoning only about invalidating intents
already in flight. Advancing also MINTS authority: a dialog opened afterwards quotes the new
token and passes, over registrations discovery just failed to observe. Both halves are needed —
keep advancing, and refuse to admit while the repository or git itself is degraded.

### [W6] Regression coverage still omits distinct identity boundaries
**Status**: accepted
**Triage**: Fair, and the manifest did overstate what was committed: I listed the create form's
frozen offer as covered when only the menu dialog's is. All four named cases get tests.

### [W7] Launch admission repeatedly materializes the complete cache tree
**Status**: accepted — as a design-conformance defect, not only a performance one
**Triage**: The performance half is real (five full-tree copies per launch). The half that
matters more is that D10 specifies admission returns the admitted intent rather than a boolean,
precisely so a caller cannot check one value and act on another — and I shipped the boolean.
The scattered reads ARE the shape D10 was written to remove, so this is fixed structurally
rather than micro-optimised: one lookup, one intent, one re-resolution at handoff.

### Boundary decision
The chair agrees create-then-launch stays outside the generation guard, and that the optional
typing, per-repository scoping and render-signature exclusion are coherent. No change there.
