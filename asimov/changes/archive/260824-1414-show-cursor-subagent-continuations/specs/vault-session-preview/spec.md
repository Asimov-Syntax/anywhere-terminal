# Spec Delta: vault-session-preview (show-cursor-subagent-continuations)

## MODIFIED Requirements

### Requirement: Cursor subagent continuation identity

A continuation SHALL take its agent identity from the invocation's own bounded `resume` argument
rather than the invoking tool's name.

Sub-agent counts SHALL report distinct agents rather than invocations.

## ADDED Requirements

### Requirement: Cursor subagent continuation placement

Calls naming the same bounded agent identity SHALL render as one launch card at the first
decoded invocation's position, followed by one continuation entry at each later invocation's own
position.

Every entry SHALL carry that invocation's own bounded description and correlated result, and
SHALL open the same saved child transcript.

#### Scenario: User previews a sub-agent that was resumed twice

- **WHEN** one background launch declares a subagent type and two later calls carry only that agent's `resume` id
- **THEN** the preview shows a launch card plus two continuation entries at the positions the resumes occurred
- **AND** opening any of the three shows that agent's own saved transcript covering every turn

### Requirement: Cursor subagent declared type resolution

An invocation's declared agent type SHALL be resolved from every invocation decoded for the
session, including invocations the bounded preview window excludes from display.

When no decoded invocation declares a type for that agent, the preview SHALL omit the agent type
rather than show the invoking tool's name.

#### Scenario: The launch invocation falls outside the displayed window

- **WHEN** the bounded preview window retains a resumed agent's continuations but not its declaring launch
- **THEN** those continuations remain visible and stay labelled with the agent's declared type

### Requirement: Nested invocation turn focus

Expanding an invocation that records a bounded prompt SHALL reveal the turn that prompt began
within the fetched child transcript, scrolled into view and visually marked.

When no turn in the fetched transcript matches, the preview SHALL render the transcript
unfocused rather than mark an unrelated turn.

#### Scenario: User expands the third invocation of one agent

- **WHEN** an agent addressed by three invocations has its third expanded
- **THEN** the child transcript opens with that invocation's own turn revealed and marked, not the transcript's first turn

