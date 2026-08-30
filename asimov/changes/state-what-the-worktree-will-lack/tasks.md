# Tasks: state-what-the-worktree-will-lack

## 1. The provider layer

- [x] 1_1 Declare the normalized model and the offer on the wire — verified: pnpm run check-types && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: docs/design/worktree-provisioning.md#2-the-normalized-model; docs/design/worktree-rpc.md#24-the-provisioning-offer; design.md D7
  - **Acceptance**:
    - Outcome: The model, the offer message and the optional port number are declared and compile
    - Verify: command pnpm run check-types
  - **Plan**:
    1. In `src/types/messages.ts`, add `ProvisionEntry`, `ProvisionSetupStep`, `ProvisionPort`, `ProvisionProvider`, `ProvisionProblem` and `ProvisionModel` exactly as `docs/design/worktree-provisioning.md` § 2 declares them, beside the `ProvisionSelection` and `ProvisionItemId` WT-012.0 already landed, copying the doc comments that state each shape's reason.
    2. Declare `ProvisionPort.port` optional per design.md D7, and add `WorktreeProvisionOfferMessage` (`type: "worktreeProvisionOffer"`) carrying `repoId`, the opaque `offerId` and the model.
    3. Add the message to `ExtensionToWebViewMessage`, and to `WORKTREE_MESSAGE_TYPES` if that list covers extension-to-webview types — check which direction it enumerates before adding.
  - **Boundary**: no field on any of these shapes capable of carrying an absolute path or command text back from the webview — the selection stays ids-only

- [x] 1_2 Read the repository's own provisioning file into the model — verified: pnpm exec vitest run 'src/worktree/provisioning/asimovProvider.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: docs/design/worktree-provisioning.md#31-asimov--asimovworktreeyaml; docs/design/worktree-provisioning.md#43-provenance-is-preserved-through-every-transform; docs/design/worktree-provisioning.md#7-security; docs/design/worktree-provisioning.md#9-edge-cases; design.md D1, design.md D2, design.md D3, design.md D4
  - **Acceptance**:
    - Outcome: This repository's own `asimov/worktree.yaml` reads as five copy entries, one link entry and two shell steps, each naming that file
    - Verify: unit src/worktree/provisioning/asimovProvider.test.ts
  - **Plan**:
    1. Add `yaml` to `dependencies` in `package.json` and install it. The package is `yaml` by eemeli (2.9.0) — if the name resolves to anything else, STOP rather than substituting.
    2. Add `src/worktree/provisioning/asimovProvider.ts` exporting `readAsimovProvisioning(deps, repoRoot): Promise<ProvisionModel>`, taking its filesystem reads as injected dependencies the way the sibling worktree modules do, so the suite needs no real disk.
    3. Map the four YAML keys per § 3.1's table. A `parse` throw, an unknown top-level key, or a value of the wrong shape becomes a `problems[]` entry; the model that survives is still returned, because § 9 keeps the create enabled.
    4. Expand a final-segment `*` against the main worktree at read time, giving every expanded entry the glob's own `source` (§ 4.3). An unmatched glob contributes nothing and is not a problem. A pattern with more than one `*`, or a `*` outside the final segment, is a `malformed` problem.
    5. Import `isResolvedPathInside` from `src/utils/pathBoundary.ts` for every containment question, including the glob's parent directory before it is read. Write no second containment implementation. An escaping entry is refused and reported, never clamped.
    6. Bound `ProvisionProblem.detail` and keep it plain text — a parser message can quote arbitrary file content (§ 7).
  - **Boundary**: no containment implementation anywhere in `src/` but `src/utils/pathBoundary.ts` — `rg -n 'function isPathInside' src/` must find that file and no other; and no write of any kind to disk

- [x] 1_3 Hold the model and publish it under an opaque offer id — verified: pnpm exec vitest run 'src/worktree/provisioning/offerStore.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: docs/design/worktree-provisioning.md#40-the-model-the-user-saw-is-the-model-that-runs; docs/design/worktree-rpc.md#24-the-provisioning-offer; design.md D5
  - **Acceptance**:
    - Outcome: A superseded offer id resolves to nothing in the host's store
    - Verify: unit src/worktree/provisioning/offerStore.test.ts
  - **Plan**:
    1. Add `src/worktree/provisioning/offerStore.ts` holding `offerId → ProvisionModel` per surface, minting item ids within an offer as a counter rather than from a path or a hash of one (design.md D5).
    2. In `src/providers/WorktreeHost.ts`, resolve the model and post `worktreeProvisionOffer` where the create defaults are already published, so one form open produces one offer.
    3. Expose the lookup the redeemer will need — an unknown offer id resolves to nothing rather than throwing — but redeem nothing here: WT-012.2 owns execution.
    4. Cover the host wiring in `src/providers/WorktreeHost.actions.test.ts`: one form open produces one offer, and the defaults request re-sent as the user types does not mint a second.
  - **Boundary**: no execution path reads this store in this change — it is written and looked up, never applied

- [x] 1_4 Render the section, one row per offered item — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeCreateDialog.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_3
  - **Refs**: specs/worktree-panel/spec.md#{the-create-form-states-what-the-new-worktree-will-lack, a-linked-row-says-where-its-writes-land}; design.md D6
  - **Acceptance**:
    - Outcome: Every offered item renders one row naming the file that declared it
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. In `src/webview/worktree/WorktreeCreateDialog.ts`, render the section from the offer as one flat checkbox list over `entries`, `ports` and `setup` — § 2.4's selection is one flat list of ids, so the rows are not grouped by kind.
    2. Take the markup and class names from `docs/ui/create-worktree.html` and `docs/ui/worktree-create-dialog.css` as they stand on this branch. Read them; change neither — a design pass owns both files and an unmerged pass on `main` touches them too.
    3. Follow the offer through `src/webview/worktree/worktreeViewTypes.ts` and `src/webview/worktree/WorktreeController.ts` the way the create defaults already travel.
    4. State the linked-row consequence as part of the row, not as a dismissible notice — the spec makes it unsuppressible.
    5. The section's styles go in `src/webview/worktree/worktreePanel.css`, which is the panel's shipped stylesheet — `docs/ui/worktree-create-dialog.css` is a mockup asset that no shipped module loads, so its `cw-` class names are read as the design and re-expressed in the panel's own `wt-` idiom.
    6. Route the offer to the controller through `src/webview/messaging/MessageRouter.ts` and `src/webview/main.ts`, the way `worktreeCreateDefaults` already routes, and add the offer fixtures to `src/webview/worktree/worktreeFixtures.ts`. Cover the controller's own hold-and-attach in `src/webview/worktree/WorktreeController.test.ts`.
  - **Boundary**: no edit to `docs/ui/create-worktree.html` or `docs/ui/worktree-create-dialog.css`

- [x] 1_5 Say what a repository that declares nothing will still lack — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeCreateDialog.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_4
  - **Refs**: specs/worktree-panel/spec.md#{the-create-form-states-what-the-new-worktree-will-lack, a-provisioning-file-that-cannot-be-read-does-not-block-a-create}; docs/design/worktree-provisioning.md#9-edge-cases
  - **Acceptance**:
    - Outcome: A repository declaring nothing still gets the section, and a malformed file still gets a create
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. In `src/webview/worktree/WorktreeCreateDialog.ts`, render the empty model as the sentence the spec requires rather than as an empty list — the distinction that matters is "needs nothing" against "we did not look".
    2. In the same file, render `problems[]` as named rows offering to open the file, and assert in `src/webview/worktree/WorktreeCreateDialog.test.ts` that the create button stays enabled: a broken provisioning config is not a reason to refuse to make a worktree.
    3. Add the empty-model and malformed-model fixtures to `src/webview/worktree/worktreeFixtures.ts` beside the ones 1_4 added.
    4. Style both states in `src/webview/worktree/worktreePanel.css`, beside the section's own rules.

## 2. Round-1 review fixes

- [x] 2_1 Refuse what the provider file cannot be trusted to say — verified: pnpm exec vitest run 'src/worktree/provisioning/asimovProvider.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_5
  - **Refs**: .reviews/round-1.md B2, B7, B8, W1; docs/design/worktree-provisioning.md#7-security; docs/design/worktree-provisioning.md#9-edge-cases; design.md D3, design.md D4
  - **Acceptance**:
    - Outcome: A denied provider file is named as a problem, a symlinked glob match is refused, and an oversized file never reaches the parser
    - Verify: unit src/worktree/provisioning/asimovProvider.test.ts
  - **Plan**:
    1. In `src/worktree/provisioning/asimovProvider.ts`, prepare the resolved root BEFORE reading the provider file and authorize that path — the file name is a constant but the file itself can be a symlink out of the checkout.
    2. Run every expanded glob match through the same resolved containment check the literal entries use. A contained parent says nothing about a child symlink, and these entries are what a later task materializes (B2, design.md D4).
    3. Classify errno rather than swallowing it: only a confirmed absence (`ENOENT`/`ENOTDIR`) is absence; every other failure becomes a bounded `unreadable` problem, for the provider read and for a glob's `readdir` alike (B8).
    4. Bound expansion: a per-glob and a per-model row budget, with the overflow reported as a bounded problem rather than silently truncated (B7).
    5. Bound the read itself, not a prior `stat` — an oversized provider file becomes an `unreadable` problem and never reaches `parse` (W1).
  - **Boundary**: no containment implementation of its own — `src/utils/resolvedPathBoundary.ts` stays the only one; and no write of any kind to disk

- [x] 2_2 Make the offer belong to one form, and connect it in production — verified: pnpm exec vitest run 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: .reviews/round-1.md B1, B3, B5, B6; docs/design/worktree-provisioning.md#40-the-model-the-user-saw-is-the-model-that-runs; design.md D5
  - **Acceptance**:
    - Outcome: The shipped extension offers provisioning, one read per form, and a closed form's offer resolves to nothing
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. Add `src/worktree/provisioning/provisioningDeps.ts` building the adapter's filesystem dependencies over `node:fs/promises`, including the bounded read 2_1 defines, and wire `readAsimovProvisioning` into `createWorktreeHost` in `src/extension.ts` so the shipped dialog actually receives an offer (B1). Prove that seam against a real checkout in `src/worktree/provisioning/provisioningDeps.test.ts` — every other suite injects fakes, which is what let it ship unwired.
    2. Scope `lookup` in `src/worktree/provisioning/offerStore.ts` to the surface key that issued the offer, admitting only that key's current id — the signature is what a redeemer inherits (B3). Cover it in `src/worktree/provisioning/offerStore.test.ts`.
    3. Track the read in flight per form in `src/providers/WorktreeHost.ts`, marked BEFORE the await, and drop completions from a superseded generation (B5).
    4. Clear a surface's offers when its form closes and when the surface detaches, and refuse a post to a disposed surface (B6).
    5. Repair the 1_3 test whose fake resolves synchronously: hold one resolution open and drive a second defaults request into that window, or the assertion cannot observe the property it names.
  - **Boundary**: still no execution path reads this store — WT-012.2 owns redemption

- [x] 2_3 Keep provisioning out of the destination's channel — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeCreateDialog.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_2
  - **Refs**: .reviews/round-1.md B4, W2, W3, S1; docs/design/worktree-actions.md#32-create
  - **Acceptance**:
    - Outcome: An offer arriving mid-edit leaves Create disabled, and a rebuild keeps the boxes the user ticked
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. Give the offer its own binding in `src/webview/worktree/WorktreeController.ts` and `src/webview/worktree/WorktreeCreateDialog.ts`, separate from `bindDefaults`, so nothing on the provisioning path can clear the destination's `outstanding` gate (B4). Send only the repository that changed (S1).
    2. Rebuild the section only when the offer's identity changes, and carry the checked ids across a rebuild so typing does not revert a user's choice (W2).
    3. Name each checkbox by its subject as well as its verb, via `aria-labelledby` over the top line and the subject — five rows from one provider currently announce identically (W3).
    4. Export the repo id `src/webview/worktree/worktreeFixtures.ts` already defines, so a test wiring the offer channel names the same repository the seed does.
  - **Boundary**: no edit to `docs/ui/create-worktree.html` or `docs/ui/worktree-create-dialog.css`

- [ ] 2_4 Write down the id obligation the merge task inherits
  - **Deps**: 2_3
  - **Refs**: .reviews/round-1.md W4; design.md D2, design.md D5
  - **Acceptance**:
    - Outcome: `ProvisionModel`'s declaration states that ids are per-offer and must be reminted when adapters merge
    - Verify: command pnpm run check-types
  - **Plan**:
    1. State on `ProvisionItemId` in `src/types/messages.ts` that ids are unique within ONE offer only, that each adapter mints from its own counter, and that whatever assembles several adapters into one offer owns reminting them.
    2. No id scheme changes here: minting in an assembly layer that does not exist, or a per-adapter prefix guessing the merge's shape, is the seam-from-one-example design.md D2 rejects.
  - **Boundary**: documentation only — no behavior change, no id format change
