# worktree-agent-presence

## MODIFIED Requirements

### Requirement: Claim agent identity only from evidence that proves it

Every agent row SHALL carry the source that proved its identity, resolved in the precedence a report
from the agent itself, then launch record, then live session registry, then process recognition, then
a committed title. A row SHALL report `none` and claim no agent when no source proved one.

#### Scenario: A pane no surface has reported

- **WHEN** no surface has reported a pane's title
- **THEN** identity resolves by a source ranked above the title, and reaching none of them reports `none` rather than treating the missing title as proof of absence

## ADDED Requirements

### Requirement: One session belongs to one pane

When more than one pane resolves to the same session, the session SHALL be claimed by the pane whose
evidence ranks strictly highest, and by no pane at all when the strongest evidence is shared.

A pane that loses a contested session SHALL fall back to its own reported title, and SHALL claim no
agent when that session was the only source that proved one.

#### Scenario: Two panes in one directory, one of them running the agent

- **WHEN** a pane running an agent and a pane running a shell resolve to the same session by sharing a directory
- **THEN** only the pane whose evidence proves the agent is in it carries that session
