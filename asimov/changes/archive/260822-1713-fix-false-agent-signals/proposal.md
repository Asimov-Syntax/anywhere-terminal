# Proposal: fix-false-agent-signals

## Why

`docs/research/20260822-orca-deep-dive/00-overview.md` §A lists seven "likely live issues
in AT today", inferred from reading a different product. Verified against AT's code (and,
for A4, against a live measurement), **two** are real: agent spinner titles force a full
tab-bar re-render ~10×/s per running pane, and a headless `claude -p` child can hijack the
pane→Claude-session mapping so subagent preview opens the wrong transcript. This change
fixes those two and records the evidence that retires the other five.

## Appetite

S (≤1d)

## Scope

### In scope

- Skip the tab-bar re-render when an OSC title differs only by decorative spinner frames.
- Exclude headless one-shot Claude sessions from pane→session resolution, classified by the
  PID registry's `entrypoint` field.
- Regression guard on the paste/insert paths so no future change writes payload text and
  `\r` in a single pty write.

### Out of scope — each with the evidence that retired it

- **A1 `sessionBoundary`** and **A2 `restoredUnconfirmed`** — not reproducible
  (`discovery.md` §2-3). AT has no turn-state model, no completion event, no OS
  notification, and persists no activity field. Real only once upgrade **C1** (hook status
  pipeline) introduces persisted status.
- **A5 nested-shell OSC 633 leak** — premise disproven (`discovery.md` §9.1).
  `shellIntegration-login.zsh:6` restores `ZDOTDIR` unconditionally, so the temp `ZDOTDIR`
  never reaches child processes and a nested zsh never re-sources the integration. The
  proposed alt-screen gate was independently shown unsound: it would drop the *real* `D`
  of any command that enters the alternate screen and dies without restoring. Recorded as
  hardening with no verified trigger.
- **A6 paste/Enter race** as a production change — no combined text+`\r` write path exists
  (`discovery.md` §7); guard test only.
- **A7 substring name matching** — no live call site (`discovery.md` §8), and the chosen
  `entrypoint` classifier removes the argv parsing that would have needed it.
- Widening `processTree` to query argv — obviated by the `entrypoint` classifier
  (`discovery.md` §9.2).
- Filtering headless transcripts out of resolution **step 3** (`newestSessionUnderCwd`) —
  accepted residual, `discovery.md` §9.3.

## Capabilities

1. **process-title-tracking** — tab-bar updates gated on a decoration-stripped title
   signature instead of firing on every title write.
2. **claude-running-session-map** — the running-session list carries `entrypoint`, and
   resolution discards headless one-shot sessions before any selection.

## UI Impact & E2E

- **User-visible UI behavior affected?** YES — the tab bar stops re-rendering on agent
  spinner frames; clicking a subagent opens the correct transcript instead of a one-shot
  `claude -p` run.
- **E2E required?** NOT REQUIRED
- **Justification**: the project has no E2E harness (`asimov/project.md` → `E2E: N/A`).
  Both behaviours are unit-reachable: the title signature is a pure function, and the
  headless filter is exercised through `resolveClaudeSession`'s injected deps. The A4
  premise itself was already verified empirically against a live `claude -p`
  (`discovery.md` §9.2).

## Risk Level

LOW — both changes are reject-only guards on existing paths (skip a render; drop a
candidate), neither can fabricate a signal, and both fail open: an unknown `entrypoint`
keeps the candidate, and a non-decorative title change always renders. No interface visible
outside the two touched modules changes.
