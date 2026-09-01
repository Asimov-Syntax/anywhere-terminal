# Review round 2 — detect-the-provider-the-repo-already-uses

- Date: 2026-09-01
- Cycle: 2
- Mode: discovery
- Scope: range `99e9d6a8..HEAD` (one commit, `449c3b27`), with change context from this change's artifacts
- Head: `449c3b278c2d9f56d4de9b2f9d7c5330280a8798` (tree dirty only in Asimov analytics written by review accounting)
- Reviewable lines: 350 including the change analytics artifact; 168 production lines plus changed tests reviewed inline
- Agents spawned: 5 (performance, logic, contracts, reuse, frontend) + chair self-review and full-flow trace
- Agents skipped: data-security — no parser, containment, dependency, or trust-boundary behavior changed; D4 now delegates to the existing canonical quote helper and was covered by contracts/reuse plus chair trace
- Verify gate evidence: `bun run asm change verify-status detect-the-provider-the-repo-already-uses` reports 1_1 through 4_1 exit 0; task 4_1 records type check, project-baseline Biome, 6,475 unit passes over 277 files, and the fs-deletion gate. The review did not re-run project verify commands.
- Verdict: **WARN**
- Counts: 0 BLOCK / 1 WARN / 1 SUGGEST
- Split over gating blockers: 0 feature / 0 machinery

This is a new cycle's discovery round because task 4_1 was added after round 1's recorded Head. It is not a verification round. The seven prior findings were independently rechecked against the remediation and are fixed. The disclosed surviving task-loop `break` mutant is not a finding: parsing and iteration are structurally capped by the 256 KiB provider-file read, while the append independently enforces the load-bearing row bound.

---

## Prior finding dispositions

### F001 — A failed later switch lowers the ceiling and re-admits an earlier choice

- Severity: BLOCK · Confidence: HIGH · Priority: P1 · Class: feature
- Agent: chair + asm-review-logic
- File: `src/providers/WorktreeHost.ts:2216-2231`
- Status: fixed · Triage: the rejection path no longer deletes the ceiling; retries carry a higher dialog-minted sequence. Close, supersede, and detach all reach `retireOpening`/`forgetSurfaceOpenings`, and reverse-success/rejection-replay paths preserve latest-wins.

### F002 — VS Code task setup rows bypass the model-wide row cap

- Severity: BLOCK · Confidence: HIGH · Priority: P1 · Class: feature
- Agent: chair + asm-review-performance
- File: `src/worktree/provisioning/providerKit.ts:177-196`
- Status: fixed · Triage: every selectable append now calls the same `addRow` capacity check. The four callers that ignore the boolean are safe: each is already guarded immediately by `full()` or performs only one append, while `addRow` itself still refuses. The repository-controlled task loop checks the boolean and stops.

### F003 — Repository-root failure falsely activates the VS Code Tasks provider

- Severity: BLOCK · Confidence: HIGH · Priority: P1 · Class: feature
- Agent: chair + asm-review-contracts
- File: `src/worktree/provisioning/vscodeTasksProvider.ts:118-126`
- Status: fixed · Triage: root failure now returns `null`, matching Asimov and Orca, so the dispatcher elects no provider. See F009 for the separate non-gating diagnostic consequence.

### F004 — D4 duplicates the repository's canonical POSIX quoting implementation

- Severity: WARN · Confidence: HIGH · Priority: P2 · Class: feature
- Agent: asm-review-reuse
- File: `src/worktree/provisioning/vscodeTasksProvider.ts:14,63,88`
- Status: fixed · Triage: local `quoted()` is removed and both command and argument words use `posixShellQuote`; the pre-existing byte-exact D4 assertions remain unchanged and pass in the recorded gate.

### F005 — Later globs still consume names after the shared scan budget is exhausted

- Severity: WARN · Confidence: HIGH · Priority: P2 · Class: feature
- Agent: asm-review-performance
- File: `src/worktree/provisioning/providerKit.ts:424-455,524-537`
- Status: fixed · Triage: an exhausted account returns before the first iterator pull, and `entriesFor` refuses before calling `readdir`. The one look-ahead used by the glob that consumes the last available slot remains bounded and does not recur for later globs.

### F006 — Multiple switch buttons have the same accessible name

- Severity: SUGGEST · Confidence: HIGH · Priority: P3 · Class: feature
- Agent: asm-review-frontend
- File: `src/webview/worktree/WorktreeCreateDialog.ts:422-429`
- Status: fixed · Triage: each button's accessible name includes the host-defined provider file list and selects that same provider; visible and keyboard behavior are unchanged.

### F007 — Draft-to-model assembly is copied across all three adapters

- Severity: SUGGEST · Confidence: MEDIUM · Priority: P4 · Class: feature
- Agent: asm-review-reuse
- File: `src/worktree/provisioning/providerKit.ts:261-279`
- Status: fixed · Triage: all three adapters use `modelFromDraft`; Asimov alone overlays its legacy single-source `providers` field, while dispatcher adapters keep it empty for `readProvisioning` to own.

---

## F008 — Task 4_1 claims two failing witnesses that do not exist

- Severity: WARN · Confidence: HIGH · Priority: P2 · Class: machinery
- Agent: chair
- File: `asimov/changes/detect-the-provider-the-repo-already-uses/tasks.md:123-135`
- Status: accepted · Triage: new discovery; non-gating
- Author triage: accepted, and the claim is fixed rather than narrowed. The finding is correct: 4_1's Outcome says every finding has a witness that fails before the fix, and for F004 and F007 that was false — the D4 assertions passed happily while the duplicate existed, which is precisely the point the chair is making. Narrowing the wording would make the record true and leave F004's stated impact ('two owners that can drift') undefended. So the witnesses are being written instead: a structural test that no second POSIX single-quote escape and no second model assembly exists in this directory. `readOnly.test.ts` is the established precedent for a source-matcher test here, including its own not-vacuous check.

**Evidence.** Task 4_1's accepted Outcome says every F001-F007 finding has a witness that fails before the fix and turns green afterward. F004 deliberately leaves the D4 rendering tests unchanged; those tests passed in round 1 while the duplicate local `quoted()` implementation still existed, so they cannot witness the duplication defect. F007 adds no test that fails while the three adapters assemble the model independently; the round-1 suite also passed with that duplication. The changed suite contains behavioral witnesses for F001, F002, F003, F005 and F006, but not failing witnesses for F004 or F007. The task is nevertheless marked done and its verify record says every accepted finding was witnessed.

**Impact.** The persisted completion evidence overstates what the suite proves. Reintroducing a private quote implementation with identical output, or re-splitting model assembly into three identical copies, remains invisible to the claimed gate. These were non-gating quality findings, so this does not reopen their runtime defects, but the task contract is not true as written.

**Suggested fix.** Either add structural witnesses that fail on the pre-fix source, or narrow task 4_1's Outcome and verify note to say F004/F007 were closed by reuse/cohesion inspection while the behavioral findings have failing regression witnesses. Do not describe unchanged output assertions as a test that fails on duplication.

---

## F009 — Correcting root election also discards the root-failure diagnostic

- Severity: SUGGEST · Confidence: MEDIUM · Priority: P4 · Class: feature
- Agent: asm-review-contracts
- File: `src/worktree/provisioning/readProvisioning.ts:87-106`
- Status: accepted · Triage: new discovery; non-gating
- Author triage: accepted as a FOLLOW-UP, not remediation. Carrying a dispatcher-level root problem means somebody must own 'no provider elected, and here is why' — a new invariant owner, which is past the remediation boundary (design lifecycle § Remediation boundary) and would supersede this cycle if landed as a fix. The chair agrees it does not violate 4_1's outcome. Recorded in workflow.md as a follow-up needing its own PLAN task; it is NOT silently dropped, and it is not fixed here.

**Evidence.** With all three adapters returning `null` for `openProviderFile(...).at === "root"`, the dispatcher reaches `chosen === null` and returns `emptyModel()`. No provider is falsely activated, closing F003, but the `"The repository root could not be resolved."` problem constructed by `openProviderFile` is now unreachable. A root symlink loop, permission failure, and a repository with no provisioning source therefore produce the same returned model.

**Impact.** The create form can state an empty provisioning section when the extension was unable to inspect the checkout at all. No accepted task requires a root-level diagnostic and the other adapters already behaved this way, so this is not gating.

**Suggested fix.** At a future task boundary, let the dispatcher prepare the root once or otherwise carry a root-level problem independently of provider election, returning no active provider plus the diagnostic.

---

## Specialist adjudication

- Performance: no findings; F002/F005 closed and the task-loop break is a bounded optimization, not an unbounded-work invariant.
- Logic: no findings; F001 closed and every live-opening exit retains the intended latest-wins behavior.
- Contracts: F002/F003/F007 closed; raised the non-gating diagnostic consequence recorded as F009.
- Reuse: no findings; F004/F007 are correctly consolidated.
- Frontend: no findings; F006 is correctly closed.
- Contracts' suggestion that the quote-helper reuse was outside remediation scope was rejected: F004 and task 4_1 explicitly require that exact replacement.
