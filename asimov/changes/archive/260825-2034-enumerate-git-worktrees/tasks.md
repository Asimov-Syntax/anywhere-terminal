## 1. Contracts

- [x] 1_1 Declare the host-owned worktree tree types — verified: pnpm run check-types && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: docs/design/worktree-model.md#2-data-model
  - **Acceptance**:
    - Outcome: The worktree tree, repo, and worktree types exist and type-check.
    - Verify: command pnpm run check-types
  - **Plan**:
    1. Add `src/worktree/types.ts` with `WorktreeTree`, `WorktreeRepo`, `WorktreeInfo` exactly as the Refs anchor defines them, including the field comments that name each field's source.
    2. Carry no agent, activity, or dirty-state field.

- [x] 1_2 Add the bounded git command runner — verified: bun test 'src/worktree/gitCommandRunner.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-discovery/spec.md#confine-a-repository-failure-to-that-repository; design.md D1
  - **Acceptance**:
    - Outcome: Git runs behind one injected seam that times out instead of hanging.
    - Verify: unit src/worktree/gitCommandRunner.test.ts
  - **Plan**:
    1. Add `src/worktree/gitCommandRunner.ts` exporting a `GitCommandRunner` interface plus an `execFile`-backed default with a 10 s timeout, a `maxBuffer` cap, and `Buffer` stdout — mirroring the injectable-deps shape at `src/pty/processCwd.ts:18-33`.
    2. Return exit code, stdout bytes, and stderr as a value; never throw on non-zero exit or timeout.

- [x] 1_3 Detect and cache git version and command capabilities — verified: bun test 'src/worktree/gitCapabilities.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: specs/worktree-discovery/spec.md#report-an-unusable-git; design.md D2; design.md D7; design.md D8; docs/research/20260826-orca-git-worktree-mechanics.md#{1-capability-detection-is-by-exit-code-not-by-message-text, 3-a-capability-cache-should-expire-not-be-permanent}
  - **Acceptance**:
    - Outcome: An unsupported git is detected by exit code rather than error text.
    - Verify: unit src/worktree/gitCapabilities.test.ts
  - **Plan**:
    1. Add `src/worktree/gitCapabilities.ts` with a `git --version` probe classifying absent / below 2.31 / supported, and a `runWithFallback(capability, preferred, fallback, isUnsupported)` function over a `Map` — the module shape D8 fixes, not orca's class.
    2. Implement the two predicates per design.md D7: `-z` rejected on **exit 129** with a message regex only as backup, and `--path-format` rejected by an **exit-zero run that echoes `--path-format`** as an output line.
    3. Memoize per capability, expire negative results after 30 minutes per design.md D2, and share one in-flight promise across concurrent probes for the same key.

## 2. Discovery primitives

- [x] 2_1 Implement the shared path normalizer — verified: bun test 'src/worktree/normalizePath.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-discovery/spec.md#normalize-every-path-through-one-rule; design.md D3; docs/design/worktree-model.md#31-path-normalization--the-shared-invariant
  - **Acceptance**:
    - Outcome: Two spellings of one directory normalize to one identity.
    - Verify: unit src/worktree/normalizePath.test.ts
  - **Plan**:
    1. Add `src/worktree/normalizePath.ts` with the five normalization steps in the Refs anchor's order, taking platform and a realpath function as injected parameters so both platforms are testable.
    2. Resolve a non-existent path by realpathing its nearest existing ancestor and re-appending the remainder.
    3. Return `null` for empty or non-absolute input rather than a best-effort string.

- [x] 2_2 Parse the porcelain worktree listing — verified: bun test 'src/worktree/porcelainParser.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-discovery/spec.md#{enumerate-every-worktree-of-a-repository-exactly-once, report-the-worktree-state-git-reports}; docs/design/worktree-model.md#33-worktree-enumeration; docs/research/20260826-orca-git-worktree-mechanics.md#2-non-z-porcelain-does-not-quote-paths--verified
  - **Acceptance**:
    - Outcome: Each porcelain token maps to its field; an ambiguous record is skipped with a reason.
    - Verify: unit src/worktree/porcelainParser.test.ts
  - **Plan**:
    1. Add `src/worktree/porcelainParser.ts` with **one** parser taking a `{ nulDelimited }` option, splitting on `\0\0` or a blank line accordingly — orca's shape, not two entry points.
    2. Map the token table in the Refs anchor; treat the first record as the main worktree and the rest as linked.
    3. In the line-delimited form only, skip any record containing a line matching no known token and return it as a reason — git emits paths **unquoted**, so an embedded newline cannot be decoded, only detected (research § 2). Assert the newline fixture yields no worktree rather than a truncated path.
    4. Decode c-quoting in `locked <reason>` and `prunable <reason>` in the line-delimited form only; the `-z` form carries them raw.
    5. Cover bare, detached, unborn-branch, `locked <reason>`, and `prunable <reason>` fixtures.

- [x] 2_3 Resolve and dedupe workspace repository roots — verified: bun test 'src/worktree/repoRoots.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1, 1_3, 2_1
  - **Refs**: specs/worktree-discovery/spec.md#resolve-workspace-git-repositories; design.md D5; design.md D7; docs/design/worktree-model.md#32-repo-root-resolution; src/providers/git.ts
  - **Acceptance**:
    - Outcome: Workspace folders sharing a repository yield one repoId, in workspace-folder order.
    - Verify: unit src/worktree/repoRoots.test.ts
  - **Plan**:
    1. Add `src/worktree/repoRoots.ts` taking workspace folders, a `vscode.git` API accessor, and a `GitCommandRunner`; import the vendored API type (Refs) rather than redeclaring it, and follow the tolerant acquisition shape at `src/providers/gitDecorationProvider.ts:150,266-277`.
    2. Match a folder to the repository whose `rootUri` is its longest prefix; fall through to `git rev-parse --path-format=absolute --show-toplevel` when there is none, or when the API is absent or `uninitialized`.
    3. Resolve `--git-common-dir` per root through 1_3's capability fallback, dropping to the bare flag and resolving a relative answer against the root when `--path-format` is unsupported — detected by the exit-zero flag echo per design.md D7, never by exit status alone.
    4. Normalize each common dir into `repoId`, dedupe on it, and keep first-seen workspace-folder order.
    5. Skip a folder that is not a repository silently — not an unreadable reason.

- [x] 2_4 Order worktrees within a repository group — verified: bun test 'src/worktree/worktreeOrder.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-discovery/spec.md#order-worktrees-deterministically; design.md D4; docs/design/worktree-model.md#34-ordering-within-a-group
  - **Acceptance**:
    - Outcome: Main sorts first, missing last, and equal branches tie-break on identity.
    - Verify: unit src/worktree/worktreeOrder.test.ts
  - **Plan**:
    1. Add `src/worktree/worktreeOrder.ts` implementing the four ordering rules in the Refs anchor, with an optional injected rank function per design.md D4.
    2. End every comparison in an `id` tie-break, and test that a shuffled input yields one stable order.

## 3. Tree assembly

- [x] 3_1 List one repository's worktrees with capability fallback and the missing probe — verified: bun test 'src/worktree/WorktreeDiscovery.listRepo.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_3, 2_1, 2_2
  - **Refs**: specs/worktree-discovery/spec.md#{enumerate-every-worktree-of-a-repository-exactly-once, report-the-worktree-state-git-reports}; docs/design/worktree-model.md#33-worktree-enumeration
  - **Acceptance**:
    - Outcome: A repository lists each worktree once, with missing set only on probed candidates.
    - Verify: unit src/worktree/WorktreeDiscovery.listRepo.test.ts
  - **Plan**:
    1. Add `src/worktree/WorktreeDiscovery.ts` with a per-repo listing step running `git worktree list --porcelain -z` through 1_3's `runWithFallback`, which drops to the line-delimited form and remembers the rejection.
    2. Normalize each reported path into `id` while keeping git's exact string as `displayPath`.
    3. Probe existence with concurrency 8 for linked, unlocked worktrees git flagged prunable; never probe the main worktree or a locked one.

- [x] 3_2 Assemble the tree with in-workspace marks and scoped degradation — verified: bun test 'src/worktree/WorktreeDiscovery.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_3, 2_4, 3_1
  - **Refs**: specs/worktree-discovery/spec.md#{resolve-workspace-git-repositories, mark-worktrees-the-workspace-has-open, report-an-unusable-git, confine-a-repository-failure-to-that-repository}; design.md D6; docs/design/worktree-model.md#6-edge-cases
  - **Acceptance**:
    - Outcome: One tree spans every repo; a failing repo carries a reason and the rest still list.
    - Verify: unit src/worktree/WorktreeDiscovery.test.ts
  - **Plan**:
    1. Compose repo roots, per-repo listing, and ordering in `src/worktree/WorktreeDiscovery.ts` into a `WorktreeTree`.
    2. Mark `inWorkspace` when a workspace folder equals a worktree's path or lies inside it — that direction, per the Refs anchor in `#2-data-model`.
    3. Set `gitAvailable: false` with an empty repo list when git is absent or below the floor, per design.md D2; never throw.
    4. Confine a per-repo failure to `degraded` on that repo, and deduplicate `unreadable.reasons` before returning.
    5. Cover the zero-folder, bare-main, submodule, and two-repos-two-groups rows of the edge-case anchor.
  - **Boundary**: no watchers, no cache, no message-protocol change — WT-001.2 owns them

## 4. Review fixes (round 1)

- [x] 4_1 Fix round-1 review findings B1, B2, W1-W5 — verified: bun test 'src/worktree/porcelainParser.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_2
  - **Refs**: .reviews/round-1.md; specs/worktree-discovery/spec.md#{enumerate-every-worktree-of-a-repository-exactly-once, normalize-every-path-through-one-rule, mark-worktrees-the-workspace-has-open}; design.md D7
  - **Acceptance**:
    - Outcome: Every accepted round-1 finding has a regression test that fails before its fix.
    - Verify: unit src/worktree/porcelainParser.test.ts
  - **Plan**:
    1. B1 — parse `src/worktree/porcelainParser.ts` byte-first: split on the delimiter byte, decode each field with a fatal UTF-8 decoder, skip and report a record whose bytes will not decode.
    2. B2 — derive `kind` from the original record ordinal rather than the accepted-record count, so a skipped first record cannot promote a linked worktree to main.
    3. W3 — carry a `skipped` occurrence count through `ParsedWorktreeList` and `RepoListing`; `unreadable.count` sums those and `reasons` stays deduplicated.
    4. W1 — in `src/worktree/WorktreeDiscovery.ts`, set `missing` only for the two absence error codes, leaving every other probe failure as prunable.
    5. W4 — extract the bounded worker pool and run per-repo listings through it, assembling by index so root order is unchanged.
    6. W2 — drop the stderr sniff in `src/worktree/repoRoots.ts`; only the exit-zero flag echo marks `--path-format` unsupported, per design.md D7.
    7. W5 — move `isWindowsAbsPath` / `normalizePathForCompare` and a new `isPathInside` into `src/utils/pathBoundary.ts`; import them in `src/providers/gitDecorationProvider.ts` and use `isPathInside` at both worktree containment sites.
  - **Boundary**: no behaviour change to `gitDecorationProvider.ts` — extraction only

## 5. Review fixes (round 2)

- [x] 5_1 Fix round-2 review findings R2-B1 and R2-W1 — verified: bun test 'src/worktree/porcelainParser.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_1
  - **Refs**: .reviews/round-2.md; design.md D7; docs/design/worktree-model.md#33-worktree-enumeration
  - **Acceptance**:
    - Outcome: Undecodable display metadata keeps its worktree; only an undecodable path drops one.
    - Verify: unit src/worktree/porcelainParser.test.ts
  - **Plan**:
    1. R2-B1 — in `src/worktree/porcelainParser.ts`, identify each field by its ASCII token prefix before decoding, and decode strictly only the bytes after `worktree `; `HEAD`, `branch`, and both lock and prunable reasons decode leniently because none of them is the identity key.
    2. R2-W1 — in `src/worktree/repoRoots.ts`, require `result.code === 0` alongside the flag echo before marking `--path-format` unsupported, per design.md D7.
  - **Boundary**: no change to the record-skip policy for paths — an undecodable path still drops its record
