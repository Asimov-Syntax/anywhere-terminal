# Design: materialize-declared-files-into-a-new-worktree

> Mechanism and risk. Why → proposal.md. External behavior → specs/worktree-panel/spec.md.
> Authority for the steps and their refusals: [worktree-apply.md](../../../docs/design/worktree-apply.md) § 1, § 2.1, § 2.2, § 3.

## Where this runs

```
worktreeCreate (webview)          WorktreeHost                     worktreeMutationService
  { …, provision? }        ──▶  offers.lookup(key, offerId)  ──▶  createWorktree(request)
                                        │                              │
                                 resolve ids → entries                 ├─ git worktree add        ✓
                                 (host model, never the wire)          ├─ addToGitExclude
                                        │                              ├─ applyEntries(…)   ◀── D1
                                        └──────────────────────────────┤     copy → link
                                                                       ├─ afterCreate (terminal/agent)
                                                                       └─ report ok
                                 post worktreeProvisionResult  ◀───────  steps[]
```

## Decisions

### D1 — Apply runs inside the create body, before `afterCreate`

The seam is `worktreeMutationService.ts:891-920`, between `addToGitExclude` and `afterCreate`.

Before `afterCreate` because `afterCreate` opens a terminal or launches an agent **into the new
worktree**, and the entire point of copying `.env` is that whatever starts there can read it. An
agent launched into a worktree whose config has not landed yet is the defect this task exists to
remove, arriving one step later.

Inside the create body, not after it, because the body already holds the per-repository mutation
queue. A create that released the queue and then wrote files would let a removal of the very
worktree it is provisioning interleave with the writes.

`afterCreate`'s existing rule is the rule apply adopts: *the worktree is already made; whatever this
rejects with, it reports as something that did not happen — it never unmakes it.*

### D2 — The entries come from the host's stored model, never from the wire

`WorktreeCreateRequestMessage` grows `provision?: ProvisionSelection` — an offer id and a list of
opaque item ids, which is what [worktree-rpc.md](../../../docs/design/worktree-rpc.md) § 2.4 already
specifies. The host resolves it against `ProvisionOfferStore.lookup(key, offerId)`, filters the
model's `entries` to the selected ids, and passes **resolved `ProvisionEntry` values** to the
service.

The service's request therefore carries entries, not ids, and holds no reference to the store. The
property being preserved is `offerStore.ts`'s own: *nothing executes that the user has not seen*.
A path arriving on the wire, or a re-read of the provider file after submit, would both break it —
so neither is representable at this seam rather than validated at it.

`lookup` is already surface-scoped, so a create cannot redeem another window's offer.

### D3 — An offer the host no longer holds refuses the create, and stops there

§ 2.4 requires **no create and no provisioning** for an unknown, evicted, or foreign `offerId`. That
half is built here: the host refuses the create with a stated reason, on the existing
`worktreeMutationResult` error arm.

§ 2.4's other half — *resolve a fresh model, present it, require a second submission* — is **not**
built here and is not silently dropped. It is a re-read plus a dialog re-render, which is the
provisioning UI's owner and not this task's; WT-012.2's Acceptance contains no clause about it.
Recorded as a follow-up needing its own PLAN task. Until it lands, the user's recovery is to reopen
the dialog, which is a worse experience than § 2.4 promises and a strictly safer one than honouring
a stale offer.

A create carrying **no** `provision` field at all is not an error — it is every create made before
this feature existed, and it provisions nothing.

### D4 — Two roots, validated separately, resolved

Source root is the **main checkout**. Destination root is the **new worktree**. Every entry is
checked against both, separately, using `isResolvedPathInside`
(`src/utils/resolvedPathBoundary.ts`) because the answer authorizes a filesystem read or a write
(DESIGN.md § 9 D31) — the lexical `isPathInside` cannot see a symlinked component.

Separately, not once, for the reason § 2.1 gives: one "inside the repository" test accepts a source
that is really a destination, and a destination whose existing parent resolves out of the worktree.

This module defines no containment predicate of its own. The acceptance for that is mechanical:
`rg -n 'function isPathInside' src/` finds nothing outside `src/utils/pathBoundary.ts`, and
`isResolvedPathInside` nothing outside `src/utils/resolvedPathBoundary.ts`.

### D5 — Never-overwrite is the write primitive's job, not a pre-check's

Each file is created with `copyFile(src, dest, COPYFILE_EXCL)`; each directory level with a
non-recursive `mkdir` whose `EEXIST` is caught and treated as "already there, keep walking"; each
symlink with `symlink`, which fails `EEXIST` on its own.

A pre-flight `exists()` followed by a write is two observations with a window between them. The
exclusive primitive has no window: it either created the thing or it did not, and it tells you
which. This is also what makes "never overwrite" true for **every descendant** rather than the
top-level name — there is no separate descendant rule to forget, because every descendant is
written by the same exclusive call.

`EEXIST` from any of them is a **skip**, reported, and the walk continues to the entry's siblings.

### D6 — The walk never follows a symlink it did not check

Every node is read with `lstat`, which does not follow. From its type:

- **regular file** → copy, mode bits preserved, ownership never.
- **directory** → `mkdir` then recurse.
- **symlink** → `readlink`; resolve the target; inside the repository → recreate it as a symlink with
  the same relative target; outside → refuse and report. Recursive symlinks therefore terminate the
  walk instead of expanding it, because a link is never walked *through*.
- **anything else** — device, socket, FIFO → refuse and report. Not configuration, and never what a
  provider meant.

### D7 — Link is relative, and degrades rather than lies

A link entry becomes a relative symlink from the worktree to the main checkout. Relative so the pair
survives being moved together.

`EPERM` / `ENOSYS` / `UNKNOWN` from `symlink` is the platform saying it has no symlink to give
(Windows without Developer Mode or elevation). The entry then copies instead, and the result says
`degradedToCopy`. Not a failure — the user gets the material — and not a silent success either, since
a link and a copy differ in a way the user was told about in the dialog: a link writes through to the
main checkout.

The refusals are checked **before** the mode is honoured, so they hold identically for copy and link:
a lockfile is refused either way, and `node_modules` is refused as a link.

### D8 — The result contract

`ProvisionStepResult` is referenced at [worktree-rpc.md](../../../docs/design/worktree-rpc.md) § 2.2
line 115 and **defined nowhere in `src/`**. It is minted here, with `worktreeProvisionResult`:

```ts
export type ProvisionStepOutcome =
  | { readonly kind: "copied" }
  | { readonly kind: "linked" }
  /** Asked to link; the platform had no symlink to give, so the content was copied (D7). */
  | { readonly kind: "degradedToCopy" }
  /** Destination already existed. Nothing was written and nothing was replaced (D5). */
  | { readonly kind: "skipped"; readonly reason: string }
  /** A rule forbade it: containment, a special file, a lockfile, node_modules as a link (D4, D6, D7). */
  | { readonly kind: "refused"; readonly reason: string }
  /** It was allowed and it did not work. */
  | { readonly kind: "failed"; readonly reason: string };

export interface ProvisionStepResult {
  /** The offer item this answers. Opaque, per-offer — never a path (offerStore.ts). */
  readonly id: string;
  /** Repo-relative POSIX path, for display. Echoed from the host's own entry. */
  readonly path: string;
  readonly outcome: ProvisionStepOutcome;
}

export interface WorktreeProvisionResultMessage {
  type: "worktreeProvisionResult";
  worktreeId: string;
  steps: readonly ProvisionStepResult[];
}
```

`refused` and `failed` are distinct arms because they are distinct answers: refused means the
extension decided not to, and the reason is a rule the user can act on; failed means it tried. Both
are reported, and `skipped` is neither — nothing was wrong and nothing was replaced.

`reason` is bounded, already-safe display text, following `ProvisionProblem.detail`'s rule: parser
and errno text is quoted, never interpreted.

### D9 — A partially copied directory is reported, not rolled back

Rejected: unwinding a directory copy that failed halfway. Two reasons, either sufficient. It would
mean deleting files inside a worktree that already exists, which is the one thing this subsystem's
I10 gate exists to keep out of these paths. And the Acceptance is explicit that a failed entry leaves
the worktree *and every earlier entry* standing — an unwind would remove work the user was told
succeeded.

So a directory entry whose walk fails partway reports `failed` with the reason, and the files already
written stay. This is stated rather than hidden: the ledger carries it as its own row.

## Obligation ledger

| Claim | Semantics | Defeater | Witness / check | Disposition |
|---|---|---|---|---|
| No write lands outside the new worktree | Every path passed to a create primitive resolves inside the worktree root, checked immediately before that call | An entry whose parent directory is a symlink pointing out of the worktree, created between validation and write; a `..` entry; an absolute entry | D4's `isResolvedPathInside` against the destination root, plus D5's exclusive primitives so validation and write are not separated by an observation. Tests: `../` entry refused; absolute entry refused; an entry whose destination parent is a symlink out of the worktree refused | supported |
| No source is read from outside the main checkout | Every source path resolves inside the main checkout, by the same resolved predicate against a **different** root | One containment test reused for both roots, which accepts a source that is really a destination | D4's two separate roots. Test: a source resolving into the new worktree, and a source resolving outside the main checkout, are both refused | supported |
| A symlinked component cannot smuggle a read or a write out | The walk resolves every symlink it meets and refuses the ones landing outside; it never traverses one | Dereferencing a symlink during the walk, which turns an out-of-repo target into an in-repo copy of foreign content | D6's `lstat`-then-`readlink`, never a following stat. Tests: an in-repo symlink is recreated as a symlink; an out-of-repo symlink is refused; a symlink loop terminates rather than recursing | supported |
| Nothing existing is replaced, at any depth | For every destination node, either it did not exist and this created it, or it existed and this wrote nothing to it | A recursive copy that checks only the top-level name; an `exists()` pre-check with a write after it | D5. The exclusive primitive IS the check, so no depth is exempt. Tests: existing top-level destination skipped; a directory copy into an existing directory holding one of the same filenames skips that file and copies its siblings | supported |
| Nothing the webview supplied reaches the filesystem | The service's create request carries `ProvisionEntry` values the host read from its own store; no wire field can name a path or a command | A `path` field added to the selection; a re-read of the provider file after submit; a global (unscoped) offer lookup letting one window redeem another's model | D2. `ProvisionSelection` has no path-bearing field, and `lookup` is surface-scoped. Test: a create citing an id absent from the host's model materializes nothing for it | supported |
| A failed entry costs the user nothing but that entry | The worktree, and every entry materialized before the failure, are left in place | An unwind on failure; an exception escaping into the create's own result | D1's report-never-unmake rule and D9. Tests: one entry fails and the create still reports ok with earlier entries present; every entry fails and the worktree still exists | supported |
| A refused entry is never silently adjusted into an allowed one | A refusal produces a `refused` step and zero filesystem operations for that entry | Clamping an escaping path back under the root, or trimming its `..` segments | D4 and D8's `refused` arm. Test: an escaping entry produces a `refused` step and no destination node is created for it | supported |
| The material-class refusals hold whichever mode asked | Lockfile refused for copy and for link; `node_modules` refused as a link | Checking the rule inside the copy branch only, so the link branch walks past it | D7 checks refusals before dispatching on mode. Tests: lockfile as copy and as link both refused; `node_modules` as link refused | supported |
| A directory copy that fails partway leaves partial content | — | Files already written when the walk fails remain, and the entry reports `failed` | **Not a claim this change makes, and deliberately so.** D9 rejects the unwind: it would mean deleting inside a live worktree, which is what the I10 gate keeps out of these paths, and the Acceptance requires earlier work to stand. Named rather than dressed as atomic | n/a — accepted and reported; per-entry atomicity is not offered |
| Provisioning does not delay or deadlock the create | Apply runs inside the create's existing queue slot and adds no lock | An unbounded walk holding the per-repository mutation queue while the user waits to remove something | Apply runs where `afterCreate` already runs, inside one queue slot, and takes no second lock. The walk is bounded by what the provider declared and the user selected — both finite lists the user was shown | supported |
| § 2.4's stale-offer contract is met in full | — | A stale `offerId` refuses the create but does NOT resolve a fresh model or re-present it | **Refuted as stated, and scoped down deliberately.** D3 builds the refusal half; the re-present half is the provisioning UI's owner and is not in WT-012.2's Acceptance. Recorded as a follow-up PLAN task rather than left implicit | n/a — the safety half is built; the recovery half is a named follow-up, and the interim recovery is reopening the dialog |
