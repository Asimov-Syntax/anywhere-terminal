# Design: write-only-the-native-config-file

Every decision below was attacked before Gate 2. Eight findings were returned and all eight
accepted; D3, D4, D6, D7, D8 and D9 are written here in their amended form, and D11 exists because
the attack found a first write with no file it could truthfully name.

## Architecture

```
dialog [Configure…] ──save{repoId, offerId, opening, switch, kept[]}──▶ WorktreeHost
                                                     │
                       cache.read().repos → repo.mainPath │  the ROOT is host-held, not the message's
                            offerStore.lookup(key, offerId) │  ids → the model
                                                     ▼
                                    divergenceOf(model, kept) → {exclude[], drop[], extends?}
                                                     │
                                                     ▼
                                  writeNativeConfig(root, divergence)
                                     resolve → lock → read → modify → rename
                                                     │
                                                     ▼
                            readProvisioning → offers.issue → worktreeProvisionOffer
                                     (under the SAME order the switch obeys)
```

## Decisions

### D1: The webview names items; the host derives every path and the root

The save message carries the offer id, the ids the user left checked, and the two ordering fields
D8 needs. It carries no path, no key and no file text.

`repoId` is a path, so it is not trusted as one: the host finds the repository in its own cache and
uses `repo.mainPath`, exactly as the `worktreeProvisionSwitch` handler does. The message's string
selects a record; it never becomes a destination.

Provider files are untrusted text (worktree-provisioning.md § 7), and this is the first control
that puts any of that text into a file the extension writes. § 4.0 established the rule for what
EXECUTES — a webview that could supply the command to run would be the authority on what runs. A
webview that could supply the path to exclude would be the authority on what the repository's
configuration says. Same rule, same store, one hop later.

An unknown, expired or foreign offer id writes nothing and re-offers.

### D2: The writer is a new module, declared as a module that writes

`src/worktree/provisioning/writeNativeConfig.ts`, added to `NOT_READ_PATH` in
`src/worktree/provisioning/readOnly.test.ts` — never to `READ_PATH`.

That suite holds the property that nothing turning provider files into a model can run a command or
change a byte, and its completeness check fails on any module in the directory absent from both
lists. Placing the writer there is therefore a declaration, not a filing decision.

### D3: One lock spans the whole read-modify-write, and the file keeps its mode

`LockedFile` from `src/agentHooks/install/lockedJsonFile.ts` is the discipline this repository
applies to every file another process may also hold. Two corrections the attack forced:

- **The lock spans the transaction, not the commit.** `readText` → `modify` → commit all run inside
  one `withLock`. Two saves that both read before either locked produce serialized renames and a
  lost update: A's exclusion is overwritten by B's stale text. Serializing the syscall is not
  serializing the operation.
- **The existing mode is read and passed.** `atomicReplace(text, undefined)` stages at `0o600`, and
  the rename makes that inode the file — a probe turned a `0644` configuration into `0600`. The
  writer stats the target first and passes the mode it had; a first write passes `undefined` and
  takes the default.

Existing file → `atomicReplace`. First write → `stageReplacement(...).commit("create")`, whose
`link` refuses to clobber a file that appeared meanwhile, with `discard()` in a `finally`.

### D4: An existing file is edited as text, and a file that cannot be edited safely is not edited

Edits come from `jsonc-parser`'s `modify()` and are applied with `applyEdits()` against the original
source. The property that holds, and the only one claimed: **bytes outside the edit spans `modify`
returns are unchanged.** That was probed against the pinned 3.3.1 over comments, trailing commas,
tabs and CRLF.

What was claimed before and is false: that comments and formatting survive "by construction".
**The span is one array ELEMENT, never the whole array.** Round 1 F004: replacing the whole value
for `exclude`, `copy` or `link` reflows the array and deletes every comment inside it, including
comments attached to elements the edit KEEPS. D4's claim survived that literally — the bytes outside
the span were unchanged — because the span had grown wide enough to make it vacuous, which is the
defeater this row already named. Probed against pinned 3.3.1, the narrow forms preserve all of it:
`modify(t, [key, n], v, { isArrayInsertion: true })` to add, `modify(t, [key, i], undefined)` to
remove. Comment preservation is the entire reason this change edits text instead of reserialising,
so the wide span defeated the purpose while satisfying the letter.

Inside the span `modify` chooses, a trailing comment can move to the element inserted after it, and
adjacent formatting is rewritten. That is acceptable — it is bounded to the span being changed —
but it is not the guarantee the earlier wording made, and the witness compares against
independently obtained spans so an implementation cannot nominate a whole-file span and pass.

Two refusals follow, because `modify` is willing to do worse than reformat:

| State | `modify` behaviour, probed | This writer |
|---|---|---|
| Document has parse errors | mutates it and leaves it unclosed | refuse, write nothing, report |
| `exclude` present but not an array | throws `Can not add property to parent of type string` | refuse, write nothing, report |

`format()` is never called on the document. `FormattingOptions` come from the file's own first
indented line and dominant line ending, defaulting to two spaces.

### D5: The keys written are the ones the choice lives in

`exclude`, `extends`, `copy` and `link`. No other key is added, removed, reordered or reformatted,
and no file but the target is opened for writing.

### D6: What is recorded is what the configuration can express; the rest is stated

The earlier claim — that only two divergences are reachable — was false of the shipped form. Ports
render ticked and are untickable, setup steps are tickable, and native inline entries are
untickable (`WorktreeCreateDialog.ts:502-540`). Three states were being discarded in silence.

| Chosen state | Recorded as |
|---|---|
| An inherited entry left unticked | its declared path appended to `exclude` |
| An entry the native file declared, left unticked | that path removed from the native `copy`/`link` |
| A different detected source taken | that source's present file as `extends` (D11) |

| Chosen state | Not recorded, because |
|---|---|
| A setup step ticked | § 7 makes the unticked box the safety rule: a provider file's command is not consented to by arriving pre-ticked. A saved preference is precisely a pre-ticked box next time, so persisting this would defeat the rule it looks like it serves |
| A port unticked | allocation is WT-012.6's and unallocated ports have no stable identity to record. `exclude` matches paths, and a port is not one |

An inherited entry and a native one diverge to different keys because `exclude` has no effect on
inline keys (§ 3.4) — excluding a path the native file itself declares would record a contradiction
the read side then reports as a problem.

The two unrecordable states are **stated in the form before the save**, not dropped quietly. The
requirement is that the user knows which of their choices this create keeps and which the
repository keeps.

### D7: The parent is resolved once and written through, and a symlinked target is refused

`<repo.mainPath>/.vscode/worktree.json`. The module takes a root and a divergence; it cannot be
handed a path.

The earlier check — resolved containment on the parent — was bypassed by probe: check the parent,
swap `.vscode` for a symlink pointing outside the repository, and the write lands outside. Two
changes close it:

1. The parent directory is resolved once, checked against the resolved repository root with
   `isResolvedPathInside` from `src/utils/resolvedPathBoundary.ts`, and **every subsequent operation
   names the resolved path** — the one resolution that was checked, never a second one taken
   afterwards. Round 1 F001: the shipped code resolved twice and built the target from the second,
   unchecked result, and in the directory-absent branch never resolved at all, leaving
   `LockedFile`'s recursive `mkdir` to walk a planted symlink. Recursive `mkdir` over an existing
   symlink-to-directory SUCCEEDS, so the directory is created non-recursively tolerating EEXIST,
   `lstat`ed and refused when it is a link, and only then resolved and checked. A later swap of the logical `.vscode` name cannot redirect a write
   that is no longer spelled through it.
2. The target itself is `lstat`ed and refused when it is a symlink. The final component was outside
   the parent check entirely, and a configuration that is a symlink is not a configuration this
   control edits.

The module spells no containment rule of its own (§ 7), and the answer authorizes a WRITE, so the
resolved form is the one that applies (DESIGN.md § 9 D31).

### D8: A save carries the ordering the switch already obeys

The save message carries `opening` and a `switch` sequence, and the handler enters the same
latest-wins gate `worktreeProvisionSwitch` uses before it starts, and re-checks it before it
publishes.

Without a shared order the two controls race: a save begins against offer A, the user takes source
B and B publishes, then the save finishes and republishes a model derived from A — the earlier
action overwriting the later visible choice. Reading the current opening after the write does not
fix it; that admits a successor form. The opening is captured before the write and compared after.

### D9: A failed save reports and changes nothing

`LockedFile` cannot distinguish a lock another process holds from a directory it could not create —
both return `undefined` (`lockedJsonFile.ts:215-232`). So there is one reason, `unavailable`, rather
than a `locked` that would be a guess. The reasons are `unavailable`, `outside`, `malformed` and
`unwritable`.

A commit that landed is a successful save even if the re-read that follows fails: the file on disk
changed, and reporting otherwise would invite the user to save again. That case reports the read
failure, not a write failure.

The failure becomes a problem the section renders, and Create stays enabled — a configuration that
could not be saved is not a reason to refuse to make a worktree (§ 9).

### D10: A save is idempotent

An exclusion already present is not appended, a path already absent from `copy`/`link` is not
removed again, and an `extends` already naming the chosen file is not rewritten. Where nothing
remains to do, the save commits nothing at all. Without this, repeated saves grow a checked-in file
without bound — the reason `addToGitExclude` re-reads and matches before appending.

### D11: The model says which of a provider's files are actually there

`ProvisionProvider` gains `present: readonly string[]` — the subset of `files` that exists, in read
order. `extends` is written as `present[0]`.

`files` is the adapter's declared list, not a finding. Orca is one provider over two independently
optional files (`orcaProvider.ts:1-7`), so in a repository carrying only `.worktreeinclude` the
active provider still publishes `["orca.yaml", ".worktreeinclude"]` and a first write naming the
first of them names a file that is not there — which the read side then reports as
`missingExtends`, breaking the save it was supposed to record.

Deriving the name from an entry's `source` instead does not work either: a present-but-empty or
comment-only file supplies no entry to derive from.

`readProvisioning` already has `anyFilePresent`; `present` is that test kept rather than reduced to
a boolean. A provider with no present file is not published at all, so `present` is non-empty
wherever it appears.

### D12: A source with no file left to name refuses the save rather than writing without one

Round 1 F002. `present` can be empty on a provider that was detected — the file was there when it
was read and gone when presence was taken, and `openProviderFile` answers `at:"root"` for every
provider at once when the root stops resolving. D11 opened that branch; this decision closes what
it leads to.

Creating `.vscode/worktree.json` with an `exclude` and no `extends` does not record one exclusion.
On the next read the native adapter is chosen (it leads `DETECTION_ORDER` and is now present),
`assemble` finds no base, and **no inherited entry is contributed at all** — the one path the user
removed becomes every path removed, in a checked-in file, silently.

So: **the document is being created, the active provider is not native, and the divergence names no
base → refuse.** An existing document is not affected, because its own `extends` is left alone.

`divergenceOf` reports the condition rather than the caller re-deriving it: it already knows it
found an active non-native provider and could not name a file for it.

### D13: A write that was refused is reported in the vocabulary of writing

Round 1 F008. `ProvisionProblem.reason` carries five values — `unreadable`, `malformed`,
`unknownKey`, `missingExtends`, `unsubstituted` — and every one of them describes a **read** going
wrong. The shipped mapping folded three write refusals onto `unreadable`, so a held lock, a target
outside the repository and a failed rename all told the user "Could not be read" about a file that
had just read fine.

One new value, `unsaved`, not four: the wire says a save was refused and nothing was written, and
`detail` carries which refusal it was. Four wire values would put the writer's internal enumeration
on the wire, where D9's own argument — that `unavailable` cannot distinguish a held lock from an
uncreatable directory — says the distinctions are not always real.

`malformed` keeps its existing meaning and stays in use for the one refusal that IS a statement
about the file's content: a document that does not parse, or that carries a wrong-shaped key.

### D14: `extends` records a source the user took, never one that merely happens to be active

Round 1 F006. Keying `extends` off the active provider is right for deciding WHICH source to name
and wrong for deciding WHETHER to name one. Pressing Configure having changed nothing wrote an
`extends`-only document — a new file in `git status`, pinning detection to a source the user never
chose to pin, indistinguishable from having taken one.

The two states are distinguishable in the form and nowhere else, so the form is what reports them:
the save carries `took`, true when a source was taken in this opening. It names no source — the
host still resolves which one from its own model, so D1 is intact — it answers only "was this a
source change".

| State | Written |
|---|---|
| A divergence to record | the divergence, and `extends` to make it meaningful |
| No divergence, `took` true | `extends` alone — the user's source change, which is spec requirement 7 |
| No divergence, `took` false | **nothing**, and the write reports `wrote: false` |

The third row is what D10's idempotence already implies and the code did not do.

### D15: The form offers no save while a switch it issued is unanswered

Round 1 A1. Taking a source posts `switch: N` and leaves the old offer drawn; a Configure pressed
before the reply mints `switch: N+1` against the OLD offer, takes the host's ceiling, records the
superseded source, and makes the in-flight switch fail its own re-check and vanish with no report.
Both halves obey D8 exactly. D8 says how a save and a switch ORDER; it does not say what the form
may offer while one is outstanding, which is the gap.

The offer on screen is superseded the moment a switch is taken, so the control is **removed** the
same way it is removed when no offer has arrived — the same statement, that there is nothing here
this save can honestly be about. The replacement offer restores it.

That is only safe if every admitted switch terminates in an offer. It does not today: the switch
path publishes nothing when `readProvisioning` rejects, which would leave the control gone for
good. So the switch path reports a failed read as a problem on the model, exactly as the save path
reports a refusal — closing a pre-existing silent-failure hole that D15 would otherwise turn into a
stuck form.

### D16: The unswappable-directory write is a separate change this one depends on

Plan attack 2 refuted three ledger rows with one defect: `LockedFile` serializes an **inode** while
every other operation names a **string**. `realpath` returns a canonical spelling, not a directory
identity, so a rename-plus-symlink at that spelling redirects the lock, the temporary, the read and
the commit — and `withLock` creates the lock before its callback, so no re-assertion inside the
callback can help. The probe also showed `/dev/fd/<dirfd>/child` is not a usable descriptor-relative
path on this host.

Closing it needs `openat`/`mkdirat`/`renameat` semantics anchored to an open directory descriptor.
That is a new invariant owner — a facility every caller of `LockedFile` inherits, not a detail of
this writer — so it is **its own change**, planned and reviewed to APPROVE independently, and this
change depends on it. Folding it in here would put a repo-wide filesystem primitive inside a task
about a configuration button.

Until it lands, `writeNativeConfig` is correct against a non-adversarial filesystem and says so:
the containment check, the symlink refusal and the mode capture all move inside the lock (F003), which
closes the ordinary races. The adversarial local-race window stays open and is recorded here rather
than claimed closed.

### D17: Presence is revalidated at the write, not trusted from the offer

Plan attack 2 refuted D12 as written. Probed: read an offer with `present: ["asimov/worktree.yaml"]`,
delete the file, save — `divergenceOf` kept the `extends`, the write succeeded, and the real re-read
answered `missingExtends` with no inherited entries. D12 only refuses an ALREADY-empty `present`, and
the live hole is disappearance **after** the snapshot.

So the base is confirmed to exist immediately before the write, inside the lock, and a base that has
gone refuses with `unnamed`. The offer's `present` selects a candidate; it never authorizes it.

### D18: "A source was taken" is derived by the host, never asserted by the form

Plan attack 2 refuted D14's `took`. Two independent failures: a webview-minted boolean is forgeable
in both directions — a false `true` recreates F006, a false `false` drops a source-only change — and
it is not a form-only fact at all, because the host admits every switch itself. Sticky-across-redraws
is also wrong for NET intent: Orca to Asimov and back writes an Orca `extends` for a form that ended
where it started.

The host records the opening's baseline source when it first offers, and compares it with the source
active at save time. Equal means no source change, whatever route the form took to get there. That is
D1 applied to the same question the rest of the message already obeys: the webview names items, the
host derives meaning. `took` does not go on the wire.

### D19: The switch invariant covers delivery of the latest live request

Plan attack 2 refuted "every admitted switch terminates in a published offer" as incompatible with
latest-wins, which deliberately publishes nothing for a superseded switch — correctly, because the
switch that superseded it will publish. Disposal and a retired opening likewise publish nothing, and
correctly, because no live form remains.

The invariant that D15 actually needs: **the latest live switch for an open form always terminates in
a DELIVERED offer.** That makes the failure to fix a delivery failure rather than a resolution one —
the switch path calls `surface.post` directly while the host has a guarded, exception-catching
delivery helper, so a throw there leaves a form with no control and no message.

## Interfaces

```ts
/** What the selection diverges to, in the vocabulary the native file has (D6). */
export interface NativeConfigDivergence {
  /** Inherited paths to add to `exclude`. */
  readonly exclude: readonly string[];
  /** Native inline paths to remove from `copy`/`link`. */
  readonly drop: readonly string[];
  /** The present file to build on, when the user took a different source. */
  readonly extends?: string;
  /**
   * An active non-native provider was found and none of its files is there (D12).
   *
   * Reported rather than re-derived by the caller: `divergenceOf` is what looked
   * for the source and failed to name one.
   */
  readonly unnamedSource: boolean;
}

export type NativeConfigWrite =
  | { readonly ok: true; readonly wrote: boolean }
  | {
      readonly ok: false;
      readonly reason: "unavailable" | "outside" | "malformed" | "unwritable" | "unnamed";
    };

/** D13 — one wire value for "the save was refused", with the cause in `detail`. */
type ProvisionProblemReason =
  | "unreadable"
  | "malformed"
  | "unknownKey"
  | "missingExtends"
  | "unsubstituted"
  | "unsaved";

/** D14 — the form's answer to "was this a source change", naming no source. */
interface WorktreeProvisionSaveMessage {
  readonly took: boolean;
}
```

## Obligation ledger

Dispositions below are the ones the plan attack established, with the mechanism amended where it
refuted the first answer.

| Claim | Semantics | Defeater | Witness | Disposition |
|---|---|---|---|---|
| Only the native file is written | For every operation, the set of paths opened for writing is a SUBSET of `{target, target.lock, target.<rand>.tmp}` — empty for a refusal or a no-op | A path taken from the model or the message; `repoId` used as a destination; **a `.vscode` swapped between the containment check and the operations that name it** | A fake fs recording every path opened for write, across both file states and the refusal and no-op paths, PLUS a real-fs case that swaps the directory for a symlink after the check and asserts nothing lands outside. Arm by restoring the second `realpath` | supported for a non-adversarial filesystem, and the adversarial case is delegated — was `refuted` by plan attack 2, which showed `realpath` pins a spelling and not an identity, and that `withLock` creates the lock before its callback. D16 makes the descriptor-anchored write its own change that this one depends on, rather than claiming a close this module cannot implement |
| A provider file is byte-identical after any save | For every detected provisioning file other than the target, bytes before = bytes after | The target is a symlink or hard link to a provider file, and an in-place write follows it | Rename rebinds the name (D3); probed against both a symlinked and a hard-linked target, and against a provider hard link appearing mid-create, which makes `commit("create")` return false | supported |
| Comments and formatting survive an edit | Every byte outside the spans `modify` returns is unchanged, AND the spans are one array element wide | Nominating a span wide enough to make the property vacuous — a whole file, or a whole array | A fixture carrying a comment INSIDE an array and arrays of more than one element; compare against spans obtained independently of the key path the implementation passes. Arm by widening the span back to the whole key | supported as narrowed — was `refuted` by plan attack 2: insertion preserves interior comments, but deleting index 1 of `/* A */ "a", /* B */ "b", /* C */ "c"` yields `/* B */ "c"`, taking a KEPT element's comment. The claim narrows to: every byte outside the removed element AND its immediate neighbour survives. Witness asserts exactly that, over a fixture with comments on both neighbours |
| A malformed configuration is never rewritten | A document with parse errors, or a wrong-shaped `exclude`/`extends`, leaves the file byte-identical | `modify` mutating a broken document and leaving it broken — probed, it does exactly that; a non-array `exclude` throws | Fixtures for both; assert byte-identity and a reported reason | supported — new row; the defeater is why D4 gained its refusals |
| The file keeps its permissions | Mode before = mode after, for an existing file | `atomicReplace(text, undefined)` staging at `0o600` — probed, a `0644` file became `0600` | Save over a `0644` fixture and assert the mode. Arm by passing `undefined` | supported — new row from the attack |
| No path the webview supplied is ever written | Every written path traces to the host-held model and the cached repository record | A forged offer id; `repoId` used as a root | `lookup` returns undefined → no write and a re-offer; the root comes from `cache.read().repos` (D1). Test both | supported — was `unresolved` on `repoId` provenance, which D1 now fixes |
| A save that fails leaves the file as it was | On any failure the target bytes are unchanged and no temporary remains | A rename that fails after the temporary is filled; a `create` whose `link` fails | `LockedFile` takes an injectable `rename`; fail it and assert the target and the directory listing. Cover the create branch too, and `discard()` in a `finally` | supported for a non-adversarial filesystem, delegated otherwise — was `refuted` by plan attack 2: after a parent rename `discard()` cannot recognise its own temporary and leaks it. Same root as row 1, same owner (D16) |
| Two saves cannot interleave | No save observes a file state another save has already superseded | Both read before either locks — serialized renames, lost update | The read is inside `withLock` (D3); test two saves whose reads are forced to overlap and assert both preferences survive | supported for a non-adversarial filesystem, delegated otherwise — was `refuted` by plan attack 2: the lock serializes an inode while the operations name strings, so a swapped parent yields two live locks. Same root as row 1, same owner (D16) |
| A save answers for the still-open form | A save never publishes over a later switch, nor into a closed form | A save in flight while a switch publishes | Save shares the switch's ordering gate (D8); test the interleaving in both directions | supported — new row from the attack |
| Repeated saves do not grow the file | Saving the same selection twice produces byte-identical files | Appending an exclusion already present | D10; two consecutive saves, byte-compared | supported |
| A first write names a source that exists | A document is created with `extends` naming a file that is there, or it is not created | An active non-native provider whose `present` is empty — the file was there at read and gone at probe, or the root stopped resolving | Round-trip through the REAL `nativeProvider`: write, read back, assert the inherited entries survive. Arm by removing the refusal | supported — was `refuted` by plan attack 2, which probed the after-the-snapshot disappearance D12 did not cover. D17 revalidates the base inside the lock immediately before the write; the offer's `present` selects a candidate and never authorizes it |
| A refusal says what happened | A refused save reports a reason that is a statement about writing, and no reason claiming the file could not be read | Folding write refusals onto `unreadable`, which the dialog's summary keys off | Assert the published problem's reason for each of the five refusals; assert the dialog renders none of them as "Could not be read". Arm by restoring the `unreadable` mapping | supported — was `refuted` by round 1 F008: a held lock, an out-of-repo target and a failed rename all said the file could not be read. D13 |
| A save records only what the user chose | Nothing is written when there is no divergence and no source was taken | Keying `extends` off `active`, which is true whenever any non-native source supplied the offer | Press Configure changing nothing, assert no file is created and `wrote: false`; then take a source, press again, assert `extends` alone. Arm by dropping `took` | supported — was `refuted` by plan attack 2 on three grounds: forgeable in both directions, derivable by the host, and wrong across a there-and-back switch. D18 derives it host-side from the opening's baseline versus the source active at save time, and `took` never reaches the wire |
| The form never saves against a superseded offer | While a switch this form issued is unanswered, no save can be issued | The switch is asynchronous and leaves the old offer drawn; the save then takes the shared ceiling and kills the switch | Take a source, assert the control is gone before the reply and back after it; assert a rejected read still publishes, so it cannot stay gone. Arm by leaving the control up | supported — was `refuted` by round 1 A1: the save recorded the source the user was leaving and the switch vanished unreported. D15 |
| A switch that fails says so | Every admitted switch terminates in a published offer, success or failure | A rejected `readProvisioning` returning from the `.then` with nothing posted | Reject the read and assert a problem is published on the model. Arm by restoring the bare return | supported as restated — was `refuted` by plan attack 2: the old wording contradicted latest-wins, which publishes nothing for a superseded switch by design. D19 restates it as delivery of the LATEST LIVE switch, and the fix is the guarded post helper rather than the direct `surface.post` |

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| `writeNativeConfig` | Writes a file the extension does not own | D5, D7 and the ledger's first two rows; the module takes a root, never a path |
| `.vscode` path resolution | Check-then-write window | Resolved once and written through the resolved path (D7) |
| `exclude` / `copy` / `link` | Grow once per unticked entry per save | Bounded by the offer's own row cap, and idempotent per D10 |
| `ProvisionProvider.present` | A new wire field consumers may not set | Non-empty by construction — a provider with no present file is not published (D11) |
| `readOnly.test.ts` | A new module in the directory silently unchecked | Its completeness check fails until the module is declared (D2) |
| Save vs switch | An earlier action overwriting a later choice | One ordering gate for both (D8) |
| Unrecordable choices | A user believing a setup tick was saved | Stated in the form before the save (D6) |
