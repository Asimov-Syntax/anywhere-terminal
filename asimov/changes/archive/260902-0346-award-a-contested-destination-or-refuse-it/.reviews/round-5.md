# Review Round 5

- Date: 2026-09-02
- Cycle: 3
- Round: 5
- Mode: verification
- Arbiter: no
- Review profile: fastlane; round opened under the recorded user-approved override
- Scope: range `d24de64e799d75d49f65357dc4d4a818947e163b..HEAD`, concentrated on round-4 F007-F010 and the parent integration seam for the two now-archived owners
- Head: `864357825a2379b10192ba5c859a2aa71260cb91` (tree dirty from an unrelated untracked change outside this review scope; reviewed code and artifacts are anchored at committed Head)
- Reviewable lines: 296
- Scope lock: clear. Round 4 explicitly routed F007-live and F008 to separate invariant owners and deferred the parent's consumption seam to the next review. Both owners are independently approved and archived; this round reviews only their integration plus F009/F010 remediation, not either child as fresh discovery.
- Agents spawned:
  - asm-review-contracts — parent/child accepted contracts, F008 wire seam, F009/F010 — gpt-5.6-sol[1M]
  - asm-review-frontend — yielding selection/count/note behavior and contest result rendering — gpt-5.6-terra[1M]
  - asm-review-performance — linear contest representation and temporary handoff state — sonnet[1M]
- Agents skipped: data-security, logic, reuse — outside this verification cone; chair covered the narrow orchestration/error-path logic
- Support: asm-finder traced apply → report → host post → router → controller → notice.
- Recorded verification: caller supplied check-types clean; Biome at the 3 errors / 14 warnings / 1 info baseline; 6701 unit tests pass across 280 files; fs-deletion gate ok; `bun run asm change verify-status award-a-contested-destination-or-refuse-it` exit 0. Per review policy, this review did not rerun project verification commands.
- Verdict: REJECT
- Counts: BLOCK 3 | WARN 0 | SUGGEST 0
- Status: blocked

## Findings

### F007

- ID: F007
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-frontend, chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:473`
- title: Reselecting the yielding row makes the live summary promise material the apply will refuse
- evidence: The archived child fixed the initial state and the full reversal, but `bringSummary()` counts every selected entry (`model.entries.filter((e) => selected.has(e.id))`). If the user leaves the favoured row selected and ticks only its yielding partner, the change handler adds both ids, leaves the partner's `refused while <favoured> is selected` note visible, and recomputes a count that now includes both. Submission also carries both ids, so the apply recomputes the contest and refuses the yielding member. The applied requirement at `asimov/specs/worktree-panel/spec.md:2080-2082` says that while the repository's own declaration remains selected, the yielder is not counted among entries the dialog says will be brought over. Existing tests cover the initial state and the full reversal, but the `still submits the yielding row when the user ticks it` witness does not assert the simultaneous note and count.
- impact: In a supported interaction, one dialog simultaneously says the row will be refused and counts it as copied/linked. F007's pre-apply truthfulness invariant therefore remains open even though its default-state and reversal boundaries are fixed.
- suggestedFix: Derive the entry summary from selected entries that can arrive under the current selection: exclude a yielding row while its favoured id is also selected. Add a focused witness that ticks the yielder without unticking the favoured row and asserts the visible refusal note, the unchanged deliverable count, and both submitted ids together.
- status: accepted
- triage: Reopened under the original ID. The archived child settled ownership and fixed the default and reversal paths, but fresh evidence in the required integration seam shows the same false-promise invariant persists at the explicit-reselection boundary. Severity remains BLOCK because this is a direct breach of the accepted SHALL-NOT-count requirement.
- invariant: Every pre-apply statement about a contender reflects what the submitted selection can actually receive.
- boundary inventory:
  - affected: ticking a yielding row while its favoured counterpart remains selected; live summary; submitted pair; apply refusal
  - verified safe: initial offer defaults; initial refusal note; unticking the favoured row hides the note; full reversal restates the mode count; groups without a favoured member

### F008

- ID: F008
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/asimov/changes/award-a-contested-destination-or-refuse-it/design.md:152`
- title: The parent still requires the quadratic reason representation its archived child removed
- evidence: The archived child and current runtime carry membership once in `WorktreeProvisionResultMessage.contests`, and each `ProvisionStepResult` references it by index; `src/types/messages.ts:2544-2583` explicitly says membership is not repeated in each reason. The parent accepted design still says “Each refusal reason therefore names every member” (`design.md:151-153`), and its ledger still claims unit witnesses on “the reason text” (`design.md:199`). Accepted task plans repeat the removed mechanism: task 4_3 says each refusal reason names the whole contest (`tasks.md:70-78`), and task 5_3 says every deferred reason is built from the whole contest (`tasks.md:103-111`). Current `applyProvisioning.ts` correctly emits a local reason plus a contest index instead. These are active parent obligations, not historical round notes, and they prescribe the exact O(N²) representation F008's owner was created to eliminate.
- impact: The runtime, IPC, and DOM growth blocker is fixed on the normal path, but the parent has not integrated the child's contract at the accepted-artifact boundary. Following the parent design/tasks would reintroduce F008, while following the child/current code violates the parent's accepted mechanism and recorded witnesses. The parent therefore cannot archive with a contradictory accepted contract.
- suggestedFix: Rewrite D4a, its obligation-ledger witness, and the affected task Plan text to state the normalized contract: the step keeps the rule/cause local, carries a contest index, the result message carries each membership once, and the rendered refusal combines them so the person still sees every path and declaring file. Keep the external Acceptance statements that every refusal names every member.
- status: accepted
- triage: Persists from round 4 at the explicitly deferred parent-integration boundary. Evidence delta: the archived child closes the runtime O(N²) storage/postMessage/DOM boundaries, but the parent accepted artifacts still require the same repeated-reason mechanism, so the gating invariant is not fully settled.
- invariant: Repository-controlled provisioning metadata stays linear in steps plus declarations, and every accepted owner describes the same once-per-contest representation while preserving the visible whole-membership refusal.
- boundary inventory:
  - affected: parent D4a mechanism; obligation-ledger witness; tasks 4_3 and 5_3 implementation/witness text
  - verified safe: apply-result storage; extension handoff on the normal path; postMessage contract; controller state; one membership block per cited contest; structural linearity witness; archived child lifecycle
  - separately unsafe: unreadable-root integration path, recorded as F011 because it is a different bypass mechanism and impact

### F011

- ID: F011
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-contracts, chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/extension.ts:584`
- title: The unreadable-root result bypasses the once-per-contest wire contract
- evidence: When `prepareEntryGate()` returns `null`, `applyProvision` returns one plain `failed` step per selected entry at `src/extension.ts:584-589`. It never calls `applyProvisioning()`, never stages a `contests` array, and attaches no `contest` index to any failed step. The archived owner's accepted task 1_1 requires `src/extension.ts` to pass contests through with the steps it forwards, and task 2_2 requires every step belonging to a contest to carry its index whatever its outcome (`archive/260901-2024-carry-a-contest-membership-once/tasks.md:6-15,50-58`). This is a reachable post-create error path: the worktree was created, but its roots could not be prepared. Because the steps carry no indexes, the renderer's explicit dangling-index warning cannot fire; the failures look like unrelated rows.
- impact: The result contract is dependable only on the successful root-preparation path. On an unreadable new worktree, selected declarations that form a contest lose their shared identity and declaring-file membership exactly when the report is the user's only explanation of what failed.
- suggestedFix: Build the unreadable-root answer through a shared structured-result helper: recompute contests over the selected entries, attach each applicable index to its failed step, and stage the same once-per-contest memberships for message assembly. Add an integration witness for contested selected entries when root preparation fails.
- status: accepted
- triage: New gating defect inside F008's required parent integration cone. It is a new ID because the mechanism is an early-return bypass and the impact is silent membership loss, distinct from F008's repeated-membership growth mechanism.
- invariant: Every provisioning result step that belongs to a selected contest references exactly one contest membership carried on the same result message, on every result-producing exit path.
- boundary inventory:
  - affected: `prepareEntryGate() === null`; synthetic failed steps; extension contest side-channel; rendered error report
  - verified safe: ordinary `applyProvisioning()` outcomes of every kind; normal contest staging; structured clone; controller handoff; dangling-index rendering when an index is present

## Prior finding dispositions

### F001
- ID: F001
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic, asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyEntries.ts:414`
- title: A read-to-create race lets another writer own a contested directory
- status: fixed
- triage: Remains fixed; the exclusive top-level claim door is unchanged.

### F002
- ID: F002
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic, asm-review-data-security, asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:121`
- title: Unknown filesystem and admission states are collapsed into absence or collision
- status: fixed
- triage: Remains fixed; only `ENOENT` establishes absence.

### F003
- ID: F003
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-contracts
- class: machinery
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:263`
- title: The extraction changes uncontested result order from copy-before-link to provider order
- status: fixed
- triage: Remains fixed; insertion/production order is unchanged.

### F004
- ID: F004
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-logic, asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:245`
- title: Deferred refusals omit members from contests larger than a pair
- status: fixed
- triage: Remains fixed at the visible-membership invariant; F008/F011 concern representation and an error-path bypass, not the former pair-only construction.

### F005
- ID: F005
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:245`
- title: Post-claim disappearance can promote the inherited member on a folding volume
- status: fixed
- triage: Remains fixed; held members are refusal-only.

### F006
- ID: F006
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:204`
- title: Every favoured refusal is misreported as an exclusive-claim loss
- status: fixed
- triage: Remains fixed; only `applyExclusiveEntry` can return `CLAIM_LOST`, and ordinary refusal reasons pass through.

### F009
- ID: F009
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.test.ts:323`
- title: Preserving the fired rule drops the contest membership every refusal must name
- status: fixed
- triage: The witness is not vacuous. It asserts the material-rule text on `steps[0]`, then resolves and exactly compares the two-member membership through that same step's contest index. Removing the rule, the index, or the referenced membership fails the witness.

### F010
- ID: F010
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/asimov/changes/award-a-contested-destination-or-refuse-it/design.md:142`
- title: D4b records the claim-loss arm on the wrong exported function
- status: fixed
- triage: D4b now names the actual two-door split: `applyEntry` returns only `ProvisionStepResult`; only `applyExclusiveEntry` may return `CLAIM_LOST`.

## Verification trace

- F007: initial default, live note withdrawal, full reversal, unfavoured groups, and submission are covered. The missing interaction is selecting the yielder while leaving the favoured member selected: the note remains true, but the count becomes false.
- F008 normal path: `applyProvisioning` stores one membership per contest and an index per contested step; extension stages one array; host posts the create result before the provisioning message; controller carries contests into the notice; the view renders one membership line per cited contest and signs every field it renders. No quadratic re-expansion remains there.
- F008 accepted artifacts: D4a/ledger/tasks still prescribe membership inside every reason, contradicting the archived owner and current wire.
- F011: the root-preparation early return constructs steps outside `ApplyProvisioningResult`, so neither indexes nor memberships enter the downstream path.
- F009: the same step supplies both independently asserted facts, so another row cannot satisfy the membership half.
- F010: the exact function signatures are now stated.
- Tests contain no changed `.only`/`.skip`; changed async witnesses are awaited.

## Adjudication notes

- The contracts BLOCK on the unreadable-root bypass is sustained as F011: it cites a reachable result path and two accepted child outcomes.
- The frontend count finding is merged into F007 because it violates the same pre-apply-truthfulness invariant through the same yielding-row count mechanism.
- The frontend suggestion to visibly mark successful contested rows is dropped. The accepted render contract requires association for every refused row; successful steps must carry the index on the wire, which they do, but the notice has no accepted per-success detail obligation.
- The performance warning about raw-vs-normalized `provisionContests` keys is refuted. `validateCreatePath()` returns `check.path` only after `normalizeWorktreePath()` has already realpathed the nearest existing ancestor, normalized NFC, and folded Windows case; that canonical `check.path` is the value passed to `applyProvision`. The later `normalizeWorktreeId(check.path)` repeats the same canonicalizer on the same path. The cited ordinary symlink/NFD/Windows differences are therefore removed before the map write, not introduced between write and take; no normal-path accumulating mismatch was demonstrated.
- No agent message was treated as user consent or risk acceptance.

## Product residual for implementation approval

The accepted scope conservatively refuses a held declaration even on a volume that genuinely keeps the two spellings apart. The oracle evidence says the available `node:fs` composition cannot distinguish that case from the favoured member's object having been unlinked. This review does not treat the absence of a user risk grant as a code defect and does not assign `risk-accepted`; the product choice remains for the user's implementation-approval decision.

## Audit backlog

None.

## Author triage (post-round)

All three blockers accepted in full — none rebutted — and fixed in `ffde4a64` (task 7_1). None
needed a new or changed `D#` or minted a new invariant owner, so the remediation boundary was not
crossed and no handback was owed for the fixes themselves.

- **F007 — accepted, fixed.** Real, and introduced by this session's own round-1 F001 fix on the
  child: making the counts follow the live selection dropped the "only while its favoured member is
  also selected" clause the round-1 chair had specified. Restored. Witness
  `[round-5 F007] does not count a yielder the user ticked back on` asserts the note, the count and
  the submitted ids together, as asked. Arm-checked.
- **F011 — accepted, fixed.** New `failEveryEntry` in `applyProvisioning.ts` is the single builder
  for "every entry failed for one reason"; it recomputes contests through `contestsOf` — the one
  definition of who is contesting — and attaches each member's index. `extension.ts` routes the
  unreadable-root return through it and stages memberships exactly as the ordinary path does.
  Three witnesses, arm-checked.
  - Deviation from the chair's suggested fix: no `extension.worktreeAssembly.test.ts` integration
    witness. That file has no harness able to make `prepareEntryGate` answer `null`, and building
    one would be a larger change than the fix. The builder is witnessed directly and the two staging
    lines at the call site are the ones the ordinary path already exercises. Recorded rather than
    quietly skipped.
- **F008 — accepted, fixed.** D4a is rewritten as a requirement on what the READER ends up
  identifying rather than on what any one string contains, and now shows the shipped
  representation (step reason + contest index → membership once per contest → composed at
  rendering). The D4 table rows and tasks 4_3/5_3 Plan text follow. The two ticked tasks' Acceptance
  Outcomes were left as written: "names every member" is still true of what the reader gets, and
  rewriting accepted Acceptance on completed tasks is the handback rule's business, not a review
  fix's.

## Status after triage

0 gating blockers by the author's account, and NOT independently verified: round 5 is closed and
round 6 needs a user decision the author cannot supply. The verify gate was re-run on the fixed
tree — check-types clean, Biome at the 3/14/1 baseline, 6707 unit tests across 280 files,
fs-deletion gate ok.

The product residual the chair names is unchanged and still the user's: on a volume that genuinely
keeps two spellings apart, the held declaration's file no longer lands. An oracle attack established
no `node:fs` composition can tell that case from the favoured member's object having been unlinked,
so the alternatives are this refusal or a user risk acceptance.
