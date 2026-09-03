## MODIFIED Requirements

### Requirement: Agent startup honours the setup wait choice

WHERE a create will start an agent and at least one setup step is selected, the form SHALL offer the
choice to wait for setup, recommended and selected by default, and SHALL state the order it produces.

- With the choice off, agent startup begins after materialization and port allocation without waiting for setup to exit.
- With the choice on, the agent starts only after every selected setup step succeeds.
- A failed gated setup starts no agent and reports the failure.
- Where no setup step is selected, the wait control remains visible but disabled.

#### Scenario: Setup is selected for an agent create

- **WHEN** an agent create is chosen and a setup step is selected
- **THEN** the wait choice is enabled and selected
- **AND** the form states that the agent starts after the selected setup finishes

## ADDED Requirements

### Requirement: An explicit overlap choice is never silently reversed

WHERE the user has set the setup wait choice themselves, that choice SHALL survive any later change
to the setup selection. Only an untouched choice follows the recommended default.

#### Scenario: The user asks for overlap

- **WHEN** the user clears the wait choice and then selects a further setup step
- **THEN** the wait choice remains cleared

#### Scenario: The setup selection is emptied and refilled

- **WHEN** the user clears every setup step and then selects one again
- **THEN** an untouched wait choice is selected again, and a cleared one stays cleared
