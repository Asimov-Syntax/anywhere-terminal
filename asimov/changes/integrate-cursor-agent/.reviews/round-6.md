# Review Round 6

- Date: 2026-08-24
- Scope: commit `7464593` only
- Reviewable lines: 793
- Large change: no
- Agents spawned: asm-review-data-security, asm-review-logic, asm-review-contracts, asm-review-frontend, asm-review-performance, asm-review-reuse
- Agents skipped: none
- Verdict: BLOCK
- Counts: BLOCK 1 | WARN 3 | SUGGEST 1

## Current Findings

### B18

- ID: B18
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/VaultLauncher.ts:86
- title: CLI-only launch-target resolution breaks Cursor IDE and child Continue
- evidence: `resolveLaunchable()` now calls `VaultService.getLaunchTarget()` before it checks `mode`. For every Cursor id, `getLaunchTarget()` delegates to `resolveCursorLaunchTarget()`, which is intentionally CLI-only and returns null for `ide:` and cannot resolve issued `child:` locators. The ordinary `getEntry()` path still resolves Cursor IDE entries and issued child locators, and `handleVaultContinue()` first succeeds through that path, but the subsequent `VaultLauncher.resolve(entryId, "continue")` performs the new CLI-only lookup and throws `unknown-entry`. A temporary focused regression confirmed `getEntry()` returns the IDE entry while `resolve(..., "continue")` rejects it.
- impact: “Continue in New Session” no longer works for Cursor IDE Composer previews or saved Cursor child transcripts, despite the approved source-aware preview/continuation contract. This is a breaking regression introduced while narrowing the proof seam for Resume.
- suggestedFix: Use `getLaunchTarget()` only for Resume and Copy Resume Command. For `continue` and `fork`, retain `getEntry()` resolution, or pass the launch mode into the service so only Cursor Resume takes the carried-path proof branch. Add real-service regressions for Cursor IDE and issued-child Continue.
- status: new
- triage: Chair-only full-flow finding. The specialists reviewed the proof seam primarily as a Resume contract; tracing `handleVaultContinue` through the changed launcher exposed the non-CLI Cursor regression.

- authorStatus: accepted
- authorTriage: Reproduced by reading VaultLauncher.resolveLaunchable: getLaunchTarget() runs before the mode check, and for Cursor it delegates to the CLI-only resolver, so an ide: id (and a child: locator) fails as unknown-entry for Continue. Regression introduced by task 11_3 while narrowing the Resume proof seam. Fix as suggested: only Resume and Copy Resume Command take the carried-path launch target; Continue and Fork keep getEntry().

### W15

- ID: W15
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-logic, asm-review-frontend, asm-review-contracts, chair
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/PreviewController.ts:443
- title: Nested replies still cannot be matched to the request that produced them
- evidence: The new orphan ledger drops replies by `entryId` and assumes the retired request’s reply arrives before a newer request for that same child. The host starts each detail read with `void handleRequestVaultSessionDetail(...)`, so reads can complete out of order: after close/reopen, the fresh reply can be consumed as the orphan and the older reply can then populate the current waiter. There is also an in-preview collapse path at lines 173-187: collapsing the final waiting card deletes `pendingNested` without recording the already-posted reply as orphaned, so collapse/reopen accepts the old reply even when replies complete in send order.
- impact: A reopened card can display stale child content or a stale error, or lose the fresh response and remain incorrect. The accepted round-5 stale-response defect remains reachable despite the generation and orphan bookkeeping.
- suggestedFix: Add an opaque nested-request id to `requestVaultSessionDetail` and echo it in `vaultSessionDetailResponse`; key pending/retired state by that id. If the protocol cannot change immediately, every path that drops the final waiter must retire one owed reply, but FIFO-by-entryId still cannot solve out-of-order completion.
- status: persists from round 5
- triage: Matches accepted round-5 W15. The new generation handles preview replacement only when response ordering happens to be FIFO; the unchanged concurrent host dispatch and the changed last-card collapse path refute that assumption.

- authorStatus: accepted
- authorTriage: The out-of-order argument stands: handleRequestVaultSessionDetail is dispatched without ordering, so FIFO-by-entryId is not a property this code can rely on. Taking the suggested fix rather than patching the ledger: the repository already uses an echoed opaque requestId for file preview, subagent preview, and file-tree search, so nested detail correlation follows an existing convention instead of inventing one. The generation counter and orphan ledger are removed once the id lands.

### W17

- ID: W17
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-logic, asm-review-contracts, chair
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/cursorTranscript.ts:485
- title: JSONL mirror cannot merge a launch with its result-derived agent identity
- evidence: `readCursorTranscript()` now runs `mergeCursorSubagentInvocations()` over normalized timeline/activity arrays, but it discards each normalized record’s `subagentCalls` and `toolResults`. A launch invocation normally has no `resume` value and therefore no `childAgentId`; when a later correlated result carries `Agent ID: ...`, the JSONL path never attaches that identity to the launch step. Only continuation calls that already carry `resume` enter the merge group, leaving the typed launch as a separate card. The added JSONL test explicitly expects this two-card outcome.
- impact: Mirror/fallback previews can still show one Cursor agent as a typed launch card plus a separate `@Task` continuation card, retain the wrong opening metadata, fail to link launch-only saved children, and over-count distinct agents. This contradicts the changed one-card-per-agent contract for stores that rely on the JSONL fallback.
- suggestedFix: Add bounded call/result correlation to the JSONL read pass and attach result-derived child ids/results to the original invocation before the shared merge, reusing the store correlation semantics. Keep unmatched launches separate rather than inferring identity without evidence.
- status: new
- triage: Corroborated by logic and contracts specialists and by the changed test’s admitted two-card expectation. The shared merge is correct only after every available identity source has been correlated.

- authorStatus: rebutted
- authorTriage: The code description is accurate — the JSONL path does discard subagentCalls/toolResults — but the suggested fix is inert on the observed format, so the finding does not survive as written. Structural census of three real project transcripts on this machine, including the parent this change was built from (`e02838b2-b235-439c-98ee-1ea72905d4f8`) and its Oracle child (`82e87c39-e85e-4a03-9462-25fd78499f74`): block types are `text` and `tool_use` only, with `turn_ended` as the sole typed record; `tool_result` blocks number ZERO, at top level and inside `message.content` alike. The mirror therefore records invocations WITHOUT results. Correlation has nothing to join, and the `Agent ID:` line that supplies a launch's identity exists only in `store.db` results, never in the mirror. Adding the correlation maps would ship a code path that cannot fire on any observed data, for no user-visible change, and would contradict this change's evidence-led bound on speculative decoding. The split launch card in mirror fallback is a property of the source format, not of the merge pass. Scope of the counter-evidence: one Cursor version, one machine, three transcripts — if a future format does carry results, the shared correlation becomes worth extracting, and that is the trigger to revisit.

### W18

- ID: W18
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-frontend, asm-review-contracts, chair
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/previewTimeline.ts:170
- title: Occurrence-based card keys shift when load-more prepends the same child
- evidence: `nestedCardKeys()` assigns `<prefix>|<entryId>#<seen>` by scanning the current timeline from oldest to newest. Loading more replaces the root timeline with a larger suffix window that prepends older items. If the prepended items contain another card for an already-visible child id, every existing occurrence number shifts; `expandedNested` retains the old key, so expansion moves to the newly prepended occurrence or the previously expanded card collapses. The rewritten duplicate-card load-more test reuses an unchanged two-item timeline and never prepends a matching occurrence.
- impact: Independent duplicate-card expansion does not survive the load-more case it was designed to preserve; the wrong occurrence can open after history grows.
- suggestedFix: Carry a stable per-invocation/card identity from the host timeline, or derive a key that is stable under prepending matching occurrences. Add a regression where load-more prepends an older card with the same child `entryId`.
- status: new
- triage: Corroborated by frontend and contracts specialists. The implementation comment’s stability claim fails specifically when the prepended history contains the same child identity.

- authorStatus: accepted-modified
- authorTriage: The defect is real: occurrence counting is top-down, so prepending an older card with the SAME child id renumbers the existing cards and expansion transfers. The suggested fix cannot be taken literally — no per-invocation identity exists on the wire, and the reader must not publish the private toolCallId to supply one. Counting from the end instead is stable under prepend but breaks under live-follow append, so it only moves the defect. Fix: key by (entryId, card title, nth among cards identical in both), which is undisturbed by prepends and appends alike; genuinely identical cards remain indistinguishable, which is the honest floor. Adding the matching-child prepend regression the finding asks for.

### S10

- ID: S10
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: asm-review-reuse
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/cursorNormalization.ts:133
- title: Resume-agent validation duplicates the canonical Cursor id rule
- evidence: The new `safeAgentId()` repeats the same 200-character, `[A-Za-z0-9._-]`, and no-`..` rule already exported as `isSafeCursorChatId()` through `cursorPaths.ts`; `cursorStore.ts` also carries another local copy.
- impact: Future Cursor identifier changes can drift between normalization, path resolution, and store proof, producing inconsistent child linking or rejection.
- suggestedFix: Keep the unknown-value/type guard locally, then delegate string validation to the canonical `isSafeCursorChatId()` helper.
- status: new
- triage: Retained as a reuse suggestion rather than a warning because current validators are behaviorally equivalent.

- authorStatus: accepted
- authorTriage: safeAgentId repeats the canonical rule. Delegating to isSafeCursorChatId keeps one owner for the identifier shape; the bounded length check stays local since the normalizer's cap is its own concern.

## Cross-round Disposition

- Round-5 B14: fixed — raw `project:` detail and entry requests are refused, and issued `child:` locators resolve only from the bounded host registry.
- Round-5 B15: fixed under approved D14 — only a readable store claiming a different agent suppresses the mirror; absent, locked, malformed-profile, or unsupported stores retain fallback.
- Round-5 B16: fixed — the profile requires one key-0 row and the supported key constraint before proof/detail proceeds.
- Round-5 B17: fixed for the accepted race — Resume/Copy resolve one Cursor candidate and prove its carried store path. The data-security specialist’s proposed proof-to-later-command binding was not retained because D14 requires proof before the current side effect, not an impossible durable authorization of a copied command executed later.
- Round-5 W14: fixed — parent project context is validated once and reused for bounded child leaf resolution.
- Round-5 W15: persists — see current W15; response identity is still inferred from entry-id/FIFO ordering, and final-card collapse does not retire its outstanding reply.
- Round-5 W16: fixed for the reviewed duplicate-card waiter case — collapsing one card removes only that body while another open card keeps the shared request.

## Specialist Disposition

- asm-review-data-security: raw-project/locator and bounded identity gates verified. Its proof-to-action BLOCK was not retained because it extends beyond the approved D14 guarantee and would also make intentionally copied commands impossible to authorize durably.
- asm-review-performance: proposed an unbounded orphan-ledger BLOCK. Not retained separately: `pendingNested` is cleared after retirement and the host normally emits one reply per request; the concrete correctness failure is retained in W15. A request-token fix also removes the fragile ledger shape.
- asm-review-reuse: canonical-id duplication retained as S10.

## Verification

- Focused Cursor wave suites: passed, 7 files / 338 tests.
- Temporary focused regression: confirmed Cursor IDE `getEntry()` succeeds while `VaultLauncher.resolve(..., "continue")` rejects with `unknown-entry`; scratch file was deleted in the same command.
- `pnpm run check-types`: exited 2 with only the documented pre-existing `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/markdownLite.ts:80` TS2339 error.
- `git show --check --format= 7464593`: passed.
- No changed `.only` or `.skip` tests found.
