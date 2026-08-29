## MODIFIED Requirements

### Requirement: A destination is named only once it is known

WHEN the derived create path is already taken, the form SHALL say so, and SHALL name a final destination only when one has been resolved. It SHALL NOT present the taken path as the path that will be created. The collision SHALL be stated in one line that names the result, and SHALL NOT restate a full path a second time.

#### Scenario: A collision names the result without a second full path

- **WHEN** the derived path is taken and the host has resolved a free suffixed path
- **THEN** the form states the collision and names the suffixed result
- **AND** no second full path is displayed alongside it

## ADDED Requirements

### Requirement: The create form leads with the branch name

The branch name SHALL be the form's first input, with no other control above it, and it SHALL hold initial focus. Submission SHALL stay unavailable until the branch name validates.

#### Scenario: The branch field is what the form opens on

- **WHEN** the create form opens
- **THEN** the branch name input is the first control in the form and holds focus

#### Scenario: An invalid branch name is not submittable

- **WHEN** the branch name fails validation
- **THEN** submission is unavailable

### Requirement: The destination is stated once, and its exact value stays reachable

The form SHALL state the resolved destination exactly once, shortened for reading. The exact value SHALL be reachable without leaving the dialog. A shortened statement SHALL NOT be shown for a destination the host has not resolved.

#### Scenario: One shortened statement, exact value reachable

- **WHEN** the host has resolved a destination for the named branch
- **THEN** exactly one element states it, shortened
- **AND** the exact value is obtainable from within the dialog

### Requirement: The agent block is revealed only when an agent was asked for

Agent, permission posture, and first prompt SHALL be absent from the form unless the user chose to start an agent after creating, and SHALL be present when they do. While absent they SHALL NOT take part in the dialog's focus order, and the submitted draft SHALL carry no agent details.

#### Scenario: Nothing to start, nothing to fill in

- **WHEN** "After creating" is any choice other than starting an agent
- **THEN** no agent, posture, or prompt control is reachable in the dialog

#### Scenario: Choosing an agent reveals what starting one needs

- **WHEN** the user chooses to start an agent after creating
- **THEN** the agent, posture, and prompt controls become present and reachable

### Requirement: Every open-after mode is reachable from the offered choices

The form SHALL offer opening the created worktree's folder as a single choice, with the window-or-workspace destination selected by a secondary control on that choice. Every open-after mode the panel supports SHALL be reachable from the form.

#### Scenario: The folder choice reaches both of its modes

- **WHEN** the user chooses to open the folder after creating
- **THEN** a secondary control selects between opening a new window and adding to the workspace
- **AND** the submitted draft carries whichever of the two was selected

### Requirement: Derived and overriding inputs sit behind one disclosure

Base ref, branch source, and the destination override SHALL sit inside a disclosure that is collapsed when the form opens. While collapsed, none of them SHALL take part in the dialog's focus order. Opening it SHALL make the destination editable as an override.

#### Scenario: The form opens without its advanced inputs in the way

- **WHEN** the create form opens
- **THEN** the base ref, branch source, and destination override are not reachable by tabbing

#### Scenario: The override is offered where the advanced inputs are

- **WHEN** the user opens the disclosure and edits the destination
- **THEN** the edited value is what the submitted draft carries
