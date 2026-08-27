# Proposal: agent-session-hook-identity

## Why

A worktree row can only name an agent's session when something proves which session that pane is on. Today only Claude publishes a PID registry, so every other agent is identified by the directory it sits in — a guess two panes in one worktree make identically, and one that leaves OpenCode rows unnamed. Every agent that supports hooks can report its own session id; that report is proof, and it is what orca uses for all fourteen of its reporting agents.

## Appetite

M (≤3d)

## Scope

### In scope

- OpenCode reports the session it is running, keyed to the terminal it was launched in.
- A reported session outranks every guess, and settles a session two panes both claim.
- Opt-in per agent, off by default, mirroring the existing Cursor hook setting.

### Out of scope

- **Cursor.** orca extracts no session identity from a Cursor hook payload (`case 'cursor': return null`), and `conversation_id` is not documented as the chat id the vault keys on. A headless `cursor-agent` run fires no hook and writes no chat directory at all, so the correspondence cannot be measured from a batch run either. Cursor already names its rows from its own terminal title; only exactness for two Cursor panes in one directory is forgone.
- **Codex.** Withdrawn at implementation (design.md D3): Codex refuses a hook whose trust hash is not in `config.toml`, and granting that trust is a subsystem — an app-server session, a ledger and a rollback path — over a second file another installed tool manages. Codex titles its rows from its own terminal title today, so what is forgone is exactness for two Codex panes in one directory. It is a change of its own.
- Claude. Its PID registry already proves the same thing.
- Remote and SSH panes — the receiver is loopback-only, as it is for Cursor today.
- Turn status and activity from these agents. This change carries identity only; activity keeps its current sources.

## Risk Level

LOW — with Codex withdrawn, nothing outside an extension-owned directory is written, and the second producer reaches the loopback receiver through the same per-terminal credential Cursor already uses.
