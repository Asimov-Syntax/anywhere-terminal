# Project: anywhere-terminal

## Overview

A VS Code extension that allows users to place terminal instances anywhere in the VS Code UI — Primary Sidebar, Secondary Sidebar, Bottom Panel, and Editor area. Uses xterm.js for the terminal emulator and node-pty for PTY process spawning.

## Tech Stack

- **Language**: TypeScript
- **Framework**: VS Code Extension API, xterm.js, node-pty
- **Database**: N/A
- **Build**: esbuild (bundler), pnpm (package manager)
- **Test**: Mocha + @vscode/test-cli + @vscode/test-electron, Vitest (unit tests)

## Architecture

- **3-Layer**: Extension Host (backend) → IPC Bridge (postMessage) → WebView (xterm.js frontend)
- **Provider Pattern**: WebviewViewProvider for sidebar/panel, WebviewPanel for editor area
- **Session Management**: Central SessionManager for multiple PTY sessions

## Commands

- **Type check**: `pnpm run check-types`
- **Lint**: `pnpm exec biome check src` (Biome — check mode; `pnpm run lint` is the auto-fix form and must not be used for a gate)
- **Format**: `pnpm run format` (Biome — auto-format)
- **Test**: `pnpm run test:unit` (Vitest)
- **Bundle gate**: `pnpm run build:check-requires` (Node; needs `dist/` built) — regression tripwire: every `require()` surviving in `dist/extension.js` resolves, so a dependency that leaves an unfollowable relative require fails the build instead of the user's activation
- **I10 gate**: `pnpm run gate:fs-deletion` (TypeScript Program; ~1.6 s) — regression tripwire: no recognised destructive `node:fs` reference in the worktree removal path
- **E2E**: N/A

### `pnpm run test:unit` is load-flaky, and the flake is not yours

`src/extension.worktreeAssembly.test.ts` fails intermittently under full-suite load — a different
assertion each run, and it reproduces on `main` (verified at `e2f56060`: 2 of 3 runs passed). Dropping
vitest to 4 workers does NOT fix it. The cause is timer-based settling in a jsdom suite competing with
12 other workers, not any one change.

Two things follow.

- **Another session's full-suite run will fail your gate.** Two Claude sessions on this repository each
  running `test:unit` is enough to tip it, in both directions. Coordinate the window before blaming a
  diff.
- **Prefer `settleUntil(<condition>, <what>)` over `settle()`** in that file whenever you add or touch a
  test. `settle()` pumps a bounded number of event-loop turns and returns whether or not the work
  finished; it never returns earlier than it used to, but DOM quiescence is not settlement — a host
  suspended in `await assess(...)` paints nothing while it waits. Each remaining bare `settle()` is an
  unconverted instance of this defect.
