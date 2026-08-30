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

- [x] 2_3 The producer is wired into the extension — verified: bun run vitest run 'src/extension.worktreeAssembly.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: design.md D2, D3
  - **Acceptance**:
    - Outcome: The assembled extension answers a refs request instead of ignoring it
    - Verify: unit src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. `src/extension.ts` supplies `readRefs`, binding `readRepoRefs` from 1_1 to the runner it already constructs — beside `readProvisioning`, which is the same shape of injection.
    2. Added rather than folded into 3_1: that task's Boundary is coverage-only, and the producer is production code. 1_2 built the seam and named `WorktreeHost` as the answerer; nothing named the entry point that supplies the reader, which is the gap this closes.
  - **Boundary**: the derivation stays in `repoRefs.ts` — this task injects a reader, it does not compute a ref list

- [x] 3_1 The list survives the production boundary — verified: bun run vitest run 'src/extension.worktreeAssembly.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_2, 2_3
  - **Refs**: design.md D1, D2; specs/worktree-panel/spec.md#a-held-branch-names-the-directory-holding-it
  - **Acceptance**:
    - Outcome: The assembled extension lists the repository's branches and marks the one the open worktree holds
    - Verify: unit src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. Cover in `src/extension.worktreeAssembly.test.ts` that the request reaches the host through the real wiring and the answer reaches the dialog — a module test asserting against its own injected fake cannot see a wrapper that drops an argument.
    2. Assert the held mark is present for the branch the assembly's own linked worktree has checked out, since that is the fact 1_1 derives rather than reads.
  - **Boundary**: no new production code — this task adds coverage, and a defect it finds is fixed in the task that owns the file

- [x] 4_1 Round-1 fixes: styling, mode derivation, and one scoped cache read — verified: bun run vitest run 'src/webview/worktree/WorktreeCreateDialog.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_1
  - **Refs**: design.md D2, D4, D6; .reviews/round-1.md B1, B2, B3, W1, W2, W3, S1, S2
  - **Acceptance**:
    - Outcome: Switching repository re-decides the branch mode, and the list renders as a bounded styled popup
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/worktreePanel.css` gains the popup, option, active, held-row and badge rules, plus a detached-toggle rule — the shipped selector is `.wt-dialog .vault-segmented button` and the toggle carries the class on the button itself, so it takes container styling and no button styling (B1).
    2. `src/webview/worktree/WorktreeCreateDialog.ts`: one derivation of `choice` and `branchMode` from the CURRENT repository's refs and the typed name, called on typing, repository change, every refs answer, and leaving detached (B2). It replaces the fallback in `heldBranch` that could not tell "this repo has the ref and it is free" from "this repo does not have it" (W1). Index the repos by id for `bindRefs` (W3), point `aria-describedby` at the partial notice (S1), and surface the existing "checked out in" explanation when a held row is refused from the keyboard (S2).
    3. `src/worktree/WorktreeCache.ts` gains a single-repository read, and `src/providers/WorktreeHost.ts`'s refs handler uses it instead of snapshotting the whole workspace per request (B3). The create-defaults handler keeps its own pre-existing `cache.read()` — that cost is not this change's and is recorded rather than folded in.
    4. `src/worktree/WorktreeCache.test.ts` covers the new single-repository read: same copy discipline as `read()`, and absent rather than a fabricated group for an unknown id.
    5. Cover in `src/webview/worktree/WorktreeCreateDialog.test.ts` and `src/webview/worktree/WorktreeController.test.ts`: a switch that must drop `existing`; a switch that must drop a stale holder; and a refs answer delivered after a dialog actually opened and closed — the round-1 case asserted that with no dialog ever open, so it could not fail for the reason it named (W2).
  - **Boundary**: `docs/ui/create-worktree.html` and `docs/ui/worktree-create-dialog.css` are owned by an external design pass and are NOT edited — the styling lands in `worktreePanel.css`

- [x] 4_2 Round-2 fixes: the create-new submit route, the scrolled active row, and an answer that knows its opening — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeCreateDialog.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_1
  - **Refs**: design.md D1, D5, D7; .reviews/round-2.md B4, B1, W2, S3
  - **Acceptance**:
    - Outcome: Committing create-new after typing a held branch issues no create request
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeCreateDialog.ts`: `heldBranch()` derives the holder from the CURRENT repository's exact ref match on the typed name, independent of `choice`. Committing the create-new row sets `choice` to `new` while leaving an exact held name in the input, so a guard reading only `choice` stops seeing the holder and submits (B4). The stale cross-repository fallback round-1 W1 deleted is NOT restored — the lookup is against `offeredRefs()`, which is this repository's list.
    2. Same file: `setActive` scrolls the active option into view with a guarded `scrollIntoView({ block: "nearest" })`, since the popup scrolls and Enter otherwise commits an off-screen row (B1).
    3. Same file: `closed` is set on the dismissal path, not only in `disposeAll` — Escape and the scrim never reach `disposeAll`, so the round-1 guard was passing on the DOM being gone rather than on the guard firing (W2).
    4. `src/types/messages.ts`, `src/webview/worktree/WorktreeController.ts` and `src/providers/WorktreeHost.ts` carry the opening token D1 now specifies: the request mints it, the host echoes it, the form drops an answer whose token is not the one it awaits (W2). Scoped to the refs pair; the defaults and provisioning messages are untouched.
    5. `src/webview/worktree/worktreePanel.css`: the active-selection colours are declared after the create-new colour so they win at equal specificity (B1), and the popup is bounded by the space below the input rather than a fixed height (S3).
    6. The token widens the wire, so the fixtures that construct these two messages carry it: `src/providers/WorktreeHost.actions.test.ts`, `src/webview/messaging/MessageRouter.test.ts`, `src/providers/TerminalViewProvider.worktree.test.ts` and `src/extension.worktreeAssembly.test.ts`.
    7. Cover in `src/webview/worktree/WorktreeCreateDialog.test.ts` and `src/webview/worktree/WorktreeController.test.ts`: a held branch typed then committed as create-new by pointer AND by keyboard issues no request; an answer carrying a superseded token is dropped while the awaited one applies; the active row is scrolled when it leaves view.
  - **Boundary**: `docs/ui/create-worktree.html` and `docs/ui/worktree-create-dialog.css` are owned by an external design pass and are NOT edited
