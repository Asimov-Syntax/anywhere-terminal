import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { CLAUDE_HOOK_EVENTS, CLAUDE_MATCHER_EVENTS } from "../agents/claude";

export const CLAUDE_CONFIG_DIR_ENV_VAR = "CLAUDE_CONFIG_DIR";
export const CLAUDE_CONFIG_FILE = "settings.json";
export const CLAUDE_HOOK_TIMEOUT_SECONDS = 2;

export type JsonObject = Record<string, unknown>;

export interface ClaudeConfigLocation {
  configuredDirectory?: () => string | undefined;
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: () => string;
}

/** Resolves one absolute destination; relative overrides never inherit the host cwd. */
export function resolveClaudeConfigPath(location: ClaudeConfigLocation = {}): string {
  const configured = location.configuredDirectory?.()?.trim();
  if (configured && isAbsolute(configured)) {
    return join(configured, CLAUDE_CONFIG_FILE);
  }
  const fromEnvironment = (location.environment ?? process.env)[CLAUDE_CONFIG_DIR_ENV_VAR]?.trim();
  if (fromEnvironment && isAbsolute(fromEnvironment)) {
    return join(fromEnvironment, CLAUDE_CONFIG_FILE);
  }
  return join((location.homeDirectory ?? homedir)(), ".claude", CLAUDE_CONFIG_FILE);
}

export type ClaudeReconcileResult =
  | { kind: "changed"; document: JsonObject }
  | { kind: "unchanged"; document: JsonObject }
  | { kind: "unsupported" }
  | { kind: "ownership-conflict" };

/**
 * Applies only canonical singleton groups. Seeing the current exact handler in
 * any user-shaped group is ambiguous ownership and therefore makes no change.
 */
export function reconcileClaudeSettings(
  source: JsonObject,
  operation: "install" | "remove",
  command: string,
): ClaudeReconcileResult {
  if (!isSupportedClaudeSettings(source)) {
    return { kind: "unsupported" };
  }
  if (hasOwnershipConflict(source, command)) {
    return { kind: "ownership-conflict" };
  }

  const document = structuredClone(source);
  const hooks = (document.hooks as JsonObject | undefined) ?? {};
  if (document.hooks === undefined && operation === "install") {
    document.hooks = hooks;
  }
  let changed = false;
  for (const event of CLAUDE_HOOK_EVENTS) {
    const groups = hooks[event];
    const existing = Array.isArray(groups) ? (groups as JsonObject[]) : [];
    const retained = existing.filter((group) => !isCanonicalManagedGroup(event, group, command));
    if (operation === "install") {
      retained.push(canonicalManagedGroup(event, command));
    }
    if (!sameGroupSequence(existing, retained)) {
      hooks[event] = retained;
      changed = true;
    }
  }
  return changed ? { kind: "changed", document } : { kind: "unchanged", document: source };
}

export function isSupportedClaudeSettings(document: JsonObject): boolean {
  if (document.hooks === undefined) {
    return true;
  }
  if (!isJsonObject(document.hooks)) {
    return false;
  }
  return Object.values(document.hooks).every(
    (groups) =>
      Array.isArray(groups) &&
      groups.every(
        (group) =>
          isJsonObject(group) &&
          Array.isArray(group.hooks) &&
          group.hooks.every(isJsonObject) &&
          (group.matcher === undefined || typeof group.matcher === "string"),
      ),
  );
}

export function canonicalManagedGroup(event: string, command: string): JsonObject {
  const hooks = [{ type: "command", command, timeout: CLAUDE_HOOK_TIMEOUT_SECONDS }];
  return CLAUDE_MATCHER_EVENTS.has(event) ? { matcher: "*", hooks } : { hooks };
}

function hasOwnershipConflict(document: JsonObject, command: string): boolean {
  const hooks = document.hooks as JsonObject | undefined;
  if (!hooks) {
    return false;
  }
  for (const [event, groups] of Object.entries(hooks)) {
    for (const group of groups as JsonObject[]) {
      for (const handler of group.hooks as JsonObject[]) {
        if (isExactManagedHandler(handler, command) && !isCanonicalManagedGroup(event, group, command)) {
          return true;
        }
      }
    }
  }
  return false;
}

function isCanonicalManagedGroup(event: string, group: JsonObject, command: string): boolean {
  if (
    !new Set<string>(CLAUDE_HOOK_EVENTS).has(event) ||
    !hasOnlyKeys(group, CLAUDE_MATCHER_EVENTS.has(event) ? ["hooks", "matcher"] : ["hooks"])
  ) {
    return false;
  }
  if (CLAUDE_MATCHER_EVENTS.has(event) && group.matcher !== "*") {
    return false;
  }
  const handlers = group.hooks;
  return (
    Array.isArray(handlers) &&
    handlers.length === 1 &&
    isJsonObject(handlers[0]) &&
    isExactManagedHandler(handlers[0], command)
  );
}

function isExactManagedHandler(handler: JsonObject, command: string): boolean {
  return (
    hasOnlyKeys(handler, ["command", "timeout", "type"]) &&
    handler.type === "command" &&
    handler.command === command &&
    handler.timeout === CLAUDE_HOOK_TIMEOUT_SECONDS
  );
}

function hasOnlyKeys(object: JsonObject, expected: string[]): boolean {
  const keys = Object.keys(object).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function sameGroupSequence(left: JsonObject[], right: JsonObject[]): boolean {
  return (
    left.length === right.length && left.every((group, index) => JSON.stringify(group) === JSON.stringify(right[index]))
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
