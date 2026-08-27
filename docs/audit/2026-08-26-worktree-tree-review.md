# Audit — worktree tree: cache, merge, and live wiring

Review of three previously-unreviewed commits, run 2026-08-26 by three independent
`asm-review-master` agents (one per commit, each fanning out to the specialist lenses).
Every finding below was re-verified by hand against **HEAD (`5fd32ec`)**, not against the
commit it was found in — agent 1 reviewed at `e650810` and six of those files were
rewritten by the time the branch landed. Line numbers are HEAD's.

**Nothing here is fixed.** This file exists so the findings survive.

| Commit | Change | Prior review | Verdict |
| --- | --- | --- | --- |
| `e650810` | `cache-and-broadcast-worktree-tree` (WT-001.2) | skipped by explicit user decision | **REJECT** — 3 blocking, 9 warnings |
| `4b18ea5` | merge of `main` into the branch | n/a | **WARN** — resolution clean, 2 semantic conflicts |
| `5fd32ec` | `wire-live-worktree-tree` (WT-003.1) | peer review not requested | **WARN** — 0 blocking, 7 warnings |

The webview UI the merge brought in (`404d4c1`, `add-worktree-panel-shell`) is a separate
change that **was** already reviewed — 2 blocking + 6 warnings, 7 fixed, 2 deferred — and
is deliberately out of scope here. Its two deferrals are carried at the end.

State at each commit: `tsc` clean, biome at the pre-existing 13 warnings, full suite green
(3274 tests at the merge). **None of the findings below is caught by a failing test.** Four
are caught by a *passing* one — see § D.

---

## A. Blocking — the cache does not hold its own headline invariant

The commit message for `e650810` states:

> WorktreeCache keeps each repo's last good listing: a failed rebuild sets `degraded` and
> retains the worktrees rather than reading as a deletion.

That holds for exactly one failure mode — a listing that fails *after* its repo is already
in the build. Two other paths empty the tree, and one of them cannot be recovered by a
forced refresh for thirty minutes.

### A1. A transient root-resolution failure deletes the whole repo group

`src/worktree/WorktreeCache.ts:57-73`, root cause at `src/worktree/repoRoots.ts:97-113`

`merge()` protects worktrees only for repos present in `build.tree.repos`. `resolveRepoRoots`
decides that set, and it cannot tell "not a repository" from "git failed": `resolveToplevel`
returns `undefined` for a 10 s timeout, a spawn failure, and a genuine non-repo alike, and
each is a bare `continue`. `applyBuild` then runs `repos.clear()` and repopulates only from
survivors — under a comment asserting the opposite reading:

```ts
// Entries absent from the new root set are gone, not stale: a workspace
// folder that was removed must not leave its group behind.
repos.clear();
```

**Failure:** multi-root window, user hits refresh under IO load,
`git rev-parse --show-toplevel` in `/repo-a` times out. The group and its 3 worktrees
vanish; `reconcileWatches` disposes its watchers. Indistinguishable from the user removing
the folder. Directly violates the change's own spec: *"SHALL NOT empty it or alter its
worktree count."*

**Shape of a fix:** `resolveToplevel` must distinguish absence from failure, and a root
that failed to resolve must be carried forward as degraded rather than dropped from the
root set.

### A2. One failed `git --version` empties every repo for 30 minutes

`src/worktree/WorktreeCache.ts:83-93`, with `src/worktree/gitCapabilities.ts:13,108`

`read()` discards all cached listings whenever the probe is negative:

```ts
function read(): WorktreeTree {
  if (!gitAvailable) {
    return { repos: [], /* ... */ gitAvailable: false };
  }
```

The negative probe is memoised per window for `GIT_CAPABILITY_RETRY_INTERVAL_MS = 30 * 60_000`,
so `force: true` re-reads the cached `absent` and changes nothing.

**Failure:** a transient `EAGAIN` under a heavy build → the panel goes empty and stays empty
for half an hour, and the Refresh button is inert against it.

**Pinned as correct** by `WorktreeCache.test.ts:209-225` ("reports git as unavailable with
its reason and no repos") — the test seeds `REPO_A`, applies a `gitAvailable: false` build,
and asserts `repos` is empty. Fixing A2 means rewriting that test's expectation.

### A3. A signal arriving mid-rebuild is dropped permanently

`src/worktree/rebuildGate.ts:123-134`

```ts
// One rebuild at a time per scope. A request arriving mid-rebuild — forced
// or not — is answered by the rebuild already running: it reads the same
// git state this request wants.
if (state.inFlight) {
  return state.inFlight;
}
```

The claim is only true if the request precedes the in-flight run's git read. Nothing
schedules a follow-up.

**Failure:** a `worktrees/*` create at t=0 starts a rebuild; git output lands at t≈40 ms; a
second `git worktree add` fires the debounced watcher at t≈210 ms. `inFlight` absorbs it and
records nothing. The broadcast omits the second worktree, the filesystem goes quiet, and
nothing ever corrects it.

**Worse than reported:** `rebuildGate.test.ts:100-120` asserts `run` is called exactly once
across three requests *including one with `{ force: true }`*. So `force` bypasses the floor
but not `inFlight` — the user-facing Refresh is silently a no-op for the duration of any
rebuild already running. The drop is pinned as the contract.

**Shape of a fix:** a request that arrives after the in-flight run's git read must set a
"dirty" flag that schedules exactly one follow-up run on completion.

---

## B. Warnings that cross commit boundaries

These are the ones where two commits disagree with each other, or where a claim in the
commit message / design doc is not what the code does.

### B1. The `visible` flag has no falling edge — the whole point of D7 is defeated

`src/providers/TerminalViewProvider.ts:219-231`, `src/providers/TerminalEditorProvider.ts:325-330`,
`src/extension.ts:226,245`

All three surfaces register `retainContextWhenHidden: true`, so a hidden webview keeps its
document and its `visible = true` declaration. Neither `onDidChangeVisibility` nor editor
view-state is ever forwarded to `WorktreeHost`.

**Failure:** switch the sidebar to Explorer with the Worktree body open. Every
watcher-driven rebuild for the rest of the session serializes the full tree into an
invisible webview and `replaceChildren()`-rebuilds its DOM. This is precisely the cost D7
exists to avoid.

The `wire-live-worktree-tree` proposal declares this out of scope **because "the host has no
signal for it."** That premise is false: `onDidChangeVisibility` is subscribed at
`TerminalViewProvider.ts:231`, seven lines below the worktree attach at `:224`, in the same
function, already gating PTY output for the same reason. The scope decision rests on a
factual error and should be revisited rather than inherited.

### B2. Presence types are declared twice, and the wire now depends on both

`src/webview/worktree/worktreeViewTypes.ts:33-90` vs `src/worktree/presenceTypes.ts:12-89`

`PresenceDegradation`, `WorktreeSubagentRow`, `WorktreeAgentRow`, `WorktreePresence` exist
independently on both sides. The host copy is the **wire** type
(`messages.ts:6` → `WorktreeTreeResponseMessage.presence`); the webview copy is what all
eight view modules consume. They are structurally identical today, so `tsc` is clean.

This is an omission, not a decision — the view file states the rule in its own header:

> When the host modules land these move to `src/worktree/` and this file re-exports them;
> the view code does not change, which is the point of transcribing the field names exactly
> rather than inventing view-local ones.

The host module landed in `e650810`. The re-export did not happen. `worktreeViewTypes.ts:21`
*does* re-export `WorktreeInfo` / `WorktreeRepo` / `WorktreeTree` — which is what proves the
four presence types were simply missed.

**Failure:** WT-004 adds an optional field to the host's `WorktreeAgentRow`. Structural
typing accepts it silently, the field renders nowhere, and — because it is absent from
`worktreeSignature()` — no change in it ever invalidates the render guard. Stale forever,
**no compile error**.

**Shape of a fix:** delete the four webview-local declarations, extend line 21's re-export.
One-line change; the value is that it can never drift again.

### B3. `4b18ea5` has a zero-width shippable window

`src/webview/main.ts` (at the merge) / `src/providers/WorktreeHost.ts:66-82`

At the merge commit, `requestWorktreeTree` / `worktreeViewVisibility` / `worktreeTreeResponse`
have zero references under `src/webview/`; the view is built by `createWorktreePreview(...)`
with `onHostAction: (a, t) => console.debug("[worktree] not wired yet:", a, t)`. The build
displays **fabricated repos, branches and agent titles** from `worktreeFixtures.ts` while the
real tree sits unreachable in the host.

Not a resolution defect — WT-003.1 (`5fd32ec`) closes it, and fixture removal there is
verified complete (no runtime reference to `worktreePreview`; `worktreeFixtures.ts` reachable
only from `*.test.ts`, so it stays out of the bundle). Recorded because `4b18ea5` must never
be a release point or a bisect-good marker.

---

## C. Per-commit warnings

### `e650810` — cache and broadcast

- **`WorktreeHost.ts:94-101`** — `rebuild()` checks `disposed` only at entry, and `dispose()`
  is idempotent, so watchers created after disposal leak for the window's lifetime. CONFIRMED
- **`WorktreeHost.ts:102-107,118-149`** — a clean per-repo rebuild silently clears a
  "not being watched" degradation (`reconcileWatches` runs on whole-tree scope only), and a
  failed watch is never retried. Reachable via *partial* watch failure — the case the test
  double never constructs. CONFIRMED
- **`worktreeWatchTargets.ts:28-34`** — `worktrees/*` and `worktrees/*/HEAD` contain path
  segments, so per VS Code's own `createFileSystemWatcher` docs these create **recursive**
  watchers over the entire `.git` dir (2 per repo). The commit message's "each glob matches one
  path segment — an agent's writes to index, logs and refs drive no rebuild" is true at the
  event-filter layer and **false at the OS-watch layer**; `.git/index`, `logs/`, `refs/` are
  outside default `files.watcherExclude`. The test asserts the glob strings lack `**` — the
  wrong layer. CONFIRMED
- **`worktreeWatchTargets.ts:31-32`** — git writes HEAD via lockfile+rename; W2/W3 subscribe to
  `change` only, so on any backend reporting that as create/delete, branch switches drive no
  rebuild. PLAUSIBLE
- **`WorktreeHost.ts:84-103,172-179`** — `requestWorktreeTree` from a surface that has not
  declared visible is never answered. The protocol spec self-contradicts here and D7's prose
  says the opposite of the code. Contract inconsistency, not a bug. CONFIRMED
- **`WorktreeCache.ts:45-55`** — the degraded merge overwrites `label` / `mainPath` from
  `root.rootPath`, so a repo opened *as* a linked worktree renames itself on a transient
  failure. Cosmetic today; WT-005 re-resolves paths from this cache. CONFIRMED
- **`WorktreeCache.ts:95-109`** — `read()` returns cache-owned repo objects and worktree
  arrays; the isolation test only pops the outer array. CONFIRMED

### `5fd32ec` — live wiring

- **`VaultPanel.ts:358-366` + `WorktreeController.ts:105-112`** — Refresh is present and inert
  while the section is collapsed. The click handler routes on `this.view === "worktree"` alone
  and ignores `this.collapsed`; `vaultPanel.css:2145-2151` hides the toolbar and body but not
  the header strip holding the button; `requestRefresh()` then returns at
  `if (!this.visible || this.refreshing)`. No request, no spinner, no expand, no log. The
  sessions branch posts regardless of collapse. This is the diff's own MODIFIED requirement
  verbatim: *"an action the view cannot perform SHALL be absent from the surface that would
  offer it — a row's context menu, **or a control in the panel toolbar**."* CONFIRMED
- **`WorktreeController.ts:120-126`, `WorktreeHost.ts:189-191`** — `loading` has one terminator
  and the protocol has no failure message. No `worktreeTreeError` variant, no timeout, and
  `void gate.request(...)` discards a rejection the gate documents that it propagates.
  `rebuild()` calls `broadcast()` last, so anything throwing before it pushes nothing, leaves
  `built === false` so every retry re-enters the same failure, and strands the skeleton with no
  log naming the cause. CONFIRMED (structure)
- **`WorktreeController.ts:109-124`** — `refreshing` is cleared by *any* response, not the one
  it asked for: no request id on either message. An unrelated repo's watcher rebuild clears the
  user's marker mid-flight; the weakened guard then admits a second forced request that A3
  silently collapses. CONFIRMED
- **`main.ts:966-976`, `VaultPanel.ts:525`** — the seam that turns the feature on has zero test
  coverage. `onWorktreeVisibility` appears in no test file; every controller test calls
  `setVisible(true)` by hand. The `worktreeController?.setVisible(...)` optional chain is
  load-bearing — reorder the mount below `new VaultPanel(...)` and the callback fires against
  `null`, the panel skeletons forever, **and the whole suite stays green**. CONFIRMED
- **`WorktreeController.ts:86-89`, `WorktreeHost.ts:174`** — visibility is a delta-only
  declaration with no resync. A script restart without a re-attach (Reload Webviews, renderer
  crash, editor-group move overwriting `this.worktreeSurface`) leaves the host at `visible: true`
  while a fresh controller seeds `false` and, per its dedup, never posts `false`. PLAUSIBLE
- **`WorktreeController.ts:138`, `WorktreeView.ts:351-369`** — `noFolder` is latched at init and
  checked before the tree branch, so a window that gains a folder without an ext-host restart
  holds a real tree that never renders. PLAUSIBLE — VS Code restarts the host when the *first*
  folder changes, but this repo already ships `workspaceRootChanged` live for the file tree, and
  the same commit deliberately made `worktreeHasRepo` a fresh read while leaving `noFolder`
  captured.
- **`hasGitRepo.ts:20`** — bare repos read as no-repo; virtual/remote workspace folders are
  probed through the local filesystem; the sync `existsSync` walk is uncached on every init.
- **`VaultPanel.ts`** — `pruneStaleState` wipes persisted collapse on a degraded listing and
  reseeds defaults, so A1/A2 also cost the user their expansion state.

---

## D. The meta-finding: four tests pin defects as contracts

This is the reason two of the three commits shipped without anyone noticing, and it matters
more than any single entry above.

| Test | Pins |
| --- | --- |
| `WorktreeCache.test.ts:209-225` | A2 — empty tree on git-unavailable, asserted as correct |
| `rebuildGate.test.ts:100-120` | A3 — the dropped mid-rebuild signal, `force` included |
| `worktreeWatchTargets` glob test | C — asserts glob strings lack `**`; the recursive watch is at the OS layer |
| `WorktreeCache` isolation test | C — pops the outer array only; inner arrays stay cache-owned |

The suites are unusually thorough on happy paths and several genuinely hard cases. The gap is
uniform and specific: **the failure cases that expose every finding here are never
constructed.** The test double for the watcher pool cannot express a partial failure; the
cache tests never drive a root that fails to resolve; the gate tests never advance the clock
past a git read.

Fixing A2 and A3 requires *changing* those two tests, not adding to them. Budget for that.

---

## E. Carried-over deferrals from `404d4c1`

That change's `.reviews/` directory was never persisted — nothing under
`asimov/changes/archive/260826-0035-add-worktree-panel-shell/`, and nothing in git history
matching `*.reviews*`. The round file is gone; these two survive only as prose in
`proposal.md:37-44`, quoted verbatim:

> - **The repo-derived default view** (worktree when a repo exists, sessions when none). It
>   needs repo knowledge the shell does not have, and the tree it would open on is fixture
>   data — so opening on it would show a stranger's paths to a user who never asked. Deferred
>   to WT-003.1, which now carries it as acceptance.
> - **Extracting the shared popup and modal primitives.** This view's context menu duplicates
>   the vault menu's whole lifecycle, and its dialog shell duplicates the continuation
>   dialog's focus trap; the two pairs have already drifted. Extraction belongs to the tasks
>   that next touch those surfaces (WT-005.1, WT-005.2) rather than to a third copy written
>   here.

The first is discharged by `5fd32ec`. The second is still open, and its recorded home —
WT-005.2's Notes, *"Reuse signal: the dialog shell duplicates the vault continuation dialog's
focus trap and disposal"* — sits **inside the hand-resolved conflict block in `docs/PLAN.md`**.
Had the merge taken either side wholesale there, the deferral would have lost its home. The
union resolution preserved it.

A related artifact of the merge, low severity: `src/webview/vault/VaultPanel.ts:31` now imports
`ICON_BRANCH, ICON_PLUS` from `../worktree/worktreeIcons`, inverting every other vault↔worktree
dependency. The extraction above is where that gets undone.

---

## F. Merge integrity of `4b18ea5` — verified clean

Checked mechanically rather than by eye, and recorded here so it does not get re-litigated:

1. **Blob-identity sweep** — for every path either parent changed vs. base `6834eb3`, the
   merged blob equals that parent's blob. Only `docs/DESIGN.md` and `docs/PLAN.md` differ on
   both sides. No deletions on either side, so no other file *could* have been taken wholesale.
2. **Raw 3-way replay** — `git merge-file` on the three blobs, diffed against the committed
   file. The only differences are the conflict blocks themselves; every auto-merged hunk from
   both parents is byte-identical.
3. **`docs/DESIGN.md`** — "Persisted view keys" took main's (the branch's text was a strict
   prefix, nothing lost); "Worktree settings keys" took the branch's, and main's version is
   md5-identical to base, i.e. main never edited it. Both correct.
4. **`docs/PLAN.md`** — WT-005.2 Notes resolved as a true **union** (`grep -c` = 1 for each
   side's unique sentence, so no double-paste). Acceptance took the branch's; main's is
   md5-identical to base.
5. At `4b18ea5`: `tsc --noEmit` exit 0 · vitest 178 files / **3274 tests pass** · biome 13
   warnings, matching the baseline `add-worktree-panel-shell`'s `workflow.md` records verbatim ·
   no conflict markers · `esbuild.js:79` already declares `".css": "text"`, so main's new CSS
   import resolves.

---

## G. Suggested order

1. **A3** then **A1**, **A2** — A3 is the smallest and its fix (a dirty flag scheduling one
   follow-up) is self-contained. A1 and A2 are the same bug seen twice: a failure that reads as
   an absence. Fixing them together keeps one definition of "degraded".
2. **B2** — one line, and it closes a whole class of silent drift before WT-004 opens it.
3. **B1** — revisit the scope decision on the falling edge; the premise it rests on is false and
   the signal is already subscribed seven lines away.
4. **`5fd32ec` C-list**: the collapsed Refresh and the missing `worktreeTreeError` are both
   user-visible today.
5. The § D test changes travel with A2 and A3 — they are not separable.
