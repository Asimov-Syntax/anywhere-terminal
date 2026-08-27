# Proposal: surface-subagent-history-rows

## Why

Expanding an agent row shows nothing about what that session delegated, so a worktree holding
an agent that fanned out to five subagents looks identical to one running a single prompt. The
transcript already records the delegation; nothing reads it for this view.

## Appetite

S

## Scope

### In scope

- Reading a resolved session's delegated subagents from the vault transcript, on demand
- Delivering them to the view for one agent row at a time, and rendering them as history
- Saying nothing when there is nothing to say: no entry id, no subagents, or a read that failed

### Out of scope

- A live roster. `live` stays false for every row this change produces; the hook phase owns the
  flip, and nothing here may make it look like it already happened
- Any depth past one level, and any pane identity of a subagent's own
- Activation behaviour — the parent's pane is the target, and WT-005.1 owns actions

## Risk Level

LOW — one new read path behind an explicit expansion, publishing rows the view already draws.
The risk that matters is not breakage but overstatement: history rendered as live work.
