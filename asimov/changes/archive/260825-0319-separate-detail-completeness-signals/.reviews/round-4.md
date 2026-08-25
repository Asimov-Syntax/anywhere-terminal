# Review Round 4

- Date: 2026-08-25
- Target: archived separate-detail-completeness-signals
- Scope: commit de9f995 — only the round-3 fixes
- Reviewable lines: approximately 40
- Method: direct chair review; no specialists spawned per explicit user instruction
- Verdict: APPROVE
- Counts: BLOCK 0 | WARN 0 | SUGGEST 1

## Cross-round resolution

- Round 3 B1: fixed. Each table now has one unique total order, and the tail order is the exact reverse of the head order. Therefore, at cardinality `N <= H + T`, the first `H` and last `T` positions cover every row; at `N > H + T`, the OFFSET probe returns a row. A real SQLite scratch reproduction with all timestamps tied confirmed exact-capacity unions of 2,100 messages and 5,000 parts, empty probes at capacity, and non-empty probes at capacity+1.
- Round 3 B2: fixed. Failed probe queries now join the required-query failure gate and return null; `partial` is no longer overloaded with unknown completeness.
- Round 3 S1: partially fixed. `childDetailMock` and the short-overlap fixture now route probes correctly, but two inline child-session fixtures still do not.

## Findings

### S1

- ID: S1
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: chair
- file: src/vault/readers/opencodeReader.detail.test.ts:324
- title: Two inline child-session fixtures still answer probes with transcript rows
- evidence: The direct-child test at lines 321-352 and the child-query-failure test at lines 375-386 dispatch on `FROM message` / `FROM part` before checking `OFFSET`. Their message and part probe queries therefore receive ordinary non-empty transcript rows, making both nominally short/complete details `partial:true`. Neither test asserts completeness, so the suite remains green. The shared `childDetailMock` and short-overlap fixture were corrected, but these two inline mocks were not. The query-count comment at lines 361-362 also still says “COUNT per table” although the queries are OFFSET probes.
- impact: No production defect, but these fixtures continue to model the wrong completeness state and can hide a regression in child-detail behavior or mislead future assertions.
- suggestedFix: Route `OFFSET` before table branches in both inline mocks and return `{ status: "ok", rows: [] }`; optionally assert `detail.partial` is falsy in each. Rename the query-count comment from COUNT to omission probes.
- status: open
- triage: follow-up
