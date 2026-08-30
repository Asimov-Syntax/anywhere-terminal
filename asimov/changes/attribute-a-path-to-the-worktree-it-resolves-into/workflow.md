# Workflow State: attribute-a-path-to-the-worktree-it-resolves-into

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [ ] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [x] All tasks done (`tasks.md`)
- [x] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: docs/PLAN.md task WT-011.6
Lane: full — cross-boundary; five attribution sites across four files, several on per-push paths
Planned at: ae9e44ce

Stage-2 facts established against current code, not inherited from the archived change:
- The five sites WT-011.1 D2 listed still carry the lexical compare, at `src/worktree/repoRoots.ts:91`, `src/worktree/worktreeBlockers.ts:163,167`, `src/worktree/presenceProjector.ts:366`, `src/providers/gitDecorationProvider.ts:148`, `src/webview/fileTree/FileTreePanel.ts:309,334` — the last against a file-local copy of the predicate at `FileTreePanel.ts:1715`, which is the "no site keeps a private copy" clause of the acceptance.
- Only ONE side of each comparison is unresolved. `normalizeWorktreePath` (`src/worktree/normalizePath.ts:79`) already realpaths worktree ids through `realpathTolerant`, so the roots are resolved; what is raw is the candidate side — workspace-folder and Git API `fsPath`, pane/session `cwd`, and webview UI paths.
- `src/worktree/presenceDeps.ts:73-77` is the seam and documents its own miss verbatim: `normalize: (p) => path.resolve(p)` with "a realpath here would have to be async. A pane whose shell reports a symlinked cwd where git reported the physical path is the one case this misses."
- The shipped resolved predicate `isResolvedPathInsideRoot` (`src/utils/pathBoundary.ts:158`) CANNOT be adopted at these sites as-is: it is async and resolves the candidate on every call with no caching, deliberately (its D8: an authorization cache would survive a path becoming a symlink). Acceptance here forbids exactly that cost on per-push paths.
- Knowledge candidate: the two predicates differ by what the answer AUTHORIZES, not by how careful they are | Surprise: the archived D8 forbids caching the resolved candidate, and this task's acceptance forbids not caching it — the same mechanism, opposite verdicts | Evidence: src/utils/pathBoundary.ts:158 vs docs/PLAN.md WT-011.6 acceptance | Consumer: plan | Action: state the distinction as a decision before adopting either predicate, so review does not read the cache as a regression against D8

Build notes:
- 1_2 grew past its planned lease: the removal-blocker filters compare the SAME pane and session cwds against the same worktree ids, so the resolution had to reach their producers — `removalFacts` in `extension.ts`, and `WorktreeHost.removalFacts.panes` becoming async. `evaluateRemoval` stays sync and pure; the contract it depends on is stated on `PaneFact.cwd`.
- 1_4 found the second consumer of "resolve a bounded set, forget what left", so that resolver moved from `repoRoots.ts` to `resolvedPathMemo.ts` as `createTrackedPathResolver` rather than being copied.
- 1_5: sharing the real `isPathInside` with the webview was impossible while `pathBoundary.ts` imported `node:fs/promises` and `node:path` — esbuild's browser bundle fails to resolve them. The RESOLVED predicate moved to `src/utils/resolvedPathBoundary.ts`; the lexical rule stayed where D2 puts it, and `compareBoundary` is exported so the boundary rule still has one home.
- Mutation testing: 11 mutations across the four seams, 10 killed by exactly the intended tests. The survivor is `resolvedOr(absPath)` in `gitDecorationProvider.isUnderAnyWorkspaceFolder` — an EQUIVALENT mutant, not a gap: `resolvedOr` on an unprepared path is a map read returning the lexical form, so it costs nothing and changes nothing. The syscall D1 forbids there is ruled out structurally, by the predicate being synchronous.
- Verify gate ticked with a pre-existing failure outside this change's files: `src/vault/snapshotPool.test.ts` > "refuses a snapshot to a caller that was waiting out another production" fails roughly 1 run in 5 under load, asserting `expected 'resolved' to match /disposed/`. Neither `snapshotPool.ts` nor its test is touched by this change (`git show --stat 06f31d9b f189aced 4f559afc` names neither). It is a real defect, not test timing: a caller queued behind an in-flight production is sometimes ADMITTED after `dispose()`, so dispose is not the barrier `reuse-a-snapshot-while-the-store-is-unchanged` claims. Reported for its own change; not fixed here.
- Also seen once and never reproduced across ~12 later full runs: two failures in `src/extension.worktreeAssembly.test.ts` under three concurrent suites. No assertion was captured. Recorded as observed, not diagnosed.
- Round-2 handback: B4 accepted and NOT fixed as remediation. Closing it needs an owner for "who still needs this path" over the shared memo, which either mints a lifecycle owner or restates D4 — a pane closing is not a structural filesystem change, so presence's retirement release is memory-bounding claiming D4's cover, and round-1 B4 (leak) and round-2 B4 (over-release) are irreconcilable until that owner exists. B1 rides along: its fix is "register a standing consumer with the shared memo", the same seam. W1/W2 sit inside B1's cone.
- Round-2 plan (fastlane): D4 restated — it governs freshness, D6 governs release. D6 folds into ResolvedPathMemo, the owner 1_2 already minted, so this stays one change rather than spawning a child. 3_1's 10 files are one seam by construction: the memo's release signature changes, so every consumer handle moves with it; splitting would land a half-claimed memo. Rejected alternatives are in D6.
- Round-2 build: `ResolvedPathMemo.prepare` deleted — every production consumer claims, and an unclaimed entry can never be released, so the API could only make leaks. Presence's `prepareCwds`/`forgetCwd` and both hand-written set differences went with it. Mutation testing: 9 mutations across 3_1 and 3_2, all killed; M4 (the session claim emptying on a failed read) survived the first pass and is the reason `keeps a session cwd resolved through a registry read that failed` exists. `gitDecorationProvider`'s resolve-failure branch is defensive and untested: `resolve` answers lexically rather than rejecting, so a failing realpath settles through the success branch.
- Round-3 build: the `pinned`/`tracked` split is gone — it claimed the pinned side forever on a premise ("the caller's standing set") that repository discovery never satisfied, and reconciling one set costs a membership test, not a syscall. A resolver is now also the unit of isolation: a removal assessment takes its own and disposes it in a `finally`, because two passes through one handle release each other's paths mid-flight. Mutation testing: 3 mutations, 2 killed on the first pass; B7b (a closed editor panel never disposing its host) survived until `resolvedRootWiring.test.ts` grew a panel-close case — the same wiring-invisible-to-unit-tests shape as round-2 B1.
