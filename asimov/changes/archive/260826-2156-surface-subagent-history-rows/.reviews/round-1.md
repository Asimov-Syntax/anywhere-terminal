# Review Round 1

- Date: 2026-08-27
- Cycle: 1
- Round: 1
- Mode: discovery
- Scope: working tree
- Reviewable lines: 1723
- Note: Large change — accuracy may decrease
- Agents spawned:
  - asm-review-contracts — delegation contracts and reader normalization — gpt-5.6-sol[1M]
  - asm-review-logic — host async cache and publication races — gpt-5.6-terra[1M]
  - asm-review-frontend — lazy expansion and roster rendering — sonnet[1M]
  - asm-review-data-security — transcript read identity boundary — gpt-5.6-terra[1M]
  - asm-review-performance — transcript and cache growth axes — gpt-5.6-luna[1M]
  - asm-review-reuse — mapper/key/outcome reuse — gpt-5.6-luna[1M]
- Support spawned: asm-finder — end-to-end delegation flow trace — gpt-5.6-luna[1M]
- Agents skipped: none
- Verdict: REJECT
- Counts: BLOCK 5 | WARN 1 | SUGGEST 0
- Verification: `pnpm run check-types` passed; 156 focused tests passed; full unit suite passed (196 files, 3769 tests). Three targeted review repros failed as described below and were deleted after execution.

## Findings

### B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeController.ts:79
- title: The expansion request never reaches WorktreeHost
- evidence: The changed controller posts `requestWorktreeSubagents`, but the only production provider switches that dispatch worktree messages handle only `requestWorktreeTree` and `worktreeViewVisibility` (`TerminalViewProvider.ts:1282-1288`, `TerminalEditorProvider.ts:639-645`). A repository-wide inventory finds no provider forwarding for the new request; host tests call `WorktreeHost.handleMessage` directly and therefore bypass the missing integration.
- impact: Every real sidebar, panel, and editor expansion remains in `Reading…`; no transcript is read and the feature is non-functional in every supported surface.
- suggestedFix: Forward `requestWorktreeSubagents` through both providers beside the existing worktree messages, and add provider-level routing tests for view and editor surfaces.
- status: accepted
- triage: Accepted — found independently during WT-005.1 discovery before this report and recorded in workflow.md Notes. Confirmed at TerminalViewProvider.ts:1284-1291 and TerminalEditorProvider.ts:641-647. The fix is not the suggested extra case: two hand-kept enumerations are what produced the defect, and WT-005.1 adds seven more types to the same switches. Routing becomes a membership test derived from the message union with a compile-time exhaustiveness check, so an unrouted type fails the build.

### B2

- ID: B2
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-contracts
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/delegations.ts:25
- title: Actual reader output can produce two rows for one delegation
- evidence: `rosterFromDetail` maps every `subagent` and every `subagentSession` independently, but those variants are not disjoint in actual reader output. OpenCode appends its `subtask` step and its direct-child stub separately; Claude can retain an unmatched spawn step plus an unmatched child stub, and its existing `subagentCount` logic explicitly compensates for that representational duplication. A targeted `mapOpencodeRows` → `rosterFromDetail` repro for one subtask plus its child failed with two rows instead of one.
- impact: The accepted specification's “one row per delegated subagent” invariant is broken; users see duplicate history, one duplicate lacks stable drill-down identity, and the inflated mapped count can mask incompleteness.
- suggestedFix: Give logical delegations an enforceable correlation identity or normalize each reader to one timeline representation per invocation before roster mapping. Add reader-to-roster contract tests for matched, unmatched, and mixed Claude/OpenCode/Codex/Cursor shapes.
- status: accepted
- triage: Accepted, and it falsifies accepted design. design.md D6 asserts 'A timeline carries one item per delegation, so the two kinds cannot double-count one call.' True for Claude (detail.ts:785-797 is an if/else — a matched stub pushes stubToItem INSTEAD of the plain step), false for OpenCode: opencodeReader.ts:544-551 pushes a `subagent` step per `subtask` part and :759-761 pushes a `subagentSession` stub per child row, uncorrelated. Choosing between correlating the two or normalizing each reader to one representation is a design decision, not a fix — handed back to asimov-plan.

### B3

- ID: B3
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-frontend
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/worktreeTreeView.ts:462
- title: An incomplete empty roster is rendered as definitive emptiness
- evidence: `renderSubagentSection` returns `No delegations found` whenever `rows.length === 0`, before it can inspect `incomplete`. The contract permits `{ kind: "ok", rows: [], incomplete: true }` when all recoverable delegation rows were omitted. A targeted view repro confirmed that this state renders only `No delegations found`; the changed tests cover empty-complete and nonempty-incomplete, but not their intersection.
- impact: The UI makes the exact false claim this change is intended to prevent: it tells the user a session delegated nothing when the reader knows delegation evidence was dropped.
- suggestedFix: Handle `incomplete` before or together with the empty-row branch and add a zero-row incomplete test that never renders definitive emptiness.
- status: accepted
- triage: Accepted. worktreeTreeView.ts returns on `roster.rows.length === 0` before reaching the incomplete note, so {kind:'ok', rows:[], incomplete:true} renders a bare 'No delegations found' — the exact claim D5 exists to prevent, at the one state where the reader knows it is wrong. Fix is in the accepted contract: the empty branch must consult `incomplete` first.

### B4

- ID: B4
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-performance, asm-review-frontend
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeView.ts:147
- title: Webview roster state outlives the host's row/session cache lifetime
- evidence: `requestedRosters` grows monotonically by `(rowId, entryId)` and is never pruned, while the host deliberately evicts a roster when its row leaves the published presence. If the same row/session returns, the host needs a fresh request but the view suppresses it forever; a targeted remove/re-add/re-expand repro produced one request instead of two. The related `expandedRows` set is keyed only by `rowId`, so a row that remains present but loses `entryId` can keep an expanded `Reading…` section after its disclosure affordance and request path disappear. Boundary inventory: session replacement is safe; host row eviction is safe; webview row disappearance/reappearance and loss of session identity are affected; render-signature separation is safe.
- impact: Rows can become permanently stuck in `Reading…` or show an unreachable stale section, and the set also grows without bound along the per-session churn axis.
- suggestedFix: Reconcile requested keys against the currently published `(rowId, entryId)` pairs, remove keys when a row/session leaves, and clear expansion when a live row no longer has an entryId. Add reappearance and entryId-loss lifecycle tests.
- status: accepted
- triage: Accepted, all three sub-claims. `requestedRosters` is never pruned while the host evicts against published rows, so a row that leaves and returns under the same (rowId, entryId) is suppressed by the view and sits at 'Reading…' with no roster ever arriving. A row that loses its entryId keeps an expanded section with no gutter to collapse it. Unbounded growth is the same defect. Reconciling the requested set against published identities is within the accepted contract.

### B5

- ID: B5
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: asm-review-contracts, chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/opencodeReader.ts:745
- title: A successful capped child read is published as complete
- evidence: The changed verdict marks child omission only when `childRes.status !== "ok"`, but the successful child query is independently capped at `CHILD_LIMIT` (100) without an overflow probe or authoritative total. When a session has more than 100 direct children, the detail carries no `partial` signal; because `stats.subagentCount` prefers `childStubs.length` when nonzero, it also reports 100 rather than a count greater than the mapped rows. Growth axis: direct delegations per session is not structurally capped by the source, while this read silently caps it.
- impact: Older direct delegations are dropped while the roster is presented without `incomplete`, violating D5 and the accepted source-omission requirement.
- suggestedFix: Read `CHILD_LIMIT + 1` (or an authoritative count), retain the first 100, and emit a partial/source-omission verdict when overflow exists. Add a successful overflow test.
- status: accepted
- triage: Accepted, and it exposes a gap in accepted design. CHILD_LIMIT = 100 (opencodeReader.ts:51) is applied at :698 with no overflow probe, while every sibling bounded query in the same read has one (msgProbeRes, partProbeRes). `subagentCount` counts only `subtask` parts, so D5's third signal cannot see it. D5 claims three signals cover source omission; this is a fourth path, in the reader rather than the mapper. The probe is mechanical, but D5's completeness claim has to be restated — handed back with B2.

### W1

- ID: W1
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/delegations.ts:34
- title: Plain delegation task descriptions are discarded
- evidence: The mapper copies `subagent.title` but ignores `subagent.prompt`. Actual unmatched Claude `Task`/`Agent` timeline items and OpenCode `subtask` items populate `prompt` and usually no `title`; the renderer then falls back to the role name. The mapper unit test supplies an artificial `title`, so it does not exercise the producer shapes.
- impact: Delegations without a matched child transcript—the evidence-thinnest rows this change intentionally preserves—often show only `librarian`/`reviewer` rather than what was delegated, contrary to the project UI anchor's task-description-primary rule.
- suggestedFix: Preserve a bounded task label for plain items, such as `title ?? prompt`, or normalize the label at the reader boundary; test with actual Claude and OpenCode mapper output.
- status: accepted
- triage: Accepted. Verified against the producers: vault/types.ts:241-247 makes `subagent.title` and `prompt` both optional while `subagentSession.title` is required, and detail.ts:788-796 / opencodeReader.ts:549 populate `prompt` and leave `title` unset on the unmatched path. So exactly the thin-evidence delegations D6 keeps both kinds FOR are the ones that render a role name. `title ?? prompt` with producer-shaped tests.

## Adjudication notes

- Dropped the reuse agent's shared-key BLOCK: both current implementations are identical and there is no present behavioral divergence; extraction is not a must-fix defect.
- Dropped the raw-error-path warning: the reason is rendered with `textContent` to the same local user whose vault is being read; no cross-user or injection boundary was demonstrated.
- Dropped the O(N²) row lookup warning: lookup occurs once per first expansion and the project contract expects row counts in the tens, so no material hot-path impact was established.
- The logic agent's synchronous-throw race is not gating: the only production reader is an `async` function, so production failures become rejected promises after the in-flight key is installed.
