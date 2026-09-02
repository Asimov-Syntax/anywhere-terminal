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

After a resolved call, `moved` requires an empty source status and a destination snapshot equal to the
issued source snapshot's expected working-tree state, with no unmerged record. Thus a no-move API exit
followed by unrelated path-name changes is not success; another actor reproducing the same bytes, modes,
links and absences has already established the observable destination state the user asked for.

Every other resolved state, every rejection, every failed read, and every changed pre-call snapshot is
`indeterminate`. The correlated snapshot proves the observable result, not which internal API exit
produced it.

Indeterminate keeps the created worktree, runs no later step, and directs the user to inspect source,
destination, and Git stashes. It does not say the work was restored, did not move, or exists in only
one place. The Git extension may already have warned; its API cannot reveal that fact, so the accepted
contract does not promise exactly one report.

## D3 — Bind a cryptographic offer to source incarnation and snapshot

A repository id is not a source worktree id. `openCreateFor(info)` retains the clicked
`WorktreeInfo.id`; repository-level and toolbar doors have no unique source and offer no migration row.
Switching the form to another repository also removes the row rather than substituting a checkout.

A cache generation is not an incarnation: every forced observation advances it, including the rebuild
a queued create must perform. Instead, the source probe captures the existing `AuthorizedDirectory`
component identities plus the `.git` entry's no-follow identity. A remove-and-recreate or registration
replacement changes one of those identities even when path, branch, commit and changed files repeat.
The same evidence is rechecked at host redemption and after the mutation queue's forced rebuild.

The opening request carries `sourceWorktreeId` only where one exists. The offer retains
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
a hash; hash symlink targets and kind/mode markers; record absence explicitly. One shared 10-second,
512 MiB snapshot budget bounds status plus filesystem reads. A timeout, malformed/overflowed status,
unreadable path, budget overflow, or unmerged record yields no offer. The same snapshot function runs
at offer, submit, immediately before the API call, and after it. The form displays the record count;
no Git-extension status array enters it.

## D5 — Actively open the exact source and destination

Production reuses the Git API already activated by `GitDecorationProvider`; the provider exposes the
current API read-only instead of a second owner activating `vscode.git`.

Offer calculation actively calls `API.openRepository(Uri.file(sourcePath))` under a concrete 10-second
`afterDelay` deadline and requires the returned repository to expose `migrateChanges`. Thus the exact
source is callable before the row appears; capability is never inferred from an unrelated repository.

After git creates the destination, open source and destination under one fresh 10-second deadline and
use the returned objects directly. This opens ordinary siblings outside the workspace and avoids a
folded string search choosing a similarly named Windows path. Null, absent method, rejection, timeout,
or synchronous expiry is indeterminate. Late completion cannot reach `migrateChanges` after expiry.
The Git API remains owned by VS Code; disposing our accessor does not dispose a captured API object.

## D6 — Only new checkouts migrate, with nested destinations excluded first

Offer and admit migration only for `fresh`, `fresh-detached`, and `reuse`. `reattach` and `adopt` act on
surviving directories and cannot carry a migration offer.

A create root may sit inside the source checkout. In that case `git worktree add` makes the new
directory appear as untracked source work until the existing `info/exclude` rule is written. It must
also be excluded before `migrateChanges(untracked: true)` so the API cannot try to stash its own
destination. Therefore the sequence is:

```text
git worktree add
  → maintain info/exclude when the destination is inside the source
  → open source + destination repositories
  → require authorized source snapshot and clean destination
  → migrateChanges
  → verify empty source + exact non-conflicted destination snapshot
  → authorize directories
  → materialize entries
  → allocate ports
  → afterCreate
```

If exclusion fails, the immediate source snapshot detects the new destination and returns
indeterminate without calling the API. For outside destinations there is no exclusion write. Any
indeterminate migration returns from the successful-create arm before provisioning or launch.

## D7 — Carry the outcome on the successful create

`MutationServiceDeps` gains an optional migration binding receiving source path, destination path,
source identity evidence, and the issued snapshot. It returns `moved` or `indeterminate`; it never
throws past the successful-create arm.
A move-only create normalizes the created worktree id so its notice attaches after tree refresh.

`MutationOutcome`, `WorktreeMutationResultMessage`, and `WorktreeActionResult` carry optional
`migrationIndeterminate`. The notice stays a successful create, takes warning tone, states that later
steps did not run, and shows the bounded reason plus inspection instruction. The reason participates
in the render signature and coexists with existing post-create fields.

## Accepted risk

The user explicitly accepted that `migrateChanges` has no expected-snapshot parameter: another process
can change source bytes or `.git` after the final recheck and before the Git extension creates its
stash. The option authorizes execution-time uncommitted work at the named source path; post-verification
reports observable divergence as indeterminate but cannot prevent the already-started move. Owner:
worktree subsystem. Reactivate when `vscode.git` exposes a transactional expected-state input or typed
result, or if source substitution is observed in practice.

## Obligation ledger

| Claim | Semantics | Defeater | Witness/check | Disposition |
|---|---|---|---|---|
| The row and final recheck name one source | Offer binds source id, authorized directory components, `.git` identity/content, and resolved admin target through the queued rebuild | Remove/recreate, in-place `.git` rewrite, or admin replacement before the call | Directory, `.git` content, target and admin-identity substitution witnesses at redemption and final recheck | supported |
| The row appears only for callable source work | Exact source `openRepository` returns a repository with `migrateChanges`, and a bounded snapshot is positive and movable | Capability inferred from another repo; empty, failed, overflowed, unreadable, or unmerged source | Exact-source open plus every ineligible snapshot witness | supported |
| The stated count is a truthful current snapshot | Displayed N is the issued record count; observed pre-call drift refuses before API entry | Same count with different path, rename origin, mode, link target, or bytes before the call | Replacement witnesses for every dimension plus wording that says "currently" and execution-time work | supported |
| Untracked work is included | `untracked: true` reaches the API call | Omitting it leaves new files | Exact-options witness | supported |
| The exact destination receives the call before expiry | The object returned by `openRepository(Uri.file(destination))` is called under 10 s | Passive discovery, path folding, null/rejected/late open | Out-of-workspace and deadline witnesses | supported |
| Proven movement is correlated at both worktrees | Empty source plus destination path-state snapshot equal to the issued source outcome and no unmerged record | API refusal followed by source cleanup, destination conflict, or same-name different-content write | Post-state matrix varying bytes, mode, links, absence, paths and unmerged state independently | supported |
| Migration applies only to new checkouts | Only fresh, fresh-detached and reuse redeem | Reattach/adopt entering a surviving directory | Form and host witnesses for every mode | supported |
| Nested destination cannot enter the moved set | Existing exclusion is attempted before pre-call status and API call | Recount before exclusion or calling after failed exclusion | Nested-root order and failed-exclusion drift witnesses | supported |
| Uncertain migration runs no later step | Indeterminate returns before authorization, entries, ports and afterCreate | Catch and continue | Rejection, resolved mismatch, failed read and set-drift witnesses | supported |
| Uncertainty is reported truthfully | Notice says potentially partial and names inspection; no restoration or single-location claim | "Not moved", "restored", or ordinary create-error wording | View and forbidden-phrase assertions | supported |
| Undelivered, retired, or replayed consent cannot enter the API | Random token binds surface, opening, repo and final pre-call evidence; post-recheck mutation is the accepted residual | Guessable id, dropped post, token reuse, or substitution detectable before API entry | Deterministic-random and pre-call substitution witnesses; no claim beyond the final recheck | supported |
| Declining performs no migration | Unchecked row serializes no token and binding is not called | Default-true or false-valued field | Dialog, controller, host and mutation absence witnesses | supported |
