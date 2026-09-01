# Design: merge-only-the-declarations-proven-to-be-one

> Blueprint: docs/PLAN.md task WT-012.17 · Spec: specs/worktree-panel/spec.md
> Sibling: WT-012.18 owns the apply-time half. This change owns the read-time half only.

## The question, and why six answers were wrong

`worktree-provisioning.md` § 4.2 step 3 says "Dedupe by `path`. **The native entry wins**, including
its `mode`." It does not say when two declared paths are one `path`. Six mechanisms have been
proposed and refuted for that gap across five review cycles:

| Mechanism | Refuted by | Failure direction |
|---|---|---|
| Lexical normalization only | round 3 F001 | extra row, then wrong mode at apply |
| Does a case-toggled spelling of a probe file exist? | round 4 F005 | dropped row |
| Do both spellings of the probe resolve alike? | oracle, pre-build | dropped row |
| `realpath` each declared path | round 5 F008 | dropped row |
| `lstat` dev+ino each declared path | oracle, pre-build | dropped row |
| `toLowerCase()` where `path.sep === "\\"` | round 7 F001 + F013 | wrong mode, and dropped row |

The structural reason every filesystem probe failed: they read an **object** and the question is
about a **name**. `realpath` dereferences the final component; `lstat` dev+ino is object identity
too. Two hard links are two names with one inode; two symlink aliases are two names with one
`realpath`; a symlinked parent defeats `lstat`'s no-follow property. Node exposes no no-follow
canonical-directory-entry-name primitive, so there is nothing left to ask.

A seventh answer — fold ASCII only — was tested here before planning and rejected. It closes the
`toLowerCase()` over-merge (`İ`/`i̇`, `ẞ`/`ß`, `Ϗ`/`ϗ` stay apart, as NTFS keeps them) but makes the
other direction worse: `Straße`/`STRASSE` and `ﬀ`/`ff` are **one file** on APFS, so splitting them
reproduces the round-7 defect exactly.

## D1 — The read path stops trying to prove it

Two declarations are one entry only when their normalized spellings are equal. Nothing weaker,
nothing stronger, and no filesystem call — not `realpath`, not `lstat`, not a probe, not on any
platform.

This is not a fold rule with a better constant. It is the removal of the fold rule. `entryGate.ts`
folds case for its lockfile refusal and that is **not** a precedent: an over-conservative refusal
stays visible to the user, while a merge key deletes a row and its provenance permanently. Different
failure semantics, different call.

## D2 — The boundary is temporal, not modular

`git worktree add` creates the worktree, and only then does provisioning run
(`worktreeMutationService.ts:923-962`). The offer is drawn before that. So the naming rule that
decides the answer is a property of a directory that **does not exist yet** while the section is
being shown. No amount of care at read time can close that; asking a different volume is asking the
wrong volume.

Hence the split: this change owns what can be decided from the declarations alone. WT-012.18 owns
what can only be decided once the destination exists.

## D3 — A contender group, offered in full

A pair whose spellings differ but which may name one destination becomes a **contender group**: both
rows shown, both offered, each keeping its own spelling and its own `source`, plus a record of which
declaration the merge rule favours (the repository's own).

The rejected alternative was to offer neither. It is safe against silent loss but wrong for the
product: `mixedcase`/`MixedCase` is the ordinary macOS case, and withholding both means the user
gets nothing where today they get something.

Offering both is correct because the apply side can settle it without a proof:

- If the two names ARE one destination, WT-012.18 lets the favoured declaration claim the slot
  first, and the accepted requirement "Materializing never replaces anything that is already there"
  (`asimov/specs/worktree-panel/spec.md:1870`) skips the loser — the native mode wins.
- If they are TWO destinations, both are created, each in its own mode.

Neither branch needs the question answered in advance. That is the whole point of moving it.

## D4 — Detecting a contender is allowed to be wrong in one direction

Membership of a contender group is a **hint for ordering**, never an identity claim. A false
positive costs an ordering constraint on two entries that never collide — no observable difference.
A false negative reverts that pair to today's behaviour.

So the detector is deliberately generous and deliberately not a proof: ASCII case folding plus
Unicode case folding, unioned, over the normalized spelling. It may group pairs that are distinct on
disk; it must not miss a pair that a common filesystem would fold. It is never used to merge, so its
errors cannot delete a declaration.

## D5 — `exclude` matches on D1's rule

`exclude` deduped against entries under the same comparison, so it inherits whatever the merge rule
does. Under D1 an exclusion spelled in a different case no longer matches — and § 4.2 step 4 already
requires an exclusion that matches nothing to be reported, so the user is told rather than left with
a rule that silently did nothing.

## D6 — Reuse the row that is already drawn but not offered

`BringRow.excluded` (`src/webview/worktree/WorktreeCreateDialog.ts:296-313`) already renders a row
with its provenance and no checkbox, through `wt-brow--excluded` at `:470`, `:487` and `:506`. The
contender marker is a second flag down that same path — it keeps the checkbox, and adds the note
naming its partner. No new rendering pattern, and `oneOwner.test.ts` stays satisfied.

## Obligation ledger

| Claim | Semantics | Defeater | Witness | Disposition |
|---|---|---|---|---|
| The read path performs no filesystem I/O for identity | For every declared path and every `exclude` spelling, no `realpath`/`lstat`/`stat`/`access` call is made on its behalf | Any identity code path reaching a dep hook | Instrumented `ProviderDeps` recording every path passed to every hook; the assertion is that the recorded list is empty for a model built from declarations alone | supported |
| Merging never deletes a declaration | Every declared path appears in exactly one of `entries`, `excluded`, or a contender group; the total is conserved | A comparison that maps two distinct declarations to one key | Property test over generated declaration pairs including `İ`/`i̇`, `ẞ`/`ß`, `Ϗ`/`ϗ`, `Straße`/`STRASSE`, `ﬀ`/`ff`, `mixedcase`/`MixedCase`: input count equals output count across all three buckets | supported |
| A contender group never changes what a row displays | Each row's `path` and `source` are the ones its own file wrote | Marking a group rewriting either field | Assert displayed spelling and `source` are byte-equal to the declaration for every member of a group (§ 4.3) | supported |
| The favoured member is the repository's own declaration | For every contender group with a native member, the favoured id is that member's | A group built from two inherited declarations, or from two native ones | Unit test on group construction for native+inherited, inherited+inherited, native+native | supported |
| A contender group is offered, not withheld | Both members receive offer ids and can be selected | A member without an id, or filtered from the offer | Assert both members appear in the offer and both ids redeem | supported |
| The detector cannot cause a declaration to be lost | Grouping is advisory; no code path deletes or merges on the strength of group membership | Any merge keyed on the group | `rg` gate plus a test that a deliberately over-grouping detector still conserves the declaration count | supported |
| Whether the favoured member actually wins the destination | Out of scope here — it is WT-012.18's Acceptance | — | — | n/a — the temporal boundary in D2 is why this change cannot witness it |

## What this change does not do

It does not decide who wins a destination two entries both claim; that needs the destination to
exist. It does not remove the residual that a contender group shows two rows where one file will
land — that is visible, reported as skipped, and in the tolerable direction. It does not adopt the
twin-create probe (create both spellings exclusively in a private directory under the real
destination parent, and read the second `EEXIST` as proof of one slot): it is the strongest
unexplored mechanism because it tests two NAMES by creating them rather than testing an object, but
it needs a stated filesystem-support contract and an owner for the artifact a crash would leave
behind, and provisioning currently deletes nothing. Recorded as a follow-up on WT-012.18.
