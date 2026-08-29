# Review Round 1 — source-the-agent-row-preview

- **Date**: 2026-08-30
- **Cycle**: 1
- **Mode**: discovery
- **Scope**: commit range `1a907750..HEAD` (5 commits: ae76beca, 837e2ba6, 7dbd0258, 2bd13fd4, f19874e8)
- **Head**: f19874e8 — tree dirty only in `analytics.json` / `.analytics-cursor.json` (skipped class)
- **Reviewable lines**: ~396 added across 7 reviewable files (+ 2 spec deltas reviewed by the chair inline)
- **Agents spawned**: 6 (logic x2, data-security, performance, frontend, contracts). Reuse skipped — covered by the chair (W2).
- **Verdict**: BLOCK
- **Counts**: 2 BLOCK / 6 WARN / 10 SUGGEST
- **Split over gating blockers**: 2 feature / 0 machinery
- **Verify gate**: not re-run by review. Cited from workflow.md — type check, `biome check src` at its pre-existing baseline (5 errors / 14 warnings / 3 infos, identical to the 1a907750 clean tree), 5109 unit tests, I10 fs-deletion gate, all observed passing.

---

## B1 — Spec delta silently deletes two accepted prohibitions from a privacy requirement

- **Severity**: BLOCK · **Confidence**: HIGH · **Priority**: P1
- **Agent**: chair (corroborated by asm-review-contracts)
- **Class**: feature
- **File**: `asimov/changes/source-the-agent-row-preview/specs/agent-session-index/spec.md:5-11`
- **Evidence**: The base requirement (`asimov/specs/agent-session-index/spec.md:53-60`) ends: "The system SHALL NOT read message bodies beyond the first preview line, **SHALL NOT persist or cache any transcript content beyond the bounded title preview**, and SHALL NOT send any vault data off the machine", and permits caching only "under the extension's storage". A MODIFIED delta restates the requirement in full, so what it omits is deleted. The delta drops (a) the `SHALL NOT persist or cache any transcript content beyond the bounded preview` prohibition entirely, replacing it with the permissive "Previews and metadata MAY be cached locally in an owner-only (`0o600`) store", and (b) the "under the extension's storage" location constraint. It also re-scopes the requirement's subject from "The system" to "A listing" and adds "This governs the **listing** path only" — a second widening beyond the one the user approved.
- **Impact**: The change's own proposal lists as a Non-goal: "Egress. The `0o600` cache and the never-off-the-machine clause are unchanged and out of scope to reopen." The delta reopens them. The shipped code does not exploit the gap (asm-review-data-security confirmed: in-memory Map only, no disk write, no logging, no telemetry, `VaultCacheStore` untouched), so this is a contract defect, not a live leak — but `bun run asm change apply` writes this text into `asimov/specs/` permanently, and every later change is reviewed against it. Approved scope was one MAY; three clauses moved.
- **SuggestedFix**: Restate the base clause with only the intended widening: `... SHALL NOT read message bodies beyond those two lines, SHALL NOT persist or cache any transcript content beyond the two bounded previews, and SHALL NOT send any vault data off the machine`, and restore "under the extension's storage" to the cache permission. Either drop the "listing path only" re-scoping or raise it explicitly as a second decision for the user, since it is not the fork recorded in the PLAN task's Notes.
- **Status**: accepted · **Triage**: Confirmed against the base at `asimov/specs/agent-session-index/spec.md:53-60` — all three clauses are there and my delta dropped them. The proposal's Non-goals name the cache and egress clauses as out of scope to reopen, so this is a drafting error, not a decision. Restoring them is remediation, not a handback: no `D#` moves and no invariant owner is minted — the artifacts go back to the decision already recorded. The listing-only re-scoping goes too; the approved fork was one MAY.

## B2 — A `null` transcript resolution is cached for the process lifetime, and a resolved path is never re-resolved

- **Severity**: BLOCK · **Confidence**: HIGH · **Priority**: P1
- **Agent**: asm-review-logic (corroborated by chair)
- **Class**: feature
- **File**: `src/worktree/sessionPreviewService.ts:118-124`
- **Evidence**: `look()` guards resolution with `if (current.target === undefined) { current.target = await resolve(entry); }`. `resolve()` returns `null` for a Codex entry whose `sessionPath` is absent or fails containment, and for a Claude session `resolveClaudeSessionPath` cannot locate. `null !== undefined`, so `resolve()` is never called again for that `entryId` while its `Held` survives the 256-entry LRU. There is no invalidation in the other direction either: a successfully resolved `target.path` is pinned for the process lifetime, so a transcript that moves (Claude re-encodes its project dir when the session's cwd changes) leaves the service stat-ing a path that no longer exists.
- **Impact**: Defeats Task 1_3's Acceptance ("a covered row carries its session's last activity") for a covered source. D2's freshness contract is defined purely over the file's `(mtimeMs, size)`; a permanently-unresolvable target is not a state the design admits. Reachable through the ordinary case the repo already knows about: `codexReader.ts:1293-1302` exists precisely because `threads.rollout_path` is unreliable, and it falls back to a filename scan — see W2. Combined with the pinned-path half, a moved transcript freezes the row's preview on old text with no path back.
- **SuggestedFix**: Treat `null` as "recheck later", not "final": re-run `resolve()` on the normal `recheckMs` cadence whenever `target` is `null`, and re-resolve when `stat` on a previously-resolved path fails. Distinguish the two states in `Held` (`unresolved` vs `uncovered-by-source`) so a genuinely uncovered provider still short-circuits with no filesystem work.
- **Status**: accepted · **Triage**: Real, and it defeats 1_3's Acceptance for a covered source. `null` will mean "retry on the recheck cadence" and a distinct `uncovered` state will keep the no-syscall short-circuit for OpenCode/Cursor; a `stat` failure on a resolved path drops back to unresolved.

## W1 — An unreadable or deleted transcript keeps its stale preview, contradicting the requirement this change ships

- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P2
- **Agent**: asm-review-contracts (corroborated by asm-review-logic, chair)
- **Class**: feature
- **File**: `src/worktree/sessionPreviewService.ts:128-130, 150`
- **Evidence**: `if (!stamp) { return current.line; }` on `stat` failure, and `look(...).catch(() => current.line)` on read failure. The ADDED requirement in `specs/worktree-agent-presence/spec.md` § "An agent row's preview line says what its session last did" states: "A row the reader does not cover — ... **or a transcript it cannot read** — SHALL carry no preview line at all". design.md § Failure surface says the same: "Failed / malformed read: **Fails open**: the row carries no preview". The test `keeps a preview when the transcript disappears rather than failing` (`sessionPreviewService.test.ts`) enshrines the opposite.
- **Impact**: The code, its test, the design's failure-surface table, and the spec delta disagree about the same behavior. A row can keep showing message text from a session whose transcript has been deleted — which on a security-privacy-flagged change means bounded sensitive text outliving the file it came from.
- **SuggestedFix**: Pick one and make all four agree. If retaining the line is intended (it is defensible against mtime flapping), amend the ADDED requirement and design.md rather than leaving the shipped spec contradicted by the shipped test.
- **Status**: accepted · **Triage**: Four artifacts disagree and two of them are the accepted spec and the design's failure surface. Resolving toward the artifacts — the code and its test move, not the spec. Cheaper than amending an accepted requirement, and it is the answer the security-privacy flag argues for: bounded message text should not outlive the file it came from.

## W2 — Codex resolution reimplements the repo's containment helper and drops its rollout fallback

- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P2
- **Agent**: chair
- **Class**: feature
- **File**: `src/worktree/sessionPreviewService.ts:104-110, 170-173`
- **Evidence**: `isInside(candidate, root)` (lines 170-173) is byte-identical in behavior to `isUnder(p, root)` at `codexReader.ts:1065-1068` — same `path.relative`, same three conditions. More consequentially, `codexReader.ts:1293-1302` already owns this exact decision: `pickRolloutPath(thread, sessionId, sessionsDir)` returns "the index's `rollout_path` when it is contained, **else a scan by filename**" via `findCodexRolloutByFilename` (line 1071). The preview service takes the first half and drops the fallback, returning `null` where the repo's own resolver would have found the file.
- **Impact**: A Codex session whose `threads.rollout_path` is absent, stale, or points outside the sessions dir gets no preview, even though the rollout exists and the repo already knows how to locate it by the uuid in its filename. That is the population B2 then pins to `null` permanently. Also two copies of one containment rule, which is how the two drift.
- **SuggestedFix**: Export and call `pickRolloutPath` (or the `isUnder` + `findCodexRolloutByFilename` pair) from `codexReader.ts` instead of the local `isInside`. The scan is bounded and runs once per entry, behind the resolution cache.
- **Status**: accepted · **Triage**: Reuse-first. `pickRolloutPath` already owns this decision including the filename fallback my copy dropped; it will be exported and called, and the local `isInside` deleted with it.

## W3 — Lexical containment follows a symlink out of the Codex sessions root

- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P3
- **Agent**: asm-review-data-security (severity adjudicated down from BLOCK by the chair)
- **Class**: feature
- **File**: `src/worktree/sessionPreviewService.ts:170-173`
- **Evidence**: `isInside` is purely lexical — no `fs.realpath` on either the candidate or the root. `<codex>/sessions/link.jsonl` passes the check while symlinking anywhere on disk, and both `fs.stat` and `readLastActivityLine` follow it. Nothing constrains the filename, the `.jsonl` suffix, or binds the path to the validated `sessionId`.
- **Chair adjudication**: the specialist rated this BLOCK. Downgraded on two pieces of specific evidence. (1) Lexical containment is the repo's established discipline, not this change's shortcut: `claudePaths.ts` uses the identical `path.relative` test in three resolvers (`resolveClaudeSessionPath`, `resolveClaudeSubagentPath`, `resolveClaudeWorkflowAgentPath`) and `codexReader.ts:1065` in a fourth; `grep -rn realpath src/` returns no production call site at all. (2) The escape yields output only for a file that parses as Codex-shaped JSONL with an `event_msg` / `user_message|agent_message` payload, and planting the symlink requires write access to `~/.codex/sessions/` — the same access needed to write a real rollout with arbitrary content. No privilege is gained. Real hardening, not a must-fix regression.
- **Impact**: A poisoned Codex store could surface one bounded line from a Codex-shaped transcript outside the approved tree on an unrelated row.
- **SuggestedFix**: `fs.realpath` both the candidate and the sessions root before the containment test, failing closed when either cannot resolve; require the expected rollout filename shape. Worth doing repo-wide rather than only here.
- **Status**: audit-backlog · **Triage**: Valid and non-gating, on the chair's own evidence: lexical containment is the repo's established discipline in four other resolvers and no privilege is gained. Fixing it here alone would make this the only path with a different rule, which is worse than consistent. Backlogged as repo-wide work — `realpath` both sides in `claudePaths.ts` (3 sites), `codexReader.ts:1065`, and this service together.

## W4 — A short read is decoded as content, so NUL padding silently eats the newest record

- **Severity**: WARN · **Confidence**: MEDIUM · **Priority**: P3
- **Agent**: asm-review-logic
- **Class**: feature
- **File**: `src/vault/readers/lastActivity.ts:53-55`
- **Evidence**: `await handle.read(buf, 0, buf.length, start)` discards the returned `bytesRead`, and `buf.toString("utf8")` decodes the whole zero-filled `Buffer.alloc(size - start)`. The specialist probed it: `trim()` does not strip NUL, so a partially-filled buffer produces a line that fails `JSON.parse` and is skipped by `usableText`. `size` is snapshotted once at line 45 and never refreshed across doublings.
- **Impact**: If the transcript is truncated or rewritten between the `stat` and the `read`, or on any short read (fuse/network-backed worktree), the final real record fuses with a NUL run and is silently dropped. The row shows an older message or `null`, indistinguishable from "no record".
- **SuggestedFix**: `const { bytesRead } = await handle.read(...)` and decode `buf.subarray(0, bytesRead)`.
- **Status**: accepted · **Triage**: A one-line correctness fix with no argument against it: decode `buf.subarray(0, bytesRead)`.

## W5 — The LRU caps memory, not work: above 256 rows every rebuild is a full miss

- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P3
- **Agent**: asm-review-performance (severity adjudicated down from BLOCK by the chair)
- **Class**: feature
- **File**: `src/worktree/sessionPreviewService.ts:84-93`
- **Evidence**: Growth axis: projected agent rows, N. `held` is bounded at `DEFAULT_PREVIEW_CACHE_CAP = 256`, but the panel has no row cap. With N > 256 visited in stable order, rows 257..N evict rows 1..N-256; the next rebuild starts at row 1 and misses every entry, bypassing the `recheckMs` gate entirely. Each miss costs `entry()` + resolve + `stat` + possible `read`; each Claude miss adds one `readdir` of the projects root plus up to P candidate `stat`s. At the 150 ms rebuild cadence that is up to 6.67 N resolutions/s against the intended N/2 freshness checks/s.
- **Chair adjudication**: the specialist rated this BLOCK under the data-scale rule. Downgraded because the trigger is a row population — panes in one VS Code window plus running agent sessions under the shown worktrees — that does not plausibly reach 256. The cliff is real and the axis is genuinely uncapped, so it stays a WARN rather than being dismissed; "small today" is not the argument, "structurally implausible in this surface" is.
- **Impact**: A cliff rather than a curve: performance is nominal up to the cap and then degrades to a full re-resolution per row per 150 ms.
- **SuggestedFix**: Size the cap against the projected row set — either let the projector hand the service its live entry-id set as an admitted generation with a separately bounded inactive tier, or set `cap` well above any plausible row count and assert the relationship.
- **Status**: audit-backlog · **Triage**: Valid, non-gating, and the chair already adjudicated the trigger implausible — the row population is this window's panes plus running sessions under the shown worktrees. The suggested fix hands the projector's live entry-id set to the service, which moves ownership D2 assigns; that is a design change, not remediation, so it belongs in a change of its own rather than this fix round.

## W6 — "a transcript it already has a path to" does not describe what the Claude branch does

- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P3
- **Agent**: asm-review-contracts
- **Class**: feature
- **File**: `specs/agent-session-index/spec.md:7` vs `src/worktree/sessionPreviewService.ts:97-101`
- **Evidence**: The widened requirement authorizes extracting a last-activity preview "from a session whose transcript it **already has a path to**". `PreviewEntry` carries `sessionPath`, but the Claude branch ignores it and calls `resolveClaudeSessionPath(entry.sessionId, ...)`, which `readdir`s the projects root and `stat`s a candidate per project dir to **derive** a path the listing did not have.
- **Impact**: The condition meant to narrow the widening does not constrain the implementation, and the implementation is outside the wording as written. Whichever way it is resolved, the two must say the same thing — this is the exact risk the proposal named ("The spec amendment under-scoped").
- **SuggestedFix**: Either reword to authorize id-based derivation under the store root explicitly, or use the supplied `sessionPath` with the same containment check the Codex branch uses.
- **Status**: accepted · **Triage**: The clause meant to narrow the widening does not describe the Claude branch. Fixed on the code side, not the spec side: the Claude branch will use the `sessionPath` the entry already carries, containment-checked like the Codex one, which makes the wording true and drops a `readdir` off the resolution path.

## S1 — `lines.shift()` discards a complete record on a newline-aligned window boundary

- **Severity**: SUGGEST · **Confidence**: MEDIUM · **Priority**: P4 · **Agent**: asm-review-logic · **Class**: feature
- **File**: `src/vault/readers/lastActivity.ts:59`
- **Evidence**: The shift is unconditional whenever `start > 0`. When `size - window` lands one byte past a `\n`, `lines[0]` is a whole record. Probed: a buffer starting after the `\n` of `{"old":1}\n{"new":2}\n` yields `["{\"new\":2}", ""]`; after `shift()` only `[""]` remains. Harmless below the cap (the next doubling re-reads it), but at `window === MAX_WINDOW_BYTES` there is no next doubling.
- **Impact**: A transcript whose only usable record in the last 1 MiB sits at that aligned first line answers `null` despite being fully inside the cap — a false negative D1b's "past the cap" story does not cover.
- **SuggestedFix**: Read one byte earlier when `start > 0` and shift only when that byte is not `0x0a`.
- **Status**: accepted · **Triage**: Cheap and real, and the cap case has no next doubling to recover it. Read one byte earlier and shift only when that byte is not a newline.

## S2 — The read cap holds only because MAX is a power-of-two multiple of INITIAL

- **Severity**: SUGGEST · **Confidence**: MEDIUM · **Priority**: P4 · **Agent**: asm-review-logic · **Class**: feature
- **File**: `src/vault/readers/lastActivity.ts:50-53, 67`
- **Evidence**: The loop reads with `window`, then tests `window >= MAX_WINDOW_BYTES` afterwards. `64 KiB x 2^4 = 1 MiB` lands exactly on the cap today, and both constants are exported (the test imports them), so they are a public knob.
- **Impact**: Latent — any future `INITIAL_WINDOW_BYTES` that is not a power-of-two divisor makes the last iteration allocate and read past the documented cap (100 KiB → 1.6 MiB), breaking D1b's second bound with no test noticing.
- **SuggestedFix**: `window = Math.min(window * 2, MAX_WINDOW_BYTES)` in the update expression.
- **Status**: accepted · **Triage**: One-liner; the bound should not depend on an arithmetic coincidence between two exported constants.

## S3 — `PreviewEntry.agent` is a bare `string`, bypassing `VaultAgentId`

- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P4 · **Agent**: asm-review-contracts · **Class**: feature
- **File**: `src/worktree/sessionPreviewService.ts:18`
- **Evidence**: `agent: string` compared against `"claude"` / `"codex"` literals, while `src/vault/types.ts:28` already defines `VaultAgentId` and the rest of the vault interfaces use it.
- **Impact**: Adding a provider forces no compile-time decision about preview coverage — it silently lands in the uncovered branch. D1a is a deliberate limit, and a deliberate limit is worth making the type system enforce.
- **SuggestedFix**: Type it `VaultAgentId` and switch exhaustively with an explicit unsupported case.
- **Status**: accepted · **Triage**: `VaultAgentId` exists and D1a's limit is deliberate enough to want the compiler enforcing it.

## S4 — A raw preview can carry the render signature's field separators

- **Severity**: SUGGEST · **Confidence**: MEDIUM · **Priority**: P4 · **Agent**: asm-review-frontend · **Class**: feature
- **File**: `src/webview/worktree/worktreeRenderSignature.ts:92-94`
- **Evidence**: `r.preview ?? ""` joins with `FIELD_SEP` / `ROW_SEP` / `SECTION_SEP`, which are `String.fromCharCode(1)`, `(2)` and `(3)`. `boundedPreview` collapses `\s+`, which does not match U+0001-U+0003, so those characters survive into the signature.
- **Chair note**: not introduced by this diff — `stripDecorations(r.title)`, `r.agent` and `r.viewId` have the identical exposure today, and a transcript message containing a raw C0 control is exotic. Recorded, not gating.
- **Impact**: In principle two distinct row states could serialize identically and skip a repaint.
- **SuggestedFix**: Escape the three separators (or length-prefix fields) at signature build time, keeping the raw value for rendering.
- **Status**: audit-backlog · **Triage**: Pre-existing on `title`, `agent` and `viewId` — this diff adds a fourth field with a property the signature already has. The fix is an encoding change to the shared join, which touches every field's contract and belongs to the signature's owner rather than to this change. Backlogged with that scope.

## S5 — `.catch(() => current.line)` swallows a failing lookup and still advances `checkedAt`

- **Severity**: SUGGEST · **Confidence**: MEDIUM · **Priority**: P4 · **Agent**: asm-review-logic · **Class**: feature
- **File**: `src/worktree/sessionPreviewService.ts:150-156`
- **Evidence**: If `deps.entry()` or `resolveClaudeSessionPath` throws, the error is discarded unlogged, the previous line is returned as if the check succeeded, and the `finally` bumps `checkedAt` so the next real attempt is deferred a full `recheckMs`.
- **Impact**: A persistently failing resolve is indistinguishable from "nothing changed" and leaves no signal anywhere.
- **SuggestedFix**: Log the caught error before falling back.
- **Status**: accepted · **Triage**: Folded into the B2/W1 fix — the swallow and the unconditional `checkedAt` advance are the same code path those two rewrite.

## S6 — Eviction can strand a live in-flight read

- **Severity**: SUGGEST · **Confidence**: MEDIUM · **Priority**: P5 · **Agent**: asm-review-logic · **Class**: feature
- **File**: `src/worktree/sessionPreviewService.ts:84-93`
- **Evidence**: `touch()` runs before the in-flight check and evicts from the front. If enough distinct entries are asked for while A's `look()` is pending, A's `Held` leaves `held` while `inflight` is still live; the completed read then writes `stamp`/`line` into an orphaned object, and the next ask for A re-runs the whole cycle.
- **Impact**: Redundant `stat`/`read` beyond what the cap and rate are meant to bound, exactly under the churn where the cache matters most. No correctness loss for the original caller.
- **SuggestedFix**: Skip entries with a live `inflight` during eviction, or re-insert on settle if the id was evicted mid-flight.
- **Status**: accepted · **Triage**: Small and in the same function as B2's fix.

## S7 — `previewFromVault` serializes independent worktree batches

- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P5 · **Agent**: asm-review-performance · **Class**: feature
- **File**: `src/worktree/presenceProjector.ts:462-470`
- **Evidence**: `for (const [worktreeId, rows] of Object.entries(...)) { await Promise.all(rows.map(...)) }` — each worktree's batch is awaited before the next starts, so miss-path latency is the sum of per-worktree maxima, not the global maximum. There is no timeout on `stat` or `read` anywhere in the service.
- **Chair note**: mirrors the pre-existing `titleFromVault` shape in the same file, so it is the established pattern rather than a new one; the missing timeout is new surface but on read-only local files.
- **Impact**: A slow filesystem read on one worktree delays every worktree after it in iteration order.
- **SuggestedFix**: One outer `Promise.all` over the worktree batches.
- **Status**: audit-backlog · **Triage**: Performance-only, on a path already gated by the recheck interval, and a timeout on `stat`/`read` is a new failure-surface decision rather than remediation.

## S8 — Delegated / subagent rows are uncovered despite the repo having a resolver

- **Severity**: SUGGEST · **Confidence**: MEDIUM · **Priority**: P5 · **Agent**: chair · **Class**: feature
- **File**: `src/worktree/sessionPreviewService.ts:97-101`
- **Evidence**: Delegated rows carry composite entry ids — `claude:s1:subagent:a` (`delegations.test.ts:23`, `agentIdentity.test.ts:74`). `parseEntryId` splits on the first `:`, yielding `sessionId = "s1:subagent:a"`, which `isSafeSessionId` (`/^[A-Za-z0-9._-]+$/`) rejects, so `resolveClaudeSessionPath` returns `null`. Meanwhile `resolveClaudeSubagentPath` exists in the same module and resolves exactly this shape.
- **Impact**: Every delegated child row is permanently preview-less. That is a normal row under D3, so it is not a defect — but D1a states coverage as "Claude JSONL", and this is Claude JSONL the reader already knows how to find. The limit is real and undocumented.
- **SuggestedFix**: Either route `SUBAGENT_MARKER` ids through `resolveClaudeSubagentPath`, or state the subagent exclusion in D1a so the gap is a decision rather than a side effect of id parsing.
- **Status**: audit-backlog · **Triage**: Not a defect — D3 makes an uncovered row normal, and delegated rows behave correctly. What is missing is a sentence in D1a, and editing design.md is a handback; it rides with the next change that opens that file.

## S9 — No projector-level test that a moved stamp replaces the row's preview

- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P5 · **Agent**: asm-review-contracts · **Class**: feature
- **File**: `src/worktree/presenceProjector.test.ts:668-750`
- **Evidence**: The spec scenario "A session that has moved on — THEN that session's transcript is read again and **its row's preview is replaced**" is verified only at the service's own output (`reads exactly once when the stamp has moved`). No test carries the replacement through to a projected row.
- **Impact**: The seam between a changed service answer and a changed row is untested; every other scenario in the delta has a focused test.
- **SuggestedFix**: One projector test where a stubbed `sessionPreview` returns a different line on the second `project()` and the row's `preview` follows.
- **Status**: rejected · **Triage**: The projector's dep is mocked, so a projector-level test of "a moved stamp replaces the preview" would assert that a stub returned two different strings. That is the exact non-proof oracle finding 6 moved this verification to the service for, where it runs against a real file and counts real syscalls. Adding it would look like coverage without being any.

## S10 — For a short session the preview repeats the title verbatim

- **Severity**: SUGGEST · **Confidence**: MEDIUM · **Priority**: P5 · **Agent**: chair · **Class**: feature
- **File**: `src/worktree/presenceProjector.ts:449-472`
- **Evidence**: `titleFromVault` sets the row title from the vault entry, whose Claude title is `boundedPreview(first user message)`. `claudeActivity` accepts `user` prompt records, so for a session with one user message and no assistant reply yet, last activity == first user message == title. Both lines then carry identical text, and both feed `el.dataset.tip`, which joins them with `\n` — the tooltip shows the line twice.
- **Impact**: Cosmetic, on a `user-visible-ui` change whose stated purpose is that "a second line that never has content is worse than no second line". A second line that duplicates the first is the adjacent failure and nothing in design.md or the deltas addresses it.
- **SuggestedFix**: Suppress the preview when it equals the row title, at the projector where both are known.
- **Status**: audit-backlog · **Triage**: Real, and a row drawing the same sentence twice is worth fixing — but "suppress the preview when it equals the title" is a new rule about what a row shows, which neither the spec nor D3 carries. It needs a decision, not a patch.

---

## What was checked and found clean

- **D1 honoured**: `readLastActivityLine` never goes through `detail.ts`'s streaming path; it imports only the `extractText` helper. Cost is flat in transcript size, worst case ~1.94 MiB cumulative across the doubling series with a 1 MiB ceiling per read.
- **D1b predicate parity**: `claudeActivity` matches `classifyClaudeStyleEvents` (`detail.ts:640-655`) — sidechain/meta dropped, `interruptedMessageId` → notice, `isCompactSummary` → compaction, tool-result-only → drop. `codexActivity` matches `classifyCodexRolloutEvents` (`codexReader.ts:864-895`). Format is a parameter and never inferred; both cross-format rejection cases are tested.
- **D2 single ownership**: the projector holds no stamp, no cache, no alive set — verified at `presenceProjector.ts:452-471`. The in-flight de-duplication has no interleaving hole (`inflight` is assigned synchronously before any await) and is always cleared in `finally`.
- **D3 absence**: `return preview ? {...row, preview} : row` correctly emits no key for both `undefined` and `""`; `degradedSources` is untouched on this path; the projector never asks about a row with no `entryId`. All four covered by tests.
- **D4 provenance**: `stripDecorations` is gone from both preview call sites and unchanged in shape; `agentRowTitle` (`worktreeFormat.ts:326`) still strips the title. No production path derives `preview` from a pane title. No repository test still asserts the old stripped-preview behavior.
- **Privacy posture in code**: the preview never reaches disk, a log, telemetry, or an external process. `VaultCacheStore`'s `0o600` write path is untouched. `textContent` (not `innerHTML`) everywhere, and `Tooltip.ts` also assigns `textContent` — no injection surface.
- **Store roots**: `new VaultService({...})` takes no root overrides, so the service's default `claudeRoots` / `codexStoreDirs` resolve against the same roots the vault uses. No divergence.
- **Claude id safety**: `isSafeSessionId` rejects traversal before any path join, and the resolved candidate is containment-checked. No id-syntax escape.

## Verification-gate evidence

Not re-run by review, per the chair's standing rule. Cited from `workflow.md`: type check, `pnpm exec biome check src` at the pre-existing baseline (5 errors / 14 warnings / 3 infos, identical to the clean 1a907750 tree, all in files this change does not touch), 5109 unit tests, and `pnpm run gate:fs-deletion` (I10) observed passing.

## Sub-agents spawned

| Specialist | Region | Lens | Model |
|---|---|---|---|
| asm-review-logic | `lastActivity.ts` | tail-walk bounds, predicates, torn records | `opus[1M]` |
| asm-review-data-security | `sessionPreviewService.ts`, `extension.ts`, both spec deltas | path containment, privacy of transcript text on a passive row | `gpt-5.6-terra[1M]` |
| asm-review-logic | `sessionPreviewService.ts`, `presenceProjector.ts` | caching, races, eviction, freshness | `sonnet[1M]` |
| asm-review-performance | reader + service + projector + signature | growth axes, hot path, recompute | `gpt-5.6-terra[1M]` |
| asm-review-frontend | `worktreeTreeView.ts`, `worktreeRenderSignature.ts` | render, signature, tooltip, a11y | `gpt-5.6-luna[1M]` |
| asm-review-contracts | both spec deltas vs. the shipped interfaces | delta well-formedness, scenario coverage | `gpt-5.6-luna[1M]` |

Reuse lens not staffed as a specialist; covered by the chair (W2).


## Author's fix record — round 1

Fixed in commit range below: B1, B2, W1, W2, W4, W6, S1, S2, S3, S5, S6.

Backlogged (valid, non-gating, rationale in each finding's Triage): W3, W5, S4, S7, S8, S10.
Rejected: S9.

Two things a re-review should check rather than take from me:

- **W4 ships without a dedicated regression test.** `handle.read`'s `bytesRead` is now honoured and
  only those bytes are decoded, but a genuinely short read is not reachable deterministically from a
  unit test without stubbing `node:fs`. The existing suite proves no regression; it does not prove the
  fix. Called out rather than claimed as covered.
- **B2's recovery path changed shape during the fix.** Re-resolving on the recheck cadence alone does
  not escape a dead path, because containment is lexical and the entry's own hint keeps pointing at
  it — so a failed `stat` now re-resolves *without* the hint, which is what runs the repo's filename
  fallback. The moved-transcript case therefore recovers on the first ask after the move, not the
  second. `re-resolves a transcript that moved instead of pinning the old path` asserts the read
  sequence, not just the value.

Impact manifest for the service rewrite (the fix touches routing, cache behaviour and error handling,
so the reachable states are enumerated here rather than left to the fix hunk):

| Entry state | Behaviour now | Verified by |
|---|---|---|
| uncovered source (opencode, cursor) | short-circuits before any syscall, permanently | `keeps costing nothing for an uncovered source however often it is asked` |
| covered, no transcript yet | retried each interval; no line | `previews a session whose transcript only appears later` |
| covered, index path stale | repo filename fallback resolves it | `finds a codex rollout the index did not name, by the repo's own fallback` |
| covered, path outside the store root | never opened, stays unresolved | `never opens a codex rollout outside the sessions dir`, `never opens a claude transcript outside the projects dir` |
| resolved, stamp unmoved | one `stat`, no open | `stats but does not open a transcript whose stamp has not moved` |
| resolved, stamp moved | exactly one read | `reads exactly once when the stamp has moved` + the two stamp-component tests |
| resolved, file moved | Codex: re-resolves and reads the new path in one ask. Claude: the no-hint path is inert there, so it recovers on the SECOND ask, when `deps.entry()` re-derives the path by id — corrected in round 2 (S1-R2); the row above overstated it | `re-resolves a transcript that moved instead of pinning the old path` (Codex) |
| resolved, file deleted | preview dropped, back to unresolved | `drops the preview when the transcript is gone` |
| `entry()` throws | no line, cadence not advanced, next ask retries | `retries on the next ask rather than waiting out an interval it never used` |
| concurrent asks | one read shared | `shares one read between concurrent asks for the same session` |

The projector, the reader's format predicates, and every D4 render/signature path are untouched by this
round.
