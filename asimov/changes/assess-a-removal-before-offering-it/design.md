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

Not a `du`, and not a `git status --ignored` parse alone: `--ignored` names the entries, which is what
the count needs, but a size means stat-ing them, and that is the part that has to be bounded. The
budget spans both phases — an enormous `--ignored` listing exhausts the entry cap before any stat runs.

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
