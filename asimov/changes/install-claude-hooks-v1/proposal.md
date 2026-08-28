# Proposal: install-claude-hooks-v1

## Why

Claude hook events now drive reviewed turn-state and presence behavior, but the installer on local `main` carries a destination ownership lifecycle rejected after eighteen review rounds. Replace only that installer with the smaller recovery contract so completed runtime/presence work remains usable without retaining ledger, lease, pointer, or historical sweep state.

## Appetite

L (≤2w)

## Scope

### In scope

- Preserve the reviewed generic hook runtime/controller and both Cursor/Claude runtime adapters.
- Restore the pre-generalization Cursor installer as a temporary compatibility bridge; Cursor inline migration remains its own reviewed change.
- Add a dedicated POSIX Claude v1 installer over exact current entries and one per-operation destination snapshot.
- Freeze and directly test a hardened Claude inline command; execute the exact bytes through real Claude Code.
- Replace registry/transition/ledger ownership with explicit activation wiring for current settings and currently derivable remove-all behavior.
- Keep Claude settings, runtime coordinates, and WT-006.3 presence projection operational.
- Supersede and archive the rejected `install-claude-hooks` change without applying its spec.

### Out of scope

- Previous-destination cleanup, durable destination inventory, ownership ledger, owner/lease/pointer state, or residue-as-gate.
- Migration of commands or wrapper paths written only by unreleased development builds.
- Cursor inline migration or Windows Cursor policy; owned by `inline-cursor-hooks`.
- Claude installation on Windows before a real Windows spike.
- Power-loss/fsync durability beyond process-crash ordering around atomic rename.

## Risk Level

HIGH — this replaces a user-config writer and security-sensitive command while preserving active runtime authority and completed cross-layer presence invariants.
