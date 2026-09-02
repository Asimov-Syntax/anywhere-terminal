# Review Round 2

- Date: 2026-09-02
- Cycle: 2
- Round: 2
- Mode: discovery
- Review profile: fastlane
- Scope: range `6a983286~1..HEAD`
- Head: `a10856897273ba3846ec827d652ead38f5a9830b` (working tree dirty from review accounting; review content was taken from the committed range)
- Reviewable lines: 307
- Escalation flags: `new-api-contract`
- Agents spawned:
  - asm-review-logic — contested apply state machine, ordering, errors, and races — gpt-5.6-sol[1M]
  - asm-review-contracts — D1-D6 outcomes, group cardinality, result order, and refusal contract — gpt-5.6-terra[1M]
  - asm-review-data-security — filesystem observation, TOCTOU, directory claims, and symlink safety — sonnet[1M]
  - asm-review-reuse — orchestration extraction and reuse of contender/admission/apply owners — gpt-5.6-luna[1M]
- Support agent: asm-finder — host selection through provisioning result consumption — gpt-5.6-luna[1M]
- Agents skipped: asm-review-frontend (no in-scope frontend diff); asm-review-performance (selected entries are provider-bounded and the shared apply budget remains structurally capped; no new growth axis)
- Recorded verification: `bun run asm change verify-status award-a-contested-destination-or-refuse-it` reports tasks 1_1, 2_1, 2_2, 3_1, 4_1, 4_2, and 4_3 at exit 0. The review did not rerun project verification commands.
- Chair probes: three targeted temporary Bun probes, deleted in the same command, reproduced (1) a directory created after the second reading being reported as the favoured copy, (2) the same race for a deferred directory, (3) post-claim removal promoting the inherited declaration, and (4) incomplete reasons for a three-member contest.
- Verdict: REJECT
- Counts: BLOCK 3 | WARN 0 | SUGGEST 0
- Blocking split: 3 feature | 0 machinery

## Findings

### F001

- ID: F001
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic, asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:181`
- title: A read-to-mkdir race still lets another writer own a contested directory
- evidence: The second reading at lines 180-190 establishes absence only before `applyEntry()` starts. Another process can create the favoured directory after that `lstat` and before the top-level `mkdir`; `makeDirectory()` then converts `EEXIST` on a directory into `written` (`applyEntries.ts:367-382`), the walk merges into it, and the favoured result is `copied`. The same mechanism exists after the held member's line-212 reading and before its line-222 `applyEntry()`. A chair probe injected a directory at each top-level `mkdir`: the favoured case returned `[MixedCase copied, mixedcase refused]` while the injected `0700` directory remained, and the held case returned both entries as `copied` while the injected directory remained.
- impact: A concurrent writer's top-level object and mode can remain authoritative while the orchestration credits either declaration with claiming it. This violates the native-wins-or-refuse acceptance and the invariant that a contested top-level directory must be established by this apply's own write.
- suggestedFix: Give contested top-level directory creation an exclusive claim result. For both the favoured and deferred member, top-level `EEXIST` must refuse the applicable contest path instead of entering ordinary directory-merge behavior; retain merge semantics only for uncontested entries and descendants beneath a top level proven created by this apply.
- status: accepted
- triage: Persists from round 1. The second reading closes the earlier-entry window but not the read-to-create window, so F001's accepted invariant remains open.
- invariant: A contested declaration either exclusively establishes its top-level destination and mode or the contest refuses; observation alone cannot convert another writer's directory into this declaration's claim.
- boundary inventory:
  - affected: favoured second-read to top-level directory `mkdir`; deferred-member post-claim read to top-level directory `mkdir`; directory copy; link degradation into a directory copy; concurrent creator
  - verified safe: destinations already present at either reading; non-`ENOENT` observation failures; file copies using `O_CREAT | O_EXCL`; direct symlink creation using `EEXIST` as skipped
  - not safe: top-level directory `EEXIST` converted to `written` after either final reading

### F005

- ID: F005
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:212`
- title: Post-claim disappearance can promote the inherited member on a folding volume
- evidence: After the favoured member reports `copied`, `linked`, or `degradedToCopy`, line 212 treats `ENOENT` for a held spelling as proof that the filesystem keeps the names apart and line 222 applies the held member. On a folding filesystem, an external process can remove the favoured object between its successful write and this read. A chair probe did exactly that: both rows returned `copied`, but the final folded destination was `/wt/mixedcase` with the inherited declaration's bytes. A remove-and-replace mutation has the companion failure: the held row refuses because something is present, while the favoured row remains reported as copied even though its claim no longer owns the slot.
- impact: The apply can actively install the inherited declaration into the contested slot after the repository's own claim disappears, or retain a false successful native result after replacement. The final state is neither native-owned nor a refused contest.
- suggestedFix: Settlement needs evidence that the favoured claim still owns the slot, not absence under the held spelling alone. If the claim disappeared or changed, refuse the remaining contest and revise the favoured result rather than applying the held member. If the available filesystem primitives cannot distinguish that state from a genuinely case-sensitive pair, hand the identity proof back to planning instead of selecting the inherited declaration.
- status: accepted
- triage: New gating blocker. This is a post-claim ownership transition, distinct from F001's pre-claim read-to-create race.
- invariant: Once the favoured declaration is reported as the contest's claim, deferred settlement cannot let disappearance or replacement turn the held declaration into the winner; loss of the claim must produce a refused contest.
- boundary inventory:
  - affected: favoured successful result to held-member observation; folded-name deletion; folded-name replacement; deferred dispatch
  - verified safe: no intervening mutation on a folding volume produces presence and refuses the held member; a genuinely case-sensitive volume with both destinations absent still lands both
  - not safe: favoured removal makes the held spelling read absent and be applied; replacement leaves the favoured success stale

### F004

- ID: F004
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-logic, asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:206`
- title: Deferred refusals still omit members from contests larger than a pair
- evidence: `ProvisionContenders.members` permits two or more entries and `contendersOf()` groups every entry sharing the foldable key. The pre-pass `refuseContest()` correctly renders `[favoured, ...held]`, but each deferred branch builds `both` from only `[member, contest.favoured]`. With one native and two inherited spellings in one group, each held refusal omitted the other inherited declaration in a chair probe; both the “never claimed” and “cannot be attributed” branches share this construction.
- impact: A user-visible refusal can conceal another declaration participating in the same destination contest, violating D4a and task 4_3's requirement that every refusal name every member by path and declaring file.
- suggestedFix: Build deferred reasons from the complete stable membership `[contest.favoured, ...contest.held]`, and add three-member witnesses for both deferred refusal branches.
- status: accepted
- triage: Persists from round 1. The pair witness fixed the quoted two-member rows, but the same incomplete-member-list mechanism remains for the already-supported `members.length > 2` boundary; under the invariant rule it retains F004 rather than receiving a new ID.
- invariant: Every refusal row names every member of its contest, its own declaration included, regardless of cardinality or adjudication row.
- boundary inventory:
  - affected: deferred favoured-never-claimed reason; deferred post-claim-unattributable reason; contests with one favoured and two or more held members
  - verified safe: pre-pass and favoured-turn whole-contest refusal; every two-member contest
  - not safe: deferred reasons assembled from only the current member and favoured member

## Prior finding dispositions

### F002

- ID: F002
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic, asm-review-data-security, asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:108`
- title: Unknown filesystem and admission states are collapsed into absence or collision
- evidence: The new `Reading` union preserves `absent`, `present`, `unreadable`, and `inadmissible`; only `ENOENT` produces `absent`, and every contest observation treats all other states as contended. The changed EACCES witness records no writes.
- impact: Closed. Observation failures no longer authorize a write, and admission refusal no longer becomes invented absence.
- suggestedFix: None; the accepted four-state D3/D4 design is implemented.
- status: fixed
- triage: Fixed in cycle 2. The deliberate `inadmissible` over-refusal is consistent with the approved correction because the gate itself reaches `realpath`/`lstat`.

### F003

- ID: F003
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-contracts
- class: machinery
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:225`
- title: The extraction changes uncontested result order from copy-before-link to provider order
- evidence: `answered` insertion order now follows actual production, and the return preserves that insertion order; the changed witness asserts copy failures/results before links even when provider order differs.
- impact: Closed. The extraction again returns the sequence the former extension closure produced and the webview comparison key already consumed.
- suggestedFix: None; production-order return is restored.
- status: fixed
- triage: Fixed in cycle 2. Deferred members remain where their outcomes are settled, as approved by D5.

## Full-flow trace

- The webview submits opaque item ids; `WorktreeHost` resolves them through the current host-owned offer, deduplicates with a `Set`, and passes only selected `ProvisionEntry` objects into the queued create.
- Git creates the worktree first. `extension.ts` prepares source and destination roots, creates one shared node/byte/deadline budget, and calls `applyProvisioning()`; root-preparation failure still returns one failed row per selected entry.
- `applyProvisioning()` recomputes contender groups over the selected entries, samples every member before the ordered pass, preserves ordinary copy-before-link execution, resamples a live contest at the favoured turn, and settles held members after the ordered pass. There is no cache or hot/cold path.
- `applyEntry()` owns admission and all writes. Files and direct links use exclusive primitives; directories deliberately merge on `EEXIST`, which is the shared boundary behind F001. Link degradation re-enters the copy walk and therefore shares the directory boundary.
- The create success is posted before provisioning results. The webview stores and compares the complete result sequence and renders each row's path plus reason; F004 is therefore user-visible rather than internal text only.
- Error paths remain per-entry and the worktree survives failures. F005 is after a reported favoured success but before the held decision, where the flow mistakes claim loss for proof that two spellings are separate.

## Adjudication notes

- The logic and contracts specialists corroborated F001; the data-security specialist's no-finding conclusion assumed directory `EEXIST` fails closed, but `makeDirectory()` explicitly returns `written` for an existing directory. The chair probes establish the contrary production behavior.
- The logic specialist and chair corroborated F005. It is not the deliberate D4 row-4 case on an unchanged case-sensitive volume; it is the folding-volume claim being removed before that row is selected.
- The logic and contracts specialists corroborated the multi-member refusal defect. Their suggestion to allocate a new ID is superseded by the cross-round invariant rule: the same incomplete-membership mechanism remains F004.
- The reuse specialist found the new module cohesive and correctly reusing `contendersOf`, `admitEntry`, and `applyEntry`. Its suggestion to extract the one-line errno reader is dropped: the implementations are identical, no behavioral divergence exists, and a shared extraction would add coupling without a witness.
- The exact self-loop guard is correctly exact and does not widen to the advisory folding key. The folded-loop follow-up remains out of scope as accepted.

## Author triage — cycle 2 closes here

All three findings accepted as written; none rebutted.

- **F001** and **F005** both refute an accepted design row, so neither is remediation:
  - F001 needs a contested top-level directory creation that is EXCLUSIVE. D3 says in as many
    words that "`EEXIST` cannot make the distinction at all, which is why it is not the signal" —
    and the fix is precisely to make it a signal, for one narrow case D3 never separated out. That
    is a changed `D#`, and a new claim result `applyEntries` does not have today.
  - F005 refutes **D4 row 4**. The row reads a held member's `absent` after the favoured claim as
    proof that the volume does not fold — but it is equally the signature of the claim being
    removed underneath the apply, and the row cannot tell those apart. Whether any available
    primitive can is the open question, and it is a planning question: it may end in a design
    that proves the claim still stands, or in an accepted non-goal that refuses the settlement
    rather than performing it.
- **F004** IS remediation inside D4a — every deferred reason must be built from
  `[favoured, ...held]` rather than the pair. It rides along as a task rather than a fix commit
  only because the two above close the cycle first; landing it alone would burn a round without
  moving either blocker.

Gate 2, Review done and the implementation gate are unticked; the next review is cycle 3's
discovery round. Per the cycle cap, a third cycle opens no fix loop of its own — the handback is
mandatory, and it carries the premise audit with it.
