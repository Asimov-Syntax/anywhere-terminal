## 1. Ask the host for a folder

- [x] 1_1 Carry the request and its answer on the wire, and open the picker — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/types/messages.contract.test.ts src/providers/TerminalViewProvider.worktree.test.ts src/extension.worktreeActions.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{a-destination-can-be-chosen-with-the-system-folder-picker,only-a-folder-this-extension-offered-is-derived-under}; design.md D2, D3
  - **Boundary**: No new destination field on the create request, and no reply for a cancelled dialog, a failed one, or one whose form is gone
  - **Acceptance**:
    - Outcome: The host opens the folder picker and answers only a form still asking
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/types/messages.contract.test.ts src/providers/TerminalViewProvider.worktree.test.ts src/extension.worktreeActions.test.ts
  - **Plan**:
    1. `src/types/messages.ts` — the request naming repository and opening, the reply echoing that opening beside the chosen path, and the request's entry in the inbound `WORKTREE_MESSAGE_TYPES` allowlist whose exhaustiveness assertion would otherwise refuse to compile.
    2. `src/providers/WorktreeHost.ts` — take the picker as an optional `WorktreeActions` capability, the way every other host capability arrives, and post only on a confirmed choice whose opening is still the live one after the await. The host imports `vscode` as a type only and must not reach for the API itself.
    3. `src/extension.ts` — declare the picker on `WorktreeActionDeps`, pass it through `createWorktreeActions`, and wire it to the same `showOpenDialog` shape the file tree already uses.
    4. `src/providers/WorktreeHost.actions.test.ts` — where the opening dance already lives: witness the echoed opening, and that cancel, failure, an unwired capability, and a dismissed form each post nothing.
    5. `src/providers/TerminalViewProvider.worktree.test.ts` — extend the exhaustive inbound sample record the new request type obliges.
    6. `src/extension.worktreeActions.test.ts` — its harness builds a complete `WorktreeActionDeps`, so the new capability is a required member there.

- [x] 1_2 Route the answer to the webview that asked — verified: pnpm exec vitest run src/webview/messaging/MessageRouter.test.ts && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#{only-a-folder-this-extension-offered-is-derived-under}; design.md D2
  - **Boundary**: No handling of the reply's meaning here — routing only, and no second place that decides whether an opening matches
  - **Acceptance**:
    - Outcome: A posted answer is carried by the router instead of being dropped there
    - Verify: command pnpm exec vitest run src/webview/messaging/MessageRouter.test.ts
  - **Plan**:
    1. `src/webview/messaging/MessageRouter.ts` — carry the new answer, the way every other host-to-webview worktree reply is carried.
    2. `src/webview/messaging/MessageRouter.test.ts` — witness the route, so a reply declared on the wire cannot stay production-dark. The worktree handler map is 2_2's, because its entry names a controller method that does not exist until then.

## 2. Derive the destination inside the folder that was chosen

- [x] 2_1 Record the folder the dialog resolved, and derive under it — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/types/messages.contract.test.ts && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#{a-destination-can-be-chosen-with-the-system-folder-picker,only-a-folder-this-extension-offered-is-derived-under}; design.md D1, D4, D5
  - **Boundary**: No path from any message is resolved to decide this; no change to what a TYPED override may name, to the collision or occupancy rules, or to the create path's handling of `path`; no configuration, workspace-state or storage write on a pick; no sweep of the record separate from the one that already retires an opening
  - **Acceptance**:
    - Outcome: A destination is derived inside a chosen folder only where this host offered it to this form
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/types/messages.contract.test.ts
  - **Plan**:
    1. `src/types/messages.ts` — the probe's new optional flag, documented as what D5 makes it: a request to use the host's own record, carrying no path because there is none the host did not give.
    2. `src/providers/WorktreeHost.ts` — the `Opening` field D4 names, written by `pickDestination` from `prepareResolvedRoot` on the answer the dialog returned, on the opening it re-read after the await; the probe's three-way root choice branching on FIELD PRESENCE and reading the record with no await between `stillOurs()` and `resolveDestination`; and `resolveDestination` taking that root instead of the configured one, changing nothing else about how it derives, suffixes, or reports the candidate it skipped. `vettedOverride` and its call are untouched.
    3. `src/providers/WorktreeHost.actions.test.ts` — where the probe's own `candidatePath` witnesses already live. One witness per ledger row: a form never offered a folder; close, supersede and detach each followed by a flagged probe; a second repository unaffected by the first's pick; a `realpath` that answers differently the second time; a `requestWorktreeRefs` replay on the live token; and an out-of-root `candidatePath` sent WITH the flag, which is the case that fails if the branch reads the vetting's result instead of the field.
    4. Same file — that a pick records against the live opening and that a dropped answer records nothing.
    5. `src/types/messages.contract.test.ts` — the wire's own witness for the added field.

- [x] 2_2 State the chosen folder from the create form, and show what it resolves to — verified: pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/webview/worktree/WorktreeController.test.ts && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: 2_1, 1_2
  - **Refs**: specs/worktree-panel/spec.md#{a-destination-can-be-chosen-with-the-system-folder-picker,only-a-folder-this-extension-offered-is-derived-under}; design.md D1, D2, D3, D6
  - **Boundary**: No path composed or sent by the webview, no persistence of a chosen folder, no caller setting the override input's value directly, and no change to how a destination is shortened or displayed
  - **Acceptance**:
    - Outcome: Choosing a folder makes the form state the host's destination inside that folder
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeCreateDialog.ts` — the three-state destination D6 draws: one named transition owning every way the destination changes, including the repository switch; the flag travelling on the selection and entering the key that decides whether to ask; and the action rendered beside the field, sharing the override's own availability.
    2. `src/webview/worktree/WorktreeController.ts` and `src/webview/worktree/worktreeMessageHandlers.ts` — bind the request, hand each opening's dialog its own opening number, and route the answer from the router to the controller.
    3. `src/webview/worktree/worktreePanel.css` — lay the action out beside the destination, whose wrapper is a column today.
    4. `src/webview/worktree/WorktreeCreateDialog.test.ts` and `src/webview/worktree/WorktreeController.test.ts` — witness each edge of D6's transition table including the switch, that the pending state between a pick and its answer submits nothing, that a foreign or superseded opening is ignored, that cancelling changes nothing, and that the action follows the override's disabled modes.

- [x] 2_3 Prove a chosen folder reaches git through the shipped wiring — verified: pnpm exec vitest run src/extension.worktreeAssembly.test.ts && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: 2_2
  - **Refs**: specs/worktree-panel/spec.md#{a-destination-can-be-chosen-with-the-system-folder-picker}; design.md D1
  - **Boundary**: No production change here — a witness only; if it fails, the defect belongs to 2_1 or 2_2
  - **Acceptance**:
    - Outcome: A worktree created after choosing a folder is added inside that folder, under the branch's derived name
    - Verify: command pnpm exec vitest run src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. `src/extension.worktreeAssembly.test.ts` — drive the real wiring: choose a folder, submit, and read the `worktree add` argv. Wait on the argv the assertion reads, never a bare `settle()` — a wait that does not name the thing being asserted is the defect this suite already carries.

## 3. Review round 1 — hold the opening across every await

- [x] 3_1 Prove a chosen folder is recorded only by the opening that asked, and only by its newest pick — verified: pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: specs/worktree-panel/spec.md#{only-a-folder-this-extension-offered-is-derived-under}; design.md D4, D5; .reviews/round-1.md F001, F003
  - **Boundary**: No change to what a chosen folder means once recorded, to the typed-override precedence, or to the create path's handling of `path`; no new message, field, or configuration
  - **Acceptance**:
    - Outcome: A suspended continuation writes only to the exact opening it started on
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `src/providers/WorktreeHost.ts` — `Opening` gains the pick generation F003 names, initialised beside `chosenRoot`; `pickDestination` captures the `Opening` before it opens the dialog, advances the generation on a confirmed answer, and writes only where `openingFor(...)` returns that same object with that generation still current; `answerCreateProbe`'s `stillOurs()` captures on its first call and requires object identity on every later one, which is the one predicate covering derivation, publication, and the candidate and repair state written there.
    2. `src/providers/WorktreeHost.actions.test.ts` — the overlaps the round names: a same-token refs replay landing while a pick is suspended and again while a probe is suspended between derivation and publication, and two confirmed picks whose root resolutions finish out of order.

- [x] 3_2 Bind the picker to the form that opened it, and withdraw a chosen folder like a typed one — verified: pnpm exec vitest run src/webview/worktree/WorktreeController.test.ts src/webview/worktree/WorktreeCreateDialog.test.ts && pnpm run check-types && VITEST_MAX_THREADS=6 pnpm run test:unit exit 0
  - **Deps**: 2_2
  - **Refs**: design.md D2, D6; .reviews/round-1.md F002, F004
  - **Boundary**: No change to the other create callbacks' opening handling, to how a destination is displayed, or to which modes withdraw the destination
  - **Acceptance**:
    - Outcome: The picker names the opening that composed the form, and a withdrawn destination retires the folder
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeController.test.ts src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeController.ts` — snapshot the opening once in `createDialogDeps()` and let the picker request and the bound answer both name it, so a predecessor form still on screen cannot post or receive the successor's token.
    2. `src/webview/worktree/WorktreeCreateDialog.ts` — clear the chosen-folder flag in the same withdrawal that marks the destination derived, so both kinds of override retire together.
    3. `src/webview/worktree/WorktreeController.test.ts` and `src/webview/worktree/WorktreeCreateDialog.test.ts` — a predecessor clicked while a successor opening is outstanding, and a disabled-destination mode read through the emitted selection and back out again.

## 4. Review round 3 — a pick is an ask, and every ask is answered

- [ ] 4_1 Anchor the opening the dispatch admitted, before the probe's first await
  - **Deps**: 3_1
  - **Refs**: design.md D4; .reviews/round-3.md F001
  - **Boundary**: No change to what the probe derives, publishes or classifies; no new message or field
  - **Acceptance**:
    - Outcome: A probe resumes only on the opening that admitted it
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `src/providers/WorktreeHost.ts` — `answerCreateProbe` takes the `Opening` the dispatch already looked up to set `latestSeq`, and anchors it before any await instead of on `stillOurs()`'s first call.
    2. `src/providers/WorktreeHost.actions.test.ts` — the witness round 3 named as missing: a flagged probe carrying a `candidatePath`, suspended in the vetting's `realpath`, with a same-token refs replay landing before it resumes.

- [ ] 4_2 Answer every picker this host opened, and say which pick is being answered
  - **Deps**: 4_1
  - **Refs**: specs/worktree-panel/spec.md#{an-opened-picker-holds-the-form-until-it-is-answered}; design.md D3, D7
  - **Boundary**: The host mints no identity and resolves no path a message named; a gone form is still answered with nothing; no change to what a confirmed pick records
  - **Acceptance**:
    - Outcome: A pick that yields no folder is answered, carrying no path
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.actions.test.ts src/types/messages.contract.test.ts src/providers/TerminalViewProvider.worktree.test.ts
  - **Plan**:
    1. `src/types/messages.ts` — `ask` on the request and echoed on the answer, `path` becoming optional there, and the stale note on `path` that still calls it "re-resolved like a typed one" corrected to what D5 made true.
    2. `src/providers/WorktreeHost.ts` — `pickDestination` posts on every arm except a form that is gone, echoing `repoId`, `token` and `ask` unchanged.
    3. `src/providers/WorktreeHost.actions.test.ts` — one witness per D3 arm: confirmed, cancelled, thrown, unresolvable root, and each gone form still silent.
    4. `src/types/messages.contract.test.ts` and `src/providers/TerminalViewProvider.worktree.test.ts` — the wire's own witnesses for the added field and the exhaustive inbound sample.

- [ ] 4_3 Hold the form on its own pick, and let a stale answer change nothing
  - **Deps**: 4_2
  - **Refs**: specs/worktree-panel/spec.md#{a-destination-can-be-chosen-with-the-system-folder-picker,an-opened-picker-holds-the-form-until-it-is-answered}; design.md D6, D7
  - **Boundary**: The form never reads the answer's path value; no new blocked-reason prose beyond the one string the existing gate already shows; no persistence
  - **Acceptance**:
    - Outcome: Create is withheld from the click until that same pick is answered
    - Verify: command pnpm exec vitest run src/webview/worktree/WorktreeCreateDialog.test.ts src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeCreateDialog.ts` — `pickAsked` beside `recoverAsked` and minted like it; the click arms the existing destination gate; `stateDestination` withdraws the ask in every branch; the answer applies only where its `ask` is still outstanding, and clears the gate either way.
    2. `src/webview/worktree/WorktreeController.ts` — carry `ask` out on the request and hand the answer through unchanged.
    3. `src/webview/worktree/WorktreeCreateDialog.test.ts` and `src/webview/worktree/WorktreeController.test.ts` — Create withheld between click and answer and offered again after a cancel; a typed path and a repository switch each surviving a late answer.
