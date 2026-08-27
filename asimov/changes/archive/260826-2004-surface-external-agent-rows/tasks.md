## 1. The registry read, typed

- [x] 1_1 Return a typed outcome from the running-session reader and carry the live set on its index — verified: pnpm exec vitest run src/vault/readers/runningSessions.test.ts && pnpm run check-types && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/claude-running-session-map/spec.md#detect-running-claude-sessions; design.md D1, D2
  - **Acceptance**:
    - Outcome: an unreadable registry reports a reason; a missing registry directory reports no sessions
    - Verify: command pnpm exec vitest run src/vault/readers/runningSessions.test.ts && pnpm run check-types
  - **Plan**:
    1. `src/vault/readers/runningSessions.ts` — add `RunningSessionsOutcome`, return it from `listRunningClaudeSessions`, split `ENOENT` from every other `readdir` error, add `all()` to `indexRunningSessions`
    2. `src/providers/TerminalEditorProvider.ts`, `src/providers/TerminalViewProvider.ts` — unwrap the outcome at the `runningIndex` binding; a failed read indexes an empty set, which is what these two already did
    3. The type check in Verify is the gate that proves all three consumers moved — the reader's own suite cannot see them

- [x] 1_2 Carry the failing source on an inconclusive session lookup — verified: pnpm exec vitest run 'src/worktree/agentIdentity.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-agent-presence/spec.md#an-unreadable-registry-is-not-an-empty-one; design.md D7
  - **Acceptance**:
    - Outcome: a failed lookup names the source that failed rather than defaulting to the pane
    - Verify: unit src/worktree/agentIdentity.test.ts
  - **Plan**:
    1. `src/worktree/agentIdentity.ts` — add `source` to `SessionLookup`'s failed arm and propagate it into the `failed` identity outcome
    2. `src/worktree/presenceDeps.ts` — name `panes` at the process-table failure site, which is the source it already meant

- [x] 1_3 Expose this rebuild's indexed sessions on the snapshot and type its failure through — verified: pnpm exec vitest run 'src/worktree/presenceDeps.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1, 1_2
  - **Refs**: design.md D2, D7
  - **Acceptance**:
    - Outcome: one registry read serves pane resolution and the external pass, failure included
    - Verify: unit src/worktree/presenceDeps.test.ts
  - **Plan**:
    1. `src/worktree/presenceProjector.ts` — add `sessions()` to `ResolutionSnapshot`
    2. `src/worktree/presenceDeps.ts` — resolve `sessions()` from the single `running` promise, yielding `index.all()` on success
    3. `src/worktree/presenceDeps.ts` — return a `registry`-sourced failed lookup from `resolve` when that read failed, before any pane fallback runs

## 2. External rows

- [x] 2_1 Resolve every pane before attribution decides which ones produce rows — verified: pnpm exec vitest run 'src/worktree/presenceProjector.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_3
  - **Refs**: specs/worktree-agent-presence/spec.md#a-registry-session-this-window-already-accounts-for-produces-no-row; design.md D3
  - **Acceptance**:
    - Outcome: a pane inside no worktree still claims its session, so nothing else can
    - Verify: unit src/worktree/presenceProjector.test.ts
  - **Plan**:
    1. `src/worktree/presenceProjector.ts` — move the cwd and attribution guards after `identify`, collect the claimed entry ids, and emit a row only for an attributed pane

- [x] 2_2 Project live registry sessions as external rows under their worktree — verified: pnpm exec vitest run 'src/worktree/presenceProjector.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: specs/worktree-agent-presence/spec.md#{surface-agents-running-outside-this-window, a-registry-session-this-window-already-accounts-for-produces-no-row}; design.md D5
  - **Acceptance**:
    - Outcome: a live session in a worktree appears once, marked external, never duplicating a pane row
    - Verify: unit src/worktree/presenceProjector.test.ts
  - **Plan**:
    1. `src/worktree/presenceProjector.ts` — attribute each session's cwd through the same `normalize` + `attribute` path and drop the claimed and the unattributable
    2. `src/worktree/presenceProjector.ts` — emit rows by the D5 table, sorted by `rowId`, contributing to the same rank map the window pass feeds
    3. `src/worktree/presenceProjector.ts` — keep per-`rowId` first-seen state, evicted against the session set of a successful read only

- [x] 2_3 Retain external rows and name the registry when the read fails — verified: pnpm exec vitest run 'src/worktree/presenceProjector.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_2
  - **Refs**: specs/worktree-agent-presence/spec.md#an-unreadable-registry-is-not-an-empty-one; design.md D4
  - **Acceptance**:
    - Outcome: a failed registry read keeps the last external rows and reports the registry as degraded
    - Verify: unit src/worktree/presenceProjector.test.ts
  - **Plan**:
    1. `src/worktree/presenceProjector.ts` — hold the last successful indexed session list, replace it on each success, and replay it through the current worktree ids on failure
    2. `src/worktree/presenceProjector.ts` — route `registry` through the existing `failures`/`failingSince` path so its first-failure epoch behaves like `panes`

- [x] 2_4 Add an external-only projection that replays the last window pass — verified: pnpm exec vitest run 'src/worktree/presenceProjector.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_3
  - **Refs**: specs/worktree-agent-presence/spec.md#scan-for-outside-this-window-agents-only-while-the-view-is-shown; design.md D6
  - **Acceptance**:
    - Outcome: an external-only projection reads the registry and resolves no pane
    - Verify: unit src/worktree/presenceProjector.test.ts
  - **Plan**:
    1. `src/worktree/presenceProjector.ts` — accept an external-only option, replay the last full pass's window rows, ranks and pane degradation, and fall back to a full pass when the worktree ids differ from the ones those rows were attributed against

## 3. Publication

- [x] 3_1 Re-rank the cached tree from a committed projection, without reading git — verified: pnpm exec vitest run src/worktree/WorktreeCache.test.ts src/providers/WorktreeHost.presence.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D8
  - **Acceptance**:
    - Outcome: a committed projection reorders the cached worktree groups
    - Verify: command pnpm exec vitest run src/worktree/WorktreeCache.test.ts src/providers/WorktreeHost.presence.test.ts
  - **Plan**:
    1. `src/worktree/WorktreeCache.ts` — add `reorder(rank)`, re-running `orderWorktrees` over each stored group's worktrees
    2. `src/providers/WorktreeHost.ts` — call it after a projection commits its result and before the envelope is published

- [x] 3_2 Poll every 5 seconds while any surface shows the view, and not otherwise — verified: pnpm exec vitest run 'src/providers/WorktreeHost.presence.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_4, 3_1
  - **Refs**: specs/worktree-agent-presence/spec.md#scan-for-outside-this-window-agents-only-while-the-view-is-shown; design.md D6
  - **Acceptance**:
    - Outcome: a worktree view no surface shows issues no polled registry scan
    - Verify: unit src/providers/WorktreeHost.presence.test.ts
  - **Plan**:
    1. `src/providers/WorktreeHost.ts` — export `EXTERNAL_SCAN_INTERVAL_MS`, drive one timer from `some(visible && displayed)` over all attached surfaces, reconciled on visibility, on displayed and on attachment disposal, and cleared in `dispose`
    2. `src/providers/WorktreeHost.ts` — request the external-only projection, joining an in-flight run without marking it dirty and cancelling a pending pane cap the poll already covers

## 4. Review round 1 fixes

- [x] 4_1 Never let the scan swallow pane evidence — verified: pnpm exec vitest run 'src/providers/WorktreeHost.presence.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_2
  - **Refs**: design.md D6
  - **Acceptance**:
    - Outcome: a scan absorbing a pending pane cap projects the panes it absorbed
    - Verify: unit src/providers/WorktreeHost.presence.test.ts
  - **Plan**:
    1. `src/providers/WorktreeHost.ts` — a pending cap makes the scan's request a full projection, and a request carrying pane evidence never joins an in-flight run as external-only

- [x] 4_2 Let a successful registry read clear its own degradation, and refuse a record that cannot name a session — verified: pnpm exec vitest run 'src/worktree/presenceProjector.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_3
  - **Refs**: specs/worktree-agent-presence/spec.md#an-unreadable-registry-is-not-an-empty-one; design.md D4, D5
  - **Acceptance**:
    - Outcome: the registry stops being named degraded as soon as it reads again
    - Verify: unit src/worktree/presenceProjector.test.ts
  - **Plan**:
    1. `src/worktree/presenceProjector.ts` — replay only the failures a pass did not re-check; the registry's own outcome owns its entry
    2. `src/worktree/presenceProjector.ts` — extract one `externalRowId(sessionId)` used by both row creation and eviction
    3. `src/vault/readers/runningSessions.ts` — require a non-empty `sessionId` and an absolute `cwd` before a record becomes a session

## 5. Review round 2 fixes

- [x] 5_1 Hold pane evidence until a full projection has actually succeeded, and rerank only on a delta — verified: pnpm exec vitest run 'src/providers/WorktreeHost.presence.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_1
  - **Refs**: design.md D6, D8
  - **Acceptance**:
    - Outcome: a full projection that rejects leaves the next scan in full mode
    - Verify: unit src/providers/WorktreeHost.presence.test.ts
  - **Plan**:
    1. `src/providers/WorktreeHost.ts` — a durable pane-evidence flag, set at the pane event and cleared only when a full projection completes cleanly; the scan reads it to pick its mode
    2. `src/worktree/presenceProjector.ts` — report whether the projection moved the ranking, comparing the map it just built against the retained one
    3. `src/providers/WorktreeHost.ts` — reorder the cache only when that report says the ranking moved

- [x] 5_2 Refuse a registry record whose filename disagrees with its payload — verified: pnpm exec vitest run 'src/vault/readers/runningSessions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_2
  - **Refs**: specs/claude-running-session-map/spec.md#detect-running-claude-sessions; design.md D1
  - **Acceptance**:
    - Outcome: a pid file whose stem names a different process than its payload is skipped
    - Verify: unit src/vault/readers/runningSessions.test.ts
  - **Plan**:
    1. `src/vault/readers/runningSessions.ts` — require the numeric filename stem to equal the payload pid before the liveness probe; the list-valued `byPid` index stays as defence in depth

## 6. Review round 3 fixes — the acknowledgement model

- [x] 6_1 Retire pane evidence and the rank delta only when the consumer that applied them says so — verified: pnpm exec vitest run src/providers/WorktreeHost.presence.test.ts src/worktree/presenceProjector.test.ts && pnpm run check-types && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 5_1
  - **Refs**: design.md D11, D12
  - **Acceptance**:
    - Outcome: evidence stays outstanding until the pass that applied it says so
    - Verify: command pnpm exec vitest run src/providers/WorktreeHost.presence.test.ts src/worktree/presenceProjector.test.ts && pnpm run check-types
  - **Plan**:
    1. `src/providers/WorktreeHost.ts` — replace the pane-evidence boolean with the counter and applied marker, captured before `project()` and raised only on a clean uninvalidated full pass; the scan compares the two to pick its mode
    2. `src/worktree/presenceProjector.ts` — replace `ranksMoved()` with a monotonic `rankRevision()`, advanced when a projection's ranking differs from the one it replaces
    3. `src/providers/WorktreeHost.ts` — hold `appliedRankRevision`, advanced only after `reorder`, and re-rank on a difference
    4. `src/providers/WorktreeHost.presence.test.ts`, `src/worktree/presenceProjector.test.ts` — the two timing regressions round 3 named (evidence arriving mid-pass; an invalidated projection interleaved with a rebuild), the real projector's revision on rank gain, loss, movement and unchanged reproduction, and a two-repository rebuild proving a partial write cannot acknowledge another repository's order

## 7. Review round 4 fixes

- [x] 7_1 Let a reordered tree still replay, instead of paying for a pane pass — verified: pnpm exec vitest run 'src/worktree/presenceProjector.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 6_1
  - **Refs**: design.md D6, D12
  - **Acceptance**:
    - Outcome: a poll after a reorder resolves no panes
    - Verify: unit src/worktree/presenceProjector.test.ts
  - **Plan**:
    1. `src/worktree/presenceProjector.ts` — compare the replay guard's worktree ids as membership, not by position

- [x] 7_2 Trust a registry record's session id and launch time only as far as they can be checked — verified: pnpm exec vitest run 'src/vault/readers/runningSessions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 6_1
  - **Refs**: specs/claude-running-session-map/spec.md#detect-running-claude-sessions; design.md D1, D7
  - **Acceptance**:
    - Outcome: a record naming an unusable session or an impossible launch time cannot become a row
    - Verify: unit src/vault/readers/runningSessions.test.ts
  - **Plan**:
    1. `src/vault/readers/runningSessions.ts` — require the canonical session-id guard rather than a non-empty string, and accept `startedAt` only when finite and non-negative
    2. `src/vault/readers/runningSessions.ts` — one named conversion from outcome to index, for the callers that have no failure to propagate
    3. `src/providers/TerminalEditorProvider.ts`, `src/providers/TerminalViewProvider.ts`, `src/worktree/presenceDeps.ts` — use it; `presenceDeps` keeps the outcome itself for D7
