import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type AgentActivityUpdate, createAgentHookRuntime } from "../agentHooks/AgentHookRuntime";
import { CURSOR_HOOK_ENV_VAR, cursorAgentRegistration } from "../agentHooks/agents/cursor";
import { CursorHookInstaller } from "./CursorHookInstaller";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function runCommand(command: string, input: string, environment: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/sh", ["-c", command], { env: environment });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(`command exited ${code}`))));
    child.stdin.end(input);
  });
}

describe("CursorHookInstaller runtime compatibility", () => {
  it.skipIf(process.platform === "win32")(
    "publishes through its restored POSIX command and cannot publish after revocation",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "cursor-hook-runtime-"));
      directories.push(directory);
      const configPath = join(directory, "hooks.json");
      await writeFile(configPath, JSON.stringify({ version: 1, hooks: {} }));

      const installer = new CursorHookInstaller({ configPath, storagePath: join(directory, "storage") });
      expect(await installer.install()).toEqual({ installed: true });
      const config = JSON.parse(await readFile(configPath, "utf8")) as {
        hooks: { beforeSubmitPrompt: Array<{ command: string }> };
      };
      const command = config.hooks.beforeSubmitPrompt[0]?.command;
      expect(command).toBeDefined();

      const updates: AgentActivityUpdate[] = [];
      const runtime = await createAgentHookRuntime(
        [cursorAgentRegistration()],
        {},
        { onStatus: (update) => updates.push(update) },
      );
      try {
        runtime.setAgentEnabled("cursor", true);
        const coordinates = runtime.create("11111111-1111-4111-8111-111111111111")[CURSOR_HOOK_ENV_VAR];
        expect(coordinates).toBeDefined();
        const environment = { ...process.env, [CURSOR_HOOK_ENV_VAR]: coordinates } as Record<string, string>;
        const payload = JSON.stringify({ hook_event_name: "beforeSubmitPrompt" });

        await expect(runCommand(command as string, payload, environment)).resolves.toBe("{}\n");
        expect(updates).toContainEqual({
          sessionId: "11111111-1111-4111-8111-111111111111",
          agent: "cursor",
          state: "working",
        });

        runtime.setAgentEnabled("cursor", false);
        expect(updates).toContainEqual({
          sessionId: "11111111-1111-4111-8111-111111111111",
          agent: "cursor",
          state: null,
        });
        const publicationsAfterRevocation = updates.length;

        await expect(runCommand(command as string, payload, environment)).resolves.toBe("{}\n");
        expect(updates).toHaveLength(publicationsAfterRevocation);
      } finally {
        runtime.dispose();
      }
    },
    10_000,
  );
});
