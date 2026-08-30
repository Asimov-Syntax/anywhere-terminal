# Proposal: tell-an-absent-session-from-an-unknown-one

## Why

Every by-id session lookup in the vault answers `VaultSessionEntry | null`, and `null` carries three
different facts at once: this session was never here, this session is gone, and I could not find
out. `codexReader.readCodexEntry` says so in its own comment — `// query-error → unresolved (caller
treats null as unknown-entry)` — and `claudeReader.readClaudeEntry` reaches the same `null` from an
unlocatable path, an unparseable file, and any caught error alike.

No shipped caller is wrong today, because none of them acts on absence: they all treat a non-entry
as "cannot launch / no cwd" and stop. The next one does. `docs/PLAN.md` WT-011.5 retires a row's
preview line when its session is gone, and built on today's `null` it would blank a live row every
time SQLite hiccups — the exact confusion it exists to end. That task is parked on this one.

The distinction is not new information the vault has to go and fetch. Each reader already computes
it and then discards it: Codex has a four-way `SqliteStatus`, OpenCode the same, Claude a directory
scan that either completes or fails. This change surfaces what they already know.

## Appetite

M (2-3d)

## Scope

### In scope

- One conclusive answer shape for a by-id lookup: found, absent, or unknown
- Each of the four readers classifying its own paths into it, from state it already has
- A `VaultService` lookup that returns it, with `getEntry` kept as the unwrapping wrapper
- Making `no-db` mean "the database file is not there", so the one status two readers already
  disagree about stops carrying an access failure as well (design.md D6)

### Out of scope

- Any change to what a caller does with the answer — every existing caller keeps today's behaviour,
  treating anything that is not `found` the way it treats `null`
- Retiring a preview on `absent`; that is WT-011.5, which depends on this
- The detail path, the record path, and entry caching — this widens one lookup's answer, it does not
  revisit how entries are built or held. The list path is touched at exactly one branch, where D6's
  status split obliges it to count an unreachable store as unreadable instead of as an empty one
- Reporting *why* a lookup was inconclusive. `unknown` is one state, not a taxonomy of errors

### Must not

- Report `absent` from anything short of a completed enumeration that did not contain the session
- Change what `getEntry` returns for any input, including the synthetic child/group/segment ids
  `vault-session-launch` § "Launch resolves a single entry by id" requires it to reject
- Add a filesystem or database probe that the existing lookup did not already perform

## Risk Level

MEDIUM — no user-visible behaviour changes, and the seam is one method's return type. The risk is
misclassification: an `absent` reported where the reader only failed to look becomes a deleted row
in the change that consumes it. Every ambiguous path is therefore required to answer `unknown`, and
that direction is what the tests pin.
