// Repro for 260827-worktree-row-session-claim — two gaps in how a row claims a session.
//
// 1. Only claude publishes a pid registry, so only a claude pane ever gets an
//    `entryId` — an opencode pane is proven to be an agent by its launch record
//    and then has no session to be titled from.
// 2. Pane→session matching has no exclusivity: `resolveClaudeSession` step 2
//    matches every live session sharing the pane's cwd, so two panes in one
//    directory both wear the same session, the same title and the same
//    delegations. That is what the reporter's screenshot showed under `main`.
//
// Driven through the production wiring, with the process table injected so the
// pid step is decided rather than sampled.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createPaneEvidenceStore } from "../../../src/session/PaneEvidenceStore";
import { listRunningClaudeSessions } from "../../../src/vault/readers/runningSessions";
import { createPresenceProjectorDeps } from "../../../src/worktree/presenceDeps";
import { createPresenceProjector } from "../../../src/worktree/presenceProjector";
import { agentRowTitle } from "../../../src/webview/worktree/worktreeFormat";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wt-claim-"));
const configDir = path.join(root, "claude");
fs.mkdirSync(path.join(configDir, "sessions"), { recursive: true });

const REPO = path.join(root, "repo");
const OPEN = path.join(root, "repo", "worktrees", "opencode-wt");
fs.mkdirSync(OPEN, { recursive: true });

const CLAUDE_PID = 31_337;
const CLAUDE_SESSION = "11111111-1111-4111-8111-111111111111";
const OPENCODE_ENTRY = "opencode:ses_abc123";

fs.writeFileSync(
  path.join(configDir, "sessions", `${CLAUDE_PID}.json`),
  JSON.stringify({
    pid: CLAUDE_PID,
    sessionId: CLAUDE_SESSION,
    cwd: REPO,
    startedAt: 1_787_819_754_846,
    kind: "interactive",
    entrypoint: "cli",
    name: "cyberk-skills-f9",
    nameSource: "derived",
  }),
);

const VAULT_TITLES: Record<string, string> = {
  [`claude:${CLAUDE_SESSION}`]: "Adversarial review of Q3 options",
  [OPENCODE_ENTRY]: "Port the pty layer to bun",
};

// pane-claude runs claude: its pty subtree holds the registry pid — proof.
// pane-shell sits in the same directory with nothing under it — a guess.
// pane-opencode was launched as opencode, which publishes no registry at all.
const store = createPaneEvidenceStore();
store.create("pane-claude", { cwd: REPO, viewId: "v1", ptyPid: 1000, shell: "zsh" });
store.create("pane-shell", { cwd: REPO, viewId: "v1", ptyPid: 2000, shell: "zsh" });
store.create("pane-opencode", { cwd: OPEN, viewId: "v1", ptyPid: 3000, shell: "opencode", isAgentLaunch: true });

const DESCENDANTS: Record<number, number[]> = { 1000: [CLAUDE_PID], 2000: [], 3000: [] };

const deps = createPresenceProjectorDeps({
  store,
  listRunning: () => listRunningClaudeSessions({ configDir }, { isAlive: () => true }),
  sessionMtime: async () => undefined,
  sessionTitle: async (entryId) => VAULT_TITLES[entryId],
  sessionUnderCwd: async (agent, cwd) =>
    agent === "opencode" && cwd === path.resolve(OPEN) ? OPENCODE_ENTRY : undefined,
  table: {
    open: async () => ({
      descendantsOf: (pid: number) => ({ kind: "ok" as const, pids: DESCENDANTS[pid] ?? [] }),
    }),
  } as never,
});
const projector = createPresenceProjector(deps);

const presence = await projector.project([path.resolve(REPO), path.resolve(OPEN)]);
const rows = Object.values(presence.rowsByWorktreeId).flat();
const byPane = new Map(rows.map((r) => [r.paneId, r]));

let failed = 0;

function observe(n: number, what: string, ok: boolean, detail: string): void {
  console.log(`OBSERVES ${n}: ${ok ? "GREEN" : "RED"} — ${what}: ${detail}`);
  if (!ok) {
    failed += 1;
  }
}

const opencodeRow = byPane.get("pane-opencode");
const opencodeTitle = opencodeRow && agentRowTitle(opencodeRow);
observe(
  1,
  "an opencode pane is titled from the session recorded under its directory",
  opencodeTitle === "Port the pty layer to bun",
  `title=${JSON.stringify(opencodeTitle)} entryId=${JSON.stringify(opencodeRow?.entryId)}`,
);

const claudeRow = byPane.get("pane-claude");
const shellRow = byPane.get("pane-shell");
const claudeOwns = claudeRow?.entryId === `claude:${CLAUDE_SESSION}`;
const shellDisowns = shellRow?.entryId === undefined;
observe(
  2,
  "of two panes sharing a directory, only the one whose process subtree holds the session claims it",
  claudeOwns && shellDisowns,
  `pane-claude entryId=${JSON.stringify(claudeRow?.entryId)} title=${JSON.stringify(claudeRow && agentRowTitle(claudeRow))}; ` +
    `pane-shell entryId=${JSON.stringify(shellRow?.entryId)} title=${JSON.stringify(shellRow && agentRowTitle(shellRow))}`,
);

fs.rmSync(root, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
