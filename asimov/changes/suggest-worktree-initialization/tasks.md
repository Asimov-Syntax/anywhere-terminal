## 1. Host-held initialization suggestions

- [x] 1_1 Detect bounded repository-root suggestions — verified: pnpm exec vitest run src/types/messages.contract.test.ts src/worktree/provisioning/suggestProvisioning.test.ts src/worktree/provisioning/readProvisioning.test.ts src/worktree/provisioning/readOnly.test.ts && pnpm run check-types && pnpm exec vitest run src/types/messages.contract.test.ts src/worktree/provisioning/suggestProvisioning.test.ts src/worktree/provisioning/readProvisioning.test.ts src/worktree/provisioning/readOnly.test.ts exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{a-repository-without-provisioning-configuration-gets-bounded-initialization-suggestions,suggestions-spend-only-the-host-held-offer-the-user-selected}; design.md D1, D2
  - **Boundary**: No recursive scan, environment or lockfile content read, command synthesis, webview-authored path or command, or provider-order change
  - **Acceptance**:
    - Outcome: Configuration-free repositories produce bounded host-held unchecked file and setup suggestions
    - Verify: command pnpm exec vitest run src/types/messages.contract.test.ts src/worktree/provisioning/suggestProvisioning.test.ts src/worktree/provisioning/readProvisioning.test.ts src/worktree/provisioning/readOnly.test.ts
  - **Plan**:
    1. `src/types/messages.ts` and `src/types/messages.contract.test.ts` — add a bounded suggestion explanation to host-issued entry and setup rows without adding webview request authority.
    2. `src/worktree/provisioning/suggestProvisioning.ts`, `src/worktree/provisioning/suggestProvisioning.test.ts`, `src/worktree/provisioning/readProvisioning.ts`, `src/worktree/provisioning/readProvisioning.test.ts`, `src/worktree/provisioning/readOnly.test.ts` and `src/worktree/provisioning/provisioningDeps.ts` — detect only fixed regular root names through the required typed stat dependency (D1), with integration witnesses that fallback runs when every provider is absent and never over an empty or unreadable present provider.

- [x] 1_2 Save only positive suggested file consent — verified: pnpm exec vitest run src/worktree/provisioning/offerStore.test.ts src/worktree/provisioning/writeNativeConfig.test.ts src/providers/WorktreeHost.actions.test.ts && pnpm run check-types && pnpm exec vitest run src/worktree/provisioning/offerStore.test.ts src/worktree/provisioning/writeNativeConfig.test.ts src/providers/WorktreeHost.actions.test.ts exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#{saving-suggestions-records-positive-file-consent-but-never-setup-consent,a-saved-configuration-replaces-fallback-suggestions,a-configuration-written-for-the-first-time-names-a-source-that-exists,a-save-that-has-nothing-to-record-writes-nothing}; design.md D2, D3
  - **Boundary**: No setup persistence, framework-file write, stale offer redemption, or change to existing exclusion semantics
  - **Acceptance**:
    - Outcome: Save records only selected suggested file copies
    - Verify: command pnpm exec vitest run src/worktree/provisioning/offerStore.test.ts src/worktree/provisioning/writeNativeConfig.test.ts src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `src/worktree/provisioning/offerStore.test.ts` — prove reminting retains suggestion explanations while replacing every selectable id.
    2. `src/worktree/provisioning/writeNativeConfig.ts` and `src/worktree/provisioning/writeNativeConfig.test.ts` — derive and append selected suggested copies without interpreting unselected suggestions as exclusions or persisting setup.
    3. `src/providers/WorktreeHost.actions.test.ts` — prove Save derives the write from the current host-held offer, and the post-save re-read offers the persisted copy as a native configured entry with no remaining fallback suggestion, setup included.

## 2. Explain and redeem the suggestions in the create form

- [ ] 2_1 Render suggestions as unchecked current-create choices
  - **Deps**: 1_2
  - **Refs**: specs/worktree-panel/spec.md#{every-initialization-suggestion-is-explicit-and-explained,suggestions-spend-only-the-host-held-offer-the-user-selected,the-create-form-states-what-the-new-worktree-will-lack,saving-suggestions-records-positive-file-consent-but-never-setup-consent}; design.md D2, D3
  - **Boundary**: No automatic selection or save, setup wait-default change, execution-order change, or direct path or command message field
  - **Acceptance**:
    - Outcome: The dialog explains unchecked suggestions and submits only their selected opaque ids
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/webview/worktree/WorktreeController.test.ts src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeCreateDialog.ts` and `src/webview/worktree/WorktreeCreateDialog.test.ts` — render suggestion provenance and effect, default suggestions off, update the summary and empty state, and retain current-create versus saved wording.
    2. `src/webview/worktree/WorktreeController.test.ts` and `src/extension.worktreeAssembly.test.ts` — prove suggestion text never becomes authority and a selected environment suggestion is copied; assert the lockfile-derived setup row is present, explained, and unchecked before asserting it does not run.
