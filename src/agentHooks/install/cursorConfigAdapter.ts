// src/agentHooks/install/cursorConfigAdapter.ts — Cursor's document shape for
// the shared reconciler. Behaviour is the shipped CursorHookInstaller's, with
// two deliberate changes: managed-entry ownership is byte equality against a
// command the ledger recorded writing (D12), and the initial document for a
// missing file is adapter-owned (D10).

import { CURSOR_HOOK_ENV_VAR, CURSOR_HOOK_EVENTS, CURSOR_HOOK_SLUG } from "../agents/cursor";
import { type AgentConfigAdapter, isJsonObject, type JsonObject, type OwnershipTest } from "./types";

const MANAGED_TIMEOUT_SECONDS = 2;

export const CURSOR_WRAPPER_DIRECTORY = "cursor-hooks";

export function cursorConfigAdapter(configPath: string): AgentConfigAdapter {
  return {
    configPath: () => configPath,

    wrapperLocation: (platform) => ({
      directoryName: CURSOR_WRAPPER_DIRECTORY,
      fileName: platform === "win32" ? "cursor-hook-observer.cmd" : "cursor-hook-observer.sh",
    }),

    createInitialDocument: () => ({ version: 1, hooks: {} }),

    isSupportedDocument: (document) => {
      if (document.version !== 1 || !isJsonObject(document.hooks)) {
        return false;
      }
      return Object.values(document.hooks).every(
        (entries) => Array.isArray(entries) && entries.every((entry) => isJsonObject(entry)),
      );
    },

    applyManagedEntries: (document, command, isOwned) => {
      const hooks = document.hooks as Record<string, JsonObject[]>;
      for (const event of CURSOR_HOOK_EVENTS) {
        const entries = hooks[event] ?? [];
        hooks[event] = [...entries.filter((entry) => !isManagedEntry(entry, isOwned)), managedEntry(command)];
      }
      return true;
    },

    removeManagedEntries: (document, isOwned) => {
      const hooks = document.hooks as Record<string, JsonObject[]>;
      let removed = false;
      for (const [event, entries] of Object.entries(hooks)) {
        const retained = entries.filter((entry) => !isManagedEntry(entry, isOwned));
        if (retained.length !== entries.length) {
          hooks[event] = retained;
          removed = true;
        }
      }
      return removed;
    },

    wrapperScript: (platform) => (platform === "win32" ? windowsWrapper() : posixWrapper()),
  };
}

function managedEntry(command: string): JsonObject {
  return { command, timeout: MANAGED_TIMEOUT_SECONDS };
}

/**
 * The managed shape *and* extension-owned ownership. Requiring both is what
 * keeps a user's own `cursor-hook-observer.sh` elsewhere out of the sweep.
 */
function isManagedEntry(entry: JsonObject, isOwned: OwnershipTest): boolean {
  const keys = Object.keys(entry).sort();
  return (
    keys.length === 2 &&
    keys[0] === "command" &&
    keys[1] === "timeout" &&
    entry.timeout === MANAGED_TIMEOUT_SECONDS &&
    isOwned(entry.command)
  );
}

function posixWrapper(): string {
  // Kept out of one template so the emitted `${VAR}` is shell syntax, never
  // interpolated here. Do not let a lint autofix collapse these.
  const dollar = "$";
  const url = `${dollar}{${CURSOR_HOOK_ENV_VAR}}`;
  const optionalUrl = `${dollar}{${CURSOR_HOOK_ENV_VAR}:-}`;
  return `${[
    "#!/bin/sh",
    "# Managed by AnyWhere Terminal. This observer is intentionally fail-open.",
    `if [ -n "${optionalUrl}" ] && command -v curl >/dev/null 2>&1; then`,
    "  curl --silent --output /dev/null --connect-timeout 0.5 --max-time 1.5 \\",
    '    --request POST --header "content-type: application/json" \\',
    `    --data-binary @- "${url}/${CURSOR_HOOK_SLUG}" || true`,
    "fi",
    "cat >/dev/null 2>&1 || true",
    'printf "{}\\n"',
  ].join("\n")}\n`;
}

// The stdin reader is fully qualified: Windows resolves a bare `more` against
// the working directory before PATH, so a repo carrying its own `more.*` would
// otherwise receive the hook payload.
function windowsWrapper(): string {
  return `@echo off
setlocal
if not defined ${CURSOR_HOOK_ENV_VAR} goto output
powershell -NoProfile -ExecutionPolicy Bypass -Command "$body=[Console]::In.ReadToEnd(); try { Invoke-WebRequest -UseBasicParsing -Method Post -ContentType 'application/json' -TimeoutSec 2 -Body $body ($env:${CURSOR_HOOK_ENV_VAR} + '/${CURSOR_HOOK_SLUG}') ^| Out-Null } catch {}"
:output
"%SystemRoot%\\System32\\more.com" >nul 2>nul
echo {}
exit /b 0
`;
}

export function cursorWrapperScripts(): { posix: string; windows: string } {
  return { posix: posixWrapper(), windows: windowsWrapper() };
}
