# agent-hook-installation Specification
## Requirements

### Requirement: Claude hook installation is opt-in and destination-local

The extension SHALL install Claude hooks only when `anywhereTerminal.agentHooks.claude.enabled` is true. Each operation SHALL resolve and snapshot one settings file in this order: configured directory, `CLAUDE_CONFIG_DIR`, then `~/.claude/settings.json`.

Changed inputs affect the next reconciliation; version 1 makes no cleanup promise for a destination no longer derivable.

#### Scenario: Claude configuration destination changes

- **WHEN** the resolved Claude configuration directory changes before the next reconciliation
- **THEN** the operation targets only the newly resolved settings file and does not guess or sweep the previous destination

### Requirement: Claude hook ownership is exact and event-scoped

The extension SHALL claim only an exact current handler inside the canonical singleton group for its registered event. The same handler in any other group is an ownership conflict that leaves settings unchanged and authority revoked. All unrelated configuration SHALL retain its order.

#### Scenario: Existing user hooks survive installation and removal

- **WHEN** a supported Claude settings file contains unrelated hook groups and handlers
- **THEN** enabling and disabling Claude observation changes only exact current managed handlers

### Requirement: Claude hook writes fail closed

Claude settings reconciliation SHALL use bounded exclusive locking, compare-and-retry, and atomic replacement. Malformed, unsupported, unreadable, or symbolic-link settings SHALL remain unchanged. A live lock MUST NOT be reclaimed solely because of age.

Failed installation leaves authority revoked. Committed installation may warn with exact lock residue; removal succeeds only without unresolved paths. Ownership conflicts report the settings path without rewriting it.

#### Scenario: Another extension host holds the settings lock

- **WHEN** a live holder keeps the sibling lock beyond any wall-clock threshold
- **THEN** another host reports the exact lock path without mutating settings or deleting the holder's lock

### Requirement: Claude hooks fail open

On Darwin and Linux, each managed handler SHALL execute one frozen inline command that consumes the supplied JSON body, emits neutral JSON, exits successfully, and bounds network work when the observer is unavailable.

#### Scenario: Observer coordinates are absent

- **WHEN** the managed command runs without current loopback coordinates
- **THEN** it consumes stdin and exits successfully without a request

### Requirement: Claude hook payloads stay on validated loopback

Managed code SHALL send payloads only to a validated HTTP loopback authority and current session path, bypassing ambient command, executable, proxy, curl, and tracing state after command entry. Shell startup, loader code, and inherited tracing expanded before the first command are outside this guarantee.

#### Scenario: Ambient proxy and curl configuration are present

- **WHEN** the managed command receives a valid payload with proxy variables or curl startup files configured
- **THEN** the payload reaches only the extension's validated loopback listener or is discarded

### Requirement: Background Claude jobs make no status claim

The managed command SHALL consume stdin and exit without a network request when `CLAUDE_JOB_DIR` is non-empty. A Claude process without current AnyWhere Terminal coordinates SHALL likewise make no request.

#### Scenario: A backgrounded Claude process inherits terminal coordinates

- **WHEN** Claude invokes a hook with `CLAUDE_JOB_DIR` set
- **THEN** the hook returns neutrally without publishing status

### Requirement: Claude hook removal is currently derivable

Disabling Claude observation and remove-all SHALL revoke runtime authority before removing exact current handlers from settings files derivable at execution time. Remove-all leaves each agent revoked until a later successful opt-in reconciliation.

These operations SHALL NOT use durable destination inventory, ownership ledgers, leases, pointers, residue gates, or historical path guesses.

#### Scenario: Remove-all runs after a destination change

- **WHEN** the remove-all command runs after configuration inputs name a different destination
- **THEN** it attempts the current derivable Claude destination and does not claim the unknown prior path

### Requirement: Windows Claude installation is unsupported until spiked

On Windows, the extension MUST NOT install or remove Claude hook commands in version 1 because no Claude registration has shipped there and no frozen command has passed a real Windows Claude Code execution spike. The operation SHALL report `unsupported-platform` without reading or writing user configuration.

#### Scenario: Claude observation is enabled on Windows

- **WHEN** reconciliation runs on Windows
- **THEN** no Claude settings file or hook command is read, created, changed, or removed

### Requirement: A replacement is staged where nothing can be waiting for it

Staging a replacement SHALL use a name that cannot be derived from the time of the write or from the
file being replaced, and SHALL fail rather than write through an object already at that name.

- An object of any kind already at the staging name → the staged write fails and nothing outside the
  staging name is modified.

#### Scenario: A symlink is waiting at the staging name

- **WHEN** a symlink to another file already exists at the name a replacement would be staged under
- **THEN** the staged write fails and the file the symlink points at is unchanged

### Requirement: A release removes only the lock the operation still identifies

Releasing a lock SHALL remove the name only while that name still identifies the object the
operation acquired, and SHALL leave it in place and report the release as failed otherwise.

#### Scenario: The name now identifies another writer's lock

- **WHEN** the object at the lock's name is a different object from the one this operation acquired
- **THEN** the name is left in place and the operation reports the release as failed

