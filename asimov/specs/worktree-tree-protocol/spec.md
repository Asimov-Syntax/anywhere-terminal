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

