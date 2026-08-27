# Review Round 1: upgrade-turn-state-presence

**Date**: 2026-08-27
**Cycle**: 1
**Mode**: discovery
**Scope**: commit `b7116a567b418aff4abd53894333f6ce02a2bae7` only
**Head**: `b7116a567b418aff4abd53894333f6ce02a2bae7`
**Tree state**: dirty at review time (`.analytics-cursor.json`, `analytics.json`); explicit commit scope was unaffected
**Reviewable lines**: 719
**Agents spawned**: data-security — reported identity/path safety — `gpt-5.6-sol[1M]`; logic — Claude reducer/state machine — `gpt-5.6-terra[1M]`; contracts — payload and turn/presence contracts — `sonnet[1M]`; frontend — projector/host/webview behavior — `gpt-5.6-terra[1M]`; performance — roster/cache/timer growth — `gpt-5.6-luna[1M]`; reuse — resolver/helper reuse — `gpt-5.6-luna[1M]`
**Agents skipped**: none; all six lenses were warranted by the cross-layer state, identity, rendering, and growth surfaces
**Verdict**: **REJECT**
**Counts**: 6 BLOCK, 6 WARN, 0 SUGGEST

## Gate and context

- Gate 2 is approved in `workflow.md`; D1–D6, task Acceptance/Boundary/Refs, the delta spec, and the project design anchors were treated as obligations.
- Recorded Verify Gate evidence: `bun run asm change verify-status upgrade-turn-state-presence` reports tasks 1_0 through 4_1 at `[x]`, exit 0. No project verify command was run during review. The source nevertheless contains an undeclared class property at `claude.ts:168`, so the recorded check-types claim and the reviewed commit do not agree.
- Deliberate decisions D1, D2, and D6 were preserved: the 2-second correlation window was not reopened; expired turn records remain for identity; interrupt state is read only when supplied and is not synthesized.

## Risk map and full-flow trace

- Highest risk: truthfulness of the reducer's lead/child state, reported identity proof, session-boundary completion semantics, and bounded roster/cache behavior.
- Medium risk: freshness/revocation transitions, live-roster precedence, prompt contract, and the webview's rendering of newly live rows.
- Flow traced: authenticated hook POST → Claude payload decoder → reducer and structural publication dedup → extension `onStatus` → pane turn evidence and freshness timer → reported identity resolution plus activity precedence → WorktreeHost roster merge → render signature and worktree row/subagent rendering.
- Process-reality guards are present for pty exit and shell-title reclaim. Pane, view, and manager teardown all cancel turn timers and delete the turn record. The blocking defects are in compilation, state-machine convergence, overflow truthfulness, identity comparison, boundary completion, and cache growth.

## Findings

### B1

- **ID**: B1
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-logic` and `asm-review-contracts` (corroborated by chair)
- **File:line**: `src/agentHooks/agents/claude.ts:168`
- **Title**: Undeclared `seen` property breaks the typed build
- **Evidence**: `ClaudeHookAgentSession.handle()` assigns `this.seen = true`, but the class declares no `seen` member and no code reads one. TypeScript reports `Property 'seen' does not exist on type 'ClaudeHookAgentSession'`.
- **Impact**: The reviewed commit cannot pass its claimed TypeScript check or produce a typed build.
- **SuggestedFix**: Remove the assignment. If a seen flag is actually required, declare it and make its behavior explicit and tested.
- **Status**: new
- **Triage**: untriaged

### B2

- **ID**: B2
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-data-security` and `asm-review-contracts` (corroborated by chair)
- **File:line**: `src/worktree/presenceProjector.ts:456`
- **Title**: Reported transcript-path mismatch is never rejected
- **Evidence**: `reportedIdentity()` resolves the reported session id, receives the vault-owned `entry.transcriptPath`, and immediately grants hook identity without comparing it to `pane.turn.report.transcriptPath`. The new test supplies `/etc/passwd` against `/vault/sess-1.jsonl` and still expects the hook entry id, encoding the opposite of §4.6 and task 3_3.
- **Impact**: A stale or inconsistent session-id/path pair can claim an existing vault session, suppress its external row, and attach the wrong entry id to the pane. The path does not steer a read, but the required identity proof is absent.
- **SuggestedFix**: When a reported path is present, compare it with the vault-owned path using the repository's path equality rules; on mismatch, discard the hook identity and use normal heuristics. Keep id-only resolution when the path is absent.
- **Status**: new
- **Triage**: untriaged
- **Invariant inventory**: Reported identity must be proved only by vault-owned state. Boundaries searched: id lookup, path comparison, entry creation, filesystem read, external-row claiming, stale identity. Affected: path comparison and downstream claim/entry assignment. Verified safe: unknown ids create nothing; the reported path is not passed to the filesystem resolver or opened directly.

### B3

- **ID**: B3
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-logic` (corroborated by chair)
- **File:line**: `src/agentHooks/agents/claude.ts:229`
- **Title**: A child start overwrites the cached lead state
- **Evidence**: `SubagentStart` changes `lead` from `done` to `working`. For a child-only sequence `SubagentStart(a)` → `SubagentStop(a)`, the roster becomes empty but `lead` remains `working`. §4.4 requires subagent events to change the roster only and re-emit the cached lead state; the effective-state gate already has the mechanism to hold a done lead open while children work.
- **Impact**: A delegation that starts and finishes without a preceding lead event leaves the pane authoritatively running until staleness or process evidence overrides it.
- **SuggestedFix**: Never mutate `lead` in `SubagentStart`; retain the cached lead and let `effectiveState()` return working while the roster contains a working child.
- **Status**: new
- **Triage**: untriaged
- **Invariant inventory**: Child events may overlay but must not rewrite cached lead state. Boundaries searched: child-only start/stop, lead-first stop order, child-first stop order, duplicate start/stop, unknown child stop, session boundary. Affected: child-only start/stop. Verified safe: the tested lead-established stop orders and unknown-child stop.

### B4

- **ID**: B4
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-logic` (corroborated by `asm-review-performance` and chair)
- **File:line**: `src/agentHooks/agents/claude.ts:252`
- **Title**: Roster eviction can falsely complete a turn
- **Evidence**: At the cap, `upsertChild()` deletes the oldest still-working child. With 33 child starts, then lead `Stop`, then stops for the 32 retained children, the roster becomes empty and the reducer publishes `done` although the evicted child was reported working and never stopped. The test checks only the length cap, not the completion invariant after overflow.
- **Impact**: The status pipeline can claim completion while known delegated work may still be running, directly violating the central truthfulness guard.
- **SuggestedFix**: Preserve a bounded overflow/unknown-working state that conservatively holds the turn open until an authoritative reset such as `SessionStart`, or use another bounded representation that never treats evicted active children as completed.
- **Status**: new
- **Triage**: untriaged
- **Invariant inventory**: Any reported working child holds a done lead open. Boundaries searched: below-cap roster, exact cap, cap+1 distinct ids, lead stop, retained-child stops, evicted-child stop, session reset. Affected: overflow, later stops, and completion. Verified safe: distinct children at or below the cap and duplicate ids.

### B5

- **ID**: B5
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `chair`
- **File:line**: `src/worktree/presenceProjector.ts:500`
- **Title**: A session boundary is stamped as a completed turn
- **Evidence**: The reducer publishes `sessionBoundary: true`, but the projector never reads it. `readActivity()` maps the report's `done` to idle and passes only activity/prompt/roster onward; `stamp()` then sets `finishedAt` whenever a running or waiting row settles to idle. A `SessionStart` after work therefore receives a fresh completion timestamp even though the approved contract says resume, clear, and post-compact boundaries are not completed turns.
- **Impact**: The panel labels a resumed, cleared, or compacted session as having just finished, producing the exact false completion the boundary flag exists to prevent.
- **SuggestedFix**: Carry `sessionBoundary` through the reported projection result and suppress completion stamping for that transition; add projector coverage starting from running/waiting and applying a boundary report.
- **Status**: new
- **Triage**: untriaged
- **Invariant inventory**: Session boundaries may land idle but must never manufacture completion. Boundaries searched: reducer flag creation/clearing, turn-to-activity mapping, state timestamping, finished timestamping, age rendering. Affected: projector stamping and the rendered age. Verified safe: roster reset and flag clearing on the following ordinary event.

### B6

- **ID**: B6
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-performance` (corroborated by chair)
- **File:line**: `src/worktree/presenceDeps.ts:51`
- **Title**: Reported-session cache grows for the entire window lifetime
- **Evidence**: `reportedSessions` retains one promise for every distinct reported session id and has no cap, TTL, membership cleanup, or eviction. The growth axis is distinct session ids encountered during a VS Code window lifetime, not live panes; closed panes and old sessions leave entries behind. Null lookups are also retained forever, so a session that appears after the first miss cannot sharpen to hook identity.
- **Impact**: Long-lived windows accumulate memory monotonically with session history and can preserve stale absence for the rest of the window.
- **SuggestedFix**: Bound the cache by active pane/session membership or a hard LRU/TTL while retaining in-flight promise sharing. Do not permanently cache misses; allow later projections to observe a newly created vault entry.
- **Status**: new
- **Triage**: untriaged
- **Invariant inventory**: Cache cost must be bounded by live structure, and absence must remain retryable. Boundaries searched: positive lookup, negative lookup, concurrent lookup sharing, pane deletion, session change, window lifetime. Affected: distinct historical ids, deleted panes, and first-miss-then-created sessions. Verified safe: repeated resolution of one positive id shares one promise.

### W1

- **ID**: W1
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `asm-review-frontend` (corroborated by chair)
- **File:line**: `src/worktree/presenceProjector.ts:92`
- **Title**: An empty fresh roster lets transcript history reappear
- **Evidence**: `reportedDelegations()` returns `undefined` when a fresh report lists zero children. `WorktreeHost` interprets undefined as permission to attach its cached transcript roster. The added test explicitly accepts this even though task 3_2 says transcript rows are the fallback where no report exists.
- **Impact**: A pane with a fresh hook report saying no delegation is running can still display old transcript-derived delegations, so fresh roster evidence does not consistently supersede history.
- **SuggestedFix**: Represent a fresh empty roster as `{ kind: "ok", reported: true, rows: [] }` and let the host preserve it.
- **Status**: new
- **Triage**: untriaged

### W2

- **ID**: W2
- **Severity**: WARN
- **Confidence**: MEDIUM
- **Priority**: P2
- **Agent**: `asm-review-contracts` (corroborated by chair)
- **File:line**: `src/agentHooks/agents/claude.ts:200`
- **Title**: Interactive prompt reports discard the content their contract names
- **Evidence**: AskUserQuestion always publishes `{questions:null}` and PermissionRequest publishes `{approval:{tool}}` with no `summary`. The decoder never reads question/tool-input content, so the accepted `{questions: …}` and `{approval:{tool,summary}}` shapes can never be populated.
- **Impact**: Consumers built to the approved prompt contract receive permanent stubs or missing fields rather than the reported question/approval context.
- **SuggestedFix**: Decode and bound the relevant tool input/question and permission summary fields before serializing the documented shapes, with malformed-input tests. If content capture is truly deferred, align the accepted design explicitly rather than silently narrowing the contract.
- **Status**: new
- **Triage**: untriaged

### W3

- **ID**: W3
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `asm-review-frontend` (corroborated by chair)
- **File:line**: `src/worktree/presenceProjector.ts:101`
- **Title**: Live hook rosters still render as “Past delegations”
- **Evidence**: The projector now emits `live: true`, but the worktree subagent renderer ignores `live`, always labels the section “Past delegations,” and uses history/outcome styling. The delegation render signature also omits both `live` and the roster's `reported` discriminator, so an otherwise identical history→live transition can be guarded out.
- **Impact**: The panel exposes the new live roster with historical semantics, hiding the distinction WT-006.3 introduced and potentially retaining the old rendered row when only evidence provenance changes.
- **SuggestedFix**: Render reported/live rosters with live vocabulary and accessible state, keep transcript rows historical, and include `reported` and `live` in the delegation signature. Add a webview test for a history→live transition with otherwise identical child fields.
- **Status**: new
- **Triage**: untriaged

### W4

- **ID**: W4
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `asm-review-logic` (corroborated by chair)
- **File:line**: `src/agentHooks/agents/claude.ts:63`
- **Title**: Empty required identifiers are accepted as valid state
- **Evidence**: `boundedString("")` returns an empty string. An empty `session_id` passes decoding, and a `SubagentStart` with empty `agent_id` creates a working roster entry keyed by `""`.
- **Impact**: Malformed partial payloads can invent active delegated work or carry unusable identity instead of degrading to no state claim.
- **SuggestedFix**: Require non-empty values for `session_id` and event-required `agent_id`; reject the payload or ignore the affected event when they are empty.
- **Status**: new
- **Triage**: untriaged

### W5

- **ID**: W5
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `asm-review-performance` (corroborated by chair)
- **File:line**: `src/worktree/presenceProjector.ts:639`
- **Title**: Reported panes still run the full inference path first
- **Evidence**: `projectPanes()` always awaits `identify()` before `reportedIdentity()`, even though a resolved hook identity is supposed to replace heuristics. This performs process/registry/session work for every reported pane and can record inference degradation that is irrelevant to the identity ultimately chosen.
- **Impact**: The 150 ms projection path pays both identity costs per reported pane and may surface degradation from a fallback that did not decide the row.
- **SuggestedFix**: Resolve the reported identity first and invoke `identify()` only when the report is absent, invalid, or unresolved.
- **Status**: new
- **Triage**: untriaged

### W6

- **ID**: W6
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `chair`
- **File:line**: `src/extension.ts:420`
- **Title**: Claude authority revocation does not expire the pane's fresh turn
- **Evidence**: The runtime publishes `state: null` when an agent is disabled, a session is replaced, or authority is released. The new extension branch records only non-null objects; every Claude null update then hits `update.agent !== "cursor"` and returns. `PaneEvidenceStore` therefore keeps the old turn authoritative until its original 60-second deadline. The new assembly test locks in this behavior by expecting the working turn to remain after `runtime.release()`.
- **Impact**: Disabling or replacing Claude hook authority can leave a waiting/running row, prompt, and live roster authoritative after the source has been revoked, instead of immediately falling back to inference.
- **SuggestedFix**: Handle Claude null publication by expiring the turn's activity authority immediately while retaining its identity record per D2; announce the projection change and cancel/reconcile the freshness timer. Cover disable and session replacement, not only pane destruction.
- **Status**: new
- **Triage**: untriaged

---

## Triage (author, round 1)

Every finding below was checked against the code and the governing artifact before a status
was set. Authorities cited: `docs/design/agent-hook-server.md` § 4.4–4.6, this change's
`specs/worktree-agent-presence/spec.md`, and `design.md`.

### B1 — Undeclared `seen` property
**Status:** accepted
**Triage:** Confirmed. `pnpm run check-types` fails: `claude.ts(168,10): error TS2339`. My
recorded type-check evidence was wrong — the gate command was piped into `tail` and the exit
code I read was `tail`'s, not `tsc`'s. Nothing reads the property. Fix: delete the assignment.

### B2 — Reported transcript-path mismatch never rejected
**Status:** accepted
**Triage:** Confirmed against both authorities. § 4.6: "It is compared against the path the
vault store already holds for that session id; a mismatch is dropped." Spec ADDED requirement
"A reported session identity is a lookup key and a reported path is never opened" carries the
mismatch scenario. `reportedIdentity()` resolves the id and returns without ever reading
`report.transcriptPath`; `ReportedSessionEntry.transcriptPath` exists solely for this
comparison and is dead. The 3_3 test encodes the unguarded behaviour and must move.

### B3 — A child start overwrites the cached lead state
**Status:** accepted
**Triage:** Confirmed, and a direct § 4.4 violation. That table's `SubagentStart` /
`SubagentStop` row reads "roster change only — Re-emits the **cached** lead state — never
fabricates lead completion". Promoting `done` → `working` mutates the cached lead, so the
promotion outlives the child that caused it. The overlay already exists in `effectiveState()`;
the mutation is redundant as well as wrong.

### B4 — Roster eviction can falsely complete a turn
**Status:** accepted
**Triage:** Confirmed. Evicting the oldest still-working child at the cap makes the spec
requirement "A turn a delegation is still working on is not a finished turn" unsatisfiable for
that turn. A cap is still required (nothing bounds distinct child ids), so the fix keeps the
bound but stops the bound from being readable as completion.

### B5 — A session boundary is stamped as a completed turn
**Status:** accepted
**Triage:** Confirmed. § 4.5's precedence table has the row "`sessionBoundary` `done` →
Recorded, but does not mark a turn complete", and the spec requirement "A session that resumes
or clears has not completed a turn" is exactly this. The reducer publishes the flag and the
projector never reads it, so the requirement has no implementation. This is the finding the
PLAN's "status pipeline starts lying" note predicts.

### B6 — Reported-session cache unbounded, misses cached forever
**Status:** accepted
**Triage:** Confirmed. Growth axis is distinct session ids seen by the window, not live panes,
so it is unbounded per the build skill's data-scale rule. The permanent negative entry is the
worse half: a pane that reports before its vault file is written can never resolve afterwards.

### W1 — Empty fresh roster lets transcript history reappear
**Status:** accepted (fix with W3)
**Triage:** Confirmed. `reportedDelegations()` returns `undefined` for an empty roster, so the
`reported` guard in `WorktreeHost.withDelegations` does not engage and cached transcript rows
are reattached. My design comment justified `undefined` as "never read", but a fresh report
listing no children IS a read that found none.

### W2 — Interactive prompt reports discard required content
**Status:** accepted
**Triage:** § 4.4 documents the two shapes as `{questions: …}` and
`{approval: {tool, summary}}`. I emit `{questions: null}` and omit `summary` entirely, so the
shape is honoured and the content is not. Decoding bounded content from `tool_input` is inside
the accepted contract, so this is a fix rather than a handback.

### W3 — Live rosters still render as "Past delegations"
**Status:** accepted
**Triage:** Confirmed, and it is what makes W1 user-visible. The MODIFIED spec requirement
turns on the live/not-live distinction; the projector emits `live` and the renderer discards
it. The render signature omitting `live` and `reported` is separately a correctness bug: a
transition that changes only provenance is guarded out and never repaints.

### W4 — Empty required identifiers accepted
**Status:** accepted
**Triage:** Confirmed. `boundedString("")` returns `""`, which is truthy for the
`!== undefined` guards. An empty `agent_id` creates a roster entry, which is invented
delegated work — the failure class this task exists to prevent.

### W5 — Reported panes still execute inference first
**Status:** accepted
**Triage:** Confirmed. `identify()` is awaited unconditionally before `reportedIdentity()`.
Beyond the wasted `ps` resolution, a degradation recorded by the losing path is attributed to
a row it did not decide.

### W6 — Revocation does not expire a fresh Claude turn
**Status:** accepted
**Triage:** Confirmed. My `extension.ts` hunk returns early only for object states, so a
`null` publication from Claude falls through to the `update.agent !== "cursor"` guard and is
dropped. D2 makes expiry a change of authority, and revocation is a stronger signal than the
60s deadline it currently waits for. The 4_1 test encodes the wrong behaviour and must move.

**Summary:** 6 BLOCK accepted, 6 WARN accepted, 0 rebutted. No finding requires reopening an
accepted spec or design decision, so this stays in the fix loop rather than handing back to
`asimov-plan`. Two inherited-from-this-change tests (3_3 mismatch, 4_1 revocation) assert the
behaviour the findings identify as wrong and will be rewritten, declared via `--test-change`.
