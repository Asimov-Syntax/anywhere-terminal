# worktree-panel Specification Delta

## ADDED Requirements

### Requirement: A named port carries a numeric preview

The create form SHALL present each offered port as its configured name and a numeric preview, while keeping the file that declared it as the row's source. The preview SHALL be presented as provisional rather than as a reservation. WHEN a preview cannot be obtained, the row SHALL keep the configured name and state that no preview is available rather than inventing a number.

### Requirement: Successful port claims do not collide across sibling worktrees

A port value the extension successfully writes for one worktree SHALL differ from every port value already claimed by a sibling worktree of the same repository. Two creates the extension performs concurrently for one repository SHALL NOT successfully claim the same value.

#### Scenario: Two windows create worktrees together

- **WHEN** two extension windows create worktrees for the same repository at the same time and both allocate a port
- **THEN** each successful claim has a different value

### Requirement: The port claim file has one strict format

A valid `.env.worktree` SHALL contain only blank lines, comment lines, and assignments whose names match `[A-Za-z_][A-Za-z0-9_]*` and whose decimal values are from 1 through 65535. Repeating a name or a numeric value SHALL make the file invalid.

### Requirement: Port names are safe environment identifiers

A configured port name SHALL be written only when it matches `[A-Za-z_][A-Za-z0-9_]*`. A name outside that grammar SHALL be reported as failed without preventing valid names from being allocated.

### Requirement: Existing non-conflicting assignments are reused

WHERE the new checkout already carries a valid `.env.worktree`, the extension SHALL reuse each selected assignment whose value no sibling claims. Missing selected names whose allocation succeeds SHALL be appended without changing any existing assignment.

#### Scenario: The file already covers every selected name

- **WHEN** `.env.worktree` contains one valid, non-conflicting assignment for every selected configured name
- **THEN** those values are reused and no fresh value is allocated or written

### Requirement: A conflicting existing assignment is retained but not adopted

WHERE a sibling already claims a value in the new checkout's `.env.worktree`, the extension SHALL leave the assignment unchanged and report that configured name as failed.

#### Scenario: An existing value conflicts with a sibling

- **WHEN** `.env.worktree` and a sibling worktree both assign the same value
- **THEN** the existing assignment is left unchanged and that configured name is reported as failed

### Requirement: An unsupported existing claim file is left untouched

WHEN the new checkout's `.env.worktree` cannot be read, is not a regular file, or is invalid under the claim-file format, the extension SHALL write nothing to it and SHALL report every selected name as failed.

### Requirement: One configured name gets one claim

WHERE more than one selected row carries the same configured name, the extension SHALL allocate or reuse one value for that name, write at most one assignment, and report the same outcome against each selected row.

### Requirement: Unproven sibling claims prevent fresh allocation

WHEN the sibling listing is incomplete, or a registered sibling's present claim file cannot be read as valid port assignments, the extension SHALL fail fresh allocations rather than choose from an incomplete claimed set. The successful worktree create SHALL remain standing.

### Requirement: Every selected port gets its own outcome

After a create, the panel SHALL report the outcome of every selected port name. A name whose allocation fails SHALL NOT prevent another name from succeeding, and no port outcome SHALL change whether the worktree create is reported as successful.

### Requirement: A changed preview is reported by variable

WHERE the authoritative allocated or reused value for a configured name differs from the value previewed in the create form, the result on the created worktree SHALL name that variable, the authoritative value, and the preview it replaced. Names whose authoritative value equals their preview SHALL NOT appear in that change report.

### Requirement: The port claim file stays local to the repository

The extension SHALL add `.env.worktree` to the repository-local exclude file and SHALL NOT add it to `.gitignore`. A failed exclude update SHALL be reported and SHALL NOT change the worktree create or any port outcome.

### Requirement: A committed allocation stays successful when lock cleanup fails

WHERE port values were committed but releasing their allocation lock fails, those port outcomes SHALL remain successful and the panel SHALL warn that a later allocation may be blocked.

### Requirement: A claimed port is not described as reserved from other processes

The create form and its result SHALL NOT claim that a preview or written value prevents an unrelated process from binding that port before setup runs.
