# Review Round 3

- **Date**: 2026-08-28
- **Cycle**: 2
- **Mode**: verification
- **Scope**: commit range `08cdbadf..806fd03c` — one commit, `806fd03c fix: report failed agent hook removals`
- **Head**: `806fd03c`
- **Tree state**: dirty during review — only `.analytics-cursor.json` and `analytics.json` modified, both outside the reviewed scope
- **Classification**: 3 reviewable (`AgentHookController.ts`, `agentHookLifecycle.ts`, `extension.ts`), 2 test, rest skipped (asimov artifacts)
- **Reviewable lines**: 111 added across the three production modules
- **Assignments**: 2 — logic (outcome propagation and races) and contracts (outcome shape, settings constant). Cone-sized roster; spawning all six on a 111-line fix diff would be a review defect.
- **Skipped lenses**: data-security, frontend, performance, reuse — the cone touches no filesystem authorization, UI, growth axis, or duplication surface
- **Verdict**: WARN
- **Counts**: 0 BLOCK, 1 WARN, 4 SUGGEST
- **Verify evidence**: task 6_1 recorded in `.build/verified.ndjson` with `bun test agentHookLifecycle.test.ts && pnpm run check-types && pnpm exec vitest run agentHookLifecycle.test.ts AgentHookController.test.ts --maxWorkers=1` exit 0. The chair ran no project verification command; all chair probes were scratch-only, created and deleted in the same command.

## Scope lock

Passed. The diff since round 2 is remediation-only: `setDesiredEnabled` widened to return the settled outcome, `removeAll` aggregating per-agent results, `summarizeAgentHookRemoval` added, and `AGENT_HOOK_SETTINGS` restructured into the single settings source. `tasks.md` gains task 6_1, a remediation task explicitly `Refs`-ing `.reviews/round-2.md B1, W2` — task-completion metadata, not scope. No new capability, no semantically changed contract beyond the accepted fix, and no new invariant owner: the controller already owned per-agent serialization and outcome normalization; this widens what it returns, it does not move ownership.

## Verification of round-2 findings

### B1 — accepted, fixed

Verified at the invariant level across every boundary its round-2 inventory listed, not at the quoted line.

| Boundary | Result |
|---|---|
| Installer outcome | unchanged; still carries `reason`, `affected`, `unresolved` |
| Controller `install`/`uninstall` | unchanged mapping; `not-installed` → success, unresolved paths → failure |
| `runReconciliation` return | now returns the settled `HookReconciliationOutcome` instead of `void`, including on the disposed path |
| `onWarning` sink | unchanged — console routing retained, per the manifest |
| Lifecycle return type | `removeAll()` now `Promise<readonly AgentHookRemovalResult[]>`, each tagged with its agent |
| Command handler | `summarizeAgentHookRemoval` splits success from failure |
| Notification call | `showInformationMessage` only on all-success; `showWarningMessage` otherwise |

Chair probes against the real controller and lifecycle:

- Claude `ownership-conflict` (the exact case round 2 said was reported as success) → `success=false`, message `AnyWhere Terminal could not remove all agent hooks: claude (ownership-conflict: /home/u/.claude/settings.json).` The false success is gone.
- Committed removal leaving lock residue → `success=false` with `affected` ∪ `unresolved` deduplicated into one path list, satisfying D9's "any removal result carrying unresolved paths remains unsuccessful".
- Nothing installed on either agent → `success=true`, information message. `not-installed` is correctly not a failure.
- **Race probe** — a removal issued while an `initialize()` install was still in flight: the removal joined the in-flight `reconcilePromise`, the loop detected the revision bump, continued to the uninstall iteration, and returned *that* outcome (`ownership-conflict`), not the install's. The in-flight-promise sharing in `reconcileLatest` does not leak a foreign iteration's result to `removeAll`.

### W2 — accepted, fixed

`AGENT_HOOK_SETTINGS` is now live and fully qualified. All three values — `anywhereTerminal.cursorAgent.hooks.enabled`, `anywhereTerminal.agentHooks.claude.enabled`, `anywhereTerminal.agentHooks.claudeConfigDir` — match `package.json`'s `contributes.configuration` exactly. Both former hardcoders now route through it: `handleConfigurationChange` reads all three from the constant, and `readAgentHookEnabled` reads `AGENT_HOOK_SETTINGS[agent].enabled`. `AgentHookLifecycleAgent` is derived as `keyof typeof AGENT_HOOK_SETTINGS`. The three-way drift is closed; one residual seam is recorded as S2 below.

### Rebuttals adjudicated

Round 2's build triage rejected W1, W3, and S1-S7. Per the cross-round filter these stay rejected and are not re-reported. Each rebuttal was checked against the code rather than accepted on assertion:

- **W1** (retry loop reports inode drift as `write-failed`) — rebuttal holds. Round 2's own evidence already conceded D3-conformance; the rebuttal declines the extra diagnostic reason and correctly notes re-authorizing per attempt would widen the accepted per-operation snapshot.
- **W3** (Cursor never populates `affected`) — rebuttal holds on its stated ground. The contracts lane re-raised this with a genuine **evidence delta**: the asymmetry is now user-visible, since a failed Cursor removal renders as `cursor (ownership-conflict)` with no path while Claude's renders with one. That delta does not refute the rebuttal's argument, which is about *ownership* — D2 assigns Cursor diagnostics to the independently reviewed inline-Cursor change, and fixing it here would duplicate that lane. Not re-reported; carried to audit backlog so the Cursor lane inherits the visibility fact.
- **S1-S7** — rebuttals hold. S7 correctly cites `proposal.md`'s explicit out-of-scope boundary for fsync durability; the rest are coherent non-gating scope declines.

## Findings

### W1

- **ID**: W1
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `chair`
- **Class**: feature
- **File:line**: `src/agentHooks/AgentHookController.ts:249-259`, surfaced at `src/agentHooks/install/agentHookLifecycle.ts:99-115`
- **Title**: Windows remove-all reports a failure for Claude when D8 guarantees there is nothing to remove
- **Evidence**: `ClaudeHookInstaller.uninstall()` returns `{removed:false, reason:"unsupported-platform"}` on Windows. `AgentHookController.uninstall()` treats every `removed:false` whose reason is not exactly `not-installed` as `success:false`, so `unsupported-platform` becomes a failure. Chair probe with both agents configured on Windows: `summarizeAgentHookRemoval` produced `success=false` and the message `AnyWhere Terminal could not remove all agent hooks: claude (unsupported-platform).` Before this commit the same outcome existed but reached only `console.warn`; B1's remediation promoted it to a `showWarningMessage` dialog.
- **Impact**: D8 states Claude hooks never shipped on Windows and that no cleanup candidate exists, so the honest result there is "nothing to remove". Every Windows user who runs the removal command now gets a warning telling them cleanup failed, and will look for a Claude hook entry that cannot exist. This is the same invariant round-2 B1 named — a user-invoked reconciliation must report its true outcome — violated in the opposite direction. Recorded as a new finding rather than appended to B1 because the causal mechanism differs (a reason-code classification gap, not a discarded result) and the impact is materially different (false alarm rather than false success).
- **SuggestedFix**: Treat `unsupported-platform` as a removal success alongside `not-installed` in `AgentHookController.uninstall()`, since both mean no managed entry exists at the current destination. Alternatively exclude unsupported agents from the removal aggregate. Add a Windows case to `agentHookLifecycle.test.ts`, which currently has none.
- **Status**: accepted
- **Triage**: Accepted. D8 makes Claude `unsupported-platform` equivalent to `not-installed` for removal, so the controller will normalize both as successful absence while preserving genuine failures.
- **Invariant inventory**: A user-invoked reconciliation must report its true outcome at the surface the user sees. Boundaries searched: installer reason vocabulary, controller `uninstall` success mapping, controller `install` success mapping, lifecycle aggregation, summary formatting, notification choice. Affected: the controller's `uninstall` mapping of `unsupported-platform`. Verified safe: `not-installed` maps to success; committed-with-residue maps to failure; every genuine installer failure maps to failure; the install path does not surface to this dialog.

### S1

- **ID**: S1
- **Severity**: SUGGEST
- **Confidence**: HIGH
- **Priority**: P4
- **Agent**: `chair`
- **Class**: machinery
- **File:line**: `src/agentHooks/install/agentHookLifecycle.ts:104-113`
- **Title**: Internal reason codes are rendered verbatim in the user-facing dialog
- **Evidence**: `summarizeAgentHookRemoval` interpolates `result.reason` directly. Reachable values include `ownership-conflict`, `unsupported-config`, `lock-unavailable`, `write-failed`, `lock-release-failed`, `unsupported-platform`, plus the controller's `agent-not-configured`, `controller-not-started`, and `controller-disposed`.
- **Impact**: The message is now a user-facing dialog rather than a log line. `claude (ownership-conflict: /path)` is guessable; `claude (controller-not-started)` is not, and tells the user nothing they can act on.
- **SuggestedFix**: Map the reason vocabulary to short human phrasing at the summary boundary, keeping the raw code in the console warning for diagnostics.
- **Status**: rejected
- **Triage**: Rejected as non-gating copy refinement. Raw reason codes remain useful alongside exact paths, and no accepted contract requires localized user prose.

### S2

- **ID**: S2
- **Severity**: SUGGEST
- **Confidence**: HIGH
- **Priority**: P4
- **Agent**: `chair`
- **Class**: machinery
- **File:line**: `src/agentHooks/install/agentHookLifecycle.ts:86-88`
- **Title**: `agents()` still hardcodes the agent list instead of deriving it from `AGENT_HOOK_SETTINGS`
- **Evidence**: W2's fix made `AGENT_HOOK_SETTINGS` the source for setting keys and for `AgentHookLifecycleAgent`, but `private agents(): readonly AgentHookLifecycleAgent[] { return ["cursor", "claude"]; }` remains a separate literal. Because its return type is the derived union, adding a third agent to the constant would compile cleanly while silently omitting that agent from `reconcileAll()` and `removeAll()`.
- **Impact**: A residual instance of exactly the drift seam W2 closed elsewhere. No current defect — the two lists agree today.
- **SuggestedFix**: `return Object.keys(AGENT_HOOK_SETTINGS) as readonly AgentHookLifecycleAgent[]`.
- **Status**: rejected
- **Triage**: Rejected as a latent future-agent seam with no current defect; the fixed two-agent vocabulary is already bounded by the accepted design.

### S3

- **ID**: S3
- **Severity**: SUGGEST
- **Confidence**: HIGH
- **Priority**: P4
- **Agent**: `asm-review-contracts`
- **Class**: machinery
- **File:line**: `src/agentHooks/AgentHookController.ts:59-67`
- **Title**: Three overlapping outcome shapes are now exported from one module without a distinguishing comment
- **Evidence**: `HookInstallOutcome` (`installed`, optional `reason`), `HookRemoveOutcome` (`removed`, optional `reason`), and the newly exported `HookReconciliationOutcome` (`success`, required `reason: string`) are structurally similar, non-interchangeable, and differ in both flag name and `reason` optionality. `HookReconciliationOutcome` was private as `ControllerOutcome` until this commit.
- **Impact**: A consumer importing from this module has three plausible-looking outcome types and no in-source signal that the third is the controller-normalized shape rather than a fourth installer variant.
- **SuggestedFix**: Add a doc comment on `HookReconciliationOutcome` stating it is the controller-normalized result of a reconciliation, derived from the two installer outcomes.
- **Status**: rejected
- **Triage**: Rejected as non-gating documentation polish; the distinct flag names and exported interfaces already prevent structural interchange.

### S4

- **ID**: S4
- **Severity**: SUGGEST
- **Confidence**: HIGH
- **Priority**: P5
- **Agent**: `asm-review-contracts`, `chair`
- **Class**: machinery
- **File:line**: `src/agentHooks/install/agentHookLifecycle.ts:59-64`
- **Title**: Outcome spread follows the `agent` key in the removal result literal
- **Evidence**: `{ agent, ...(await this.options.controller.setDesiredEnabled(agent, false)) }` places the spread last, so a future `HookReconciliationOutcome` field named `agent` would override the intended value. The contracts lane correctly notes the risk is bounded: `AgentHookRemovalResult extends HookReconciliationOutcome` with `agent: AgentHookLifecycleAgent` would force a compile error if the base gained an incompatible `agent` field.
- **Impact**: Latent shape only; no current defect.
- **SuggestedFix**: `{ ...outcome, agent }`.
- **Status**: rejected
- **Triage**: Rejected as a compiler-bounded hypothetical with no current `agent` field in the normalized outcome.

## Specialist adjudication

- **Logic lane returned no findings** and answered all six verification questions. Its Q1 conclusion — that no production caller bypasses the lifecycle queue and an in-flight initialization reconcile loops to the removal revision before resolving — was independently confirmed by the chair's race probe.
- **The logic lane's Q3 answer is refuted in part.** It asserted "All removal failures preserve a remaining actionable condition." The chair's Windows probe shows `unsupported-platform` produces a user-facing failure with no actionable condition behind it, because D8 guarantees no Claude hook can exist on Windows. The lane noted the `unsupported-platform` mapping as a fact under Q2 but did not carry it into Q3's claim. Evidence over role: W1 stands.
- **The contracts lane's WARN is the round-2 W3 finding**, which the build rejected on D2 ownership grounds. Its evidence delta (now user-visible) is real and recorded, but does not defeat the rebuttal's argument about which change owns the fix. Kept rejected, not re-reported, carried to audit backlog.
- The contracts lane's two SUGGESTs are new, in-cone, and accepted as S3 and S4. S4 merges with an independent chair observation; the lane's refinement about the `extends` clause bounding the risk is adopted.
- No user-granted accepted risk applies to any finding in this round.

## Audit backlog

Carried forward; non-gating. Re-list at the next discovery round, never re-report as new.

- **AB1** (round 2) — `acquireLock` runs `mkdir -p` before the path is classified; a symlinked ancestor can be traversed to create directories. No user bytes at risk.
- **AB2** (round 2) — `design.md`'s Failure Surface Inventory claims non-cooperating drift fails "without overwrite", marginally stronger than any Node implementation can deliver. Documentation precision.
- **AB3** (round 2) — task 5_3 step 2 required retaining `src/cursor/CursorHookController.{ts,test.ts}`; neither exists at HEAD. The capability is correctly owned by the generic controller per D1/D2. Stale plan text, right outcome.
- **AB4** (new) — round-2 W3's Cursor `affected` asymmetry is now user-visible: a failed Cursor removal renders without a path while an equivalent Claude failure renders with one. W3 remains rejected here on D2 ownership grounds; the inline-Cursor lane should inherit this visibility fact when it next touches Cursor outcome shapes.
- **AB5** (round 2) — the frozen-command/harness lens never ran a specialist pass; both spawn attempts died on an API stream disconnect and the chair covered the accepted D7/D10 obligations directly. The next discovery round should re-run this lens rather than treat D7/D10 as fully swept.

## Sub-agents spawned

- `asm-review-logic` — removal outcome propagation, races, revocation ordering — `gpt-5.6-terra[1M]` — no findings
- `asm-review-contracts` — outcome contract shape, settings constant, summary formatting — `sonnet[1M]` — 1 WARN (adjudicated to rejected-W3 carry-forward), 2 SUGGEST
