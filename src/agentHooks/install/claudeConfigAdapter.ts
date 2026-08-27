// src/agentHooks/install/claudeConfigAdapter.ts — Claude's document shape for
// the shared reconciler. Claude's settings.json is a general settings file the
// user and a newer CLI both write to, so everything here is written to touch
// `hooks` and nothing else.

import { homedir } from "node:os";
import { join } from "node:path";
import { CLAUDE_HOOK_ENV_VAR, CLAUDE_HOOK_EVENTS, CLAUDE_HOOK_SLUG, CLAUDE_MATCHER_EVENTS } from "../agents/claude";
import { type AgentConfigAdapter, isJsonObject, type JsonObject, type OwnershipTest } from "./types";

const MANAGED_TIMEOUT_SECONDS = 2;

export const CLAUDE_WRAPPER_DIRECTORY = "claude-hooks";
export const CLAUDE_CONFIG_FILE = "settings.json";
export const CLAUDE_CONFIG_DIR_ENV_VAR = "CLAUDE_CONFIG_DIR";

export interface ClaudeConfigLocation {
  /** The `anywhereTerminal.agentHooks.claudeConfigDir` setting, read at resolution time (D4). */
  configuredDirectory?: () => string | undefined;
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: () => string;
}

/**
 * Setting → `CLAUDE_CONFIG_DIR` → `~/.claude` (D4). Re-resolved on every call
 * rather than captured once, so changing either takes effect on reload without
 * the installer holding a stale path.
 */
export function resolveClaudeConfigPath(location: ClaudeConfigLocation = {}): string {
  const configured = location.configuredDirectory?.()?.trim();
  if (configured) {
    return join(configured, CLAUDE_CONFIG_FILE);
  }
  const environment = (location.environment ?? process.env)[CLAUDE_CONFIG_DIR_ENV_VAR]?.trim();
  if (environment) {
    return join(environment, CLAUDE_CONFIG_FILE);
  }
  return join((location.homeDirectory ?? homedir)(), ".claude", CLAUDE_CONFIG_FILE);
}

export function claudeConfigAdapter(location: ClaudeConfigLocation = {}): AgentConfigAdapter {
  return {
    configPath: () => resolveClaudeConfigPath(location),

    wrapperLocation: (platform) => ({
      directoryName: CLAUDE_WRAPPER_DIRECTORY,
      fileName: platform === "win32" ? "claude-hook-observer.cmd" : "claude-hook-observer.sh",
    }),

    // Claude has no `version` field and no required key; an empty object is a
    // valid settings file that the reconciler then fills in.
    createInitialDocument: () => ({}),

    isSupportedDocument,

    applyManagedEntries: (document, command, isOwned) => {
      const hooks = (document.hooks as Record<string, JsonObject[]> | undefined) ?? {};
      document.hooks = hooks;
      for (const event of CLAUDE_HOOK_EVENTS) {
        const groups = sweepGroups(hooks[event] ?? [], isOwned);
        hooks[event] = [...groups, managedGroup(event, command)];
      }
      return true;
    },

    removeManagedEntries: (document, isOwned) => {
      const hooks = document.hooks as Record<string, JsonObject[]> | undefined;
      if (!hooks) {
        return false;
      }
      let removed = false;
      for (const [event, groups] of Object.entries(hooks)) {
        const retained = sweepGroups(groups, isOwned);
        if (retained.length !== groups.length || retained.some((group, index) => group !== groups[index])) {
          hooks[event] = retained;
          removed = true;
        }
      }
      return removed;
    },

    wrapperScript: (platform) => (platform === "win32" ? windowsWrapper() : posixWrapper()),
  };
}

/**
 * Every structural container, and nothing below it (D2). Handler objects keep
 * unknown keys and unknown `type` values: Claude's handler schema is extensible
 * and freezing it here would make a newer CLI's settings file unsupported.
 */
function isSupportedDocument(document: JsonObject): boolean {
  const hooks = document.hooks;
  if (hooks === undefined) {
    return true;
  }
  if (!isJsonObject(hooks)) {
    return false;
  }
  return Object.values(hooks).every(
    (groups) =>
      Array.isArray(groups) &&
      groups.every(
        (group) =>
          isJsonObject(group) &&
          Array.isArray(group.hooks) &&
          group.hooks.every((handler) => isJsonObject(handler)) &&
          (group.matcher === undefined || typeof group.matcher === "string"),
      ),
  );
}

function managedGroup(event: string, command: string): JsonObject {
  const handlers = [{ type: "command", command, timeout: MANAGED_TIMEOUT_SECONDS }];
  return CLAUDE_MATCHER_EVENTS.has(event) ? { matcher: "*", hooks: handlers } : { hooks: handlers };
}

/**
 * Drops our handlers wherever they sit, then drops any group left empty. A group
 * the user added handlers to survives with those handlers, and a group that held
 * only ours disappears rather than accumulating as an empty husk.
 */
function sweepGroups(groups: JsonObject[], isOwned: OwnershipTest): JsonObject[] {
  const swept: JsonObject[] = [];
  for (const group of groups) {
    const handlers = group.hooks as JsonObject[] | undefined;
    if (!Array.isArray(handlers)) {
      swept.push(group);
      continue;
    }
    const retained = handlers.filter((handler) => !isManagedHandler(handler, isOwned));
    if (retained.length === handlers.length) {
      swept.push(group);
      continue;
    }
    if (retained.length > 0) {
      swept.push({ ...group, hooks: retained });
    }
  }
  return swept;
}

/** The managed shape *and* extension-owned ownership, exactly as cursor's is (D3). */
function isManagedHandler(handler: JsonObject, isOwned: OwnershipTest): boolean {
  const keys = Object.keys(handler).sort();
  return (
    keys.length === 3 &&
    keys[0] === "command" &&
    keys[1] === "timeout" &&
    keys[2] === "type" &&
    handler.type === "command" &&
    handler.timeout === MANAGED_TIMEOUT_SECONDS &&
    isOwned(handler.command)
  );
}

function posixWrapper(): string {
  // Kept out of one template so the emitted `${VAR}` is shell syntax, never
  // interpolated here. Do not let a lint autofix collapse these.
  const dollar = "$";
  const url = `${dollar}{${CLAUDE_HOOK_ENV_VAR}}`;
  const optionalUrl = `${dollar}{${CLAUDE_HOOK_ENV_VAR}:-}`;
  return `${[
    "#!/bin/sh",
    "# Managed by AnyWhere Terminal. This observer is intentionally fail-open.",
    "# The {} is defensive output; emitting it first covers every exit path below.",
    'printf "{}\\n"',
    "# Captured before the guards: an early exit must not leave the caller writing",
    "# into a pipe nothing reads.",
    "payload=$(cat)",
    "# A backgrounded session inherited the dispatching terminal's environment.",
    `if [ -n "${dollar}{CLAUDE_JOB_DIR:-}" ]; then`,
    "  exit 0",
    "fi",
    `if [ -z "${optionalUrl}" ] || ! command -v curl >/dev/null 2>&1; then`,
    "  exit 0",
    "fi",
    `printf '%s' "${dollar}payload" | curl --silent --output /dev/null \\`,
    "  --connect-timeout 0.5 --max-time 1.5 \\",
    '  --request POST --header "content-type: application/json" \\',
    `  --data-binary @- "${url}/${CLAUDE_HOOK_SLUG}" || true`,
    "exit 0",
  ].join("\n")}\n`;
}

function windowsWrapper(): string {
  // Inverted against the POSIX order on purpose: outside a managed terminal the
  // caller may abandon stdin rather than close it, and a read-to-EOF then never
  // returns. Windows checks the environment before it owns stdin; curl drains it
  // on the only path that reads. Both binaries are fully qualified because
  // Windows searches the working directory before PATH.
  return `@echo off
setlocal
echo {}
if not "%CLAUDE_JOB_DIR%"=="" exit /b 0
if not defined ${CLAUDE_HOOK_ENV_VAR} exit /b 0
"%SystemRoot%\\System32\\curl.exe" --silent --output nul --connect-timeout 0.5 --max-time 1.5 --request POST --header "content-type: application/json" --data-binary @- "%${CLAUDE_HOOK_ENV_VAR}%/${CLAUDE_HOOK_SLUG}" >nul 2>nul
exit /b 0
`;
}

export function claudeWrapperScripts(): { posix: string; windows: string } {
  return { posix: posixWrapper(), windows: windowsWrapper() };
}
