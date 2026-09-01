# Proposal: merge-only-the-declarations-proven-to-be-one

## Why

`worktree-provisioning.md` § 4.2 promises that when a repository builds on another provisioning
source, the repository's own declaration wins a path they share — including its mode, so a path the
framework links becomes a path this repo copies. The promise has never held for two declarations
spelled differently, and five review cycles have refuted six mechanisms for deciding when two
spellings are one path. Round 7 showed the current one failing in both directions at once: on macOS
the inherited mode wins the destination the contract awards to the repository, and on Windows
`toLowerCase()` merges filenames NTFS keeps apart, deleting a declaration outright.

The pattern across all six is one mistake repeated: each asked the filesystem about an **object**
when the question is about a **name**, and each wrong answer discarded something the repository had
written down. This change stops asking.

## Scope

The read path only. Identity becomes exact normalized-spelling equality with no filesystem access at
all. Declarations that a common filesystem might fold together are grouped as contenders, both
offered, with the repository's own declaration recorded as the favoured one, and `exclude` reporting
a spelling that matched nothing.

## Non-goals and must-nots

- **Not** deciding who wins a destination two entries both claim. That needs the destination to
  exist, which it does not while the offer is drawn; WT-012.18 owns it.
- **Must not** rewrite what a row displays or the file it names as its source (§ 4.3).
- **Must not** reach a `ProviderDeps` hook from an identity or exclusion path — not once, not behind
  a flag, not "just to check".
- **Must not** use contender membership to merge, drop or reorder anything in this change. It is
  ordering data for the sibling change and nothing else.
- **Must not** withhold a row from the offer because its pair could not be told apart. That was
  considered and rejected: it makes the ordinary macOS case deliver nothing.
- **Must not** touch `docs/ui/create-worktree.html` or `docs/ui/worktree-create-dialog.css`.

## Appetite

Small. Three of the six tasks delete code or assert an absence. The expensive part of this problem
was deciding to stop solving it, and that is already paid.

## Risk

The residual is deliberate and in the tolerable direction: a contender group shows two rows where
one file may land, and the loser is reported as skipped rather than silently dropped. Visible and
explainable beats correct-looking and wrong, which is what the last six attempts shipped.

The real risk is the seventh mechanism arriving later as a helpful-looking helper, which is why task
3_1 is a structural gate rather than another behavioural test.
