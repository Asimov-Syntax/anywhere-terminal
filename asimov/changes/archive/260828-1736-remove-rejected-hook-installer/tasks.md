## 1. Gate integrity

- [x] 1_1 Record the non-mutating lint gate and resolved-version check — verified: grep -F 'pnpm exec biome check src' asimov/project.md && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D7
  - **Acceptance**:
    - Outcome: Project verification cannot rewrite source files.
    - Verify: command grep -F 'pnpm exec biome check src' asimov/project.md
  - **Plan**:
    1. Replace the auto-fix lint gate in asimov/project.md with `pnpm exec biome check src` and record the version-drift warning.

## 2. Preserve Cursor while cutting the rejected installer

- [x] 2_1 Restore the Cursor-specific installer bridge — verified: bun test 'src/cursor/CursorHookInstaller.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: design.md D1, D2
  - **Acceptance**:
    - Outcome: The released Cursor setting retains a tested configuration writer.
    - Verify: unit src/cursor/CursorHookInstaller.test.ts
  - **Plan**:
    1. Restore src/cursor/CursorHookInstaller.ts and src/cursor/CursorHookInstaller.test.ts exactly from `d31d6d17^`.

- [ ] 2_2 Remove rejected installer and Claude activation surfaces
  - **Deps**: 2_1
  - **Refs**: design.md D1, D2, D3, D4
  - **Boundary**: preserve generic runtime/controller, Cursor adapter, presence consumers, and user-owned config files
  - **Acceptance**:
    - Outcome: Activation exposes only the preserved Cursor hook lifecycle.
    - Verify: command test -z "$(git grep -l -E 'agentHooks/install|agents/claude|agentHooks\.claude|agentHooks\.uninstall' -- src/agentHooks src/extension.ts package.json || true)"
  - **Plan**:
    1. Delete src/agentHooks/install/ and src/agentHooks/agents/claude.ts plus src/agentHooks/agents/claude.test.ts.
    2. Rewire src/extension.ts to one CursorHookInstaller slot over the current generic controller and runtime and retained presence callback.
    3. Remove Claude settings and the global hook-uninstall command from package.json.

- [ ] 2_3 Remove stale cross-layer exemptions
  - **Deps**: 2_1
  - **Refs**: design.md D3
  - **Acceptance**:
    - Outcome: Cross-layer invariant metadata names no removed installer owner.
    - Verify: unit src/test/invariants/sourceBytes.test.ts
  - **Plan**:
    1. Remove the obsolete peer-owned control-byte exemption from src/test/invariants/sourceBytes.test.ts while keeping both assertions meaningful.
    2. Rename the empty deferred-set contract in src/test/invariants/registry.ts and src/test/invariants/coverage.test.ts around the retained runtime boundary.

## 3. Repair the blueprint and history

- [ ] 3_1 Reset installer-owned blueprint sections
  - **Deps**: 2_2
  - **Refs**: design.md D6
  - **Acceptance**:
    - Outcome: Blueprint documents describe the narrowed future Claude v1 sequence.
    - Verify: command grep -A15 '\[WT-006.2\]' docs/PLAN.md | grep -q 'todo'
  - **Plan**:
    1. Reset WT-006.2 and WT-006.3 dependency text in docs/PLAN.md without changing completed runtime and presence acceptance.
    2. Remove rejected installer settings, command, ownership, and shipped-state claims from docs/DESIGN.md and docs/design/agent-hook-server.md while retaining runtime design.

- [ ] 3_2 Archive the rejected change as superseded
  - **Deps**: 2_3, 3_1
  - **Refs**: design.md D5
  - **Acceptance**:
    - Outcome: Rejected research is archived with unapplied specifications.
    - Verify: command test ! -d asimov/changes/install-claude-hooks && find asimov/changes/archive -maxdepth 1 -type d -name '*-install-claude-hooks' | grep -q .
  - **Plan**:
    1. Add an explicit superseded note to asimov/changes/install-claude-hooks/workflow.md while preserving incomplete gates and review files.
    2. Move asimov/changes/install-claude-hooks/ intact to asimov/changes/archive/*-install-claude-hooks/ without invoking `change apply`.
    3. Remove only the matching active analytics marker under asimov/.analytics-open/changes/ when present.
