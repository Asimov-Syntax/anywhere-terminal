# Review Round 1 — collapse-the-rail-after-a-sidebar-selection

| Field | Value |
|---|---|
| Date | 2026-08-30 |
| Cycle | 1 |
| Mode | discovery |
| Scope | range `95545535..HEAD` |
| Head | `a89b0288bbb10fbc80fc6a13bf886cd40b58a08b` |
| Tree state | dirty after review accounting (`.analytics-cursor.json`, `analytics.json`); not part of the explicit committed range |
| Reviewable lines | ~899; large-change warning applies, with 780 lines from the generated analytics cursor |
| Agents spawned | asm-finder; asm-review-logic (`gpt-5.6-sol[1M]`); asm-review-contracts (`sonnet[1M]`); asm-review-performance (`gpt-5.6-terra[1M]`); asm-review-frontend (`gpt-5.6-terra[1M]`) |
| Agents skipped | data-security (no auth, persistence, secret, or input boundary); reuse (the only helper extracts an existing layout predicate rather than reimplementing a capability) |
| Verdict | REJECT |
| Counts | BLOCK 3 · WARN 1 · SUGGEST 2 |
| Split | 3 gating blockers — 3 feature / 0 machinery |

## Context and verification evidence

- Gate 2 is approved. The accepted obligations are the task Acceptance/Boundary fields and the spec delta under this change.
- No `proposal.md` exists; review used the approved task/spec delta, workflow handback, caller intent, and project design anchors.
- Recorded build evidence was cited, not rerun: tasks 1_1 and 1_2 are verified; type check, 5152 unit tests, I10, and the Biome `src` baseline were reported green. `bun run asm change verify-status collapse-the-rail-after-a-sidebar-selection` confirmed both task records at exit 0.
- The non-persisted collapse is correct: `collapseAfterSelection()` reaches the same class/ARIA/visibility path while suppressing only `vaultCollapsed` persistence.
- The absent already-collapsed guard is safe for the stated behavior: repeated `setCollapsed(true, { persist: false })` does not animate or refresh and only repeats idempotent class/ARIA/visibility writes.
- The side-by-side/stacked predicate correctly reuses the existing top/bottom class definition, and no position default changed.
- Scope set/clear ordering is correct: the coordinator mutates scope before render/revalidation; the effective-visibility edge guard suppresses duplicate IPC.
- Whole-surface hiding/disposal remains safe at the host boundary because `WorktreeHost` separately gates on `displayed`; the scan is window-global, not multiplied per scoped surface.

## Full-flow trace

Selection enters through the worktree row callback, updates the per-surface scope, settles the active/empty destination, redraws the tab bar, revalidates the subscription, then conditionally collapses the vault. Collapse updates class and ARIA, reports the worktree body hidden, and the controller keeps host delivery active when an effective scope remains. The host combines the posted value with its independent `displayed` state before pushing or arming the window-global external scan. Presence pushes update attribution, which can redraw the hidden-waiting count. Clearing scope redraws first, then revalidation posts false when the body remains hidden, stopping delivery and the scan. The side-by-side path scopes without collapsing. The rollout-off path is intended to keep the shipped layout, but the callback's init-time flag capture breaks live transitions (B3). The hidden-body path also exposes the async create lifecycle regression (B2), and the external-only projection performs the unbounded enrichment work in B1.

## Findings

### [B1] A scope-only subscription runs uncapped per-session preview I/O every five seconds

- **Severity**: BLOCK · **Confidence**: HIGH · **Priority**: P1
- **Agent**: asm-review-performance (confirmed by chair)
- **Class**: feature
- **File**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/main.ts:1151` (flow continues through `WorktreeController.ts:500`, `WorktreeHost.ts:1334-1369`, `presenceProjector.ts:461-475,992-993`)
- **Evidence**: `presenceNeeded` keeps a displayed scoped surface reported visible after the rail collapses, so `WorktreeHost.anyShowing()` keeps the flat 5 s external projection armed. That external-only pass still calls `previewFromVault()` over every projected row, and each row with an entry invokes `sessionPreview(entryId)`. The preview service rechecks known entries on a 2 s cadence and caps retained state at 256, but the cap does not bound processed input; with more than 256 cyclically visited entries it also churns the cache. Growth axis: `E`, live registry/projected session entries. No application-level structural cap bounds `E`.
- **Impact**: A displayed but collapsed scoped surface can keep approximately `E` preview lookups/stats alive indefinitely on top of the accepted registry read/JSON parse/`kill(0)` scan. This cost was not in the handback's trade or §3.7's price, and it grows with session entries even though scope-badge correctness does not need preview enrichment.
- **Suggested fix**: Preserve the accepted external scan, but do not refresh title/preview enrichment for every row on every external-only pass. Retain cached enrichment and refresh only newly observed or materially changed sessions, or move enrichment to a separately bounded cadence/dirty set. Add a scale case beyond the 256-entry cache cap.
- **Status**: accepted — resolved by scope cut, not by a fix here
- **Triage**: Confirmed. `reconcileScan()` (src/providers/WorktreeHost.ts:1334) arms the external scan on
`anyShowing()` = `visible && displayed`, and presence rides the same projection broadcast — there
is no separate presence channel. So holding `worktreeViewVisibility` true to keep presence
necessarily arms the 5s scan and its per-row enrichment. Separating "subscribed for presence" from
"drawing rows" is a new protocol concept and a new invariant owner, which the remediation boundary
puts outside a fix loop.

Resolved by removing the cause rather than fixing the symptom: task 1_2 (`presenceNeeded` /
`revalidateVisibility`) is reverted. It was never WT-010.4's accepted scope — it was added
mid-build as my resolution to the presence handback, and this round shows that resolution needs
design work. With it gone the surface reports invisible on collapse exactly as it did before this
change, and B1 does not exist.

The underlying contradiction it was trying to solve (an auto-collapse freezes the presence half of
the hidden-waiting count, vs `tab-bar-component` § "The count reads every source that can say a
pane is waiting") is pre-existing — a hand-collapse already did this — and is handed back as its
own change. It is a dependency of WT-010.6 (Default the Workbench On), not of this change, because
`anywhereTerminal.worktree.workbench` defaults to false: with the rollout off the auto-collapse
never fires and nothing here changes shipped behaviour.

### [B2] Effective subscription visibility bypasses hidden-body async cleanup

- **Severity**: BLOCK · **Confidence**: HIGH · **Priority**: P1
- **Agent**: asm-review-logic (corroborated by chair)
- **Class**: feature
- **File**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeController.ts:500`
- **Evidence**: When `setVisible(false)` records a hidden worktree body while `presenceNeeded()` remains true, `applyVisibility()` computes the same effective `visible` value and returns at line 501. The existing `pendingCreate = null` cleanup at lines 505-510 therefore never runs. A user can start create-default resolution, select a worktree or switch bodies while scoped, and let `handleCreateDefaults()` reach `openPendingCreate()` after the body is hidden. The same conflation leaves body-only refresh eligibility keyed to effective subscription visibility at line 536. Invariant inventory: host presence delivery is intentionally affected; host `displayed` gating is verified safe; pending-create cancellation and body-only refresh gating are affected; scope clear correctly releases the subscription.
- **Impact**: A late create response can mount a create dialog over a body it no longer acts in, regressing the explicit lifecycle guarantee the old `setVisible(false)` cleanup enforced. Auto-collapse makes this path routine rather than exceptional.
- **Suggested fix**: Keep requested body visibility and effective host subscription as separate state machines. On a requested true→false transition, clear `pendingCreate` and any body-only state regardless of the effective presence subscription; gate body-only refresh on requested visibility. Let the effective state own only IPC delivery/scan edges. Add tests for pending create and refresh while hidden-but-scoped.
- **Status**: accepted — resolved by the same scope cut
- **Triage**: Confirmed against source before triage: the `pendingCreate = null` cleanup sits inside
`if (!visible)` below the `visible === this.visible` early return, so a collapse under a scope
skipped it and a late create-defaults response could mount the dialog over a hidden body. This
regressed the accepted round-1 W6 guarantee from an earlier change.

The defect was introduced by task 1_2's split of requested vs effective visibility. Reverting 1_2
restores the single-valued `setVisible`, so every `setVisible(false)` reaches the cleanup again.
Covered by re-running the existing create-lifecycle tests, not by new ones — the pre-change
behaviour is what is being restored.

### [B3] Auto-collapse is gated by the initialization snapshot, not the live rollout

- **Severity**: BLOCK · **Confidence**: HIGH · **Priority**: P1
- **Agent**: chair (corroborated by asm-review-frontend)
- **Class**: feature
- **File**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/main.ts:1158`
- **Evidence**: The selection callback closes over `msg.worktreeWorkbench`, the init payload. The runtime handler at lines 860-872 updates `VaultPanel`, the scope coordinator, and `WorktreeController`, but cannot change that captured value. After off→on, a valid stacked selection never collapses; after on→off, a selection still collapses even though the accepted must-not says the shipped layout is unchanged while the rollout is off.
- **Impact**: Both live rollout directions violate WT-010.4, including the safety side of the feature flag. This is reachable without reload because providers explicitly push `worktreeWorkbench` updates at runtime.
- **Suggested fix**: Read the live gate at click time, for example `worktreeController?.isWorkbenchEnabled()`, or maintain a mutable value updated by `onWorktreeWorkbench`. Cover both off→on and on→off selection paths at an importable wiring seam.
- **Status**: accepted
- **Triage**: Confirmed: all four `worktreeWorkbench` reads in src/webview/main.ts are the init-time
`msg.worktreeWorkbench`, with no mutable local; `onWorktreeWorkbench` updates the panel and
controller but cannot reach the captured value. The chair's addition of the on->off direction is
the more serious half — selections would still collapse after the rollout is switched off, which
breaks the requirement that shipped behaviour is unchanged while the flag is off. WT-010.3
(e9e7878c) exists specifically to make every participant follow this rollout at runtime, so this
is a hole in an accepted contract rather than a nicety; the specialist's SUGGEST label understated
it and the chair's BLOCK is right. Fixed by reading live controller state at selection time, with
tests for both transition directions.

### [W1] Auto-collapse can hide the focused row without moving focus

- **Severity**: WARN · **Confidence**: HIGH · **Priority**: P2
- **Agent**: asm-review-frontend (severity escalated by chair from SUGGEST because the common empty/already-active paths are reachable)
- **Class**: feature
- **File**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/VaultPanel.ts:750`
- **Evidence**: Keyboard or pointer activation leaves focus on the selected row unless scope settlement activates a different pane. If the active pane is already in scope, or the selected worktree has no panes and the empty-scope region is shown, no focus transfer occurs. `collapseAfterSelection()` then applies `.vault-collapsed`, whose CSS hides `.vault-body`, without moving focus to the surviving header, tab-bar escape, terminal, or empty-scope action.
- **Impact**: Keyboard and screen-reader users can lose visible focus immediately after the primary selection action, making the next interaction ambiguous.
- **Suggested fix**: When automatic collapse is about to hide the current active element, move focus to a deliberate visible destination (at minimum the collapsed header; preferably the selected terminal/empty-scope region when available). Cover empty-scope and already-active-in-scope keyboard selections.
- **Status**: accepted
- **Triage**: Valid. The collapse hides the focused row and the header-toggle path's focus transfer is not
reused, so keyboard and screen-reader users lose their place after the primary selection action.
Fixed by moving focus to a deliberate surviving destination when the active element is inside the
body being hidden.

### [S1] Non-persistence also suppresses the shared collapse animation

- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P3
- **Agent**: asm-review-frontend
- **Class**: feature
- **File**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/vault/VaultPanel.ts:755`
- **Evidence**: `collapseAfterSelection()` correctly passes `{ persist: false }`, but `setCollapsed()` invokes `animateCollapse` only when `opts.persist !== false` at line 779. The automatic selection collapse therefore snaps in every motion mode and never reaches `runAuxCollapseAnimation` or its reduced-motion branch, unlike the header-toggle path.
- **Impact**: Persistence policy and motion policy are accidentally coupled; the new primary transition has a different normal-motion feel from the existing collapse path, and the claim that the shipped reduced-motion path guards this transition is not actually exercised.
- **Suggested fix**: Separate `persist` and `animate` options. Keep automatic collapse non-persisted while allowing the shared animator to decide normal versus reduced motion. Add both motion-mode cases.
- **Status**: accepted
- **Triage**: Valid and cheap. `{ persist: false }` was doing two jobs: it correctly suppressed the write to
`vaultCollapsed`, and it incidentally suppressed `animateCollapse`, so the automatic collapse snaps
in every motion mode and never reaches the shared reduced-motion path. Persistence and animation
are separated so the automatic collapse animates like the manual one while still not persisting.

### [S2] The changed sender widens the visibility protocol without updating its authority

- **Severity**: SUGGEST · **Confidence**: HIGH · **Priority**: P4
- **Agent**: asm-review-contracts
- **Class**: feature
- **File**: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/webview/worktree/WorktreeController.ts:493` (contradicts `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/types/messages.ts:881-885`)
- **Evidence**: The new sender comment defines `worktreeViewVisibility` as “still draws something from presence,” while the message contract still defines it as whether the Worktree view “is being shown.” Host state and scan design also use the older visible/showing vocabulary. The runtime remains coherent only because the host independently gates `displayed`; the protocol meaning itself now has two authoritative descriptions.
- **Impact**: Future callers and consumers cannot tell whether this boolean owns body lifecycle, presence delivery, or scan admission. B2 is already one concrete consequence of that ambiguity.
- **Suggested fix**: After separating body lifecycle from effective subscription, update the message/host contract to name exactly what the posted boolean means, or introduce a distinct subscription concept instead of overloading “visibility.”
- **Status**: accepted — resolved by the same scope cut
- **Triage**: Valid as written. The divergence exists only because task 1_2 widened the sender's meaning
while src/types/messages.ts:881 kept the original definition. Reverting 1_2 removes the widening,
so the protocol authority and the sender agree again with no doc edit needed. The two-level concept
S2 gestures at is exactly what the handed-back change has to design; recorded there rather than
patched here.

## Adjudication notes

- The performance report was relayed twice; it is persisted once as B1.
- The frontend rollout finding was escalated from SUGGEST to BLOCK because the accepted contract explicitly requires live rollout behavior and unchanged shipped behavior while off; source evidence proves both transition directions fail.
- The frontend focus finding was escalated from SUGGEST to WARN because it is reachable on empty scopes and already-active panes and removes visible keyboard focus.
- The contracts WARN about making `collapseAfterSelection()` encode layout/rollout/selection gates was rejected: those facts belong to the bootstrap caller, the method has one caller, and moving them into `VaultPanel` would couple the panel to layout/rollout state without fixing a current defect.
- The contracts P5 observation about calling `revalidateVisibility()` on every render was rejected: the current cost is an O(1) predicate and the edge guard suppresses messages, requests, and scan reconciliation.

## Accepted risk

None.

## Audit backlog

None.
