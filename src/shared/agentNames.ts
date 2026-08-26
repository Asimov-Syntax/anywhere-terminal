// src/shared/agentNames.ts — Whole-token name matching for terminal titles.
//
// Two questions this answers, both about a pane's reported title: does it name a
// shell (the shell has reclaimed the pane), and does it commit to an agent?
//
// Pure and dependency-free by contract: `isShellName` is imported from the
// webview bundle by the tab's activity tracker as well as by the host, so the
// tab and the worktree row cannot come to different answers.
//
// See: docs/design/worktree-agent-presence.md § 3.2, § 6;
//      asimov/changes/project-worktree-agent-presence/design.md D5.

import type { VaultAgentId } from "../vault/types";

/**
 * Whole-token boundary guard.
 *
 * `includes` is what this exists to prevent: `openclaude ⊃ claude` and
 * `opencode-blinker ⊃ opencode` both produce a false identity whenever a title
 * falls back to a bare directory name. Rejecting `\w`, `.`, `/`, `\` and `-` on
 * both sides kills path segments and hyphenated compounds alike. The optional
 * Windows suffix is admitted because a launcher process legitimately surfaces
 * as `claude.exe`.
 */
function tokenPattern(name: string): RegExp {
  return new RegExp(`(?<![\\w./\\\\-])${name}(?:\\.(?:exe|cmd|bat|ps1))?(?![\\w./\\\\-])`, "i");
}

/**
 * The agent names a TITLE may claim — deliberately NARROWER than
 * `VAULT_AGENT_IDS`, which is the set the product can launch.
 *
 * Title identity is the weakest rank in the precedence, so it is the one that
 * must not be widened for convenience. `cursor` is excluded because it is an
 * ordinary English word: admitting it would paint any pane whose title mentions
 * a cursor as a running agent. Cursor Agent is still recognised, by the
 * distinctive `cursor-agent` token it actually launches under. The same reasoning
 * keeps short generic names out of the reference implementation's title path.
 *
 * Ordered longest-first so a compound token is tested before any prefix of it.
 */
export const TITLE_AGENT_NAMES: ReadonlyArray<{ token: string; agent: VaultAgentId }> = [
  { token: "cursor-agent", agent: "cursor" },
  { token: "opencode", agent: "opencode" },
  { token: "claude", agent: "claude" },
  { token: "codex", agent: "codex" },
];

const TITLE_AGENT_PATTERNS: ReadonlyArray<{ re: RegExp; agent: VaultAgentId }> = TITLE_AGENT_NAMES.map(
  ({ token, agent }) => ({ re: tokenPattern(token), agent }),
);

/**
 * Shells whose name in a title is strong evidence the agent has ended and the
 * shell has the pane back.
 *
 * An allow-list, never "not an agent name": a title we do not recognise is
 * neutral, and treating it as a shell would silence a working agent whose title
 * we simply have no rule for.
 */
const SHELL_NAMES = [
  "bash",
  "zsh",
  "sh",
  "fish",
  "pwsh",
  "powershell",
  "cmd",
  "nu",
  "dash",
  "ksh",
  "tcsh",
  "csh",
  "xonsh",
  "elvish",
] as const;

const SHELL_PATTERNS: readonly RegExp[] = SHELL_NAMES.map(tokenPattern);

/** The agent a title commits to, or `undefined` when it commits to none. */
export function matchTitleAgentName(text: string | undefined): VaultAgentId | undefined {
  if (!text) {
    return undefined;
  }
  for (const { re, agent } of TITLE_AGENT_PATTERNS) {
    if (re.test(text)) {
      return agent;
    }
  }
  return undefined;
}

/** True when `text` names a shell as a whole token. */
export function isShellName(text: string | undefined): boolean {
  if (!text) {
    return false;
  }
  return SHELL_PATTERNS.some((re) => re.test(text));
}
