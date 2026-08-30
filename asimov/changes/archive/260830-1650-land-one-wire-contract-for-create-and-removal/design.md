# Design: land-one-wire-contract-for-create-and-removal

The contract itself is owned by [worktree-rpc.md](../../../docs/design/worktree-rpc.md) §§ 2.3–2.6
and § 4. This file decides only how it lands on a tree that already has a working create and
removal path.

## Decisions

### D1: The unions travel unflattened from the webview to the mutation service

`WorktreeCreateMode`, `DestinationDisposition` and `WorktreeAfterCreate` are the parameter shapes of
`WorktreeHost`'s `createWorktree` capability and of the mutation service's create request, not just
of the message.

A boundary that accepts `{ kind: "reuse", branch }` and hands on `{ branch, baseRef: undefined }`
has deleted the property the union exists for, at the one place nobody looks. The type is the
enforcement *within our own code* — a validator that re-checks "reuse must not carry a base ref"
three layers down is exactly the forgettable check rpc § 2.3 replaces.

**It is not a substitute for validating the inbound message.** The type erases where the webview's
message crosses into the host, so `WorktreeHost` keeps a runtime check that the discriminant is one
of the five and that the variant carries the fields it declares — rpc § 4 asks for exactly that, on
every inbound message. What the union removes is the *inference* (`sourceOf` guessing a mode from
which optional fields are set), not the boundary check.

Consequence: three signatures change together in one task, and the flat `branch?` / `baseRef?` /
`detach?` / `openAfter` / `launch?` fields disappear rather than being kept as an overload.

### D2: The dialog already makes the choice; the wire is what loses it

`WorktreeCreateDialog` has offered three branch modes since before this change, and
`WorktreeController` already branches on all three. Only the message is impoverished:

| `draft.branchMode` today | What the wire carries today | Mode it becomes |
|---|---|---|
| `new` | `{ branch, baseRef? }` | `{ kind: "fresh", branch, baseRef? }` |
| `existing` | `{ branch }` | `{ kind: "reuse", branch }` |
| `detached` | `{ detach: true, baseRef? }` | `{ kind: "fresh-detached", baseRef }` |

`new` and `existing` are **indistinguishable on the wire**, so
`worktreeMutationService.ts` `sourceOf` guesses: it picks `newBranch` only when `baseRef` is also
present, and otherwise falls through to `existingBranch`. A new-branch create with the base ref left
blank — the ordinary case — therefore runs `git worktree add <path> <branch>` against a branch that
does not exist, and git answers `fatal: invalid reference`. The round-3 B11 fix stopped the empty
string at the controller and never reached this derivation.

The union removes the guess rather than repairing it: `sourceOf` becomes a total map from
`WorktreeCreateMode` to `CreateSource` with no inference left to get wrong. That makes the repair a
consequence of the contract, not a separate decision — there is no version of this union that keeps
the defect — and it is why this change carries a `worktree-panel` delta instead of NO-DELTA.

`reuse` therefore **has** a producer here. `reattach` and `adopt` do not: WT-012.15 builds those,
and WT-012.8 still owns everything `reuse` needs around it — detecting that a branch already exists,
refusing one checked out elsewhere, and offering recovery.

The detached case is the one mapping that is not mechanical. Today the dialog puts the ref the user
typed in `baseRef` and *also* reads it as the branch name for the path slug
(`WorktreeCreateDialog.ts` — `detached ? draft.baseRef : draft.branchName`). `fresh-detached` has
one field and no `branch`, so the slug derivation reads the mode rather than the draft.

`fresh-detached` declares `baseRef` **required** while the controller sends it optionally. The
controller supplies `"HEAD"` where the field is blank, which is what `sourceOf` already substitutes
today — the default moves to the producer, where the type can insist on it.

### D3: Path validation takes the intent, not the mode

`validateCreatePath` gains one parameter describing what the destination must be, derived from the
mode and disposition by the caller:

```ts
export type CreatePathIntent =
  | { kind: "mustBeFreeOrEmpty" }
  /** reattach / adopt: the surviving directory. Must exist; emptiness is not required. */
  | { kind: "mustBeExistingDirectory" }
  /** disposition `debris`: must exist, must hold non-git debris, fingerprint must match. */
  | { kind: "mustMatchDebrisAuthorization"; authorization: DebrisAuthorization };
```

The intent, not the mode, because `validateCreatePath` lives in `src/worktree/` and has no business
knowing that `adopt` and `reattach` are different git operations — they impose the same requirement
on the path. Mapping mode+disposition → intent is one function, tested directly, and it is the only
place the mapping exists.

Only `mustBeFreeOrEmpty` has a producer in this change; the other two are reachable from the mapping
function and tested through it. The existing `mustBeEmpty` / `recheckPath` / `recheckIdentity`
re-check contract is unchanged — the intent decides what the first check demands, not how the
second one re-verifies it.

### D4: The removal report is projected from the assessment the host already computes

`evaluateRemoval` already returns `RemovalRefusal | ConfirmableRemoval | UnavailableRemoval`
(`src/worktree/worktreeBlockers.ts`), which is strictly richer than the boolean record the wire
carries. A new pure function projects it to `readonly RemovalCheck[]`:

| Source | Check id | Class | Outcome |
|---|---|---|---|
| `refused.isMain` | `isMain` | `refusal` | `failed` when true, `passed` when false |
| `refused.busyAgents` | `busyAgents` | `refusal` | `failed` when > 0 |
| `refused.containsWorktrees` | `containsWorktrees` | `refusal` | `failed` when non-empty |
| `evidence.dirtyPaths` | `dirty` | `confirmable` | `failed` when non-empty |
| `evidence.untrackedPaths` | `untracked` | `confirmable` | `failed` when non-empty |
| `evidence.paneIds` | `idlePanes` | `confirmable` | `failed` when non-empty |
| `evidence.externalSessionIds` | `externalAgents` | `confirmable` | `failed` when non-empty |
| `evidence.locked` | `locked` | `confirmable` | `failed` when true |
| `unavailable.unreadable` names the source | the checks that source feeds | their own class | `unproven` |

No check is invented. `notApplicable` is on the wire (rpc § 2.5) and this change produces it from
nothing — the sources that can answer "the question does not arise" are the ones WT-013.1 adds. The
projection is total over today's three assessment kinds and nothing else.

`RemovalCheckClass` is carried per check rather than re-derived in the webview, because the
webview's decision to offer a confirmation depends on it and a second copy of that mapping is a
second place for the safety rule to be wrong.

### D5: The panel renders from checks and shows the same lines it shows today

`isRemoveRefused` and `buildBlockerList` read `readonly RemovalCheck[]` instead of the boolean
record. What the user sees does not change in this task: a `passed` check renders nothing, an
`unproven` check renders where its `failed` form rendered, and the counts come from `detail`.

This is the change's one visible risk, so it is verified against rendered output — the existing
`WorktreeRemoveDialog.test.ts` cases keep their assertions and get the new input shape, rather than
being rewritten to assert on checks.

`WorktreeRemoveBlockerPayload` is deleted in the same task. Keeping it beside the check model, even
briefly, is what D4's rationale forbids.

### D6: The offer types land without a producer, verified structurally

`ProvisionSelection`, the item id, `BranchDeleteOffer` and `BranchDeleteRequest` have no producer
until WT-012.1 and WT-013.3. Their acceptance is therefore a compile-time one: a file of
`@ts-expect-error` assertions proving the shapes that must be unrepresentable do not compile —
a selection carrying a command or a path, a `fresh-detached` carrying a branch, a `reuse` carrying
a base ref, a non-agent after-create carrying an agent id.

The idiom is already in the tree (`src/shared/imagePasteTrigger.test.ts`,
`src/vault/readers/detail.test.ts`) and is checked by `pnpm run check-types`, which is what makes
the assertion real: `@ts-expect-error` on a line that *does* compile is itself a type error.

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| `WorktreeRemoveDialog` | A projection defect silently changes the rendered blocker list on the one action that cannot be undone | D5 — the existing render assertions are kept verbatim and re-pointed at the new input; the task fails if any rendered string moves |
| `worktreeMutationService` create path | Flattening the mode at the service boundary to avoid touching `worktreeMutations` re-introduces the forgettable validator | D1 — the union is the parameter type. `worktreeMutations`' own `CreateSource` union stays: it is git's vocabulary, and `reattach`/`adopt` are not `git worktree add` at all. `sourceOf` becomes a total map between the two, with no field-presence inference |
| New-branch create | The repair D2 describes is landed but never demonstrated, so a later refactor can silently restore the guess | Task 1_2's Verify exercises the empty-base-ref case end to end; the `worktree-panel` delta makes it a requirement rather than an incidental fix |
| `validateCreatePath` | A mode-dependent existence rule weakens the `fresh` case by accident, allowing a create into a non-empty directory | D3 — `mustBeFreeOrEmpty` keeps today's behaviour exactly; the existing `createPath.test.ts` cases are unchanged and must still pass |
| Path handling | A hand-rolled containment check enters `src/` alongside the new intent | Task 1_3's Boundary — `src/utils/pathBoundary.ts` stays the only definition, and the Boundary names the grep that proves it |
| Offer / branch-delete types | Types nobody produces rot before their consumer arrives | D6 — compile-time assertions run on every `check-types`, so a shape that drifts fails the build rather than waiting for WT-012.1 |
| `WORKTREE_MESSAGE_TYPES` | A new message type declared but not routed, the defect the list exists for | No new message *type* is added — the shapes change on existing types; the existing exhaustiveness check still guards the list |

## Failure surface

| Resource | Answer |
|---|---|
| Worktree destination directory | Unchanged by this change. `validateCreatePath`'s two-observation contract (validate, then re-check identity immediately before spawn) is preserved verbatim by D3; the intent decides what the first observation demands, not how the second re-verifies |
| Removal fingerprint | Unchanged, deliberately. `createFingerprintStore` issues and redeems over `RemovalEvidence` — a host-side value D4 does not touch, because the projection reads the assessment and does not replace it. Re-pointing it at the check list would change *when a removal re-prompts*, which is rpc § 3.1's "any change to the assessment re-prompts" rule and belongs to WT-013.1 with the outcomes that make it necessary. Touching it here would ship a behaviour change inside a contract task |
| Provisioning offer store | n/a — no offer is issued in this change (proposal § Out of scope). The host-held store is WT-012.1's; its concurrency and expiry answers belong there |
| Spawned git process | n/a — no change to process lifecycle; the mutation coordinator and queue are untouched |
