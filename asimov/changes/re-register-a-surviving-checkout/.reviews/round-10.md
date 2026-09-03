# Review Round 10

- Date: 2026-09-03
- Cycle: 3
- Mode: verification
- Review lane: fastlane
- Escalation: security-privacy, re-review
- Scope: range `4f986c80d772138299d93d6b49ef0c22f4dec4bf..071d517814abaaf867407a6fa0b530626194424d`; verification delta `f51be25d874dad6cd66c3cabfbd4040611b71ff2..071d517814abaaf867407a6fa0b530626194424d` (task 10_1)
- Head: `071d517814abaaf867407a6fa0b530626194424d` (tree dirty only because the open review round updated `asimov/changes/re-register-a-surviving-checkout/analytics.json`)
- Reviewable lines: 23
- Large change: no
- Scope lock: clear. Task 10_1 changes only accepted-artifact text in round-9 F018's remediation cone, adds task-completion metadata, touches no production code, changes no D#, and mints no invariant owner.
- Accepted context: workflow Gate 2 is approved; task 10_1, design D4/D9, the obligation ledger, and the withdrawal requirements in `specs/worktree-panel/spec.md` govern the verification.
- Recorded Verify Gate: `bun run asm change verify-status re-register-a-surviving-checkout` reports task 10_1 complete, exit 0, `scope-unchanged`. Review ran no project verify command.
- Risk map: authority and internal consistency of accepted artifacts describing mutation of repository-owned Git administrative state; locked-first construction; descriptor ownership from `gitdir` publication; empty-and-unlock withdrawal; conditional residue reporting. No persistence growth, hot path, public API, frontend, or reuse surface enters this text-only delta.
- Behavioral cone: accepted `proposal.md`, `design.md`, `specs/worktree-panel/spec.md`, and `tasks.md` -> D4 withdrawal and construction claims -> `adoptWorktree` locked/createPinned/write/undo paths -> collectability and residue witnesses.
- Agents spawned:
  - `asm-review-contracts` — accepted-artifact authority and implementation conformance — `gpt-5.6-terra[1M]`
  - `asm-review-data-security` — destructive Git-state claims and scope lock — `sonnet[1M]`
- Agents skipped:
  - `asm-review-logic` — no production logic changed; the only verification question is contract-text conformance
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
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/asimov/changes/re-register-a-surviving-checkout/design.md:397`
- Title: The supported ledger witness still claims the superseded entry-removal outcome
- Evidence: Task 10_1 correctly reconciles the five passages round 9 cited: the two spec withdrawal outcomes, the incomplete-undo scenario, the withdrawal ledger's conditional entry-path reporting, and the risk map's locked-first construction. But the current obligation ledger's `supported` witness for the `nlink === 0` outcome still says the test asserts “the entry is still removed.” The implementation deletes no entry directory: it truncates the held `<entry>/gitdir`, ownership-gates the `locked` unlink, and returns `entryPath: null` after a successful handoff (`src/worktree/adoptWorktree.ts:478-519`). The current witness asserts exactly that current outcome — `{ entryPath: null, link: "leftAsFound" }` and `collectable(ENTRY) === true` — rather than removal (`src/worktree/adoptWorktree.test.ts:1440-1442`). This makes task 10_1's accepted outcome, “No accepted artifact describes a withdrawal that removes the entry,” false.
- Impact: A live, supported Gate-2 ledger row still tells a builder or reviewer that one withdrawal boundary deletes the entry, contradicting D4's no-directory-deletion handoff. F018's accepted artifacts remain internally inconsistent after a third inventory pass.
- SuggestedFix: Replace “the entry is still removed” with the witnessed result: the entry is emptied and unlocked, becomes collectable, and requires no reported entry path when that handoff completes. Because the F018 inventory has expanded in rounds 8, 9, and 10, stop patching cited phrases individually and hand the accepted artifacts back to planning for one mechanical whole-artifact reconciliation against D4 and the implementation.
- Status: accepted
- Triage: Persists from rounds 8 and 9. The exact round-9 inventory is fixed, but materially new evidence finds the same invariant and causal mechanism in another live obligation-ledger witness. Severity is unchanged.
- Invariant: Approved design, task, ledger, and spec must state one achievable withdrawal contract: locked-first construction; no directory deletion; successful handoff means empty `gitdir` plus marker removal and no required residue path; failed empty/unlock remains locked and is named.
- Boundary inventory: searched proposal scope, D4 sequence and withdrawal, the historical/refuted alternative at design lines 115-131, all obligation-ledger rows, risk map, every withdrawal and incomplete-undo spec scenario, completed remediation tasks and their explicit reversals, task 10_1, implementation withdrawal/construction, and current collectability witnesses. Affected: `design.md:397`. Verified safe: `proposal.md` at its stated altitude; D4 including lines 115-131 as explicitly refuted history; `design.md:393` conditional residue semantics; `design.md:406` locked-first risk mitigation; all worktree-panel withdrawal scenarios; completed task imperatives as chronology explicitly superseded by tasks 7_1/8_1/10_1; implementation and tests.

## Adjudication notes

- The contracts specialist and chair independently found F018 at `design.md:397`. The data/security specialist reported the edited passages clean but its broader “no remaining removal language” conclusion is refuted by that exact supported ledger witness and the contrary current test.
- `design.md:115-131` is not a finding. It explicitly labels the old retained-entry result as what a prior amendment would have shipped, states the incompatible guarantees, and records the `git worktree prune` delegation as refuted before D4 states the replacement contract at lines 134-159.
- Completed task entries that describe earlier mechanisms are chronological history, not additional live findings: the file explicitly says 6_1 is “deliberately REVERSED” and later says the absolute removal promise is “DROPPED.”
- No audit-backlog or accepted-risk entry exists.

## Author triage record (round 10)

### F018 — Status: accepted

Third round on one finding, and the chair's diagnosis of WHY is the part worth
recording: I have been fixing cited phrases. Round 9 cited five passages, I fixed
five, and round 10 found a sixth in the same table. My own sweep after task 10_1
missed it because I grepped `is removed` and the survivor reads `is still
removed` — a search shaped by the phrasing I had just written rather than by the
claim I was looking for.

So this round takes the chair's instruction literally and sweeps by CLAIM, not by
phrase, across every artifact and both test files, on three axes: (a) anything
saying an entry is removed, (b) anything crediting `gitdir`-first for what
`locked` now does, (c) anything reporting an entry path on a handoff that
completed. Six passages, one of them the chair's:

1. `design.md` ledger, `nlink === 0` witness (the finding) — said "the entry is
   still removed"; the test asserts `entryPath: null` and a collectable entry. The
   same cell also said the STALE bytes survive, where the test asserts the
   REPLACEMENT's bytes are what the name holds. Both corrected.
2. `adoptWorktree.ts` — the undo's ordering comment still said "removing the
   entry before the link goes back".
3. `adoptWorktree.test.ts:572` — "names what it left behind when the entry cannot
   be removed"; the fake rejects the MARKER unlink, so the case is an entry that
   cannot be unlocked.
4. `adoptWorktree.test.ts:1526` — "removes the entry even when a foreign link
   names it", with a comment block asserting the same. It is now the handover.
5. `adoptWorktree.integration.test.ts:291` — "leaves no entry" describes a
   listing; the directory survives by design.
6. `adoptWorktree.integration.test.ts:327,342` — two git-behaviour probes still
   credited `gitdir`-first for protecting the construction interval. The facts
   they pin are still load-bearing (D4's four-state table cites them); the
   rationale is now `locked` for the construction interval, and the inertness
   between `gitdir` and the final write for why the link is written last.

Items 3–6 are outside the passage the chair cited and outside "accepted
artifacts" as such. I include them because they are the same defect at the same
axis, and leaving them is how round 11 finds a seventh.

Fix-delta audit: no assertion was added, weakened or removed anywhere in the
delta — names and comments only, and `verify-task` records the suite change with
no assertion delta. The `Boundary` on task 11_1 says exactly this. Production
change is one comment in `adoptWorktree.ts`; behavior is untouched.

Adjudications accepted without addition: `design.md:115-131` is historical, the
completed task entries in `tasks.md` are chronological, and no audit backlog or
accepted risk remains.
