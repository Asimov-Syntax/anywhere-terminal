# pane-evidence-transport Delta

## ADDED Requirements

### Requirement: A shell title reclaims the pane

WHEN a pane's reported title names a shell rather than an agent, the pane's activity SHALL be
`idle`, overriding output and semantic working evidence. This SHALL NOT override `exited` or
`waiting`.

#### Scenario: A shell title while output is still recent

- **WHEN** a pane's reported title changes to a shell name and output was seen within the idle window
- **THEN** the pane reads `idle`

#### Scenario: A shell title on a pane that is waiting

- **WHEN** a pane's reported title names a shell and waiting evidence is set
- **THEN** the pane reads `waiting`

### Requirement: A decorative title is not activity evidence

A reported title whose content is decoration alone SHALL leave a pane's activity exactly as the
pane's other evidence decides it, and a title naming neither a shell nor an agent SHALL do the same.

#### Scenario: A neutral title while output is still recent

- **WHEN** a pane's reported title names neither a shell nor an agent, and output was seen within the idle window
- **THEN** the pane reads `running`
