# Review Round 4

- Date: 2026-09-02
- Cycle: 3
- Round: 4
- Mode: verification
- Arbiter: no
- Review profile: fastlane; user-granted bounded extension
- Scope: range `6a983286~1..HEAD`, with verification concentrated on the remediation delta `89e95c8673275e06d7bc8e59957b2343ade5204e..d24de64e799d75d49f65357dc4d4a818947e163b`, the round-3 findings, and their rebutted artifact boundaries
- Head: `d24de64e799d75d49f65357dc4d4a818947e163b` (working tree dirty from review accounting and a specialist handoff note; reviewed code/artifacts were anchored at the committed Head)
- Reviewable lines: 75 in the remediation delta
- Scope lock: bounded verification retained. D4b is the approved F006 remediation, while F007-live and F008 were routed to separate owners rather than implemented in this parent. Their unsettled dependency state is adjudicated below; it did not turn this round into fresh discovery.
- Agents spawned:
  - asm-review-logic — F006 typed claim-loss path, reachability, caller parity, and F001-F005 regression cone — gpt-5.6-sol[1M]
  - asm-review-contracts — F007 artifact consistency, split ownership/settlement, F008 dependency, and D4b contract accuracy — gpt-5.6-terra[1M]
- Agents skipped: data-security, frontend, performance, reuse — outside this narrow remediation cone
- Recorded verification: `bun run asm change verify-status award-a-contested-destination-or-refuse-it` reports task 6_1 at exit 0 and the workflow Verify gate is checked. The caller supplied the current final-gate record: check-types clean; 6687 unit tests pass; Biome remains at the 3 errors / 14 warnings / 1 info baseline; fs-deletion gate ok. Per review policy, this review did not rerun project verification commands.
- Verdict: REJECT
- Counts: BLOCK 3 | WARN 1 | SUGGEST 0
- Status: blocked

## Findings

### F007

- ID: F007
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/asimov/changes/award-a-contested-destination-or-refuse-it/proposal.md:33`
- title: The scope cut is still contradicted, and its live owner is not a settled dependency
- evidence: The modified spec, task 2_1, D4, and the parent workflow now say a held contender is refused even where the filesystem keeps the spellings distinct. The accepted proposal still prohibits refusal “on the folding key” (`proposal.md:33-37`) and says a group that is genuinely two files “must still land both” (`proposal.md:56-60`), which is the exact behavior the current implementation deliberately withdrew. Separately, `offer-a-yielding-declaration-as-yielding` contains only an unchecked workflow scaffold: no accepted proposal/spec/design/tasks, no build, no verification, and no independent APPROVE (`workflow.md:7-18`). The design lifecycle requires a new invariant owner to be planned, built, and reviewed to APPROVE independently before the parent consumes it as a settled dependency.
- impact: F007's artifact half is not reconciled across accepted artifacts, and the live pre-apply false promise remains unremediated. Named ownership means the finding was not silently erased, but an intent-only scaffold cannot discharge it or let this parent archive.
- suggestedFix: Amend the proposal to state the settled refusal rule without a “both land” or no-folding-key-refusal promise. Keep F007 gating until `offer-a-yielding-declaration-as-yielding` is planned, built, verified, independently APPROVED, and recorded as a settled dependency; then review the parent's integration seam.
- status: accepted
- triage: Persists from round 3. The spec/task/design portion is corrected, but the proposal boundary remains stale and the live split has not reached the lifecycle's settlement condition.
- invariant: Every accepted and pre-apply boundary states what a selected contender can actually receive; a split owner must be settled before the parent treats its obligation as discharged.
- boundary inventory:
  - affected: proposal non-goal and risk; live offer defaults/counts; child dependency lifecycle
  - verified safe: revised delta spec; task 2_1; design D4; parent workflow ownership note; post-apply notice
  - not safe: proposal lines 33-37 and 56-60; unchanged live dialog; unplanned/unapproved child workflow

### F008

- ID: F008
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:135`
- title: The quadratic wire contract remains live behind an unsettled scaffold
- evidence: The per-row result representation and complete-member reason construction are unchanged, so the round-3 `O(N*T)`/quadratic payload witness remains reproducible across result storage, postMessage, and rendering. `carry-a-contest-membership-once` has only an unchecked workflow skeleton, with no accepted plan artifacts, tasks, implementation, verification, review, or implementation approval (`workflow.md:7-18`). The lifecycle requires this new result-contract owner to APPROVE independently before the parent consumes it as a settled dependency.
- impact: The existing repeated-membership wire contract can still expand bounded repository input into a roughly 50–150 MiB result path at the supported caps. The split's name and parent note preserve traceability, but they do not close the load-bearing defect or make it non-gating.
- suggestedFix: Plan, build, verify, and independently APPROVE `carry-a-contest-membership-once`, including the extension-to-webview consumer migration, before treating F008 as settled; then review only the parent's integration seam.
- status: accepted
- triage: Persists from round 3. Ownership is named but not settled, and the runtime witness remains unchanged.
- invariant: Repository-controlled provisioning metadata remains bounded after derived representation and IPC; a parent may consume a new wire-contract owner only after independent APPROVE.
- boundary inventory:
  - affected: eager contest refusal; held-member refusal; ProvisionStepResult storage; postMessage clone; webview reason join; child dependency lifecycle
  - verified safe: source row/file caps; active child name and parent ownership note preserve discoverability
  - not safe: aggregate output bytes; current result wire contract; unplanned/unapproved child workflow

### F009

- ID: F009
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:210`
- title: Preserving the fired rule drops the contest membership every refusal must name
- evidence: F006's new branch correctly lets an ordinary `refused` result from `applyExclusiveEntry()` pass without being relabelled as claim loss, but line 210 stores that `ProvisionStepResult` unchanged. The special-file witness therefore gives the favoured row only “devices, sockets and FIFOs are never configuration”; it does not name its own declaration or the held declaration. D4b explicitly says the readable reason still names every member, D4a requires every refusal to name every member by path and declaring file, and task 5_3's accepted Outcome says “Every refusal names every member of its contest, at any cardinality.” The added witness asserts only the material-rule substring and does not witness membership.
- impact: A user reading the favoured refusal sees the local rule but cannot see which declarations were in dispute. The F006 translation defect is closed, but its remediation creates a different deterministic breach of the accepted refusal contract on the same changed path.
- suggestedFix: For a contested ordinary refusal, preserve the original fired-rule reason and add one normalized whole-contest membership context; do not translate it into claim-loss prose. Extend the F006 witness to assert the original rule and every member's path plus declaring file.
- status: accepted
- triage: New gating blocker inside the F006 remediation cone. F004's original deferred-list construction remains fixed; this is a distinct pass-through mechanism violating the same D4a obligation.
- invariant: Every contest refusal preserves the rule that fired and names every member of the contest.
- boundary inventory:
  - affected: favoured ordinary refusal returned by `applyExclusiveEntry`; `answered` insertion; result IPC and rendered notice
  - verified safe: claim-loss whole-contest settlement; eager D3 whole-contest refusal; deferred held-member reasons at pair and larger cardinality
  - not safe: ordinary favoured `refused` pass-through

### F010

- ID: F010
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/asimov/changes/award-a-contested-destination-or-refuse-it/design.md:136`
- title: D4b records the claim-loss arm on the wrong exported function
- evidence: D4b says `applyEntry` returns the distinguishable claim-loss answer. The implementation deliberately keeps `applyEntry(...): Promise<ProvisionStepResult>` unchanged and exposes `applyExclusiveEntry(...): Promise<ProvisionStepResult | typeof CLAIM_LOST>` as the only second door. `applyProvisioning` selects that door only for contested entries.
- impact: The accepted design obscures the guarantee that ordinary callers cannot receive `CLAIM_LOST` and misstates the public/internal seam future work must preserve.
- suggestedFix: Amend D4b, and task 6_1 if needed, to name the actual split: `applyEntry` keeps the old result contract; `applyExclusiveEntry` alone may return `CLAIM_LOST`; only that sentinel triggers whole-contest claim-loss settlement.
- status: accepted
- triage: New non-gating artifact warning in the F006 fix delta. It does not reopen F006's runtime witness.

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
- evidence: `applyExclusiveEntry` still maps only the entry's own top-level file, directory, direct link, and degraded-copy `EEXIST` sites to `CLAIM_LOST`; `applyProvisioning` refuses the whole contest only on that sentinel.
- impact: Closed. The F006 refactor preserved the exclusive-claim boundary.
- suggestedFix: None.
- status: fixed
- triage: Remains fixed from round 3.

### F002

- ID: F002
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic, asm-review-data-security, asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:112`
- title: Unknown filesystem and admission states are collapsed into absence or collision
- evidence: The four-state reading and only-ENOENT-means-absent discipline are unchanged.
- impact: Closed.
- suggestedFix: None.
- status: fixed
- triage: Remains fixed from round 3.

### F003

- ID: F003
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-contracts
- class: machinery
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:249`
- title: The extraction changes uncontested result order from copy-before-link to provider order
- evidence: `answered` still preserves production insertion order and the return path is unchanged.
- impact: Closed.
- suggestedFix: None.
- status: fixed
- triage: Remains fixed from round 3.

### F004

- ID: F004
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-logic, asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:238`
- title: Deferred refusals omit members from contests larger than a pair
- evidence: The deferred `everyone` construction and both three-member witnesses are unchanged and still include every member. F009 is a distinct ordinary-refusal pass-through mechanism, not recurrence of this deferred-list defect.
- impact: Closed at its recorded boundary.
- suggestedFix: None.
- status: fixed
- triage: Remains fixed from round 3.

### F005

- ID: F005
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:230`
- title: Post-claim disappearance can promote the inherited member on a folding volume
- evidence: Held members remain refusal-only after the favoured turn; no destination reading or held `applyEntry` call was reintroduced.
- impact: Closed.
- suggestedFix: None.
- status: fixed
- triage: Remains fixed from round 3.

### F006

- ID: F006
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyEntries.ts:187`
- title: Every favoured refusal is misreported as an exclusive-claim loss
- evidence: `CLAIM_LOST` is a disjoint string sentinel returned only by `applyExclusiveEntry`; ordinary `refused`, `skipped`, and `failed` results remain `ProvisionStepResult`s. `applyProvisioning` checks the sentinel exactly. `claimLost` can arise only at the exclusive entry's own top-level file/directory/symlink creation; `ensureParents` and descendant walks call non-own creation, child propagation is safe, and `makeLink`'s exclusion is sound. Grep found no unchanged production caller of `applyEntry` with the removed option; ordinary callers still take the non-exclusive door with the old signature and behavior. The special-file witness closes the false-collision arm. The logic specialist found no logic/complexity issue.
- impact: Closed. An ordinary contested refusal keeps the rule that fired, and claim-loss prose is reserved for the exclusive top-level `EEXIST` sentinel. F009 is a new membership-context defect introduced by the pass-through, not persistence of the false-cause mechanism.
- suggestedFix: None for F006.
- status: fixed
- triage: Fixed in round 4.
- invariant: A contest refusal reports the rule that actually fired; only the exclusive top-level `EEXIST` site may claim the destination was taken.
- boundary inventory:
  - verified safe: admission refusal; top-level special-file and lockfile refusal; direct link; degraded link-to-copy; file and directory exclusive EEXIST; parent creation; descendant walk; ordinary callers
  - affected and now closed: whole-contest translation in `applyProvisioning`

## Verification trace

- F006: `applyEntry` and `applyExclusiveEntry` now expose disjoint contracts. The internal `claimLost` arm is reachable only from own top-level exclusive creation. Parent creation always uses `mustCreate=false`; recursive children always use `own=false`; `makeLink` cannot construct `claimLost`; the outer exclusive link arm maps only `skipped/EEXIST` to `CLAIM_LOST`. The ordinary cast therefore cannot leak the sentinel under current control flow, and unchanged callers preserve behavior.
- F001-F005: their witnesses and invariant boundaries remain intact. No exclusive arm was removed, the four-state reading/order/held settlement did not change, and the three-member deferred reasons remain complete.
- F007: spec/task/design D4 are now truthful, but the accepted proposal is not. The live child is named but not settled.
- F008: the child name preserves the issue's route, but the quadratic representation is unchanged and the child is not a settled dependency.
- Tests: the changed tests add the F006 special-file witness and sentinel assertions, contain no `.only`/`.skip`, and await their async paths. The missing whole-membership assertion is part of F009.

## Adjudication notes

- The logic specialist reported no logic/complexity defect and corroborated that F006 and F001-F005 are closed in the runtime cone.
- The contracts specialist identified the stale proposal, both unsettled dependencies, and the inaccurate D4b function contract. The chair merged the two F007 mechanisms under the existing invariant and kept F008's original ID.
- The chair and contracts specialist separately identified F009 after tracing D4a through the new ordinary-refusal pass-through. It is a different mechanism from F004's fixed deferred-list construction, so it receives a new ID.
- The split findings are not silently dropped: active change ids and the parent workflow preserve ownership. They remain gating because neither child has reached independent APPROVE, which is the lifecycle's settlement condition.
- No accepted risk exists. No agent message was treated as user consent.

## Audit backlog

None.
