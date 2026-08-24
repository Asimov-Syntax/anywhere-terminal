## ADDED Requirements

### Requirement: Cursor hook opt-in setting

The machine-scoped setting `anywhereTerminal.cursorAgent.hooks.enabled` SHALL default to `false` and SHALL control AnyWhere Terminal's observational Cursor hooks on that host.

### Requirement: Cursor hook configuration ownership

Enabling hook observation SHALL preserve a supported `~/.cursor/hooks.json` and add only uniquely owned entries; disabling SHALL remove only those entries.

Malformed or unsupported schemas SHALL remain unchanged, disable runtime acceptance immediately, and report when owned cleanup could not be completed.

#### Scenario: Existing user hooks survive setup

- **WHEN** hook observation is enabled and later disabled in a version-1 file containing unrelated hooks
- **THEN** the unrelated hooks and their order remain present

### Requirement: Cursor hook writer coordination

Hook reconciliation SHALL use a stable managed-wrapper identity, bounded advisory locking, compare-and-retry, and atomic replacement.

Native-Windows hook entries MUST NOT be installed unless the generated observer command passes a local no-op execution probe.

### Requirement: Cursor observers fail open

AnyWhere Terminal's Cursor hook entries MUST NOT block prompts, tools, or shell actions when the observer is absent, unavailable, malformed, or timed out.

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

Hook prompts, shell output, user identity, raw request bodies, and content not required for status SHALL NOT be persisted, logged, transmitted off-device, or exposed to the webview.
