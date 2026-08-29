# vault-panel Specification Delta

## ADDED Requirements

### Requirement: A row's abbreviated content is reachable on hover and on focus

WHEN a session row, a subagent row, or a row control presents content that is truncated or abbreviated to fit the row, the full content SHALL be reachable both by hovering the element with a pointer and by moving keyboard focus to it, and SHALL be presented to the user rather than only recorded in the document.

#### Scenario: A session title too long for its row

- **WHEN** the user hovers a session row whose title is truncated, or moves keyboard focus to it
- **THEN** the full title is presented
