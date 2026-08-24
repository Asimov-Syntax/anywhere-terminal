## ADDED Requirements

### Requirement: Resolve Cursor executable

The system SHALL launch Cursor Agent through the first user-installed candidate that passes the interactive Cursor capability probe, preferring `agent` and falling back to `cursor-agent`.

The probe MUST require positional prompt support plus `--resume`, `--mode plan`, and `--force`; an unrelated `agent` MUST be rejected.

#### Scenario: Unrelated agent executable is installed

- **WHEN** `agent` lacks the required Cursor capabilities and `cursor-agent` passes
- **THEN** Cursor launch uses `cursor-agent`

### Requirement: Cursor selected resume compatibility

A validated schema-1 Cursor Agent CLI entry SHALL use its safe chat-directory name as the `chatId` passed to the detected CLI's `--resume [chatId]` option.

The executable probe MUST accept the official `agent` help shape (`Start the Cursor Agent`, positional `[prompt...]`, `--resume [chatId]`, plan mode, and force) while continuing to reject unrelated `agent` binaries.

#### Scenario: User explicitly resumes a compatible Cursor CLI chat

- **WHEN** the user invokes Resume from the row action, preview header, or context menu
- **THEN** the system starts `<resolved-executable> --resume <chat-id>` as a visible terminal in the chat cwd

### Requirement: Cursor source capability enforcement

Cursor IDE and unmatched project-transcript entries SHALL reject Resume, Copy Resume Command, and Fork requests in both the UI and extension host.

A forged or stale launch message MUST NOT cause a non-resumable source identifier to be substituted into a Cursor CLI command.

### Requirement: Continue into Cursor session

Continuing into Cursor SHALL start a new visible terminal in the source entry's validated cwd and pass the confirmed handoff prompt as one positional argument.

Cursor entries SHALL NOT offer Fork while no supported Cursor fork command exists.

### Requirement: Cursor continuation permission posture

The Cursor continuation target SHALL offer an approval-preserving default, a plan-only posture, and an explicitly marked full-access posture.

The default MUST NOT add a bypass flag; full access MUST be identified as bypassing checks before launch.
