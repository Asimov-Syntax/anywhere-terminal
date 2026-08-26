# worktree-tree-protocol Delta

## ADDED Requirements

### Requirement: A push never replaces newer published state with older

WHEN two pushes are prepared concurrently, the surfaces SHALL NOT be left holding the older of the
two. A push whose contents were superseded while it was being prepared SHALL be discarded rather
than delivered.

#### Scenario: A slow presence projection finishes after a newer push

- **WHEN** a presence projection begins against the current tree, a newer push is delivered while it is still running, and the projection then completes
- **THEN** the surfaces still hold the newer state
