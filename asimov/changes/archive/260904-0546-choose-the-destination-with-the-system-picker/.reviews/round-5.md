# Review round 5 — choose-the-destination-with-the-system-picker

- Date: 2026-09-04
- Cycle: 2
- Mode: superseded
- Requested mode: verification
- Lane: fastlane
- Escalation flags: new-api-contract, security-privacy, cross-boundary
- Prior reviewed Head: `3eb2c64cec1c6928e5fe159f6e60dfb5d6007cc1`
- Reviewed scope before stop: exact commits `ec0ea84260f3dc5fd3c9f9771e318f397a3ac0e2`, then `03e2921a573c104827622cb6197b3e46437fd8b7`; no range was used
- Current checkout Head: `0a4ff6fa76817a5e626f35416729058b59993380`
- Tree: dirty only in this change's `analytics.json` after the already-recorded `round-start`; the supersession signal is committed in the explicit scope
- Reviewable lines: 25 added/modified across reviewable source files before the scope-lock stop; 49 changed test lines were classified but not adjudicated
- Agents spawned: none — the verification scope lock stopped the round before specialist dispatch
- Agents skipped: all specialist lenses — no prior witness or remediation impact cone was adjudicated after supersession
- Verdict: **BLOCK** — cycle superseded; round 4's accepted F005 blocker and F006 warning remain unverified
- Counts: 1 prior accepted BLOCK · 2 prior accepted WARN · 0 SUGGEST; 0 new findings adjudicated

## Supersession signal

The explicit remediation scope contains a semantic contract delta after cycle 2's gate set was frozen:

- `asimov/changes/choose-the-destination-with-the-system-picker/specs/worktree-panel/spec.md` changes `An opened picker holds the form until it is answered` from withholding Create only to also withholding the action that opens another picker, and adds a normative second-picker scenario.
- `asimov/changes/choose-the-destination-with-the-system-picker/tasks.md` adds task 5_1 with new Acceptance, Boundary, Refs, and Plan obligations for that behavior.

The production expression and tests may implement the intended F005/F006 remediation, and the caller's standing replan grant explains why the contract moved. That does not make the move verifiable inside the existing cycle: a new or semantically changed task/contract is an explicit verification scope-lock trigger. Adjudicating the implementation against an obligation introduced after round 4 would silently move cycle 2's frozen gate set.

The `src/types/messages.ts` comment correction in `ec0ea842` and the `WorktreeHost.ts` F007 comment correction do not independently trip the lock. No specialist reviewed the one-line control change, its test witnesses, or the impact manifest after the contract signal was identified.

## Prior gate set

No round-4 witness was reproduced or adjudicated in this superseded round. Prior dispositions carry forward unchanged:

- F005 — the single picker slot loses an earlier confirmed pick when a newer picker ends without a folder — accepted BLOCK, unverified.
- F006 — the approved repository-switch late-answer witness is missing — accepted WARN, unverified.
- F007 — retiring an Opening can leave its still-visible form waiting on a picker that never opens — accepted WARN residual; not re-reported and not widened here.

F001 remains fixed. The author's remediation summary, impact manifest, test evidence, and recorded verify-gate status remain context for the next review; scope lock prevented treating them as reviewed evidence here.

## Next review

Route the contract/task delta back through plan Gate 2. The next user-initiated review starts cycle 3 in discovery mode and persists as global `round-6.md`; numbering does not reset. It should review the intended exact picker commits without sweeping the interleaved archived changes, carry F005–F007 under their existing IDs, and adjudicate the amended contract and implementation together.
