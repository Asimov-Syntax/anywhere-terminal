import { spawn } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, open, readFile, rename, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CURSOR_HOOK_COMMAND,
  CURSOR_HOOK_EVENTS,
  CursorHookInstaller,
  type CursorHookInstallerDependencies,
} from "./CursorHookInstaller";

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

function windowsMemoryFixture(document: Record<string, unknown>, wrapperContents?: string) {
  const configPath = "C:\\Users\\alice\\.cursor\\hooks.json";
  const storagePath =
    "C:\\Users\\alice\\AppData\\Roaming\\Code\\User\\globalStorage\\huybuidac.anywhere-terminal\\cursor-hooks";
  const wrapperPath = win32.join(storagePath, "cursor-hook-observer.cmd");
  const files = new Map<string, string>([[configPath, JSON.stringify(document)]]);
  if (wrapperContents !== undefined) {
    files.set(wrapperPath, wrapperContents);
  }
  const replacements: Array<[string, string]> = [];
  const memoryFsImpl = {
    mkdir: vi.fn(async () => undefined),
    chmod: vi.fn(async () => undefined),
    lstat: vi.fn(async (path: string) => {
      if (!files.has(path)) {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }
      return { isSymbolicLink: () => false };
    }),
    open: vi.fn(async (path: string) => {
      if (files.has(path)) {
        throw Object.assign(new Error("exists"), { code: "EEXIST" });
      }
      files.set(path, "");
      return {
        close: async () => undefined,
        writeFile: async (contents: string) => {
          files.set(path, contents);
        },
        chmod: async () => undefined,
      };
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
  };
  const memoryFs = memoryFsImpl as unknown as NonNullable<CursorHookInstallerDependencies["fs"]> & typeof memoryFsImpl;
  return {
    files,
    memoryFs,
    paths: { configPath, storagePath, platform: "win32" as const },
    replacements,
    wrapperPath,
  };
}

interface ShellResult {
  code: number | null;
  elapsedMs: number;
  stderr: string;
  stdout: string;
  writerError: string | undefined;
}

function runHook(
  command: string,
  options: {
    closeStdout?: boolean;
    environment?: NodeJS.ProcessEnv;
    input?: string;
    inputDelayMs?: number;
  } = {},
): Promise<ShellResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const executed = options.closeStdout ? `exec 1>&-; ${command}` : command;
    const child = spawn("/bin/sh", ["-c", executed], {
      env: { PATH: process.env.PATH ?? "", ...options.environment },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let writerError: string | undefined;
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      writerError = error.code;
    });
    const sendInput = () => child.stdin.end(options.input ?? '{"hook_event_name":"sessionStart"}');
    if (options.inputDelayMs === undefined) {
      sendInput();
    } else {
      setTimeout(sendInput, options.inputDelayMs);
    }
    child.on("close", (code) => {
      resolve({ code, elapsedMs: Date.now() - started, stderr, stdout, writerError });
    });
  });
}

async function httpRecorder(): Promise<{ bodies: string[]; close: () => Promise<void>; server: Server; url: string }> {
  const bodies: string[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += String(chunk);
    });
    request.on("end", () => {
      bodies.push(body);
      response.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    bodies,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    server,
    url: `http://127.0.0.1:${port}`,
  };
}

function cursorHookUrl(base: string): string {
  return `${base}/123e4567-e89b-12d3-a456-426614174000/${"a".repeat(64)}`;
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

  it("retains the released POSIX wrapper while a preserved custom event references it", async () => {
    const paths = await fixture();
    const wrapperPath = join(paths.storagePath, "cursor-hook-observer.sh");
    const legacyCommand = `'${wrapperPath}'`;
    await mkdir(paths.storagePath, { recursive: true });
    await writeFile(wrapperPath, "#!/bin/sh\n");
    await writeFile(
      paths.configPath,
      JSON.stringify({
        version: 1,
        hooks: {
          sessionStart: [{ command: legacyCommand, timeout: 2 }],
          customEvent: [{ command: legacyCommand, timeout: 2 }],
        },
      }),
    );

    await expect(new CursorHookInstaller(paths).install()).resolves.toEqual({
      installed: true,
      reason: "legacy-wrapper-referenced",
      unresolved: [wrapperPath],
    });
    const hooks = (await config(paths.configPath)).hooks as Record<string, Array<Record<string, unknown>>>;
    expect(hooks.sessionStart).toEqual([{ command: CURSOR_HOOK_COMMAND, timeout: 2 }]);
    expect(hooks.customEvent).toEqual([{ command: legacyCommand, timeout: 2 }]);
    expect(await readFile(wrapperPath, "utf8")).toBe("#!/bin/sh\n");
    expect(CURSOR_HOOK_COMMAND).not.toContain(paths.storagePath);
  });

  it("retains the released POSIX wrapper when uninstall preserves a custom event reference", async () => {
    const paths = await fixture();
    const wrapperPath = join(paths.storagePath, "cursor-hook-observer.sh");
    const legacyCommand = `'${wrapperPath}'`;
    await mkdir(paths.storagePath, { recursive: true });
    await writeFile(wrapperPath, "#!/bin/sh\n");
    await writeFile(
      paths.configPath,
      JSON.stringify({
        version: 1,
        hooks: {
          sessionStart: [{ command: CURSOR_HOOK_COMMAND, timeout: 2 }],
          customEvent: [{ command: legacyCommand, timeout: 2 }],
        },
      }),
    );

    await expect(new CursorHookInstaller(paths).uninstall()).resolves.toEqual({
      removed: false,
      reason: "legacy-wrapper-referenced",
      unresolved: [wrapperPath],
    });
    expect((await config(paths.configPath)).hooks).toEqual({
      sessionStart: [],
      customEvent: [{ command: legacyCommand, timeout: 2 }],
    });
    expect(await readFile(wrapperPath, "utf8")).toBe("#!/bin/sh\n");
  });

  it("preserves every whole-entry lookalike of the frozen and released commands", async () => {
    const paths = await fixture();
    const legacyCommand = `'${join(paths.storagePath, "cursor-hook-observer.sh")}'`;
    const lookalikes = [
      { command: `${CURSOR_HOOK_COMMAND} `, timeout: 2 },
      { command: ` ${CURSOR_HOOK_COMMAND}`, timeout: 2 },
      { command: `${CURSOR_HOOK_COMMAND}.bak`, timeout: 2 },
      { command: `/usr/bin/audit ${CURSOR_HOOK_COMMAND}`, timeout: 2 },
      { command: CURSOR_HOOK_COMMAND, timeout: 3 },
      { command: CURSOR_HOOK_COMMAND },
      { command: legacyCommand.replaceAll("'", '"'), timeout: 2 },
      { command: legacyCommand, timeout: 2, owner: "user" },
    ];
    await writeFile(paths.configPath, JSON.stringify({ version: 1, hooks: { sessionStart: lookalikes } }));

    await new CursorHookInstaller(paths).install();
    const hooks = (await config(paths.configPath)).hooks as Record<string, Array<Record<string, unknown>>>;
    expect(hooks.sessionStart).toEqual([...lookalikes, { command: CURSOR_HOOK_COMMAND, timeout: 2 }]);
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

  it("refuses a symbolic-link config without reading or replacing its target", async () => {
    const paths = await fixture();
    const target = `${paths.configPath}.target`;
    const original = JSON.stringify({ version: 1, hooks: {} });
    await writeFile(target, original);
    await symlink(target, paths.configPath);
    const installer = new CursorHookInstaller(paths);

    await expect(installer.install()).resolves.toMatchObject({ installed: false, reason: "unsupported-config" });
    await expect(installer.uninstall()).resolves.toMatchObject({ removed: false, reason: "unsupported-config" });
    expect(await readFile(target, "utf8")).toBe(original);
    expect((await lstat(paths.configPath)).isSymbolicLink()).toBe(true);
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

  it("does not reclaim an advisory lock solely because of age", async () => {
    const paths = await fixture();
    const original = JSON.stringify({ version: 1, hooks: {} });
    await writeFile(paths.configPath, original);
    const lockPath = `${paths.configPath}.anywhere-terminal.lock`;
    await writeFile(lockPath, "owner still live");
    const installer = new CursorHookInstaller(paths, {
      now: () => 100_000,
      sleep: async () => undefined,
    });

    await expect(installer.install()).resolves.toMatchObject({
      installed: false,
      reason: "lock-unavailable",
      unresolved: [paths.configPath, join(paths.storagePath, "cursor-hook-observer.sh")],
    });
    expect(await readFile(paths.configPath, "utf8")).toBe(original);
    expect(await readFile(lockPath, "utf8")).toBe("owner still live");
  });

  it("keeps a paused holder exclusive beyond the former stale threshold", async () => {
    const paths = await fixture();
    const original = JSON.stringify({ version: 1, hooks: {} });
    await writeFile(paths.configPath, original);
    let enteredReplace: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      enteredReplace = resolve;
    });
    let releaseHolder: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      releaseHolder = resolve;
    });
    const first = new CursorHookInstaller(paths, {
      now: () => 0,
      beforeReplace: async () => {
        enteredReplace();
        await held;
      },
    });
    const firstInstall = first.install();
    await entered;

    const lockPath = `${paths.configPath}.anywhere-terminal.lock`;
    const second = new CursorHookInstaller(paths, {
      now: () => 60_000,
      sleep: async () => undefined,
    });
    await expect(second.install()).resolves.toMatchObject({
      installed: false,
      reason: "lock-unavailable",
      unresolved: [paths.configPath, join(paths.storagePath, "cursor-hook-observer.sh")],
    });
    expect(await readFile(paths.configPath, "utf8")).toBe(original);

    releaseHolder();
    await expect(firstInstall).resolves.toMatchObject({ installed: true });
    await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["install", "uninstall"] as const)(
    "reports a final POSIX lock-release failure after %s without erasing committed state",
    async (operation) => {
      const paths = await fixture();
      await writeFile(
        paths.configPath,
        JSON.stringify({
          version: 1,
          hooks: operation === "uninstall" ? { sessionStart: [{ command: CURSOR_HOOK_COMMAND, timeout: 2 }] } : {},
        }),
      );
      const lockPath = `${paths.configPath}.anywhere-terminal.lock`;
      const installer = new CursorHookInstaller(paths, {
        fs: {
          unlink: async (path) => {
            if (String(path) === lockPath) {
              throw Object.assign(new Error("denied"), { code: "EACCES" });
            }
            await unlink(path);
          },
        },
      });

      const result = await installer[operation]();
      expect(result).toEqual(
        operation === "install"
          ? { installed: true, reason: "lock-release-failed" }
          : { removed: true, reason: "lock-release-failed" },
      );
      expect(await readFile(lockPath, "utf8")).toBe("");
    },
  );

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
    const storagePath =
      "C:\\Users\\alice\\AppData\\Roaming\\Code\\User\\globalStorage\\huybuidac.anywhere-terminal\\cursor-hooks";
    const legacyCommand = `"${win32.join(storagePath, "cursor-hook-observer.cmd")}"`;
    const { memoryFs, paths, replacements } = windowsMemoryFixture({
      version: 1,
      hooks: { sessionStart: [{ command: legacyCommand, timeout: 2 }] },
    });
    const installer = new CursorHookInstaller(paths, {
      fs: memoryFs,
      now: () => 123,
      randomBytes: () => Buffer.alloc(16, 0xcd),
    });

    expect((await installer.uninstall()).removed).toBe(true);
    // The clock no longer names it — an attacker who knows the time knows the
    // name, and `writeFile` followed a symlink placed there (design.md D1). What
    // this test still owns is that the temporary is a SIBLING with a win32 path.
    expect(replacements).toEqual([
      [`C:\\Users\\alice\\.cursor\\.hooks.json.${"cd".repeat(16)}.tmp`, "C:\\Users\\alice\\.cursor\\hooks.json"],
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

  it("reports a failed staging write without changing hooks.json", async () => {
    const paths = await fixture();
    const original = JSON.stringify({ version: 1, hooks: {} });
    await writeFile(paths.configPath, original);
    const installer = new CursorHookInstaller(paths, {
      fs: {
        open: async (path: Parameters<typeof open>[0], ...rest: unknown[]) => {
          if (String(path).endsWith(".tmp")) {
            throw new Error("permission denied");
          }
          return (open as (...a: never[]) => ReturnType<typeof open>)(path as never, ...(rest as never[]));
        },
      } as CursorHookInstallerDependencies["fs"],
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

  it("registers the frozen POSIX literal without creating a wrapper file", async () => {
    const paths = await fixture();
    await writeFile(paths.configPath, JSON.stringify({ version: 1, hooks: {} }));
    const installer = new CursorHookInstaller(paths);

    await expect(installer.install()).resolves.toMatchObject({ installed: true });
    const hooks = (await config(paths.configPath)).hooks as Record<string, Array<Record<string, unknown>>>;
    for (const event of CURSOR_HOOK_EVENTS) {
      expect(hooks[event]).toEqual([{ command: CURSOR_HOOK_COMMAND, timeout: 2 }]);
    }
    await expect(readFile(join(paths.storagePath, "cursor-hook-observer.sh"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("removes the exact released Windows entry and wrapper instead of installing new bytes", async () => {
    const storagePath =
      "C:\\Users\\alice\\AppData\\Roaming\\Code\\User\\globalStorage\\huybuidac.anywhere-terminal\\cursor-hooks";
    const legacyCommand = `"${win32.join(storagePath, "cursor-hook-observer.cmd")}"`;
    const { files, memoryFs, paths, wrapperPath } = windowsMemoryFixture(
      { version: 1, hooks: { sessionStart: [{ command: legacyCommand, timeout: 2 }] } },
      "@echo off\r\necho {}\r\n",
    );
    const installer = new CursorHookInstaller(paths, { fs: memoryFs });

    await expect(installer.install()).resolves.toEqual({ installed: false, reason: "unsupported-platform" });
    const document = JSON.parse(files.get(paths.configPath) ?? "") as Record<string, unknown>;
    expect(document).toMatchObject({ version: 1, hooks: { sessionStart: [] } });
    expect(files.has(wrapperPath)).toBe(false);
    expect(memoryFs.writeFile).not.toHaveBeenCalledWith(wrapperPath, expect.anything(), expect.anything());
  });

  it("preserves a malformed Windows config and reports every unresolved exact path", async () => {
    const { files, memoryFs, paths, wrapperPath } = windowsMemoryFixture({}, "legacy");
    const original = files.get(paths.configPath);

    await expect(new CursorHookInstaller(paths, { fs: memoryFs }).install()).resolves.toEqual({
      installed: false,
      reason: "unsupported-config",
      unresolved: [paths.configPath, wrapperPath],
    });
    expect(files.get(paths.configPath)).toBe(original);
    expect(files.get(wrapperPath)).toBe("legacy");
  });

  it("preserves Windows lock failure details instead of replacing them with platform support", async () => {
    const { files, memoryFs, paths, wrapperPath } = windowsMemoryFixture({ version: 1, hooks: {} }, "legacy");
    const lockPath = `${paths.configPath}.anywhere-terminal.lock`;
    files.set(lockPath, "held");
    const installer = new CursorHookInstaller(paths, {
      fs: memoryFs,
      sleep: async () => undefined,
    });

    await expect(installer.install()).resolves.toEqual({
      installed: false,
      reason: "lock-unavailable",
      unresolved: [paths.configPath, wrapperPath],
    });
    expect(files.get(wrapperPath)).toBe("legacy");
  });

  it("reports a Windows wrapper that remains after its entry was removed", async () => {
    const storagePath =
      "C:\\Users\\alice\\AppData\\Roaming\\Code\\User\\globalStorage\\huybuidac.anywhere-terminal\\cursor-hooks";
    const legacyCommand = `"${win32.join(storagePath, "cursor-hook-observer.cmd")}"`;
    const { files, memoryFs, paths, wrapperPath } = windowsMemoryFixture(
      { version: 1, hooks: { sessionStart: [{ command: legacyCommand, timeout: 2 }] } },
      "legacy",
    );
    const baseUnlink = memoryFs.unlink;
    memoryFs.unlink = vi.fn(async (path: import("node:fs").PathLike) => {
      if (String(path) === wrapperPath) {
        throw new Error("denied");
      }
      await baseUnlink(path);
    });

    await expect(new CursorHookInstaller(paths, { fs: memoryFs }).install()).resolves.toEqual({
      installed: false,
      reason: "legacy-wrapper-delete-failed",
      unresolved: [wrapperPath],
    });
    expect(files.get(wrapperPath)).toBe("legacy");
    const document = JSON.parse(files.get(paths.configPath) ?? "") as Record<string, unknown>;
    expect(document).toMatchObject({ version: 1, hooks: { sessionStart: [] } });
  });

  it.each(["install", "uninstall"] as const)(
    "retains the released Windows wrapper when %s preserves a custom event reference",
    async (operation) => {
      const storagePath =
        "C:\\Users\\alice\\AppData\\Roaming\\Code\\User\\globalStorage\\huybuidac.anywhere-terminal\\cursor-hooks";
      const legacyCommand = `"${win32.join(storagePath, "cursor-hook-observer.cmd")}"`;
      const { files, memoryFs, paths, wrapperPath } = windowsMemoryFixture(
        {
          version: 1,
          hooks: {
            sessionStart: [{ command: legacyCommand, timeout: 2 }],
            customEvent: [{ command: legacyCommand, timeout: 2 }],
          },
        },
        "legacy",
      );
      const installer = new CursorHookInstaller(paths, { fs: memoryFs });

      await expect(installer[operation]()).resolves.toEqual(
        operation === "install"
          ? { installed: false, reason: "legacy-wrapper-referenced", unresolved: [wrapperPath] }
          : { removed: false, reason: "legacy-wrapper-referenced", unresolved: [wrapperPath] },
      );
      const document = JSON.parse(files.get(paths.configPath) ?? "") as {
        hooks: Record<string, Array<Record<string, unknown>>>;
      };
      expect(document.hooks.sessionStart).toEqual([]);
      expect(document.hooks.customEvent).toEqual([{ command: legacyCommand, timeout: 2 }]);
      expect(files.get(wrapperPath)).toBe("legacy");
    },
  );

  it.each(["install", "uninstall"] as const)(
    "reports a final Windows lock-release failure after %s without erasing committed state",
    async (operation) => {
      const storagePath =
        "C:\\Users\\alice\\AppData\\Roaming\\Code\\User\\globalStorage\\huybuidac.anywhere-terminal\\cursor-hooks";
      const legacyCommand = `"${win32.join(storagePath, "cursor-hook-observer.cmd")}"`;
      const { files, memoryFs, paths, wrapperPath } = windowsMemoryFixture(
        {
          version: 1,
          hooks: { sessionStart: [{ command: legacyCommand, timeout: 2 }] },
        },
        "legacy",
      );
      const lockPath = `${paths.configPath}.anywhere-terminal.lock`;
      const baseUnlink = memoryFs.unlink;
      memoryFs.unlink = vi.fn(async (path: import("node:fs").PathLike) => {
        if (String(path) === lockPath) {
          throw Object.assign(new Error("denied"), { code: "EACCES" });
        }
        await baseUnlink(path);
      });
      const installer = new CursorHookInstaller(paths, { fs: memoryFs });

      await expect(installer[operation]()).resolves.toEqual(
        operation === "install"
          ? { installed: false, reason: "lock-release-failed" }
          : { removed: true, reason: "lock-release-failed" },
      );
      expect(files.has(wrapperPath)).toBe(false);
      expect(files.has(lockPath)).toBe(true);
    },
  );

  it("returns unsupported-platform without creating a Windows wrapper when nothing was installed", async () => {
    const { files, memoryFs, paths, wrapperPath } = windowsMemoryFixture({ version: 1, hooks: {} });

    await expect(new CursorHookInstaller(paths, { fs: memoryFs }).install()).resolves.toEqual({
      installed: false,
      reason: "unsupported-platform",
    });
    expect(files.has(wrapperPath)).toBe(false);
    expect(memoryFs.mkdir).not.toHaveBeenCalled();
  });

  describe("the frozen POSIX literal", () => {
    it("uses trusted awk without Cursor-rejected shell pattern removal", () => {
      expect(CURSOR_HOOK_COMMAND).toContain("command -p awk 'BEGIN");
      expect(CURSOR_HOOK_COMMAND).not.toMatch(/\$\{[^}]+[#%][^}]*}/);
    });

    it("emits neutral JSON and delivers valid JSON semantics only to its loopback path", async () => {
      const listener = await httpRecorder();
      try {
        const input = '{"hook_event_name":"stop"}\n\n';
        const result = await runHook(CURSOR_HOOK_COMMAND, {
          environment: { ANYWHERE_TERMINAL_CURSOR_URL: cursorHookUrl(listener.url) },
          input,
        });

        expect(result).toMatchObject({ code: 0, stderr: "", stdout: "{}\n", writerError: undefined });
        expect(listener.bodies).toHaveLength(1);
        expect(JSON.parse(listener.bodies[0] ?? "")).toEqual({ hook_event_name: "stop" });
      } finally {
        await listener.close();
      }
    });

    it.each([
      ["missing", undefined],
      ["non-loopback", `http://example.invalid:80/123e4567-e89b-12d3-a456-426614174000/${"a".repeat(64)}`],
      ["nonnumeric port", `http://127.0.0.1:nope/123e4567-e89b-12d3-a456-426614174000/${"a".repeat(64)}`],
      ["query", `http://127.0.0.1:80/123e4567-e89b-12d3-a456-426614174000/${"a".repeat(64)}?to=elsewhere`],
      ["short token", "http://127.0.0.1:80/123e4567-e89b-12d3-a456-426614174000/abc"],
    ])("drains input and sends nothing for %s coordinates", async (_name, url) => {
      const listener = await httpRecorder();
      try {
        const result = await runHook(CURSOR_HOOK_COMMAND, {
          environment: url ? { ANYWHERE_TERMINAL_CURSOR_URL: url } : {},
          input: JSON.stringify({ pad: "x".repeat(1024 * 1024) }),
        });
        expect(result.code).toBe(0);
        expect(result.writerError).toBeUndefined();
        expect(listener.bodies).toEqual([]);
      } finally {
        await listener.close();
      }
    });

    it("rejects userinfo authority escape that unhardened prefix validation sends off-loopback", async () => {
      const sink = await httpRecorder();
      try {
        const address = sink.server.address();
        const sinkPort = typeof address === "object" && address !== null ? address.port : 0;
        const malicious = `http://127.0.0.1:123@127.0.0.1:${sinkPort}/123e4567-e89b-12d3-a456-426614174000/${"a".repeat(64)}`;
        await runHook(CURSOR_HOOK_COMMAND, {
          environment: { ANYWHERE_TERMINAL_CURSOR_URL: malicious },
          input: '{"secret":"prompt"}',
        });
        expect(sink.bodies).toEqual([]);

        const control = CURSOR_HOOK_COMMAND.replace(
          /command -p awk 'BEGIN .*?' "\$url" 2>\/dev\/null \|\| exit 0; /,
          "",
        ).replace("--globoff --proto '=http' ", "");
        expect(control).not.toBe(CURSOR_HOOK_COMMAND);
        await runHook(control, {
          environment: { ANYWHERE_TERMINAL_CURSOR_URL: malicious },
          input: '{"secret":"prompt"}',
        });
        expect(sink.bodies).toEqual(['{"secret":"prompt"}']);
      } finally {
        await sink.close();
      }
    });

    it("runs neither utility nor command function from inherited process state", async () => {
      const listener = await httpRecorder();
      const directory = await mkdtemp(join(tmpdir(), "cursor-hook-shadow-"));
      tempDirectories.push(directory);
      const marker = join(directory, "ran.txt");
      for (const utility of ["awk", "cat", "curl"]) {
        const script = join(directory, utility);
        await writeFile(
          script,
          `#!/bin/sh\nprintf '${utility}\\n' >> '${marker}'\nexec ${utility === "cat" ? "/bin/cat" : "/usr/bin/curl"} "$@"\n`,
        );
        await chmod(script, 0o700);
      }
      try {
        const result = await runHook(CURSOR_HOOK_COMMAND, {
          environment: {
            ANYWHERE_TERMINAL_CURSOR_URL: cursorHookUrl(listener.url),
            "BASH_FUNC_awk%%": "() { printf 'function-awk\\n' >&2; return 1; }",
            "BASH_FUNC_command%%": "() { printf 'function-command\\n' >&2; return 1; }",
            PATH: `${directory}:${process.env.PATH ?? ""}`,
          },
          input: '{"hook_event_name":"sessionStart"}',
        });
        expect(result.code).toBe(0);
        expect(result.stderr).not.toMatch(/function-(?:awk|command)/);
        await expect(readFile(marker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
        expect(listener.bodies).toEqual(['{"hook_event_name":"sessionStart"}']);

        const control = "command -p printf '{}\\n'; command -p cat >/dev/null";
        const controlResult = await runHook(control, {
          environment: { "BASH_FUNC_command%%": "() { printf 'function-command\\n' >&2; return 1; }" },
        });
        expect(controlResult.stderr).toContain("function-command");
      } finally {
        await listener.close();
      }
    });

    it("disables inherited tracing before payload expansion", async () => {
      const listener = await httpRecorder();
      try {
        const result = await runHook(CURSOR_HOOK_COMMAND, {
          environment: {
            ANYWHERE_TERMINAL_CURSOR_URL: cursorHookUrl(listener.url),
            SHELLOPTS: "xtrace",
          },
          input: '{"secret":"not-on-stderr"}',
        });
        expect(result.stderr).not.toContain("not-on-stderr");
        expect(listener.bodies).toEqual(['{"secret":"not-on-stderr"}']);

        const control = await runHook("payload=$(cat); printf '%s' \"$payload\" >/dev/null", {
          environment: { SHELLOPTS: "xtrace" },
          input: '{"secret":"visible-under-xtrace"}',
        });
        expect(control.stderr).toContain("visible-under-xtrace");
      } finally {
        await listener.close();
      }
    });

    it("bypasses proxy environment and curl startup files", async () => {
      const listener = await httpRecorder();
      const proxy = await httpRecorder();
      const home = await mkdtemp(join(tmpdir(), "cursor-hook-curl-home-"));
      tempDirectories.push(home);
      await writeFile(join(home, ".curlrc"), `proxy = "${proxy.url}"\n`);
      try {
        const input = '{"secret":"loopback-only"}';
        const result = await runHook(CURSOR_HOOK_COMMAND, {
          environment: {
            ANYWHERE_TERMINAL_CURSOR_URL: cursorHookUrl(listener.url),
            CURL_HOME: home,
            HOME: home,
            http_proxy: proxy.url,
          },
          input,
        });
        expect(result.code).toBe(0);
        expect(listener.bodies).toEqual([input]);
        expect(proxy.bodies).toEqual([]);

        const control = CURSOR_HOOK_COMMAND.replace("--disable ", "").replace("--noproxy '*' ", "");
        await runHook(control, {
          environment: {
            ANYWHERE_TERMINAL_CURSOR_URL: cursorHookUrl(listener.url),
            CURL_HOME: home,
            HOME: home,
            http_proxy: proxy.url,
          },
          input: '{"secret":"control-leaks"}',
        });
        expect(proxy.bodies).toContain('{"secret":"control-leaks"}');
      } finally {
        await Promise.all([listener.close(), proxy.close()]);
      }
    });

    it("drains on failed trusted-utility lookup and after neutral-output EPIPE", async () => {
      const input = JSON.stringify({ pad: "x".repeat(1024 * 1024) });
      for (const utility of ["awk", "cat"] as const) {
        const missing = CURSOR_HOOK_COMMAND.replace(`command -p ${utility}`, `command -p ${utility}_absent_for_test`);
        expect(missing).not.toBe(CURSOR_HOOK_COMMAND);
        const lookup = await runHook(missing, {
          environment: { ANYWHERE_TERMINAL_CURSOR_URL: cursorHookUrl("http://127.0.0.1:1") },
          input,
        });
        expect(lookup).toMatchObject({ code: 0, writerError: undefined });
      }

      const closedOutput = await runHook(CURSOR_HOOK_COMMAND, { closeStdout: true, input });
      expect(closedOutput).toMatchObject({ code: 0, writerError: undefined });

      const control = await runHook("exec 0<&-; sleep 0.2", { input, inputDelayMs: 25 });
      expect(["EPIPE", "ERR_STREAM_DESTROYED"]).toContain(control.writerError);
    });

    it("bounds an unavailable loopback listener", async () => {
      const result = await runHook(CURSOR_HOOK_COMMAND, {
        environment: {
          ANYWHERE_TERMINAL_CURSOR_URL: `http://127.0.0.1:1/123e4567-e89b-12d3-a456-426614174000/${"a".repeat(64)}`,
        },
      });
      expect(result.code).toBe(0);
      expect(result.elapsedMs).toBeLessThan(2_500);
    });
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

// The staging name and the call that creates it, against a REAL filesystem —
// a memory double models neither "writeFile follows the symlink at this name"
// nor "wx refuses it", and modelling them badly is how this witness would pass
// over the defect it exists to catch (design.md D1).
describe("where a replacement is staged", () => {
  const stagedAt = (directory: string) => join(directory, `.hooks.json.${"ab".repeat(16)}.tmp`);

  /** Fixes the staging name so a test can be waiting at it, as an attacker who guessed would be. */
  const fixedName: CursorHookInstallerDependencies = {
    now: () => 1_756_800_000_000,
    randomBytes: () => Buffer.alloc(16, 0xab),
  };

  it("refuses a symlink waiting at the staging name rather than writing through it", async () => {
    const options = await fixture();
    await writeFile(options.configPath, `${JSON.stringify({ version: 1, hooks: {} })}\n`, "utf8");
    const decoy = join(options.storagePath, "..", "decoy.txt");
    await writeFile(decoy, "ORIGINAL\n", "utf8");
    await symlink(decoy, stagedAt(join(options.configPath, "..")));

    const result = await new CursorHookInstaller(options, fixedName).install();

    expect(result.installed).toBe(false);
    expect(await readFile(decoy, "utf8")).toBe("ORIGINAL\n");
  });

  it("names the staging file from neither the clock nor a previous staging", async () => {
    const options = await fixture();
    await writeFile(options.configPath, `${JSON.stringify({ version: 1, hooks: {} })}\n`, "utf8");
    const seen: string[] = [];
    const capture: CursorHookInstallerDependencies = {
      now: () => 1_756_800_000_000,
      rename: async (from, to) => {
        seen.push(from);
        await rename(from, to);
      },
    };

    await new CursorHookInstaller(options, capture).install();
    await writeFile(options.configPath, `${JSON.stringify({ version: 1, hooks: {} })}\n`, "utf8");
    await new CursorHookInstaller(options, capture).install();

    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toContain("1756800000000");
    expect(seen[0]).not.toBe(seen[1]);
  });
});
