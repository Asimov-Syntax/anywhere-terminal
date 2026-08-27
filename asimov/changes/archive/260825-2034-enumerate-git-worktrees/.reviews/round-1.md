# Review Round 1

- date: 2026-08-26
- scope: working tree
- reviewable lines: 920
- note: Large change — accuracy may decrease
- verdict: BLOCK
- counts: BLOCK 2 | WARN 5 | SUGGEST 0
- agents spawned:
  - asm-review-logic — parser, discovery, failure handling — gpt-5.6-sol[1M]
  - asm-review-contracts — accepted WT-001.1 contracts — gpt-5.6-terra[1M]
  - asm-review-data-security — git execution and path boundaries — sonnet[1M]
  - asm-review-performance — repository/worktree growth axes — gpt-5.6-terra[1M]
  - asm-review-reuse — existing git/path capabilities — gpt-5.6-luna[1M]
- agents skipped:
  - asm-review-frontend — no frontend changes

## Findings

### B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + asm-review-logic
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/porcelainParser.ts:103
- title: Invalid path bytes are silently converted into a different path
- evidence: `parseWorktreeList` calls `output.toString("utf8")` before splitting NUL-delimited fields. Invalid UTF-8 bytes become U+FFFD and the resulting record is accepted without an unreadable reason. A direct probe with a path byte `0xff` returned `/repo/�` and zero reasons. This contradicts approved D1's byte-oriented parsing obligation and the spec's requirement to report an unrepresentable path rather than invent another one.
- impact: `displayPath`, normalized identity, copy/reveal targets, and later filesystem probes can refer to a path Git never reported.
- suggestedFix: Split Buffer payloads on byte delimiters first, decode each field with fatal UTF-8 validation, and skip/count a record whose bytes cannot be represented. Add an invalid-byte fixture.
- status: accepted
- triage: Reproduced. `parseWorktreeList` decodes the whole payload up front, so U+FFFD substitution happens before any delimiter is seen. A path is this change's identity key (spec `normalize-every-path-through-one-rule`), and inventing a lossy one is worse than reporting it unreadable. Fixing byte-first: split on the delimiter byte, decode each field with a fatal TextDecoder, skip the record and add a reason when a field will not decode. Lock reasons stay lenient — they are display text, not identity.

### B2

- ID: B2
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + asm-review-logic + asm-review-contracts
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/porcelainParser.ts:119
- title: Skipping the first record promotes a linked worktree to main
- evidence: `kind` is derived from `worktrees.length`, which counts only accepted records. When the first Git record is skipped because the line fallback detects an ambiguous newline path, or because it lacks a path, the next record is emitted as `kind: "main"`. A direct probe reproduced a malformed first record followed by `/linked` being returned as main.
- impact: The wrong worktree becomes `mainPath`, supplies the repository label, sorts first, and is excluded from linked-worktree missing probes.
- suggestedFix: Derive `kind` from the original record ordinal, including skipped records, and add a malformed-first-record regression test.
- status: accepted
- triage: Reproduced. Git always emits the main worktree as record 0, so ordinal is the real signal and `worktrees.length` only coincides with it while nothing is skipped. Three skip paths break that coincidence: unknown-token, empty-path, and the new undecodable one from B1. Deriving `kind` from the record ordinal also gives the honest answer when record 0 is dropped — the repo then reports no main, and `buildWorktreeTree` already falls back to `root.rootPath` for `mainPath`.

### W1

- ID: W1
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair + asm-review-logic + asm-review-contracts
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/WorktreeDiscovery.ts:78
- title: Every stat failure is reported as a missing worktree
- evidence: `annotateMissing` catches every rejection from `stat` and sets `missing = true`; it does not distinguish `ENOENT`/`ENOTDIR` from `EACCES`, descriptor exhaustion, or transient network-filesystem errors. The accepted contract defines `missing` as path absence.
- impact: An existing worktree can be falsely rendered and ordered as missing because its path was temporarily unreadable.
- suggestedFix: Set `missing` only for absence error codes. Preserve false for other errors and surface an unreadable/degraded reason if the probe failure needs reporting.
- status: accepted
- triage: Agreed on the classification; declining the reporting half. `missing` will be set only for ENOENT/ENOTDIR, leaving EACCES and transient errors as `prunable` — which is what git already told us and is the weaker, safer claim. Not surfacing a reason for those: the worktree is still listed, so counting it as unreadable would inflate the omitted-record count that W3 is fixing.

### W2

- ID: W2
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair + asm-review-logic + asm-review-contracts
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/repoRoots.ts:67
- title: English stderr can poison the shared path-format capability
- evidence: A non-zero result is classified as unsupported when stderr matches `/path-format/i`. Approved D7 defines rejection as an exit-zero output line echoing `--path-format`, not error text. The negative classification is cached globally for 30 minutes.
- impact: One repository-specific failure can switch unrelated repositories to the fallback and conceal the original preferred-command failure.
- suggestedFix: Treat only the exit-zero output echo as unsupported. Return other non-zero results as repository failures without mutating capability state.
- status: accepted
- triage: Correct, and the code contradicts itself — the comment immediately below the stderr test states the exact reason the stderr test is wrong. The `/path-format/i` disjunct is a leftover that violates accepted design D7 (detection by exit code and flag echo, never by error text) and is locale-fragile besides. Dropping it; `hasUnsupportedPathFormatEcho` alone decides.

### W3

- ID: W3
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair + asm-review-logic + asm-review-contracts
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/WorktreeDiscovery.ts:183
- title: Unreadable count tracks distinct reasons instead of skipped records
- evidence: The parser reduces repeated failures to a reason `Set`, `RepoListing` carries only the deduplicated array, and assembly increments `unreadableCount` by `listing.reasons.length`. Multiple malformed records with the same reason in one repository therefore count as one, although the accepted spec requires count per skipped record and deduplication only for displayed reasons.
- impact: The tree understates how many worktree records were omitted.
- suggestedFix: Carry a separate skipped/unreadable occurrence count through parser and listing results; deduplicate only `reasons`.
- status: accepted
- triage: Matches the `unreadable: { count, reasons }` shape this change copied from `src/vault/types.ts:467`, where count is occurrences and reasons is the deduplicated display list. `ParsedWorktreeList` and `RepoListing` each gain a `skipped` count covering all three skip paths (unknown token, undecodable bytes, unresolvable path); assembly sums those instead of `reasons.length`.

### W4

- ID: W4
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: asm-review-performance
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/WorktreeDiscovery.ts:181
- title: Repository listings serialize timeout latency
- evidence: The loop awaits `listRepoWorktrees` once per repository. With a 10-second command timeout and repository count R, R slow or hung repositories can delay the tree by roughly `10s × R`; later repositories are not started until earlier ones settle. The project model states rebuilds are per-repository so one slow repository cannot stall siblings.
- impact: A multi-root workspace can remain without any discovery result for tens of seconds even when some repositories are healthy.
- suggestedFix: Start per-repository listings concurrently while preserving root order in the assembled result; keep per-worktree stat concurrency bounded as it is.
- status: accepted
- triage: Real: the 10 s runner timeout is per command, so serial listing makes the worst case R x 10 s and one hung repo starves healthy siblings — contrary to worktree-model.md's per-repository rebuild model. Fixing with the same bounded worker pool `annotateMissing` already uses, extracted so both call it rather than duplicating the loop, and assembling by index so root order is unchanged.

### W5

- ID: W5
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair + asm-review-logic + asm-review-reuse
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/WorktreeDiscovery.ts:143
- title: Filesystem-root worktrees fail descendant workspace detection
- evidence: Descendant detection appends another separator to `worktreeId`. For POSIX root `/`, the prefix becomes `//`; for a Windows drive root it similarly doubles the terminal separator. A workspace below that root is therefore not marked open unless it equals the root exactly. The repository already has a root-aware containment implementation in `src/providers/gitDecorationProvider.ts:172-193`.
- impact: A valid worktree at a filesystem or drive root is returned with `inWorkspace: false`, enabling incorrect later affordances.
- suggestedFix: Use a root-aware containment helper based on `path.relative`, or extract/reuse the existing boundary-safe implementation, and test POSIX and Windows roots.
- status: accepted
- triage: Accepted, and taking the extraction option rather than a third copy — `repoRoots.ts:43` carries the same naive `startsWith(root + sep)` form, so this change would otherwise ship two instances of the bug the repo already solved. `isWindowsAbsPath` / `normalizePathForCompare` / a new `isPathInside` move to `src/utils/pathBoundary.ts`; `gitDecorationProvider.ts` imports them instead of defining its own, and both worktree call sites use `isPathInside`. Behaviour-preserving for the provider, whose existing tests cover it.

## Verification

- `bun test src/worktree`: 103 passed
- `pnpm run check-types`: passed
- `pnpm run test:unit`: 164 files, 3033 tests passed
