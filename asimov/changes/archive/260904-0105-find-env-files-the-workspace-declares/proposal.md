# Proposal: find-env-files-the-workspace-declares

## Why

`suggest-worktree-initialization` inspects the repository root only. A monorepo keeps its environment
files inside its packages — `koto-prototype` has none at the root and three under `apps/web`,
`apps/server` and `packages/infra` — so the create form offers a `bun install` step and nothing else,
and the user is told a worktree needs nothing brought over while three environment files are missing
from it. Root-only detection is not a smaller answer for these repositories; it is the wrong one.

## Appetite

M (≤3d)

## Scope

### In scope

- Read the workspace directories the repository itself declares (`package.json` `workspaces`,
  `pnpm-workspace.yaml` `packages`) and probe the same fixed environment filenames one level inside
  each of them.
- Refuse a declared pattern that leaves the repository, that this reader does not implement, or that
  exceeds the existing scan and row budgets.
- Keep every suggestion opt-in, explained, and named by its repo-relative path.

### Out of scope

- Recursive discovery, or any directory this repository did not declare as a workspace.
- Reading an environment file's contents, at any depth.
- Per-package setup commands. A workspace install runs at the root, and the root lockfile already
  supplies it.
- Changing when suggestions appear at all: a present provisioning source still answers and suppresses
  them.

### Must not

- Read a secret value to decide whether to suggest its file.
- Let a declared pattern reach outside the checkout, through spelling or through a symlink.
- Make the work a repository can cause unbounded — a package directory holding a million names must
  cost what the existing budget allows and no more.
- Offer, copy, or run anything without the same explicit per-create selection.

## Risk Level

HIGH — the change widens where the extension looks for likely-secret files, and it does so by
following a pattern written in a checked-in file. Every widening is bounded by the repository's own
declaration, the existing containment rule, and the existing scan/row budgets.
