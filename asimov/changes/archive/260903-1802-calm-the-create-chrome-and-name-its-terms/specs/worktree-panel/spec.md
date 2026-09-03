## ADDED Requirements

### Requirement: A secondary action does not carry a primary action's weight

An action that is not the surface's decision SHALL be presented as secondary. The panel's
inline empty state and the provisioning save action are both secondary, and neither SHALL
be styled as the surface's primary button.

#### Scenario: The tree offers a create for a repository with no worktrees

- **WHEN** the inline empty state offers to create a worktree
- **THEN** its action is presented as a secondary action

#### Scenario: The create form offers to save provisioning defaults

- **WHEN** the provisioning section offers to save the current choices
- **THEN** the save action is presented as secondary, and its explanation sits below it rather than wrapping around it

### Requirement: A disclosure names what it hides

A collapsed region in the create form SHALL name the choices it contains, so a user can tell
whether to open it without opening it.

#### Scenario: The advanced region is collapsed

- **WHEN** the create form is opened
- **THEN** the collapsed region names the inputs it holds

### Requirement: A term of art carries its own explanation

WHERE the create form labels a control with a git term of art, that label SHALL carry a
hover and assistive-technology explanation of what the term means for this create. The
explanation SHALL be available without changing any choice.

#### Scenario: The base ref input is offered

- **WHEN** the advanced region is opened
- **THEN** the base ref control carries an explanation of what a base ref is

#### Scenario: The detached checkout choice is offered

- **WHEN** the detached-checkout choice is shown
- **THEN** it carries an explanation of what detaching at a ref produces
