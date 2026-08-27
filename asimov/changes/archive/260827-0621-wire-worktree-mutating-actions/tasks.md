# Tasks: wire-worktree-mutating-actions

- [x] 1_1 Give the host a per-repo mutation lock that does not coalesce — verified: pnpm exec vitest run 'src/worktree/mutationQueue.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md#d1-mutation-serialization-is-its-own-per-repo-lock-not-the-rebuild-gate; specs/worktree-tree-protocol/spec.md#mutations-on-one-repository-do-not-interleave
  - **Acceptance**:
    - Outcome: two mutations queued on one repo both run, in order, and neither is dropped
    - Verify: unit src/worktree/mutationQueue.test.ts
  - **Plan**:
    1. `src/worktree/mutationQueue.ts` (new) — serialize per `repoId`; unlike `rebuildGate`, concurrent entries queue rather than coalesce, and each runs its own body
    2. `src/worktree/mutationQueue.test.ts` (new) — two entries on one repo both run in order; entries on different repos do not block each other; a body that throws releases the lock
  - **Boundary**: does NOT touch `rebuildGate` — its coalescing is correct for rebuilds

- [x] 1_2 Order every mutation against the rebuild gate, in one coordinator — verified: pnpm exec vitest run 'src/worktree/mutationCoordinator.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: design.md#d12-one-coordinator-orders-every-mutation-against-the-rebuild-gate; specs/worktree-tree-protocol/spec.md#a-mutation-resolves-against-the-rebuilt-tree-not-a-stale-cache
  - **Acceptance**:
    - Outcome: a mutation entering during a rebuild resolves against the rebuilt tree
    - Verify: unit src/worktree/mutationCoordinator.test.ts
  - **Plan**:
    1. `src/worktree/mutationCoordinator.ts` (new) — acquire queue, await a forced gate barrier, re-resolve and validate, run, force and await the post-attempt rebuild, release in `finally`
    2. `src/worktree/mutationCoordinator.test.ts` (new) — a mutation arriving mid-rebuild sees post-rebuild state; a throwing body and a failing trailing rebuild both release; the gate is never awaited while another mutation holds the queue
  - **Boundary**: lock order is one-way `mutationQueue → rebuildGate` — a gate callback that awaits the mutation queue is the deadlock this task exists to forbid

- [x] 1_3 Evaluate a removal's whole blocker set in one pass — verified: pnpm exec vitest run 'src/worktree/worktreeBlockers.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: design.md#d2-one-evaluator-produces-the-whole-blocker-set-from-sources-that-already-exist; design.md#d4-a-worktree-containing-another-registered-worktree-is-refused-not-confirmed
  - **Acceptance**:
    - Outcome: a removal target reports every blocker that applies to it, from real state
    - Verify: unit src/worktree/worktreeBlockers.test.ts
  - **Plan**:
    1. `src/worktree/worktreeBlockers.ts` (new) — one pass producing the full evidence from the cached listing, `PaneEvidenceStore`, the presence projection, and one `git status --porcelain`; containment via `src/utils/pathBoundary.ts`, never `startsWith`
    2. `src/types/messages.ts` — the evidence and assessment shapes, including `containsWorktrees` as an array
    3. `src/worktree/worktreeBlockers.test.ts` (new) — each blocker independently; **one external session yields `busyAgents: 0`, `externalAgents: 1`, and stays confirmable**; a parent holding two registered children names both; a clean worktree reports empty evidence
  - **Boundary**: `busyAgents` counts window-owned rows only — `presenceProjector` emits external sessions with `activity: "running"`, and counting them would turn an accepted confirmable blocker into a refusal

- [x] 1_4 Bind a confirmation to the identities it was shown, not to counts — verified: pnpm exec vitest run 'src/worktree/worktreeFingerprint.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_3
  - **Refs**: design.md#d3-the-fingerprint-is-issued-by-the-host-and-verified-against-a-re-evaluation; specs/worktree-tree-protocol/spec.md#{a-confirmation-authorizes-one-blocker-set-and-no-other, an-unsafe-destructive-action-returns-its-blockers-rather-than-failing, a-forced-removal-carries-the-identifier-it-was-authorized-by}
  - **Acceptance**:
    - Outcome: a confirmation re-prompts when the files at risk are replaced at equal count
    - Verify: unit src/worktree/worktreeFingerprint.test.ts
  - **Plan**:
    1. `src/worktree/worktreeFingerprint.ts` (new) — derive from evidence identities — the dirty and untracked relative-path sets, pane ids, external session ids, lock state, contained worktree ids; record per `worktreeId`; expire; admit only an identity-preserving subset
    2. `src/worktree/worktreeFingerprint.test.ts` (new) — identical proceeds; a strict subset proceeds; **one dirty file swapped for another re-prompts at equal count**; a closed pane replaced by a new one re-prompts; an unissued or expired fingerprint authorizes nothing
  - **Boundary**: a refusal must be unable to carry a fingerprint at all — the three-type split is what enforces it, not a runtime check

- [x] 1_5 Refuse what no confirmation can authorize, everywhere it is shown — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeRemoveDialog.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_4
  - **Refs**: design.md#d4-a-worktree-containing-another-registered-worktree-is-refused-not-confirmed; specs/worktree-tree-protocol/spec.md#some-blockers-no-confirmation-can-override; specs/worktree-panel/spec.md#a-refusal-names-the-reason-it-actually-has
  - **Acceptance**:
    - Outcome: an unconditionally blocked removal offers no confirmation, and the refusal box names the reason that actually applies
    - Verify: unit src/webview/worktree/WorktreeRemoveDialog.test.ts
  - **Plan**:
    1. `src/worktree/worktreeBlockers.ts` — emit `RemovalRefusal` for `isMain`, `busyAgents > 0`, and non-empty `containsWorktrees`, so no code path reaches a force with one set
    2. `src/webview/worktree/worktreeViewTypes.ts`, `src/webview/worktree/worktreeFixtures.ts` — the blocker contract gains `containsWorktrees`; the refusal versus confirmable split reaches the dialog
    3. `src/webview/worktree/WorktreeRemoveDialog.ts` — `isRemoveRefused` covers containment; the refusal box gains its own explanation instead of falling through to the agent copy; `buildBlockerList` names every contained worktree
    4. `src/webview/worktree/WorktreeRemoveDialog.test.ts`, `src/worktree/worktreeBlockers.test.ts` — each refusal independently; **a containment refusal does not render the "agent is mid-turn" text**; two children are both named; a refusal carries no fingerprint
  - **Boundary**: refusal only — a recursive remove-with-children is a different operation and is not built here

- [x] 2_1 Run lock, unlock, and prune against real git — verified: pnpm exec vitest run 'src/worktree/worktreeMutations.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: design.md#d12-one-coordinator-orders-every-mutation-against-the-rebuild-gate; specs/worktree-tree-protocol/spec.md#{a-mutating-action-resolves-its-own-target, git-is-invoked-as-an-argument-vector}
  - **Acceptance**:
    - Outcome: locking, unlocking, and pruning change real git state and the tree reflects it
    - Verify: unit src/worktree/worktreeMutations.test.ts
  - **Plan**:
    1. `src/worktree/worktreeMutations.ts` (new) — lock / unlock / prune as argv vectors through `gitCommandRunner`, each run through the 1_2 coordinator; a lock reason is one bounded argv token; prune reports the count it dropped
    2. `src/types/messages.ts`, `src/providers/WorktreeHost.ts` — the message family and its cases
    3. `src/worktree/worktreeMutations.test.ts` (new), `src/providers/WorktreeHost.actions.test.ts` — argv shape per verb; a leading-`-` reason or ref is rejected; a stale id runs no command; the host reaches each verb's capability
  - **Boundary**: the least destructive three first — remove and create land in 2_2 and 3_2

- [x] 2_2 Remove a worktree, and report honestly when the state is unclear — verified: pnpm exec vitest run 'src/worktree/worktreeMutations.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_5, 2_1
  - **Refs**: design.md#d5-removal-carries-its-own-timeout-separate-from-the-listings; design.md#d11-indeterminate-is-a-comparison-not-a-guess; specs/worktree-tree-protocol/spec.md#{every-mutation-attempt-is-followed-by-a-rebuild, a-removal-that-was-killed-is-never-reported-as-a-clean-failure}
  - **Acceptance**:
    - Outcome: a removal killed mid-delete reports `indeterminate`, even though the directory and the registration both still exist
    - Verify: unit src/worktree/worktreeMutations.test.ts
  - **Plan**:
    1. `src/worktree/gitCommandRunner.ts` — a per-call timeout and cancellation parameter on `run`, since the current timeout is fixed at construction and a removal-specific budget is otherwise unimplementable
    2. `src/worktree/worktreeMutations.ts` — remove, on its own longer budget; `--force` only behind a matched fingerprint, `--force --force` for a locked target; journal the target's registration and path before the spawn
    3. `src/providers/WorktreeHost.ts` — rebuild after every attempt including failure and timeout; compare against the journal; a killed or timed-out removal and a failed listing are each `indeterminate` unconditionally; hold the lock until the child is confirmed terminated, and quarantine the repo when it cannot be
    4. `src/worktree/worktreeMutations.test.ts`, `src/providers/TerminalViewProvider.worktree.test.ts`, `src/providers/WorktreeHost.actions.test.ts` — unforced by default; a locked target needs the doubled flag; **a timeout leaving directory and registration intact still reports `indeterminate`**; a failed listing reports `indeterminate`; no retry
  - **Boundary**: never `rm -rf` — deletion is git's, per design.md § Design Constraints

- [x] 3_1 Resolve the create path, as untrusted input — verified: pnpm exec vitest run 'src/worktree/createPath.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: design.md#d6-the-create-path-is-validated-as-untrusted-input-and-re-validated-at-execution; design.md#d7-the-create-root-is-detected-from-the-repo-and-an-explicit-setting-outranks-detection; specs/worktree-tree-protocol/spec.md#{a-create-path-is-validated-as-untrusted-input, a-create-path-is-re-checked-against-the-filesystem-it-will-be-created-on}
  - **Acceptance**:
    - Outcome: the form is offered the free path the host will actually use, and a hostile path is refused
    - Verify: unit src/worktree/createPath.test.ts
  - **Plan**:
    1. `src/worktree/createPath.ts` (new) — root precedence, suffix-until-free, and the validation pipeline: **`lstat` the original lexical components BEFORE normalizing**, then normalize for identity and containment
    2. `src/settings/SettingsReader.ts`, `package.json` — declare and read `anywhereTerminal.worktree.createRoot`; explicitly-set outranks detection even when its value equals the default
    3. `src/worktree/createPath.test.ts` (new) — each precedence tier; detection infers the root and never a naming pattern; a taken path suffixes; **`/safe/link/new` where `link` is a symlink is refused, not silently resolved to the link's target**; an existing empty candidate re-checks its own identity and emptiness, not its parent's; non-absolute, inside-a-linked-worktree, and is-the-main-worktree each refused
  - **Boundary**: resolution and validation only — the git invocation is 3_2

- [x] 3_2 Create a worktree, and keep the parent's status clean — verified: pnpm exec vitest run 'src/worktree/worktreeMutations.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_1, 1_2, 2_1
  - **Refs**: design.md#d8-a-create-under-a-root-inside-the-main-worktree-writes-infoexclude-and-a-failure-there-does-not-block; design.md#d9-create-ships-without-its-agent-mode-and-validation-rejects-that-mode; specs/worktree-panel/spec.md#{a-created-worktree-names-the-destination-it-will-actually-use, the-panel-s-mutating-actions-perform-what-they-offer}
  - **Acceptance**:
    - Outcome: a create makes the worktree and leaves the parent repo's status clean
    - Verify: unit src/worktree/worktreeMutations.test.ts
  - **Plan**:
    1. `src/worktree/worktreeMutations.ts` — create, one argv shape per case — new branch, existing branch, or detached at a ref; no `--force`, so git's own refusal text reaches the user
    2. `src/worktree/gitExclude.ts` (new) — add a root to `.git/info/exclude` once, idempotently; never `.gitignore`; a write failure is reported and does not fail the create
    3. `src/providers/WorktreeHost.ts` — re-validate the path immediately before spawning, after the coordinator's queue wait; reject `openAfter: "agent"` as defense in depth
    4. `src/worktree/gitExclude.test.ts` (new), `src/worktree/worktreeMutations.test.ts`, `src/types/messages.ts`, `src/providers/TerminalViewProvider.worktree.test.ts`, `src/providers/WorktreeHost.actions.test.ts` — the exclude entry is written once and not duplicated; a failed exclude still reports the create as succeeded; `agent` is rejected
  - **Boundary**: does NOT launch an agent — WT-005.3 owns § 4 and the fresh-launch capability

- [x] 4_1 Offer the mutating actions in the panel, and only where they apply — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeContextMenu.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_2, 3_2
  - **Refs**: design.md#d13-prune-is-confirmed-and-the-count-is-what-the-confirmation-is-for; design.md#d9-create-ships-without-its-agent-mode-and-validation-rejects-that-mode; specs/worktree-panel/spec.md#{the-panel-s-mutating-actions-perform-what-they-offer, a-removal-states-what-it-destroys-and-what-it-spares, prune-names-how-many-registrations-it-drops, a-deferred-mode-is-absent-from-the-create-form}
  - **Acceptance**:
    - Outcome: each mutating menu item performs its action, and prune states its count first
    - Verify: unit src/webview/worktree/WorktreeContextMenu.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeController.ts` — supply the mutating capabilities through the same optional-capability shape the read-only ones use
    2. `src/webview/worktree/WorktreeContextMenu.ts` — `WorktreeMenuActions` gains prune; prune absent when the repo has nothing prunable; the lock item reflects current lock state
    3. `src/webview/worktree/WorktreePruneDialog.ts` (new) — the confirmation, naming the host-supplied count of registrations to be dropped, on `worktreeDialogShell`
    4. `src/webview/worktree/WorktreeCreateDialog.ts` — **remove `agent` from `OPEN_AFTER` and its agent box**, so the deferred mode is absent rather than selectable and inert
    5. `src/webview/worktree/WorktreeRemoveDialog.ts` — the confirmation states that the directory goes irrevocably, the branch is kept, and panes are left running
    6. `src/webview/worktree/WorktreeController.test.ts`, `WorktreeContextMenu.test.ts`, `src/webview/worktree/WorktreePruneDialog.test.ts` (new), `src/webview/worktree/WorktreeCreateDialog.test.ts`, `src/webview/worktree/WorktreeRemoveDialog.test.ts`, `src/webview/worktree/WorktreeController.test.ts` — each item posts its message; nothing-prunable offers no prune; prune confirms with the count; **no agent option exists even when the repo fixture has agents**; the removal copy names all three consequences
  - **Boundary**: the `indeterminate` notice's own Prune button (`WorktreeView.ts:661-671`) stays unconfirmed — the user is reading the observation report, which says more than the count would

- [x] 4_2 Reflect a mutation's result in the panel — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeView.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_1
  - **Refs**: specs/worktree-panel/spec.md#a-mutation-that-fails-leaves-the-panel-showing-reality; design.md#d11-indeterminate-is-a-comparison-not-a-guess
  - **Acceptance**:
    - Outcome: a failed mutation shows git's own message and a tree matching reality
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeView.ts` — render the three outcomes distinctly, with git's bounded stderr as the error text and `indeterminate` reading as unclear rather than failed
    2. `src/webview/worktree/WorktreeView.test.ts` — each outcome renders distinctly; an `indeterminate` result does not read as a clean failure; no retry affordance is offered
  - **Boundary**: presentation only — the outcomes themselves are produced in 2_2

- [x] 5_1 Prove the destructive paths against real git, not against argv spies — verified: pnpm exec vitest run 'src/worktree/worktreeMutations.integration.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_2, 3_2
  - **Refs**: design.md#d4-a-worktree-containing-another-registered-worktree-is-refused-not-confirmed; design.md#d11-indeterminate-is-a-comparison-not-a-guess; specs/worktree-tree-protocol/spec.md#a-removal-that-was-killed-is-never-reported-as-a-clean-failure
  - **Acceptance**:
    - Outcome: on a temporary repository, git's actual deletion and metadata behavior matches what the safety model claims
    - Verify: integration src/worktree/worktreeMutations.integration.test.ts
  - **Plan**:
    1. `src/worktree/worktreeMutations.integration.test.ts` (new), `src/worktree/worktreeMutations.ts` — a temporary repo per case: a nested registered worktree is refused and survives; a locked worktree needs `--force --force`; a create into an existing empty directory succeeds; a killed removal reports `indeterminate`; prune drops exactly the count it reported
  - **Boundary**: only the cases where **git's own behavior** is the claim under test — argv shape, precedence, and path validation stay in the unit tests that already cover them

- [x] 6_1 Make the queue and the confirmation single-use (round-1 W1, B5, W2) — verified: pnpm exec vitest run 'src/worktree/mutationQueue.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 5_1
  - **Refs**: .reviews/round-1.md#w1; .reviews/round-1.md#b5; specs/worktree-tree-protocol/spec.md#a-confirmation-authorizes-one-blocker-set-and-no-other
  - **Acceptance**:
    - Outcome: a synchronous throw releases the repo, and a fingerprint authorizes exactly one attempt
    - Verify: unit src/worktree/mutationQueue.test.ts
  - **Plan**:
    1. `src/worktree/mutationQueue.ts` — invoke the body inside the try, so a synchronous throw still decrements
    2. `src/worktree/worktreeFingerprint.ts` — consume the record on verify; invalidate after every attempt whatever its outcome; evict expired records on access
    3. `src/worktree/mutationQueue.test.ts`, `src/worktree/worktreeFingerprint.test.ts` — a synchronous throw leaves `isBusy` false; a verified fingerprint is not verifiable twice; an expired record is gone from the store, not merely refused

- [x] 6_2 Validate a create path on the platform it will run on (round-1 B3, B4) — verified: pnpm exec vitest run 'src/worktree/createPath.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 5_1
  - **Refs**: .reviews/round-1.md#b3; .reviews/round-1.md#b4; design.md#d6-the-create-path-is-validated-as-untrusted-input-and-re-validated-at-execution
  - **Acceptance**:
    - Outcome: a Windows drive-rooted path walks its real components, and the recheck compares identity rather than mere existence
    - Verify: unit src/worktree/createPath.test.ts
  - **Plan**:
    1. `src/worktree/createPath.ts` — preserve `api.parse(raw).root` as the walk's origin; use the injected `api` for detection and suggestion instead of `nodePath.posix`; widen the `lstat` dep to carry a filesystem identity and compare it at recheck, naming the platforms where that identity is not trustworthy
    2. `src/worktree/createPath.test.ts` — `C:\safe\link\new` is refused; a UNC root is not mangled; detection and suggestion hold on win32; a recheck against a replaced-but-still-empty directory is refused
  - **Boundary**: the residual race stays stated, not closed — proposal.md:49-50 governs

- [x] 6_3 Supply the mutations in production, resolved from ids (round-1 B1, B2) — verified: pnpm exec vitest run 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 6_1, 6_2
  - **Refs**: .reviews/round-1.md#b1; .reviews/round-1.md#b2; design.md#d12-one-coordinator-orders-every-mutation-against-the-rebuild-gate; specs/worktree-panel/spec.md#the-panel-s-mutating-actions-perform-what-they-offer
  - **Acceptance**:
    - Outcome: a mutation message posted at the real extension seam reaches git through the coordinator, resolved from its id after the rebuild
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `src/worktree/worktreeMutationService.ts` (new) — compose queue, coordinator, blockers, fingerprint, createPath, gitExclude and the git verbs into the five capabilities
    2. `src/providers/WorktreeHost.ts` — capabilities take `{ repoId, worktreeId }`; the host stops pre-resolving and exposes the resolver and forced rebuild the service needs
    3. `src/extension.ts` — supply all five at the existing `createWorktreeActions` seam
    4. `src/providers/WorktreeHost.actions.test.ts`, `src/worktree/worktreeMutationService.test.ts` (new), `src/extension.worktreeMutations.test.ts` (new) — a stale id resolves to nothing and runs no command; resolution happens after the forced rebuild, not before; `activate` hands the host all five capabilities

- [x] 6_4 Give create, prune and their outcomes a shipped path (round-1 B1) — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeController.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 6_3
  - **Refs**: .reviews/round-1.md#b1; specs/worktree-panel/spec.md#a-mutation-that-fails-leaves-the-panel-showing-reality
  - **Acceptance**:
    - Outcome: the panel can start a create and a prune, and sees the outcome of each
    - Verify: unit src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. `src/types/messages.ts` — the outbound mutation result and create-defaults messages
    2. `src/webview/worktree/WorktreeController.ts` — the create submitter and the repo-scoped prune, both resolver-driven so neither can post an id the webview guessed
    3. `src/webview/worktree/WorktreeController.test.ts` — each entry path posts; a zero count and an absent resolver each post nothing; the deferred agent mode posts nothing

- [x] 7_1 Walk a create path with the platform's own separator (round-2 B3) — verified: pnpm exec vitest run 'src/worktree/createPath.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 6_4
  - **Refs**: .reviews/round-2.md#b3; design.md#d6-the-create-path-is-validated-as-untrusted-input-and-re-validated-at-execution
  - **Acceptance**:
    - Outcome: a POSIX path whose component contains a backslash is walked as one component, and its later symlink is still found
    - Verify: unit src/worktree/createPath.test.ts
  - **Plan**:
    1. `src/worktree/createPath.ts` — split on `/` for posix and on both separators only for win32
    2. `src/worktree/createPath.test.ts` — `/safe/foo\bar/link/new` is refused for the symlink at `link`, not silently passed; the win32 drive-root and UNC cases still hold
  - **Boundary**: separator handling only — the identity work is 7_2

- [x] 7_2 Validate a create path on both sides of the queue wait (round-2 B4) — verified: pnpm exec vitest run 'src/worktree/worktreeMutationService.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 7_1
  - **Refs**: .reviews/round-2.md#b4; design.md#d6-the-create-path-is-validated-as-untrusted-input-and-re-validated-at-execution
  - **Acceptance**:
    - Outcome: a candidate replaced by a different empty directory during the queue wait is refused
    - Verify: unit src/worktree/worktreeMutationService.test.ts
  - **Plan**:
    1. `src/worktree/worktreeMutationService.ts` — validate before entering the queue, retain the result, and after the barrier re-run the FULL check — lexical, normalize, containment, type, emptiness via `mustBeEmpty`, and identity — immediately before the spawn
    2. `src/worktree/worktreeMutationService.test.ts` — the two observations happen in that order; a swapped-but-empty candidate is refused; `mustBeEmpty` is honoured on the second pass

- [x] 7_3 Make unreadable evidence its own outcome (round-2 B6) — verified: pnpm exec vitest run 'src/worktree/worktreeBlockers.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 6_4
  - **Refs**: design.md#d16-evidence-that-cannot-be-read-is-its-own-outcome-and-it-refuses; specs/worktree-tree-protocol/spec.md#a-removal-whose-risk-cannot-be-read-is-not-reported-as-safe
  - **Acceptance**:
    - Outcome: a removal whose `git status` failed names the unreadable source and runs no git
    - Verify: unit src/worktree/worktreeBlockers.test.ts
  - **Plan**:
    1. `src/worktree/worktreeBlockers.ts` — the third assessment member; the three sources carry typed failure instead of a fallback value
    2. `src/providers/WorktreeHost.ts` — `assessRemoval` propagates a non-zero status, a failed registry read, and a `degraded` repo instead of substituting `""`, `[]` and current
    3. `src/worktree/worktreeBlockers.test.ts`, `src/providers/WorktreeHost.actions.test.ts` — each source independently; a clean read is still confirmable
  - **Boundary**: `unavailable` is not a refusal — it must stay distinguishable, because only it offers a retry

- [x] 7_4 Evaluate blockers on every removal, not only a forced one (round-2 B1) — verified: pnpm exec vitest run 'src/worktree/worktreeMutationService.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 7_3, 7_2
  - **Refs**: .reviews/round-2.md#b1; design.md#d2-one-evaluator-produces-the-whole-blocker-set-from-sources-that-already-exist
  - **Acceptance**:
    - Outcome: an unforced removal of a worktree holding an idle pane returns its blockers instead of running git
    - Verify: unit src/worktree/worktreeMutationService.test.ts
  - **Plan**:
    1. `src/worktree/worktreeMutationService.ts` — `assessRemoval` runs on every removal; a `confirmable` result on an unforced call returns the blockers and a fingerprint rather than spawning git
    2. `src/worktree/worktreeMutationService.test.ts` — an unforced removal with blockers runs nothing and carries a fingerprint; with none, it proceeds

- [x] 7_5 Destroy a confirmation when its worktree disappears, and spend it on every exit (round-2 B5) — verified: pnpm exec vitest run 'src/worktree/worktreeFingerprint.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 7_4
  - **Refs**: design.md#d15-a-confirmation-is-invalidated-by-observation-not-by-a-marker-on-the-target; specs/worktree-tree-protocol/spec.md#{a-confirmation-does-not-survive-the-disappearance-of-what-it-was-issued-for, a-confirmation-authorizes-one-attempt}
  - **Acceptance**:
    - Outcome: a confirmation issued before a removal authorizes nothing against a worktree recreated at the same path
    - Verify: unit src/worktree/worktreeFingerprint.test.ts
  - **Plan**:
    1. `src/worktree/worktreeFingerprint.ts` — `incarnation` leaves `FingerprintTarget`; the store gains the observation that drops a worktree's record
    2. `src/worktree/worktreeMutationService.ts` — every forced exit spends the token, including the ones that never reach git; the post-attempt rebuild reports what it no longer found
    3. `src/worktree/worktreeFingerprint.test.ts`, `src/worktree/worktreeMutationService.test.ts` — a recreate cannot inherit; an unreadable assessment spends the token; a vanished target spends it

- [x] 7_6 Observe a removal's aftermath independently of the listing (round-2 B7) — verified: pnpm exec vitest run 'src/extension.worktreeMutations.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 7_5
  - **Refs**: .reviews/round-2.md#b7; design.md#d11-indeterminate-is-a-comparison-not-a-guess
  - **Acceptance**:
    - Outcome: a removal leaving the directory behind reports `indeterminate`
    - Verify: unit src/extension.worktreeMutations.test.ts
  - **Plan**:
    1. `src/extension.ts`, `src/worktree/worktreeMutationService.ts`, `src/providers/WorktreeHost.ts` — `observeAfter` receives the journalled path and always stats it rather than inferring it from the registration lookup, and returns null when the post-attempt listing was degraded
    2. `src/extension.worktreeMutations.test.ts`, `src/worktree/worktreeMutationService.test.ts` — registration gone but directory present is `indeterminate`; a degraded listing is `indeterminate`; the journalled path is what gets statted

- [x] 7_7 Give create, prune and every outcome a typed path to the panel (round-2 B1, W3) — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeController.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 7_6
  - **Refs**: design.md#{d17-results-return-to-the-surface-that-asked-the-tree-refresh-goes-to-everyone, d14-the-panel-derives-the-prune-count-it-already-holds-the-host-re-counts-authoritatively, d8-a-create-under-a-root-inside-the-main-worktree-writes-infoexclude-and-a-failure-there-does-not-block}; specs/worktree-panel/spec.md#{the-panel-states-the-outcome-of-every-mutation-it-started, a-create-that-asked-for-a-terminal-gets-one}
  - **Acceptance**:
    - Outcome: a create started from the panel opens with the host's own destination and reports its outcome there
    - Verify: unit src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. `src/types/messages.ts` — the two outbound messages, added to the union and its exhaustiveness guard
    2. `src/providers/WorktreeHost.ts` — resolve create defaults on request; route each outcome to the ORIGINATING surface; perform `openAfter: "terminal"` through that surface's `openTerminal`
    3. `src/worktree/worktreeMutationService.ts` — call `gitExclude` when the resolved path is inside the main worktree, per D8; stop posting to providers directly
    4. `src/extension.ts` — stop posting results from the service wiring; the host owns delivery
    5. `src/providers/WorktreeHost.actions.test.ts` — defaults are resolved on request; each outcome reaches the originating surface and not the others; a terminal create reaches that surface's `openTerminal`
    6. `src/worktree/worktreeMutationService.test.ts` — the harness gains the two `gitExclude` deps step 3 added

- [x] 7_8 Open the create dialog on the host's destination, and show what happened (round-2 B1) — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeController.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 7_7
  - **Refs**: design.md#{d17-results-return-to-the-surface-that-asked-the-tree-refresh-goes-to-everyone, d14-the-panel-derives-the-prune-count-it-already-holds-the-host-re-counts-authoritatively}; specs/worktree-panel/spec.md#the-panel-states-the-outcome-of-every-mutation-it-started
  - **Acceptance**:
    - Outcome: the create dialog opens showing the host's destination, and each outcome renders
    - Verify: unit src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeController.ts` — supply `createDialogDeps` from the host defaults; derive the prune count from `prunable`; route the result message to the view
    2. `src/webview/worktree/WorktreeView.ts` — render each outcome, with a retry offered only on `unavailable`
    3. `src/webview/worktree/WorktreeController.test.ts`, `src/webview/worktree/WorktreeView.test.ts` — the dialog opens on host defaults; prune offers the derived count; each outcome renders distinctly; only `unavailable` offers retry
    4. `src/types/messages.ts`, `src/providers/WorktreeHost.ts`, `src/providers/WorktreeHost.actions.test.ts`, `src/extension.ts`, `src/worktree/worktreeMutationService.ts` — the defaults message gains the branch prefix and the collided candidate, and every result gains the scope its notice attaches to
    5. `src/webview/worktree/worktreeViewTypes.ts`, `src/webview/messaging/MessageRouter.ts`, `src/webview/main.ts` — the `unavailable` outcome, and the two messages routed to the controller

## Round-3 fixes (cycle 2)

Sequential, not a wave: every task below touches at least one file another one leases.

- [x] 8_1 Make the menu actually offer create, and prune actually confirm (round-3 B1, B9, B11, W8, W9) — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeContextMenu.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 7_8
  - **Refs**: design.md#{d13-a-prune-confirmation-names-the-count-it-will-drop, d17-results-return-to-the-surface-that-asked-the-tree-refresh-goes-to-everyone}; docs/design/worktree-actions.md#3
  - **Acceptance**:
    - Outcome: the menu offers create, and a prune opens its confirmation before posting
    - Verify: unit src/webview/worktree/WorktreeContextMenu.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeContextMenu.ts` — render the create item; absent only when no capability was supplied
    2. `src/webview/worktree/WorktreeController.ts`, `src/webview/worktree/WorktreeView.ts` — route both prune paths through the dialog and post only from its confirm; omit a blank `baseRef` and a blank branch; keep `repoId` on a blocked result
    3. `src/webview/worktree/WorktreeContextMenu.test.ts`, `src/webview/worktree/WorktreeController.test.ts` — the item renders; a click confirms before posting; a blank base ref is absent from the message; an invalid branch never posts

- [x] 8_2 A confirmation dies with the thing it was issued for, wherever that is observed (round-3 B5, W5) — verified: pnpm exec vitest run 'src/worktree/worktreeMutationService.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 8_1
  - **Refs**: design.md#d15-a-confirmation-does-not-survive-the-disappearance-of-what-it-was-issued-for
  - **Acceptance**:
    - Outcome: no token survives an observation that its worktree is gone, on any path that makes that observation
    - Verify: unit src/worktree/worktreeMutationService.test.ts
  - **Plan**:
    1. `src/worktree/worktreeMutationService.ts` — spend the token on the missing-target exit; take the post-attempt rebuild from the coordinator instead of running a third one
    2. `src/worktree/mutationCoordinator.ts` — expose the post-attempt rebuild's result to the body's classifier rather than throwing past it
    3. `src/providers/WorktreeHost.ts`, `src/extension.ts` — reconcile fingerprints against every authoritative rebuild, not only the one a removal drives
    4. `src/worktree/worktreeMutationService.test.ts`, `src/providers/WorktreeHost.actions.test.ts` — a token issued before a disappearance cannot authorize a same-path recreate, whether the disappearance was observed by a removal or by a watcher

- [x] 8_3 A missing registration can still be removed (round-3 B8) — verified: pnpm exec vitest run 'src/worktree/worktreeBlockers.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 8_2
  - **Refs**: design.md#d16-evidence-that-could-not-be-read-is-not-evidence-of-safety; docs/design/worktree-actions.md#3.3
  - **Acceptance**:
    - Outcome: removing a worktree whose directory is gone succeeds and prunes the registration
    - Verify: unit src/worktree/worktreeBlockers.test.ts
  - **Plan**:
    1. `src/providers/WorktreeHost.ts` — do not ask a missing directory for its status; mark that source not-applicable rather than unreadable
    2. `src/worktree/worktreeBlockers.ts` — a not-applicable source is distinct from an unreadable one and from a clean one
    3. `src/worktree/worktreeBlockers.test.ts`, `src/providers/WorktreeHost.actions.test.ts` — a missing worktree is confirmable on its remaining evidence; an unreadable status on a PRESENT directory is still `unavailable`

- [x] 8_4 The exclude entry is a pattern, and a path cannot write one of its own (round-3 B10) — verified: pnpm exec vitest run 'src/worktree/gitExclude.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 8_3
  - **Refs**: design.md#d8-a-create-under-a-root-inside-the-main-worktree-writes-infoexclude-and-a-failure-there-does-not-block
  - **Acceptance**:
    - Outcome: the exclude entry is one repo-relative escaped pattern that actually matches, and no create path can add a second line
    - Verify: unit src/worktree/gitExclude.test.ts
  - **Plan**:
    1. `src/worktree/createPath.ts` — reject CR, LF and other control characters in a create path
    2. `src/worktree/gitExclude.ts` — take a repo-relative root, escape git's pattern metacharacters, and refuse an entry that is not a single line
    3. `src/worktree/worktreeMutationService.ts`, `src/extension.ts` — derive the relative root rather than passing the absolute path
    4. `src/worktree/gitExclude.test.ts`, `src/worktree/createPath.test.ts` — a newline path is rejected; the written entry matches the created directory; a repeated create still writes once

- [x] 8_5 The destination the form shows is the one it submits (round-3 B12) — verified: pnpm exec vitest run 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 8_4
  - **Refs**: specs/worktree-panel/spec.md#a-created-worktree-names-the-destination-it-will-actually-use
  - **Acceptance**:
    - Outcome: the create form submits the free path the host resolved for the typed branch
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `src/extension.ts` — supply `createRoot` from `readWorktreeCreateRoot`
    2. `src/types/messages.ts` — the defaults request carries the branch it is asking about
    3. `src/providers/WorktreeHost.ts`, `src/worktree/createPath.ts` — resolve the free path for that branch, checking the filesystem as well as the registrations; the branch→segment rule moves beside the other path rules so host and form share one
    4. `src/webview/worktree/WorktreeController.ts`, `src/webview/worktree/WorktreeCreateDialog.ts` — re-ask on branch change and submit the host's path verbatim
    5. `src/providers/WorktreeHost.actions.test.ts`, `src/webview/worktree/WorktreeController.test.ts` — the configured root wins; the submitted path is the one the host returned

- [x] 8_6 An unreadable filesystem is not an absent one (round-3 B13, W4, W7) — verified: pnpm exec vitest run 'src/worktree/worktreeMutationService.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 8_5
  - **Refs**: design.md#d16-evidence-that-could-not-be-read-is-not-evidence-of-safety
  - **Acceptance**:
    - Outcome: a stat that fails for a reason other than absence is reported indeterminate
    - Verify: unit src/worktree/worktreeMutationService.test.ts
  - **Plan**:
    1. `src/extension.ts` — distinguish ENOENT from every other stat rejection
    2. `src/worktree/worktreeMutations.ts` — `countPrunable` returns a typed read, not `0`
    3. `src/worktree/worktreeMutationService.ts` — validate the confirmed count at the boundary; report an open-after failure beside a successful create rather than instead of it
    4. `src/worktree/worktreeMutationService.test.ts`, `src/worktree/worktreeMutations.test.ts`, `src/worktree/worktreeMutations.integration.test.ts`, `src/extension.worktreeMutations.test.ts` — each of the three, with the negative that a genuine absence is still a clean success, and one against the deps `activate` actually supplies

- [x] 8_7 Notices survive the row they were about (round-3 B1 third half, W6) — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeController.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 8_6
  - **Refs**: specs/worktree-panel/spec.md#the-panel-states-the-outcome-of-every-mutation-it-started
  - **Acceptance**:
    - Outcome: a removal's outcome stays visible after its row leaves the tree
    - Verify: unit src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeController.ts` — reconcile results and defaults against each tree response; re-scope a result whose row has gone to its repository
    2. `src/webview/worktree/WorktreeView.ts` — render a repo-scoped notice for a row that no longer exists
    3. `src/webview/worktree/worktreeViewTypes.ts` — a re-scoped notice carries the row it outlived
    4. `src/webview/worktree/WorktreeController.test.ts`, `src/webview/worktree/WorktreeView.test.ts` — a successful removal's notice renders after the row disappears; a stale default is dropped

- [x] 8_8 Prune reports to the surface that asked (round-3 B1 second half) — verified: pnpm exec vitest run 'src/extension.worktreeMutations.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 8_7
  - **Refs**: design.md#d17-results-return-to-the-surface-that-asked-the-tree-refresh-goes-to-everyone
  - **Acceptance**:
    - Outcome: a prune's outcome reaches the surface that started it
    - Verify: unit src/extension.worktreeMutations.test.ts
  - **Plan**:
    1. `src/extension.ts` — forward the origin argument
    2. `src/extension.worktreeMutations.test.ts` — every capability production supplies forwards every argument its type declares

- [x] 8_9 One test that walks the real assembly (round-3 verification gap) — verified: pnpm exec vitest run 'src/extension.worktreeMutations.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 8_8
  - **Refs**: specs/worktree-panel/spec.md#the-panel-states-the-outcome-of-every-mutation-it-started
  - **Acceptance**:
    - Outcome: each mutating verb is driven from the rendered menu item down to git argv
    - Verify: unit src/extension.worktreeMutations.test.ts
  - **Plan**:
    1. `src/extension.worktreeAssembly.test.ts` — drive each mutating verb from the rendered menu item down to the git argv, so a callback nothing renders fails the test. Its own file because the walk needs a jsdom environment the node-side capability tests must not take on

## Round-4 fixes (cycle 2, bounded extension round)

Sequential: every task below touches at least one file another one leases.

- [x] 9_1 A result is re-scoped when it ARRIVES, not when a tree does (round-4 B1, W7, W6) — verified: pnpm exec vitest run 'src/extension.worktreeAssembly.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 8_9
  - **Refs**: specs/worktree-panel/spec.md#the-panel-states-the-outcome-of-every-mutation-it-started
  - **Acceptance**:
    - Outcome: a successful removal's notice is visible in the order production actually produces — rebuilt tree first, result second
    - Verify: unit src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeController.ts` — re-scope an incoming result whose row is absent from the current tree; bound repo-level orphan notices
    2. `src/worktree/worktreeMutationService.ts`, `src/types/messages.ts`, `src/extension.ts` — a create whose open-after failed is ONE partial-success outcome, not a success followed by an error that replaces it
    3. `src/webview/worktree/worktreeViewTypes.ts`, `src/webview/worktree/WorktreeView.ts` — render that partial success as a success that names what did not happen
    4. `src/webview/worktree/WorktreeController.test.ts`, `src/webview/worktree/WorktreeView.test.ts`, `src/worktree/worktreeMutationService.test.ts` — the production order, tree first
    5. `src/extension.worktreeAssembly.test.ts` — the removal's notice observed through the real assembly, which is the only place the order is not a test's choice

- [x] 9_2 The host probes the filesystem production actually has (round-4 B12) — verified: pnpm exec vitest run 'src/extension.worktreeAssembly.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 9_1
  - **Refs**: specs/worktree-panel/spec.md#a-created-worktree-names-the-destination-it-will-actually-use
  - **Acceptance**:
    - Outcome: an unregistered occupied directory is taken in production, not only in a test harness
    - Verify: unit src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. `src/extension.ts` — supply `exists`
    2. `src/providers/WorktreeHost.ts`, `src/types/messages.ts`, `src/webview/worktree/WorktreeController.ts`, `src/webview/worktree/worktreeViewTypes.ts` — carry the branch back on the answer so a stale reply is identifiable
    3. `src/webview/worktree/WorktreeCreateDialog.ts` — ignore an answer for a branch the form has moved past, and do not submit while one is outstanding
    4. `src/extension.worktreeAssembly.test.ts`, `src/webview/worktree/WorktreeController.test.ts`, `src/webview/worktree/WorktreeCreateDialog.test.ts` — the probe reaches the real filesystem seam; a stale answer changes nothing

- [x] 9_3 One exclude pattern for the create root, in git's separators (round-4 B10) — verified: pnpm exec vitest run 'src/worktree/gitExclude.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 9_2
  - **Refs**: design.md#d8-a-create-root-inside-the-main-worktree-must-not-dirty-its-status
  - **Acceptance**:
    - Outcome: the entry git receives is one root pattern using `/`, on every platform
    - Verify: unit src/worktree/gitExclude.test.ts
  - **Plan**:
    1. `src/worktree/gitExclude.ts` — convert separators rather than escaping them
    2. `src/extension.ts` — derive the create root, not the leaf
    3. `src/worktree/gitExclude.test.ts`, `src/worktree/worktreeMutationService.test.ts` — a Windows path and a repeat create

- [x] 9_4 Git judges the branch name, not us (round-4 W9) — verified: pnpm exec vitest run 'src/worktree/worktreeMutationService.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 9_3
  - **Refs**: specs/worktree-panel/spec.md#a-created-worktree-names-the-destination-it-will-actually-use
  - **Acceptance**:
    - Outcome: an invalid branch name is refused before any worktree is created
    - Verify: unit src/worktree/worktreeMutationService.test.ts
  - **Plan**:
    1. `src/worktree/worktreeMutations.ts` — ask `git check-ref-format --branch`
    2. `src/worktree/worktreeMutationService.ts` — refuse before the create
    3. `src/worktree/worktreeMutationService.test.ts`, `src/worktree/worktreeMutations.test.ts` — a rejected name creates nothing; a valid one is untouched

- [x] 9_5 A rebuild that fails is not a rebuild that happened (round-4 W10, S1) — verified: pnpm exec vitest run 'src/worktree/mutationCoordinator.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 9_4
  - **Refs**: design.md#d12-every-mutation-resolves-against-a-freshly-rebuilt-tree
  - **Acceptance**:
    - Outcome: a rejected settle still leaves the fallback rebuild able to run
    - Verify: unit src/worktree/mutationCoordinator.test.ts
  - **Plan**:
    1. `src/worktree/mutationCoordinator.ts` — memoize the in-flight rebuild, mark completion only on success
    2. `src/worktree/worktreeMutationService.ts` — spend a forced token even when the assessment throws
    3. `src/worktree/mutationCoordinator.test.ts`, `src/worktree/worktreeMutationService.test.ts`

- [x] 9_6 The assembly walk covers every verb it claims (round-4 W11) — verified: pnpm exec vitest run 'src/extension.worktreeAssembly.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 9_5
  - **Refs**: specs/worktree-panel/spec.md#the-panel-states-the-outcome-of-every-mutation-it-started
  - **Acceptance**:
    - Outcome: unlock, a submitted create and a confirmed prune each reach git argv from the rendered surface
    - Verify: unit src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. `src/extension.worktreeAssembly.test.ts` — click Unlock on a locked row, submit the create form, confirm a prune whose count is non-zero
    2. `src/webview/worktree/WorktreeView.ts` — supply the menu's `prunableCount`; it defaulted to `() => 0`, so the Prune item could never render (found BY this task's walk)
