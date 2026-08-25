# Design: unify-vault-detail-contract

## Decisions

### D1: Source completeness and pageability are separate inputs, and neither may write the other

The rule itself is no longer this change's to state: `de9f995` landed it as the base-spec requirement "Source omission and pageability are distinct signals", and `src/vault/types.ts` now documents `truncated` as pageability and `partial` as source omission "and nothing else". All four readers obey it today.

What belongs here is making it structural rather than conventional. The rule currently holds because five files each choose to honour it, and nothing stops the sixth: every producer can still reach `partial` and `limitedReason` directly, which is exactly how three of them conflated the axes before. Once every producer returns through one constructor that alone writes those fields plus `contentKind`, the conflation is unreachable rather than merely absent.

Two consequences this change SHALL respect rather than revisit. Claude's bounded head-plus-tail buffer (`src/vault/readers/detail.ts:55-101`) drops the middle while the retained records stay pageable, so both flags hold at once — pinned by `src/vault/readers/detail.test.ts:777-783`. And OpenCode now proves omission with a bounded existence probe read inside the same snapshot as its windows; an unproven read returns null, because `partial` may carry only confirmed omission. No refactor may introduce an unverified state into that field.

### D2: The constructor owns the verdict only — never bounding, stats, classification, or child discovery

`finalizeDetail` SHALL receive already-bounded parts and SHALL pass `parts.truncated` and `parts.stats` through untouched.

Bounding cannot move, because each reader bounds at a different point for a reason:

```
cursor    decode → bound → link children (async)   bound first, or child I/O and
                                                    locator-registry churn are spent
                                                    on items about to be dropped
cursor    activity → filter continuations → cap 12  agent-level strip, not per-invocation
opencode  one snapshot: 4 windows + probe + children → build →
          splice gap (source-window ids) → return
claude    classify (bounds) → merge teammate turns + boards → re-bound
codex     classify (bounds) → finalize              already the target shape
```

Stats describe the decoded source, not the visible tail, so the constructor must not recompute them after bounding.

Owning a field means winning it. `finalizeDetail` today returns `{ entryId, ...detail }` — the argument first, the parts spread second — so a parts object carrying its own `entryId`, `partial` or `limitedReason` overrides the constructor. The `Omit` in Interfaces makes that illegal only for fresh object literals; a caller passing a variable typed as a whole `VaultSessionDetail` stays assignable and spreads a stale verdict straight through the non-partial branch. The constructor SHALL therefore spread `parts` first and write `entryId`, `contentKind`, `partial` and `limitedReason` last, so the verdict is authoritative by construction rather than by what the call sites happen to contain.

### D3: Two constructors, so a metadata-only detail cannot be handed timeline content

`finalizeDetail` SHALL accept only the two timeline-bearing cases. A separate `limitedDetail(entryId, reason)` SHALL construct the metadata-only detail and SHALL take no parts parameter.

The case is named `partial`, not `windowed` or `metadata-only`, because of Codex: its index-only fallback (`src/vault/readers/codexReader.ts:1327-1350`) is a partial that still carries content — the indexed first prompt and the child stubs discovered from SQLite, pinned by `specs/vault-session-preview/spec.md` scenario "Codex partial detail still shows known children". Collapsing it into the empty metadata-only case would silently delete that content.

A single entry point with a three-case union would leave `{ kind: "metadata-only" }` structurally able to receive a populated timeline that the constructor then discards — hiding exactly that bug rather than failing it. Separating the functions makes the exclusion structural. Because a type-level exclusion cannot be proven by an ordinary test, and `check-types` only validates the positive uses that exist, it SHALL be proven by a compiled `@ts-expect-error` fixture.

### D4: `contentKind` becomes required and is derived, never chosen by the caller

`VaultSessionDetail.contentKind` SHALL be required, set to `timeline` by `finalizeDetail` and `metadata-only` by `limitedDetail`. `src/webview/vault/PreviewController.ts:785-787` SHALL then select the limited view from that field alone, deleting `entry.agent === "cursor"`.

Safe without a migration: `src/vault/VaultCacheStore.ts:42-46` actively rejects `contentKind` and every other detail field, so no persisted payload can predate the requirement. Lands as its own task — it is an IPC-contract cleanup that contributes nothing to the load-more fix, so it must be separately revertable. A type check alone cannot prove the renderer still picks the right view, so its Verify SHALL also run the webview suite.

### D5: Shared assertions, reader-local fixtures

The conformance layer SHALL be an exported assertion vocabulary called from each reader's existing test file. It SHALL NOT introduce a shared fixture harness.

The four fixture mechanisms share nothing: Claude writes temporary JSONL (`claudeReader.detail.test.ts:52-63`), Codex combines temporary rollouts with injected SQL (`codexReader.detail.test.ts:20-26,283-340`), OpenCode dispatches on SQL text (`opencodeReader.detail.test.ts:425-476`), Cursor builds stores behind injected filesystem seams (`cursorReader.test.ts:27-61`) while its IDE tests create real SQLite (`cursorIdeReader.test.ts:12-18,32-49`). A "shared suite" would collapse into four near-identical files sharing only their assertions — so share the assertions and skip the pretence.

`expectLimitGrowth` SHALL re-read while `truncated` holds and SHALL require the timeline to grow strictly on every increase, ending false. A ceiling-only check is too weak: a reader whose source caps at 500 while `MAX_DETAIL_LIMIT` is 5000 would stall for a dozen clicks before the assertion had anything to say. Each assertion SHALL also fail when handed nothing to check, so a vacuous call on a null or childless detail cannot pass as coverage.

### D6: One adapter per agent, with capabilities optional

The five parallel `Record<VaultAgentId, …>` maps (`src/vault/VaultService.ts:71-99,153-184`) plus the watch routing (`:875-943`) SHALL collapse into one `Record<VaultAgentId, VaultAgentAdapter>`. Capabilities absent from an agent SHALL be absent from its adapter rather than stubbed, and that absence SHALL itself be covered by a test.

Cursor's opaque-locator mechanics (`src/vault/VaultService.ts:236-239,726-734,752-784`) SHALL stay specialized in the service and SHALL NOT be pushed onto the adapter interface — forcing every reader to model an identity-and-locator flow it does not have is the false generality this change is otherwise avoiding.

The move is behaviour-preserving, but the existing tests inject their own maps through `makeReaders` and never exercise the production defaults at `:153-185`, so a default that points at the wrong reader would keep every test green. The coverage gap SHALL be closed before the move, not after.

The map is keyed by `VAULT_AGENT_IDS` and bounded at four entries; it grows only when a developer adds an agent, so it has no runtime growth axis.

### D7: The Ctrl+V paste decision becomes a required per-agent field, in browser-safe code

The accent half of the add-an-agent checklist needs no work: `AGENT_ICONS … satisfies Record<VaultAgentId, AgentIcon>` (`src/webview/vault/agentIcons.ts:58-69`) already makes omitting an agent a compile error. Only the stylesheet's `.vault-badge--<id>` selector stays manual, and no type can check a CSS selector.

The real gap is the paste trigger. `CTRL_V_AGENTS` (`src/shared/imagePasteTrigger.ts:36-42`) is a `Set<string>` whose `satisfies (VaultAgentId | "grok")[]` catches a **renamed** id but not an **omitted** one — a new agent that needs Ctrl+V and is simply not listed falls silently to the OS-native branch. It SHALL become a required `Record<VaultAgentId, boolean>` so every agent declares its trigger explicitly, proven by a compiled `@ts-expect-error` fixture rather than by the positive uses `check-types` already accepts.

That record SHALL live in `src/vault/types.ts`, NOT `src/vault/registry.ts`: `src/webview/main.ts:15` imports `shared/imagePasteTrigger`, while `registry.ts:10-11` imports `node:child_process` and `node:util`, so sourcing the flag from the registry would pull Node APIs into the webview bundle. `"grok"` is pre-wired ahead of its own registry record and stays an explicit extra outside the record.

The checklist comment at `src/vault/types.ts:16-25` SHALL be corrected — it currently claims step 5 is not compile-enforced, which is false — and SHALL describe the registration mechanism D6 leaves behind.

## Interfaces

```ts
// src/vault/readers/detail.ts

/** What the read could and could not see — independent of `parts.truncated`,
 *  which says only whether a larger limit would return more items (D1). */
export type DetailSource =
  | { kind: "complete" }
  | { kind: "partial"; reason: string };

/** Everything the reader decoded and already bounded. The verdict fields are
 *  the constructor's to set, so they are absent here (D2/D4). */
export type DetailParts = Omit<
  VaultSessionDetail,
  "entryId" | "contentKind" | "partial" | "limitedReason"
>;

export function finalizeDetail(
  entryId: string,
  parts: DetailParts,
  source: DetailSource,
): VaultSessionDetail;

/** The limited view: no timeline, no activity, no `truncated`. Takes no parts,
 *  so content cannot be passed in and silently dropped (D3). */
export function limitedDetail(entryId: string, reason: string): VaultSessionDetail;
```

```ts
// src/vault/types.ts — contentKind required (D4); paste trigger as required data (D7)
contentKind: "timeline" | "metadata-only";

export const AGENT_USES_CTRL_V = {
  claude: false,
  codex: true,
  opencode: true,
  cursor: false,
} satisfies Record<VaultAgentId, boolean>;
```

```ts
// src/vault/VaultAgentAdapter.ts (new)

export interface VaultAgentAdapter {
  readonly id: VaultAgentId;
  list: ListReader;
  detail(sessionId: string, limit?: number): Promise<VaultSessionDetail | null>;
  entry(sessionId: string): Promise<VaultSessionEntry | null>;
  record(sessionId: string, msgRef: string): Promise<RecordLineResult>;
  /** Absent → no writable native title (claude). */
  renameInStore?(sessionId: string, name: string): Promise<boolean>;
  /** Absent → contributes no store-level watch targets. */
  storeWatchTargets?(): VaultWatchTarget[];
  /** Absent → the agent has no per-session watch path. */
  sessionWatchTargets?(sessionId: string): Promise<VaultWatchTarget[]>;
}
```

```ts
// src/vault/readers/detailContract.testkit.ts — assertion vocabulary (D5)

/** Legal combinations of partial / truncated / contentKind for one detail. */
export function expectDetailContract(detail: VaultSessionDetail): void;
/** Re-reads while `truncated` holds, requiring strict timeline growth on every
 *  increase and a false ending; a stall, a null, or `truncated` still claimed at
 *  the MAX_DETAIL_LIMIT ceiling fails. */
export function expectLimitGrowth(
  read: (limit: number) => Promise<VaultSessionDetail | null>,
): Promise<void>;
/** Every nested `subagentSession.entryId` resolves to a readable detail. */
export function expectResolvableChildren(
  detail: VaultSessionDetail,
  read: (entryId: string) => Promise<VaultSessionDetail | null>,
): Promise<void>;
```

## Design Constraints

- `pnpm run test:unit` is `vitest run` (`package.json:603`). Positional paths filter, but `-- <path>` does not — it runs all 154 files. Every scoped Verify must omit the `--`.
- `src/shared/imagePasteTrigger.ts` is reachable from the webview bundle (`src/webview/main.ts:15`), so anything it imports must be free of Node built-ins.
- OpenCode's fixtures dispatch on SQL text, and its existence probe is the only query carrying `OFFSET`. A fixture that answers the probe with transcript rows turns a complete session `partial` while all 154 test files stay green, so the `OFFSET` branch must be matched first (`src/vault/readers/opencodeReader.detail.test.ts:64,481,598,644,675`).
- `finalizeDetail` returns `{ entryId, ...parts }` and does not set `contentKind` today, while both Cursor readers set it on every return (`cursorReader.ts:668,682,724,739`, `cursorIdeReader.ts:491,554`). Until D4 makes the field required and derived, any migration that rebuilds a Cursor parts object must carry it through — dropping it makes `PreviewController.ts:785-786` render every Cursor session as metadata-only.

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| OpenCode probe fixtures | The repeated reads `expectLimitGrowth` performs run against fixtures that dispatch on SQL text; mis-ordered branches answer the probe with transcript rows and flip complete sessions to `partial` with the suite still green | Task 1_4 step 5 requires the `OFFSET` branch first; Design Constraints records the mechanism |
| `finalizeDetail` signature | All eleven production call sites break at once (`claudeReader.ts:258`, `claudeChildren.ts:63,303,357`, `claudeTeam.ts:214`, `codexReader.ts:1323`, `detail.ts:943` via `synthesizeGroupDetail`, `cursorReader.ts:675,732`, `cursorIdeReader.ts:547`, `opencodeReader.ts:760`) | Signature change is compile-enforced; task 1_1 migrates them in one task with `check-types` chained into its Verify |
| Codex second return path | `codexReader.ts:1338-1350` is a hand-written `partial` literal in the same function as the migrated call, so "migrate the callers" does not reach it | Task 1_1 names it as its own Plan step and keeps its prompt and child stubs |
| Verdict field precedence | The current `{ entryId, ...parts }` order lets a parts object override the constructor's own verdict, and the `Omit` does not stop it when the caller passes a variable rather than a literal — `opencodeReader.ts:758-760` passes a whole `VaultSessionDetail`, `entryId` included | D2 requires parts to spread first; task 1_1 step 3 makes it a named step and step 6 pins it with a stale-verdict parts case |
| Claude both-flags case | A verdict model that forces one flag off silently regresses Claude | `detail.test.ts:777-783` asserts it; task 1_1 chains that file into its Verify and extends it to the new union |
| Cursor `contentKind` | `finalizeDetail` does not set it, so a migration that rebuilds Cursor's parts object drops it and renders every Cursor session as metadata-only | Design Constraints records the mechanism; task 1_3 removes the hazard permanently by making the field required and derived |
| Cursor bound-before-link ordering | Moving bounding to the constructor would spend child I/O and churn the bounded locator registry on dropped items | D2 forbids the constructor owning bounding; task 1_2 changes the return shape, not the ordering |
| OpenCode gap splice | Splicing into an already-finalized timeline would reorder against the bound | Task 1_2 splices before calling the constructor, keeping `opencodeReader.ts:748-757` ahead of the return |
| Required `contentKind` | Test helpers casting partial objects hide the new required field | Task 1_3 fixes `VaultPanel.test.ts:576-584`, `:2178-2196`, `VaultService.detail.test.ts:14-16` and `SubagentPreviewPopup.test.ts:12-21,123-147`, and chains the webview suite into its Verify |
| Type-level exclusions (D3, D7) | `check-types` proves the positive uses compile, never that an illegal one does not | Both are proven by compiled `@ts-expect-error` fixtures in tasks 1_3 and 2_4 |
| Adapter refactor | Existing tests inject their own maps and never exercise the production defaults at `VaultService.ts:153-185`, so a wrong default stays green | Task 2_1 closes that gap before the move; 2_2 and 2_3 then run against it |
| Webview bundle | Sourcing the paste trigger from `registry.ts` pulls `node:child_process` into the browser bundle | D7 places the record in `types.ts`; Design Constraints records why |
