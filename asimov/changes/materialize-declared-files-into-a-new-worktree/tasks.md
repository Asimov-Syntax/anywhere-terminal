# Tasks: materialize-declared-files-into-a-new-worktree

Fully serial. 1_3 and 1_4 share `applyEntries.ts`; 1_5 needs every layer beneath it.

- [x] 1_1 Mint the per-step result contract the wire has documented but never defined — verified: pnpm run check-types && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D8
  - **Acceptance**:
    - Outcome: A selection and a per-step result are both expressible on the wire
    - Verify: command pnpm run check-types
  - **Plan**:
    1. `src/types/messages.ts`: add `ProvisionStepOutcome`, `ProvisionStepResult` (including `details`) and `WorktreeProvisionResultMessage` exactly as D8 declares them, and register the new message in the extension→webview union and its type-name list.
    2. `src/types/messages.ts`: `WorktreeCreateRequestMessage` gains `provision?: ProvisionSelection`. Optional, because a create carrying none is every create made before this feature existed.
    3. `src/types/messages.contract.test.ts`: the new message appears in the union and round-trips. Verify is the type check because that file says outright that `check-types` is the judge and its runtime body is a placeholder — a passing unit run there would not fail on a wrong contract.
  - **Boundary**: no behavior — this task adds types and registrations only, and nothing reads them yet

- [x] 1_2 Refuse an entry before anything opens a file descriptor for it — verified: pnpm exec vitest run 'src/worktree/provisioning/entryGate.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: design.md D4, D7; specs/worktree-panel/spec.md#{an-entry-that-would-write-outside-the-new-worktree-is-refused-not-adjusted, some-material-is-refused-however-a-repository-asks-for-it}
  - **Acceptance**:
    - Outcome: A refused entry yields the reason its own rule names
    - Verify: unit src/worktree/provisioning/entryGate.test.ts
  - **Plan**:
    1. `src/worktree/provisioning/entryGate.ts`: prepare each root ONCE with `prepareResolvedRoot` and answer through `isResolvedPathInsideRoot` (`src/utils/resolvedPathBoundary.ts`), source against the main checkout and destination against the new worktree, separately. This module defines no containment predicate.
    2. `src/worktree/provisioning/entryGate.ts`: the material-class refusals, checked before mode is consulted so copy and link cannot diverge — lockfiles either way, `node_modules` as a link. A lockfile is `refused`, not `skipped`, per D8.
    3. `src/worktree/provisioning/entryGate.test.ts`: `../`, absolute, and symlinked-component escapes refused for source and for destination; a source resolving into the new worktree refused; lockfile refused as copy and as link; `node_modules` refused as link; each refusal carries the reason its rule names, distinguishable from the others.
  - **Boundary**: refuse, never adjust — no code path may return a path it modified to bring it inside a root

- [x] 1_3 Walk a directory no-follow, bounded, replacing nothing — verified: pnpm exec vitest run 'src/worktree/provisioning/applyEntries.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: design.md D5, D6, D9, D10; specs/worktree-panel/spec.md#materializing-never-replaces-anything-that-is-already-there
  - **Acceptance**:
    - Outcome: A directory copy replaces nothing that already existed, at any depth
    - Verify: unit src/worktree/provisioning/applyEntries.test.ts
  - **Plan**:
    1. `src/worktree/provisioning/applyEntries.ts`: the recursive walk, dispatching on `lstat`. Files copy fd-to-fd — source opened `O_RDONLY | O_NOFOLLOW` and `fstat`-ed on that fd, destination opened `O_WRONLY | O_CREAT | O_EXCL` — not through `copyFile`, which cannot express no-follow on the source. Mode bits preserved, ownership never.
    2. `src/worktree/provisioning/applyEntries.ts`: directories created by non-recursive `mkdir`; on `EEXIST`, `lstat` the destination and descend only into a real directory — a file or a symlink there stops that subtree and is reported.
    3. `src/worktree/provisioning/applyEntries.ts`: a symlink is recreated only when its target resolves inside the main checkout from the SOURCE directory and inside the worktree from the DESTINATION directory (D6). Links are never traversed.
    4. `src/worktree/provisioning/applyEntries.ts`: the walk budget — node count, byte cap, and a wall-clock deadline from `afterDelay` (`src/worktree/deadline.ts`). Exceeding one stops that entry, reports `failed` naming the budget, and leaves the remaining entries to run.
    5. `src/worktree/provisioning/applyEntries.fake.ts`: a filesystem small enough to state a defeater in — `lstat`, `realpath` resolving component by component, and a no-follow open that refuses a source which became a symlink. Test-only; production takes `node:fs/promises`.
    6. `src/worktree/provisioning/applyEntries.test.ts`: the falsifiers, each of which must fail against a walk written the obvious way — an existing top-level destination skipped; a directory copy into an existing directory holding one of the same filenames skips that file, copies its siblings, and names it in `details`; a source replaced by a symlink between `lstat` and open fails rather than copying through; a destination parent that is a symlink out of the worktree refused at the descent check; a source directory over a destination file reported for that subtree rather than `ENOTDIR` on its children; a source directory over a destination symlink-to-directory refused rather than followed; the D6 relocation construction (an in-repo relative link that resolves outside once moved) refused; an in-repo link at equal depth recreated as a symlink; a symlink loop terminating; a special file refused; a walk over the node budget and one over the deadline each reporting `failed` with the budget named while later entries still run; a walk failing partway leaving what it had already written.
  - **Boundary**: no deletion primitive may appear in this module — a partial copy is reported, never unwound (D9), and the I10 gate scans this path

- [x] 1_4 Link to the main checkout, or say the platform would not let you — verified: pnpm exec vitest run 'src/worktree/provisioning/applyEntries.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_3
  - **Refs**: design.md D7; specs/worktree-panel/spec.md#a-link-the-platform-cannot-make-becomes-a-copy-that-says-so
  - **Acceptance**:
    - Outcome: A link the platform refuses arrives as a copy that says so
    - Verify: unit src/worktree/provisioning/applyEntries.test.ts
  - **Plan**:
    1. `src/worktree/provisioning/applyEntries.ts`: a link entry becomes a relative symlink from the worktree to the main checkout. It is one node, not a walk: D6's destination-side containment governs links found INSIDE a copied tree and would refuse every link entry, whose whole purpose is to leave the worktree.
    2. `src/worktree/provisioning/applyEntries.ts`: `EPERM`/`ENOSYS`/`UNKNOWN` from `symlink` falls back to the copy path from 1_3 and reports `degradedToCopy`; every other error reports `failed`.
    3. `src/worktree/provisioning/applyEntries.test.ts`: the symlink is relative and points at the main checkout; a platform refusing symlinks yields copied content and a `degradedToCopy` step; an unrelated symlink error yields `failed` and is not silently degraded.
  - **Boundary**: degradation is per entry and reported — no code path may report `linked` for an entry it copied

- [x] 1_5 Provision the worktree the create just made, without ever costing it — verified: pnpm exec vitest run 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_4
  - **Refs**: design.md D1, D2, D3; specs/worktree-panel/spec.md#{the-material-a-worktree-was-promised-is-actually-put-there, provisioning-never-costs-the-user-the-worktree}
  - **Acceptance**:
    - Outcome: A create materializes the selected entries and reports one step each
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `src/providers/WorktreeHost.ts`: resolve `provision` against the surface-scoped offer store, filter the stored model's entries to the selected ids, and pass resolved entries on the create request. An offer the store no longer holds refuses the create with a stated reason (D3); an absent `provision` provisions nothing.
    2. `src/worktree/provisioning/applyEntries.ts`: the production `node:fs/promises` binding for `ApplyFsDeps` — the no-follow open pair lives here, beside the walk that depends on it, rather than in wiring where the flags could drift.
    3. `src/worktree/worktreeMutationService.ts`: call apply between `addToGitExclude` and `afterCreate`, inside its OWN `.catch()` modelled on `afterCreate`'s at `:905-910`, so no rejection can reach the create body's outer arm at `:920-925` and report a successful git create as an error.
    4. `src/providers/WorktreeHost.ts` and `src/extension.ts`: post `worktreeProvisionResult` to the originating surface after the create's own result, through the host's existing mutation-report path rather than a second surface lookup — it already owns attachment, and posting straight at the providers is what missed every editor surface.
    5. `src/providers/WorktreeHost.actions.test.ts` and `src/worktree/worktreeMutationService.test.ts`: an apply that REJECTS still yields `ok` with a `failed` step — a fake returning a failed result does not exercise the outer arm and is not the witness for this; selected entries only; copy ordered before link; apply runs before `afterCreate`; a stale offer id creates nothing; a create with no `provision` field still succeeds and provisions nothing.
  - **Boundary**: the service receives entry values, never ids and never a store handle — it must not become able to resolve an offer

- [x] 2_1 Bound the walk per operation, and make the production binding the one under test — verified: pnpm exec vitest run 'src/worktree/provisioning/applyEntries.node.test.ts' && pnpm run check-types && pnpm run test:unit && pnpm run gate:fs-deletion exit 0
  - **Deps**: 1_5
  - **Refs**: design.md D5, D6, D10; .reviews/round-1.md F003, F002, F004, F008, F012, F013
  - **Acceptance**:
    - Outcome: A committed symlink cannot land a link resolving outside the new worktree, and no single operation runs unbounded
    - Verify: unit src/worktree/provisioning/applyEntries.node.test.ts
  - **Plan**:
    1. `src/worktree/provisioning/applyEntries.ts`: bind `realpath` on `nodeApplyFsDeps`, and change the local helper's fallback from the spelled path to `fs.realpath` — the fallback `resolvedPathBoundary.ts:63,99` already uses. Either alone leaves an omitted dep degrading to lexical resolution (F003).
    2. `src/worktree/provisioning/applyEntries.node.test.ts`: a NEW suite exercising `nodeApplyFsDeps` itself against a real temp tree. The existing suite cannot witness F003 by construction — its fake supplies the dep production omits. Includes the chair's reproduction: an in-repo symlink chain whose lexical dirname is inside both roots and whose real dirname is outside.
    3. `src/worktree/deadline.ts`, `src/worktree/deadline.test.ts`, `src/worktree/orphanProofs.test.ts`, `src/worktree/sessionPreviewService.test.ts`: a synchronously readable `expired` on `Deadline`, and the field added to the two suites that build a `Deadline` by hand. A deadline observable only through a promise is the defect's root — the walk's `.then` watcher cannot have run before the first node. `afterDelay` is its only implementor.
    4. `src/worktree/provisioning/applyEntries.ts`: charge the budget per OPERATION, not per node — the source size known from D5's `fstat` is spent before the copy, `readdir` is charged for the listing it materializes, and the deadline is read synchronously so an already-expired budget stops node 1 rather than after it (F002).
    5. `src/worktree/provisioning/entryGate.ts`: refuse any `\` in `entry.path`. `path.posix.basename` does not split it but `path.resolve` does on Windows, so the lockfile and `node_modules` refusals are bypassable by spelling (F004).
    6. `src/worktree/provisioning/applyEntries.ts`: cap `details` with an explicit truncation row (F008); create missing destination parents recursively, each component no-follow and containment-checked exactly as the descent is (F012); build the display path with one separator convention (F013).
    7. `src/worktree/provisioning/applyEntries.test.ts`, `src/worktree/provisioning/entryGate.test.ts`: one invariant-level falsifier per boundary — a single oversized file, an oversized listing, an already-expired deadline, a backslash spelling of each refused basename, a truncated `details`, a missing destination parent.
  - **Boundary**: no deletion primitive may appear in this module — the D9 report-don't-unwind rule and the I10 gate both still hold

- [x] 2_2 Say what happened, on every arm that can happen — verified: pnpm exec vitest run 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && pnpm run test:unit && pnpm run gate:fs-deletion exit 0
  - **Deps**: 2_1
  - **Refs**: design.md D3, D8, D10; .reviews/round-1.md F001, F006, F007, F009, F010, F011, F015
  - **Acceptance**:
    - Outcome: A refusal states its reason on the wire
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `src/providers/WorktreeHost.ts`: a stale `offerId` refuses on the existing `worktreeMutationResult` error arm with a stated reason, which is what D3 already says and the code does not do (F001). The test asserts the posted message, not only the absent create.
    2. `src/providers/WorktreeHost.ts`: an `isKnownProvision` runtime guard beside its three neighbours — the dispatch at `TerminalViewProvider.ts:1024-1031` returns before the `try`, so a malformed `provision` escapes into VS Code's callback rather than failing closed (F006).
    3. `src/extension.ts`: ONE budget for the whole apply, created once and threaded through the loop — a fresh `afterDelay` per entry multiplies D10's bound by the entry count (F007).
    4. `src/worktree/worktreeMutationService.ts`: a selection with no `applyProvision` binding reports a step per entry instead of dropping them silently into an outcome identical to "selected nothing" (F009); remove the duplicated `provision` spread (F010); normalize `worktreeId` through the helper the tree keys on (F015).
    5. `src/worktree/errorMessage.ts` (new), `src/worktree/provisioning/applyEntries.ts`, `src/worktree/clearDebris.ts`, `src/worktree/worktreeMutationService.ts`: one shared `messageOf` — the third copy has already drifted to `"unknown error"` where the other two answer `String(error)`, in a string the user reads (F011).
    6. `src/providers/WorktreeHost.actions.test.ts`, `src/worktree/worktreeMutationService.test.ts`: the stale offer's POSTED message, not only its absent create; a malformed `provision` refused without throwing; a selection with no binding reporting a step per entry; the id normalized.
  - **Boundary**: no new error arm — every refusal added here rides the `worktreeMutationResult` shape that already exists

- [x] 2_3 Land the two halves that make the flow reach a user — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeCreateDialog.test.ts' && pnpm run check-types && pnpm run test:unit && pnpm run gate:fs-deletion exit 0
  - **Deps**: 2_2
  - **Refs**: specs/worktree-panel/spec.md#the-material-a-worktree-was-promised-is-actually-put-there; .reviews/round-1.md F005
  - **Acceptance**:
    - Outcome: The rows the user ticked reach the host, and what provisioning did reaches the panel
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeCreateDialog.ts`: surface the selection the dialog ALREADY holds — `checkedByOffer` at `:828`, re-ticked across offers at `:870-880` — onto the draft as `{ offerId, itemIds }`. Nothing new is tracked; the last hop is what is missing.
    2. `src/webview/worktree/WorktreeController.ts`: spread `provision` into the `worktreeCreate` post. Absent when the offer is absent or nothing is ticked, so a form with no provisioning posts exactly what it posts today.
    3. `src/webview/messaging/MessageRouter.ts`: a case for `worktreeProvisionResult` — its default silently ignores unknown types, which is why a declared, posted, handled type reached nobody (the `TerminalViewProvider.ts:1021` precedent).
    4. `src/webview/worktree/worktreeMessageHandlers.ts`: the delegated route, in the table production and the assembly test share — a second copy of this table is what shipped a route dark once already.
    5. `src/webview/worktree/worktreeViewTypes.ts`, `src/webview/worktree/WorktreeController.ts`, `src/webview/worktree/WorktreeView.ts`: carry the steps on the create's own `WorktreeActionResult` and render them in the notice that already reports the create. A second notice would compete with the first for the same row.
    6. Tests in `src/webview/worktree/WorktreeCreateDialog.test.ts`, `src/webview/worktree/WorktreeController.test.ts`, `src/webview/messaging/MessageRouter.test.ts`, `src/webview/worktree/WorktreeView.test.ts`: a ticked row reaches the post; an unticked one does not; a form with no offer posts no `provision`; a result message routes rather than falling into the default; a refused entry is named in the notice.
  - **Boundary**: no new wire type — task 1_1 already defined both directions; this task only connects them

- [x] 3_1 Classify on what will be written, and make one budget mean one budget — verified: pnpm exec vitest run 'src/worktree/provisioning/entryGate.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_3
  - **Refs**: design.md D5, D8, D10; .reviews/round-2.md F004, F002, F007, F016, F019, F020, F021, F022, F024
  - **Acceptance**:
    - Outcome: No spelling of a refused name is admitted
    - Verify: unit src/worktree/provisioning/entryGate.test.ts
  - **Plan**:
    1. `src/worktree/provisioning/entryGate.ts`: classify the material rules on the RESOLVED destination's basename — the string `path.resolve` produced and the walk will write — with the lockfile set case-folded. Round 1 fixed the spelling the finding quoted and left the instrument that made it work, so a trailing-dot spelling and an upper-case one reopened it (F004).
    2. `src/worktree/provisioning/applyEntries.ts`: move `nodes` and `bytes` onto the budget so all three bounds have one lifetime — only the deadline was ever apply-wide (F007); charge each child once by checking the listing against the budget rather than reserving it (F016); refund a precharge the destination skipped (F020) and reconcile against the bytes actually written (F021); stop cancelling a deadline the caller owns, which after F007 is reused by every later entry (F024).
    3. `src/worktree/provisioning/applyEntries.ts`: pass an `AbortSignal` driven by the deadline into `pipeline`, so a copy already running is stopped rather than only the next one refused (F002, in-flight half). The listing half stays open and is a workflow Note, not a ledger row: `readdir` materializes before anything can charge it, and `opendir` would change `ApplyFsDeps` for every caller.
    4. `src/worktree/provisioning/applyEntries.ts`: `realpath` required on `ApplyFsDeps` — optional is the shape that produced F003 (F022); `ensureParents` refuses rather than silently no-oping when the resolved root and the spelled destination disagree (F019).
    5. `src/worktree/provisioning/entryGate.test.ts`, `src/worktree/provisioning/applyEntries.test.ts`, `src/worktree/provisioning/applyEntries.node.test.ts`, `src/worktree/provisioning/applyEntries.fake.ts`: acceptance per SPELLING rather than per rule — every variant the chair ran against both material rules; the node budget at its exact boundary; a refunded skip; an aborted in-flight copy.
  - **Boundary**: no deletion primitive may appear in this module — D9 and the I10 gate both still hold

- [x] 3_2 Give the create notice the id its own result carries — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeController.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_1
  - **Refs**: design.md D1; .reviews/round-2.md F017, F018, F023
  - **Acceptance**:
    - Outcome: One create produces one notice, carrying what provisioning did
    - Verify: unit src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. `src/worktree/worktreeMutationService.ts`: the create outcome carries the normalized `worktreeId` it already computes. Without it the merge key never matches and every real create synthesizes a second notice with a fabricated `outcome: "ok"` (F017).
    2. `src/worktree/worktreeMutationService.ts`: compute `provisionedAt` inside the selection guard and under its own `.catch()`. It was the one unguarded await in the body D1 exists to protect, and it ran on reattaches too (F023).
    3. `src/webview/worktree/WorktreeController.ts`: merge on the identity the create notice ARRIVED under, not the one it was left holding — `rescope` drops a `worktreeId` the tree has not seen yet, and a worktree created seconds ago is exactly that, so the id-only key missed on every real create even once the service supplied it (F017, second half, found by the assembly witness).
    4. `src/webview/worktree/WorktreeView.ts`: render the `details` rows the host bounds and sends — a directory reporting `copied` currently hides every skipped descendant, which is what D8 minted the field for (F018).
    5. `src/worktree/worktreeMutationService.test.ts`, `src/webview/worktree/WorktreeController.test.ts`, `src/webview/worktree/WorktreeView.test.ts`, `src/extension.worktreeAssembly.test.ts`: the merge witness rebuilt from what the service actually emits rather than from a literal — the round-2 finding names my own fixture as the reason the defect survived. The end-to-end half runs in the assembly lane, where the id is produced rather than written down; round 2 recorded that the webview side of this change had no such witness at all.
  - **Boundary**: no new notice — provisioning reports on the create's own result, never beside it
