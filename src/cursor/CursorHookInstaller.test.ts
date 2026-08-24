import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CURSOR_HOOK_EVENTS, CursorHookInstaller, type CursorHookInstallerDependencies } from "./CursorHookInstaller";

const tempDirectories: string[] = [];

async function fixture(platform: "linux" | "win32" = "linux") {
  const directory = await mkdtemp(join(tmpdir(), "cursor-hooks-"));
  tempDirectories.push(directory);
  const configPath = join(directory, "hooks.json");
  const storagePath = join(directory, "storage");
  return { configPath, storagePath, platform };
}

async function config(path: string) {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

function runShell(script: string, input: string, environment: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/sh", [script], { env: environment });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(`shell exited ${code}`))));
    child.stdin.end(input);
  });
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("CursorHookInstaller", () => {
  it("adds only its observer entries and exactly removes them again", async () => {
    const paths = await fixture();
    const original = {
      version: 1,
      futureTopLevel: { preserve: true },
      hooks: {
        beforeSubmitPrompt: [{ command: "user-before", timeout: 9 }],
        customEvent: [{ command: "user-custom" }],
      },
    };
    await writeFile(paths.configPath, JSON.stringify(original));
    const installer = new CursorHookInstaller(paths);

    expect((await installer.install()).installed).toBe(true);
    const installed = await config(paths.configPath);
    expect(installed.futureTopLevel).toEqual(original.futureTopLevel);
    expect(installed.hooks).toMatchObject({
      beforeSubmitPrompt: [{ command: "user-before", timeout: 9 }, { timeout: 2 }],
      customEvent: original.hooks.customEvent,
    });
    expect(Object.keys(installed.hooks as Record<string, unknown>)).toEqual([
      "beforeSubmitPrompt",
      "customEvent",
      ...CURSOR_HOOK_EVENTS.filter((event) => event !== "beforeSubmitPrompt"),
    ]);

    expect((await installer.uninstall()).removed).toBe(true);
    expect(await config(paths.configPath)).toMatchObject(original);
  });

  it("removes only exact owned entries and preserves lookalike user entries", async () => {
    const paths = await fixture();
    await writeFile(paths.configPath, JSON.stringify({ version: 1, hooks: {} }));
    const installer = new CursorHookInstaller(paths);
    await installer.install();
    const document = await config(paths.configPath);
    const hooks = document.hooks as Record<string, Array<Record<string, unknown>>>;
    const owned = hooks.beforeSubmitPrompt[0];
    const lookalikes = [
      { ...owned, userMetadata: true },
      { command: owned.command, timeout: 3 },
      { command: owned.command },
    ];
    hooks.beforeSubmitPrompt.push(...lookalikes);
    await writeFile(paths.configPath, JSON.stringify(document));

    expect((await installer.uninstall()).removed).toBe(true);
    expect((await config(paths.configPath)).hooks).toMatchObject({ beforeSubmitPrompt: lookalikes });
  });

  it.each([
    ["invalid JSON", "not json"],
    ["future version", JSON.stringify({ version: 2, hooks: {} })],
    ["malformed hooks", JSON.stringify({ version: 1, hooks: [] })],
    ["malformed event", JSON.stringify({ version: 1, hooks: { stop: {} } })],
  ])("does not rewrite %s configuration", async (_name, contents) => {
    const paths = await fixture();
    await writeFile(paths.configPath, contents);
    const installer = new CursorHookInstaller(paths);

    await expect(installer.install()).resolves.toMatchObject({ installed: false, reason: "unsupported-config" });
    expect(await readFile(paths.configPath, "utf8")).toBe(contents);
    await expect(installer.uninstall()).resolves.toMatchObject({ removed: false, reason: "unsupported-config" });
  });

  it("retries when another writer changes the configuration before replacement", async () => {
    const paths = await fixture();
    await writeFile(paths.configPath, JSON.stringify({ version: 1, hooks: {} }));
    let changes = 0;
    const installer = new CursorHookInstaller(paths, {
      beforeReplace: async () => {
        changes += 1;
        if (changes === 1) {
          await writeFile(paths.configPath, JSON.stringify({ version: 1, external: true, hooks: {} }));
        }
      },
    });

    expect((await installer.install()).installed).toBe(true);
    expect(await config(paths.configPath)).toMatchObject({ external: true });
  });

  it("stops after three external writes without clobbering configuration", async () => {
    const paths = await fixture();
    await writeFile(paths.configPath, JSON.stringify({ version: 1, hooks: {} }));
    let changes = 0;
    const installer = new CursorHookInstaller(paths, {
      beforeReplace: async () => {
        changes += 1;
        await writeFile(paths.configPath, JSON.stringify({ version: 1, externalChange: changes, hooks: {} }));
      },
    });

    await expect(installer.install()).resolves.toMatchObject({ installed: false, reason: "write-failed" });
    expect(await config(paths.configPath)).toEqual({ version: 1, externalChange: 3, hooks: {} });
  });

  it("reclaims a stale advisory lock", async () => {
    const paths = await fixture();
    await writeFile(paths.configPath, JSON.stringify({ version: 1, hooks: {} }));
    await writeFile(`${paths.configPath}.anywhere-terminal.lock`, "stale");
    await utimes(`${paths.configPath}.anywhere-terminal.lock`, 0, 0);
    const installer = new CursorHookInstaller(paths, { now: () => 100_000 });

    expect((await installer.install()).installed).toBe(true);
  });

  it("returns lock-unavailable after a bounded number of lock attempts", async () => {
    const paths = await fixture();
    const original = JSON.stringify({ version: 1, hooks: {} });
    await writeFile(paths.configPath, original);
    await writeFile(`${paths.configPath}.anywhere-terminal.lock`, "active");
    let sleeps = 0;
    const installer = new CursorHookInstaller(paths, {
      now: Date.now,
      sleep: async () => {
        sleeps += 1;
      },
    });

    await expect(installer.install()).resolves.toMatchObject({ installed: false, reason: "lock-unavailable" });
    expect(sleeps).toBeGreaterThan(0);
    expect(sleeps).toBeLessThanOrEqual(41);
    expect(await readFile(paths.configPath, "utf8")).toBe(original);
  });

  it("preserves the existing configuration mode during atomic replacement", async () => {
    const paths = await fixture();
    await writeFile(paths.configPath, JSON.stringify({ version: 1, hooks: {} }));
    await chmod(paths.configPath, 0o640);

    expect((await new CursorHookInstaller(paths).install()).installed).toBe(true);
    expect((await stat(paths.configPath)).mode & 0o777).toBe(0o640);
  });

  it("uses a valid sibling temporary path for Windows-shaped configuration paths", async () => {
    const configPath = "C:\\Users\\alice\\.cursor\\hooks.json";
    const storagePath = "C:\\Users\\alice\\AppData\\Local\\AnyWhere Terminal";
    const files = new Map<string, string>([[configPath, JSON.stringify({ version: 1, hooks: {} })]]);
    const replacements: Array<[string, string]> = [];
    const memoryFs = {
      mkdir: vi.fn(async () => undefined),
      chmod: vi.fn(async () => undefined),
      open: vi.fn(async (path: string) => {
        if (files.has(path)) {
          throw Object.assign(new Error("exists"), { code: "EEXIST" });
        }
        files.set(path, "");
        return { close: async () => undefined };
      }),
      readFile: vi.fn(async (path: string) => {
        const contents = files.get(path);
        if (contents === undefined) {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        }
        return contents;
      }),
      rename: vi.fn(async (oldPath: string, newPath: string) => {
        const contents = files.get(oldPath);
        if (contents === undefined) {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        }
        replacements.push([oldPath, newPath]);
        files.set(newPath, contents);
        files.delete(oldPath);
      }),
      stat: vi.fn(async (path: string) => {
        if (!files.has(path)) {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        }
        return { mode: 0o640, mtimeMs: 0 };
      }),
      unlink: vi.fn(async (path: string) => {
        if (!files.delete(path)) {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        }
      }),
      writeFile: vi.fn(async (path: string, contents: string | Uint8Array) => {
        files.set(path, typeof contents === "string" ? contents : Buffer.from(contents).toString("utf8"));
      }),
    } as unknown as NonNullable<CursorHookInstallerDependencies["fs"]>;
    const installer = new CursorHookInstaller(
      { configPath, storagePath, platform: "win32" },
      { fs: memoryFs, now: () => 123, run: async () => ({ exitCode: 0, stdout: "{}\n" }) },
    );

    expect((await installer.install()).installed).toBe(true);
    expect(replacements).toEqual([
      ["C:\\Users\\alice\\.cursor\\.hooks.json.123.tmp", "C:\\Users\\alice\\.cursor\\hooks.json"],
    ]);
  });

  it("reports config replacement failure and leaves the user configuration intact", async () => {
    const paths = await fixture();
    const original = JSON.stringify({ version: 1, hooks: {} });
    await writeFile(paths.configPath, original);
    const installer = new CursorHookInstaller(paths, {
      rename: async () => {
        throw new Error("denied");
      },
    });

    await expect(installer.install()).resolves.toMatchObject({ installed: false, reason: "write-failed" });
    expect(await readFile(paths.configPath, "utf8")).toBe(original);
  });

  it("reports wrapper creation failure without changing hooks.json", async () => {
    const paths = await fixture();
    const original = JSON.stringify({ version: 1, hooks: {} });
    await writeFile(paths.configPath, original);
    const installer = new CursorHookInstaller(paths, {
      fs: {
        writeFile: async () => {
          throw new Error("permission denied");
        },
      },
    });

    await expect(installer.install()).resolves.toMatchObject({ installed: false, reason: "write-failed" });
    expect(await readFile(paths.configPath, "utf8")).toBe(original);
  });

  it("reports cleanup failure and leaves the user configuration intact", async () => {
    const paths = await fixture();
    await writeFile(paths.configPath, JSON.stringify({ version: 1, hooks: {} }));
    const installer = new CursorHookInstaller(paths);
    await installer.install();
    const before = await readFile(paths.configPath, "utf8");
    const blocked = new CursorHookInstaller(paths, {
      rename: async () => {
        throw new Error("denied");
      },
    });

    await expect(blocked.uninstall()).resolves.toMatchObject({ removed: false, reason: "write-failed" });
    expect(await readFile(paths.configPath, "utf8")).toBe(before);
  });

  it("generates a POSIX wrapper that drains stdin and returns empty JSON after curl fails", async () => {
    const paths = await fixture();
    await writeFile(paths.configPath, JSON.stringify({ version: 1, hooks: {} }));
    const installer = new CursorHookInstaller(paths);

    await installer.install();
    const wrapper = join(paths.storagePath, "cursor-hook-observer.sh");
    const bin = join(paths.storagePath, "bin");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(bin));
    const curl = join(bin, "curl");
    await writeFile(curl, "#!/bin/sh\nexit 1\n");
    await chmod(curl, 0o700);
    const output = await runShell(wrapper, '{"event":"stop"}', {
      ANYWHERE_TERMINAL_CURSOR_URL: "http://127.0.0.1:1",
      PATH: `${bin}:/bin`,
    });

    expect(output).toBe("{}\n");
    const contents = await readFile(wrapper, "utf8");
    expect(contents).toContain("--connect-timeout 0.5");
    expect(contents).toContain("--max-time 1.5");
    expect(contents).toContain("cat >/dev/null 2>&1 || true");
    const hooks = (await config(paths.configPath)).hooks as Record<string, Array<Record<string, unknown>>>;
    for (const event of CURSOR_HOOK_EVENTS) {
      expect(hooks[event]).toContainEqual(expect.objectContaining({ timeout: 2 }));
      expect(hooks[event]).not.toContainEqual(expect.objectContaining({ failClosed: expect.anything() }));
    }
  });

  it("does not install Windows observers when the no-op probe exits unsuccessfully", async () => {
    const paths = await fixture("win32");
    await writeFile(paths.configPath, JSON.stringify({ version: 1, hooks: {} }));
    const installer = new CursorHookInstaller(paths, { run: async () => ({ exitCode: 1, stdout: "" }) });

    await expect(installer.install()).resolves.toMatchObject({ installed: false, reason: "windows-probe-failed" });
    expect(await config(paths.configPath)).toEqual({ version: 1, hooks: {} });
  });

  it("bounds a hung Windows no-op probe and allows a later reconciliation", async () => {
    vi.useFakeTimers();
    try {
      const paths = await fixture("win32");
      const original = JSON.stringify({ version: 1, hooks: {} });
      await writeFile(paths.configPath, original);
      let probeStarted: () => void = () => undefined;
      const started = new Promise<void>((resolve) => {
        probeStarted = resolve;
      });
      const run = vi
        .fn<NonNullable<CursorHookInstallerDependencies["run"]>>()
        .mockImplementationOnce(async () => {
          probeStarted();
          return await new Promise<never>(() => undefined);
        })
        .mockResolvedValue({ exitCode: 0, stdout: "{}\n" });
      const installer = new CursorHookInstaller(paths, { run });

      const hungInstall = installer.install();
      await started;
      vi.advanceTimersByTime(2_000);
      await expect(hungInstall).resolves.toMatchObject({ installed: false, reason: "windows-probe-failed" });
      expect(await readFile(paths.configPath, "utf8")).toBe(original);

      await expect(installer.install()).resolves.toMatchObject({ installed: true });
      expect(run).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["not JSON", "[]", '{"not":"empty"}'])(
    "does not install Windows observers when the no-op probe output is %j",
    async (stdout) => {
      const paths = await fixture("win32");
      await writeFile(paths.configPath, JSON.stringify({ version: 1, hooks: {} }));
      const installer = new CursorHookInstaller(paths, { run: async () => ({ exitCode: 0, stdout }) });

      await expect(installer.install()).resolves.toMatchObject({ installed: false, reason: "windows-probe-failed" });
      expect(await config(paths.configPath)).toEqual({ version: 1, hooks: {} });
    },
  );

  it("installs Windows observers only after an empty JSON no-op probe", async () => {
    const paths = await fixture("win32");
    await writeFile(paths.configPath, JSON.stringify({ version: 1, hooks: {} }));
    const run = vi.fn(async () => ({ exitCode: 0, stdout: "{}\n" }));
    const installer = new CursorHookInstaller(paths, { run });

    expect((await installer.install()).installed).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    const wrapper = await readFile(join(paths.storagePath, "cursor-hook-observer.cmd"), "utf8");
    expect(wrapper).toContain("more >nul 2>nul");
    expect(wrapper).toContain("echo {}");
  });

  it("emits a hook command that /bin/sh -n accepts when the storage path contains an apostrophe", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cursor-hooks-"));
    tempDirectories.push(directory);
    const configPath = join(directory, "hooks.json");
    const storagePath = join(directory, "O'Brien", "storage");
    await writeFile(configPath, JSON.stringify({ version: 1, hooks: {} }));
    const installer = new CursorHookInstaller({ configPath, storagePath, platform: "linux" });

    expect((await installer.install()).installed).toBe(true);
    const hooks = (await config(configPath)).hooks as Record<string, Array<Record<string, unknown>>>;
    const emittedCommand = hooks.sessionStart[0]?.command;
    expect(typeof emittedCommand).toBe("string");

    const scriptPath = join(directory, "emitted-command.sh");
    await writeFile(scriptPath, emittedCommand as string);
    await expect(
      new Promise<void>((resolve, reject) => {
        const child = spawn("/bin/sh", ["-n", scriptPath]);
        child.once("error", reject);
        child.once("close", (code) => (code === 0 ? resolve() : reject(new Error(`shell -n exited ${code}`))));
      }),
    ).resolves.toBeUndefined();
  });
});
