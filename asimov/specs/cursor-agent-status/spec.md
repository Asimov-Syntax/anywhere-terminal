# cursor-agent-status Specification
## Requirements

### Requirement: Cursor hook opt-in setting

The machine-scoped setting `anywhereTerminal.cursorAgent.hooks.enabled` SHALL default to `false` and SHALL control AnyWhere Terminal's observational Cursor hooks on that host.

### Requirement: Cursor hook configuration ownership

Enabling hook observation SHALL preserve a supported `~/.cursor/hooks.json` and converge exact AnyWhere Terminal entries to one current managed entry per event. Disabling SHALL remove only exact current or released entries, while unrelated hooks and their order remain present.

Malformed, unsupported, unreadable, or symbolic-link configurations SHALL remain unchanged, disable runtime acceptance immediately, and report why cleanup could not complete.

#### Scenario: Existing user hooks survive migration

- **WHEN** hook observation is enabled and later disabled in a version-1 file containing unrelated hooks and an exact released wrapper entry
- **THEN** unrelated hooks and their order remain present after migration and removal

### Requirement: Cursor hook writer coordination

Hook reconciliation SHALL use bounded exclusive locking, compare-and-retry, and atomic replacement. A live lock MUST NOT be reclaimed solely because of age, and configuration replacement SHALL commit before cleanup of any released executable path.

### Requirement: Cursor observers fail open

AnyWhere Terminal's Cursor hook entries MUST consume the supplied JSON body, emit a neutral JSON result, exit successfully, and bound each network attempt when the observer is absent, unavailable, malformed, or timed out. The registered Cursor handler timeout SHALL bound the overall hook process.

A failed lookup for a required utility MUST NOT fall back to the inherited executable search path and MUST still consume stdin before exiting.

### Requirement: Cursor semantic terminal status

A Cursor Agent inside an AnyWhere Terminal pane SHALL surface working, action-required, and idle tab states.

### Requirement: Cursor status evidence precedence

A verified current approval dialog SHALL establish action-required status above hook, title, and output evidence.

Fresh validated hooks MAY establish working or done; unavailable or stale hooks SHALL fall back to bounded PTY-output activity.

### Requirement: Cursor status pane isolation

Cursor evidence from one pane MUST NOT change another pane, and an expired or disabled semantic state MUST NOT leave a tab stuck working or waiting.

#### Scenario: Cursor waits for command approval

- **WHEN** the current Cursor screen shows the active command-approval dialog
- **THEN** only that pane's tab shows action required until the dialog clears

### Requirement: Current-screen approval evidence

The system SHALL classify Cursor approval only after a live output write completes and only from a bounded current-screen tail belonging to verified Cursor identity.

Restore replay, approval-like prose, or a completed dialog retained only in scrollback MUST NOT produce action-required status.

### Requirement: Hook session isolation

A Cursor hook event SHALL affect status only when it carries a valid live AnyWhere Terminal session identity and per-session launch token.

Fallback-shell replacement MUST invalidate the old token and issue a fresh token for the replacement PTY; disabling hooks MUST reject events and clear semantic state immediately.

### Requirement: Cursor hook payload privacy

AnyWhere Terminal-controlled hook runtime and command code SHALL NOT persist, log, transmit off-device, or expose to the webview hook prompts, shell output, user identity, raw request bodies, or content not required for status.

The managed command MUST validate the extension's complete loopback authority and path shape, restrict requests to HTTP, bypass all proxy environment variables, and disable ambient curl configuration before transmitting the request.

#### Scenario: Host configures a proxy or curl startup file

- **WHEN** the hook runs with proxy variables or curl startup configuration present
- **THEN** its payload is delivered only to the extension's loopback listener or discarded

### Requirement: Cursor legacy command ownership

The extension SHALL claim only released event, platform, path, and quoting tuples derivable under the current storage root. It SHALL NOT guess ownership from custom event names, partial paths, normalization, or handler shape.

### Requirement: Cursor legacy wrapper migration

On Darwin and Linux, enabling hook observation SHALL commit the current inline entry before deleting an exact released wrapper. A pre-commit failure SHALL leave the released hook working; a later deletion failure SHALL preserve the inline hook and report the residue path.

#### Scenario: Migration is interrupted before replacement

- **WHEN** inline installation fails before the configuration replacement is durable
- **THEN** the released wrapper command and wrapper file remain available

### Requirement: Windows Cursor hook removal-only

On Windows, enabling or disabling Cursor hook observation SHALL remove exact released entries and wrappers but MUST NOT install new command bytes until they pass a real Cursor Agent execution spike on Windows.

A failed or partial cleanup SHALL report its underlying reason and every unresolved path rather than only reporting platform support.

### Requirement: Cursor pre-command execution boundary

The payload-privacy guarantee SHALL begin when managed-command execution starts. Code that Cursor's selected shell or process loader executes beforehand is outside the guarantee because it already has equivalent process and stdin authority.

