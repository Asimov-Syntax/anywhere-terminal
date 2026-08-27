# Review Round 1

- Date: 2026-08-27
- Cycle: 1
- Round: 1
- Mode: discovery
- Scope: commit range `bb02bde..3ed52539133f8b3570d577ca0bfd93421983a874`
- Head: `3ed52539133f8b3570d577ca0bfd93421983a874` (tree clean before this review artifact was written)
- Change context: `launch-agent-in-worktree` — Gate 2 approved
- Reviewable lines: 17,520
- Size note: Large change — accuracy may decrease
- Agents spawned:
  - asm-review-logic — backend launch, mutation, error and async flow — `gpt-5.6-sol[1M]`
  - asm-review-contracts — registry, launcher, IPC and host contracts — `gpt-5.6-terra[1M]`
  - asm-review-frontend — worktree launch UI, state and dialog lifecycle — `sonnet[1M]`
  - asm-review-performance — presence, registry polling and render growth axes — `gpt-5.6-terra[1M]`
  - asm-review-data-security — spawn, filesystem and Git trust boundaries — `gpt-5.6-luna[1M]`
  - asm-review-reuse — shared launch, dialog and resolver ownership — `gpt-5.6-luna[1M]`
- Agents skipped: none
- Verdict: REJECT
- Counts: 4 BLOCK | 5 WARN | 2 SUGGEST
- Verification evidence: `bun run asm change verify-status launch-agent-in-worktree` reports tasks 1_1 through 5_1 at exit 0. No verify command was run during review.
- Scope note: the explicit range also contains the prerequisite presence, external-row, subagent, navigation and mutation commits; they were reviewed because the caller explicitly selected the range.

## Findings

### B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-contracts, asm-review-data-security
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:862`
- title: Fresh launches are not admitted against the host-issued target set
- evidence: `worktreeLaunchAgent` validates only the worktree path and prompt length, then forwards any registry agent to `startAgent`. The installed/start-capable answer is computed separately in `TerminalViewProvider.handleRequestVaultLaunchTargets()` and is never retained or consulted by `WorktreeHost`. The create path forwards the same unchecked launch payload through `WorktreeHost.ts:669-699` and `extension.ts:541-551` after Git has created the worktree. Fixed-executable definitions can therefore be attempted, and can succeed if PATH changed, even though the agent was absent from the surface's target answer.
- impact: The public IPC boundary violates the approved requirement that an agent absent from the host's own launch-target answer be rejected. Capability-based UI withholding is not an authorization boundary for either direct or create-after launch.
- suggestedFix: Put one host-owned fresh-launch admission resolver in front of both entry paths. It should produce or retain the current per-surface `start` target set, reject absent agent ids, validate the chosen posture, and only then return `CreateSessionOptions`; for create mode, run this admission before the Git mutation.
- status: open
- triage: untriaged
- invariant: A fresh launch may execute only an agent in the authoritative start-target set issued by the host to that surface.
- boundary inventory:
  - affected: standalone launch IPC; create-after-launch IPC; fixed-executable agents; stale/forged target ids
  - verified safe: worktree id resolves from the current host tree; resume-here matches row/session identity; oversized prompts are rejected; cursor's templated executable re-probes before build

### B2

- ID: B2
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-contracts, asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/LaunchBuilder.ts:223`
- title: A supplied posture is accepted for agents with no posture vocabulary
- evidence: `chosenPermissionArgs()` returns `[]` immediately when `permissionChoices` is absent or empty, before checking the supplied id. OpenCode is a concrete start target with no choices, so `{ agent: "opencode", permissionChoiceId: "anything" }` launches under the CLI default instead of rejecting the undeclared posture. Direct launch forwards the id at `WorktreeHost.ts:872-874`; create mode reaches this check only after the worktree exists.
- impact: The host accepts a payload the approved contract requires it to reject, and the launched posture differs from the posture the request claimed. Create mode can also perform the filesystem/Git side effect before discovering other invalid launch details.
- suggestedFix: When a posture id is present, require an exact declared choice even when the list is empty. Move the same per-agent posture admission into the shared pre-launch host gate used by direct and create-after launch.
- status: open
- triage: untriaged
- invariant: An explicit permission posture must match one choice declared by the selected agent; omission alone means use the agent default.
- boundary inventory:
  - affected: zero-choice agents in direct launch and create-after launch
  - verified safe: unknown ids for agents with non-empty choices throw; omitted posture remains valid; UI normally omits the control for zero-choice agents

### B3

- ID: B3
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-performance
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/presenceProjector.ts:391`
- title: Every pane-evidence batch recomputes all panes across all worktrees
- evidence: The growth axes are open panes P and worktrees W, neither structurally capped. Every non-external projection snapshots all panes, rebuilds live/claimed/row/rank collections, resolves every pane, and calls the linear `attribute(..., worktreeIds)` scan for every pane. A qualifying evidence batch therefore performs at least O(P×W) containment checks plus full per-pane resolution work. The 150 ms coalescing cap in `WorktreeHost` limits burst frequency, not total work or cardinality.
- impact: Normal title, cwd, process and activity updates repeatedly reconstruct window-wide presence. Cost grows with the complete pane/worktree relation rather than the pane that changed, creating an uncapped hot-path full recompute.
- suggestedFix: Retain each pane's projected row, identity and rank contribution; update only dirty pane ids for evidence events. Use an indexed longest-root lookup for attribution, and reserve full projection for initial builds or worktree membership changes.
- status: open
- triage: untriaged
- invariant: A single pane-evidence change must not require recomputing the entire pane/worktree history as P and W grow.
- boundary inventory:
  - affected: pane evidence batches; per-pane identity resolution; worktree attribution; rank reconstruction
  - verified safe: process-table and running-session reads are shared once within a projection; external-only polling skips pane projection; stale pane state is evicted

### B4

- ID: B4
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-performance
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/runningSessions.ts:133`
- title: The five-second external-session poll fully scans and reattributes the user-wide registry
- evidence: The growth axes are registry files R and worktrees W, with no repository-enforced cap. Each visible-panel poll readdir-scans `~/.claude/sessions`, reads and parses every numeric JSON file, and liveness-probes each record before deduplication. The external projection then linearly attributes each surviving session across every worktree at `presenceProjector.ts:353`, making the fixed-cadence path O(R) filesystem/process work plus O(R×W) containment checks even when nothing changed. Stale crash files remain recurring work until another producer removes them.
- impact: Active or accumulated session records turn a permanently armed five-second poll into unbounded repeated filesystem, process and attribution work across the user's machine.
- suggestedFix: Maintain an incremental registry index driven by directory/file changes, update only changed records, and use an indexed worktree-root lookup. Keep a periodic reconciliation only with a structural bound or retention/compaction policy for stale files.
- status: open
- triage: untriaged
- invariant: Fixed-cadence presence maintenance must be bounded or incremental over the registry growth axis rather than rescanning all history every interval.
- boundary inventory:
  - affected: directory enumeration; record reads/parses; liveness probes; session-to-worktree attribution; unchanged five-second polls
  - verified safe: malformed/headless/dead entries are filtered; in-memory external first-seen state is evicted after successful scans; agent launch detection is fixed at four candidates

### W1

- ID: W1
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-logic
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:630`
- title: Null launch fields can throw before the rejection handlers are installed
- evidence: `admissiblePrompt()` reads `.length` from a statically typed value, but the runtime message guard validates only the message name. `prompt: null` throws synchronously. For create mode, `launch: null` satisfies `launch !== undefined` and then throws at `msg.launch.prompt` before `perform()` wraps the capability.
- impact: A stale or malformed webview payload aborts the inbound callback without a response instead of failing closed. The throw occurs before a create starts, so no unintended Git side effect was demonstrated.
- suggestedFix: Runtime-validate `launch` as a non-null object and agent/posture/prompt fields as strings. Accept `unknown` in the admission helper and admit only `undefined` or a bounded string.
- status: open
- triage: untriaged

### W2

- ID: W2
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-contracts
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/worktreeAgentBox.ts:73`
- title: The normal UI can submit an oversized prompt that the host silently drops
- evidence: The worktree textarea has no `maxLength`, counter or validation, while the host rejects prompts beyond `MAX_CONTINUATION_INSTRUCTION` by returning at `WorktreeHost.ts:683` and `:865`. The standalone dialog disposes itself before posting, and neither rejection path posts an error. The existing Continue dialog already applies the same constant and presents validation feedback.
- impact: A user can enter a valid-looking prompt over 4,000 characters, click Start or Create, lose the dialog, and receive no launch, create result or explanation.
- suggestedFix: Reuse `MAX_CONTINUATION_INSTRUCTION` in the shared agent box, set `maxLength`, show the count/error, and retain host-side validation. If an oversized payload still arrives, post an explicit validation error to the requesting surface.
- status: open
- triage: untriaged

### W3

- ID: W3
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair, asm-review-contracts
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeController.ts:500`
- title: Same-capability launch-target replies can arrive out of order
- evidence: Every visibility transition sends a new asynchronous `start` target request, but replies carry only `capability`; `handleLaunchTargets()` installs every start reply. An older non-empty detection can therefore land after a newer empty result and restore launch actions and create-form agents that the newer answer withdrew.
- impact: Capability echo keeps start and continue consumers separate, but it does not keep the current start answer separate from a stale one; unavailable capabilities can reappear in the UI.
- suggestedFix: Add and echo a request id or generation, track the current start request in the controller, and ignore older replies. The host-side admission in B1 remains required as defense in depth.
- status: open
- triage: untriaged

### W4

- ID: W4
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-frontend
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeView.ts:268`
- title: Launch and prune dialogs are not tracked for disposal
- evidence: Create/remove dialogs return a disposer that `WorktreeView` stores in `closeDialog`; launch/prune openers return `void`, so `openLaunchDialog()` and `openPruneDialog()` mount a modal after calling `closeDialog?.()` but never register the new modal. A create-defaults request is asynchronous, so a launch dialog can open before its reply; when the reply later opens the create dialog, the launch scrim, DOM and document-level key listener remain underneath.
- impact: A normal create-vs-launch race can stack two modal focus traps and leak the lower listener until the user separately dismisses that orphaned dialog. The specialist's proposed wrong-target launch was not retained because the ordinary UI sequence did not establish that reachability.
- suggestedFix: Return `shell.dispose` from launch/prune openers and assign it to `this.closeDialog`, matching create/remove. Clear the same tracked disposer on confirm/cancel and on view disposal.
- status: open
- triage: untriaged

### W5

- ID: W5
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair, asm-review-performance
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/worktreeRenderSignature.ts:22`
- title: The no-op render guard rebuilds a whole-tree string on every broadcast
- evidence: `WorktreeView.setData()` calls `worktreeSignature()` before it can skip rendering. The signature maps every repo/worktree, sorts all presence keys, serializes every agent row and delegation roster, and allocates a new aggregate string. Unchanged five-second external scans still broadcast, so the guard avoids DOM work but keeps O(W+P+R+D) traversal and allocation plus key sorting.
- impact: The periodic path continues to scale with the complete envelope even when the UI has nothing to repaint.
- suggestedFix: Publish stable tree/presence revision tokens or cache incremental per-repo/worktree signatures so unchanged broadcasts can be rejected without serializing the whole envelope.
- status: open
- triage: untriaged

### S1

- ID: S1
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: asm-review-reuse
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/worktreeDialogShell.ts:38`
- title: Continue and worktree dialogs maintain parallel modal lifecycles
- evidence: `openDialogShell()` owns overlay construction, focus discovery/trapping, Escape handling, disposal and focus restoration. `ContinueDialog` independently implements the same lifecycle and document listeners.
- impact: Focus, Escape and cleanup fixes can drift between the two dialog families; W4 demonstrates that lifecycle ownership is already easy to apply inconsistently.
- suggestedFix: Generalize the worktree shell as the shared modal lifecycle and migrate `ContinueDialog` to it, keeping content and launch-specific validation separate.
- status: open
- triage: untriaged

### S2

- ID: S2
- severity: SUGGEST
- confidence: MEDIUM
- priority: P4
- agent: asm-review-reuse
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/VaultLauncher.ts:87`
- title: Fresh start duplicates executable-template resolution
- evidence: `startAgent()` independently checks the start template for `{{executable}}` and calls `resolveAgentExecutable`; the entry-backed path already centralizes the same template check and probe in `LaunchBuilder.resolveLaunchExecutable()`.
- impact: Future changes to executable tokens, aliases, help-token compatibility or missing-executable errors can drift between fresh and entry-backed launches.
- suggestedFix: Extract one template/executable resolver in `LaunchBuilder` and use it from both fresh and entry-backed launcher paths.
- status: open
- triage: untriaged

## Full-flow trace

- Existing-worktree launch: context-menu capability is withheld until a `start` reply; dialog collects target/posture/prompt; webview posts ids only; host resolves worktree id to its current display path; launcher expands the registry template and surface spawns a visible pane. B1/B2 are the unresolved admission gaps; W2/W3 cover user-visible validation and freshness.
- Create then launch: create dialog uses the shared box and sends launch details only with `openAfter: "agent"`; host validates mode/prompt shape partially; mutation service performs two-phase path validation and Git create; `afterCreate` launches on the origin surface and wraps failures as `Agent did not start: <reason>` without rollback. B1/B2 allow invalid launch details to pass the pre-create boundary.
- Resume Here: the row id plus entry id is matched against published host state; worktree id resolves from the current tree; the launcher resumes with the explicit worktree cwd; the requesting launch-capable surface opens the pane and reports resolver/spawn errors. Editor surfaces never receive a start-target answer, so the two menu items remain absent there; the logic specialist's contrary BLOCK was refuted.
- Presence prerequisites in the explicit range: pane evidence and tree changes feed a single-flight projector with committed tree/presence envelopes and retained failure state; external registry scans run while any surface shows the view. B3/B4/W5 are the remaining scale defects in those prerequisite flows.

## Adjudication notes

- Corroborated B1 from contracts and data-security was merged across direct and create-after boundaries rather than reported twice.
- B2 retains BLOCK because the approved public contract explicitly requires rejection of undeclared postures; the logic specialist's WARN was upgraded on that evidence.
- The logic specialist's `Resume Here` BLOCK was dropped: editor surfaces do not answer `requestVaultLaunchTargets`, so the controller never installs either launch action there, matching the caller's deliberate capability-withholding decision.
- The frontend dialog finding was downgraded from BLOCK to WARN: stacked modal DOM/listeners are reachable, but the claimed wrong-target spawn was not established through the ordinary UI sequence.
- The all-dangerous-only posture observation was dropped because no current registry definition instantiates that shape.
- Reuse findings were retained as SUGGEST because they show drift risk but no additional current behavioral failure beyond W4.

---

## Triage (author, round 1)

**Scope correction.** The review target I passed named `bb02bde..HEAD`, which spans ten
commits — six earlier, already-reviewed and archived changes (presence projection, external
rows, subagent rows, navigation actions, mutating actions) plus this one. WT-005.3 is commit
`3ed5253` alone. Findings landing outside that commit are rebutted on scope, not on merit.

### [B1] Fresh launches are not admitted against the host-issued target set
**Status**: accepted
**Triage**: Correct, and it is a spec violation rather than a hardening idea:
`specs/worktree-tree-protocol/spec.md` § "A launch is admitted only on values the host
declared" requires the host to reject an undeclared agent and an undeclared posture, and the
code at `WorktreeHost.ts:862` explicitly delegates that to the launcher — which B2 proves does
not perform it. Both entry paths are fixed, and the create path is admitted BEFORE git runs.

### [B2] A supplied posture is accepted for agents with no posture vocabulary
**Status**: accepted
**Triage**: Confirmed at `LaunchBuilder.ts:225` — `!choices?.length` returns `[]` before the
supplied id is ever compared. An explicit id must match a declared choice or be refused.

### [B3] Every pane-evidence batch recomputes all panes across all worktrees
**Status**: rejected — out of scope
**Triage**: `src/worktree/presenceProjector.ts` is not touched by `3ed5253`; it shipped with
`project-worktree-agent-presence` and was reviewed there. Valid as an observation about that
module, but this change neither introduced nor worsened it.

### [B4] The five-second external-session poll fully scans the user-wide registry
**Status**: rejected — out of scope
**Triage**: `src/vault/readers/runningSessions.ts` is likewise untouched by `3ed5253`
(`surface-external-agent-rows`).

### [W1] Null launch fields can throw before rejection handlers are installed
**Status**: accepted
**Triage**: `admissiblePrompt` reads `.length` off a value the router only type-asserts. Fixed
together with B1, since admission is the one place both entry paths pass through.

### [W2] The UI can submit an oversized prompt that the host silently drops
**Status**: accepted
**Triage**: The bound is published and enforced host-side but invisible in the box, and the
standalone dialog closes before the drop. Reuses `MAX_CONTINUATION_INSTRUCTION`, as the
Continue dialog already does.

### [W3] Same-capability target replies can arrive out of order
**Status**: accepted with modification
**Triage**: Real, but a request generation on the wire buys ordering the panel does not
otherwise need. The overlap only exists because a visibility transition can re-ask while an
answer is outstanding, so the fix is to not ask twice: one outstanding request at a time. B1
remains the security boundary either way.

### [W4] Launch and prune dialogs are not tracked for disposal
**Status**: accepted (launch half only)
**Triage**: `openWorktreeLaunchDialog` is this change's; its disposer is now tracked like the
create and remove dialogs'. The prune dialog has the same shape and predates this change —
noted for audit rather than fixed here.

### [W5] The render guard rebuilds a whole-tree signature on every broadcast
**Status**: rejected — out of scope
**Triage**: `src/webview/worktree/worktreeRenderSignature.ts` is untouched by `3ed5253`.

### [S1] Continue and worktree dialogs maintain parallel modal lifecycles
**Status**: audit-backlog
**Triage**: A real duplication, and both shells predate this change; migrating `ContinueDialog`
is a refactor with its own blast radius, not a remediation of this diff.

### [S2] Fresh start duplicates executable-template resolution
**Status**: accepted
**Triage**: Small and squarely this change's — `VaultLauncher.startAgent` re-derives what
`resolveLaunchExecutable` already decides.
