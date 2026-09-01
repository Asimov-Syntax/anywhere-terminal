# Spec Delta: worktree-panel

## ADDED Requirements

### Requirement: Deleting the branch is a separate opt-in, offered only on a proven merge

WHERE a pre-removal report establishes that the worktree's branch is merged, the extension SHALL
offer deleting that branch as a control that is off by default. WHERE the merge is not established —
whether it was disproven, could not be established, or does not apply — the extension SHALL NOT offer
the control at all, rather than offering it disabled.

Removing the worktree SHALL NOT imply deleting the branch, and any typed confirmation the removal
itself requires SHALL NOT enable the control.

#### Scenario: The branch is proven merged

- **WHEN** the report establishes the branch is merged
- **THEN** the control is offered, and it is off

#### Scenario: The merge could not be established

- **WHEN** the merge is disproven, unestablished, or does not apply
- **THEN** no branch-deletion control appears in the report

#### Scenario: The removal is confirmed but the branch was not opted into

- **WHEN** the user confirms the removal without turning the control on
- **THEN** the worktree is removed and no branch is deleted

### Requirement: The branch is deleted only if nothing it was proven against has moved

WHERE the user opted in, the extension SHALL verify — as one indivisible step with the deletion —
that the branch and the default branch still point at the commits the merge was proven from. WHERE
either has moved, the extension SHALL NOT delete the branch and SHALL report that it did not.

#### Scenario: The branch advanced after the proof

- **WHEN** the branch has moved since the report was built
- **THEN** the branch is not deleted and the user is told it was not

#### Scenario: The default branch moved after the proof

- **WHEN** the default branch has moved since the report was built
- **THEN** the branch is not deleted and the user is told it was not

### Requirement: A branch in use, or the default branch, is never deleted

The extension SHALL NOT delete the default branch, and SHALL NOT delete a branch checked out in
another worktree. Both SHALL be established immediately before deleting rather than when the report
was built.

#### Scenario: The branch was checked out elsewhere in the meantime

- **WHEN** the branch is checked out in another worktree at the moment of deletion
- **THEN** the branch is not deleted and the user is told it was not

#### Scenario: The target is the default branch

- **WHEN** the branch named for deletion is the default branch
- **THEN** it is not deleted

### Requirement: The branch deletion is reported apart from the removal

WHEN the user opted in, the extension SHALL delete the branch only after the worktree removal has
succeeded, and SHALL report the removal and the branch deletion as separate outcomes. A failed branch
deletion SHALL NOT be reported as a failed removal.

#### Scenario: The removal succeeds and the deletion fails

- **WHEN** the worktree is removed and the branch deletion then fails
- **THEN** the removal is reported as having succeeded and the branch failure is reported separately

#### Scenario: The removal fails

- **WHEN** the worktree removal fails
- **THEN** no branch deletion is attempted
