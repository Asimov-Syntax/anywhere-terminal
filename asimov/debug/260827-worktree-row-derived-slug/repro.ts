// Repro for 260827-worktree-row-derived-slug.
//
// The report: two different panes in one repo both read `cyberk-skills-f9` —
// the directory slug claude derived for itself (`nameSource: "derived"`), which
// says nothing about what either session is doing.
//
// orca titles a claude session from its transcript (custom-title > latest
// ai-title > first user prompt) and never reads the pid registry's `name`.
// `claudeReader.ts:344` already computes exactly that title; the projection just
// never asked for it unless the registry had nothing.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createPaneEvidenceStore } from "../../../src/session/PaneEvidenceStore";
import { listRunningClaudeSessions } from "../../../src/vault/readers/runningSessions";
import { createPresenceProjectorDeps } from "../../../src/worktree/presenceDeps";
import { createPresenceProjector } from "../../../src/worktree/presenceProjector";
import { agentRowTitle } from "../../../src/webview/worktree/worktreeFormat";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wt-slug-"));
const configDir = path.join(root, "claude");
fs.mkdirSync(path.join(configDir, "sessions"), { recursive: true });

const HERE = path.join(root, "repo");
const OTHER = path.join(root, "repo", "worktrees", "hadern-analysis");
fs.mkdirSync(OTHER, { recursive: true });

const HERE_SESSION = "11111111-1111-4111-8111-111111111111";
const OTHER_SESSION = "22222222-2222-4222-8222-222222222222";

/** A registry file as claude writes one for a session it named after the directory. */
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

writeSession(11111, HERE_SESSION, HERE, "cyberk-skills-f9");
writeSession(22222, OTHER_SESSION, OTHER, "cyberk-skills-f9");

// What the vault reads out of each transcript — claude's own display precedence,
// which is what a person recognises the session by.
const VAULT_TITLES: Record<string, string> = {
  [`claude:${HERE_SESSION}`]: "Fix the worktree row titles",
  [`claude:${OTHER_SESSION}`]: "Hadern attribution analysis",
};

const store = createPaneEvidenceStore();
store.create("pane-1", { cwd: HERE, viewId: "view-1" });

const deps = createPresenceProjectorDeps({
  store,
  listRunning: () => listRunningClaudeSessions({ configDir }, { isAlive: () => true }),
  sessionMtime: async () => undefined,
  sessionTitle: async (entryId) => VAULT_TITLES[entryId],
});
const projector = createPresenceProjector(deps);

const presence = await projector.project([path.resolve(HERE), path.resolve(OTHER)]);
const rows = Object.values(presence.rowsByWorktreeId).flat();

const windowRow = rows.find((r) => r.scope === "window");
const externalRow = rows.find((r) => r.scope === "external");

let failed = 0;

function observe(n: number, what: string, actual: string | undefined, expected: string): void {
  const ok = actual === expected;
  console.log(
    `OBSERVES ${n}: ${ok ? "GREEN" : "RED"} — ${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
  if (!ok) {
    failed += 1;
  }
}

observe(
  1,
  "a pane shows what its session is about, not the slug claude derived from the directory",
  windowRow && agentRowTitle(windowRow),
  "Fix the worktree row titles",
);
observe(
  2,
  "a session in another window does the same",
  externalRow && agentRowTitle(externalRow),
  "Hadern attribution analysis",
);

fs.rmSync(root, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
