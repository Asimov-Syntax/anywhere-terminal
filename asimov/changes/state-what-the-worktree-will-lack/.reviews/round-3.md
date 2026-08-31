# Review Round 3

- Date: 2026-08-31
- Cycle: 1
- Mode: verification
- Review lane: fastlane
- Scope: range `48b1ee7eb75a5c13362479d5d08ec045af7d00f6..f25ad8d53e97a92bf2e514a1d7886e9b0ecc4a33`
- Previous round Head: `48b1ee7eb75a5c13362479d5d08ec045af7d00f6`
- Head: `f25ad8d53e97a92bf2e514a1d7886e9b0ecc4a33` (tree dirty after the reviewed range: `asimov/changes/state-what-the-worktree-will-lack/analytics.json`)
- Scope lock: passed — the range contains only accepted round-2 remediation, regression tests, and task/workflow metadata
- Reviewable lines: 380
- Recorded Verify Gate: `.build/verified.ndjson` records exit 0 for tasks 3_1 through 3_3; the coordinator additionally reports type check, 5,625 tests, I10, and `asm change verify-status` passing; review ran no project verify command
- Agents spawned:
  - `asm-review-logic` — opening generation and offer lifetime — `gpt-5.6-sol[1M]`
  - `asm-review-data-security` — scan/model budgets and containment classification — `gpt-5.6-terra[1M]`
  - `asm-review-frontend` — checkbox handler and stale webview cache — `sonnet[1M]`
- Agents skipped:
  - `asm-review-contracts` — W4's final-offer contract verified directly by chair
  - `asm-review-performance` — B7's named growth axes covered by data-security
  - `asm-review-reuse` — no new duplication or competing primitive in the remediation cone
- Verdict: REJECT
- Counts: 3 BLOCK, 0 WARN, 0 SUGGEST
- Cycle state: round 3 is the final verification round in cycle 1. The remaining blockers require handback to planning/build; the next user-initiated review starts cycle 2 in discovery mode.

## Prior finding disposition

### B5
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:1160`
- Title: Host-local generations still do not bind a result to the webview's live opening
- Evidence: The generation is minted only after the host processes a branch-less request and is never carried on the wire. On reopen, the controller clears its cache and asynchronously posts the new request; the predecessor read can resolve after the clear but before the host receives that request, while its host-local generation remains current. Its untagged offer is then accepted by `handleProvisionOffer`, cached, and can seed the reopened dialog. If the successor read rejects, the predecessor model remains. The regression test calls both host requests directly before releasing either read, so it excludes this cross-webview/host ordering. In addition, every duplicate or forged branch-less request is treated as a new generation and starts another concurrent read; no identity distinguishes a new form from a duplicate request for the current one.
- Impact: A reopened form can still inherit its predecessor's model, and repeated branch-less messages can suppress the legitimate result or create unbounded concurrent reads.
- SuggestedFix: Mint the opening identity in the controller, include it in opening requests, echo it on defaults and offer replies, and reject any reply not matching the controller's live identity. Deduplicate reads by `(surface, repo, openingId)` so duplicate requests for one opening join or are ignored while a distinct opening starts a new read.
- Status: persists from round 2
- Triage: accepted; the remediation protects host-processed generations but not the cross-process opening identity

### B6
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:1169`
- Title: Cancelled and submitted forms still publish late provisioning results
- Evidence: The completion guard checks host disposal, surface attachment, and whether a later branch-less request replaced the host slot. Normal cancel and submit perform none of those transitions: `WorktreeView.ts:558-564` only closes the dialog. A read owned by that dead form can therefore call `offers.issue`, post the offer, and be retained by `WorktreeController.handleProvisionOffer`; the disposed dialog's callback also remains bound. Clearing the cache at the next open happens after this publication and cannot make the dead owner publish nothing.
- Impact: A dead form still mints host authority and leaves controller/host state until detach or another opening, violating the accepted form-lifetime invariant and leaving no basis for safe redemption in WT-012.2.
- SuggestedFix: Return the close/opening-identity contract to planning. Add an explicit close/invalidation transition, or an equivalent controller-owned opening capability whose retirement on cancel/submit is communicated to the host and checked before both issue and acceptance.
- Status: persists from round 2
- Triage: accepted-modified; the stale-reopen cache was fixed, but the disclosed normal-close residual remains at the original invariant boundary

### B7
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/asimovProvider.ts:436`
- Title: The model-wide row budget still bypasses problem-producing paths
- Evidence: Production directory enumeration is now streamed and capped, and selected entry/port/setup paths consult `full()`. However, every unknown top-level key at lines 436-439 appends directly to `draft.problems`; a file containing only unknown keys never calls `full()` at all. Malformed `copy`/`link` list values and wrong-shape `ports`/`setup` also have direct problem pushes that bypass the shared budget. This boundary was explicitly named in round 2 and in task 3_2's requirement that one cap span every emitted problem. Tests cover escaping-match problems and valid ports, but not unknown-key or general malformed-problem overflow. Invariant inventory — verified safe: production directory materialization, per-glob scan count, accepted entries, ports, setup, and escaping-match problems; still affected: unknown-key and direct malformed/unreadable problem paths.
- Impact: A provider file within the 256 KiB byte limit can still emit thousands of problem rows, producing a model/postMessage/DOM payload far above `MAX_MODEL_ROWS` despite the enforced-cap claim.
- SuggestedFix: Centralize every model/problem append behind budget-aware helpers. Once capped, skip all remaining sections and retain exactly one cap problem. Add cases with more than `MAX_MODEL_ROWS` unknown keys and non-string copy entries, plus malformed collection shapes after a nearly full draft.
- Status: persists from round 2
- Triage: accepted; remediation remains incomplete at the same previously inventoried boundary

### W4
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: `asm-review-contracts`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/offerStore.ts:116`
- Title: Item identity is minted inside one adapter rather than at final offer assembly
- Evidence: `issue()` now clones the completed model and remints every selectable entry, port, and setup step from a store-wide opaque counter. Tests combine colliding adapter-local ids, verify uniqueness and field preservation, and verify no reuse across offers.
- Impact: Merged models cannot expose ambiguous selectable ids through an issued offer.
- SuggestedFix: none
- Status: fixed
- Triage: accepted in round 2; verified fixed in round 3

### W5
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-frontend`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:509`
- Title: Every redraw adds another persistent checkbox change listener
- Evidence: The delegated listener is registered once and resolves `checkedByOffer.get(drawnOfferId)` at event time. Cross-repository coverage uses two offers whose adapter-local ids overlap; no old per-redraw listener remains.
- Impact: Checkbox updates remain isolated to the currently drawn offer without listener growth.
- SuggestedFix: none
- Status: fixed
- Triage: accepted in round 2; verified fixed in round 3

### W6
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-data-security`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/asimovProvider.ts:202`
- Title: Filesystem resolution failures are reported as proven path escapes
- Evidence: `contained()` now distinguishes `inside`, proven `outside`, and `unresolvable`; unresolved paths map to `unreadable` and proven escapes to `malformed`. Tests cover both outcomes and the refusal remains fail-safe.
- Impact: The UI no longer states an escape when resolution merely failed.
- SuggestedFix: none
- Status: fixed
- Triage: accepted in round 2; verified fixed in round 3

## Accepted risk

None.

## Audit backlog

None.

## Author triage (round 3)

The chair's per-finding `Status`/`Triage` lines above are its own. This section records the author's disposition. No fix edit was made in this round — the thrash stop fired before the first one.

### B5 — accepted
Verified against the code. The window is real and is not the one the round-2 regression test covers: `WorktreeController.openCreateForRepo` clears `provisionOffers` and posts `requestWorktreeCreateDefaults` from the webview, while `WorktreeHost` bumps `provisionGeneration` only when it *receives* that post. Between those two points the predecessor read can resolve against a generation that is still current, publish, and be accepted by a controller that has already cleared. The test drives both host requests directly, so it never opens that gap.

Cannot be fixed inside the accepted contract. The host has no way to tell "the form that asked" from "a new form" without an opening identity on the wire, and task 3_1's Boundary forbids exactly that: *"no new webview-to-extension message — a form-close transition is a contract change owned by worktree-rpc.md § 2.4, not a review fix."* Fixing it needs a changed `D#` and a new invariant owner (the opening's lifetime), which the remediation boundary puts with `asimov-plan`, not here.

### B6 — accepted
Verified. Cancel and submit dispose the dialog in the webview and send the host nothing, so none of the three guard conditions (host disposed, surface detached, generation superseded) fires. The late read still calls `offers.issue` and posts.

Same owner as B5 and the same handback for the same reason. Worth stating plainly what is and is not at stake today: nothing in this change executes a provisioning model, so a retained offer for a dead form renders nothing and runs nothing. The cost is that WT-012.2 — the first redeemer — would inherit an offer lifetime with no defined close, and redemption is the point at which a stale offer stops being inert.

### B7 — accepted
Verified at two sites, one of them narrower than the report and one wider:
- `asimovProvider.ts:436-439` — the unknown-key loop appends one problem per unrecognized top-level key and never consults `full()`. Confirmed: a file of nothing but unknown keys emits one row each, unbounded by anything but the byte budget.
- `asimovProvider.ts:275-279` — a non-string element in `copy`/`link` pushes its problem and `continue`s *before* reaching the `full()` call on the next line. Confirmed, and not named explicitly in the report.
- The report also lists wrong-shape `ports`/`setup` as bypasses. Those are single pushes for a single malformed top-level value (`ports` not a mapping, `setup` not a list), bounded at one row each. Imprecise, but it does not weaken the finding.

This one IS remediation — bounded emission, no new `D#`, no new invariant owner. It is also the reason the thrash stop fires on a second independent count: round 2's B7 already required *"ONE budget across every emitted collection: entries, ports, setup steps and problems,"* task 3_2 implemented it for three of the four, and the same invariant has now survived two fix attempts.

### Thrash stop
Fired on three independent conditions from `asimov-build` § Review Fix Loop: the cycle's 3rd round still ends with blockers; the same invariant survived 2 fix attempts (B7); and the chair records cycle 1 as capped.

The three options were put to the user and went unanswered for ten minutes (they had said they were going to sleep). Rather than choose for them between a handback and a risk acceptance — neither of which fastlane may auto-choose — the work was split at the line the remediation boundary already draws:

- **B7 closed** as task 3_4 (`450670d4`). It needs no artifact change, and it was going to need fixing under every one of the three options, so doing it now forecloses nothing.
- **B5 and B6 left untouched.** They are one invariant — the opening's lifetime — and closing them requires an identity on the wire that task 3_1's Boundary reserves for `asimov-plan`. Attempting them here would be the remediation-boundary violation the round-2 triage already refused once.

The change therefore stands at 2 open blockers, and the gate that would let it archive is the user's to open. No review round was requested for 3_4: cycle 1 is capped, and the next review starts cycle 2 in discovery mode.

### 3_4, for whoever reviews it next
Every problem append now routes through one `report` helper that consults the budget first, and a capped draft stops rather than walking the remaining sections. Four regression tests: a file of nothing but unknown keys, a `copy` list of non-path elements, exactly one cap row with the later sections skipped, and a malformed collection shape still reported when there is room. Verify Gate re-run on `450670d4`: type check pass, 5,629 tests pass, I10 ok, lint byte-identical to the change base.


## Author triage — thrash-stop resolution (2026-08-31)

The 3rd round of cycle 1 ended with blockers, so the thrash stop applied and the three options went
to the user. They chose **option 1 — hand back to `asimov-plan` for a designed fix**.

- **B5** and **B6** — accepted, and deliberately NOT fixed in this change. They are one invariant:
  a provisioning result must belong to the form that asked for it, and a cancelled or submitted
  form must stop being able to receive one. B6's own SuggestedFix says to return the
  close/opening-identity contract to planning. Closing it requires an opening identity minted in
  the webview and echoed by the host, which mints a **new invariant owner** — so the obligation
  test makes it a separate change, not remediation. Landing it here as a fix commit would close
  this cycle as `superseded` and burn a round for a contract this task's Boundary forbids anyway.
  Owner: docs/PLAN.md **WT-012.16**; WT-012.1 now depends on it and resumes once it lands.
- **B7** — accepted and fixed as task 3_4 (every model and problem append routed through the
  budget-aware helpers, with unknown-key and malformed-shape overflow cases added).

This is not a risk acceptance: nothing ships from this change while the blockers stand, because the
change stays parked rather than being archived.
