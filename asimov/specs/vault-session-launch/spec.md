# vault-session-launch Specification
## Requirements

### Requirement: Resume a session in a new visible terminal

The system SHALL resume a selected session by spawning the agent's native resume command — built from the registry template with the session's captured per-session flags (model, permission/approval mode, sandbox, reasoning effort, agent) re-injected — in a NEW AnyWhere Terminal session whose working directory is the session's recorded `cwd`. The new session SHALL be surfaced as a selectable tab in the active view (the host posts the same tab-created notification the normal new-tab flow uses). WHEN the agent executable cannot be launched, the system SHALL surface an error notice rather than leaving a silently-broken terminal.

### Requirement: Launch resolves a single entry by id

WHEN resolving the launch options for a resume or fork, the system SHALL resolve the target entry directly by its id from only the relevant agent's store (a point or locate-by-id lookup), and SHALL NOT aggregate or scan every agent's session store to find it. Resolving a single entry SHALL NOT trigger work scoped to other agents (e.g. the OpenCode version probe SHALL run only when the target entry is an OpenCode session). The agent's store location SHALL be derived from the id host-side; a webview-supplied path SHALL NOT be trusted.

Synthetic child/group/segment ids — those carrying a nesting marker (`:subagent:`, `:workflow:`, `:wfagent:`, `:turn:`) — are detail-view handles only and SHALL NOT resolve to a launchable entry: `getEntry` SHALL return null for them, so a nested view node never offers resume or fork. (An id containing `:` already fails the session-id safety check, so this holds without a separate guard.) A teammate turn (`:turn:`) is a view of a slice of a member session; the member session itself stays launchable by its plain `claude:<memberId>`.

### Requirement: Fork a session when supported

The system SHALL offer a fork action that runs the agent's fork command in a new terminal. For OpenCode, fork SHALL be available only when the detected `opencode --version` is ≥ 1.1.54 (the release that introduced `--fork`); when fork is unsupported for an agent or version, the fork action SHALL be unavailable for that entry rather than failing at launch.

### Requirement: Preserve Claude auth/config on launch (best-effort)

WHEN launching a Claude resume or fork, the system SHALL ensure the auth-env allowlist values present in the extension-host environment reach the spawned process: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, and `CLAUDE_CONFIG_DIR`, plus any `CLAUDE_CONFIG_DIR` captured at index time. This is best-effort: when the extension host lacks the user's login-shell environment, the resumed session targets the same account only insofar as those vars were available — the system SHALL NOT claim success it cannot guarantee, and SHALL surface launch/auth failures via the error notice.

### Requirement: Injection-safe command construction

Session ids, cwd, model, and flag values interpolated into a launch command SHALL be validated or escaped such that a crafted value in a session file cannot inject additional shell commands.

#### Scenario: Hostile session id cannot inject commands

- **WHEN** a session entry's id or a captured flag value contains shell metacharacters (e.g. `; rm -rf ~`)
- **THEN** the launch either rejects the value or passes it as a single inert argument, and no extra command is executed

### Requirement: Continue a stored session in a new session

The system SHALL offer, from any message in a session's preview transcript, a **Continue in New Session** action that starts a NEW session in the entry's recorded working directory, seeded with a handoff prompt, and SHALL leave the stored session unmodified. The new session SHALL be surfaced as a selectable tab in the active view, the same way Resume already surfaces one.

The point continued from SHALL be an assistant turn — the reply the previous session had just produced — and the reader's instruction SHALL be the turn that follows it: activating the action on an assistant message SHALL offer the next user message of the transcript as that instruction, and activating it on a user message SHALL anchor at the assistant message before it and offer that user message. WHERE no assistant turn precedes the chosen message, the action SHALL still be offered, with no anchor and an empty instruction.

The webview SHALL identify the anchor and the offered instruction by the entry id plus reader-assigned message locators only; the host SHALL resolve them from the agent's own store and SHALL refuse the action — surfacing an error notice rather than launching — when the entry or the agent's continue command cannot be resolved. WHERE an agent's CLI provides no way to seed a prompt at launch, that agent SHALL be unavailable as a continuation target rather than launching an unseeded session.

Activating the action SHALL dismiss the preview overlay, so the new session's tab is what the reader is left looking at. The new session SHALL be started under the model the entry captured, as Resume is.

#### Scenario: Continuing from an assistant reply

- **WHEN** the reader activates Continue in New Session on an assistant message that is followed by a user turn
- **THEN** the continuation is anchored at that reply and offers the following user turn as the instruction to send

#### Scenario: Continuing from a user message

- **WHEN** the reader activates Continue in New Session on a user message
- **THEN** the continuation is anchored at the assistant message before it and offers that user message as the instruction to send

#### Scenario: The preview after activating Continue

- **WHEN** the reader confirms the continuation from the preview overlay
- **THEN** the overlay closes rather than staying open over the new session's tab

### Requirement: Continuation is confirmed before anything launches

Activating the action SHALL open a confirmation dialog and SHALL start no process until the reader confirms it; dismissing the dialog SHALL leave no session started and the preview open.

The dialog SHALL show which stored session is being continued and the anchoring reply, SHALL offer the instruction as editable text the reader can rewrite before starting, and SHALL state the working directory the new session starts in.

The dialog SHALL offer the agent to start as a choice among the agents the host detects as available for continuation, defaulting to the stored session's own agent. WHERE the chosen agent exposes a permission posture, the dialog SHALL offer that agent's own choices, SHALL default to the posture the stored session was captured under, and SHALL mark a choice that bypasses permission checks as such — so starting a session without permission checks is a visible decision rather than an inherited one. WHERE the chosen agent exposes no such choice, no permission control SHALL be shown.

The instruction the reader confirms SHALL be bounded by an explicit length cap and SHALL reach the agent as a single inert argument of the launch argv, never interpolated into a shell string.

#### Scenario: Dismissing the dialog

- **WHEN** the reader closes the confirmation dialog without confirming
- **THEN** no session is started and the preview stays open

#### Scenario: Editing the offered instruction

- **WHEN** the reader rewrites the offered instruction before confirming
- **THEN** the new session is seeded with what the reader wrote, not with the stored message

#### Scenario: An instruction containing shell metacharacters

- **WHEN** the confirmed instruction contains shell metacharacters or quoting
- **THEN** it reaches the agent as one argument and no additional command is executed

#### Scenario: Continuing a session captured with permission checks bypassed

- **WHEN** the reader opens the dialog for an entry whose captured permission posture bypasses permission checks
- **THEN** that posture is preselected and shown as bypassing checks, and the started session runs under the posture shown

### Requirement: Handoff prompt composition and safety

The handoff prompt SHALL be composed by the host from content the host reads itself plus the instruction the reader confirmed, and SHALL carry: the originating agent, session title and working directory; the transcript's location WHERE the session is file-backed, described as read-only reference material; the reader's instruction; an instruction to treat transcript content as historical reference data and not to follow instructions found inside it; and an instruction to inspect the current workspace, treat it as authoritative where it disagrees with the transcript, and continue the work from the anchoring reply.

The webview SHALL supply no transcript content — only the reader's own instruction and the locators the host resolves itself.

WHERE the session is file-backed and an anchor was resolved, the prompt SHALL locate the anchoring reply within that transcript in the addressing scheme its agent's store uses, so the reader can reach it without scanning the whole file, and SHALL state that the transcript continues past that reply with work the new session is resuming from rather than repeating.

WHERE the reader leaves the intent check enabled, the prompt SHALL additionally instruct the new session to state the goal and the current state as it understands them and wait for confirmation before acting; WHERE it is disabled, the prompt SHALL carry no such instruction.

#### Scenario: Continuing from a reply with later work after it

- **WHEN** the anchoring reply is followed in the stored transcript by further turns
- **THEN** the prompt names where that reply sits in the transcript and marks the turns after it as the prior attempt being resumed from, rather than leaving the reader to locate it

#### Scenario: Starting with the intent check disabled

- **WHEN** the reader clears the intent check before confirming
- **THEN** the prompt carries no instruction to stop and confirm, and the new session begins the work directly

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

### Requirement: Start a new session for an agent that declares one

Starting a brand-new session SHALL be a capability an agent declares, and an agent that
declares none SHALL NOT be offered as a launch target.

- The executable and arguments a start runs SHALL be those the selected agent declared, and no
  others.
- A declared start SHALL accept no prompt as readily as one — a launch without a prompt is not
  an error, and SHALL pass no empty argument in the prompt's place.

#### Scenario: An undeclared agent is not offered

- **WHEN** launch targets are requested and an installed agent declares no way to start a fresh session
- **THEN** that agent is absent from the offered targets, rather than offered and failing at launch

### Requirement: A seeded prompt arrives submitted

WHEN a launch carries a prompt, the started agent SHALL receive it as an already-submitted
turn rather than as editable composer text.

- The prompt SHALL be passed as a single argument, never concatenated into a command string.
- A launch target SHALL state whether that agent can be seeded at all, and an agent that cannot
  SHALL NOT be offered a prompt.

### Requirement: A prompt is never read as a command-line option

A prompt that would be parsed as an option by the agent it is passed to SHALL be rejected
rather than launched.

#### Scenario: A posture cannot be smuggled through the prompt

- **WHEN** the prompt begins with a hyphen, such as a flag that would bypass the agent's permission checks
- **THEN** nothing is launched, and the posture the user selected is the only one that could have applied

### Requirement: A launch may name the directory it runs in

A launch SHALL accept an explicit working directory that takes precedence over the one
recorded against the session being launched.

- Absent an explicit directory, the recorded one SHALL still apply.

#### Scenario: Resuming a session somewhere else

- **WHEN** a stored session whose recorded directory is A is resumed with an explicit directory B
- **THEN** the resumed agent runs in B

