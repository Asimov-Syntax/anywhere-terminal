# Review Round 6

- Date: 2026-08-31
- Cycle: 3
- Mode: discovery
- Review lane: fastlane
- Escalation flags: new-api-contract, cross-boundary, re-review
- Scope: range `c7fc268d55ea8e2c1cdd63f2e6c878269fec62bc..0cdeaf1cb96043ca41fb65fa0367ac2371a0c226`
- Head: `0cdeaf1cb96043ca41fb65fa0367ac2371a0c226` (tree dirty after the reviewed range: modified `asimov/changes/resolve-a-selection-before-the-create-runs/analytics.json`)
- Reviewable lines: 128
- Cycle start: cycle 3 discovery is required because D5 and D8 were amended and D9 was added after round 5; the cycle-2 gate set was not treated as a verification scope
- Recorded Verify Gate: `bun run asm change verify-status resolve-a-selection-before-the-create-runs` records tasks `7_1`, `7_2`, and `7_3` exit 0; `workflow.md` records check-types clean, 5,992/5,992 unit tests, I10 ok, and the unchanged 3-error / 14-warning / 1-info Biome baseline outside this change; review ran no project verify command
- Agents spawned:
  - `asm-review-frontend` — dialog destination ownership, detached mode, submit gate, and assembly coverage — `gpt-5.6-sol[1M]`
  - `asm-review-logic` — async opening ownership and post-await races — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — cross-boundary candidate/target and mode translation — `sonnet[1M]`
  - `asm-review-data-security` — destination trust boundary and stale-answer authority — `gpt-5.6-luna[1M]`
- Auxiliary flow mapping: `asm-finder` traced entry, probe, response routing, submit, host admission, and all mutation modes
- Agents skipped:
  - `asm-review-performance` — no persistence, growing collection, full-history recompute, or changed hot-path growth axis in this range; `stillOurs` is an O(1) read of the existing bounded opening slot
  - `asm-review-reuse` — no added reusable capability, mirrored implementation, parser/encoder, or split-cohesion surface
- Verdict: BLOCK
- Counts: 1 BLOCK, 0 WARN, 0 SUGGEST
- Split: 1 feature blocker, 0 machinery blockers
- Gate status: B11 is gating. Round-5 B3, B7, B10, and W7 are fixed at their named invariants; B11 is a distinct presentation leak from the discarded detached classification mode.

## Findings

### B11
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-frontend`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:1553`
- Title: Detached mode still states the discarded classification's action
- Evidence: The cycle-3 change correctly keeps a detached resolution in `effective` so its destination can drive `draft.path`, and the switch at lines 1564-1566 correctly prevents `resolution.mode` from changing `draft.branchMode`. But `syncDerived` still renders `ACTION_BY_MODE[effective.mode.kind]` at lines 1246-1250. Therefore every detached resolution states the host's classification of the ref as the pending action even though submit omits `resolved` and `WorktreeController` emits `fresh-detached`. The added detached test supplies `mode.kind: "reattach"`, making the form state “Repairs the stale registration…” while the request creates a detached worktree; a normal `fresh` answer similarly says it creates a new branch although detached creates none. Invariant inventory — required invariant: the action stated before submit describes the same operation the form submits. Boundaries searched: resolution application, form branch mode, action note, destination target, draft carriage, controller mode translation, host admission, and mutation source. Affected: the action statement for every detached answer. Verified safe: detached destination ownership, detached resolution gate, omission of `resolved`, controller `fresh-detached` translation, and all non-detached action statements.
- Impact: The confirmation UI can tell the user that Create will repair a stale registration, reuse a branch, or create a new branch while the click actually creates a detached worktree. This breaks the accepted before-submit action contract at the user's decision point even though the destination and wire request are correct.
- SuggestedFix: Derive the action statement from the form's effective execution mode, so detached always states a detached create while continuing to consume the resolution's destination and discard its classification mode. Extend the detached unit case to assert that `#wt-action-note` describes the submitted detached operation and never the discarded resolution mode.
- Status: open
- Triage: New in cycle-3 discovery. Escalated from the frontend specialist's WARN to BLOCK because the wrong text is not auxiliary guidance: D5/D8 and the primary added requirement require the dialog to state what the create will actually do before the user submits, and the changed detached path now states a different operation from the one sent on the wire.

- Status: accepted
- Author-Triage: Correct, and mine — 7_1 retained `effective` under detached so the answer's destination could drive `draft.path`, and the action note reads the same object's MODE. D5 as amended already decides this: the toggle outranks the classification's mode, and the action statement is a statement of mode, so the leak is remediation under an existing decision rather than a new one. Fixed as task 7_4: the action text derives from the mode the form will actually execute, and the detached regression test asserts `#wt-action-note`.

## Prior findings resolved in this discovery

- B3 — fixed: `supplied` remains the probe candidate and ask identity, while a matching resolution's `targetOf(effective)` now owns the displayed destination, `draft.path`, submission, and issued mutation target; the occupied-override assembly walk makes candidate and target differ.
- B7 — fixed: `answerCreateProbe` re-resolves `(surface, repository, token)` through `stillOurs()` after every await and before posting; the three observable departure windows prove no corroboration, base resolution, or post survives repository removal.
- B10 — fixed at its gate and destination invariant: detached no longer bypasses `resolutionOutstanding`, consumes the answer's destination, omits `resolved`, and translates downstream to `fresh-detached`. B11 is a different mechanism: the discarded mode still leaks into the action statement.
- W7 — fixed: the assembly suite now crosses an occupied fresh override where candidate and target differ and a standing override followed by reattach, asserting the stated, posted, and executed target across the real seam.

## Full-flow trace

- Entry/opening: `WorktreeController.openCreateForRepo` rotates the opening token, requests defaults and one refs enumeration, and binds the dialog.
- Selection/identity: the dialog's ask key covers repository, branch/ref, base, and supplied candidate; the controller adds a monotonic sequence; the host admits only the current opening and sequence.
- Resolution: the host vets candidate containment, resolves destination/classification/base, re-identifies ownership after each await, and posts token+sequence; the controller rejects stale opening or sequence before the dialog applies the answer.
- Submission by mode: fresh and reuse carry the applied classification; reattach carries its repair identity and target; detached consumes only the resolved target and translates independently to `fresh-detached`; adopt continues to fall back to fresh.
- Mutation boundary: the host runtime-validates the create payload; fresh/reuse/detached paths go through absolute/symlink/containment/emptiness checks and recheck identity, while reattach re-establishes stale registration and checkout proof before repair.
- Error/fallback: unresolved selections remain gated; unresolvable bases are stated before submit; failed ref enumeration follows the accepted fail-open-to-fresh rule with git as backstop; departed openings post nothing.

## Audit backlog

None.
