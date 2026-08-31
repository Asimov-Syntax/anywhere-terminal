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

**The ordinary branch was unreachable, and D6 is what reaches it.** This paragraph used to argue
that the host's `atRisk` gate — which removes a clean worktree without sending a report at all — was
outside this change. Round 3 overruled that (B1) and the overrule is accepted. `confirmationFor`
stays total over the assessments the wire permits, as it always was; what changed is that a producer
now exists for its ordinary case. See D6 and D7.

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

## Round-3 B1 remedy — the report is shown before anything is deleted

D2 recorded that the ordinary branch is unreachable and argued the host's `atRisk` gate was not this
change's business. That rebuttal was **overruled** in round 3 and the overrule is accepted: the
blueprint Design Ref and task Acceptance both establish the ordinary confirmation as this change's,
and a control the shipped flow can never mount is not delivered. The decisions below make it
reachable. D1 through D5 are unchanged.

### D6 — Asking what a removal would cost is its own message, and it acts on nothing

`worktreeRemoveAssess { worktreeId }` is answered by `worktreeRemoveAssessment`. It resolves the
target, evaluates, posts, and removes nothing.

The contract is not invented here: [worktree-rpc.md](../../../docs/design/worktree-rpc.md) § 2.1
line 97 and § 2.2 line 114 already declare both messages. Neither was ever implemented, so the only
way the report reaches the panel today is `worktreeMutationResult.result.kind === "blocked"`, which
the host produces **by attempting the removal**. That is the whole mechanism of B1: a clean worktree
is deleted because there is no way to ask.

Reuse, not new machinery — `WorktreeMutationBindings.assessRemoval`
(`worktreeMutationService.ts:203`) already exists and is what the removal path itself calls.

**"Resolves the target" was underspecified, and round-4 B3 is what that cost.** This decision said
what the message does not do — it does not act — and left unstated *against which tree* it resolves.
The answer is now D10's: the same forced-rebuild barrier a mutation takes, and still no mutation
result published. Read D6 and D10 together; where the two disagree D10 governs.

**Rejected — make every unforced removal report first.** The user would then need a way to say "I
have seen it", which is either a second unforced request the host cannot tell from the first, or new
per-worktree host state. That is more machinery than a read-only message, and it fuses "ask" with
"act" in the one place this change exists to separate them.

### D7 — The fingerprint's PRESENCE is the force authority, and the panel never mints it

```
fingerprint: string  →  confirm posts  worktreeRemove { force: true, fingerprint }
fingerprint: null    →  confirm posts  worktreeRemove { force: false }
```

The assessment carries `fingerprint: string | null`, non-null under **exactly** the predicate the
blocked path already uses — `atRisk(assessment.evidence)` at `worktreeMutationService.ts:467`. A
refusal carries `null`, as the blocked path already sends (`:461`). A clean or `notApplicable`
assessment carries `null` and its confirmation therefore goes down the **existing unforced path**,
which re-evaluates and blocks if the worktree stopped being clean in the meantime.

**Which worktree the token is bound to.** `fingerprints.issue` keys on `worktreeId` plus evidence,
never on the registration the report described — deliberately, because round-2 B5 established that no
available field can identify an incarnation uniquely. The binding is `forget`, and D10 is what makes
it fire before the token is minted rather than after. Without D10 this line mints authority over
whatever now occupies the path.

So assessing a healthy worktree mints no force authority. The alternative — issue on every assess,
for symmetry, which is what round-3 B1's SuggestedFix proposes — is **rejected**: it would make "ask
what this would cost" a deletion-authority door on a worktree where nothing is wrong. This project
shipped exactly that door twice, at round-1 B2 and round-3 B2 of WT-012.16, both walked back through
by a replayed message.

This needs `WorktreeRemoveDialogDeps.onConfirm` to widen from `(fingerprint: string)` to
`(fingerprint: string | null)`. That widening is the mechanism: the dialog forwards the authority it
was handed and cannot manufacture one it was not.

### D8 — An assessment that could not be made is not a refusal

`checksFor({ kind: "unavailable" })` marks the **entire** catalogue `unproven`, refusal-class checks
included (`removalChecks.ts:70-84`). Under D2's predicate — corrected in 1_5 so that an unproven
refusal refuses — a flat assessment message would therefore make a worktree the host merely could not
READ render as a hard refusal with no control at all.

So the reply is discriminated and the panel routes on the discriminant, exactly as the host already
routes its own `unavailable` away from the blocked path (`worktreeMutationService.ts:452`):

```ts
export interface WorktreeRemoveAssessRequestMessage {
  type: "worktreeRemoveAssess";
  worktreeId: string;
}

export interface WorktreeRemoveAssessmentMessage {
  type: "worktreeRemoveAssessment";
  worktreeId: string;
  result:
    | { kind: "assessed"; assessment: WorktreeRemoveAssessmentPayload; fingerprint: string | null }
    | { kind: "unavailable"; unreadable: readonly string[] };
}
```

`WorktreeRemoveAssessmentPayload` (`messages.ts:2249`) is reused verbatim — it already carries
`checks` and the named `contained` list, and is already what the blocked path sends. Nothing about
`RemovalCheck` moves.

**Blueprint reconciliation.** § 2.2 line 114 declares the payload as
`{ worktreeId, checks, fingerprint, branchDelete? }`. Three corrections, owned by this change's
Blueprint Sync: `fingerprint` is `string | null` rather than required-and-present, matching the
`blocked` result it mirrors; `contained` is named, because the shipped payload has carried it since
WT-013.1 and the doc simply never caught up; and the reply is discriminated per D8. `branchDelete`
stays in the doc **unimplemented and owned by WT-013.3** — this change adds no branch-delete offer.

### D9 — `notApplicable` needs no new rule

A worktree that is gone yields confirmable checks with outcome `notApplicable`
(`removalChecks.ts:97-105`), which is neither "passed" nor "failed or unproven". `confirmationFor`
already returns `"ordinary"` for it, because its typed predicate tests `failed || unproven` and its
refusal predicate does the same within its own class. The fourth state was always handled; it was
never *named*, and an unnamed reachable state is one a later edit breaks silently. The spec now names
it and a test pins it. No code changes for this decision.

### D10 — An authority-bearing read takes the same freshness barrier a mutation takes

Round-4 B3. D6 said the assess "resolves the target, evaluates, posts, and removes nothing", and the
code took that literally: `worktreeRemoveAssess` calls `assessRemovalReport` directly, so it reads
from whatever the cache holds. The build-time comment justifying that named two grounds for avoiding
the mutation wrapper — it takes the rebuild gate, and it publishes a mutation result. **The first
ground was wrong.** Queueing an authority-bearing read behind writes is not a cost to avoid; it is
the property the read needs. Only the second ground survives.

The two are separable, and the seam already exists:

```
mutationCoordinator.run<T, R>(repoId, step)     ← queue lock, forced rebuild barrier,
  │                                                re-resolve, body, post-attempt rebuild.
  │                                                Generic. Publishes NOTHING.
  └── withTarget(verb, target, body)            ← wraps run, then calls deps.report(...)
                                                   THIS is what announces a mutation.
```

So `assessRemovalReport` runs its assessment inside `coordinator.run` and the host still publishes
no mutation result. **No new invariant owner is minted** — the existing one is adopted, which is why
this is an amendment rather than its own change.

**What this closes, and by which existing mechanism.** Binding the token to an incarnation was tried
and rejected at round-2 B5: `head:branch` repeats on a recreate onto the same commit, and git reuses
`.git/worktrees/<name>` once the name is free, so no field available can be made unique. The binding
lives in `FingerprintStore.forget` (`worktreeFingerprint.ts:44-53`) instead — the rebuild that fails
to find an id destroys every token for it, so a worktree created later at the same path cannot
inherit one. B3 is reachable precisely because that rebuild had **not run yet**. Taking the barrier
first is therefore not a new defence; it is what makes the shipped one fire before authority is
minted rather than after.

**Cost, accepted rather than engineered around.** `coordinator.run` forces a rebuild in its `finally`
after every body, and a forced request bypasses the rebuild floor (`rebuildGate.ts:14`). An assess
therefore costs two forced rebuilds where it previously cost none, and resets the floor. Accepted:
this is one human click on a menu item, not a hot path, and the alternative — an opt-out flag on the
shared coordinator — would put a way to skip the post-attempt rebuild within reach of every mutation,
where it is load-bearing for exactly the reason its comment gives.

**A target that vanished** returns `null` through the coordinator's `missing` leg and the host posts
nothing, unchanged from today. The rebuild that observed the disappearance has already removed the
row, so the panel's answer to the user is the row leaving the tree.

### D11 — A late answer never replaces what the user is looking at now

Round-4 W4. `WorktreeView.openRemoveDialog` calls one global `closeDialog`, so an assessment answered
late closes whatever dialog is open and puts an obsolete report in its place.

The remedy is a **controller-local live-intent guard, not a wire field.** The controller is the only
thing that opens a dialog — create, launch, prune and the report all go through it — so it can hold
the one remove intent that is live and drop any reply that no longer answers it. A per-surface token
echoed through the message was considered and rejected: it costs a contract change to distinguish two
assessments **of the same worktree**, and those two render the same report, so the distinction buys
nothing. Every boundary the finding names is closed without it:

| Late reply arrives after… | Guard |
|---|---|
| a removal was asked for a DIFFERENT worktree | intent names one worktree; a mismatch is dropped |
| a create, launch or prune dialog opened | opening any dialog clears the intent |
| the user cancelled the report | the dialog's own cancel clears it |
| the row departed (`unavailable` arm) | Retry renders only while the target still resolves |

The last row is the second half of W4: a re-scoped `unavailable` result loses its `worktreeId`, and
`onRetryAction` then silently does nothing while the button is still on screen. A control that cannot
act is not offered.

Two assessments of the same worktree completing out of order remain possible and are harmless: with
D10 in place both reports were produced behind the barrier, and a token issued over older evidence
reprompts at redemption if the worktree has since changed.

### D12 — A failed assessment is answered, not swallowed

Round-4 W5. The host's `catch` posts nothing. That was written against a real hazard — inventing an
empty report would render a worktree of unknown risk as one with none — but the conclusion was wrong:
the choice is not between a false report and silence, it is between a false report and the
`unavailable` arm D8 already defines for exactly this.

The obstacle is that `unavailable` promises a **named** list (`unreadable: readonly string[]`, which
the panel renders under "These reads failed:") and a rejection has no source to name. Two ways out
were weighed:

- **Widen the result union with a third `failed` arm.** Rejected: a new wire arm, a new panel branch,
  and a third thing that means "we could not tell you" beside the two that already do.
- **Name the assessment itself as the read that failed** — `unreadable: ["the assessment"]`. Chosen.
  It keeps D8's shape and its retry surface, and the sentence it renders is true: the assessment is
  what could not be read. The promise that the list is never empty is kept rather than weakened.

Fail-closed is preserved either way — nothing is deleted — but an explicit destructive request now
always gets an answer.

## Obligation ledger

| Claim | Semantics | Defeater | Witness / check | Disposition |
|---|---|---|---|---|
| Asking for a report removes, modifies or deletes nothing | For every `worktreeRemoveAssess`, no destructive call is reached | A handler that shares a path with `removeWorktree` and falls through to it | The handler calls `assessRemoval` — read-only at `WorktreeHost.ts:3017`, and the orphan proofs it runs are read-only at `orphanProofs.ts:87-93`, `:142-200` — and posts. A test asserts the removal capability is never invoked for an assess. `pnpm run gate:fs-deletion` runs in this change's Verify Gate | supported |
| Assessing mints force authority under exactly the conditions that already minted it, and no others | `fingerprint !== null` ⟺ `atRisk(evidence)`, the same predicate and the same call the blocked path makes | Issuing unconditionally "for symmetry"; a clean confirm posting `force: true` | D7. Tests: an all-passed assessment carries `null` and its confirm posts `force: false`; a `notApplicable` one does the same; a failed-confirmable one carries a fingerprint and its confirm posts `force: true`; a refusal carries `null` and mounts no control | supported |
| The report→confirm window is not lengthened by moving the report earlier | The user gesture count and the elapsed window between issue and redemption are unchanged | An assess issued long before any intent to remove — e.g. on hover, on selection, or eagerly per row | The only caller is the Remove Worktree action itself, so the sequence is click→read→confirm where it was click→blocked→read→force. One issue per explicit remove intent, as today | supported |
| A worktree that could not be read cannot be rendered as refusing removal | An `unavailable` assessment reaches no code path that computes `confirmationFor` | A flat reply shape that erases the kind, leaving every check `unproven` | D8's discriminant. A test sends `kind: "unavailable"` and asserts the retry surface, not a report, and that no confirmation control exists | supported |
| The panel cannot manufacture force authority | The dialog forwards `fingerprint` and never synthesises one | `onConfirm` defaulting a null to a string, or the controller posting `force: true` when it holds no fingerprint | D7's nullable `onConfirm`. A test drives a null-fingerprint confirm and asserts the posted message is `force: false` with no `fingerprint` key | supported |
| Redemption cannot be satisfied by evidence the user never saw | — | Lock reason A → unlock → lock reason B between report and confirm redeems, because `isIdentityPreservingSubset` (`worktreeBlockers.ts:35-36`) compares the lock as a BOOLEAN and the digest (`worktreeFingerprint.ts:179-189`) omits `lockReason`. Second schedule: the 150 ms presence projection cap can leave pane rows stale while an agent has begun running, and redemption compares pane IDENTITY, not activity | **Not a claim this change makes.** Both defeaters are properties of the shipped force path, reachable today through blocked→force, and neither is introduced or widened here — see the window row above. Recorded so it is not mistaken for something this change closed | n/a — pre-existing; needs its own PLAN task, named in workflow.md Notes |
| A report and the removal its confirmation authorizes name the same registration | For every assessed reply, the tree the assessment resolved against is the tree the barrier had just rebuilt | A watcher rebuild still pending while the path was removed and recreated outside the panel: the old cached row is described, the replacement's evidence is read, and `forget` has not fired | D10. `coordinator.run` awaits `gate.request(force: true)` before `resolve`, so the rebuild that would call `forget` (`worktreeFingerprint.ts:44-53`) has completed. Test: a deferred-watcher replacement produces no assessed reply carrying a token redeemable against the replacement | supported |
| A late assessment cannot replace what the user is looking at | An assessed reply opens a report only while it answers the live remove intent | `openRemoveDialog`'s single global `closeDialog` closing a newer create/launch/prune/report dialog | D11's controller-local intent guard. Tests: a reply for worktree A after a removal was asked for B opens nothing; a reply landing after another dialog opened leaves it standing; a re-scoped `unavailable` result renders no Retry | supported |
| An explicit destructive request always gets an answer | Every `worktreeRemoveAssess` from a live surface is followed by exactly one reply or by the row leaving the tree | The `catch` posting nothing, leaving Remove Worktree inert | D12. Test: a rejecting assessment capability produces an `unavailable` reply and the retry surface, not silence | supported |
| Typing never unlocks a proof-gated option | The typed predicate excludes `cls === "proof"` | A proof check misclassified `confirmable` | The class is the host's and the panel reads it. The witness is **vacuous until WT-013.3** ships a proof-gated control: with none in the DOM, no test can fail. Stated rather than dressed as covered | n/a — no proof-gated control exists to gate; WT-013.3 owns the real witness |
