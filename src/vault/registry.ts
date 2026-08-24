// src/vault/registry.ts — Data-driven AI CLI agent definitions.
// See: asimov/changes/add-ai-coding-vault/specs/agent-vault-registry/spec.md,
//      design.md D1, docs/research/20260528-cmux-vault-mechanism.md §1,§5,§6,§7.
//
// Launch (resume/fork) is fully data-driven from these records (D1): adding an
// agent's launch needs only a record here. History *reading* still needs a
// small per-agent reader (src/vault/readers/) because path layout + schema
// differ per agent.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveAgentExecutable } from "../cursor/CursorExecutableResolver";
import { type AgentVaultDefinition, VAULT_AGENT_IDS, type VaultAgentId, type VaultLaunchTarget } from "./types";

// Re-exported for back-compat: the SINGLE source now lives in types.ts (so the
// webview can share it without importing the host's launch data). See types.ts.
export { VAULT_AGENT_IDS, type VaultAgentId } from "./types";

/**
 * Claude's auth/config env allowlist — the only host env vars forwarded to a
 * resumed/forked Claude so it targets the same account (research §5,
 * RestorableAgentSession.swift:276-286). Version-fragile by design: kept here
 * so a drift fix is one line.
 */
export const CLAUDE_AUTH_ENV_ALLOWLIST = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CONFIG_DIR",
] as const;

const claude: AgentVaultDefinition = {
  id: "claude",
  displayName: "Claude Code",
  detect: { executable: "claude" },
  sessionStore: {
    format: "jsonl",
    pathTemplate: "<$CLAUDE_CONFIG_DIR|~/.claude>/projects/<encoded-cwd>/*.jsonl",
  },
  sessionIdSource: "filename-stem",
  // claude --resume <sessionId> [--model <m>] [--permission-mode <p>]
  resumeCommand: {
    executable: "claude",
    args: [
      "--resume",
      "{{sessionId}}",
      { flag: "--model", from: "model" },
      { flag: "--permission-mode", from: "permissionMode" },
    ],
  },
  // claude --resume <sessionId> --fork-session
  forkCommand: {
    executable: "claude",
    args: ["--resume", "{{sessionId}}", "--fork-session"],
  },
  // claude [--model <m>] [--permission-mode <p>] "<prompt>" — a NEW session seeded
  // with the handoff prompt. Claude 2.x has no composer-prefill flag, so the
  // positional prompt submits on launch, and it goes LAST so the flags parse.
  // The run settings mirror resume: continuing must not silently drop the reader
  // into a stricter session than the one they are continuing from.
  continueCommand: {
    executable: "claude",
    args: [{ flag: "--model", from: "model" }, "{{prompt}}"],
  },
  cwdPolicy: "preserve",
  authEnvAllowlist: [...CLAUDE_AUTH_ENV_ALLOWLIST],
  // Ids ARE claude's own `--permission-mode` values, so a captured posture
  // selects its choice by equality with no mapping table (D11).
  permissionChoices: [
    { id: "default", label: "Ask for permission", args: ["--permission-mode", "default"] },
    { id: "plan", label: "Plan only", args: ["--permission-mode", "plan"] },
    { id: "acceptEdits", label: "Accept edits", args: ["--permission-mode", "acceptEdits"] },
    {
      id: "bypassPermissions",
      label: "Bypass permission checks",
      dangerous: true,
      args: ["--permission-mode", "bypassPermissions"],
    },
  ],
};

const codex: AgentVaultDefinition = {
  id: "codex",
  displayName: "Codex",
  detect: { executable: "codex" },
  sessionStore: {
    format: "sqlite",
    pathTemplate: "~/.codex/state_5.sqlite (threads); fallback ~/.codex/sessions/**/*.jsonl",
  },
  sessionIdSource: "threads.id",
  // codex resume <sessionId> [-m <m>] [-a <approval>] [-s <sandbox>] [-c model_reasoning_effort=<e>]
  resumeCommand: {
    executable: "codex",
    args: [
      "resume",
      "{{sessionId}}",
      { flag: "-m", from: "model" },
      { flag: "-a", from: "approval" },
      { flag: "-s", from: "sandbox" },
      { flag: "-c", from: "reasoningEffort", valueTemplate: "model_reasoning_effort={{value}}" },
    ],
  },
  // codex fork <sessionId>
  forkCommand: {
    executable: "codex",
    args: ["fork", "{{sessionId}}"],
  },
  // codex [-m <m>] [-a <approval>] [-s <sandbox>] [-c …] "<prompt>"
  continueCommand: {
    executable: "codex",
    args: [
      { flag: "-m", from: "model" },
      { flag: "-c", from: "reasoningEffort", valueTemplate: "model_reasoning_effort={{value}}" },
      "{{prompt}}",
    ],
  },
  cwdPolicy: "preserve",
  // Codex splits permission over approval AND sandbox, so a choice carries both
  // and is identified by its sandbox value — the axis the entry captures (D11).
  permissionChoices: [
    { id: "read-only", label: "Read only", args: ["-a", "untrusted", "-s", "read-only"] },
    { id: "workspace-write", label: "Write in the workspace", args: ["-a", "on-request", "-s", "workspace-write"] },
    {
      id: "danger-full-access",
      label: "Full access, no approvals",
      dangerous: true,
      args: ["--dangerously-bypass-approvals-and-sandbox"],
    },
  ],
};

const opencode: AgentVaultDefinition = {
  id: "opencode",
  displayName: "OpenCode",
  detect: { executable: "opencode" },
  sessionStore: {
    format: "sqlite",
    pathTemplate: "~/.local/share/opencode/opencode.db (session)",
  },
  sessionIdSource: "session.id",
  // opencode --session <sessionId> [-m <model>] [--agent <agent>]
  resumeCommand: {
    executable: "opencode",
    args: ["--session", "{{sessionId}}", { flag: "-m", from: "model" }, { flag: "--agent", from: "agent" }],
  },
  // opencode --session <sessionId> --fork (gated ≥ 1.1.54, when --fork landed)
  forkCommand: {
    executable: "opencode",
    args: ["--session", "{{sessionId}}", "--fork"],
  },
  forkMinVersion: "1.1.54",
  // opencode [-m <model>] [--agent <agent>] --prompt "<prompt>"
  continueCommand: {
    executable: "opencode",
    args: [{ flag: "-m", from: "model" }, { flag: "--agent", from: "agent" }, "--prompt", "{{prompt}}"],
  },
  cwdPolicy: "preserve",
};

const cursor: AgentVaultDefinition = {
  id: "cursor",
  displayName: "Cursor Agent",
  detect: {
    executable: "agent",
    aliases: ["cursor-agent"],
    requiredHelpTokens: ["prompt", "--resume", "--mode", "plan", "--force"],
  },
  sessionStore: {
    format: "metadata-json",
    pathTemplate: "~/.cursor/chats/<workspace-bucket>/<chat-id>/meta.json",
  },
  sessionIdSource: "chat-directory-name (compatibility-gated for resume)",
  resumeCommand: {
    executable: "{{executable}}",
    args: ["--resume", "{{sessionId}}"],
  },
  continueCommand: {
    executable: "{{executable}}",
    args: ["{{prompt}}"],
  },
  cwdPolicy: "preserve",
  permissionChoices: [
    { id: "default", label: "Ask for permission", args: [] },
    { id: "plan", label: "Plan only", args: ["--mode", "plan"] },
    { id: "force", label: "Full access, no approvals", dangerous: true, args: ["--force"] },
  ],
};

// `satisfies Record<VaultAgentId, …>` makes omitting an agent a compile error
// while keeping the public map string-indexable (callers pass `entry.agent`).
const AGENT_RECORD = { claude, codex, opencode, cursor } satisfies Record<VaultAgentId, AgentVaultDefinition>;

export const AGENT_REGISTRY: Record<string, AgentVaultDefinition> = AGENT_RECORD;

/** Registry records in `VAULT_AGENT_IDS` order. */
export const AGENT_DEFINITIONS: AgentVaultDefinition[] = VAULT_AGENT_IDS.map((id) => AGENT_RECORD[id]);

export function getAgentDefinition(id: string): AgentVaultDefinition | undefined {
  return AGENT_REGISTRY[id];
}

/**
 * Map a launched executable (a session's `shell`) back to its agent id, e.g.
 * "codex" / "/usr/local/bin/opencode" / "claude.cmd" → the VaultAgentId. Used to
 * pick the correct image-paste PTY trigger per running CLI. Returns undefined for
 * plain shells and unknown commands.
 */
const execFileAsync = promisify(execFile);

export interface AgentDetectDeps {
  exec(file: string, args: string[], options: { timeout: number }): Promise<{ stdout: string; stderr: string }>;
}

const defaultDetectDeps: AgentDetectDeps = {
  exec: (file, args, options) =>
    execFileAsync(file, args, { timeout: options.timeout }).then(({ stdout, stderr }) => ({
      stdout: stdout.toString(),
      stderr: stderr.toString(),
    })),
};

/**
 * The agents a continuation can start, in registry order: those that can be
 * seeded with a prompt at all AND whose executable answers on this host. Probed
 * rather than assumed — the dialog offering an agent that is not installed would
 * fail at spawn, after the reader committed (D11).
 */
export async function detectContinuationTargets(
  deps: AgentDetectDeps = defaultDetectDeps,
): Promise<VaultLaunchTarget[]> {
  const candidates = AGENT_DEFINITIONS.filter((d) => d.continueCommand);
  const present = await Promise.all(
    candidates.map(async (definition) => (await resolveAgentExecutable(definition, deps)) !== null),
  );
  return candidates
    .filter((_, i) => present[i])
    .map((d) => ({ agent: d.id, displayName: d.displayName, permissionChoices: d.permissionChoices ?? [] }));
}

export function agentKindForExecutable(executable: string | undefined): VaultAgentId | undefined {
  if (!executable) {
    return undefined;
  }
  const base = executable
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(/\.(exe|cmd|bat|ps1)$/i, "")
    .toLowerCase();
  if (!base) {
    return undefined;
  }
  return AGENT_DEFINITIONS.find(
    (definition) =>
      definition.id === base ||
      definition.detect.executable.toLowerCase() === base ||
      definition.detect.aliases?.some((alias) => alias.toLowerCase() === base),
  )?.id;
}
