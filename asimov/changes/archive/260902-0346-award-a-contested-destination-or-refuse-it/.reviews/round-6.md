# Review Round 6

- Date: 2026-09-02
- Cycle: 3
- Round: 6
- Mode: verification
- Arbiter: no
- Review profile: fastlane
- Scope: commit `ffde4a64b2c66e638b76e33b5fb4dc156db5e789` only; verification of round-5 F007, F008, and F011
- Head: `ffde4a64b2c66e638b76e33b5fb4dc156db5e789` (the reviewed commit; the checkout has since advanced to `228122542f1bcb10c7950e0b9a59a42b80c681bd` and contains unrelated analytics changes outside this explicit scope)
- Reviewable lines: 88
- Scope lock: clear. The commit contains only the three accepted remediations, their focused tests, and the parent contract/task reconciliation; it adds no capability, changed invariant owner, or design delta.
- Agents spawned:
  - asm-review-contracts — normalized contest contract and unreadable-root handoff — gpt-5.6-sol[1M]
  - asm-review-logic — unreadable-root builder, indexing, staging, and cleanup — gpt-5.6-terra[1M]
  - asm-review-frontend — yielding-row count/note/submission and reader-visible contest association — sonnet[1M]
- Agents skipped: data-security, performance, reuse — outside this narrow verification cone; the normalized representation and shared builders were checked by contracts, logic, and chair.
- Recorded verification: `bun run asm change verify-status award-a-contested-destination-or-refuse-it` exit 0; author-recorded check-types clean, Biome at the 3 errors / 14 warnings / 1 info baseline, 6707 unit tests across 280 files, and fs-deletion gate ok. Per review policy, this review did not rerun project verification commands.
- Verdict: WARN
- Counts: BLOCK 0 | WARN 1 | SUGGEST 0

## Findings

### F012

- ID: F012
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/extension.worktreeAssembly.test.ts:1449`
- title: F011's new tests do not arm the assembly bypass that caused F011
- evidence: The three added F011 tests call `failEveryEntry` directly. Reverting only `src/extension.ts:590-594` to round 5's inline plain failed-step return would leave all of them green, even though the shipped unreadable-root path would again omit every contest index and membership. The recorded reason for omitting an assembly witness is not borne out by the existing harness: this test already explains at lines 1486-1493 that its fake git does not materialize the destination and explicitly creates that directory only to keep `prepareEntryGate` from failing. Omitting that `mkdirSync` is therefore an existing way to make `prepareEntryGate` answer `null`; adding two contesting provider declarations and submitting both can exercise the exact branch end to end.
- impact: The implementation in `ffde4a64` is correct, so F011 itself closes, but the suite can no longer prove that the extension continues to call the builder and stage its contests. The same assembly regression that round 5 found can return without breaking the new witness.
- suggestedFix: Add one focused case to `src/extension.worktreeAssembly.test.ts` that declares a favoured/held contest, submits both entries, deliberately leaves the fake-git destination unmaterialized so `prepareEntryGate` returns `null`, and asserts the resulting notice associates both failed rows with one membership naming both paths and declaring files.
- status: accepted
- triage: New non-gating support finding inside F011's remediation cone. Phase 2.5 limits missing-test findings to WARN. It does not reopen F011 because static review confirms the shipped branch currently calls `failEveryEntry`, stages the returned contests under the ordinary key, and forwards them through `takeContests`.

## Prior finding dispositions

### F001
- status: fixed
- triage: Remains fixed; the exclusive claim path is untouched by this commit.

### F002
- status: fixed
- triage: Remains fixed; filesystem reading/admission classification is untouched.

### F003
- status: fixed
- triage: Remains fixed; the ordinary production-order path is unchanged, and `failEveryEntry` preserves the prior unreadable-root input order.

### F004
- status: fixed
- triage: Remains fixed; complete contest membership is still carried once and rendered from every refused row's index.

### F005
- status: fixed
- triage: Remains fixed; held members remain refusal-only and the settled distinct-spelling residual still behaves as designed.

### F006
- status: fixed
- triage: Remains fixed; D4b and the runtime still preserve the actual local refusal rule except for the typed `CLAIM_LOST` path.

### F007
- status: fixed
- triage: `bringSummary` now excludes a selected yielder exactly while its favoured member is also selected. The focused witness is armed: reverting to the old selected-only filter adds the yielder's linked count while the test still expects the note visible, one copied item, and both submitted ids.
- invariant: Every pre-apply statement about a contender reflects what the submitted selection can actually receive.
- boundary inventory:
  - verified safe: initial yielding default; yielder ticked back on while favoured stays selected; note visibility; copied/linked count; both submitted ids; full reversal; groups without a favoured member

### F008
- status: fixed
- triage: D4a, its ledger row, and tasks 4_3/5_3 now describe the shipped normalized representation: local reason plus contest index, one membership per contest, and composition at rendering. D4b still preserves the rule that fired. From the reader's point of view every refused contested row cites the membership line containing every path and declaring file.
- invariant: Repository-controlled provisioning metadata stays linear in steps plus declarations, and every accepted owner describes the once-per-contest representation while preserving visible whole-membership refusal.
- boundary inventory:
  - verified safe: accepted parent design; task plans; apply result; message type; extension handoff; controller state; notice rendering; dangling-index disclosure; one membership block per cited contest

### F009
- status: fixed
- triage: Remains fixed; a contested entry's own reason and its contest index are both preserved.

### F010
- status: fixed
- triage: Remains fixed; D4b still names the two exported-function doors accurately.

### F011
- status: fixed
- triage: `failEveryEntry` recomputes through the same `contestsOf` definition as the ordinary path, uses the shared `wireContests` builder, and attaches the matching index to every selected member. `extension.ts` routes `prepareEntryGate() === null` through it, stages nonempty memberships under the same `worktreePath` key as ordinary apply, and the existing one-shot `takeContests` path forwards and deletes them. F012 records only the missing end-to-end regression witness.
- invariant: Every provisioning result step that belongs to a selected contest references exactly one contest membership carried on the same result message, on every result-producing exit path.
- boundary inventory:
  - verified safe: unreadable-root builder; contested and uncontested steps; ordinary apply sharing; extension early return; side-channel key; one-shot forwarding/cleanup; result rendering

## Verification trace

- F007: offer model -> `yieldsTo` -> live selected set -> `bringSummary` and `syncYieldNotes` use the same favoured-selection condition -> submission still carries both selected ids -> apply recomputes and refuses the yielder.
- F008: apply keeps local outcomes -> contested steps carry an index -> result carries each membership once -> extension stages/forwards it -> controller preserves it -> rendering marks each refused row with its contest and lists every member once below the rows.
- F011: `prepareEntryGate() === null` -> `failEveryEntry` -> shared contest discovery and wire membership -> member index attachment -> `provisionContests.set(worktreePath, ...)` -> `takeContests(outcome.provision.path)` -> result message -> rendered membership.
- Tests contain no changed `.only`/`.skip`; the F007 interaction is synchronous and the F011 builder tests require no omitted async work.

## Adjudication notes

- All three specialists found no product or contract defect. The chair agrees that F007, F008, and F011 are fixed in the reviewed commit.
- The chair adds F012 because the explicit no-harness rationale is contradicted by the assembly test's own destination setup. This is regression coverage, not evidence that the shipped branch is currently wrong, so it is WARN and does not reopen F011.
- The settled distinct-spelling residual matches the recorded decision: held declarations remain refused rather than materialized after the favoured declaration's object can no longer be proven.
- No agent message was treated as user consent, approval, or risk acceptance.

## Audit backlog

None.

## Author triage — round 6

**F012 — ACCEPTED, and it refutes my own stated reason.** Round 5's triage recorded a deviation:
"That file has no harness able to make `prepareEntryGate` answer `null`, and building one would be a
larger change than the fix." That claim is false. `src/extension.worktreeAssembly.test.ts:1486-1493`
already creates the destination directory precisely BECAUSE `prepareEntryGate` returns `null`
otherwise — the harness I said did not exist is the one the neighbouring test uses, and its comment
says so. I did not check before declaring the limitation, and the chair did.

Severity is WARN and the shipped implementation is correct, so this is not gating. Fixing it anyway
rather than carrying it as a nice-to-fix: the finding is a REGRESSION gap on the unreadable-root
bypass, and reverting the `extension.ts` wiring alone would leave the direct-`failEveryEntry` tests
green. This change's whole subject is a destination that cannot be un-written, so a silent regression
there is worth a test that costs one case.

No `D#` changes and no new invariant owner, so the remediation boundary is not crossed.

---

## Out-of-band findings reassigned to this change — 2026-09-02

Two BLOCK findings against this change's apply-time owner were raised by the chair reviewing the
sibling change `assemble-one-config-from-several-files` (its `.reviews/round-8.md`, F015 and F016),
which reaches this owner through its integration seam. I verified both mechanisms in the code
directly rather than accepting the report.

### [OOB-F015] Two native contenders leave a group with no winner, and the inherited row takes the destination

- Severity: BLOCK · Confidence: HIGH · Verified by author at HEAD
- File: `src/worktree/provisioning/providerKit.ts:404`, `src/worktree/provisioning/applyProvisioning.ts:60-64`

`contendersOf` sets `favoured` only when `native.length === 1`. A group of two native case-variants
plus one inherited variant therefore carries no `favoured`, and `contestsOf` drops it on the branch
whose comment reads "A group with no favoured member left is not a contest — nothing in it claims
priority." That reasoning was written for a favoured member the user had unticked. Two natives is a
different state: priority IS claimed, by two rows at once. The group falls through to the ordinary
pass and the inherited declaration's material and `mode` land at the destination.

This contradicts the spec delta's `MODIFIED` requirement — "where declarations may name one
destination, the repository's own is materialized first and the others are refused" — and its
`Scenario: More than two declarations may name one destination`.

### [OOB-F016] A held member's own admission refusal vetoes an admissible native winner

- Severity: BLOCK · Confidence: HIGH · Verified by author at HEAD
- File: `src/worktree/provisioning/applyProvisioning.ts:171`

`read()` collapses every `admitEntry` failure to `"inadmissible"`, and `contended()` refuses on any
reading that is not `"absent"`. An inherited member refused by its own material rule — a link-mode
entry over a directory, say — therefore proves the shared destination "not free" and the admissible
native copy is refused at a destination that does not exist.

The collapse is deliberate and D3 argues for it: a gate refusal reaches the filesystem and cannot be
told apart from an unreadable destination. That argument holds for the destination reading itself.
It does not hold for a refusal that is a property of the MEMBER — its mode, its material — and never
of the destination.

## Author disposition

Both are **accepted**, and both are **artifact handbacks, not remediation**:

- OOB-F015 needs a rule for what a group with more than one native member means. `favoured` is
  currently a single optional id; either the type changes or a native-selection rule is chosen. That
  is a new or changed `D#`, and § 4.3's "the repository's own declaration" needs to say what it means
  when two rows are.
- OOB-F016 needs `Reading` to distinguish a destination-observation failure from a member-specific
  admission failure. `D3` explicitly argues the current collapse; changing it changes `D3`.

Neither can land as a fix commit inside this cycle. Parking and returning to `asimov-plan`.
