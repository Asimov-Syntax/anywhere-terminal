# Design: improve-vault-transcript-messages

## Decisions

### D1: One classifier owns every user-role record

`cleanPromptText` (`src/vault/readers/detail.ts:321`) is today's only filter and it answers one question — "is this a prompt, and what is its text". The three new outcomes (drop / notice / compaction) do not fit a `string | undefined` return, and its two callers (`classifyClaudeStyleEvents` for the timeline, `extractUserText` in `claudeRecords.ts` for titles and `firstPrompt`) must agree or the list titles drift from the transcript.

Replace it with one function returning a tagged union, in a new sibling `src/vault/readers/userRecord.ts`:

```ts
export type UserRecordClass =
  | { kind: "prompt"; text: string }
  | { kind: "drop" }
  | { kind: "notice"; summary: string; status?: string; body?: string }
  | { kind: "compaction"; text: string };

export function classifyUserRecord(rec: Rec): UserRecordClass;   // record-level: flags + text
export function cleanPromptText(raw: string): string | undefined; // kept, text-level, now also strips inner envelopes
```

`cleanPromptText` stays exported with its current name and contract — `claudeRecords.extractUserText`, the teammate-tag path and the existing tests all call it, and a rename buys nothing. It gains only the inner-envelope stripping (D2). The record-level entry point is the new one, because two of the four outcomes are decided by record flags, not text.

Callers: `classifyClaudeStyleEvents` switches on the union; `extractUserText` keeps returning `string | undefined` by mapping everything but `prompt` to `undefined` — which is what makes a background-notification-tailed session stop being titled with the envelope.

### D2: Anchoring rules — whole-block, flags first

| Input | Signal | Outcome |
|---|---|---|
| `isMeta: true` | record flag | drop |
| `isCompactSummary: true` | record flag | compaction |
| `interruptedMessageId` present | record field | notice = request interrupted |
| text is `<local-command-caveat>` / `<local-command-stdout>` / `<command-stdout>` envelope | starts-with, whole block | drop |
| text is `<command-name>` / `<command-message>` wrapper, no args | starts-with | drop |
| …with args | starts-with | prompt = `<name> <args>` (unchanged) |
| text is `<task-notification>` envelope | starts-with + closing tag | notice |
| `<system-reminder>…</system-reminder>` anywhere in the text | scan + excise | strip, then re-classify the remainder |
| nothing left after stripping | — | drop |

Two rules carry the "triệt để" part of the request:

1. **Flags before text.** `isCompactSummary` is a record field; the 25 KB "This session is being continued…" blob has no envelope to match on. Matching its prose would be a heuristic that breaks the moment a human types the same sentence.
2. **`<system-reminder>` is excised, not matched at position 0.** Verified in the local store: reminders ride *after* other content inside one text block, which is exactly why today's `startsWith` never sees them. Excision is a bounded scan for the literal open/close pair — no regex backtracking over untrusted text, same discipline as the `<teammate-message>` parse at `detail.ts:330`.

The `startsWith` anchoring that `cleanPromptText`'s comment already justifies is kept for every envelope that owns its whole block, so a prompt quoting an envelope survives — the spec scenario that pins this.

`<task-notification>` field extraction reads `<summary>`, `<status>` and `<result>` by the same bounded open/close scan. A malformed envelope (no close tag) degrades to `notice` with the summary it could read, or to `drop` — never to raw markup on screen.

### D3: `notice` and `compaction` are timeline kinds, rendered by one collapsible atom

```ts
| { kind: "notice"; summary: string; status?: string; body?: string; timestamp?: number }
| { kind: "compaction"; text: string; timestamp?: number }
```

Both join `breaksRun` (`previewTimeline.ts:17`) — the single place that list is maintained — so they are never swallowed by a run's "Show N more". Both render through the existing collapsible shape that `thinkingBlock` (`renderAtoms.ts:285`) already implements: a head button carrying role chip + one-line gist + chevron, and a `.vault-md` body revealed by an `is-expanded` class. Extract that shape into one `collapsibleMessage({kind, label, gist, body})` builder and have `thinkingBlock`, `notice` and `compaction` all call it, rather than a third and fourth hand-rolled copy of the same 40 lines.

Bodies are bounded by `MAX_MESSAGE_TEXT` like every other bounded body; the complete text is reachable through Raw copy (D5), which is what that affordance is for.

### D4: `msgRef` — an opaque, reader-owned message locator

Message items gain `msgRef?: string`. It is never parsed by the webview or the provider; it round-trips back to the reader that issued it.

| Agent | Value | Stability |
|---|---|---|
| Claude | record `uuid` | native, self-verifying on re-read |
| OpenCode | `message` row id | native |
| Codex | `#<lineOrdinal>` | rollout files are append-only; the ordinal is stamped during the read, before the head+tail bound drops the middle, so a bounded read and a full read agree |

The ordinal must be stamped in the streaming loop (`codexReader.ts:1000`), not derived from the retained array — the bounded buffer drops the middle, and an index into the survivors is not an index into the file.

One locator serves both new features: Raw copy resolves it (D5), and Continue-in-New-Session resolves it to get the untruncated message text (D7). Absent locator → Raw is hidden and Continue is hidden for that message, per spec, rather than falling back to the truncated on-screen text.

### D5: Raw resolution is a host round-trip, capped

```
webview → { type: "requestVaultMessageRecord", entryId, msgRef }
host    → { type: "vaultMessageRecordResponse", entryId, msgRef, raw?, error? }
```

The webview supplies no path — the host resolves the store location from `entryId` exactly as `requestVaultSessionDetail` already does (`vault-session-preview` spec, *Session detail IPC*), so D9 of the original preview design is untouched. `raw` is the record serialized as pretty JSON, capped at 256 KB; a larger record returns an error rather than a truncated document that would read as complete.

Resolution is one small function per reader, reusing each reader's existing stream/query: Claude scans for `uuid`, OpenCode selects the row, Codex counts lines to the ordinal.

### D6: One shared action bar, moved on hover — not 400 bars

400 timeline items × a copy control each is 400 extra subtrees on every re-render, and the preview re-renders on every live-follow push. Instead the preview body owns **one** action-bar element and a delegated `mouseover`/`focusin` listener positions it into the hovered message. Cost is constant, the atoms in `renderAtoms.ts` stay pure DOM builders with no per-message listeners, and the existing `VaultPanel.test.ts` DOM assertions keep passing because message subtrees are unchanged.

The bar carries Copy (menu: Markdown / JSON / Raw) and, on user messages only, Continue in New Session. Which message the bar acts on is read from the hovered element's dataset (`data-msg-index`), so the bar holds no stale item reference across a re-render.

Copy writes go through the same serialized `clipboardChain` the meta copies use (`PreviewController.ts:71`) — that ordering guarantee is spec'd, and a second, unordered write path would break it.

### D7: Continue = a fourth launch mode, argv-seeded

`LaunchMode` gains `"continue"`; the registry gains a `continueCommand` per agent with a new `{{prompt}}` token that `expandArgs` substitutes:

| Agent | Template | Note |
|---|---|---|
| claude | `claude {{prompt}}` | positional; **submits on launch** — verified: `--prefill` does not exist in claude 2.1.239, contrary to the orca notes |
| codex | `codex {{prompt}}` | positional |
| opencode | `opencode --prompt {{prompt}}` | flag |

`{{prompt}}` differs from the existing tokens in that its value comes from the launch call, not from the entry — so `build()` takes an optional `prompt` and `substituteTokens` receives it. The value lands in one argv slot; `LaunchBuilder`'s existing invariant (argv array, never a shell string, `LaunchBuilder.ts:8`) is what makes the spec's metacharacter scenario hold with no new escaping.

The prompt itself is built host-side by `buildContinuationPrompt(entry, messageText)` in a new `src/vault/ContinuationPrompt.ts`, following the shape orca settled on (`orca/src/renderer/src/lib/agent-session-continuation.ts:37`): source header, transcript path as read-only reference, the quoted message, the untrusted-content warning, the workspace-is-authoritative instruction. The quoted message is capped at 4000 characters — well inside any argv limit and inside a first-turn context budget.

### D8: Entry point is the message, not the header

The action lives in the per-message bar (D6), because a header-level Continue would duplicate Resume's affordance with different semantics. The row context menu is left alone.

### D9: The fork point is an assistant turn; the user turn after it is the editable input

_(User feedback, supersedes the user-message anchoring in D7/D8.)_

Seeding a new session with a *user* message reads as "re-ask this question", which is not what continuing means — the state being continued from is what the agent had **just produced**. So the fork point is an assistant turn, exactly as orca's is (`orca/src/renderer/src/lib/agent-session-continuation.ts` uses `lastAssistantMessage`), and what the reader edits is the instruction that comes *after* it.

One operation, two entry points on the bar:

| Activated on | Anchor (assistant record) | Seed text |
|---|---|---|
| assistant message | that message | the next user message in the transcript, else empty |
| user message | the assistant message before it | that user message |

Both resolve to the same `{anchorRef, seedRef?}` pair, computed in the webview from the rendered timeline (which already holds ordered items with `msgRef`), so no new host query is needed to find the pair. The seed's *text* is not taken from the timeline — timeline text is truncated at `MAX_MESSAGE_TEXT` and would silently ship a shortened instruction. It is fetched with the existing D5 round trip (`requestVaultMessageRecord` + `extractMessageText`) when the dialog opens.

A message with no anchor resolvable this way (a session opening on a user turn, a run whose assistant turn is outside the loaded window) keeps the action but opens the dialog with an empty editor and no anchor line — the reader types the instruction themselves.

### D10: A confirm dialog owns the launch; the prompt text becomes webview-supplied

Launching a permission-bypassing agent on a single click is the wrong default, so the action opens a dialog and nothing spawns until Start. The dialog is a plain DOM overlay inside the preview shell — the codebase has no dialog primitive (`src/webview/ui/` is Tooltip + BannerService), and `FloatingWindow` is a draggable window, not a modal.

This changes a spec invariant: the prompt's task text is now **reader-authored**, so the webview supplies it. The host still composes the frame (source header, transcript path, anchor line, safety instructions) and still refuses to take a *transcript* quote from the webview — what crosses the boundary is the reader's own typing, bounded by the same `MAX_CONTINUATION_QUOTE` cap, landing in the same single inert argv token. The `msgRef` still resolves host-side, for the anchor line only.

```
webview → { type: "vaultContinueSession", entryId, anchorRef?, instruction, options: { confirmIntent, agent, permissionMode? } }
```

### D11: Agent and permission choices are registry data, not a second table

The dialog's Agent list is the registry's own agents filtered by what `detect.executable` resolves to on PATH — the host answers a `requestVaultLaunchTargets` query and the webview renders the reply, so detection stays host-side where `spawn` lives.

Permission is agent-shaped, not universal: Claude has one `--permission-mode` axis, Codex has two (`-a` approval, `-s` sandbox), OpenCode has none. Rather than a lowest-common-denominator control, each definition gains an optional `permissionChoices: { id, label, dangerous?, args }[]` — the args a choice contributes to the launch argv. An agent with no choices hides the row. The entry's captured mode (7_1) selects the initial choice; a `dangerous` choice is marked in the list so bypassing permission checks is a visible decision rather than an inherited one.

### D12: The intent check is an appended block, on by default

The optional instruction is one block appended to the composed prompt, not a rewrite of it: state the goal and current state in a line or two and wait for confirmation before acting. Default on — the whole point of the dialog is that a continuation starts cautiously.

### D13: The host validates the continuation frame before launch

_(Review round 2 B1, W1, W2.)_

`anchorRef` remains opaque in the webview, but it is not trusted merely because the dialog emitted it. Before composing a handoff, the provider resolves it through `VaultService.readMessageRecord(entryId, anchorRef)`, validates the resolved record as an assistant turn in that source agent's schema, and derives the canonical locator from the record (or the normalized physical-line ordinal for Codex). A missing, oversized, malformed, user-role or injected record refuses the launch.

Session metadata is store-derived too. The prompt serializes agent, title and cwd as fenced JSON explicitly labelled untrusted data, so embedded newlines cannot become host-authored prompt structure. An explicit permission-choice id is fail-closed: it must name a registry choice for the selected target. Only the implicit captured posture may fall back to the target's first safe visible choice when the captured value is stale.

### D14: Raw bounds apply before records are materialized

_(Review round 2 B2, B3.)_

The shared JSONL resolver scans byte chunks and retains at most the configured record budget for one physical line. It skips an oversized non-target line without constructing or parsing it; a line-number hint (Codex) or an exact serialized `uuid` field/value marker (Claude) lets it report `too-large` for the target without mistaking a uuid quoted inside message content for the record field.

OpenCode performs size classification and conditional JSON aggregation in one SQL statement against one copied snapshot. The query returns either one bounded complete record or its `too-large` classification; no later payload query can observe parts appended after the size decision. The returned compact JSON is pretty-serialized only after the same-snapshot query has bounded it.

### D15: Continuation pairing and dialog state stay exact across bounds

_(Review round 2 B4, W3-W7, S1.)_

Every head+tail reader preserves a proven omitted boundary as a `gap` timeline item: Claude and Codex translate the shared internal sentinel, while OpenCode inserts one between non-overlapping message windows. Fork scans stop at it. A selected user turn with no assistant in its contiguous segment produces an empty fork point. The dialog never treats capped timeline text as launchable input: it starts empty while the locator resolves, fills only from the complete host record, and on failure stays empty with a visible error until the reader authors text.

Notice and compaction items carry the same reader-owned locator as their source user record. They bind to the shared action bar, which exposes Raw only for those kinds; Markdown, JSON and Continue remain message-only. The bar and existing metadata copies share one latest-success confirmation helper, and every preview loading/error/close teardown disposes the current bar.

The dialog traps Tab/Shift+Tab inside its controls and restores the invoking message on non-launch dismissal. The read-only anchor preview is removed from the tab order, and asynchronous status changes use a polite live region. This makes the declared `aria-modal` behavior real without adding a second modal framework.

### D16: The confirmed instruction is bounded before launch

_(Review round 3 W8.)_

One dependency-free constant owns the 4,000-character instruction cap for host and webview. The dialog exposes the limit, applies `maxLength`, displays a live counter and visibly shortens an over-cap stored seed before it can be confirmed. The provider rejects forged over-cap IPC input; `buildContinuationPrompt` refuses it as defense in depth rather than silently changing the reader-confirmed text.

## Architecture

```
                        transcript record
                               │
        ┌──────────────────────┴──────────────────────┐
        │  classifyUserRecord   (userRecord.ts, D1/D2) │
        └──┬───────────┬───────────┬───────────────┬───┘
        prompt        drop       notice        compaction
           │                        │               │
           └────────┬───────────────┴───────────────┘
                    ▼
            VaultTimelineItem  (+ msgRef, D4)
                    │  IPC
                    ▼
            PreviewController ── renders ──► previewTimeline
                    │                             │
                    │                    collapsible atom (D3)
                    │
                    └── one hover action bar (D6)
                            ├── Copy MD / JSON      (client-side)
                            ├── Copy Raw            ──► requestVaultMessageRecord (D5)
                            └── Continue in New Session ──► vaultContinueSession
                                                              │
                                          host: resolve msgRef → buildContinuationPrompt
                                                              │
                                          LaunchBuilder mode "continue" + {{prompt}} (D7)
```

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| `classifyUserRecord` | A tightened filter silently drops a real prompt — the failure nobody notices | The `startsWith` whole-block anchoring is kept and its "quoted envelope survives" case is a spec scenario with a test; `detail.test.ts` already covers the existing wrapper cases and those tests must stay green unmodified |
| `notice` body | Task-notification `<result>` can be a full agent report (6.5 KB seen locally, unbounded in principle) | Bounded by `MAX_MESSAGE_TEXT` like every other body; full text via Raw copy |
| `compaction` body | Compaction summaries observed at 25 KB, grows with context window | Same `MAX_MESSAGE_TEXT` bound; collapsed by default so it costs one line of layout |
| Raw record IPC | A single record could be megabytes; an unbounded reply crosses `postMessage` | 256 KB cap, error above it; the reply carries the record only, never a whole file |
| Per-message action bar | Grows with timeline length (up to `MAX_DETAIL_LIMIT` = 5000 items) | One shared bar + delegation (D6) — constant DOM cost regardless of item count |
| Continue prompt | Transcript text reaching a command line | Single argv slot, no shell string (`LaunchBuilder.ts:8`); message quote capped at 4000 chars; prompt composed host-side from a host-read record, webview supplies only `entryId` + `msgRef` |
| Codex `msgRef` | Line ordinal invalid if a rollout is ever rewritten rather than appended | Resolver re-reads by ordinal and returns an error when the record at that ordinal is not a user message — a wrong record is never returned as Raw |
| `previewMessage` signature | Used by teammate messages, subagent steps and the subagent popup — a change ripples | The bar is external to the atom (D6); the atom gains a `data-msg-index` attribute only |
