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

#### Scenario: The extension-owned storage directory moves

- **WHEN** the resolved storage directory changes — a different editor profile, a remote
  window, or a relocated directory — and hooks were installed against the previous path
- **THEN** the next reconcile rewrites the managed entries to the current path, and no entry
  is left pointing at the old one

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
