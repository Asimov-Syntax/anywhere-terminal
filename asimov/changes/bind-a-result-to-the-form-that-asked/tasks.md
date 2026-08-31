## 1. The identity on the wire

- [ ] 1_1 Carry the opening on the destination request and both replies
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#a-create-form-s-opening-identity-travels-on-every-request-and-every-reply; design.md D1
  - **Acceptance**:
    - Outcome: The destination request and both replies name the opening they belong to
    - Verify: command pnpm run check-types
  - **Plan**:
    1. `src/types/messages.ts`: `opening: number` on `WorktreeCreateDefaultsRequest`, on `WorktreeCreateDefaultsMessage` and on `WorktreeProvisionOfferMessage`. Required, not optional — an absent opening is the permissive reading D1's failure-surface row rules out.
    2. Same file: `WorktreeCreateClosedMessage` (`opening`), webview → extension, added to `WORKTREE_MESSAGE_TYPES`.
  - **Boundary**: no second identity and no change to `worktreeCreate`'s payload — this task moves one field onto four messages

- [ ] 1_2 Send and honour the opening in the panel
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#a-create-form-s-opening-identity-travels-on-every-request-and-every-reply; design.md D1, D2
  - **Acceptance**:
    - Outcome: A reply naming a superseded opening is dropped
    - Verify: unit src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeController.ts`: send the live opening on both `requestWorktreeCreateDefaults` posts — the opening ask in `openCreateForRepo` and the settled-edit ask in `createDialogDeps`.
    2. Same file: `handleCreateDefaults` and `handleProvisionOffer` drop a message whose `opening` is not the live one, by the rule `handleRefs` already applies.
    3. `src/webview/worktree/WorktreeController.test.ts`: a superseded defaults reply seeds nothing; a superseded offer is not cached; and for each, the LIVE one still lands — a guard that drops everything must fail.
  - **Boundary**: the refs, resolution and debris guards are not rewritten — this task adds the same rule at the two sites that lack it

## 2. The host answers one opening

- [ ] 2_1 Record the opening the panel named, and answer nothing for any other
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#a-repeated-request-for-one-opening-never-starts-a-second-read; design.md D2, D4
  - **Acceptance**:
    - Outcome: A repeated opening request starts no second read
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `src/providers/WorktreeHost.ts`: hold the live opening per surface, written synchronously in the handler turn before any await. Replace `provisionGeneration` rather than keeping it beside the record — two authorities on one question is the defect being removed.
    2. Same file: an opening ask naming the live opening JOINS the read in flight; a different opening supersedes and retires the previous one's right to publish; an unknown one is answered with nothing.
    3. Same file: both replies echo the opening they answer.
    4. `src/providers/WorktreeHost.actions.test.ts`: the duplicate ask runs one read and still answers; an unknown opening posts nothing; a superseding opening's predecessor publishes nothing.
  - **Boundary**: the destination reply must not wait on the provisioning read — they stay independent, per the proposal's must-not

- [ ] 2_2 Retire an opening, and evict what it authorized
  - **Deps**: 2_1
  - **Refs**: specs/worktree-panel/spec.md#closing-a-create-form-retires-its-opening; design.md D3, D5
  - **Acceptance**:
    - Outcome: A read that lands after its opening was retired publishes nothing and leaves no offer behind
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `src/providers/WorktreeHost.ts`: handle `worktreeCreateClosed` — drop the surface's opening record and evict the offer issued against it.
    2. `src/providers/WorktreeHost.actions.test.ts`: a read resolving after the close publishes nothing; the offer it would have issued is not redeemable afterwards.
  - **Boundary**: no new refusal path for an evicted offer id — § 2.4's resolve-fresh-and-resubmit rule already owns that

## 3. Both exits retire

- [ ] 3_1 Cancel and submit both close the conversation
  - **Deps**: 1_2, 2_2
  - **Refs**: specs/worktree-panel/spec.md#closing-a-create-form-retires-its-opening; design.md D3
  - **Acceptance**:
    - Outcome: Cancelling and submitting each post the retirement for the opening that closed
    - Verify: unit src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeView.ts`: one `onCreateClosed` dep, called from BOTH the dialog's `onSubmit` and its `onCancel`.
    2. `src/webview/worktree/WorktreeController.ts`: post `worktreeCreateClosed` from that one hook.
    3. `src/webview/worktree/WorktreeView.test.ts` and `src/webview/worktree/WorktreeController.test.ts`: each exit retires, asserted separately — a retirement wired into one exit is the same bug in a different position.
  - **Boundary**: the submit payload and the cancel's existing behaviour are unchanged; this adds a signal beside them

- [ ] 3_2 Prove it through the shipped wiring
  - **Deps**: 3_1
  - **Refs**: design.md D2, D3
  - **Acceptance**:
    - Outcome: The assembled extension drops a predecessor's offer and honours the live opening's
    - Verify: unit src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. `src/extension.worktreeAssembly.test.ts`: reopen a form while the first opening's provisioning read is outstanding, and assert the predecessor renders nothing while the live opening's own answer does.
    2. Same file: route `onWorktreeCreateClosed` through the shared table from `src/webview/worktree/worktreeMessageHandlers.ts` rather than a hand-written entry.
  - **Boundary**: no production behaviour is added here — this task only proves what tasks 1 to 3_1 built, through the real assembly
