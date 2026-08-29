## 1. A real source for the second line

- [x] 1_1 Read a session's last activity from the end of its transcript, bounded — verified: pnpm exec vitest run 'src/vault/readers/lastActivity.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/agent-session-index/spec.md#metadata-only-bounded-title-preview-no-egress · specs/worktree-agent-presence/spec.md#a-preview-is-bounded-and-single-line-before-it-travels · design.md#{d1-a-narrow-tail-reader-over-file-backed-transcripts-not-the-detail-reader, d1b-one-usable-record-predicate-per-format-and-a-stated-scan-budget}
  - **Acceptance**:
    - Outcome: a transcript's last activity comes back as one bounded line, whatever the file's size
    - Verify: unit src/vault/readers/lastActivity.test.ts
  - **Plan**:
    0. Files: `src/vault/readers/lastActivity.ts`, `src/vault/readers/lastActivity.test.ts`.
    1. Build the reader the Ref's interface names. It seeks the END of the file and walks backwards; it must not stream the whole transcript the way `claudeRecords.ts` does for the detail path — that is the cost this task exists to avoid.
    2. The format is a parameter, never inferred from content. The two usable-record rules the Ref cites live in existing readers; take them from there rather than restating a schema here.
    3. The Ref's two bounds are both load-bearing and neither is optional: the growing window has a cap, and a record still unseen at the cap is `null`. "Return the last message" and "never read the head" cannot both hold for a record larger than any window.
    4. Bound the line with the vault's existing `boundedPreview`, so the two previews the spec admits are bounded by one implementation rather than two that can drift.
    5. An unopenable or malformed file is `null`, never a throw — the caller's whole failure story is the absence of a preview.
    6. Cover: the last message returned from a file whose head would answer differently; a file larger than one read window answered without reading its head; each format's own usable-record rule, including a record the OTHER format would have accepted; a record spanning a window boundary still found after growth; a record past the cap answered `null` rather than read on; a multi-line and over-long message bounded before it is returned; a marker-only line surviving as itself; a corrupt tail line skipped rather than fatal; an absent file answered `null`.

- [x] 1_2 Serve previews from one owner that knows when not to look — verified: pnpm exec vitest run 'src/worktree/sessionPreviewService.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-agent-presence/spec.md#a-scan-that-finds-no-new-activity-reads-no-transcript · design.md#{d1a-coverage-is-file-backed-transcripts-only-and-that-is-a-stated-limit, d2-the-preview-service-owns-the-stamp-the-cache-and-the-rate}
  - **Acceptance**:
    - Outcome: a rebuilt scan over unchanged sessions opens no transcript and makes no new syscall
    - Verify: unit src/worktree/sessionPreviewService.test.ts
  - **Plan**:
    0. Files: `src/worktree/sessionPreviewService.ts`, `src/worktree/sessionPreviewService.test.ts`.
    1. Build the service the Ref's table describes. It is the ONE owner of freshness, rate, in-flight de-duplication and eviction — the projector gets a one-argument call and holds nothing.
    2. Verified here rather than through the projector on purpose: a mocked dep cannot prove an unchanged transcript was not opened. These tests count real reads and real `stat`s against a real temporary file.
    3. Resolving an `entryId` to a transcript path and its format is the service's, and it covers exactly the sources the Ref names — a session it has no path for is answered `undefined` without a syscall.
    4. Cover: a first ask reading once; a second ask inside the re-check interval making NO syscall at all; an ask after the interval with an unchanged stamp doing one `stat` and no open; a moved stamp doing exactly one read; a size-only change and an mtime-only change each counting as moved; concurrent asks for one session sharing a single read; an uncovered source answered without touching the filesystem; the cache bounded rather than growing per session seen.

- [x] 1_3 Put the preview on the row — verified: pnpm exec vitest run 'src/worktree/presenceProjector.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: specs/worktree-agent-presence/spec.md#{an-agent-row-s-preview-line-says-what-its-session-last-did, a-missing-preview-is-a-normal-row-not-a-degraded-scan} · design.md#d3-absence-is-not-degradation
  - **Acceptance**:
    - Outcome: a covered row carries its session's last activity and an uncovered one carries nothing
    - Verify: unit src/worktree/presenceProjector.test.ts
  - **Plan**:
    0. Files: `src/worktree/presenceProjector.ts`, `src/worktree/presenceDeps.ts`, `src/extension.ts`, `src/worktree/presenceProjector.test.ts`.
    1. Add the dep beside `sessionTitle`, in the same optional shape and for the same reason: it opens a transcript, so the projector's own tests must run without one.
    2. The pass over rows mirrors `titleFromVault`'s shape — but NOT its ownership. The projector holds no stamp and no cache; it asks once per covered row and writes what comes back.
    3. A row with no answer gets no `preview` key. Not an empty string — the layout WT-009.2 shipped draws no second line only when nothing survives, and a placeholder is what the Ref forbids.
    4. `degradedSources` is untouched on this path, and nothing else on the row is derived from a preview.
    5. Wire the service at the same place `sessionTitle` is wired.
    6. Cover: a covered row carrying its last activity; an uncovered row carrying no preview key; a scan of only-uncovered rows reporting no degraded source; a row's identity, activity and ranking unchanged by the presence or absence of a preview; the projector running at all with no preview dep supplied.

- [x] 1_4 Stop treating a preview as a pane title — verified: pnpm exec vitest run 'src/webview/worktree/worktreeTreeView.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-agent-presence/spec.md#a-preview-is-message-text-not-a-pane-title · design.md#d4-the-preview-is-message-text-so-it-never-meets-the-titles-stripper
  - **Acceptance**:
    - Outcome: a preview keeps the leading bullet marker it opens with
    - Verify: unit src/webview/worktree/worktreeTreeView.test.ts
  - **Plan**:
    0. Files: `src/webview/worktree/worktreeTreeView.ts`, `src/webview/worktree/worktreeRenderSignature.ts`, `src/webview/worktree/worktreeTreeView.test.ts`, `src/webview/worktree/worktreeRenderSignature.test.ts`, `src/webview/worktree/WorktreeView.test.ts`, `src/webview/worktree/WorktreeRemoveDialog.test.ts`.
    1. WT-009.2 sent the preview through the title's stripper at both the render and the signature. Take it out of both; the preview arrives bounded and newline-stripped from 1_1's reader and needs nothing further.
    2. `stripDecorations` itself does not change. Its contract is shared with `title` and with the host's own stripping, and narrowing the regex would move an accepted contract this change does not own — the Ref records why.
    3. Three existing suites assert the behaviour being reversed: they require a spinner-prefixed PREVIEW to be stripped. Their provenance assumption is what moved, so change the assumption rather than leaving a builder to find unrelated-looking failures. The same suites' TITLE assertions stay exactly as they are.
    4. The signature must still move when the preview moves, and still not move for a title's spinner tick. Two different inputs to one string, and only one of them stops being stripped.
    5. Cover: `"- item"` and `"* item"` surviving intact in the rendered row and its tooltip; a preview that is only a marker still drawing a second line; a spinner tick in the TITLE still stripped and still not moving the signature; a changed preview still moving it.

## 2. Round-1 review fixes

- [x] 2_1 Close the round-1 blockers and their accepted warnings — verified: pnpm exec vitest run 'src/worktree/sessionPreviewService.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1, 1_2, 1_3, 1_4
  - **Refs**: .reviews/round-1.md#{b1-spec-delta-silently-deletes-two-accepted-prohibitions-from-a-privacy-requirement, b2-a-null-transcript-resolution-is-cached-for-the-process-lifetime-and-a-resolved-path-is-never-re-resolved} · design.md#{d1b-one-usable-record-predicate-per-format-and-a-stated-scan-budget, d2-the-preview-service-owns-the-stamp-the-cache-and-the-rate}
  - **Acceptance**:
    - Outcome: a session whose transcript resolves late gets its preview, and one whose transcript is gone loses it
    - Verify: unit src/worktree/sessionPreviewService.test.ts
  - **Plan**:
    0. Files: `asimov/changes/source-the-agent-row-preview/specs/agent-session-index/spec.md`, `src/worktree/sessionPreviewService.ts`, `src/worktree/sessionPreviewService.test.ts`, `src/vault/readers/lastActivity.ts`, `src/vault/readers/lastActivity.test.ts`, `src/vault/readers/codexReader.ts`, `src/extension.ts`.
    1. B1 — the delta restates its base in full, so restore every clause the base carries and widen only the one the fork approved. The cache prohibition, its storage-location constraint and the subject all come back.
    2. B2 — unresolved and uncovered stop being the same state. One retries on the ordinary cadence, the other short-circuits with no syscall forever, and a `stat` that fails on a path already resolved drops back to unresolved rather than pinning it.
    3. W1 — the code and the test move to the artifacts, not the other way: the spec and the design's failure surface both already say an unreadable transcript carries no preview.
    4. W2 and W6 — resolution stops being this module's own. The Codex branch calls the repo's existing rollout resolver, fallback and containment included; the Claude branch uses the path the entry already carries, which is also what makes the delta's wording true.
    5. W4, S1 and S2 — the reader's three bound defects: decode only the bytes actually read, do not discard a record the window boundary happened to align with, and never read past the cap.
    6. S3, S5 and S6 — the agent field takes the vault's own union, a swallowed lookup stops advancing the cadence as if it had answered, and eviction stops stranding a read still in flight.
    7. Cover: a session unresolvable on the first ask and resolvable on the next; an uncovered source still costing nothing however often it is asked; a resolved path that disappears re-resolving rather than freezing; a deleted transcript ending with no preview; a Codex rollout found by the repo's fallback when the index path is stale; a short read not eating the newest record; a record ending exactly on a window boundary still found; each format's usable-record rule unchanged.

- [x] 2_2 Stop an unresolvable row paying for a tree walk on the freshness cadence — verified: pnpm exec vitest run 'src/worktree/sessionPreviewService.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: .reviews/round-2.md#b1-r2-the-two-fixes-together-walk-the-entire-codex-sessions-tree-every-2-s-forever · design.md#d2-the-preview-service-owns-the-stamp-the-cache-and-the-rate
  - **Acceptance**:
    - Outcome: a row whose transcript never resolves stops costing a scan per interval
    - Verify: unit src/worktree/sessionPreviewService.test.ts
  - **Plan**:
    0. Files: `src/worktree/sessionPreviewService.ts`, `src/worktree/sessionPreviewService.test.ts`, `src/vault/readers/lastActivity.ts`, `src/vault/readers/lastActivity.test.ts`, `asimov/changes/source-the-agent-row-preview/design.md`.
    1. B1-R2 — retrying a resolution and re-checking a known file are two different questions and stop sharing one interval. Consecutive failures decay their own retry; a success puts the entry back on the freshness cadence.
    2. W1-R2 — the gate becomes an explicit next-attempt time that BOTH outcomes set, so a rejected look can no longer leave the entry with no rate limit at all.
    3. W2-R2 — the re-seat tests absence, not inequality: a newer entry for the same id wins and the stale one is dropped.
    4. S1-R2 — the no-hint recovery is Codex-only in fact, so it says so; the Ref's own note on how a Claude row recovers instead goes with it, and the round-1 manifest row is corrected.
    5. S2-R2 — the short read is testable after all, by the Ref's method. The reader takes one optional seam for opening, used by nothing in production.
    6. W3-R2 — D1a is amended to describe the resolution that ships, including what the fallback costs. The coverage decision itself does not move.
    7. Cover: an unresolvable row's scans falling off rather than recurring per interval; a resolution that succeeds putting the entry back on the freshness cadence; a rejected lookup still rate-limited; a stale entry not displacing a newer one; a file truncated between the reader's own stat and read not losing its newest record.

- [x] 2_3 Ask the vault only when a re-resolve actually needs it — verified: pnpm exec vitest run 'src/worktree/sessionPreviewService.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_2
  - **Refs**: .reviews/round-3.md#b1-r3-the-tree-walk-invariant-survives-at-the-deps-entry-boundary · specs/worktree-agent-presence/spec.md#a-scan-that-finds-no-new-activity-reads-no-transcript · design.md#d2-the-preview-service-owns-the-stamp-the-cache-and-the-rate
  - **Boundary**: bounded extension round — the stated hypothesis only. No new capability, no seam extraction, no widening of what a row carries.
  - **Acceptance**:
    - Outcome: a healthy row's repeat look asks neither the vault nor the store where its transcript is
    - Verify: unit src/worktree/sessionPreviewService.test.ts
  - **Plan**:
    0. Files: `src/worktree/sessionPreviewService.ts`, `src/worktree/sessionPreviewService.test.ts`, `asimov/changes/source-the-agent-row-preview/design.md`.
    1. B1-R3 — the entry is needed to RE-resolve, not to re-check. Hold it beside the target it resolved, and go back to the vault only when there is no usable target. The gate the Ref names is what a healthy row must not pay.
    2. W1-R3 — the retry counter keys off whether a look achieved something, not off what the target happens to say. Confirming an unchanged stamp or completing a read is progress; nothing else is.
    3. W2-R3 — the reject path stops being special. The Ref's own once-per-interval sentence outranks the faster-retry suggestion that produced the floor, so a rejecting entry decays like any other unproductive look.
    4. S1-R3 — the eviction test is rewritten to observe the clobber it was supposed to catch, which needs the two entries to hold different lines. Revert-check it this time.
    5. S2-R3 and S3-R3 — the design's published signature matches the code, and the retry rate is filed under the decision that owns rates.
    6. Cover: a healthy repeat look asking the vault nothing; a look that resolves nothing still backing off; a null entry over a stale target not resetting the retry; a rejecting lookup gated at the cadence rather than eight times inside it; a newer entry surviving a stale one whose read was still in flight.

- [x] 2_4 State the invariant the recovery path rests on — verified: pnpm exec vitest run 'src/worktree/sessionPreviewService.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_3
  - **Refs**: .reviews/round-4.md#s2-r4-the-comment-credits-a-mechanism-this-commit-removed
  - **Acceptance**:
    - Outcome: the paired clear that makes recovery work is named and enforced, not incidental
    - Verify: unit src/worktree/sessionPreviewService.test.ts
  - **Plan**:
    0. Files: `src/worktree/sessionPreviewService.ts`, `src/worktree/sessionPreviewService.test.ts`.
    1. The comment explains recovery by a mechanism the previous task deleted. Replace it with what actually carries it, and make the paired clear read as load-bearing rather than as a line beside it that looks redundant.
    2. The pairing is what the whole cache rests on, so it gets an assertion of its own rather than being left to a reader's care.
