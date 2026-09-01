# Design: delete-a-branch-only-under-a-guard

Blueprint: docs/PLAN.md task WT-013.3. Design ref: docs/design/worktree-removal.md § 5, § 7.

The blueprint already fixes the rules. This records the mechanism, and one hazard the mechanism
introduces that the blueprint could not have known about.

## D1 — The merge proof has to carry evidence, not just a verdict

`mergeProof` in `src/worktree/orphanProofs.ts` answers a `ProofOutcome` and nothing else. § 5 rule 3
requires the delete to verify **both** the branch's OID and the default branch's OID as they were
when the proof was taken, so a verdict alone cannot support the guard: by the time the user opts in,
the thing that was proven is unidentified.

So `mergeProof` also records what it proved against — the branch OID, the default branch's name and
OID — and that evidence travels with the report. The outcome stays exactly as it is; this is an
addition, and every existing `notApplicable`/`unproven`/`failed` path keeps answering what it does
now, carrying no evidence because it proved nothing.

## D2 — One ref transaction, verified empirically

`git update-ref --stdin` expresses the whole guard atomically, and it was run before being designed
around:

```
start
verify refs/heads/<default> <baseOid>
delete refs/heads/<branch> <branchOid>
commit
```

Confirmed on git 2.50.1: with both OIDs current the branch is deleted; with a stale base OID the
transaction is refused whole and the branch survives. `verify` is what lets a ref the delete does not
touch still gate it — which is the only way rule 3's "the default branch has not moved" can be part
of the same atom as the delete.

## D3 — The transaction bypasses git's own checked-out guard, so rule 4 is load-bearing

This is the finding that changes the shape of the work, and it was found by running it:

| Command | Branch checked out in another worktree | Result |
|---|---|---|
| `git branch -d inuse` | yes | **refused** — "cannot delete branch 'inuse' used by worktree at …" |
| `update-ref --stdin` delete | yes | **deleted it anyway** |

`git branch -d` carries a safety net that `update-ref` does not. Choosing the transaction for D2's
atomicity therefore *removes* a protection, and § 5 rule 4's "re-checked immediately before the
delete, not merely at report time" stops being defence in depth and becomes the only thing standing
between an opt-in and another worktree left with a dangling HEAD.

So the re-check is not advisory and is not a nicety of ordering: **the check runs immediately before
the transaction, and its absence is a defect, not a missing optimization.** It is `git worktree list
--porcelain` read fresh — not the tree's cached model, which is what "at report time" would mean.

The residual is honest: the window between that read and the transaction is not covered. Another
process can check the branch out inside it. That window is small and unavoidable without a lock git
does not offer, and the failure mode is a dangling HEAD in a worktree the user can repair, not lost
commits — the commits are merged, which is the precondition for the control existing at all.

## D4 — Never the default branch, twice over

Rule 4's first half is already structurally true: `mergeProof` returns `notApplicable` when the
branch IS the default branch, so the control is never offered for it (`orphanProofs.ts`, the
`base === branch` arm). That is a good place for it, and it is not the only place it belongs — the
host re-derives the default branch when it builds the transaction and refuses if the target matches,
because the offer and the execution are separated by a user interaction and a removal.

## D5 — What this does not claim

Guarded and fail-closed, not provably safe (§ 5 rule 5). The delete fails rather than proceeding on
stale evidence. That is weaker than "nothing bad can happen", and the difference is D3's window.

A failed branch delete never fails the removal (§ 5 rule 6, § 7): the worktree is gone and cannot be
restored, so the compound action reports its parts separately.

## Obligation ledger

| Claim | Semantics | Defeater | Witness/check | Disposition |
|---|---|---|---|---|
| The control is offered only on a proven merge | Offered ⇔ `branchMerged === "passed"` | Offering on `unproven`, which reads as "not yet checked" rather than "not established" | Witness per `ProofOutcome` value asserting absence | supported |
| It is never on by default | Absent from the request ⇒ never deleted | An opt-out, or a default-true field | Optional wire field defaulting to absent | supported |
| The typed confirmation never unlocks it | The two controls are independent | Reusing the removal's confirmation as consent for the branch | Witness: confirmed removal without the opt-in deletes no branch | supported |
| Both OIDs are verified at delete time | The transaction refuses if either moved | Verifying only the branch, letting the default branch move under a stale proof | Witness driving a moved base OID and asserting the branch survives | **refuted** — the plan re-DERIVES the default at delete time and verifies that ref against the recorded OID. If `origin/HEAD` moves from `main` to `release` between report and execution, it verifies `release@X` while the recorded `main` moved to `Y`, and deletes. The RECORDED ref name has to be verified, not a fresh derivation |
| A branch checked out elsewhere is never deleted | Re-read immediately before the transaction | D3: `update-ref` will delete it, unlike `git branch -d` | Witness with the branch checked out in a second worktree, asserting refusal | **refuted** — `git worktree list --porcelain` emits only `branch <ref>` or `detached` (`builtin/worktree.c:949-979`), while git's own guard also registers rebase, bisect and sequencer `--update-refs` holders (`branch.c:405-450`). A rebase of `feature` elsewhere leaves a detached HEAD, porcelain names no `feature`, and the transaction deletes it. Git also silently OMITS a worktree whose administrative `gitdir`/HEAD is unreadable (`worktree.c:41-56,121-155`), so the check fails open |
| The default branch is never deleted | Refused at proof time and again at execution | The default branch changing between report and execution | Witness at both points | **refuted** — default identity comes from mutable `origin/HEAD`/config (`orphanProofs.ts:180-200`). Another process can repoint `origin/HEAD` at the target branch without moving any OID; the transaction guards OIDs only and deletes what is now the default. D5's disclosed residual covers checkout races, not selector changes |
| A failed delete leaves the removal successful | Two outcomes, reported separately | Reporting the compound as failed, implying the worktree survives | Witness: failed delete, removal still reported removed | **refuted** — separation is planned in the SERVICE, but nothing carries the outcome to the user: `toResultMessage` (`extension.ts:223-252`) serializes only `openFailed`, `messages.ts:2389-2405` has no branch outcome, and `WorktreeView.ts:1516-1537` would render just "Remove done." Every "the user is told" clause in the spec is currently undischarged |
| The delete runs only after the removal succeeds | Ordering | Deleting the branch then failing the removal, stranding the user | Call-order witness | supported |
| No window is claimed to be closed | Guarded, not safe | Documenting the guarantee as atomic end to end | D5 states it; no witness can establish a negative | supported — stated, not proven |

## Oracle attack — dispositions and what they cost

Five rows supported, four refuted, one design point unresolved. The refutations are recorded in the
ledger above with their counterexamples. Three further defects, none of them ledger rows:

- **The evidence has no retrieval path (unresolved).** Task 3_2 says the host resolves the evidence
  from its own report. It cannot today: the webview sends only `worktreeId` and `fingerprint`
  (`messages.ts:1296-1300`), the service computes a FRESH assessment before redemption
  (`worktreeMutationService.ts:539-588`), and `redeem` returns only `"proceed" | "reprompt"` without
  exposing the issued evidence (`worktreeFingerprint.ts:61-65,95-106`). So a report showing
  `branch@B1` could authorize a delete carrying freshly-assessed `branch@B2`. The missing fact is how
  the ISSUED report's evidence is recovered after redemption.
- **The payload task names the wrong file.** Task 1_2 assigns evidence passthrough to
  `removalChecks.ts`; the wire payload is assembled at `extension.ts:215-220`. Unit tests over
  constructed payloads would pass while the running extension omits the evidence and the control
  never appears.
- **The spec claims what the design disclaims.** The spec says a checked-out branch SHALL NOT be
  deleted, tested "at the moment of deletion"; D5 admits a checkout can happen between the read and
  the transaction. A call-order witness cannot establish an at-the-moment guarantee.

### The mechanism fork this exposes, which is the user's to settle

The oracle's judgment, and I agree with it: `git branch -d` plus separate OID checks is **not**
strictly safer. The two mechanisms protect different things and neither dominates.

| | in-use guard | evidence guard |
|---|---|---|
| `git update-ref` transaction | only what porcelain reports — misses rebase, bisect, sequencer, unreadable entries | exact recorded OIDs, atomic |
| `git branch -d` | git's full `branch_checked_out` model | checks against the branch's upstream or HEAD, NOT the recorded default — can delete `B2` when the user authorized `B1` |

The plan adopted the transaction and reproduced only a subset of the other guard. Deleting a branch
is destructive and irreversible from this extension's side, so which guard to prefer — or whether to
pay for both with a verify-then-`branch -d` sequence and a small unguarded window — is a safety
judgment, not a mechanism preference.
