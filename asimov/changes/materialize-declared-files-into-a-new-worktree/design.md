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

**And it adopts the mechanism, not only the sentiment.** `afterCreate` has its own local `.catch()`
(`worktreeMutationService.ts:905-910`). Without an equivalent around apply, a rejection — an `EIO` from
`readdir`, a bug in the walk — falls through to the create body's outer rejection arm at
`worktreeMutationService.ts:920-925`, which reports a **successful git create as a create error**. The
plan attack established this by reading the real seam, and it defeats the whole point of the step. Apply
is therefore wrapped so that no rejection can reach that arm: an escaping throw becomes a `failed` step,
never a failed create.

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

Each root is prepared once with `prepareResolvedRoot` and reused through `isResolvedPathInsideRoot`
across every candidate, which is what that module's own contract asks for
(`resolvedPathBoundary.ts:49-57,139-149`); the single-shot `isResolvedPathInside` is for one-off
questions and re-resolves the root per call.

This module defines no containment predicate of its own. The acceptance for that is mechanical:
`rg -n 'function isPathInside' src/` finds nothing outside `src/utils/pathBoundary.ts`, and
`isResolvedPathInside` nothing outside `src/utils/resolvedPathBoundary.ts`.

### D5 — Openat is not available, so the write path is no-follow where it can be and honest where it cannot

The first draft said "the exclusive primitive IS the check, so no depth is exempt". The plan attack
refuted it with a schedule worth writing down, because the fix is partial and the residual is real:

> validate the absent destination `/wt/cfg/secret`; create `/wt/cfg`; something replaces `cfg` with a
> symlink to `/outside`; `copyFile(…, COPYFILE_EXCL)` then follows the **intermediate** component and
> creates `/outside/secret`.

`COPYFILE_EXCL` refuses an existing **final** component — a file, a directory, a live symlink, even a
dangling one. It says nothing about the components above it. POSIX's answer is `openat` on a directory
handle; Node exposes no `openat`, so a walk written in Node cannot make intermediate components
race-free. What it can do:

- **Final destination component, no-follow.** `open(dest, O_WRONLY | O_CREAT | O_EXCL)` — `O_EXCL` with
  `O_CREAT` refuses to follow a final symlink, by POSIX. Write through the fd. `EEXIST` is a skip.
- **Final source component, no-follow.** `open(src, O_RDONLY | O_NOFOLLOW)`, then `fstat` **that fd** and
  copy from it. This closes the second refuted row exactly: a source that becomes a symlink between
  `lstat` and open now fails `ELOOP` instead of being read through. `copyFile` cannot do this, so the
  copy is fd-to-fd rather than `copyFile`.
- **Every intermediate component, re-checked at descent.** Each directory level is created by
  non-recursive `mkdir`; on `EEXIST` it is `lstat`-ed and must be a real directory — a symlink there is
  a refusal, not a traversal — and the walk descends only after that check.
- **Directories we open, not paths we re-resolve.** The walk carries the parent's own `fs.Dir`/fd where
  the platform gives one, so descent does not re-resolve a pathname it already validated.

**The residual, named rather than buried.** Between the `lstat` of an intermediate directory and the
`open` beneath it there is a window no Node primitive closes. Defeating it requires a local process
writing inside a directory git created seconds earlier, racing a walk it cannot observe. It is a ledger
row, not a claim.

### D6 — A recreated symlink is validated where it will live, not only where it was found

The plan attack's second construction: an in-repo relative symlink can escape after relocation.

> `/repo/alias → deep/a/b`; entry `alias/tree`; `/repo/deep/a/b/tree/link → ../../../inside.txt`, which
> resolves to `/repo/deep/inside.txt` — inside. Recreate that same relative target at
> `/wt/alias/tree/link` and it resolves to `/inside.txt` — outside.

Validating at the source alone admits the escape; validating at the destination alone wrongly refuses a
source link that really is inside. So **both**, and the entry is refused unless both hold:

1. the target resolved from the symlink's **source** directory is inside the main checkout, and
2. the same target resolved from the symlink's **destination** directory is inside the new worktree.

Otherwise the walk dispatches on `lstat`, which does not follow:

- **regular file** → the no-follow fd copy of D5, mode bits preserved, ownership never.
- **directory** → `mkdir`, verify, recurse.
- **symlink** → the two-sided check above; recreated with its original relative target when it passes.
  A link is never walked *through*, so loops terminate rather than expanding.
- **anything else** — device, socket, FIFO → refused. Not configuration, and never what a provider meant.

### D7 — Link is relative, and degrades rather than lies

A link entry becomes a relative symlink from the worktree to the main checkout. Relative so the pair
survives being moved together.

**D6's destination-side rule does NOT apply to it, and an earlier draft of this paragraph said it
did.** That rule requires a target to resolve inside the worktree, and a link entry points at the
main checkout — leaving the worktree is the entire thing it is for. Applied here it would refuse
every link this decision exists to create. What the entry gate already established is what governs:
the target is inside the main checkout, and the link's own location is inside the worktree. D6 governs
symlinks *encountered while walking a source tree*, where nothing intends to leave.

`EPERM` / `ENOSYS` / `UNKNOWN` from `symlink` is the platform saying it has no symlink to give (Windows
without Developer Mode or elevation). The entry then copies instead and reports `degradedToCopy` — not a
failure, since the user gets the material, and not a silent success either, because a link and a copy
differ in the way the dialog told them about: a link writes through to the main checkout. Every other
`symlink` error is `failed`, never quietly degraded.

Refusals are checked **before** mode is consulted, so they cannot diverge between copy and link.

### D8 — The result contract

`ProvisionStepResult` is referenced at [worktree-rpc.md](../../../docs/design/worktree-rpc.md) § 2.2
line 115 and **defined nowhere in `src/`**. It is minted here, with `worktreeProvisionResult`:

```ts
export type ProvisionStepOutcome =
  | { readonly kind: "copied" }
  | { readonly kind: "linked" }
  /** Asked to link; the platform had no symlink to give, so the content was copied (D7). */
  | { readonly kind: "degradedToCopy" }
  /** Nothing was written and nothing was replaced — the destination was already there (D5). */
  | { readonly kind: "skipped"; readonly reason: string }
  /** A rule forbade it: containment, a special file, a lockfile, node_modules as a link. */
  | { readonly kind: "refused"; readonly reason: string }
  /** It was allowed and it did not work. */
  | { readonly kind: "failed"; readonly reason: string };

export interface ProvisionStepResult {
  /** The offer item this answers. Opaque, per-offer — never a path (offerStore.ts). */
  readonly id: string;
  /** Repo-relative POSIX path, for display. Echoed from the host's own entry. */
  readonly path: string;
  readonly outcome: ProvisionStepOutcome;
  /**
   * Descendants of a directory entry that were skipped or refused, and why.
   *
   * A directory entry has ONE outcome but many nodes, and the spec requires the
   * file inside an existing destination to be reported — which a single
   * top-level `copied` cannot express. Bounded and display-ready; empty for a
   * file entry.
   */
  readonly details?: readonly { readonly path: string; readonly reason: string }[];
}

export interface WorktreeProvisionResultMessage {
  type: "worktreeProvisionResult";
  worktreeId: string;
  steps: readonly ProvisionStepResult[];
}
```

`refused` and `failed` are distinct answers: refused means the extension decided not to and the reason
is a rule the user can act on; failed means it tried. `reason` is bounded, already-safe display text,
following `ProvisionProblem.detail`'s rule — errno and parser text is quoted, never interpreted.

**A lockfile is `refused`, and this contradicts a design doc.**
[worktree-apply.md](../../../docs/design/worktree-apply.md) § 2.1 and its § 4 table both say *skipped*.
`docs/PLAN.md` WT-012.2's Acceptance says *refused with its reason*, and PLAN is the task contract. The
doc predates the `refused`/`skipped` distinction this decision mints, under which *skipped* means
nothing was wrong and nothing was replaced — which is not what declining a lockfile is. PLAN wins; the
doc is corrected at Blueprint Sync.

### D9 — A partially copied directory is reported, and a reader can see it mid-write

Rejected: unwinding a directory copy that failed partway. It would mean deleting inside a worktree that
already exists — the one thing the I10 gate keeps out of these paths — and the Acceptance is explicit
that a failed entry leaves *every earlier entry* standing.

The plan attack was right that calling this "not a claim this change makes" was a dodge. It is a claim,
and it carries a consequence the first draft did not name: apply runs before `afterCreate` (D1), so an
agent launched into the worktree can read a file this walk is still writing, or one whose directory
entry later failed. Per-file atomicity would need a temp-then-`link`-then-`unlink` dance, and `unlink`
is a deletion primitive in a module the I10 gate scans. Not worth that trade. Both facts are ledger
rows, and the second is a genuine residual rather than a claim.

### D10 — The walk is bounded, because a selected list is not

"A finite list the user was shown" bounds the number of *entries*, not the number of files under one of
them. One selected directory with a million descendants would hold the per-repository mutation queue —
delaying `afterCreate`, the create result, and any removal queued behind it.

So the walk carries a budget: a node count, a total byte cap, and a wall-clock deadline built from
`afterDelay` in `src/worktree/deadline.ts`, which this repo already uses for exactly this shape of
bound. Exceeding any of them stops **that entry**, reports it `failed` with which budget it hit, and
leaves the remaining entries to run. It never fails the create.

## Obligation ledger

Eleven rows. The plan attack refuted four and defeated the `n/a` on a fifth; every one of those is
rewritten below against what the mechanism can actually hold, with the residual named where the fix is
partial. A row that once read `supported` and now reads `n/a` says so and says why.

| Claim | Semantics | Defeater | Witness / check | Disposition |
|---|---|---|---|---|
| No write lands outside the new worktree, by any path this walk can control | Final destination components are created no-follow; every intermediate component is `lstat`-verified as a real directory before descent; every candidate is checked against the prepared worktree root | `open(O_CREAT\|O_EXCL)` refuses a final symlink, so the defeater is an INTERMEDIATE one: validate `/wt/cfg/secret`, create `/wt/cfg`, have something replace `cfg` with a symlink to `/outside`, then write | D4 + D5. Tests: `../` and absolute entries refused; an entry whose destination parent is a symlink out of the worktree refused at the descent check; a final destination that is a symlink refused rather than written through | supported — for final components and for every intermediate the walk observes |
| The intermediate-component window is closed | — | Between the `lstat` of an intermediate directory and the `open` beneath it, a local process can swap that directory for a symlink | **Not a claim this change makes.** POSIX closes it with `openat` on a directory handle; Node exposes no `openat`, so no walk written in Node can. D5 shrinks it to that one window and states it. Reaching it requires a local process writing inside a directory git created seconds earlier, racing a walk it cannot observe | n/a — unclosable in Node; named rather than implied by the row above |
| No source is read from outside the main checkout | The source's final component is opened `O_NOFOLLOW` and `fstat`-ed on that fd, so the bytes copied come from the object the check passed | `lstat` says regular file; the file is replaced by a symlink to `/outside/secret` before the open; a following `copyFile` reads the foreign file | D5's fd-to-fd copy. `copyFile` cannot express `O_NOFOLLOW`, which is why the copy is not `copyFile`. Test: a source swapped to a symlink between stat and open fails `ELOOP` rather than copying | supported |
| A symlinked component cannot smuggle a read or a write out | A recreated symlink's target must resolve inside the main checkout **from its source directory** and inside the worktree **from its destination directory** | An in-repo relative link relocated to a different depth: `/repo/alias → deep/a/b`, entry `alias/tree`, link `../../../inside.txt` — inside at the source, `/inside.txt` at the destination | D6's two-sided check. Tests: the relocation construction above is refused; an in-repo link at equal depth is recreated as a symlink; an out-of-repo link is refused; a loop terminates because links are never traversed | supported |
| Nothing existing is replaced, at any depth | For every destination node, either it did not exist and this created it, or it existed and this wrote nothing to it | A recursive copy checking only the top-level name; an `exists()` pre-check with a write after it | D5's exclusive primitives, which refuse an existing file, directory, live symlink or dangling symlink alike, so no depth is exempt. Tests: existing top-level destination skipped; a directory copy into an existing directory holding one of the same filenames skips that file and copies its siblings | supported |
| A type mismatch at the destination is reported, not walked into | `EEXIST` from `mkdir` is followed by an `lstat`: a real directory continues the walk, a file or a symlink stops that subtree and reports it | `mkdir` returns `EEXIST` for a destination FILE and the walk keeps going, so children fail `ENOTDIR` with no useful reason; or `EEXIST` for a symlink to a directory and the walk writes descendants through it | D5's descent check, which is the same check the containment row leans on. Tests: source directory over destination file reports that subtree, not `ENOTDIR` on its children; source directory over a destination symlink-to-directory refuses rather than following | supported |
| The report can express what happened inside a directory entry | A directory entry carries one outcome plus per-descendant `details` for what was skipped or refused | One outcome per top-level entry, which cannot say "this descendant was skipped and its siblings were copied" while the spec requires that file to be reported | D8's `details`. Test: a directory copy with one pre-existing descendant reports `copied` with that descendant named in `details` | supported |
| Nothing the webview supplied reaches the filesystem | The service's create request carries `ProvisionEntry` values the host read from its own store; no wire field can name a path or a command | A path field on the selection; a re-read of the provider file after submit; an unscoped lookup letting one window redeem another's model; a setup-step id passing as an entry id | D2. Surface identity is host-minted (`WorktreeHost.ts:906-915`), the key includes `repoId`, `lookup` requires both (`offerStore.ts:132-136`), and `remint` draws entries, ports and setup from ONE sequence (`offerStore.ts:91-99`) so the id spaces cannot collide. Test: a create citing an id absent from the host's model materializes nothing for it | supported |
| A failed entry costs the user nothing but that entry | The worktree, and every entry materialized before the failure, are left in place; the create still reports `ok` | An apply **rejection** rather than a returned step: it falls to the create body's outer arm (`worktreeMutationService.ts:920-925`) and reports a successful git create as a create error | D1's local catch, modelled on `afterCreate`'s at `:905-910`. Tests: an apply that REJECTS still yields `ok` with a `failed` step — a fake returning a failed result does not exercise this and is not the witness; one entry fails and earlier entries remain; every entry fails and the worktree still exists | supported |
| A refused entry is never silently adjusted into an allowed one | A refusal produces a `refused` step and zero filesystem operations for that entry | Clamping an escaping path back under the root, or trimming its `..` segments | D4 and D8's `refused` arm. Test: an escaping entry produces a `refused` step and no destination node is created for it | supported |
| The material-class refusals hold whichever mode asked | Lockfile refused for copy and for link; `node_modules` refused as a link | Checking the rule inside the copy branch only, so link walks past it | D7 checks refusals before dispatching on mode. Tests: lockfile as copy and as link both refused; `node_modules` as link refused. The `refused`-vs-`skipped` wording conflict with worktree-apply.md § 2.1 is settled in D8 and corrected at Blueprint Sync | supported |
| A partially copied directory leaves partial content, and a launched agent can see it | Files written before a walk failed remain, and the entry reports `failed`; apply runs before `afterCreate`, so a launched agent can read a file mid-write or a directory left incomplete | — | **A real claim, not an exemption** — the first draft called this "not a claim this change makes" and the plan attack was right to reject that. D9 states both halves. Per-file atomicity needs temp-then-`link`-then-`unlink`, and `unlink` is a deletion primitive in a module the I10 gate scans | n/a — accepted and reported; per-entry atomicity is not offered, and the mid-write window is stated rather than closed |
| Provisioning does not delay the create or what is queued behind it | Every walk stops at a node count, a byte cap, or a wall-clock deadline, whichever comes first | A finite list of ENTRIES does not bound the descendants of one of them: a single selected directory with a million files holds the per-repository mutation queue, delaying `afterCreate`, the create result, and any removal behind it. A tree growing during the walk extends it further | D10's budget, built on `afterDelay` (`src/worktree/deadline.ts`), which this repo already uses for this shape of bound. Tests: a walk exceeding the node budget reports `failed` naming the budget and the remaining entries still run; a walk exceeding the deadline does the same | supported |
| § 2.4's stale-offer contract is met in full | — | Two halves are missing, not one. § 2.4 requires (a) a fresh model resolved and re-presented after a stale id, and (b) refusal when the provider files changed underneath a STILL-HELD offer — and `lookup` (`offerStore.ts:132-136`) compares key and id only, carrying no version, timestamp or content identity | **Refuted as stated, and scoped down deliberately.** D3 builds the refusal for an unknown or evicted id, which is the safety half: it happens before the service is called, so no filesystem state is left inconsistent, and a held offer still executes only the model the user was shown. Neither missing half is in WT-012.2's Acceptance; both are recorded as a follow-up PLAN task | n/a — the safety subset is built; the refresh contract is a named follow-up, and the interim recovery is reopening the dialog |
