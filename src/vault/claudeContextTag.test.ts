// src/vault/claudeContextTag.test.ts — Restating the context window a resumed
// Claude session ran under (260825-resume-drops-1m-context).

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyContextTag, contextTagOf, readClaudeContextTag } from "./claudeContextTag";
import { build, buildResumeCommandString } from "./LaunchBuilder";
import type { VaultSessionEntry } from "./types";
import { VaultLauncher } from "./VaultLauncher";
import type { VaultService } from "./VaultService";

const roots: string[] = [];

async function configRoot(settings?: Record<string, unknown>, name = "settings.json"): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "at-ctx-tag-"));
  roots.push(dir);
  if (settings) {
    await fs.writeFile(path.join(dir, name), JSON.stringify(settings));
  }
  return dir;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function entry(over: Partial<VaultSessionEntry> = {}): VaultSessionEntry {
  return {
    id: "claude:sess-1",
    agent: "claude",
    sessionId: "sess-1",
    title: "t",
    cwd: "/Users/me/proj",
    modified: 1,
    flags: {},
    canFork: false,
    ...over,
  };
}

function stubService(target: VaultSessionEntry): VaultService {
  return {
    getLaunchTarget: async (id: string) => (id === target.id ? { entry: target, verify: async () => true } : undefined),
    getEntry: async (id: string) => (id === target.id ? target : undefined),
  } as unknown as VaultService;
}

describe("contextTagOf / applyContextTag", () => {
  it("reads the trailing window tag off a model id", () => {
    expect(contextTagOf("opus[1m]")).toBe("[1m]");
    expect(contextTagOf("claude-opus-5")).toBeUndefined();
  });

  it("appends a tag, and leaves a model that already names its window alone", () => {
    expect(applyContextTag("claude-opus-5", "[1m]")).toBe("claude-opus-5[1m]");
    expect(applyContextTag("claude-opus-5[1m]", "[1m]")).toBe("claude-opus-5[1m]");
    expect(applyContextTag("claude-opus-5", undefined)).toBe("claude-opus-5");
  });
});

describe("readClaudeContextTag", () => {
  it("takes the tag from the configured default model", async () => {
    const dir = await configRoot({ model: "opus[1m]" });
    await expect(readClaudeContextTag({ configDir: dir })).resolves.toBe("[1m]");
  });

  // The config root has no settings.local.json scope — only a project does.
  it("ignores a settings.local.json sitting in the config root", async () => {
    const dir = await configRoot({ model: "opus[1m]" });
    await fs.writeFile(path.join(dir, "settings.local.json"), JSON.stringify({ model: "sonnet" }));
    await expect(readClaudeContextTag({ configDir: dir })).resolves.toBe("[1m]");
  });

  it("ANTHROPIC_MODEL outranks every settings file", async () => {
    const dir = await configRoot({ model: "opus[1m]" });
    await expect(readClaudeContextTag({ configDir: dir, envModel: "sonnet" })).resolves.toBeUndefined();
    await expect(readClaudeContextTag({ configDir: dir, envModel: "sonnet[1m]" })).resolves.toBe("[1m]");
  });

  it("reads <home>/.claude when no config dir is given", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "at-ctx-home-"));
    roots.push(home);
    await fs.mkdir(path.join(home, ".claude"));
    await fs.writeFile(path.join(home, ".claude", "settings.json"), JSON.stringify({ model: "opus[1m]" }));
    await expect(readClaudeContextTag({ home })).resolves.toBe("[1m]");
  });

  it("reads no root at all when the caller supplies neither — never the real machine's home", async () => {
    await expect(readClaudeContextTag({})).resolves.toBeUndefined();
  });

  it("an untagged, absent, or malformed setting yields no tag", async () => {
    await expect(readClaudeContextTag({ configDir: await configRoot({ model: "opus" }) })).resolves.toBeUndefined();
    await expect(readClaudeContextTag({ configDir: await configRoot() })).resolves.toBeUndefined();
    const broken = await configRoot();
    await fs.writeFile(path.join(broken, "settings.json"), "{not json");
    await expect(readClaudeContextTag({ configDir: broken })).resolves.toBeUndefined();
  });
});

describe("readClaudeContextTag: project scope outranks the config root", () => {
  async function projectRoot(settings: Record<string, unknown>, name = "settings.json"): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "at-ctx-proj-"));
    roots.push(dir);
    await fs.mkdir(path.join(dir, ".claude"));
    await fs.writeFile(path.join(dir, ".claude", name), JSON.stringify(settings));
    return dir;
  }

  it("a project model wins over the user-level one", async () => {
    const cwd = await projectRoot({ model: "opus[1m]" });
    const dir = await configRoot({ model: "sonnet" });
    await expect(readClaudeContextTag({ configDir: dir, cwd })).resolves.toBe("[1m]");
  });

  // The narrower project pin is what the CLI would run, so the resume must not
  // widen the session back to 1M off the user-level default.
  it("an untagged project model suppresses a tagged user default", async () => {
    const cwd = await projectRoot({ model: "sonnet" });
    const dir = await configRoot({ model: "opus[1m]" });
    await expect(readClaudeContextTag({ configDir: dir, cwd })).resolves.toBeUndefined();
  });

  it("project settings.local.json wins over the shared project file", async () => {
    const cwd = await projectRoot({ model: "sonnet" });
    await fs.writeFile(path.join(cwd, ".claude", "settings.local.json"), JSON.stringify({ model: "opus[1m]" }));
    await expect(readClaudeContextTag({ cwd })).resolves.toBe("[1m]");
  });

  it("finds the project root from a subdirectory", async () => {
    const root = await projectRoot({ model: "opus[1m]" });
    const nested = path.join(root, "packages", "app", "src");
    await fs.mkdir(nested, { recursive: true });
    await expect(readClaudeContextTag({ cwd: nested })).resolves.toBe("[1m]");
  });

  it("a project file that omits model falls through to the config root", async () => {
    const cwd = await projectRoot({ permissions: {} });
    const dir = await configRoot({ model: "opus[1m]" });
    await expect(readClaudeContextTag({ configDir: dir, cwd })).resolves.toBe("[1m]");
  });

  it("never mistakes the user config root for a project root while walking up", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "at-ctx-home-"));
    roots.push(home);
    await fs.mkdir(path.join(home, ".claude"));
    // Not a scope Claude reads at this level — the walk must skip it, not adopt it.
    await fs.writeFile(path.join(home, ".claude", "settings.local.json"), JSON.stringify({ model: "sonnet[1m]" }));
    await fs.writeFile(path.join(home, ".claude", "settings.json"), JSON.stringify({ model: "opus" }));
    const cwd = path.join(home, "proj");
    await fs.mkdir(cwd);
    await expect(readClaudeContextTag({ home, cwd })).resolves.toBeUndefined();
  });
});

describe("resume restates the context window", () => {
  // Claude records only the canonical id: a session run as `opus[1m]` writes
  // `claude-opus-5`. Without this the resumed session silently drops to 200k.
  it("tags the resumed model with the reader's configured window", async () => {
    const configDir = await configRoot({ model: "opus[1m]" });
    const target = entry({ flags: { model: "claude-opus-5", configDir } });
    const opts = await new VaultLauncher(stubService(target), {}).resolve("claude:sess-1", "resume");
    expect(opts.shellArgs).toEqual(["--resume", "sess-1", "--model", "claude-opus-5[1m]"]);
  });

  it("falls back to the host CLAUDE_CONFIG_DIR when the entry captured none", async () => {
    const configDir = await configRoot({ model: "opus[1m]" });
    const target = entry({ flags: { model: "claude-opus-5" } });
    const opts = await new VaultLauncher(stubService(target), { CLAUDE_CONFIG_DIR: configDir }).resolve(
      "claude:sess-1",
      "resume",
    );
    expect(opts.shellArgs).toEqual(["--resume", "sess-1", "--model", "claude-opus-5[1m]"]);
  });

  it("the copied resume command carries the same window as the launch", async () => {
    const configDir = await configRoot({ model: "opus[1m]" });
    const target = entry({ flags: { model: "claude-opus-5", configDir } });
    await expect(new VaultLauncher(stubService(target), {}).buildResumeCommand("claude:sess-1")).resolves.toBe(
      "claude --resume sess-1 --model 'claude-opus-5[1m]'",
    );
  });

  it("leaves the model untouched when the reader configured no window", async () => {
    const configDir = await configRoot({ model: "opus" });
    const target = entry({ flags: { model: "claude-opus-5", configDir } });
    const opts = await new VaultLauncher(stubService(target), {}).resolve("claude:sess-1", "resume");
    expect(opts.shellArgs).toEqual(["--resume", "sess-1", "--model", "claude-opus-5"]);
  });

  it("does not push a Claude window tag onto another agent's model", async () => {
    const configDir = await configRoot({ model: "opus[1m]" });
    const target = entry({
      id: "codex:t1",
      agent: "codex",
      sessionId: "t1",
      flags: { model: "gpt-5", configDir },
    });
    const opts = await new VaultLauncher(stubService(target), {}).resolve("codex:t1", "resume");
    expect(opts.shellArgs).toEqual(["resume", "t1", "-m", "gpt-5"]);
  });

  it("a session with no captured model stays unpinned — the CLI applies its own default", async () => {
    const configDir = await configRoot({ model: "opus[1m]" });
    const spec = build(entry({ flags: { configDir } }), "resume", {}, undefined, undefined, undefined, "[1m]");
    expect(spec.args).toEqual(["--resume", "sess-1"]);
  });

  it("the host ANTHROPIC_MODEL decides the window, over the settings file", async () => {
    const configDir = await configRoot({ model: "opus[1m]" });
    const target = entry({ flags: { model: "claude-opus-5", configDir } });
    const opts = await new VaultLauncher(stubService(target), { ANTHROPIC_MODEL: "opus" }).resolve(
      "claude:sess-1",
      "resume",
    );
    expect(opts.shellArgs).toEqual(["--resume", "sess-1", "--model", "claude-opus-5"]);
  });

  it("Claude-to-Claude continue carries the window onto the seeded session", async () => {
    const configDir = await configRoot({ model: "opus[1m]" });
    const target = entry({ flags: { model: "claude-opus-5", configDir } });
    const opts = await new VaultLauncher(stubService(target), {}).resolve("claude:sess-1", "continue", "carry on");
    expect(opts.shellArgs).toEqual(["--model", "claude-opus-5[1m]", "carry on"]);
  });

  // Continuing into a different agent clears the source's flags, so there is no
  // model to tag and no Claude window to leak onto another CLI.
  it("continue into another agent stays unpinned", async () => {
    const configDir = await configRoot({ model: "opus[1m]" });
    const target = entry({ flags: { model: "claude-opus-5", configDir } });
    const opts = await new VaultLauncher(stubService(target), {}).resolve("claude:sess-1", "continue", "carry on", {
      agent: "codex",
    });
    expect(opts.shellArgs).not.toContain("-m");
    expect(opts.shellArgs.some((a) => a.includes("[1m]"))).toBe(false);
  });

  it("without a host env, no config root is read", async () => {
    await configRoot({ model: "opus[1m]" });
    await expect(buildResumeCommandString(entry({ flags: { model: "claude-opus-5" } }))).resolves.toBe(
      "claude --resume sess-1 --model claude-opus-5",
    );
  });
});
