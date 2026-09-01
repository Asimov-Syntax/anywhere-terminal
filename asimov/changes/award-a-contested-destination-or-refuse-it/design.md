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

### D3 — Absence is observed twice, and only `ENOENT` establishes it

A contested destination is observed with `lstat` at two moments:

1. **Before the ordered pass**, so what it reads is what was already in the worktree rather than
   what this apply has since written.
2. **Immediately before the favoured member takes its ordinary turn.** One reading is not enough:
   between it and that turn, an earlier uncontested entry can create the name — a copy of
   `MixedCase/seed` has to create `MixedCase` — and `makeDirectory` then answers `written` for a
   directory that was already there (`applyEntries.ts:355-370`) and the walk merges into it
   (`:485-503`). The favoured step reports `copied` while an unrelated writer owns the top-level
   destination and its mode.

`EEXIST` cannot make the distinction at all, which is why it is not the signal: it cannot tell a
rival declaration from material `git worktree add` checked out, and a favoured claimant that fails
before claiming produces none.

An observation is one of four states, never a boolean:

| State | How it is reached | What it means here |
|---|---|---|
| `absent` | `lstat` rejects with `ENOENT` | and only then is the destination free |
| `present` | `lstat` resolves | something is there |
| `unreadable` | `lstat` rejects with anything else — `EACCES`, `EIO`, `ELOOP` | absence was NOT established |
| `inadmissible` | the entry gate refuses the entry outright | this member claims nothing; it is not a collision |

Collapsing `unreadable` into `absent` is what lets a transient failure authorize the merge path,
and collapsing `inadmissible` into `present` reports a collision that was never observed while
discarding the refusal the gate actually had.

### D4 — The adjudication

For a contested group `G` with favoured `f` and each other selected member `m`:

| What the apply observes | Outcome |
|---|---|
| Any member reads `present` or `unreadable` in either D3 reading | `f` and every `m` are `refused`, naming each other; nothing is written for the group |
| `f` did not claim — refused, skipped or failed | `m` is `refused`, naming both declarations |
| `f` claimed and `m` does not read `absent` afterwards | `m` is `refused`, naming both declarations |
| `f` claimed and `m` reads `absent` afterwards | `m` is applied, in the deferred position D2 gives it |

An `inadmissible` member is none of these: it is applied in its ordinary place so the gate reports
the refusal it actually has, and it never refuses anyone else.

Row 3 is one row on purpose. A destination that appeared during the apply may be `f`'s own
material under a folded name, a descendant another entry's directory copy wrote, or a name another
process created — and nothing available here tells those apart. So the reason says the creation
**cannot be attributed**, and never that this apply did not create it: naming a non-creator is the
same unfounded causal claim as naming a creator.

`P2` is satisfied by the ordering and by row 1's refusal, never by a repair. No row writes `m` into
a destination `f` claimed or any party held.

### D4a — Every refusal names every member, by path and declaring file

A step's own `path` says which row lost; it does not say which declaration it lost to, and the row
a person reads is one entry's. Each refusal reason therefore names **every member of the contest**,
its own included, each as `<path> (declared in <source>)`.

### D5 — One orchestration, out of the extension entry point

The ordering, the D3 reading and the D4 table move from the `applyProvision` lambda in
`src/extension.ts` into `src/worktree/provisioning/applyProvisioning.ts`, which calls `applyEntry`
unchanged for anything it decides to apply. The lambda keeps the wiring it already has — roots,
budget, deps — and calls the new function. A claim discipline expressed inside a closure in the
extension's activation path has no unit test that can reach it.

`readOnly.test.ts` requires every non-test module in the directory to be listed; the new module
joins the mutating list, beside `applyEntries.ts`. `src/test/invariants/fsDeletionGate.ts` already
scans everything under `src/worktree/`, so it covers the new module without being edited.

The extraction is behaviour-preserving, and that includes the ORDER OF THE ANSWER. The closure
returned its results in execution order — copy before link — and the webview's comparison key
includes the sequence, so returning them in the order the provider listed them is an observable
change dressed as a refactor. `applyProvisioning` returns results in the order they were
PRODUCED: the group refusals D4 row 1 settles up front, then the ordered pass, then the deferred
members. A deferred member therefore answers last, which is also when its outcome becomes known.

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
| A refusal names every member | Every D4 refusal carries each member's path and declaring file, its own included | A reason naming only the counterparty, which leaves a reader unable to say which row lost | Unit witnesses on the reason text of all three refusal rows, asserting the refused member's own spelling and source appear | supported |
| No outcome claims who did or did not create a destination | Row 3's reason states only that creation cannot be attributed | A reason asserting "not put there by this apply", which is the same unfounded causal claim inverted | Unit witness on row 3's text | supported |
| Absence is established, never assumed | Only `ENOENT` reads as absent; any other `lstat` failure refuses the contest | Collapsing `EACCES`/`EIO` into absence, which authorizes the write path after failing to prove the destination free | D3's four states; witness with a fake whose `lstat` rejects `EACCES` | supported |
| The extraction did not change what the caller receives | Results are returned in the order they were produced, as the closure did | Returning them in provider order, which the webview's comparison key can see | Unit witness on the returned order for a mixed model | supported |
| A contested destination is claimed by the favoured member's own write | No favoured member merges into a destination an earlier entry or another process created | One reading, taken before the ordered pass, with the favoured turn arbitrarily later | D3's second reading, immediately before that turn; witness where an uncontested `MixedCase/seed` copy creates the directory first | supported |
| A recreated symlink is never refused for a loop this volume cannot have | Refusal only on exact self-reference | Refusing on the folding key, which `Foo -> foo` beside a real `foo` satisfies without being a loop | D6 uses exact equality; witness that a case-distinct in-repo link is still recreated | supported |
