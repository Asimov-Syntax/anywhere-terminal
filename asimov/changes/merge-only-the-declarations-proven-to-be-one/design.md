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

Neither branch needs the question answered in advance — but the apply side does NOT get this for
free, and D3 originally claimed it did. Two states break the simple story, and both are WT-012.18's
to settle with a `D#` of its own:

- **Directory against directory.** `makeDirectory` returns `written` for a destination that was
  already a real directory (`applyEntries.ts:349-372`), and the walk then descends and MERGES the
  loser's children in (`:485-503`). For directory entries the loser is not skipped at all, so
  ordering alone does not produce native-wins.
- **A native link against an inherited copy.** "Copying SHALL happen before linking" is an accepted
  requirement (`asimov/specs/worktree-panel/spec.md:1810-1815`), so letting the native link claim
  the slot first violates it. Native-wins and copy-before-link constrain the same state and one of
  them must yield; WT-012.18 owns writing both as predicates over one model and showing a
  construction that satisfies them, or naming the one that gives way.

This change therefore commits only to what it can witness: the group travels, and it names the
favoured member. Whether the favoured member actually lands is WT-012.18's Acceptance.

## D4 — Detecting a contender is allowed to be wrong in one direction

Membership of a contender group is a **hint for ordering**, never an identity claim. A false positive
costs an ordering constraint on two entries that never collide, plus the note D6 draws — visible, but
it cannot delete material. A false negative reverts that pair to today's defect, so that is the
direction that still loses a guarantee and the direction the detector is tuned against.

So the detector is deliberately generous and deliberately not a proof. Over the normalized spelling
it unions:

- ASCII case folding and Unicode case folding;
- Win32 filename semantics — trailing dots and spaces, and a `::$DATA` suffix — which
  `entryGate.ts:134-175` already computes for its lockfile refusal and which pure case folding
  misses entirely (`foo` and `foo.` are one object to Win32);
- Unicode canonical equivalence, NFC against NFD, which case folding also does not close
  (composed `é` against `e` + combining acute).

It may group pairs that are distinct on disk; it must not miss a pair a common filesystem folds. It
is never used to merge, so its errors cannot delete a declaration — but a false positive is NOT
unobservable, because D6 draws a note naming the partner and that note can change which box a user
ticks. The defensible claim is only that a false positive cannot delete material.

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
| Identity does not read the filesystem | The model merge and exclusion produce is a pure function of the declared spellings | Any code path where a filesystem answer changes which rows survive | DIFFERENTIAL: run one set of declarations against two fakes that disagree about every declared path — one resolving each to itself, one resolving both spellings to a single canonical path, which is what a folding volume reports — and assert the rows are identical. NOT "no declared path reaches a hook": running that proved declared paths DO reach `realpath`, because CONTAINMENT resolves them to check where they land, and that is a security property that must not be asserted away | supported |
| Merging never deletes a declaration whose spelling differs | Two declarations with DISTINCT normalized spellings always yield two rows across `entries` + `excluded`; the total is conserved | A comparison that maps two distinct spellings to one key | Property test over `İ`/`i̇`, `ẞ`/`ß`, `Ϗ`/`ϗ`, `Straße`/`STRASSE`, `ﬀ`/`ff`, `mixedcase`/`MixedCase`, `foo`/`foo.` | supported |
| A contender group never changes what a row displays | Each row's `path` and `source` are the ones its own file wrote | Marking a group rewriting either field | Assert displayed spelling and `source` are byte-equal to the declaration for every member of a group (§ 4.3) | supported |
| A group names at most one favoured member | A group with exactly one native member favours it; a group with none or with several has NO favoured member and says so, rather than picking one | Two native declarations differing only in spelling; two inherited ones | Unit test on group construction for native+inherited, inherited+inherited, native+native, and a three-member component (`Straße`/`STRASSE`/`strasse`) | supported |
| Group ids survive reminting | The ids a group names are the ids the offer actually issues | `offerStore.remint()` replaces every entry id (`offerStore.ts:91-99`) and leaves the group pointing at ids nobody holds | Offer-store test that reminting rewrites group member and favoured ids with the entries | supported |
| A contender group is offered, not withheld | Both members receive offer ids and can be selected | A member without an id, or filtered from the offer | Offer-store / host test that both ids redeem. NOT `readProvisioning.test.ts` — it cannot see redemption, and asserting there would prove the wrong layer | supported |
| The detector cannot cause a declaration to be lost | Grouping is advisory; no code path deletes or merges on the strength of group membership | Any merge keyed on the group | `rg` gate plus a test that a deliberately over-grouping detector still conserves the declaration count | supported |
| Whether the favoured member actually wins the destination | WT-012.18's Acceptance, not this change's | Directory-against-directory merges rather than skips; native-link-against-inherited-copy collides with the accepted copy-before-link rule | None available here — the destination does not exist while this code runs | **unresolved**, deliberately, and NOT `n/a`: the spec delta no longer asserts any on-disk outcome, so nothing in THIS change depends on it, but the promise is real and it is owed by WT-012.18 before either ships |

## What this change does not do

It does not decide who wins a destination two entries both claim; that needs the destination to
exist. It does not remove the residual that a contender group shows two rows where one file will
land — that is visible, reported as skipped, and in the tolerable direction. It does not adopt the
twin-create probe (create both spellings exclusively in a private directory under the real
destination parent, and read the second `EEXIST` as proof of one slot): it is the strongest
unexplored mechanism because it tests two NAMES by creating them rather than testing an object, but
it needs a stated filesystem-support contract and an owner for the artifact a crash would leave
behind, and provisioning currently deletes nothing. Recorded as a follow-up on WT-012.18.
