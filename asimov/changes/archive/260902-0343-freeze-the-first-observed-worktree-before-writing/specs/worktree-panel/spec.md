# worktree-panel Specification Delta

## ADDED Requirements

### Requirement: Selected post-create writes retain observed checkout identity

After Git creates a worktree, the extension SHALL freeze the first stable filesystem identities it observes for the source and destination of selected provisioning work.

- Stable identity unavailable → Git create remains successful and the affected selected work fails.
- Identity change observed before a selected write begins → that work fails and no write begins through the observed replacement.

### Requirement: Sibling claim reads sample stable listing-time identity

A sibling claim SHALL contribute to port allocation only when the sibling's listing-time identity matches immediately before and after its claim read.

- Stable identity unavailable or mismatched → fresh allocation fails rather than using an incomplete claimed set.
- A normalized listing row that identifies the new worktree SHALL be excluded from its sibling set by filesystem identity.
