# Review Round 7

- Date: 2026-08-24
- Scope: commit `0033523` only
- Reviewable lines: 234
- Large change: no
- Agents spawned: asm-review-logic, asm-review-contracts, asm-review-frontend, asm-review-data-security, asm-review-performance, asm-review-reuse
- Agents skipped: none
- Verdict: WARN
- Counts: BLOCK 0 | WARN 1 | SUGGEST 0

## Current Findings

### W19

- ID: W19
- severity: WARN
- confidence: MEDIUM
- priority: P3
- agent: asm-review-frontend
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/previewTimeline.ts:180
- title: Nested-card tuple encoding can collide on the delimiter
- evidence: `nestedCardKeys()` encodes the tuple as `` `${item.entryId}|${title}` ``. `title`/`preview` is free text and may contain `|`; the entry-id contract does not reserve that delimiter, and OpenCode child stubs currently pass a store row's `id` into `formatEntryId()` without applying `isSafeOpenCodeId`. Distinct tuples can therefore collapse into one count group, for example `(opencode:ses_x, a|b)` and `(opencode:ses_x|a, b)`. If load-more prepends the latter before an expanded former card, the former moves from ordinal `#0` to `#1` and expansion transfers to the prepended card—the same renumbering defect W18 intended to remove, now behind a delimiter collision.
- impact: A malformed or version-drifted external child row can make two distinct cards exchange expansion state after a re-render, opening the wrong nested transcript/fallback card.
- suggestedFix: Use an injective tuple encoding such as `JSON.stringify([item.entryId, title])` or a length-prefixed pair for the count identity and card key. Add a prepend regression with two distinct tuples that collide under the current `|` concatenation.
- status: new
- triage: Retained from the frontend specialist. Chair validation found a concrete producer path: OpenCode child stubs render raw child row ids without the safe-id validator, so a pipe-bearing entry id is not merely a type-level hypothetical. Confidence remains MEDIUM because it requires malformed/version-drifted source data.

- authorStatus: accepted
- authorTriage: The producer path is real — nothing reserves `|` in an entry id, and the concatenation is not injective. Taking the suggested `JSON.stringify([entryId, title])` encoding (self-delimiting, no escaping to maintain) with the colliding-tuple prepend regression.

## Cross-round Disposition

- Round-6 B18: fixed — `VaultLauncher` uses `getLaunchTarget()` and carried identity proof only for Resume/Copy; Continue and Fork resolve through `getEntry()`. Cursor Fork remains capability-rejected as required.
- Round-6 W15: fixed — nested requests carry a webview-generated request id, the host echoes it on success, not-found, and exception replies, and the controller renders only an exact pending `(entryId, requestId)` match. Generation and orphan ledgers are removed.
- Round-6 W17 rebuttal: sustained; the prior finding is rejected and not re-reported. `cursorNormalization` can parse result-shaped records, but the recorded three-transcript census found no mirror `tool_result` blocks, and a repeat census of the named parent and child found only `text`/`tool_use` blocks plus `turn_ended`. The identity-bearing `Agent ID:` result exists in `store.db`, so mirror correlation has no demonstrated current input to join. Revisit only if a real Cursor project JSONL format emits correlated Task/Agent results.
- Round-6 W18: fixed under the accepted-modified floor — keys use child id, title/preview, and nth among identical cards; the same-child/different-title prepend regression passes. Genuinely identical cards remain deliberately indistinguishable.
- Round-6 S10: fixed — resume-agent validation delegates to `isSafeCursorChatId` while retaining the normalizer's local type and length guard.

## Specialist Disposition

- asm-review-logic: no findings; request-id lifecycle and launch branching verified; prior W17 finding overruled for lack of a demonstrated mirror result format.
- asm-review-contracts: no findings; additive IPC contract, D14 launch proof, Fork rejection, and accepted card-key floor verified.
- asm-review-frontend: W19 retained; no other UI-state or rendering findings.
- asm-review-data-security: no findings; Resume/Copy proof boundaries and opaque echo behavior verified.
- asm-review-performance: no findings; preview maps are bounded by the open preview/timeline, and the scalar request sequence retains no ledger.
- asm-review-reuse: no findings; canonical validator and existing request-correlation convention are reused appropriately.

## Verification

- Focused Wave-12 suites: passed, 4 files / 208 tests.
- `pnpm run check-types`: exited 2 with only the documented pre-existing `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/markdownLite.ts:80` TS2339 error.
- Biome check over the six changed source files: passed.
- `git show --check --format= 0033523`: passed.
- Changed tests contain no `.only` or `.skip` focus markers.
- `build-state.json` parses as valid JSON.
- Named W17 census: parent `e02838b2-b235-439c-98ee-1ea72905d4f8` had `text=14`, `tool_use=5`, `turn_ended=1`; child `82e87c39-e85e-4a03-9462-25fd78499f74` had `text=7`, `tool_use=6`, `turn_ended=1`; neither contained `tool_result`.
