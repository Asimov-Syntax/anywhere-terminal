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

`EEXIST` cannot make the distinction for a pre-existing destination, an uncontested entry, a
parent, or a descendant: there it cannot tell a rival declaration from material
`git worktree add` checked out, and a favoured claimant that fails before claiming produces none.

**One site is the exception**, and only one: the TOP-LEVEL destination of a CONTESTED favoured
entry, at the moment after reading 2 returned `absent`. Nothing this repository owns can create
that exact path in that window — git has finished (`worktreeMutations.ts:267-287` is awaited
before `worktreeMutationService.ts:918-957` calls provisioning), the apply is sequential, every
earlier entry has already answered, `ensureParents` creates only ancestors
(`applyEntries.ts:395-424`), and the held members are deferred by construction. So there,
`EEXIST` is not an ambiguous signal: it is **the exclusive claim being lost**, and the contest is
refused rather than merged into (.reviews/round-2.md F001). Anything else keeps today's merge.

An observation is one of four states, never a boolean:

| State | How it is reached | What it means here |
|---|---|---|
| `absent` | `lstat` rejects with `ENOENT` | and only then is the destination free |
| `present` | `lstat` resolves | something is there |
| `unreadable` | `lstat` rejects with anything else — `EACCES`, `EIO`, `ELOOP` | absence was NOT established |
| `inadmissible` | the entry gate refuses the entry outright | absence was NOT established either |

Collapsing `unreadable` into `absent` is what lets a transient failure authorize the merge path.
`inadmissible` is kept separate because the refusal the gate has is truer than any this could
invent — but it is not evidence of absence: the gate reaches the filesystem itself
(`src/utils/resolvedPathBoundary.ts:117-121` calls `realpath` and `lstat`), so an `EACCES` on the
destination and a naming rule are the same answer from here. Only `ENOENT` frees a destination.

### D3a — A member's own refusal is not an observation of the destination

Round 7 of the sibling change found `read()` collapsing every `admitEntry` failure into
`inadmissible`, so an inherited link-mode entry refused by its own material rule proved the shared
destination "not free" and the admissible native copy was refused at a destination that did not exist
(`applyProvisioning.ts:171`, recorded in `.reviews/round-6.md` as OOB-F016).

D3 argued the collapse, and the argument was half right. The gate does reach the filesystem, so an
`EACCES` there and a naming rule are indistinguishable **in the verdict as it is currently shaped**.
But they are not indistinguishable in `admitEntry`, which already separates them by construction
(`entryGate.ts:205-243`):

| Refusal | Touches the filesystem? | What it says about the destination |
|---|---|---|
| absolute spelling, backslash | no | nothing — it is a fact about the NAME |
| `refusedMaterial` | no — resolution is lexical, as the function's own comment states | nothing — it is a fact about this MEMBER's mode |
| `isResolvedPathInsideRoot` (either side) | yes — `realpath` and `lstat` | absence was NOT established |

So the verdict carries which kind it is, and `read()` maps the first two to a member-scoped refusal
and only the last to `inadmissible`. A member refused for what it is gets refused alone; the contest
continues, and an admissible favoured member still claims a free destination.

This is the distinction orca draws for an at-most-once RPC: `rpc-delivery-ambiguity.ts` keeps
"the request reached the wire and the outcome is unknown" apart from "it failed before the frame ever
left", because folding the second into the first surrenders a decision that is actually available.
The rule here is the same one — a failure BEFORE the destination was observed is not evidence about
the destination.

### D3b — More than one native member is refused entire

`contendersOf` sets `favoured` only when exactly one member comes from the native file
(`providerKit.ts:404`). A group of two native spellings plus one inherited therefore carries no
favoured member, and `contestsOf` drops it on the branch reading "nothing in it claims priority"
(`applyProvisioning.ts:60-64`) — so the ordinary pass runs and the INHERITED declaration's material
and `mode` land at the destination (OOB-F015).

That branch's reasoning was written for a favoured member the user had UNTICKED, where nothing
claiming priority is literally true. Two natives is the opposite state: priority is claimed twice.

Nothing available can choose between them. Declaration order inside one file is not a precedence the
spec gives, and inventing one would decide a user's config silently. So a group with more than one
native member is **refused entire**, naming every member by path and declaring file per D4a. That is
the same answer the spec already gives when nothing can establish which slot a destination is, and it
cannot end with an inherited row quietly taking a destination two native rows asked for.

### D3c — The offer asks the apply's question, over the selection it holds

D3b settled how a group with more than one repository declaration is APPLIED and left how it is
OFFERED where it was, so the dialog ticked every member of such a group, attached no note, and
counted them all into "N copied" — and every one came back `refused` (.reviews/round-7.md F007,
reopened under its round-5 ID because it is the same invariant through the same mechanism).

The recurrence is the point. F007 has now been found three times, and each time the dialog was
re-deriving "what will arrive" from a hand-rolled subset of the apply's rule. The apply's rule is
one function over the SUBMITTED entries — `contendersOf(selected, NATIVE_PROVIDER_FILE)` — and the
dialog's job is to state its answer for the selection currently held. So the fix is to make the
dialog ask the same question rather than to add a fourth special case to it.

`contendersOf` itself cannot cross the boundary: `providerKit.ts` imports `node:path` and
`resolvedPathBoundary`, and the webview bundle is `src/webview/main.ts`. What crosses is the one
fact the dialog lacks — WHICH members are the repository's own. Today the wire carries a
pre-computed winner, and a winner computed against the full offer is stale the moment the user
unticks a row.

So `ProvisionContenders.favoured` and `priorityClaimedTwice` are both replaced by

```ts
/** The members declared by the repository's own file, in `members` order. */
readonly natives: readonly string[];
```

and every consumer applies one predicate to the selection it is looking at:

| Repository declarations among the SELECTED members | Outcome |
|---|---|
| more than one | the group is refused entire (D3b) |
| exactly one | that one is favoured; the rest yield (D4) |
| none | nothing claims priority; the members are applied as they are |

The table is the same on both sides of the wire, which is what makes the dialog's statement
checkable against the apply's behaviour rather than merely similar to it. It also answers
.reviews/round-7.md F016 by construction: there is no longer a pair of optional fields that can
contradict each other, because there is one field and the three states are ranges of its length.

`remint` must translate it like `members` and `favoured` before it (F015). It rebuilt each group
from `members` and `favoured` alone, so `priorityClaimedTwice` never crossed the wire at all — the
apply was unaffected only because D1 recomputes the groups from the submitted entries, which is
exactly why every test passed.

**The default is SELECTED, and the plan attack is what settled it.** The first draft offered such a
group unselected, copying the yielder. That is incoherent: at an all-unselected group the predicate
above reads zero repository declarations among the selected members and answers "nothing claims
priority", so every row would carry a refusal note the rule contradicts — and a user who then ticked
only the inherited member would have it COPIED while its row still said none of them would be
brought over. That is round-5 F007 exactly, reached a fourth time.

The reason the yielder's unselected default works is that it is a FIXED POINT: unticked is precisely
the state in which the group succeeds. A group with two of the repository's own declarations has no
such state — the only selections that succeed keep exactly one of them, and choosing which is what
D3b forbids. So the default is the ordinary one, every member selected, which IS a fixed point in
the other direction: the predicate answers "refuse entire", every row says so, and the count is
zero. Each note is a live function of the selection, as the yielder's already is
(`WorktreeCreateDialog.ts:1090-1098`), so unticking one repository declaration turns the group into
an ordinary contest in front of the user and the notes follow.

Offering them selected also avoids a silent behaviour change the unselected default would have
carried: the inherited member of such a group would have stopped arriving without anything saying
so.

**What this requirement does NOT reach.** The dialog's advisory "may be the same file as X" partner
list and its "N spellings may be one file" line are statements about the OFFER's membership, not
about what will arrive, and they stay that way — the requirement quantifies over what the dialog
says will be brought over. Nor does it promise the apply's whole answer: the apply also refuses on a
destination reading the dialog cannot take before the worktree exists (D4 row 1). What is claimed,
and what is checkable, is that the GROUP-DECISION rule is the same one on both sides.

**A shape worth naming, because it is the easiest way to reach this state by accident:** `copy` and
`link` in one repository file naming the same path produce two entries from the repository's own
file with the same subject, distinguished only by their verb.

### D4 — The adjudication

For a contested group `G` with favoured `f` and each other selected member `m`:

| What the apply observes | Outcome |
|---|---|
| Any member reads anything but `absent` in either D3 reading | `f` and every `m` are `refused`, naming each other; nothing is written for the group |
| `f`'s own top-level creation answers `EEXIST` | `f` and every `m` are `refused`; the claim was lost between reading 2 and the write |
| `f` did not claim — refused, skipped or failed | every `m` is `refused`, carrying the contest index that identifies every member |
| `f` claimed | every `m` is `refused`, carrying the contest index that identifies every member |

An `inadmissible` member outside a contest is untouched by all of this: it is applied in its
ordinary place and the gate reports the refusal it actually has. Inside a contest it refuses the
group like any other unproven destination, per row 1.

Row 3 was two rows and is now one, because the distinction the second one rested on cannot be
observed. It read a held member's `absent` after `f` claimed as proof that this volume keeps the
two spellings apart, and therefore wrote `m`. But `absent` is equally the signature of `f`'s
just-written object being unlinked underneath the apply: on a folding volume both spellings then
read `ENOENT`, and writing `m` there makes the INHERITED declaration the owner of a destination
the whole change exists to give the repository's own (.reviews/round-2.md F005).

No available primitive tells those two states apart. An oracle attack established it: rechecking
`f` and then writing `m` is not atomic, an open handle proves the object still exists but not that
the name still binds it, checking after the write is too late and this apply owns no deletion
primitive to undo with, and the twin-create probe fails the same way — the probe's first name can
be unlinked before its second exclusive create succeeds. `{ bigint: true }` fixes the Windows
`st_ino` precision defect but not the semantics: hard links share an inode, a symlinked parent
collapses two paths, and an absent path has no inode to compare at all.

So the settlement refuses. **This costs a real case:** where the volume genuinely keeps
`MixedCase` and `mixedcase` apart, the inherited declaration no longer materializes — only the
repository's own does, and the other is refused naming both. That is a deliberate scope cut, taken
because the alternative is a path on which the inherited declaration silently wins the destination
and BOTH rows report success. The user was asked and was away; the option not taken was a risk
acceptance, which is theirs to grant and not mine.

A destination that appeared during the apply may be `f`'s own
material under a folded name, a descendant another entry's directory copy wrote, or a name another
process created — and nothing available here tells those apart. So the reason says the creation
**cannot be attributed**, and never that this apply did not create it: naming a non-creator is the
same unfounded causal claim as naming a creator.

`P2` is satisfied by the ordering and by row 1's refusal, never by a repair. No row writes `m` into
a destination `f` claimed or any party held.

### D4b — A refusal says which rule refused, and the reason string is not a channel

`applyEntry` answers a contested member with one `refused` outcome whatever refused it — an
unsupported file type, a lockfile, a symlink destination, or the exclusive claim being lost. The
orchestration cannot read a rule out of prose, so replacing every one of them with the claim-loss
reason reported a destination collision that never happened, for refusals that had nothing to do
with the contest (.reviews/round-3.md F006).

So the claim-loss answer is distinguishable at the type level rather than by its text, through two
doors rather than one flag: `applyEntry` keeps returning only a `ProvisionStepResult`, and
`applyExclusiveEntry` returns `ProvisionStepResult | typeof CLAIM_LOST`. The orchestration refuses
the contest on `CLAIM_LOST` and passes every other refusal through with the rule it actually had —
DECORATED with the contest's membership, never replaced by it, because D4a is about what a refusal
says and not about which one it is (.reviews/round-4.md F009, F010).

### D4a — Every refusal identifies every member, by path and declaring file

A step's own `path` says which row lost; it does not say which declaration it lost to, and the row
a person reads is one entry's. Every refusal therefore reaches the reader identifying **every member
of the contest**, its own included, each as `<path> (declared in <source>)`.

**What carries it is not the reason string.** The first draft put the whole membership INSIDE each
member's reason, which is `O(N**2)` text for one `N`-member contest — the input is row-capped and
that output was not (.reviews/round-4.md F008). That representation was withdrawn and re-owned by
`carry-a-contest-membership-once`, now archived. The shipped one composes at rendering:

```
step  →  { …, contest: <index> }          the local reason, plus a pointer
result → { steps, contests: [{ members }] }   each membership ONCE, per contest
notice →  "<reason> [contest N]" + one "Contest N, one destination these may all name: …" line
```

So D4a is a requirement on what the READER ends up identifying, not on what any one string contains.
A step's own reason keeps the rule that actually fired — an unsupported file type stays an
unsupported file type (D4b) — and the contest index is what makes its membership recoverable. Every
contested step carries that index whatever its outcome, including the failure path where the
worktree could not be read at all (.reviews/round-5.md F011).

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
| Nothing the apply writes can make the inherited declaration the owner of a contested destination | After any contested group, the material at the destination is `f`'s or nothing this apply wrote | Settling a held member on evidence that cannot distinguish a distinct slot from a removed one | D4's single post-claim row: every `m` is refused once `f` has run, whatever the destination reads. Witness that a held member is refused even when its spelling reads absent on a non-folding fake | supported |
| A refusal reports the rule that fired | A contested member refused for its own reason keeps that reason; only a lost exclusive claim reports a lost claim | Collapsing every `refused` from a contested entry into the claim-loss text, which invents a collision for an unsupported file type | D4b's distinguishable outcome; witness that a contested entry refused by the material rule still says so | supported |
| A contested top-level destination is created exclusively or not at all | `f`'s own `mkdir` establishes the top-level directory, or the contest refuses | `makeDirectory` converting `EEXIST` into `written` and the walk merging into a directory another writer owns | D3's exception at that one site; witness where the fake creates the destination between reading 2 and the write | supported |
| No entry outside a contested group changes position or outcome | The applied order and every uncontested step are identical to today's | Promoting a member ahead of the copy pass — the `Foo` / `foo` / `Foo/seed` case | D2 defers the loser instead of promoting the favoured member; witness asserting the applied order for a mixed model with a contested link group present | supported |
| Provisioning still deletes nothing | No unlink, truncate, or overwrite on any path this change touches | A repair that "clears" a contested destination | `pnpm run gate:fs-deletion`, which already scans every production module under `src/worktree/`; `ApplyFsDeps` offers no destructive primitive to call | supported |
| Copy-before-link still holds where it was relied on | `P1` over every entry that is not a contested non-favoured member | A deferred copy that a link was waiting on | D2's argument that no link can depend on a contested loser's material — a link entry points out of the worktree, a recreated in-tree link resolves inside its own tree | supported |
| An awarded destination is never attributed to a write the apply cannot prove | No outcome claims `f` created what `m` names | Reporting `m` as skipped-because-folded when a descendant walk or another process created that name | D4 row 3 refuses instead of attributing; witness that a name created by an unrelated entry's directory copy still refuses rather than awards | supported |
| A refusal identifies every member | Every D4 refusal resolves, through its `contest` index, to each member's path and declaring file, its own included | A step with no index, or an index into a membership the result never carried, which leaves a reader unable to say which row lost | Unit witnesses on all three refusal rows resolve the membership THROUGH the step's index (`named(contests, step)`), so a dropped index fails them; plus the `failEveryEntry` witnesses for the unreadable-root path | supported |
| The report's size is linear in the declarations | One membership per contest, referenced by index — not one copy per member | The withdrawn per-reason expansion, `O(N**2)` in text against a row-capped input | `carry-a-contest-membership-once` (archived) owns this; its witnesses count the membership's tokens per region rather than measuring a ratio | supported, owned by the child |
| No outcome claims who did or did not create a destination | Row 3's reason states only that creation cannot be attributed | A reason asserting "not put there by this apply", which is the same unfounded causal claim inverted | Unit witness on row 3's text | supported |
| Absence is established, never assumed | Only `ENOENT` reads as absent; any other `lstat` failure refuses the contest | Collapsing `EACCES`/`EIO` into absence, which authorizes the write path after failing to prove the destination free | D3's four states; witness with a fake whose `lstat` rejects `EACCES` | supported |
| The extraction did not change what the caller receives | Results are returned in the order they were produced, as the closure did | Returning them in provider order, which the webview's comparison key can see | Unit witness on the returned order for a mixed model | supported |
| A contested destination is claimed by the favoured member's own write | No favoured member merges into a destination an earlier entry or another process created | One reading, taken before the ordered pass, with the favoured turn arbitrarily later | D3's second reading, immediately before that turn; witness where an uncontested `MixedCase/seed` copy creates the directory first | supported |
| A recreated symlink is never refused for a loop this volume cannot have | Refusal only on exact self-reference | Refusing on the folding key, which `Foo -> foo` beside a real `foo` satisfies without being a loop | D6 uses exact equality; witness that a case-distinct in-repo link is still recreated | supported |
| What the dialog says will arrive follows from the selection held | For every selection the dialog can hold, the notes its contested rows carry and the count it summarises agree with the GROUP-DECISION rule `contendersOf` applies to that same selection. Not the apply's whole answer — D4 row 1 also refuses on a destination reading no dialog can take before the worktree exists | A group state the dialog decides by a rule of its own — how F007 recurred at rounds 3, 5 and 7 — or a default tick state that is not a fixed point of the dialog's own predicate, which is how the first draft of D3c reached it a fourth time | One predicate over `natives` and the live selection on both sides (D3c); witnesses walking the dialog through every selection of a two-native group — as offered, one repository declaration unselected, selected again, and only the inherited one left — asserting note and count at each | unresolved — closed by tasks 10_3 and 10_6 |
| The group identity the dialog reasons about is the one the apply will recompute | `natives` survives every transform between `contendersOf` and the dialog | `remint` rebuilding a group field by field and dropping one, as it did to `priorityClaimedTwice` (F015); or carrying it through with the PRE-remint ids, which passes every `members`-only assertion and then reads as zero natives in the dialog | A witness on `remint` asserting the translated group names the new ids and that no pre-remint id survives. The plan attack traced the whole offer path and found `remint` the only field-by-field rebuild on it; the second producer, `modelFromDraft`, calls `contendersOf` with no repository source and correctly yields an empty list | unresolved — closed by task 10_2 |
| A member refused for what it IS keeps its own rule under every schedule | For every contest, a member whose gate refusal observed nothing reports that refusal, whatever any sibling's reading was | The pre-pass ordering that refuses the contest and `continue`s before the member's own reason is recorded (F014) | A witness asserting the REASON and the step ORDER of that member, in a contest where a sibling reads non-`absent` — the reorder is visible through `provisionKey`, which is what the extraction-order row exists to catch. The plan attack confirmed D4 row 1, the contest index, and every existing order-asserting witness survive the hoist | unresolved — closed by task 10_4 |
