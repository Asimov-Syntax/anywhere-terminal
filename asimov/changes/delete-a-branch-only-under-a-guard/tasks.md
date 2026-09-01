## 1. The proof carries what it proved against

- [ ] 1_1 Record the two commits the merge proof was taken from
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

- [ ] 1_2 Carry the evidence and the opt-in across the wire
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

- [ ] 2_1 Delete a branch only inside a verified ref transaction
  - **Deps**: 1_2
  - **Refs**: design.md D2, D3, D4, D5; specs/worktree-panel/spec.md#{the-branch-is-deleted-only-if-nothing-it-was-proven-against-has-moved, a-branch-in-use-or-the-default-branch-is-never-deleted}
  - **Acceptance**:
    - Outcome: The branch is deleted only when both commits still match and it is checked out nowhere
    - Verify: unit src/worktree/deleteBranch.test.ts
  - **Plan**:
    1. Add `src/worktree/deleteBranch.ts` exporting a function taking the evidence and an injected git runner, mirroring the injected-runner shape `src/worktree/orphanProofs.ts` uses.
    2. Re-read `git worktree list --porcelain` immediately before the transaction and refuse when the target branch is checked out in any worktree — `update-ref` does NOT carry `git branch -d`'s guard, so this check is the only one there is (design.md D3).
    3. Re-derive the default branch and refuse when the target equals it.
    4. Issue `start` / `verify refs/heads/<default> <baseOid>` / `delete refs/heads/<branch> <branchOid>` / `commit` on one `git update-ref --stdin`, and treat a non-zero exit as a refusal that deleted nothing.
    5. Return a discriminated outcome naming which guard refused, never a bare boolean.

- [ ] 2_2 Run the delete after the removal, and report it apart
  - **Deps**: 2_1
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
  - **Deps**: 3_1
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

- [ ] 4_2 Assemble the evidence where the payload is actually built
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

- [ ] 4_4 Read every holder git registers, and refuse on doubt
  - **Deps**: 2_1
  - **Refs**: design.md D7, D8, D9; specs/worktree-panel/spec.md#a-branch-in-use-or-the-default-branch-is-never-deleted
  - **Acceptance**:
    - Outcome: A branch any git operation elsewhere holds is never deleted
    - Verify: unit src/worktree/deleteBranch.test.ts
  - **Plan**:
    1. In `src/worktree/deleteBranch.ts`, extend the in-use check beyond porcelain's symbolic HEAD to read the rebase head-name files, the bisect start marker, and the sequencer todo file in each worktree's administrative directory, for the main checkout and every linked worktree.
    2. Refuse the deletion on a non-zero exit, a timeout, unparseable output, or any administrative entry that cannot be read, rather than treating silence as absence.
    3. In `src/worktree/deleteBranch.ts`, verify the recorded default ref NAME against its recorded OID, and additionally refuse when the target re-derives as the default branch.
    4. Witness each holder separately, plus an unreadable entry, plus a recorded-name-versus-re-derived-name divergence.
