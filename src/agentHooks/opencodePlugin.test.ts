// src/agentHooks/opencodePlugin.test.ts — the plugin OpenCode loads, driven as
// OpenCode drives it, and the directory it is written into.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installOpenCodePlugin, OPENCODE_CONFIG_DIR_ENV } from "./opencodeConfigDir";
import { buildOpenCodePluginSource, OPENCODE_PLUGIN_FILE } from "./opencodePlugin";

interface Received {
  path: string;
  body: unknown;
}

async function receiver(): Promise<{ url: string; received: Received[]; close(): Promise<void> }> {
  const received: Received[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => {
      received.push({ path: req.url ?? "", body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/t1/tok`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Load the generated source the way OpenCode does — from a file, at run time. */
async function loadPlugin(dir: string) {
  const path = join(dir, "loaded-plugin.ts");
  await writeFile(path, buildOpenCodePluginSource(), "utf8");
  const module = (await import(path)) as { server: () => Promise<{ event(input: unknown): Promise<void> }> };
  return await module.server();
}

describe("the plugin OpenCode loads", () => {
  let dir: string;
  let hook: Awaited<ReturnType<typeof receiver>>;
  const previous = process.env[OPENCODE_CONFIG_DIR_ENV];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "at-oc-plugin-"));
    hook = await receiver();
    process.env.ANYWHERE_TERMINAL_AGENT_HOOK_URL = hook.url;
  });

  afterEach(async () => {
    delete process.env.ANYWHERE_TERMINAL_AGENT_HOOK_URL;
    if (previous === undefined) {
      delete process.env[OPENCODE_CONFIG_DIR_ENV];
    } else {
      process.env[OPENCODE_CONFIG_DIR_ENV] = previous;
    }
    await hook.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("reports the session id OpenCode names, to its own agent path", async () => {
    const plugin = await loadPlugin(dir);

    await plugin.event({ event: { type: "session.created", properties: { sessionID: "ses_abc123" } } });

    expect(hook.received).toEqual([{ path: "/t1/tok/opencode", body: { sessionID: "ses_abc123" } }]);
  });

  it("reads the id out of a session.updated info block too", async () => {
    const plugin = await loadPlugin(dir);

    await plugin.event({ event: { type: "session.updated", properties: { info: { id: "ses_from_info" } } } });

    expect(hook.received[0]?.body).toEqual({ sessionID: "ses_from_info" });
  });

  it("reports a session once, however many events it produces", async () => {
    const plugin = await loadPlugin(dir);

    for (const type of ["session.created", "message.updated", "message.part.updated", "session.updated"]) {
      await plugin.event({ event: { type, properties: { sessionID: "ses_abc123" } } });
    }

    expect(hook.received).toHaveLength(1);
  });

  it("reports a second session started in the same terminal", async () => {
    const plugin = await loadPlugin(dir);

    await plugin.event({ event: { type: "session.created", properties: { sessionID: "ses_one" } } });
    await plugin.event({ event: { type: "session.created", properties: { sessionID: "ses_two" } } });

    expect(hook.received.map((entry) => (entry.body as { sessionID: string }).sessionID)).toEqual([
      "ses_one",
      "ses_two",
    ]);
  });

  it("sends nothing but the session id", async () => {
    const plugin = await loadPlugin(dir);

    await plugin.event({
      event: {
        type: "message.part.updated",
        properties: { sessionID: "ses_abc123", part: { type: "text", text: "the user's private prompt" } },
      },
    });

    expect(hook.received[0]?.body).toEqual({ sessionID: "ses_abc123" });
  });

  it("stays quiet when no credential is in the environment", async () => {
    delete process.env.ANYWHERE_TERMINAL_AGENT_HOOK_URL;
    const plugin = await loadPlugin(dir);

    await plugin.event({ event: { type: "session.created", properties: { sessionID: "ses_abc123" } } });

    expect(hook.received).toEqual([]);
  });

  it("does not throw when the receiver is gone", async () => {
    const plugin = await loadPlugin(dir);
    await hook.close();

    await expect(
      plugin.event({ event: { type: "session.created", properties: { sessionID: "ses_abc123" } } }),
    ).resolves.toBeUndefined();
  });
});

describe("the configuration directory we own", () => {
  let storage: string;

  beforeEach(async () => {
    storage = await mkdtemp(join(tmpdir(), "at-oc-cfg-"));
  });

  afterEach(async () => {
    await rm(storage, { recursive: true, force: true });
  });

  it("writes the plugin where OpenCode scans for one, and points a terminal at it", async () => {
    const contribution = await installOpenCodePlugin({ storagePath: storage, env: {} });

    const configDir = contribution[OPENCODE_CONFIG_DIR_ENV];
    expect(configDir).toBe(join(storage, "opencode-config"));
    expect(await readFile(join(configDir as string, "plugin", OPENCODE_PLUGIN_FILE), "utf8")).toBe(
      buildOpenCodePluginSource(),
    );
  });

  it("keeps a configuration directory the user already chose, and contributes nothing", async () => {
    const contribution = await installOpenCodePlugin({
      storagePath: storage,
      env: { [OPENCODE_CONFIG_DIR_ENV]: "/home/u/my-opencode" },
    });

    expect(contribution).toEqual({});
  });

  it("costs the report, not the terminal, when the plugin cannot be written", async () => {
    const contribution = await installOpenCodePlugin({
      storagePath: storage,
      env: {},
      fs: {
        writeFile: () => Promise.reject(new Error("EROFS")),
      },
    });

    expect(contribution).toEqual({});
  });
});
