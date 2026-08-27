# worktree-tree-protocol Specification
## Requirements

### Requirement: Answer a worktree tree request

The system SHALL accept a `requestWorktreeTree` message carrying an optional `force` flag and
SHALL answer it with exactly one `worktreeTreeResponse`. Without `force` the answer MAY be served
from the cached listing; with `force` the listings SHALL be rebuilt before the answer is sent, and
a rebuild already running SHALL NOT be taken as that rebuild.

#### Scenario: Concurrent requests without force produce one rebuild

- **WHEN** two `requestWorktreeTree` messages without `force` arrive while a rebuild for the same
  scope is already in flight
- **THEN** one rebuild runs and one push is produced

#### Scenario: A forced request during a rebuild rebuilds again

- **WHEN** a `requestWorktreeTree` carrying `force` arrives while a rebuild for the same scope is
  already in flight
- **THEN** a further rebuild runs, and the request is answered from it

### Requirement: Push the tree and the presence projection together

Every `worktreeTreeResponse` SHALL carry both the worktree tree and the presence projection in
one message. The two halves SHALL NOT be delivered as separate messages, so a recipient can
never hold a presence row keyed to a worktree absent from the tree it currently has.

### Requirement: Push unsolicited on the same message

A rebuild the system initiated SHALL be delivered as a `worktreeTreeResponse` identical in
shape to the reply to a request, so a recipient cannot distinguish, and need not, whether it
asked for a given tree.

### Requirement: Deliver each push only to surfaces showing the view

The system SHALL accept a `worktreeViewVisibility` message carrying a `visible` flag, by which
one surface declares whether its worktree view is being shown. Each push SHALL be delivered to
every live surface that has both declared the view visible and is being displayed by the window —
including the surface whose request produced it — and SHALL NOT be delivered to any other surface.

#### Scenario: A hidden surface is skipped

- **WHEN** two surfaces have declared the view visible and a third has not
- **THEN** the push reaches exactly the two that declared it visible

#### Scenario: A retained surface stops receiving while it is not displayed

- **WHEN** a surface that declared the view visible stops being displayed, and a rebuild produces a push
- **THEN** that surface receives no push, and the surfaces still displayed receive it

### Requirement: Serve a surface that is displayed again

WHEN a surface begins showing the view again after a period of not showing it, the system SHALL
deliver the current listings to that surface without the surface asking, and SHALL NOT require a
rebuild to do so. Where no listings have been produced yet, it SHALL produce them.

The delivery SHALL reach only the surface that began showing the view, so a surface already
showing it performs no work on another surface's transition.

#### Scenario: A surface displayed again shows current data

- **WHEN** a surface stops being displayed, the listings change while it is not displayed, and it is displayed again
- **THEN** that surface receives the changed listings, and no rebuild is run to produce them

### Requirement: A push never replaces newer published state with older

WHEN two pushes are prepared concurrently, the surfaces SHALL NOT be left holding the older of the
two. A push whose contents were superseded while it was being prepared SHALL be discarded rather
than delivered.

#### Scenario: A slow presence projection finishes after a newer push

- **WHEN** a presence projection begins against the current tree, a newer push is delivered while it is still running, and the projection then completes
- **THEN** the surfaces still hold the newer state

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

