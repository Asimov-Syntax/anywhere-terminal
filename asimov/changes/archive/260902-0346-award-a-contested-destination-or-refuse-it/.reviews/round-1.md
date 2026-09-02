# Review Round 1

- Date: 2026-09-02
- Cycle: 1
- Round: 1
- Mode: discovery
- Review profile: fastlane
- Scope: range `6a983286~1..HEAD`
- Head: `f770c4c6f55a8b986a1a0513541b5ee8d1a407e7` (working tree dirty after review accounting updated `analytics.json`; review content was taken from the committed range)
- Reviewable lines: 246
- Escalation flags: `new-api-contract`
- Agents spawned:
  - asm-review-logic — contested apply state machine, ordering, failures, and races — gpt-5.6-sol[1M]
  - asm-review-contracts — declaration identity, D1-D6 outcomes, extraction compatibility, and result contract — gpt-5.6-terra[1M]
  - asm-review-data-security — filesystem observation, containment, TOCTOU, and symlink safety — sonnet[1M]
  - asm-review-reuse — orchestration extraction and reuse of contender/admission owners — gpt-5.6-luna[1M]
- Support agent: asm-finder — offer-id uniqueness and end-to-end provisioning result flow — gpt-5.6-luna[1M]
- Agents skipped: asm-review-frontend (no frontend diff); asm-review-performance (selected entries and apply budgets remain structurally bounded; no new growth axis)
- Recorded verification: `bun run asm change verify-status award-a-contested-destination-or-refuse-it` reports tasks 1_1, 2_1, 2_2, and 3_1 at exit 0, with the recorded focused/unit/typecheck gates. The review did not rerun project verification commands.
- Chair probes: none; findings are established directly by the changed control flow and accepted contracts.
- Verdict: REJECT
- Counts: BLOCK 4 | WARN 0 | SUGGEST 0
- Blocking split: 3 feature | 1 machinery

## Findings

### F001

- ID: F001
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:117`
- title: A favoured directory can merge into a destination created after the D3 reading
- evidence: The only pre-existing check is completed before the ordered pass. A preceding uncontested copy such as `MixedCase/seed`, or another process, can create `/wt/MixedCase` after that check but before a favoured directory copy reaches `applyEntry()` at line 143. `makeDirectory()` then catches `EEXIST`, returns `written` for an existing directory (`applyEntries.ts:367-382`), and `walk()` merges into it (`:497-515`). The favoured step is reported `copied`, so the later held-member check treats it as a claim even though this apply did not create the top-level directory or install its mode.
- impact: Material and mode already held by an unrelated or inherited writer remain authoritative while the apply reports that the repository declaration claimed the destination. This violates D4 and the primary native-wins-or-refuse acceptance.
- suggestedFix: Give a contested favoured entry a top-level claim result that distinguishes “created by this apply” from “directory already existed.” A top-level `EEXIST` after the D3 reading must make the contest refuse rather than using the ordinary uncontested directory-merge behavior; descendants beneath a top-level directory proven created by this apply may retain the current walk behavior.
- status: accepted
- triage: Open gating blocker. The deliberate no-promotion construction remains intact; the defect is the unguarded interval before the favoured member's ordinary turn. The changed link witness reaches `skipped` on `EEXIST`, but does not cover the directory arm that returns `written` and merges.
- invariant: A contested favoured declaration either exclusively establishes its top-level destination and mode, or the contest refuses; an unrelated writer cannot become the destination owner through the gap between observation and the favoured turn.
- boundary inventory:
  - affected: D3 pre-read to ordered-pass handoff; favoured directory top-level creation; concurrent creator; preceding uncontested descendant copy
  - verified safe: pre-existing destinations observed during D3 are refused; file copies and link creation use exclusive primitives and do not merge
  - not safe: directory `mkdir` returning `EEXIST` after D3 is converted to `written` and descends

### F002

- ID: F002
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic, asm-review-data-security, asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:97`
- title: Unknown filesystem and admission states are collapsed into absence or collision
- evidence: `present()` catches every `lstat` rejection and returns `false`, so `EACCES`, `EIO`, or another observation failure authorizes the same path as confirmed `ENOENT`. During D3, a transient failure against an existing directory allows the directory-merge path described by F001; after the favoured turn it can select row 4 and attempt the held member. Separately, `destinationOf()` discards `admitEntry()`'s refusal reason as `null`; post-pass code treats that `undefined` as a present/unattributable collision even when no destination was observed, instead of giving the held entry its deferred `applyEntry()` result.
- impact: The apply can write into a pre-existing directory after failing to establish absence, and other admission failures are reported as collisions the filesystem never showed. The core state machine cannot distinguish “absent,” “present,” “admission refused,” and “observation failed.”
- suggestedFix: Carry a discriminated observation result such as `absent | present | admissionRefused(reason) | failed(reason)`. Only `ENOENT` is confirmed absence. Any other observation failure must refuse without writing; an admission refusal must preserve its own rule/result rather than becoming an invented collision.
- status: accepted
- triage: Open gating blocker. The data-security specialist rated this WARN by assuming every write remains exclusive; that does not hold for directories because `makeDirectory()` deliberately turns `EEXIST` on a directory into `written` and the walk merges beneath it. The concrete directory path sustains BLOCK.
- invariant: Failure to observe a destination is never proof of absence and never authorizes a contested write; admission refusal remains distinct from destination presence.
- boundary inventory:
  - affected: D3 pre-read lstat; D4 post-pass lstat; destination admission; held-member deferred dispatch; directory merge
  - verified safe: a successful lstat is presence; `ENOENT` beneath an admitted destination is absence; ordinary `applyEntry()` still reports its own admission rule
  - not safe: non-ENOENT lstat errors; `admitEntry()` refusal collapsed to `null`; post-pass `undefined !== false`

### F003

- ID: F003
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-contracts
- class: machinery
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:169`
- title: The extraction changes uncontested result order from copy-before-link to provider order
- evidence: Before extraction, `extension.ts` sorted entries copy-before-link and pushed each result into `steps`, so `[link, copy]` returned `[copy result, link result]`. The new function still executes `copiesFirst(entries)` but returns `entries.map(...)`, and the new test explicitly asserts arrival/input order. Task 1_1 requires the same models to produce the same steps in the same order. The webview's `provisionKey()` includes every result in sequence (`WorktreeView.ts:1792-1800`), so the change is observable beyond internal work order.
- impact: Uncontested models receive a changed `ProvisionStepResult[]` contract from a refactor promised to be behavior-preserving, and order-sensitive UI state comparison changes for identical provisioning work.
- suggestedFix: Preserve the pre-extraction copy-before-link result sequence for ordinary entries and define the placement of deferred contest results without silently reverting the whole answer to provider order. The extraction witness should assert the prior returned order.
- status: accepted
- triage: Open gating blocker. Offer ids are uniquely reminted before selection, so id ambiguity is not the defect; the returned array order itself changed.

### F004

- ID: F004
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:125`
- title: Refusal text neither names both declarations nor preserves causal uncertainty
- evidence: Every reason is built from `declaredAs()` for only the other side: row 1 omits the current member's declaring file, and rows 2/3 omit the held member's declaring file. `ProvisionStepResult` carries only that member's path, not its source, and the rendered notice uses only `path: reason` (`WorktreeView.ts:1842-1847`), so the missing source is not recovered by the consumer. The row-3 reason also says what is present “was not put there by this apply,” although the common folding case is precisely that the favoured member may have put it there; the accepted D4 decision says the apply cannot know which cause applies.
- impact: The user-visible refusal cannot identify both config declarations as required by task 2_2, and it replaces the forbidden “awarded to the favoured member” causal claim with an equally unsupported opposite claim.
- suggestedFix: Build each D4 refusal from `declaredAs(member)` and every counterpart, and phrase row 3 as an inability to attribute the destination rather than asserting who did not create it.
- status: accepted
- triage: Open gating blocker. The tests assert only the counterparty's source and lock in the false negative-causality wording; they do not witness the accepted “both declarations” contract as rendered to the user.

## Full-flow trace

- The offer store remints selectable ids uniquely, the host resolves checked ids back to host-owned `ProvisionEntry` objects, and the mutation service invokes provisioning only after git has created the worktree.
- `extension.ts` prepares both containment roots once, mints one shared budget, and calls `applyProvisioning()` for copy, link, and link-degraded-to-copy modes. There is no cache or cold/hot split in this flow.
- `applyProvisioning()` recomputes contests over selected entries, samples destinations, runs the ordinary copy-before-link pass, settles held members, and returns per-entry outcomes. F001 and F002 are in the observation-to-claim translation; F003 is in output ordering; F004 is in the user-visible result contract.
- Root preparation failure still returns one failed result per selected entry. `applyEntry()` catches per-entry write failures. The create result is posted first and the provisioning report second; the webview summarizes results in their returned sequence.

## Adjudication notes

- The reuse specialist found no duplicate implementation or cohesion defect; the new module correctly calls the existing contender, admission, and entry-apply owners.
- The finder established that issued offers remint ids uniquely, so the apparent id-collision risk inside `contestsOf()` is not reachable through the production selection flow.
- The data-security specialist's claim that exclusive creation limits observation errors to messaging is refuted for directory entries by `makeDirectory()` returning `written` on an existing directory and `walk()` merging into it.
- The exact self-loop check is correctly exact and does not widen to the contender folding key. No finding is recorded for the deliberate folded-loop non-goal.

## Author triage — cycle 1 closes here

All four findings accepted as written; none rebutted.

None of them is remediation inside the accepted contract, so the cycle closes rather than
entering a fix loop:

- F001 and F002 change **D3**: one reading before the ordered pass cannot establish that the
  favoured member's own write created its destination, and "not `ENOENT`" is not "absent". D3 now
  owns two readings and a discriminated observation, and D4 gains the row they imply.
- F003 changes a contract task 1_1 accepted: the extraction must return results in the order they
  were PRODUCED, which is what the closure did. Where a deferred contest result appears in that
  order is a decision the design has to make rather than a line to patch.
- F004 changes what **D4** requires a refusal to say — both members by path and declaring file,
  and no claim about who did not create the destination.

Gate 2, Review done and the implementation gate are unticked; the next review is cycle 2's
discovery round.
