# Design: remove-rejected-hook-installer

## Architecture

```text
current main
  generic runtime/controller ─────────────── keep
  Cursor agent adapter ───────────────────── keep
  rejected shared installer + Claude ─────── delete

bridge after cleanup
  CursorHookInstaller (pre-d31 baseline)
      → AgentHookController(cursor-only)
      → existing generic AgentHookRuntime
      → existing presence/webview projections

next change
  inline-cursor-hooks → replaces only the bridge installer behavior
```

## Decisions

### D1: Preserve the reviewed runtime boundary

`src/agentHooks/AgentHookRuntime.ts`, `AgentHookController.ts`, and `agents/cursor.ts` SHALL remain the runtime boundary.

`ce2e8010` is disjoint from the rejected installer lifecycle and later presence code imports its report types. Removing it would revert reviewed WT-006.1/WT-006.3 behavior rather than clean up WT-006.2.

### D2: Restore the Cursor-specific installer as a compatibility bridge

The cleanup SHALL restore `src/cursor/CursorHookInstaller.{ts,test.ts}` byte-for-byte from `d31d6d17^` and wire it into the current generic controller as the only agent slot.

Deleting `src/agentHooks/install/` without a bridge would silently remove the released Cursor setting's effect. Reusing the pre-installer seam preserves the merge base expected by the already-approved `inline-cursor-hooks` branch; this change does not redesign or harden that bridge.

### D3: Remove only the rejected installer ownership surface

The deletion boundary is `src/agentHooks/install/**`, `src/agentHooks/agents/claude.{ts,test.ts}`, their manifest contributions, and their activation wiring.

No ledger, destination pointer, lease, residue sweep, Claude adapter, global uninstall command, or Claude hook setting survives. No generic runtime, Cursor decoder, or presence consumer belongs to this boundary.

### D4: Do not mutate development-only residue

The cleanup SHALL NOT inspect or modify `~/.claude/settings.json`, fixed wrapper paths, or the machine-wide ledger.

The feature never shipped, and the rejected ownership model cannot prove which historical destinations or byte-identical entries it owns. Leaving local development residue for manual cleanup is safer than guessing against user-owned files.

### D5: Supersede history without applying its contract

`asimov/changes/install-claude-hooks/` SHALL move intact to the archive with an explicit superseded note; incomplete workflow boxes remain incomplete and its spec delta is never applied.

A manual forward archive is intentional because the normal archive command correctly refuses to represent an unverified, unapproved change as completed.

### D6: Reset the blueprint to the recovery sequence

WT-006.2 SHALL return to `todo` as the narrowed `install-claude-hooks-v1` capability. WT-006.3 SHALL depend on WT-006.1 and WT-004.3, matching its implemented runtime/presence dependencies instead of the removed installer.

The cleanup change itself has no blueprint completion target: it repairs the blueprint rather than completing WT-006.2.

### D7: Verification uses the installed toolchain honestly

The lint gate SHALL run non-mutating Biome check mode and record the resolved version. A failure already present at `a79f8c1f` under Biome 2.5.10 may be accepted only after reproduction on a detached clean baseline and proof that this change touched none of the reported files.

Type-check, the full unit suite, the filesystem-deletion gate, and the scale benchmark must pass on the final tree.

## Failure Surface Inventory

| Resource | Writer / serialization | Crash or failure outcome | Failed-read policy | Two-host behavior |
|---|---|---|---|---|
| `~/.cursor/hooks.json` | Restored Cursor installer retains its existing sibling-lock and atomic-rename path | Same shipped behavior until `inline-cursor-hooks` replaces it; no new migration in this cleanup | Existing malformed/unreadable handling is preserved | Existing Cursor lock behavior is preserved, not redesigned here |
| `~/.claude/settings.json` | No writer remains after cleanup | Existing development-only bytes stay untouched | No read occurs; fail closed against accidental ownership | No host from this extension reconciles Claude until v1 lands |
| Rejected ledger/wrapper residue | No writer or sweeper remains | Files may remain on developer machines | No scan or inference is authorized | No cross-host state protocol survives |
| Generic hook runtime | Existing controller/runtime lifecycle | Cursor runtime continues; bind failure falls back to inference | Existing fail-open runtime behavior remains | Per-window runtime and tokens remain unchanged |
| Rejected change artifacts | Git move only; no spec apply | History remains inspectable with incomplete gates visible | Missing source artifact blocks the archive task | One branch performs the move; no shared runtime state |

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| Cursor installation | Deleting the shared installer also deletes shipped Cursor reconciliation | D2 restores the exact pre-installer implementation and tests before wiring changes |
| Runtime/presence | Broad rollback removes load-bearing report types | D1 hard-excludes the reviewed runtime, controller, Cursor adapter, and presence consumers |
| User-owned Claude config | Cleanup guesses ownership and deletes user entries | D4 performs no filesystem cleanup for the unshipped feature |
| Extension activation | Removed imports leave partial Claude/ledger wiring or no Cursor slot | D3 source-level absence checks plus type-check and full unit suite |
| Blueprint | A done presence task depends on a reset installer task | D6 points WT-006.3 at its actual runtime prerequisite |
| Review history | Normal archive falsely records incomplete work as approved | D5 preserves open boxes and adds an explicit superseded record |
| Lint | Biome version drift is mistaken for cleanup regressions | D7 records versions and reproduces only failures outside the touched path set |
| Data scale | No new growing collection; deletion removes ledger growth | Full suite and scale benchmark guard retained presence/runtime costs |
