# pane-evidence-transport Specification
## Requirements

### Requirement: Report pane title and waiting evidence to the host

The system SHALL accept a `paneEvidence` message naming a `paneId`, by which the surface
rendering that pane reports its title evidence, whether it is waiting on the user, or both.

- `title` → the title's decorative signature, normalized as `process-title-tracking` defines it.
- `decorated` → whether the raw title carried a decorative frame, a fact normalization destroys
  and the recipient cannot recover. Carried if and only if `title` is.
- `waiting` → whether the pane is waiting on the user.

### Requirement: Title evidence and waiting evidence travel independently

A `paneEvidence` message SHALL be able to carry either piece of evidence alone. Reporting one
SHALL NOT require stating the other, and SHALL NOT change what is held for the other.

#### Scenario: A title is reported before waiting evidence exists

- **WHEN** a pane's title is reported and no waiting evidence has ever been reported for it
- **THEN** that pane's waiting evidence still reads as unknown, not as `false`

### Requirement: Report on change, never on a timer

A `paneEvidence` message SHALL be sent only when a value it carries differs from the one last
reported for that pane, and SHALL carry only the evidence that changed.

#### Scenario: A spinner frame advances

- **WHEN** a pane's title changes from `⠋ Fix tests` to `⠙ Fix tests`
- **THEN** no `paneEvidence` message is sent

#### Scenario: A spinner stops

- **WHEN** a pane's title changes from `⠙ Fix tests` to `Fix tests`
- **THEN** one `paneEvidence` message is sent, carrying title `Fix tests` and `decorated: false`

### Requirement: Evidence is keyed by pane, never by surface

Reported evidence SHALL be held against the `paneId` alone. Where more than one surface reports
the same pane, the most recent report SHALL be the one held, and the surface it came from SHALL
NOT change what is held or where it is held.

#### Scenario: Two surfaces report one pane

- **WHEN** two surfaces each report the same `paneId`, the second carrying a later title
- **THEN** the evidence held for that pane is the second report, and there is exactly one entry
  for it

### Requirement: Evidence lasts as long as the pane, not as long as its process

Evidence for a pane SHALL be discarded only when the pane itself is closed. Neither the disposal
of a surface that reported it, nor the exit of the pane's own process, SHALL discard it.

#### Scenario: The reporting surface goes away

- **WHEN** the only surface that reported a pane's title is disposed while the pane still exists
- **THEN** that pane's title evidence is unchanged

#### Scenario: The process exits while the pane stays open

- **WHEN** a pane's process exits and the user leaves the pane open
- **THEN** that pane still has evidence, and its activity reads `exited`

#### Scenario: The pane is closed

- **WHEN** the user closes a pane, whether its process had already exited or not
- **THEN** no evidence is held for it

### Requirement: Unreported evidence is distinguishable from reported absence

For every pane, the system SHALL distinguish evidence never reported from evidence reported as
absent. A pane no surface has reported SHALL read as unknown title and unknown waiting, which is
NOT equal to a reported empty title or a reported `waiting: false`.

### Requirement: Reject evidence a report cannot justify

A `paneEvidence` message SHALL be discarded without being stored when it names a `paneId` the
system holds no pane for, so a report can never bring a pane into existence.

- `paneId` absent or not a non-empty string → discarded.
- `title` present without `decorated`, or `decorated` without `title` → discarded.
- `title` not a string, `decorated` or `waiting` not a boolean → discarded.
- `title` longer than 1024 characters → truncated to that length rather than stored whole.

### Requirement: Hold output, exit, and semantic evidence independently of any report

For every pane it holds, the system SHALL know when that pane's output was last seen, whether its
process has exited, and its agent-reported semantic status, each updated as it occurs.

- These SHALL be correct for a pane no surface has ever reported.
- Output SHALL be counted as seen at the moment it is delivered to the surface rendering the
  pane, so the pane's own view of its output and the system's cannot be a different one.

### Requirement: Pane activity states

A pane's activity SHALL be exactly one of `exited`, `waiting`, `running`, or `idle`, decided from
that pane's evidence in that order of precedence.

- `exited` → the pane's process has exited while the pane is still open.
- `waiting` → waiting evidence is set.
- `running` → output was seen within the idle window, or semantic working evidence is set.
- `idle` → none of the above.

### Requirement: A worktree row and a terminal tab never disagree about a pane

For one pane and one set of evidence, the activity shown on that pane's worktree row and the
activity shown on its terminal tab SHALL be equal.

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

