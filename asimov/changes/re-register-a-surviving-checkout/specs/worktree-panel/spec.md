# Spec Delta: worktree-panel — re-register-a-surviving-checkout

## ADDED Requirements

### Requirement: A surviving checkout is offered as adopt, not skipped

WHERE the destination a create would take holds a directory whose `.git` entry names an
administrative directory that no longer exists, and the selected branch already exists, the panel
SHALL resolve the selection to adopt at that directory rather than to a suffixed fresh path or to
debris. WHERE the selected branch does not exist, adopt SHALL NOT be offered and the suffixed fresh
path SHALL stand.

#### Scenario: A pruned checkout at the derived destination

- **WHEN** the derived destination holds a checkout whose administrative entry is gone and the typed
  branch exists
- **THEN** the resolution names adopt and the directory it would re-register, and the create does not
  offer a suffixed near-duplicate beside it

#### Scenario: A checkout is never offered for deletion

- **WHEN** that same destination is resolved
- **THEN** it is not reported as debris and no authorization to clear it is issued

### Requirement: Adoption re-registers a directory without changing what is in it

WHERE an adoption is authorized, the panel SHALL attach the surviving directory to the selected
branch so that it is listed by git, holds that branch, survives a prune, and can commit into the
repository; and SHALL report only the directory's genuine working-tree state rather than every
tracked file as deleted. No file inside the adopted directory SHALL be created, modified, or removed
by the adoption.

#### Scenario: The adopted checkout is a worktree again

- **WHEN** an adoption completes
- **THEN** the directory is listed as a worktree of the repository on the selected branch, and its
  reported status names only changes that were already on disk

#### Scenario: The content is untouched

- **WHEN** an adoption completes
- **THEN** every file under the adopted directory has the content and the modification time it had
  before the adoption

### Requirement: A branch a live worktree holds is never adopted onto

WHERE any live worktree of the repository holds the selected branch, the panel SHALL refuse the
adoption before writing anything, with no confirmation path past the refusal. The check SHALL be made
against git's own listing at the moment of the write, not against the listing the resolution was
built from.

#### Scenario: The branch is claimed while the user decides

- **WHEN** another worktree takes the selected branch between the resolution and the authorization
- **THEN** the adoption is refused, nothing is written, and the refusal names the directory holding
  the branch

### Requirement: Adoption states what it cannot restore before it is authorized

The panel SHALL state, before an adoption is authorized, the directory it will re-register, the
branch it will be attached to, and that staged changes, an in-progress rebase, merge, bisect or
cherry-pick, the worktree's own refs and reflog, its per-worktree configuration, and its locked state
did not survive and are not recovered. These SHALL be stated rather than probed.

#### Scenario: The confirmation names the loss

- **WHEN** an adoption is offered
- **THEN** the offer names the directory, the branch, and each thing the adoption does not restore

### Requirement: An adoption that does not complete leaves the destination as it found it

WHERE any step of an adoption fails, the panel SHALL leave no administrative entry behind, SHALL
restore the directory's `.git` entry to the bytes it held, and SHALL report the failure rather than a
create. WHERE the branch is found to be claimed after the entry was written, the entry SHALL be
removed and the adoption reported as refused.

#### Scenario: A failed reconstruction is not a half-registration

- **WHEN** a write or a git step of the adoption fails
- **THEN** the repository lists no worktree at that directory, the directory's `.git` entry holds
  what it held before, and the result is reported as a failure

### Requirement: Adoption is offered only where the reconstruction has been verified

WHERE the reconstruction has not been executed and recorded on the running platform, the panel SHALL
NOT offer adopt there, and SHALL state that the platform is unverified rather than that the
reconstruction fails.

#### Scenario: An unverified platform withholds the mode

- **WHEN** a surviving checkout is resolved on a platform the reconstruction has not been recorded on
- **THEN** adopt is not offered, the reason given is that the platform is not yet verified, and the
  resolution falls back to the suffixed fresh path

## MODIFIED Requirements

### Requirement: The base ref is refused where the mode cannot apply it

WHERE the resolved mode takes its starting point from something that already exists — an existing
branch, a stale registration being repaired, or a surviving checkout being adopted — the base ref
SHALL be unavailable with a stated reason rather than accepted and ignored. WHERE the mode creates a
new branch, the base ref SHALL be validated before submission and SHALL be reported as unresolvable
before the create is attempted.

#### Scenario: Base is refused, not silently dropped

- **WHEN** the selection resolves to reusing an existing branch
- **THEN** the base ref control is unavailable and states why

#### Scenario: An adoption refuses the base ref

- **WHEN** the selection resolves to adopting a surviving checkout
- **THEN** the base ref control is unavailable and states why

#### Scenario: An occupied destination does not disable the base ref

- **WHEN** the destination is occupied and the branch mode creates a new branch
- **THEN** the base ref remains available, because clearing the ground does not change where the new
  branch starts

### Requirement: A mode that fixes its own target refuses the destination control

WHERE the resolved mode acts on a directory of its own — a repair acts on the registration's, an
adoption on the surviving checkout's — the destination control SHALL be refused with its reason
rather than accepted and ignored, on the same rule the base ref already follows.

#### Scenario: A repair keeps the directory it is repairing

- **WHEN** the selection resolves to a repair and the user had supplied a destination
- **THEN** the destination control is refused with its reason, and the form states and submits the
  directory being repaired

#### Scenario: An adoption keeps the directory it is adopting

- **WHEN** the selection resolves to an adoption and the user had supplied a destination
- **THEN** the destination control is refused with its reason, and the form states and submits the
  directory being adopted
