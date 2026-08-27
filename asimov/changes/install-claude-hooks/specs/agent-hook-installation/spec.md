# Spec Delta: agent-hook-installation

## ADDED Requirements

### Requirement: Per-Agent Opt-In Hook Installation

The extension SHALL install agent hook entries only while that agent's own enablement
setting is true, and SHALL default every such setting to false.

Turning a setting on SHALL install that agent's managed entries; turning it off SHALL remove
exactly those entries. An agent's setting SHALL NOT affect any other agent's entries.

#### Scenario: Second agent enabled while the first stays off

- **WHEN** the user enables Claude hooks while Cursor hooks remain disabled
- **THEN** Claude's configuration gains the managed entries, and Cursor's configuration is
  left untouched

### Requirement: User-Authored Configuration Is Preserved

Installing or removing managed hook entries SHALL preserve every other part of the user's
configuration file, including hook entries the user wrote, keys the extension does not
recognise, and the file's permission mode.

#### Scenario: Unknown keys survive a round trip

- **WHEN** the user's configuration contains keys the extension has no knowledge of, and the
  user enables then disables that agent's hooks
- **THEN** those keys are present and unchanged afterwards

#### Scenario: A user-authored hook on the same event is kept

- **WHEN** the user has their own hook registered on an event the extension also registers
- **THEN** installation adds the managed entry alongside it and removal deletes only the
  managed one

### Requirement: An Unrecognised Or Malformed Configuration Is Refused

A configuration whose shape the extension does not recognise SHALL be reported as
`unsupported-config` and left byte-for-byte unmodified.

A configuration file that exists but cannot be parsed, or whose root is not an object, SHALL
be refused the same way and SHALL NOT be replaced with a newly created one. Only a
configuration file that does not exist may be created.

#### Scenario: A malformed configuration file is refused, not repaired

- **WHEN** the agent's configuration file exists but contains invalid JSON, or a root that is
  not an object, and the user enables that agent's hooks
- **THEN** installation reports `unsupported-config` and the file is byte-for-byte unchanged

### Requirement: Configuration Destination Is Not Followed Through A Symlink

When the resolved configuration path is a symbolic link, the extension SHALL refuse the
operation and report `unsupported-config` rather than reading or writing through the link.

### Requirement: A Moved Managed Script Is Reconciled, Not Duplicated

The extension SHALL recognise its own managed entries by the extension-owned directory they
invoke rather than by their full command string, and SHALL rewrite an entry that points
somewhere other than the current script path.

Entries invoking a script the extension does not own SHALL be preserved, even when that
script shares the managed script's filename.

#### Scenario: The managed script path moves under the same owner

- **WHEN** the resolved script path changes while the extension's storage root stays the same
- **THEN** the next reconcile rewrites the managed entries to the current path, and no entry
  is left pointing at the old one

### Requirement: A Relocation Is One Durable Move

The extension SHALL record both the current and the target entry before either configuration
changes, install the target first, and remove the previous entry only afterwards.

Where that removal fails, both entries MAY remain installed until the move is resolved, and the
extension SHALL report both paths rather than forget either.

#### Scenario: A failed cleanup leaves the move recoverable

- **WHEN** the target entry is installed but removing the previous entry fails
- **THEN** the extension reports both the current and the previous path, admits no further move
  until that one is resolved, and the next reconcile retries the removal

#### Scenario: A same-named script the user owns is left alone

- **WHEN** the user's configuration invokes a script with the same filename from a directory
  the extension does not own
- **THEN** install and uninstall both leave that entry untouched

### Requirement: Uninstall Command Clears Every Managed Entry

The extension SHALL expose a command that removes every managed hook entry for every agent,
regardless of what the enablement settings say, so a user can undo installation without
changing settings first.

### Requirement: Claude Configuration Location Is Overridable

The extension SHALL resolve Claude's configuration directory from its own override setting
when that setting is non-empty, from the `CLAUDE_CONFIG_DIR` environment variable when the
setting is empty and the variable is set, and from the agent's default location otherwise.

### Requirement: An Unreachable Hook Costs The Agent Nothing

A managed hook script SHALL exit without error and make no status claim when its coordinates
are absent from the environment, and SHALL bound its total cost when the coordinates are
present but nothing is listening.

#### Scenario: Agent runs outside a terminal this extension spawned

- **WHEN** the agent runs the managed hook with no coordinates in its environment
- **THEN** the script exits silently, reports no activity, and the agent's own operation is
  unaffected

### Requirement: One Installation Owns A Configuration Destination

For a given agent and canonical configuration path, at most one extension installation SHALL
hold the managed registration.

An installation that finds the destination held by another SHALL report `destination-owned` and
change nothing. The refusal SHALL name the holder and the supported route to clear it, so the
user can resolve it without editing extension state by hand.

#### Scenario: A second installation targets a configuration another already manages

- **WHEN** a second installation enables hooks for an agent whose configuration path is already
  registered by a different installation
- **THEN** it reports `destination-owned`, names the holder and how to clear it, and the
  configuration file is byte-for-byte unchanged

#### Scenario: The installation's own storage root changes

- **WHEN** the extension's storage root changes and hooks were installed under the previous root
- **THEN** the extension reports `transfer-required` rather than silently adopting the previous
  registration, and that registration stays recorded and removable

### Requirement: An Abandoned Registration Is Not Reclaimed

The extension SHALL NOT transfer, reclaim, or expire another holder's registration on any timeout
or heuristic. The uninstall-everything command is the one deliberate exception.

#### Scenario: An abandoned registration still blocks

- **WHEN** the installation holding a registration is gone and never cleared it
- **THEN** a later installation is still refused with `destination-owned`, and the
  uninstall-everything command removes the registration by its exact recorded path and command

### Requirement: An Unprovable Prior Installation Is Reported, Never Guessed

Where the extension cannot prove which command it previously wrote at a configuration path, it
SHALL NOT synthesise one, remove an entry on suspicion, or report that path as clean. It SHALL
retain the obligation, surface it to the user, and leave the configuration untouched.

#### Scenario: A recorded path whose command cannot be recovered

- **WHEN** an earlier record names a configuration path but no command written there survives
- **THEN** the extension reports that it can no longer prove what it wrote, states that nothing
  in the file was changed and that the hook may still be active, and asks the user to inspect it
  before automatic installation resumes

### Requirement: Converting Earlier Records Is All Or Nothing

Where a conversion of records written in an earlier shape cannot complete within the declared
bounds, the extension SHALL leave the previous records byte-for-byte intact, report the refusal,
and reconcile no configuration in that activation.

#### Scenario: A conversion that does not fit its bounds

- **WHEN** converting the earlier records would exceed the declared record or candidate bounds
- **THEN** the conversion is refused whole, the previous records are unchanged, and no
  configuration is reconciled in that activation

#### Scenario: A sweep that found nothing does not clear an unproven obligation

- **WHEN** a removal sweep using only surviving candidate commands reports nothing was installed
- **THEN** the obligation remains recorded, because that is the expected answer when the real
  command is the one that was lost
