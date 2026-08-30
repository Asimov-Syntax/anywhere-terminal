# Code Review Round 1

- Date: 2026-08-30
- Cycle: 1
- Mode: discovery
- Scope: range `5ceca2c0..48fe43cea468bfbc81c039d4d8b1b138f0d60b13`
- Head: `48fe43cea468bfbc81c039d4d8b1b138f0d60b13` (explicit committed range reviewed; working tree dirty only in change analytics before this round file was written)
- Reviewable lines: 98
- Classification: 2 reviewable source files, 1 test file reviewed inline, 9 `docs/**` or other Markdown files skipped by policy
- Agents spawned:
  - `asm-review-logic`: preview state machine and async/retry transitions — `gpt-5.6-sol[1M]`
  - `asm-review-contracts`: three-way lookup contract and adapter wiring — `gpt-5.6-terra[1M]`
  - `asm-review-performance`: lookup cadence and growth-axis bounds — `sonnet[1M]`
- Agents skipped:
  - `asm-review-data-security`: no changed persistence, auth, validation, or secret boundary
  - `asm-review-frontend`: no reviewable frontend source changed (`docs/ui/**` is skipped by policy)
  - `asm-review-reuse`: no material helper, parser, mapper, or split requiring a separate reuse audit
- Verification evidence: `bun run asm change verify-status retire-a-preview-whose-entry-is-gone` reports task `1_1` exit 0 but marks the service/test scope changed; the review did not rerun gates. The caller reports type check, Biome's 0-error/14-warning baseline, 5521 unit tests, I10, and both bundles green.
- Verdict: BLOCK
- Counts: 1 BLOCK, 0 WARN, 0 SUGGEST
- Split: 1 feature blocker, 0 machinery blockers

## Findings

### B1

- ID: B1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair (corroborated by `asm-review-logic`, `asm-review-contracts`, and `asm-review-performance`)
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/sessionPreviewService.ts:309`
- Title: A resolved row continues filesystem work after an `unknown` lookup
- Evidence: The `unknown` branch returns only when the target is not resolved or has no cached entry. For the normal held resolved row, execution falls through to `stat`, re-resolution, `read`, and `forget`. A changed transcript can therefore replace `line`; a failed `stat` can clear `target`, `entry`, `stamp`, and `line`; an unchanged stamp sets `progressed = true`, resets misses, and schedules the next overdue store lookup after the ordinary 2-second `recheckMs`. The added test at `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/sessionPreviewService.test.ts:992` explicitly expects that 2-second retry, while approved D4 requires `unknown` to return the existing line immediately, change none of the owned state, and score no progress so the retry ladder applies.
- Impact: An inconclusive store answer can erase or replace a live session's preview and, for an idle resolved Codex row, repeat the history-sized by-id fallback at 0.5 Hz instead of backing off. Across the 256-entry service cap this can recreate the sustained lookup load the 30-second cadence was introduced to prevent.
- SuggestedFix: Return `current.line` immediately for every `fresh.status === "unknown"` before any filesystem work, leaving `progressed` false. Replace the resolved-unknown test's 2-second expectation with the retry-ladder delay and add changed-transcript and failed-`stat` cases asserting the old line remains and no `stat`/`read` occurs.
- Status: open
- Triage: untriaged
- Invariant: An `unknown` store answer establishes nothing; it must not mutate preview-owned state, touch the transcript, or obtain progress from downstream filesystem work.
- Boundary inventory:
  - Affected: resolved target with unchanged transcript; resolved target with changed transcript; resolved target with failed `stat` or re-resolution/read work.
  - Verified safe: initial unresolved target; gone target; conclusive found; conclusive absent; timeout/stale-attempt fencing.

---

## Author triage

### B1 — **AuthorStatus**: accepted

**AuthorTriage**: Confirmed at `sessionPreviewService.ts:309`. The load argument is the one that
lands, and it lands hard: `confirmedAt` is deliberately not stamped by an `unknown`, so `due` stays
true forever; the fall-through then reaches an unchanged `stat` and sets `progressed`, which resets
`misses` to 0 and puts the next look — and with it the next store lookup — at the ordinary 2 s
cadence. For a Codex row without SQLite that is the history-sized walk at 0.5 Hz, the exact load
round-3 B1-R3 removed and this change's own D2 exists to prevent. My test at
`sessionPreviewService.test.ts:992` asserts that 2 s retry, so the suite encodes the defect rather
than catching it.

It is also a plain conformance gap: design.md D4 says an `unknown` "leaves `target`, `entry`,
`stamp`, `line` and `confirmedAt` exactly as they were and returns the line already on the row",
and I implemented a fall-through instead. No `D#` changes and no owner is minted, so this is
remediation, not a handback.

Two of the three consequences listed are not harms this diff introduces, and I record that rather
than let the round overstate the blast radius: a changed transcript replacing the held line is the
freshness update working, and a failed `stat` clearing target/entry/stamp/line is the shipped rule
that a row whose transcript cannot be read carries no preview (`worktree-agent-presence` § "An agent
row's preview line says what its session last did"). Both are reachable on every ordinary look, with
or without a preceding `unknown`. The fix is unchanged by that, so this is a note, not a rebuttal.
