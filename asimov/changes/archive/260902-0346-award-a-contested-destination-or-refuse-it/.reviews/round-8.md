# Review Round 8

- Date: 2026-09-02
- Cycle: 5
- Round: 8
- Mode: discovery
- Arbiter: no
- Review profile: fastlane
- Escalation flags: new-api-contract, re-review
- Scope: range `ab11eef0..38e3ae557702d275bd54fcb269141e9c702b4f58`. Change context is `award-a-contested-destination-or-refuse-it`; the range also contains the archived sibling's final bundle-require fixes and one skipped workflow-only commit from `prove-entry-reconstruction-on-windows`. `docs/ui/create-worktree.html` and `docs/ui/worktree-create-dialog.css` were absent from the range and remain out of scope.
- Head: `38e3ae557702d275bd54fcb269141e9c702b4f58` (working tree dirty only in analytics files at review close; review content came from the explicit committed range)
- Reviewable lines: 323
- Cycle note: round 7 ended cycle 4 at BLOCK and handed F007/F013 back to plan. Gate 2 was re-earned with D3c and the new offer-side requirement. This is the replan's discovery round, not a verification pass; the gate set is frozen here.
- Agents spawned:
  - asm-review-frontend — dialog predicate, live notes, summaries, defaults, and submission — opus[1M]
  - asm-review-logic — apply contest reconstruction, own-rule ordering, and no-write paths — gpt-5.6-terra[1M]
  - asm-review-contracts — `ProvisionContenders.natives` producer/remint/consumer contract — sonnet[1M]
  - asm-review-reuse — predicate ownership and browser-boundary duplication — gpt-5.6-luna[1M]
  - asm-review-logic — incidental archived bundle-require fixes in the explicit range — gpt-5.6-luna[1M]
  - asm-review-performance — contender-note DOM and toggle growth at the 200-row cap — gpt-5.6-luna[1M]
- Support agent: asm-finder — end-to-end contender offer, redemption, apply, and result flow — gpt-5.6-luna[1M]
- Agents skipped: data-security (no changed auth, permission, secret, persistence, or untrusted-path authority surface)
- Recorded verification: `bun run asm change verify-status award-a-contested-destination-or-refuse-it` exit 0. Tasks 10_1, 10_4, 10_5 and 10_6 record their focused Vitest plus type/unit gates at exit 0; task 10_1 records 20 added/updated assertions, 10_4 records 6, 10_5 records 10, and 10_6 records 11. Per review policy, this review did not rerun project verification commands.
- Verdict: WARN
- Counts: BLOCK 0 | WARN 2 | SUGGEST 1
- Split over gating blockers: 0 feature / 0 machinery

## Findings

### F019

- ID: F019
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-performance
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:768`, `:772`, `:1233`
- title: Candidate notes multiply one bounded contender group into pathological DOM and per-toggle work
- evidence: For a group with `M` members and `K` repository-native claimants, each of the `M-K` inherited rows receives `K` separate hidden/live yield-note spans. Each span rebuilds and stores the full `K`-id claimant list in `dataset.claiming` (`row.yields.map(...).join(" ")`), so initial rendering duplicates `O((M-K) * K^2)` identifier content. Every checkbox change then visits every one of those spans, splits that full string, allocates an array, and filters all `K` ids again — the same `O((M-K) * K^2)` hot-path work. `MAX_MODEL_ROWS` structurally caps `M` at 200, but `entriesFor` does not deduplicate repeated/case-varied declarations and `contendersOf` may put all 200 rows in one group. At `K=100`, `M-K=100`, the implementation creates 10,000 note elements and performs about 1,000,000 claimant checks plus temporary allocations on each tick; `K=133`, `M-K=67` still performs about 1,185,000 checks.
- impact: A valid, bounded repository declaration can make opening the create dialog allocate thousands of hidden DOM nodes and make each checkbox interaction scan roughly a million duplicated id entries. The cap prevents unbounded growth but does not make this derived representation proportionate to the 200-row input; the UI can become sluggish or memory-heavy exactly on the contested groups this change adds live interaction for.
- suggestedFix: Render one yield note per inherited row (or one shared note per group), keep claimant ids/paths once in JavaScript state keyed by group, and update that note's visibility and text from the current selected-native subset. This reduces both initial DOM and toggle work to model-proportional `O(M*K)` or better without requiring a row redraw.
- status: accepted
- triage: New. The performance specialist independently quantified both the initial-render and interaction boundaries; they are one causal representation and one fix, so they are merged rather than reported as two findings.
- author-triage: ACCEPTED, and it is a regression task 10_6 introduced — before it there was one note per row. Reproduced the bound rather than taking it on the specialist's word: `MAX_MODEL_ROWS = 200` (`providerKit.ts:78`) and groups are formed by a fold key over ALL entries (`providerKit.ts:386`), so one group really can hold every row the cap allows and a 100/100 split is reachable from a checked-in file. Fixed inside the accepted contract: D3c owns the predicate, not its representation.
- invariant: Derived UI work for a structurally capped provisioning model remains proportionate to the model rather than multiplying candidate combinations into DOM and repeated per-event scans.
- boundary inventory:
  - affected: initial `bringRow` DOM construction; copied `dataset.claiming` strings; delegated checkbox-change `syncYieldNotes`
  - verified safe: `bringSummary`/`refusedEntire` remain model-proportional; provider rows are capped at 200; offer storage does not accumulate per redraw

### F018

- ID: F018
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair, asm-review-frontend
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:786`, `:1246`
- title: A three-native group names an unselected declaration as selected
- evidence: `contestedBy` gives every row all native claimants from the offer. The note text is then baked once from that full list as `refused while A and B and C are both selected`, while `syncYieldNotes` shows it whenever the count of selected claimant ids is at least two. With three native declarations for one folded destination, unticking C leaves A and B selected. The apply and summary correctly continue to refuse/count zero, but the still-visible note continues to name C and says it is selected. Three native declarations are reachable: one repository file can declare three folding spellings, the accepted requirement says “more than one”, and the producer/test contract permits any ordered `natives` subset; the dialog tests stop at exactly two native declarations.
- impact: The group decision and arrival count are correct, so this is not round-7 F007's false-arrival blocker. The explanation is nevertheless false at the live selection the user just made and obscures which declarations still keep the group refused. It directly misses the review brief's requirement that no shown note be false and D3c's render-time/selection-time split.
- suggestedFix: Make the contested note's text live as well as its visibility: derive the displayed paths from the selected claimant subset (and say “all selected” rather than “both”), or use selection-independent wording that does not name unselected rows. Add a three-native witness that unticks one while leaving two selected.
- status: accepted
- triage: New, corroborated independently by the chair and frontend specialist. It does not reopen F007 because the arriving set and refusal outcome agree with the apply; the causal defect and impact are the stale claimant names inside an otherwise-correct refusal note.
- author-triage: ACCEPTED. My 10_6 witnesses walk a TWO-native group, where "more than one selected" and "all of them" coincide, so the text could not be caught being stale. With three, visibility needs two and the text names three. The spec requires the row to say the create will refuse it because more than one of the repository's own declarations names this destination; it does not fix which ones are named, so deriving the names from the live selection satisfies the same requirement without a `D#` change.

### F020

- ID: F020
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: chair, asm-review-frontend, asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:499`, `:603`
- title: The selection-aware refactor leaves dead guards that misstate where live truth is derived
- evidence: `bringRows(model, selected?)` accepts a selection, but both production calls omit it; the redraw call then overwrites every returned `checked` value from the held selection. Separately, `bringSummary` tests `!selected.has(favoured.id)`, but `yieldsTo(model, selected)` can return a favoured id only after filtering `group.natives` by that same `selected` set, so the condition cannot be true. The adjacent round-5 rationale credits this vacuous branch even though the actual protection now lives inside `yieldsTo`.
- impact: No current behavior is wrong. The dead parameter and impossible branch make the fourth iteration of this invariant look selection-driven in places it is not, inviting tests or maintenance changes to target guards that cannot fire instead of the one predicate that now owns the behavior.
- suggestedFix: Remove the unused `selected` parameter from `bringRows`, reduce the summary test to absence from the yielding map, and move/update the rationale (including `BringRow.yields`'s now-plural candidate semantics) at the actual selection filter.
- status: accepted
- triage: New. Two no-behavior defects from separate specialists are merged as one maintainability finding because both are stale API surfaces left by the same selection-aware rewrite.
- author-triage: ACCEPTED, both halves verified. `bringRows` is called at 1288 and 1297 and neither passes a selection, so the `selected?` parameter and its fixed-point comment describe a call that does not exist. And at 603 `yieldsTo` draws `favoured.id` out of `selected` itself (line 379), so `!selected.has(favoured.id)` cannot be true — the expression is just `favoured === undefined`.

## Prior finding dispositions

### F001 — F006
- status: fixed
- triage: Remain fixed. The exclusive-claim, observation, ordering, membership and rule-that-fired paths were traced through the selected-entry apply and no changed branch reopens them.

### F007
- status: fixed
- triage: D3c closes the invariant at the arriving-set boundary. The dialog and apply both decide from the number of selected native declarations: more than one refuses entire, exactly one favours that declaration and holds the rest, none applies the selected members ordinarily. Summary counts and submitted ids follow the same live selection. F018 is deliberately separate because the result/count remain true; only the names embedded in one note become stale for a three-native subset.

### F008 — F012
- status: fixed
- triage: Remain fixed. Contest membership is still carried once and indexed on every result path, including unreadable-root failure; extension staging and result rendering are unchanged in the relevant impact cone.

### F013
- status: fixed
- triage: The delta spec now expressly owns refusal of more than one selected repository declaration and qualifies the materialization rule through the two contest requirements.

### F014
- status: fixed
- triage: `refusedItself` steps are produced before a sibling's non-absent reading settles the rest, and the new witness asserts both reason and observable order.

### F015
- status: fixed
- triage: `remint` translates `members` and `natives` through the same closure, and the round-trip witness proves both native ids are live reminted ids and remain a subset of members.

### F016
- status: fixed
- triage: The contradictory optional-field pair was deleted. The one required `natives` list encodes the three legal states by selected cardinality.

### F017
- status: fixed
- triage: The apply tests now cover a favoured member refused by its own rule and a contest whose members are all refused before reading; the dialog tests walk the accepted two-native selections. F018 records the distinct untested three-native text boundary.

## Full-flow trace

- Producer and wire: `readProvisioning` assembles surviving entries, `contendersOf` groups by one fold key and emits `natives` in member order, and `offerStore.remint` translates both id lists through one map. The host posts only that reminted model.
- Selection and authority: the dialog seeds defaults from the all-selected fixed point, keeps one set per offer, recomputes summary/note visibility on each delegated checkbox event, and submits only offer id plus selected item ids. The host validates the inbound shape, redeems the exact live offer, and filters its own stored entries; no webview path or command becomes filesystem authority.
- Apply: `applyProvisioning` recomputes contender groups from the selected entries. Zero selected natives yields no contest, one yields a favoured/held contest, and multiple yields a refuse-entire contest. Own lexical/mode refusals are answered before group settlement; all remaining first-read, second-read, claim-lost and held paths either write only the favoured member exclusively or write nothing.
- Output: each contested step carries one contest index, membership is staged once per worktree, the create result posts before provisioning results on the same channel, and the webview resolves and renders membership by index without depending on result position.
- Incidental explicit-range work: the archived bundle-require fixes preserve builtin/bare-external/relative/absolute classifications, resolve paths before containment checks, and use specifier-neutral warning text. No finding.
- Tests/support: changed tests contain no `.only` or `.skip`; async witnesses are awaited. No project verification command was run by review.

## Adjudication notes

- The frontend specialist and chair independently found F018. Both verified the group outcome and summary remain correct, so severity is WARN and it is not merged into or used to reopen F007.
- The performance specialist reported initial DOM expansion and per-toggle rescanning separately. They share one candidate-note representation and one remediation, so they are merged as F019 with both boundaries inventoried.
- The contracts specialist's wire checks and logic specialist's apply trace found no contract or apply defect. The reuse specialist found no existing browser-safe owner and no behavioral divergence among the decision helpers.
- No agent message was treated as user consent, approval, or risk acceptance.

## Audit backlog

None. This is a discovery round; all surviving findings are in scope.
