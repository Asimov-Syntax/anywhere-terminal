# worktree-tree-protocol Specification

## MODIFIED Requirements

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
