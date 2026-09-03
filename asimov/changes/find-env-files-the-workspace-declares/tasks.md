## 1. Look where the repository says its packages are

- [x] 1_1 Read the declared workspaces and probe one level inside them — verified: pnpm exec vitest run src/worktree/provisioning/suggestProvisioning.test.ts src/worktree/provisioning/readProvisioning.test.ts src/worktree/provisioning/readOnly.test.ts src/worktree/provisioning/oneOwner.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{a-repository-without-provisioning-configuration-gets-bounded-initialization-suggestions,a-workspace-repository-s-package-environment-files-are-found}; design.md D1, D2, D3, D4, D5
  - **Boundary**: No recursive scan, environment-file content read, per-package setup command, provider-order change, or second implementation of glob/containment/budget
  - **Acceptance**:
    - Outcome: Environment files inside declared workspace packages are offered as bounded suggestions
    - Verify: command pnpm exec vitest run src/worktree/provisioning/suggestProvisioning.test.ts src/worktree/provisioning/readProvisioning.test.ts src/worktree/provisioning/readOnly.test.ts src/worktree/provisioning/oneOwner.test.ts
  - **Plan**:
    1. `src/worktree/provisioning/suggestProvisioning.ts` — read the declared workspaces per D1, refusing a parse that reports any error; expand each pattern through `providerKit`'s glob and containment; charge every resolved directory to the shared budget before probing the fixed names one level inside it.
    2. `src/worktree/provisioning/suggestProvisioning.test.ts` — witness the manifest shapes including a truncated-but-recoverable one, the exact `readFile` call list, escaping and unimplemented patterns, a literal-only manifest against the budget, and the repo-relative naming.
    3. `src/worktree/provisioning/readProvisioning.ts` and `src/worktree/provisioning/readProvisioning.test.ts` — hand the detector the read's own budget and dependencies, and keep the three present-source suppression witnesses true for a workspace repository.
    4. `src/worktree/provisioning/providerKit.ts` and `src/worktree/provisioning/provisioningDeps.ts` — expose only what the detector must borrow to charge the budget and resolve a declared directory, adding no second implementation of either.

## 2. Show a package's file as the file it is

- [x] 2_1 Name a workspace suggestion by its path, end to end — verified: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/extension.worktreeAssembly.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#{a-workspace-repository-s-package-environment-files-are-found,every-initialization-suggestion-is-explicit-and-explained}; design.md D4
  - **Boundary**: No automatic selection, save-semantics change, or webview-authored path
  - **Acceptance**:
    - Outcome: A package's environment suggestion is named and copied by its repo-relative path
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeCreateDialog.test.ts` — witness that two package rows are distinguishable and still start unchecked.
    2. `src/extension.worktreeAssembly.test.ts` — prove a selected package environment suggestion arrives at the same relative location in the new worktree through the shipped wiring.
