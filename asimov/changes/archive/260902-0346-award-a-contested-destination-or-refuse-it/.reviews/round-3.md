# Review Round 3

- Date: 2026-09-02
- Cycle: 3
- Round: 3
- Mode: discovery
- Arbiter: yes
- Review profile: fastlane
- Scope: range `6a983286~1..HEAD`
- Head: `89e95c8673275e06d7bc8e59957b2343ade5204e` (working tree dirty from review accounting; review content was taken from the committed range)
- Reviewable lines: 351
- Escalation flags: `new-api-contract`
- Agents spawned:
  - asm-review-logic — contested apply state machine, ordering, errors, and races — gpt-5.6-sol[1M]
  - asm-review-contracts — D1-D6, scope-cut/spec truthfulness, result and option contracts — gpt-5.6-terra[1M]
  - asm-review-data-security — filesystem observations, exclusive claims, containment, and TOCTOU — sonnet[1M]
  - asm-review-frontend — offer defaults, contender copy, and provisioning notices — gpt-5.6-terra[1M]
  - asm-review-reuse — orchestration extraction and exclusive-claim cohesion — gpt-5.6-luna[1M]
  - asm-review-performance — refusal-reason growth across the postMessage/render path — gpt-5.6-luna[1M]
- Support agent: asm-finder — offer selection through apply and result rendering — gpt-5.6-luna[1M]
- Agents skipped: none
- Recorded verification: `bun run asm change verify-status award-a-contested-destination-or-refuse-it` reports tasks 1_1 through 5_3 at exit 0, including the recorded focused/unit/typecheck gates. The review did not rerun project verification commands.
- Chair probes: one targeted temporary Bun probe, deleted in the same command, supplied a valid contested top-level special file and reproduced the favoured member's real refusal being replaced by a false destination-taken reason.
- Verdict: REJECT
- Counts: BLOCK 3 | WARN 0 | SUGGEST 0
- Blocking split: 3 feature | 0 machinery
- Status: blocked

## Findings

### F006

- ID: F006
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:197`
- title: Every favoured refusal is misreported as an exclusive-claim loss
- evidence: `applyEntry(..., { exclusive: true })` can return `refused` for rules unrelated to `EEXIST`, but lines 197-205 interpret every refused outcome as “the destination was taken” and replace the original result for the whole contest. A chair probe used two valid selected declarations whose favoured source is a top-level special file. `admitEntry()` accepted the contained path, `applyEntry()` correctly refused it as “not a file, a directory or a symlink,” and `applyProvisioning()` returned both rows as “it was taken before this entry could create it,” although no destination existed and no write was attempted. Parent-containment or source/destination mutations between the second reading and `applyEntry()` have the same conflation.
- impact: The result contract says `refused.reason` is the rule the user can act on, and D4's obligation forbids claims about who created or took a destination without evidence. This path hides the actual special-file or containment rule and gives the user a false collision diagnosis in the changed, user-visible contest flow.
- suggestedFix: Give exclusive claim loss a distinct internal result/code from ordinary refusal. Preserve the favoured member's actual refusal reason, add whole-contest context without rewriting its cause, and use the destination-taken wording only for the top-level exclusive `EEXIST` result.
- status: accepted
- triage: New gating blocker. The logic specialist and chair independently identified the same causal collapse; the chair probe establishes it without a race.
- invariant: A contest refusal reports the rule that actually fired; only the exclusive top-level `EEXIST` site may claim that another writer took the destination.
- boundary inventory:
  - affected: top-level special-file refusal; post-reading admission/containment refusal; any future `applyEntry` rule returning `refused`; whole-contest refusal translation
  - verified safe: exclusive file/directory/link `EEXIST` paths do represent claim loss; pre-pass `present`, `unreadable`, and deliberate `inadmissible` readings refuse without claiming a specific writer
  - not safe: the undifferentiated `applied.outcome.kind === "refused"` branch

### F007

- ID: F007
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/asimov/changes/award-a-contested-destination-or-refuse-it/specs/worktree-panel/spec.md:62`
- title: The withdrawn both-materialize behavior is still promised before apply
- evidence: D4 and the added scenario at spec lines 17-22 honestly state the scope cut: once a favoured member is selected, every held member is refused even where the filesystem keeps the spellings apart. The same spec's modified base requirement still says every selected entry is materialized and its scenario says every selected copy entry exists and is reported copied (lines 62-72); task 2_1 still says the non-folding witness has “both land” (`tasks.md:26`). The live create dialog reinforces the stale contract: `bringRows()` marks every contender `Copy`/`Link` row checked (`WorktreeCreateDialog.ts:361-374`), and `bringSummary()` announces all offered rows as “N copied”/“N linked” while only adding “spellings may be one file” (`:415-457`). The offer already carries `group.favoured`, so after the scope cut the loser is known: if both remain selected, it will be refused on every volume, not only when the spellings collapse. The post-apply notice is truthful (`WorktreeView.ts:1810-1847`), but it arrives only after the worktree was created under the false pre-apply promise.
- impact: A user can leave two rows visibly selected under a definite “2 copied” summary and receive one copy plus one deliberate refusal even on a case-sensitive volume. The accepted spec is internally contradictory and the UI still presents the exact behavior the scope cut withdrew, so the user cannot make an informed selection before the irreversible create.
- suggestedFix: Reconcile the spec and completed task record with D4, including the unqualified all-selected scenarios. In the offer, use the known `favoured` member to make the settlement explicit before submit: either default held members off or keep them selected only with copy that says they will be refused while the favoured member remains selected; count offered/attempted rows rather than promising them as copied or linked. Keep the truthful post-apply summary.
- status: accepted
- triage: New gating blocker. This is the explicit final-review scope-cut question: the design is honest, but the spec, completed task record, default selection, and offer summary are not coherent with it.
- invariant: Every pre-apply contract boundary states what a selected contender can actually receive after the deliberate scope cut; no selected/checked/counting surface promises a held member will materialize.
- boundary inventory:
  - affected: delta-spec base materialization requirement and scenario; task 2_1 witness text; offer row default selection; offer summary counts; contender note
  - verified safe: design.md D4's scope-cut discussion; the added non-folding spec scenario; applyProvisioning's held-member branch; the non-folding unit witness; the post-apply provisioning notice
  - not safe: the contradictory general spec clauses and the pre-apply dialog's definite `Copy`/`N copied` presentation

### F008

- ID: F008
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:135`
- title: Complete-member reasons amplify a bounded offer into a quadratic result payload
- evidence: Both `refuseContest()` (lines 132-140) and the held settlement (lines 227-243) construct the complete declaration list separately for every refused member, then store that full string in every `ProvisionStepResult`. For a contest of `N` members and aggregate declaration text `T`, the result retains `O(N*T)` text (`O(N²)` for ordinary similarly sized paths). `MAX_MODEL_ROWS` caps `N` at 200 and each repository-controlled provider file at 256 KiB, but those input caps do not cap the derived payload: a base can declare 199 distinct POSIX paths with a long common prefix and different trailing-dot spellings that `foldWin32Name` groups, while the native file supplies the one favoured row. A valid roughly 256 KiB declaration list is then repeated about 200 times, producing roughly 50 MiB from one provider file and more when a native/base pair contributes text. The extension posts every duplicate string, and `provisionSummary()` joins them again into one DOM reason (`WorktreeView.ts:1842-1847`).
- impact: Repository-controlled input that satisfies both existing structural bounds can expand by two orders of magnitude on the normal successful contest path, consuming extension-host memory, structured-clone/IPC bandwidth, and webview render memory during create. This defeats the reason the provider byte/row budgets exist and can stall or fail the load-bearing create-result path.
- suggestedFix: Change the result/report contract so contest membership is represented once per group and per-entry rows refer to that shared bounded record, or otherwise impose an aggregate output-byte bound with one truthful grouped notice. Do not independently repeat the full member list in every row; preserving D4a may require changing the presentation contract rather than truncating names silently.
- status: accepted
- triage: New gating blocker. The growth axis is contest cardinality `N` (structurally capped at 200) times aggregate declaration text `T` (bounded only before this multiplication); the concrete bound remains large enough to defeat the untrusted-input budgets and core result path.
- invariant: Repository-controlled provisioning metadata remains bounded after every derived representation and across the extension-host-to-webview handoff; one bounded model cannot be multiplied into an effectively unbounded result by per-row duplication.
- boundary inventory:
  - affected: eager whole-contest refusal; deferred held refusals; ProvisionStepResult storage; postMessage clone; provisioning notice reason join and DOM text
  - verified safe: offer row cardinality itself is capped at 200; each provider-file read is capped at 256 KiB; `provisionKey` uses ids/outcome kinds rather than reasons
  - not safe: aggregate reason bytes after repeating full membership once per refused row

## Prior finding dispositions

### F001

- ID: F001
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic, asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyEntries.ts:390`
- title: A read-to-create race lets another writer own a contested directory
- evidence: The new exclusive option reaches the entry's own top-level file, directory, direct link, and link-degraded-to-copy write. At those sites, `EEXIST` becomes `refused`; ancestors and descendants still call the ordinary merge path. `applyProvisioning()` then refuses the whole contest. The added race witness creates the directory after reading 2 and observes no merge.
- impact: Closed. Another writer can no longer be credited as the contested declaration's top-level claim.
- suggestedFix: None; the invariant is implemented at the exclusive top-level boundary.
- status: fixed
- triage: Fixed in cycle 3. This is the same F001 mechanism from rounds 1-2, now closed for file, directory, link, and degradation arms.

### F002

- ID: F002
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic, asm-review-data-security, asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:108`
- title: Unknown filesystem and admission states are collapsed into absence or collision
- evidence: The `Reading` union still preserves `absent`, `present`, `unreadable`, and `inadmissible`; only `ENOENT` produces `absent`, and all other states refuse the contest before writing.
- impact: Closed. Unknown observation states do not authorize contested writes.
- suggestedFix: None.
- status: fixed
- triage: Remains fixed from cycle 2. The deliberate `inadmissible` whole-contest refusal is accepted context; preserving the gate's specific member-level reason would be a different contract, not a reopening of F002.

### F003

- ID: F003
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-contracts
- class: machinery
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:248`
- title: The extraction changes uncontested result order from copy-before-link to provider order
- evidence: `answered` retains production insertion order, the return preserves it, and the mixed-model witness asserts copy results before links.
- impact: Closed. Existing result consumers receive the former closure's production order.
- suggestedFix: None.
- status: fixed
- triage: Remains fixed from cycle 2.

### F004

- ID: F004
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-logic, asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:235`
- title: Deferred refusals omit members from contests larger than a pair
- evidence: Deferred reasons now build `everyone` from the current member, favoured member, and every other held member. The two three-member witnesses cover both claimed and never-claimed settlement branches.
- impact: Closed. Every deferred refusal names every member at supported cardinality.
- suggestedFix: None; F008 is a distinct representation-growth mechanism, not a reopening of the omission defect.
- status: fixed
- triage: Fixed in cycle 3.

### F005

- ID: F005
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:210`
- title: Post-claim disappearance can promote the inherited member on a folding volume
- evidence: The post-claim destination reading and deferred `applyEntry()` call are gone. Every held member is settled as `refused` after the favoured turn, regardless of its own destination reading; the changed non-folding witness asserts no held write.
- impact: Closed. Favoured disappearance or replacement cannot make the inherited declaration the writer.
- suggestedFix: None; the deliberate cost on case-sensitive volumes is evaluated separately in F007's contract-boundary inventory.
- status: fixed
- triage: Fixed in cycle 3. The implementation closes the invariant; the pre-apply promise of the withdrawn behavior is the new F007 mechanism.

## Full-flow trace

- `readProvisioning()` builds a bounded model and contender groups; the offer store uniquely remints ids. The create dialog renders every offered entry checked by default and submits selected ids. `WorktreeHost` resolves those ids back to the current host-owned `ProvisionEntry` objects.
- Git worktree creation completes before provisioning. `extension.ts` prepares roots, creates one shared budget, and calls `applyProvisioning()` inside the queued mutation flow. There is no cache or hot/cold split.
- `applyProvisioning()` recomputes groups over selected entries, samples all members before the ordered pass, keeps the favoured member in its ordinary copy-before-link position, samples the live group again at that turn, and calls `applyEntry(..., { exclusive: true })`. F001's exclusive claim boundary is closed; F006 is the translation of unrelated refused outcomes after that call.
- `applyEntry()` keeps exclusive behavior at the entry's own top-level destination only. Parents and descendants retain the ordinary merge path, containment is rechecked, and no destructive primitive is available. Exact symlink self-reference is refused; case-distinct target spelling remains allowed as designed.
- After the favoured turn, no held member is written. That closes F005, including favoured removal on a folding volume, but means the held member is also refused on a genuinely case-sensitive volume. F007 traces the scope cut through design/spec/task/offer/post-result boundaries; only the design, added scenario, implementation, witness, and post-result notice are truthful.
- The create result is posted first and the complete per-entry provisioning report second. `WorktreeController` folds it into the create notice, `provisionKey()` observes result order/kinds, and `provisionSummary()` repeats every refusal reason into one rendered string. F008 spans reason construction, IPC, and this render endpoint.

## Adjudication notes

- The logic specialist corroborated F006. Its separate proposal to preserve the exact `inadmissible` member's gate reason is rejected because the caller explicitly fixed the accepted decision that `inadmissible` refuses the contest like an unreadable destination; it cannot establish absence.
- The reuse specialist found the orchestration cohesive and the existing contender/admission/application owners reused. Its two extraction suggestions are not independently reported: the claim-loss translation is part of F006's required distinct result, and the repeated membership construction is subsumed by F008's representation fix.
- The prior F001, F004, and F005 witnesses now close at their invariant boundaries. F002 and F003 remain fixed.
- No accepted risk exists. The coordinator's message is not user consent and cannot waive any blocker or accept the withdrawn behavior's downstream contract mismatch.

## Arbiter dispositions

- F006 — accepted: the special-file probe proves a deterministic, load-bearing false causal result on the changed contest path; the exact exclusive-claim-loss signal must be distinguishable.
- F007 — accepted: the design and one added scenario state the scope cut, but the accepted base spec, completed task record, and live pre-apply offer still promise the withdrawn behavior; this falsifies the user-visible selection contract.
- F008 — accepted: the changed per-row representation multiplies repository-controlled bounded input into a result payload large enough to defeat the explicit provider budgets and the core create-result IPC/render path.

## Audit backlog

None.

## Author triage — thrash stop, and cycle 3 closes here

All three accepted as written; none rebutted. The trajectory is `r1=4 | r2=3 | r3=3`, so two
consecutive rounds show no net blocker reduction, and this is the third cycle. Both stops point the
same way and the cycle cap makes option 1 mandatory: no fourth fix loop opens on this change.

- **F006** is the only true remediation. `applyProvisioning` replaces EVERY `refused` outcome from a
  contested `applyEntry` with the claim-loss reason, so an ordinary rule — an unsupported file type,
  a lockfile, a symlink destination — is reported to the user as a destination collision that never
  happened. `applyEntries` needs to say WHICH refusal it had; the reason string is not a channel.
- **F007** is an artifact defect plus a live one. The artifact half is mine to correct: the spec's
  general requirement and task 2_1's record still promise the withdrawn both-materialize behaviour
  that D4 and the new scenario withdrew. The live half is not remediation — the dialog checks every
  contender by default and counts it into "N copied" before the apply runs, so the offer promises
  what the apply will now refuse. Making the offer represent yielding is a new invariant owner in the
  webview, not a line to patch here.
- **F008** cannot be fixed inside the accepted contract either. `ProvisionStepResult` carries one
  string reason per entry, so naming every member in every member's reason IS the wire format; the
  fix is to represent a contest's membership once and have each result reference it. That is a
  changed wire contract with its own owner.

So the scope splits: this change keeps F006 and the artifact half of F007. The offer's
representation of a yielding member, and the grouped-membership result contract, each become their
own change that this one depends on.

Gate 2, Review done and the implementation gate are unticked.
