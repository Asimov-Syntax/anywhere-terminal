# Tasks: upgrade-turn-state-presence

## 1. The reducer

- [x] 1_0 Correlate duplicate posts by arrival, not by content alone — verified: pnpm exec vitest run 'src/agentHooks/AgentHookRuntime.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Refs**: design.md#d1-a-content-hash-is-not-an-event-identity-so-duplicate-correlation-is-time-bounded, specs/worktree-agent-presence/spec.md#a-repeated-action-is-not-one-action
  - **Boundary**: the digest, the store and its cap stay as they are — only the window changes
  - **Acceptance**:
    - Outcome: an identical body posted after the correlation window is delivered, not dropped
    - Verify: unit src/agentHooks/AgentHookRuntime.test.ts
  - **Plan**:
    1. `src/agentHooks/AgentHookRuntime.ts` — the duplicate window narrows to 2 s, sized to the wrapper's own request timeout
    2. `src/agentHooks/AgentHookRuntime.test.ts` — a twin milliseconds apart is dropped; the same body after the window is delivered; the documented false positive inside the window is pinned as intended

- [x] 1_1 Widen the channel so an agent can publish a turn, not just a word — verified: pnpm exec vitest run 'src/agentHooks/AgentHookRuntime.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_0
  - **Refs**: design.md#d3-the-channel-publishes-a-value-not-a-string-and-cursors-meaning-is-unchanged
  - **Boundary**: one publication path — no second method, and the revocation check stays where it is
  - **Acceptance**:
    - Outcome: a repeat of the currently published turn publishes nothing
    - Verify: unit src/agentHooks/AgentHookRuntime.test.ts
  - **Plan**:
    1. `src/agentHooks/AgentHookRuntime.ts` — `publish` accepts Cursor's string or a structured turn; the drop-a-repeat rule compares structurally
    2. `src/agentHooks/AgentHookRuntime.test.ts` — a repeated structured turn is dropped; Cursor's existing values compare exactly as before

- [x] 1_2 Decode a Claude hook payload into the reported turn — verified: pnpm exec vitest run 'src/agentHooks/agents/claude.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: docs/design/agent-hook-server.md#3-data-model, design.md#interfaces
  - **Boundary**: payload is data — bounded, validated, never executed, and an unknown event is ignored rather than guessed at
  - **Acceptance**:
    - Outcome: a well-formed payload yields a turn carrying every field the reducer reads
    - Verify: unit src/agentHooks/agents/claude.test.ts
  - **Plan**:
    1. `src/agentHooks/agents/claude.ts` — decode the body, validate the fields the reducer reads, drop what does not parse
    2. `src/agentHooks/agents/claude.test.ts` — a well-formed payload of each registered event decodes to its expected fields, bounded; a truncated body and an unknown event name publish nothing

- [x] 1_3 Map events to turn state, and hold a turn open for working children — verified: pnpm exec vitest run 'src/agentHooks/agents/claude.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: docs/design/agent-hook-server.md#44-event--turn-state, design.md#{d1-a-content-hash-is-not-an-event-identity-so-duplicate-correlation-is-time-bounded, d4-both-timestamps-are-minted-here-because-the-payload-carries-none, d6-interrupt-detection-is-not-built-because-the-event-that-would-prove-it-is-not-sent}, specs/worktree-agent-presence/spec.md#{a-turn-a-delegation-is-still-working-on-is-not-a-finished-turn, a-session-that-resumes-or-clears-has-not-completed-a-turn, the-same-turn-reported-twice-is-one-turn}
  - **Boundary**: no counters and no accumulated history — state is a pure function of the event and the current state, and no flag is synthesised from an absent field
  - **Acceptance**:
    - Outcome: a turn with a working delegation still reports working
    - Verify: unit src/agentHooks/agents/claude.test.ts
  - **Plan**:
    1. `src/agentHooks/agents/claude.ts` — the § 4.4 table; roster as a `Map` keyed by reported child id under an explicit cap; `stateStartedAt` advances only on a real change; a session start of any stated cause is a boundary, not a completed turn
    2. `src/agentHooks/agents/claude.test.ts` — every row of the table; the held-open turn and its release; a lead stop and a child stop reaching the same state in either arrival order; the roster at its cap; a duplicate of each event kind changing nothing; an interactive prompt never inheriting across events

## 2. Turn state as evidence

- [x] 2_1 Carry the reported turn as pane evidence, and let its authority expire — verified: pnpm exec vitest run 'src/session/PaneEvidenceStore.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_3
  - **Refs**: design.md#{d2-turn-state-lives-in-the-pane-evidence-store-and-expires-as-authority-rather-than-as-a-record, d4-both-timestamps-are-minted-here-because-the-payload-carries-none}, specs/worktree-agent-presence/spec.md#a-pane-that-is-gone-leaves-no-report-behind
  - **Boundary**: expiry ends the report's authority over activity; it does not delete the report
  - **Acceptance**:
    - Outcome: a report past its window still carries its identity and no longer decides activity
    - Verify: unit src/session/PaneEvidenceStore.test.ts
  - **Plan**:
    1. `src/session/PaneEvidenceStore.ts` — a turn field per pane, set on report, discarded on every pane-destruction path, its authority ageing out on the existing timer while the record stays
    2. `src/session/PaneEvidenceStore.test.ts` — teardown on each path leaves nothing; expiry announces a change rather than deleting the record; a report past the window no longer decides activity but still answers for identity

## 3. The row a user sees

- [x] 3_1 Let a fresh report decide activity, and process reality overrule it — verified: pnpm exec vitest run 'src/worktree/presenceProjector.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: docs/design/agent-hook-server.md#45-turn-state--presence, specs/worktree-agent-presence/spec.md#{a-reported-turn-outranks-inferred-activity-while-it-is-fresh, what-the-process-is-doing-overrides-what-the-agent-reported}
  - **Boundary**: `exited` is never produced from a report — only a dead pty produces it
  - **Acceptance**:
    - Outcome: a pane whose pty exited reports exited whatever it last published
    - Verify: unit src/worktree/presenceProjector.test.ts
  - **Plan**:
    1. `src/worktree/presenceTypes.ts` — the row carries the interactive prompt a waiting turn reported, so there is something for staleness to clear
    2. `src/worktree/presenceProjector.ts` — the § 4.5 precedence, `activitySource: "hook"` when a fresh report decides, prompt cleared when it goes stale
    3. `src/webview/worktree/worktreeRenderSignature.ts`, `src/webview/worktree/worktreeRenderSignature.test.ts` — a changed prompt has to reach the surface, so it joins the signature the guard compares
    4. `src/worktree/presenceProjector.test.ts` — each row of the precedence table, the shell title overruling a published working state, and a stale report's identity surviving beside inferred activity

- [x] 3_2 Report a live roster where the agent reported one — verified: pnpm exec vitest run 'src/providers/WorktreeHost.delegations.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_1
  - **Refs**: docs/design/worktree-agent-presence.md#36-subagent-rows--post-hoc-and-labelled-as-such, specs/worktree-agent-presence/spec.md#delegated-work-is-reported-as-history-never-as-live-work
  - **Boundary**: a subagent carries no pane identity and nests exactly one level
  - **Acceptance**:
    - Outcome: a delegation the agent reported running survives to the published row marked live
    - Verify: unit src/providers/WorktreeHost.delegations.test.ts
  - **Plan**:
    1. `src/worktree/presenceTypes.ts` — `live` widens from the literal `false` a transcript row could only be
    2. `src/worktree/presenceProjector.ts` — a fresh report's roster becomes live rows; children decay with the parent
    3. `src/providers/WorktreeHost.ts` — the post-projection transcript roster no longer overwrites a roster the projector supplied
    4. `src/worktree/presenceProjector.test.ts`, `src/providers/WorktreeHost.delegations.test.ts` — live rows preferred over transcript rows through the host, not only in the projector; a stale parent leaves no live child; transcript rows still used where no report exists

- [x] 3_3 Use a reported identity as a lookup key and never open a reported path — verified: pnpm exec vitest run 'src/worktree/presenceProjector.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_2
  - **Refs**: docs/design/agent-hook-server.md#46-reported-identity-is-a-lookup-key-never-a-path-to-open, specs/worktree-agent-presence/spec.md#a-reported-session-identity-is-a-lookup-key-and-a-reported-path-is-never-opened
  - **Boundary**: no reported value may cause an entry to be created or a path to be read
  - **Acceptance**:
    - Outcome: a reported session id matching no stored entry creates nothing
    - Verify: unit src/worktree/presenceProjector.test.ts
  - **Plan**:
    1. `src/worktree/presenceTypes.ts` — a row may name a report as what identified it, rather than crediting a heuristic that did not
    2. `src/worktree/presenceDeps.ts` — a point-resolution dependency that answers a session id from the vault's own store and returns the path already stored for it
    3. `src/worktree/presenceProjector.ts` — resolve the reported session through it; compare a reported transcript path against the stored one and drop a mismatch
    4. `src/worktree/presenceProjector.test.ts` — an unknown session id, a transcript path that disagrees, and no read of either reported value

## 4. Wiring

- [x] 4_1 Route a published Claude turn into pane evidence — verified: pnpm exec vitest run 'src/extension.worktreeAssembly.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_2, 3_3
  - **Refs**: design.md#d5-the-wiring-seam-is-the-last-task-and-it-is-small-but-not-a-single-line
  - **Boundary**: `src/extension.ts` only — no change to the Cursor branch or to activation ordering
  - **Acceptance**:
    - Outcome: a Claude turn published by the runtime reaches the pane's evidence
    - Verify: unit src/extension.worktreeAssembly.test.ts
  - **Plan**:
    1. Rebase onto the other session's activation-wiring task before editing — it rewrites this file
    2. `src/extension.ts` — the status callback learns the Claude case beside the Cursor one, and the projector deps gain the session resolver 3_3 added
    3. `src/extension.worktreeAssembly.test.ts` — a published turn reaches the row through the real assembly, not a stub; a revocation clears it; a restored pane starts on inference
