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
   names the resolved path**. A later swap of the logical `.vscode` name cannot redirect a write
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
}

export type NativeConfigWrite =
  | { readonly ok: true; readonly wrote: boolean }
  | { readonly ok: false; readonly reason: "unavailable" | "outside" | "malformed" | "unwritable" };
```

## Obligation ledger

Dispositions below are the ones the plan attack established, with the mechanism amended where it
refuted the first answer.

| Claim | Semantics | Defeater | Witness | Disposition |
|---|---|---|---|---|
| Only the native file is written | For every operation, the set of paths opened for writing is a SUBSET of `{target, target.lock, target.<rand>.tmp}` — empty for a refusal or a no-op | A path taken from the model or the message; `repoId` used as a destination | A fake fs recording every path opened for write, asserted across all operations, both file states, and the refusal and no-op paths. Arm by passing `msg.repoId` as the root | supported — was `refuted` as an exact-set universal, which the refusal and no-op cases contradict |
| A provider file is byte-identical after any save | For every detected provisioning file other than the target, bytes before = bytes after | The target is a symlink or hard link to a provider file, and an in-place write follows it | Rename rebinds the name (D3); probed against both a symlinked and a hard-linked target, and against a provider hard link appearing mid-create, which makes `commit("create")` return false | supported |
| Comments and formatting survive an edit | Every byte outside the spans `modify` returns is unchanged | Nominating a whole-file span, so the property holds vacuously; or calling `format()` | Compare against spans obtained independently from `modify`, not from the implementation. Arm by re-serializing a parsed value | supported — the claim is narrowed to this; D4 records what happens inside the span |
| A malformed configuration is never rewritten | A document with parse errors, or a wrong-shaped `exclude`/`extends`, leaves the file byte-identical | `modify` mutating a broken document and leaving it broken — probed, it does exactly that; a non-array `exclude` throws | Fixtures for both; assert byte-identity and a reported reason | supported — new row; the defeater is why D4 gained its refusals |
| The file keeps its permissions | Mode before = mode after, for an existing file | `atomicReplace(text, undefined)` staging at `0o600` — probed, a `0644` file became `0600` | Save over a `0644` fixture and assert the mode. Arm by passing `undefined` | supported — new row from the attack |
| No path the webview supplied is ever written | Every written path traces to the host-held model and the cached repository record | A forged offer id; `repoId` used as a root | `lookup` returns undefined → no write and a re-offer; the root comes from `cache.read().repos` (D1). Test both | supported — was `unresolved` on `repoId` provenance, which D1 now fixes |
| A save that fails leaves the file as it was | On any failure the target bytes are unchanged and no temporary remains | A rename that fails after the temporary is filled; a `create` whose `link` fails | `LockedFile` takes an injectable `rename`; fail it and assert the target and the directory listing. Cover the create branch too, and `discard()` in a `finally` | supported — was `unresolved` for covering only the existing-file branch |
| Two saves cannot interleave | No save observes a file state another save has already superseded | Both read before either locks — serialized renames, lost update | The read is inside `withLock` (D3); test two saves whose reads are forced to overlap and assert both preferences survive | supported — was `refuted`; the commit-only lock scope was the defect |
| A save answers for the still-open form | A save never publishes over a later switch, nor into a closed form | A save in flight while a switch publishes | Save shares the switch's ordering gate (D8); test the interleaving in both directions | supported — new row from the attack |
| Repeated saves do not grow the file | Saving the same selection twice produces byte-identical files | Appending an exclusion already present | D10; two consecutive saves, byte-compared | supported |

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
