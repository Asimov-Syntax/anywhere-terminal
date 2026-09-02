# Review Round 8 — run-the-setup-the-user-saw

- Date: 2026-09-02
- Cycle: 4
- Round: 8
- Mode: verification
- Scope: remediation range `200a376a..a924f5e8`
- Head: `a924f5e8ace84f9ab22382769f2c54e64fcee6f8` (working tree dirty only from generated `asimov/changes/run-the-setup-the-user-saw/analytics.json`)
- Scope lock: satisfied — task 8_1 is mandatory remediation for accepted F018 under its existing result-identity owner
- Reviewable lines: 35 production lines in the remediation range
- User approval: `Cho phép Round 8`, recorded before the round opened
- Verify gate: task 8_1 `[x] exit 0`; recorded evidence includes focused controller 172/172, type check, changed-source Biome, 289 files / 7184 unit tests, bundle-require and filesystem-deletion gates passing. Review did not rerun project verification.
- Agents spawned: 3 (frontend, logic, contracts) + chair verification and impact-cone trace
- Agents skipped: data-security, performance, reuse — the remediation cone changes only webview result identity/reconciliation
- Verdict: **BLOCK**
- Status: **blocked**
- Counts: 1 BLOCK · 0 WARN · 0 SUGGEST; F001–F017 remain fixed
- Review session identity: `ea8b01d7-0032-4405-a0ae-82791e72b715`

## Findings

### F018

- ID: F018
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-frontend, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/src/webview/worktree/WorktreeController.ts:1686-1709`
- title: An intermediate tree response still strips a pending create's canonical identity
- evidence: The remediation correctly gives an arriving absent create `canonicalId`, but `rescope()` removes both `canonicalId` and `worktreeId` before rebuilding the absent result, and preserves canonical identity only when `present === undefined`. Any tree reconciliation supplies `present`. Therefore, after mutation/provisioning results establish a pending create notice, one intervening tree response that still lacks the newly created row strips its `canonicalId`. When the later authoritative tree contains the row, `rescope()` has no canonical id to reattach. This is reachable through a stale in-flight tree response, a presence-driven push over the previous tree, or any rebuild that lands before the row-producing rebuild. The new witness goes directly from pending result to the row-containing tree and does not exercise an intermediate absent reconciliation.

  A second impact-cone boundary fails through the same generation-inference mechanism. A setup retry can be accepted and queued, then its original worktree can depart. The host's identity-mismatch update carries only `worktreeId`; if the old create notice was already re-scoped to an aliased display label, provisioning lookup misses it and constructs a fallback `action: "create"` result. Because it is an arriving create, `rescope()` assigns canonical identity to that stale retry result. A later recreation at the same normalized id can then reattach the old retry failure to the new row. The fallback also lacks `repoId`, so it can coexist with the new generation's mutation notice.
- impact: F018 persists in both directions: a current create's setup status/output/retry can lose its identity before row arrival, and an old generation's retry failure can gain the identity of a later recreation. The UI can therefore omit required retry for the new create or misrepresent the new row with stale setup state.
- suggestedFix: A canonical worktree id alone cannot distinguish all generations. First, preserve an existing `result.canonicalId` across absent reconciliations; only strip identity when an attached notice carrying `worktreeId` actually departs. Second, bind provisioning/setup-retry updates to the create generation or worktree incarnation that produced them and merge/reattach only when it matches. Add both witnesses: (1) pending create → intermediate absent tree → row arrival; (2) old aliased row → retry queued → row departs → identity-mismatch update → recreate same normalized id → new row arrival, asserting the old setup result never attaches.
- status: accepted
- triage: Persists from round 7 with a new boundary witness under the same causal mechanism: `rescope` still discards the pending create generation's canonical identity before row arrival. Severity remains stable.
- invariant: Every provisioning/setup update retains the create generation's canonical identity through any number of absent tree reconciliations until that generation's row appears.
- boundary inventory:
  - affected: arriving create before row; initial provisioning merge; stale/intermediate tree response without row; later row arrival; setup output/retry actions
  - verified safe: direct pending result → row arrival; attached row updates; multiple creates/dedupe through the shared identity helper; old attached remove/create notices losing identity on actual departure
  - not safe: pending create → one or more reconciliations where the row is still absent → eventual row arrival

## Impact-cone review

- `actionResultIdentity()` is now used consistently by provisioning lookup and result dedupe.
- Direct remove/recreate with aliased display path is fixed when the next tree response already contains the new row.
- Row arrival correctly clears `canonicalId`/`orphanedLabel` and restores `worktreeId`.
- Old attached notices still lose identity on departure and do not attach to later recreations.
- The remaining defect is limited to pending create notices crossing an intermediate absent reconciliation; no other in-cone regression was found.
- F001–F017 remain fixed under the current cumulative implementation.

## Sub-agents spawned

- asm-review-frontend: recreated setup notice, actions and row reattachment — `gpt-5.6-sol[1M]`
- asm-review-logic: result identity lifecycle across mutation/provisioning/reconciliation — `gpt-5.6-terra[1M]`
- asm-review-contracts: canonical identity and setup-result merge contract — `sonnet[1M]`

## Re-review identity

- Chair review session: `ea8b01d7-0032-4405-a0ae-82791e72b715`
- Round-8 source of truth: this file at Head `a924f5e8ace84f9ab22382769f2c54e64fcee6f8`
