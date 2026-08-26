# claude-running-session-map Specification

## MODIFIED Requirements

### Requirement: Detect running Claude sessions

The host SHALL enumerate the Claude session PID registry at `~/.claude/sessions/<pid>.json`
(each carrying `pid`, `sessionId`, `cwd`, `startedAt`, and an optional `entrypoint`), and
SHALL treat a session as running only when `process.kill(pid, 0)` confirms the process is
alive (an `ESRCH` error marks it stale and SHALL be ignored). Malformed registry files
SHALL be skipped without failing the scan. The result SHALL be keyed by `sessionId`.

The enumeration SHALL report whether it could read the registry at all, so that a caller can
distinguish a registry that holds no sessions from one it was unable to read, and SHALL carry
a reason with the latter. A registry directory that does not exist SHALL be reported as
holding no sessions rather than as unreadable, since a machine where the agent has never run
has genuinely none.

`entrypoint` SHALL be carried through verbatim as a string when present and left
`undefined` otherwise. It MUST NOT be defaulted, because "absent" and "some value we do not
recognise" both have to stay distinguishable from a known headless value.

WHEN two live entries claim the same `sessionId`, an interactive entry SHALL win over a
headless one **before** `startedAt` is considered; only between entries of equal
headless-ness SHALL the newer `startedAt` win, with the higher `pid` as a stable tie-break
so an exact tie cannot resolve by directory-read order.

This ordering is load-bearing, not a preference: a headless `claude -p --resume <id>` writes
its own pid file carrying a live session's `sessionId` and a newer `startedAt`. If it won the
dedupe, the interactive entry — whose pid is the one actually inside the pane's process
subtree — would be discarded before any caller could filter it, and the caller's headless
filter would then remove the survivor, erasing the session entirely.

#### Scenario: The registry directory cannot be opened

- **WHEN** the registry directory exists but cannot be read
- **THEN** the enumeration reports that it was unreadable, with a reason, rather than reporting no sessions
