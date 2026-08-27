# Review Round 2

- Date: 2026-08-27
- Cycle: 1
- Round: 2
- Mode: verification
- Scope: commit `0d3d2fee9259cb1889e6d300f871f9c108270258` only, in context of feature commit `3ed52539133f8b3570d577ca0bfd93421983a874`
- Head: `0d3d2fee9259cb1889e6d300f871f9c108270258` (the checkout also had review-session analytics changes outside this explicit commit scope)
- Change context: `launch-agent-in-worktree` — Gate 2 approved
- Scope lock: passed — the commit contains round-1 remediation plus review/build metadata, not a new capability or contract
- Reviewable lines: 439 changed lines in reviewable production/metadata files; tests reviewed inline
- Agents spawned:
  - asm-review-contracts — host-issued target, posture and resolver contracts — `gpt-5.6-sol[1M]`
  - asm-review-logic — async admission, stale state and resolver error flow — `gpt-5.6-terra[1M]`
  - asm-review-frontend — prompt bound, request state and dialog disposal — `sonnet[1M]`
- Agents skipped:
  - asm-review-data-security — contract specialist covered the narrowed IPC admission cone
  - asm-review-performance — no growth-axis behavior changed in the fix
  - asm-review-reuse — S2 verification was covered by contracts/logic; S1 required only scope adjudication
- Verdict: BLOCK
- Counts: 2 BLOCK | 1 WARN | 0 SUGGEST
- Verification evidence: `bun run asm change verify-status launch-agent-in-worktree` reports tasks 1_1 through 6_1 at exit 0. The author reports type check clean, 4,340 tests passing, and Biome check-mode clean except five pre-existing findings outside this change. No verify command was run during review.

## Open findings

### B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-contracts
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/extension.ts:628`
- title: Admission re-probes the registry instead of checking the target answer issued to the surface
- evidence: The panel answer is independently produced by `TerminalViewProvider.handleRequestVaultLaunchTargets()` and is not retained by `WorktreeHost`. The new `launchTargets` capability runs a fresh `detectLaunchTargets("start")` for each action. If an agent was absent from the answer the surface received but becomes detectable before a stale or forged request is admitted, the second probe includes it and `admissibleLaunch()` accepts it. Sharing the detector does not make two time-separated results the same published answer.
- impact: The exact round-1 invariant and task 6_1 remain open: both standalone launch and create-after-launch can accept an agent that the requesting surface was never offered.
- suggestedFix: Retain the exact start-target snapshot per surface when it is published and admit against that snapshot. If the answer can refresh, associate launch requests with the current surface generation/hash and reject requests that do not match it.
- status: open
- triage: persists from round 1; malformed fields, current-probe membership, posture membership, prompt capability/bound, fail-closed missing capability, and pre-create admission are verified fixed, but the authoritative issued-answer boundary is not
- invariant: A fresh launch may execute only values in the authoritative start-target set issued by the host to the requesting surface.
- boundary inventory:
  - affected: standalone launch; create-after-launch; stale/forged agent ids across a target-set change
  - verified safe: malformed agent/posture/prompt shapes; current detection membership; per-agent posture membership; non-seedable prompt refusal; over-bound prompt refusal; host without `launchTargets`; create admission before Git

### B5

- ID: B5
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-contracts, asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:921`
- title: Standalone launch paths use a worktree path captured before asynchronous resolution
- evidence: `worktreeLaunchAgent` resolves `actionPath()` before awaiting `admissibleLaunch()`, then `startAgent()` may perform another executable probe before the surface opens the pane. `worktreeResumeHere` likewise captures the worktree path before the asynchronous vault/session resolution. Neither path re-resolves the worktree identifier at the final handoff in `launch()`. A tree rebuild can therefore remove or mark the worktree missing while either request is resolving, yet the previously captured path is still handed to the surface.
- impact: A worktree that has left the host's current tree can still receive a fresh or resumed agent launch, violating the approved stale-worktree fail-closed scenario. The directory may be gone or may now represent something other than the worktree the surface selected.
- suggestedFix: Carry the worktree id into the launch completion path and re-resolve it immediately before `surface.launchAgent`. Abort if it no longer resolves; for resume, also require the final path to match the cwd placed in the resolved options. Cover both fresh launch and Resume Here with a deferred resolver plus an intervening tree rebuild.
- status: open
- triage: new finding in the fix impact cone; the fresh-launch gap was introduced by asynchronous admission, and the author impact manifest explicitly placed Resume Here in the reviewed launch boundary
- invariant: A worktree-scoped launch must resolve its target from the host's current tree at the final side-effect handoff, after every asynchronous eligibility/resolution boundary.
- boundary inventory:
  - affected: standalone fresh launch; Resume Here; host tree rebuild or missing-state transition while launch resolution is pending
  - verified safe: initial unknown/missing worktree rejection; create-after-launch uses the mutation service's newly created path; resolver/spawn errors are posted to the asking surface

### W6

- ID: W6
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.actions.test.ts:998`
- title: The remediation tests do not exercise several changed invariants
- evidence: Commit `0d3d2fe` changes host admission, zero-choice posture handling, target-request single-flight state, prompt max/count behavior, dialog-disposer ownership, and executable resolution, but only `WorktreeHost.actions.test.ts` and the assembly harness receive test changes. The host tests use a stable target answer and do not delay admission while the target set or tree changes. Existing tests do not assert a zero-choice `buildStart` posture refusal, hide/show-before-reply deduplication, the prompt `maxLength`/counter, superseding/disposal of a launch dialog, or templated `startAgent` probe failure through the shared resolver.
- impact: The recorded 4,340 passing tests do not prove the two remaining asynchronous/issued-answer boundaries and would allow several accepted round-1 fixes to regress without failing.
- suggestedFix: Add focused regression cases at each changed owner, especially target-snapshot drift, tree removal during deferred admission/resolution, zero-choice builder refusal, one outstanding start request, prompt limit/count reset, and launch-dialog supersession/disposal.
- status: open
- triage: new support-review finding inside the remediation cone

## Audit backlog

### S1

- ID: S1
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: asm-review-reuse, asm-review-frontend
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/worktreeDialogShell.ts:38`
- title: Continue and worktree dialogs maintain parallel modal lifecycles
- evidence: The duplicated focus, Escape, disposal and focus-restoration lifecycles remain. `3ed5253` technically touches `ContinueDialog.ts`, but only to rename a permission-option type; blame confirms every modal-lifecycle line predates both reviewed commits, and neither commit touches `worktreeDialogShell.ts`.
- impact: Lifecycle fixes can drift between dialog families, but this change neither introduced nor behaviorally worsened the duplication.
- suggestedFix: Consider a separate refactor that generalizes the worktree shell for Continue.
- status: audit-backlog
- triage: rebuttal sustained in substance; non-gating and carried forward

### AB1

- ID: AB1
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair, asm-review-frontend
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeView.ts:291`
- title: The prune dialog remains outside `closeDialog` ownership
- evidence: The launch dialog is now stored and disposed correctly, but `openPruneDialog()` still opens its dialog without assigning the returned disposer. The prune implementation predates both scoped commits.
- impact: A later dialog can still stack over an open prune confirmation and leave its listener/focus trap mounted.
- suggestedFix: Address prune dialog ownership in the change that owns that pre-existing path.
- status: audit-backlog
- triage: non-accepted half of W4; outside this verification cone

### AB2

- ID: AB2
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-contracts
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/LaunchBuilder.ts:234`
- title: Entry-backed Continue still ignores an explicit posture for a zero-choice agent
- evidence: `permissionArgs()` returns `[]` on an empty `permissionChoices` list before consulting a supplied `chosenId`, so a forged Continue target for OpenCode can still claim an undeclared posture and run the default. This behavior predates `3ed5253`; the changed fresh-start path now reaches `chosenPermissionArgs()` directly and is fixed.
- impact: The same posture truthfulness rule is not universal across the older Continue path, but this change did not introduce or worsen that boundary.
- suggestedFix: In a change owning Continue admission, check an explicit `chosenId` through `chosenPermissionArgs()` before the empty-choice fallback.
- status: audit-backlog
- triage: author impact manifest incorrectly states `buildStart` is the only caller of `chosenPermissionArgs`; recorded non-gating because the zero-choice Continue bypass is unchanged and outside WT-005.3's fresh-launch contract

## Prior finding outcomes

### B2

- ID: B2
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-contracts, asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/LaunchBuilder.ts:223`
- title: A supplied posture is accepted for agents with no posture vocabulary
- evidence: `buildStart()` now sends every explicit choice through `chosenPermissionArgs()`, whose empty-list short circuit was removed. Host admission also rejects a posture absent from the selected target's declared choices.
- impact: Direct and create-after fresh launches can no longer claim an undeclared posture while running the agent default.
- suggestedFix: none
- status: fixed
- triage: fixed for the round-1 fresh-launch boundaries; the pre-existing entry-backed Continue variant is AB2, not a persistence of this scoped finding

### B3

- ID: B3
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-performance
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/presenceProjector.ts:391`
- title: Every pane-evidence batch recomputes all panes across all worktrees
- evidence: Neither `3ed5253` nor `0d3d2fe` touches `presenceProjector.ts`.
- impact: none attributable to this change
- suggestedFix: none in this change
- status: rejected
- triage: rebuttal sustained — out of scope; do not re-report in this cycle

### B4

- ID: B4
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-performance
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/runningSessions.ts:133`
- title: The external-session poll fully scans the user-wide registry
- evidence: Neither `3ed5253` nor `0d3d2fe` touches `runningSessions.ts`.
- impact: none attributable to this change
- suggestedFix: none in this change
- status: rejected
- triage: rebuttal sustained — out of scope; do not re-report in this cycle

### W1

- ID: W1
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:643`
- title: Null launch fields can throw before rejection handlers are installed
- evidence: `admissibleLaunch()` accepts `unknown`, rejects null/non-object launch payloads, and type-checks agent, posture and prompt before use on both entry paths.
- impact: malformed payloads now fail closed without throwing or creating a worktree
- suggestedFix: none
- status: fixed
- triage: verified

### W2

- ID: W2
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-contracts, asm-review-frontend
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/worktreeAgentBox.ts:82`
- title: The normal UI can submit an oversized prompt that the host silently drops
- evidence: The shared agent box now sets `maxLength` to `MAX_CONTINUATION_INSTRUCTION`, shows a live count, and resets the count when a non-seedable agent hides and clears the prompt.
- impact: both standalone and create forms expose the host's bound before submission
- suggestedFix: none
- status: fixed
- triage: verified; W6 records the missing focused test

### W3

- ID: W3
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair, asm-review-contracts, asm-review-frontend
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeController.ts:406`
- title: Same-capability launch-target replies can arrive out of order
- evidence: `awaitingLaunchTargets` permits at most one `start` target request in flight and is cleared only by the matching capability answer, so two same-capability answers cannot interleave.
- impact: an older start-target answer can no longer overwrite a newer one from this controller
- suggestedFix: none
- status: fixed
- triage: verified under the accepted one-outstanding-request design; W6 records the absent dedup regression test

### W4

- ID: W4
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-frontend
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeView.ts:276`
- title: Launch and prune dialogs are not tracked for disposal
- evidence: `openWorktreeLaunchDialog()` now returns its idempotent shell disposer, `WorktreeView` stores it in `closeDialog`, clears it on confirm/cancel, invokes it before superseding dialogs, and invokes it on view disposal.
- impact: the launch dialog can no longer remain stacked under the next modal
- suggestedFix: none for the accepted launch half
- status: fixed
- triage: launch half verified; the pre-existing prune half is AB1

### W5

- ID: W5
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair, asm-review-performance
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/worktreeRenderSignature.ts:22`
- title: The no-op render guard rebuilds a whole-tree string on every broadcast
- evidence: Neither `3ed5253` nor `0d3d2fe` touches `worktreeRenderSignature.ts`.
- impact: none attributable to this change
- suggestedFix: none in this change
- status: rejected
- triage: rebuttal sustained — out of scope; do not re-report in this cycle

### S2

- ID: S2
- severity: SUGGEST
- confidence: MEDIUM
- priority: P4
- agent: asm-review-reuse, asm-review-contracts, asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/LaunchBuilder.ts:313`
- title: Fresh start duplicates executable-template resolution
- evidence: `resolveProbedExecutable()` is now the single template-aware probe used by both entry-backed resolution and `VaultLauncher.startAgent`. Fixed templates remain unprobed; templated launch failure throws `executable-not-found` before spawn.
- impact: start/resume/fork/continue and copy-resume no longer maintain separate template-probe decisions
- suggestedFix: none
- status: fixed
- triage: verified; the author's claim that missing fresh-start resolution previously fell through as literal `{{executable}}` was inaccurate because `buildStart` already threw, but behavior remains correct

## Rebuttal verdicts

- B3 — SUSTAINED. Neither scoped commit touches or worsens `presenceProjector.ts`.
- B4 — SUSTAINED. Neither scoped commit touches or worsens `runningSessions.ts`.
- W5 — SUSTAINED. Neither scoped commit touches or worsens `worktreeRenderSignature.ts`.
- S1 — SUSTAINED in substance. `ContinueDialog.ts` is technically touched by `3ed5253`, contrary to the literal “none of those files” premise, but only for a type rename; all duplicated lifecycle behavior and all of `worktreeDialogShell.ts` predate both commits. S1 remains audit backlog, not a finding against this change.

---

## Triage (author, round 2)

### [B1] Admission re-probes instead of checking the surface-issued target set
**Status**: accepted
**Triage**: Correct, and my round-1 fix answered the wrong question — "would this host run it"
rather than "did this host offer it", which is what the requirement says. Two probes with a
window between them is not one answer. The host now OWNS the start answer: it resolves the
targets, posts them, and keeps the snapshot per surface; admission reads that snapshot, and a
surface that was never answered admits nothing.

### [B5] Launches can use a worktree path captured before asynchronous resolution
**Status**: accepted
**Triage**: Confirmed — `actionPath` is read before the admission and resolution awaits, and
nothing looks again at the handoff. Both launch paths now carry the worktree ID through
resolution and re-resolve it immediately before the surface opens the pane.

### [W6] The remediation tests omit several changed invariants
**Status**: accepted
**Triage**: Fair — the round-1 tests proved the door exists, not that it stays shut while the
world moves. Covered now at each owner: target-snapshot drift, worktree removal during
deferred resolution, zero-choice posture refusal in `buildStart`, the templated probe failing
a fresh start, start-target request deduplication, the prompt bound and its count, and launch
dialog supersession.

### Correction to the round-1 impact manifest
The chair is right that `chosenPermissionArgs` is not `buildStart`-only — entry-backed
Continue reaches the same zero-choice hole through `permissionArgs`. That is pre-existing
behavior on a path this change does not otherwise touch, so it goes to audit backlog rather
than being fixed inside this diff.

### Audit backlog carried forward
- The prune dialog stays outside `closeDialog` ownership (pre-existing, same shape as W4).
- Entry-backed Continue ignores an explicit posture for an agent declaring none.
- Continue and worktree dialogs keep parallel modal lifecycles (round-1 S1).
