# Design — clear crash debris under an explicit authorization

> Blueprint: `docs/design/worktree-create.md` § 2.0, § 2.2, § 6; `docs/design/worktree-actions.md` § 3.1 rule 3.
> Those documents own the rule. This file records only what building it decides.

## D1 — Debris is classified by reading for `.git`, not by absence from the listing

`WorktreeHost.ts:1401`'s `dispositionOf(isRegistered)` returns `debris` for any unregistered
directory. That is a proxy, and it is wrong in the one direction that matters: a checkout whose
administrative entry was pruned is unregistered and holds a `.git` file, and calling it debris would
offer to delete the surviving work that WT-012.15 exists to re-register.

The classifier reads the destination for a `.git` entry — file or directory, `lstat`, not resolved —
and reports `debris` only when there is none. Registration is still consulted: a registered path is
never debris regardless of content.

The read runs only for a candidate the suffixing already skipped, so the common path adds no I/O —
the same bound `corroborate` already observes for reattach.

## D2 — The authorization is a sibling store, not a generalization of removal's

`worktreeFingerprint.ts` is written in `RemovalEvidence`: `isIdentityPreservingSubset` compares
dirty paths, pane ids, external sessions, lock state and ignored material. Parameterizing it over key
and evidence type for one further caller would put a type parameter through the module that guards
the most dangerous action in the extension, for no shared logic — the comparison is the module, and
debris shares none of it.

So: a sibling with the same *shape* — issue / redeem / forget, spend-on-sight, one record per key,
TTL eviction — keyed by resolved path and carrying debris evidence. `FINGERPRINT_TTL_MS` is imported
rather than redeclared; one TTL, one owner.

**Subset, not equality.** An entry present at authorization and gone at redemption is inside what the
user approved; an entry that appeared was never named. This matches removal's rule and is why the
comparison is a subset test rather than a digest equality — a crash-debris directory can still have a
process writing into it, and equality would refuse every such clearance rather than the unsafe ones.

## D3 — The identity recheck is re-taken immediately before the delete

`worktreeMutationService.ts` phase 2 already `lstat`s `recheckPath` and compares `identityOf(stat)`
against phase 1. For a debris destination `recheckPath` is the directory itself, so that comparison is
the device/inode check § 2.2 asks for — but `branchNameIsValid` awaits between it and the point where
the delete would run, and a guard read before an `await` and acted on after it is not a guard.

The delete therefore re-stats and re-compares immediately before removing, with no `await` between the
comparison and the removal call. The phase-2 check stays: it fails earlier and more cheaply.

## D4 — The delete site is declared to the I10 gate

`src/test/invariants/fsDeletionGate.ts` fails on any destructive `node:fs` reference in
`src/worktree/**` or `src/providers/WorktreeHost.ts`. The carve-out is a *named* exception in
`worktree-actions.md` § 3.1 rule 3, so the gate names it too: one allowlisted module path, asserted to
be the only one, in the same stated-list style as `EXPECTED_GAPS`.

Putting the delete outside the scoped paths instead would pass the gate by hiding from it, which
inverts what the gate is for. The allowlist entry is the record that the carve-out was taken
deliberately, and a second entry appearing is a review signal.

## D5 — A partial clearance fails the create and never rolls back

The delete reports what remains rather than what it removed: `readdir` after the removal, and a
non-empty result is a failure naming the entries. Consistent with
`worktree-actions.md` § 3.6 — a failed step is never reported as nothing having happened, and the
create does not proceed to `git worktree add` on a destination it could not clear.

## Failure-surface inventory

The mutable resource is **the debris directory on disk**.

| Question | Answer |
|---|---|
| Who owns writes | Nothing in this extension writes into it. This change only removes it, from the mutation service's serialized body. |
| What serializes concurrent access | `mutationCoordinator.run(repoId, …)` — the same queue every other mutation on the repo takes. Two windows are not serialized against each other; the device/inode recheck (D3) is what catches the other window's replacement, not a lock. |
| What a crash mid-write leaves behind | A partially removed directory. D5 reports what remains; the next create re-classifies the remainder from scratch, since classification (D1) reads the filesystem rather than any stored state. |
| Failed / malformed read | Fails **closed**. `readdir` or `lstat` returning null is "not proven to be debris" — no authorization is issued and no delete runs. |
| Two racing hosts | Both may hold an authorization for the same path. The first delete wins; the second finds a changed identity or a missing directory and refuses. Neither deletes what the other created, because a directory created after the authorization has a different inode. |
