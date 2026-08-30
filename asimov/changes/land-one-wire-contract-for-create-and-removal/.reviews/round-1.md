# Review Round 1

- Date: 2026-08-30
- Cycle: 1
- Mode: discovery
- Request lane: fastlane
- Scope: range `dc925375~1..10e3dd648d54539fbe07a58dacd3cfd7680cd0a0`
- Head: `10e3dd648d54539fbe07a58dacd3cfd7680cd0a0` (working tree dirty; explicit range reviewed, with pre-existing dirty analytics and out-of-scope UI docs excluded)
- Reviewable lines: 894
- Large change: accuracy may decrease
- Agents spawned:
  - `asm-review-contracts`: create wire boundary and union contracts — `gpt-5.6-sol[1M]`
  - `asm-review-frontend`: destructive removal rendering — `gpt-5.6-terra[1M]`
  - `asm-review-logic`: create mapping, path intent, removal projection — `sonnet[1M]`
  - `asm-review-data-security`: untrusted create inputs and authorization — `gpt-5.6-luna[1M]`
  - `asm-finder`: full create/removal flow trace — `gpt-5.6-luna[1M]`
- Agents skipped:
  - `asm-review-performance`: no persistence, unbounded collection, recompute loop, or hot-path growth axis changed
  - `asm-review-reuse`: no material helper reimplementation or split-cohesion risk identified
- Verification evidence: `bun run asm change verify-status land-one-wire-contract-for-create-and-removal` reports exit 0 for tasks 1_1 through 1_5, with recorded scope-change annotations; no verify command or test suite was run by review
- Verdict: BLOCK
- Counts: 2 BLOCK, 2 WARN, 0 SUGGEST
- Split: 2 feature blockers / 0 machinery blockers

## Findings

### B1

- ID: B1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts`, `asm-review-data-security`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:926`
- Title: Unredeemed destination disposition crosses the host boundary
- Evidence: The `worktreeCreate` boundary validates only `msg.mode` and `msg.afterCreate`, then delegates `msg.disposition` unchanged. `intentFor` treats any `kind !== "debris"` as the mode's ordinary rule, while a forged `{ kind: "debris" }` selects `mustMatchDebrisAuthorization`. `validateCreatePath` uses that intent to allow an existing non-empty directory but never compares `authorization.path`, validates the fingerprint, or redeems it against a host-issued record. This task deliberately has no debris producer or redemption store, so the only safe currently implemented inbound disposition is `free`.
- Impact: A hand-sent WebView message can weaken the destination rule with an authorization the host never issued, violating the new serialized contract before capability/git work. It also leaves malformed or missing dispositions to silent coercion or downstream failure instead of failing closed at the boundary.
- SuggestedFix: Add a runtime disposition guard. Until the debris producer/store lands, reject `debris` entirely and accept only the exact `free` variant. When debris is implemented, redeem its host-issued fingerprint and verify the authorized path before delegating, with boundary tests for missing, unknown, malformed, and forged variants.
- Status: accepted
- Triage: Accepted, verified independently before the report landed. `intentFor` returns `mustMatchDebrisAuthorization` for any `disposition.kind === "debris"`, and `createPath.ts:220` computes `mustBeEmpty: exists && intent.kind === "mustBeFreeOrEmpty"` — so a forged debris variant deletes the emptiness requirement on a `fresh` mode, which is the one mode that reaches git. `CreatePathIntent`'s own doc comment says redemption "happens before this is called", and this change ships no caller that does it. This is exactly the failure D1's third paragraph exists to prevent, so fixing it completes an accepted decision rather than changing one — remediation, no new D#.

### B2

- ID: B2
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts`, `asm-review-data-security`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:858`
- Title: After-create validation accepts malformed union variants
- Evidence: `WorktreeAfterCreate` requires `waitForSetup: boolean` on the `agent` variant, but `isKnownAfterCreate` checks only a non-empty `agent`. A payload with a valid current offer and agent but no/non-boolean `waitForSetup` passes `admissibleLaunch` and reaches create execution. The four non-agent arms return true without rejecting agent-only fields. The prior host test that rejected launch details riding a non-launch mode was deleted even though `postMessage` erases TypeScript's union.
- Impact: Malformed inbound requests can create a worktree and enter the asynchronous after-create flow despite violating the declared wire contract. The setup sequencing flag can be silently absent/coerced, and cross-variant launch data is ignored rather than rejected as the accepted boundary rule requires.
- SuggestedFix: Validate the complete runtime variant: require boolean `waitForSetup` and valid optional launch-field types for `agent`; reject agent-only fields on every non-agent kind. Restore host-boundary tests for missing required fields and forbidden cross-variant fields.
- Status: accepted
- Triage: Accepted. Confirmed at `WorktreeHost.ts:872`: the `agent` arm checks only `typeof a.agent === "string" && a.agent.length > 0`, and `admissibleLaunch` never reads `waitForSetup`. The chair is also right about the deleted test: task 1_2's `--test-change` rationale argued the union makes the arrangement unrepresentable, which is true of our own code and false across `postMessage`. That was my error, not the reviewer's — D1 says the union removes the inference, not the boundary check.

### W1

- ID: W1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-contracts`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:831`
- Title: Create-mode validation does not preserve structurally absent fields
- Evidence: `isKnownCreateMode` checks required fields but never rejects fields prohibited by a variant. For example, `reuse` with `baseRef` and `fresh-detached` with `branch` both pass and are delegated unflattened, after which `sourceOf` silently ignores the forbidden member.
- Impact: The mode union's safety property holds only for typed producers, not at the serialized boundary it was introduced to protect. Malformed requests are accepted with ambiguous data rather than rejected.
- SuggestedFix: Make each runtime mode arm exact with respect to variant-specific fields and add host-boundary cases mirroring the compile-time negative assertions.
- Status: accepted
- Triage: Accepted as must-fix rather than should-fix, because it is the same defect as B1 and B2 in the same function and the fix is one exact-shape pass over all three validators. `messages.contract.test.ts` already proves these shapes cannot be built by a typed producer; the host-boundary tests will mirror those negative cases across the serialized edge where the type is gone.

### W2

- ID: W2
- Severity: WARN
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-frontend`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeRemoveDialog.ts:169`
- Title: Unproven checks fall into an empty force-removal confirmation
- Evidence: `isRefusedByChecks` treats only `failed` refusal checks as refusing, while `buildBlockerList` renders only failed checks or positive counts. A valid `unproven` refusal or confirmable check therefore selects the confirmation branch, contributes no blocker line, and exposes `Force remove`, contrary to accepted D5's rule that unproven renders where its failed form rendered. The current mutation service still routes unavailable assessments through its separate retry result, so this valid wire outcome is not yet produced on the shipped dialog path; the defect is in the new renderer contract that later removal tasks will consume.
- Impact: Once an unproven check is carried in the removal report, the irreversible action can be presented as an unexplained ordinary confirmation; an unproven refusal would fail to suppress force.
- SuggestedFix: Define UI handling by class and outcome: unproven refusal must refuse, unproven confirmable must be named in the confirmation, and neither may disappear. Add DOM tests for unproven refusal and confirmable checks, including danger-button availability.
- Status: accepted
- Triage: Accepted, but split by ownership after costing the fix. The finding is real and my first triage understated it: making an `unproven` check render "where its `failed` form rendered" needs a magnitude the check does not carry and a refusal sentence for "the risk could not be read" — new user-visible copy, which this change's proposal lists under Must not and which WT-013.4 ("The Report Is Legible Before It Is Dangerous") owns. Routing unproven into the existing refusal chain is worse than nothing: its `else` arm renders agent copy, so an unreadable status would tell the user to stop an agent that is not running. What lands HERE is the prose-free half, which is also the dangerous half: the dialog withholds "Force remove" whenever any check is unproven, so the empty blocker list can no longer sit above a destructive button. No reachable rendering moves — `checksFor` emits `unproven` only for an `unavailable` assessment, which the service answers elsewhere — and the case fails closed instead of open when WT-013.1 first routes one here.

## Accepted risk

None.

## Audit backlog

None.
