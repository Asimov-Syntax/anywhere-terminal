## 1. Freeze the cross-boundary contract

- [x] 1_1 Add setup outcomes and opaque setup actions to the wire — verified: bun test 'src/types/messages.contract.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{only-setup-the-user-selected-runs, setup-failure-leaves-the-successful-create-standing} <!-- design.md D1, D4, D6 -->
  - **Acceptance**:
    - Outcome: setup results and actions expose only host-issued identifiers
    - Verify: unit src/types/messages.contract.test.ts
  - **Plan**:
    1. Extend `src/types/messages.ts` with `ProvisionSetupResult`; make `WorktreeProvisionResultMessage` a full initial-result or setup-only update union; add exact `worktreeSetupRetry` and `worktreeSetupViewOutput` inbound messages carrying opaque ids only.
    2. Register both inbound types in `WebViewToExtensionMessage` and `WORKTREE_MESSAGE_TYPES`; update `src/types/messages.contract.test.ts` to prove malformed variants cannot be constructed.
    3. Extend the exhaustive inbound sample inventory in `src/providers/TerminalViewProvider.worktree.test.ts`; narrow existing initial-result assertions in `src/extension.worktreeAssembly.test.ts` across the new full-or-setup-update union.

## 2. Execute and record setup

- [x] 2_1 Run selected scripts serially through one setup terminal — verified: pnpm exec vitest run src/worktree/provisioning/setupRunner.test.ts src/worktree/provisioning/setupTerminal.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#{setup-runs-in-the-created-worktree-through-one-shell-argument, task-file-setup-does-not-use-the-task-system, setup-receives-the-worktree-paths-and-branch, setup-receives-authoritative-named-ports, asimov-setup-receives-its-compatibility-environment, setup-failure-leaves-the-successful-create-standing} <!-- design.md D2 -->
  - **Acceptance**:
    - Outcome: each selected script receives one shell argument, the authorized cwd, and streamed terminal output
    - Verify: command pnpm exec vitest run src/worktree/provisioning/setupRunner.test.ts src/worktree/provisioning/setupTerminal.test.ts
  - **Plan**:
    1. Add `src/worktree/provisioning/setupRunner.ts` with sequential orchestration over an injected PTY child, one shared two-hour deadline, port-aware environment construction, authority checks before each spawn, and first-failure skipping.
    2. Reuse POSIX `detectShell()` with login args plus one exact `-c` script value; encode Windows scripts as one UTF-16LE PowerShell `EncodedCommand` payload and never use `shell: true` or command-line interpolation.
    3. Add `src/worktree/provisioning/setupTerminal.ts` implementing one VS Code pseudoterminal per run: start only after `open`, forward PTY data and input, retain a 1 MiB tail, cancel on close, and recreate disposed output from the tail under an origin-scoped id.
    4. Cover executable POSIX and PowerShell payloads with quotes, operators, CRLF, and newlines; environment and port values; open ordering; transcript bounds; sequencing; failures; timeouts; close; later skips; and authority substitution in both test files.
    5. Classify the new execution and manifest modules outside the read-only provider path in `src/worktree/provisioning/readOnly.test.ts`.

- [x] 2_2 Write the administrative provisioning manifest atomically — verified: bun test 'src/worktree/provisioning/provisionManifest.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#setup-failure-leaves-the-successful-create-standing <!-- design.md D5 -->
  - **Acceptance**:
    - Outcome: one atomic manifest records successful material, authoritative ports, and every selected setup outcome
    - Verify: unit src/worktree/provisioning/provisionManifest.test.ts
  - **Plan**:
    1. Add `src/worktree/provisioning/provisionManifest.ts` to derive version-1 records from provisioning results and resolve the destination through `readWorktreeGitDir`.
    2. Authorize the administrative directory, recheck it around `LockedFile.atomicReplace`, use mode `0o600`, and report an uncommitted write as a warning without changing any apply result.
    3. Add `src/worktree/provisioning/provisionManifest.test.ts` for filtering, failed and skipped setup records, admin-directory resolution, substitution, atomic replacement, retry replacement, and write failure; extend `src/worktree/ignoredMaterial.test.ts` with writer-compatible and absent and malformed degradation cases.

## 3. Redeem and orchestrate the retained model

- [x] 3_1 Redeem setup selections and route setup capabilities in the host — verified: bun test 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#{only-setup-the-user-selected-runs, setup-failure-leaves-the-successful-create-standing} <!-- design.md D1, D4 -->
  - **Acceptance**:
    - Outcome: the host forwards only selected setup values from its current offer and rejects foreign setup tokens
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. In `src/providers/WorktreeHost.ts`, filter selected setup steps beside entries and ports, derive the asimov environment class from the held model, and add both values to the host-owned create request.
    2. Add retry and output capabilities to `WorktreeActions` plus a provisioning-only host reporter; validate exact opaque-token messages, resolve retry identity from the current tree, and bind output reveal to the originating surface.
    3. Extend `src/providers/WorktreeHost.actions.test.ts` for selected and unselected setup, stale offers, active asimov inheritance, forged tokens, missing rows, and surface-scoped output.

- [x] 3_2 Add the agent wait control without changing setup consent — verified: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/webview/worktree/WorktreeController.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#{only-setup-the-user-selected-runs, agent-startup-honours-the-setup-wait-choice} <!-- design.md D6 -->
  - **Acceptance**:
    - Outcome: agent creates carry the visible off-by-default wait choice, disabled when no setup is selected
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. Add `waitForSetup` to the create draft in `src/webview/worktree/worktreeViewTypes.ts`, preserve it through dialog submit, and carry it into wire assembly in `src/webview/worktree/WorktreeController.ts`.
    2. Render one unchecked wait control in `src/webview/worktree/WorktreeCreateDialog.ts` beside agent controls; keep it visible only for agent launch and disabled whenever the current offer selection contains no setup id.
    3. Extend `src/webview/worktree/WorktreeCreateDialog.test.ts` for default-off, selected-step enablement, deselection, offer replacement, non-agent visibility, and submit; extend `src/webview/worktree/WorktreeController.test.ts` for the carried boolean.

- [x] 3_3 Sequence initial setup and setup-only retry in the mutation service — verified: bun test 'src/worktree/worktreeMutationService.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1, 2_2, 3_1
  - **Refs**: specs/worktree-panel/spec.md#{only-setup-the-user-selected-runs, setup-failure-leaves-the-successful-create-standing, agent-startup-honours-the-setup-wait-choice} <!-- design.md D3, D4, D5 -->
  - **Acceptance**:
    - Outcome: setup follows material and ports; retry repeats setup only and cannot cross worktree identity
    - Verify: unit src/worktree/worktreeMutationService.test.ts
  - **Plan**:
    1. Extend `src/worktree/worktreeMutationService.ts` dependencies and create request with setup execution, manifest writing, provisioning-only reporting, and reconciliation of one rotating retry record per live worktree.
    2. Include selected setup in destination authorization and normalized result-id guards; start it after entries and ports with authoritative port environment values, overlapping ungated launch and sequencing gated launch after complete success.
    3. Preserve create success on setup, manifest, and launch failure; retain initial contest membership but make retry emit a setup-only update with no dangling step indices or second mutation notice.
    4. Implement queued retry requiring the current target, rotating token, path, and original authority; rewrite setup plus manifest only and evict state on success or disappearance.
    5. Cover setup-only merge keys, controlled order, all wait branches, partial failure, port environment, manifest warning, no-replay retry, contest preservation, token rotation, substitution, disappearance, and one-record-per-row bounds.

## 4. Surface and assemble the result

- [x] 4_1 Render setup output and retry on the created worktree row — verified: pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts src/webview/worktree/WorktreeController.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_1, 3_2
  - **Refs**: specs/worktree-panel/spec.md#setup-failure-leaves-the-successful-create-standing <!-- design.md D6 -->
  - **Acceptance**:
    - Outcome: a failed setup row offers working output and setup-only retry actions until superseded
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeView.test.ts src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. Extend `WorktreeActionResult` in `src/webview/worktree/worktreeViewTypes.ts` with setup outcomes and opaque output and retry ids.
    2. Merge setup fields from `worktreeProvisionResult` and post opaque action messages in `src/webview/worktree/WorktreeController.ts`; preserve existing material, ports, and contests when a setup-only retry update omits them.
    3. Render success, failed and skipped counts, manifest warning, `View output`, and `Retry setup` in `src/webview/worktree/WorktreeView.ts`, attaching the notice to the created row and removing retry after success.
    4. Cover message merging and replacement and action posting in `src/webview/worktree/WorktreeController.test.ts`; cover failure, warning, actions, retry success, and row rescoping in `src/webview/worktree/WorktreeView.test.ts`.
    5. In `src/extension.worktreeAssembly.test.ts`, wait for the provisioning result itself instead of an unrelated notice plus a fixed event-loop pump.

- [x] 4_2 Assemble the production runner, manifest, retry, and reporting path — verified: pnpm exec vitest run 'src/extension.worktreeMutations.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_3, 4_1
  - **Refs**: specs/worktree-panel/spec.md#{setup-runs-in-the-created-worktree-through-one-shell-argument, task-file-setup-does-not-use-the-task-system, setup-receives-the-worktree-paths-and-branch, setup-receives-authoritative-named-ports, asimov-setup-receives-its-compatibility-environment, setup-failure-leaves-the-successful-create-standing, agent-startup-honours-the-setup-wait-choice} <!-- design.md D1, D2, D3, D4, D5, D6 -->
  - **Acceptance**:
    - Outcome: a real create reaches setup, manifest, row retry, output reveal, and gated launch through production bindings
    - Verify: integration src/extension.worktreeMutations.test.ts
  - **Plan**:
    1. In `src/extension.ts`, construct the setup terminal and output owner, manifest writer, setup and retry callbacks, and provisioning reporter beside the existing entry and port bindings; use the shared directory authority and git runner.
    2. Include setup fields in initial results, use the provisioning-only reporter for retry, route output reveal through the scoped terminal owner, and reconcile retry and output state from authoritative rebuild membership without changing native-config writer seams.
    3. Extend `src/extension.worktreeMutations.test.ts` for the production dependency path and `src/extension.worktreeAssembly.test.ts` for offer-to-create ordering, setup failure and retry, manifest warning, and both agent-gate branches.

- [x] 4_3 Conform the setup delta to the current Biome gate — verified: pnpm exec biome check src/extension.ts src/extension.worktreeAssembly.test.ts src/providers/WorktreeHost.ts src/worktree/worktreeMutationService.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_2
  - **Refs**: design.md D1, D2, D3, D4, D5, D6
  - **Acceptance**:
    - Outcome: Four production assembly files satisfy current Biome checks
    - Verify: command pnpm exec biome check src/extension.ts src/extension.worktreeAssembly.test.ts src/providers/WorktreeHost.ts src/worktree/worktreeMutationService.ts
  - **Plan**:
    1. Apply only the block, import-order, and line-layout changes reported by check mode in `src/extension.ts`, `src/extension.worktreeAssembly.test.ts`, `src/providers/WorktreeHost.ts`, and `src/worktree/worktreeMutationService.ts`.

- [x] 4_4 Complete Biome conformance across the setup delta — verified: git diff --name-only 45dab796 -- 'src/**' | xargs pnpm exec biome check && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_3
  - **Refs**: design.md D1, D2, D3, D4, D5, D6
  - **Acceptance**:
    - Outcome: The remaining setup-delta files satisfy current Biome checks
    - Verify: command git diff --name-only 45dab796 -- 'src/**' | xargs pnpm exec biome check
  - **Plan**:
    1. Apply only check-mode block, import-order, and line-layout findings in `src/providers/WorktreeHost.actions.test.ts`, `src/webview/worktree/WorktreeController.test.ts`, `src/webview/worktree/WorktreeCreateDialog.test.ts`, `src/webview/worktree/WorktreeView.ts`, `src/webview/worktree/WorktreeView.test.ts`, `src/worktree/ignoredMaterial.test.ts`, `src/worktree/provisioning/provisionManifest.test.ts`, `src/worktree/provisioning/setupRunner.ts`, `src/worktree/provisioning/setupRunner.test.ts`, `src/worktree/provisioning/setupTerminal.ts`, and `src/worktree/provisioning/setupTerminal.test.ts`.

## 5. Review remediation

- [x] 5_1 Protect setup authority and the aggregate deadline — verified: pnpm exec vitest run src/worktree/provisioning/providerKit.test.ts src/worktree/provisioning/setupRunner.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_4
  - **Refs**: specs/worktree-panel/spec.md#{setup-receives-authoritative-named-ports, setup-receives-the-worktree-paths-and-branch}; design.md D2, D3 <!-- review round 1 F001, F002; F006 runner half -->
  - **Acceptance**:
    - Outcome: Port authority and run cancellation remain valid across reserved names, hanging authorization, and pre-spawn races
    - Verify: command pnpm exec vitest run src/worktree/provisioning/providerKit.test.ts src/worktree/provisioning/setupRunner.test.ts
  - **Plan**:
    1. Validate portable, non-reserved port names while parsing in `src/worktree/provisioning/providerKit.ts`; cover malformed, reserved, and case-variant names in `src/worktree/provisioning/providerKit.test.ts`.
    2. In `src/worktree/provisioning/setupRunner.ts`, overlay host variables after ports, create one deadline and close cancellation state, race authorization against it, recheck immediately before spawn, and make kill plus settlement exception-safe.
    3. Extend `src/worktree/provisioning/setupRunner.test.ts` with collision, hanging authorization, close-before-spawn, deadline, and throwing-kill witnesses.

- [x] 5_2 Bound and dispose setup terminal resources — verified: pnpm exec vitest run src/worktree/provisioning/setupRunner.test.ts src/worktree/provisioning/setupTerminal.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 5_1
  - **Refs**: design.md D2 <!-- review round 1 F003, F006, F009, F010 -->
  - **Acceptance**:
    - Outcome: Terminal output work and resources stay bounded across streaming, child settlement, and disposal
    - Verify: command pnpm exec vitest run src/worktree/provisioning/setupRunner.test.ts src/worktree/provisioning/setupTerminal.test.ts
  - **Plan**:
    1. Replace whole-tail rebuilds with a bounded byte-chunk deque and bounded live-write batching in `src/worktree/provisioning/setupTerminal.ts`; add identity-checked detach and idempotent dispose with best-effort kill.
    2. Have `src/worktree/provisioning/setupRunner.ts` detach each settled child in `finally`.
    3. Cover incremental eviction, an oversized event, UTF-8 partial-chunk eviction, 8 ms and 64 KiB flush bounds, pending-flush disposal, final-child detach, both throwing-kill paths, and repeated disposal in `src/worktree/provisioning/setupTerminal.test.ts` and `src/worktree/provisioning/setupRunner.test.ts`.

- [ ] 5_3 Retire output authority and complete create records
  - **Deps**: 5_2
  - **Refs**: design.md D3, D4, D5, D6 <!-- review round 1 F004, F005, F007, F008 -->
  - **Acceptance**:
    - Outcome: Output authority, retry retirement, and manifests remain truthful across replacement, rejection, and empty creates
    - Verify: command pnpm exec vitest run src/worktree/worktreeMutationService.test.ts src/extension.worktreeMutations.test.ts src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. Add retry-start output retirement and visible coordinator-rejection reporting to `src/worktree/worktreeMutationService.ts`; normalize every fresh create for a truthful empty manifest and cover all branches in `src/worktree/worktreeMutationService.test.ts`.
    2. In `src/extension.ts`, bind retained output to its original `AuthorizedDirectory`, recheck it before reveal, and dispose on retry start, replacement, mismatch, and reconciliation.
    3. Extend `src/extension.worktreeMutations.test.ts` for retry-start disposal, completed-run replacement disposal, same-id authority refusal, rebuild disappearance, and empty-manifest production wiring.
    4. Reassert in `src/webview/worktree/WorktreeController.test.ts` that a rejection update without a retry id removes the stale action.
