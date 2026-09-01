# Proposal: detect-the-provider-the-repo-already-uses

## Why

The bring-over section reads exactly one file today, `asimov/worktree.yaml`. Every repository that
has already answered "what does a fresh checkout need" somewhere else — an orca configuration, a
task declared to run when a worktree is created — gets an empty section and a worktree missing its
`.env` and its `node_modules`. The section's whole claim is that it says what a worktree will lack,
and for those repositories it currently says nothing at all.

## Appetite

M (≤3d)

## Scope

### In scope

- Reading orca's configuration pair and the VS Code task file into the same normalized model the
  existing reader produces, with per-row provenance preserved.
- A fixed detection order, so which file supplies the model never depends on enumeration or timing.
- Presenting a detected-but-unused source as one row that offers to populate the section from it
  instead, and honouring that choice.
- Extracting the provider-agnostic half of the existing reader so three adapters share one
  containment, budget, glob and problem-reporting discipline rather than three copies of it.

### Out of scope

- `.vscode/worktree.json`, `extends`, and the merge rule — WT-012.4 owns them, and the detection
  order this change builds is the thing that file gets inserted in front of.
- Running any setup step. Nothing in this change executes; WT-012.11 owns execution, and the
  quoting decision here is only about the text a user is shown and a later task will run.
- Allocating ports. A port row is named and selectable with no number until WT-012.6.
- Honouring orca's own preconditions (a shared directory must exist and be gitignored). The
  adapter records the repository's stated intent; what the material turns out to be is an apply-time
  outcome.

### Must not

- Merge two detected sources into one offer. Two frameworks in one repository usually means one is
  being migrated away from, and unioning them would offer a setup command the user believes they
  retired.
- Hide a detected source because another one won.
- Let a webview supply command text or a path. The switch affordance names a provider the host
  already detected; it never carries a model.
- Substitute a value for an unresolved `${...}` placeholder in a task command.

## Risk Level

MEDIUM — three checked-in, untrusted files are parsed into text that a later task will hand to a
shell, and one new runtime dependency enters a published extension whose runtime surface is
currently two packages.
