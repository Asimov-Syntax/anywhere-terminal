## 1. Establish the coordinator seam

- [x] 1_1 Add the extension-host coordinator and direct lifecycle tests — verified: bun test 'src/providers/VaultWatchCoordinator.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md#{d1-target-structure, d2-preservation-proof, d4-allowed-non-pure-transformations}
  - **Acceptance**:
    - Outcome: two coordinator clients preserve independent store and follow watcher lifecycles
    - Verify: unit src/providers/VaultWatchCoordinator.test.ts
  - **Plan**:
    1. add `src/providers/VaultWatchCoordinator.ts` with the shared owner, per-webview client contract, injected `WatcherPool`/`VaultService`, and provider callbacks
    2. move the store and follow subscription, debounce, generation, detail-read and idempotent teardown behavior into each client without wiring production callers yet
    3. add `src/providers/VaultWatchCoordinator.test.ts` covering both debounce paths, stale async resolution, multi-client independence and both disposal levels

## 2. Cut the provider responsibility

- [x] 1_2 Delegate vault watcher ownership from TerminalViewProvider — verified: npx vitest run 'src/providers/TerminalViewProvider.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: design.md#{d1-target-structure, d2-preservation-proof, d3-expected-test-moves, d4-allowed-non-pure-transformations}
  - **Acceptance**:
    - Outcome: TerminalViewProvider routes vault watch commands through the coordinator
    - Verify: unit src/providers/TerminalViewProvider.test.ts
  - **Plan**:
    1. construct one `VaultWatchCoordinator` in `src/extension.ts`, register its disposal, and pass it to both production `TerminalViewProvider` instances
    2. in `src/providers/TerminalViewProvider.ts`, attach one client per resolved webview, delegate `vaultWatchSession`, capture that client for disposal, and remove the migrated fields, constants, and methods
    3. refine focused store and follow collaborators in `src/providers/VaultWatchCoordinator.ts` if destination shape analysis still fires; add delegation-only cases to `src/providers/TerminalViewProvider.test.ts` and keep inherited assertions unchanged

## 3. Accepted review findings (round 1)

- [x] 2_1 Bind watch messages to their resolved webview client — verified: npx vitest run 'src/providers/TerminalViewProvider.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: design.md#{d1-target-structure, d2-preservation-proof} <!-- .reviews/round-1.md W1 -->
  - **Acceptance**:
    - Outcome: each webview message handler controls only its captured watcher client
    - Verify: unit src/providers/TerminalViewProvider.test.ts
  - **Plan**:
    1. pass the resolution-local client through message dispatch in `src/providers/TerminalViewProvider.ts` instead of reading mutable provider-wide watcher state
    2. add a two-resolution stale-message and delayed-disposal regression to `src/providers/TerminalViewProvider.test.ts`

- [x] 2_2 Prove follow isolation and share subscription assembly — verified: bun test 'src/providers/VaultWatchCoordinator.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: design.md#{d1-target-structure, d2-preservation-proof} <!-- .reviews/round-1.md W2, S1 -->
  - **Acceptance**:
    - Outcome: two clients retain isolated follow watchers, timers, generations, and callbacks
    - Verify: unit src/providers/VaultWatchCoordinator.test.ts
  - **Plan**:
    1. extract the repeated target subscription loop into one module-local helper in `src/providers/VaultWatchCoordinator.ts`
    2. add a two-client follow switching and disposal regression to `src/providers/VaultWatchCoordinator.test.ts`

