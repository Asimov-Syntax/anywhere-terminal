## 1. Contracts

- [x] 1_1 Declare the presence envelope types — verified: pnpm run check-types && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D6; docs/design/worktree-agent-presence.md#2-data-model
  - **Acceptance**:
    - Outcome: The presence projection and its row types exist and type-check.
    - Verify: command pnpm run check-types
  - **Plan**:
    1. Add `src/worktree/presenceTypes.ts` declaring `WorktreePresence`, `PresenceDegradation`, `WorktreeAgentRow`, `WorktreeSubagentRow` exactly as the Refs anchor defines them, reusing `VaultAgentId` from `src/vault/types.ts` for the `agent` field.
    2. Types only — no builder, no default value, no behavior. Comment that WT-004 owns their population.

- [x] 1_2 Add the worktree message family to the shared protocol — verified: pnpm run check-types && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-tree-protocol/spec.md#{answer-a-worktree-tree-request, push-the-tree-and-the-presence-projection-together, deliver-each-push-only-to-surfaces-showing-the-view}; design.md D6; design.md D7
  - **Acceptance**:
    - Outcome: The three worktree messages are members of the protocol unions.
    - Verify: command pnpm run check-types
  - **Plan**:
    1. In `src/types/messages.ts`, add `RequestWorktreeTreeMessage` and `WorktreeViewVisibilityMessage` to `WebViewToExtensionMessage`, and `WorktreeTreeResponseMessage` to `ExtensionToWebViewMessage`.
    2. Doc-comment each with its direction and the invariant that tree and presence never travel apart.
    3. Add no webview handler: `createMessageRouter` already ignores unrouted types via its `default` branch (`src/webview/messaging/MessageRouter.ts:258`), and the webview sender lands in WT-002.1.

- [x] 1_3 Report pattern-watcher creation failure to the caller — verified: npx vitest run 'src/providers/fsWatcherPool.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/fs-watcher-pool/spec.md#{enospc--emfile-surfacing, pattern-subscription-failure-is-observable}; design.md D5
  - **Acceptance**:
    - Outcome: A pattern subscription whose watcher failed reports itself inactive with a reason.
    - Verify: unit src/providers/fsWatcherPool.test.ts
  - **Plan**:
    1. In `src/providers/fsWatcherPool.ts`, export `PatternSubscription extends vscode.Disposable` with `readonly active: boolean` and `readonly failureReason?: string`, and widen `subscribePattern`'s return type to it.
    2. Set `active` false with the caught error's code and message when watcher creation threw, and false with a "pool disposed" reason on the post-dispose early return; true otherwise. Keep the existing `console.error` line unchanged.
    3. Leave `VaultWatchCoordinator` untouched — the widening is source-compatible; assert in the test that disposing an inactive subscription is safe.

## 2. Cache and freshness

- [x] 2_1 Cache listings per repository and keep the last good one — verified: npx vitest run 'src/worktree/WorktreeCache.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-tree-freshness/spec.md#{confine-a-rebuild-to-the-repository-that-changed, never-present-a-stale-listing-as-current}; design.md D2
  - **Acceptance**:
    - Outcome: A failed listing keeps its previous worktrees and gains a reason.
    - Verify: unit src/worktree/WorktreeCache.test.ts
  - **Plan**:
    1. Add `src/worktree/WorktreeCache.ts` holding the resolved root set and one `CachedRepo { repo, degraded? }` per `repoId`, in memory only.
    2. Expose applying a rebuild result for one `repoId` and for the whole tree, plus reading the assembled `WorktreeTree` in resolved-root order.
    2b. In `src/worktree/WorktreeDiscovery.ts`, export the per-root assembly already inside `buildWorktreeTree` plus a detailed build returning the roots and each repo's listing, so a per-repo rebuild reuses that assembly instead of copying it and `unreadable` stays exact per repo. `buildWorktreeTree` keeps its signature and behavior.
    3. On an incoming listing that is degraded, retain the stored `worktrees` and set `degraded` from the reason; on a clean listing, replace both.
    4. Drop entries whose `repoId` left the resolved root set, so a removed workspace folder leaves no group behind.
    5. Cover: fail-after-success keeps the count; fail-on-first-read yields an empty group with a reason while a sibling stays populated. Files: `src/worktree/WorktreeCache.ts`, `src/worktree/WorktreeDiscovery.ts`.

- [x] 2_2 Gate rebuilds by scope with a rate floor and a forced bypass — verified: npx vitest run 'src/worktree/rebuildGate.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-tree-freshness/spec.md#{bound-the-sustained-rebuild-rate, rebuild-only-on-a-structural-change}; design.md D4
  - **Acceptance**:
    - Outcome: A sustained signal stream collapses to one rebuild per second per repository.
    - Verify: unit src/worktree/rebuildGate.test.ts
  - **Plan**:
    1. Add `src/worktree/rebuildGate.ts` keying pending and in-flight work on a scope string (a `repoId`, or the whole-tree scope).
    2. Coalesce: a request arriving while that scope's rebuild is in flight awaits the same promise instead of starting a second.
    3. Floor at `REBUILD_FLOOR_MS = 1000` since that scope's last rebuild — defer to the window's remainder and collapse further signals into that one deferred run.
    4. Let a forced request run immediately and reset the floor.
    5. Inject `now: () => number` and the timer factory, as `createGitCapabilities` does (`src/worktree/gitCapabilities.ts:68`); drive the floor and the deferral from a fake clock, never a real wait.

- [x] 2_3 Subscribe the three narrow watch patterns per repository — verified: npx vitest run 'src/worktree/worktreeWatchTargets.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_3
  - **Refs**: specs/worktree-tree-freshness/spec.md#{rebuild-only-on-a-structural-change, report-a-watch-that-was-never-established}; design.md D3
  - **Acceptance**:
    - Outcome: Each repository is watched by exactly the three documented patterns.
    - Verify: unit src/worktree/worktreeWatchTargets.test.ts
  - **Plan**:
    1. Add `src/worktree/worktreeWatchTargets.ts` returning the D3 table's three descriptors for a `repoId` — every one based at the common dir itself, so a repository whose linked-worktree directory does not exist yet is still watched.
    2. Subscribe them through the injected pool's `subscribePattern`, supplying `change` for the two HEAD patterns; `subscribe()` cannot see an in-place rewrite (`src/providers/fsWatcherPool.ts:185`).
    3. Report a reason when any of the three comes back inactive, and expose one disposal that releases all three.
    4. Assert each descriptor's exact base, glob, and event set against the D3 table — a glob matching one path segment rather than any depth is what keeps an agent's continuous writes to a worktree's index, logs, and refs out of the event stream.

## 3. Host

- [x] 3_1 Broadcast the tree to the surfaces that declared the view visible — verified: npx vitest run 'src/providers/WorktreeHost.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2, 2_1
  - **Refs**: specs/worktree-tree-protocol/spec.md#{answer-a-worktree-tree-request, push-unsolicited-on-the-same-message, deliver-each-push-only-to-surfaces-showing-the-view}; design.md D1; design.md D7
  - **Acceptance**:
    - Outcome: A push reaches every visible surface and no hidden one.
    - Verify: unit src/providers/WorktreeHost.test.ts
  - **Plan**:
    1. Add `src/providers/WorktreeHost.ts` with the `attach` / `handleMessage` interface from design.md § Interfaces, keeping a `Set` of surfaces each carrying a `visible` flag initialised false — the attach shape of `VaultWatchCoordinator.attach` (`src/providers/VaultWatchCoordinator.ts:294`), with the work behind it moved to window scope.
    2. Route `worktreeViewVisibility` to the sending surface's flag, and `requestWorktreeTree` to a rebuild through the gate, answering with one push.
    3. Emit `{ tree, presence }` with an empty presence projection; post only to surfaces that are visible and whose `isReady()` holds.
    4. Cover: two visible surfaces and one hidden receive two posts; a detached surface receives none; two concurrent requests produce one rebuild and one push per visible surface.

- [x] 3_2 Drive rebuilds from the watches and workspace changes — verified: npx vitest run 'src/providers/WorktreeHost.invalidation.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_2, 2_3, 3_1
  - **Refs**: specs/worktree-tree-freshness/spec.md#{rebuild-only-on-a-structural-change, confine-a-rebuild-to-the-repository-that-changed, own-freshness-once-per-window, report-a-watch-that-was-never-established}; design.md D3; design.md D8
  - **Acceptance**:
    - Outcome: A repository's watch event rebuilds that repository alone.
    - Verify: unit src/providers/WorktreeHost.invalidation.test.ts
  - **Plan**:
    1. In `src/providers/WorktreeHost.ts`, resolve the root set once, subscribe 2_3's targets per `repoId`, and route each event into 2_2's gate under that `repoId`'s scope.
    2. Subscribe `vscode.workspace.onDidChangeWorkspaceFolders` (injected) to a whole-tree scope that re-resolves roots and re-subscribes watches for added repositories, releasing those for removed ones.
    3. Mark a repository degraded when 2_3 reports an inactive subscription, per design.md D3. The watcher pool becomes a required construction dependency, so `src/providers/WorktreeHost.test.ts` supplies it too.
    4. Wire no `vscode.git` API events — design.md D8 records why and what covers them.
    5. Cover: an event for repo A runs one rebuild for A and none for B; attaching a second surface adds no git call and no watcher.

- [x] 3_3 Assemble the production git dependencies behind one factory — verified: npx vitest run 'src/worktree/worktreeDeps.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D9
  - **Acceptance**:
    - Outcome: One factory yields discovery deps backed by the real git and filesystem.
    - Verify: unit src/worktree/worktreeDeps.test.ts
  - **Plan**:
    1. Add `src/worktree/worktreeDeps.ts` exporting `createWorktreeTreeDeps()` composing `createGitCommandRunner()`, `createGitCapabilities(runner)`, `normalizeWorktreePath` bound to `fs.realpath` and the real platform, and `fs.stat`.
    2. Test the seams that are real: `normalize` maps two spellings of one temp directory to one value, and `stat` rejects with `ENOENT` for an absent path. Do not spawn git.

## 4. Wiring

- [x] 4_1 Wire the host once per window and attach every surface — verified: npx vitest run 'src/providers/TerminalViewProvider.worktree.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_2, 3_3
  - **Refs**: specs/worktree-tree-freshness/spec.md#own-freshness-once-per-window; specs/worktree-tree-protocol/spec.md#deliver-each-push-only-to-surfaces-showing-the-view; design.md D1
  - **Acceptance**:
    - Outcome: Sidebar, panel, and editor surfaces all receive the window's tree.
    - Verify: unit src/providers/TerminalViewProvider.worktree.test.ts
  - **Plan**:
    1. Construct the host once in `src/extension.ts` beside `createWatcherPool()` (`src/extension.ts:179`), pass it into both `TerminalViewProvider` instances, `TerminalEditorProvider.createPanel`, and `TerminalPanelSerializer`, and push it onto `context.subscriptions`.
    2. In `src/providers/TerminalViewProvider.ts`, attach on `resolveWebviewView` with `{ isReady, post }` mirroring the `fileTreeHost.attach` call site (`TerminalViewProvider.ts:206`), dispose the attachment in `onDidDispose`, and forward the two inbound worktree message types to `handleMessage`.
    3. Do the same in `src/providers/TerminalEditorProvider.ts` and `src/providers/TerminalPanelSerializer.ts` — the editor surface mounts the same webview document, so it is a live surface.
    4. Cover: a `requestWorktreeTree` from one provider's webview produces a push on that webview once it has declared the view visible, and none before.

- [x] 4_2 Record the visibility message in the protocol design doc — verified: manual — docs-only: added the worktreeViewVisibility row to worktree-rpc.md § 2.1 and named it in § 1 as the mechanism behind the existing skip rule
  - **Deps**: 1_2
  - **Refs**: design.md D7
  - **Acceptance**:
    - Outcome: The doc's message table lists the visibility message it already relies on.
    - Verify: none — docs-only
  - **Plan**:
    1. Add the `worktreeViewVisibility` row to `docs/design/worktree-rpc.md` § 2.1 and a sentence in § 1 naming it as the mechanism behind the existing skip rule.
