# worktree-tree-protocol Specification
## Requirements

### Requirement: Answer a worktree tree request

The system SHALL accept a `requestWorktreeTree` message carrying an optional `force` flag and
SHALL answer it with exactly one `worktreeTreeResponse`. Without `force` the answer MAY be
served from the cached listing; with `force` the listings SHALL be rebuilt before the answer is
sent.

#### Scenario: Concurrent requests produce one rebuild

- **WHEN** two `requestWorktreeTree` messages arrive while a rebuild for the same scope is
  already in flight
- **THEN** one rebuild runs and one push is produced

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
every live surface that has declared the view visible — including the surface whose request
produced it — and SHALL NOT be delivered to a surface that has declared it not visible, has
never declared, or has been disposed.

#### Scenario: A hidden surface is skipped

- **WHEN** two surfaces have declared the view visible and a third has not
- **THEN** the push reaches exactly the two that declared it visible

