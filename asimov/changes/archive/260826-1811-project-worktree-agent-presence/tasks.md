## 1. Shared rules

- [x] 1_1 Add a token-bounded matcher for shell names and title-borne agent names — verified: pnpm exec vitest run 'src/shared/agentNames.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-agent-presence/spec.md#a-title-proves-identity-only-as-a-whole-token-from-a-curated-set <!-- design.md D5 -->
  - **Acceptance**:
    - Outcome: a name is recognised only as a whole token, never as a substring
    - Verify: unit src/shared/agentNames.test.ts
  - **Plan**:
    1. Add `src/shared/agentNames.ts` exporting `isShellName` and `matchTitleAgentName` over the boundary pattern in design.md D5.
    2. The title list is curated and narrower than `VAULT_AGENT_IDS`, and the reason is written at the constant (D5). Rank 1 does not use this module — it reuses `agentKindForExecutable` (D4).
    3. Dependency-free — `isShellName` is imported from the webview bundle by 1_4.
    4. Cover `openclaude`, `opencode-blinker`, a `.exe`/`.cmd` suffix, a path-form basename, a name among other words, and `cursor` used as an ordinary English word.

- [x] 1_2 Extend the shared activity projection with the two title rules — verified: pnpm exec vitest run 'src/shared/paneEvidence.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/pane-evidence-transport/spec.md#{a-shell-title-reclaims-the-pane, a-decorative-title-is-not-activity-evidence} <!-- design.md D6, D7 -->
  - **Acceptance**:
    - Outcome: a shell title reclaims a pane to `idle`, and a decoration-only title changes nothing
    - Verify: unit src/shared/paneEvidence.test.ts
  - **Plan**:
    1. In `src/shared/paneEvidence.ts`, add `TitleClass` and the `titleClass` field to `LiveActivityEvidence`, and apply D6's precedence inside `projectLiveActivity`.
    2. Replace the standing comment that defers these rules with what was decided, including why `waiting` outranks the shell rule and why decoration is neutral (D7).
    3. Keep every existing case as the regression gate; add the spec scenarios plus an `unknown` class behaving exactly as today.
    4. The field is required, not optional, so no caller can skip the rule by omission — which breaks the two existing construction sites at compile time. Pass `unknown` at `src/session/PaneEvidenceStore.ts` and `src/webview/terminal/TerminalActivityTracker.ts` to keep them building and behaving exactly as today; 1_3 and 1_4 replace those with real classification.

- [x] 1_3 Make the evidence store the pane registry, and expire output on a deadline — verified: pnpm exec vitest run 'src/session/PaneEvidenceStore.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: specs/worktree-agent-presence/spec.md#{reflect-a-pane-s-lifecycle-without-leaving-a-row-behind, a-pane-s-activity-expires-without-further-evidence}, specs/pane-evidence-transport/spec.md#a-shell-title-reclaims-the-pane <!-- design.md D2, D3 -->
  - **Acceptance**:
    - Outcome: the store enumerates every open pane and announces activity changes the clock causes
    - Verify: unit src/session/PaneEvidenceStore.test.ts
  - **Plan**:
    1. In `src/session/PaneEvidenceStore.ts`, add `cwd` / `ptyPid` / `shell` / `isAgentLaunch` to `PaneEvidence`, plus `panes()`, `markCwd`, and `markProcess` — surface in design.md § Interfaces.
    2. Derive `titleClass` inside `activityFor` from the stored title; do not store it, for the reason the store already applies to `titleReported`.
    3. Announce output through the *projected* activity, not each timestamp: `markOutput` fires `onChange` only when the projected activity moved (D3.2).
    4. Arm a per-pane idle deadline at `lastOutputAt + OUTPUT_IDLE_WINDOW_MS` that fires `onChange` when it elapses, cleared on delete, view delete and dispose — the shape `TerminalActivityTracker` already runs (D3.3).
    5. Cover: enumeration, each title class, a sustained stream announcing once, the idle edge announcing with no further input, and no timer surviving a delete.

- [x] 1_4 Feed the same title class to the tab tracker — verified: pnpm exec vitest run 'src/webview/integration/paneEvidenceReporting.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: specs/pane-evidence-transport/spec.md#a-shell-title-reclaims-the-pane, specs/pane-evidence-transport/spec.md#a-worktree-row-and-a-terminal-tab-never-disagree-about-a-pane <!-- design.md D6 -->
  - **Acceptance**:
    - Outcome: the tab and the worktree row read the same activity for one pane and one title
    - Verify: integration src/webview/integration/paneEvidenceReporting.test.ts
  - **Plan**:
    1. Add `setTitle(sessionId, rawTitle)` to `src/webview/terminal/TerminalActivityTracker.ts`, storing the stripped title per pane and passing its class into `projectLiveActivity`; clear it in `delete` and `dispose`.
    2. Call it from the same `onTitleChange` site in `src/webview/terminal/TerminalFactory.ts` that already feeds `onTitleEvidence`, and wire it in `src/webview/main.ts` beside the existing reporter wiring.
    3. Assert equality against `PaneEvidenceStore.activityFor` for a shell title, an agent title and a decoration-only title — a tracker-only unit test would not prove the two sides agree.

- [x] 1_5 Write pane facts into the store from the session lifecycle — verified: pnpm exec vitest run 'src/session/SessionManager.paneEvidence.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_3
  - **Refs**: specs/worktree-agent-presence/spec.md#{attribute-a-pane-to-exactly-one-worktree, reflect-a-pane-s-lifecycle-without-leaving-a-row-behind} <!-- design.md D2, D4 -->
  - **Acceptance**:
    - Outcome: a pane's directory and process facts stay current for as long as the pane exists
    - Verify: unit src/session/SessionManager.paneEvidence.test.ts
  - **Plan**:
    1. In `src/session/SessionManager.ts`, seed `cwd` / `ptyPid` / `shell` / `isAgentLaunch` at the existing `paneEvidence.create` call, and call `markCwd` from `setCurrentCwd` beside the write to `session.currentCwd`.
    2. Call `markProcess` from `respawnFallbackShell` where the pty is swapped, so the pane's pid, shell and cleared launch flag stay true after a shell reclaims it (D4).
    3. Add no deletion path: `cleanupSession` must keep leaving the evidence alone, which is what lets an exited pane keep its row (D2).
    4. Cover create, an OSC 7 update, a fallback respawn, and that a naturally exited pane is still enumerable after leaving `sessions`.

## 2. Projection

- [x] 2_1 Read the process table once per rebuild, and say so when it fails — verified: pnpm exec vitest run 'src/pty/processTableSnapshot.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-agent-presence/spec.md#{a-presence-rebuild-reads-each-shared-source-once, an-inconclusive-identity-read-retains-the-last-proven-identity} <!-- design.md D9, D10 -->
  - **Acceptance**:
    - Outcome: many descendant lookups cost one read, and a failed read is distinguishable from an empty one
    - Verify: unit src/pty/processTableSnapshot.test.ts
  - **Plan**:
    1. Add `src/pty/processTableSnapshot.ts` with the surface in design.md § Interfaces, reusing `parseProcessTable` and `collectDescendants` from `src/pty/processTree.ts` and exporting its ps-args matrix and timeout from there rather than copying either.
    2. Return the typed outcome in the discriminated-union shape `src/worktree/repoRoots.ts` already uses — `ok` / `unsupported` / `failed` with a reason — never an empty list standing in for a failure (D10).
    3. Share the in-flight promise so concurrent callers await one child process; expire on `ttlMs`, which paces a later external scan but never bounds a rebuild (D9).
    4. Cover N lookups costing one exec, concurrent callers sharing one, TTL expiry, and each failure mode reported as itself.

- [x] 2_2 Resolve agent identity by the documented precedence — verified: pnpm exec vitest run 'src/worktree/agentIdentity.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1, 2_1
  - **Refs**: specs/worktree-agent-presence/spec.md#{claim-agent-identity-only-from-evidence-that-proves-it, a-title-proves-identity-only-as-a-whole-token-from-a-curated-set, an-inconclusive-identity-read-retains-the-last-proven-identity} <!-- design.md D4, D5, D10 -->
  - **Acceptance**:
    - Outcome: identity is claimed only by a source that proved it, and never lost to a failed read
    - Verify: unit src/worktree/agentIdentity.test.ts
  - **Plan**:
    1. Add `src/worktree/agentIdentity.ts` returning the `IdentityOutcome` union in design.md § Interfaces — `proven` / `absent` / `failed` — over D4's ranks.
    2. Rank 1 calls `agentKindForExecutable` from `src/vault/registry.ts` gated on `isAgentLaunch`; rank 4 calls `matchTitleAgentName`. Do not reimplement either (D4, D5).
    3. Build vault handles with `formatEntryId` from `src/vault/types.ts`, never by assembling the string (D13).
    4. A failing snapshot or resolution yields `failed`, not `absent`, so the caller can retain the last proven identity (D10).
    5. Cover each rank winning, an unreported title, a decoration-only title, a substring near-miss, a launch record whose shell is not an agent binary, and a failed read reported as `failed`.

- [x] 2_3 Map panes to worktrees and project the agent rows — verified: pnpm exec vitest run 'src/worktree/presenceProjector.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_5, 2_2
  - **Refs**: specs/worktree-agent-presence/spec.md#{attribute-a-pane-to-exactly-one-worktree, qualify-identity-and-activity-independently, reflect-a-pane-s-lifecycle-without-leaving-a-row-behind, an-inconclusive-identity-read-retains-the-last-proven-identity, a-failed-presence-source-degrades-its-scope-rather-than-clearing-it, an-agent-row-s-age-describes-its-agent-not-its-pane, worktrees-rank-by-their-newest-agent-activity, a-presence-rebuild-reads-each-shared-source-once} <!-- design.md D8, D10, D11, D12, D13 -->
  - **Acceptance**:
    - Outcome: this window's panes become agent rows under the worktree each one is inside
    - Verify: unit src/worktree/presenceProjector.test.ts
  - **Plan**:
    1. Add `src/worktree/presenceProjector.ts` per design.md § Interfaces, enumerating panes from the store, never from `SessionManager` (D2).
    2. Attribute with `isPathInside` from `src/utils/pathBoundary.ts`, selecting the longest matching worktree as `matchRepository` does in `src/worktree/repoRoots.ts` — do not hand-roll a prefix test (D13).
    3. Capture one snapshot at `project()` entry — process table and running-session registry — and pass it to every pane through the existing `ResolveClaudeSessionDeps` seam (D9).
    4. Hold one resolution slot per pane: reuse a `proven` outcome while pane id, pty pid and cwd hold; retry `absent` and `failed` every rebuild; evict against the live pane set (D8).
    5. Retain last-proven identity across a `failed` outcome and append a degradation carrying the first-failure epoch (D10).
    6. Key rows `window:<paneId>`; restart the agent-lifetime timestamps on an identity-epoch change but not on a source upgrade, and quantize `lastActivityAt` to whole seconds (D11).
    7. Expose `rank(worktreeId)` as the newest `lastActivityAt` across that worktree's rows, absent before any projection (D12).
    8. Cover every spec scenario, plus: a rebuild whose panes resolve across a TTL boundary still reading once, an agent appearing in a pane that previously resolved to none, and a failed source flipping nothing to a less active state.

## 3. Wiring

- [x] 3_1 Publish presence with the tree, coalesced and never out of order — verified: pnpm exec vitest run 'src/providers/WorktreeHost.presence.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_3
  - **Refs**: specs/worktree-agent-presence/spec.md#{presence-is-published-with-the-tree-it-describes, a-pane-s-activity-expires-without-further-evidence, worktrees-rank-by-their-newest-agent-activity}, specs/worktree-tree-protocol/spec.md#a-push-never-replaces-newer-published-state-with-older <!-- design.md D3, D12 -->
  - **Acceptance**:
    - Outcome: a pane change publishes fresh presence with the tree, once per burst and never stale
    - Verify: unit src/providers/WorktreeHost.presence.test.ts
  - **Plan**:
    1. In `src/providers/WorktreeHost.ts`, take an optional projector and a pane-change subscription; the first change arms a 150 ms cap that later changes do not push out (D3.1).
    2. Make projection single-flight — a change arriving mid-projection marks dirty and re-runs after — and stamp a monotonic publish generation, discarding any result whose generation moved before broadcast (D3.4).
    3. A presence rebuild reads the cached tree and broadcasts both halves on the existing `worktreeTreeResponse`; it bypasses `rebuildGate`'s floor but not publication ordering.
    4. Recompute presence before every git-rebuild broadcast, and pass `rank` into the discovery deps handed to `buildWorktreeTreeDetailed` and `cache.applyRepo` (D12).
    5. Cover: a burst producing one push, a continuous stream bounded rather than pushing per flush, a slow presence job interleaved with a git rebuild leaving the newer state, a host with no projector behaving exactly as today, and disposal cancelling a pending rebuild.

- [x] 3_2 Bind the projection to the real window — verified: pnpm exec vitest run 'src/worktree/presenceDeps.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1, 3_1
  - **Refs**: specs/worktree-agent-presence/spec.md#{attribute-a-pane-to-exactly-one-worktree, a-presence-rebuild-reads-each-shared-source-once} <!-- design.md D1, D8, D9 -->
  - **Acceptance**:
    - Outcome: the window's real panes, evidence and session resolution reach the projector
    - Verify: unit src/worktree/presenceDeps.test.ts
  - **Plan**:
    1. Add `src/worktree/presenceDeps.ts` assembling the projector dependencies from a `PaneEvidenceStore`, following the `src/worktree/worktreeDeps.ts` pattern of one production wiring site.
    2. Bind the resolution to `resolveClaudeSession` with its descendant lookup and its `listRunning` both served from the rebuild snapshot, so one rebuild reads each once (D9).
    3. In `src/extension.ts`, construct the snapshot and projector, pass them to `createWorktreeHost`, and subscribe the host to the store through `createPaneEvidenceStore`'s change callback.
    4. Cover panes enumerated with their view, cwd, pty pid, launch flag and shell; a pane with no cwd omitted; and one process-table read plus one registry read across a multi-pane resolution.

## 4. Review fixes

- [x] 4_1 Serialize projection, pin the process table, and name the rule that decided — verified: pnpm exec vitest run 'src/providers/WorktreeHost.presence.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_2
  - **Refs**: .reviews/round-1.md#{b1, b2, w1, w2, s1, s2}, specs/worktree-agent-presence/spec.md#{presence-is-published-with-the-tree-it-describes, a-presence-rebuild-reads-each-shared-source-once, qualify-identity-and-activity-independently}, specs/worktree-tree-protocol/spec.md#a-push-never-replaces-newer-published-state-with-older <!-- design.md D3, D6, D9 -->
  - **Acceptance**:
    - Outcome: one projection at a time, against one process-table read, reporting the rule that produced each activity
    - Verify: unit src/providers/WorktreeHost.presence.test.ts
  - **Plan**:
    1. In `src/providers/WorktreeHost.ts`, route the rebuild path and the pane path through one projection coordinator so the stateful projector is never entered twice at once (B1).
    2. Version the cached tree on every cache write instead of on every delivery attempt; a projection whose version moved re-runs instead of being dropped, and a skipped or cached broadcast supersedes nothing (B1).
    3. In `src/pty/processTableSnapshot.ts`, add a pinned reading — one table taken once, every lookup derived from it — and take it once per rebuild in `src/worktree/presenceDeps.ts` (B2).
    4. Memoize transcript path + mtime per snapshot, and extract the shared reader into `src/vault/readers/claudePaths.ts`, re-export it from `src/vault/readers/claudeReader.ts`, and call it from `presenceDeps.ts` and both `src/providers/TerminalViewProvider.ts` and `src/providers/TerminalEditorProvider.ts` (W1, S2).
    5. Report the winning rule from the shared projection in `src/shared/paneEvidence.ts`, expose it on `src/session/PaneEvidenceStore.ts`, and map it to `activitySource` in `src/worktree/presenceProjector.ts` so a pane that was idle anyway is not credited to its title (W2).
    6. Move `classifyTitle` into `src/shared/paneEvidence.ts` and call it from both the store and `src/webview/terminal/TerminalActivityTracker.ts` (S1).
    7. Cover, across `src/providers/WorktreeHost.presence.test.ts`, `src/pty/processTableSnapshot.test.ts`, `src/worktree/presenceDeps.test.ts`, `src/worktree/presenceProjector.test.ts`, `src/shared/paneEvidence.test.ts` and `src/session/PaneEvidenceStore.test.ts`: a rebuild completing while a pane projection is out, a cached tree request during a projection, a projection crossing the process-table TTL between two panes, one transcript stat across many panes, and an idle pane with a shell title that had no work to overrule.

- [x] 4_2 Publish tree and presence as one committed envelope, and bound the registry scan — verified: pnpm exec vitest run 'src/providers/WorktreeHost.presence.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_1
  - **Refs**: .reviews/round-2.md#{b1, w1, w3}, specs/worktree-agent-presence/spec.md#{presence-is-published-with-the-tree-it-describes, a-presence-rebuild-reads-each-shared-source-once}, specs/worktree-tree-protocol/spec.md#a-push-never-replaces-newer-published-state-with-older <!-- design.md D3, D9 -->
  - **Acceptance**:
    - Outcome: every delivery carries a tree and the presence projected against that same tree, published once
    - Verify: unit src/providers/WorktreeHost.presence.test.ts
  - **Plan**:
    1. In `src/providers/WorktreeHost.ts`, hold one committed envelope — tree plus the presence projected against that tree version — and serve every delivery path from it rather than from the live cache (B1).
    2. Make the coordinator the only thing that commits and the only thing that publishes: it commits after its final clean iteration, and no caller attaches a broadcast to it (B1, W3).
    3. In `src/vault/readers/runningSessions.ts`, index the live registry by pid and by cwd, dropping headless entries once; take `src/session/resolveClaudeSession.ts` off the raw list and onto the index, and build it once per snapshot in `src/worktree/presenceDeps.ts` (W1).
    4. Update the callers in `src/providers/TerminalViewProvider.ts` and `src/providers/TerminalEditorProvider.ts`.
    5. Cover, across `src/providers/WorktreeHost.presence.test.ts`, `src/vault/readers/runningSessions.test.ts`, `src/session/resolveClaudeSession.test.ts` and `src/worktree/presenceDeps.test.ts`: a cached tree request mid-rebuild, a surface becoming displayed mid-rebuild, two callers joining one projection cycle, and one registry index across many panes.

- [x] 4_3 Close the first-build delivery window, the pid tie-break, and the failed-cycle publish — verified: pnpm exec vitest run 'src/providers/WorktreeHost.presence.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_2
  - **Refs**: .reviews/round-3.md#{b1, w4, w5}, specs/worktree-agent-presence/spec.md#presence-is-published-with-the-tree-it-describes, specs/worktree-tree-protocol/spec.md#a-push-never-replaces-newer-published-state-with-older <!-- design.md D3 -->
  - **Acceptance**:
    - Outcome: a projector-backed host delivers only committed envelopes, and a failed projection publishes nothing
    - Verify: unit src/providers/WorktreeHost.presence.test.ts
  - **Plan**:
    1. In `src/providers/WorktreeHost.ts`, refuse delivery while a projector-backed host has committed no envelope, and have a cached tree request in that window request the projection rather than publish (B1).
    2. Commit only after a clean successful iteration; a caller that joined a failed run gets a re-run instead of a resolved promise and abandoned work (W5).
    3. In `src/vault/readers/runningSessions.ts`, key pid to an array so two records claiming one pid both reach the mtime tie-break, as they did before the index (W4).
    4. Cover, across `src/providers/WorktreeHost.presence.test.ts` and `src/vault/readers/runningSessions.test.ts`: a cached request and a newly displayed surface during the first build, a failed pane-only projection, a rebuild joining a failed run, and two registry records claiming one pid.
