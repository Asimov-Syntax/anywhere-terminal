# Proposal: upgrade-turn-state-presence

## Why

The worktree panel currently guesses what an agent is doing. It watches output timing, terminal
titles and the process table, and infers `running` / `waiting` / `idle` from them. That is the
right fallback and the wrong primary: an agent thinking for ninety seconds without printing
anything reads as idle, and a shell prompt sitting under a finished agent reads the same as one
under a working agent.

WT-006.1 built the transport that fixes this — a loopback runtime, per-pane tokens, entitlement,
containment and dedup — and WT-006.2 registers Claude's hooks against it. Claude's module
currently accepts every event and drops it, deliberately: `install-claude-hooks` D6 says "Claude
is transport-only in this task; the reducer is WT-006.3". This change writes that reducer and
carries its output to the row a user actually looks at.

## Scope

In:

- The Claude event → turn-state reducer, per the accepted § 4.4 table.
- The live subagent roster, replacing transcript-derived history for panes that report.
- Turn state carried as pane evidence, and the § 4.5 precedence applied in the projector —
  including the guards that stop it lying: process reality wins, a stale report is identity-only,
  a session boundary is not a completed turn, a turn with working children is not finished.
- Reported session id and transcript path used as lookup keys only.

Out:

- Anything under `src/agentHooks/install/*`, `AgentHookController.ts` — another session owns
  them.
- Codex and OpenCode reducers, answering questions from the panel, keystroke-inferred interrupt
  detection, completion notifications. All deferred upstream; the reducer's shape accommodates
  them.
- Interrupt detection, and the `PreCompact → working` half of the compaction rule. Both are
  named by accepted design and neither is buildable here: the field § 4.4 reads for interrupts
  is not on the events it names, and the compaction event is not registered. Deferred with the
  evidence in design.md D6; § 4.4 is corrected at Blueprint Sync rather than implemented against
  a field that does not exist.
- The cross-layer and scale verification of WT-007.1.

## Appetite

Medium. The contracts are accepted upstream and the transport exists, so most of this is a
reducer and a precedence table. One problem resolved into reuse — turn state has a natural home
in the pane evidence store (design.md D2). One did not: the transport's duplicate suppression
turned out to be unsafe at its current window and is repaired here (D1).

## Risk

MEDIUM, and concentrated in one place. The blueprint says it in a line: "this is where a status
pipeline starts lying if the guards are omitted." Every guard in § 4.5 exists because some
implementation shipped without it and showed a user a wrong thing — a stale question card
surviving a reload, a spinner stuck after `/compact`, a finished agent still spinning because a
subagent held the turn open. The failure mode is not a crash; it is a panel that looks
authoritative and is wrong, which is worse than the inference path it replaces.

The mitigation is that each guard is a separate requirement with its own scenario, so an omitted
guard is a failing test rather than a design discussion.
