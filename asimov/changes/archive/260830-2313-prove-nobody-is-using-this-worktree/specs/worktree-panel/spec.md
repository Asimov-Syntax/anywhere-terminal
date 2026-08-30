# Spec Delta — worktree-panel

## ADDED Requirements

### Requirement: The removal assessment reports whether the worktree looks abandoned

The removal assessment SHALL report three orphan proofs — that the worktree's lock is older than a recorded threshold, that no process is recorded as owning it, and that its branch is merged — each carrying its own outcome from the same four-outcome vocabulary as every other check. Each proof SHALL be answered from a named existing source and SHALL NOT be inferred from any other proof's answer.

#### Scenario: A worktree that is not locked

- **WHEN** the assessment runs against a worktree git does not report as locked
- **THEN** the lock-age proof is reported as not applicable rather than as passed or failed

### Requirement: A proof never blocks the removal it accompanies

A proof SHALL NOT refuse a removal, SHALL NOT cause a typed confirmation to be required, and SHALL NOT cause a previously granted confirmation to be re-requested. WHEN a proof cannot be evaluated it SHALL be reported as unproven, and the removal SHALL remain exactly as available as it was without the proof.

#### Scenario: Every proof is unproven

- **WHEN** none of the three proofs can be evaluated and no confirmable risk is present
- **THEN** the removal is still offered without a typed confirmation

#### Scenario: A proof degrades between confirmation and execution

- **WHEN** the user confirms a removal and a proof that was passing is unproven at execution time
- **THEN** the removal proceeds on the confirmation already given, and only the option that proof gated is withdrawn

### Requirement: The merge proof reads local refs and never fetches

The merge proof SHALL be answered by comparing the worktree's branch against a default branch resolved from local references only. The system SHALL NOT contact a remote to answer it. WHEN the default branch cannot be resolved, or the comparison cannot be made, the proof SHALL be reported as unproven rather than as not merged. WHEN the worktree has no branch, the proof SHALL be reported as not applicable.

#### Scenario: A branch that is not an ancestor of the default branch

- **WHEN** the worktree's branch contains commits the resolved default branch does not
- **THEN** the merge proof is reported as failed rather than unproven

#### Scenario: The repository has no resolvable default branch

- **WHEN** no local reference identifies a default branch
- **THEN** the merge proof is reported as unproven and no removal behavior changes

### Requirement: The ownership proof distinguishes no record from a dead record

The ownership proof SHALL be answered from the session registry read in a way that preserves records whose process is gone. A registry that names no record for the worktree SHALL be reported as the proof passing; a registry that names a record whose process is gone SHALL also be reported as passing; a registry that names a record whose process is alive SHALL be reported as failing; and a registry that cannot be read SHALL be reported as unproven rather than as either.

#### Scenario: A crashed session left a record behind

- **WHEN** the registry holds a record rooted in the worktree whose process no longer exists
- **THEN** the ownership proof passes, and the record is not reported as a live agent
