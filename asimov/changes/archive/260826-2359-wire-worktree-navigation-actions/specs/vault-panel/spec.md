# Spec Delta: vault-panel

## ADDED Requirements

### Requirement: A context menu is keyboard-navigable and gives focus back

An open row context menu SHALL place keyboard focus on its first item and SHALL move focus
between items with `ArrowUp` and `ArrowDown`, wrapping at both ends. WHEN it is dismissed with
`Escape`, focus SHALL return to the row it was opened from.

#### Scenario: Escape returns the user to the row they came from

- **WHEN** a context menu is open and `Escape` is pressed
- **THEN** the menu closes and keyboard focus is on the row it was opened from
