# Proposal: retire-a-preview-whose-entry-is-gone

## Why

A row can keep presenting a preview sourced from a session that no longer exists. The service caches
a resolved target beside the vault entry that produced it and then, deliberately, stops asking the
vault about that entry at all — re-asking every look sent a Codex row through a history-sized tree
walk at the freshness cadence, so an earlier review removed it. The cost of that fix is this debt:
while the transcript file survives on disk, `stat` keeps succeeding, and nothing ever notices the
session it belonged to was deleted.

## Appetite

S (≤1d)

## Scope

### In scope

- The service noticing, within a bound, that the session behind a held preview is gone
- Naming that as a third outcome, distinct from "not there yet" and "this source keeps no transcript"
- Consuming the conclusive `found | absent | unknown` lookup WT-011.8 shipped, so an inconclusive
  store answer neither retires a line nor blanks one
- A re-confirmation cadence slow enough that the walk B1-R3 removed does not come back

### Out of scope

- What a row does with a transcript file that vanishes or turns unreadable. That is governed by an
  accepted requirement — `worktree-agent-presence` § "An agent row's preview line says what its
  session last did" — and this change does not reopen it (design.md D3)
- Any live-entry set pushed from the projector into the service (DESIGN.md § 9 D35 rejects it)
- The lookup contract itself — readers, `VaultService`, and its wiring shipped as WT-011.8
- The read deadline and the outstanding-work bounds shipped in WT-011.3

### Must not

- Restore a `deps.entry` call on the ordinary per-look path
- Treat a timeout, a failed `stat`, an unreadable file, or an inconclusive store answer as the session ceasing to exist
- Introduce a second definition of "live" for the service and the projector to keep in sync

## Risk Level

LOW — one service, one new outcome, and a strictly slower cadence than the one beside it. The
failure it guards against is a stale line, not a wrong action.
