# Review Round 9 — run-the-setup-the-user-saw

- Date: 2026-09-03
- Cycle: 4
- Round: 9
- Mode: verification
- Scope: remediation range `a924f5e8..336e9514`
- Head: `336e951427f655a91ba07244701b3ce02c8525b0` (working tree dirty only from pre-existing generated `asimov/changes/run-the-setup-the-user-saw/analytics.json`)
- Scope lock: satisfied — task 9_1 is mandatory remediation for accepted F018 under the existing controller result-identity owner; it adds no capability, design/spec change, external contract, or invariant owner
- Reviewable lines: 34 production lines in the remediation range; 64 changed test lines reviewed inline
- User approval: `ok cho phép`, recorded before the round opened
- Verify gate: task 9_1 `[x] exit 0`; recorded evidence covers the focused controller test, type check, and cumulative unit suite. Adjudication relies on the recorded Verify Gate.
- Agents spawned: 2 (logic, frontend) + chair verification and impact-cone trace
- Agents skipped: data-security, contracts, performance, reuse — the remediation cone changes only webview result identity, setup-result merging, and row reconciliation
- Verdict: **APPROVE**
- Counts: 0 BLOCK · 0 WARN · 0 SUGGEST; F018 fixed; F001–F017 remain fixed

## Findings

### F018

- ID: F018
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/webview/worktree/WorktreeController.ts:1416-1435`, `:1697-1730`
- title: Setup-result generation identity survives intermediate trees and stale retry updates
- evidence: `rescope()` now distinguishes a pending notice from an attached notice by field ownership: only a notice already carrying no `worktreeId` preserves its existing `canonicalId` across an absent reconciliation, while an attached notice that actually departs loses both identities. Repeated absent tree responses therefore retain the pending create's canonical id, and the later row response reattaches that exact notice. For setup-only updates, a miss no longer constructs a worktree-scoped create generation. It first targets an identity-less departed notice by the display label retained for the departed normalized id; otherwise its fallback carries `orphanedLabel` only. Such a result remains visible but `rescope()` has no canonical identity with which to attach it to a later recreation.

  The adverse reverse ordering raised during specialist review — an old retry update arriving after a successor create result and matching the successor through `exact` — is excluded by the production admission and serialization boundaries. A fresh local create at the same normalized path cannot pass the pre-queue create-path check while the host cache still carries the old linked worktree (`createPath.ts:196-204`). Once an authoritative rebuild observes absence, `reconcileFingerprints()` removes the old retry record (`worktreeMutationService.ts:602-605`), so a later recreation cannot emit from it. If retry was admitted before the successor create, both run through the repository coordinator and the retry's `.then(reportProvisioning)` reaction posts before the queued successor starts. A recreation from another extension host sends this controller a tree response, not that other surface's mutation result. Consequently no production path places an old setup-only update beside a successor create notice under the same controller identity.
- impact: Current-generation setup state, output, and retry controls remain attached through intermediate absent trees; stale retry failure state remains detached and cannot overwrite or become actionable on a recreated row.
- suggestedFix: None.
- status: fixed
- triage: Fixed from rounds 7–8. The Round 9 delta closes both accepted boundaries under the existing D4/D6 ordering and authority contracts. The specialist reverse-order concern was refuted by the host admission, retry reconciliation, per-repository serialization, and per-origin delivery constraints; it does not reopen F018.
- invariant: Every provisioning/setup update retains or loses reattachment identity according to its originating create generation, not merely according to a reusable display label.
- boundary inventory:
  - affected in Round 8: arriving create before row; initial provisioning merge; one or more absent tree responses; later row arrival; attached departure; stale setup-only identity-mismatch update; same-normalized-id recreation; output/retry controls
  - verified safe now: direct pending result to row; pending result through repeated absent responses to row; matched initial provisioning; matched setup-only replacement; attached notice departure stripping identity; stale setup-only update before external recreation; stale update remaining visible without row/retry attachment; local retry/create serialization; external recreation delivering only tree state to the old origin surface

## Impact-cone review

- Pending generation: `canonicalId` survives any number of absent reconciliations while `worktreeId` remains absent, then converts back to `worktreeId` when the row arrives.
- Departed generation: an attached notice loses identity when its row actually leaves; a setup-only mismatch update can merge into that historical notice by the retained display label but cannot mint canonical identity.
- Successor isolation: the stale-before-successor witness stays detached, and producer admission/queue/origin constraints exclude the reverse exact-match ordering on one controller.
- UI actions: only an attached result with `worktreeId` can post setup retry; the reattached current notice retains its opaque output and retry ids.
- Tests: the delta adds the missing intermediate-absent response and stale retry mismatch/recreation witnesses, with no focused/disabled cases and no weakened inherited assertion.
- No new finding intersects the remediation cone. F001–F017 remain fixed under the current cumulative implementation.

## Sub-agents spawned

- asm-review-logic: setup-result identity lifecycle, ordering, and races — `gpt-5.6-sol[1M]`
- asm-review-frontend: notice placement, row reattachment, and actionable setup state — `gpt-5.6-terra[1M]`
