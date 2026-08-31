# Review Round 4

- Date: 2026-08-31
- Cycle: 2
- Mode: verification
- Review lane: fastlane
- Escalation flags: new-api-contract, cross-boundary, re-review
- Scope: range `0ef331865c93021e725929947a0798efdb908070..d9e9e5ad3285138aec182358f31c4eab7eaed7e9`
- Head: `d9e9e5ad3285138aec182358f31c4eab7eaed7e9` (tree dirty after the reviewed range: modified `asimov/changes/resolve-a-selection-before-the-create-runs/analytics.json`)
- Reviewable lines: 574
- Scope lock: passed — no new or changed D#, design contract, or invariant owner; task 6_1 is remediation inside approved D1/D2/D3/D7/D8
- Recorded Verify Gate: `.build/verified.ndjson` records task 6_1 exit 0 for focused assembly coverage plus check-types/full unit suite; caller reports check-types clean, 5,976 tests passing, and the unchanged 3-error / 14-warning / 1-info Biome baseline outside this range; review ran no project verify command
- Agents spawned:
  - `asm-review-frontend` — dialog selection, submit gate, and request agreement — `gpt-5.6-sol[1M]`
  - `asm-review-logic` — async probe ownership and post-repair proof — `gpt-5.6-terra[1M]`
  - `asm-review-data-security` — IPC validation and resolved containment — `sonnet[1M]`
- Agents skipped:
  - `asm-review-contracts` — the narrowed wire cone was covered by frontend and data-security
  - `asm-review-performance` — the opening-state growth cone was reviewed by logic and chair
  - `asm-review-reuse` — no independent reuse obligation remained in the verification cone
- Verdict: REJECT
- Counts: 3 BLOCK, 2 WARN, 1 SUGGEST

## Findings

### B3
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `asm-review-frontend`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:943`
- Title: Destination overrides still bypass the effective selection and submit gate
- Evidence: `askForDestination` arms `outstanding`, clears `effective`, and arms `resolutionOutstanding` only when `classifyKey` changes. `classifyKey` deliberately omits `candidatePath`, and the `unasked` drift gate uses that same reduced key. A path keystroke can therefore be submitted by Cmd+Enter before its settled probe is even sent; after `change`, the probe is sent but no gate is armed. The later render keeps `draft.path` whenever `pathIsDerived` is false and chooses it over `targetOf(effective)`, while the resolution's occupied-candidate note is hidden for overrides. For reattach this is a direct split: the form displays/posts the override, but the submitted mode still carries `repairPath` and the mutation repairs that different path. For an occupied fresh override, the host's suffixed `freePath` is ignored and the occupied path reaches a predictable post-submit refusal. Invariant inventory — required invariant: one current effective selection owns mode, displayed destination, submitted path, and executed target. Boundaries searched: branch/base drift, destination drift, default fresh, default reattach, explicit override, controller translation, mutation execution. Affected: explicit destination override before and after its answer. Verified safe: derived fresh destinations and reattach with no override.
- Impact: The user can be shown one destination while a different checkout is repaired, or submit a path the host already resolved away from. The change therefore still permits the exact split-state behavior round-3 B3 blocked.
- SuggestedFix: Treat every changed full `askKey` as destination-invalidating: arm the destination gate until the matching resolution lands. Once it lands, make `targetOf(resolution)` and its disposition authoritative for the displayed and submitted destination in every mode, or explicitly refuse/disable an inapplicable override for reattach. Add an end-to-end reattach-override and occupied-override walk.
- Status: accepted
- Triage: Persists from round-3 B3. The remediation closes the derived-path and no-override reattach branches, but the `pathIsDerived === false` branch preserves a second destination owner.
- Author-Triage: Accepted, and the chair has named my own error precisely. Splitting `classifyKey` out of `askKey` was a decision I made to avoid amending three tests that would otherwise have needed the override to settle and be answered; the reasoning I wrote for it — that an override changes which path is reported on, not what the create does — is wrong for `reattach`, where the override moves the displayed path while the submitted mode still carries `repairPath`. Second failed attempt on this invariant, which fires the thrash stop.
### B7
- Severity: BLOCK
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-logic`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:602`
- Title: Repositories that leave the tree retain opening state for the host lifetime
- Evidence: `retireOpenings(surface, repoId, keep)` removes historical tokens only when another `requestWorktreeRefs` arrives for the same surface and repository. A later dialog asks only repositories still present in `WorktreeController.openCreateForRepo`; a repository removed from the workspace receives no next refs request, so its `refsReads` promise/result and `latestProbe` sequence remain until the whole surface detaches or the host disposes. Workspace-folder invalidation rebuilds the tree but performs no cleanup for departed repository ids. The probe handler also accepts syntactically valid tokens without proving that token is the current refs-owned opening, so a retired/forged token can recreate a `latestProbe` entry. Growth inventory — axis: distinct repository identities opened and then removed while one surface remains attached, plus unowned probe tokens. Affected boundaries: repository removal/replacement and semantic probe ownership. Verified safe: same-repository reopen, surface detach, and host disposal.
- Impact: Opening state still grows monotonically during ordinary multi-root workspace churn, so round-3 B7's extension-host-lifetime retention invariant is not closed.
- SuggestedFix: Own one current opening slot per surface+repository and remove slots when repositories leave the rebuilt tree. Reject probes whose token is not that slot's active refs-owned token; key the latest sequence inside the owned slot rather than letting arbitrary tokens mint map entries.
- Status: accepted
- Triage: Persists from round-3 B7 at the same severity. Supersession for a repository that remains present is fixed, but the lifecycle inventory still lacks repository-removal cleanup and semantic token ownership.
- Author-Triage: Accepted. `retireOpenings` runs only when a NEW refs request arrives for the same repository, so a repository that leaves the workspace is never the subject of one again and its entries survive to surface detach. The fix I wrote closes supersession and leaves departure open.
### B9
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-frontend`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeController.ts:1092`
- Title: A posted same-query answer can validate a newer base selection
- Evidence: The sender increments `probeSeq` for the whole selection, but `handleCreateResolution` rejects only `msg.seq < appliedSeq`; it does not require the answer to equal the latest requested sequence. The dialog then checks only repository and branch query because the resolution echoes neither base nor candidate path. If seq 1 for branch X/base A is posted by the host, the user settles branch X/base B and sends seq 2 before seq 1 reaches the WebView, seq 1 is still accepted because no newer answer has yet been applied. It restores `effective`, clears both gates, and its `baseValid` is read as the verdict for base B. Host-side supersession cannot retract a response already posted. Invariant inventory — required invariant: an answer may clear the submit gate only for the exact latest whole selection. Boundaries searched: sequence minting, host latest check before/after awaits, already-posted responses, controller receive gate, dialog query gate. Affected: an older same-query response crossing a newer base/path request in flight. Verified safe: old tokens, different queries, and responses that arrive below a newer already-applied sequence.
- Impact: Create can be re-enabled for an invalid newer base using the valid verdict for an older base, sending the validation failure back to git after submit and violating approved D7.
- SuggestedFix: Track the latest requested sequence for the active opening and accept a resolution only when `msg.seq` equals that sequence. The response must correlate to the full current selection before it can clear either gate; highest-applied ordering alone is insufficient.
- Status: open
- Triage: New within the accepted B4/D7 impact cone. The production sender now carries the fields, but the receive boundary does not prove that the answer belongs to the latest field values.
- Author-Triage: Accepted, and it is a defect in the fix rather than a survival: `appliedSeq` is the highest ANSWER applied, never the latest question asked, so an answer for base A landing after base B was asked clears both gates and applies A's verdict to B. The dialog's own `query` echo cannot see it — the branch is identical and only the base moved.
### W7
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-frontend`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/extension.worktreeAssembly.test.ts:1259`
- Title: The assembly gate still omits the destination-override branch that breaks agreement
- Evidence: The new assembly walks prove agreement for a derived fresh destination, a reattach with no override, and production base validation. None edits `#wt-path`, so every path-agreement walk keeps `pathIsDerived === true`. B3 survives only in the unexercised override branch: the displayed/submitted override can differ from the effective repair target or host `freePath`, and candidate-only drift is not gated.
- Impact: The accepted production-seam gate remains green while the displayed path, posted create payload, and issued argv disagree for an entry mode the impact manifest explicitly names.
- SuggestedFix: Add assembled walks for a reattach followed by a path override and for an occupied fresh override. Assert the button stays disabled until the exact answer, then assert displayed path = posted path = issued target, or assert the override is explicitly refused where the mode cannot use it.
- Status: accepted
- Triage: Persists from round-3 W7. Fresh/default-reattach and base coverage were added, but the requested destination-override production case is still absent.
- Author-Triage: Accepted. The override branch is exactly the one B3 says is broken, and no assembly walk touches `#wt-path`, which is why the gate stayed green over it.
### W8
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:602`
- Title: Opening retirement makes dialog opening quadratic in repository count
- Evidence: A dialog opening sends `requestWorktreeRefs` once for each of R repositories. Each request calls `retireOpenings`, which snapshots and scans all keys in both maps; after normal supersession those maps still hold approximately one key per repository, so the full opening performs O(R²) key scans and allocates O(R²) temporary key-array entries. Repository count in a multi-root workspace has no structural cap.
- Impact: The cleanup intended to bound host-lifetime state can synchronously delay dialog opening as repository count grows.
- SuggestedFix: Maintain a direct current-opening index keyed by surface+repository, then delete the one known previous key in O(1), or use nested maps whose repository bucket can be replaced directly.
- Status: open
- Triage: New inside the B7 remediation cone.
- Author-Triage: Accepted. Scanning both maps per opening is O(R) per request and O(R^2) per dialog open. One active opening per surface and repository replaces in O(1) and is also what B7's departure cleanup needs.
### S1
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: `asm-review-logic`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/worktreeMutationService.ts:122`
- Title: The duplicate-record proof retains every match when two are enough
- Evidence: `recordFor` accumulates every normalized path+branch match in an array although its only decision is zero, exactly one, or more than one. The authoritative listing is already O(W); a malformed/ambiguous listing adds a second O(W) allocation on the failure boundary.
- Impact: Minor avoidable memory growth in the post-repair proof for large or malformed listings.
- SuggestedFix: Retain the first match and return `undefined` immediately when a second match appears.
- Status: open
- Triage: New inside the exact post-repair proof cone; non-gating.
- Author-Triage: Accepted. `recordFor` accumulates every match to count them; returning on the second is the same answer with a bound.
## Prior findings resolved in this verification

- B1 — fixed: post-repair success requires exactly one same-branch, same-normalized-path record and requires it to be non-prunable; absence, ambiguity, branch change, and normalization failure all fail closed.
- B4 — fixed for payload routing: the production sender forwards base and candidatePath and the host validates base for fresh/adopt. B9 is a separate receive-correlation mechanism.
- B6 — fixed: changed UI paths ask on settled events and duplicate change/blur delivery is coalesced by the full ask key.
- B8 — fixed: candidate overrides pass resolved containment through the same injected filesystem view before any `exists` call; failures and escapes never reach the existence probe.
- W1 — fixed: exact declared keys, safe non-negative ordinals, and exact nested base variants are checked before async work.

## Audit backlog

None.
