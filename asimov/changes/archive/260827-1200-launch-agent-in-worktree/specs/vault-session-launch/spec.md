## ADDED Requirements

### Requirement: Start a new session for an agent that declares one

Starting a brand-new session SHALL be a capability an agent declares, and an agent that
declares none SHALL NOT be offered as a launch target.

- The executable and arguments a start runs SHALL be those the selected agent declared, and no
  others.
- A declared start SHALL accept no prompt as readily as one — a launch without a prompt is not
  an error, and SHALL pass no empty argument in the prompt's place.

#### Scenario: An undeclared agent is not offered

- **WHEN** launch targets are requested and an installed agent declares no way to start a fresh session
- **THEN** that agent is absent from the offered targets, rather than offered and failing at launch

### Requirement: A seeded prompt arrives submitted

WHEN a launch carries a prompt, the started agent SHALL receive it as an already-submitted
turn rather than as editable composer text.

- The prompt SHALL be passed as a single argument, never concatenated into a command string.
- A launch target SHALL state whether that agent can be seeded at all, and an agent that cannot
  SHALL NOT be offered a prompt.

### Requirement: A prompt is never read as a command-line option

A prompt that would be parsed as an option by the agent it is passed to SHALL be rejected
rather than launched.

#### Scenario: A posture cannot be smuggled through the prompt

- **WHEN** the prompt begins with a hyphen, such as a flag that would bypass the agent's permission checks
- **THEN** nothing is launched, and the posture the user selected is the only one that could have applied

### Requirement: A launch may name the directory it runs in

A launch SHALL accept an explicit working directory that takes precedence over the one
recorded against the session being launched.

- Absent an explicit directory, the recorded one SHALL still apply.

#### Scenario: Resuming a session somewhere else

- **WHEN** a stored session whose recorded directory is A is resumed with an explicit directory B
- **THEN** the resumed agent runs in B
