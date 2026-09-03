# Review Round 12

- Date: 2026-09-03
- Cycle: 3
- Mode: verification
- Review lane: fastlane
- Escalation: security-privacy, re-review
- Scope: range `4f986c80d772138299d93d6b49ef0c22f4dec4bf..b0dcafba10fc5db3e5d2df10ca150ea208d9823f`; verification delta `7edb1c329b4d566cc50eaf413a0a2784073c5e01..b0dcafba10fc5db3e5d2df10ca150ea208d9823f` (task 12_1)
- Head: `b0dcafba10fc5db3e5d2df10ca150ea208d9823f` (tree dirty only because the open review round updated `asimov/changes/re-register-a-surviving-checkout/analytics.json`)
- Reviewable lines: 31
- Large change: no
- Scope lock: clear. Task 12_1 changes only the four enumerated F018 passages plus task-completion and review metadata. No assertion or runtime behavior changes, no new capability, no new or semantically changed `D#`, and no new invariant owner.
- Accepted context: workflow Gate 2 is approved; task 12_1, design D4/D9, and the withdrawal requirements in `specs/worktree-panel/spec.md` govern the verification.
- Recorded Verify Gate: `bun run asm change verify-status re-register-a-surviving-checkout` reports task 12_1 complete, exit 0, `scope-unchanged`, with the integration header comment as the only suite change and no assertion delta. Review ran no project verify command.
- Risk map: semantic authority of accepted design and code/test commentary describing repository-owned Git administrative state; locked-first construction; descriptor-owned emptying; ownership-gated marker unlink; collectable handoff. No new persistence, public API, frontend, performance, or reuse surface enters the delta.
- Behavioral cone: D4/D9 and task 12_1 -> the four enumerated passages -> current `adoptWorktree` withdrawal/construction behavior and the unit/integration witnesses that establish it.
- Agents spawned/skipped:
  - `asm-review-contracts` — F018 semantic reconciliation and Gate 2 boundary — `gpt-5.6-terra[1M]`; completed, no findings.
  - `asm-review-data-security` — destructive Git-state commentary — `sonnet[1M]`; spawned, but its report became unavailable when the child terminated after the chair's premature return. It was not relied on in adjudication and is recorded as unrun for this closed round. The chair independently covered the destructive filesystem boundary.
  - `asm-review-logic` skipped — no production logic or assertion changed; the verification question is conformance of four passages to an existing mechanism.
  - `asm-review-frontend` skipped — no frontend surface in the cone.
  - `asm-review-performance` skipped — no growth axis, recomputation, or hot path in the cone.
  - `asm-review-reuse` skipped — no helper, split, parser, or duplicated capability in the delta.
- Verdict: APPROVE
- Counts: 0 BLOCK, 0 WARN, 0 SUGGEST

## Findings

### F018
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/asimov/changes/re-register-a-surviving-checkout/design.md:326`
- Title: The four remaining lifecycle passages now match D4
- Evidence: The round-11 witness is closed at every inventoried boundary. D9 now says the undo empties the entry and hands it to Git's collection. The orphan `AdoptFs` JSDoc promising recursive entry removal is deleted, leaving the interface's explicit single-file removal contract and no recursive-removal member. `stillOurLink` now describes the entry the undo is about to empty, matching the actual link-first then descriptor-truncate order. The integration header now assigns `locked` the pre-`gitdir` construction interval and assigns the live-path `gitdir` fact only the interval between populated `gitdir` and the final link write. The subject-based inventory covered every comment block in `adoptWorktree.ts`, `adoptWorktree.test.ts`, and `adoptWorktree.integration.test.ts`, plus every lifecycle line in `design.md`, `spec.md`, and `proposal.md`; no other current passage prescribes entry-directory deletion or attributes pre-`gitdir` protection to `gitdir`.
- Impact: The approved D4 withdrawal/construction contract is stated consistently across the accepted design and the current source/test commentary. Builders and reviewers are no longer directed toward the superseded recursive-deletion or `gitdir`-first mechanisms.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed from round 11. All four exact witnesses are reconciled, and the inventory no longer expands because task 12_1 replaced predicate/phrase sweeps with a subject-complete enumeration.
- Invariant: `locked` protects the whole construction interval; a completed withdrawal deletes no entry directory, empties `gitdir`, removes only the owned marker, hands the entry to Git's collection, and requires no entry path; failed empty/unlock remains locked and named.
- Boundary inventory: checked D4 sequence/state table/residuals, D9 ownership passage, proposal, withdrawal spec, task 12_1, all comment blocks in the implementation and both test files, the withdrawal implementation, and the integration prune witnesses. Affected in round 11 and now fixed: `design.md:326-327`, the deleted former `adoptWorktree.ts:144`, `adoptWorktree.ts:397-401`, and `adoptWorktree.integration.test.ts:1-16`. Verified safe: every other inventoried lifecycle passage, including historical/refuted mechanism descriptions that are explicitly marked as such.

## Adjudication notes

- The four passages task 12_1 changed now match D4. The contracts specialist independently reached the same conclusion and found no contract or pattern issue.
- The author's decision not to reopen Gate 2 is sustained. The lifecycle's remediation boundary requires planning re-entry only for a new or semantically changed `D#` or a new invariant owner. Task 12_1 introduces neither: it reconciles prose to D4, which has owned the no-delete, locked-first mechanism since the round-7 handback. Reapproving unchanged D4 would not approve a new obligation.
- Round 11's handback recommendation was justified while phrase-level inventories kept expanding. Its substantive requirement was an enumerated semantic reconciliation rather than another cited-line patch; task 12_1 supplied and recorded that complete inventory. The completed inventory resolves the reason for handback without creating a Gate 2 signal.
- The current implementation remains evidence for the prose: undo settles the link first, truncates the held entry `gitdir`, ownership-gates only the `locked` unlink, and reports no entry path after a collectable handoff. No assertion, test behavior, or production behavior changed in this delta.
- No audit-backlog or accepted-risk entry exists.
