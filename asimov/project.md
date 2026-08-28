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
- **I10 gate**: `pnpm run gate:fs-deletion` (TypeScript Program; ~1.6 s) — regression tripwire: no recognised destructive `node:fs` reference in the worktree removal path
- **E2E**: N/A
