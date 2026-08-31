# Review Round 4

- Date: 2026-08-31
- Cycle: 2
- Mode: verification
- Review lane: fastlane
- Scope: current-tree opening/offer integration seam at `dc1e2ad86946bfe2b1a8141e59e8608216c3e7d4`; WT-012.16 implementation range `eb792a5c..538217c2`
- Previous round Head: `f25ad8d53e97a92bf2e514a1d7886e9b0ecc4a33`
- Head: `dc1e2ad86946bfe2b1a8141e59e8608216c3e7d4` (clean tree before review persistence)
- Scope lock: passed — the new opening-lifetime owner was extracted as WT-012.16, independently designed/reviewed/archived, and merged; this round reviews only its integration with WT-012.1's offer seam
- Reviewable lines: 391
- Recorded Verify Gate: the archived WT-012.16 `.build/verified.ndjson` records exit 0 through tasks 1_1–5_1, including focused host/controller/view/assembly witnesses; `asm change verify-status state-what-the-worktree-will-lack` records every parent task through 3_4 at exit 0; review ran no project verify command
- Agents spawned:
  - `asm-review-logic` — opening generation and offer lifetime — `gpt-5.6-sol[1M]`
  - `asm-review-frontend` — closed/replaced form offer acceptance — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — offer-store and close-contract alignment — `sonnet[1M]`
- Agents skipped:
  - `asm-review-data-security` — no new data/auth/input-validation boundary in this verification cone
  - `asm-review-performance` — no changed growth axis; all opening/offer collections are replaced or retired per surface/repository
  - `asm-review-reuse` — no new helper, parser, split, or competing capability in this integration seam
- Verdict: APPROVE
- Counts: 0 BLOCK, 0 WARN, 0 SUGGEST

## Prior finding disposition

### B5
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:1937`
- Title: Host-local generations still do not bind a result to the webview's live opening
- Evidence: Fixed. The panel increments and sends its opening before the host sees the successor (`WorktreeController.ts:810-845`). The host records that exact opening, rechecks it after the provisioning await, and only then issues and posts an offer carrying the same opening (`WorktreeHost.ts:1872-1901, 1937-1947`). The controller rejects a mismatched opening before either cache insertion or dialog application (`WorktreeController.ts:1123-1136`). This closes both sides of the cross-process gap: a predecessor resolving before the successor ask reaches the host is dropped by the already-advanced panel token; one resolving after the ask reaches the host is stopped by the host's live-opening/read-marker check. Repeated asks for one live opening retain the successful read marker until retirement, so they do not start another read.
- Impact: None remaining for B5's stale-reopen or duplicate-read witness.
- SuggestedFix: none
- Status: fixed
- Triage: accepted in round 3; verified fixed in round 4

### B6
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:1813`
- Title: Cancelled and submitted forms still publish late provisioning results
- Evidence: Fixed. `WorktreeView` captures the opening when the dialog mounts and invokes one idempotent retirement path on cancel, submit, replacement, and disposal (`WorktreeView.ts:565-609`). The controller posts that captured opening and immediately advances its live token when it is still current, so an offer already posted but delivered after close is rejected before cache/application (`WorktreeController.ts:546-566, 1123-1136`). On the host, `worktreeCreateClosed` requires equality with the live opening and calls `retireOpening`; that operation drops the live record, every per-repository read marker, every offer for the surface, and the opening's enumeration records (`WorktreeHost.ts:647-672, 1813-1837`). A read completing afterwards fails the post-await guard before `offers.issue`. Supersession and surface detach invoke the same retirement operation (`WorktreeHost.ts:1889-1896, 2850-2864`).
- Impact: WT-012.2 inherits a bounded host-authoritative offer lifetime. After close, `ProvisionOfferStore.lookup({ surface, repoId }, oldOfferId)` cannot resolve because `forgetSurface` removed the record; a later opening cannot accidentally revive it because offer ids are monotonic and the new opening retires the prior surface store before adoption.
- SuggestedFix: none
- Status: fixed
- Triage: accepted in round 3; verified fixed in round 4

## Adjudication notes

- The store's own key remains `{ surface, repoId }`, not `{ surface, repoId, opening }`. This is safe in the current invariant because the host admits at most one live opening per surface and every close, supersession, and detach executes `offers.forgetSurface(surfaceKey)` before another opening is served. The key's effective lifetime is therefore the opening's lifetime across every repository in that form.
- `WorktreeController.provisionOffers` can still contain the last display message after a live offer arrived and the form then closed, but it is not retained authority: host retirement has removed the redeemable record, replies for the retired token are rejected, the disposed form cannot submit, and `openCreateForRepo` clears the map before the next opening is asked or seeded. The accepted scenario requires a result arriving after retirement to change nothing and leave nothing later honoured; that holds.
- A specialist proposed a predecessor-dialog/successor-opening race. It is not reachable through the shipped entry paths: while a create form is interactive, its fixed full-screen scrim intercepts the toolbar/tree controls and its focus trap retains keyboard focus; rapid repeated asks before defaults arrive have no predecessor dialog, and every shipped replacement by another dialog calls `closeDialog` synchronously first. No current user-visible defect remains to report.

## Accepted risk

None.

## Audit backlog

None.
