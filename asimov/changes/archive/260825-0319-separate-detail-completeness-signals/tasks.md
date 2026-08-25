## 1. Contract

- [x] 1_1 Restate the two completeness signals in the `VaultSessionDetail` field docs — verified: manual — comment-only edit to the truncated/partial field docs in src/vault/types.ts; ran pnpm run check-types separately — clean
  - **Deps**: none
  - **Refs**: specs/vault-session-preview/spec.md#{source-omission-and-pageability-are-distinct-signals, bounded-detail-retains-both-transcript-ends}
  - **Acceptance**:
    - Outcome: the `truncated` and `partial` doc comments each describe one signal, not both
    - Verify: none — comment-only change, no runtime behavior
  - **Plan**:
    1. In `src/vault/types.ts`, rewrite the `truncated` comment (~:414-415) to pageability only, and drop the "transcript too large to read whole" clause from the `partial` comment (~:416-422) into a statement that both may hold at once.

## 2. Producers

- [x] 2_1 Split the two signals in the Cursor CLI reader — verified: pnpm run test:unit src/vault/readers/cursorReader.test.ts src/vault/readers/detail.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/vault-session-preview/spec.md#{source-omission-and-pageability-are-distinct-signals, bounded-detail-retains-both-transcript-ends}
  - **Boundary**: never force one signal off because the other is set — both may hold at once
  - **Acceptance**:
    - Outcome: a Cursor CLI read past its source cap reports `partial`, not `truncated`
    - Verify: command pnpm run test:unit src/vault/readers/cursorReader.test.ts src/vault/readers/detail.test.ts
  - **Plan**:
    1. In `src/vault/readers/cursorReader.ts`, drop `sourceTruncated ||` / `transcript.truncated ||` from the `truncated` expressions at ~:735 and ~:680, leaving only the `maxItems` comparison; route both returns through `finalizeDetail` (`src/vault/readers/detail.ts:191`) with that flag as its `sourceTruncated` argument, replacing the hard-coded `partial: false`.
    2. Keep `contentKind` in the parts object passed to `finalizeDetail` — it spreads `...detail` and does not set the field itself; dropping it makes `PreviewController` treat every Cursor session as metadata-only.
    3. In `src/vault/readers/cursorTranscript.ts` rename the local `MAX_TIMELINE_ITEMS` (500, ~:21), which shadows the exported 400 in `detail.ts:23`.
    4. Add the missing source-truncated coverage to `cursorReader.test.ts` (today `:1385` covers only limit truncation, `:1408` only metadata-only), reading each fixture at a limit BELOW the decoded count (assert `partial` and `truncated` both true) and ABOVE it (assert `partial` with a non-empty `limitedReason`, and `truncated` not true).
    5. Assert `contentKind === "timeline"` on the timeline cases and `"metadata-only"` on the limited one.

- [x] 2_2 Split the two signals in the Cursor IDE reader — verified: pnpm run test:unit src/vault/readers/cursorIdeReader.test.ts src/vault/readers/detail.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/vault-session-preview/spec.md#{source-omission-and-pageability-are-distinct-signals, bounded-detail-retains-both-transcript-ends}
  - **Boundary**: never force one signal off because the other is set — both may hold at once
  - **Acceptance**:
    - Outcome: a Cursor IDE read past its fixed source limits reports `partial`, not `truncated`
    - Verify: command pnpm run test:unit src/vault/readers/cursorIdeReader.test.ts src/vault/readers/detail.test.ts
  - **Plan**:
    1. In `src/vault/readers/cursorIdeReader.ts`, drop `sourceTruncated ||` from the `truncated` expression at ~:552 and route the return through `finalizeDetail` with it as the `sourceTruncated` argument, replacing `partial: false`. Both of its origins — the composer header cap (~:516) and `MAX_NORMALIZED_TEXT_CHARS` (~:529) — are fixed and never grow with the requested limit.
    2. Keep `contentKind` in the parts object, per 2_1 step 2.
    3. Update the two tests at `cursorIdeReader.test.ts:242-265` that currently assert `truncated: true` for the 501-header and normalized-text-ceiling cases; both pass no limit, so both now expect `partial` true and `truncated` not true.
    4. Add the below-the-decoded-count half to each so `partial` and `truncated` are pinned true together, and assert `contentKind`.

- [x] 2_3 Split the two signals in the OpenCode reader — verified: pnpm run test:unit src/vault/readers/opencodeReader.detail.test.ts src/vault/readers/detail.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/vault-session-preview/spec.md#{source-omission-and-pageability-are-distinct-signals, bounded-detail-retains-both-transcript-ends}
  - **Boundary**: never force one signal off because the other is set — both may hold at once
  - **Acceptance**:
    - Outcome: an OpenCode session whose fixed SQL windows dropped rows reports `partial`, not `truncated`
    - Verify: command pnpm run test:unit src/vault/readers/opencodeReader.detail.test.ts src/vault/readers/detail.test.ts
  - **Plan**:
    1. In `src/vault/readers/opencodeReader.ts`, stop assigning `windowTruncated` to `detail.truncated` at ~:733-735 and feed it to `finalizeDetail` as `sourceTruncated` instead. It derives from the fixed windows at `:43-46` issued at `:671-674`, which never grow with the requested limit; the pageable flag stays the one `boundTimeline` returns at `:567`.
    2. Update the disjoint-window test at `opencodeReader.detail.test.ts:425-485`, which today asserts `truncated: true`, to assert `partial` true with a `limitedReason` and `truncated` not true.
    3. Add a below-the-decoded-count read of the same fixture asserting `partial` and `truncated` both true.
    4. Establish omission by retained row count, never by window non-overlap — that predicate is a false positive at exactly 2,100 messages or 5,000 parts, where both windows are full and disjoint yet their union covers every row (review round 1, B1). Add one bounded `SELECT COUNT(*)` per table and set omission only when the true total strictly exceeds the deduped retained union; drive the inserted `gap` item off that same proof.
    5. Cover the boundary in `opencodeReader.detail.test.ts`: an exact-capacity fixture whose independently known total equals the retained union asserts NO `partial`, and a strictly-over-capacity fixture asserts `partial` (review round 1, W1). The gap alone is not evidence — it derives from the same predicate.
    6. Re-declare the task's `--test-change` so `build-state.json` records the evidence accurately, without calling an unbounded scan bounded (review round 1 W2, round 2 W1).
    7. Round 2 B1/B3: run every detail query on ONE snapshot via `withSqliteSnapshot`, following the `options.withSqliteSnapshotFn ?? readSnapshot` pattern in `src/vault/readers/cursorIdeReader.ts`. Seven independent `readSqlite` calls each copy the live DB, so a count could not be compared against the windows it judged. Replace the two `COUNT(*)` queries with bounded existence probes (`LIMIT 1 OFFSET` head+tail per table) — exact at the boundary and it does not scan session history.
    8. Round 2 B2: a probe that does not come back must never read as complete. Render the timeline but set `partial` with a reason saying completeness could not be verified.
    9. Round 2 S1: the `||` short-circuits on message overflow, so add a case with messages at exact capacity and the part total one over, proving the part branch independently.

## 3. Cross-layer proof

- [x] 3_1 Pin that a partial-but-complete detail offers no load-more affordance — verified: pnpm run test:unit src/webview/vault/VaultPanel.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/vault-session-preview/spec.md#load-more-is-offered-only-while-more-transcript-exists
  - **Boundary**: no production change expected — `PreviewController` already gates on `detail.truncated` alone
  - **Acceptance**:
    - Outcome: rendering a `partial`-without-`truncated` detail produces no load-older-messages button and requests nothing further
    - Verify: command pnpm run test:unit src/webview/vault/VaultPanel.test.ts
  - **Plan**:
    1. In `src/webview/vault/VaultPanel.test.ts`, render a detail with `partial: true` and a `limitedReason` but no `truncated`, and assert no `.vault-preview-loadmore` element exists while the `limitedReason` notice still renders.
    2. Assert a scroll-to-top dispatch posts no further `requestVaultSessionDetail` message.
    3. If this needs a production edit to pass, stop and report it — that means the renderer gates on something other than `truncated` and the change's premise is wrong.
    10. Round 3 B1: `ORDER BY time_created` is not a total order, so tied timestamps let the head and tail windows overlap while both miss rows — 5,000 parts on one timestamp yield 4,000 unique and the capacity probe reports complete. Give both windows an exactly reversed total order (`time_created ASC, id ASC` / `time_created DESC, id DESC`) and add an equal-timestamp regression at exact capacity.
    11. Round 3 B2: `partial` is contracted as source omission and nothing else (`src/vault/types.ts`, task 1_1), so an unverified read must not set it. A failed probe joins the existing window-query status check and returns null, exactly as every other failed query in this reader already does. Drop `UNVERIFIED_REASON`.
    12. Round 3 S1: the migrated child and short-session mocks match `FROM message`/`FROM part` before `OFFSET`, so probes returned transcript rows and silently made complete fixtures partial. Route `OFFSET` first, and assert `partial` is falsy in the short-overlap test so a complete fixture proves it stays complete.
