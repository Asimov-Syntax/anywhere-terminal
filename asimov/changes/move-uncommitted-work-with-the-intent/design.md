# Design: move-uncommitted-work-with-the-intent

Blueprint: docs/PLAN.md task WT-012.10. Design ref: docs/design/worktree-create.md § 4, § 6.

## Context

Offer to move one explicitly identified worktree's uncommitted changes into a newly created checkout,
after git succeeds and before provisioning or launch. The mechanism remains the built-in Git
extension's `Repository.migrateChanges`; this change does not reproduce its stash/apply operation.

The plan attack disproved the original unconditional failure guarantee. In VS Code 1.130 the API
returns only `void`, creates the source stash before entering its recovery `try`, and may reject after
showing a conflict warning when restoring the source also fails. It exposes neither the stash identity
nor a typed "already reported" outcome. At Gate 1 the user chose the indeterminate contract: keep
`migrateChanges`, preserve the created worktree, stop later steps, and report that source and
destination may need inspection instead of claiming restoration or single-report ownership.

## D1 — Use the Git extension call exactly

The call is made on the destination repository with the source worktree path:

```ts
await destination.migrateChanges(sourcePath, {
  confirmation: false,
  deleteFromSource: true,
  untracked: true,
});
```

The unchecked form row supplies consent, so `confirmation` is false. `deleteFromSource` makes this a
move rather than a copy, and `untracked` includes new files.

`src/providers/git.ts` vendors optional `Repository.migrateChanges` and `API.openRepository` with the
upstream signatures. They stay optional because `engines.vscode` starts at 1.105 while the behavior
was verified in 1.130. An editor without either method gets no offer and creates normally.

A second Gate 1 choice accepted the API's final TOCTOU boundary: the host rechecks source identity and
snapshot immediately before calling, but cannot prevent another process changing bytes or `.git`
before the Git extension creates its stash. The row authorizes the source work present when Git runs;
the displayed count is a current snapshot, not an atomic write-set guarantee. Observable drift makes
the result indeterminate.

## D2 — Failure is indeterminate; success needs correlated evidence

The Git extension can resolve `void` after success, overlap refusal, or handled conflict. A zero source
count alone does not prove which occurred because another actor can commit or discard the source while
the API runs.

The host therefore retains an exact source snapshot, not only its displayed count. The snapshot holds
each porcelain record's current and original path plus the current filesystem state of every affected
path: absent, or a bounded hash over kind, mode, symlink target or file bytes. A rename keeps both path
names even though the form counts the record once. Immediately before the API call the source snapshot
must still match and the destination must be clean.

Each pre-call and post-call snapshot is bracketed by source and destination evidence reads; both evidence
reads must equal the retained incarnations. Before the call, source and destination must also resolve to the
same common-repository path and identity retained from the selected repository registration. After a resolved
call, `moved` requires those stable observed identities, an empty source status, and a destination snapshot equal to the issued source snapshot's
expected working-tree state, with no unmerged record. Thus a no-move API exit followed by unrelated
path-name changes is not success; another actor reproducing the same bytes, modes, links and absences in
the same observed checkouts has established the observable destination state the user asked for.

Every other resolved state, every rejection, every failed read, every changed pre-call snapshot, and any
observable post-call source or destination identity change is `indeterminate`. The correlated snapshot
and identities prove the observable result within D8's accepted path-based observation boundary, not
which internal API exit produced it.

Indeterminate keeps the created worktree, runs no later step, and directs the user to inspect source,
destination, and Git stashes. It does not say the work was restored, did not move, or exists in only
one place. The Git extension may already have warned; its API cannot reveal that fact, so the accepted
contract does not promise exactly one report.

## D3 — Bind a cryptographic offer to source incarnation and snapshot

A repository id is not a source worktree id. `openCreateFor(info)` retains the clicked normalized
`WorktreeInfo.id`; that id is the host-held operational source path, while Git's raw `displayPath` remains
presentation-only. Repository-level and toolbar doors have no unique source and offer no migration row.
Switching the form to another repository also removes the row rather than substituting a checkout.

A cache generation is not an incarnation: every forced observation advances it, including the rebuild
a queued create must perform. Repository resolution instead captures an `AuthorizedDirectory` for the
normalized common directory before listing worktrees and revalidates it after the listing. The cache stores
the successful listing's generation and registration in the same internal repository record;
`WorktreeRepo`, the tree broadcast, and the webview never receive filesystem identities. When any current folder successfully resolves a repository, that one current root is canonical for every
folder association and order entry naming the same `repoId`; an earlier failed folder remembers that current
root rather than preserving an older registration. When no same-repository folder resolves, every still-open
failed folder keeps its remembered canonical association so closing one duplicate cannot drop the retained
group. These retained roots exist only for display, ordering, watches, and later repo-scoped discovery.

The cache stores a successful listing's registration beside its generation and `registrationFor` reads both
from that same record rather than joining public state to retained root order. A repo-scoped observation while
the whole tree says Git is unavailable may refresh retained display data, but stores no generation or
registration authority; private lookup independently refuses while Git is unavailable. A whole-tree rebuild
may establish a new registration, while a repo-scoped rebuild must retain and revalidate the existing one.
Missing or changed evidence makes the listing degraded and migration-ineligible rather than minting authority
over retained rows.

`openCreateFor(info)` freezes both the normalized row id and its public repository generation. The opening
request returns only those opaque identities to the host. In the same synchronous turn, before starting the
source probe, the host requires that generation still names the current non-degraded public group and
snapshots its private cached registration. A whole-tree rebuild that installed another registration therefore
also installed another generation and cannot silently retarget an already selected row; a repo-scoped rebuild
may advance the generation but retains and revalidates the same private registration. A group with no
authoritative generation or registration receives no migration offer.

The host requires the snapshotted registration still be current when the probe resolves, at redemption, and
immediately before enqueueing create. After the mutation coordinator's forced repo rebuild, the mutation body
asks a narrow host binding for the cache's current migration registration before `git worktree add`. Every
checkpoint derives authority from the currently published generation and its paired registration, never from
retained `rootFor` identity. This allows a repo-scoped generation advance that revalidated the same
registration, while refusing retained, degraded, Git-unavailable, or otherwise generation-less groups. The source probe captures the existing source
`AuthorizedDirectory` component identities plus the `.git` entry's no-follow identity. A remove-and-recreate,
common-directory replacement, or registration replacement changes one of those identities even when path,
branch, commit and changed files repeat.

The probe receives the selected registration, normalized source id, and row's `main | linked` role. A main
source must be an ordinary `.git` directory or a standalone separate-git-dir file resolving directly to that
common directory; a linked source must remain a linked gitfile, prove admin placement under its `worktrees/`
directory, and have its `gitdir` back-pointer resolve to the same canonical path and file identity as the
normalized source `.git`. Realpath equivalence reconciles Git's raw `/var/...` back-pointer with a normalized
`/private/var/...` source, while the canonical path check rejects a same-inode hard link at another name.

The opening request carries `{ sourceWorktreeId, sourceGeneration }` only where one selected publication
exists. The offer retains its private repository registration beside
`{ sourceWorktreeId, sourceEvidence, snapshot }` and sends only `{ offerId, count }` to the form. The
row says "currently N" and that Git moves the uncommitted work present when it runs; it never presents
N as an atomic write-set lock.

`offerId` is a cryptographically random bearer token, generated with `randomUUID` in production and an
injected deterministic source in tests. `WorktreeSurface.post` cannot acknowledge delivery, so an
unguessable token is what makes a dropped message unredeemable. Predictable offer-store counters are
not reused.

A checked submit quotes the token; unchecked sends no migration field. Redemption requires the same
surface, opening, repository, source id, still-authorized source evidence, and freshly read snapshot.
The internal create request carries that evidence and snapshot through the mutation queue for the final
best-effort recheck. Retirement forgets the offer. A replacement token resets the checkbox when drift
is observed before execution; D1's row wording states that Git moves execution-time work, so the
uncloseable interval after that recheck is not described as atomic snapshot authority.

## D4 — Count Git's complete movable porcelain set

Git-extension resource arrays are capped by `git.statusLimit`, while `migrateChanges` stashes beyond
that cap. Use the shared `GitCommandRunner` against the source worktree:

```text
git status --porcelain=v2 -z --untracked-files=all
```

Parse strict records. Ordinary and untracked records count once. A rename or copy also counts once but
retains both its current and original path in the authorization signature, so `a → c` cannot be
replaced by `b → c` under the same displayed count. Ignored records do not appear. Any unmerged record
makes the source ineligible because the selected API's no-change check ignores its merge group and
ordinary stash cannot migrate an unresolved merge.

Complete each record with the current filesystem state of every affected path. Stream file bytes into
a hash; hash symlink targets and kind/mode markers; record absence explicitly. Resolve and revalidate
every traversed parent component before and after the final no-follow read, rejecting static or
persisting intermediate symlink replacement; a final symlink remains symlink state. Node exposes no
cross-platform handle-relative `openat`, so D8 owns the remaining transient ABA interval.

One shared 10-second, 512 MiB snapshot budget bounds status plus filesystem reads. Linked-worktree
`.git` content is capped at 1 MiB before allocation and read into one buffer sized from the opened
handle's `fstat`, avoiding chunk retention plus `Buffer.concat`. The cap remains above the supported
hosts' usable path envelopes: Windows extended paths are at most 32,767 UTF-16 code units (under 132 KiB
at worst-case UTF-8), while macOS and Linux path arguments are smaller. It therefore bounds strict
UTF-8 decode/re-encode peak without rejecting a usable Git worktree path. A timeout,
malformed/overflowed status, unreadable path, oversized gitfile, budget overflow, or unmerged record
yields no offer. The
same bracketed snapshot function runs at offer, submit, immediately before the API call, and after it.
The form displays the record count; no Git-extension status array enters it.

## D5 — Actively open the exact source and destination

Production reuses the Git API already activated by `GitDecorationProvider`; the provider exposes the
current API read-only instead of a second owner activating `vscode.git`.

Offer calculation receives the host-retained common-directory registration plus
`{ sourcePath, sourceKind }`, first proves the registration remains authorized and the source evidence belongs
to it in the selected main-or-linked role, then actively calls `API.openRepository(Uri.file(sourcePath))`
under a concrete 10-second `afterDelay` deadline and requires the returned repository to expose
`migrateChanges`. Thus the exact normalized source is both owned and callable before the row appears;
capability is never inferred from an unrelated repository or a later occupant of the same `repoId` path.

After git creates the destination, open source and destination under one fresh 10-second deadline and
use the returned objects directly. This opens ordinary siblings outside the workspace and avoids a
folded string search choosing a similarly named Windows path. Null, absent method, rejection, timeout,
or synchronous expiry is indeterminate. Late completion cannot reach `migrateChanges` after expiry.
The Git API remains owned by VS Code; disposing our accessor does not dispose a captured API object.

## D6 — Only new checkouts migrate, with nested destinations excluded first

Offer and admit migration only for `fresh`, `fresh-detached`, and `reuse`. `reattach` and `adopt` act on
surviving directories and cannot carry a migration offer.

A create root may sit inside the selected source checkout, including a linked source outside the main
checkout. In that case `git worktree add` makes the new directory appear as untracked source work until
that source's common-repository `info/exclude` receives a source-relative rule. This migration-specific
rule is derived from `request.migration.sourcePath`, which is the normalized source id rather than its raw
display spelling; it is migration-critical and a failed write stops migration as indeterminate. The existing main-checkout hygiene rule remains separate, retains its
nonfatal reporting contract, and still applies to ordinary creates nested in the main checkout. When
the two rules resolve to the same `(gitDir, pattern)`, one idempotent write satisfies both and is
migration-critical. Therefore the sequence is:

```text
git worktree add
  → capture the observed destination registration and back-pointer
  → require the narrow source exclusion and attempt independent main-checkout hygiene
  → open source + destination repositories
  → require bracketed source/destination evidence, authorized source snapshot, and clean destination
  → migrateChanges
  → verify bracketed identities, empty source, and exact non-conflicted destination snapshot
  → authorize provisioning directories
  → materialize entries
  → allocate ports
  → afterCreate
```

If the selected-source exclusion fails, migration returns indeterminate without calling the API; a
resolved write that did not take is also detected by the immediate source snapshot. Failure of a
separate main-checkout hygiene write remains nonfatal and is reported by its existing channel. For
outside-source destinations there is no migration exclusion write. Any indeterminate migration returns
from the successful-create arm before provisioning or launch.

## D7 — Carry the outcome on the successful create

`MutationServiceDeps` gains an optional migration binding receiving source path, destination path,
source identity evidence, and the issued snapshot. It returns `moved` or `indeterminate`; it never
throws past the successful-create arm.
A move-only create normalizes the created worktree id so its notice attaches after tree refresh.

`MutationOutcome`, `WorktreeMutationResultMessage`, and `WorktreeActionResult` carry optional
`migrationIndeterminate`. The notice stays a successful create, takes warning tone, states that later
steps did not run, and shows the bounded reason plus inspection instruction. The reason participates
in the render signature and coexists with existing post-create fields.

## D8 — Bind every observable destination incarnation

After `git worktree add` succeeds, the mutation service immediately captures destination evidence before
its own later work: authorized directory components, no-follow `.git` identity/content, resolved admin
directory identity, `HEAD`/`gitdir`/`commondir` identities and hashes, the admin `gitdir` back-pointer,
and the common repository path. The capture must prove that the observed destination registration
belongs to `request.repoId`; absence, ambiguity, or mismatch returns a successful create with
`migrationIndeterminate` before the API call.

The adapter receives that evidence beside the source evidence, issued snapshot, and selected repository
registration. Before API entry it revalidates the registration and requires both retained worktrees' common
paths and identities to match it, re-enforcing source and destination ownership against the pre-offer
registration rather than accepting whichever repository first occupies `repoId` during probing. Exact-path
`openRepository` remains necessary but is not identity: evidence brackets each pre-call and post-call snapshot, and every
observed destination mismatch is indeterminate. The capture and comparisons share
the same bounded evidence machinery rather than introducing a second parser.

VS Code and Node expose the migration and filesystem operands only by path. They cannot prove continuity
between `git worktree add` returning and the first capture, between two bracket reads, or between the
last comparison and the Git extension consuming the path. Gate 1 explicitly accepts those transient,
unobservable ABA intervals under the same rule as the source-side final-check interval: persistent or
observed substitution is refused or indeterminate; an unobserved occupant may receive the path-based
operation. This best-effort boundary follows Orca's metadata/back-pointer fingerprint and cmux's
post-add identity capture; cmux closes component traversal only with native `openat`, which this
cross-platform extension does not ship.

## Accepted risk

The user explicitly accepted the path-based best-effort boundary on 2026-09-02. `migrateChanges` has no
expected-snapshot or destination-incarnation parameter, and Node exposes no cross-platform
handle-relative `openat`: another process can transiently replace source bytes, an intermediate source
component, source `.git`, or the destination after the last relevant comparison and before the path is
consumed, and can restore it before a later comparison. The option authorizes execution-time work at the
named source path and the observed destination registration; persistent or observable divergence is
refused or indeterminate, but an unobservable ABA substitution cannot be prevented or reported.

Owner: worktree subsystem. Reactivate when `vscode.git` exposes transactional expected-state and typed
result inputs, Node exposes a cross-platform handle-relative filesystem primitive, or a source/destination
substitution incident is observed in practice.

## Obligation ledger

| Claim | Semantics | Defeater | Witness/check | Disposition |
|---|---|---|---|---|
| The row and final recheck name one owned source | A bracketed worktree listing makes its current root canonical for every same-repository folder association and order entry, and stores its private registration in the same cached record as its public generation; all-failed duplicates retain every folder association but no authority; probe completion, redemption, pre-queue handoff, and the mutation body after its forced rebuild each require a currently published generation whose paired registration equals the binding | Earlier failed folder retains A while a later current folder publishes B; retained A later initiates a repo-scoped rebuild; both duplicates fail then the first closes; a Git-unavailable repo-scoped apply hides but privately resolves a guessed generation; a pending probe or issued offer survives degradation through `rootFor`; the coordinator rebuild withdraws authority after host handoff but before create; whole-tree refresh; wrong role/repository; linked topology, `.git`, or admin replacement | Failed-A/current-B paired lookup and canonical-root witness; both-fail then first-closes retention; unavailable guessed-generation no-authority cache/host witnesses; pending-probe and issued-offer degradation refusal; post-coordinator-rebuild refusal before `git worktree add`; same-registration generation advance acceptance; selected-generation refresh, listing bracket, role, alias, repository/back-pointer, directory, `.git`, target and admin-identity witnesses through final recheck | supported |
| The row appears only for callable source work | Exact source `openRepository` returns a repository with `migrateChanges`, and a bounded snapshot is positive and movable | Capability inferred from another repo; empty, failed, overflowed, unreadable, or unmerged source | Exact-source open plus every ineligible snapshot witness | supported |
| The stated count is a truthful current snapshot | Displayed N is the issued record count; observed pre-call drift refuses before API entry | Same count with different path, rename origin, mode, link target, or bytes before the call | Replacement witnesses for every dimension plus wording that says "currently" and execution-time work | supported |
| Untracked work is included | `untracked: true` reaches the API call | Omitting it leaves new files | Exact-options witness | supported |
| The observed destination receives the call before expiry | The object returned by `openRepository(Uri.file(destination))` is called under 10 s only while its registration/evidence equals the immediate post-create capture | Passive discovery, path folding, null/rejected/late open, or persistent clean same-path replacement | Out-of-workspace, deadline, wrong-repository/back-pointer, and persistent before/after substitution witnesses; transient ABA is accepted risk | supported |
| Proven movement is correlated at both observed worktrees | Evidence brackets each snapshot; source and destination retain one common-repository identity, source is empty, destination states equal the issued outcome, and no unmerged record exists | Cross-repository source baseline, API refusal followed by cleanup, observable source `.git` change, destination replacement/conflict, or mixed persistent incarnation | Wrong-repository source and source/destination common-identity witnesses plus the post-state matrix varying both evidence brackets, bytes, mode, links, absence, paths and unmerged state; transient mixed ABA is accepted risk | supported |
| Migration applies only to new checkouts | Only fresh, fresh-detached and reuse redeem | Reattach/adopt entering a surviving directory | Form and host witnesses for every mode | supported |
| Nested destination cannot enter the moved set | Normalized-source-relative migration exclusion and independent main-checkout hygiene are established before pre-call status and API call | Raw display alias, linked source outside main, broad parent suppression, recount before exclusion, or calling after failed exclusion | Display/id alias, main-source, linked-source with sibling work, outside-source, narrow-pattern, and failed-exclusion witnesses | supported |
| Persistent intermediate redirection is refused | Parent realpaths/component identities are checked around a no-follow final-component read | Static or persisting intermediate symlink points outside the source | Static and persistent intermediate replacement plus final-symlink and regular-file substitution witnesses; transient ABA is accepted risk | supported |
| `.git` evidence stays within the general byte bound without rejecting usable host paths | Opened-handle size above 1 MiB is refused before allocation; accepted content uses one exact buffer and bounded decode/re-encode | A `.git` file approaches the 512 MiB budget or a valid Windows extended path exceeds the cap | Over-cap refusal, near-cap peak allocation, and 132 KiB worst-case UTF-8 path witnesses | supported |
| Uncertain migration runs no later step | Indeterminate returns before authorization, entries, ports and afterCreate | Catch and continue | Rejection, resolved mismatch, failed read and set-drift witnesses | supported |
| Uncertainty is reported truthfully | Notice says potentially partial and names inspection; no restoration or single-location claim | "Not moved", "restored", or ordinary create-error wording | View and forbidden-phrase assertions | supported |
| Undelivered, retired, or replayed consent cannot enter the API | Random token binds surface, opening, repo and final pre-call evidence; post-recheck mutation is the accepted residual | Guessable id, dropped post, token reuse, or substitution detectable before API entry | Deterministic-random and pre-call substitution witnesses; no claim beyond the final recheck | supported |
| Declining performs no migration | Unchecked row serializes no token and binding is not called | Default-true or false-valued field | Dialog, controller, host and mutation absence witnesses | supported |
