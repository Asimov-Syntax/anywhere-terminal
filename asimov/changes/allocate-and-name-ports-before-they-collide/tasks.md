# Tasks: allocate-and-name-ports-before-they-collide

The lock extraction and result skeleton can start together. Everything after the allocator is serial through the host, create service, and notice.

## 1. Port claims

- [x] 1_1 Extract the generic locked-file primitive without changing its shipped caller — verified: pnpm exec vitest run 'src/agentHooks/install/lockedJsonFile.test.ts' && test "$(rg -l 'export class LockedFile' src | wc -l | tr -d ' ')" = 1 && rg -q 'utils/lockedFile' src/agentHooks/install/ClaudeHookInstaller.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D2, design.md D6
  - **Acceptance**:
    - Outcome: LockedFile has one shared implementation and the hook installer keeps its behavior
    - Verify: command pnpm exec vitest run 'src/agentHooks/install/lockedJsonFile.test.ts' && test "$(rg -l 'export class LockedFile' src | wc -l | tr -d ' ')" = 1 && rg -q 'utils/lockedFile' src/agentHooks/install/ClaudeHookInstaller.ts
  - **Plan**:
    1. `src/utils/lockedFile.ts`: move the current `LockedFile`, staged replacement, filesystem types, constants and error predicates here without changing their public behavior.
    2. `src/agentHooks/install/lockedJsonFile.ts`: retain the old module as a compatibility re-export, with no second implementation.
    3. `src/agentHooks/install/ClaudeHookInstaller.ts`: import the primitive from its shared home; keep its authorization and replacement flow unchanged.

- [x] 1_2 Serialize and atomically publish repository-local exclude edits — verified: pnpm exec vitest run 'src/worktree/gitExclude.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: design.md D7; specs/worktree-panel/spec.md#the-port-claim-file-stays-local-to-the-repository
  - **Acceptance**:
    - Outcome: Concurrent repository-local exclude edits preserve every exact rule
    - Verify: unit src/worktree/gitExclude.test.ts
  - **Plan**:
    1. `src/worktree/gitExclude.ts`: run the repository-local exclude file's exact-line read-modify-write under `LockedFile`, treat only `ENOENT` as absence, and publish preserved contents plus one line atomically.
    2. `src/worktree/gitExclude.ts`: keep `excludePatternFor` directory-only; admit the literal file pattern `/.env.worktree` without adding a second path-pattern helper.
    3. `src/worktree/gitExclude.test.ts`: preserve idempotence and escaping coverage; add concurrent distinct rules, non-ENOENT read failure, failed publication, and exact `/.env.worktree` cases.

- [x] 1_3 Give ports their own result contract and show the preview in the row — verified: pnpm exec vitest run 'src/types/messages.contract.test.ts' 'src/webview/worktree/WorktreeCreateDialog.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D1, design.md D8; specs/worktree-panel/spec.md#{a-named-port-carries-a-numeric-preview, a-claimed-port-is-not-described-as-reserved-from-other-processes}
  - **Boundary**: do not edit `docs/ui/create-worktree.html` or `docs/ui/worktree-create-dialog.css`
  - **Acceptance**:
    - Outcome: A supplied preview renders as NAME=number, and an unavailable preview is stated
    - Verify: command pnpm exec vitest run 'src/types/messages.contract.test.ts' 'src/webview/worktree/WorktreeCreateDialog.test.ts'
  - **Plan**:
    1. `src/types/messages.ts`: add `ProvisionPortResult` plus compatibility-optional port results and warnings to `WorktreeProvisionResultMessage`; leave path-bearing `ProvisionStepResult` unchanged. Task 1_6 makes ports required when every producer is updated.
    2. `src/types/messages.contract.test.ts`: cover allocated, reused and failed port results, preview retention, and the absence of path or command authority on the submitted selection.
    3. `src/webview/worktree/WorktreeCreateDialog.ts`: replace the WT-012.6 placeholder comment and render each port subject as `NAME=preview`, or `NAME · preview unavailable`, while the source stays in the existing badge slot.
    4. `src/webview/worktree/WorktreeCreateDialog.test.ts`: replace the no-number assertion with numeric and unavailable-preview cases; keep per-item ids and source provenance unchanged.

- [x] 1_4 Allocate, retain and publish named port claims under one lock — verified: pnpm exec vitest run 'src/worktree/worktreePorts.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1, 1_2, 1_3
  - **Refs**: design.md D2, design.md D3, design.md D4, design.md D5, design.md D6, design.md D7, design.md D8; specs/worktree-panel/spec.md#{successful-port-claims-do-not-collide-across-sibling-worktrees, the-port-claim-file-has-one-strict-format, port-names-are-safe-environment-identifiers, existing-non-conflicting-assignments-are-reused, a-conflicting-existing-assignment-is-retained-but-not-adopted, an-unsupported-existing-claim-file-is-left-untouched, one-configured-name-gets-one-claim, unproven-sibling-claims-prevent-fresh-allocation, every-selected-port-gets-its-own-outcome, the-port-claim-file-stays-local-to-the-repository, a-committed-allocation-stays-successful-when-lock-cleanup-fails}
  - **Boundary**: no edits to `src/worktree/provisioning/readProvisioning.ts`, `providerKit.ts`, or `entryGate.ts`; duplicate names are coalesced at apply, not rewritten in the provider model
  - **Acceptance**:
    - Outcome: Every successful port result maps to a unique persisted value
    - Verify: unit src/worktree/worktreePorts.test.ts
  - **Plan**:
    1. `src/worktree/worktreePorts.ts`: add the spec-owned bounded claim parser, exact-name grouping, best-effort preview probe, and authoritative allocator over injected filesystem, worktree listing and TCP dependencies.
    2. `src/worktree/worktreePorts.ts`: place fresh listing, claim reads, probes, choices and publication inside a `LockedFile` sentinel rooted at `repoId`; require a complete listing and probe literal `127.0.0.1:0`.
    3. `src/worktree/worktreePorts.ts`: authorize an existing regular no-follow file, reject duplicate names or numeric values, retain its bytes, mode and assignments, fail retained collisions, and recheck identity and contents before staged creation or replacement.
    4. `src/worktree/worktreePorts.ts`: update `/.env.worktree` through `addToGitExclude` after the claim transaction; preserve committed successes on lock-release failure and return typed batch warnings for lock release or exclude failure.
    5. `src/worktree/worktreePorts.test.ts`: cover concurrent allocators; every incomplete-list shape; sibling exclusion; unreadable or malformed claims; duplicate and invalid names or values; retained, partial and conflicting files; target substitution; bounded probes; atomic failure; and warnings.

- [x] 1_5 Put previews in host-issued offers and redeem selected ports only — verified: pnpm exec vitest run 'src/providers/WorktreeHost.test.ts' 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && pnpm run test:unit -- --maxWorkers=4 exit 0
  - **Deps**: 1_3, 1_4
  - **Refs**: design.md D1, design.md D8; specs/worktree-panel/spec.md#{a-named-port-carries-a-numeric-preview, every-selected-port-gets-its-own-outcome}
  - **Boundary**: the host resolves ids to its stored `ProvisionPort` values; no name or preview from the webview reaches create
  - **Acceptance**:
    - Outcome: The host offers previews and passes only selected host-held ports to create
    - Verify: command pnpm exec vitest run 'src/providers/WorktreeHost.test.ts' 'src/providers/WorktreeHost.actions.test.ts'
  - **Plan**:
    1. `src/providers/WorktreeHost.ts`: add a preview dependency and route every model issuance through one helper that previews before `offers.issue`, including the initial provider and each switched provider.
    2. `src/providers/WorktreeHost.ts`: resolve checked ids against both `offered.entries` and `offered.ports`, passing the two host-held arrays separately on the create capability request.
    3. `src/providers/WorktreeHost.test.ts` and `src/providers/WorktreeHost.actions.test.ts`: preview success or failure once per issued offer, switched-provider previews, superseded offers, selected ports only, duplicate names retained as ids, and malformed inbound selections refused.

- [x] 1_6 Apply ports after files and carry their outcomes on the successful create — verified: pnpm exec vitest run 'src/worktree/worktreeMutationService.test.ts' 'src/extension.worktreeMutations.test.ts' 'src/extension.worktreeAssembly.test.ts' && pnpm run check-types && pnpm run test:unit -- --maxWorkers=4 exit 0
  - **Deps**: 1_5
  - **Refs**: design.md D1, design.md D8, design.md D9; specs/worktree-panel/spec.md#{a-named-port-carries-a-numeric-preview, every-selected-port-gets-its-own-outcome, a-committed-allocation-stays-successful-when-lock-cleanup-fails, the-port-claim-file-stays-local-to-the-repository}
  - **Acceptance**:
    - Outcome: Production create applies ports after files and reports every selected port
    - Verify: command pnpm exec vitest run 'src/worktree/worktreeMutationService.test.ts' 'src/extension.worktreeMutations.test.ts' 'src/extension.worktreeAssembly.test.ts'
  - **Plan**:
    1. `src/worktree/worktreeMutationService.ts`: add the selected-port request and `applyPorts` dependency, execute it after copied and linked entries and before `afterCreate`, and invoke it when ports are the only selected items.
    2. `src/worktree/worktreeMutationService.ts`: keep create `ok` through allocator rejection, lock timeout and warning outcomes; normalize the result worktree id once when either material or ports produced a report; route create-root exclusion through common-dir `repoId`.
    3. `src/extension.ts`: bind both offer previews and authoritative allocation to `worktreePorts.ts`; use current paths for previews and a fresh complete git listing plus common-dir `repoId` for apply; include ports and warnings after the create result.
    4. `src/types/messages.ts`, `src/types/messages.contract.test.ts`, `src/providers/WorktreeHost.actions.test.ts`, `src/webview/messaging/MessageRouter.test.ts`, and `src/webview/worktree/WorktreeController.test.ts`: make port results required after every production result producer carries them, and update typed fixtures with explicit empty results.
    5. `src/worktree/worktreeMutationService.test.ts`: assert file materialization before ports before launch, ports-only apply, all-port failure with create success, partial success, warnings, common-dir exclusion, normalized identity, and absent-selection behavior.
    6. `src/extension.worktreeMutations.test.ts` and `src/extension.worktreeAssembly.test.ts`: prove production supplies both bindings and delivers port results and warnings after the create result.

- [ ] 1_7 Render port movement and failure without naming unchanged successes
  - **Deps**: 1_6
  - **Refs**: design.md D8; specs/worktree-panel/spec.md#{a-changed-preview-is-reported-by-variable, every-selected-port-gets-its-own-outcome, a-committed-allocation-stays-successful-when-lock-cleanup-fails, the-port-claim-file-stays-local-to-the-repository}
  - **Acceptance**:
    - Outcome: Port notices identify preview changes and failures
    - Verify: command pnpm exec vitest run 'src/webview/worktree/WorktreeController.test.ts' 'src/webview/worktree/WorktreeView.test.ts'
  - **Plan**:
    1. `src/webview/worktree/worktreeViewTypes.ts`: carry port results and batch warnings beside material results on the create action result.
    2. `src/webview/worktree/WorktreeController.ts`: merge all fields from `WorktreeProvisionResultMessage` onto the existing create notice under the same normalized worktree id.
    3. `src/webview/worktree/WorktreeView.ts`: include port results and warnings in the render signature; count ordinary allocated and reused results; coalesce duplicate ids by name; and name only changed or failed variables with authoritative and preview values.
    4. `src/webview/worktree/WorktreeController.test.ts` and `src/webview/worktree/WorktreeView.test.ts`: changed and unchanged filtering, duplicate-name coalescing, failed names, preview absence, lock-release and exclude warnings, result merging, and unchanged-push DOM coverage.
