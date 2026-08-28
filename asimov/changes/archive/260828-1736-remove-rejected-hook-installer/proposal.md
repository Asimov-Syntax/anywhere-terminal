# Proposal: remove-rejected-hook-installer

## Why

Local `main` contains the installer lifecycle later rejected by `install-claude-hooks` review round 18. Remove that unapproved surface forward-only without discarding the separately reviewed generic hook runtime or breaking the Cursor hook capability that v0.18.1 shipped.

## Appetite

M (≤3d)

## Scope

### In scope

- Preserve `AgentHookRuntime`, `AgentHookController`, the Cursor agent adapter, and worktree-presence consumers introduced by the reviewed runtime/presence changes.
- Restore the pre-installer Cursor-specific installer as a compatibility bridge, then rewire activation to its single Cursor slot.
- Remove the rejected shared installer tree, Claude adapter, settings, command, ownership state, and extension wiring.
- Reset WT-006.2 to the narrowed Claude v1 work and correct WT-006.3's runtime dependency.
- Preserve the rejected change's research and review history in a clearly superseded archive without applying its spec delta.

### Out of scope

- Cursor inline hardening; the completed `inline-cursor-hooks` branch lands immediately after this cleanup.
- Claude hook installation v1.
- Cleanup of unshipped development-only Claude config entries, wrapper files, or ledgers.
- Reverting `ce2e8010`, presence work, cross-layer verification, or any unrelated local-main commit.
- Reset, rebase, or other history rewrite.

## Risk Level

HIGH — this removes security-sensitive configuration code from current `main` while preserving a released Cursor writer and several later consumers of the generic runtime.
