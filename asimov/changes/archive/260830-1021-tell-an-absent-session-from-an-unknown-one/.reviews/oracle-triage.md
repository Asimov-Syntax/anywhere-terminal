# Oracle triage — planning round (5 BLOCK, 1 WARN, 1 SUGGEST)

All five BLOCKs verified against the code before triage. All accepted; one with a scope decision.

## F1 — task 1_5's lease cannot implement D5 — ACCEPTED

Independently confirmed by a read-only peer first. All three Cursor sub-resolvers collapse "no match"
and "could not read" before `readCursorEntry:631-642` routes them: `cursorPaths.ts:143-190,272-287`,
`cursorTranscript.ts:97-157,301-330`, `cursorIdeReader.ts:293-325,468-481`. Fix: the Cursor task
leases four files, and its size is stated rather than implied.

## F2 — a child-map miss is not proof of absence — ACCEPTED, and worse than reported

Verified: `cursorChildLocators` is an insertion-ordered `Map` (`VaultService.ts:293`) trimmed to
`MAX_CURSOR_CHILD_LOCATORS` by evicting its oldest key (`:843-847`). A miss at `:859-867` therefore
means *never issued*, *evicted for capacity*, or *process restarted* — the last two while the project
transcript is still on disk. Calling it "host-side truth" was wrong: the map is truth about what this
process can currently decode, never about whether a session exists. It answers `unknown`. The D12
access boundary is untouched — a forged locator still resolves nothing either way.

## F3 — D4 still permits a false Claude `absent` — ACCEPTED

Verified at `claudePaths.ts:87-94`: every candidate `stat` failure is caught and treated as "not in
this project dir". ENOENT means that; EACCES/EIO does not. The catch must inspect the error it
already has. The oracle also caught a plain error of fact in design.md — the sentence claiming
per-candidate `stat` failures "stay non-fatal in both" is false of Codex, which uses `dirent.isFile()`
off the `readdir` and performs no per-candidate `stat` at all.

## F4 — the OpenCode missing-store rule — ACCEPTED IN FULL, and it reverses my D2 example

This is the finding I would have got wrong. Verified:

- `sqlite.ts:112-118` — the default `exists` catches every `fs.access` rejection and returns `false`;
  `:269-276` turns that into `no-db`. So `no-db` today conflates "the file is not there" with "I
  could not reach it", which is why mapping it to `absent` would be unsafe.
- But the LIST path already decided this question the other way and shipped it:
  `opencodeReader.ts:252-259` returns `unreadable: 1` for `query-error` and `unreadable: 0` for
  `no-db`/`no-sqlite3` — i.e. a conclusive empty store — pinned by `opencodeReader.test.ts:106-110`.

So my D2 did not choose the conservative reading of a shared fact; it chose the *opposite* reading
from the one already shipped beside it, which is precisely the second-definition-of-one-concept
defect Phase 11 exists to remove. Pinning `no-db` to `unknown` forever would also mean no OpenCode
preview is ever retired.

The right fix is the one the oracle names, and it is smaller than my first estimate: make `no-db`
mean what it says by having the presence check distinguish an ENOENT miss from an access failure —
information `fs.access` already returns in the error it rejects with, so no new syscall. Then both
readers agree, and `absent` becomes reachable. That is a shared-vocabulary change to `sqlite.ts`, so
it lands as its own task ahead of the Codex and OpenCode classifications rather than inside either.

Also accepted: Codex needs the analogous ENOENT rule for its rollout root, and D2's prose claiming a
Codex/OpenCode asymmetry on uninstall was wrong — today neither reaches `absent` there.

## F5 — "row returned" is not `found` — ACCEPTED

Verified: `codexReader.mapThreadRow:142-160` and `opencodeReader.mapSessionRow:157-177` both return
null for a record the store conclusively holds, and the OpenCode by-id path returns that nullable
result directly (`:291-295`). The session exists and its entry could not be built — `unknown` under
D2. Both tables gain the row the Claude table already had.

## F6 (WARN) — the `VaultEntryReaders` injection seam — ACCEPTED

Verified: it is exported at `VaultService.ts:84` as `Promise<VaultSessionEntry | null>` and installed
straight into the adapter at `:358`. Task 1_1 must say which way it goes; it wraps rather than
widens, so existing injected readers keep working unchanged. `VaultService.wiring.test.ts` joins the
task's verification — it mocks `read*Entry` at `:63-97` and asserts production registration at
`:187-209`, which `VaultService.test.ts` alone would not catch.

## F7 (SUGGEST) — ACCEPTED

NO-DELTA stands, and the accepted requirement is preserved by the wrapper. `unknown` stays distinct
from the list path's `unreadable`: one is the epistemic result of a single lookup, the other is
aggregate record accounting. Their malformed-record handling is aligned by F5 rather than merged —
which also answers the reuse question I put to the oracle directly.
