## MODIFIED Requirements

### Requirement: Detect running Claude sessions

The host SHALL enumerate the Claude session PID registry at `~/.claude/sessions/<pid>.json`
(each carrying `pid`, `sessionId`, `cwd`, `startedAt`, and an optional `entrypoint`), and
SHALL treat a session as running only when `process.kill(pid, 0)` confirms the process is
alive (an `ESRCH` error marks it stale and SHALL be ignored). Malformed registry files
SHALL be skipped without failing the scan. The result SHALL be keyed by `sessionId`.

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

### Requirement: Map a terminal to its Claude session

The host SHALL resolve the Claude `sessionId` a given terminal is showing, in this order:

1. Walk the terminal's pty process subtree (from `session.pty.pid`) and intersect the
   descendant pids with the running registry (the registry `pid` is the `claude` node
   process, a descendant of the pty's shell, never the pty pid itself). A single match
   yields the exact `{ sessionId, cwd }`; WHEN more than one running registry pid is found
   in the subtree, the one with the most-recently-modified `<sessionId>.jsonl` transcript
   SHALL be chosen.
2. WHEN the subtree walk yields no match, fall back to running registry entries whose `cwd`
   equals the terminal's current cwd, choosing the most-recently-modified
   `<sessionId>.jsonl`. (Note: the terminal's live cwd is the shell's cwd and MAY differ
   from the registry's launch cwd if the shell has `cd`'d; a miss here SHALL degrade to
   step 3, not error.)
3. WHEN no running session matches the cwd, fall back to the most-recently-modified Claude
   session under that cwd (so a terminal whose CLI has already exited still resolves).

**Headless one-shot sessions SHALL be excluded from the running set before steps 1 and 2
are evaluated**, so they can neither be selected outright nor win a tie-break. A session is
headless one-shot when its `entrypoint` is one of the known headless values — currently the
single value `sdk-cli`, as written by `claude -p` / `claude --print`. Exclusion SHALL be an
explicit allow-list of known headless values, never "anything that is not `cli`", so an
unrecognised or absent `entrypoint` keeps the session as a candidate. WHEN exclusion empties
the candidate set for a step, resolution SHALL continue to the next step rather than
returning null.

Step 3 is deliberately NOT filtered: it reads transcripts from disk, where no `entrypoint`
is available, and is reachable only when no running session matches at all.

It SHALL return null when nothing resolves, and SHALL derive every path from the cwd within
the Claude store — never from a webview-supplied path. On platforms without a supported
process-table query (e.g. Windows) the subtree walk SHALL no-op and resolution SHALL use the
cwd fallbacks only.

#### Scenario: Hook-spawned headless child competes with the interactive session

- **WHEN** the pane's pty subtree contains both the interactive `claude` registry pid and a
  live `claude -p` child whose transcript was modified more recently
- **THEN** resolution MUST return the interactive session's `{ sessionId, cwd }`.

#### Scenario: Unrecognised entrypoint is not treated as headless

- **WHEN** the only running session in the subtree reports an `entrypoint` that is absent,
  empty, or an unknown value
- **THEN** it MUST still be selected, so a future Claude release cannot silently break
  resolution by renaming the field's values.
