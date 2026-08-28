## 1. Gate integrity

- [x] 1_1 Record the non-mutating lint gate — verified: grep -F 'pnpm exec biome check src' asimov/project.md && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Acceptance**:
    - Outcome: Biome check mode leaves source bytes unchanged.
    - Verify: command grep -F 'pnpm exec biome check src' asimov/project.md
  - **Plan**:
    1. Correct the lint command and warning in asimov/project.md.

## 2. Exact ownership and migration

- [x] 2_0 Make config locking fail closed without age reclamation — verified: bun test 'src/cursor/CursorHookInstaller.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/cursor-agent-status/spec.md#cursor-hook-writer-coordination; design.md D8
  - **Acceptance**:
    - Outcome: A paused lock holder remains exclusive beyond the former stale threshold.
    - Verify: unit src/cursor/CursorHookInstaller.test.ts
  - **Plan**:
    1. Remove mtime-based live-lock reclamation from src/cursor/CursorHookInstaller.ts and surface the exact lock path on bounded refusal.
    2. Cover crash residue, a holder paused beyond 30 seconds, and a competing host that neither writes nor releases the first lock in src/cursor/CursorHookInstaller.test.ts.

- [x] 2_1 Replace the POSIX wrapper identity with the frozen inline generation — verified: bun test 'src/cursor/CursorHookInstaller.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_0
  - **Refs**: specs/cursor-agent-status/spec.md#{cursor-hook-configuration-ownership, cursor-legacy-command-ownership}; design.md D1, D3, D7
  - **Acceptance**:
    - Outcome: POSIX installation converges exact owned entries to one inline generation.
    - Verify: unit src/cursor/CursorHookInstaller.test.ts
  - **Plan**:
    1. Export the D1 literal and replace dynamic wrapper ownership in src/cursor/CursorHookInstaller.ts with the D3 host-specific candidate set.
    2. Classify missing, supported, malformed, unreadable, and symbolic-link configs without coercing unsupported input.
    3. Retarget src/cursor/CursorHookInstaller.test.ts ownership, released-event scoping, migration, malformed-config, symlink, byte-identical waiver, and rounds-1–3 lookalike cases onto exact entries.

- [x] 2_2 Commit the inline entry before removing the released wrapper — verified: bun test 'src/cursor/CursorHookInstaller.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1
  - **Refs**: specs/cursor-agent-status/spec.md#{cursor-hook-writer-coordination, cursor-legacy-wrapper-migration}; design.md D4, D5
  - **Acceptance**:
    - Outcome: Interrupted migration preserves an executable fail-open released hook path.
    - Verify: unit src/cursor/CursorHookInstaller.test.ts
  - **Plan**:
    1. Reorder install and uninstall in src/cursor/CursorHookInstaller.ts around the existing lock and atomic replacement, with exact-path post-commit wrapper cleanup.
    2. Define `unresolved` and `legacy-wrapper-delete-failed` in src/cursor/CursorHookInstaller.ts; make ENOENT idempotent without scanning the storage directory.
    3. Extend src/cursor/CursorHookController.ts and src/cursor/CursorHookController.test.ts so successful install residue warns without revoking authority, while incomplete removal remains unsuccessful.

- [x] 2_3 Make Windows an outcome-preserving removal-only reconcile — verified: bun test 'src/cursor/CursorHookInstaller.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_2
  - **Refs**: specs/cursor-agent-status/spec.md#{cursor-hook-writer-coordination, windows-cursor-hook-removal-only}; design.md D3, D5, D6
  - **Acceptance**:
    - Outcome: Windows cleanup surfaces its final state and exact unresolved paths.
    - Verify: unit src/cursor/CursorHookInstaller.test.ts
  - **Plan**:
    1. Delete Windows wrapper generation and probing from src/cursor/CursorHookInstaller.ts; route install through exact legacy cleanup.
    2. Cover clean removal, malformed config, lock and write failures, missing files, unlink residue, and no-created-wrapper behavior in src/cursor/CursorHookInstaller.test.ts and src/cursor/CursorHookController.test.ts.

## 3. Transport proof

- [x] 3_1 Pin every bounded and privacy-preserving branch through the real POSIX shell — verified: bun test 'src/cursor/CursorHookInstaller.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_3
  - **Refs**: specs/cursor-agent-status/spec.md#{cursor-observers-fail-open, cursor-hook-payload-privacy}; design.md D1, D2
  - **Acceptance**:
    - Outcome: Only the hardened literal delivers payloads to the loopback listener.
    - Verify: unit src/cursor/CursorHookInstaller.test.ts
  - **Plan**:
    1. Update the frozen D1 bytes in src/cursor/CursorHookInstaller.ts with the ignored-PIPE startup guard.
    2. Replace wrapper execution helpers in src/cursor/CursorHookInstaller.test.ts with `/bin/sh -c` tests of the exported literal.
    3. Drive neutral output, semantic JSON delivery, numeric authority and token validation, PATH, function, and xtrace hardening, failed-lookup drain, timeout, proxy environment, curl startup, trailing-LF, and stdout-closure branches in src/cursor/CursorHookInstaller.test.ts.
    4. Keep controls in src/cursor/CursorHookInstaller.test.ts proving function and PATH hijack, xtrace disclosure, authority escape, proxy disclosure, curlrc disclosure, and EPIPE without each mitigation.

- [x] 3_3 Replace Cursor-rejected shell parsing with trusted URL validation — verified: bun test 'src/cursor/CursorHookInstaller.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_1
  - **Refs**: specs/cursor-agent-status/spec.md#{cursor-observers-fail-open, cursor-hook-payload-privacy}; design.md D1, D2
  - **Acceptance**:
    - Outcome: The frozen literal validates the exact runtime URL through trusted POSIX awk.
    - Verify: unit src/cursor/CursorHookInstaller.test.ts
  - **Plan**:
    1. Replace the rejected shell-pattern parser in src/cursor/CursorHookInstaller.ts with D1's real-agent-proven awk generation.
    2. Retarget src/cursor/CursorHookInstaller.test.ts valid UUID URLs, rejected authority and path cases, awk function and PATH controls, and failed-awk drain behavior.

- [ ] 3_2 Execute the frozen bytes through real cursor-agent
  - **Deps**: 2_2, 2_3, 3_3
  - **Refs**: specs/cursor-agent-status/spec.md#{cursor-observers-fail-open, cursor-hook-payload-privacy, cursor-pre-command-execution-boundary}; design.md D1, D2
  - **Acceptance**:
    - Outcome: Real cursor-agent delivers lifecycle payloads through the frozen literal.
    - Verify: command bun scripts/verify-cursor-inline-hook.mjs
  - **Plan**:
    1. Add scripts/verify-cursor-inline-hook.mjs as a bounded temporary-workspace and listener harness around the installed cursor-agent.
    2. Record CLI and shell version, command hash, delivered events, exit status, startup-environment probe, and untouched user-config evidence in docs/research/20260828-cursor-inline-hook-spike.md.


## 4. Release disclosure

- [x] 4_1 Record the temporary Windows observability regression — verified: grep -F "Windows Cursor hook observability" CHANGELOG.md && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_3
  - **Refs**: specs/cursor-agent-status/spec.md#windows-cursor-hook-removal-only; design.md D6
  - **Acceptance**:
    - Outcome: The changelog states that Windows Cursor hook observability is temporarily removed.
    - Verify: command grep -F "Windows Cursor hook observability" CHANGELOG.md
  - **Plan**:
    1. Add an Unreleased entry to ./CHANGELOG.md naming removal-only behavior, the safety reason, and restoration gate.
