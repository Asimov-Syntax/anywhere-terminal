# Design: move-uncommitted-work-with-the-intent

Blueprint: docs/PLAN.md task WT-012.10. Design ref: docs/design/worktree-create.md § 6.

## Context

Offer to move the current worktree's uncommitted changes into the newly created one, between git
success and provisioning, so a setup command sees the moved work. The wire contract already
reserves the field (`docs/design/worktree-rpc.md` § `worktreeCreate` → `migrateChanges?: boolean`);
it exists in neither `src/types/` nor `src/webview/` yet.

The PLAN row calls this "a call and a conditional row, not a reimplementation". That is right, and
the whole design problem is in what the call does NOT tell us.

## What the Git extension actually provides — read, not assumed

`@types/vscode` does not cover the Git extension, and `src/providers/git.ts` vendors only the
members this repo already consumes. So the contract below was read out of the shipped bundle,
`/Applications/Visual Studio Code.app/Contents/Resources/app/extensions/git/dist/main.js`
(VS Code 1.130.0), not inferred from the doc:

- It is on the public API wrapper, delegating to the model, beside `createWorktree`/`deleteWorktree`.
- It is called **on the DESTINATION repository, with the SOURCE root path**. The extension's own
  command does `destination.migrateChanges(source.root,
  { confirmation: true, deleteFromSource: true, untracked: true })`.
- Its own modal calls the operation IRREVERSIBLE.

### D1 — The call shape

`{ confirmation: false, deleteFromSource: true, untracked: true }`.

- `confirmation: false` — the dialog's row IS the consent. A second modal for a choice made two
  seconds ago is the double-prompt the row exists to replace. This moves an obligation onto the row
  (D5): the extension's modal is where the user would have met the word IRREVERSIBLE, so the row has
  to carry that weight itself instead of reading like a convenience toggle.
- `deleteFromSource: true` — the task is *move*. With it the destination pops the stash; without it
  the destination applies and the source pops, i.e. a copy. The PLAN row says moves.
- `untracked: true` — it is passed straight to `createStash(name, includeUntracked)`. Without it a
  new-but-unstaged file stays behind, which is a silent partial move: the worst outcome available.

### D2 — What the call can and cannot tell us

`migrateChanges` returns `void` and reports several outcomes itself. This is the fact the whole
design has to be built around, so it is enumerated rather than summarized:

| Condition | What it does | Caller sees |
|---|---|---|
| Source repository not known to the extension | `showWarningMessage`, return | nothing |
| Source has no index/working-tree/untracked changes | `showInformationMessage`, return | nothing |
| A path changed in BOTH worktrees | modal `showErrorMessage` listing ≤5, return | nothing |
| `confirmation` modal dismissed | return | nothing |
| Stash apply hits `StashConflict` | warns, offers "Show Changes", pops the stash back on the source, return | nothing |
| Any other git failure | pops the stash back on the source, **rethrows** | the throw |

Four of those six are eliminated rather than handled:

1. **Source not known** — checked before the row is offered (D3); it is the repository whose panel
   the user is acting from.
2. **No changes** — checked before the row is offered; that IS the row's condition (D5).
3. **Both-worktrees overlap** — *unreachable here*. The overlap set is computed against the
   DESTINATION's working-tree and untracked groups, and the destination is a worktree git created
   seconds ago and nothing has written into yet. It is empty precisely **because** the move is
   sequenced before provisioning (D6) — the ordering the acceptance demands for one reason turns out
   to be what makes this refusal impossible for another.
4. **Confirmation dismissed** — we pass `confirmation: false` (D1).

That leaves two, and both satisfy the acceptance clause "a failed move is reported with the worktree
standing and the changes left where they were":

- **Rethrow** — we catch it and report the failure ourselves. The create is not rolled back;
  `worktree-create.md` § 6 already rules that a failed step after a successful create is reported as
  exactly that. The extension has already popped the stash back on the source, so the changes are
  where they were.
- **StashConflict** — the extension reports it, with a better affordance than we could offer
  ("Show Changes" into the SCM view), and pops the source's stash back. We stay silent: reporting on
  top of it would be a second message for one event, and ours would be guessing.

**Residual, and it is real**: in the conflict case the source's changes are restored AND the
destination is left holding conflict markers, with the extension's `isWorktreeMigrating` flag set.
"The changes left where they were" holds; "and nowhere else" does not. This is the extension's own
semantics and cannot be prevented by a caller — a stash made at the source's HEAD can always
conflict when applied at the destination's, and a create onto a different branch is the normal case.
Raised at Gate 2 rather than absorbed here.

### D3 — The destination has to be a repository the extension knows

The call is a method ON the destination repository object, so `API.repositories` must contain it.
A worktree created seconds ago has not necessarily been scanned yet — this is a race, not a
formality, and losing it throws `is not a function`-adjacent failures after the worktree exists.

Wait for it, bounded: subscribe to `onDidOpenRepository`, resolve on the first repository whose
`rootUri` resolves to the created path, and race that against `afterDelay` from
`src/worktree/deadline.ts` (WT-011.11 — reused, not rewritten). The deadline elapsing is a
reportable failure of the move, not of the create.

Path comparison uses `isPathInside`/the resolved-path helpers, never a hand-rolled string compare —
`src/utils/pathBoundary.ts` is the only definition of containment in `src/`.

### D4 — Feature detection, because the floor is not the verified version

`package.json` declares `engines.vscode: ^1.105.0`; the API was verified in **1.130.0** and has NOT
been verified in 1.105. The worktree API family is recent. So: `typeof
repository.migrateChanges === "function"` before offering the row. This is not defensive noise — on
a version without it the failure lands AFTER the worktree exists, which is the one place this
subsystem tries never to fail. Absent ⇒ the row is not offered and nothing else changes.

`src/providers/git.ts` gains `migrateChanges?` on `Repository`, optional for exactly this reason,
plus the `MigrateChangesOptions` shape. Consumers keep taking `Pick<API, …>` as `repoRoots.ts` does.

### D5 — The row

Offered only when all of: the source repository is known, it has ≥1 change to move, the destination
API is present (D4). It states how many, and says the work leaves this worktree — the source is
emptied, and after D1 the extension will not say so itself.

The count is **distinct paths** across index, working-tree and untracked. The extension's own
overlap computation concatenates the three groups without deduping, so a file both staged and
edited appears twice in its array; a user-facing "N changes" that counts that file twice is simply
wrong. Distinct paths is what the user can go and look at.

### D6 — Ordering

After git reports the create succeeded, before provisioning. Named by the acceptance, required by
§ 6 so a setup command sees the moved work, and load-bearing for D2.3.

## Obligation ledger

| Claim | Semantics | Defeater | Witness/check | Disposition |
|---|---|---|---|---|
| The row appears only when work can actually move | Offered ⇔ source known ∧ ≥1 change ∧ `migrateChanges` present | Offering where the API is absent, or where the extension would report "no changes" | Unit witnesses per change-group combination + an absent-API fixture | supported |
| The stated count is the work that moves | "N changes" = distinct paths over index ∪ workingTree ∪ untracked | Counting one group only, or double-counting a staged-and-edited file | Witness with a path in two groups asserting N=1 | supported |
| Untracked work is not left behind | `untracked: true` reaches `createStash` | Omitting it — a silent partial move | Witness asserts the option passed | supported |
| The move lands after git success and before provisioning | Call order | Provisioning racing it | Call-order witness on the host path | supported |
| A failed move leaves the worktree standing | No rollback of a successful create | Reporting a migration failure as a create failure | The create result is already independent (§ 6) | supported |
| A failed move is reported | The user learns it did not happen | D2: four of six outcomes return silently | Each of the four is eliminated (D2.1–4), not handled; the two that remain are a throw we report and a conflict the extension reports | supported — narrowed; see the residual in D2 |
| The destination is callable when we call it | It is in `API.repositories` | Calling before the extension has scanned it | Bounded wait witness: resolves on the event, fails on the deadline | supported |
| Declining leaves both worktrees untouched | Field absent from the submit ⇒ never called | A default-true field | Optional field, defaults to absent | supported |
| The overlap refusal cannot fire | Destination working-tree ∪ untracked = ∅ at call time | Provisioning having run first | Guaranteed by D6; witnessed by the call-order test | supported |

## D7 — The sequencing seam already exists, on a branch that has not landed

The ordering D6 requires is inside `createWorktreeMutationService`, not in `extension.ts`. Its
`applyProvision` binding is the nearest hook, and it is the WRONG one: it fires only when
`wanted.length > 0` (`src/worktree/worktreeMutationService.ts:943`), so a user who asks to move work
while selecting no provisioning entries would be silently ignored — the one failure this task's
acceptance names outright.

The correct hook is a new optional binding beside `applyProvision`. That shape is not invented here:
the WT-012.6 peer branch (`huybuidac/creat-worktree-2`, commit `72d44151`) has already added
`applyPorts?(input): Promise<…>` to `MutationServiceDeps` and invoked it on the create path, and
`migrateChanges` is the same shape with different cargo. Following it is reuse; adding a second,
differently-shaped hook to the same function would be the duplication the parallel-session brief
forbids.

**So this change is BLOCKED on that branch landing**, not on a design question. Both hooks live in
the same interface block and the same create arm of one function; writing mine first guarantees a
conflict in a branch whose review has already recorded its final blockers. Everything above is
settled and does not change when it lands — only the insertion point does.
