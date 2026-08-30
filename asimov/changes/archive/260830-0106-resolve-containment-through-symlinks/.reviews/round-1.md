# Review Round 1: resolve-containment-through-symlinks

**Date**: 2026-08-30
**Cycle**: 1
**Round**: 1
**Mode**: discovery (fastlane requested)
**Scope**: range `80d19aee5f8be9fca7a65c41b1eeb3a2d4efe0a5..0f2f085895e7551d9675fedc40b0ec852616157b`
**Head**: `0f2f085895e7551d9675fedc40b0ec852616157b` (explicit committed range; working tree dirty outside the review scope in `.analytics-cursor.json` and `analytics.json`)
**Reviewable lines**: 165
**Agents spawned**: data-security (`gpt-5.6-sol[1M]`), logic (`gpt-5.6-terra[1M]`), performance (`sonnet[1M]`), contracts (`gpt-5.6-terra[1M]`), reuse (`gpt-5.6-luna[1M]`)
**Agents skipped**: frontend — no UI/frontend changes
**Verdict**: **BLOCK**
**Counts**: 1 BLOCK, 1 WARN, 1 SUGGEST
**Blocker split**: 1 feature / 0 machinery

## Gate and context

- Gate 2 is approved; design D1-D6, resolved task refs, task Acceptance fields, and WT-011.1 are binding.
- `bun run asm change verify-status resolve-containment-through-symlinks` records all five tasks at exit 0. The caller also reported type check, 5,285 unit tests, I10, and Biome at the 4/14/3 baseline.
- The full-flow trace covered Claude list/detail/subagent/workflow reads, Codex index-path and filename fallback reads, and the bounded preview cache/retry flow. Every changed adopter awaits containment before stat/read and preserves skip/null/fallback/unresolved behavior.

## Findings

### B1

- **ID**: B1
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: asm-review-data-security
- **Class**: feature
- **File:line**: `src/utils/pathBoundary.ts:117`
- **Title**: Windows case folding permits containment outside a case-sensitive directory
- **Evidence**: The new authorization predicate delegates its final decision to `isPathInside`, whose `normalizePathForCompare` lowercases every component of a Windows path. Windows supports case-sensitive NTFS directories, so resolved root `C:\vault\Store` and resolved candidate `C:\vault\store\secret.jsonl` can name distinct sibling locations while the comparison accepts the latter as inside the former. A targeted in-memory probe against the changed predicate returned `true` for exactly those resolved values. This defect is introduced at the new read-authorizing call to the lexical comparator; the existing lexical helper's historical use does not clear it for authorization.
- **Impact**: On a supported Windows filesystem configuration, a symlink beneath the configured vault root can resolve into a case-distinct sibling and pass all seven guards, allowing transcript readers to open a file outside the resolved store root. This defeats the security invariant the change exists to enforce.
- **SuggestedFix**: Give the resolved authorization predicate a comparison that preserves component case after `realpath`, normalizing separators and only the volume/drive identity as required. Add a regression where resolved root and candidate differ only by a case-sensitive component and require refusal.
- **Status**: open
- **Triage**: new; corroborated by chair probe

**Invariant inventory**: The invariant is that a resolved candidate must be a strict descendant of the exact resolved root on the host filesystem. Affected boundaries: shared predicate and therefore all seven Claude/Codex/enumeration/preview adopters. Verified safe: POSIX boundary handling, strict equality, absent-tail reconstruction, dangling-link refusal, non-ENOENT failure, symlinked-root resolution, and adopter fallback/error paths.

Status: accepted
Triage: Real, and it is this change's own failure mode arriving one layer down. `isPathInside` folds case because its callers compare worktree IDS, where VS Code hands back `c:\Repo` and `C:\repo` for one path. An authorization predicate cannot inherit that: after `realpath` both sides already carry the filesystem's canonical component case, so folding it can only ever ERASE a distinction the filesystem makes — never repair one. Narrow (case-sensitive dirs on Windows, via WSL or `fsutil setCaseSensitiveInfo`) but a false ACCEPT on a read guard, which is the direction that matters.
The fix cannot just stop calling `isPathInside` — D1 states the resolved form finishes by calling it so the lexical rules stay defined once, and D2 forbids widening it. Parameterizing the shared boundary logic by its normalizer, and recording WHY the two predicates normalize differently, changes D1's stated mechanism. That is a design edit, not remediation: handback.

### W1

- **ID**: W1
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: asm-review-performance
- **Class**: feature
- **File:line**: `src/utils/pathBoundary.ts:103`
- **Title**: Invariant store roots are re-resolved for every item in history-sized loops
- **Evidence**: `isResolvedPathInside` always performs `realpath(root)`. Callers invoke it inside loops whose root is invariant: Claude project-directory scans, Claude per-file enumeration, and Codex child-stub reads. In the cache-hot Claude list path, this root resolution still runs once per listed file before the existing stamp cache. Growth axes are project-directory count, session-file history, and Codex child count; preview resolution is separately capped and backed off.
- **Impact**: Each scan adds one avoidable filesystem syscall per item on top of the candidate-specific resolution that the security contract genuinely requires. The cost grows with unbounded session/project history and makes the recorded “one realpath per listed file” claim inaccurate until the root work is hoisted.
- **SuggestedFix**: Resolve the root once per outer operation and pass a prepared/resolved-root containment context to each candidate check. Continue resolving every candidate on every authorization pass; do not cache a stale containment answer by file stamp.
- **Status**: open
- **Triage**: new; the specialist's broader BLOCK was rejected because candidate resolution is required by task 1_5 and cannot safely be skipped on cache hits. The redundant invariant-root half survives as this WARN.

**Invariant inventory**: History-sized loops may pay candidate-specific security work once per item, but must not recompute an invariant root per item. Affected: Claude id scans, Claude list cache-hot/cold paths, Codex child metadata. Verified safe: preview cache/backoff and the absent-tail walk, which is bounded by path depth rather than collection size.

Status: accepted
Triage: Correct and measured on the right axis — the root is invariant across an entire listing, and `claudeReader` calls the predicate once per enumerated file, so the redundant `realpath(root)` grows with session history. The reviewer's own caveat is the important half: the CANDIDATE must still resolve on every pass, and containment must not be cached by file stamp — a stamp is not identity, and that cache would reintroduce exactly the bug this change closes.
Carried into the same handback rather than fixed here: it changes the predicate's interface (a prepared-root form), which design.md § Interfaces owns.

### S1

- **ID**: S1
- **Severity**: SUGGEST
- **Confidence**: HIGH
- **Priority**: P4
- **Agent**: chair
- **Class**: feature
- **File:line**: `src/vault/readers/claudePaths.test.ts:68`
- **Title**: Two Claude resolver branches lack the healthy symlinked-root regression
- **Evidence**: Task 1_2 planned direct coverage for each Claude resolver of both an escaping link and a genuinely contained transcript under a symlinked projects root. The session resolver has both, while the subagent and workflow-agent sections cover ordinary containment plus escape only.
- **Impact**: A future regression in those branches' directory enumeration or candidate construction under a linked root could pass the shared-helper suite while breaking the promised healthy configuration.
- **SuggestedFix**: Add symlinked-projects-root success cases for `resolveClaudeSubagentPath` and `resolveClaudeWorkflowAgentPath`.
- **Status**: open
- **Triage**: new; non-gating support coverage

Status: accepted
Triage: Task 1_2 asked for the healthy symlinked-root case at each resolver and only the session resolver got one. The gap is real — the subagent and workflow-agent branches build their candidates differently (nested join, and a path derived from an already-resolved parent), so the session resolver's success case does not cover them. Fixed with the handback's tasks, since those tests must be written against the corrected predicate rather than the current one.

## Adjudication notes

- Data-security B1 survived unchanged; code evidence and the targeted probe establish a reachable authorization bypass.
- Performance's proposed BLOCK for checking every enumerated candidate on cache-hot scans was rejected: task 1_5 requires each listed file to be containment-checked, and a cached path/stamp cannot prove a symlink still resolves to the same place. Its independently identified repeated root resolution was retained as W1.
- Logic, contracts, and reuse reported no findings. Their verification confirmed loop/error semantics, seven-site adoption, fallback preservation, and correct non-reuse of `realpathTolerant`.

## Audit backlog

None.

## Accepted risk

None.
