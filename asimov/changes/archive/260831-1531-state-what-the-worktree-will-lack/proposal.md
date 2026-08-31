# Proposal: state-what-the-worktree-will-lack

## Why

A worktree made today is missing whatever the repository does not track — `node_modules`, `.env`,
a permission allowlist, a warm cache — and the form says nothing about it. The user finds out when
the new checkout fails to build.

This is also the first slice of the provider layer. The normalized model and its provenance rule
are what every later Phase 12 task consumes, and they are cheaper to get right against one real
file than four. This repository's own `asimov/worktree.yaml` is that file, and it exercises every
shape the model has except ports: a glob, a directory, a link, and two setup commands.

## Appetite

M (≤3d)

## Scope

### In scope

- One provider adapter — `asimov/worktree.yaml` — read into the normalized model of
  `docs/design/worktree-provisioning.md` § 2, with globs expanded at read time.
- The host-held offer: the model is resolved once, kept, and published under an opaque offer id.
- The `worktreeProvisionOffer` message and the model types on the wire.
- The Bring over section, rendered from the offer, one row per selectable item, each naming the
  file that declared it.
- The empty case and the unreadable case, which are requirements rather than error handling.

### Out of scope

- **Applying anything.** Nothing is copied, linked, allocated or executed, and nothing is written
  to disk. WT-012.2 materializes files, WT-012.6 allocates ports, WT-012.11 runs setup.
- **The other three adapters.** orca, `.vscode/tasks.json` and the native file are WT-012.3's;
  detection order and the merge rule are WT-012.4's. This change reads one file and records the
  provider it came from.
- **Submitting a selection.** `ProvisionSelection` exists on the wire from WT-012.0. The rows are
  rendered, but no create consumes what was checked until WT-012.2.
- **Writing the native file.** WT-012.5 owns `.vscode/worktree.json`.
- **Size and secrecy warnings.** Deliberately deferred by the design
  ([worktree-provisioning.md](../../../docs/design/worktree-provisioning.md) § 8); this repo's own
  config copies a credentials-shaped file and the section states the path without judging it.

### Must not

- Let the webview learn a command or a path it could send back. The offer carries display text;
  the selection carries ids. A field capable of carrying command text re-opens exactly what
  WT-012.0's contract closed.
- Re-read a provider file after the model was shown. The property is *nothing executes that the
  user has not seen*, and a second read is the window an untrusted checked-in file needs — even
  though this change executes nothing, the store it builds is what later tasks execute from.
- Hand-roll path containment. `src/utils/pathBoundary.ts` is the only definition in `src/`.
- Clamp an escaping entry into range. An entry resolving outside the repository is refused and
  reported; clamping turns a suspicious entry into a silently different one.
- Refuse the create because provisioning is broken. A malformed provider file is a problem row,
  not a disabled button.

## Risk Level

MEDIUM — the diff is contained and writes nothing, but two properties are load-bearing for every
later task in the phase. The offer store is the first host-held authority over what will execute,
and the provenance rule is what makes a later merge auditable. The third risk is a new runtime
dependency: `yaml` is the second entry in `dependencies`, and it parses untrusted checked-in files.
