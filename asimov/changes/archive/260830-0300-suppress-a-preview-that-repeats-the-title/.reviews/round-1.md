# Review Round 1 — suppress-a-preview-that-repeats-the-title

| Field | Value |
|---|---|
| Date | 2026-08-30 |
| Cycle | 1 |
| Mode | discovery |
| Requested mode | fastlane |
| Scope | commit range `16a8f338..8ae1fa6ce11f06aa0488a90b3ee6c617004d87ab` |
| Head | `8ae1fa6ce11f06aa0488a90b3ee6c617004d87ab` |
| Tree state | dirty outside the explicit range (`.analytics-cursor.json` and `analytics.json` advanced during review); not reviewed |
| Reviewable lines | 1,383 (30 production TypeScript + 61 test lines + 1,292 Asimov analytics/build metadata lines) |
| Agents spawned | asm-finder (`gpt-5.6-luna[1M]`); asm-review-contracts (`gpt-5.6-terra[1M]`); asm-review-frontend (`gpt-5.6-luna[1M]`); asm-review-logic (`gpt-5.6-luna[1M]`); asm-review-reuse (`gpt-5.6-luna[1M]`) |
| Agents skipped | data-security — no data/auth/input boundary; performance — constant-time presentation derivation with no collection growth or hot-path recompute change |
| Verdict | APPROVE |
| Counts | BLOCK 0 · WARN 0 · SUGGEST 0 |
| Blocker split | 0 feature · 0 machinery |

> Large change — accuracy may decrease. The line count is dominated by generated Asimov analytics/build metadata; the production behavior change is 30 lines.

## Gate and classification

- Gate 2 is approved. Task 1_1 Acceptance and resolved refs, docs/DESIGN.md D34, and the consistency-registry preview-suppression rule are binding.
- No `proposal.md` exists, so the review used the approved task contract, workflow notes, project design, active specifications, and caller intent as context.
- Reviewable: `asimov/changes/active`, change analytics/build records, `src/webview/worktree/worktreeFormat.ts`, and `src/webview/worktree/worktreeTreeView.ts`.
- Tests reviewed inline: `src/webview/worktree/worktreeFormat.test.ts` and `src/webview/worktree/worktreeTreeView.test.ts`.
- Skipped by classification: change markdown/spec artifacts and `docs/PLAN.md`; they were still read as accepted intent and architecture context, and the requested specification chain was independently audited.
- The committed analytics cursor and analytics/build records are valid, consistently shaped metadata and contain no absolute local filesystem paths.

## Full-flow trace

1. Pane evidence and bounded transcript-tail readers populate `WorktreeAgentRow.title` and optional raw `preview`; preview text is bounded and made single-line before presentation.
2. `worktreeSignature` keys `stripDecorations(row.title)` and raw `row.preview`, exactly the two inputs that can change `presentedPreview`'s result.
3. `WorktreeView.applyAt` rebuilds the DOM when either signature input changes, so equal→different, different→equal, title-normalization, and blank/nonblank transitions cannot remain behind the guard.
4. Every agent-row surface — the main tree, inspector, and removal dialog — reaches the shared `renderAgentRow` builder.
5. `renderAgentRow` derives `previewText` once through `presentedPreview` and feeds both the root focus/hover `data-tip` and the `.wt-apreview` second-line guard from it. Withheld repeats therefore disappear from both surfaces; all other message text reaches `textContent` verbatim.
6. Tooltip delegation resolves the root hint for keyboard focus and cleans up correctly when rebuilt rows replace the old DOM.

No stale-state, alternate-renderer, tooltip, or output-escaping gap was found.

## Specification-chain adjudication

The removal and modification are valid and do not retire behavior still depended upon:

- The active `worktree-agent-presence` requirement, “A preview is message text, not a pane title,” requires leading message markers and marker-only previews to survive intact.
- Commit `837e2ba6` implemented that decision at both presentation boundaries: `renderAgentRow` changed from `stripDecorations(row.preview)` to raw preview, and `worktreeRenderSignature` changed from stripped preview to raw preview. Its signature test was inverted from “spinner-only preview change is unchanged” to requiring a leading-marker change to move the signature.
- Current `docs/design/worktree-panel-ui.md` § 3.3 says the preview is drawn verbatim and not decoration-stripped; § 6.1 says only title frames are stripped before signature calculation.
- Current production search found no `stripDecorations` call over a preview. Existing tests require marker-prefixed and marker-only previews to render, and require every preview change, including a marker change, to repaint.
- Therefore the removed worktree-panel requirement states the opposite of the active specification, current design, shipped code, and tests. Its neighboring “preview that is only decoration” scenario is contradicted by the same newer invariant and is correctly deleted from the modified two-line requirement rather than rehomed.
- The only remaining prose that restates the old decision is historical material: archived change artifacts and the completed WT-009.2 row in `docs/PLAN.md`. The immediately following completed WT-009.5 row records the superseding marker-preservation rule. Neither is a live code/test dependency; blueprint sync can reconcile the historical plan wording separately.

## Verification evidence

- Project verification commands were not rerun by review.
- `bun run asm change verify-status suppress-a-preview-that-repeats-the-title` records task 1_1 at exit 0 with type check and 5,324 unit tests. Its `scope-changed` marker is an import-order-only change in `worktreeTreeView.ts` between the verified tree and the reviewed commit; the behavioral diff is identical.
- The caller reports the I10 gate passing and Biome `src` at its unchanged 4-error / 14-warning / 3-info baseline.
- Added tests cover exact repeat, spinner-decorated title, blank preview, near-match, marker-prefixed and marker-only content, the `(untitled)` placeholder boundary, tooltip de-duplication, and restoration after the preview changes.
- No changed test contains `.only` or `.skip`; no existing marker-preservation assertion was removed or weakened.

## Findings

None.

## Adjudication notes

- Chair review found no defect across logic, frontend, contracts/specification, reuse, render-signature consistency, metadata, and inline test support.
- asm-review-frontend returned no findings and independently confirmed that the same presented value drives the second line and root tooltip, with signature inputs sufficient for every suppression toggle.
- asm-review-logic did not return directly to this chair before adjudication; its result was supplied out of band by the coordinator and reported no findings. Its branch and signature analysis matches the chair's independent trace.
- asm-review-contracts and asm-review-reuse were dispatched but no report returned to this chair before adjudication. No coverage from those specialists is claimed. The chair independently completed the contract-history and reuse/cohesion passes instead.
- asm-finder independently traced the source→row→signature→renderer→tooltip flow and found no live code or test dependency on decoration-stripping previews beyond the stale base clauses this delta removes.

## Accepted risk

None.

## Audit backlog

None.
