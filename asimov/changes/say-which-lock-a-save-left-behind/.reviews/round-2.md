# Review Round 2

- Date: 2026-09-02
- Cycle: 2
- Round: 2
- Mode: discovery
- Review profile: fastlane
- Lane: full
- Scope: range `a8252482..HEAD`
- Head: `d8c73c32934ed6694139b5bec75478bb3121022a` (the committed range was reviewed; review accounting left only the change's generated analytics dirty)
- Reviewable lines: 427 (251 production-code churn plus 176 lines of tracked change analytics; tests and Markdown artifacts classified separately)
- Intent obligations: Gate 2 was re-earned after revised D4 introduced the required `writeOutcome` carrier. Applicable anchors were D1-D6, tasks 2_1/2_2, the worktree-panel delta, round-1 accepted findings, and the supplied impact manifest.
- Escalation flags: `new-api-contract`, `security-privacy`, `re-review`
- Agents spawned:
  - `asm-review-data-security` — pathless lock residue and warning sinks — `gpt-5.6-sol[1M]`
  - `asm-review-logic` — controller residue signal and authority — `gpt-5.6-terra[1M]`
  - `asm-review-logic` — Cursor cleanup state machine — `gpt-5.6-luna[1M]`
  - `asm-review-contracts` — discriminated `ProvisionProblem` wire and consumers — `sonnet[1M]`
  - `asm-review-frontend` — all save-summary combinations — `gpt-5.6-luna[1M]`
  - `asm-review-performance` — repeated failed-refresh accumulation — `gpt-5.6-luna[1M]`
- Supporting trace: `asm-finder` — hook outcome producers/signals/sinks and `ProvisionProblem` transformations — `gpt-5.6-luna[1M]`
- Agents skipped:
  - `asm-review-reuse` — round-1 F003 is a direct removal of the duplicate predicate; this range adds no new helper, parser, validator, or split needing a separate reuse assignment
- Recorded verification: `bun run asm change verify-status say-which-lock-a-save-left-behind` reports tasks 1_1 through 2_2 at exit 0. The review ran no project verification command.
- Verdict: BLOCK
- Counts: BLOCK 1 | WARN 0 | SUGGEST 0
- Blocking split: 1 feature | 0 machinery

## Prior finding dispositions

### F001

- ID: F001
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, `asm-review-data-security`
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/agentHooks/install/ClaudeHookInstaller.ts:105`
- title: Installer warnings still expose reboundable lock pathnames
- status: fixed
- triage: Both Claude arms are closed: lock acquisition reports only the configuration path, and release failure records only `lock-release-failed`. The same invariant was inventoried through Cursor's acquisition and release arms; its remaining `unresolved` entries are the user's config/wrapper files, never the advisory lock. Controller and lifecycle display sinks receive no lock path.

### F002

- ID: F002
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, `asm-review-frontend`
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:689`
- title: The new summary is hidden on real models and falsely calls no-op saves saved
- status: fixed
- triage: The two original mechanisms close: `saveSummary` runs before the content-count return, and the required `writeOutcome` member preserves written/unchanged/refused from `NativeConfigWrite` through `WorktreeHost` to the renderer. Populated witnesses cover all three strings. F004 below is a different mechanism: old post-save reports retained by the failed-reread fallback can overrule the newly preserved current outcome.

### F003

- ID: F003
- severity: SUGGEST
- confidence: HIGH
- priority: P3
- agent: `asm-review-reuse`
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/agentHooks/install/ClaudeHookInstaller.ts:4`
- title: Reuse the shared identity predicate in the changed installer
- status: fixed
- triage: `ClaudeHookInstaller` now imports `FileIdentity` and `sameIdentity` and removes its local duplicate without widening the pre-existing stat-capture contract.

## Findings

### F004

- ID: F004
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, `asm-review-performance`
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:2544`
- title: Failed refreshes retain older save outcomes that overrule the current one
- evidence: On a rejected post-save reread, `base` is the previously shown offer at line 2544. `refusedSave()` and `leftLocked()` both append to `model.problems` rather than replacing the previous post-save report (lines 167-176 and 203-215), and `offerStore.issue()` stores that augmented model as the next redeemable `shown` value. A second failed-reread save therefore carries both attempts. `saveSummary()` aggregates the whole history with existential precedence: any stale `unsaved` wins at lines 754-756, any stale `locked/refused` wins at lines 762-763, and any stale `locked/written` wins over a current `unchanged` at lines 765-767. For example, a first `written`+`movedAway` release can publish `locked/written`; a second no-op can acquire the now-free canonical name, fail its reread, append `locked/unchanged`, and still render `Saved, may still be locked`. A prior lock-unavailable attempt followed by a later written attempt similarly leaves stale `unsaved` and renders `Not saved`. No changed host or renderer witness submits a second save after a failed reread.
- impact: The required discriminator reaches the renderer correctly, but the renderer can report an older attempt instead of the current one. The `problems` array also grows once per save whose reread keeps failing, with no structural cap on the per-opening/per-failed-attempt axis; stale details and IPC payload size accumulate alongside the wrong summary.
- suggestedFix: Treat post-save problems as latest-attempt state rather than append-only history. Before publishing from the `shown` fallback, replace the previous save-generated report with the current refusal/lock report while preserving genuine read problems; if save-generated `malformed` cannot be distinguished from read-generated `malformed`, give transient save diagnostics an explicit owner/carrier instead of inferring from reason text. Add a two-save witness with both rereads rejected for at least `written -> unchanged` and `refused -> written`, asserting one current save report and the current attempt's summary.
- status: open
- author triage: pending
- triage: New cycle-2 discovery blocker. This is not round-1 F002 recurring: the early return and missing discriminator are fixed. The new causal mechanism is the failed-reread fallback carrying prior transient outcomes into the next offer, combined with `saveSummary` aggregating all retained outcomes.
- invariant: A provisioning offer contains at most one current post-save outcome, and the summary is derived from that latest attempt rather than any earlier failed-refresh history.
- growth axis: one appended problem per save attempt while post-save `readProvisioning` rejects, scoped to a live opening but not structurally capped within it
- boundary inventory:
  - affected: repeated save after a failed reread; `written -> unchanged`, `unchanged -> written`, `refused -> written`, and repeated refusals; offer-store retention; summary aggregation; detail-row and IPC growth
  - verified safe: first save attempt; any attempt whose reread succeeds and supplies a fresh model; a newer source switch that suppresses publication; disposal/closed-surface guards
  - not safe: every sequence where the previously published fallback already contains a save-generated problem and the next post-save reread rejects again

## Full-flow trace

- Claude and Cursor installers now return only configuration/wrapper paths. Acquisition failure, ordinary write failure, release failure, unsupported-platform cleanup, legacy-wrapper residue, and not-installed paths were traced through `AgentHookController`, `AgentHookLifecycle`, extension logging, and removal summaries.
- `leftResidue` is correct for every current producer. Clean committed outcomes use no reason; the ordinary remove answers are `not-installed` and `unsupported-platform`; pathless `lock-release-failed` and the two legacy-wrapper reasons are residue. Failed install/remove outcomes bypass the committed-outcome branch and already warn through `success: false`.
- The only other stateful `unresolved` consumer is Cursor's Windows cleanup bridge. Its `not-installed` case becomes the ordinary unsupported-platform answer, while pathless `lock-release-failed` survives. `AgentHookLifecycle.summarizeAgentHookRemoval` and both warning formatters consume `affected`/`unresolved` only as display lists after controller success has already been decided.
- `ProvisionProblem` is preserved by object spread and structured message delivery; there is no serializer, validator, cache projection, or clone that drops `writeOutcome`. The read-side factory is correctly narrowed to non-lock reasons. `WorktreeHost` is the only locked producer and maps all three writer outcomes exactly.
- The single-attempt UI table is correct on populated models: written, unchanged, and refused are reachable; refusal precedence holds; generic details remain visible and use `textContent`. The open gap is the cold failed-reread path across more than one attempt, recorded as F004.

## Inline support review

- Changed tests contain no `.only` or `.skip`; asynchronous tests use the existing awaited controller/host settlement boundaries.
- Controller witnesses cover a pathless install release warning and pathless uninstall authority withholding. Cursor witnesses cover supported and Windows cleanup paths without lock names.
- Contract tests require `writeOutcome` on locked problems and prove no `lockPath` member is emitted. Host tests witness each writer-to-wire mapping; renderer tests witness all three single-attempt summaries on populated models.
- No test covers a second save using an offer produced by the failed-reread fallback, which is the F004 witness gap.
- No changed fixture contains secrets, and no seed/destructive support path changed.

## Adjudication notes

- No finding survives against `leftResidue`'s exclusion list. For current in-repo producers, every non-empty reason reaching the committed branch is either lock residue or legacy-wrapper residue; ordinary failures are handled before the helper, and the two ordinary removal answers are explicitly excluded.
- No additional `unresolved`/`affected` signal consumer was found beyond the three named controller sites and Cursor's Windows cleanup predicate. The lifecycle and warning sites only format lists.
- A co-present read problem plus a current lock outcome was not reported separately: this section already summarizes selected work rather than every problem, detail rows remain visible, and approved D4 explicitly gives the current save outcome its own summary. F004 is different because it substitutes an older save outcome for the current one.

## Author triage

### F004 — accepted

Not rebutted; reproduced by reading the publish site. `base = reread ?? shown` at
`WorktreeHost.ts:2544` falls back to the model ALREADY PUBLISHED, which carries the previous save's
appended problems, and both `refusedSave` (`:167-176`) and `leftLocked` (`:202-216`) append rather
than replace. Two saves with failing rereads therefore leave two reports about one file, and
`saveSummary` reads the stale one.

Remediation, not a handback: the accepted spec already governs what THIS save is shown as
("WHERE a save wrote the file and then could not release its lock, what the user is shown SHALL say
the file was written"), so making post-save diagnostics latest-attempt state serves the requirement
rather than changing it. No `D#` moves and no new invariant owner is minted.

### F005 — accepted, NOT reported by the chair

Added by the author. `asm-review-frontend` raised it as a WARN and the chair's report carries it
neither as a finding nor as a warning — its "Requested probes" section states that all three
single-attempt summaries are correct. That is wrong, and the counterexample is a single attempt:

| problems | old answer | shipped answer |
|---|---|---|
| `malformed` + `locked/written` | `Could not be read` | `Saved, may still be locked` |

The old code read `model.problems.every((p) => p.reason === "locked")`. Task 2_2 replaced it with a
`filter` and a `some`, and that `every` was load-bearing: it said the lock answer applies only when
the lock is the ONLY kind of problem. Without it the headline claims success over a provider file
that could not be read, which is the same class of falsehood F002 was raised about — a summary
stating something the model contradicts.

Accepting a finding the chair did not sustain rather than taking its verdict as the whole answer:
the evidence is a concrete state, and the fix-delta audit is the author's.
