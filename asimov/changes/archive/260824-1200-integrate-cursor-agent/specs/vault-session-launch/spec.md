## ADDED Requirements

### Requirement: Resolve Cursor executable

The system SHALL launch Cursor Agent through the first user-installed candidate that passes the interactive Cursor capability probe, preferring `agent` and falling back to `cursor-agent`.

The probe MUST require positional prompt support plus `--resume`, `--mode plan`, and `--force`; an unrelated `agent` MUST be rejected.

#### Scenario: Unrelated agent executable is installed

- **WHEN** `agent` lacks the required Cursor capabilities and `cursor-agent` passes
- **THEN** Cursor launch uses `cursor-agent`

### Requirement: Cursor selected resume compatibility

A validated Cursor Agent CLI entry SHALL use its safe directory name as the `chatId` passed to the detected CLI's `--resume [chatId]` option after explicit identity proof.

The executable probe MUST accept the official `agent` help shape while continuing to reject unrelated `agent` binaries.

### Requirement: Cursor explicit Resume identity proof

Resume and Copy Resume Command SHALL read only the bounded supported store profile and require its agent identity to match the candidate directory name before executable probing or side effects.

An unavailable, malformed, unsupported, or mismatched store SHALL reject the action without removing its metadata row from the Vault list.

#### Scenario: User explicitly resumes a compatible Cursor CLI chat

- **WHEN** the user invokes Resume from the row action, preview header, or context menu and the explicit store identity proof matches
- **THEN** the system starts `<resolved-executable> --resume <chat-id>` as a visible terminal in the chat cwd

#### Scenario: User copies a Cursor Resume command

- **WHEN** the user invokes Copy Resume Command and the explicit store identity proof matches
- **THEN** the system copies `<resolved-executable> --resume <chat-id>`
- **AND** a failed proof leaves the clipboard unchanged

### Requirement: Cursor source capability enforcement

Cursor IDE and unmatched project-transcript entries SHALL reject Resume, Copy Resume Command, and Fork requests in both the UI and extension host.

A forged or stale launch message MUST NOT cause a non-resumable source identifier to be substituted into a Cursor CLI command.

### Requirement: Continue into Cursor session

Continuing into Cursor SHALL start a new visible terminal in the source entry's validated cwd and pass the confirmed handoff prompt as one positional argument.

Cursor entries SHALL NOT offer Fork while no supported Cursor fork command exists.

### Requirement: Cursor continuation permission posture

The Cursor continuation target SHALL offer an approval-preserving default, a plan-only posture, and an explicitly marked full-access posture.

The default MUST NOT add a bypass flag; full access MUST be identified as bypassing checks before launch.
