# Review Round 2

- date: 2026-08-26
- scope: working tree re-review — accepted round-1 findings and changed files
- reviewable lines: 634
- verdict: BLOCK
- counts: BLOCK 1 | WARN 1 | SUGGEST 0
- prior findings: fixed 5 | partially fixed 2 | rejected 0
- agents spawned:
  - asm-review-logic — parser and concurrency fixes — gpt-5.6-sol[1M]
  - asm-review-contracts — accepted contract fixes — gpt-5.6-terra[1M]
  - asm-review-data-security — byte and path boundaries — sonnet[1M]
  - asm-review-performance — bounded mapping behavior — gpt-5.6-terra[1M]
  - asm-review-reuse — path helper extraction — gpt-5.6-luna[1M]
- agents skipped:
  - asm-review-frontend — no frontend changes

## Cross-round disposition

- round-1 B1: original path-byte substitution is fixed; accepted triage is incomplete because invalid display-only metadata still drops the record. Follow-up: round-2 B1.
- round-1 B2: fixed.
- round-1 W1: fixed.
- round-1 W2: persists from round 1; stderr matching was removed, but the required exit-zero guard is still absent. Follow-up: round-2 W1.
- round-1 W3: fixed.
- round-1 W4: fixed. `mapBounded` preserves input order and both callers remain capped at their supplied limit.
- round-1 W5: fixed. The provider extraction is behavior-preserving, and `getDescendantBuckets` retains its precomputed hot-path boundary.

## Findings

### B1

- ID: R2-B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + asm-review-logic + asm-review-contracts
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/porcelainParser.ts:160
- title: Invalid display-only bytes still discard the entire worktree
- evidence: Every raw field is passed through the fatal `strictUtf8` decoder before the token is identified. Invalid UTF-8 in a NUL-form `locked <reason>` field therefore clears `fields`, increments `skipped`, and drops the complete record at lines 160-170. A direct probe with a valid `/repo` path and byte `0xff` only in the lock reason returned zero worktrees, `skipped: 1`, and the inaccurate reason that the path was invalid. This contradicts round-1 B1's accepted triage, which requires fatal decoding for path identity while lock reasons remain lenient display text.
- impact: A valid worktree disappears because non-identity metadata cannot decode, and `unreadable.count` is inflated with a reason that misidentifies the failing field.
- suggestedFix: Identify fields from their ASCII token prefix before decoding values. Decode the `worktree` path fatally; decode lock/prunable reasons leniently. Decide and test the intended policy for other non-identity metadata such as `HEAD` and `branch`. Add a NUL-form invalid-byte lock-reason test that retains the worktree and leaves `skipped` at zero.
- status: accepted
- triage: Correct — the round-1 triage said lock reasons stay lenient and the implementation then decoded every field fatally, so the code contradicted its own stated policy. Fixing by identifying the token from its ASCII prefix first and decoding strictly only the bytes after `worktree `. Policy for the other non-identity metadata, made explicit: `HEAD`, `branch`, and lock/prunable reasons all decode leniently. None of them is the identity key — `id` comes from the normalized path — so a replacement character in a label is a worse-looking row, while dropping the record loses a worktree the user really has.

### W1

- ID: R2-W1
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair + asm-review-logic
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/repoRoots.ts:72
- title: A non-zero flag echo still poisons the shared capability
- evidence: `hasUnsupportedPathFormatEcho(result.stdout)` is checked without requiring `result.code === 0`. A direct probe where `/bad` exited 128 while echoing `--path-format=absolute` caused the capability to be cached as unsupported: `/ok` then skipped the preferred command and ran only the bare fallback. Round-1 W2's accepted triage requires an exit-zero output echo.
- impact: A repository-specific failure can disable the preferred command for unrelated repositories for 30 minutes and conceal the original failure behind fallback behavior.
- suggestedFix: Return `{ supported: false }` only when `result.code === 0 && hasUnsupportedPathFormatEcho(result.stdout)`. Add a non-zero-echo regression test proving the next repository still runs the preferred command.
- status: accepted
- triage: persists from round 1; the accepted exit-zero condition is still absent

## Verification

- `pnpm run check-types`: passed
- `pnpm run test:unit`: 165 files, 3067 tests passed
- `bun test src/utils/pathBoundary.test.ts src/worktree`: 137 passed
- direct invalid-lock-reason probe: reproduced round-2 B1
- direct non-zero path-format echo probe: reproduced round-2 W1 and cross-repo fallback poisoning
