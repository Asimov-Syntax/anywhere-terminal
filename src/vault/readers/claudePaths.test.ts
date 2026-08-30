// src/vault/readers/claudePaths.test.ts — the three id→path resolvers, tested
// directly rather than through the detail pipeline that usually exercises them.
//
// What is worth testing here is one thing: a candidate is judged by where it
// RESOLVES, not by how it is spelled. A symlink inside the projects root that
// points out of it satisfies every string comparison, and each of these three
// resolvers hands its answer straight to a read.

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every `realpath` the resolvers ask for, in order. The real implementation is
 * kept — these tests need a real filesystem — and only counted through, because
 * D8's claim is about how MANY times the root is resolved, not what it answers.
 */
const realpathCalls: string[] = [];
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    default: actual,
    realpath: (p: Parameters<typeof actual.realpath>[0], ...rest: unknown[]) => {
      realpathCalls.push(String(p));
      return (actual.realpath as (...a: unknown[]) => unknown)(p, ...rest);
    },
  };
});

import { resolveClaudeSessionPath, resolveClaudeSubagentPath, resolveClaudeWorkflowAgentPath } from "./claudePaths";

const SESSION = "11111111-2222-3333-4444-555555555555";

describe("claudePaths resolvers", () => {
  let tmp: string;
  let configDir: string;
  let projectsDir: string;
  let outside: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "claude-paths-"));
    configDir = path.join(tmp, "config");
    projectsDir = path.join(configDir, "projects");
    outside = path.join(tmp, "outside");
    await fs.mkdir(path.join(projectsDir, "-repo"), { recursive: true });
    await fs.mkdir(outside, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  const options = () => ({ configDir });

  describe("resolveClaudeSessionPath", () => {
    it("finds a transcript genuinely inside the projects root", async () => {
      const real = path.join(projectsDir, "-repo", `${SESSION}.jsonl`);
      await fs.writeFile(real, "{}\n");
      expect(await resolveClaudeSessionPath(SESSION, options())).toBe(real);
    });

    it("refuses one that reaches outside the root through a link", async () => {
      const escapeTarget = path.join(outside, "stolen.jsonl");
      await fs.writeFile(escapeTarget, "{}\n");
      await fs.symlink(escapeTarget, path.join(projectsDir, "-repo", `${SESSION}.jsonl`));
      expect(await resolveClaudeSessionPath(SESSION, options())).toBeNull();
    });

    it("still finds a transcript when the projects root itself is behind a link", async () => {
      // The common healthy arrangement — a vault kept on another volume. Only
      // resolving BOTH sides keeps this working.
      const realStore = path.join(tmp, "volume", "projects");
      await fs.mkdir(path.join(realStore, "-repo"), { recursive: true });
      const real = path.join(realStore, "-repo", `${SESSION}.jsonl`);
      await fs.writeFile(real, "{}\n");
      const linkedConfig = path.join(tmp, "linked-config");
      await fs.mkdir(linkedConfig);
      await fs.symlink(realStore, path.join(linkedConfig, "projects"));

      const found = await resolveClaudeSessionPath(SESSION, { configDir: linkedConfig });
      expect(found).toBe(path.join(linkedConfig, "projects", "-repo", `${SESSION}.jsonl`));
    });
  });

  describe("resolveClaudeSubagentPath", () => {
    const stem = "66666666-7777-8888-9999-000000000000";

    it("finds a subagent transcript inside the root", async () => {
      const dir = path.join(projectsDir, "-repo", SESSION, "subagents");
      await fs.mkdir(dir, { recursive: true });
      const real = path.join(dir, `${stem}.jsonl`);
      await fs.writeFile(real, "{}\n");
      expect(await resolveClaudeSubagentPath(SESSION, stem, options())).toBe(real);
    });

    it("refuses one whose link escapes the root", async () => {
      const dir = path.join(projectsDir, "-repo", SESSION, "subagents");
      await fs.mkdir(dir, { recursive: true });
      const escapeTarget = path.join(outside, "stolen.jsonl");
      await fs.writeFile(escapeTarget, "{}\n");
      await fs.symlink(escapeTarget, path.join(dir, `${stem}.jsonl`));
      expect(await resolveClaudeSubagentPath(SESSION, stem, options())).toBeNull();
    });

    it("still finds one when the projects root itself is behind a link", async () => {
      // The nested join builds a deeper candidate than the session resolver's,
      // so the session resolver's success case does not cover this one.
      const realStore = path.join(tmp, "volume", "projects");
      const dir = path.join(realStore, "-repo", SESSION, "subagents");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, `${stem}.jsonl`), "{}\n");
      const linkedConfig = path.join(tmp, "linked-config");
      await fs.mkdir(linkedConfig);
      await fs.symlink(realStore, path.join(linkedConfig, "projects"));

      const found = await resolveClaudeSubagentPath(SESSION, stem, { configDir: linkedConfig });
      expect(found).toBe(path.join(linkedConfig, "projects", "-repo", SESSION, "subagents", `${stem}.jsonl`));
    });
  });

  describe("resolveClaudeWorkflowAgentPath", () => {
    const wfId = "wf_abc123";
    const stem = "agent-01";

    it("finds a workflow agent transcript inside the root", async () => {
      await fs.writeFile(path.join(projectsDir, "-repo", `${SESSION}.jsonl`), "{}\n");
      const dir = path.join(projectsDir, "-repo", SESSION, "subagents", "workflows", wfId);
      await fs.mkdir(dir, { recursive: true });
      const real = path.join(dir, `${stem}.jsonl`);
      await fs.writeFile(real, "{}\n");
      expect(await resolveClaudeWorkflowAgentPath(SESSION, wfId, stem, options())).toBe(real);
    });

    it("refuses one whose link escapes the root", async () => {
      await fs.writeFile(path.join(projectsDir, "-repo", `${SESSION}.jsonl`), "{}\n");
      const dir = path.join(projectsDir, "-repo", SESSION, "subagents", "workflows", wfId);
      await fs.mkdir(dir, { recursive: true });
      const escapeTarget = path.join(outside, "stolen.jsonl");
      await fs.writeFile(escapeTarget, "{}\n");
      await fs.symlink(escapeTarget, path.join(dir, `${stem}.jsonl`));
      expect(await resolveClaudeWorkflowAgentPath(SESSION, wfId, stem, options())).toBeNull();
    });

    it("still finds one when the projects root itself is behind a link", async () => {
      // This resolver derives its candidate from an ALREADY-resolved parent
      // path, so it is the branch most likely to double-resolve and refuse a
      // healthy store. Its own success case is the only thing that says it does not.
      const realStore = path.join(tmp, "volume", "projects");
      await fs.mkdir(path.join(realStore, "-repo"), { recursive: true });
      await fs.writeFile(path.join(realStore, "-repo", `${SESSION}.jsonl`), "{}\n");
      const dir = path.join(realStore, "-repo", SESSION, "subagents", "workflows", wfId);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, `${stem}.jsonl`), "{}\n");
      const linkedConfig = path.join(tmp, "linked-config");
      await fs.mkdir(linkedConfig);
      await fs.symlink(realStore, path.join(linkedConfig, "projects"));

      const found = await resolveClaudeWorkflowAgentPath(SESSION, wfId, stem, { configDir: linkedConfig });
      expect(found).not.toBeNull();
      expect(path.basename(found as string)).toBe(`${stem}.jsonl`);
    });
  });

  describe("the root is resolved once per scan", () => {
    it("does not re-resolve the projects root per project directory", async () => {
      // The scan visits every project dir looking for one session id. Resolving
      // the root inside that loop is a syscall per directory for an answer that
      // cannot change within the scan (design.md D8).
      for (const name of ["-a", "-b", "-c", "-d"]) {
        await fs.mkdir(path.join(projectsDir, name), { recursive: true });
      }
      await fs.writeFile(path.join(projectsDir, "-d", `${SESSION}.jsonl`), "{}\n");

      realpathCalls.length = 0;
      expect(await resolveClaudeSessionPath(SESSION, options())).toBeTruthy();
      expect(realpathCalls.filter((p) => p === projectsDir)).toHaveLength(1);
    });
  });
});
