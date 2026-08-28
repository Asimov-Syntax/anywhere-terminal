# cursor-agent-status Specification Delta

## ADDED Requirements

### Requirement: Cursor legacy command ownership

The extension SHALL claim only released platform, path, and quoting tuples derivable under the current storage root. It SHALL NOT guess ownership from partial paths, normalization, or handler shape.

### Requirement: Cursor legacy wrapper migration

On Darwin and Linux, enabling hook observation SHALL commit the current inline entry before deleting an exact released wrapper. A pre-commit failure SHALL leave the released hook working; a later deletion failure SHALL preserve the inline hook and report the residue path.

#### Scenario: Migration is interrupted before replacement

- **WHEN** inline installation fails before the configuration replacement is durable
- **THEN** the released wrapper command and wrapper file remain available

### Requirement: Windows Cursor hook removal-only

On Windows, enabling or disabling Cursor hook observation SHALL remove exact released entries and wrappers but MUST NOT install new command bytes until they pass a real Cursor Agent execution spike on Windows.

A failed or partial cleanup SHALL report its underlying reason and every unresolved path rather than only reporting platform support.

## MODIFIED Requirements

### Requirement: Cursor hook configuration ownership

Enabling hook observation SHALL preserve a supported `~/.cursor/hooks.json` and converge exact AnyWhere Terminal entries to one current managed entry per event. Disabling SHALL remove only exact current or released entries, while unrelated hooks and their order remain present.

Malformed, unsupported, unreadable, or symbolic-link configurations SHALL remain unchanged, disable runtime acceptance immediately, and report why cleanup could not complete.

#### Scenario: Existing user hooks survive migration

- **WHEN** hook observation is enabled and later disabled in a version-1 file containing unrelated hooks and an exact released wrapper entry
- **THEN** unrelated hooks and their order remain present after migration and removal

### Requirement: Cursor hook writer coordination

Hook reconciliation SHALL use bounded advisory locking, compare-and-retry, and atomic replacement. Configuration replacement SHALL commit before cleanup of any released executable path.

### Requirement: Cursor observers fail open

AnyWhere Terminal's Cursor hook entries MUST consume the supplied request body, emit a neutral JSON result, exit successfully, and bound connection and total request time when the observer is absent, unavailable, malformed, or timed out.

A failed lookup for a required utility MUST NOT fall back to the inherited executable search path and MUST still consume stdin before exiting.

### Requirement: Cursor hook payload privacy

Hook prompts, shell output, user identity, raw request bodies, and content not required for status SHALL NOT be persisted, logged, transmitted off-device, or exposed to the webview.

The managed command MUST accept only the extension's loopback URL shape, MUST bypass all proxy environment variables, and MUST disable ambient curl configuration before transmitting the request.

#### Scenario: Host configures a proxy or curl startup file

- **WHEN** the hook runs with proxy variables or curl startup configuration present
- **THEN** its payload is delivered only to the extension's loopback listener or discarded
