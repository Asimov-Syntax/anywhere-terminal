# Review Round 2: resolve-containment-through-symlinks

**Date**: 2026-08-30
**Cycle**: 1
**Round**: 2
**Mode**: verification
**Scope**: remediation diff `0f2f085895e7551d9675fedc40b0ec852616157b..488655161db2e8c27693e237189f38d9c07b8389`, prior findings, and behavioral impact cone
**Head**: `488655161db2e8c27693e237189f38d9c07b8389` (explicit committed range; working tree dirty outside review scope in `.analytics-cursor.json` and `analytics.json`)
**Reviewable lines**: 139
**Agents spawned**: data-security (`gpt-5.6-sol[1M]`), logic (`sonnet[1M]`), performance (`gpt-5.6-terra[1M]`)
**Agents skipped**: contracts, frontend, reuse — the verification cone was limited to containment security, prepared-root logic, and growth-axis behavior
**Verdict**: **WARN**
**Open counts**: 0 BLOCK, 1 WARN, 0 SUGGEST
**Prior findings fixed**: B1, S1

## Scope lock

Passed. The design D1 amendment and new D7/D8/tasks 2_1–2_2 are direct remediation of accepted B1/W1 through an artifact handback; Gate 2 was re-earned before implementation. No unrelated capability, contract, or invariant owner entered the fix diff.

## Verification evidence

- `bun run asm change verify-status resolve-containment-through-symlinks` records all seven tasks at exit 0.
- The coordinator reports type check, 5,295 unit tests, I10, and Biome at the 4/14/3 baseline.
- A targeted chair probe confirmed the old lexical comparator still accepts the case-folded id shape, the resolved predicate now refuses the case-distinct sibling, a same-case descendant remains accepted, and one prepared root served two candidates with exactly one root resolution.

## Findings

### B1

- **ID**: B1
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: asm-review-data-security
- **Class**: feature
- **File:line**: `src/utils/pathBoundary.ts:90`
- **Title**: Windows case folding permits containment outside a case-sensitive directory
- **Evidence**: `normalizeResolvedForCompare` now folds separators and only a leading drive letter; component case is preserved before the shared boundary test. The case-distinct sibling regression refuses while `isPathInside` keeps its prior case-folded behavior. Data-security, logic, and the chair probe found no surviving false-accept path in the remediation cone.
- **Impact**: The round-1 Windows authorization bypass is closed across the shared predicate and all seven adopters.
- **SuggestedFix**: None.
- **Status**: fixed
- **Triage**: accepted in round 1; fixed by D1/D7 remediation

**Invariant inventory**: Exact resolved-root identity is preserved for drive paths, POSIX paths, strict equality, existing and absent candidates, and symlinked roots. UNC differences preserve/fail closed. All seven read-authorizing boundaries consume the corrected resolved comparator; lexical worktree-id behavior remains unchanged.

### W1

- **ID**: W1
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: asm-review-performance
- **Class**: feature
- **File:line**: `src/vault/readers/claudePaths.ts:121`
- **Title**: The invariant root is still re-prepared per tied subagent candidate
- **Evidence**: The direct history-sized loops are fixed: `readClaudeSessions`, `resolveClaudeSessionPath`, and `resolveClaudeSubagentPath` prepare once before their own item loops, and `isResolvedPathInsideRoot` performs no hidden root resolution. The impact-cone trace found one remaining same-mechanism boundary: `src/vault/readers/subagentLookup.ts:40-41` loops over every prefix-matching tied subagent and calls `resolveClaudeSubagentPath` for each, so the stable projects root is prepared M times for M candidates. Candidate resolution still correctly occurs every time. The match set grows with unbounded subagent history; the path is a rare explicit selection, not the normal list/cache cadence.
- **Impact**: Ambiguous subagent selection retains linear redundant root syscalls, although the original per-project-directory and per-session-file multiplication is removed.
- **SuggestedFix**: Prepare the projects root once in the ambiguous-selection operation and pass it to an internal subagent resolver variant for each candidate. Keep the prepared root ephemeral to that operation and continue resolving every candidate; do not cache containment answers.
- **Status**: persists from round 1
- **Triage**: accepted round-1 invariant, partially fixed; inventory expanded to the direct caller loop. Severity remains WARN because the mechanism and impact class are unchanged.

**Invariant inventory**: An operation over many candidates may resolve its invariant store root once, while each candidate resolves every time. Verified safe/fixed: Claude full listing cache-hot/cold, session resolver project-dir scan, subagent resolver project-dir scan, null-root paths, mid-pass root replacement, single-candidate Codex and preview paths. Affected: ambiguous subagent tie selection in `pickNewestByMtime`. Independent one-off resolver entry points preparing separately are not a defect; the remaining issue is the actual composing M-candidate loop.

### S1

- **ID**: S1
- **Severity**: SUGGEST
- **Confidence**: HIGH
- **Priority**: P4
- **Agent**: chair
- **Class**: feature
- **File:line**: `src/vault/readers/claudePaths.test.ts:107`
- **Title**: Two Claude resolver branches lack the healthy symlinked-root regression
- **Evidence**: Direct healthy symlinked-root cases now cover both `resolveClaudeSubagentPath` and `resolveClaudeWorkflowAgentPath`, including the workflow branch that derives its candidate from a resolved parent.
- **Impact**: The accepted availability behavior is now protected at each resolver branch.
- **SuggestedFix**: None.
- **Status**: fixed
- **Triage**: accepted in round 1; fixed by task 2_2

Status: accepted
Triage: Verified — subagentLookup.ts:40 calls resolveClaudeSubagentPath once per tied candidate, and each call prepares the same projects root again. This is the exact case design.md D8 already names ("the root resolves once per OPERATION"), and pickNewestByMtime is one operation that already owns every candidate. Fixing it is faithful to the accepted decision rather than a change to it, so it lands as remediation and not a handback.
Shape: a prepared-root variant of the subagent resolver, with the existing function kept as the one-shot wrapper — the same split pathBoundary already uses, so there is one idiom for this rather than two.

## Adjudication notes

- B1 is fixed. The private comparator preserves old lexical semantics while the resolved normalizer closes the case-sensitive Windows false accept.
- W1 is not fully fixed. The implementation removed the originally identified per-item root work in the changed loops, but the impact cone contains an unbounded caller loop over `resolveClaudeSubagentPath` with the same redundant-root mechanism. It appends to W1 rather than becoming a new finding.
- The coordinator's open question is benign for independent entry points. The actionable exception is the concrete `pickNewestByMtime` composing loop, where one operation owns all tied candidates and can safely own one prepared root.
- S1 is fixed. No new findings or audit-backlog entries survived adjudication.

## Audit backlog

None.

## Accepted risk

None.
