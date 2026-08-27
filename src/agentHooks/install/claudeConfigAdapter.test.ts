// src/agentHooks/install/claudeConfigAdapter.test.ts — Claude's settings.json is
// a general settings file, so most of these tests are about what the reconciler
// must NOT touch.

import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CLAUDE_HOOK_EVENTS } from "../agents/claude";
import {
  CLAUDE_CONFIG_DIR_ENV_VAR,
  CLAUDE_WRAPPER_DIRECTORY,
  claudeConfigAdapter,
  claudeWrapperScripts,
  resolveClaudeConfigPath,
} from "./claudeConfigAdapter";
import { ManagedConfigInstaller } from "./ManagedConfigInstaller";

const tempDirectories: string[] = [];

interface Paths {
  configPath: string;
  storageRoot: string;
  wrapperDirectory: string;
}

async function fixture(): Promise<Paths> {
  const directory = await mkdtemp(join(tmpdir(), "claude-hooks-"));
  tempDirectories.push(directory);
  const storageRoot = join(directory, "storage");
  return {
    configPath: join(directory, "settings.json"),
    storageRoot,
    wrapperDirectory: join(storageRoot, CLAUDE_WRAPPER_DIRECTORY),
  };
}

function installerFor(paths: Paths, platform: "linux" | "win32" = "linux") {
  return new ManagedConfigInstaller(
    claudeConfigAdapter({ configuredDirectory: () => join(paths.configPath, "..") }),
    { storageRoot: paths.storageRoot, platform },
    platform === "win32" ? { run: async () => ({ exitCode: 0, stdout: "{}\n" }) } : {},
  );
}

async function settings(path: string) {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

function groupsFor(document: Record<string, unknown>, event: string) {
  return (document.hooks as Record<string, Array<Record<string, unknown>>>)[event];
}

function runShell(
  script: string,
  input: string,
  environment: Record<string, string>,
): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/sh", [script], { env: environment });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ stdout, code }));
    child.stdin.end(input);
  });
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("resolveClaudeConfigPath", () => {
  it("prefers the setting over the environment and the default", () => {
    expect(
      resolveClaudeConfigPath({
        configuredDirectory: () => "/from/setting",
        environment: { [CLAUDE_CONFIG_DIR_ENV_VAR]: "/from/env" },
        homeDirectory: () => "/home/alice",
      }),
    ).toBe("/from/setting/settings.json");
  });

  it("falls back to the environment when the setting is empty or blank", () => {
    for (const configured of [undefined, () => undefined, () => "", () => "   "]) {
      expect(
        resolveClaudeConfigPath({
          configuredDirectory: configured,
          environment: { [CLAUDE_CONFIG_DIR_ENV_VAR]: "/from/env" },
          homeDirectory: () => "/home/alice",
        }),
      ).toBe("/from/env/settings.json");
    }
  });

  it("falls back to ~/.claude when neither is set", () => {
    expect(
      resolveClaudeConfigPath({
        environment: { [CLAUDE_CONFIG_DIR_ENV_VAR]: "  " },
        homeDirectory: () => "/home/alice",
      }),
    ).toBe("/home/alice/.claude/settings.json");
  });

  it("re-reads the setting on every call rather than capturing it", () => {
    let directory = "/first";
    const adapter = claudeConfigAdapter({ configuredDirectory: () => directory });
    expect(adapter.configPath()).toBe("/first/settings.json");
    directory = "/second";
    expect(adapter.configPath()).toBe("/second/settings.json");
  });
});

describe("claudeConfigAdapter through the shared reconciler", () => {
  it("round-trips unknown keys and sibling settings untouched", async () => {
    const paths = await fixture();
    const original = {
      model: "opus",
      permissions: { allow: ["Bash(git status)"] },
      env: { FOO: "bar" },
      somethingANewerCliAdded: { nested: [1, 2, 3] },
    };
    await writeFile(paths.configPath, JSON.stringify(original));
    const installer = installerFor(paths);

    expect((await installer.install()).installed).toBe(true);
    const installed = await settings(paths.configPath);
    expect(installed).toMatchObject(original);

    expect((await installer.uninstall()).removed).toBe(true);
    const cleaned = await settings(paths.configPath);
    expect(cleaned).toMatchObject(original);
    for (const event of CLAUDE_HOOK_EVENTS) {
      expect(groupsFor(cleaned, event)).toEqual([]);
    }
  });

  it("registers every event and scopes only PreToolUse with a matcher", async () => {
    const paths = await fixture();
    await writeFile(paths.configPath, "{}");

    expect((await installerFor(paths).install()).installed).toBe(true);

    const document = await settings(paths.configPath);
    for (const event of CLAUDE_HOOK_EVENTS) {
      const groups = groupsFor(document, event);
      expect(groups).toHaveLength(1);
      expect(groups[0]?.hooks).toEqual([
        { type: "command", command: expect.stringContaining(paths.storageRoot), timeout: 2 },
      ]);
      expect(groups[0]?.matcher).toBe(event === "PreToolUse" ? "*" : undefined);
    }
    expect(Object.keys(document.hooks as object)).toEqual([...CLAUDE_HOOK_EVENTS]);
  });

  it("keeps a user hook registered on the same event", async () => {
    const paths = await fixture();
    const userGroup = { matcher: "Bash", hooks: [{ type: "command", command: "~/bin/audit.sh" }] };
    await writeFile(paths.configPath, JSON.stringify({ hooks: { PreToolUse: [userGroup] } }));
    const installer = installerFor(paths);

    expect((await installer.install()).installed).toBe(true);
    expect(groupsFor(await settings(paths.configPath), "PreToolUse")).toMatchObject([userGroup, { matcher: "*" }]);

    expect((await installer.uninstall()).removed).toBe(true);
    expect(groupsFor(await settings(paths.configPath), "PreToolUse")).toEqual([userGroup]);
  });

  it("keeps a user handler the user added inside our own group", async () => {
    const paths = await fixture();
    await writeFile(paths.configPath, "{}");
    const installer = installerFor(paths);
    await installer.install();
    const document = await settings(paths.configPath);
    const userHandler = { type: "command", command: "~/bin/mine.sh" };
    (groupsFor(document, "Stop")[0]?.hooks as unknown[]).push(userHandler);
    await writeFile(paths.configPath, JSON.stringify(document));

    expect((await installer.uninstall()).removed).toBe(true);
    expect(groupsFor(await settings(paths.configPath), "Stop")).toEqual([{ hooks: [userHandler] }]);
  });

  it("keeps a user-authored group's own keys when our handler is the last one in it", async () => {
    const paths = await fixture();
    const userGroup = { matcher: "*", label: "keep me", note: { any: "shape" } };
    await writeFile(paths.configPath, "{}");
    const installer = installerFor(paths);
    await installer.install();
    const document = await settings(paths.configPath);
    const managed = groupsFor(document, "Stop")[0]?.hooks;
    (document.hooks as Record<string, unknown[]>).Stop = [{ ...userGroup, hooks: managed }];
    await writeFile(paths.configPath, JSON.stringify(document));

    expect((await installer.uninstall()).removed).toBe(true);
    expect(groupsFor(await settings(paths.configPath), "Stop")).toEqual([{ ...userGroup, hooks: [] }]);
  });

  it("does not leave an empty husk behind for a group it created itself", async () => {
    const paths = await fixture();
    await writeFile(paths.configPath, "{}");
    const installer = installerFor(paths);
    await installer.install();

    expect((await installer.uninstall()).removed).toBe(true);
    const document = await settings(paths.configPath);
    for (const event of CLAUDE_HOOK_EVENTS) {
      expect(groupsFor(document, event)).toEqual([]);
    }
  });

  it.each([
    ["a directory that merely ends in the owned name", "'/home/alice/not-claude-hooks/claude-hook-observer.sh'"],
    ["a filename that merely starts with the owned name", "'/root/claude-hooks/claude-hook-observer.sh.bak'"],
    ["the owned pair as somebody else's argument", "'/usr/bin/audit' --script claude-hooks/claude-hook-observer.sh"],
  ])("does not claim %s", async (_name, command) => {
    const paths = await fixture();
    const foreign = { type: "command", command, timeout: 2 };
    await writeFile(paths.configPath, JSON.stringify({ hooks: { Stop: [{ hooks: [{ ...foreign }] }] } }));
    const installer = installerFor(paths);

    expect((await installer.install()).installed).toBe(true);
    expect(groupsFor(await settings(paths.configPath), "Stop")[0]?.hooks).toEqual([foreign]);

    expect((await installer.uninstall()).removed).toBe(true);
    expect(groupsFor(await settings(paths.configPath), "Stop")[0]?.hooks).toEqual([foreign]);
  });

  it("converges to one managed group per event across repeated installs", async () => {
    const paths = await fixture();
    await writeFile(paths.configPath, "{}");
    const installer = installerFor(paths);

    await installer.install();
    await installer.install();
    await installer.install();

    const document = await settings(paths.configPath);
    for (const event of CLAUDE_HOOK_EVENTS) {
      expect(groupsFor(document, event)).toHaveLength(1);
    }
  });

  it("rewrites a managed entry whose script path drifted, and leaves a lookalike alone", async () => {
    const paths = await fixture();
    const stale = {
      type: "command",
      command: `'/old/root/${CLAUDE_WRAPPER_DIRECTORY}/claude-hook-observer.sh'`,
      timeout: 2,
    };
    const foreign = { type: "command", command: "'/home/alice/scripts/claude-hook-observer.sh'", timeout: 2 };
    await writeFile(paths.configPath, JSON.stringify({ hooks: { Stop: [{ hooks: [stale, foreign] }] } }));

    expect((await installerFor(paths).install()).installed).toBe(true);

    const groups = groupsFor(await settings(paths.configPath), "Stop");
    expect(groups).toHaveLength(2);
    expect(groups[0]?.hooks).toEqual([foreign]);
    expect((groups[1]?.hooks as Array<Record<string, unknown>>)[0]?.command).toContain(paths.storageRoot);
  });

  it("creates a settings file that holds nothing but our hooks", async () => {
    const paths = await fixture();

    expect((await installerFor(paths).install()).installed).toBe(true);

    expect(Object.keys(await settings(paths.configPath))).toEqual(["hooks"]);
  });

  describe("the D2 container gate", () => {
    it.each([
      ["a non-object hooks map", { hooks: [] }],
      ["a non-array event value", { hooks: { Stop: { matcher: "*" } } }],
      ["a non-object matcher group", { hooks: { Stop: ["nope"] } }],
      ["a non-array matcher hooks value", { hooks: { Stop: [{ hooks: "broken" }] } }],
      ["a non-object handler", { hooks: { Stop: [{ hooks: ["echo hi"] }] } }],
      ["a non-string matcher", { hooks: { Stop: [{ matcher: 7, hooks: [] }] } }],
    ])("refuses %s byte-for-byte", async (_name, document) => {
      const paths = await fixture();
      const contents = JSON.stringify(document);
      await writeFile(paths.configPath, contents);
      const installer = installerFor(paths);

      await expect(installer.install()).resolves.toMatchObject({ installed: false, reason: "unsupported-config" });
      expect(await readFile(paths.configPath, "utf8")).toBe(contents);
      await expect(installer.uninstall()).resolves.toMatchObject({ removed: false, reason: "unsupported-config" });
      expect(await readFile(paths.configPath, "utf8")).toBe(contents);
    });

    it.each([
      ["hooks absent entirely", { model: "opus" }],
      ["an unknown handler key", { hooks: { Stop: [{ hooks: [{ type: "command", command: "x", futureKey: 1 }] }] } }],
      ["an unknown handler type", { hooks: { Stop: [{ hooks: [{ type: "somethingNew" }] }] } }],
      ["an event Claude added later", { hooks: { AFutureEvent: [{ hooks: [] }] } }],
    ])("accepts %s and keeps it ahead of our own entry", async (_name, document) => {
      const paths = await fixture();
      await writeFile(paths.configPath, JSON.stringify(document));

      await expect(installerFor(paths).install()).resolves.toMatchObject({ installed: true });

      const installed = await settings(paths.configPath);
      const { hooks: originalHooks, ...siblings } = document as Record<string, unknown>;
      expect(installed).toMatchObject(siblings);
      for (const [event, groups] of Object.entries((originalHooks ?? {}) as Record<string, unknown[]>)) {
        expect(groupsFor(installed, event).slice(0, groups.length)).toEqual(groups);
      }
    });
  });

  describe("the emitted wrapper", () => {
    it("prints neutral output and posts the payload when coordinates are present", async () => {
      const paths = await fixture();
      await writeFile(paths.configPath, "{}");
      await installerFor(paths).install();
      const bin = join(paths.storageRoot, "bin");
      const posted = join(paths.storageRoot, "posted.txt");
      await mkdir(bin, { recursive: true });
      await writeFile(join(bin, "curl"), `#!/bin/sh\ncat >"${posted}"\nprintf '%s\\n' "$@" >>"${posted}"\n`);
      await chmod(join(bin, "curl"), 0o700);

      const result = await runShell(join(paths.wrapperDirectory, "claude-hook-observer.sh"), '{"hook":"Stop"}', {
        ANYWHERE_TERMINAL_CLAUDE_URL: "http://127.0.0.1:9/s/abc",
        PATH: `${bin}:/bin:/usr/bin`,
      });

      expect(result.stdout).toBe("{}\n");
      expect(result.code).toBe(0);
      const observed = await readFile(posted, "utf8");
      expect(observed).toContain('{"hook":"Stop"}');
      expect(observed).toContain("http://127.0.0.1:9/s/abc/claude");
      expect(observed).toContain("--max-time");
    });

    it.each([
      ["no coordinates in the environment", {}],
      ["a backgrounded job", { ANYWHERE_TERMINAL_CLAUDE_URL: "http://127.0.0.1:9/s/abc", CLAUDE_JOB_DIR: "/tmp/job" }],
    ])("exits silently on %s while still draining stdin", async (_name, environment) => {
      const paths = await fixture();
      await writeFile(paths.configPath, "{}");
      await installerFor(paths).install();
      const bin = join(paths.storageRoot, "bin");
      const posted = join(paths.storageRoot, "posted.txt");
      await mkdir(bin, { recursive: true });
      await writeFile(join(bin, "curl"), `#!/bin/sh\ncat >"${posted}"\n`);
      await chmod(join(bin, "curl"), 0o700);

      const result = await runShell(join(paths.wrapperDirectory, "claude-hook-observer.sh"), '{"hook":"Stop"}', {
        ...(environment as Record<string, string>),
        PATH: `${bin}:/bin:/usr/bin`,
      });

      expect(result.stdout).toBe("{}\n");
      expect(result.code).toBe(0);
      await expect(readFile(posted, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("still prints neutral output when curl is absent entirely", async () => {
      const paths = await fixture();
      await writeFile(paths.configPath, "{}");
      await installerFor(paths).install();
      const bin = join(paths.storageRoot, "empty-bin");
      await mkdir(bin, { recursive: true });

      const result = await runShell(join(paths.wrapperDirectory, "claude-hook-observer.sh"), '{"hook":"Stop"}', {
        ANYWHERE_TERMINAL_CLAUDE_URL: "http://127.0.0.1:9/s/abc",
        PATH: bin,
      });

      expect(result.stdout).toBe("{}\n");
      expect(result.code).toBe(0);
    });

    it("emits the POSIX wrapper in the order the guards depend on", async () => {
      const paths = await fixture();
      await writeFile(paths.configPath, "{}");
      await installerFor(paths).install();

      const contents = await readFile(join(paths.wrapperDirectory, "claude-hook-observer.sh"), "utf8");
      expect(contents).toBe(claudeWrapperScripts().posix);
      // Independent of the generator: a same-length edit would slip past an
      // equality check against the code under test (round-1 W3). The `${...}`
      // occurrences below are shell expansions the emitted script must carry
      // literally, not template placeholders.
      // biome-ignore-start lint/suspicious/noTemplateCurlyInString: emitted shell syntax
      expect(contents).toBe(
        [
          "#!/bin/sh",
          "# Managed by AnyWhere Terminal. This observer is intentionally fail-open.",
          "# The {} is defensive output; emitting it first covers every exit path below.",
          'printf "{}\\n"',
          "# Captured before the guards: an early exit must not leave the caller writing",
          "# into a pipe nothing reads.",
          "payload=$(cat)",
          "# A backgrounded session inherited the dispatching terminal's environment.",
          'if [ -n "${CLAUDE_JOB_DIR:-}" ]; then',
          "  exit 0",
          "fi",
          'if [ -z "${ANYWHERE_TERMINAL_CLAUDE_URL:-}" ] || ! command -v curl >/dev/null 2>&1; then',
          "  exit 0",
          "fi",
          `printf '%s' "$payload" | curl --silent --output /dev/null \\`,
          "  --connect-timeout 0.5 --max-time 1.5 \\",
          '  --request POST --header "content-type: application/json" \\',
          '  --data-binary @- "${ANYWHERE_TERMINAL_CLAUDE_URL}/claude" || true',
          "exit 0",
          "",
        ].join("\n"),
      );
      // biome-ignore-end lint/suspicious/noTemplateCurlyInString: emitted shell syntax
      expect(Buffer.byteLength(contents, "utf8")).toBe(761);
      expect(contents.startsWith("#!/bin/sh\n")).toBe(true);
      const lines = contents.split("\n").filter((line) => line !== "" && !line.startsWith("#"));
      expect(lines[0]).toBe('printf "{}\\n"');
      expect(lines[1]).toBe("payload=$(cat)");
      const at = (needle: string) => lines.findIndex((line) => line.includes(needle));
      expect(at("CLAUDE_JOB_DIR")).toBe(2);
      expect(at("CLAUDE_JOB_DIR")).toBeLessThan(at("ANYWHERE_TERMINAL_CLAUDE_URL"));
      expect(at("ANYWHERE_TERMINAL_CLAUDE_URL")).toBeLessThan(at("curl --silent"));
    });

    it("emits the Windows wrapper byte-for-byte with its guards ahead of stdin", async () => {
      const paths = await fixture();
      await writeFile(paths.configPath, "{}");
      await installerFor(paths, "win32").install();

      const contents = await readFile(join(paths.wrapperDirectory, "claude-hook-observer.cmd"), "utf8");
      expect(contents).toBe(claudeWrapperScripts().windows);
      expect(contents).toBe(
        [
          "@echo off",
          "setlocal",
          "echo {}",
          'if not "%CLAUDE_JOB_DIR%"=="" exit /b 0',
          "if not defined ANYWHERE_TERMINAL_CLAUDE_URL exit /b 0",
          '"%SystemRoot%\\System32\\curl.exe" --silent --output nul --connect-timeout 0.5 --max-time 1.5 --request POST --header "content-type: application/json" --data-binary @- "%ANYWHERE_TERMINAL_CLAUDE_URL%/claude" >nul 2>nul',
          "exit /b 0",
          "",
        ].join("\n"),
      );
    });
  });
});
