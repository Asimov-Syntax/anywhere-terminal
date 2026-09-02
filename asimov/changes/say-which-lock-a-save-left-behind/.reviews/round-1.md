# Review Round 1

- Date: 2026-09-02
- Cycle: 1
- Round: 1
- Mode: discovery
- Review profile: fastlane
- Lane: full
- Scope: range `c6a6f7247c08791034a48873247c60c9e07844d2..HEAD`
- Head: `a8252482b8a6c50a3d4a5c5fcc5126b934f1d403` (the committed range was reviewed; the working tree was dirty only from review accounting updates to the change's analytics/workflow state)
- Reviewable lines: 320 (212 production-code churn plus 108 lines of tracked change analytics; tests and Markdown change artifacts classified separately)
- Intent obligations: `workflow.md` has Gate 2 approved; applicable anchors were proposal must-not rules, design D1-D6, task Acceptance/Boundary/Refs, and the worktree-panel delta requirements
- Escalation flags: `new-api-contract` (`ProvisionProblem.reason` adds `locked`), `security-privacy` (reboundable lock names must not reach users)
- Agents spawned:
  - `asm-review-data-security` — lock ownership and warning privacy — `gpt-5.6-sol[1M]`
  - `asm-review-logic` — release classification and async save/reread flow — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — wire union and consumer inventory — `sonnet[1M]`
  - `asm-review-frontend` — provisioning summary and detail rendering — `gpt-5.6-luna[1M]`
  - `asm-review-reuse` — file-identity predicate reuse — `gpt-5.6-luna[1M]`
- Supporting trace: `asm-finder` — reason producers/consumers, lock callbacks, warning sinks, and identity comparisons — `gpt-5.6-luna[1M]`
- Agents skipped:
  - `asm-review-performance` — no collection growth, list endpoint, full-history recompute, duplicate accumulation, or scale-sensitive hot path changed
- Recorded verification: `bun run asm change verify-status say-which-lock-a-save-left-behind` reports tasks 1_1, 1_2, and 1_3 at exit 0. The review ran no project verification command.
- Verdict: BLOCK
- Counts: BLOCK 2 | WARN 0 | SUGGEST 1
- Blocking split: 2 feature | 0 machinery

## Findings

### F001

- ID: F001
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, `asm-review-data-security`
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/agentHooks/install/ClaudeHookInstaller.ts:107`
- title: Installer warnings still expose reboundable lock pathnames
- evidence: The lock-unavailable result is constructed with `[path, locked.lockPath]` at line 107 even though failure to acquire the lock supplies no ownership proof. The new release callback also pushes `lockPath` for `stuck` at lines 109-112. Both arrays are returned at lines 122-126; `AgentHookController.formatWarning()` merges `affected` and `unresolved`, and `extension.ts` emits that string to the user. The changed installer test at lines 270-275 explicitly preserves the stuck lock pathname. This contradicts approved D1 and the delta requirement that no lock pathname be offered in the panel or any warning. A pre-unlink identity match does not make the pathname safe minutes later: the name may be rebound before the user acts.
- impact: The product can still present the name of another writer's live lock. Acting on that warning can destroy mutual exclusion and admit overlapping configuration writes, the security/privacy failure this change is intended to remove.
- suggestedFix: Never place a lock pathname in either `affected` or `unresolved`. For acquisition failure and every release disposition, preserve the pathless reason/warning and, if useful, the configuration-file path only. Update the stuck and lock-unavailable warning witnesses to assert absence of the lock name.
- status: open
- author triage: pending
- triage: New discovery blocker. The no-path invariant was checked at acquisition failure, each release disposition, installer outcome assembly, controller formatting, and the extension warning sink; `notOurs`, `movedAway`, and `indeterminate` are path-safe, but `lock-unavailable` and `stuck` are not.
- invariant: No reboundable lock pathname reaches a human-facing message, regardless of whether ownership was never acquired, could not be determined, or appeared owned at an earlier instant.
- boundary inventory:
  - affected: lock acquisition failure through `affected`; matched-identity unlink refusal through `unresolved`
  - verified safe: panel `locked` problem shape; writer discarding `_lockPath`; installer `notOurs`, `movedAway`, and `indeterminate` callback arms
  - not safe: `ClaudeHookInstaller.run()` lock-unavailable fallback and `stuck` collection, both consumed by `AgentHookController.formatWarning()`

**Status**: accepted

**Triage**: Not rebutted; the design already forbids what the code does, so this is the
implementation failing its own D1 rather than a finding against the design. Two arms, both real:

- `ClaudeHookInstaller.ts:107` puts `locked.lockPath` in `affected` for `lock-unavailable` — a lock
  this process never held, so the name is the one it has least standing to vouch for.
- `:112` pushes `lockPath` into `unresolved` on the `stuck` arm, which is mine.

`stuck` looked defensible on the ground that our own lock file is still at that name — but the
obligation ledger already answers it: "`released` and `stuck` are claims about a moment, not proofs
| Neither is turned into an instruction to delete". The accepted spec is unqualified — "SHALL NOT
give the user a pathname to remove, in the panel or in any warning". Remediation, no design change.

### F002

- ID: F002
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, `asm-review-frontend`
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:723`
- title: The new summary is hidden on real models and falsely calls no-op saves saved
- evidence: `bringSummary()` returns the entry/port/setup/contender counts at lines 723-725 before inspecting problems, so any populated post-save model with an appended `locked` problem never reaches the new `Saved, still locked` branch at lines 742-743. The renderer witness uses `emptyProvisionModel()` at test lines 1162-1171, so it does not exercise the accepted populated-model requirement. Independently, `leftLocked()` deliberately emits the same `reason: "locked"` for `wrote: true` and `wrote: false`, varying only detail text, while the summary maps every lock-only model to the fixed word `Saved`. The host's no-op witness at lines 3554-3562 checks only the detail and therefore permits that false summary.
- impact: In the ordinary case where the saved config still contains entries, the summary omits the lock outcome entirely. In the no-op case, it states that a file was saved even though nothing was written. Both falsify the accepted requirement that the summary report the lock while never describing a write that did not happen as written.
- suggestedFix: Evaluate write-outcome problems before the count early return, preserving refusal precedence. Give the lock-only summary wording or wire shape enough information to remain truthful for both `wrote: true` and `wrote: false` (for example, a neutral lock summary for both, or distinct write-outcome data). Add renderer witnesses with a genuinely populated model and with the no-op host output.
- status: open
- author triage: pending
- triage: New discovery blocker. The summary invariant was checked for populated writes, empty writes, no-op writes, refusals, read failures, and mixed refusal-plus-lock models.
- invariant: The summary must surface the actionable post-save outcome before ordinary content counts, and it must not claim a write when `NativeConfigWrite.wrote` is false.
- boundary inventory:
  - affected: populated successful write plus lock; successful no-op plus lock
  - verified safe: empty-model `wrote: true` lock-only case; refusal-plus-lock precedence; generic detail rendering via `textContent`; failed reread delivery; source supersession suppression
  - not safe: any model with countable content, and every lock-only no-op model

**Status**: accepted (both halves)

**Triage**: Not rebutted. The suppressed summary was named in advance and still shipped: design.md's
obligation ledger row for "A written file is never summarised as unsaved" records the defeater as
"a witness on an empty model, which returns counts before inspecting problems" and specifies a
POPULATED-model witness as the discharge. The witness written was the defeater. `bringSummary`'s
`parts.length > 0` early return at `WorktreeCreateDialog.ts:727` is the mechanism.

The no-op half is a direct violation of the accepted spec sentence "A save that wrote NOTHING SHALL
NOT be described as written" — `leftLocked` varies only the detail string, while the summary is
keyed on `reason` alone and reads "Saved, still locked" for both. It cannot be rebutted on the
meaning of `wrote: false` (content already matched, so the configuration IS on disk): the spec
governs what the user is TOLD, not whether the end state is correct.

That half is also the one that crosses the remediation boundary. The summary needs to tell the two
outcomes apart and `ProvisionProblem` carries no discriminator — only `file`, `reason`, `detail`.
Supplying one changes D4, which owns the wire representation of this outcome, so it goes back to
plan rather than landing as a fix commit. The suppressed-summary half needs no design change and is
ordinary remediation.

### F003

- ID: F003
- severity: SUGGEST
- confidence: HIGH
- priority: P3
- agent: `asm-review-reuse`
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/utils/fileIdentity.ts:20`
- title: Reuse the shared identity predicate in the changed installer
- evidence: The range adds `sameIdentity()` as the shared dev/inode predicate, but changed file `ClaudeHookInstaller.ts` retains an equivalent local predicate at lines 377-379 and uses it at its authorization boundaries. The two implementations already differ: the shared helper normalizes through `BigInt`, while the local helper compares operands directly.
- impact: The repository still has two definitions of file identity that can drift, weakening the cohesion goal of D6 even though this range does not change the installer's existing stat-capture behavior.
- suggestedFix: Import `sameIdentity` and `FileIdentity` into `ClaudeHookInstaller.ts`, remove its local type/predicate, and preserve the installer's current caller error behavior. Any separate conversion of its stat captures to `{ bigint: true }` should be handled only with its ownership contract and tests in scope.
- status: open
- author triage: pending
- triage: New discovery suggestion. This is a reuse/cohesion cleanup, not a gating claim that the range newly introduced the installer's pre-existing numeric stat captures.

**Status**: accepted

**Triage**: SUGGEST, non-blocking, and cheap: `ClaudeHookInstaller.ts:377-379` keeps a local
`sameIdentity` comparing `number` fields while `src/utils/fileIdentity.ts` exists precisely to stop
that drift. Taken in the same fix round as F001, which already edits this file. The chair's caveat
holds — converting the installer's pre-existing stat captures to `{ bigint: true }` is separate
ownership work and is NOT done here, so the helper is adopted at its current precision only.

## Full-flow trace

- Repo-native save: the webview submits only an opening-scoped, host-issued offer id; `WorktreeHost` resolves the repository root and redeemed model, then calls `writeNativeConfig`.
- Persistence: `writeNativeConfig` acquires `LockedFile`, performs the read/modify/write inside the lock, receives a six-arm release disposition, and sets `mayStillBeLocked` only for approved `stuck`/`movedAway` arms. Landed, no-op, refused, unavailable, and thrown paths were traced.
- Post-save publication: `WorktreeHost` catches a rejected reread, falls back to the previously shown model, appends refusal and lock problems from the write's own result, and rechecks disposal, surface presence, opening, and source-switch sequence before publishing. A newer source switch intentionally suppresses the old file's report.
- Wire and consumers: `ProvisionProblem.reason` is produced post-write only in `WorktreeHost`; the repository-wide inventory found the generic detail renderer, `bringSummary`, the read-side `unreadable` comparison, and the contract test. No additional reason switch, validator, serializer, or renderer was missed.
- UI: detail text is rendered with `textContent` and contains only the native config path, not a lock path. F002 is the open summary defect: count precedence suppresses the new result, and the single `locked` reason cannot make the fixed `Saved` summary truthful for a no-op.
- Installer warning: both acquisition failure and post-work release flow reach `AgentHookController.formatWarning()` and then extension logging; F001 records the two remaining lock-name exposures.

## Inline support review

- Changed tests contain no `.only` or `.skip`; asynchronous changed tests await their assertions or use the existing host settling helper.
- The release table has focused real-filesystem witnesses for ordinary release, already-gone, moved-away, not-ours, indeterminate, and stuck. The accepted `unlink`-ENOENT-as-`released` contract and the pre-existing check/unlink substitution limit are stated in D3 and were not re-litigated as new findings.
- The renderer tests fail the accepted populated-model and no-op-summary boundaries recorded in F002; the installer tests deliberately preserve the stuck pathname recorded in F001.
- No changed fixture contains secrets or destructive seed behavior. Tracked analytics follows the repository's existing change-accounting format; no product behavior depends on it.

## Adjudication notes

- The logic specialist's proposed blocker for classifying `unlink` `ENOENT` as `released` was rejected: approved D3 explicitly defines that arm as a claim that the canonical name is free, and a lock renamed to an unknown pathname does not block the next canonical acquisition.
- The data-security specialist's separate check-to-unlink race finding was not carried: the sequence and risk pre-exist this range, D3 explicitly records the limitation, WT-012.21 owns the invariant, and this review does not report unchanged non-critical code below the emergency threshold.
- The contracts specialist and finder independently found no missed `ProvisionProblem.reason` consumer. That does not clear F002, which is a defect inside the inventoried summary consumer itself.
