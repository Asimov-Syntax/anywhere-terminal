# Discovery: unify-vault-detail-contract

## Context

The request was to unify how the four vault agents render session detail, prompted by a Cursor integration that appeared to reuse nothing from Claude/Codex/OpenCode, especially around background subagents.

Reading the code inverted the premise. The renderer is already agent-neutral: `src/webview/vault/previewTimeline.ts:92-126,253-300` dispatches on `VaultTimelineItem.kind` and never on the agent. The one agent name in the render layer, `src/webview/vault/PreviewController.ts:786`, is a symptom of a reader-side contract gap rather than a rendering difference.

Two rounds of independent review then narrowed the change twice. Round one killed a wide `buildSessionDetail` funnel that would have owned bounding, and killed a universal child-stub type. Round two corrected the remaining verdict model and established that the change has almost no integration-cost payoff — which reshaped what is worth doing.

## Key Findings

**The real defect is that two completeness signals are fed from one input.** `finalizeDetail` (`src/vault/readers/detail.ts:191-200`) already separates them for Claude, and `src/vault/readers/detail.test.ts:777-783` pins that both can legitimately be true at once — the source dropped the middle, yet the retained head-plus-tail window is still pageable. Three producers violate the separation: `src/vault/readers/cursorReader.ts:735` and `src/vault/readers/cursorIdeReader.ts:552` fold `sourceTruncated` into `truncated`; `src/vault/readers/opencodeReader.ts:733-735` assigns `windowTruncated` — derived from fixed SQL windows at `:43-46,671-674` that do not grow with the requested limit — to `truncated`. Since `src/webview/vault/PreviewController.ts:785-795` renders load-more purely from `truncated` and grows the limit by 400 at `:40`, a source-truncated Cursor session or a long OpenCode session offers the button forever.

**Cursor's source cap was a shadowing constant** — `src/vault/readers/cursorTranscript.ts:21` declared a local `MAX_TIMELINE_ITEMS = 500` under the same name as `src/vault/readers/detail.ts:23`'s 400. Renamed by `de9f995`; nothing left for this change.

**Making `contentKind` required needs no migration.** `src/vault/VaultCacheStore.ts:42-46` actively rejects `contentKind`, `timeline`, `recentActivity`, `limitedReason` and `stats` — details are never cached.

**No limit-clamping gap exists.** `src/vault/VaultService.ts:721-739` clamps the webview-supplied limit for every agent before dispatch, so readers that never call `clampDetailLimit` are not a production hole.

**The Cursor integration cost did not live where the refactor reaches.** Attributing its ~3,300 reader lines by dominant concern: store/path discovery, reconciliation and watches ~850; protobuf/SQLite/JSONL decoding ~650; security bounds, containment, identity and private ids ~600; normalization into the timeline ~580; child/background-subagent handling ~380; final detail assembly ~220. Everything proposed here touches only the last bucket, worth 30-60 lines. Cursor was expensive because it exposes three private storage dialects, ambiguous path identity, and a subagent lifecycle that must correlate call id to task id to completion notice to a private agent id, group repeated resumes of one agent, recover a declared type from a different invocation, and keep raw child ids off the wire. No shared abstraction supplies any of that.

**What a fifth agent would actually curse at** is the service wiring: five parallel `Record<VaultAgentId, …>` maps at `src/vault/VaultService.ts:71-99,153-184`, watch routing at `:875-943`, and the six-step checklist at `src/vault/types.ts:16-25` whose step 5 (accent CSS) and step 6 (`CTRL_V_AGENTS`) are documented as not compile-enforced, so omitting them fails silently.

## Options

### Option A — A wide assembly funnel owning bounding (rejected)

One constructor taking every reader's parts and owning limit clamping, timeline and activity bounding, and the completeness verdict. Rejected: bounding mechanics differ for real reasons the funnel would need an option per case to preserve. Cursor bounds *before* async child linking (`src/vault/readers/cursorReader.ts:670-673,725-728`) so it does not spend child I/O or churn the locator registry on items it will drop, and filters continuations before the twelve-item cap (`:584-590`) because its activity strip is agent-level rather than invocation-level. OpenCode splices a gap using source-window row ids (`src/vault/readers/opencodeReader.ts:709-735`). Claude re-bounds *after* merging teammate turns and workflow boards (`src/vault/readers/claudeReader.ts:246-257`).

### Option B — Verdict-only constructor plus shared assertions plus adapter manifest (Recommended)

Keep the constructor as narrow as it already is and give it only the verdict; leave bounding where each reader needs it; pin the contract with assertions each reader's existing tests call; and separately collapse the service wiring, which is the part that actually prices the next integration.

### Option C — Documentation and conformance tests only (partially adopted)

Argued on the grounds that shared code buys little here. Adopted for the test half; rejected as a whole because the two load-more defects are production bugs that tests alone do not fix, and because the metadata-only literal genuinely repeats.

## Reuse — existing code to build on

- `finalizeDetail` and `SOURCE_TRUNCATED_REASON`, `src/vault/readers/detail.ts:181-200` — the verdict logic already exists and is already correct; it widens rather than gets replaced.
- `clampDetailLimit`, `boundTimeline`, `boundActivity`, `MAX_DETAIL_LIMIT`, `MAX_ACTIVITY_STEPS`, `src/vault/readers/detail.ts:14-113` — stay as the composable bounding helpers each reader calls at its own point.
- `synthesizeGroupDetail`, `src/vault/readers/detail.ts:927-953` — already wraps `finalizeDetail`; migrates with it rather than becoming a second way to build a detail.
- `VAULT_AGENT_IDS` and the `satisfies Record<VaultAgentId, …>` idiom, `src/vault/types.ts:27` and `src/vault/registry.ts:195` — the existing compile-enforcement pattern the adapter manifest and the registry-data steps extend.
- Each reader's existing test harness — `claudeReader.detail.test.ts:52-63`, `codexReader.detail.test.ts:20-26,283-340`, `opencodeReader.detail.test.ts:425-476`, `cursorReader.test.ts:27-61`, `cursorIdeReader.test.ts:12-18,32-49` — stays; only shared assertions are added to it.

## Rejected — considered and dropped

- **A shared `ChildSessionStub` type and shared placement strategy.** Claude binds a child by an exact `toolUseId` parent edge with description as a legacy fallback (`src/vault/readers/detail.ts:732-759,840-849`); Codex by thread parentage (`src/vault/readers/codexReader.ts:1178-1228`); OpenCode has only creation-time placement (`src/vault/readers/opencodeReader.ts:739-775`); Cursor rewrites invocation cards in place, preserving prompt, result, status and continuation while swapping raw child ids for host-issued opaque locators (`src/vault/readers/cursorReader.ts:505-581`). One type covering all four would be a discriminated union in denial. The neutral seam already exists and is `VaultTimelineItem.subagentSession`.
- **A shared `subagentSessionItem()` builder.** The four literals differ in title, agent, timestamp and truncation policy; the dedup is about ten lines and costs local readability. Apply opportunistically only if a task already edits those lines.
- **Unifying child-id encoding.** Claude's `:subagent:` / `:workflow:` / `:wfagent:` / `:turn:` markers and Cursor's `ide:` / `project:` prefixes encode resolution and security, not presentation.
- **Generalizing `src/vault/readers/runningSessions.ts`**, which is explicitly Claude PID-registry-specific at `:1-13,115-163`, and `src/vault/LaunchBuilder.ts`, already registry-driven at `:187-207,246-276`.

## Gap Analysis

| Component | Have | Need | Gap |
|---|---|---|---|
| Completeness verdict | `finalizeDetail` boolean, used by 7 of 9 producers | One constructor every producer returns through, three cases | Two bypassers; no metadata-only case |
| Pageability signal | Reader-computed, correct for Claude/Codex | Set only when a larger limit yields more | Cursor and OpenCode feed source omission into it |
| Content kind | Optional field, one emitter | Required, derived by the constructor | Webview infers it from the agent name |
| Reader contract proof | Per-reader tests, no shared assertions | Shared assertion vocabulary in each reader's own tests | Nothing catches a new reader drifting |
| Agent registration | Five parallel maps, watch routing, 6-step checklist | One adapter per agent, capabilities optional | Steps 5 and 6 fail silently when omitted |
