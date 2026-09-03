# Review Round 11

- Date: 2026-09-03
- Cycle: 3
- Mode: verification
- Review lane: fastlane
- Escalation: security-privacy, re-review
- Scope: range `4f986c80d772138299d93d6b49ef0c22f4dec4bf..7edb1c329b4d566cc50eaf413a0a2784073c5e01`; verification delta `071d517814abaaf867407a6fa0b530626194424d..7edb1c329b4d566cc50eaf413a0a2784073c5e01` (task 11_1)
- Head: `7edb1c329b4d566cc50eaf413a0a2784073c5e01` (tree dirty only because the open review round updated `asimov/changes/re-register-a-surviving-checkout/analytics.json`)
- Reviewable lines: 58
- Large change: no
- Scope lock: clear. Task 11_1 changes only names, comments, accepted-artifact prose, and task-completion metadata inside F018's remediation cone. No assertion or runtime behavior changes, no new capability or D#, and no new invariant owner.
- Accepted context: workflow Gate 2 is approved; task 11_1, design D4/D9, the obligation ledger, and the withdrawal requirements in `specs/worktree-panel/spec.md` govern the verification.
- Recorded Verify Gate: `bun run asm change verify-status re-register-a-surviving-checkout` reports task 11_1 complete, exit 0, `scope-unchanged`, with test-name/comment changes only and no assertion delta. Review ran no project verify command.
- Risk map: authority and internal consistency of accepted artifacts and code/test commentary describing repository-owned Git administrative state; locked-first construction; descriptor-owned emptying; ownership-gated marker unlink; collectable handoff; conditional residue reporting. No persistence growth, hot path, public API, frontend, or reuse surface enters this delta.
- Behavioral cone: accepted `proposal.md`, `design.md`, `specs/worktree-panel/spec.md`, and `tasks.md` -> D4/D9 construction and withdrawal claims -> `adoptWorktree` comments and implementation -> unit/integration witness names and rationales -> `worktreeMutationService` residue reporting.
- Agents spawned:
  - `asm-review-contracts` — D4 mechanism claims and accepted-artifact conformance — `gpt-5.6-terra[1M]`
  - `asm-review-data-security` — destructive Git-state claims and declared boundary — `sonnet[1M]`
- Agents skipped:
  - `asm-review-logic` — no production logic or assertion changed; the verification question is mechanism-description conformance
  - `asm-review-frontend` — no frontend behavior in the cone
  - `asm-review-performance` — no growth axis, recomputation, or hot path in the cone
  - `asm-review-reuse` — no helper, split, parser, or duplicated capability in the delta
- Verdict: BLOCK
- Counts: 1 BLOCK, 0 WARN, 0 SUGGEST

## Findings

### F018
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/asimov/changes/re-register-a-surviving-checkout/design.md:326`
- Title: The claim-level sweep still leaves four live passages describing superseded mechanisms
- Evidence: Task 11_1 fixes every passage named in its plan, including the ledger witness at `design.md:397`, which now matches the `nlink === 0` assertions. But four current, non-historical passages still contradict D4. `design.md:326` says the undo “then removed” the entry. `src/worktree/adoptWorktree.ts:144` is an orphan interface comment promising “Recursive removal of the entry directory this adoption created,” despite `AdoptFs` offering only the single-file `removeFile`. `src/worktree/adoptWorktree.ts:402` repeats that the undo is “about to remove” the entry. `src/worktree/adoptWorktree.integration.test.ts:6-10` still presents the prune fact as what “lets gitdir be written first,” while the implemented construction writes `locked` first and uses the live-path fact only to keep the interval between `gitdir` and the final link write inert. The implementation instead truncates the held entry `gitdir`, ownership-gates unlink of `locked`, and reports `entryPath: null` after a collectable handoff (`src/worktree/adoptWorktree.ts:478-519`, `527-550`).
- Impact: Task 11_1's accepted outcome, “No passage in this change describes a withdrawal that removes an entry,” remains false. A live approved design passage and current implementation/test commentary still teach deletion or the obsolete construction rationale, so builders and reviewers can derive a mechanism the code deliberately does not perform.
- SuggestedFix: Reconcile all four passages to D4: say the undo hands the entry to Git's collection rather than removing it; delete the orphan recursive-removal comment; and rewrite the integration header to distinguish `locked`-first protection of the whole construction interval from the live-path fact that permits the final link write to stay last. Because F018's inventory has expanded in rounds 8, 9, 10, and 11 despite phrase-level and claim-level sweeps, hand the accepted artifacts and commentary inventory back to planning for one enumerated semantic reconciliation rather than another cited-line patch.
- Status: accepted
- Triage: Persists from rounds 8, 9, and 10. The round-10 witness at `design.md:397` is fixed, but materially new evidence finds the same invariant and causal mechanism at four more current boundaries. Severity remains BLOCK because the approved task's explicit acceptance outcome is still falsified.
- Invariant: Approved design, task, implementation commentary, and test rationale must state one achievable withdrawal/construction contract: `locked` protects the whole construction interval; a completed withdrawal deletes no entry directory, empties `gitdir`, removes only the owned marker, hands the entry to Git's collection, and requires no entry path; failed empty/unlock remains locked and is named.
- Boundary inventory: searched proposal scope; D4 sequence, state table, refuted alternative, residuals, D9 ownership discussion, obligation ledger, and risk map; every withdrawal/residue spec scenario; completed task chronology and explicit reversals; `adoptWorktree` interface and full construction/undo commentary; both test files including file headers, names, rationale blocks, locked-first witnesses, collectability witnesses, and Git-behavior probes; `extension.ts` filesystem adapter commentary; and `worktreeMutationService` residue reporting. Affected: `design.md:326`, `src/worktree/adoptWorktree.ts:144`, `src/worktree/adoptWorktree.ts:402`, `src/worktree/adoptWorktree.integration.test.ts:6-10`. Verified safe: `proposal.md`; D4 lines 110-132 as explicitly refuted Git behavior/history and lines 134-165 as the live rule; the obligation ledger including corrected line 397; all current spec outcomes; completed task entries as chronology explicitly superseded by later reversed/dropped sections; current unit-test withdrawal names/assertions; the edited integration probe rationales at lines 327-352; `extension.ts`; and `worktreeMutationService.ts` entry-path handling.

## Adjudication notes

- The contracts specialist independently found F018 persisting at `design.md:326`; the chair corroborated that passage and found the three additional current commentary boundaries. These are merged under the existing invariant ID because they teach the same superseded removal/construction mechanism.
- The data/security specialist found the edited passages and implementation behavior sound but concluded the inventory was complete. That conclusion is refuted by the four exact current passages above.
- Round 10's adjudication of `design.md:113-131` is confirmed. The table records Git's verified behavior, and the surrounding prose explicitly labels the removal alternative refuted before D4 states the replacement contract. Completed task entries are likewise chronology: the later sections explicitly mark the old outcomes REVERSED and DROPPED.
- Task 11_1 stayed inside its declared boundary: production changes are comments only, test changes are names/comments only, and no assertion changed.
- No audit-backlog or accepted-risk entry exists.

## Author triage record (round 11)

### F018 — Status: accepted

Fourth round, and the chair is right that the previous two sweeps were not
different in kind. Round 10 I grepped phrases; round 11 I grepped claims — but a
grep pattern is a phrase either way, and the four survivors read "then removed",
"about to remove", an orphan JSDoc with no member under it, and a file header.
No predicate-shaped search finds those.

**The method that is actually complete, and why.** Enumerate by SUBJECT, not by
predicate: extract every comment block from the three source files and every line
of the three artifacts that mentions the entry's lifecycle (`entry`, `entries`,
`locked`, `marker`, `withdraw`, `undo`), then READ each one against D4. That is
complete by construction — a passage describing the entry's lifecycle must name
it — where a search for the wording of the defect can only find the wording it
was given. The extraction is 40 comment blocks in `adoptWorktree.ts`, 13 in the
unit tests, 11 in the integration tests, and the full text of `design.md`,
`specs/worktree-panel/spec.md` and `proposal.md`.

It returned exactly four, and they are the chair's four. `spec.md` and
`proposal.md` came back clean, and so did every other comment in the three
source files — including the ones that narrate the superseded mechanism
deliberately, which the inventory distinguishes because reading tells history
from prescription and grep cannot.

The four:

1. `design.md` D9, the ownership paragraph — byte equality would leave `<wt>/.git`
   "naming an entry the undo then removed". Now emptied and handed to git.
2. `adoptWorktree.ts:144` — an orphan JSDoc for the deleted `removeDir`, standing
   after `removeFile` with no member under it, documenting a capability `AdoptFs`
   deliberately no longer offers. Deleted. This one is worth noting: it survived
   three sweeps because it describes a member that does not exist, so nothing
   about the code contradicted it.
3. `adoptWorktree.ts:402` — `stillOurEntry`'s comment, "about to remove" → "about
   to empty".
4. `adoptWorktree.integration.test.ts:6-10` — the header credited the prune facts
   with letting `gitdir` be written first. Those facts are still load-bearing, but
   for why the LINK is written last; `locked` is what covers the construction
   interval. The header now says both.

**On the chair's recommendation to hand back to planning.** Taken, and this record
plus task 12_1 is the enumerated reconciliation it asked for — the inventory is
recorded above rather than left as a claim that I looked. What is NOT taken is a
Gate 2 reopening: the remediation boundary test asks whether a fix needs a new or
changed `D#` or mints an invariant owner, and this needs neither. D4 has said
"the withdrawal deletes nothing" since the round-7 handback; every one of these
four passages contradicted a decision already accepted. Reopening Gate 2 to
approve prose that is being brought INTO line with an approved decision would
record an approval of nothing.

Fix-delta audit: no assertion added, weakened or removed; the only production
edit removes a comment for a member that does not exist and changes one verb in
another. `verify-task` records the suite change as the header comment alone.
