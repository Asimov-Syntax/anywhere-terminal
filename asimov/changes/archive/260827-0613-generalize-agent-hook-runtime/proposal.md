# Proposal: generalize-agent-hook-runtime

## Why

Phase 6 (docs/PLAN.md WT-006.1) needs one hook runtime serving several agents; the extension ships that architecture for Cursor only, behind a singular contributor slot. Two runtimes disagreeing about enablement, token authority, or disposal would be worse than either alone, so the migration of Cursor onto the generalized form is part of this change, not a follow-up.

## Appetite

M (≤3d)

## Scope

### In scope

- Generalized loopback hook runtime: per-agent normalizer routing, per-agent enablement, per-session tokens
- Widened session-environment contributor seam (multi-agent env minting per spawn)
- Generalized per-agent controller lifecycle (install reconcile → authority grant)
- Migration of Cursor (runtime, controller wiring, tests) onto the generalized stack, behaviourally unchanged

### Out of scope

- Claude hook installer, script, config writes, settings keys (WT-006.2)
- Claude event → turn state reducer, subagent rosters, presence integration (WT-006.3)
- Codex / OpenCode installers (deferred per docs/PLAN.md)
- Any change to CursorHookInstaller's config path or entry shape (generalized in WT-006.2)

## Risk Level

HIGH — modifies a shipped security-relevant component (loopback auth, token lifecycle, env injection) in place rather than adding beside it; blueprint carries `security-privacy` + `re-review`.
