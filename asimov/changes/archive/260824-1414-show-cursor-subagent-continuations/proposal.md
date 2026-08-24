# Proposal: show-cursor-subagent-continuations

## Why

Cursor addresses one sub-agent through many `Task` invocations, and v0.18.0 collapsed them
into a single card at the launch position. That fixed the duplicate-card defect but made every
continuation invisible: nothing renders where the resume actually happened, and once the launch
scrolls past the preview's tail cap the agent disappears from the timeline entirely. The user
re-raised this after previously declining a follow-up.

## Appetite

S (≤1d)

## Scope

### In scope

- A continuation renders at its own position in the Cursor session detail, drilling into the
  same saved child transcript as its launch.
- One agent still reads as one agent: the declared type labels every invocation, and sub-agent
  counts keep reporting distinct agents.
- The declared type survives the preview's tail cap; an unresolvable type is shown as no type
  rather than the invoking tool's name.

### Out of scope

- The recent-activity strip stays agent-level — continuations are not added to its 12 slots.
- Claude and OpenCode sub-agent presentation; their children are per-spawn sessions and do not
  have this failure mode.
- Correlating call/result in the project JSONL mirror (rejected in
  `260824-1200-integrate-cursor-agent` review W17 — the mirror records no `tool_result` blocks).
- Any new on-disk read: no Cursor file or record is opened that the preview does not already open.

## Risk Level

LOW — preview-only rendering change over records already parsed, behind the existing bounded,
containment-checked Cursor read path; no new I/O, no new external contract.
