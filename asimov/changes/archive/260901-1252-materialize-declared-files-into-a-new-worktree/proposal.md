# Proposal: materialize-declared-files-into-a-new-worktree

## Why

A new worktree is a fresh checkout: it has the tracked files and nothing else. The material a
developer actually needs to run the branch — `.env`, local config, a data fixture — is exactly the
material git does not carry, because it is ignored. Today the extension can already READ what a
repository declares and SHOW it (WT-012.1), and then does nothing with it. The user is shown a list
of files that will be brought over, presses Create, and gets a worktree without them.

This is the step that puts them there.

## Scope

The first two of the four apply steps, and the security rules both share:

- **Copy** — recursive for directories, mode bits preserved, ownership never.
- **Link** — a relative symlink to the main checkout, degrading to a copy where the platform has no
  symlink to give.
- **The refusals** — containment, never-overwrite, special files, symlinks that leave the
  repository, lockfiles, `node_modules` as a link.
- **The report** — one result per entry, on a wire message that does not exist yet.

## Non-goals

- **Ports and setup** (`worktree-apply.md` § 2.3, § 2.4). WT-012.6 and WT-012.11 own them. The
  ordering constraint they impose is honoured — this step runs first — but nothing here allocates a
  port or runs a command.
- **The manifest** (§ 2.6). Written after a *successful apply*, which means after all four steps;
  writing it from a two-step apply would record a worktree as provisioned when it is half done.
- **Re-presenting a fresh model after a stale offer.** See must-not below.

## Must not

- **Must not spell its own containment test.** `isPathInside` / `isResolvedPathInside` are the only
  two definitions in `src/`, and this module is not permitted to become a third.
- **Must not clamp an escaping entry into range.** Refuse it and say so. A clamped entry is a
  silently different entry, which is worse than a refused one.
- **Must not accept a path, a glob, or command text from the webview.** The webview sends item ids
  against an offer the host issued; the host resolves them from its own stored model.
- **Must not fail or roll back a create because an entry failed.** The worktree exists. An entry
  that could not be materialized is reported, and every entry before it stands.
- **Must not overwrite anything.** Not the named entry, and not one file inside a directory whose
  top-level name happened to be free.

## Appetite

L. Four buildable slices behind one wire type: the result contract, the per-entry validator, the
copy walk, the link step and its degradation, then the wiring into the create body.

## Risk

The highest in this phase. It writes to disk, into a directory that did not exist a moment ago,
from paths a checked-in file supplied — and a checked-in file is written by whoever opened the pull
request. The mitigation is that every rule above is a refusal rather than a repair, and that the
one thing the webview can influence is *which* of the host's own entries are selected.
