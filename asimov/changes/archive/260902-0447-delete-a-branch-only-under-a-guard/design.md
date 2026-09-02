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
the transaction, and its absence is a defect, not a missing optimization.** D7 defines the fresh
full-holder read; porcelain alone is only one input and is not a sufficient guard.

The residual is honest: the window between that read and the transaction is not covered. Another
process can check the branch out inside it. That window is small and unavoidable without a lock git
does not offer, and the failure mode is a dangling HEAD in a worktree the user can repair, not lost
commits — the commits are merged, which is the precondition for the control existing at all.

## D7 — The in-use check covers every Git registration, and fails closed

The oracle refuted D3's check, not D3's premise. `git branch -d` consults `branch_checked_out`,
which registers four things (`branch.c:386-460`): a worktree's symbolic HEAD, a rebase's held
branch, bisect's origin branch, and rebase/sequencer `--update-refs` branches. `git worktree list
--porcelain` reports only the first — `branch <ref>` or `detached` (`builtin/worktree.c:949-979`).
So a rebase of the target branch in another worktree leaves porcelain saying `detached`, and the
transaction deletes a branch git itself would refuse.

The check follows Git's conditions rather than treating every stale marker as a holder:

| Holder | Read |
|---|---|
| symbolic HEAD | `git worktree list --porcelain` |
| rebase | `rebase-merge/head-name`; `rebase-apply/head-name` only when `rebase-apply/applying` is absent |
| bisect | `BISECT_START` only while `BISECT_LOG` exists |
| rebase/sequencer `--update-refs` | `rebase-merge/update-refs`, parsed as repeated ref / before-OID / after-OID records, with both OIDs validated |

Git's enumeration fails OPEN: a linked worktree whose administrative `gitdir` cannot be read is
silently omitted (`worktree.c:94-194`). The host therefore reconciles porcelain against the raw
administrative directory before trusting either:

- resolve the common git directory and enumerate every non-dot entry under its `worktrees` directory;
- require one non-bare, unambiguous main record plus exactly one linked porcelain record per raw
  administrative entry;
- require every raw entry to be a directory with a readable, non-empty `gitdir` pointer;
- treat a missing `worktrees` directory as zero linked worktrees, and every other read error,
  count/name mismatch, malformed porcelain record, or bare main record as a refusal.

It then **refuses on any remaining doubt**: a non-zero exit, timeout, state file it cannot read,
or malformed/truncated update-refs triple. A normally absent optional state file means that holder
is absent; an existing file with invalid content is not absence. Silence is not evidence of absence.

Source correction from the build handback: Git v2.50.1 `branch.c#prepare_checked_out_branches`
calls `sequencer_get_update_refs_state`, whose state is `rebase-merge/update-refs`; `sequencer.c`
parses repeated three-line ref / before-OID / after-OID records. `sequencer/todo` is a different
instruction file and is not evidence for this holder. Authoritative sources:
`https://github.com/git/git/blob/v2.50.1/branch.c`,
`https://github.com/git/git/blob/v2.50.1/sequencer.c`,
`https://github.com/git/git/blob/v2.50.1/wt-status.c`,
`https://github.com/git/git/blob/v2.50.1/worktree.c`, and
`https://github.com/git/git/blob/v2.50.1/builtin/worktree.c`.

## D8 — The recorded ref is verified, not a fresh derivation of it

The transaction previously re-derived the default branch and verified THAT ref against the recorded
OID. Those are different refs when the selector moves: with the proof taken against `main@X`, a
change of `origin/HEAD` to `release` makes the transaction verify `release@X` while the recorded
`main` has moved to `Y`, and the delete proceeds on evidence that is no longer true.

So the evidence records the default branch's **ref name** as well as its OID, and the transaction
verifies that recorded name. Re-derivation still happens, but only to REFUSE — if the target now
resolves as the default branch it is not deleted — never to choose what to verify.

## D9 — The residual is a selector race, and it is stated

D5's residual named only the checkout window. There is a second: the default-branch selector is
mutable (`orphanProofs.ts:180-200` reads remote HEAD, then config, then a fallback), so another
process can repoint `origin/HEAD` at the target branch after this code re-derives it and before the
transaction runs. Nothing available closes that; the guard is fail-closed on what it can observe,
which remains weaker than a proof.

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
| Both OIDs are verified at delete time | The transaction refuses if either moved | Verifying only the branch, letting the default branch move under a stale proof | Witness driving a moved base OID and asserting the branch survives | supported after replan — D8 records the default's REF NAME with its OID and verifies that name; re-derivation now only refuses, never selects what to verify |
| A branch held elsewhere is never deleted | Re-read immediately before the transaction, covering every holder Git registers | D3: `update-ref` will delete it; or a linked administrative entry omitted by porcelain; or malformed update-refs state parsed as absence | One witness per holder and Git condition, plus malformed/truncated update-refs, raw-admin/porcelain count mismatch, unreadable gitdir, and main/bare-record refusal; removing reconciliation or OID validation kills the suite | supported after corrected replan — D7 covers all four holders and reconciles raw administrative entries before trusting absence |
| The default branch is never deleted on evidence this code can observe | Refused at proof time, and again at execution against both the recorded ref name and a fresh derivation | A selector move that the code observes and ignores | Witness at both points, plus a recorded-name-versus-re-derived-name divergence | supported — D8 |
| The selector race is disclosed, not closed | `origin/HEAD` can be repointed at the target after the fresh derivation and before the transaction | Documenting the guard as if it covered this | None possible — a negative about an external process; D9 states it and the spec claims only what is observable | supported — stated, not proven |
| A failed delete leaves the removal successful | Two outcomes, reported separately | Reporting the compound as failed, implying the worktree survives | Witness: failed delete, removal still reported removed | supported after replan — tasks 4_1 and 4_2 carry the outcome through the result message, the action result and the notice, and the acceptance is the rendered notice rather than the service return |
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

## D10 — The issued evidence has to survive redemption

Task 3_2 said the host resolves the evidence from its own report. It cannot, as the code stands:
the webview sends only `worktreeId` and `fingerprint` (`messages.ts:1296-1300`), the service computes
a FRESH assessment before redemption (`worktreeMutationService.ts:539-588`), and `redeem` answers
`"proceed" | "reprompt"` without exposing what was issued (`worktreeFingerprint.ts:61-65,95-106`).
Taking the evidence from the fresh assessment would let a report showing `branch@B1` authorize a
delete carrying `branch@B2` — the exact substitution the guard exists to prevent.

So the fingerprint store, which already RETAINS the issued evidence, returns it on redemption. The
guard's inputs then come from the same object the user was shown, and the fresh assessment is used
only to refuse, never to supply an OID.
