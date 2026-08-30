# Peer evidence — Cursor D5 rows (read-only, from an Explore session)

Held for triage with the oracle round; artifacts stay frozen until it returns.

## Confirmed as planned

- `readCursorEntry` dispatches by prefix only — `cursorReader.ts:631-642`. Routing is as D5 assumed.
- The child-map row is `VaultService.resolveCursorRequest` (`VaultService.ts:852-869`), a map lookup
  with no I/O — not a `readCursorEntry` sub-reader path. tasks.md already assigns it to 1_1, so the
  task split is right; design.md's Cursor table should stop presenting it as a reader row.

## Defect — 1_5's Plan paths do not cover the work

D5's two negative Cursor rows are not separately reachable today: every sub-resolver collapses "no
match" and "could not read" into one `null`. Threading the distinction out needs edits in three
files 1_5 never names, so the scope gate would deny them mid-build:

| Sub-path | Where the status is discarded |
|---|---|
| CLI | `cursorPaths.ts:143-190`, `:272-287` (unsafe / unlocatable / ambiguous id, then the bucket scan) |
| Project | `cursorTranscript.ts:97-157`, `:301-330` (bounded cwd walk; caught `stat` errors) |
| IDE | `cursorIdeReader.ts:468-481` (invalid id, missing composer, any non-`ok` snapshot status) |

1_5 is therefore materially larger than 1_2 to 1_4 — four files, three independent resolvers.

## Correction to design.md's framing

"Every row is reachable from state the reader already computes; no row adds a syscall" is true about
syscalls and misleading about availability. The accurate claim, which D4 already makes for the two
filename scanners and which holds for all four readers: **no extra syscall is required, but no
reader surfaces the distinction today** — each computes it internally and discards it at the return.
Claude `:95-101`, Codex `:108-114`, OpenCode `:124-126` collapse the same way Cursor does. Only the
id-safety rows and the found rows are reachable from the public surface as it stands.

## Follow-up: two D5 rows are wrong, and a reuse signal I dismissed too fast

**Gap — a record that exists but cannot be mapped.** Each reader has a mapper that returns null for
a row it found and could not use: `codexReader.mapThreadRow:142-160` (:143-146),
`opencodeReader.mapSessionRow:157-177`, `claudeReader.buildClaudeEntry:331-371` (:339). D5 handles
this for Claude ("file found, build returns falsy or throws → unknown") and misses it for the other
two: the Codex row "SQLite ok, one or more rows → `found`" and the OpenCode row "SQLite ok, one or
more rows → `found`" are both false when the mapper rejects the row. The session is demonstrably
there and we failed to read it — `unknown` by D2, never `found` and never `absent`. Both tables need
the row Claude already has.

**Reuse signal.** The list path already keeps this exact accounting under another name:
`claudeReader.ts:439-453` counts build-null and caught failures into `unreadable`, and the other list
readers carry an `unreadable` set too. design.md's Risk Map dismisses it in one line as "not this
contract". That is still probably right — list-wide freshness is a different question from a by-id
answer — but it deserves a real look at triage rather than a dismissal, since `unreadable` and
`unknown` are the same idea and two names for it is the kind of thing this phase exists to remove.
