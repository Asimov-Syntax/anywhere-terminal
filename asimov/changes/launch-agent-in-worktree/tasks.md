## 1. Contracts

- [x] 1_1 Declare a fresh-start launch capability on the agent registry — verified: pnpm exec vitest run 'src/vault/registry.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/vault-session-launch/spec.md#{start-a-new-session-for-an-agent-that-declares-one, a-seeded-prompt-arrives-submitted}, design.md#d1-the-registry-declares-startcommand-the-launcher-never-assembles-one, design.md#d2-the-prompt-is-an-argv-fragment-so-absence-is-representable, design.md#d3-native-prefill-only-the-pty-write-path-is-deferred-to-the-blueprint
  - **Acceptance**:
    - Outcome: only installed agents that declare a start command are reported as start targets
    - Verify: unit src/vault/registry.test.ts
  - **Plan**:
    1. `src/vault/types.ts` — add `PromptFragment`, widen `CommandTemplate.args`, add `startCommand` to `AgentVaultDefinition`, add `canSeedPrompt` to `VaultLaunchTarget` and drop `args` from the posture shape it publishes
    2. `src/vault/registry.ts` — declare `startCommand` per agent per design D1's table
    3. `src/vault/registry.ts` — generalize `detectContinuationTargets` into `detectLaunchTargets(capability, deps)`, deriving `canSeedPrompt` from the template's `PromptFragment`; keep the old name as its `"continue"` caller
    4. `src/vault/LaunchBuilder.ts`, `src/webview/vault/ContinueDialog.ts` — the widened union's existing consumers: discriminate the fragment kinds, and read a posture as the narrowed option

- [x] 1_2 Declare the worktree launch messages — verified: pnpm run check-types && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-tree-protocol/spec.md#{report-which-agents-can-start-a-fresh-session, a-launch-resolves-its-own-target, a-create-launches-its-agent-only-after-the-create-succeeded}, design.md#d5-launch-targets-reuse-the-existing-requestvaultlaunchtargets-pair
  - **Acceptance**:
    - Outcome: the launch payloads type-check across host and webview
    - Verify: command pnpm run check-types
  - **Plan**:
    1. `src/types/messages.ts` — add `WorktreeLaunchAgentMessage` / `WorktreeResumeHereMessage`, the create message's `agent` / `permissionChoiceId` / `prompt` fields, `capability` on both `requestVaultLaunchTargets` and its `vaultLaunchTargets` reply, and both new types in the worktree message-name list
    2. `src/webview/worktree/worktreeViewTypes.ts` — carry the agent's permission choices on `WorktreeCreateDefaults.agents`
    3. `src/webview/worktree/worktreeFixtures.ts` — the only construction site of that shape, so it moves with it

## 2. Launcher

- [x] 2_1 Expand a prompt fragment that is absent when no prompt is given — verified: pnpm exec vitest run 'src/vault/LaunchBuilder.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/vault-session-launch/spec.md#{a-seeded-prompt-arrives-submitted, a-prompt-is-never-read-as-a-command-line-option}, design.md#d2-the-prompt-is-an-argv-fragment-so-absence-is-representable
  - **Acceptance**:
    - Outcome: a start with no prompt emits no prompt argument at all
    - Verify: unit src/vault/LaunchBuilder.test.ts
  - **Plan**:
    1. `src/vault/LaunchBuilder.ts` — handle `PromptFragment` in `expandArgs`: skip when the prompt is empty, else emit `[flag?, prompt]`
    2. `src/vault/LaunchBuilder.ts` — add `buildStart(agent, cwd, hostEnv, opts)` reading `startCommand` and composing `permissionArgs` ahead of the fragment; no `VaultSessionEntry` is synthesized
    3. `src/utils/readsAsFlag.ts`, `src/worktree/worktreeMutations.ts` — lift the existing one-line guard to a shared util so both callers share one definition
    4. `src/vault/LaunchBuilder.ts` — refuse a prompt that guard accepts; cover `--force`, and keep the three entry-backed modes expanding as they do today

- [x] 2_2 Start an agent in a named directory — verified: pnpm exec vitest run 'src/vault/VaultLauncher.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: specs/vault-session-launch/spec.md#{start-a-new-session-for-an-agent-that-declares-one, a-launch-may-name-the-directory-it-runs-in}, design.md#d4-cwd-is-an-explicit-launch-override-not-a-new-mode
  - **Acceptance**:
    - Outcome: a launch runs in the supplied directory, and in the recorded one when none is supplied
    - Verify: unit src/vault/VaultLauncher.test.ts
  - **Plan**:
    1. `src/vault/LaunchBuilder.ts` — optional `cwd` override winning over `entry.cwd` for every mode
    2. `src/vault/VaultLauncher.ts` — thread `cwd` through `resolve`, and add `startAgent(agent, cwd, { permissionChoiceId?, prompt? })` over `buildStart`, returning the same `CreateSessionOptions`

## 3. Host

- [x] 3_1 Answer a launch-target request for the start capability — verified: pnpm exec vitest run 'src/providers/TerminalViewProvider.vaultContinue.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1, 1_2
  - **Refs**: specs/worktree-tree-protocol/spec.md#report-which-agents-can-start-a-fresh-session, design.md#d5-launch-targets-reuse-the-existing-requestvaultlaunchtargets-pair
  - **Acceptance**:
    - Outcome: a start-capability request answers with start-capable installed agents only
    - Verify: unit src/providers/TerminalViewProvider.vaultContinue.test.ts
  - **Plan**:
    1. `src/providers/TerminalViewProvider.ts` — pass the request's `capability` (default `"continue"`) into `detectLaunchTargets` and echo it on the reply

- [x] 3_2 Resolve and validate a worktree launch host-side — verified: pnpm exec vitest run 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2, 2_2
  - **Refs**: specs/worktree-tree-protocol/spec.md#{a-launch-resolves-its-own-target, a-launch-is-admitted-only-on-values-the-host-declared, resuming-a-session-into-a-worktree-runs-it-there, a-launch-that-was-asked-for-on-its-own-reports-its-own-failure}, specs/worktree-panel/spec.md#a-worktree-offers-to-start-an-agent-in-it, design.md#d6-starting-a-pane-is-a-surface-capability-mirroring-openterminal
  - **Acceptance**:
    - Outcome: a launch the host cannot admit starts nothing, and one that fails says so
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `src/providers/WorktreeHost.ts` — add `launchAgent` to `WorktreeSurface` and a `startAgent` / `resumeSessionAt` pair to `WorktreeActions`
    2. `src/providers/WorktreeHost.ts` — handle `worktreeLaunchAgent` via `actionPath`, and `worktreeResumeHere` via `matchedRow(rowId, "entryId", entryId)` plus `actionPath`
    3. `src/providers/WorktreeHost.ts` — reject an agent, posture, or prompt the registry and `MAX_CONTINUATION_INSTRUCTION` do not admit; add both names to the worktree message routing list
    4. `src/providers/WorktreeHost.ts` — post a launch failure back to the asking surface rather than routing it through `perform`, which swallows to a log

- [x] 3_3 Launch the requested agent after a create succeeds — verified: pnpm exec vitest run 'src/worktree/worktreeMutationService.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_2
  - **Refs**: specs/worktree-tree-protocol/spec.md#{launch-details-belong-to-the-agent-mode-alone, a-create-launches-its-agent-only-after-the-create-succeeded, a-failed-launch-never-undoes-its-worktree}, specs/worktree-panel/spec.md#a-launch-that-fails-after-a-create-says-the-worktree-was-made, design.md#d8-a-failed-launch-after-a-create-reuses-openfailed
  - **Acceptance**:
    - Outcome: a failed launch reports a created worktree with an unstarted agent, and the worktree remains
    - Verify: unit src/worktree/worktreeMutationService.test.ts
  - **Plan**:
    1. `src/worktree/worktreeMutationService.ts` — carry the launch fields on the create request, require them exactly for `openAfter: "agent"`, and report a launch failure as `openFailed` on the ok result, wrapped as `Agent did not start: <reason>`
    2. `src/extension.ts` — route `afterCreate`'s `"agent"` mode into the same launch path the menu uses, and supply the host's `startAgent` / `resumeSessionAt`
    3. `src/providers/TerminalViewProvider.ts` — implement `WorktreeSurface.launchAgent`, creating the pane from the resolved `CreateSessionOptions` the way `launchVaultSession` already does

## 4. Panel

- [x] 4_1 Extract the agent box and drive its postures from the chosen agent — verified: pnpm exec vitest run 'src/webview/worktree/worktreeAgentBox.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: specs/worktree-panel/spec.md#{a-launch-is-described-by-the-agent-it-will-run, a-dangerous-posture-is-offered-but-never-preselected}, design.md#d7-one-agent-box-two-dialogs
  - **Acceptance**:
    - Outcome: switching agent replaces the postures offered, and a dangerous one is never the initial selection
    - Verify: unit src/webview/worktree/worktreeAgentBox.test.ts
  - **Plan**:
    1. `src/webview/worktree/worktreeAgentBox.ts` — new: agent select, posture select, and a prompt field present only for a `canSeedPrompt` agent, mounted into a supplied element
    2. `src/webview/worktree/WorktreeCreateDialog.ts` — mount the box, delete the hardcoded `PERMISSIONS` constant
    3. `src/webview/worktree/worktreeFixtures.ts` — give fixture agents their permission choices
    4. `src/webview/worktree/worktreeViewTypes.ts` — the draft's launch fields become the agent's own vocabulary (`permissionChoiceId`, `prompt`)
    5. `src/webview/worktree/worktreePanel.css` — only if the extracted markup needs a rule it did not already have

- [x] 4_2 Collect a standalone launch — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeLaunchDialog.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_1
  - **Refs**: specs/worktree-panel/spec.md#a-launch-is-described-by-the-agent-it-will-run, design.md#d7-one-agent-box-two-dialogs
  - **Acceptance**:
    - Outcome: the launch dialog submits the chosen agent, posture and optional prompt for one worktree
    - Verify: unit src/webview/worktree/WorktreeLaunchDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeLaunchDialog.ts` — new: a dialog shell naming the worktree, the shared agent box, and its two action buttons

- [x] 4_3 Offer the launch actions and post them — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeController.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_2
  - **Refs**: specs/worktree-panel/spec.md#{a-worktree-offers-to-start-an-agent-in-it, a-row-is-never-offered-an-action-it-cannot-perform}, specs/worktree-tree-protocol/spec.md#{a-launch-resolves-its-own-target, resuming-a-session-into-a-worktree-runs-it-there}
  - **Acceptance**:
    - Outcome: with no start-capable agent reported, neither launch action appears in the menu
    - Verify: unit src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeContextMenu.ts` — add `launchAgentHere` on the worktree items beside the existing `resumeHere` on agent rows
    2. `src/webview/worktree/WorktreeController.ts` — request start targets, feed them into `createRepos().agents`, open the launch dialog, post `worktreeLaunchAgent` / `worktreeResumeHere`, and stop suppressing `openAfter: "agent"` on create submit
    3. `src/webview/worktree/WorktreeView.ts` — pass the launch capabilities through to the menu
    4. `src/webview/main.ts` — route a `vaultLaunchTargets` reply by its echoed `capability`: `continue` to the vault panel, `start` to the worktree controller
    5. `src/webview/worktree/WorktreeCreateDialog.ts` — restore the `agent` option now that a launch exists behind it

## 5. Assembly

- [x] 5_1 Walk both launch entry paths through the real wiring — verified: pnpm exec vitest run 'src/extension.worktreeAssembly.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_3, 4_3
  - **Refs**: specs/worktree-panel/spec.md#{a-worktree-offers-to-start-an-agent-in-it, a-launch-that-fails-after-a-create-says-the-worktree-was-made}, specs/worktree-tree-protocol/spec.md#resuming-a-session-into-a-worktree-runs-it-there, design.md#d7-one-agent-box-two-dialogs
  - **Acceptance**:
    - Outcome: all three launch entry paths reach the resolved argv and directory they name
    - Verify: unit src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. `src/extension.worktreeAssembly.test.ts` — drive a rendered menu launch, a create-with-agent submit, and a resume-here on an agent row through the real host, router and wiring to the session options each produces; the resume case asserts row matching and the worktree cwd override

## 6. Review round 1 fixes

- [x] 6_1 Admit a launch only on the values the host declared — verified: pnpm exec vitest run 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 5_1
  - **Refs**: specs/worktree-tree-protocol/spec.md#{a-launch-is-admitted-only-on-values-the-host-declared, launch-details-belong-to-the-agent-mode-alone}, specs/worktree-panel/spec.md#a-launch-is-described-by-the-agent-it-will-run
  - **Acceptance**:
    - Outcome: an agent, posture or prompt the host never published launches nothing and creates nothing
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `src/providers/WorktreeHost.ts` — take the host's own launch-target answer as a capability and admit both entry paths against it, the create one before git runs; validate the payload shapes rather than trusting the router's assertion (B1, W1)
    2. `src/vault/LaunchBuilder.ts` — refuse an explicit posture id for an agent that declares none (B2)
    3. `src/extension.ts` — supply the launch-target capability from the same detection the panel asks for
    4. `src/webview/worktree/worktreeAgentBox.ts` — bound the prompt field at the limit the host publishes, with the count the Continue dialog already shows (W2)
    5. `src/webview/worktree/WorktreeController.ts` — ask for start targets once at a time, so two answers cannot land out of order (W3)
    6. `src/webview/worktree/WorktreeView.ts` — track the launch dialog's disposer like the create and remove dialogs' (W4)
    6b. `src/webview/worktree/WorktreeLaunchDialog.ts` — return that disposer
    7. `src/vault/VaultLauncher.ts` — resolve the template executable through one resolver instead of two (S2)
    8. `src/extension.worktreeAssembly.test.ts` — fix the host's launch-target answer, now that admission asks for it
