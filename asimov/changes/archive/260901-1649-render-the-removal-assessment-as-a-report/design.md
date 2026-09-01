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
| The removal itself (irreversible directory deletion) | The dialog returns the report fingerprint; the host re-evaluates, redeems it once, and alone chooses ordinary or forced Git execution. A request with no fingerprint reports and cannot execute. Partial-failure classification remains outside this change |
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

**Superseded by D7.** This decision first rejected making every fingerprint-free removal report,
because the host could not distinguish a second unforced request from the first without new state.
The user's scope decision requires that invariant. D7 supplies the distinction without host session
state: absence of a fingerprint is always an ask, and presence is the answered report.

### D7 — A fingerprint authorizes the confirmed attempt; the host chooses force

**Amended after the user's 2026-09-01 decision, “Luôn hỏi trước khi xoá”.** The first version made
fingerprint presence synonymous with force authority: a clean report carried `null`, its callback
posted an unforced removal, and the service deleted when its fresh assessment was clean. That made
confirmation a panel convention rather than a host invariant — the callback's request was
indistinguishable from a direct fingerprint-free request that had crossed no dialog.

The two questions are now separate:

```
worktreeRemove { worktreeId }                 → unconfirmed intent: assessment state, never execute
worktreeRemove { worktreeId, fingerprint }    → confirmed attempt: re-assess and redeem
                                                   │
                                                   └─ host computes atRisk(current evidence)
                                                        false → ordinary git removal
                                                        true  → forced git removal
```

Every readable, non-refused assessment receives a fingerprint, including an all-passed or
`notApplicable` one. A refusal carries none and mounts no control; an unavailable assessment is not a
report. The assessment-only message remains the menu's read-only, coalesced path, while the mutation
service makes the same rule hold for a direct `worktreeRemove`: for a host-published target, absence
of a fingerprint returns assessment state but can never reach git. A wholly unknown id remains a
silent fail-closed pre-flight, because it has no repository or panel row to answer against.

The request no longer carries `force`. The panel forwards only the fingerprint the report carried,
and the service re-evaluates, redeems, then derives Git's mode from the current evidence with the one
existing `atRisk` definition. A clean confirmation therefore remains unforced; a risky confirmation
uses force; a newly appeared risk re-prompts through the existing subset verdict. A risk that cleared
may narrow to the ordinary path. The webview cannot request force and fingerprint presence does not
imply it.

**Which worktree the token is bound to is unchanged.** `fingerprints.issue` keys on `worktreeId` plus
evidence. Round-2 B5 established that no available incarnation field is unique across a same-path,
same-commit recreation, so `FingerprintStore.forget` remains the binding and D10 remains what makes
it fire before authority is minted. The user decision changes which reports receive an attempt token;
it does not reopen the rejected incarnation claim, widen the subset rule, or change the token's TTL
and one-shot spend.

This matches the useful part of Orca's cleanup flow: confirmation is required independently of risk,
then fresh host evidence chooses ordinary versus forced removal. It deliberately rejects t3code's
shape of confirming clean work and then always forcing it. It also rejects three local alternatives:
keeping a client-supplied `force` bit leaves contradictory payloads representable; treating every
fingerprint as force removes Git's late clean check; and retaining host-side “confirmed” state adds a
second authorization store when the fingerprint already owns target, evidence, expiry and spend.

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

**What this closes is PARITY, not the whole window.** The plan attack refuted the stronger reading
and the refutation is accepted. Taking the barrier fixes the target the assessment *starts* from; it
does not freeze the worktree while the assessment runs. Its schedule: the barrier resolves A, the
async status, ignored-content and proof reads at `WorktreeHost.ts:3084-3110` then read the path while
A is replaced by B outside the panel, and `stillObserved` (`:3116`) does not notice because with the
watcher deferred no rebuild has landed to change the observation. A token is minted over B's evidence.

That window is **shared with the shipped `blocked` → force path**, which issues from inside the same
coordinator body after the same reads, and it is what round-4 B3 measured this path against: the
finding was that the assess path was *weaker than* the removal path, and parity is what answers it.
The residual is recorded below as a row of its own and needs its own PLAN task, exactly like the
lock-reason weakness — it is not something D10 closed.

**Rejected — re-resolve after the reads and compare `incarnation`.** It would read as a binding that
holds and would not: round-2 B5 established that `head:branch` repeats on a recreate onto the same
commit, which is the case that matters. A check that fails silently in exactly its motivating case is
worse than an honestly named residual.

**The cost model, and who owns it.** One assessment holds the per-repo mutation queue across two
forced rebuilds, the git status and proof commands (10 s timeout) and the ignored-content scan (1.5 s
bound). That is affordable once. It is affordable per *click* only if something bounds how many
clicks become queued work — without such a bound every menu activation would enter the queue in its
own right, and a burst would delay any mutation behind it by the sum of all of them. This decision
therefore does not merely benefit from a bound on ADMITTED assessments; it is unaffordable without
one.

**It does not have one, and never did.** A controller-side duplicate drop was written here and
round-6 B5 refuted it: keyed on the single live worktree id, it saw one surface, so alternating two
rows — or two panels — walked straight past it. That is not a gap this decision can patch, because a
bound on work sharing the mutation queue has to be keyed by the repository the queue is keyed by, and
has to sit where every surface is visible.

**The bound is a settled dependency, owned elsewhere.** `coalesce-assessment-requests-at-the-host`
(`asimov/changes/archive/260901-0348-coalesce-assessment-requests-at-the-host/`) admits at most one assessment job per
repository, and the controller-side drop this paragraph used to rely on is gone. What that change
guarantees, how, and at what residual is its design.md's to state; this decision consumes it and
restates none of it.

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

**A controller-local, id-only guard was drafted here and REFUTED.** It rested on "the controller is
the only thing that opens a dialog", and that is false: the blocked-result notice's own *Force
remove…* action calls `openRemoveReport` directly from the view (`WorktreeView.ts:1540-1547`), so a
guard the controller clears is not cleared when the user opens that one. It also cannot order two
assessments **of the same worktree** — reply 1 arriving after request 2 was made still matches an
id-only intent and opens, leaving the user's latest request with no visible answer.

So the request carries a **token**, minted per request and echoed by the host:

```
worktreeRemoveAssess       { worktreeId, token }
worktreeRemoveAssessment   { worktreeId, token, result }
```

The controller holds at most one live token. It is minted where the assess is posted, and cleared
when any dialog opens — including the view's own opener, which tells the controller — when the report
is answered or cancelled, and when a newer removal is asked. A reply whose token is not the live one
is dropped, whatever its `worktreeId`.

| Late reply arrives after… | Closed by |
|---|---|
| a removal was asked for a DIFFERENT worktree | a newer request minted a newer token |
| the SAME worktree was asked twice | the token orders them; only the latest opens |
| a create, launch or prune dialog opened | opening any dialog clears the live token |
| the blocked-notice *Force remove…* dialog opened | the view clears it through the controller |
| the user cancelled the report | the dialog's own cancel clears it |
| the row departed (`unavailable` arm) | Retry renders only while the target still resolves |

The last row is the second half of W4: a re-scoped `unavailable` result loses its `worktreeId`, and
`onRetryAction` then silently does nothing while the button is still on screen. A control that cannot
act is not offered.

The token orders answers; it is **not** an authority. Removal authority remains D7's fingerprint,
and the host derives force independently; a reply carrying a stale token is discarded rather than
trusted for anything.

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

**The rejection is not the only silent exit, and the plan attack was right that the claim outran the
mechanism.** The coordinator's `missing` leg is the other one: when the barrier's rebuild finds the
worktree gone, `resolve` returns null and the assessment returns null, and the host posts nothing.
D10 first argued the row leaving the tree is the user's answer — but that holds only while the
rebuild actually broadcasts, and a rebuild whose presence projection rejects publishes nothing at
all (`WorktreeHost.ts:2518-2543`). The panel then keeps a stale row AND gets no reply.

So the `missing` leg answers too, through the same `unavailable` arm, naming the departure rather
than a read: `unreadable: ["the worktree is no longer registered"]`. Every request the host takes up
is answered on one of these arms; none of them exits silently.

Fail-closed is preserved either way — nothing is deleted.

**Amended, and narrower than first written.** This decision originally claimed "one live request, one
reply, with no exception". Two things it does not own make that false as stated, and both are better
named than defended. A request superseded before the host takes it up is never served and receives no
reply of its own — the child change's D3 chose that deliberately, and the user is not left waiting,
because the ask that replaced it is the one they are on. And delivery itself is unacknowledged: this
host posts, it does not confirm arrival. What D12 establishes is the host-local property — no exit
from a served request is silent — which is the part a design here can actually hold.

## Obligation ledger

| Claim | Semantics | Defeater | Witness / check | Disposition |
|---|---|---|---|---|
| Asking for a report removes, modifies or deletes nothing | For every `worktreeRemoveAssess`, no destructive call is reached | A handler that shares a path with `removeWorktree` and falls through to it | The handler calls `assessRemoval` — read-only at `WorktreeHost.ts:3017`, and the orphan proofs it runs are read-only at `orphanProofs.ts:87-93`, `:142-200` — and posts. A test asserts the removal capability is never invoked for an assess. `pnpm run gate:fs-deletion` runs in this change's Verify Gate | supported |
| No removal executes without authority bound to an issued report | Every readable non-refused report carries a one-shot fingerprint; a fingerprint-free `worktreeRemove` for a host-published target returns assessment state but cannot reach git; refusal and unavailable carry no executable authority | A direct fingerprint-free request reaches the current clean fallthrough; or a confirmable report carries no token and its callback recreates that request | D7. Task 4_1 drives the raw request through the host/service and task 4_4 drives the shipped menu through the dialog callback. The oracle refuted the stronger wording “proves the user answered”: a same-trust-domain client can replay an issued fingerprint, while the assembled UI test is the witness that production execution starts from the callback | supported — narrowed after plan attack |
| The shipped menu's report→confirm window is not lengthened by moving the report earlier | `worktreeRemoveAssess` is issued only by the Remove Worktree action, immediately before the dialog it answers | An assess issued on hover, selection, or eagerly per row | The menu sequence remains click→read→confirm. The plan attack correctly found that the defensive raw `worktreeRemove` fallback still travels blocked notice→report and therefore holds its token longer; that compatibility path is outside this narrower gesture-count claim and task 4_4 names it rather than pretending it opens directly | supported — narrowed after plan attack |
| A worktree that could not be read cannot be rendered as refusing removal | An `unavailable` assessment reaches no code path that computes `confirmationFor` | A flat reply shape that erases the kind, leaving every check `unproven` | D8's discriminant. A test sends `kind: "unavailable"` and asserts the retry surface, not a report, and that no confirmation control exists | supported |
| The panel cannot choose or manufacture Git's execution mode | The removal request carries a report fingerprint and no `force` field; the service derives force from the fresh assessment after redemption | Retaining the client bit; treating fingerprint presence as force; or defaulting a missing fingerprint into an executable request | D7. Type checks reject a client force choice; controller tests assert it forwards only the fingerprint; service and assembly tests show clean confirmation invokes ordinary Git while a confirmed risk invokes forced Git | supported |
| Redemption cannot be satisfied by evidence the user never saw | — | Lock reason A → unlock → lock reason B between report and confirm redeems, because `isIdentityPreservingSubset` (`worktreeBlockers.ts:35-36`) compares the lock as a BOOLEAN and the digest (`worktreeFingerprint.ts:179-189`) omits `lockReason`. Second schedule: the 150 ms presence projection cap can leave pane rows stale while an agent has begun running, and redemption compares pane IDENTITY, not activity | **Not a claim this change makes.** Both defeaters are properties of the shipped force path, reachable today through blocked→force, and neither is introduced or widened here — see the window row above. Recorded so it is not mistaken for something this change closed | n/a — pre-existing; needs its own PLAN task, named in workflow.md Notes |
| Assessing is no weaker than the removal path it reports for | The assess resolves its target behind the same forced-rebuild barrier, from the same coordinator body, as the shipped `blocked` → force path | Assessing straight off the cache, so `forget` (`worktreeFingerprint.ts:44-53`) has not fired for a path already removed and recreated | D10. `coordinator.run` awaits `gate.request(force: true)` before `resolve`. Test: a deferred `forceRebuild` proves neither `resolve` nor the assessment runs before the barrier releases, and a registration replaced ACROSS the barrier is assessed as the replacement | supported |
| A registration replaced DURING the assessment's own reads cannot be told apart | — | Barrier resolves A; the async status, ignored and proof reads (`WorktreeHost.ts:3084-3110`) then read the path while A is replaced by B; `stillObserved` (`:3116`) sees no change because the deferred watcher has landed no rebuild; a token is minted over B's evidence | **Not a claim this change makes.** The shipped `blocked` → force path issues from inside the same body after the same reads and holds the identical window; round-4 B3 measured this path against that one, and parity is what it asked for. Named rather than dressed as closed — a re-resolve comparing `incarnation` was rejected in D10 because `head:branch` repeats on the recreate that motivates it (round-2 B5) | n/a — pre-existing and shared with blocked→force; needs its own PLAN task, named in workflow.md Notes |
| A late assessment cannot replace what the user is looking at | An assessed reply opens a report only while its token is the controller's live one | Two assessments of the SAME worktree answered out of order; the blocked-notice *Force remove…* dialog, which the VIEW opens directly at `WorktreeView.ts:1540-1547` | D11's echoed token — an id-only guard was drafted, refuted on both counts, and replaced. Tests: reply for A after B was asked opens nothing; reply 1 of two same-worktree requests opens nothing; a reply after the view's own opener leaves that dialog standing; a re-scoped `unavailable` result renders no Retry | supported |
| An explicit destructive request always gets an answer | The latest `worktreeRemoveAssess` a live surface has made is followed by exactly one reply carrying its token. **Amended**: a request superseded before it is served now receives no reply of its own, per the child change's D3 — the user is not waiting on it, because the same surface asked again | The `catch` posting nothing; and the coordinator's `missing` leg returning null while the rebuild that would have removed the row published nothing because presence projection rejected (`WorktreeHost.ts:2518-2543`) | D12, which answers BOTH exits through the `unavailable` arm. Tests: a rejecting assessment capability produces one `unavailable` reply; a target that vanishes across the barrier produces one too, not silence | supported |
| A burst of requests cannot back up the mutation queue behind it | At most one assessment job is in a repository's mutation queue, over all request patterns and all surface churn | Repeated or alternating menu activations, from one panel or several, each holding the per-repo queue across two forced rebuilds, git status/proof (10 s timeout) and the ignored scan (1.5 s) | Witnessed elsewhere, not unwitnessed. `coalesce-assessment-requests-at-the-host` (`asimov/changes/archive/260901-0348-coalesce-assessment-requests-at-the-host/`) owns it: one lane per repository, admission setting `outstanding` before the job is enqueued, and a synchronous re-arm in the service step's `finally` — approved at its cycle-1 round 1 with 0 findings and measured rather than asserted (dropping the lane guard puts 80 assessments in flight where 2 are allowed, and 11 ahead of a removal where 1 is) | supported — by a settled dependency, which relocates the witness and not the obligation. This row previously claimed "at most one assess is outstanding per worktree", witnessed by a controller-side duplicate drop; round-6 B5 refuted both, and that drop no longer exists |
| The panel tells the user what the host answered | — | The host posts an `unavailable` reply; `webview.postMessage` resolves `false` or rejects; both production adapters ignore the boolean and swallow the rejection (`TerminalViewProvider.ts:1659-1666`, `TerminalEditorProvider.ts:1132-1139`), so the panel shows neither the notice nor a retry | **Not a claim this change makes, and not one any requirement in this capability makes separately.** Every panel message rides the same unacknowledged transport, so a dropped-delivery reading falsifies the whole spec uniformly rather than this requirement in particular; qualifying this one sentence and no other would misdescribe where the residual lives. What bounds the cost is the child change's requirement that asking again always asks again — one click, tested at `WorktreeController.test.ts` `[W6] still opens a report after an answer that never arrived` — which is why round-6 W6 is closed rather than moved | n/a — pre-existing and shared with every message in the panel's protocol; an acknowledged transport is its own change, named in workflow.md Notes |
| Typing never unlocks a proof-gated option | The typed predicate excludes `cls === "proof"` | A proof check misclassified `confirmable` | The class is the host's and the panel reads it. The witness is **vacuous until WT-013.3** ships a proof-gated control: with none in the DOM, no test can fail. Stated rather than dressed as covered | n/a — no proof-gated control exists to gate; WT-013.3 owns the real witness |
