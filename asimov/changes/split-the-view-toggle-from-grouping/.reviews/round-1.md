# Code Review — Round 1

**Date**: 2026-08-30
**Cycle**: 1
**Mode**: discovery
**Requested mode**: fastlane
**Scope**: range `e4523282..HEAD`
**Head**: `7699a602e7fda262009171bc216ee26c73e2420f` (explicit range reviewed; working tree also had untracked change analytics outside the range)
**Reviewable lines**: 185
**Intent context**: Gate 2 approved; accepted task Acceptance/Refs and spec delta applied. `proposal.md` is absent.
**Agents spawned**: `asm-review-frontend` (`gpt-5.6-sol[1M]`), `asm-review-logic` (`gpt-5.6-terra[1M]`), `asm-review-reuse` (`gpt-5.6-luna[1M]`)
**Agents skipped**: `asm-review-data-security` (no data/auth boundary), `asm-review-contracts` (no schema/route/public contract; UI contract covered by chair/frontend), `asm-review-performance` (no scale-sensitive collection or hot-path growth axis)
**Verification evidence**: `bun run asm change verify-status split-the-view-toggle-from-grouping` reports tasks `1_1`, `1_2`, and `1_3` exit 0. The supplied build record also reports type check, 5,138 unit tests, I10, and Biome `src` baseline passing. No project verify command was run during review.
**Verdict**: BLOCK
**Counts**: 2 BLOCK / 0 WARN / 0 SUGGEST
**Split**: 1 feature / 1 machinery

## Findings

### [B1] The grouping strip renders beside the sessions list
- **ID**: B1
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: chair (layout defect corroborated by `asm-review-frontend`; chair escalated from WARN because it breaks the primary user-visible composition at normal sidebar widths)
- **Class**: feature
- **File**: `src/webview/vault/vaultPanel.css:224`
- **Title**: The grouping strip renders beside the sessions list
- **Evidence**: The new `.vault-groupbar` and the existing `.vault-list` are direct children of `.vault-body`. `.vault-body` is `display: flex` without `flex-direction`, so its default main axis is horizontal. `.vault-groupbar` therefore occupies a left-hand column while the flexing sessions list is squeezed into the remaining width; no rule stacks the first child above the list. The new tests assert DOM parentage but do not exercise computed layout.
- **Impact**: With the rollout enabled, the feature meant to relieve a cramped four-segment toolbar instead consumes much of the already narrow panel body and compresses session rows, rather than presenting the grouping control as the intended strip above the body it groups.
- **SuggestedFix**: Vertically stack the sessions grouping and list, either by making `.vault-body` a column while preserving both body children' flex sizing, or by introducing a sessions-body wrapper that contains `.vault-groupbar` above `.vault-list`. Add a layout-level assertion or focused browser check that proves the group bar precedes the list on the block axis.
- **Status**: open
- **Triage**: pending author remediation; must fix before approval

### [B2] Runtime rollout changes leave VaultPanel on the old composition
- **ID**: B2
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-logic` (corroborated by chair and `asm-review-frontend`; logic's BLOCK severity retained because the repository explicitly guarantees live flag delivery and post-init race closure)
- **Class**: machinery
- **File**: `src/webview/main.ts:1136`
- **Title**: Runtime rollout changes leave VaultPanel on the old composition
- **Evidence**: The changed wiring passes `msg.worktreeWorkbench` only to the `VaultPanel` constructor, whose `workbench`, `viewToggleEl`, and `groupBarEl` composition is fixed at construction. The existing `onWorktreeWorkbench` path updates `tabBarScope` and `WorktreeController` but never `vaultPanel`. Provider code and tests explicitly deliver `worktreeWorkbench` to already-open views and re-send it after `init` to close the construction race, so this is a supported transition rather than a reload-only setting.
- **Impact**: Enabling the rollout after initialization leaves the shipped flat control beside workbench-enabled rail/tab behavior; disabling it leaves the two-level control visible while the rest of the workbench turns off. In the post-init race, the panel can also retain the stale value captured by `init` even though the corrective message reaches the other components. This violates both rollout directions and the requirement that the shipped flat control render unchanged while off.
- **SuggestedFix**: Give `VaultPanel` an idempotent runtime rollout transition that swaps or rebuilds the control composition while preserving `view`, `groupMode`, persistence callbacks, and transient panel state, and invoke it from the same `onWorktreeWorkbench` seam as `tabBarScope.setWorkbench`. Cover false→true, true→false, and the post-init re-send race.
- **Status**: open
- **Triage**: pending author remediation; must fix before approval

---

## Author's triage — round 1

**[B1] Grouping strip renders beside the sessions list — Status: accepted.**
Confirmed independently: `.vault-body` is `display: flex` with the default row direction
(`vaultPanel.css:218-228`), and `.vault-groupbar` was appended as a direct child of it. Before this
change the point was moot — `.vault-list` and the worktree body are the only other children and
exactly one is displayed at a time, so row and column rendered identically for a single growing
child. Adding a second SIMULTANEOUSLY visible child is what made the direction load-bearing, and
nothing in the change noticed. My own tests are the reason it got through: they assert DOM
parentage, which was the mechanism I had in mind rather than the result the user sees.

**[B2] Runtime rollout changes leave VaultPanel on its initial composition — Status: accepted.**
Confirmed: `main.ts:850-859` routes `worktreeWorkbench` to `tabBarScope` or `worktreeController`,
and the panel is not in that list. `VaultPanel` reads the flag once, in its constructor. The seam
already exists and has two participants; I added a third consumer and wired only its construction.

Neither fix needs a new or changed `D#` and neither mints an invariant owner: B1 is a layout
correction inside an accepted composition, B2 makes the panel the third participant in a rollout
seam the change did not invent. Both are remediation, so they are fixed here rather than handed
back — landed as one task, `2_1`, because their leases overlap.
