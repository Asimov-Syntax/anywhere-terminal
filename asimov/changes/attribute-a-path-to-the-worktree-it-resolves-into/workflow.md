# Workflow State: attribute-a-path-to-the-worktree-it-resolves-into

> State file, not a procedure — stages live in the asimov-plan/build/archive skills.
> Source of truth: gates → this file · task completion → `tasks.md`
> States: `[ ]` pending · `[x]` done · `[-]` skipped/N/A · `[!]` failed non-blocking

## Plan

- [ ] Gate 1: direction approved _(only if a real fork; else `[-]`)_
- [x] `asm change validate` passes
- [x] Gate 2: plan approved

## Implement

- [ ] All tasks done (`tasks.md`)
- [ ] Verify gate: type check / lint / test observed passing _(`[-]` per command not in project.md)_
- [ ] Review done _(user-initiated; `[-]` + reason if skipped)_
- [ ] Gate: implementation approved
- [ ] Blueprint sync complete _(`[-]` + reason only when `Blueprint: none`)_

## Archive

- [ ] Apply deltas: `bun run asm change apply`
- [ ] Archive change: `bun run asm change archive`

> Commit everything after archive. No box: `archive` ticks its own before the commit exists, and a tick is evidence — git history is the record here.

## Notes

<!-- Blueprint source, lane, and the SHA the plan is written against below. Optional: one-line orphan decisions only — scope boundaries, deviations, rejected alternatives with no home elsewhere. -->

Blueprint: none
Lane: full
Planned at: e87eb449

Blueprint: docs/PLAN.md task WT-011.6
Lane: full — cross-boundary; five attribution sites across four files, several on per-push paths
Planned at: (set at Gate 2)

Stage-2 facts established against current code, not inherited from the archived change:
- The five sites WT-011.1 D2 listed still carry the lexical compare, at `src/worktree/repoRoots.ts:91`, `src/worktree/worktreeBlockers.ts:163,167`, `src/worktree/presenceProjector.ts:366`, `src/providers/gitDecorationProvider.ts:148`, `src/webview/fileTree/FileTreePanel.ts:309,334` — the last against a file-local copy of the predicate at `FileTreePanel.ts:1715`, which is the "no site keeps a private copy" clause of the acceptance.
- Only ONE side of each comparison is unresolved. `normalizeWorktreePath` (`src/worktree/normalizePath.ts:79`) already realpaths worktree ids through `realpathTolerant`, so the roots are resolved; what is raw is the candidate side — workspace-folder and Git API `fsPath`, pane/session `cwd`, and webview UI paths.
- `src/worktree/presenceDeps.ts:73-77` is the seam and documents its own miss verbatim: `normalize: (p) => path.resolve(p)` with "a realpath here would have to be async. A pane whose shell reports a symlinked cwd where git reported the physical path is the one case this misses."
- The shipped resolved predicate `isResolvedPathInsideRoot` (`src/utils/pathBoundary.ts:158`) CANNOT be adopted at these sites as-is: it is async and resolves the candidate on every call with no caching, deliberately (its D8: an authorization cache would survive a path becoming a symlink). Acceptance here forbids exactly that cost on per-push paths.
- Knowledge candidate: the two predicates differ by what the answer AUTHORIZES, not by how careful they are | Surprise: the archived D8 forbids caching the resolved candidate, and this task's acceptance forbids not caching it — the same mechanism, opposite verdicts | Evidence: src/utils/pathBoundary.ts:158 vs docs/PLAN.md WT-011.6 acceptance | Consumer: plan | Action: state the distinction as a decision before adopting either predicate, so review does not read the cache as a regression against D8

