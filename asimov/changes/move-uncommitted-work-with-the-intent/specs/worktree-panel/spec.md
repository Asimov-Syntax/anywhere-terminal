# Spec Delta: worktree-panel

## ADDED Requirements

### Requirement: The create form offers to move uncommitted work only when there is work to move

WHERE the worktree the user is creating from has at least one uncommitted change and the editor's
git integration can perform the move, the create form SHALL offer to move that work into the new
worktree, and SHALL state how many changes would move. WHERE either condition does not hold, the
form SHALL NOT offer it.

The count SHALL be the number of distinct paths that are staged, changed in the working tree, or
untracked; a path in more than one of those SHALL be counted once.

#### Scenario: There is work to move

- **WHEN** the source worktree has uncommitted changes and the integration can move them
- **THEN** the form offers to move them and states how many changes that is

#### Scenario: A path is both staged and edited

- **WHEN** one path is staged and also changed in the working tree
- **THEN** the form states it as one change

#### Scenario: Nothing to move

- **WHEN** the source worktree has no staged, working-tree, or untracked changes
- **THEN** the form does not offer to move anything

#### Scenario: The editor cannot perform the move

- **WHEN** the running editor's git integration does not provide change migration
- **THEN** the form does not offer to move anything, and the create is otherwise unaffected

### Requirement: The work moves between the create and the provisioning

WHEN the user asked for the work to be moved, the extension SHALL move it after git reports the
worktree was created and before it materializes any provisioning entry, so that a setup command
runs against the moved work. Untracked work SHALL move with the rest.

#### Scenario: A setup command sees the moved work

- **WHEN** a create carries both the move and provisioning entries
- **THEN** the move completes before the first provisioning entry is materialized

#### Scenario: Untracked files move too

- **WHEN** the moved work includes a file git is not tracking
- **THEN** that file moves with the rest rather than staying behind

### Requirement: A move that fails leaves the worktree standing and the work where it was

WHERE the move fails, the extension SHALL report the failure as a failure of the move, SHALL NOT
report it as a failed create, SHALL NOT remove the created worktree, and SHALL leave the work in the
worktree it came from.

WHERE the editor's git integration has already reported the failure to the user itself, the
extension SHALL NOT report it a second time.

#### Scenario: The move fails

- **WHEN** the move fails after the worktree was created
- **THEN** the create is still reported as having succeeded, the worktree remains, and the failure
  is reported as the move's

#### Scenario: The integration reported it already

- **WHEN** the move stops for a reason the git integration has already told the user about
- **THEN** the extension does not report a second message for the same event

### Requirement: Declining to move leaves both worktrees untouched

WHERE the user does not ask for the work to be moved, the extension SHALL NOT move it, and the
source worktree's changes SHALL remain exactly as they were.

#### Scenario: The offer is declined

- **WHEN** the user creates a worktree without asking for the work to move
- **THEN** no migration is attempted and the source worktree's changes are unchanged
