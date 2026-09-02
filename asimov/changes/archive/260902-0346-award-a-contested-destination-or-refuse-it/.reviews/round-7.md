# Review Round 7

- Date: 2026-09-02
- Cycle: 4
- Round: 7
- Mode: discovery
- Arbiter: no
- Review profile: fastlane
- Escalation flags: new-api-contract
- Scope: range `853829fc~1..ab11eef0` — the three feature commits building design.md D3a and D3b plus the task/workflow reconciliation. The working tree carries interleaved commits from `fail-a-build-whose-bundle-cannot-resolve-itself` (`scripts/`, `src/test/invariants/`); those were NOT reviewed.
- Head: `ab11eef0` (tree clean at review start)
- Reviewable lines: 105 (`src/types/messages.ts` +10, `applyProvisioning.ts` +70/-15, `entryGate.ts` +22/-6, `providerKit.ts` +3)
- Cycle note: cycle 3 closed at WARN in round 6 with 0 blockers. Two out-of-band blockers recorded there as OOB-F015/OOB-F016 were handed back to plan, which minted D3a and D3b. This is that build. Discovery mode: full risk map, full-strength hunt, gate set frozen here.
- Finding-ID note: `F013`–`F017` continue THIS change's own sequence (F001–F012). The `OOB-F015`/`OOB-F016` labels in round-6.md belong to the sibling change `assemble-one-config-from-several-files` and are namespaced by their prefix; there is no collision.
- Agents spawned:
  - asm-review-logic — `applyProvisioning` orchestration: pre-pass, `refusedItself`, ordering, `membersOf`, every favoured-undefined path — opus[1M]
  - asm-review-contracts — `EntryVerdict.observedDestination`, `ProvisionContenders.priorityClaimedTwice`, wire seam — gpt-5.6-terra[1M]
  - asm-review-frontend — offer-side pre-apply statements, production order, result rendering — sonnet[1M]
  - asm-review-logic (test lens) — arming of the new witnesses, gate coverage — gpt-5.6-luna[1M]
- Agents skipped: data-security (no auth/secret/input surface in the diff), performance (representation is unchanged and linear; round-5 settled it), reuse (the diff removes duplication via `membersOf` rather than adding any)
- Recorded verification: `bun run asm change verify-status award-a-contested-destination-or-refuse-it` exit 0. Tasks 9_1/9_2/9_3 each record `pnpm run check-types && pnpm run test:unit` exit 0, with RED-before evidence for the two behavioral witnesses in 9_2 and 9_3. Per review policy this review did not rerun project verification commands.
- Verdict: BLOCK
- Counts: BLOCK 1 | WARN 3 | SUGGEST 2
- Split over gating blockers: 1 feature / 0 machinery

## Findings

### F007 (reopened)

- ID: F007
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-frontend, asm-review-contracts, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:351` (`yieldsTo`), `:397` (`bringRows`), `:473` (`bringSummary`)
- title: D3b makes the apply refuse a two-native group entire while the offer still ticks every member and counts them as arriving
- evidence: `yieldsTo()` produces a loser only for a group with `group.favoured !== undefined` (`const id = group.favoured; if (id === undefined …) continue;`). A `priorityClaimedTwice` group carries no `favoured`, so `yieldsTo` returns nothing for any member. `bringRows()` then sets `checked: loses === undefined` → `true` for every member and attaches no `yields` note, and `bringSummary()`'s `favoured === undefined || !selected.has(favoured.id)` is vacuously true, so every member is counted into "N copied" / "N linked". Meanwhile `applyProvisioning.ts:236-246` refuses the whole group via `refuseContest` before any reading — witnessed by the new test `[OOB-F015] … writes nothing, and does not hand the destination to the inherited row`, which asserts `fs.created` is empty. The offer path is the same producer: `readProvisioning.ts:264` calls `contendersOf(kept, NATIVE_PROVIDER_FILE)`, so the state is reachable from any repository whose own config file spells one destination two folding ways. `grep -rn priorityClaimedTwice src/` returns three hits — `messages.ts`, `providerKit.ts`, `applyProvisioning.ts` — and none under `src/webview/`.
- impact: The dialog states "N copied · N spellings may be one file" with every row ticked and no refusal note, the user submits, and every one of those rows comes back `refused`. This is F007's own invariant — "every pre-apply statement about a contender reflects what the submitted selection can actually receive" — broken through F007's own mechanism: the dialog's arriving-set predicate is not the apply's refusal rule. Round-5 F007's boundary inventory listed "groups without a favoured member" as VERIFIED SAFE; that verification was sound then, because such groups were applied. D3b invalidated it without moving the offer.
- suggestedFix: Not a fix commit — an artifact handback, like OOB-F015 itself. The applied spec's scenario `Nothing is favoured` says "both stay selected, because nothing decides between them and unselecting either would pick a winner the apply does not", which is exactly the state D3b splits in two. Deciding how a two-native group is offered (unticked with a "two repository declarations name this destination" note, as `offer-a-yielding-declaration-as-yielding` established for a yielder; or withheld) modifies that accepted scenario and needs the requirement written. The mechanical shape is already established by the archived child, so the build is small once the requirement exists. Note F015 below: the flag does not currently survive `remint`, so the offer cannot see this state even if the dialog were taught to.
- status: accepted
- triage: Reopened under its original ID per the invariant-finding rule — same invariant, same causal mechanism, a boundary the prior round recorded as verified safe and this change invalidated. Severity held at BLOCK with no evidence delta: identical class of false pre-apply promise, and strictly broader in extent (every member of the group, with no note at all, rather than one reselected row).
- invariant: Every pre-apply statement about a contender reflects what the submitted selection can actually receive.
- boundary inventory:
  - affected: a contender group with more than one native member — default tick state, refusal note, live summary counts, submitted ids, apply refusal
  - verified safe: favoured/held pair (fixed round 6); yielder ticked back on (fixed round 6); a group where NOTHING claims priority — still applied unchanged, witnessed by `[OOB-F015] still applies a group where nothing at all claims priority`; result-side rendering, which resolves membership by index and is order-insensitive (`WorktreeView.ts:1837-1855`)

### F013

- ID: F013
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/asimov/changes/award-a-contested-destination-or-refuse-it/specs/worktree-panel/spec.md:66`
- title: The spec delta does not carry D3b, and its MODIFIED requirement asserts the opposite of what ships
- evidence: The MODIFIED requirement reads "Copying SHALL happen before linking, EXCEPT that where declarations may name one destination, the repository's own is materialized first and the others are refused." For a group with two native members nothing is materialized at all — `refuseContest` answers every member including both native ones. The ADDED requirement is scoped "WHERE two selected declarations may name one destination and one of them is the repository's own", which a two-native group satisfies while its SHALL ("materialize the repository's own declaration before the other") is unsatisfiable. No ADDED scenario covers the two-native case; task 9_3's Refs name only `design.md D3b`.
- impact: `bun run asm change apply` writes this delta into `asimov/specs/worktree-panel/spec.md` at archive, leaving the applied spec asserting a behavior the shipped code deliberately does not have. Every later change reads that spec as the contract. D3b is an accepted design decision, so this is an obligation-sync gap rather than a divergence from intent — which is why it is WARN and not BLOCK.
- suggestedFix: In the same handback that settles F007, add the requirement D3b earns — a group in which more than one declaration is the repository's own is refused entire, naming every member — and qualify the MODIFIED requirement's EXCEPT clause so it speaks only of a group with exactly one repository declaration.
- status: accepted
- triage: New. Discovered by the chair's intent-reconstruction pass comparing the shipped behavior against the change's own accepted spec delta rather than against design.md alone.

### F014

- ID: F014
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: asm-review-logic, chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:248`
- title: A member refused for what it IS loses its own rule whenever any sibling reads non-`absent`
- evidence: The pre-pass evaluates `contended(await Promise.all(members.map(read)))` and calls `refuseContest` before the `refusedItself` answering loop at `:263-268`, then `continue`s past it. `refuseContest` sets `answered` for every member not already answered, so a member whose `read()` returned `"refused"` — its `admitEntry` reason already sitting in `refusedItself` — is reported as "may name this same destination, and it could not be shown to be free before the apply began". No reading of that member's destination ever happened: it was refused lexically for its name or its mode. The new witness `still refuses the whole contest when the refusal DID observe the destination` asserts only `outcome.kind`, never the reason, so nothing pins this.
- impact: The user is told a destination could not be shown free when the actual refusal was, for example, "node_modules is never linked". That is the precise class D4b exists to prevent and the ledger row "A refusal reports the rule that fired — a contested member refused for its own reason keeps that reason" asserts. The new code installs the guarantee only on the uncontended branch. No write decision changes, so P2 is untouched.
- suggestedFix: Hoist the `refusedItself` answering loop above the `contended` branch — compute the readings once, answer the refused-for-itself members, then branch. `refuseContest` already skips answered members, so the group is still refused entire, every member still carries the contest index, and only the reason each member reports changes. Add the missing reason assertion to the containment witness.
- status: accepted
- triage: New. Corroborated independently by the chair's full-flow trace and the tier-1 logic specialist; both reached it from the same code, not from each other.

### F015

- ID: F015
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: asm-review-logic, chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/offerStore.ts:106`
- title: `remint` rebuilds each contender group without `priorityClaimedTwice`, so the new wire field never crosses the wire
- evidence: `remint` reconstructs every group as `{ members: […], ...(favoured === undefined ? {} : { favoured }) }`. The spread names exactly two fields; `priorityClaimedTwice` is silently dropped. Every offer the webview receives passes through `remint` (`offerStore.ts:140`). `offerStore.test.ts` asserts only `members` and `favoured` translation, so nothing catches it. Apply-time correctness is unaffected, because D1 has `applyProvisioning` recompute `contendersOf(entries, NATIVE_PROVIDER_FILE)` from the submitted entries and read the flag off that fresh result — which is why the two new tests pass.
- impact: A field was added to a wire contract (`ProvisionContenders`, `src/types/messages.ts:947`) and documented as the thing "the apply side has to tell apart", but no consumer on the far side of the wire can ever observe it. It is dead on the wire today and blocks F007's remediation tomorrow: teaching the dialog to read the flag would read `undefined`.
- suggestedFix: Carry it through — `...(group.priorityClaimedTwice === true ? { priorityClaimedTwice: true as const } : {})` — and extend the existing `remint` translation test to assert it survives, in the same commit that teaches the dialog to use it.
- status: accepted
- triage: New. Found by the tier-1 logic specialist tracing the offer path, confirmed by the chair against `offerStore.ts` and `offerStore.test.ts`.

### F016

- ID: F016
- severity: SUGGEST
- confidence: MEDIUM
- priority: P4
- agent: asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/types/messages.ts:927`
- title: `ProvisionContenders` permits `favoured` and `priorityClaimedTwice` together, though they are mutually exclusive
- evidence: Both fields are optional and independent, so `{ members, favoured: "i1", priorityClaimedTwice: true }` type-checks. `contendersOf` cannot produce it (`native.length === 1` vs `> 1`), and no postMessage validator refines the shape, but `contestsOf` resolves the contradiction silently — `favoured === undefined && group.priorityClaimedTwice !== true` lets `favoured` win and ignores the flag without saying so.
- impact: The stated invariant lives only in prose and in one producer. No concrete defect today; a second producer or a hand-built test fixture could express the contradictory state without a type error.
- suggestedFix: Model the three legal states as a discriminated union — exactly one repository declaration, priority claimed twice, or neither — so the exclusion is checked rather than documented.
- status: accepted
- triage: New. No concrete defect and one producer, so SUGGEST rather than WARN; recorded because the change carries the `new-api-contract` flag and this is the contract it added.

### F017

- ID: F017
- severity: SUGGEST
- confidence: MEDIUM
- priority: P4
- agent: asm-review-logic (test lens), chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.test.ts:541`
- title: No witness for the FAVOURED member refused by its own lexical rule, nor for a contest whose every member is
- evidence: The two new D3a witnesses both refuse the INHERITED member. `applyProvisioning.test.ts:322-348` covers a favoured member refused by `applyEntry`'s own rule (a special file type) in the ordered pass, not by `admitEntry` in the new pre-pass. The pre-pass branch `if (!answered.has(contest.favoured)) { live.set(…) }` and the tail loop's "never claimed" reason for that state have no direct witness; nor does the all-members-refused state, where `held` and `live` both end empty.
- impact: D4 row 3 reached through the new pre-pass path is unwitnessed. The chair's static trace confirms both states behave correctly today and neither can write, so this is coverage rather than a defect. Phase 2.5 caps missing-test findings below BLOCK.
- suggestedFix: One case where the NATIVE entry is `node_modules` in link mode beside an inherited copy: assert the native row keeps "node_modules is never linked", the inherited row says "never claimed", nothing is created, and both resolve one membership through their contest index.
- status: accepted
- triage: New. The test specialist also called `[OOB-F015] still applies a group where nothing at all claims priority` unarmed against the priority-twice branch; the chair rejects that half. That case is a guard against D3b over-widening to every favoured-less group, and it goes red if the branch is widened — which is the regression it is for. Its build record says exactly this, and the two `[OOB-F015]` refusal cases carry the positive arming (both recorded RED before the fix).

## Prior finding dispositions

### F001 — F006
- status: fixed
- triage: Remain fixed. The exclusive-claim path, the four-state reading, the production order, the whole-membership refusal, the held-member settlement, and the rule-that-fired discipline are all untouched by this range except where F014 records the new pre-pass ordering.

### F007
- status: accepted (reopened) — see Findings above.

### F008 — F011
- status: fixed
- triage: Remain fixed. `wireContests` and `indexByMember` now compose through `membersOf`, which preserves one membership per contest and an index on every member, including the `failEveryEntry` path — `contestsOf` admits a `priorityClaimedTwice` group, so the unreadable-root builder indexes its members too (round-5 F011's requirement holds on the new path).

### F012
- status: fixed
- triage: Closed in commit `ffde4a64`'s follow-up per task 8_1, whose build record documents the arm check: reverting only the `src/extension.ts` staging lines makes the new assembly case fail. Outside this range; not re-reviewed.

## Verification trace

- D3a, every `admitEntry` exit: absolute spelling and backslash are string tests; `refusedMaterial` reads `path.basename` of the lexically resolved destination through `refusedLockfile`/`filesystemIdentity`/`foldWin32Name`, all pure — `false` is correct for all three. Both containment exits are marked `true`, and `isResolvedPathInsideRoot` (`src/utils/resolvedPathBoundary.ts:100-135`) always attempts `realpath` before it can return false and has no lexical short-circuit, so the destination WAS observed on every path that reaches them — including a source-side refusal, because the two predicates run in one `Promise.all`. The author's stated concern is answered: no refusal that touched the filesystem is marked `false`.
- P2 under the narrowing: the only path written is the favoured member's own destination, `lstat`'d in the pre-pass and again immediately before its turn, then created through `applyExclusiveEntry` where `EEXIST` is `CLAIM_LOST`. A member skipped by `contended` could only add information if two spellings were one object AND the favoured spelling's own `lstat` missed it, which a folded name cannot do. Held members are written on no row of D4. The narrowing does not open a P2 hole.
- D3b admission test: `contendersOf` emits only groups of two or more; `priorityClaimedTwice` requires `native.length > 1`; with `favoured` undefined the `id !== favoured?.id` filter removes nothing, so `held` is the whole group and `held.length > 1` always holds for exactly the groups intended. `byId` is built from the same array `contendersOf` partitioned, so no member is dropped. The two producer branches are mutually exclusive at the source.
- Ordering: `answered` insertion order is pre-pass group and member refusals (contests order, favoured first), then the ordered pass in `copiesFirst` order, then the held tail, then the never-applied sweep. Deterministic, no key overwritten. The webview's `provisionKey` (`WorktreeView.ts:1799`) is `JSON.stringify([steps, contests])` — order-sensitive by design, and the content genuinely changed, so a redraw is correct. `provisionSummary` renders each row as `path: reason [contest N]` and resolves membership by index, never by position. The reorder is real, visible only as row order in the notice, and coherent. D5 is satisfied.
- Two-native group to the reader: `contestsOf` admits it → `refuseContest` answers every member with `step(member, why, contest)` → `indexOf.get(contest)` → `wireContests(contests)` carries `membersOf` once → `extension.ts` stages it under the `worktreePath` key → `takeContests` forwards it → `withContest`/`contestLines` render `[contest N]` per row and one membership line naming every path and declaring file. D4a holds on this path, witnessed by `[OOB-F015] names every member of the group, by path and declaring file`.
- Tests: no `.only`/`.skip`, no missing `await`. `toMatchObject` fails on `undefined` in this Vitest version, so the `steps.find(...)` assertion in the D3a reason witness is non-vacuous. The `fs.created` empty assertion is the load-bearing no-write witness; `nodes.has` alone checks only an exact raw key.

## Adjudication notes

- Four independent lenses plus the chair reached the offer/apply divergence from different entry points (dialog code, wire contract, orchestration trace, spec text). It is reopened as F007 rather than minted new, because the mechanism and invariant are identical to the finding round 6 closed.
- The chair refuted one specialist WARN (see F017's triage) and downgraded the contracts specialist's union WARN to SUGGEST, because a single producer constructs the type and no consumer misreads it today.
- The frontend specialist's fixture-coverage SUGGEST is folded into F007's remediation rather than listed separately; there is no contender fixture at all in `worktreeFixtures.ts`, which is why F007 was invisible to the webview suite.
- The author's own three highest-risk questions are all answered clean: `observedDestination` is correct at every return, no site assumes `Contest.favoured` is present, and the admission test is total. The defects are on the other side of the seam.
- No agent message was treated as user consent, approval, or risk acceptance.

## Audit backlog

None. This is a discovery round; every finding is in scope and gating status is by severity.

## Recommendation

The apply half of D3b is correct and well witnessed; its offer half does not exist, and the field meant to carry it does not survive `remint`. F007 and F013 are one handback: a requirement saying how a group with more than one repository declaration is OFFERED, alongside the one saying how it is applied. F014 and F015 are ordinary fix-commit work and can land in the same cycle once that requirement exists.

## Author triage — round 7

| Finding | Disposition | Reason |
|---|---|---|
| F007 | **accepted — handback** | Correct, and the mechanism is mine. D3b answered how a two-native group is APPLIED and left how it is OFFERED where it was, so the dialog now ticks and counts rows the apply refuses entire. That is a false pre-apply promise, which is exactly the invariant F007 names, and reopening it under the same ID is right. It cannot be a fix commit: the applied spec's `Nothing is favoured` scenario says both members stay selected "because nothing decides between them and unselecting either would pick a winner the apply does not" — D3b splits that state in two and the half it created has no requirement. |
| F013 | **accepted — same handback** | The MODIFIED requirement's EXCEPT clause asserts the repository's own is materialized first; for two natives nothing is. `asm change apply` would write that into the applied spec at archive. The requirement F007 needs is the same requirement that repairs this, so they are one unit of work. |
| F014 | **accepted — task in the replan** | Mine, and the chair's reading of the ordering is right: the `refusedItself` loop sits after the `contended` check and its `continue`, so a member refused for what it IS loses its own rule whenever any sibling reads non-`absent`. That is the class D4b exists to prevent and my own ledger row claims the opposite. The reorder changes no write decision — `refuseContest` already skips answered members — and it needs a witness that asserts the reason, not only the outcome kind, which my containment witness does not. |
| F015 | **accepted — task in the replan** | `remint` rebuilds each group from `members`/`favoured` only, so `priorityClaimedTwice` never crosses the wire. Apply-time correctness is unaffected because D1 recomputes `contendersOf` from the submitted entries — which is why every test passes and why I did not see it. It blocks F007's remediation directly: a dialog taught to read the flag would read `undefined`. |
| F016 | **accepted — task in the replan** | No concrete defect today and I agree with SUGGEST, but the change carries `new-api-contract` and this is the contract it added. A discriminated union over the three legal states checks the exclusion instead of documenting it, and F007's remediation adds the second consumer that makes the contradictory state reachable. |
| F017 | **accepted — task in the replan** | Both D3a witnesses refuse the inherited member, so D4 row 3 reached through the NEW pre-pass is unwitnessed. The chair is right that one fixture covers both gaps. I accept the rejection of the other half: `[OOB-F015] still applies a group where nothing at all claims priority` is a guard against D3b over-widening to every favoured-less group, not an arming witness for the new branch, and my build record says so. |

**Disposition of the round.** Cycle 4, and the cycle cap makes option 1 mandatory — no fourth fix loop on this invariant. That is also what F007 independently requires: a fix needing a new spec requirement is not remediation. The lease is parked and the change goes back to `asimov-plan` to earn the offer-side requirement; F014, F015, F016 and F017 become tasks in that replan rather than fix commits in a cycle that is closing.

**Premise audit.** Not triggered — the round's blocking split is 1 feature / 0 machinery, so this is not a machinery-majority round. The shipped baseline is unchanged and every mechanism in the range answers an evidenced state.
