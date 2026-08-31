## 1. The identity on the wire

- [x] 1_1 Carry the opening on the destination request and both replies — verified: pnpm run check-types && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#a-create-form-s-opening-identity-travels-on-every-request-and-every-reply; design.md D1
  - **Acceptance**:
    - Outcome: The destination request and both replies name the opening they belong to
    - Verify: command pnpm run check-types
  - **Plan**:
    1. `src/types/messages.ts`: `opening: number` on `WorktreeCreateDefaultsRequest`, on `WorktreeCreateDefaultsMessage` and on `WorktreeProvisionOfferMessage`. Required, not optional — an absent opening is the permissive reading D1's failure-surface row rules out.
    2. Same file: `WorktreeCreateClosedMessage` (`opening`), webview → extension, added to `WORKTREE_MESSAGE_TYPES`.
    3. The field is REQUIRED, so the tree does not compile until every existing site names an opening. Those sites are carried here, mechanically and with no behaviour change, because a task whose Verify is `check-types` cannot pass while it has broken the build for the tasks after it: `src/webview/worktree/WorktreeController.ts` (both posters, sending the token it already holds), `src/providers/WorktreeHost.ts` (echo it on both replies), and the four suites that construct these messages — `src/providers/TerminalViewProvider.worktree.test.ts`, `src/providers/WorktreeHost.actions.test.ts`, `src/webview/worktree/WorktreeController.test.ts`, `src/webview/worktree/WorktreeController.state.test.ts`.
  - **Boundary**: no guard, no drop, no retirement handling — 1_2 and 2_1 own those. This task makes the field exist and every caller name it, and nothing may start BEHAVING differently here

- [x] 1_2 Send and honour the opening in the panel — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeController.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
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

- [x] 2_1 Record the opening the panel named, and answer nothing for any other — verified: bun test 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
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

- [x] 2_2 Retire an opening, and evict what it authorized — verified: pnpm exec vitest run 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
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

- [x] 3_1 Cancel and submit both close the conversation — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeController.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
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

- [x] 3_2 Prove it through the shipped wiring — verified: pnpm exec vitest run 'src/extension.worktreeAssembly.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_1
  - **Refs**: design.md D2, D3
  - **Acceptance**:
    - Outcome: The assembled extension drops a predecessor's offer and honours the live opening's
    - Verify: unit src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. `src/extension.worktreeAssembly.test.ts`: reopen a form while the first opening's provisioning read is outstanding, and assert the predecessor renders nothing while the live opening's own answer does.
    2. Same file: assert the retirement travels from the dialog's Cancel to the shipped host. (Planned as "route `onWorktreeCreateClosed` through the shared table" — there is no such route to move: `worktreeCreateClosed` is webview → extension, so it has no inbound handler. The shared table's coverage of the offer route, which this walk does depend on, is asserted instead.)
  - **Boundary**: no production behaviour is added here — this task only proves what tasks 1 to 3_1 built, through the real assembly

## 4. Retirement covers every channel the token carries

> Added after round 1. B2, B4 and B6's liveness half: D5 under-scoped retirement to the
> provisioning offer, and D4 never said what a repeat means once the read has settled.

- [x] 4_1 A retired opening mints no probe or debris authority — verified: pnpm exec vitest run 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_2
  - **Refs**: specs/worktree-panel/spec.md#closing-a-create-form-retires-its-opening; design.md D5
  - **Acceptance**:
    - Outcome: After a form closes, a probe and a debris authorization riding its opening are both refused
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `src/providers/WorktreeHost.ts`: `retireOpening` also drops every `openings` record the surface holds — the same prefix sweep the read markers get.
    2. `src/providers/WorktreeHost.actions.test.ts`: after a close, `worktreeCreateProbe` publishes nothing and `worktreeAuthorizeDebris` issues no authorization; each asserted with a setup-landed check first.
  - **Boundary**: the debris carve-out's own rule is unchanged — a deletion still needs an explicit authorization naming a fingerprint. What changes is that a cancelled form can no longer be the thing that names one.

- [x] 4_2 A duplicate after the read settles still runs no second read — verified: pnpm exec vitest run 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_1
  - **Refs**: specs/worktree-panel/spec.md#a-repeated-request-for-one-opening-never-starts-a-second-read; design.md D4
  - **Acceptance**:
    - Outcome: A repeat delivered after the first read completed starts no read, and the form is still answered
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `src/providers/WorktreeHost.ts`: the read marker is cleared by retirement rather than by the read settling; a FAILED read clears it so the opening may retry.
    2. `src/providers/WorktreeHost.actions.test.ts`: settle the first read, repeat the same opening, assert one read and a second destination reply; and a failed read followed by a repeat does read again.
  - **Boundary**: the destination reply stays unconditional — joining the read must not cost a repeat its answer

- [ ] 4_3 The panel stops honouring an opening it retired
  - **Deps**: 4_2
  - **Refs**: design.md D5
  - **Acceptance**:
    - Outcome: A reply of any kind naming a retired opening changes nothing in the panel
    - Verify: unit src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeController.ts`: advance `refsToken` after posting the retirement, so every existing guard rejects the retired number.
    2. `src/webview/worktree/WorktreeController.test.ts`: a defaults, offer and refs reply each delivered after a close change nothing. The existing `[1_2][r1 W2]` case asserts a refs reply IS still stored after close — that assertion encodes the behaviour D5 now corrects and moves with it.
  - **Boundary**: the retirement still names the opening the dialog captured; advancing the counter must not change what was posted
