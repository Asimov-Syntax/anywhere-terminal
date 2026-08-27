// Repro for 260827-worktree-agent-untitled.
//
// The report: every agent row in the Worktree view renders "(untitled)", for
// panes in this window AND for sessions running in another window, while the
// Claude session registry on disk names every one of them.
//
// Driven through the production wiring (`createPresenceProjectorDeps`) against a
// throwaway CLAUDE_CONFIG_DIR, so whichever seam carries the name has to work.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createPaneEvidenceStore } from "../../../src/session/PaneEvidenceStore";
import { listRunningClaudeSessions } from "../../../src/vault/readers/runningSessions";
import { createPresenceProjectorDeps } from "../../../src/worktree/presenceDeps";
import { createPresenceProjector } from "../../../src/worktree/presenceProjector";
import { agentRowTitle } from "../../../src/webview/worktree/worktreeFormat";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wt-untitled-"));
const configDir = path.join(root, "claude");
fs.mkdirSync(path.join(configDir, "sessions"), { recursive: true });

const HERE = path.join(root, "repo");
const OTHER = path.join(root, "repo", "worktrees", "hadern-analysis");
fs.mkdirSync(OTHER, { recursive: true });

/** A registry file exactly as claude 2.1.239 writes it — `name` included. */
function writeSession(pid: number, sessionId: string, cwd: string, name: string): void {
  fs.writeFileSync(
    path.join(configDir, "sessions", `${pid}.json`),
    JSON.stringify({
      pid,
      sessionId,
      cwd,
      startedAt: 1_787_819_754_846,
      version: "2.1.239",
      kind: "interactive",
      entrypoint: "cli",
      name,
      nameSource: "derived",
      status: "busy",
    }),
  );
}

writeSession(11111, "11111111-1111-4111-8111-111111111111", HERE, "cyberk-skills-f9");
writeSession(22222, "22222222-2222-4222-8222-222222222222", OTHER, "hadern-analysis-a7");

// A pane in THIS window, sitting in HERE. No ptyPid, so resolution takes the cwd
// step and no process table is read. No title is ever reported: claude 2.1.239
// emits no OSC 0/2 title, which is what a real pane looks like.
const store = createPaneEvidenceStore();
store.create("pane-1", { cwd: HERE, viewId: "view-1" });

const deps = createPresenceProjectorDeps({
  store,
  listRunning: () => listRunningClaudeSessions({ configDir }, { isAlive: () => true }),
  sessionMtime: async () => undefined,
});
const projector = createPresenceProjector(deps);

const presence = await projector.project([path.resolve(HERE), path.resolve(OTHER)]);
const rows = Object.values(presence.rowsByWorktreeId).flat();

const windowRow = rows.find((r) => r.scope === "window");
const externalRow = rows.find((r) => r.scope === "external");

let failed = 0;

function observe(n: number, what: string, actual: string | undefined, expected: string): void {
  const ok = actual === expected;
  console.log(`OBSERVES ${n}: ${ok ? "GREEN" : "RED"} — ${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (!ok) {
    failed += 1;
  }
}

observe(
  1,
  "a session running in another window shows its name",
  externalRow && agentRowTitle(externalRow),
  "hadern-analysis-a7",
);
observe(
  2,
  "a pane in this window shows its session name",
  windowRow && agentRowTitle(windowRow),
  "cyberk-skills-f9",
);

fs.rmSync(root, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
