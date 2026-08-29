# Proposal: source-the-agent-row-preview

## Why

WT-009.2 gave the agent row a second line and shipped it. Nothing fills it.

The row's `preview` field has been in the presence data model since the projection was designed
([worktree-agent-presence.md](../../../docs/design/worktree-agent-presence.md) § 2), and
[worktree-panel-ui.md](../../../docs/design/worktree-panel-ui.md) § 3.3 calls the preview "the line
users actually read — `Approve the git worktree add?` tells them what to do; a title and a timestamp
do not". The layout for that line exists, is tested, and is empty on every row: the projector
populates no `preview` at all. A second line that never has content is worse than no second line,
because the row now reserves height for nothing.

This is the task that decides what text a passively-refreshed row is allowed to carry, and it is
separated from WT-009.2 precisely so that decision is reviewed on its own rather than smuggled in
behind a layout change.

## Scope

- A source for `preview` on rows the chosen source covers, read through a change-stamped path so a
  scan that finds nothing new performs no read.
- The `agent-session-index` spec's index requirement widened to admit a bounded last-activity line
  alongside the bounded title preview, per the privacy fork the user already decided (option A,
  recorded in the PLAN task's Notes). The widening is written into the owning spec, not left implied
  by the code.
- WT-009.2's inherited review finding W1: `stripDecorations` treats a leading `- ` or `* ` as
  decoration, which is ordinary content in prose. This task chooses the preview's input and is
  therefore the only one able to size that stripper against real text.

## Non-goals

- The detail path. Sibling requirements in the same spec already authorize full-transcript reads
  there (workflow sub-agents, `teammateTurn` scans, per-turn segments). What moves is what a
  passively-refreshed LIST may hold, not whether bodies are read at all.
- Egress. The `0o600` cache and the never-off-the-machine clause are unchanged and out of scope to
  reopen.
- Live streaming of the preview. The row is refreshed by the existing presence cadence; nothing new
  is polled for it.
- The inspector (§ 3.7), which WT-010.5 owns.

## Must not

- Re-parse a transcript per presence scan, per row. The scan is coalesced at 150 ms and the external
  poll runs at 5 s; a per-push parse per row is the data-scale trap the PLAN task names.
- Carry unbounded or multi-line text across IPC. The text is bounded and single-line **at the point
  it is read**, not at the point it is drawn — a render-time truncation still puts the whole line in
  the envelope and in the render signature.
- Show a placeholder on a row the source does not cover. Blank is the honest answer; § 3.3's rule
  that a row never claims what it cannot prove applies to this line too.
- Widen the stripper's reach. Narrowing what counts as decoration is in scope; making it strip more
  is not.

## Appetite

M. One projection seam, one bounded reader, one spec amendment, and one stripper correction.

## Risk

| Risk | Why it matters |
|------|----------------|
| Per-scan transcript parsing | The named data-scale trap: rows × scans, with the external poll at 5 s |
| Unbounded text in the envelope | Crosses IPC and enters the render signature on every scan, so a long line costs a redraw as well as bytes |
| The spec amendment under-scoped | Widening the wrong clause would licence the detail-path reads the index requirement was never about, or fail to licence the one line this change adds |
| Coverage read as failure | A row the source does not cover is a normal row, not a degraded one; `degradedSources` must not grow an entry for it |
| The stripper correction | It is shared with `title` and with the host's own stripping, so narrowing it moves an accepted contract unless it is scoped to the preview's own read |
