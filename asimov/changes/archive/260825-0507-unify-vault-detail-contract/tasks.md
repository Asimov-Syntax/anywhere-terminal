# Tasks: unify-vault-detail-contract

> Baseline: `de9f995` (the load-more fix) is landed; this change is unblocked and its
> line references are re-verified against that commit. Preserve its semantics — the
> two axes and the OpenCode probe are now spec requirements, not this change's to move.

## 1. One verdict constructor for every detail producer

- [x] 1_1 Widen `finalizeDetail` to a source verdict and add `limitedDetail` — verified: pnpm run check-types && pnpm run test:unit src/vault/readers/detail.test.ts src/vault/readers/codexReader.detail.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/vault-session-preview/spec.md#the-detail-declares-its-own-content-kind <!-- design.md D1, D2, D3 -->
  - **Acceptance**:
    - Outcome: every Claude and Codex detail is built through the two constructors
    - Verify: command pnpm run check-types && pnpm run test:unit src/vault/readers/detail.test.ts src/vault/readers/codexReader.detail.test.ts
  - **Plan**:
    1. In `src/vault/readers/detail.ts`, replace `finalizeDetail`'s `sourceTruncated: boolean` with the `DetailSource` two-case union from design.md Interfaces, and add `limitedDetail(entryId, reason)` taking no parts.
    2. Keep `parts.truncated` and `parts.stats` passing through untouched; do not add bounding, classification, or child discovery.
    3. Spread `parts` FIRST and write `entryId` and the verdict fields last. Today the argument comes first and the parts spread second, so a parts object carrying its own `entryId`, `partial` or `limitedReason` silently overrides the constructor — one caller already passes a whole detail as parts.
    4. Migrate all eleven boolean call sites across `src/vault/readers/claudeReader.ts`, `src/vault/readers/claudeChildren.ts` (three), `src/vault/readers/claudeTeam.ts`, `src/vault/readers/codexReader.ts`, `src/vault/readers/cursorReader.ts` (two), `src/vault/readers/cursorIdeReader.ts`, `src/vault/readers/opencodeReader.ts` and `synthesizeGroupDetail` in `src/vault/readers/detail.ts`, plus three in `src/vault/readers/detail.test.ts`.
    5. Route the second Codex return path — the hand-written index-only literal in `src/vault/readers/codexReader.ts`, in the same function as the migrated call — through `finalizeDetail` with the `partial` case, keeping its indexed prompt and child stubs.
    6. Keep the both-flags-true case in `src/vault/readers/detail.test.ts` green and extend it to cover the new union, including a parts object carrying stale verdict fields that the constructor must override.

- [x] 1_2 Return OpenCode, Cursor CLI and Cursor IDE details through the constructors — verified: pnpm run test:unit src/vault/readers/opencodeReader.detail.test.ts src/vault/readers/cursorReader.test.ts src/vault/readers/cursorIdeReader.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/vault-session-preview/spec.md#the-detail-declares-its-own-content-kind <!-- design.md D2, D3 -->
  - **Boundary**: preserve `de9f995`'s `partial` / `truncated` semantics exactly, including OpenCode's existence probe, its single-snapshot read and its reversed total orders — this task changes return shape only
  - **Acceptance**:
    - Outcome: no reader hand-writes a detail literal; the limited-view literals are gone
    - Verify: command pnpm run test:unit src/vault/readers/opencodeReader.detail.test.ts src/vault/readers/cursorReader.test.ts src/vault/readers/cursorIdeReader.test.ts
  - **Plan**:
    1. Replace the three surviving metadata-only literals — two in `src/vault/readers/cursorReader.ts` and one in `src/vault/readers/cursorIdeReader.ts` — with `limitedDetail`. These are the only hand-written detail literals left outside Codex.
    2. The timeline-bearing paths already return through `finalizeDetail`; migrating them is task 1_1's boolean sweep, so this step only carries their explicit `contentKind: "timeline"` (`cursorReader.ts:682,739`, `cursorIdeReader.ts:554`) until task 1_3 makes the field derived.
    3. Assert absence, not just behaviour, in `src/vault/readers/cursorReader.test.ts` and `src/vault/readers/cursorIdeReader.test.ts`: each reader's limited path must return a value deep-equal to `limitedDetail(entryId, reason)`, so a surviving literal fails.
    4. Keep each reader's existing bounding where it already sits — Cursor still bounds before child linking and filters continuations before the activity cap; OpenCode still splices its gap (`opencodeReader.ts:748-757`) before returning.

- [x] 1_3 Make `contentKind` required and delete the agent-name fallback — verified: pnpm run check-types && pnpm run test:unit src/webview/vault/VaultPanel.test.ts src/vault/VaultService.detail.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: specs/vault-session-preview/spec.md#the-detail-declares-its-own-content-kind <!-- design.md D3, D4 -->
  - **Acceptance**:
    - Outcome: the preview picks the limited view from `contentKind` alone, with no agent name in the renderer
    - Verify: command pnpm run check-types && pnpm run test:unit src/webview/vault/VaultPanel.test.ts src/vault/VaultService.detail.test.ts
  - **Plan**:
    1. Make `contentKind` required on `VaultSessionDetail` in `src/vault/types.ts`, derived by the two constructors.
    2. Delete the `entry.agent === "cursor"` clause in `src/webview/vault/PreviewController.ts`.
    3. Fix the typed detail literals that omit the new field: the helper in `src/webview/vault/VaultPanel.test.ts` defaults to `timeline` and its metadata-only case states `metadata-only`; also `src/vault/VaultService.detail.test.ts`, `src/vault/VaultService.wiring.test.ts` and `src/webview/links/SubagentPreviewPopup.test.ts`.
    4. The two classifiers that declare `Omit<VaultSessionDetail, "entryId">` as their return type — in `src/vault/readers/codexReader.ts` and `src/vault/readers/opencodeReader.ts` — return parts, not details, so they take `DetailParts` instead. They must not start naming `contentKind`; the constructor owns it.
    5. Add a compiled `@ts-expect-error` fixture proving `limitedDetail` cannot be handed timeline parts — `check-types` alone only proves the legal calls compile.

- [x] 1_4 Add the shared detail-contract assertions and call them from each reader's tests — verified: pnpm run test:unit src/vault/readers/ && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_3
  - **Refs**: specs/vault-session-preview/spec.md#the-detail-declares-its-own-content-kind <!-- design.md D5 -->
  - **Acceptance**:
    - Outcome: all four readers assert the same detail contract from their own fixtures
    - Verify: command pnpm run test:unit src/vault/readers/
  - **Plan**:
    1. Add `src/vault/readers/detailContract.testkit.ts` exporting `expectDetailContract`, `expectLimitGrowth` and `expectResolvableChildren` per design.md Interfaces.
    2. `expectLimitGrowth` re-reads while `truncated` holds and requires strict timeline growth on every increase, ending false; a stall, a null, or `truncated` still claimed at the `MAX_DETAIL_LIMIT` ceiling fails.
    3. Make each assertion fail when handed nothing to check, so a vacuous call on a null or childless detail cannot pass as coverage.
    4. Call them from the existing `src/vault/readers/claudeReader.detail.test.ts`, `src/vault/readers/codexReader.detail.test.ts`, `src/vault/readers/opencodeReader.detail.test.ts`, `src/vault/readers/cursorReader.test.ts` and `src/vault/readers/cursorIdeReader.test.ts`, reusing each file's own fixture setup; add no shared fixture harness.
    5. In `src/vault/readers/opencodeReader.detail.test.ts`, any fixture the repeated reads touch must keep its `sql.includes("OFFSET")` branch ahead of the transcript branches. Answering the existence probe with transcript rows makes a complete fixture report `partial` while the whole suite stays green.

## 2. Collapse the per-agent service wiring

- [x] 2_1 Cover the production reader wiring the existing tests bypass — verified: pnpm run test:unit src/vault/VaultService.test.ts src/vault/VaultService.detail.test.ts src/vault/VaultService.watchTargets.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: <!-- design.md D6 -->
  - **Acceptance**:
    - Outcome: a default reader pointing at the wrong agent now fails a test
    - Verify: command pnpm run test:unit src/vault/VaultService.test.ts src/vault/VaultService.detail.test.ts src/vault/VaultService.watchTargets.test.ts
  - **Plan**:
    1. Add tests exercising the production default registrations in `src/vault/VaultService.ts`, which every current test bypasses by injecting its own maps. They need module-level reader mocks, which would leak across an existing file's suites, so they land in a dedicated `src/vault/VaultService.wiring.test.ts`; `src/vault/VaultService.watchTargets.test.ts` keeps the watch-target assertions.
    2. Add the missing positive dispatch cases: a Cursor entry read, a Cursor record read, and a successful Claude session-watch resolution.
    3. Assert the non-Cursor store-watch targets by exact shape and count, not paths alone.

- [x] 2_2 Replace the five per-agent reader maps with one adapter per agent — verified: pnpm run check-types && pnpm run test:unit src/vault/VaultService.test.ts src/vault/VaultService.detail.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: <!-- design.md D6 -->
  - **Acceptance**:
    - Outcome: list, detail, entry, record and rename resolve through one adapter per agent
    - Verify: command pnpm run check-types && pnpm run test:unit src/vault/VaultService.test.ts src/vault/VaultService.detail.test.ts
  - **Plan**:
    1. Add `src/vault/VaultAgentAdapter.ts` with the interface from design.md Interfaces, capabilities optional.
    2. In `src/vault/VaultService.ts`, replace the five per-capability maps with one `satisfies Record<VaultAgentId, VaultAgentAdapter>` record, keeping the existing dependency-injection seams.
    3. Keep Cursor's locator issuance and identity proof in the service, off the adapter interface.
    4. Behaviour-preserving — change no reader output.

- [x] 2_3 Move both watch methods onto optional adapter capabilities — verified: pnpm run test:unit src/vault/VaultService.watchTargets.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_2
  - **Refs**: <!-- design.md D6 -->
  - **Acceptance**:
    - Outcome: watch targets resolve through the adapters, and an agent may declare neither
    - Verify: command pnpm run test:unit src/vault/VaultService.watchTargets.test.ts
  - **Plan**:
    1. Move the `getStoreWatchTargets` and `resolveSessionWatchTargets` bodies in `src/vault/VaultService.ts` onto the adapters' optional watch capabilities, declared in `src/vault/VaultAgentAdapter.ts`. `VaultWatchTarget` moves there too, since the interface names it; `src/vault/VaultService.ts` re-exports it.
    2. Keep the Cursor branch's locator and identity handling in the service.
    3. Add a test in `src/vault/VaultService.watchTargets.test.ts` for an adapter that declares neither watch capability, proving absence is handled rather than stubbed.
    4. Move the glob-safety guard onto the adapters that interpolate a session id into a glob, so the service stops naming Cursor to decide who skips it.

- [x] 2_4 Make the Ctrl+V paste decision a required per-agent field — verified: pnpm run check-types && pnpm run test:unit src/shared/imagePasteTrigger.test.ts src/vault/registry.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_3
  - **Refs**: <!-- design.md D7 -->
  - **Acceptance**:
    - Outcome: omitting an agent's paste trigger stops compiling
    - Verify: command pnpm run check-types && pnpm run test:unit src/shared/imagePasteTrigger.test.ts src/vault/registry.test.ts
  - **Plan**:
    1. Add the required `satisfies Record<VaultAgentId, boolean>` paste-trigger record to `src/vault/types.ts` — not `src/vault/registry.ts`, which imports Node built-ins the webview bundle cannot take — and source `src/shared/imagePasteTrigger.ts` from it, keeping `grok` an explicit extra.
    2. Add a compiled `@ts-expect-error` fixture in `src/shared/imagePasteTrigger.test.ts` proving an incomplete record fails, since `check-types` otherwise only accepts the complete one.
    3. Correct the add-an-agent checklist in `src/vault/types.ts`: it wrongly claims the accent map is not compile-enforced, and it must describe the adapter registration this change leaves behind.

## 3. Review fixes (round 1)

- [x] 3_1 Stop an adapter override erasing a required capability, and hold metadata-only to absent rather than falsy — verified: pnpm run test:unit src/vault/VaultService.wiring.test.ts src/vault/VaultService.watchTargets.test.ts src/vault/readers/cursorReader.test.ts src/vault/readers/cursorIdeReader.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_4
  - **Refs**: <!-- .reviews/round-1.md W1, W2 -->
  - **Acceptance**:
    - Outcome: an `undefined` override keeps a required capability but still drops an optional one
    - Verify: command pnpm run test:unit src/vault/VaultService.wiring.test.ts src/vault/VaultService.watchTargets.test.ts src/vault/readers/cursorReader.test.ts src/vault/readers/cursorIdeReader.test.ts
  - **Plan**:
    1. In `src/vault/VaultService.ts`, merge a `deps.adapters` entry so that an `undefined` value for the four REQUIRED capabilities is ignored and the default survives. Drop-on-undefined stays for the optional three — task 2_3's absence test depends on it.
    2. Add cases in `src/vault/VaultService.wiring.test.ts`: a required capability overridden with `undefined` still reads through the production reader, and an optional capability overridden with `undefined` is still dropped.
    3. In `src/vault/readers/detailContract.testkit.ts`, assert a metadata-only detail carries no `truncated` field at all rather than a falsy one.
    4. Route a real metadata-only detail through `expectDetailContract` in `src/vault/readers/cursorReader.test.ts` and `src/vault/readers/cursorIdeReader.test.ts` — the existing deep-equality cases compare against `limitedDetail` itself, so a drift inside that constructor moves both sides and nothing else exercises the tightened assertion.
