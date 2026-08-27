# worktree-tree-protocol — delta

## ADDED Requirements

### Requirement: A mutating action resolves its own target

Every mutating worktree action SHALL resolve its target host-side from an identifier the host itself issued, and SHALL NOT accept a filesystem path from the view for any object that already exists. WHEN the identifier is absent from the current tree, the action SHALL fail without running any git command, report that the target no longer exists, and push a rebuilt tree.

#### Scenario: A stale identifier runs nothing

- **WHEN** a mutating action names a worktree that is no longer in the host's tree
- **THEN** no git command runs, the action reports the target as gone, and a freshly built tree is pushed

### Requirement: Git is invoked as an argument vector

Every git invocation a mutating action makes SHALL pass its arguments as a vector, never as a string interpreted by a shell. A user-supplied branch name, base reference, lock reason, or path SHALL be rejected when it begins with `-`, and SHALL otherwise be passed as exactly one argument.

### Requirement: An unsafe destructive action returns its blockers rather than failing

WHEN the host judges a destructive action unsafe, it SHALL return the set of blockers that apply, together with an identifier naming that set, instead of reporting a failure.

### Requirement: A confirmation authorizes one blocker set and no other

WHEN a destructive action is re-sent with a blocker-set identifier, the host SHALL re-evaluate the blockers immediately before invoking git and SHALL proceed only while every item at risk in the re-evaluated set was also at risk in the set that identifier names. The comparison SHALL be over the identities at risk — which files, which panes, which sessions — and not over their counts.

#### Scenario: A same-count substitution re-prompts

- **WHEN** the files or panes at risk are replaced by different ones between the confirmation and the re-send, leaving every count unchanged
- **THEN** the action does not run, and a fresh blocker set with a fresh identifier is returned

#### Scenario: A blocker that appeared after the confirmation re-prompts

- **WHEN** a worktree acquires a blocker between the confirmation being shown and the action being re-sent
- **THEN** the action does not run, and a fresh blocker set with a fresh identifier is returned

#### Scenario: An identifier the host did not issue authorizes nothing

- **WHEN** a forced action carries an identifier this host did not issue for this target, or one that has expired
- **THEN** the action does not run and the current blocker set is returned for confirmation

### Requirement: A forced removal carries the identifier it was authorized by

A forced removal SHALL carry a blocker-set identifier this host issued for that target. An unforced removal SHALL be rejected WHEN it carries an identifier at all.

### Requirement: Some blockers no confirmation can override

The host SHALL refuse a removal outright, offering no confirmation path, WHEN the target is the repository's main worktree, WHEN the target holds an agent whose activity is running or waiting, or WHEN the target contains another worktree the repository has registered.

#### Scenario: Removing a worktree that contains a registered worktree is refused

- **WHEN** a removal targets a worktree that contains another registered worktree of the same repository
- **THEN** the removal is refused with no confirmation offered, and every contained worktree is named

#### Scenario: A refused removal carries no confirmation identifier

- **WHEN** a removal is refused
- **THEN** the result carries no blocker-set identifier, so no later re-send can present one for that state

#### Scenario: A session in another window blocks but does not refuse

- **WHEN** the only agent rooted in the target belongs to another window rather than this one
- **THEN** the removal is confirmable, and it is not refused as holding an agent mid-turn

### Requirement: Every mutation attempt is followed by a rebuild

The host SHALL rebuild and push the affected repository's tree after every mutating action attempt, including one that exited non-zero and one that exceeded its time limit. WHEN the rebuild finds git's registrations and the filesystem in disagreement, the result SHALL report an indeterminate outcome describing what was observed, rather than a clean success or a clean failure.

### Requirement: Mutations on one repository do not interleave

The host SHALL run at most one mutating action per repository at a time, and a queued action SHALL re-resolve its target and re-evaluate its blockers against the tree as it stands when it starts, never against the tree as it stood when it was queued.

### Requirement: A create path is validated as untrusted input

WHEN an action supplies a path for a worktree that does not yet exist, the host SHALL require that path to be absolute after normalization, to be absent or an empty directory, and to lie outside every linked worktree of the repository. The host SHALL refuse the path WHEN any existing component **of the path as supplied** is a symbolic link, judged before any resolution that would replace that component with its target.

#### Scenario: A symlinked component is refused rather than resolved through

- **WHEN** a create path names an existing symbolic link as one of its components
- **THEN** the path is refused, and the worktree is not created at the link's target

#### Scenario: A validated path is re-checked after waiting behind another mutation

- **WHEN** a create waits behind another mutation on the same repository
- **THEN** its path is validated again against the current filesystem before git runs, rather than reusing the earlier result

### Requirement: A create path is re-checked against the filesystem it will be created on

Immediately before invoking git, the host SHALL re-check the identity of the candidate directory itself together with its emptiness WHEN it already exists, and the identity of its nearest existing ancestor otherwise.

### Requirement: A mutation resolves against the rebuilt tree, not a stale cache

WHEN a mutating action arrives while a rebuild of the same repository is in flight, the host SHALL wait for that rebuild and SHALL resolve the action's target against its result, rather than against the tree the action was queued behind.

### Requirement: A removal that was killed is never reported as a clean failure

WHEN a removal exceeds its time limit or is otherwise terminated before git reports an outcome, the host SHALL report an indeterminate result, whether or not the target's directory and registration both still exist. The host SHALL also report an indeterminate result WHEN the rebuild that follows an attempt cannot obtain an authoritative listing.

#### Scenario: A partial deletion is not reported as a clean error

- **WHEN** a forced removal is killed after deleting part of the worktree, leaving the directory and the registration in place
- **THEN** the result is indeterminate and describes what was observed, rather than reporting that nothing happened


### A removal whose risk cannot be read is not reported as safe

When any source of a removal's blocker evidence cannot be read — the worktree's own
`git status`, the external-session registry, or the repository listing itself — the removal
reports that it could not check, names which reads failed, and runs no git command. It does not
report an empty blocker set, and no confirmation is issued against one.

### A confirmation does not survive the disappearance of what it was issued for

A confirmation is destroyed when the worktree it names is next observed to be absent. A worktree
created afterwards at the same path is a different worktree, and the earlier confirmation
authorizes nothing against it.

### A confirmation authorizes one attempt

Submitting a confirmation spends it, whatever the attempt then reports — including attempts that
never reach git.
