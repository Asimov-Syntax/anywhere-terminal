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
by the adoption. The directory's `.git` entry is the one path the adoption replaces.

#### Scenario: The adopted checkout is a worktree again

- **WHEN** an adoption completes
- **THEN** the directory is listed as a worktree of the repository on the selected branch, and its
  reported status names only changes that were already on disk

#### Scenario: The content is untouched

- **WHEN** an adoption completes
- **THEN** every path under the adopted directory other than its `.git` entry has the content and the
  modification time it had before the adoption

### Requirement: A branch a live worktree holds is never adopted onto

WHERE any live worktree of the repository holds the selected branch, the panel SHALL refuse the
adoption before writing anything, with no confirmation path past the refusal. The check SHALL be made
against git's own listing at the moment of the write, not against the listing the resolution was
built from, and SHALL be made again after the registration is written — where a second holder is found
then, the adoption SHALL be undone and reported as refused rather than as a create.

#### Scenario: The branch is claimed while the user decides

- **WHEN** another worktree takes the selected branch between the resolution and the authorization
- **THEN** the adoption is refused, nothing is written, and the refusal names the directory holding
  the branch

#### Scenario: The branch is claimed while the adoption runs

- **WHEN** another worktree takes the selected branch after the adoption's own check and before it
  finishes
- **THEN** the registration the adoption wrote is removed and the result is reported as a refusal

### Requirement: An adoption attaches the branch at the tip it promised

WHERE the branch moves between the offer and the write, the panel SHALL undo the adoption and report a
refusal rather than attaching the checkout to a commit the user was not shown. The tip SHALL be read
from the adopted worktree after its registration is written.

#### Scenario: The branch moves during the adoption

- **WHEN** the selected branch is updated while the adoption is running
- **THEN** the registration is removed and the result names the tip mismatch

### Requirement: An adoption re-establishes what it was offered on

WHERE the directory's administrative entry exists again at the moment of the write, the panel SHALL
refuse the adoption rather than overwrite the registration, whatever branch that registration names.

#### Scenario: The registration comes back during the pause

- **WHEN** the surviving directory's administrative entry is restored between the resolution and the
  authorization
- **THEN** the adoption is refused and the directory's `.git` entry is left as it was found

### Requirement: Adoption states what it cannot restore before it is authorized

The panel SHALL state, before an adoption is authorized, the directory it will re-register, the
branch it will be attached to, and that staged changes, an in-progress rebase, merge, bisect or
cherry-pick, the worktree's own refs and reflog, its per-worktree configuration, and its locked state
did not survive and are not recovered. These SHALL be stated rather than probed.

#### Scenario: The confirmation names the loss

- **WHEN** an adoption is offered
- **THEN** the offer names the directory, the branch, and each thing the adoption does not restore

### Requirement: An adoption that does not complete leaves the destination as it found it

WHERE any step of an adoption fails, the panel SHALL leave the directory in a state it offers as
adopt again, reporting the failure rather than a create. It SHALL NOT delete any directory to do so:
the administrative entry it created is left in the state git's own collection takes it from, and
hidden from the repository's worktree listing meanwhile. It SHALL name that entry only where it could
not hand it over — an entry git will collect needs nothing from the user.

#### Scenario: A withdrawn adoption is offered again rather than left behind

- **WHEN** an adoption fails at any step and is withdrawn
- **THEN** the same directory is offered as adopt on a retry, the repository lists no worktree from
  the failed attempt, and a routine `git worktree prune` collects what the attempt created

#### Scenario: A withdrawal does not delete what another process put there

- **WHEN** another process replaces the administrative entry while an adoption is withdrawing
- **THEN** that process's files are left intact, because the withdrawal removes no directory at all

#### Scenario: A failed reconstruction is not a half-registration

- **WHEN** a write or a git step of the adoption fails
- **THEN** the repository lists no worktree at that directory, the directory's `.git` entry holds
  what it held before, and the result is reported as a failure

### Requirement: A withdrawal states what it could not put back

WHERE the directory's `.git` entry could not be restored to the bytes it held, or the undo itself
could not complete, the panel SHALL report what was left behind and where, rather than reporting
either a create or a clean failure.

#### Scenario: An undo that cannot finish says so

- **WHEN** the adoption fails and its own undo cannot remove the entry or restore the `.git` entry
- **THEN** the result names the entry directory and the state the `.git` entry was left in

### Requirement: An undo restores only the `.git` entry the adoption itself replaced

WHERE the entry at that path is no longer the file the adoption wrote, or no longer names the
administrative entry the adoption created, the panel SHALL leave it untouched and report it as left
as found.

#### Scenario: Another process's registration is not withdrawn by our undo

- **WHEN** the adoption fails after something else has replaced the directory's `.git` entry
- **THEN** that entry keeps the bytes that other writer put there, and the result reports it as left
  as found rather than as restored

### Requirement: An adoption that cannot establish the `.git` entry says so rather than reporting a clean failure

WHERE the write of the directory's `.git` entry BEGINS and does not complete, the panel SHALL report
the entry's state as unestablished and name the directory, rather than reporting a failure whose
stated effect is that nothing was changed. WHERE the write is refused before it changes anything, the
panel SHALL report a failure that changed nothing and SHALL withdraw the administrative entry it had
created — an unbegun write is not an unestablished one.

#### Scenario: The link write fails partway

- **WHEN** the write that re-points the directory's `.git` entry begins and does not complete
- **THEN** the result names that directory and states that its `.git` entry could not be left in a
  known state, and the administrative entry has been handed to git's collection

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
