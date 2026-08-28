## 1. Gate integrity

- [ ] 1_1 Record the non-mutating lint gate
  - **Deps**: none
  - **Acceptance**:
    - Outcome: Biome check mode leaves source bytes unchanged.
    - Verify: command pnpm exec biome check src
  - **Plan**:
    1. Correct the lint command and warning in asimov/project.md.

## 2. Exact ownership and migration

- [ ] 2_1 Replace the POSIX wrapper identity with the frozen inline generation
  - **Deps**: 1_1
  - **Refs**: specs/cursor-agent-status/spec.md#{cursor-hook-configuration-ownership, cursor-legacy-command-ownership}; design.md D1, D3, D7
  - **Acceptance**:
    - Outcome: POSIX installation converges exact owned entries to one inline generation.
    - Verify: unit src/cursor/CursorHookInstaller.test.ts
  - **Plan**:
    1. Export the D1 literal and replace dynamic wrapper ownership in src/cursor/CursorHookInstaller.ts with the D3 host-specific candidate set.
    2. Classify missing, supported, malformed, unreadable, and symbolic-link configs without coercing unsupported input.
    3. Retarget src/cursor/CursorHookInstaller.test.ts ownership, migration, malformed-config, symlink, and rounds-1–3 lookalike cases onto exact entries.

- [ ] 2_2 Commit the inline entry before removing the released wrapper
  - **Deps**: 2_1
  - **Refs**: specs/cursor-agent-status/spec.md#{cursor-hook-writer-coordination, cursor-legacy-wrapper-migration}; design.md D4, D5
  - **Acceptance**:
    - Outcome: Interrupted migration always leaves a working registered hook.
    - Verify: unit src/cursor/CursorHookInstaller.test.ts
  - **Plan**:
    1. Reorder install and uninstall in src/cursor/CursorHookInstaller.ts around the existing lock and atomic replacement, with exact-path post-commit wrapper cleanup.
    2. Carry unresolved paths in install and remove outcomes in src/cursor/CursorHookInstaller.ts; make ENOENT idempotent without scanning the storage directory.
    3. Extend src/cursor/CursorHookController.ts and its tests so successful install residue warns without revoking authority, while incomplete removal remains unsuccessful.

- [ ] 2_3 Make Windows an outcome-preserving removal-only reconcile
  - **Deps**: 2_2
  - **Refs**: specs/cursor-agent-status/spec.md#{cursor-hook-writer-coordination, windows-cursor-hook-removal-only}; design.md D3, D5, D6
  - **Acceptance**:
    - Outcome: Windows cleanup surfaces its final state and exact unresolved paths.
    - Verify: unit src/cursor/CursorHookInstaller.test.ts
  - **Plan**:
    1. Delete Windows wrapper generation and probing from src/cursor/CursorHookInstaller.ts; route install through exact legacy cleanup.
    2. Cover clean removal, malformed config, lock and write failures, missing files, unlink residue, and no-created-wrapper behavior in src/cursor/CursorHookInstaller.test.ts and src/cursor/CursorHookController.test.ts.

## 3. Transport proof

- [ ] 3_1 Pin every bounded and privacy-preserving branch through the real POSIX shell
  - **Deps**: 2_1
  - **Refs**: specs/cursor-agent-status/spec.md#{cursor-observers-fail-open, cursor-hook-payload-privacy}; design.md D1, D2
  - **Acceptance**:
    - Outcome: Only the hardened literal delivers payloads to the loopback listener.
    - Verify: unit src/cursor/CursorHookInstaller.test.ts
  - **Plan**:
    1. Replace wrapper execution helpers in src/cursor/CursorHookInstaller.test.ts with `/bin/sh -c` tests of the exported literal.
    2. Drive neutral output, delivery, missing and non-loopback coordinates, PATH shadowing, failed lookup drain, bounded failure, proxy environment, and curl startup branches in src/cursor/CursorHookInstaller.test.ts.
    3. Keep positive controls proving the harness observes executable hijack, proxy disclosure, curlrc disclosure, and EPIPE without each mitigation.

- [ ] 3_2 Execute the frozen bytes through real cursor-agent
  - **Deps**: 2_2, 2_3, 3_1
  - **Refs**: specs/cursor-agent-status/spec.md#{cursor-observers-fail-open, cursor-hook-payload-privacy}; design.md D1, D2
  - **Acceptance**:
    - Outcome: Real cursor-agent delivers lifecycle payloads through the frozen literal.
    - Verify: command bun scripts/verify-cursor-inline-hook.ts
  - **Plan**:
    1. Add scripts/verify-cursor-inline-hook.ts as a bounded temporary-workspace and listener harness around the installed cursor-agent.
    2. Record CLI version, command hash, delivered events, exit status, and untouched user-config evidence in docs/research/20260828-cursor-inline-hook-spike.md.
