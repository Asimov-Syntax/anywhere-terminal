# Review Round 7 — run-the-setup-the-user-saw

- Date: 2026-09-02
- Cycle: 4
- Round: 7
- Mode: discovery
- Scope: cumulative range `45dab796..HEAD`
- Head: `200a376a1f21eab1d7fe51cf13ae267343855961` (working tree dirty only from generated `asimov/changes/run-the-setup-the-user-saw/analytics.json`; production code is unchanged from `40b21f1b`)
- Scope lock: satisfied — task 7_1 is mandatory remediation under existing D2/D4 owners, and corrected Round 6 adjudicated F015–F017 fixed
- Reviewable lines: 1583 added/modified production lines across 12 reviewable files
- Note: Large change — accuracy may decrease
- Labels: `security-privacy`; fastlane
- Verify gate: `bun run asm change verify-status run-the-setup-the-user-saw` reports tasks 1_1 through 7_1 `[x] exit 0`. Recorded evidence includes focused tests, type check, 289 files / 7183 unit tests, changed-source Biome, bundle-require and filesystem-deletion gates passing. Review did not rerun project verification.
- Agents spawned: 6 (data-security, logic, contracts, frontend, performance, reuse) + chair self-review and full-flow trace
- Agents skipped: none
- Verdict: **BLOCK**
- Status: **blocked**
- Counts: 1 BLOCK · 0 WARN · 0 SUGGEST; F001–F017 fixed
- Split over gating blockers: 1 feature / 0 machinery
- Review session identity: `ea8b01d7-0032-4405-a0ae-82791e72b715`

## Findings

### F018

- ID: F018
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-frontend, chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/webview/worktree/WorktreeController.ts:1405-1424`, `:1454-1468`, `:1672-1705`
- title: Recreating a departed path can orphan setup results and remove setup retry
- evidence: `rescope()` preserves `canonicalId` only when the absent worktree id is not found in `departed`. After a worktree is removed, `departed` holds its exact display path. If a new create reuses the same normalized id before the new row appears, its create result is treated as the old departed row: `worktreeId` is removed, `canonicalId` is omitted, and `orphanedLabel` receives the old display path. Worktree discovery explicitly permits `id !== displayPath` (`/private/var/...` versus `/var/...`). The following provisioning result searches only `(r.worktreeId ?? r.orphanedLabel) === msg.worktreeId`, so it misses that create result. Its fallback result has no `repoId`; after the same rescope, `showActionResult()` cannot dedupe it against the mutation notice because dedupe also compares `repoId`. Neither notice retains canonical identity, so the next tree cannot reattach them. The provisioning notice also lacks `worktreeId`, and `WorktreeView` therefore omits `Retry setup` even when `setupRetryId` is present.
- impact: A supported remove-then-recreate flow on an aliased/normalized path can produce two inconsistent create notices, leave setup status and output at repository scope, and suppress the required setup-only retry for the newly created worktree. This violates the accepted requirement that setup failure surface on that worktree's row with working retry.
- suggestedFix: Treat a successful `create` result as evidence of a new identity generation: while its row is absent, preserve `canonicalId` regardless of an older `departed` label, using the label only for presentation. Use one identity function—`worktreeId ?? canonicalId ?? orphanedLabel`—for provisioning lookup and result dedupe. Add an end-to-end controller witness: departed old row with `displayPath !== id` → create same id → provisioning failure before rebuild → one notice → new row arrives → notice reattaches with output and retry actions.
- status: accepted
- triage: New cumulative-discovery finding. Although the lookup/rescope machinery predates task 7_1, the changed setup-result arm makes the defect falsify this change's load-bearing row-scoped output/retry obligation; the finding is against that changed application, not a general relitigation of old notice behavior.
- invariant: Every provisioning/setup update merges into the create generation that produced it and retains the canonical worktree identity until that generation's row appears.
- boundary inventory:
  - affected: departed-id cache; normalized id versus display path; create mutation result before rebuild; initial provisioning result; setup-only retry action; action-result dedupe; row reattachment
  - verified safe: first create at an id absent from `departed`; paths where `displayPath === id`; provisioning after the new row has already appeared; ordinary setup-only updates on an attached row
  - not safe: remove then recreate same normalized id while `departed` carries a different display label and provisioning arrives before the new row

## Prior finding dispositions

| ID | Disposition | Evidence in current cumulative implementation |
|---|---|---|
| F001 | fixed | Provider parsing plus null-prototype port/setup maps preserve legal names and host variables overlay last |
| F002 | fixed | Run-level cancellation covers terminal open, directory authorization and pre-spawn |
| F003 | fixed | Transcript retention is incremental rather than full-tail recompute per event |
| F004 | fixed | Retry start, output replacement and disappearance dispose prior output |
| F005 | fixed | Reveal is surface- and original-directory-authority-bound |
| F006 | fixed | Cancellation settles before PTY termination |
| F007 | fixed | Every successful fresh create writes a descriptive manifest, including empty selection |
| F008 | fixed | Retry rejection/identity mismatch emits a visible retry-id-less update |
| F009 | fixed | Live output is byte-bounded and batched |
| F010 | fixed | Settled children are detached and unsubscribed |
| F011 | fixed | Trimmed retained slices use bounded independent backing allocations |
| F012 | fixed | Closed replay output clears its reference and recreates |
| F013 | fixed | Flush sizing and slicing use UTF-8 bytes |
| F014 | fixed | Sequential reveal-authority mismatch clears stale actions |
| F015 | fixed | Post-await generation checks prevent stale reveal mutation/reporting |
| F016 | fixed | Fully evicted transcript slots release backing references immediately |
| F017 | fixed | Oversized live events stream directly without whole-event concat |

## Adjudication notes

- Full-flow trace covered form selection → opening-scoped offer → host redemption → Git create → material/ports → setup runner/terminal → gated/ungated launch → manifest → mutation result → provisioning result → row rescope → output/retry → retry update → reveal/reconciliation.
- Data-security, logic, contracts, performance and reuse specialists found no surviving issue. Their evidence sustains F001–F017 as fixed.
- The frontend specialist's duplicate-notice report was independently traced and narrowed by the chair. Matching `canonicalId` alone is insufficient because `rescope` currently omits it when a prior departed label exists; the fix must preserve a new create generation's canonical id as well.
- The finding is reachable because worktree discovery deliberately keeps Git's exact `displayPath` while normalizing `id`, and the supported lifecycle allows removal followed by creation at the same path.
- No changed `.only`/`.skip`, fixture secret, or behavioral-source execution contradiction was found.

## Sub-agents spawned

- asm-review-data-security: offer, environment, shell, retry/output and manifest authority — `gpt-5.6-sol[1M]`
- asm-review-logic: full setup/create/retry lifecycle and race review — `gpt-5.6-terra[1M]`
- asm-review-contracts: D1–D6, task 7_1 and wire/result contracts — `sonnet[1M]`
- asm-review-frontend: setup controls, row merge, actions and rendering — `gpt-5.6-luna[1M]`
- asm-review-performance: PTY bytes/events and retained-resource growth — `gpt-5.6-terra[1M]`
- asm-review-reuse: process/output/authority owner cohesion — `gpt-5.6-luna[1M]`

## Re-review identity

- Chair review session: `ea8b01d7-0032-4405-a0ae-82791e72b715`
- Round-7 source of truth: this file at Head `200a376a1f21eab1d7fe51cf13ae267343855961`
