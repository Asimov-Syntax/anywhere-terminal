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

- [x] 2_1 The probe and its resolution travel with the opening that asked — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeController.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: design.md D1; specs/worktree-panel/spec.md#a-resolution-belonging-to-a-previous-opening-of-the-dialog-is-discarded
  - **Acceptance**:
    - Outcome: A resolution answering a previous opening is dropped rather than applied
    - Verify: unit src/webview/worktree/WorktreeController.test.ts
  - **Plan**:
    1. `src/types/messages.ts` gains the pair named in design.md § Interfaces, and `worktreeCreateProbe` joins `WORKTREE_MESSAGE_TYPES`. `ResolvedDisposition` moves there from `src/worktree/createResolution.ts`, which imports it back — it is a wire type now, and leaving its definition below the wire would make messages.ts import upward from the module that consumes it.
    2. `src/providers/WorktreeHost.ts` answers it from 1_1 and 1_2 over the listing it already holds, echoing `token` and `query` unchanged. 1_2's corroboration reaches it as an injected `probeReattach` option, assembled in `src/extension.ts` beside `readRefs` — the host holds a listing, not a ref database or a filesystem. Reading a `.git` entry into 1_2's `GitLink` is real parsing with real edge cases, so it lands in `src/worktree/reattachProbe.ts` beside the type it produces, over injected filesystem primitives, and is covered in `src/worktree/reattachProbe.test.ts`. The host's own answer is covered in `src/providers/WorktreeHost.actions.test.ts`, beside the refs pair it mirrors.
    3. `src/webview/worktree/WorktreeController.ts` sends the probe per settled selection and drops an answer whose token is not the current opening's — the same guard the refs pair carries, reusing the existing counter rather than minting a second one.
    4. `src/providers/TerminalViewProvider.worktree.test.ts` holds the routing-completeness fixture keyed on `WORKTREE_MESSAGE_TYPES`; a new inbound type is a compile error there until it has a sample.
    5. The inbound half is only half the wire: `src/webview/messaging/MessageRouter.ts` and `src/webview/main.ts` route the ANSWER, and `src/webview/messaging/MessageRouter.test.ts` covers it. Declared-posted-handled but unrouted is how `requestWorktreeSubagents` shipped inert with every unit test green.
  - **Boundary**: `worktreeCreateDefaults` and the provisioning offer gain nothing — their lifecycle is a separate question (proposal § Non-goals)

- [x] 2_2 The form states the mode and refuses the base ref that cannot apply — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeCreateDialog.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: design.md D5; specs/worktree-panel/spec.md#the-base-ref-is-refused-where-the-mode-cannot-apply-it
  - **Acceptance**:
    - Outcome: Resolving to reuse disables the base ref with a stated reason
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeCreateDialog.ts` derives the base control's enabled state from `draft.branchMode` alone — the same single-source rule the combobox already applies to new-versus-existing (D5). Disabled, not hidden.
    2. The resolution's mode feeds `draft.branchMode`, and the form states what the create will do. A stale answer — `query` no longer matching what is typed — is ignored, which is what `query` echoes for. `WorktreeBranchMode` in `src/webview/worktree/worktreeViewTypes.ts` gains `reattach`, and `src/webview/worktree/WorktreeController.ts` builds the wire `reattach` mode from the resolution it already holds — 3_1 executes a repair and 2_1 offers one, and without this seam nothing in the form could ever reach either. Covered in `src/webview/worktree/WorktreeController.test.ts`.
    3. A `debris` disposition does NOT disable the base: clearing the ground does not change where a new branch starts (§ 2.1).
    4. Cover in `src/webview/worktree/WorktreeCreateDialog.test.ts`: base disabled with a reason for reuse and for reattach; enabled for fresh; enabled for fresh WITH an occupied destination; a resolution for a query the user has typed past changes nothing.
  - **Boundary**: `docs/ui/create-worktree.html` and `docs/ui/worktree-create-dialog.css` are owned by an external design pass and are NOT edited

- [x] 3_1 Reattach repairs, and re-checks what the user's pause could have changed — verified: pnpm exec vitest run 'src/worktree/worktreeMutationService.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: design.md D3, D6; specs/worktree-panel/spec.md#a-stale-registration-is-repaired-in-place-and-only-while-git-can-repair-it
  - **Acceptance**:
    - Outcome: A repair whose recorded commit no longer matches the directory is refused rather than applied
    - Verify: unit src/worktree/worktreeMutationService.test.ts
  - **Plan**:
    1. `src/worktree/worktreeMutationService.ts` branches on `reattach` BEFORE `sourceOf`, which keeps its throw — reattach is not a `git worktree add` and has no `CreateSource` (D6). `adopt` keeps its throw too; WT-012.15 owns it.
    2. The argv vectors land in `src/worktree/worktreeMutations.ts` beside the other verbs: `git worktree repair <path>`, the directory's own `HEAD`, and the re-read listing that answers § 2.3 condition 4. A repair that did not take is reported, never claimed. Covered in `src/worktree/worktreeMutations.test.ts`.
    3. `expectedOid` is re-checked against the directory immediately before the command. The resolution is a read that authorizes a mutation and the user's decision sits between them, so the guard is at the mutation, not carried from the read (D3).
    4. Cover in `src/worktree/worktreeMutationService.test.ts`: a repair issues `worktree repair` and never `worktree add`; a moved `expectedOid` refuses and issues nothing; a listing still reporting `prunable` afterwards is reported as a failed repair; the working tree is never written.
  - **Boundary**: no `--force` and no fallback to `add` — where the repair cannot be made, it is refused (§ 6)

- [x] 4_1 The resolution survives the production boundary — verified: pnpm exec vitest run 'src/extension.worktreeAssembly.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_2, 3_1
  - **Refs**: design.md D1, D2, D6
  - **Acceptance**:
    - Outcome: The assembled extension answers a probe and repairs a prunable worktree it really has
    - Verify: unit src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. Cover in `src/extension.worktreeAssembly.test.ts` that a probe reaches the host through the real wiring and its answer reaches the dialog — a module test asserting against its own injected fake cannot see a wrapper that drops an argument, which is how the refs answer nearly shipped unrouted.
    2. Assert against the assembly's own real repository that a `prunable` worktree resolves to reattach and that the repair clears the flag.
  - **Boundary**: no new production code — this task adds coverage, and a defect it finds is fixed in the task that owns the file

- [x] 5_1 A repair re-establishes every condition it was offered under — verified: pnpm exec vitest run 'src/worktree/worktreeMutationService.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D3, D6; specs/worktree-panel/spec.md#a-stale-registration-is-repaired-in-place-and-only-while-git-can-repair-it
  - **Acceptance**:
    - Outcome: A repair whose administrative directory vanished during the user's pause is refused, not reported as done
    - Verify: unit src/worktree/worktreeMutationService.test.ts
  - **Plan**:
    1. `src/worktree/worktreeMutationService.ts` re-establishes D3 condition 2 inside the coordinator, beside the condition-3 check already there: re-read the `.git` link and require its administrative directory, and require the authoritative listing to still carry a prunable record for the normalized path ON `mode.branch`. Today only condition 3 survives the pause, and `mode.branch` is never consulted.
    2. The vacuous-success hole is why this blocks: with the administrative entry pruned, `git worktree repair` has nothing to reconnect and exits 0, and the condition-4 check asks only whether the path is STILL prunable — an unregistered path is not, so a repair that did nothing reports success. Requiring the prunable record BEFORE the command is what makes condition 4 mean what it says.
    3. `src/worktree/reattachProbe.ts`: `readGitLink` treats every non-directory `lstat` as a file, so a symlinked `.git` satisfies the FILE check and `readFile` follows it. Require a true regular file.
    4. `src/worktree/worktreeMutations.ts`: `prunablePaths` parses the line format while `WorktreeDiscovery` negotiates `-z` through the `worktree-list-z` capability probe. The listing that OFFERS a reattach and the one that CONFIRMS it can disagree about the same path — the exact comparison condition 4 rests on. Reuse the authoritative reader.
    5. Cover: an admin directory removed between resolution and submit refuses; a branch that moved while the checkout stayed put refuses; a symlinked `.git` is not offered; the post-repair listing uses the same reader the offer did.
    6. The reader and the corroboration reach the mutation as injected deps, so the assembly in `src/extension.ts` supplies the SAME `probeReattach` it already gives the host and the same `listRepoWorktrees` the tree uses — offer and mutation cannot then diverge on what they checked. Construction sites `src/extension.ts` and `src/extension.worktreeMutations.test.ts` take the new deps; the symlink case is covered in `src/worktree/reattachProbe.test.ts`, and `src/worktree/worktreeMutations.test.ts` loses the `prunablePaths` block along with the function it covered.
  - **Boundary**: still no `--force` and no fallback to `add`

- [x] 5_2 The host answers one probe per settled selection, for one owner — verified: pnpm exec vitest run 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D1, D2, D7
  - **Acceptance**:
    - Outcome: A base ref that resolves to no commit is reported unresolvable in the resolution, before any create is attempted
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `src/types/messages.ts` takes D1's amended pair: `seq` on both messages, `base` on the probe, `baseValid` on the resolution.
    2. `src/providers/WorktreeHost.ts` resolves the base against the refs it already holds and answers `baseValid`, omitted for `reuse` and `reattach` per D7.
    3. Retention is keyed by surface, repository and opening rather than repository alone, evicted on supersession and detach — today a second surface's `requestWorktreeRefs` replaces the promise the first surface's probe consumes. Keep only the latest pending probe per key.
    4. Validate the inbound payload's fields, not just its discriminant, before they enter async logic.
    5. Extract the one destination resolver both the probe and the defaults handler use — they derive root, taken paths, slug and free suffix separately today, so `freePath` and the submitted destination can drift.
    6. `src/extension.ts` wires the base resolution beside the existing `probeReattach` assembly.
    7. Cover: an unresolvable base answers `ok: false`; `baseValid` is absent for reuse and reattach; two surfaces on one repository each classify against their own enumeration; a malformed probe is refused rather than throwing.
    8. Adding a required field to the pair breaks every existing sender and consumer, so the mechanical plumbing lands here rather than leaving the tree uncompilable between tasks: `src/webview/worktree/WorktreeController.ts` mints the monotonic `seq` it sends, and `src/webview/messaging/MessageRouter.test.ts`, `src/webview/worktree/WorktreeController.test.ts` and `src/extension.worktreeAssembly.test.ts` and `src/webview/worktree/WorktreeCreateDialog.test.ts` carry it on their fixtures. Applying it — dropping an answer below the highest applied — is 5_3's.
  - **Boundary**: no change to `worktreeCreateDefaults`' own lifecycle — D1's scope note still holds

- [x] 5_3 One effective resolution drives the form, and submit waits for it — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeCreateDialog.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 5_2
  - **Refs**: design.md D5, D7, D8; specs/worktree-panel/spec.md#the-resolution-names-both-the-path-the-create-will-take-and-the-one-it-skipped
  - **Acceptance**:
    - Outcome: Create stays disabled until the resolution for the typed selection has arrived
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. `src/webview/worktree/WorktreeCreateDialog.ts` holds ONE effective resolution per D8, driving mode, displayed destination, stated action and guards. Today the applier changes `branchMode` only for `reattach` and drops `fresh`, `reuse` and `adopt`, so a declined corroboration leaves the mode the local text derivation guessed.
    2. Render what the spec already requires the resolution to name: the free path the create will take, and the occupied candidate the suffixing skipped with what was found there. Both arrive on the wire today and neither reaches the user.
    3. Submit gates on a matching resolution as well as the destination per D7. The current comment declines this deliberately, which is what lets a selection be submitted as fresh while its own classification is in flight.
    4. `src/webview/worktree/WorktreeController.ts` mints `seq` per probe, applies an answer only at or above the highest `seq` applied, and sends the current `candidatePath` and `base`.
    5. The base-ref reason moves out of the collapsed Advanced body into an always-visible accessible summary — the rule D5 exists to make legible is undiscoverable behind a disclosure.
    6. Covered in `src/webview/worktree/WorktreeCreateDialog.test.ts` and, for the seq gate, `src/webview/worktree/WorktreeController.test.ts`: an A to B to A edit sequence never applies the older answer; a declined repair returns the form to fresh rather than leaving reattach armed; the rendered destination is the path the submitted request carries; create is disabled while a classification is outstanding.
  - **Boundary**: `docs/ui/create-worktree.html` and `docs/ui/worktree-create-dialog.css` are owned by an external design pass and are NOT edited

- [ ] 5_4 The assembly walks a typed selection to the argv it issues
  - **Deps**: 5_1, 5_3
  - **Refs**: design.md D1, D7, D8
  - **Acceptance**:
    - Outcome: The assembled extension carries one typed selection from probe to issued git argv through the real dialog
    - Verify: unit src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. In `src/extension.worktreeAssembly.test.ts` the current repair test handcrafts a `worktreeCreate` and calls `host.handleMessage` directly, so the resolution-to-submit seam is never crossed and three blockers survived a green gate.
    2. Drive one assembled dialog from typed selection through the real matching resolution and the real submit, then assert the visible action, the displayed path, the posted create payload and the issued git argv all agree. Add a delayed answer and a declined corroboration.
  - **Boundary**: no new production code — a defect this finds is fixed in the task that owns the file
