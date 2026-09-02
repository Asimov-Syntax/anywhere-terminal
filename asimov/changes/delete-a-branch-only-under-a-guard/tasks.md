## 1. The proof carries what it proved against

- [x] 1_1 Record the two commits the merge proof was taken from — verified: pnpm exec vitest run 'src/worktree/orphanProofs.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D1, D4; specs/worktree-panel/spec.md#the-branch-is-deleted-only-if-nothing-it-was-proven-against-has-moved
  - **Acceptance**:
    - Outcome: A passed merge proof reports the branch commit, the default branch, and its commit
    - Verify: unit src/worktree/orphanProofs.test.ts
  - **Plan**:
    1. In `src/worktree/orphanProofs.ts`, add a `mergeEvidence` field to `OrphanProofs` holding `{ branch, branchOid, base, baseOid }`, present only when `branchMerged` is `"passed"`.
    2. In `mergeProof`, resolve both OIDs with `git rev-parse` against the same worktree the ancestry check ran in, and return them beside the outcome.
    3. Answer `unproven` rather than `passed` when either `rev-parse` fails or returns no OID, so evidence is never partially present.
    4. Leave the `notApplicable`, `failed` and `unproven` arms answering exactly as they do now, carrying no evidence.

- [x] 1_2 Carry the evidence and the opt-in across the wire — verified: pnpm exec vitest run 'src/types/messages.contract.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: design.md D1
  - **Acceptance**:
    - Outcome: The assessment carries the merge evidence and the remove request carries the opt-in
    - Verify: unit src/types/messages.contract.test.ts
  - **Plan**:
    1. In `src/types/messages.ts`, add the optional merge-evidence field to the removal assessment payload, documenting that its PRESENCE is what gates the control.
    2. In `src/types/messages.ts`, add an optional `deleteBranch` field to `WorktreeRemoveRequestMessage`, absent by default, documenting that absence means no deletion.
    3. In `src/worktree/removalChecks.ts`, pass the evidence through to the payload without inventing one where the proof did not pass.

## 2. The guarded delete

- [x] 2_1 Delete a branch only inside a verified ref transaction — verified: pnpm exec vitest run 'src/worktree/deleteBranch.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: design.md D2, D3, D4, D5; specs/worktree-panel/spec.md#{the-branch-is-deleted-only-if-nothing-it-was-proven-against-has-moved, a-branch-in-use-or-the-default-branch-is-never-deleted}
  - **Acceptance**:
    - Outcome: The branch is deleted only when both commits still match and it is checked out nowhere
    - Verify: unit src/worktree/deleteBranch.test.ts
  - **Plan**:
    1. Add `src/worktree/deleteBranch.ts` exporting a function taking the evidence and an injected git runner, mirroring the injected-runner shape `src/worktree/orphanProofs.ts` uses.
    1a. In `src/worktree/gitCommandRunner.ts` and `src/worktree/gitCommandRunner.test.ts`, add a per-call stdin option: the accepted transaction is `git update-ref --stdin`, and the existing argv-only runner otherwise cannot execute it. Preserve the runner's bounded, never-rejecting result contract.
    2. Re-read `git worktree list --porcelain` immediately before the transaction and refuse when the target branch is checked out in any worktree — `update-ref` does NOT carry `git branch -d`'s guard, so this check is the only one there is (design.md D3).
    3. Re-derive the default branch and refuse when the target equals it.
    4. Issue `start` / `verify refs/heads/<default> <baseOid>` / `delete refs/heads/<branch> <branchOid>` / `commit` on one `git update-ref --stdin`, and treat a non-zero exit as a refusal that deleted nothing.
    5. Return a discriminated outcome naming which guard refused, never a bare boolean.

- [ ] 2_2 Run the delete after the removal, and report it apart
  - **Deps**: 2_1, 4_4
  - **Refs**: design.md D5; specs/worktree-panel/spec.md#the-branch-deletion-is-reported-apart-from-the-removal
  - **Acceptance**:
    - Outcome: A failed branch delete reports the removal as succeeded and the branch failure separately
    - Verify: unit src/worktree/worktreeMutationService.test.ts
  - **Plan**:
    1. In `src/worktree/worktreeMutationService.ts`, add an optional `deleteBranch` binding to `MutationServiceDeps`, beside the existing optional bindings.
    2. Call it in the removal arm only after the removal outcome is a success and only when the request carried the opt-in, so a failed removal attempts no deletion.
    3. Carry the branch outcome on the removal's own result rather than replacing it, following how provisioning rides the create's outcome.
    4. Never let a rejection from the binding change the removal's classification.

## 3. The control

- [ ] 3_1 Offer the control only where the proof is present, and off
  - **Deps**: 2_2
  - **Refs**: design.md D1; specs/worktree-panel/spec.md#deleting-the-branch-is-a-separate-opt-in-offered-only-on-a-proven-merge
  - **Acceptance**:
    - Outcome: The control appears only with merge evidence, starts off, and the typed confirmation never enables it
    - Verify: unit src/webview/worktree/WorktreeRemoveDialog.test.ts
  - **Plan**:
    1. In `src/webview/worktree/WorktreeRemoveDialog.ts`, render the opt-in only when the assessment carries merge evidence, defaulting to unchecked, naming the branch it would delete.
    2. Keep it independent of the typed confirmation control: typing the confirmation changes nothing about this checkbox's state.
    3. Send `deleteBranch` on the remove request only when it is ticked.

- [ ] 3_2 Wire the binding at the host
  - **Deps**: 3_1, 4_3, 4_4
  - **Refs**: design.md D2
  - **Acceptance**:
    - Outcome: The opt-in reaches the guarded delete with the report's own evidence
    - Verify: unit src/extension.worktreeMutations.test.ts
  - **Plan**:
    1. In `src/providers/WorktreeHost.ts`, validate `deleteBranch` at runtime beside the other inbound removal fields and pass it into the mutation request.
    2. In `src/extension.ts`, supply the `deleteBranch` binding built on `src/worktree/deleteBranch.ts` and the existing git runner.
    3. Resolve the evidence from the host's own report rather than from anything the webview sent.

## 4. Oracle attack — close the refuted rows

- [ ] 4_1 Carry the branch outcome to the user
  - **Deps**: 2_2
  - **Refs**: design.md D5; specs/worktree-panel/spec.md#the-branch-deletion-is-reported-apart-from-the-removal
  - **Acceptance**:
    - Outcome: A refused branch delete appears in the removal notice
    - Verify: unit src/webview/worktree/WorktreeView.test.ts
  - **Plan**:
    1. In `src/types/messages.ts`, add an optional branch outcome to the successful removal result, naming which guard refused.
    2. In `src/extension.ts`, carry it through `toResultMessage` beside `openFailed` rather than dropping it.
    3. In `src/webview/worktree/WorktreeView.ts`, render it in the removal notice so "Remove done." is never the whole story when a branch delete was asked for and did not happen.
    4. Witness each refusal reason reaching the rendered notice.

- [x] 4_2 Assemble the evidence where the payload is actually built — verified: pnpm exec vitest run 'src/extension.worktreeMutations.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: design.md D1, D10
  - **Acceptance**:
    - Outcome: The running extension emits merge evidence in the assessment it sends
    - Verify: unit src/extension.worktreeMutations.test.ts
  - **Plan**:
    1. In `src/extension.ts`, add the merge evidence to the assessment payload mapper that today emits only `checks` and `contained`.
    2. Witness the mapper itself, not a constructed payload, so a green unit test cannot coexist with a control that never appears.

- [ ] 4_3 Return the issued evidence from redemption
  - **Deps**: 2_2, 4_2
  - **Refs**: design.md D10
  - **Acceptance**:
    - Outcome: The guard reads the OIDs the user was shown, never a freshly assessed pair
    - Verify: unit src/worktree/worktreeFingerprint.test.ts
  - **Plan**:
    1. In `src/worktree/worktreeFingerprint.ts`, have `redeem` return the evidence issued with the fingerprint alongside the answer it already returns.
    2. In `src/worktree/worktreeMutationService.ts`, take the guard's OIDs from that returned evidence and use the fresh assessment only to refuse.
    3. Witness that a branch which moved between issue and redemption is refused rather than deleted at its new OID.

- [x] 4_4 Read every holder git registers, and refuse on doubt — verified: pnpm exec vitest run 'src/worktree/deleteBranch.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: design.md D7, D8, D9; specs/worktree-panel/spec.md#a-branch-in-use-or-the-default-branch-is-never-deleted
  - **Acceptance**:
    - Outcome: A branch any git operation elsewhere holds is never deleted
    - Verify: unit src/worktree/deleteBranch.test.ts
  - **Plan**:
    1. In `src/worktree/deleteBranch.ts`, extend the in-use check beyond porcelain's symbolic HEAD to the other states Git v2.50.1 registers: rebase-merge head-name; rebase-apply head-name only when its applying marker is absent; BISECT_START only when BISECT_LOG is present; and rebase update-refs state. Parse update-refs as repeated three-line records containing the ref, before-OID, and after-OID, validating both OIDs; the sequencer todo instruction file is not this state.
    2. Derive the common git directory, enumerate every non-dot entry under its worktrees directory, and require exactly one porcelain main record plus one linked record per raw administrative entry. A missing worktrees directory means zero linked entries; an unreadable entry, unreadable gitdir pointer, non-directory entry, bare or ambiguous main record, malformed porcelain, or count or name mismatch refuses the deletion.
    3. Refuse the deletion on a non-zero exit, timeout, unparseable output, malformed or truncated update-refs triple, or unreadable state that is not a normal absent optional file, rather than treating silence as absence.
    4. In `src/worktree/deleteBranch.ts`, verify the recorded default ref NAME against its recorded OID, and additionally refuse when the target re-derives as the default branch.
    5. Witness each holder separately; the rebase-apply applying and stale BISECT_START non-holder conditions; malformed and truncated update-refs records; an unreadable entry; linked entry count or name mismatch including a gitdir-omitted worktree; main-record and bare-main refusal; and recorded-name-versus-re-derived-name divergence. The count-mismatch and malformed-triple witnesses must fail when reconciliation or OID validation is removed.
