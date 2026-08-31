# Review Round 5

- Date: 2026-08-31
- Cycle: 2
- Mode: verification
- Review lane: fastlane
- Escalation flags: new-api-contract, cross-boundary, re-review
- Scope: range `d9e9e5ad3285138aec182358f31c4eab7eaed7e9..420bb60b0f136650a19763b3788d1c679d64320d`
- Head: `420bb60b0f136650a19763b3788d1c679d64320d` (tree dirty after the reviewed range: modified `asimov/changes/resolve-a-selection-before-the-create-runs/analytics.json`)
- Reviewable lines: 327
- Scope lock: passed — no new or changed D#, design contract, capability, or invariant owner; task 6_2 is the bounded remediation extension inside approved D1/D2/D3/D7/D8
- Recorded Verify Gate: `.build/verified.ndjson` records task 6_2 exit 0 for the assembly test plus check-types/full unit suite; caller reports check-types clean, 5,984 tests passing, and the unchanged 3-error / 14-warning / 1-info Biome baseline outside this range; review ran no project verify command
- Agents spawned:
  - `asm-review-frontend` — exact selection, destination ownership, submit gate, and assembly coverage — `gpt-5.6-sol[1M]`
  - `asm-review-logic` — async opening ownership, sequence application, convergence, and duplicate proof — `gpt-5.6-terra[1M]`
  - `asm-review-performance` — opening growth axes, replacement cost, lifecycle release, and witness — `sonnet[1M]`
- Agents skipped:
  - `asm-review-data-security` — the contained override boundary was reviewed inside the accepted B3 cone by logic, frontend, and chair
  - `asm-review-contracts` — no wire/schema change in this remediation range; accepted D1/D2/D3/D7/D8 were applied as anchors by the active lenses
  - `asm-review-reuse` — no independent reuse or split-cohesion obligation in the verification cone
- Verdict: REJECT
- Counts: 3 BLOCK, 1 WARN, 0 SUGGEST
- Gate status: B3, B7, and B10 are gating. W7 is non-gating. The thrash-stop extension still has blockers and cycle 2 is at its three-round cap, so handback to `asimov-plan` is mandatory; no fourth verification round is available.

## Findings

### B3
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-frontend`, `asm-review-logic`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:1253`
- Title: Fresh overrides still remain authoritative after the host resolves a different target
- Evidence: The full `askKey` now correctly gates an override, but an applicable override leaves `pathIsDerived === false`. `syncDerived` computes the authoritative `resolvedPath` from `targetOf(effective)`, then deliberately keeps `draft.path` and the stated destination from the local override whenever `pathIsDerived` is false. When the override is occupied, the host returns a suffixed `freePath`; when resolved containment rejects an escaping/unreadable override, `vettedOverride` returns `undefined` and the host returns its derived path. In both cases the form still displays and submits the original candidate. The new assembly case creates a free `mine` path, so candidate and `freePath` happen to agree and the failing branches are not exercised. Invariant inventory — required invariant: the matching effective resolution owns the displayed, submitted, and executed destination. Boundaries searched: free fresh override, occupied fresh override, containment-refused override, reattach override, dialog display/draft, controller translation, and mutation target. Affected: occupied and containment-refused fresh overrides. Verified safe: a free override where `freePath === candidatePath`, and reattach after its one withdrawal/re-ask.
- Impact: An occupied override reaches the mutation instead of the host-selected suffix and predictably fails after submit; a refused/out-of-root override is shown and posted even though the probe resolved a different in-root path. The exact one-selection/one-target invariant from round-4 B3 remains broken.
- SuggestedFix: Keep the requested candidate separately for the ask identity, but after a matching resolution make `targetOf(effective)` authoritative for `draft.path`, the destination statement, and the create request in every mode. Add assembled occupied and containment-refused override walks where the candidate differs from `freePath`.
- Status: accepted
- Triage: Persists from round-4 B3 at the same severity. The bounded hypothesis closes the reattach branch and its re-ask converges, but it leaves the fresh override as a second destination owner — including the exact occupied branch round 4 named. This is the third failed patch-level attempt on B3, so handback is mandatory.
- Author-Triage: Accepted, third attempt and I will not take a fourth. Confirmed by reading: `stated = overridden ? draft.path : resolvedPath` keeps the user's spelling over `targetOf(effective)` whenever `pathIsDerived` is false, so a candidate the host suffixed past (occupied) or refused (resolved containment) is still what the form displays and submits. My assembly walk picked a free override, where candidate and answer agree, so it could not see it.
### B7
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:1250`
- Title: A departed opening can still post from a captured owner after the map releases it
- Evidence: `answerCreateProbe` captures the `Opening` object before awaiting its refs read and all later checks consult only that retained object's `latestSeq`. A whole-tree rebuild can remove the map entry through `forgetDepartedRepos`, but it does not mutate the captured object; the checks after the refs, corroboration, and base awaits therefore still pass and the stale function posts. The controller does not rotate the dialog token merely because a repository left the rebuilt tree, so an already-open dialog can accept that response. Invariant inventory — required invariant: a probe may answer only while its token still owns the current surface+repository opening at every async boundary. Boundaries searched: dispatch, refs await, corroboration await, base await, whole-tree departure, opening supersession, detach, dispose, controller token. Affected: repository departure during any probe await. Verified safe: probes unowned at dispatch, O(1) supersession in the map, map release on departure, surface detach, dispose, and superseded-token rejection at the controller.
- Impact: The map is bounded, but a repository that no longer exists in the workspace can still classify and enable its live dialog from stale repository facts; a subsequent create is refused only when the host can no longer find the repository. The semantic ownership half of round-4 B7 is not closed.
- SuggestedFix: After every await and immediately before posting, require `openingFor(surface, msg.repoId, msg.token) === opening`; return when the current slot was replaced or removed. Add a deferred-read test that removes the repository while the probe is suspended and asserts no resolution is posted.
- Status: accepted
- Triage: Persists from round-4 B7 at the same severity. Storage growth and O(R²) retirement are fixed, but the ownership inventory expands to the after-await departure boundary. Patch-level lifecycle repair has again left one boundary behind, reinforcing the mandatory handback.
- Author-Triage: Accepted. `answerCreateProbe` captures the `Opening` object before its awaits and every later check reads that capture, so deleting the map entry cannot invalidate a continuation already holding it — `forgetDepartedRepos` bounds memory and not authority. The identity re-check the chair names is right, and it is a different property from the one `openingsHeld()` witnesses.
### B10
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-frontend`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:1367`
- Title: Detached selections can submit after only the branch-level defaults answer
- Evidence: A settled detached base or destination edit arms both gates and sends both the branch-only defaults request and the full probe. The defaults callback clears `outstanding`, while the submit condition explicitly exempts detached mode from `resolutionOutstanding`; the resolution callback also returns without applying detached answers. If defaults arrives first, `unasked` is already false because the full selection was recorded as asked, so Create opens without the latest full-selection resolution. Invariant inventory — required invariant: only the matching full-selection answer may clear the submit gate for fields that answer controls. Boundaries searched: detached base/path edits, defaults reply, resolution reply, drift key, and submit. Affected: detached selections, especially destination overrides. Verified safe: non-detached modes remain behind `resolutionOutstanding` until an answer lands.
- Impact: An occupied or refused detached override can be submitted using its unresolved candidate before the host's exact answer arrives, restoring the stale-submit window this change is meant to eliminate.
- SuggestedFix: Do not exempt detached mode from the full-selection resolution gate. Apply the resolution's destination and any applicable verdict while preserving the user's detached mode instead of discarding the whole answer; the narrower defaults reply must not clear that gate.
- Status: open
- Triage: New inside the accepted exact-selection and submit-gate impact cone. It is gating because it bypasses the new gate on a supported create mode.
- Author-Triage: Accepted, and it is the finding that settles the handback. The fix is not local: D5 makes the detached toggle the user's own and says it OUTRANKS a classification of the typed text, which is why the resolution applier discards an answer under detached; consuming that answer's DESTINATION while discarding its MODE is a new rule about what a resolution owns, and D8 currently says one effective resolution drives the form. That is a changed `D#`, so it fails the obligation test and is a plan decision rather than a fix commit.
### W7
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-frontend`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/extension.worktreeAssembly.test.ts:1336`
- Title: The assembly gate still avoids both override branches that distinguish candidate from target
- Evidence: The reattach case begins after the mode has already disabled the path and never establishes a standing override that must be withdrawn and re-asked. The fresh case chooses a nonexistent `mine` path, so it never produces `occupiedCandidate.path !== freePath`. Task 6_2 and round-4 W7 explicitly required the occupied fresh branch, and the production walk remains green while B3 survives there.
- Impact: The cross-boundary gate still cannot fail when the displayed and posted override differ from the resolution's actual target.
- SuggestedFix: Add assembled walks that make a fresh override occupied and that land reattach while an override is standing. Assert the intermediate gate/re-ask and final displayed path = posted path = issued target.
- Status: accepted
- Triage: Persists from round-4 W7. The added tests cover a free override and an already-disabled repair field, not the two discriminating branches the prior finding named. Non-gating, but it explains the green gate over B3.
- Author-Triage: Accepted, and it is the reason the gate stayed green over B3 twice. An override walk that does not make candidate and resolved target DIFFER asserts agreement between two values that were never going to disagree.
## Prior findings resolved in this verification

- B9 — fixed: the controller applies a resolution only when `msg.seq === probeSeq`, so an answer older than the latest question cannot validate a newer base selection.
- W8 — fixed: one map slot is replaced in O(1) per surface+repository, and the departure sweep runs once per whole-tree rebuild rather than once per refs request.
- S1 — fixed: `recordFor` holds one match and returns on the second, preserving O(W) time with O(1) extra memory and fail-closed duplicate handling.

## Audit backlog

None.
