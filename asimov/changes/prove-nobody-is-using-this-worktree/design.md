# Design — prove nobody is using this worktree

> Refs: [worktree-removal.md](../../../docs/design/worktree-removal.md) § 2.2, § 4, § 4.1;
> [worktree-rpc.md](../../../docs/design/worktree-rpc.md) § 2.5, § 3.1;
> WT-013.1 (`archive/260830-2042-assess-a-removal-before-offering-it/design.md`) D1, D2, D6

## Decisions

### D1 — The proofs are rows in the existing catalogue, not a parallel structure

`removalChecks.ts` declares `CATALOGUE` as one table keyed by check id, and WT-013.1's D1 defends
that: a check that appears in one branch and not another is how a UI renders a shorter list for a
worse outcome. `RemovalCheckClass` already carries `proof` and nothing has ever used it.

**Chosen:** three new catalogue rows — `lockAged`, `ownerGone`, `branchMerged` — with a constant
`cls: "proof"`. They are reported from the `confirmable` branch of `checksFor` only. A `refused`
assessment gathered no evidence about them, and reporting them there would claim checks ran that did
not.

Rejected — a separate `proofs` array beside `checks` on the wire: § 2.5 already puts `cls` on every
check precisely so the webview never re-derives what an outcome costs. A second array would put the
same rule in a second place.

### D2 — A proof is not a risk, and three call sites must keep saying so

§ 2.2 makes a proof-gated check withhold only the action it gates. § 3.1 adds the case that reads
like a contradiction and is not: a proof moving from passed to unproven "must withdraw the option it
gated **even though nothing about the removal got riskier**."

**Chosen:** the proofs enter `RemovalEvidence` so `checksFor` can report them, and enter nothing
else. Three deliberate non-inclusions, each for its own reason:

- `atRisk` (`worktreeMutationService.ts`) decides whether an unforced removal may run at all. A
  stale lock is not a reason to demand confirmation.
- `isIdentityPreservingSubset` (`worktreeFingerprint.ts`) asks whether every risk present now was
  present in the set the user approved. A proof has no identities and is not a risk; folding it in
  would re-prompt a removal because a branch got merged.
- `digest` — same reason. A confirmation is bound to the risk the user weighed.

§ 3.1's withdrawal requirement is satisfied without any of them: the option a proof gates is branch
deletion, the offer is computed from the assessment taken immediately before the delete, and
§ 5 rule 3 guards it with both OIDs re-verified at that moment. A proof that degraded simply does
not produce an offer. **This is the mechanism, and it lives in WT-013.3** — which is why this change
produces the proof and no offer.

Rejected — putting the proofs in the digest so any change re-prompts: it converts every merge of a
default branch into a re-prompt on an unrelated removal, and § 3.1's own sentence says the removal
did not get riskier.

### D3 — One registry read answers both questions

`listRunningClaudeSessions` drops a record the moment `isAlive(pid)` is false, so its empty result
cannot distinguish "no record" from "a dead record was filtered out" — and § 4.1 says that
distinction IS the ownership proof. Four call sites depend on its current behaviour
(`extension.ts`, `TerminalEditorProvider`, `TerminalViewProvider`, `presenceDeps`).

**Chosen:** extract the per-file parse and validation into one helper. `listRunningClaudeSessions`
keeps its exact signature, dedupe, and live-only filter — nothing about the presence panel moves. A
second export returns every well-formed record with an `alive: boolean`, from the same parse. This
is WT-013.1's D2 pattern applied again: same source, two questions, and the filter belongs to the
question that wants it.

The removal producer then takes the raw records ONCE and derives both the live external evidence and
the ownership proof from them, so the assessment scans the registry directory exactly as many times
as it does today. `RemovalInput.externalSessions` becomes `RemovalInput.sessions`, carrying
`SessionRecord` (an `ExternalSessionFact` plus `alive`), and `evaluateRemoval` filters the live ones
where it used to be handed them.

Rejected — a `keepDead?: boolean` option on the existing function: the return type would then mean
two different things depending on an argument, and every existing caller reads it as "live sessions"
without looking.

Rejected — a second `readdir` for the proof: two scans of the same directory in one assessment, able
to disagree with each other about the same instant.

### D4 — The default branch is resolved from local refs, and origin is the assumed remote

§ 4.1 names the ladder — `refs/remotes/<remote>/HEAD`, then `init.defaultBranch`, then a local `main`
or `master` — without naming the remote.

**Chosen:** `origin`. `git symbolic-ref --short refs/remotes/origin/HEAD` first, then
`git config init.defaultBranch`, then `main`, then `master`. Every candidate past the first is
confirmed to exist with `git rev-parse --verify --quiet refs/heads/<name>` before it is used, because
`init.defaultBranch` is a preference about repositories yet to be created and says nothing about this
one. Nothing resolves → the proof is unproven.

Verified against git 2.50.1 rather than assumed (WT-013.1's round-1 B3 was a source whose behaviour I
had asserted without probing): a repository with no `origin/HEAD` fails
`symbolic-ref` with exit 128 and `fatal: ref refs/remotes/origin/HEAD is not a symbolic ref`, and
`rev-parse --verify --quiet` exits 1 for an absent ref and 0 for a present one.

Rejected — enumerating `refs/remotes/*/HEAD` and picking one: with two remotes there is no
non-arbitrary answer, and an arbitrary one produces a confident wrong proof about which branch is
"the" default.

### D5 — Only two `merge-base` exit codes mean anything

**Chosen:** exit 0 → the branch is merged (proof passes). Exit 1 → it is not (proof fails).
**Anything else → unproven**, including 128. Verified on git 2.50.1: a missing ref exits 128 with
`fatal: Not a valid object name`, which under a `code !== 0` test would read as "not merged" — and a
"not merged" answer is the one that withholds a destructive option, so reading an error as a fact is
the direction that produces a wrong offer once WT-013.3 lands.

A worktree with no `branch` — detached or bare — reports `notApplicable`. § 4.1's table leaves the
`notApplicable` column blank for this proof, which the code cannot honour: there is no branch for the
question to be about, and `unproven` would claim a comparison was attempted. **This extends the
blueprint and is carried to blueprint sync.**

### D6 — The lock's age comes from the file git writes, through the git dir git names

**Chosen:** `stat` of `<worktreeGitDir>/locked`, where `<worktreeGitDir>` is what
`git rev-parse --absolute-git-dir` reports from inside the worktree. Threshold **24 h**, a recorded
constant. `notApplicable` when `target.locked` is false; unproven when the file cannot be stat'd.

Verified on git 2.50.1: `git worktree lock` writes the `locked` file whether or not a reason is
given — with no reason it is zero bytes — so the file's presence tracks the lock state and its mtime
is the lock's age. A zero-byte file would defeat a reader that used content as the signal.

`diskIgnoredDeps` already runs `rev-parse --absolute-git-dir` for the provisioning manifest. That
read is extracted to one helper both callers use rather than copied — the second copy is what
round-1 W1 of the previous change was about.

Rejected — deriving the path as `<repoGitDir>/worktrees/<basename>`: git's directory name is not
always the worktree's basename (it disambiguates collisions), so the derivation is wrong exactly
where two worktrees share a basename.

### D7 — Proofs are computed only where they can be reported

**Chosen:** the proof reads are taken in the same `Promise.all` as the existing four, and only for an
assessment that can reach `confirmable`. A `missing` worktree resolves them without touching the
disk: no directory means no lock file and no branch to compare, so `lockAged` and `branchMerged` are
`notApplicable` and only `ownerGone` is answered, from the registry read that happens anyway.

This is what keeps § 2.3's promise intact under D7: the assessment's suspension points do not grow,
which is the window WT-013.1's round-9 B8 closed and its round-1 B2 fix round nearly re-opened.

## Failure-surface inventory

| Resource | Owns writes | Serialization | Crash mid-write | Failed / malformed read | Two racing hosts |
|---|---|---|---|---|---|
| `.git/worktrees/<name>/locked` | `git worktree lock`/`unlock`, never this change | n/a — read-only here | n/a | Fails **open**: unproven, and a proof withholds only the option it gates. An unlocked worktree is `notApplicable`, which is not a read failure | Another host unlocking between the listing and the stat yields `notApplicable`-or-unproven; neither is a wrong claim |
| Claude PID / session registry | The agent subsystem, not this change | n/a — read-only here | n/a | Fails **closed for the refusal question** (unreadable leaves external checks unproven, per WT-013.1 D2) and **unproven for the proof**. A record that cannot be parsed is skipped by the shared parser, exactly as today | A session starting between the read and the removal is what § 3.1's re-assessment exists to catch |
| Local git refs (branch, default branch) | The user's own git, and any other process using this repository | n/a — read-only here | n/a | Fails **open**: unproven. Never "not merged", which is the answer that would withhold an option on an error | Another host advancing the default branch mid-assessment yields a proof about a moment that has passed; § 5 rule 3's OID guard is what makes that safe to act on, and it is WT-013.3's |

Nothing in this change writes to any of them, so there is nothing to roll back.

**Not covered by this inventory, and deliberately:** an abandoned read that outlives its deadline
(WT-013.1 round-5 W3). The lock proof adds one bounded `stat` of one small file and only when the
worktree is locked, so it does not change that finding's mechanism — but it is one more read, and the
finding stays open and unwaived.

## Interfaces

```ts
/** A registry record as read, whether or not its process still exists. */
export interface SessionRecord {
  sessionId: string;
  /** The identity a window pane's claim is keyed by. */
  entryId: string;
  /** Resolved, on the same contract as `PaneFact.cwd`. */
  cwd: string;
  activity: PaneActivity | undefined;
  /** `process.kill(pid, 0)` semantics at the moment of the read. */
  alive: boolean;
}

/** What one proof established, or why it could not. `notApplicable` is not a failure. */
export type ProofOutcome = "passed" | "failed" | "unproven" | "notApplicable";

/** The three proofs of § 4, answered together. */
export interface OrphanProofs {
  lockAged: ProofOutcome;
  ownerGone: ProofOutcome;
  branchMerged: ProofOutcome;
}
```

`ProofOutcome` is structurally `RemovalCheckOutcome` and is declared separately on purpose: the wire
type is what a check reports, and this is what a proof establishes. They agree today; a change to one
should not silently redefine the other.
