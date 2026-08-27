# 260827-worktree-row-session-claim

Supersedes `260827-worktree-row-derived-slug`, which titled claude rows from the
vault. Both of its repros are still asserted here.

## Symptom (verbatim)

> là đã fix xong chưa? opencode/codex/cuurrsor có thma khảo luôn ko?

Two things the claude fix left behind: opencode rows still read "(untitled)",
and two panes sharing a worktree showed the same delegation title.

## Repro

`bun run asimov/debug/260827-worktree-row-session-claim/repro.ts`

```
OBSERVES 1: RED — an opencode pane is titled from the session recorded under its
  directory: title="(untitled)" entryId=undefined
OBSERVES 2: RED — of two panes sharing a directory, only the one whose process
  subtree holds the session claims it: pane-claude and pane-shell both wear
  entryId="claude:1111…" title="Adversarial review of Q3 options"
```

## Root cause

**1. Only claude publishes a PID registry.** `~/.claude/sessions/<pid>.json` is
claude's alone, so `resolve()` returns an entryId for claude panes and nothing
for anyone else. codex and cursor-agent survived that because they emit an OSC
0/2 title (`codex-rs/tui/src/terminal_title.rs`; cursor's `3363.index.js`), so
the pane title carried a name of its own. opencode emits neither — it was the
one agent still rendering the placeholder after the previous session.

The fix asks the vault the question the vault already answers for the session
list: newest entry for this agent under this directory (`sessionUnderCwd`). It
is the same read the row's title already came from, so a proven opencode pane
now gets both an entryId and a title.

**2. The cwd step of `resolveClaudeSession` is not exclusive.** Step 2 matches a
registry entry by directory alone. Two panes open in one worktree — an agent and
a plain shell — both matched the one running session, and both rows wore its
title.

Resolution now reports which step matched (`evidence: "process" | "directory" |
"recent"`), and the projector settles a contested entryId with it: the pane
whose pty subtree actually holds the claude pid keeps the session, and every
other claimant is disowned back to its own pane title. A row that was an agent
only *because* of that session (`agentSource: "registry"`) loses the agent along
with it. Two directory-only guesses cancel — nobody keeps it, because picking
one would be a coin toss shown as fact.

`claimed` is still filled from what each pane MATCHED, not from what its row
ends up wearing: a disowned pane must not reappear as an "other window" row.

## What the verified run did not settle

- A pane whose shell `cd`'d out of the launch directory still resolves by cwd,
  and can lose to — or contest with — a pane that did not. Evidence tagging
  bounds the damage; it does not make step 2 correct.
- `sessionUnderCwd` proves an agent *ran* in that directory, not that it is the
  one in this pane. It is consulted only for a pane already proven to hold that
  agent (`outcome.kind === "proven"`), so a plain shell never picks up a stale
  transcript — but two opencode panes in one directory will still share one
  entryId, since there is no process evidence to settle them with.
- The underlying gap is untouched: claude publishes a registry, nobody else
  does. A per-agent registry — or an OSC title from opencode — would make step 1
  available to every agent instead of just claude.
