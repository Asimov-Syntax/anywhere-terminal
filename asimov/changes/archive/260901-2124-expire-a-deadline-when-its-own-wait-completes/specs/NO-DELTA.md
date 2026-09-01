# No spec delta

`Deadline` is an internal primitive. One user-visible outcome CAN change — see below — but no
accepted requirement is falsified by it, and no externally mandated constraint moves.

**A plan attack refuted this and the refutation is rebutted, so the reasoning is recorded here
rather than left implicit.** The attack found the one production site that reads the getter —
`src/worktree/provisioning/applyEntries.ts:314`, via `check()` — and showed a schedule where an
empty-directory node completing inside the sub-millisecond window reports `failed` where it
previously reported `copied`, which reaches the user at `WorktreeView.ts`.

That is a real observable, and it is still not a spec delta:

- `applyEntries.ts:254` ALREADY aborts in-flight work on `elapsed`. Any node doing actual I/O in
  that window was failing before this change; only a node that needs no further work — the empty
  `check(0)` — could slip through. The two clocks disagreeing is what let one caller stop while
  another continued.
- No accepted requirement names which clock bounds the budget, or promises which side of a timeout
  boundary a node lands on. The requirement is that the apply is bounded and reports the outcome of
  every entry, refusals included — true before and after.
- The window is sub-millisecond against a 60-second budget. A requirement whose truth flips inside
  it would be a requirement no test could hold.

So the change makes two internal clocks agree on a boundary no external statement pins.
