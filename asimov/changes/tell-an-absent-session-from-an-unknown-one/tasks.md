## 1. One answer shape, then one reader at a time

- [x] 1_1 Give a by-id lookup somewhere to say "I could not find out" — verified: pnpm exec vitest run 'src/vault/VaultService.wiring.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: <!-- design.md D1, D3 -->
  - **Boundary**: no reader classifies its own paths yet — each is wrapped so a non-null read is found and a null read is unknown, which is behaviour-identical
  - **Acceptance**:
    - Outcome: `lookupEntry` answers with the union for every agent and `getEntry` returns what it did before
    - Verify: unit src/vault/VaultService.wiring.test.ts
  - **Plan**:
    1. Declare `VaultEntryLookup` in `src/vault/types.ts` per design.md D1.
    2. Widen `VaultAgentAdapter.entry` in `src/vault/VaultAgentAdapter.ts` to return it.
    3. Export a `lookup*Entry` beside each `read*Entry` in `src/vault/readers/claudeReader.ts`, `src/vault/readers/codexReader.ts`, `src/vault/readers/opencodeReader.ts` and `src/vault/readers/cursorReader.ts`, each wrapping its existing reader per the Boundary. These become the sole callers of the `read*Entry` functions, so tasks 1_2 to 1_5 can rewrite one reader each without meeting here again.
    4. Keep the exported `VaultEntryReaders` injection seam null-returning and wrap it where it is installed, so every injected reader keeps working unchanged; do not widen it.
    5. In `src/vault/VaultService.ts`, register the four `lookup*Entry` functions; add `lookupEntry` carrying the Cursor id rewrite and the `canFork` enrichment on its found branch; reduce `getEntry` to the unwrapping wrapper.
    6. Also in `src/vault/VaultService.ts`, report unknown for a `CURSOR_CHILD_PREFIX` id absent from `cursorChildLocators` — the map is capacity-evicted and per-process, so a miss is undecodable, not proof of absence (design.md D5).
    7. Cover both seams in `src/vault/VaultService.wiring.test.ts` and `src/vault/VaultService.test.ts`: a synthetic nesting id and an unknown agent still give null from `getEntry`, a found entry still arrives enriched, and production entry registration still resolves.

- [x] 1_2 Make a missing database distinguishable from an unreachable one — verified: pnpm exec vitest run 'src/vault/sqlite.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: <!-- design.md D6 -->
  - **Boundary**: `no-db` keeps its current meaning — the file is not there; only the access-failure case moves out of it
  - **Acceptance**:
    - Outcome: an unreadable database directory no longer reports the same status as a deleted database
    - Verify: unit src/vault/sqlite.test.ts
  - **Plan**:
    1. In `src/vault/sqlite.ts`, have the presence check separate an absence-class `fs.access` rejection from any other, using the error it already receives, and report the two as distinct statuses from `readSqlite`.
    2. In `src/vault/readers/opencodeReader.ts`, count the new access-failure status as unreadable in the list path rather than as an empty store, leaving the `no-db` branch as it is.
    3. In `src/vault/readers/codexReader.ts`, have its local status alias reference `SqliteStatus` rather than re-listing its members, so the new status cannot be missed there.
    4. Re-pin the existing `no-db` list expectation in `src/vault/readers/opencodeReader.test.ts` and add the access-failure case beside it.

- [x] 1_3 Let the Claude reader say which of the three it means — verified: pnpm exec vitest run 'src/vault/readers/claudeReader.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: <!-- design.md D2, D4, D5 (Claude) -->
  - **Boundary**: `resolveClaudeSessionPath` keeps its current signature and its three other callers are not touched
  - **Acceptance**:
    - Outcome: a Claude session never stored reports absent; every path that failed to look reports unknown
    - Verify: unit src/vault/readers/claudeReader.test.ts
  - **Plan**:
    1. Move the errno-to-presence decision task 1_2 put in `src/vault/sqlite.ts` into `src/utils/fsPresence.ts` and re-export it there, so the by-id scanners share the one definition of which failures prove absence rather than restating it.
    2. In `src/vault/readers/claudePaths.ts`, add a sibling of `resolveClaudeSessionPath` reporting the path plus whether the scan was exhaustive, separating an ENOENT projects dir from any other `readdir` failure and from a `prepareResolvedRoot` miss; keep the existing function as its wrapper.
    3. In the same file, make the per-candidate `stat` catch inspect the error it already has: an absence-class error is a miss, anything else makes the scan non-exhaustive.
    4. In `src/vault/readers/claudeReader.ts`, give `lookupClaudeEntry` the real classification from the D5 Claude table, reporting unknown when the entry build returns nothing or raises.
    5. Test each row of the table, asserting unknown specifically on the failure paths rather than "not found".

- [ ] 1_4 Let the Codex reader say which of the three it means
  - **Deps**: 1_2
  - **Refs**: <!-- design.md D2, D4, D5 (Codex), D6 -->
  - **Boundary**: the SQLite-first / rollout-fallback order is unchanged; no new probe is added
  - **Acceptance**:
    - Outcome: a Codex query error reports unknown where it returned the null a genuine miss returns
    - Verify: unit src/vault/readers/codexReader.test.ts
  - **Plan**:
    1. In `src/vault/readers/codexReader.ts`, make `findCodexRolloutByFilename` report whether its walk entered every directory, replacing the silent `continue` on a failed `readdir`.
    2. Give `lookupCodexEntry` the real classification from the D5 Codex table, retiring the `// query-error → unresolved` comment now that the return type says it.
    3. Report unknown when `mapThreadRow` rejects a row the query returned, and absent when the rollout root itself is missing.
    4. Test every `SqliteStatus`, both rollout outcomes, a scan over a tree holding one unreadable directory, and a returned-but-unmappable row.

- [ ] 1_5 Let the OpenCode reader say which of the three it means
  - **Deps**: 1_2
  - **Refs**: <!-- design.md D2, D5 (OpenCode), D6 -->
  - **Boundary**: no fallback source is added for OpenCode; the `no-db`/access-failure split is task 1_2's and is consumed here, not redefined
  - **Acceptance**:
    - Outcome: an OpenCode lookup separates a deleted session, a deleted store, and a store it could not read
    - Verify: unit src/vault/readers/opencodeReader.test.ts
  - **Plan**:
    1. In `src/vault/readers/opencodeReader.ts`, give `lookupOpenCodeEntry` the real classification from the D5 OpenCode table, splitting today's single `result.status !== "ok" || rows.length === 0` guard.
    2. Report unknown when `mapSessionRow` rejects a row the query returned, rather than passing its nullable result straight out.
    3. Test each status, with the confirmed-missing database reporting absent and the unreachable one reporting unknown.

- [ ] 1_6 Let the Cursor reader say which of the three it means
  - **Deps**: 1_1
  - **Refs**: <!-- design.md D2, D5 (Cursor) -->
  - **Boundary**: the three locator shapes keep their current routing, and the host-side child locator map is task 1_1's, not this one's. Largest of the reader tasks — four files, three independent resolvers
  - **Acceptance**:
    - Outcome: a Cursor lookup reports absent only from a store it could read
    - Verify: unit src/vault/readers/cursorReader.test.ts
  - **Plan**:
    1. Thread a status out of the CLI resolver in `src/vault/readers/cursorPaths.ts`, which collapses unsafe, unlocatable and ambiguous ids with a failed candidate scan.
    2. Thread a status out of the project resolver in `src/vault/readers/cursorTranscript.ts`, whose bounded cwd walk and caught `stat` failures return the same nothing as a genuine miss.
    3. Thread a status out of the IDE resolver in `src/vault/readers/cursorIdeReader.ts`, which returns the same nothing for an invalid id, a missing composer, and any non-ok snapshot status.
    4. In `src/vault/readers/cursorReader.ts`, give `lookupCursorEntry` the real classification per the D5 Cursor table, keeping the prefix routing as it is.
    5. Test one absent and one unknown case per locator shape.
