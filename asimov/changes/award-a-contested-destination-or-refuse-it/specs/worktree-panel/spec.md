# Spec Delta: worktree-panel

## ADDED Requirements

### Requirement: A destination two declarations may both name is held by the repository's own

WHERE two selected declarations may name one destination and one of them is the repository's own,
the extension SHALL materialize the repository's own declaration before the other, so that the
material and the `mode` at that destination are the repository's own declaration's.

#### Scenario: Both spellings resolve to one file

- **WHEN** two selected declarations differ only in a form the worktree's filesystem folds, and one
  of them is the repository's own
- **THEN** the worktree holds the repository's own declaration's material under its own `mode`

#### Scenario: The two spellings may be two files here

- **WHEN** two such declarations name destinations this filesystem may keep apart
- **THEN** only the repository's own is materialized, and the other is refused naming both
  declarations, because nothing available can establish that the second destination is a different
  slot rather than the first one having been removed

### Requirement: A collision the extension cannot attribute to its own write is refused

WHERE a destination two selected declarations may both name is already present when the apply
begins, or is present after the repository's own declaration ran without the extension being able
to establish that this apply's own write put it there, the extension SHALL report a refusal naming
both declarations, SHALL NOT resolve the destination in favour of the inherited declaration, and
SHALL NOT write into it.

#### Scenario: The destination was already in the worktree

- **WHEN** the destination already exists when the apply begins
- **THEN** neither declaration's material is written into it and both are named in the refusal

#### Scenario: The repository's own declaration failed first

- **WHEN** the repository's own declaration is refused or fails before it claims the destination
- **THEN** the other declaration is refused rather than applied in its place

#### Scenario: The repository's own declaration claimed it

- **WHEN** the repository's own declaration has materialized the destination
- **THEN** the other declaration is refused rather than written, whatever its own destination reads

#### Scenario: More than two declarations may name one destination

- **WHEN** three or more selected declarations may name one destination
- **THEN** every refusal names every one of them, by path and declaring file, its own included

### Requirement: A destination more than one of the repository's own declarations name is refused entire

WHERE more than one selected declaration naming a destination is the repository's own, the extension
SHALL materialize none of them, SHALL report a refusal naming every declaration in the group by path
and declaring file, and SHALL NOT resolve the destination in favour of any of them.

Nothing available decides between two of the repository's own declarations: their order inside one
file is not a precedence anything here grants, and choosing by it would settle a user's config
silently.

#### Scenario: Two of the repository's own declarations name one destination

- **WHEN** two selected declarations from the repository's own file may name one destination, beside
  an inherited declaration that may name it too
- **THEN** nothing is written at that destination, and every one of the three is refused naming the
  others

#### Scenario: The user leaves only one of them selected

- **WHEN** the user unselects all but one of the repository's own declarations for that destination
- **THEN** the remaining one is the repository's own declaration for the group and is materialized,
  because the question the refusal could not answer is no longer being asked

### Requirement: A symlink that would resolve to itself is never created

WHERE recreating a symlink in the new worktree would produce a link whose target resolves to that
link's own destination, the extension SHALL refuse it and report why, rather than creating a link
that resolves to itself.

## MODIFIED Requirements

### Requirement: A declaration that will yield is offered as yielding

WHERE declared entries may name one destination, what the dialog says will be brought over SHALL
follow from the selection it currently holds, under the rule the apply uses to decide that group. A
row that selection would have refused SHALL say so and SHALL NOT be counted, and where unselecting
it is what lets the group succeed, it SHALL be offered unselected.

#### Scenario: The inherited spelling is offered beside the repository's own

- **WHEN** the offer contains two declarations that may name one destination and exactly one of them
  is the repository's own
- **THEN** the repository's own is selected and the other is not, and the other says it will be
  refused while its counterpart stays selected

#### Scenario: The summary counts only what will arrive

- **WHEN** such a pair is offered
- **THEN** the summary counts the repository's own declaration and not the one that will yield

#### Scenario: Nothing is favoured

- **WHEN** two declarations may name one destination and neither is the repository's own
- **THEN** both stay selected, because nothing decides between them and unselecting either would
  pick a winner the apply does not

#### Scenario: More than one of the repository's own declarations names a destination

- **WHEN** the offer contains two declarations from the repository's own file that may name one
  destination, beside an inherited declaration that may name it too
- **THEN** all three are offered selected, each says the create will refuse it because more than one
  of the repository's own declarations names this destination, and none is counted — there is no
  selection the dialog could offer that makes this group succeed, and unselecting one of the
  repository's own on the user's behalf would pick the winner the apply refuses to pick

#### Scenario: The user unselects one of the repository's own

- **WHEN** the user leaves exactly one of the repository's own declarations in that group selected
- **THEN** the remaining one stops saying it will be refused and is counted, and the inherited
  declaration says it will yield to it

#### Scenario: The user selects the second one again

- **WHEN** a second of the repository's own declarations is selected again
- **THEN** every row in the group returns to saying it will be refused, and none is counted

#### Scenario: Only the inherited declaration is left selected

- **WHEN** the user unselects both of the repository's own declarations and leaves the inherited one
- **THEN** it stops saying it will be refused and is counted, because the selection it holds names
  one declaration for that destination

### Requirement: The material a worktree was promised is actually put there

WHEN a worktree is created with provisioning entries the user left selected, the extension SHALL
materialize each one it does not refuse into the new worktree — copying by default, linking where
the entry says link — and SHALL report the outcome of every entry it was given, refusals included.
Copying SHALL happen before linking, EXCEPT where declarations may name one destination, which the
two requirements above settle.

#### Scenario: The files the dialog listed are in the new worktree

- **WHEN** a create carries selected copy entries, none of which may name another's destination
- **THEN** each of those files exists in the new worktree, and each is reported as copied

#### Scenario: Only what was selected is materialized

- **WHEN** the user unticks an entry before creating
- **THEN** that entry is not written into the new worktree and is not reported as a step that ran

#### Scenario: The report arrives after the create's own result

- **WHEN** provisioning entries are applied
- **THEN** the create's success is reported first, and the per-entry outcomes follow it
