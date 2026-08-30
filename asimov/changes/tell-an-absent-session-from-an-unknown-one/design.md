# Design: tell-an-absent-session-from-an-unknown-one

## Decisions

### D1: One discriminated answer on the adapter contract, not a second method

`VaultAgentAdapter.entry` widens from `Promise<VaultSessionEntry | null>` to `Promise<VaultEntryLookup>`,
declared beside `VaultSessionEntry` in `src/vault/types.ts`:

```ts
/** What a by-id lookup could establish about one session. `absent` is a proof that
 *  the session is not there; every path that merely failed to find out is `unknown`
 *  (D2). There is no fourth state: why a lookup was inconclusive is the reader's
 *  business, not its caller's. */
export type VaultEntryLookup =
  | { status: "found"; entry: VaultSessionEntry }
  | { status: "absent" }
  | { status: "unknown" };
```

**Rejected**: leaving `entry` alone and adding `entryExists(sessionId)` beside it. It would ask each
store the same question twice, and the two answers could disagree — a session deleted between the
calls reports `found` plus `absent`. One lookup, one answer.

**Rejected**: `VaultSessionEntry | null | undefined`, absent versus unknown by which empty value.
It is unreadable at the call site and every existing `?? `/`!entry` test silently picks a meaning.

### D2: Absence is proven, never inferred

A reader may answer `absent` only from an enumeration that **completed** and did not contain the
session. Everything else — a store it could not open, a query that threw, a directory it could not
list, a file it found but could not parse — is `unknown`.

This is the whole safety property. The consumer WT-011.5 retires a row's line on `absent` and keeps
it on `unknown`, so a misclassification in this direction deletes a live session's preview, while one
in the other direction only leaves a stale line for another cycle. The costs are not symmetric, so
the default is not symmetric.

Its sharpest consequence is NOT "a missing store is unknown". Planning first wrote that rule, and
review showed it was the wrong reading of a fact the repo had already settled: the list path returns
`unreadable: 1` for a `query-error` and `unreadable: 0` — a conclusive empty store — for `no-db`
(`opencodeReader.ts:252-259`, pinned by `opencodeReader.test.ts:106-110`). Answering `unknown` to the
same fact would have put two contradictory readings of `no-db` in one subsystem, which is the defect
this phase exists to remove, and would have meant no OpenCode preview is ever retired.

What is true is that `no-db` does not yet mean what it says — see D6, which fixes that instead of
routing around it.

**Rejected**: making the by-id path conservative on its own and leaving the list path alone. It buys
safety by disagreeing with shipped, tested behaviour about the same fact, and hides the real defect
one layer down.

### D3: `getEntry` stays, as the unwrapping wrapper

```ts
async lookupEntry(entryId: string): Promise<VaultEntryLookup>   // new, carries the enrichment
async getEntry(entryId: string): Promise<VaultSessionEntry | null> {
  const found = await this.lookupEntry(entryId);
  return found.status === "found" ? found.entry : null;
}
```

Six call sites across `extension.ts`, `TerminalViewProvider.ts` and `VaultLauncher.ts` want a
launchable entry or nothing; none of them has anything to do with `absent`, and rewriting them to
re-collapse the union would be churn that reads like meaning. `vault-session-launch` § "Launch
resolves a single entry by id" also states `getEntry`'s null return for synthetic nesting ids as an
accepted requirement — keeping the wrapper keeps that requirement true verbatim.

The `canFork` enrichment and the Cursor id rewrite stay on the `found` branch of `lookupEntry`, so
they run exactly when they run today.

### D4: A scan that skipped a directory it could not read has not completed

Both filename scanners currently swallow the distinction D2 depends on:

- `codexReader.findCodexRolloutByFilename` catches a failed `readdir` per directory and `continue`s,
  then returns `null` — a scan that could not enter half the tree looks exactly like an exhaustive
  one that found nothing.
- `claudePaths.resolveClaudeSessionPath` returns `null` when the top-level `readdir` throws, whether
  that is ENOENT (the projects dir does not exist — genuinely absent) or EACCES/EIO (unknown), and
  again when `prepareResolvedRoot` cannot realpath the store root (unknown: containment could not be
  established, so nothing was searched).

Each grows a sibling that reports whether the walk was exhaustive; the existing function stays as the
`string | null` wrapper for its three other callers (`claudeChildren`, `claudeTeam`,
`VaultService`), which do not need the distinction and are not touched.

Per-candidate handling inside a listed directory needs the same care, and only Claude has it to get
wrong: `claudePaths.ts:87-94` catches every `stat` rejection as "not in this project dir", which is
true of ENOENT and false of EACCES or EIO. The catch inspects the error it already holds — an
absence-class error is a miss, anything else makes the scan non-exhaustive. Codex performs no
per-candidate `stat` at all; it reads `dirent.isFile()` off the `readdir` it already did.

### D5: What each reader reports

No row needs a syscall the reader does not already make. But no reader *surfaces* these distinctions
today — each computes one internally and discards it at the `return`, which is what D4 describes for
the two filename scanners and is equally true of the mappers and the Cursor sub-resolvers. The work
in every reader task is threading a status out of an operation that already ran.

**Claude** — `readClaudeEntry`

| Condition | Answer |
|---|---|
| Id fails the safety check (includes every synthetic `:`-bearing id) | `absent` |
| Projects dir missing (ENOENT) | `absent` |
| Projects dir unreadable for any other reason | `unknown` |
| Store root cannot be realpath'd (`prepareResolvedRoot` null) | `unknown` |
| Exhaustive scan of the project dirs, no such file | `absent` |
| Scan skipped a project dir it could not list | `unknown` |
| A candidate `stat` failed with anything but an absence-class error | `unknown` |
| File found, `buildClaudeEntry` returns falsy or throws | `unknown` |
| Entry built | `found` |

**Codex** — `readCodexEntry`

| Condition | Answer |
|---|---|
| Id fails `isSafeCodexId` | `absent` |
| SQLite `ok`, a row that `mapThreadRow` maps | `found` |
| SQLite `ok`, a row `mapThreadRow` rejects | `unknown` — the store holds it, we could not build it |
| SQLite `ok`, zero rows | `absent` |
| SQLite `no-db`/`no-sqlite3`, rollout root missing (ENOENT) | `absent` |
| SQLite `no-db`/`no-sqlite3`, rollout file found and built | `found` |
| SQLite `no-db`/`no-sqlite3`, exhaustive rollout scan, no file | `absent` |
| SQLite `no-db`/`no-sqlite3`, scan skipped an unreadable directory | `unknown` |
| SQLite `no-db`/`no-sqlite3`, rollout found but the build threw | `unknown` |
| SQLite `db-unreachable` | the rollout fallback still runs; `absent` only from an exhaustive walk, else `unknown` |
| SQLite `query-error` | `unknown` |

The `query-error` row is the finding that produced this change: it is the path the reader's own
comment already labels "unresolved", returned as the same `null` as a genuine miss.

The `db-unreachable` row was amended after round-1 review. It first said `unknown` outright, which
silently dropped a fallback: before D6, an EACCES on the database arrived as `no-db` and entered the
rollout scan, so a session with a readable rollout file resolved. Answering `unknown` before that
scan is a behaviour change for every existing `getEntry` caller, which D3 promises there are none of.
An unreachable database is a reason to consult the other source, not to stop.

**OpenCode** — `readOpenCodeEntry`

| Condition | Answer |
|---|---|
| Id fails `isSafeOpenCodeId` | `absent` |
| SQLite `ok`, a row that `mapSessionRow` maps | `found` |
| SQLite `ok`, a row `mapSessionRow` rejects | `unknown` — the store holds it, we could not build it |
| SQLite `ok`, zero rows | `absent` |
| SQLite `no-db` (after D6: the database file is confirmed missing) | `absent` |
| SQLite access failure (after D6), `no-sqlite3`, or `query-error` | `unknown` |

**Cursor** — `readCursorEntry`, three locator shapes plus the host-side child map

| Condition | Answer |
|---|---|
| A `CURSOR_CHILD_PREFIX` id with no entry in `cursorChildLocators` | `unknown` — see below |
| A candidate matched, but the enumeration that proves it UNIQUE was incomplete | `unknown` |
| `ide:` / `project:` / CLI sub-reader resolves an entry | `found` |
| Sub-reader's enumeration completes with no match | `absent` |
| IDE header query failed, or its row could not be parsed | `unknown` — the nested query did not run |
| Sub-reader's database or file access fails | `unknown` |

The child-map row was planned as `absent` on the grounds that the map is host-side truth. It is not:
`cursorChildLocators` is an insertion-ordered `Map` (`VaultService.ts:293`) trimmed to
`MAX_CURSOR_CHILD_LOCATORS` by evicting its oldest key (`:843-847`), so a miss means the locator was
never issued, was evicted for capacity, or did not survive a process restart — the last two while the
project transcript is still on disk. The map is truth about what this process can currently decode,
never about whether a session exists, so it answers `unknown`. The D12 access boundary is unaffected:
a forged locator resolves to nothing either way.

Cursor's three sub-resolvers collapse "no match" and "could not read" into one `null` BELOW
`readCursorEntry` — `cursorPaths.ts:143-190,272-287`, `cursorTranscript.ts:97-157,301-330`,
`cursorIdeReader.ts:293-325,468-481`. None of these rows is reachable at the `readCursorEntry` seam,
which is why its task leases four files and is the largest of the four reader tasks.

### D6: `no-db` is made to mean what it says, rather than worked around

`readSqlite` reports `no-db` when its presence check says the file is not there, and that check
returns `false` for every `fs.access` rejection alike (`sqlite.ts:112-118`, `:269-276`) — a database
behind an unreadable directory is reported identically to one that was deleted. Two consumers then
read the same status differently: the list path treats it as a conclusive empty store, and this
change's first draft treated it as unknown.

The presence check distinguishes the two from the error it is already given — an absence-class error
is a confirmed miss, anything else is an access failure — and `readSqlite` reports them as separate
statuses. No new syscall, and `no-db` keeps its current meaning for every consumer that reads it as
"the file is not there", because that is now the only thing it says. The list path gains the one
behaviour change: an access failure counts as unreadable rather than as an empty store.

This lands as its own task ahead of the Codex and OpenCode classifications, because it is shared
vocabulary rather than either reader's business.

**Rejected**: probing with a `stat` beside the existing check. It answers a question already answered
and adds a syscall to every store read.

## Failure-surface inventory

The change performs no writes, takes no locks, and spawns no processes; every path is a read that
already runs. The one row that is not `n/a` is the change's whole subject.

| Resource | Answer |
|---|---|
| Writes / crash mid-write / two racing hosts | n/a — read-only; no path here mutates a store, a cache, or a file |
| Serialization | n/a — no shared mutable state is added; `VaultEntryLookup` values are immutable and per-call |
| A failed or malformed read fails open or closed | **Open, and that is the decision**: it reports `unknown`, which every caller treats as today's `null` — no launch, no cwd, and (in WT-011.5) no change to the line already drawn. Failing closed would mean reporting `absent`, which asserts a fact the reader did not establish |
| A store that disappears between two lookups | Answers `absent` on the Codex/Cursor/Claude paths that can enumerate a second source, `unknown` on OpenCode. Both are honest about what was checked; neither is cached, so the next lookup re-asks |

## Risk Map

| Risk | Mitigation |
|---|---|
| A reader reports `absent` where it only failed to look, and WT-011.5 later blanks a live row | D2 makes `unknown` the default for every non-exhaustive path, and each reader's task pins its own error paths with a test that asserts `unknown` specifically — not merely "not found" |
| The two filename scanners keep swallowing partial walks after D4, so `absent` looks proven | The partiality flag is the tested unit: a scan over a tree with one unreadable directory must answer `unknown` even though the remaining directories were searched exhaustively |
| Widening the adapter contract silently changes an existing caller | `getEntry` is unchanged by construction (D3) and the six call sites are not edited; task 1_1 lands the seam with every reader wrapped as `non-null → found, null → unknown`, which is behaviour-identical, before any reader starts classifying |
| Scope creep into the list/detail/cache paths, which share these readers | Boundary on every task: only the by-id `entry` path changes, plus the one list branch D6 necessarily moves. `unreadable` stays the list's aggregate record accounting and `unknown` stays one lookup's epistemic result — reviewed as a possible duplication and kept distinct, with their malformed-record handling aligned instead |
| D6 changes a status two shipped list readers consume | Its task owns the list-side branch and the existing `no-db` test, so the change is made and re-pinned in one place rather than discovered by whichever reader task ran second |
