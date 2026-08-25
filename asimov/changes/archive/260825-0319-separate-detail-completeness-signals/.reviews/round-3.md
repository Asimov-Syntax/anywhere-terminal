# Review Round 3

- Date: 2026-08-25
- Target: separate-detail-completeness-signals
- Scope: working-tree re-review — round-2 rebutted files plus changes since round 2
- Reviewable lines: 92
- Agents spawned: 4 (`asm-review-contracts`, `asm-review-data-security`, `asm-review-logic`, `asm-review-performance`)
- Agents skipped: `asm-review-frontend` (no webview changes), `asm-review-reuse` (the round correctly reuses `withSqliteSnapshot`)
- Verdict: BLOCK
- Counts: BLOCK 2 | WARN 0 | SUGGEST 1

## Cross-round resolution

- Round 2 B1: fixed — all seven detail queries now execute against one `withSqliteSnapshot` copy.
- Round 2 B2: fixed in its original false-complete direction, but the replacement encoding introduces new finding B2 below.
- Round 2 B3: fixed — unbounded COUNT scans are gone; indexed OFFSET probes have constant caps.
- Round 2 W1: fixed — the latest task declaration describes bounded existence probes rather than COUNT.
- Round 2 S1: fixed — part-only capacity+1 overflow now has direct coverage.

## Findings

### B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-contracts
- file: src/vault/readers/opencodeReader.ts:677
- title: Constant-capacity probes can still report complete after tied windows omit rows
- evidence: The probes test whether table cardinality exceeds the nominal 2,100/5,000 capacities, but the actual retained set is the de-duplicated head/tail union. Because both windows order only by `time_created`, tied timestamps are not a total order: ASC and DESC can overlap on some rows while both miss others. A direct SQLite reproduction with 5,000 `part` rows sharing one timestamp and `part_session_idx(session_id)` produced a 1,000-head/4,000-tail union of only 4,000 rows, while `LIMIT 1 OFFSET 5000` returned no row. The current code therefore reports complete despite omitting 1,000 source rows.
- impact: The new source-omission signal still has a reachable false-complete case, violating the requested iff semantics in the same direction as the accepted round-2 B2 finding.
- suggestedFix: Give both head/tail pairs a stable, exactly reversed total order: `ORDER BY time_created ASC, id ASC` and `ORDER BY time_created DESC, id DESC`, then add an equal-timestamp exact-capacity regression. Alternatively, keep arbitrary window order but split the shared-snapshot callback into two bounded phases and probe at `OFFSET msgRows.length` / `OFFSET partRows.length`, which compares source cardinality with what was actually retained. Either approach remains structurally bounded; the stable-order fix preserves the current parallel query shape.
- status: accepted
- triage: ACCEPTED. The chair reproduced it in SQLite (5,000 part rows on one timestamp -> 4,000 unique from the 1000-head/4000-tail union, OFFSET 5000 empty, 1,000 rows omitted and reported complete). asm-review-performance had independently routed the same finding to me out of band and I confirmed it before this report. My round-2 probe is exact only if the two windows are complementary, which ORDER BY time_created alone does not guarantee. Two candidate fixes: a total order (time_created, id) reversed exactly between head and tail, or probing at the actual deduped retained lengths in a second bounded phase inside the same snapshot. NOT fixed — round limit reached, handed to the user.

### B2

- ID: B2
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-contracts
- file: src/vault/readers/opencodeReader.ts:760
- title: Unverified completeness is encoded as confirmed source omission
- evidence: A failed probe establishes only that completeness is unknown. The branch nevertheless calls `finalizeDetail(..., true)`, setting `partial:true`. The changed public contract defines `partial` as “SOURCE OMISSION, and nothing else” and says the read dropped records no larger limit can recover. `UNVERIFIED_REASON` explains uncertainty but does not establish omission.
- impact: A potentially complete, fully preserved timeline is represented as known irrecoverably incomplete, introducing a third state under a Boolean whose documented meaning excludes it. The reason string cannot redefine the flag's public semantics.
- suggestedFix: If retaining the timeline on probe failure is required, add and specify an independent verified/unverified completeness state that can coexist with `partial` and `truncated`. Without that contract/spec change, fail the detail read on probe failure rather than setting `partial`. Do not discard a potentially complete timeline merely to manufacture source omission.
- status: accepted
- triage: ACCEPTED, and the error is mine twice over. Task 1_1 of THIS change wrote the contract as `partial` = "SOURCE OMISSION, and nothing else" (src/vault/types.ts), and the round-2 fix then set partial:true for unverified completeness, contradicting it inside the same change. When I put this choice to the user I justified "no spec change" from the ADDED requirement's WHEN wording and failed to check the TypeScript contract I had authored myself earlier in the change, so the option was presented as cleaner than it was. Resolution is a user decision: fail the detail read on probe failure (stays in build, but is the metadata-only degrade the user already declined), or model verified/unverified explicitly (spec change -> handback to asimov-plan and Gate 2 re-approval). NOT fixed — user decision required.

### S1

- ID: S1
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: chair, asm-review-logic
- file: src/vault/readers/opencodeReader.detail.test.ts:61
- title: Several migrated fixtures answer probe queries with transcript rows
- evidence: `childDetailMock`, the inline child-session mocks, and the short-overlap fixture dispatch by `FROM message`/`FROM part` without checking `OFFSET` first. Their probe queries therefore return ordinary non-empty transcript rows, spuriously setting `messageWindowTruncated`/`partWindowTruncated` and making short fixture details partial. Those tests do not assert completeness, so they remain green while modeling the wrong state.
- impact: Future completeness assertions in these fixtures can inherit a hidden false premise, and the short-session regression currently proves de-duplication while silently returning a partial detail.
- suggestedFix: Route `OFFSET` queries before ordinary windows in every detail mock; return empty rows for complete short fixtures. Add `expect(detail?.partial).toBeFalsy()` to the short-overlap case and update the stale query-count comment from COUNT to probes.
- status: accepted
- triage: ACCEPTED. Self-inflicted by my round-2 fixture migration: child and short-session mocks route on FROM message / FROM part before checking OFFSET, so probe queries return ordinary transcript rows and those nominally complete fixtures silently became partial:true with nothing asserting otherwise. The suite stayed green because no short-session test asserts partial. Fix is to route OFFSET first, return empty for complete fixtures, assert partial is falsy in the short-overlap test, and drop the stale COUNT comment. NOT fixed — round limit reached.
