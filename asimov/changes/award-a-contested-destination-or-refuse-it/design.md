# Design: award-a-contested-destination-or-refuse-it

> Read-time identity and the contender relation are worktree-provisioning.md § 4.4. This document
> owns what happens when both members of a group are selected and the apply runs.

## Decisions

### D1 — Contested groups are recomputed from the selected entries, not carried on the wire

`contendersOf(selected, NATIVE_PROVIDER_FILE)` (`src/worktree/provisioning/providerKit.ts`) is
called again over exactly the entries the create carried. The rule already has one owner and a
gate that keeps it that way, and recomputing answers the question the apply actually has — which
selected rows contend — rather than the question the offer answered before the user unticked
anything. It also needs no id to survive the offer's reminting.

Restricting the partition to the selected entries can shrink or drop a group the user saw and can
never invent one they did not, because the key is deterministic and the relation is an equivalence
partition over it. An entry whose group has no `favoured` member among the selected entries is not
contested and is applied exactly as it is today — which is what makes an unchecked favoured member
neither claim nor block a selected inherited one.

### D2 — The loser yields its place in the order; nothing is promoted

Two accepted requirements constrain one order. As predicates over the applied sequence `S`:

- `P1` (accepted, spec `worktree-panel`): `∀ c ∈ copies, ∀ l ∈ links: index(c) < index(l)`.
- `P2` (this change): for a contested group `G` with favoured `f`, the material and mode at the
  destination are `f`'s, which requires `index(f) < index(m)` for every other selected `m ∈ G`.

With `f` a link and `m` a copy, `P1` demands `index(m) < index(f)`. Promoting `f` ahead of the copy
pass satisfies both predicates and is still wrong: a promoted native LINK named `Foo` creates a
symlink out of the worktree, and an UNCONTESTED later copy `Foo/seed` then resolves its parent
through it and is refused as outside the worktree
(`src/worktree/provisioning/applyEntries.ts:400-410`). That is a new refusal for an entry with no
part in the dispute.

So the **non-favoured member yields instead**: `f` keeps its ordinary pass position and every
selected `m ∈ G` is held out of its own pass and settled after the ordered pass ends. `P1` then
holds unrestricted over every entry except a contested loser, and no entry outside a group changes
position at all.

Deferring a loser starves nothing. A link entry points OUT of the worktree at the main checkout
(`makeLink`), and a symlink recreated inside a copied tree resolves within that tree
(`copyLink`); neither can depend on material a contested inherited copy would have supplied. That
is what `P1` was protecting, and it is untouched.

### D3 — What was already there is read before anything is written

Before the ordered pass begins, the apply `lstat`s the destination of every member of every
contested group and records presence, not contents.

`EEXIST` cannot make that distinction: `makeDirectory` answers `written` for a directory that was
already there (`applyEntries.ts:355-370`) and `walk` merges children into it (`:485-503`); `EEXIST`
cannot tell a rival declaration from material `git worktree add` checked out; and a favoured
claimant that fails before claiming produces no `EEXIST` at all.

The reading governs **both** members. Where any member's destination is already present, the whole
group is refused before `f` runs — otherwise `f` merges into it and installs neither its material
nor its mode, while only the loser is reported.

### D4 — The adjudication

For a contested group `G` with favoured `f` and each other selected member `m`:

| What the apply observes | Outcome |
|---|---|
| Any member's destination present in the D3 reading | `f` and every `m` are `refused`, naming each other; nothing is written for the group |
| `f` did not claim — refused, skipped or failed | `m` is `refused`, naming both declarations |
| `f` claimed and `m`'s destination is present after the ordered pass | `m` is `refused`, naming both declarations |
| `f` claimed and `m`'s destination is still absent | `m` is applied, in the deferred position D2 gives it |

Row 3 is one row on purpose. A destination that appeared during the apply may be `f`'s own
material under a folded name, or a descendant another entry's directory copy wrote, or a name
another process created — and nothing available here tells those apart. Attributing it to `f` and
reporting `m` as merely skipped would claim a causal fact the apply cannot establish, and the
concurrent case is one the blueprint requires to be refused. So all three are reported the same
way, which is what they are: a collision this apply cannot attribute to its own write.

`P2` is satisfied by the ordering alone — `f` writes before any `m` can — and never by a repair.
No row writes `m` into a destination `f` claimed or any party held.

### D5 — One orchestration, out of the extension entry point

The ordering, the D3 reading and the D4 table move from the `applyProvision` lambda in
`src/extension.ts` into `src/worktree/provisioning/applyProvisioning.ts`, which calls `applyEntry`
unchanged for anything it decides to apply. The lambda keeps the wiring it already has — roots,
budget, deps — and calls the new function. A claim discipline expressed inside a closure in the
extension's activation path has no unit test that can reach it.

`readOnly.test.ts` requires every non-test module in the directory to be listed; the new module
joins the mutating list, beside `applyEntries.ts`. `src/test/invariants/fsDeletionGate.ts` already
scans everything under `src/worktree/`, so it covers the new module without being edited.

### D6 — A recreated symlink is refused only when it is a self-loop on every volume

`copyLink` recreates a link by writing the source's target verbatim. Where the target resolved
against the link's own directory is exactly the link's own destination, the result resolves to
itself on any filesystem, and it is refused with that reason.

The folding key is NOT used here. It is deliberately over-inclusive and safe only for advisory
grouping: on a case-sensitive volume `Foo -> foo` beside a real `foo` is an ordinary in-repository
link, and refusing it on a shared folding key would destroy material to prevent a loop that volume
cannot have. The folded case — the same link on a folding volume — is left to the filesystem,
which answers `ELOOP` to a reader and loses nothing, and is recorded as a follow-up needing the
twin-create probe this change does not assume.

## Obligation ledger

| Claim | Semantics | Defeater | Witness / check | Disposition |
|---|---|---|---|---|
| The inherited declaration never wins a contested destination | For every contested group, the material and mode at the destination are the favoured member's, or nothing was written by either | An ordering or failure path that lets `m` write where `f` would have; a pre-existing destination `f` merges into while only `m` is refused | D2 puts every `m` after `f`; D4 row 1 refuses the whole group before `f` runs. Unit witnesses for all four rows, including the pre-existing directory case asserting the fake recorded no write for either member | supported |
| A group whose members are two distinct files here still lands both | Both members materialize when the volume keeps their destinations apart | An unconditional refusal or pre-emption of the loser | D4 row 4; witness with a fake filesystem that keeps the two spellings apart | supported |
| No entry outside a contested group changes position or outcome | The applied order and every uncontested step are identical to today's | Promoting a member ahead of the copy pass — the `Foo` / `foo` / `Foo/seed` case | D2 defers the loser instead of promoting the favoured member; witness asserting the applied order for a mixed model with a contested link group present | supported |
| Provisioning still deletes nothing | No unlink, truncate, or overwrite on any path this change touches | A repair that "clears" a contested destination | `pnpm run gate:fs-deletion`, which already scans every production module under `src/worktree/`; `ApplyFsDeps` offers no destructive primitive to call | supported |
| Copy-before-link still holds where it was relied on | `P1` over every entry that is not a contested non-favoured member | A deferred copy that a link was waiting on | D2's argument that no link can depend on a contested loser's material — a link entry points out of the worktree, a recreated in-tree link resolves inside its own tree | supported |
| An awarded destination is never attributed to a write the apply cannot prove | No outcome claims `f` created what `m` names | Reporting `m` as skipped-because-folded when a descendant walk or another process created that name | D4 row 3 refuses instead of attributing; witness that a name created by an unrelated entry's directory copy still refuses rather than awards | supported |
| A refusal names both declarations | Every D4 refusal carries `f`'s path and declaring file and `m`'s own | A reason string that names one side | Unit witnesses on the reason text of all three refusal rows | supported |
| A recreated symlink is never refused for a loop this volume cannot have | Refusal only on exact self-reference | Refusing on the folding key, which `Foo -> foo` beside a real `foo` satisfies without being a loop | D6 uses exact equality; witness that a case-distinct in-repo link is still recreated | supported |
