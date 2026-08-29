# Spec Delta: tab-bar-component — default-the-workbench-on

## REMOVED Requirements

### Requirement: Scoping is offered only where it has been turned on

**Reason**: The rollout it described is over. The setting is no longer declared or read, so there
is no state in which the scoped tab bar, the chip, and worktree selection are withheld — and a
requirement that a retired setting "SHALL default to disabled" describes a value nothing reads.
What the scoped tab bar does when a scope IS held is unchanged and is owned by the scoping
requirements alongside this one.
