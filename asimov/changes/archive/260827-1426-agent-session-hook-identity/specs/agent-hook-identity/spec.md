# agent-hook-identity

## ADDED Requirements

### Requirement: An agent reports the session it is running

While identity reporting is enabled for an agent, a terminal running that agent SHALL carry the session identifier the agent itself reports, and the row for that terminal SHALL name the session under that identifier.

Reporting SHALL be supported for OpenCode.

#### Scenario: Two panes of one agent in one directory

- **WHEN** two terminals in the same directory each run a reporting agent
- **THEN** each row carries the session its own terminal reported, and neither carries the other's

### Requirement: A session report is accepted only for the terminal it was issued to

A report SHALL be accepted only when it presents the credential issued to that terminal for the current run, and SHALL be rejected once that terminal has exited or been re-issued a credential.

A rejected report SHALL leave every row's identity unchanged.

### Requirement: Identity reporting is opt-in per agent

The machine-scoped setting `anywhereTerminal.opencode.hooks.enabled` SHALL default to `false` and SHALL control identity reporting for OpenCode on that host.

### Requirement: Reporting preserves the user's own OpenCode configuration

Enabling OpenCode reporting SHALL NOT add, remove, or rewrite any file in a configuration directory the user owns.

When the environment already selects an OpenCode configuration directory, that selection SHALL be preserved and reporting SHALL be forfeited for that terminal rather than replaced.

#### Scenario: The user already selects a configuration directory

- **WHEN** a terminal is launched with an OpenCode configuration directory already selected in its environment
- **THEN** that selection reaches OpenCode unchanged, and the terminal's identity resolves without a report

### Requirement: A session report carries no conversation content

A report SHALL carry only the reporting agent's session identifier and the name of the event that produced it.

Prompt text, tool input, tool output, and model output MUST NOT be transmitted.

### Requirement: Identity observers fail open

An identity observer MUST NOT block, delay past its timeout, or fail a prompt, tool call, or shell action when the receiver is absent, unavailable, malformed, or timed out.
