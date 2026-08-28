# Review Round 1

- Date: 2026-08-28
- Cycle: 1
- Round: 1
- Mode: discovery
- Scope: working tree — final tracked state plus untracked additions
- Head: e4e823d5d4c37bcbbf227669708f44af8c20969d (dirty working tree)
- Reviewable lines: 1037
- Size note: Large change — accuracy may decrease.
- Agents spawned:
  - asm-review-data-security — frozen command, payload privacy, exact migration and cleanup boundary — gpt-5.6-sol[1M]
  - asm-review-logic — locking, config-first migration, Windows removal-only outcomes, controller authority — gpt-5.6-terra[1M]
  - asm-review-contracts — exact ownership tuples, result schema, D1-D8/spec conformance — sonnet[1M]
- Agents skipped:
  - asm-review-frontend — no frontend code changed
  - asm-review-performance — event and ownership sets are structurally capped; reconciliation is control-plane rather than a per-event hot path
  - asm-review-reuse — no material helper, parser, abstraction split, or mirrored implementation warranted a separate lens
- Support agent: asm-finder — traced setting → controller → installer/runtime → PTY environment → loopback listener → status flow
- Verdict: BLOCK
- Counts: BLOCK 2 | WARN 0 | SUGGEST 0
- Verification evidence: `bun run asm change verify-status inline-cursor-hooks` records exit 0 for tasks 1_1, 2_0–2_3, 3_1–3_3, and 4_1. The review did not run project verify commands.

## Current findings

### B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/worktree-phase6/src/cursor/CursorHookInstaller.ts:142
- title: Cleanup deletes a legacy wrapper that a preserved custom event still references
- evidence: Install and uninstall claim entries only inside `CURSOR_HOOK_EVENTS` (`CursorHookInstaller.ts:123-129` and `:166-173`), as D3 requires, but both paths then call `removeLegacyWrapper()` unconditionally (`:142` and `:183`). The changed test at `CursorHookInstaller.test.ts:205-225` explicitly preserves an exact legacy command under `customEvent`, but it does not create the released wrapper. A targeted scratch probe with that exact custom entry and a real wrapper returned `{installed:true}`, retained the custom entry, and deleted the wrapper. The configuration is therefore not “durably free” of the legacy command when cleanup runs.
- impact: A user-owned or future Cursor event using the exact released wrapper command survives migration in `hooks.json` but is silently made non-executable. This violates D3's event-scoped non-ownership and D4's cleanup ordering, and can break unrelated user hook behavior during either enable or disable.
- suggestedFix: Before unlinking, retain proof from the reconciled document that no unclaimed exact legacy-command reference remains outside the released ownership tuples. If any remains, preserve the wrapper and surface its path as unresolved/a warning rather than deleting it. Add install and uninstall regressions with an actual wrapper plus an exact custom-event reference.
- status: accepted
- triage: Accepted — D3 forbids claiming custom/future events and D4 permits unlink only after the preserved configuration is free of the released wrapper reference. Fix all POSIX and Windows install/uninstall boundaries.
- invariant: Exact cleanup must not delete an executable while a preserved configuration entry still references it.
- boundary inventory:
  - affected: POSIX install migration; POSIX uninstall; Windows removal-only install/uninstall when a custom/future event retains the exact Windows legacy command
  - verified safe: released-event exact entries are removed before unlink; malformed/unreadable/symlink/lock/write failures skip unlink and preserve the wrapper; substring and differently quoted lookalikes are not claimed

### B2

- ID: B2
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/worktree-phase6/src/cursor/CursorHookInstaller.ts:228
- title: Lock-release failure is swallowed and reported as a clean reconciliation
- evidence: `withLock()` returns the work result, then its `finally` executes `unlink(lockPath).catch(() => undefined)` (`CursorHookInstaller.ts:228-234`). Any failed lock deletion is discarded after the config/wrapper result has already been chosen. A targeted scratch probe injected `EACCES` only for the lock unlink: `install()` returned `{installed:true}` while the lock file remained. D8 says normal completion removes the lock, and D5 requires exact unresolved paths instead of clean outcomes when cleanup is not proven.
- impact: The current call grants runtime authority or reports Windows cleanup complete, but every later install/uninstall fails closed on the orphaned lock until the user manually removes it. Because the successful call omits the lock path, the user receives neither an accurate outcome nor actionable recovery information.
- suggestedFix: Make lock release part of the returned outcome. Preserve the already-committed install/remove boolean, but on unlink failure report an explicit cleanup reason and include `lockPath` in `unresolved`; ensure the controller treats removal with unresolved lock residue as unsuccessful and install as a separately warned partial success. Add POSIX and Windows tests that fail only the final lock unlink.
- status: accepted
- triage: Accepted — D5 and D8 require exact unresolved lock state; successful work cannot erase a final lock-release failure. Preserve committed booleans, add an explicit reason, and surface the lock path on every affected boundary.
- invariant: A reconciliation may report clean completion only after every owned serialization artifact is proven released or surfaced as unresolved.
- boundary inventory:
  - affected: POSIX install success and partial-wrapper-cleanup outcomes; POSIX uninstall success/not-installed; Windows removal-only clean and partial outcomes
  - verified safe: acquisition failure already reports config, wrapper, and lock paths; work exceptions return write-failed; successful lock unlink removes the file

## Accepted risk

None.

## Audit backlog

None.
