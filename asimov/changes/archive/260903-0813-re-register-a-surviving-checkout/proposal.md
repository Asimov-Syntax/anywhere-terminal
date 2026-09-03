# Proposal: re-register-a-surviving-checkout

## Why

A checkout whose administrative entry was pruned still holds the work. Today the create path walks
past it: the directory has a `.git`, so it is not debris, and it is not registered, so the destination
derivation suffixes a near-duplicate beside it and leaves the original stranded. Git offers no command
that attaches it — `repair` requires the entry to already exist and `add` refuses a non-empty path.

## Appetite

M

## Scope

### In scope

- Resolving a surviving checkout at the destination to adopt, for a branch that already exists
- Reconstructing the administrative entry, handing it to `git worktree repair`, and rebuilding the index
- Refusing outright when a live worktree holds the branch, and re-proving that after the write
- Stating, before authorization, the directory, the branch, and what adoption does not restore
- Restoring the destination when any step fails

### Out of scope

- Offering adopt where the selected branch does not exist — there is no ref to attach the checkout to,
  and inventing one would name a branch the user never asked for
- Recovering the index, in-progress operations, per-worktree refs, config or lock state — none survived
  the deleted directory and none is reconstructible
- Offering adopt on Windows before WT-012.14 records the reconstruction there — the dependency this
  task already declares, not a scope cut
- Removing anything. Adoption is the create path that deletes nothing; debris clearing stays WT-012.12's

### Must not

- Write a single byte inside the adopted working tree. `<wt>/.git` is not inside it — that link file IS the adoption, and it is the one path under the directory that changes
- Let two administrative entries claim one branch through any interleaving adoption can observe. Global exclusion is not on offer: two concurrent `git worktree add` runs against one branch both succeed on git 2.50.1, so no client provides it and this one claims parity, not more
- Refuse adopt on Windows on the grounds that the reconstruction fails there — it has not been run
- Reach for `git worktree add --force` against an occupied destination

## Risk Level

HIGH — it writes into git's own administrative directory, and the failure it prevents (two worktrees
on one branch) is silent: git reports nothing, both commit, and the second commit reverts the first
with a linear history and no conflict.
