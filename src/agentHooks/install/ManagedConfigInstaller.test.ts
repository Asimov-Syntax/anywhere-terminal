// src/agentHooks/install/ManagedConfigInstaller.test.ts — Migrated from
// src/cursor/CursorHookInstaller.test.ts with its assertions intact, plus the
// behaviours install-claude-hooks adds to the shared layer: classified reads
// (D10), symlink refusal ahead of the lock (D5), directory-scoped managed-entry
// ownership (D12), and chmod-before-rename wrapper creation (D11).

import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CURSOR_HOOK_EVENTS } from "../agents/cursor";
import { CURSOR_WRAPPER_DIRECTORY, cursorConfigAdapter, cursorWrapperScripts } from "./cursorConfigAdapter";
import {
  ManagedConfigInstaller,
  type ManagedConfigInstallerDependencies,
  managedWrapperCommand,
} from "./ManagedConfigInstaller";
import { ManagedEntryLedger, memoryLedgerStore } from "./managedEntryLedger";
import { PROBE_OUTER_DEADLINE_MS } from "./probeRunner";

const tempDirectories: string[] = [];

interface Paths {
  configPath: string;
  storageRoot: string;
  wrapperDirectory: string;
  platform: "linux" | "win32";
}

async function fixture(platform: "linux" | "win32" = "linux"): Promise<Paths> {
  const directory = await mkdtemp(join(tmpdir(), "cursor-hooks-"));
  tempDirectories.push(directory);
  const storageRoot = join(directory, "storage");
  return {
    configPath: join(directory, "hooks.json"),
    storageRoot,
    wrapperDirectory: join(storageRoot, CURSOR_WRAPPER_DIRECTORY),
    platform,
  };
}

type Hooks = Record<string, Array<Record<string, unknown>>>;

function installerFor(
  paths: Paths,
  dependencies: ManagedConfigInstallerDependencies = {},
  ledger?: ManagedEntryLedger,
) {
  const adapter = cursorConfigAdapter(paths.configPath);
  const options = { storageRoot: paths.storageRoot, platform: paths.platform };
  const ownership = ledger?.ownership("cursor", managedWrapperCommand(adapter, options));
  return new ManagedConfigInstaller(adapter, { ...options, ownership }, dependencies);
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

describe("ManagedConfigInstaller with the cursor adapter", () => {
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
    const installer = installerFor(paths);

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
    const installer = installerFor(paths);
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
    const installer = installerFor(paths);

    await expect(installer.install()).resolves.toMatchObject({ installed: false, reason: "unsupported-config" });
    expect(await readFile(paths.configPath, "utf8")).toBe(contents);
    await expect(installer.uninstall()).resolves.toMatchObject({ removed: false, reason: "unsupported-config" });
  });

  describe("classified reads (D10)", () => {
    it.each([
      ["an array root", "[]"],
      ["a null root", "null"],
      ["a numeric root", "42"],
      ["a string root", '"hello"'],
      ["truncated JSON", '{"version": 1, "hooks":'],
    ])("refuses %s byte-for-byte instead of recreating the file", async (_name, contents) => {
      const paths = await fixture();
      await writeFile(paths.configPath, contents);
      const installer = installerFor(paths);

      await expect(installer.install()).resolves.toMatchObject({ installed: false, reason: "unsupported-config" });
      expect(await readFile(paths.configPath, "utf8")).toBe(contents);
      await expect(installer.uninstall()).resolves.toMatchObject({ removed: false, reason: "unsupported-config" });
      expect(await readFile(paths.configPath, "utf8")).toBe(contents);
    });

    it("creates a configuration only when the file does not exist", async () => {
      const paths = await fixture();

      expect((await installerFor(paths).install()).installed).toBe(true);
      expect(await config(paths.configPath)).toMatchObject({ version: 1 });
    });

    it("installs into a configuration directory that does not exist yet", async () => {
      const paths = await fixture();
      const nested = { ...paths, configPath: join(paths.storageRoot, "never", "created", "hooks.json") };

      expect((await installerFor(nested).install()).installed).toBe(true);
      expect(await config(nested.configPath)).toMatchObject({ version: 1 });
    });

    it("reports nothing to remove — not a lock failure — when the config directory is absent", async () => {
      const paths = await fixture();
      const nested = { ...paths, configPath: join(paths.storageRoot, "never", "created", "hooks.json") };

      await expect(installerFor(nested).uninstall()).resolves.toEqual({ removed: false, reason: "not-installed" });
      await expect(stat(join(paths.storageRoot, "never"))).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  describe("symlink refusal (D5)", () => {
    it.each([
      "install",
      "uninstall",
    ] as const)("refuses a symlinked destination on %s and takes no lock", async (op) => {
      const paths = await fixture();
      const real = join(paths.storageRoot, "real-hooks.json");
      await mkdir(paths.storageRoot, { recursive: true });
      await writeFile(real, JSON.stringify({ version: 1, hooks: {} }));
      await symlink(real, paths.configPath);
      const installer = installerFor(paths);

      const outcome = op === "install" ? await installer.install() : await installer.uninstall();
      expect(outcome).toMatchObject({ reason: "unsupported-config" });
      expect(await readFile(real, "utf8")).toBe(JSON.stringify({ version: 1, hooks: {} }));
      await expect(stat(`${paths.configPath}.anywhere-terminal.lock`)).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  describe("managed-entry ownership (D12)", () => {
    it("sweeps and rewrites an entry it recorded writing at a storage root that has since moved", async () => {
      const paths = await fixture();
      await writeFile(paths.configPath, JSON.stringify({ version: 1, hooks: {} }));
      const ledger = new ManagedEntryLedger(memoryLedgerStore());
      const moved = { ...paths, storageRoot: join(paths.storageRoot, "..", "moved-storage") };

      expect((await installerFor(paths, {}, ledger).install()).installed).toBe(true);
      const before = ((await config(paths.configPath)).hooks as Hooks).sessionStart[0]?.command;
      expect((await installerFor(moved, {}, ledger).install()).installed).toBe(true);

      const { sessionStart } = (await config(paths.configPath)).hooks as Hooks;
      expect(sessionStart).toHaveLength(1);
      expect(sessionStart[0]?.command).not.toBe(before);
      expect(sessionStart[0]?.command).toContain("moved-storage");
    });

    it("leaves an entry at another storage root alone when it never recorded writing one", async () => {
      const paths = await fixture();
      const stale = { command: `'/somewhere/else/${CURSOR_WRAPPER_DIRECTORY}/cursor-hook-observer.sh'`, timeout: 2 };
      await writeFile(paths.configPath, JSON.stringify({ version: 1, hooks: { sessionStart: [{ ...stale }] } }));

      expect((await installerFor(paths).install()).installed).toBe(true);

      // The cost of exact equality, taken deliberately: an entry we cannot prove
      // is ours is another program's until the ledger says otherwise.
      expect((await config(paths.configPath)).hooks).toMatchObject({ sessionStart: [stale, { timeout: 2 }] });
    });

    it.each([
      ["a directory that merely ends in the owned name", "'/home/alice/not-cursor-hooks/cursor-hook-observer.sh'"],
      ["a filename that merely starts with the owned name", "'/root/cursor-hooks/cursor-hook-observer.sh.backup'"],
      [
        "the owned pair appearing as somebody else's argument",
        "'/usr/bin/audit' --script cursor-hooks/cursor-hook-observer.sh",
      ],
      ["a same-named script in a different directory", "'/home/alice/scripts/cursor-hook-observer.sh'"],
    ])("does not claim %s", async (_name, command) => {
      const paths = await fixture();
      const foreign = { command, timeout: 2 };
      await writeFile(paths.configPath, JSON.stringify({ version: 1, hooks: { sessionStart: [{ ...foreign }] } }));
      const installer = installerFor(paths);

      expect((await installer.install()).installed).toBe(true);
      expect((await config(paths.configPath)).hooks).toMatchObject({ sessionStart: [foreign, { timeout: 2 }] });

      expect((await installer.uninstall()).removed).toBe(true);
      expect((await config(paths.configPath)).hooks).toMatchObject({ sessionStart: [foreign] });
    });

    it.each([
      [
        "a quoted path with a suffix concatenated after the closing quote",
        "'/root/cursor-hooks/cursor-hook-observer.sh'.bak",
      ],
      [
        "a quoted path with a suffix concatenated in a second quoted run",
        `'/root/cursor-hooks/cursor-hook-observer.sh'".bak"`,
      ],
      ["an unterminated single quote", "'/root/cursor-hooks/cursor-hook-observer.sh"],
      ["an unterminated double quote", '"/root/cursor-hooks/cursor-hook-observer.sh'],
    ])("does not claim %s", async (_name, command) => {
      const paths = await fixture();
      const foreign = { command, timeout: 2 };
      await writeFile(paths.configPath, JSON.stringify({ version: 1, hooks: { sessionStart: [{ ...foreign }] } }));
      const installer = installerFor(paths);

      expect((await installer.install()).installed).toBe(true);
      expect((await config(paths.configPath)).hooks).toMatchObject({ sessionStart: [foreign, { timeout: 2 }] });

      expect((await installer.uninstall()).removed).toBe(true);
      expect((await config(paths.configPath)).hooks).toMatchObject({ sessionStart: [foreign] });
    });

    it("leaves a re-quoted equivalent of its own path alone rather than resolving it", async () => {
      const paths = await fixture();
      const wrapper = join(paths.wrapperDirectory, "cursor-hook-observer.sh");
      // Every one of these resolves to our wrapper. Three rounds of review
      // established that no parser deciding so can be trusted, so none is ours.
      const equivalents = [wrapper, `"${wrapper}"`, `'${wrapper.slice(0, 5)}'${wrapper.slice(5)}`];
      const entries = equivalents.map((command) => ({ command, timeout: 2 }));
      await writeFile(paths.configPath, JSON.stringify({ version: 1, hooks: { sessionStart: entries } }));

      expect((await installerFor(paths).install()).installed).toBe(true);

      const { sessionStart } = (await config(paths.configPath)).hooks as Hooks;
      expect(sessionStart).toHaveLength(entries.length + 1);
      expect(sessionStart.slice(0, entries.length)).toEqual(entries);
    });

    it("claims the byte-exact command the shipped build wrote before any ledger existed", async () => {
      const paths = await fixture();
      const shipped = `'${join(paths.wrapperDirectory, "cursor-hook-observer.sh")}'`;
      await writeFile(
        paths.configPath,
        JSON.stringify({ version: 1, hooks: { sessionStart: [{ command: shipped, timeout: 2 }] } }),
      );

      expect((await installerFor(paths).uninstall()).removed).toBe(true);
      expect((await config(paths.configPath)).hooks).toMatchObject({ sessionStart: [] });
    });

    it("leaves a same-named script the extension does not own untouched", async () => {
      const paths = await fixture();
      const foreign = { command: "'/home/alice/scripts/cursor-hook-observer.sh'", timeout: 2 };
      await writeFile(paths.configPath, JSON.stringify({ version: 1, hooks: { sessionStart: [{ ...foreign }] } }));
      const installer = installerFor(paths);

      expect((await installer.install()).installed).toBe(true);
      expect((await config(paths.configPath)).hooks).toMatchObject({
        sessionStart: [foreign, { timeout: 2 }],
      });

      expect((await installer.uninstall()).removed).toBe(true);
      expect((await config(paths.configPath)).hooks).toMatchObject({ sessionStart: [foreign] });
    });

    it("converges to one managed entry per event across repeated installs", async () => {
      const paths = await fixture();
      await writeFile(paths.configPath, JSON.stringify({ version: 1, hooks: {} }));
      const installer = installerFor(paths);

      await installer.install();
      await installer.install();
      await installer.install();

      const hooks = (await config(paths.configPath)).hooks as Record<string, Array<Record<string, unknown>>>;
      for (const event of CURSOR_HOOK_EVENTS) {
        expect(hooks[event]).toHaveLength(1);
      }
    });
  });

  describe("wrapper bytes are pinned", () => {
    // The move from CursorHookInstaller to the shared reconciler must not alter
    // one byte of what a user's Cursor runs. Length is pinned alongside content
    // so a whitespace-only regression cannot pass.
    it("emits the POSIX wrapper verbatim at its recorded length", async () => {
      const paths = await fixture();
      await writeFile(paths.configPath, JSON.stringify({ version: 1, hooks: {} }));

      await installerFor(paths).install();

      const contents = await readFile(join(paths.wrapperDirectory, "cursor-hook-observer.sh"), "utf8");
      expect(contents).toBe(cursorWrapperScripts().posix);
      // biome-ignore-start lint/suspicious/noTemplateCurlyInString: emitted shell syntax
      expect(contents).toBe(
        [
          "#!/bin/sh",
          "# Managed by AnyWhere Terminal. This observer is intentionally fail-open.",
          'if [ -n "${ANYWHERE_TERMINAL_CURSOR_URL:-}" ] && command -v curl >/dev/null 2>&1; then',
          "  curl --silent --output /dev/null --connect-timeout 0.5 --max-time 1.5 \\",
          '    --request POST --header "content-type: application/json" \\',
          '    --data-binary @- "${ANYWHERE_TERMINAL_CURSOR_URL}/cursor" || true',
          "fi",
          "cat >/dev/null 2>&1 || true",
          'printf "{}\\n"',
          "",
        ].join("\n"),
      );
      // biome-ignore-end lint/suspicious/noTemplateCurlyInString: emitted shell syntax
      expect(Buffer.byteLength(contents, "utf8")).toBe(423);
      expect(contents.startsWith("#!/bin/sh\n")).toBe(true);
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the emitted script must carry this shell expansion literally.
      expect(contents).toContain("${ANYWHERE_TERMINAL_CURSOR_URL}/cursor");
    });

    it("emits the Windows wrapper verbatim at its recorded length", async () => {
      const paths = await fixture("win32");
      await writeFile(paths.configPath, JSON.stringify({ version: 1, hooks: {} }));

      await installerFor(paths, { run: async () => ({ exitCode: 0, stdout: "{}\n" }) }).install();

      const contents = await readFile(join(paths.wrapperDirectory, "cursor-hook-observer.cmd"), "utf8");
      expect(contents).toBe(cursorWrapperScripts().windows);
      expect(contents).toBe(
        [
          "@echo off",
          "setlocal",
          "if not defined ANYWHERE_TERMINAL_CURSOR_URL goto output",
          `"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "$body=[Console]::In.ReadToEnd(); try { Invoke-WebRequest -UseBasicParsing -Method Post -ContentType 'application/json' -TimeoutSec 2 -Body $body ($env:ANYWHERE_TERMINAL_CURSOR_URL + '/cursor') ^| Out-Null } catch {}"`,
          ":output",
          '"%SystemRoot%\\System32\\more.com" >nul 2>nul',
          "echo {}",
          "exit /b 0",
          "",
        ].join("\n"),
      );
      expect(Buffer.byteLength(contents, "utf8")).toBe(469);
      expect(contents).toContain("$env:ANYWHERE_TERMINAL_CURSOR_URL + '/cursor'");
      expect(contents).toContain('"%SystemRoot%\\System32\\more.com" >nul 2>nul');
      expect(contents).not.toMatch(/^more /m);
    });
  });

  it("makes the wrapper executable before it is reachable (D11)", async () => {
    const paths = await fixture();
    await writeFile(paths.configPath, JSON.stringify({ version: 1, hooks: {} }));
    const order: string[] = [];
    const wrapper = join(paths.wrapperDirectory, "cursor-hook-observer.sh");
    const installer = installerFor(paths, {
      fs: {
        writeFile: (async (path: string, contents: string, options?: unknown) => {
          if (String(path).includes("cursor-hook-observer")) {
            order.push(`write:${String(path) === wrapper ? "canonical" : "temp"}`);
          }
          return writeFile(path, contents, options as never);
        }) as never,
        chmod: (async (path: string, mode: number) => {
          if (String(path).includes("cursor-hook-observer")) {
            order.push(`chmod:${String(path) === wrapper ? "canonical" : "temp"}`);
          }
          return chmod(path, mode);
        }) as never,
      },
    });

    expect((await installer.install()).installed).toBe(true);
    expect(order).toEqual(["write:temp", "chmod:temp"]);
    expect((await stat(wrapper)).mode & 0o777).toBe(0o700);
  });

  it("retries when another writer changes the configuration before replacement", async () => {
    const paths = await fixture();
    await writeFile(paths.configPath, JSON.stringify({ version: 1, hooks: {} }));
    let changes = 0;
    const installer = installerFor(paths, {
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
    const installer = installerFor(paths, {
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
    const installer = installerFor(paths, { now: () => 100_000 });

    expect((await installer.install()).installed).toBe(true);
  });

  it("returns lock-unavailable after a bounded number of lock attempts", async () => {
    const paths = await fixture();
    const original = JSON.stringify({ version: 1, hooks: {} });
    await writeFile(paths.configPath, original);
    await writeFile(`${paths.configPath}.anywhere-terminal.lock`, "active");
    let sleeps = 0;
    const installer = installerFor(paths, {
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

    expect((await installerFor(paths).install()).installed).toBe(true);
    expect((await stat(paths.configPath)).mode & 0o777).toBe(0o640);
  });

  it("uses a valid sibling temporary path for Windows-shaped configuration paths", async () => {
    const configPath = "C:\\Users\\alice\\.cursor\\hooks.json";
    const storageRoot = "C:\\Users\\alice\\AppData\\Local\\AnyWhere Terminal";
    const files = new Map<string, string>([[configPath, JSON.stringify({ version: 1, hooks: {} })]]);
    const replacements: Array<[string, string]> = [];
    const memoryFs = {
      mkdir: vi.fn(async () => undefined),
      chmod: vi.fn(async () => undefined),
      lstat: vi.fn(async () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }),
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
    } as unknown as NonNullable<ManagedConfigInstallerDependencies["fs"]>;
    const installer = new ManagedConfigInstaller(
      cursorConfigAdapter(configPath),
      { storageRoot, platform: "win32" },
      { fs: memoryFs, now: () => 123, run: async () => ({ exitCode: 0, stdout: "{}\n" }) },
    );

    expect((await installer.install()).installed).toBe(true);
    expect(replacements.filter(([, target]) => target === configPath)).toEqual([
      ["C:\\Users\\alice\\.cursor\\.hooks.json.123.tmp", configPath],
    ]);
  });

  it("reports config replacement failure and leaves the user configuration intact", async () => {
    const paths = await fixture();
    const original = JSON.stringify({ version: 1, hooks: {} });
    await writeFile(paths.configPath, original);
    let renames = 0;
    const installer = installerFor(paths, {
      rename: async (oldPath, newPath) => {
        renames += 1;
        // Let the wrapper rename through; fail only the configuration replace.
        if (newPath === paths.configPath) {
          throw new Error("denied");
        }
        await rename(oldPath, newPath);
      },
    });

    await expect(installer.install()).resolves.toMatchObject({ installed: false, reason: "write-failed" });
    expect(renames).toBeGreaterThan(0);
    expect(await readFile(paths.configPath, "utf8")).toBe(original);
  });

  it("reports wrapper creation failure without changing hooks.json", async () => {
    const paths = await fixture();
    const original = JSON.stringify({ version: 1, hooks: {} });
    await writeFile(paths.configPath, original);
    const installer = installerFor(paths, {
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
    const installer = installerFor(paths);
    await installer.install();
    const before = await readFile(paths.configPath, "utf8");
    const blocked = installerFor(paths, {
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
    const installer = installerFor(paths);

    await installer.install();
    const wrapper = join(paths.wrapperDirectory, "cursor-hook-observer.sh");
    const bin = join(paths.storageRoot, "bin");
    await mkdir(bin, { recursive: true });
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
    const installer = installerFor(paths, { run: async () => ({ exitCode: 1, stdout: "" }) });

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
        .fn<NonNullable<ManagedConfigInstallerDependencies["run"]>>()
        .mockImplementationOnce(async () => {
          probeStarted();
          return await new Promise<never>(() => undefined);
        })
        .mockResolvedValue({ exitCode: 0, stdout: "{}\n" });
      const installer = installerFor(paths, { run });

      const hungInstall = installer.install();
      await started;
      vi.advanceTimersByTime(PROBE_OUTER_DEADLINE_MS);
      await expect(hungInstall).resolves.toMatchObject({ installed: false, reason: "windows-probe-failed" });
      expect(await readFile(paths.configPath, "utf8")).toBe(original);

      await expect(installer.install()).resolves.toMatchObject({ installed: true });
      expect(run).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    "not JSON",
    "[]",
    '{"not":"empty"}',
  ])("does not install Windows observers when the no-op probe output is %j", async (stdout) => {
    const paths = await fixture("win32");
    await writeFile(paths.configPath, JSON.stringify({ version: 1, hooks: {} }));
    const installer = installerFor(paths, { run: async () => ({ exitCode: 0, stdout }) });

    await expect(installer.install()).resolves.toMatchObject({ installed: false, reason: "windows-probe-failed" });
    expect(await config(paths.configPath)).toEqual({ version: 1, hooks: {} });
  });

  it("installs Windows observers only after an empty JSON no-op probe", async () => {
    const paths = await fixture("win32");
    await writeFile(paths.configPath, JSON.stringify({ version: 1, hooks: {} }));
    const run = vi.fn(async () => ({ exitCode: 0, stdout: "{}\n" }));
    const installer = installerFor(paths, { run });

    expect((await installer.install()).installed).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    const wrapper = await readFile(join(paths.wrapperDirectory, "cursor-hook-observer.cmd"), "utf8");
    expect(wrapper).toContain('"%SystemRoot%\\System32\\more.com" >nul 2>nul');
    expect(wrapper).toContain("echo {}");
  });

  it("emits a hook command that /bin/sh -n accepts when the storage path contains an apostrophe", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cursor-hooks-"));
    tempDirectories.push(directory);
    const configPath = join(directory, "hooks.json");
    const storageRoot = join(directory, "O'Brien", "storage");
    await writeFile(configPath, JSON.stringify({ version: 1, hooks: {} }));
    const installer = new ManagedConfigInstaller(cursorConfigAdapter(configPath), { storageRoot, platform: "linux" });

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
