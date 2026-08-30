# Tasks — offer every ref in one box

- [x] 1_1 Enumerate the repository's local branches, bounded — verified: bun test 'src/worktree/repoRefs.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D2, D3; specs/worktree-panel/spec.md#a-held-branch-names-the-directory-holding-it
  - **Acceptance**:
    - Outcome: A repository over the cap answers a partial list flagged partial; an empty one answers an empty list
    - Verify: unit src/worktree/repoRefs.test.ts
  - **Plan**:
    1. New `src/worktree/repoRefs.ts` reading local branches over the injected git runner, with the cap as a recorded exported constant and a `truncated` flag set when it was hit.
    2. Each ref carries the name of the directory whose worktree holds it, taken from the `WorktreeInfo[]` the caller passes in — never a second git call, and never a full path.
    3. A non-zero exit, a timeout, or a buffer overflow answers a failed read rather than an empty list: "no branches" and "we could not ask" are different, and only one of them is a real repository state.
    4. Cover in `src/worktree/repoRefs.test.ts`: the cap and its flag; an empty repository; a failed read; a branch held by another worktree carries that directory's name; a branch held by the MAIN worktree is marked too; a detached or bare worktree contributes no holder.
  - **Boundary**: read-only — this module runs no git command that writes

- [x] 1_2 The refs reach the dialog on their own message — verified: bun run vitest run 'src/webview/worktree/WorktreeController.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D1
  - **Acceptance**:
    - Outcome: The dialog opens before the refs arrive and gains the list when they do
    - Verify: unit src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. `src/types/messages.ts` gains the request and answer named in design.md § Interfaces, beside the provisioning offer they are modelled on.
    2. `src/webview/worktree/WorktreeController.ts` requests them when the create dialog opens and routes the answer through a bound applier, exactly as `bindProvisioning` already does. The seed slot on `WorktreeCreateDefaults` and the `bindRefs` dep live in `src/webview/worktree/worktreeViewTypes.ts` and `src/webview/worktree/WorktreeCreateDialog.ts`; this task stores the value, 2_1 renders it.
    3. `src/providers/WorktreeHost.ts` answers the request from 1_1 over the runner and listing it already holds.
    4. Cover in `src/webview/worktree/WorktreeController.test.ts` and `src/providers/WorktreeHost.actions.test.ts`: the request goes out on open; an answer for a different repo is ignored; an answer that arrives after the dialog closed is dropped rather than applied.
    5. `src/providers/TerminalViewProvider.worktree.test.ts` holds the routing-completeness fixture keyed on `WORKTREE_MESSAGE_TYPES` — a new inbound type is a compile error there until it has a sample, which is the fixture doing its job.
    6. The inbound half is only half the wire: `src/webview/messaging/MessageRouter.ts` and `src/webview/main.ts` route the ANSWER to the controller. Declared-posted-handled but unrouted is exactly how `requestWorktreeSubagents` shipped inert with every unit test green, so `src/webview/messaging/MessageRouter.test.ts` covers the new case.
  - **Boundary**: `worktreeCreateDefaults` gains nothing — it is answered per settled branch edit and the refs are not a per-keystroke fact (D1)

- [x] 2_1 The lead input becomes the combobox — verified: bun run vitest run 'src/webview/worktree/WorktreeCreateDialog.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: design.md D4, D6, D7; specs/worktree-panel/spec.md#{the-create-dialog-offers-branches-and-a-create-new-entry-in-one-list, the-branch-list-is-ordered-by-what-the-typed-text-most-likely-means, a-branch-can-be-created-when-the-list-is-unavailable-or-incomplete, create-dialog-keyboard-and-dismissal-behaviour, escape-closes-the-branch-list-before-it-dismisses-the-dialog}
  - **Acceptance**:
    - Outcome: Typing filters one list ordered exact match, then prefix matches, then create-new
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. In `src/webview/worktree/WorktreeCreateDialog.ts`, the branch input gains combobox semantics over a listbox of the refs from 1_2 plus a create-new row, with plain markup rather than the vendored widget (D6).
    2. Selecting a ref sets the draft's branch mode to existing; the create-new row sets it to new. The Advanced branch-source control keeps only the detached case (D4).
    3. Escape closes an open list and reaches the dialog only when the list is closed; arrow keys move the active option only while open (D7). The shell owns Escape on a `document` CAPTURE listener registered before the form exists, so no listener the form adds can run first — `src/webview/worktree/worktreeDialogShell.ts` gains an optional "was this handled?" hook instead, keeping one Escape owner rather than two racing ones.
    4. Cover in `src/webview/worktree/WorktreeCreateDialog.test.ts`: the ordering; the create-new row present at every query including one matching nothing; the list absent before the answer arrives and present after; Escape's two levels; that the existing focus-order, focus-trap and dismissal cases still pass untouched.
  - **Boundary**: `docs/ui/create-worktree.html` and `docs/ui/worktree-create-dialog.css` are owned by an external design pass and are NOT edited — if the control cannot be built without them, STOP and ask

- [x] 2_2 A held branch is shown, explained, and unsubmittable — verified: bun run vitest run 'src/webview/worktree/WorktreeCreateDialog.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: design.md D2, D5; specs/worktree-panel/spec.md#{a-branch-another-worktree-holds-is-offered-but-not-selectable, an-entry-that-cannot-be-selected-stays-reachable, an-incomplete-branch-list-is-stated-as-incomplete}
  - **Acceptance**:
    - Outcome: A create naming a branch another worktree holds issues no request, by any route into submit
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. In `src/webview/worktree/WorktreeCreateDialog.ts`, a held row renders with its holder's directory name and `aria-disabled`, staying reachable and announced rather than hidden (D5).
    2. The submit guard reads the selection rather than the DOM, so a held branch cannot be submitted even when it reached the draft by a route that never touched the row — a typed exact match, or a list that answered after the name was typed.
    3. A truncated list states that it is partial, and the create-new row stays selectable underneath it.
    4. Cover in `src/webview/worktree/WorktreeCreateDialog.test.ts`: the badge names a directory and not a path; submit is refused for a held branch typed by hand rather than clicked; the partial notice appears only when the answer says truncated; a failed enumeration still permits a create.
  - **Boundary**: the disabled rendering is never the guard — a test that only asserts the attribute does not satisfy this task

- [ ] 3_1 The list survives the production boundary
  - **Deps**: 2_2
  - **Refs**: design.md D1, D2; specs/worktree-panel/spec.md#a-held-branch-names-the-directory-holding-it
  - **Acceptance**:
    - Outcome: The assembled extension lists the repository's branches and marks the one the open worktree holds
    - Verify: unit src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. Cover in `src/extension.worktreeAssembly.test.ts` that the request reaches the host through the real wiring and the answer reaches the dialog — a module test asserting against its own injected fake cannot see a wrapper that drops an argument.
    2. Assert the held mark is present for the branch the assembly's own linked worktree has checked out, since that is the fact 1_1 derives rather than reads.
  - **Boundary**: no new production code — this task adds coverage, and a defect it finds is fixed in the task that owns the file
