# Proposal: add-worktree-panel-shell

## Why

The Worktree view is the design gate for the whole worktree epic: its spacing, state vocabulary,
and empty-state copy can only be judged against each other, so they are settled in one pass and
signed off before live data is allowed near them. Building the shell against fixtures typed to
the real tree model makes every later phase a change of producer rather than a rewrite.

This change record is written **after** the implementation landed. It exists so the ledger holds
the durable contract the view now owes, and so the two review findings that were deliberately not
fixed are recorded as decisions rather than rediscovered as defects.

## Appetite

L (≤2w)

## Scope

### In scope

- The fourth segment in the vault panel's segmented control, and the body swap behind it.
- Panel controls becoming view-scoped: search, refresh, folder filter, create.
- The worktree tree itself: repo groups, worktree rows, agent rows, subagent rows, the collapsed
  presence pill, and both disclosure levels.
- Every state the design names: first load, quiet refresh, three causes of emptiness, no-match,
  per-repo degraded, and the two action-result notices.
- Both row context menus, the create form, and the remove confirmation including its refusal.
- Persisting the active view and both disclosure levels.

### Out of scope

- **Any host protocol.** No message is defined, no git runs, and no menu item or dialog button
  reaches a host operation. Every action surface is inert by construction; the graft point is a
  single seam the wiring pass removes.
- **Live data.** The tree and presence are fixtures typed against the real tree model.
- **The repo-derived default view** (worktree when a repo exists, sessions when none). It needs
  repo knowledge the shell does not have, and the tree it would open on is fixture data — so
  opening on it would show a stranger's paths to a user who never asked. Deferred to WT-003.1,
  which now carries it as acceptance.
- **Extracting the shared popup and modal primitives.** This view's context menu duplicates the
  vault menu's whole lifecycle, and its dialog shell duplicates the continuation dialog's focus
  trap; the two pairs have already drifted. Extraction belongs to the tasks that next touch those
  surfaces (WT-005.1, WT-005.2) rather than to a third copy written here.

## Risk Level

MEDIUM — the change edits a shipped surface (the vault panel's toolbar and body) that users
depend on today, and a regression there is visible immediately. The worktree body itself carries
no risk of its own while nothing it renders can act.
