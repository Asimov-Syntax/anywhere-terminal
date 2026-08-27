# Spec Delta: vault-session-preview

## ADDED Requirements

### Requirement: A bounded read reports what its bound dropped

WHEN a session detail read applies a bound to any query whose overflow would drop delegations or
messages from the result, the read SHALL determine whether the bound was reached and SHALL
report source omission when it was. A bound reached without that report is not permitted.

The delegation count a detail declares SHALL be the count its source supports, not the count
that survived a window, so a read that dropped records still declares more than it hands over.

#### Scenario: A session with more direct delegations than the read retains

- **WHEN** a session has more direct child sessions than one read retains
- **THEN** the detail reports source omission, and its declared delegation count exceeds the delegations it handed over

### Requirement: One invocation appears once in a timeline

A session timeline SHALL carry one item per delegated invocation. WHEN a source records the same
invocation both as an invocation step and as a child session, the timeline SHALL carry the child
session item alone; WHEN no child session exists for an invocation, the timeline SHALL carry its
invocation step.

#### Scenario: An invocation with a child session is not also listed as a step

- **WHEN** a timeline is built for a session whose source holds both records for one invocation
- **THEN** the invocation appears once, as the child session item
