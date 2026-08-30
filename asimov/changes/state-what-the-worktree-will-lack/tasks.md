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

- [ ] 1_3 Hold the model and publish it under an opaque offer id
  - **Deps**: 1_2
  - **Refs**: docs/design/worktree-provisioning.md#40-the-model-the-user-saw-is-the-model-that-runs; docs/design/worktree-rpc.md#24-the-provisioning-offer; design.md D5
  - **Acceptance**:
    - Outcome: A superseded offer id resolves to nothing in the host's store
    - Verify: unit src/worktree/provisioning/offerStore.test.ts
  - **Plan**:
    1. Add `src/worktree/provisioning/offerStore.ts` holding `offerId → ProvisionModel` per surface, minting item ids within an offer as a counter rather than from a path or a hash of one (design.md D5).
    2. In `src/providers/WorktreeHost.ts`, resolve the model and post `worktreeProvisionOffer` where the create defaults are already published, so one form open produces one offer.
    3. Expose the lookup the redeemer will need — an unknown offer id resolves to nothing rather than throwing — but redeem nothing here: WT-012.2 owns execution.
  - **Boundary**: no execution path reads this store in this change — it is written and looked up, never applied

- [ ] 1_4 Render the section, one row per offered item
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
  - **Boundary**: no edit to `docs/ui/create-worktree.html` or `docs/ui/worktree-create-dialog.css`

- [ ] 1_5 Say what a repository that declares nothing will still lack
  - **Deps**: 1_4
  - **Refs**: specs/worktree-panel/spec.md#{the-create-form-states-what-the-new-worktree-will-lack, a-provisioning-file-that-cannot-be-read-does-not-block-a-create}; docs/design/worktree-provisioning.md#9-edge-cases
  - **Acceptance**:
    - Outcome: A repository declaring nothing still gets the section, and a malformed file still gets a create
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. In `src/webview/worktree/WorktreeCreateDialog.ts`, render the empty model as the sentence the spec requires rather than as an empty list — the distinction that matters is "needs nothing" against "we did not look".
    2. In the same file, render `problems[]` as named rows offering to open the file, and assert in `src/webview/worktree/WorktreeCreateDialog.test.ts` that the create button stays enabled: a broken provisioning config is not a reason to refuse to make a worktree.
    3. Add the empty-model and malformed-model fixtures to `src/webview/worktree/worktreeFixtures.ts` beside the ones 1_4 added.
