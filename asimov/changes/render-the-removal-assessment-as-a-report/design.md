# Design: render-the-removal-assessment-as-a-report

> Blueprint: [worktree-removal.md](../../../docs/design/worktree-removal.md) § 1, § 2.1, § 2.3, § 2.4, § 3, § 4

## Context

Everything this change needs is already on the wire. WT-013.1 landed `RemovalCheck` with `id`,
`cls`, `outcome`, `count` and `detail`, and the four-outcome vocabulary including `notApplicable`;
WT-013.2 put the three orphan proofs into the same `checks` array with `cls: "proof"`. No message
shape changes here — this change is what the webview does with an assessment it already receives.

What the dialog does today: `buildBlockerList` renders a hand-written line per failing check, keyed
on `failed(checks, id)` or a positive `count`. A passing check renders nothing, an `unproven` check
renders nothing, and `notApplicable` renders nothing — so a report where a check could not run is
indistinguishable from one where it passed. The force button is then withheld entirely whenever any
non-proof check is `unproven`, with a comment naming WT-013.4 as the owner of the copy that would
make such a report legible.

## Decisions

### D1 — One presenter table keyed by check id, not a chain of failure tests

**Chosen:** a single table maps each check id to how it is worded, and the renderer walks the
assessment's own `checks` array, asking the table for wording and the check's `outcome` for which
of the four forms to use. The dialog never asks "is `dirty` failing" to decide whether `dirty`
exists in the report.

The current chain cannot express § 2.1 at all: it is a list of `if (failed(...))` statements, so
"render every check including the passing ones" would mean adding a second branch per check and
keeping the two in step. Worse, the chain silently owns the check inventory — a check the host adds
renders nowhere until someone edits the webview, which is how `notApplicable` came to be invisible
despite being on the wire specifically so the UI could tell it apart.

Ordering comes from the assessment, not from the table: the host already evaluates checks together
and in a stable order, and a second ordering in the webview is a second thing to disagree.

**Rejected — rendering `detail` as the whole line.** `detail` is bounded prose for the cases that
have something extra to say. A report assembled only from it would put the host in charge of UI
copy, and would lose the count element the panel renders in its own right (`count` is separate from
`detail` for exactly that reason).

### D2 — The confirmation control is chosen once, from the classes the host sent

**Chosen:** one function over the checks returns which of three controls the dialog mounts —
none (refused), typed, or ordinary — and the dialog mounts what it returns. Refusal is earned by a
check with `cls === "refusal"` whose outcome is `failed` **or `unproven`**. Typed is required when
no refusal-class check earned a refusal and any check with `cls === "confirmable"` has outcome
`failed` or `unproven`. Everything else is ordinary.

**Corrected after round-1 W1.** This decision first read "refusal keeps reading
`isRefusedByChecks`", which refuses only on `failed`, so a refusal-class check nobody could evaluate
fell through to a confirmation. DESIGN.md D43 had already decided otherwise — "a hard refusal
unproven still refuses" — and worktree-removal.md § 2.2 says the same in the domain's own words:
"Activity that cannot be determined is treated as live". The blueprint outranks this file, so the
predicate changes rather than the rule. Fail-closed within each class is what D43 makes the shared
meaning of `unproven`: it withholds whatever its own class gates — the removal for a refusal, an
ordinary confirm for a risk, only the option it gated for a proof.

`isRefusedByChecks` is the single definition and has no host caller, so the correction changes what
this dialog offers and no host behavior. The host reaches its own refusal through
`assessment.kind`, and routes a wholly `unavailable` assessment — the one case that reports every
check `unproven` — to retry UI rather than to this dialog. That routing is why the shipped path was
fail-closed in spite of the wrong predicate, and it is not something to depend on: it is one
producer away from authorizing a deletion while agent activity is unknown.

`cls` travels on the wire precisely so this rule is not re-derived webview-side (worktree-removal.md
§ 2.2). Reading `cls` rather than a list of ids means a check whose class is computed host-side —
`externalAgents` is `refusal` or `confirmable` depending on what was found — lands on the right side
without the webview knowing that rule exists.

### D3 — An unproven confirmable risk earns a typed confirmation; it no longer withholds the button

**Chosen:** the round-1 W2 guard — withhold force whenever a non-proof check is `unproven` — is
replaced by the typed confirmation. The report now says which check could not be evaluated and what
that leaves unknown, which is the thing the guard was standing in for.

The guard was correct while the dialog could not describe the gap: offering force under a blocker
list that silently omitted an unreadable `git status` would have asked the user to authorize
destroying a risk set the dialog had failed to describe. It is wrong once the report names the
unproven check, and leaving it would make a worktree with an unreadable status permanently
unremovable through this UI, which § 2.3 explicitly refuses for the same reason on ignored content:
a slow or unreadable disk must not make a worktree unremovable.

The safety property is preserved by strengthening, not by removing: unproven now demands the
typed confirmation, which is a higher bar than the ordinary confirm it would otherwise have got.

### D4 — Proofs render in their own group and never touch the control

**Chosen:** proof-class checks are rendered under their own heading, worded as what they would
unlock rather than as a risk, and are excluded from the control decision by D2's `cls` test.

§ 2.2 makes this the whole point of the class, and § 4 states proofs are shown and never acted on
alone. A proof rendered beside the confirmable risks reads as a reason the removal is dangerous,
which is the misreading that would make an unfetched default branch look like a hazard.

### D5 — What the removal leaves behind is stated unconditionally

**Chosen:** the sentence that the branch is kept and that panes inside the worktree keep running in
a deleted directory is part of the report, not a clause appended only when `idlePanes > 0`.

The pane clause today is conditional on the count, so a removal with no panes open says nothing
about panes — which is fine — but the accepted requirement is about what the report states, and the
branch clause has the same shape. Keep each clause's truth condition: claim panes keep running only
where there are panes, and name the branch only where there is one.

## Failure-surface inventory

| Resource | Answer |
|---|---|
| The removal itself (irreversible directory deletion) | Not owned here. The dialog authorizes; the host performs and re-evaluates. The confirmation re-sends the fingerprint the user was shown, unchanged from today — a typed confirmation is a stronger gesture over the same authorization, not a wider one |
| Assessment state | n/a — the dialog holds one assessment for its lifetime and is disposed on answer. A newer assessment arrives as a new dialog |
| Durable stores, caches, locks, spawned processes | n/a — this change writes nothing outside the DOM |
| Two racing hosts | n/a — the fingerprint already binds an authorization to the set it was granted over, and worktree-panel's "A confirmation authorizes only the risks it was shown" is the contract |
