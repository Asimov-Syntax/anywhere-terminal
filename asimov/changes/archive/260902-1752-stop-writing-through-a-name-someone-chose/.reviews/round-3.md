# Review Round 3

- Date: 2026-09-03
- Cycle: 2
- Mode: verification
- Scope: commit range `eed906888e185819ef5961f82c2316f3c2dfc325..3cb6f03c449621d0e68728dbf480d43426edba34`
- Head: `3cb6f03c449621d0e68728dbf480d43426edba34` (tree dirty only from review bookkeeping in `analytics.json` after round start)
- Scope lock: passed — the design/task delta and `createParent` option are remediation of accepted F002/F003 inside the existing `LockedFile` invariant owner; no new capability or invariant owner was introduced
- Reviewable lines: 43 across `src/agentHooks/install/lockedJsonFile.ts` and `src/cursor/CursorHookInstaller.ts`; focused tests reviewed inline
- Agents spawned:
  - `asm-review-logic`: F002 no-parent-creation invariant and result paths — `gpt-5.6-sol[1M]`
  - `asm-review-contracts`: default behavior and consumer impact — `gpt-5.6-terra[1M]`
  - `asm-review-reuse`: shared option placement and F003 filesystem seam — `sonnet[1M]`
- Agents skipped: data-security (logic covered the narrow filesystem race and no new security boundary appeared); frontend; performance
- Verdict: APPROVE WITH ACCEPTED RISK
- Counts: BLOCK 0, WARN 0, SUGGEST 0
- Prior findings fixed: 4

## Findings

### F001 — Failure cleanup can unlink a substituted staging object

- ID: F001
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; corroborated by `asm-review-data-security` and `asm-review-reuse`
- Class: machinery
- File: `src/cursor/CursorHookInstaller.ts:375`
- Status: fixed
- Evidence: Cursor continues to route replacement through `LockedFile.atomicReplace`; no Cursor-local pathname cleanup has returned. Shared staging owns identity capture, guarded commit, and guarded discard.
- Impact: No open impact.
- Suggested Fix: None.
- Triage: Remains fixed from round 2.

### F002 — Shared lock acquisition changes missing-parent results and creates configuration state

- ID: F002
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; corroborated by `asm-review-logic`
- Class: feature
- File: `src/agentHooks/install/lockedJsonFile.ts:37`
- Status: fixed
- Evidence: `LockedFileDependencies.createParent` defaults to `true`; Cursor's single `locked()` factory passes `false`, so both of its fresh instances receive the same policy. Under `false`, both acquisition and staging skip recursive `mkdir`. An absent or removed parent therefore reaches the exclusive `open`, which returns `ENOENT`; acquisition returns `undefined` and the caller's exact `lockUnavailable` payload is preserved, while staging returns `undefined`. The caller-side stat precheck is deleted, so the prior check-to-mkdir interval no longer exists. Boundary inventory rechecked: stable absence, removal before acquisition open, removal after lock acquisition but before staging, lock acquisition, and staging. None contains an operation that creates the parent under Cursor's policy; later name rebinding remains R1 rather than parent creation.
- Impact: Cursor can no longer recreate a missing configuration directory through either the lock or staging path.
- Suggested Fix: None.
- Triage: Fixed at the act that owned the behavior. No third failure of the invariant remains.

### F003 — The hybrid-filesystem guard observes an unrelated directory

- ID: F003
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair; corroborated by `asm-review-contracts` and `asm-review-reuse`
- Class: machinery
- File: `src/cursor/CursorHookInstaller.test.ts:126`
- Status: fixed
- Evidence: The Proxy is removed. The formerly omitted live operation, `link`, is now an own enumerable throwing stub on the injected filesystem, so both Cursor's spread and `LockedFile`'s spread carry it and override the real default. The production `LockedFile.stageReplacement(...).commit("create")` path invokes the stub; the witness observes that invocation and the expected swallowed-failure result. A second witness inventories every operation in the current `LockedFileSystem` surface and the fixture supplies each as an own function. Current impact-cone operations were checked: `chmod`, `link`, `lstat`, `mkdir`, `open`, `readFile`, `rename`, `unlink`, and `writeFile`.
- Impact: No current shared-lock operation can silently fall through from the Windows fixture to real `node:fs/promises`.
- Suggested Fix: None.
- Triage: Fixed through own properties on the path object spread actually copies, with the witness driven through the production invariant owner.

### F004 — The rewritten write-failure test no longer reaches a returned handle

- ID: F004
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: chair
- Class: machinery
- File: `src/cursor/CursorHookInstaller.test.ts:1145`
- Status: fixed
- Evidence: Shared staging remains the lifecycle owner and the Cursor integration witnesses continue to reach returned-handle write/chmod and replace failures.
- Impact: No open impact.
- Suggested Fix: None.
- Triage: Remains fixed from round 2.

## Accepted risk

The following user-granted risks remain non-gating. Owner: WT-012.21. Expiry: none. Reactivation trigger: a Node release exposing usable descriptor-relative `openat`/`renameat` operations.

- R1 — Directory substitution between named lock, staging, read, and commit operations. Status: risk-accepted.
- R2 — Release-leaf substitution between identity comparison and unlink. Status: risk-accepted.
- R3 — Temporary-leaf substitution between ownership comparison and rename/discard. Status: risk-accepted.
- R4 — Post-release wedge when a rebound lock name is refused and no age reclaim exists. Status: risk-accepted.

## Clean areas

- No unopted `LockedFile` consumer changes behavior. `createParent` is `dependencies.createParent ?? true`; `ClaudeHookInstaller` and `writeNativeConfig` omit the option and retain both acquisition and staging directory creation. Cursor is the only production caller passing `false`.
- The two fresh Cursor `LockedFile` instances both come from the same helper and therefore cannot diverge on `createParent`.
- There is no remaining parent-check interleaving to witness: the check was deleted and the creation acts themselves are disabled. If the parent vanishes before either exclusive open, the open refuses; if another actor recreates or redirects it, that is the already accepted R1 namespace behavior, not creation by this code.
- The F003 stub survives both relevant object spreads because it is an own enumerable property; the removed Proxy did not.
- Verify-gate evidence records clean type checking and 7,083 tests, with the unrelated worktree-assembly flake reproduced before this change and acknowledged in the build record. Review did not rerun project verification.
