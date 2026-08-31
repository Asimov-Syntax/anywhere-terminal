# worktree-panel — delta

## ADDED Requirements

### Requirement: A destination holding debris is offered as recover, not silently avoided

Where a create destination holds a directory that is not a git checkout, the panel SHALL report that
destination as debris and offer to clear it, naming the directory and what it holds. The offer SHALL
compose with any branch mode, so clearing debris and reusing an existing branch is expressible.
A destination holding a `.git` file or directory SHALL NOT be reported as debris.

#### Scenario: A non-git directory is offered rather than suffixed away

- **WHEN** the derived destination holds a directory with no `.git` entry
- **THEN** that destination is offered as recover, stating the path and what will be removed, instead
  of the create silently moving to a suffixed path

#### Scenario: A surviving checkout is not debris

- **WHEN** the derived destination holds a directory containing a `.git` file or directory
- **THEN** the destination is not offered as recover

### Requirement: Clearing debris happens only under an authorization bound to what was found

The panel SHALL NOT remove a debris directory unless the request carries a host-issued authorization
for that path whose evidence still covers what is present when the removal runs; otherwise the
removal SHALL be refused and the user re-prompted with the current contents. The panel SHALL refuse
the removal where any component of the path is a symbolic link, and SHALL refuse it where the
directory's identity differs from the identity recorded when the authorization was issued.

#### Scenario: An authorization does not cover content that appeared after it was issued

- **WHEN** the debris directory holds an entry that was not present when the authorization was issued
- **THEN** the removal is refused and the user is re-prompted, and no entry is removed

#### Scenario: The directory was replaced between authorization and removal

- **WHEN** the path resolves to a directory whose device and inode differ from those recorded at
  authorization
- **THEN** the removal is refused and nothing at that path is removed

### Requirement: A create never reports success for a clearance that did not complete

Where clearing a debris destination does not remove everything it named, the panel SHALL report what
remains and SHALL NOT report the create as successful. A create against a destination that is not
debris SHALL remove nothing.

#### Scenario: A partial clearance is reported as a failure

- **WHEN** removing the debris directory leaves entries behind
- **THEN** the outcome names what remains and the create is not reported as successful

#### Scenario: An ordinary create deletes nothing

- **WHEN** a create runs against a free destination
- **THEN** no filesystem entry is removed
