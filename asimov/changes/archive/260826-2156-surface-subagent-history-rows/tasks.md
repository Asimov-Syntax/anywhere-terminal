# Tasks: surface-subagent-history-rows

## 1. The shape

- [x] 1_1 Make a row's delegations a typed outcome instead of an optional array — verified: pnpm exec vitest run src/webview/worktree && pnpm run check-types && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-agent-presence/spec.md#a-delegation-roster-that-could-not-be-read-is-not-an-empty-one; design.md D4
  - **Acceptance**:
    - Outcome: an unread roster is distinguishable from an empty one
    - Verify: command pnpm exec vitest run src/webview/worktree && pnpm run check-types
  - **Plan**:
    1. `src/worktree/presenceTypes.ts` — add the roster type and replace the row's optional subagent array with it
    2. `src/webview/worktree/worktreeFixtures.ts`, `src/webview/worktree/WorktreeView.ts`, `src/webview/worktree/worktreeTreeView.ts`, `src/webview/worktree/worktreeViewTypes.ts` — move every reader to the new field, rendering unchanged for the case that already worked
    3. `src/webview/worktree/worktreeRenderSignature.ts`, `src/webview/worktree/worktreeRenderSignature.test.ts` — the signature covers every roster state, so an unread row and an empty one do not render as each other
    4. the render key is where an unread roster and an empty one must differ — a view that cannot tell them apart leaves its reading state on screen after the answer arrived; what each state RENDERS is 3_1's

- [x] 1_2 Turn a session's transcript into a delegation roster — verified: pnpm exec vitest run 'src/worktree/delegations.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-agent-presence/spec.md#delegated-work-is-reported-as-history-never-as-live-work; specs/worktree-agent-presence/spec.md#a-delegation-roster-that-could-not-be-read-is-not-an-empty-one; design.md D5, D6, D7
  - **Acceptance**:
    - Outcome: a read that dropped unrecoverable records reports an incomplete roster rather than a whole one
    - Verify: unit src/worktree/delegations.test.ts
  - **Plan**:
    1. `src/worktree/delegations.ts` — map a session detail to a roster: both delegation item kinds, top level only, never live, absent status becoming unknown, and incompleteness from any of the three signals
    2. `src/worktree/delegations.test.ts` — the mapping, a detail reporting source omission, one reporting only pageability, one whose counted delegations exceed the items it handed over, and a delegation with no child transcript

## 2. The host

- [x] 1_3 Stop a failed child query from reading as a session that delegated nothing — verified: pnpm exec vitest run 'src/vault/readers/opencodeReader.detail.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-agent-presence/spec.md#a-delegation-roster-that-could-not-be-read-is-not-an-empty-one
  - **Acceptance**:
    - Outcome: a session whose child query failed reports source omission
    - Verify: unit src/vault/readers/opencodeReader.detail.test.ts
  - **Plan**:
    1. `src/vault/readers/opencodeReader.ts` — a failed child query reports omission with a reason instead of substituting an empty child list, as every other failed query in that read already does

- [x] 2_1 Read a row's delegations when the view asks, once per row and session — verified: pnpm exec vitest run 'src/providers/WorktreeHost.delegations.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: specs/worktree-agent-presence/spec.md#show-what-an-agent-s-session-delegated; specs/worktree-agent-presence/spec.md#delegated-work-is-reported-as-history-never-as-live-work; design.md D1, D2, D3, D8, D11
  - **Acceptance**:
    - Outcome: expanding a row publishes its roster, and expanding it again reads nothing
    - Verify: unit src/providers/WorktreeHost.delegations.test.ts
  - **Plan**:
    1. `src/types/messages.ts` — the request naming a row and the session the view believed it had
    2. `src/providers/WorktreeHost.ts` — match the request against the published row's own entry id, read through an injected reader, hold roster and in-flight read under the composite key, apply to a copy of the row at publish, decay a child that outlived its parent's freshness, and evict against the rows published
    3. `src/providers/WorktreeHost.delegations.test.ts` — a row with no entry id, a row that no longer exists, an entry id that no longer matches, a read that fails, a second expansion, a concurrent one, two reads completing in reverse order, an external-only projection and a replay, a tree rebuild, a commit refused by the version check, a stale parent, and disposal mid-read

- [x] 2_2 Wire the real reader behind the host's seam — verified: pnpm exec vitest run 'src/extension.worktreeDelegations.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: design.md D6
  - **Acceptance**:
    - Outcome: the host's reader asks the vault service for the whole transcript, not a page of it
    - Verify: unit src/extension.worktreeDelegations.test.ts
  - **Plan**:
    1. `src/extension.ts` — construct the vault service before the worktree host and pass a reader backed by its detail read at the reader's maximum bound
    2. `src/extension.worktreeDelegations.test.ts` — the wired reader asks for that bound, so a type-compatible reader with the wrong limit fails

## 3. The view

- [x] 3_1 Ask on expansion, and render what came back — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeView.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: specs/worktree-agent-presence/spec.md#show-what-an-agent-s-session-delegated; design.md D9, D10; docs/design/worktree-panel-ui.md#3-4-subagent-row
  - **Acceptance**:
    - Outcome: expanding a row with a session asks the host and shows reading, then what it got
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. `src/webview/worktree/worktreeTreeView.ts`, `src/webview/worktree/worktreePanel.css` — offer the disclosure by the row's session rather than by children already held, give the section its reading, empty, incomplete and unreadable states with a style of their own, and render a delegation's task description as its primary text with the role as the fallback
    2. `src/webview/worktree/WorktreeView.ts`, `src/webview/worktree/WorktreeController.ts` — post the request on first expansion of a row and render the section whenever the row is expanded
    3. `src/webview/worktree/WorktreeView.test.ts` — each state, a row with no session offering no disclosure, and that collapsing and re-expanding posts nothing further

## 4. Round-1 fixes

- [x] 4_1 Make the OpenCode reader owe one timeline item per delegation — verified: pnpm exec vitest run 'src/vault/readers/opencodeReader.detail.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/vault-session-preview/spec.md#one-invocation-appears-once-in-a-timeline; specs/worktree-agent-presence/spec.md#one-delegation-is-one-row; design.md D6
  - **Acceptance**:
    - Outcome: a session whose source records one delegation both ways yields one timeline item, the one that can be opened
    - Verify: unit src/vault/readers/opencodeReader.detail.test.ts
  - **Plan**:
    1. `src/vault/readers/opencodeReader.ts` — correlate a subtask part to a child session stub before emitting it, emitting the plain step only for a subtask no child session accounts for, in the shape `detail.ts` already uses for the same problem
    2. `src/vault/readers/opencodeReader.detail.test.ts` — one delegation recorded both ways, one recorded only as a subtask, one child session with no surviving subtask part, and two delegations to the same agent that must not collapse into one
    3. the correlation is description-then-agent because the source carries no id linking the two — a subtask part's data holds only its type, prompt, description, agent, model and command

- [x] 4_2 Report what the child-session bound dropped — verified: pnpm exec vitest run 'src/vault/readers/opencodeReader.detail.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_1
  - **Refs**: specs/vault-session-preview/spec.md#a-bounded-read-reports-what-its-bound-dropped; design.md D5
  - **Acceptance**:
    - Outcome: a child list cut short by the bound reports source omission
    - Verify: unit src/vault/readers/opencodeReader.detail.test.ts
  - **Plan**:
    1. `src/vault/readers/opencodeReader.ts` — probe the child query for overflow the way the message and part windows already are, report it as source omission, and declare the delegation count from the evidence available rather than from a counter one window survived
    2. `src/vault/readers/opencodeReader.detail.test.ts` — a child list at the bound with more behind it, and one exactly at the bound with nothing behind it, which must not claim omission

- [x] 4_3 Keep the delegated task where the source recorded it — verified: pnpm exec vitest run 'src/worktree/delegations.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D6; docs/design/worktree-panel-ui.md#3-4-subagent-row
  - **Acceptance**:
    - Outcome: a delegation whose source recorded only a prompt renders that prompt, not its role name
    - Verify: unit src/worktree/delegations.test.ts
  - **Plan**:
    1. `src/worktree/delegations.ts` — take the task label from either field the producers populate, keeping the role as the last fallback
    2. `src/worktree/delegations.test.ts` — an item shaped as each producer actually emits it on the unmatched path, and one with neither field

- [x] 4_4 Stop the view claiming what the roster did not, and reconcile what it has asked for — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeView.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-agent-presence/spec.md#a-delegation-roster-that-could-not-be-read-is-not-an-empty-one; design.md D13, D14
  - **Acceptance**:
    - Outcome: an incomplete empty roster never reads as a session that delegated nothing
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. `src/webview/worktree/worktreeTreeView.ts` — decide the section state by what the roster claims before deciding it by how many rows it carries
    2. `src/webview/worktree/WorktreeView.ts` — prune the asked-set and the expanded set against the identities the current presence carries, on the pass that already prunes rows that vanished
    3. `src/webview/worktree/WorktreeView.test.ts` — an incomplete empty roster, a row that leaves and returns under the same session, a row that loses its session while expanded, and a row whose session changed

- [x] 4_5 Deliver the expansion request to the host — verified: pnpm exec vitest run 'src/providers/TerminalViewProvider.worktree.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D12
  - **Acceptance**:
    - Outcome: an expansion posted from either surface reaches the host
    - Verify: unit src/providers/TerminalViewProvider.worktree.test.ts
  - **Plan**:
    1. `src/providers/TerminalViewProvider.ts`, `src/providers/TerminalEditorProvider.ts` — forward the expansion request beside the worktree messages each already forwards
    2. `src/providers/TerminalViewProvider.worktree.test.ts` — the request reaches the host from a view surface and from an editor surface
    3. this is the minimal forward only; `wire-worktree-navigation-actions` task 1_1 replaces both enumerations wholesale and must expect three cases here, not two

## 5. Round-2 fixes

- [x] 5_1 Make the reader's correlation and its bound report only what they proved — verified: pnpm exec vitest run 'src/vault/readers/opencodeReader.detail.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/vault-session-preview/spec.md#one-invocation-appears-once-in-a-timeline; specs/vault-session-preview/spec.md#a-bounded-read-reports-what-its-bound-dropped; design.md D5, D6
  - **Acceptance**:
    - Outcome: an exact match always outranks a guess, and a bound claims only what it proved
    - Verify: unit src/vault/readers/opencodeReader.detail.test.ts
  - **Plan**:
    1. `src/vault/readers/opencodeReader.ts` — reserve every exact match before any agent-only fallback runs, ignore the bound probe for a child list short enough to prove itself whole, fail the read when a saturated list's probe could not run, and declare the count the confirmed overflow supports
    2. `src/vault/readers/opencodeReader.detail.test.ts` — an earlier same-agent delegation with no child of its own followed by a later one whose child matches exactly, an unsaturated list whose probe failed, a saturated list whose probe failed, and a confirmed overflow whose declared count exceeds the items handed over
    3. three round-2 findings, one file — B6 the correlation order, B7 the probe's reach, B8 the count at the bound

- [x] 5_2 Pin the revived editor's expansion routing — verified: pnpm exec vitest run 'src/providers/TerminalViewProvider.worktree.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D12
  - **Acceptance**:
    - Outcome: an expansion posted from a revived editor panel reaches the host
    - Verify: unit src/providers/TerminalViewProvider.worktree.test.ts
  - **Plan**:
    1. `src/providers/TerminalViewProvider.worktree.test.ts` — add the serializer-revived editor beside the three surfaces already covered
    2. behaviour is already correct by shared construction; this pins the one construction route the change never exercised

## 6. Round-3 fixes

- [x] 6_1 Stop a failed read from being reported as a session that does not exist — verified: pnpm exec vitest run 'src/providers/TerminalViewProvider.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D5
  - **Acceptance**:
    - Outcome: a detail the reader could not produce is not reported as a missing session
    - Verify: unit src/providers/TerminalViewProvider.test.ts
  - **Plan**:
    1. `src/providers/TerminalViewProvider.ts` — the reply to a detail read that produced nothing names both outcomes it cannot tell apart, rather than asserting the one it never established
    2. `src/providers/TerminalViewProvider.test.ts` — the reply to an unproduced detail does not claim the session is absent
    3. the `getEntry` miss earlier in this file is a real not-found and keeps its wording
