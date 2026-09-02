## 1. What the model must say before anything can be written

- [x] 1_1 Publish which of a provider's files are actually present — verified: pnpm exec vitest run 'src/worktree/provisioning/readProvisioning.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#a-configuration-written-for-the-first-time-names-a-source-that-exists <!-- design.md D11 -->
  - **Acceptance**:
    - Outcome: every published provider names the subset of its files that exists
    - Verify: unit src/worktree/provisioning/readProvisioning.test.ts
  - **Plan**:
    1. Add `present: readonly string[]` to `ProvisionProvider` in `src/types/messages.ts`, documented as the subset of `files` that exists, in read order, non-empty.
    2. In `src/worktree/provisioning/readProvisioning.ts`, fill `present` for both the chosen and the detected-inactive provider by keeping the per-file result `anyFilePresent` already computes rather than reducing it to a boolean.
    3. Add a case to `src/worktree/provisioning/readProvisioning.test.ts` for a repository carrying only `.worktreeinclude`, asserting `present` holds that file alone while `files` still holds both.
    4. Fill `present` where `src/worktree/provisioning/asimovProvider.ts` builds its own `providers` array, and in the fixture `src/webview/worktree/worktreeFixtures.ts`, so the new field has one meaning everywhere a provider is constructed.

## 2. The write

- [x] 1_2 Write the repository's own configuration, and nothing else — verified: pnpm exec vitest run 'src/worktree/provisioning/writeNativeConfig.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{no-configuration-file-another-tool-defined-is-ever-written, a-configuration-that-cannot-be-edited-safely-is-refused-rather-than-rewritten, an-existing-configuration-keeps-the-formatting-and-comments-it-had} <!-- design.md D2, D3, D4, D5, D7, D9, D10 -->
  - **Acceptance**:
    - Outcome: a save records the divergence in `.vscode/worktree.json` and opens no other path for writing
    - Verify: unit src/worktree/provisioning/writeNativeConfig.test.ts
  - **Plan**:
    1. Add `src/worktree/provisioning/writeNativeConfig.ts` exporting `NativeConfigDivergence`, `NativeConfigWrite`, `NativeConfigDeps` and `writeNativeConfig` per design.md § Interfaces.
    2. Resolve `<root>/.vscode` once, refuse with `outside` unless `isResolvedPathInside` from `src/utils/resolvedPathBoundary.ts` accepts it against the resolved root, and name that resolved directory in every operation that follows; `lstat` the target and refuse `outside` when it is a symlink.
    3. Run the whole transaction inside one `LockedFile.withLock` from `src/agentHooks/install/lockedJsonFile.ts`: `readText`, then the edit, then the commit.
    4. Build the new text with `modify` + `applyEdits` from `jsonc-parser` for `exclude`, `extends`, `copy` and `link` only, taking `FormattingOptions` from the file's first indented line and dominant line ending; refuse with `malformed` when `parseTree` reports errors or when a key this writer touches is present with the wrong shape.
    5. Skip an exclusion already present, a path already absent from `copy`/`link`, and an `extends` already naming the chosen file; commit nothing when nothing remains.
    6. Commit through `LockedFile`: `atomicReplace(text, modeOfExistingFile)` for an existing file, `stageReplacement(...).commit("create")` with `discard()` in a `finally` for a first write; map an unacquirable lock to `unavailable` and a commit that did not land to `unwritable`.
    7. Add `"writeNativeConfig.ts"` to `NOT_READ_PATH` in `src/worktree/provisioning/readOnly.test.ts`.
    8. Write `src/worktree/provisioning/writeNativeConfig.test.ts` covering every ledger row in design.md § Obligation ledger, including the arming step each row names.

- [x] 1_3 Derive the divergence from the offer the host holds — verified: pnpm exec vitest run 'src/worktree/provisioning/writeNativeConfig.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1, 1_2
  - **Refs**: specs/worktree-panel/spec.md#{a-choice-the-repository-s-own-configuration-can-express-is-recorded-there, choosing-a-different-source-changes-only-which-source-is-named} <!-- design.md D1, D6, D11 -->
  - **Acceptance**:
    - Outcome: an unticked entry diverges to the key its own declaring file owns
    - Verify: unit src/worktree/provisioning/writeNativeConfig.test.ts
  - **Plan**:
    1. In `src/worktree/provisioning/writeNativeConfig.ts`, export a pure `divergenceOf(model, kept, source)` mapping each unticked `model.entries` member to `exclude` when its `source` is not `.vscode/worktree.json` and to `drop` when it is.
    2. Set `extends` to `present[0]` of the provider `source` names, or of the active one when `source` is absent, and leave it unset for the native provider and for an empty `present`.
    3. Take ports, setup steps and `model.excluded` no further; design.md D6 states the reason for each.

## 3. Carrying the choice

- [x] 1_4 Carry a save request from the host wire to the write — verified: pnpm exec vitest run 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_3
  - **Refs**: specs/worktree-panel/spec.md#{a-choice-the-repository-s-own-configuration-can-express-is-recorded-there, a-save-answers-for-the-form-that-is-still-open} <!-- design.md D1, D8, D9 -->
  - **Acceptance**:
    - Outcome: a stale offer id writes nothing
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. Add `WorktreeProvisionSaveMessage` to `src/types/messages.ts` carrying `repoId`, `offerId`, `opening`, `switch` and the kept ids, with no path or text field, and register its type name beside `worktreeProvisionSwitch`.
    2. Add a `writeNativeConfig` option to the host options in `src/providers/WorktreeHost.ts` and wire it in `src/extension.ts` the way `readProvisioning` is wired.
    3. Handle the message in `src/providers/WorktreeHost.ts`: take `repo.mainPath` from `cache.read().repos`, resolve the model with `offers.lookup`, and return without writing when either is undefined.
    4. Enter the same latest-wins gate `worktreeProvisionSwitch` uses before the write starts, and re-check both it and the live opening before publishing.
    5. On success re-read with `readProvisioning` and publish a fresh offer; on a failure reason from design.md D9, publish it as a problem and leave Create enabled.
    6. Extend `src/providers/WorktreeHost.actions.test.ts` with the stale-offer case and both save-versus-switch interleavings.
    7. Add the new type to the exhaustive sample map in `src/providers/TerminalViewProvider.worktree.test.ts`, which pins every entry of `WORKTREE_MESSAGE_TYPES`.

- [x] 1_5 Offer the save in the create dialog and post it — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeCreateDialog.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_4
  - **Refs**: specs/worktree-panel/spec.md#{a-choice-the-repository-s-own-configuration-can-express-is-recorded-there, a-choice-that-configuration-cannot-express-is-stated-not-silently-dropped} <!-- design.md D1, D6 -->
  - **Acceptance**:
    - Outcome: pressing Configure posts the kept ids and states what the save will not keep
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. Drop `provider` from `WorktreeProvisionSaveMessage` in `src/types/messages.ts`, from its validator and handler in `src/providers/WorktreeHost.ts`, and from `divergenceOf` in `src/worktree/provisioning/writeNativeConfig.ts`: design.md D1 enumerates what the save carries and a source is not on it, the named offer already records which provider was active, and feeding a webview-named provider into the post-write re-read would re-resolve that source instead of the file just written. Convert the affected assertions in `src/worktree/provisioning/writeNativeConfig.test.ts` to drive the same outcomes through `active`.
    2. Add an `onProvisionSave` dep to the dialog deps in `src/webview/worktree/WorktreeCreateDialog.ts`, shaped like `onProvisionSwitch`: ids and the offer id, never a path.
    3. Render a `[Configure…]` control in the provisioning section that calls it with the currently ticked ids, and leave the control out when the section has no offer.
    4. Beside the control, state that ticked setup steps and port choices apply to this create only, per design.md D6.
    5. Supply `onProvisionSave` in `createDialogDeps` in `src/webview/worktree/WorktreeController.ts`, converting it into the opening-bound wire message the way `onProvisionSwitch` is converted.
    6. Extend `src/webview/worktree/WorktreeCreateDialog.test.ts` and `src/webview/worktree/WorktreeController.test.ts` so the posted message is asserted, not only the injected callback.

## Wave 2 — round 1 remediation

Fully sequential. Plan attack 2 refuted the earlier `2_1, 2_4 | 2_2 | 2_3` shape: 2_4 changes whether
2_1's refusal branch is reachable at all, and 2_1 cannot add a refusal reason and stay type-green
without the exhaustive `Record<NativeConfigRefusal, string>` that 2_2's file owns. Nothing here is
genuinely parallel, so nothing here pretends to be.

- [x] 2_1 Take presence from reads already authorized, and pin the ordering it relies on — verified: pnpm exec vitest run 'src/worktree/provisioning/readProvisioning.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: <!-- .reviews/round-1.md F013, F017; design.md D17 -->
  - **Acceptance**:
    - Outcome: presence costs no extra provider-file reads
    - Verify: unit src/worktree/provisioning/readProvisioning.test.ts
  - **Plan**:
    1. In `src/worktree/provisioning/readProvisioning.ts`, pass the prepared root and the `authorized` map into `filesPresent` rather than re-reading every provider file (F017).
    2. Record in the same file that `present` is a candidate and not an authorization — D17 revalidates it at the write, and this task widens the window between snapshot and save.
    3. Pin the ordering `divergenceOf` relies on — the chosen native adapter precedes its `base` in `DETECTION_ORDER` — with a test in `src/worktree/provisioning/readProvisioning.test.ts` (F013).

- [x] 2_2 Bind the write to what it checked, and narrow what it rewrites — verified: pnpm exec vitest run 'src/worktree/provisioning/writeNativeConfig.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: specs/worktree-panel/spec.md#{a-configuration-that-cannot-be-edited-safely-is-refused-rather-than-rewritten, an-existing-configuration-keeps-the-formatting-and-comments-it-had, a-configuration-written-for-the-first-time-names-a-source-that-exists} <!-- design.md D4, D16, D17; .reviews/round-1.md F003, F004, F005, F010, F011, F015 -->
  - **Acceptance**:
    - Outcome: a base deleted between the offer and the save refuses the write
    - Verify: unit src/worktree/provisioning/writeNativeConfig.test.ts
  - **Plan**:
    1. In `src/worktree/provisioning/writeNativeConfig.ts`, move the target `lstat`, the symlink refusal and the mode capture inside `withLock` so the identity the write preserves is the identity the lock covers (F003).
    2. Narrow array edits to one element — `isArrayInsertion` to add, an index to remove — and apply removals in DESCENDING index order: probed, ascending original indices `1` then `2` over `[a,b,c,d]` removes `b` and `d` (D4).
    3. Record in the module that deletion may take a comment from the removed element's immediate neighbour; that is the narrowed D4 claim, not an accident.
    4. Replace the hand-rolled `parseTree`/`getNodeValue` with `providerKit.readJsonc` keeping the errors array (F011), and treat an empty document as an editable empty object rather than `malformed` (F010).
    5. Add the `unnamed` refusal and confirm the named base still exists inside the lock immediately before writing (D17); add it to the refusal map in `src/providers/WorktreeHost.ts` in the same task, since the `Record<NativeConfigRefusal, string>` is exhaustive.
    6. Return `wrote: false` rather than creating an `extends`-only document when nothing diverges and the host says no source was taken (D18's writer half).
    7. Drop `notFound` for the exported `isNotFound` (F015).
    8. In `src/worktree/provisioning/writeNativeConfig.test.ts`, rewrite the span witness to obtain spans independently of the implementation's key path over a fixture with comments on BOTH neighbours of a removed element (F005), and add a round-trip that reads a written document back through the real `nativeProvider` (F002).
    9. Record the D16 boundary in the module: the adversarial parent-swap race is NOT closed here and is owned by the change this one depends on.

- [x] 2_3 Give a refused save its own word, and derive the source change host-side — verified: pnpm exec vitest run 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_2
  - **Refs**: specs/worktree-panel/spec.md#{a-refusal-to-save-says-a-save-was-refused, a-save-that-has-nothing-to-record-writes-nothing} <!-- design.md D13, D18, D19; .reviews/round-1.md F007, F012, F016 -->
  - **Acceptance**:
    - Outcome: a locked file reports that the save did not happen
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. Add `unsaved` to `ProvisionProblem.reason` in `src/types/messages.ts` and map every write refusal but `malformed` onto it in `src/providers/WorktreeHost.ts`, with the cause in `detail` (D13).
    2. Record the opening's baseline source when the form is first offered and compare it with the source active at save time, in `src/providers/WorktreeHost.ts` — never a webview field (D18).
    3. Remove `provider` from the `onlyKeys` allowlist on `isKnownSave` and bound `kept` (F012, F016).
    4. Publish a fresh offer for the LIVE stale-offer rejection only — an unknown repository or an absent reader has no form state to refresh, so those keep returning bare (F007, narrowed by plan attack 2).
    5. Deliver the latest live switch through the guarded post helper rather than the direct `surface.post`, so a throw cannot strand a form (D19).
    6. Cover each in `src/providers/WorktreeHost.actions.test.ts`, including a save payload carrying an extra key, and add the wire sample in `src/providers/TerminalViewProvider.worktree.test.ts`.

- [x] 2_4 Offer the save only where it can be honoured — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeCreateDialog.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_3
  - **Refs**: specs/worktree-panel/spec.md#{no-save-is-offered-against-a-source-change-still-in-progress} <!-- design.md D15, D19; .reviews/round-1.md F009, F014 -->
  - **Acceptance**:
    - Outcome: taking a source removes the save control until the replacement offer arrives
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. In `src/webview/worktree/WorktreeCreateDialog.ts`, remove the control while a switch this form issued is unanswered and restore it when an offer with a new id is drawn (D15).
    2. Stop sending any source-change flag from the form; the host derives it (D18). Update `src/webview/worktree/WorktreeController.ts` accordingly.
    3. Leave the control out where `onProvisionSave` is absent, matching the rule the control's own comment already applies to a missing offer (F009).
    4. Give the D6 note an id and point `aria-describedby` at it from the button (F014).
    5. Render an `unsaved` problem as a save that did not happen rather than a file that could not be read (D13).
    6. Extend `src/webview/worktree/WorktreeCreateDialog.test.ts` and `src/webview/worktree/WorktreeController.test.ts`, including the take-then-configure interleaving.

**Waves**: `2_1 | 2_2 | 2_3 | 2_4`

## Wave 3 — round 2 remediation

- [x] 3_1 Keep every accepted round-2 finding closed in one pass — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeCreateDialog.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_4
  - **Refs**: specs/worktree-panel/spec.md#{a-refusal-to-save-says-a-save-was-refused} <!-- design.md D1, D7, D12, D15, D16, D17, D18; .reviews/round-2.md F013-F020 -->
  - **Acceptance**:
    - Outcome: a save answered by a fresh offer redraws the section with the selection the user pressed it under
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Boundary**: no wire field is added and no path, key or script travels in a save request — the dialog correlates two host-supplied models locally (D1)
  - **Plan**:
    1. Bind the narrow edits to what they claimed in `src/worktree/provisioning/writeNativeConfig.ts`: re-parse and compare the key's value, fall back to a whole-key replace against the original text, and refuse rather than write a document the parser corrupted.
    2. Resolve the containing directory once and take `lstat`, the symlink refusal and the mode inside the lock, in the same file (F019, D16).
    3. In `src/webview/worktree/WorktreeCreateDialog.ts`, key the pending save by repository and hold the offer it went out against, that offer's model, and the selection at the press.
    4. Match the answering offer's rows to the previous offer's by kind, subject, mode, source and occurrence, carry both ticks and unticks across, and apply the new model's defaults only to rows the previous offer did not have (F018).
    5. Reseed from defaults when a source switch was taken after the save — the selection was about a source no longer in play (D15).
    6. Cover each in `src/webview/worktree/WorktreeCreateDialog.test.ts`, `src/worktree/provisioning/writeNativeConfig.test.ts` and `src/types/messages.contract.test.ts`.

**Waves**: `3_1`

## Wave 4 — round 3 remediation

- [x] 4_1 Refuse a base the read side would never accept, and stop toggling what should be derived — verified: pnpm exec vitest run 'src/worktree/provisioning/writeNativeConfig.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_1
  - **Refs**: specs/worktree-panel/spec.md#{a-refusal-to-save-says-a-save-was-refused} <!-- design.md D2, D17; .reviews/round-3.md F014, F022, F023, F025 -->
  - **Acceptance**:
    - Outcome: an `extends` naming no adapter file is refused without the filesystem being asked about it
    - Verify: unit src/worktree/provisioning/writeNativeConfig.test.ts
  - **Boundary**: no new containment rule of its own — the writer asks the read side's adapter list, it does not grow a second copy (D2)
  - **Plan**:
    1. Export `FRAMEWORK_ORDER` from `src/worktree/provisioning/readProvisioning.ts` so one list serves both sides.
    2. In `src/worktree/provisioning/writeNativeConfig.ts`, check adapter membership before the D17 probe and refuse a non-member as `unnamed` (F025).
    3. Mask the created mode by the process umask so the exact `chmod` cannot land broader than the process's own policy (F022).
    4. In `src/webview/worktree/WorktreeCreateDialog.ts`, derive the save button's disabled state from the repository's pending record on every redraw (F014), and evict the switched-from offer's selection when its replacement is drawn (F023).
    5. Cover each in `src/worktree/provisioning/writeNativeConfig.test.ts` and `src/webview/worktree/WorktreeCreateDialog.test.ts`.

**Waves**: `4_1`
