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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  });
});
