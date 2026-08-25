# Review Round 1

- Date: 2026-08-25
- Scope: working tree
- Reviewable lines: 1271
- Size note: Large change — accuracy may decrease
- Agents spawned: asm-review-contracts, asm-review-logic, asm-review-data-security, asm-review-reuse, asm-review-frontend
- Agents skipped: asm-review-performance (all changed collections are structurally bounded or module-initialized; no persistence/list/hot-path growth axis changed)
- Verdict: WARN
- Counts: BLOCK 0 | WARN 2 | SUGGEST 0
- Verification: `pnpm run check-types` passed; focused vault tests passed (25 files, 666 tests); full unit suite passed (155 files, 2903 tests); `biome check src/` passed with 13 pre-existing warnings and no errors

## Findings

### W1

- ID: W1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: asm-review-logic
- File: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/VaultService.ts:336
- Title: Required adapter capability can be overwritten with `undefined`
- Evidence: `VaultServiceDeps.adapters` is typed as `Partial<Record<VaultAgentId, Partial<VaultAgentAdapter>>>`. With the project's default optional-property semantics, required members such as `detail` may be explicitly set to `undefined`. The final spread of `deps.adapters?.[id]` then overwrites the default adapter function, while callers such as `getDetail()` invoke the required capability without a guard. The existing test's explicit `undefined` watch overrides also demonstrate that this optional-property style is accepted by the project compiler.
- Impact: A consumer of the new override seam can make list/detail/entry/record operations throw a runtime `TypeError` instead of falling back to the default required capability. The legacy full-record injection seams did not permit an omitted required reader.
- SuggestedFix: Merge required adapter capabilities only when their override value is defined. Preserve explicit-`undefined` removal semantics only for optional capabilities such as `renameNative`, `storeWatchTargets`, and `sessionWatchTargets`; alternatively define a dedicated override type that distinguishes required replacements from removable optional capabilities.
- Status: accepted
- Triage: Confirmed independently. `tsconfig.json` sets only `"strict": true` — `exactOptionalPropertyTypes` is absent — so `{ detail: undefined }` compiles, and the dispatch sites (VaultService.ts:433, :798, :858, :882) call the capability with no guard. The finding correctly scopes the hazard to the NEW seam: the legacy per-capability deps are full `Record<VaultAgentId, …>` maps, so `deps.readers[id]` is never `undefined` and they cannot erase anything. Taking the first suggested fix, not the dedicated override type: drop-on-undefined is load-bearing for the optional capabilities — task 2_3's test exercises an adapter declaring neither watch capability, which is D6's absence-not-stubbed claim — so the merge must keep that behavior for the optional three and ignore `undefined` only for the required four.

### W2

- ID: W2
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: chair
- File: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/detailContract.testkit.ts:28
- Title: Shared contract assertion permits a forbidden `truncated: false` signal
- Evidence: The approved delta spec says a metadata-only detail SHALL carry no `truncated` signal, but `expectDetailContract` uses `toBeFalsy()`. That assertion accepts both absence and an explicitly present `false`, despite the testkit's purpose being to prevent reader contract drift.
- Impact: A future metadata-only producer can emit `truncated: false` and still pass the shared conformance assertion, weakening the structural no-pageability guarantee and allowing the shared contract vocabulary to diverge from the accepted spec.
- SuggestedFix: Assert `d.truncated` is `undefined` rather than merely falsy.
- Status: accepted
- Triage: Confirmed. `limitedDetail` never writes `truncated`, so every metadata-only detail this change produces already satisfies the stronger assertion — tightening costs nothing today and is exactly what the testkit exists to hold. Accepting as stated.
