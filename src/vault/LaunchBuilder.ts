// src/vault/LaunchBuilder.ts — Synthesize a resume/fork launch as an argv array.
// See: specs/vault-session-launch/spec.md (Resume; Fork; Preserve Claude
//      auth/config; Injection-safe construction), design.md D5,D6,D9.
//
// Output is an argv array — `file` + `args[]` — never a shell string, so a
// session id/flag containing shell metacharacters (e.g. "a; rm -rf ~") is one
// inert argument and cannot inject a command (D9). The CLI re-reads its own
// session files; AT never parses the resumed transcript.

import { resolveAgentExecutable } from "../cursor/CursorExecutableResolver";
import { posixShellQuote } from "../utils/posixShellQuote";
import { applyContextTag, readClaudeContextTag } from "./claudeContextTag";
import { isCursorCliResumableEntry } from "./cursorCapabilities";
import { getAgentDefinition } from "./registry";
import type { AgentVaultDefinition, CommandTemplate, VaultSessionEntry } from "./types";

export type LaunchMode = "resume" | "fork" | "continue";

export interface LaunchSpec {
  file: string;
  args: string[];
  cwd: string;
  /** Per-session env override merged OVER the host env at spawn (D5/D6). */
  env: Record<string, string>;
}

export class VaultLaunchError extends Error {
  constructor(
    message: string,
    readonly code:
      | "unknown-agent"
      | "no-fork-command"
      | "fork-unsupported"
      | "resume-unsupported"
      | "unknown-entry"
      | "no-continue-command"
      | "no-prompt"
      | "unknown-permission-choice"
      | "executable-not-found",
  ) {
    super(message);
    this.name = "VaultLaunchError";
  }
}

function substituteTokens(token: string, entry: VaultSessionEntry, executable: string, prompt: string): string {
  return token
    .replace(/\{\{sessionId\}\}/g, entry.sessionId)
    .replace(/\{\{sessionPath\}\}/g, "")
    .replace(/\{\{executable\}\}/g, executable)
    .replace(/\{\{prompt\}\}/g, prompt);
}

function expandArgs(
  template: CommandTemplate,
  entry: VaultSessionEntry,
  executable = template.executable,
  prompt = "",
  contextTag?: string,
): string[] {
  const args: string[] = [];
  for (const part of template.args) {
    if (typeof part === "string") {
      args.push(substituteTokens(part, entry, executable, prompt));
      continue;
    }
    // Flag fragment: emit [flag, value] only when the captured value is present.
    const value = entry.flags[part.from];
    if (value === undefined || value === "") {
      continue;
    }
    args.push(part.flag);
    // The captured model is canonical — the transcript never records the window
    // the session ran under — so the reader's configured tag is restated here or
    // the resume silently drops to the narrow context.
    const tagged = part.from === "model" ? applyContextTag(value, contextTag) : value;
    args.push(part.valueTemplate ? part.valueTemplate.replace(/\{\{value\}\}/g, tagged) : tagged);
  }
  return args;
}

function assertLaunchCapability(entry: VaultSessionEntry, mode: LaunchMode): void {
  if (mode === "continue") {
    return;
  }
  if (mode === "fork") {
    if (!entry.canFork) {
      throw new VaultLaunchError(`Fork is not supported for ${entry.id}`, "fork-unsupported");
    }
    return;
  }
  if (entry.agent === "cursor") {
    if (!isCursorCliResumableEntry(entry)) {
      throw new VaultLaunchError(`Resume is not supported for ${entry.id}`, "resume-unsupported");
    }
    return;
  }
  if (entry.canResume === false) {
    throw new VaultLaunchError(`Resume is not supported for ${entry.id}`, "resume-unsupported");
  }
}

function resolveTemplateExecutable(template: CommandTemplate, executable?: string): string {
  if (!template.executable.includes("{{executable}}")) {
    return template.executable;
  }
  if (!executable) {
    throw new VaultLaunchError("No executable found for launch", "executable-not-found");
  }
  return template.executable.replace(/\{\{executable\}\}/g, executable);
}

/**
 * Quote one argv token for a readable, paste-safe POSIX command string. Simple
 * tokens (ids, flags, `key=value`) pass through unquoted; anything else falls
 * back to the canonical `posixShellQuote` (which neutralizes metacharacters,
 * including apostrophes). The result is COPIED for the user to inspect/run —
 * never executed by us.
 */
function shellQuoteArg(arg: string): string {
  if (arg !== "" && /^[A-Za-z0-9_./:=@-]+$/.test(arg)) {
    return arg;
  }
  return posixShellQuote(arg);
}

/**
 * Render the registry resume template (executable + captured flags) to a single
 * shell command string for "Copy Resume Command" (redesign-vault-panel-ui D9).
 * Reuses the same flag substitution as `build`.
 */
export async function buildResumeCommandString(
  entry: VaultSessionEntry,
  hostEnv: Record<string, string | undefined> = {},
): Promise<string> {
  const def = getAgentDefinition(entry.agent);
  if (!def) {
    throw new VaultLaunchError(`Unknown agent: ${entry.agent}`, "unknown-agent");
  }
  assertLaunchCapability(entry, "resume");
  const template = def.resumeCommand;
  const resolvedExecutable = await resolveLaunchExecutable(entry, "resume");
  const executable = resolveTemplateExecutable(template, resolvedExecutable);
  const args = expandArgs(template, entry, executable, "", await resolveContextTag(entry, hostEnv));
  return [executable, ...args].map(shellQuoteArg).join(" ");
}

/**
 * The context-window tag a Claude launch must restate (see claudeContextTag).
 * Every root comes from the captured entry or the INJECTED host env — never from
 * `process.env` or the real home — so the launcher reads no config nobody handed
 * it, and a test cannot pick up the developer's own settings. Other agents encode
 * no such tag in their model ids, so they get none.
 */
export async function resolveContextTag(
  entry: VaultSessionEntry,
  hostEnv: Record<string, string | undefined>,
  agent = entry.agent,
): Promise<string | undefined> {
  if (agent !== "claude") {
    return undefined;
  }
  return readClaudeContextTag({
    configDir: entry.flags.configDir ?? hostEnv.CLAUDE_CONFIG_DIR,
    home: hostEnv.HOME ?? hostEnv.USERPROFILE,
    cwd: entry.cwd,
    envModel: hostEnv.ANTHROPIC_MODEL,
  });
}

function buildClaudeEnv(
  def: AgentVaultDefinition,
  entry: VaultSessionEntry,
  hostEnv: Record<string, string | undefined>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of def.authEnvAllowlist ?? []) {
    const value = hostEnv[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  // A configDir captured at index time overrides the host's (D6).
  if (entry.flags.configDir) {
    env.CLAUDE_CONFIG_DIR = entry.flags.configDir;
  }
  return env;
}

/** What the continuation dialog chose (D11); both fall back to the entry. */
export interface ContinuationTarget {
  agent?: string;
  permissionChoiceId?: string;
}

/**
 * The posture to launch under: the reader's choice, else the one the entry was
 * captured with, on whichever axis this agent keys its choices by.
 */
function permissionArgs(def: AgentVaultDefinition, entry: VaultSessionEntry, chosenId?: string): string[] {
  const choices = def.permissionChoices;
  if (!choices?.length) {
    return [];
  }
  if (chosenId !== undefined) {
    const chosen = choices.find((c) => c.id === chosenId);
    if (!chosen) {
      throw new VaultLaunchError(`Unknown permission choice: ${chosenId}`, "unknown-permission-choice");
    }
    return chosen.args;
  }
  const captured = entry.flags.permissionMode ?? entry.flags.sandbox;
  if (!captured) {
    return [];
  }
  return (choices.find((c) => c.id === captured) ?? choices[0]).args;
}

export async function resolveLaunchExecutable(
  entry: VaultSessionEntry,
  mode: LaunchMode,
  target?: ContinuationTarget,
): Promise<string | undefined> {
  assertLaunchCapability(entry, mode);
  const agent = mode === "continue" ? (target?.agent ?? entry.agent) : entry.agent;
  const def = getAgentDefinition(agent);
  if (!def) {
    return undefined;
  }
  const template = mode === "continue" ? def.continueCommand : mode === "fork" ? def.forkCommand : def.resumeCommand;
  if (!template?.executable.includes("{{executable}}")) {
    return undefined;
  }
  const executable = await resolveAgentExecutable(def);
  if (!executable) {
    throw new VaultLaunchError(`No executable found for ${def.displayName}`, "executable-not-found");
  }
  return executable;
}

function buildContinue(
  entry: VaultSessionEntry,
  hostEnv: Record<string, string | undefined>,
  prompt: string | undefined,
  target: ContinuationTarget | undefined,
  resolvedExecutable: string | undefined,
  contextTag: string | undefined,
): LaunchSpec {
  const agent = target?.agent ?? entry.agent;
  const def = getAgentDefinition(agent);
  if (!def?.continueCommand) {
    throw new VaultLaunchError(`Unknown agent: ${agent}`, "unknown-agent");
  }
  const continueCommand = def.continueCommand;
  if (!prompt?.trim()) {
    throw new VaultLaunchError("Continue needs a prompt", "no-prompt");
  }
  // Captured flags describe the SOURCE agent's run — a claude model id means
  // nothing to codex — so continuing into a different agent starts from none.
  const source: VaultSessionEntry = agent === entry.agent ? entry : { ...entry, flags: {} };
  const executable = resolveTemplateExecutable(continueCommand, resolvedExecutable);
  return {
    file: executable,
    args: [
      ...permissionArgs(def, source, target?.permissionChoiceId),
      ...expandArgs(continueCommand, source, executable, prompt, agent === "claude" ? contextTag : undefined),
    ],
    cwd: entry.cwd,
    env: def.id === "claude" ? buildClaudeEnv(def, source, hostEnv) : {},
  };
}

/**
 * Build the argv + env + cwd for resuming/forking `entry`. `hostEnv` is the
 * extension-host environment (typically `process.env`); only Claude's allowlist
 * is forwarded from it (D6) — other agents inherit the host env via the normal
 * spawn path, so their override is empty.
 */
export function build(
  entry: VaultSessionEntry,
  mode: LaunchMode,
  hostEnv: Record<string, string | undefined>,
  prompt?: string,
  target?: ContinuationTarget,
  resolvedExecutable?: string,
  contextTag?: string,
): LaunchSpec {
  const def = getAgentDefinition(entry.agent);
  if (!def) {
    throw new VaultLaunchError(`Unknown agent: ${entry.agent}`, "unknown-agent");
  }
  assertLaunchCapability(entry, mode);
  // `continue` is the one mode whose values come from the CALL, not the entry: the
  // host composed the prompt (D7) and the reader chose the agent and posture (D11).
  if (mode === "continue") {
    return buildContinue(entry, hostEnv, prompt, target, resolvedExecutable, contextTag);
  }
  const template = mode === "fork" ? def.forkCommand : def.resumeCommand;
  if (!template) {
    throw new VaultLaunchError(`Agent ${entry.agent} has no fork command`, "no-fork-command");
  }

  const env = def.id === "claude" ? buildClaudeEnv(def, entry, hostEnv) : {};
  const executable = resolveTemplateExecutable(template, resolvedExecutable);
  return {
    file: executable,
    args: expandArgs(template, entry, executable, "", def.id === "claude" ? contextTag : undefined),
    cwd: entry.cwd,
    env,
  };
}
