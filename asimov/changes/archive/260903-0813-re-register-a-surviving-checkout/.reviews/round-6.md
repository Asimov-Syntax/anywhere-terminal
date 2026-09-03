# Review Round 6

- Date: 2026-09-03
- Cycle: 2
- Mode: verification
- Review lane: fastlane
- Scope: range `5bdac775546072460ec756aeee3e1376a5bba31f..4f986c80d772138299d93d6b49ef0c22f4dec4bf`
- Head: `4f986c80d772138299d93d6b49ef0c22f4dec4bf` (tree dirty only because the already-open round updated `asimov/changes/re-register-a-surviving-checkout/analytics.json`)
- Reviewable lines: 40
- Large change: no
- Scope lock: passed — D4/D9 and task 6_1 are remediation under the existing `adoptWorktree` invariant owner; the range adds no capability or new invariant owner.
- Recorded Verify Gate: `bun run asm change verify-status re-register-a-surviving-checkout` reports task `6_1` complete with exit 0. The author records `check-types`, 7218 tests across 287 files, and biome clean on every touched file. Review ran no project verify command.
- Verification impact cone: opening and claim-time link authority; all three `putLink` callers; partial/failed claim recovery; post-claim and caller-deferred undo; visible-link/entry coupling; the pruned-checkout same-name case; residue rendering; success-path descriptor release.
- Targeted scratch probes: none. Findings are established by direct state-machine traces over the injected filesystem seams and corroborated specialist review.
- Agents spawned:
  - `asm-review-data-security` — filesystem authority, link/entry coupling, and descriptor alias boundary — `gpt-5.6-sol[1M]`
  - `asm-review-logic` — undo state machine and caller-visible residue — `gpt-5.6-terra[1M]`
  - `asm-review-logic` — guard/witness causality — `sonnet[1M]`
- Agents skipped:
  - `asm-review-contracts` — no route/schema/public API delta; accepted D4/D9 obligations were checked by the chair
  - `asm-review-frontend` — no frontend behavior in the remediation cone
  - `asm-review-performance` — no collection, recompute, or growth axis
  - `asm-review-reuse` — no new helper, parser, split, or duplicated repository capability
- Verdict: BLOCK
- Counts: 2 BLOCK, 1 WARN, 0 SUGGEST

## Findings

### F001
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:1122`
- Title: Adopt submission is not bound to the host-issued resolution
- Evidence: The host-issued resolution binding remains intact and this remediation does not intersect it.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2 and unchanged in round 6.

### F002
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptProbe.ts:73`
- Title: The surviving checkout is never bound to the current repository
- Evidence: The normalized common-directory binding remains intact and reaches reconstruction unchanged.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2 and outside this remediation cone.

### F003
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:248`
- Title: Filesystem read failures are still converted into proof of absence
- Evidence: Opening descriptor failures and positioned-read failures still refuse before entry creation.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2; its corrected witness remains causal.

### F004
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:494`
- Title: Identity failure after mkdir leaks an unreported administrative entry
- Evidence: The created path remains present in the failure result consumed by the caller.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2 and unchanged.

### F005
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:389`
- Title: The visible-link dependency proof still expires before entry deletion
- Evidence: The new `state !== "restored"` branch reads `<wt>/.git` at lines 389-391, then awaits entry identity at line 414 and recursive removal at line 421 without revalidating or atomically coupling the pathname condition. A different-inode replacement can land after the read and make the visible link name `entryPath`; the unchanged entry identity then passes and cleanup deletes its target. The restored branch is wider: it skips the visible-path check entirely, so a replacement after the post-restore sample at line 368 and before removal produces the same dangling link while returning cleanly. Two specialists independently traced these schedules, and the chair reached the same result from the full state machine.
- Impact: Withdrawal can still leave `<wt>/.git` naming a deleted administrative directory. In `leftAsFound`/`unknown` it can report `entryPath: null`; in `restored` it can return no residue at all. This falsifies D4/task 6_1's stated invariant and the round-5 blocker remains open.
- SuggestedFix: Hand this invariant back to planning rather than add another sample. With the available Node primitives, a pathname read cannot stay authoritative across asynchronous entry deletion. State a realizable rule including the deliberately restored stale-link exception and the post-sample external-writer residual; conservatively retain/report the entry on observable non-restored outcomes unless deletion can be coupled to the visible-link condition. Add a witness that replaces `.git` with `gitdir: <entryPath>` after the visible read/post-restore sample but before entry removal.
- Status: accepted
- Triage: Persists from round 5. The exact round-5 replacement-before-the-new-read witness is fixed, but the same invariant and check-then-delete mechanism fail at the next mutation boundary. Its inventory has expanded in five consecutive remediation rounds; patch-level fixing has failed and planning must settle the actual achievable contract.
- Invariant: Cleanup must not delete an administrative directory while the visible coupled link depends on it, and must not report a clean withdrawal when that dependency is unresolved.
- Boundary inventory: searched pre-restore link ownership, restore write, post-restore identity, visible pathname parse, entry identity, removal, malformed/unreadable/absent link, restored/leftAsFound/unknown outcomes, and caller residue rendering. Affected: replacement after the visible pathname read and before entry removal; restored-branch replacement after the final identity sample and before removal. Verified safe: the exact round-5 branch where the replacement already names the entry when the new pathname read occurs; unrelated visible targets observed by a stable read; unreadable visible link conservatively retains the entry.

### F006
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:450`
- Title: The final stale-link proof precedes another filesystem await
- Evidence: The claim remains descriptor-bound and the opening stale-byte witness added in this range is causal: removing the comparison reaches entry construction and breaks its zero-write assertions.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 4; the post-round-5 self-audit closes its missing opening-byte witness.

### F007
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/reattachProbe.ts:142`
- Title: A malformed gitfile is accepted as adoption authority
- Evidence: The strict shared `gitdir:` grammar is unchanged.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2 and outside the cone.

### F008
- Severity: WARN
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-frontend`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:2024`
- Title: A late refs reply desynchronizes adopt from its form controls
- Evidence: The resolved-mode guard is unchanged.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2 and outside the cone.

### F009
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-contracts`, `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:486`
- Title: The branch-tip guard runs after index reconstruction
- Evidence: Repair is still followed by the worktree-local tip read and only then `reset --mixed`.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2 and preserved.

### F010
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-reuse`, `asm-review-contracts`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/worktreeMutationService.ts:889`
- Title: Adoption bypasses the repository's capability-aware common-dir resolver
- Evidence: Corroboration and reconstruction still share the normalized `repoId` common directory.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2 and outside the cone.

### F011
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:536`
- Title: Non-collision entry failures are reported as name exhaustion
- Evidence: Only `EEXIST` advances the candidate name; other failures retain their reason.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 2 and unchanged.

### F012
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:456`
- Title: A rejected final write can mutate the link without becoming owned
- Evidence: Partial/failed claim writes still enter descriptor-bound recovery and report `unknown` when recovery does not land.
- Impact: No open impact under F012; F015 separately covers a refusal before any write begins.
- SuggestedFix: None under F012.
- Status: fixed
- Triage: Fixed in round 4 and not reopened by the alias check.

### F013
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:292`
- Title: Later descriptor restores bypass the link-count boundary
- Evidence: `oneName()` now executes inside `putLink()` before truncation. The claim, failed-claim recovery, and deferred undo restore all call that operation, so an alias visible at any call boundary prevents that descriptor mutation. Unit and real-filesystem late-alias witnesses causally cover the undo restore; F016 records the missing dedicated recovery witness.
- Impact: The cross-path descriptor-write defect is closed. F015 is a separate cleanup-state defect caused by collapsing pre-mutation refusal and post-mutation failure into one boolean result.
- SuggestedFix: None under F013; see F015 and F016.
- Status: fixed
- Triage: Fixed in round 6 at the invariant owner: all three writes inherit the descriptor-sourced link-count refusal.
- Invariant: Mutation authority over one pathname does not authorize mutating another pathname that aliases the same inode.
- Boundary inventory: searched opening count, claim, failed-claim recovery, post-claim/deferred undo restore, truncate, short/zero/full writes, and real hard-link behavior. Verified safe in production: each logical write invokes `oneName()` before truncate. Test-proven: open, claim, and deferred undo. Test gap: failed-claim recovery, tracked as F016.

### F014
- Severity: WARN
- Confidence: HIGH
- Priority: P1
- Agent: `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.test.ts:899`
- Title: The unreadable-opening witness now fails at the stale-entry reader instead
- Evidence: The corrected handle-level witness still refuses before writes or git calls.
- Impact: No open impact.
- SuggestedFix: None.
- Status: fixed
- Triage: Fixed in round 5 and unchanged.

### F015
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:490`
- Title: A pre-truncate alias refusal is treated as unknown mutation
- Evidence: `putLink()` returns the same `false` when `oneName()` refuses at line 292 before `truncate()` and when truncate/write has already altered content. If an alias appears after entry construction but before the initial claim, the claim call and the attempted stale-byte recovery both return `false` without writing, yet line 495 sets `contentUnknown = true`. In the pruned-checkout case, `staleLink` already names the same path `createEntry` claimed, so undo enters `unknown`, the visible-link check retains that completed entry, and the failed adoption leaves a live registration even though the link bytes never changed and ordinary withdrawal was possible. The existing pre-claim alias test uses a different stale target and does not expose this branch.
- Impact: A claim refused before its first mutation can leave the repository registered while reporting a failed adoption with unknown link state. This violates the failure/withdrawal contract and the stated impact manifest, which reserves `contentUnknown` for a rejected write that had already truncated.
- SuggestedFix: Make the descriptor-write result distinguish `notWritten` from `contentUnknown` and success. A pre-truncate link-count refusal must preserve the known restored state and withdraw the newly created entry, including when the stale link path equals the claimed entry path. Add a same-name pruned-checkout witness where the alias appears immediately before the initial claim.
- Status: accepted
- Triage: New in round 6. This is not F013's cross-path-write mechanism; that write is correctly refused. The independently actionable defect is the state machine collapsing a safe pre-mutation refusal into the post-mutation recovery state.

### F016
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-logic`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.test.ts:1210`
- Title: Failed-claim recovery still has no late-alias witness
- Evidence: Both new late-alias tests create the alias after a successful claim and force repair failure, so they reach only undo's restore call. Neither makes the initial claim begin/fail and then introduces an alias before `putLink(request.staleLink)` at line 495. Existing open/claim alias tests precede the claim rather than covering this recovery boundary.
- Impact: The shared `putLink` owner makes a production miss unlikely, but round-5 F013's affected-boundary inventory and task 6_1 explicitly require a causal witness for failed-claim recovery; that arm remains unproven.
- SuggestedFix: Add a unit witness whose initial `putLink(ourLink)` truncates or partially writes and fails, introduces the hard link before recovery, and asserts the recovery leaves every alias's bytes untouched and reports residue.
- Status: accepted
- Triage: New non-gating support finding in round 6. The two self-audit witness repairs are causal; this is the remaining uncovered F013 boundary.

## Adjudication notes

- F005 is sustained with agreement from both filesystem/state-machine specialists and the chair. The new test proves the exact round-5 pre-read branch, but the read remains a snapshot followed by two asynchronous mutation boundaries. The restored exception also contradicts D4/task 6_1's absolute wording; the workflow note describes an intended stale-state exception that the accepted invariant does not encode. Because F005's inventory has expanded every round, another local guard is not an acceptable closure strategy.
- F015 is sustained from direct control-flow evidence. The moved `nlink` check correctly prevents the write, but `putLink`'s boolean cannot tell the caller that no mutation began. The same-name pruned checkout turns that reporting distinction into a retained live registration.
- F013's production invariant is fixed: every descriptor mutation enters the same `oneName()` check. F016 is a test-evidence gap, not grounds to keep the production blocker open.
- The two self-audit witness repairs in `4f986c80` are causal. Removing the opening stale-byte comparison reaches `createEntry` and breaks the zero-write/zero-command assertions; removing the entry identity re-check now reaches a successful adoption because link identity is no longer substituted.
- `residueNote` still renders all three `AdoptLinkState` values and nullable `entryPath`; the reached caller paths use one of `undo()` or `release()`. No caller-consumer defect was found.
- No audit-backlog or accepted-risk entry exists.

## Author triage record (round 6)

All three accepted. No rebuttal: the chair's F005 trace is the same schedule I would have had to
construct to defend the code, and F015 I confirmed by reading `putLink`'s two exits rather than by
argument — `oneName()` refusing at the top and a half-finished write both return the bare `false`
the caller then reads as `contentUnknown`.

**F005 — accepted, sixth appearance, and I am not writing a sixth guard.** Rounds 2-6 have each
closed one mutation boundary and the next round has found the next one. That is not five unlucky
misses; it is the signature of a rule that cannot be realized with the primitives available. The
undo proves a fact about a PATHNAME and then, asynchronously, deletes a DIRECTORY. Nothing in Node
couples those two — the same wall WT-012.19 hit when it looked for `renameat`/`linkat` and found
them `undefined`, and the same wall cmux hits in Swift and answers by validating the descriptor and
accepting the residual rather than by claiming exclusion. D4's undo is the last claim in this change
still written as an absolute; D5 and D9 both already state a residual, and D4 has to join them.

**The redesign is a deletion, not another check.** The visible-link read is the thing that has been
generating findings, and it exists only to rescue the `leftAsFound`/`unknown` outcomes. Drop it: the
undo removes the entry ONLY on `restored`, and every non-restored outcome retains the entry and
reports it. There is then no pathname sample left to expire on those paths, so F005's non-restored
arm is closed by construction rather than by a fresh guard. On `restored` the link demonstrably no
longer names the entry — except the pruned same-name case, which is a deliberate exception and must
be written into D4 rather than left in a comment — and the residual that survives is an external
writer replacing the link between the final identity sample and the removal. That one is stated, not
closed, and it is exactly the exposure `git worktree repair` itself carries.

**F015 — accepted, and it is the third site the round-4 handback named and I then under-built.**
`putLink`'s boolean cannot say "nothing happened", so a refusal that mutated nothing is reported as
content nobody can vouch for, and in the pruned same-name case that turns a clean withdrawal into a
retained live registration. Three outcomes, not two: wrote / notWritten / unknown. A `notWritten`
claim leaves the link exactly as found and withdraws the entry by the ordinary path.

**F016 — accepted, non-gating.** The witness lands with the redesign rather than before it, because
`putLink`'s return shape is what the test would assert against and that shape is changing.

Both blocking findings change accepted text — D4's undo obligation, D9's write contract, and the
spec requirement wording for what an incomplete adoption owes. That is the remediation boundary, so
this closes cycle 2 as a handback under thrash-stop option 1, which the chair also independently
recommends. It is not a user risk-acceptance and not a further review round.
