// Repro: resuming a Claude session that ran under a 1M-context model must not
// drop the reader to the plain 200k context window.
//
// Reporter's gesture: user runs Claude with `opus[1m]` (their configured default,
// `~/.claude/settings.json` → "model": "opus[1m]"), then clicks Resume in the AT
// vault panel. The model comes back right; the context window does not.
//
// Layer: the argv AT actually spawns. A transcript shaped exactly like the ones
// Claude writes for a 1M session (Claude records the RESOLVED api id — the
// `[1m]` tag is never written to the transcript) goes in; the launch argv comes
// out. If that argv pins `--model <id-without-a-context-tag>` it OVERRIDES the
// user's configured `opus[1m]`, and the resumed session is 200k.

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { readClaudeSessions } from "../../../src/vault/readers/claudeReader";
import type { VaultService } from "../../../src/vault/VaultService";
import { VaultLauncher } from "../../../src/vault/VaultLauncher";

const SESSION_ID = "f1f99648-bc3a-4f11-9e68-8c2584af40f9";
const CWD = "/Users/huybuidac/Projects/ai-oss/anywhere-terminal";
/** What Claude 2.1.x writes for a session running under `opus[1m]`. */
const RECORDED_MODEL = "claude-opus-5";
/** What the user configured — the tag that produces the 1M window. */
const CONFIGURED_MODEL = "opus[1m]";

function line(obj: unknown): string {
  return `${JSON.stringify(obj)}\n`;
}

async function seedStore(configDir: string): Promise<void> {
  const projectDir = path.join(configDir, "projects", CWD.replace(/\//g, "-"));
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(path.join(configDir, "settings.json"), JSON.stringify({ model: CONFIGURED_MODEL }, null, 2));
  await fs.writeFile(
    path.join(projectDir, `${SESSION_ID}.jsonl`),
    line({ type: "permission-mode", permissionMode: "bypassPermissions", sessionId: SESSION_ID }) +
      line({
        type: "user",
        isSidechain: false,
        message: { role: "user", content: "list file thay đổi" },
        cwd: CWD,
        gitBranch: "docs/worktree-blueprint",
        sessionId: SESSION_ID,
      }) +
      line({
        type: "assistant",
        isSidechain: false,
        message: { role: "assistant", model: RECORDED_MODEL, content: [{ type: "text", text: "ok" }] },
        cwd: CWD,
        sessionId: SESSION_ID,
      }),
  );
}

/** The context-window tag on a model string, e.g. "opus[1m]" -> "[1m]". */
function contextTag(model: string): string | undefined {
  return /\[[^\]]+\]$/.exec(model)?.[0];
}

async function main(): Promise<void> {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "at-1m-repro-"));
  try {
    await seedStore(configDir);

    const { entries } = await readClaudeSessions({ configDir });
    const entry = entries.find((e) => e.sessionId === SESSION_ID);
    if (!entry) {
      throw new Error("repro defect: the seeded session was not indexed");
    }

    // The reporter's gesture: the provider calls VaultLauncher.resolve(id, "resume")
    // and spawns exactly what it returns. Anything below this misses a launcher
    // that never asks for the context tag in the first place.
    const vaultService = {
      getLaunchTarget: async (id: string) =>
        id === entry.id ? { entry, verify: async () => true } : undefined,
      getEntry: async (id: string) => (id === entry.id ? entry : undefined),
    } as unknown as VaultService;
    const launcher = new VaultLauncher(vaultService, { CLAUDE_CONFIG_DIR: configDir });
    const options = await launcher.resolve(entry.id, "resume");

    const argv = [options.shell, ...options.shellArgs];
    const modelIndex = options.shellArgs.indexOf("--model");
    const launchedModel = modelIndex === -1 ? undefined : options.shellArgs[modelIndex + 1];

    console.log(`recorded in transcript : ${RECORDED_MODEL}`);
    console.log(`user's configured model: ${CONFIGURED_MODEL}  (tag ${contextTag(CONFIGURED_MODEL)})`);
    console.log(`resume argv            : ${argv.join(" ")}`);
    console.log(`--model passed         : ${launchedModel ?? "(omitted — CLI default applies)"}`);

    // The resumed session gets a 1M window iff AT either leaves the model to the
    // CLI (which reads the configured `opus[1m]`) or pins a model that carries
    // the context tag itself. Pinning a bare id silently downgrades to 200k.
    const keepsWideContext = launchedModel === undefined || contextTag(launchedModel) !== undefined;

    console.log(
      `OBSERVES 1: ${keepsWideContext ? "GREEN" : "RED"} — resume preserves the 1M context window the session ran under`,
    );
    if (!keepsWideContext) {
      console.error(
        `FAIL: resume pins --model ${launchedModel}, overriding the configured ${CONFIGURED_MODEL}; the resumed session is 200k, not 1M.`,
      );
      process.exitCode = 1;
    }
  } finally {
    await fs.rm(configDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
