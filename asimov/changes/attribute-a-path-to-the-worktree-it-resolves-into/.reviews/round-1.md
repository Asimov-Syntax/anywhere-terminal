# Review Round 1: attribute-a-path-to-the-worktree-it-resolves-into

**Date**: 2026-08-30
**Cycle**: 1
**Round**: 1
**Mode**: discovery (fastlane requested)
**Scope**: range `a92abd5f..d1669a19f07d28d7f34d366f8c5d2d4abe64f69f`
**Head**: `d1669a19f07d28d7f34d366f8c5d2d4abe64f69f` (explicit committed range; working tree dirty outside the reviewed range in three `docs/` files)
**Reviewable lines**: 465
**Agents spawned**: logic/memo (`gpt-5.6-sol[1M]`), logic/presence-removal (`gpt-5.6-terra[1M]`), contracts (`sonnet[1M]`), frontend (`gpt-5.6-luna[1M]`), performance (`gpt-5.6-luna[1M]`), reuse (`gpt-5.6-luna[1M]`); two support traces by `asm-finder`
**Agents skipped**: data-security — no changed auth, input-validation, persistence, secret, or external-data boundary; the read-authorizing predicate was moved verbatim and separately audited for semantic preservation
**Verdict**: **REJECT**
**Counts**: 5 BLOCK, 0 WARN, 1 SUGGEST
**Blocker split**: 5 feature / 0 machinery

## Gate and context

- Gate 2 is approved. The review applied design D1-D5, the task Acceptance fields, the worktree-agent-presence delta, and project anchors WT-011.6 / DESIGN D31.
- `bun run asm change verify-status attribute-a-path-to-the-worktree-it-resolves-into` records all five tasks at exit 0. The caller additionally reported type check, 5,474 unit tests, I10, and `biome check src` at the 0-error / 14-warning baseline. The review did not rerun project verification.
- Review classification: change-state Markdown and ordinary docs were skipped; changed tests were reviewed inline; `analytics.json` and production TypeScript were reviewable. No changed test contains `.only` or `.skip`.

## Risk map

- One mutable path memo is shared across projection, removal assessment, repository discovery, and decoration scoping.
- Cold-path `realpath` completion crosses structural invalidation and UI reset boundaries.
- Pane/session/folder/repository producer sets have different lifecycles but mutate one global cache.
- Removal confirmation consumes cwd and activity evidence around a new await.
- File-tree containment crosses extension-host raw workspace paths into a browser-only lexical comparator.
- Growth axis: distinct successful cwd spellings retained across pane/session lifetimes in one extension-host process.

## Full-flow trace

- Presence: `PaneEvidenceStore` -> cwd preparation -> synchronous `resolvedOr` -> longest-worktree attribution -> host single-flight commit. The host dirties and reruns a projection when pane evidence changes during the await, so the specialist's separate-pane-snapshot projection finding was rejected.
- Removal: pane snapshot -> cwd preparation -> activity lookup -> `evaluateRemoval` pane filter -> confirmation evidence. No pane-evidence revision or retry protects this flow.
- Repository discovery: workspace folders + Git API roots -> tracked preparation -> longest resolved root -> git probe fallback -> normalized worktree roots.
- Decorations: workspace-folder event/construction -> fire-and-forget preparation -> immediate repo-map rebuild -> synchronous workspace filter -> delta. No continuation fires after preparation settles.
- File tree: `vscode.workspace.workspaceFolders[0].uri.fsPath` -> init/change message -> `FileTreePanel.workspaceRootPath` -> lexical `isPathInside`; no realpath occurs in this flow.
- Authorization split: the moved `resolvedPathBoundary` implementation remains uncached for candidates, preserves strict/read-authorizing behavior, and leaves `pathBoundary` node-free for the browser bundle.

## Findings

### B1

- **ID**: B1
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: chair
- **Class**: feature
- **File:line**: `src/webview/fileTree/FileTreePanel.ts:309`
- **Title**: File-tree containment still compares against an unresolved workspace root
- **Evidence**: The changed sites at lines 310 and 335 now call the shared lexical `isPathInside`, but `workspaceRootPath` still arrives unchanged from `fileTreeHost.ts:119-128,156-176`, where it is read directly from `workspaceFolders[0].uri.fsPath`. The complete init and `workspace-root-changed` flow forwards that spelling unchanged. No memo or realpath is wired into the file-tree boundary, despite D1 requiring the producer-bounded root side to resolve and task 1_5 planning that resolution where the panel receives the root.
- **Impact**: With a symlink-spelled workspace root and a physical path from editor/OSC reveal, the panel decides the path is outside, reroots unnecessarily, and fails the accepted “root-side aliasing everywhere” behavior.
- **SuggestedFix**: Resolve the workspace root host-side before the containment contract, or send a separate resolved comparison root while retaining the user spelling for display/data access. Add initial-root and root-change regressions with a symlinked workspace folder and physical revealed node.
- **Status**: open
- **Triage**: new; chair full-flow finding, supported by `asm-finder`

### B2

- **ID**: B2
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: asm-review-logic, corroborated by asm-review-frontend and chair
- **Class**: feature
- **File:line**: `src/providers/gitDecorationProvider.ts:172`
- **Title**: Decorations rebuild before workspace-folder resolution settles
- **Evidence**: `resolveFolders()` starts `paths.prepare()` without awaiting it. Construction proceeds into Git acquisition, and a folder-change handler calls `resolveFolders()` then immediately `provider.reset()`. That reset rebuilds repo maps and filters each path through `resolvedOr`; until realpath settles it returns the lexical folder. No generation-guarded reset or emission runs when preparation completes.
- **Impact**: Physical Git paths under a symlink-spelled workspace folder can be filtered out on initial acquisition or folder replacement and remain undecorated until an unrelated repository event. This directly violates task 1_4's correctness acceptance.
- **SuggestedFix**: Preserve immediate clearing if needed, then run an authoritative generation-guarded reset/rebuild after the current folder-set preparation settles. Add a delayed-realpath test proving decorations recover without another Git event.
- **Status**: open
- **Triage**: new; specialist agreement, elevated from WARN because the hard acceptance can remain false indefinitely

### B3

- **ID**: B3
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: asm-review-logic, corroborated by frontend, contracts, and chair
- **Class**: feature
- **File:line**: `src/utils/resolvedPathMemo.ts:46`
- **Title**: In-flight resolution can restore stale state after invalidation
- **Evidence**: A pending success unconditionally writes `settled.set(key, real)` after `invalidate()` or `invalidateAll()` has cleared the key. A pending failure unconditionally deletes `memo`, so an older rejected operation can also delete a newer promise started after invalidation. Sequential tests cover only already-settled entries.
- **Impact**: A pre-structural-change result can repopulate the memo or overwrite a newer result, leaving projection, removal, discovery, and decorations attributed to the old physical directory indefinitely.
- **SuggestedFix**: Give each operation a promise identity or per-key/global generation and publish/delete only if it still owns the current entry. Cover delayed success and delayed failure across `invalidate()` and `invalidateAll()`.
- **Status**: open
- **Triage**: new; corroborated across three specialists

**Invariant inventory**: An operation may mutate a memo key only while it is the current generation for that key. Affected boundaries: success publication, failure cleanup, single-key invalidation, global invalidation. Verified safe: concurrent callers before invalidation join one promise; settled sequential invalidation re-resolves.

### B4

- **ID**: B4
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: asm-review-contracts, corroborated by logic, performance, reuse, and chair
- **Class**: feature
- **File:line**: `src/utils/resolvedPathMemo.ts:83`
- **Title**: The shared memo has no producer ownership lifecycle
- **Evidence**: One global `invalidate(path)` deletes every consumer's answer. A pane leaving the symlinked workspace root invalidates the same key the decoration tracker still owns; decorations then fall back lexically and do not prepare again until a workspace-folder event. The inverse also occurs: pane closure deletes state without forgetting `seenCwd`, and successful registry reads evict disappeared sessions without invalidating their cwds, so successful entries remain in both maps. Repository discovery additionally passes workspace folders as never-forgotten `pinned` paths. The direct cwd growth axis is final paths of closed panes plus paths of disappeared external sessions over the extension-host lifetime, with no structural cap.
- **Impact**: One producer can erase another active producer's root, while dead producers leave stale resolutions and unbounded retained entries. A reused spelling after symlink retargeting can be attributed to the former worktree; a pane move at the workspace root can disable symlink-aware decoration scoping for the rest of the session.
- **SuggestedFix**: Make the single memo owner-aware: replace each producer's current set atomically, retain an entry while any owner holds it, and force a fresh generation on zero-to-one re-entry. Apply the same lifecycle to panes, registry sessions, workspace folders, and repo roots; test two owners sharing one spelling plus pane/session disappearance.
- **Status**: open
- **Triage**: new; merged invariant finding for over-invalidation, under-invalidation, and uncapped retention

**Invariant inventory**: A cached attribution fact lives exactly while at least one active producer owns its spelling, and no owner may evict another's live fact. Affected boundaries: pane move/close, external-session disappearance, repo-root changes, repo-discovery workspace-folder history, and decoration's standing folder set. Verified safe: decoration's own folder replacement and repoRoots' tracked repository removal when no other owner shares the key.

### B5

- **ID**: B5
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: asm-review-logic
- **Class**: feature
- **File:line**: `src/extension.ts:706`
- **Title**: Removal facts combine pane cwd and activity from different observations
- **Evidence**: `removalFacts.panes()` snapshots pane ids/cwds, awaits cold path resolution, then calls `activityFor()` while mapping the older records. A pane can move or exit during the await, producing an old cwd paired with new activity. `WorktreeHost.stillObserved` validates only the repository listing; `PaneEvidenceStore` exposes no revision and the removal flow performs no pane retry.
- **Impact**: The confirmation evidence can omit a live pane rooted in the target or suppress a pane because post-await activity says `exited`, allowing removal without naming the terminal that can be destroyed. The await's placement before `stillObserved` preserves the repository observation but not one pane observation.
- **SuggestedFix**: Snapshot each pane's cwd and activity together before awaiting resolution, or add a pane-evidence revision and retry when it changes during preparation. Keep the resolved cwd and activity tied to the same accepted observation.
- **Status**: open
- **Triage**: new; directly refutes the claimed one-observation property for pane facts

### S1

- **ID**: S1
- **Severity**: SUGGEST
- **Confidence**: HIGH
- **Priority**: P4
- **Agent**: chair
- **Class**: feature
- **File:line**: `src/providers/gitDecorationProvider.test.ts:738`
- **Title**: The surviving decorated-path mutation is not equivalent
- **Evidence**: `resolvedOr(absPath)` is lexical only when that spelling is unprepared. Production deliberately shares one memo across producers, so a decorated path can already be prepared as a workspace folder, repo root, pane cwd, or session cwd. In that state the mutant changes the candidate from lexical to physical and can change containment; the current tests never preload the decorated path through another producer.
- **Impact**: Treating the survivor as equivalent overstates mutation coverage and can let an accidental violation of D1's lexical per-event side survive unnoticed.
- **SuggestedFix**: Add a test that preloads the decorated candidate spelling in the shared memo and proves decoration still uses the lexical candidate with no syscall. Count the survivor as killed/non-equivalent rather than equivalent.
- **Status**: open
- **Triage**: new; non-gating support evidence

## Adjudication notes

- The presence specialist's proposed blocker for `project()` reading pane state twice was rejected. The production `WorktreeHost` single-flight marks the run dirty on pane changes, reruns a full projection, and commits only a clean completion.
- The frontend specialist's statement that a lexical FileTree root was approved was rejected. D1 leaves the revealed node lexical but explicitly requires the producer-bounded workspace root to resolve; the host-to-panel trace proves that half is absent.
- The `pathBoundary` / `resolvedPathBoundary` split is sound: the read-authorizing candidate remains uncached, shared boundary semantics still have one implementation, and the browser import remains node-free.
- The archived D8 no-cache rule remains correctly scoped to answers authorizing reads. B3/B4 concern the separate attribution memo's own lifecycle, not a request to remove that accepted cache.

## Requested confirmations

- `snapshotPool.test.ts` and `snapshotPool.ts` are absent from the reviewed range and from the changed behavioral impact cone. The recorded dispose/admission defect remains a valid separate-change concern and is not a finding here.
- The decorated-path mutation is challenged as non-equivalent for the shared-memo reason recorded in S1.

## Recorded verification evidence

`bun run asm change verify-status attribute-a-path-to-the-worktree-it-resolves-into` reports tasks 1_1 through 1_5 at exit 0, including the additive assertion accounting and the moved 33-test boundary suite. The caller reports the final type check, 5,474 unit tests, I10 gate, and Biome 0-error / 14-warning baseline. These passing gates do not exercise delayed realpath settlement, cross-owner invalidation, FileTree root provenance, or removal-fact observation coherence.

## Specialist results

- `asm-review-logic` — memo concurrency/invalidation — `gpt-5.6-sol[1M]` — B2/B3/B4 corroboration.
- `asm-review-logic` — presence/removal flow — `gpt-5.6-terra[1M]` — B3/B5 and lifecycle corroboration; projection-snapshot proposal rejected after caller trace.
- `asm-review-contracts` — five-site contracts and boundary split — `sonnet[1M]` — B4; authorization split verified safe.
- `asm-review-frontend` — decorations and FileTree UI — `gpt-5.6-luna[1M]` — B2/B3; FileTree conclusion refuted by full provenance trace.
- `asm-review-performance` — growth axes and hot paths — `gpt-5.6-luna[1M]` — B4's uncapped-retention boundary.
- `asm-review-reuse` — tracker extraction and module split — `gpt-5.6-luna[1M]` — B4 ownership issue; split cohesion verified.

## Audit backlog

None.

## Accepted risk

None.

---

## Author triage — round 1

Every finding was checked against current code before a verdict. No fix edit preceded this section.

### B1 — File-tree containment still uses an unresolved workspace root
**Status:** accepted
**Triage:** Correct, and it is a gap against my own task Plan: 1_5's step 1 said "resolving the workspace root through the memo where the panel receives it" and I only deleted the private predicate. D1 commits to resolving the root side at every site and the table lists `FileTreePanel.ts:309,334` as root-bounded, so this is remediation of an accepted decision, not new scope. The chair's fix note is also right that the root cannot simply be replaced: `workspaceRoot` mounts the tree and is echoed in the UI, so realpathing it in place would show `/private/var/...` where the user typed `/var/...`. The resolved form travels as a SEPARATE field and only the comparison uses it.

### B2 — Decorations rebuild before workspace-folder resolution settles
**Status:** accepted
**Triage:** Confirmed. `resolveFolders()` is fire-and-forget and nothing re-runs when it settles, so the first rebuild after construction or a folder change compares lexically and no later event repairs it. My in-code comment defended the lexical fallback as "exactly the behaviour that shipped before", which is true and beside the point: 1_4's acceptance is that a symlink-spelled folder DOES scope decorations, and a fallback that is never revisited does not deliver it.

### B3 — In-flight resolution can restore stale state after invalidation
**Status:** accepted
**Triage:** Confirmed by reading `resolve()`: the success continuation writes `settled` unconditionally, and the failure continuation calls `memo.delete(key)` without checking that the entry is still its own. This is the identical defect `presenceDeps.resolveReportedSession` already carries a fix for (round-2 W7, "compared before deleting") — I wrote that guard and did not carry it here.

### B4 — The shared memo has no producer ownership lifecycle
**Status:** accepted in part — the leak accepted, the proposed mechanism rejected
**Triage:** Two claims, and they do not stand equally.
- ACCEPTED: entries are never released when a pane closes or an external session disappears. `forgetCwd` fires only on a pane that MOVES, so a pane that exits leaves its last cwd resolved forever. That is a genuine unbounded axis over an extension-host lifetime and is fixed here.
- REJECTED: owner-scoped sets with reference counting. Cross-producer invalidation is a cost, not a correctness fault — every consumer re-resolves through `prepare`/`resolvedOr` and gets the same answer, one syscall later. Reference counting would mint a new lifecycle owner to buy back a syscall the design already budgets for, and D4 deliberately keeps invalidation structural rather than accounted. Releasing on pane close and on session eviction closes the leak without it.
- The "spelling reused after symlink retargeting" half is the residual already named in design.md's Risk Map, accepted at plan time.

### B5 — Removal facts combine different pane observations
**Status:** accepted
**Triage:** Confirmed. `paneEvidence.panes()` is snapshotted, then the resolution is awaited, then `activityFor` is read per pane on the far side of that await. A pane that exits during the await is filtered by `p.activity !== "exited"` in `evaluateRemoval`, so a terminal that was live when the set was taken can be dropped from the blocker list — on the one action that cannot be undone. I moved the await ahead of `stillObserved` to keep ONE repository observation and did not notice I had split the PANE observation in doing so.

### S1 — The surviving decorated-path mutation is not equivalent
**Status:** accepted — my claim was wrong
**Triage:** The chair is right and the reason is my own 1_4 change: once every consumer shares one memo, a decorated path can already be prepared as a workspace folder, repository root, pane cwd or session cwd, and `resolvedOr` then returns the resolved form rather than the lexical one. My equivalence argument silently assumed the unshared memo of 1_2. The cost claim survives — no syscall is issued on that path — but the containment claim does not, and the test must pin the per-event candidate as lexical against a memo that HAS the spelling prepared.
