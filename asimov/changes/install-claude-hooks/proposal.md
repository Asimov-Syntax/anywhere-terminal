# Proposal: install-claude-hooks

## Why

The generalized hook runtime (WT-006.1) can serve any number of agents, but only Cursor has
an installer, so Claude panes still fall back to inference. The installer that exists is
shaped around Cursor's `hooks.json` — a flat entry list behind a `version: 1` envelope —
while Claude's `settings.json` is a user-owned file full of unrelated settings whose hook
entries are nested inside matcher groups. Extending it is the point of the task; writing a
second installer beside it is the failure mode.

Two gaps in the shipped machinery surface here rather than being new work: the registered
script path is absolute and lives in the extension's install directory, so an extension
update leaves every user's config pointing at a script that no longer exists, and the
symlink refusal the design requires was never implemented.

## Appetite

L (≤2w)

## Scope

### In scope

- Managed-config installation for a second agent, reusing the existing cross-process lock,
  atomic rename, and typed failure reasons rather than reimplementing them
- The document differences that reuse forces out into the open: entry nesting, config-shape
  validation, and how a managed entry is recognised
- Reconciling a script path that moved because the extension updated
- Refusing a symlinked destination, in the shared layer, for both agents
- Per-agent opt-in settings, a config-location override, and one uninstall command that
  clears every managed entry whatever the settings say
- Enough of a Claude registration for coordinates to be minted and posts to be authenticated

### Out of scope

- Folding Claude's events into per-pane turn state, subagent rosters, or presence — that is
  WT-006.3, and this task deliberately leaves the reducer unwritten
- Codex and OpenCode installers
- Answering questions from the panel, keystroke-inferred interrupts, notifications
- Remote or SSH installation

## Risk Level

MEDIUM — writes into a configuration file the user owns and registers an executable path.
The blast radius of a merge bug is the user's own Claude settings, which is why the lock,
the read-compare-write retry, and the atomic rename are reused rather than rebuilt. The
change also narrows how a managed entry is recognised for the agent already shipping.
