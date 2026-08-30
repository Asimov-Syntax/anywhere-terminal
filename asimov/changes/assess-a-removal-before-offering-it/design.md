# Design — assess a removal before offering it

> Refs: [worktree-removal.md](../../../docs/design/worktree-removal.md) § 2, § 2.2, § 2.3, § 3;
> [worktree-rpc.md](../../../docs/design/worktree-rpc.md) § 2.5;
> [worktree-apply.md](../../../docs/design/worktree-apply.md) § 2.6

## Decisions

### D1 — A check's class is a property of the check, except where the evidence decides it

`removalChecks.ts` declares `CATALOGUE` as one table keyed by check id, and its comment defends that
deliberately: a check that appears in one branch and not another is how a UI renders a shorter list
for a worse outcome. That defence is about **which checks exist**, and it stays.

`externalAgents` breaks the other half. `worktree-removal.md` § 2.2 puts it in the refusal class when
the session's activity is `running`, `waiting`, or undeterminable, and in the confirmable class only
when it is provably idle — so its class depends on what was read, not on its id.

**Chosen:** the catalogue keeps one row per id and that row's `cls` becomes either a constant or a
function of the assessment. `externalAgents` is the only function today, and the catalogue still
answers "which checks exist" with one list.

Refined while building 1_2: the function reads the assessment KIND, not the session count. `cls`
answers "could a confirmation authorize this check", and a refused assessment authorizes nothing —
so every check in that branch is refusal-class, including this one, and the pre-existing invariant
that a refusal reports only refusal-class checks survives untouched. `externalAgents` is reported
in the refused branch because the sessions were genuinely read: an unreadable registry returns
`unavailable` before any refusal is reached, so this is not the "claiming a read that never
happened" case the branch guards against.

Rejected — two ids (`externalAgentsBusy` / `externalAgentsIdle`): it makes the check list differ by
outcome, which is the exact failure the existing comment guards against, and the UI would have to
know that two ids mean one row.

Rejected — leave the class constant and encode the refusal in the outcome: the outcome vocabulary is
`passed | failed | unproven | notApplicable`, none of which distinguishes a failure that can be
confirmed past from one that cannot. That distinction IS `cls`, and § 2.5 puts `cls` on the wire so
the webview never re-derives it.

### D2 — The registry read keeps what it read, including what it could not

`ExternalSessionFact` is `{ sessionId, cwd }`. There is nowhere to put an activity, so every external
session is currently confirmable — which is how a removal can be forced past a session we never asked
about.

**Chosen:** `ExternalSessionFact` gains an activity that can be absent, and absent means live.
`SourceRead<T>` already carries `{ ok: false }` for a source that could not be read at all, so the two
failures stay distinct: the registry was unreadable (every external check unproven) versus the
registry was read and one record's activity was not determinable (refusal).

The presence reader's live-only filter is not reused for this. It answers "what should the panel
show", where a dead record is noise; the assessment asks "is anything using this", where a record we
cannot classify is the whole point. Same source, two questions, and the filter belongs to the other
one.

### D3 — The ignored walk is bounded by the walk, not by a prior measurement

The report needs a count and a total size of ignored material. Both come from one walk under one pair
of budgets — an entry cap and a time cap — and the walk stops at whichever is reached first, reporting
`unproven` rather than a partial number presented as a total.

**Every terminating condition produces the same outcome**: budget exhausted, a directory that cannot
be read, or the enumeration throwing. A partial count rendered as a total is worse than no count,
because § 2.5 renders `count` inside its own element as a reading that was taken.

Not a `du`. And **not `git status --ignored`** — corrected while fixing round-1 B3, where the original
sentence here asserted that `--ignored` names the entries. It does not: verified against git 2.50.1,
both `--ignored=matching` and `--ignored=traditional` report an ignored DIRECTORY as one record
(`!! node_modules/`), so stat-ing what it names sizes the directory inode and a gigabyte reports as a
few hundred bytes. The enumeration is `git ls-files --others --ignored --exclude-standard -z`, which
names every ignored FILE recursively — and NUL-delimited, so git's c-quoting grammar never has to be
re-implemented here (round-1 W1).

The sizing is what has to be bounded, and so is the enumeration: git buffers its whole listing before
the first entry is admitted, so a cap applied only to the stats leaves the listing running on whatever
the runner's own default happens to be (round-1 B4). The budget still spans both phases — ONE walk,
one time cap — so `measureIgnoredMaterial` owns the deadline and hands the enumeration the time still
left in it. Time spent listing is time the sizing no longer has.

**What the two caps actually bound, stated exactly** (cycle-2 B4, which found the earlier wording
claiming more than the mechanism delivers):

- The **time cap** bounds this walk's own elapsed time, end to end. It reaches git as the child's
  timeout, and it stops the loop issuing further stats. It does NOT cancel a stat already in flight —
  `lstat` takes no signal — so the walk abandons waiting on one at the deadline and returns
  `unproven`; the read it walked away from may still complete, unobserved, costing nothing but its
  own I/O.
- The **entry cap** bounds what this process holds and stats. It cannot bound git's own directory
  traversal — git walks the tree whether or not we intend to read the result — so it is enforced as a
  ceiling on the LISTING WE BUFFER, per call, alongside the count of entries admitted to the loop. A
  listing past that ceiling fails the command and the walk reports `unproven`, which is the same
  answer as reaching the cap and is the honest one: we did not measure this tree.

Rejected — a streaming, cancellable runner that terminates git mid-listing: `GitCommandRunner`
resolves one buffered `GitCommandResult`, and every caller in the repository is written against that.
A second, streaming shape exists to serve one read on one assessment, and it would be the only
cancellable-mid-output path in the codebase. The buffer ceiling reaches the same outcome — `unproven`
on a tree too large to measure — for an option-bag field rather than a second runner contract.

### D4 — Provenance is read, never inferred

Provisioned material is named as such only from the manifest at
`.git/worktrees/<id>/anywhere-terminal-provision.json` (`worktree-apply.md` § 2.6). A missing,
unreadable, or wrong-`version` manifest degrades to the undifferentiated count and says so.

**Nothing infers provenance from a path.** `.env.worktree` looking like ours is not evidence it is
ours, and a heuristic here produces the sentence "the 4 files this worktree was set up with" about
files the user wrote.

**Note the manifest does not exist yet.** No code writes or reads one; the apply path that would
write it is unbuilt Phase 12 work. The differentiated branch is unit-verified against a written
fixture. The undifferentiated fallback is the path that actually runs until Phase 12 lands, so it is
the one the tests weight.

### D5 — Re-evaluation compares check sets, not booleans

§ 3 requires that a *newly appeared* failure re-prompts while the failure the user already confirmed
does not. That is a comparison between the check set the confirmation was bound to and the one
re-evaluation produced — not "did anything fail", which would re-prompt forever on the dirty files
the user just confirmed.

**Chosen:** the fingerprint already binds a confirmation to an assessment (`worktree-rpc.md` § 3.1).
Re-evaluation recomputes the checks and returns `needsConfirm` when a check that was not failed at
confirmation time is failed now. A check that stops failing never re-prompts.

A refusal-class check appearing at re-evaluation is a refusal, not a re-prompt: § 3 says force never
runs against a working agent, and there is no confirmation for it to ask for.

### D6 — A session is classified once, by the window that holds it

Added on the round-1 B2 handback. `listRunningClaudeSessions()` is USER-WIDE: a Claude running in a
pane of this window writes its own registry record with a live pid, so D2's "absent activity means
live" refuses on a session this window can already see is idle. The worktree becomes unremovable
while an idle local Claude sits in it — against `worktree-actions.md`'s accepted rule that an idle
pane is confirmable.

**Chosen:** the removal producer drops registry sessions this window has already claimed, so the
session is counted once — as the idle pane it is. The claimed set is not recomputed: the presence
projector already builds it (`claimed`, from `identify()`) precisely so an external row is never a
second row for a pane's own session, and it is published as a read rather than rebuilt. Nothing about
the projection's own filter changes, which is what task 1_1's Boundary reserved — this reads a fact
the projector computes, it does not repurpose the pass that computes it.

Absent before the first window pass, the set is empty and every registry session refuses, exactly as
it does today.

**Revised on cycle-2 B5.** The paragraph that stood here claimed the degradation is toward refusing.
That is true only of the empty set. A set that is merely STALE degrades the other way, and the
sentence read as a guarantee it was not: `claimedSessionIds()` is the last COMPLETED pass, an identity
is claimed before its pane is attributed to any worktree, and `PaneFact` carries no session identity,
so a live Claude rooted in the target vanished from BOTH evidence sources whenever its claiming pane
had no attributable cwd or the pane set moved ahead of the debounced projection. On the one action
that cannot be undone, that let an unforced removal reach git.

**Chosen instead:** a claim suppresses a registry session only where the SAME assessment will classify
the pane that made it. The projector publishes the claim as `entryId → paneId` rather than a bare
membership set — it already knows the pane, so this is the same fact keyed usefully — and the
suppression moves out of the producer and into `evaluateRemoval`, which is where the target worktree
and the pane snapshot are both in hand. A session is dropped from the external evidence only when its
claiming pane is present in that same snapshot, resolved inside the target, and not exited. Anything
else keeps the registry record, and an unclassifiable record refuses. Both failure directions now
point the same way: an unknown session refuses, and a claim we cannot corroborate is not a claim.

Rejected — a generation counter on the projection compared against a pane-evidence generation: it
answers "were these read at the same moment", which is a weaker question than "will this assessment
account for that pane". Two coherent-but-unattributed reads still lose the session.

Rejected — resolving pane identity a second time inside the removal producer: `identify()` reads the
process table and falls back to heuristics, so a second copy is both a real cost per assessment and a
second place for the answer to differ from the one the panel is showing.

Rejected — matching on `cwd` instead of identity: a pane and a registry record sharing a directory
are not thereby the same session, and two Claudes in one worktree is the case the count exists for.

## Failure-surface inventory

| Resource | Owns writes | Serialization | Crash mid-write | Failed / malformed read | Two racing hosts |
|---|---|---|---|---|---|
| Ignored material on disk | Nobody here — the walk is **read-only** | n/a — no writes | n/a | Fails **open**: unproven, confirmable. § 2.3 is explicit that a slow or unreadable disk must not make a worktree unremovable | Both walk, both read; a file appearing between them changes a count that § 3 already says is not a guarantee |
| Provision manifest | The apply path (unbuilt), never this change | n/a — read-only here | n/a | Fails **open** to the undifferentiated count. A malformed or wrong-`version` file is treated as absent and said so; never partially trusted | Read-only; a manifest rewritten mid-read yields absent-or-whole, and both degrade to the same fallback |
| Claude PID / session registry | The agent subsystem, not this change | n/a — read-only here | n/a | Fails **closed** for the refusal question: unreadable registry leaves external checks `unproven`, and an undeterminable activity is treated as live (§ 2.2). This is the one read where open would be unsafe | Another host's session appearing between assessment and execution is exactly what D5's re-evaluation exists to catch |
| The worktree directory itself | `git worktree remove`, in WT-013.4's execution path | Per-repo mutation queue, this extension host only | Out of scope — this change assesses and does not execute | n/a | § 3 already states per-repo serialization does not cover other processes |

Nothing in this change writes to any of them. That is the reason the inventory is short, and it is
worth stating rather than leaving to be inferred: an assessment that mutated something would need a
rollback story, and this one has nothing to roll back.

## Interfaces

```ts
/** Absent activity means live — an external session we cannot classify is not evidence of idleness. */
export interface ExternalSessionFact {
  sessionId: string;
  /** Resolved, on the same contract as `PaneFact.cwd`. */
  cwd: string;
  activity: PaneActivity | undefined;
}

/** What one bounded walk found, or why it could not finish. */
export type IgnoredMaterial =
  | { kind: "measured"; entries: number; bytes: number; provisioned?: { entries: number } }
  | { kind: "unproven"; reason: "budget" | "unreadable" };
```

`provisioned` is present only when the manifest was read whole. Its absence is how "we did not
differentiate" is expressed — never a zero, which would claim we looked and found none.
