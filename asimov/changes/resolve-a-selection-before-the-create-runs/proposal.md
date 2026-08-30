# Proposal — resolve a selection before the create runs

> Blueprint: docs/PLAN.md task WT-012.8

## Why

Every state a branch or a destination can already be in arrives today as a git failure **after** the
user pressed Create. The name they typed exists; the directory they were given is occupied; a
registration went stale. Git has a precise answer for each, and the user sees none of them until the
action has already failed.

WT-012.7 landed half of this: the combobox now knows which branches exist and which are held. What
it cannot say is what *creating* against one of them would actually do — and the difference between
`git worktree add -b`, `git worktree add`, and `git worktree repair` is the difference between a
create that works and one that fails with a message about a directory the user never chose.

## Scope

- A **resolution taken before submit**: a typed selection plus a candidate path answer with a branch
  mode (`fresh` / `fresh-detached` / `reuse` / `reattach`), the free path the create would take, and
  the occupied candidate the suffixing skipped with what was found there.
- **Reattach executes**, by `git worktree repair`, under all four of worktree-create.md § 2.3's
  conditions. It is the one mode whose wire type exists and whose execution currently throws.
- **Base ref is refused where it cannot apply** — disabled with a reason for `reuse` and `reattach`,
  validated for `fresh`, and unaffected by a `debris` disposition.

## Non-goals

- **Recover** (the `debris` disposition's authorization and delete) is WT-012.12. This change
  REPORTS the occupied candidate — without that report WT-012.12 has nothing to act on — and does
  not act on it.
- **Adopt** is WT-012.15. It writes into git's administrative directory, which is a different
  invariant owner from repairing a link that is already there.
- Giving `worktreeCreateDefaults` and the provisioning offer the per-opening lifecycle the refs pair
  gained in WT-012.7. The resolution pair is new here and carries its own opening identity from the
  start; retrofitting the other two is a question about the create wire as a whole.

## Must-not

- **Reattach never rewrites the working tree.** `repair` rewrites the two-way link and nothing else.
  Where any of § 2.3's four conditions fails, the mode is not offered at all — it never degrades to
  `add`, which would refuse the non-empty directory anyway, and never to a checkout.
- **A registration whose administrative entry is actually gone is never offered as reattach.** That
  is adopt's state, and treating a surviving checkout as debris would destroy work to tidy a
  listing.
- **No `--force`, ever.** A branch held by another worktree is prevented at the combobox (WT-012.7);
  reaching git's refusal is a race, and git's message names the holder better than we could.
- `docs/ui/create-worktree.html` and `docs/ui/worktree-create-dialog.css` are owned by an external
  design pass and are not edited.

## Appetite

L. Three seams — a host-side resolver, one new git mutation, and the form's mode derivation — and
the resolver is the one carrying the risk.

## Risk

The resolution is a **read whose answer authorizes a mutation**, and the two are separated by
however long the user takes to press Create. Every guard therefore has to be re-checked at the
mutation rather than trusted from the resolution: `expectedOid` already exists on the `reattach`
wire type for exactly this, and it is load-bearing rather than decorative.

Second: `prunable` is git's flag, not ours, and the listing carrying it can be stale by the time the
resolution runs. § 2.3's conditions 2 and 3 are what turn a stale flag into a safe action, and
condition 2 is the one that separates reattach from adopt.
