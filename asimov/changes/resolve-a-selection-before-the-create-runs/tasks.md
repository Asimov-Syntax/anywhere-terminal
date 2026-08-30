# Tasks — resolve a selection before the create runs

- [x] 1_1 Classify a selection from facts the host already holds — verified: pnpm exec vitest run 'src/worktree/createResolution.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D2, D3, D4; specs/worktree-panel/spec.md#{a-selection-resolves-to-what-the-create-would-actually-do-before-submit, the-resolution-names-both-the-path-the-create-will-take-and-the-one-it-skipped, reporting-an-occupied-destination-does-not-authorize-removing-it}
  - **Acceptance**:
    - Outcome: An existing branch no worktree holds resolves to reuse, not fresh
    - Verify: unit src/worktree/createResolution.test.ts
  - **Plan**:
    1. New `src/worktree/createResolution.ts` with a pure `resolveSelection` over the refs list, the repository's `WorktreeInfo[]`, and the destination's disposition — no git call of its own, because every input is already in the host's hand (D2).
    2. It answers `ResolvedMode` per design.md § Interfaces: `fresh` when nothing owns the name; `reuse` when the branch exists and no worktree holds it; `blockedBy` when a LIVE worktree holds it.
    3. A `prunable` worktree on the selected branch answers a CANDIDATE for reattach, carrying the directory to corroborate. Corroboration is 1_2's — this task decides which selections are even worth a filesystem read.
    4. The reported disposition is the narrower `ResolvedDisposition` (D4), which has no authorization field — a probe sent on every settled edit must not hand out a delete authorization, and a type that cannot carry one is the guard.
    5. Cover in `src/worktree/createResolution.test.ts`: a reported `debris` disposition carries nothing a delete could be built from; each mode; a branch held by a live worktree blocks rather than reuses; a branch held by a `prunable` one does NOT block, because that registration is exactly what reattach repairs; an empty query resolves nothing rather than guessing.
  - **Boundary**: read-only and git-free — this module runs no command and touches no disk

- [x] 1_2 Corroborate a prunable claim, or decline to offer the repair — verified: pnpm exec vitest run 'src/worktree/reattachProbe.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: design.md D3; specs/worktree-panel/spec.md#a-stale-registration-is-repaired-in-place-and-only-while-git-can-repair-it
  - **Acceptance**:
    - Outcome: A directory whose git link names a missing administrative directory is not offered as a repair
    - Verify: unit src/worktree/reattachProbe.test.ts
  - **Plan**:
    1. New `src/worktree/reattachProbe.ts` answering design.md D3's conditions 2 and 3 over injected filesystem and git readers: the `.git` FILE, its `gitdir:` target's existence, and the directory's `HEAD` against the branch's current OID.
    2. Every failure answers "not offered" rather than an error — a link that cannot be read, a target that is gone, a HEAD that has moved. The gone-target case is adopt's state and is reported as such (D3), never as debris.
    3. Runs ONLY for a candidate 1_1 produced, so the common path takes no filesystem read at all.
    4. Cover in `src/worktree/reattachProbe.test.ts`: all three conditions passing offers the repair with the directory's OID; a `.git` DIRECTORY rather than a file is not a linked worktree; a `gitdir:` naming a missing directory answers adopt; a moved HEAD declines; an unreadable link declines rather than throwing.
  - **Boundary**: no writes and no `worktree repair` — this task decides whether to OFFER, and 3_1 acts

- [ ] 2_1 The probe and its resolution travel with the opening that asked
  - **Deps**: 1_2
  - **Refs**: design.md D1; specs/worktree-panel/spec.md#a-resolution-belonging-to-a-previous-opening-of-the-dialog-is-discarded
  - **Acceptance**:
    - Outcome: A resolution answering a previous opening is dropped rather than applied
    - Verify: unit src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. `src/types/messages.ts` gains the pair named in design.md § Interfaces, and `worktreeCreateProbe` joins `WORKTREE_MESSAGE_TYPES`.
    2. `src/providers/WorktreeHost.ts` answers it from 1_1 and 1_2 over the runner and listing it already holds, echoing `token` and `query` unchanged.
    3. `src/webview/worktree/WorktreeController.ts` sends the probe per settled selection and drops an answer whose token is not the current opening's — the same guard the refs pair carries, reusing the existing counter rather than minting a second one.
    4. `src/providers/TerminalViewProvider.worktree.test.ts` holds the routing-completeness fixture keyed on `WORKTREE_MESSAGE_TYPES`; a new inbound type is a compile error there until it has a sample.
    5. The inbound half is only half the wire: `src/webview/messaging/MessageRouter.ts` and `src/webview/main.ts` route the ANSWER, and `src/webview/messaging/MessageRouter.test.ts` covers it. Declared-posted-handled but unrouted is how `requestWorktreeSubagents` shipped inert with every unit test green.
  - **Boundary**: `worktreeCreateDefaults` and the provisioning offer gain nothing — their lifecycle is a separate question (proposal § Non-goals)

- [ ] 2_2 The form states the mode and refuses the base ref that cannot apply
  - **Deps**: 2_1
  - **Refs**: design.md D5; specs/worktree-panel/spec.md#the-base-ref-is-refused-where-the-mode-cannot-apply-it
  - **Acceptance**:
    - Outcome: Resolving to reuse disables the base ref with a stated reason
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeCreateDialog.ts` derives the base control's enabled state from `draft.branchMode` alone — the same single-source rule the combobox already applies to new-versus-existing (D5). Disabled, not hidden.
    2. The resolution's mode feeds `draft.branchMode`, and the form states what the create will do. A stale answer — `query` no longer matching what is typed — is ignored, which is what `query` echoes for.
    3. A `debris` disposition does NOT disable the base: clearing the ground does not change where a new branch starts (§ 2.1).
    4. Cover in `src/webview/worktree/WorktreeCreateDialog.test.ts`: base disabled with a reason for reuse and for reattach; enabled for fresh; enabled for fresh WITH an occupied destination; a resolution for a query the user has typed past changes nothing.
  - **Boundary**: `docs/ui/create-worktree.html` and `docs/ui/worktree-create-dialog.css` are owned by an external design pass and are NOT edited

- [ ] 3_1 Reattach repairs, and re-checks what the user's pause could have changed
  - **Deps**: 1_2
  - **Refs**: design.md D3, D6; specs/worktree-panel/spec.md#a-stale-registration-is-repaired-in-place-and-only-while-git-can-repair-it
  - **Acceptance**:
    - Outcome: A repair whose recorded commit no longer matches the directory is refused rather than applied
    - Verify: unit src/worktree/worktreeMutationService.test.ts
  - **Plan**:
    1. `src/worktree/worktreeMutationService.ts` branches on `reattach` BEFORE `sourceOf`, which keeps its throw — reattach is not a `git worktree add` and has no `CreateSource` (D6). `adopt` keeps its throw too; WT-012.15 owns it.
    2. The repair issues `git worktree repair <path>` and then confirms the listing lost `prunable` (§ 2.3 condition 4). A repair that did not take is reported, never claimed.
    3. `expectedOid` is re-checked against the directory immediately before the command. The resolution is a read that authorizes a mutation and the user's decision sits between them, so the guard is at the mutation, not carried from the read (D3).
    4. Cover in `src/worktree/worktreeMutationService.test.ts`: a repair issues `worktree repair` and never `worktree add`; a moved `expectedOid` refuses and issues nothing; a listing still reporting `prunable` afterwards is reported as a failed repair; the working tree is never written.
  - **Boundary**: no `--force` and no fallback to `add` — where the repair cannot be made, it is refused (§ 6)

- [ ] 4_1 The resolution survives the production boundary
  - **Deps**: 2_2, 3_1
  - **Refs**: design.md D1, D2, D6
  - **Acceptance**:
    - Outcome: The assembled extension answers a probe and repairs a prunable worktree it really has
    - Verify: unit src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. Cover in `src/extension.worktreeAssembly.test.ts` that a probe reaches the host through the real wiring and its answer reaches the dialog — a module test asserting against its own injected fake cannot see a wrapper that drops an argument, which is how the refs answer nearly shipped unrouted.
    2. Assert against the assembly's own real repository that a `prunable` worktree resolves to reattach and that the repair clears the flag.
  - **Boundary**: no new production code — this task adds coverage, and a defect it finds is fixed in the task that owns the file
