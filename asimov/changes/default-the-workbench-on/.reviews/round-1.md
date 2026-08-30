# Review Round 1: default-the-workbench-on

**Date**: 2026-08-30
**Cycle**: 1
**Mode**: discovery
**Requested execution mode**: fastlane
**Scope**: range `ee68eafc..143be492`
**Head**: `143be4920ee0bb7991b951393fd369464607bc7a` (working tree dirty outside the reviewed range)
**Reviewable lines**: 69
**Agents spawned**: `asm-review-logic`, `asm-review-frontend`, `asm-review-contracts`; support trace by `asm-finder`
**Agents skipped**: `asm-review-data-security` (no data/auth/input boundary), `asm-review-performance` (no growth axis or hot-path addition), `asm-review-reuse` (deletion-only change; no new helper or duplicated capability)
**Verdict**: **APPROVE**
**Counts**: 0 BLOCK, 0 WARN, 0 SUGGEST
**Blocker split**: 0 feature / 0 machinery

## Scope and accepted obligations

Gate 2 is approved. The review applied D1-D6 and task Acceptance/Boundary fields: remove the setting rather than default it true; remove every consumer and IPC contract; preserve `WebviewState.worktreeScope`; keep the non-rollout collapse guards; and read implicit-OFF fixtures case by case.

## Risk map

- Cross-layer retirement: manifest -> settings reader/listener -> provider init/live IPC -> message union/router -> webview consumers.
- UI retirement: flat four-segment composition, its CSS-only hook, selection gate, inspector gate, and selection/expansion presentation.
- Persisted state: scope restoration, stale-scope drop, presence subscription, tab filtering, and error-path settlement must remain the former ON behavior.
- Test validity: five WorktreeView and two VaultPanel cases previously mounted the implicit OFF arm.

## Full-flow trace

- Fresh surface: providers send init without rollout state; `main.ts` constructs scope wiring, controller, and `VaultPanel` unconditionally; no worktree is selected until an explicit row activation.
- Selection: `WorktreeView` announces before committing; scope persistence can reject the move without leaving a selected row; a valid move updates scope/filter/chip, opens the inspector, and collapses only a stacked layout.
- Persisted scope: the coordinator reads it before the controller mounts, keeps presence subscribed while hidden, confirms it against the next tree, and clears/stages notice before panel pruning when stale. `deliver()` failures still settle in `finally`.
- Stale setting: the key is undeclared and unread; neither provider registers its listener or emits init/live fields; the message union/router has no rollout variant; the webview has no OFF dependency or branch.
- Supported surfaces: sidebar, panel, and editor share the same webview scope wiring and host visibility protocol; no alternate surface retains the rollout.

## Verification questions

- Former ON selection/scope/collapse behavior remains intact across first render, tree arrival/removal, no-panel, and error paths.
- No production reader, listener, message, setter/getter, dependency, branch, or CSS hook remains for the OFF arm.
- Retargeted tests assert the new grouping/selection split and two-level controls; dedicated selection tests reject the former expansion-as-card behavior.
- Deleted runtime-flip settlement served only the removed state; selection, tree application, chip clearing, and error paths retain independent settlement.

## Inline support review

Changed tests contain no `.only` or `.skip`. The provider stale-key cases exercise initialized surfaces and configuration-change delivery; the VaultPanel and WorktreeView retargets remain behaviorally discriminating. No fixture secrets or contract-shape drift were found.

## Findings

None.

## Recorded verification evidence

`bun run asm change verify-status default-the-workbench-on` records all six tasks verified: type check clean, 5257 unit tests, I10 gate clean, and `biome check src` at 4 pre-existing errors / 14 warnings / 3 infos, below the recorded 5-error baseline.

## Specialist results

- `asm-review-logic` — scope, selection, collapse, controller/error paths — `gpt-5.6-terra[1M]` — no findings.
- `asm-review-frontend` — VaultPanel/WorktreeView composition, accessibility, retargeted tests — `sonnet[1M]` — no findings.
- `asm-review-contracts` — manifest, settings, providers, IPC and router contracts — `gpt-5.6-luna[1M]` — no findings.
