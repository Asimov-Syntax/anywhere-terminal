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

- [x] 6_2 Admit against what this surface was actually offered — verified: pnpm exec vitest run 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 6_1
  - **Refs**: specs/worktree-tree-protocol/spec.md#{a-launch-is-admitted-only-on-values-the-host-declared, a-launch-resolves-its-own-target}
  - **Acceptance**:
    - Outcome: a launch is refused when the target set moved, and when the worktree went away mid-resolution
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `src/providers/WorktreeHost.ts` — answer the start-capability request from the host, keep the published set per surface, admit against that snapshot, and re-resolve the worktree at the surface handoff (round-2 B1, B5)
    2. `src/providers/TerminalViewProvider.ts` — route a start-capability request to the host and keep the continuation one where it is
    3. `src/providers/TerminalViewProvider.vaultContinue.test.ts` — the start capability moves owner, so its two provider-answers-it cases move with it

- [x] 6_3 Carry identity across the awaits, not facts — verified: pnpm exec vitest run 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 6_2
  - **Refs**: specs/worktree-tree-protocol/spec.md#{a-launch-is-admitted-only-on-values-the-host-declared, a-launch-resolves-its-own-target}
  - **Acceptance**:
    - Outcome: a launch quoting a superseded offer, or a worktree recreated at the same id, launches nothing
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `src/types/messages.ts` — the launch-target answer carries an offer id and a launch echoes it
    2. `src/providers/WorktreeHost.ts` — mint an offer id per published answer, admit only a launch quoting the current one, and require the worktree's incarnation unchanged at the handoff (round-3 B1, B5)
    3. `src/webview/worktree/WorktreeController.ts` — keep the offer id the answer arrived with and quote it on both entry paths
    4. `src/webview/worktree/WorktreeView.ts` — cover the dialog supersession at its own owner

## 7. Review round 4 rework — one launch intent

- [x] 7_1 Give a repository a token that says when its registrations stopped being provable — verified: pnpm exec vitest run 'src/worktree/WorktreeCache.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 6_3
  - **Refs**: specs/worktree-tree-protocol/spec.md#{a-launch-acts-on-the-registration-it-was-chosen-against, the-registration-token-is-not-derived-from-git-state}, design.md#d10-a-launch-is-one-immutable-intent-minted-by-the-host-and-re-checked-at-handoff
  - **Boundary**: no git state may feed the token — not head, not branch, not the admin directory
  - **Acceptance**:
    - Outcome: a repository's token advances on every authoritative apply of that repository and on no other repository's
    - Verify: unit src/worktree/WorktreeCache.test.ts
  - **Plan**:
    1. `src/worktree/types.ts` — `WorktreeRepo` carries `generation: number`, mirrored to the webview with the rest of the tree
    2. `src/worktree/WorktreeCache.ts` — own the counter per repo, advance it on `applyBuild` and on `applyRepo`, and preserve it for repositories that apply did not touch
    3. `src/worktree/WorktreeCache.test.ts` — the touched repo advances, an untouched sibling does not, and a repo re-listed with an identical listing still advances
    4. `src/webview/worktree/worktreeRenderSignature.test.ts` — the exhaustive tree fixture gains the field, and asserts the guard ignores it: the token moves on every rebuild, so signing it would repaint the whole tree at rebuild rate

- [x] 7_2 Admit a launch as one intent and re-check it at the handoff — verified: pnpm exec vitest run 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 7_1
  - **Refs**: specs/worktree-tree-protocol/spec.md#{a-launch-acts-on-the-registration-it-was-chosen-against, a-launch-resolves-its-own-target, a-launch-is-admitted-only-on-values-the-host-declared}, design.md#d10-a-launch-is-one-immutable-intent-minted-by-the-host-and-re-checked-at-handoff
  - **Boundary**: admission stays synchronous — no `await` between reading the quoted values and returning the intent
  - **Acceptance**:
    - Outcome: a launch whose worktree was replaced before the handoff starts nothing
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `src/providers/WorktreeHost.ts` — replace `incarnationOf` with the published generation, make `admissibleLaunch` synchronous and return the admitted intent instead of a boolean, and re-resolve the worktree at the handoff requiring the same generation, using the path that re-resolution returned (round-4 B5, B6)
    2. `src/providers/WorktreeHost.actions.test.ts` — recreate at the same commit and branch is refused, a sibling repo's rebuild is not, and both guards are proven RED by disabling each one

- [x] 7_3 Submit the launch the dialog was opened against — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeController.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 7_2
  - **Refs**: specs/worktree-panel/spec.md#a-launch-is-submitted-as-the-offer-it-was-shown, design.md#d10-a-launch-is-one-immutable-intent-minted-by-the-host-and-re-checked-at-handoff
  - **Boundary**: the dialog reads no controller-owned mutable field on submit
  - **Acceptance**:
    - Outcome: a submit quotes what the dialog rendered, not what the panel now holds
    - Verify: unit src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. `src/types/messages.ts` — a launch quotes the repository generation beside the offer id; both stay optional on the wire and required by admission
    2. `src/providers/WorktreeHost.ts` — admission requires the quoted generation to be the one the host currently publishes for that worktree
    3. `src/webview/worktree/WorktreeController.ts` — freeze `{offerId, worktreeId, generation, agents}` when a launch or create dialog opens and submit from that object alone (round-4 B1)
    4. `src/webview/worktree/worktreeViewTypes.ts` — carry the repository generation on the row the dialog is opened from
    5. `src/webview/worktree/WorktreeController.test.ts` — a republish under an open dialog does not change what the submit quotes

- [x] 7_4 Let a create hand its own generation to the launch that follows it — verified: pnpm exec vitest run 'src/extension.worktreeAssembly.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 7_3
  - **Refs**: specs/worktree-tree-protocol/spec.md#a-launch-acts-on-the-registration-it-was-chosen-against, design.md#d10-a-launch-is-one-immutable-intent-minted-by-the-host-and-re-checked-at-handoff
  - **Acceptance**:
    - Outcome: the assembled menu launch is refused when its worktree is replaced mid-flight
    - Verify: unit src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. `src/extension.worktreeAssembly.test.ts` — walk the menu launch through the replacement boundary at the assembly level, and hold create-then-launch to starting the agent it asked for (round-4 W6)

## 8. Review round 5 fixes

- [x] 8_1 Make the admitted intent the only thing a launch acts on — verified: pnpm exec vitest run 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 7_4
  - **Refs**: specs/worktree-tree-protocol/spec.md#{a-launch-acts-on-the-registration-it-was-chosen-against, a-repository-whose-listing-failed-authorizes-nothing, the-registration-token-is-not-derived-from-git-state, a-launch-resolves-its-own-target}, design.md#d11-an-unwatched-repository-keeps-launch-authority-an-unobserved-one-does-not, design.md#d10-a-launch-is-one-immutable-intent-minted-by-the-host-and-re-checked-at-handoff
  - **Boundary**: no launch path may read the tree twice for one decision
  - **Acceptance**:
    - Outcome: every launch path acts only on values one admission returned
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    0. `src/worktree/WorktreeCache.test.ts` — a retained apply publishes no registration; an observed one does
    1. `src/worktree/WorktreeCache.ts` — a repository whose apply RETAINED rather than observed carries no registration at all, so the same absence both invalidates intents in flight and denies new ones; a repository merely unwatched keeps its own, because its listing was observed (round-5 B7)
    2. `src/providers/WorktreeHost.ts` — one lookup returns the admitted intent (path, registration, normalized fields) or nothing; an unusable git admits nothing (round-5 B7, W7)
    3. `src/types/messages.ts` — a resume quotes the registration it was published under, as a launch does
    4. `src/webview/worktree/WorktreeController.ts` — quote it from the row the action was raised on (round-5 B5)
    5. `src/providers/WorktreeHost.actions.test.ts` — resume across a replacement, a degraded repository admitting nothing, and an unrelated repository rebuilding refusing nothing
    6. `src/webview/worktree/WorktreeController.test.ts` — the create form submits the offer it was opened against (round-5 W6)

## 9. Review round 7 fixes

- [x] 9_1 Freeze what the menu shows, and keep the two degradation claims apart — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeController.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 8_1
  - **Refs**: specs/worktree-tree-protocol/spec.md#{a-launch-acts-on-the-registration-it-was-chosen-against, a-repository-whose-listing-failed-authorizes-nothing}, design.md#d11-an-unwatched-repository-keeps-launch-authority-an-unobserved-one-does-not, design.md#d10-a-launch-is-one-immutable-intent-minted-by-the-host-and-re-checked-at-handoff
  - **Boundary**: no rendered action may read tree state that moved after the menu was built
  - **Acceptance**:
    - Outcome: a resume posts the registration its menu was built under
    - Verify: unit src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeContextMenu.ts` — the menu announces the row it is being built for, so an action can capture what is on screen at that moment
    2. `src/webview/worktree/WorktreeController.ts` — freeze `{worktreeId, generation}` there and resume from it, never from the live tree (round-7 B5)
    3. `src/worktree/WorktreeCache.ts` — hold the listing failure and the watch failure as separate claims and compose them for display, so a repo-scoped rebuild cannot drop the watch one and neither can overwrite the other (round-7 W8)
    4. `src/providers/WorktreeHost.ts` — report a recovered watcher as well as a failed one
    5. `src/worktree/WorktreeCache.test.ts` — a repo rebuild keeps the watch claim; a listing failure is not described as a watcher limitation
    6. `src/webview/worktree/WorktreeController.test.ts` — menu opened under one registration, a generation-only update, then the click (round-7 W6)
    7. `src/providers/WorktreeHost.actions.test.ts` — a launch survives a sibling repository rebuilding, and an unwatched repository still admits one

## 10. Round 8 handback — the removal boundary

- [x] 10_1 Mint the observation claim once, and let every authority ask it — verified: pnpm exec vitest run 'src/worktree/WorktreeCache.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 9_1
  - **Refs**: specs/worktree-tree-protocol/spec.md#{removing-a-worktree-needs-the-same-observation-a-launch-needs, a-repository-whose-listing-failed-authorizes-nothing}, design.md#d12-one-predicate-this-repository-was-observed-authorizes-both-a-launch-and-a-removal
  - **Boundary**: no consumer may re-derive the claim from a degradation string
  - **Acceptance**:
    - Outcome: an unusable git authorizes no removal and no launch
    - Verify: unit src/worktree/WorktreeCache.test.ts
  - **Plan**:
    1. `src/worktree/WorktreeCache.ts` — an unusable git withdraws every repository's registration token, as it already withdraws their freshness
    2. `src/providers/WorktreeHost.ts` — one helper answers "was this repository observed", and launch admission and both removal readers call it
    3. `src/worktree/WorktreeCache.test.ts` — the token goes when git does, and comes back when git does
    4. `src/providers/WorktreeHost.actions.test.ts` — an unusable git refuses a removal and a launch; an unwatched repository refuses neither
