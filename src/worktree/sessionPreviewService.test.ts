// src/worktree/sessionPreviewService.test.ts — when a transcript is worth opening
// (source-the-agent-row-preview 1_2).
//
// Verified here rather than through the projector on purpose: "an unchanged
// transcript was not opened" is a claim about the filesystem, and a mocked dep
// cannot make it. Every case below runs against a real temporary rollout and
// counts the real reads and real stats that reach it.

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readLastActivityLine } from "../vault/readers/lastActivity";
import { createSessionPreviewService, type PreviewEntry } from "./sessionPreviewService";

let dir: string;
let sessionsDir: string;
let projectsDir: string;
let rollout: string;
let reads: string[];
let stats: string[];
let clock: number;

const codexEvent = (message: string): string =>
  JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message } });

async function writeRollout(message: string): Promise<void> {
  await fs.writeFile(rollout, `${codexEvent(message)}\n`);
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "at-preview-svc-"));
  sessionsDir = path.join(dir, "sessions");
  projectsDir = path.join(dir, "projects");
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.mkdir(projectsDir, { recursive: true });
  rollout = path.join(sessionsDir, "rollout-s1.jsonl");
  await writeRollout("the first answer");
  reads = [];
  stats = [];
  clock = 1_000_000;
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const CODEX: PreviewEntry = { agent: "codex", sessionId: "s1" };

/** The real reader and a real `stat`, counted on the way through. */
function service(entries: Record<string, PreviewEntry>, over: { recheckMs?: number; cap?: number } = {}) {
  return createSessionPreviewService({
    entry: async (entryId) => entries[entryId] ?? null,
    read: async (file, format) => {
      reads.push(file);
      return readLastActivityLine(file, format);
    },
    stat: async (file) => {
      stats.push(file);
      try {
        const s = await fs.stat(file);
        return { mtimeMs: s.mtimeMs, size: s.size };
      } catch {
        return null;
      }
    },
    roots: { codexSessionsDir: sessionsDir, claudeProjectsDir: projectsDir },
    now: () => clock,
    recheckMs: over.recheckMs ?? 2000,
    ...(over.cap === undefined ? {} : { cap: over.cap }),
  });
}

/** Move the file on, guaranteeing a different stamp than a coarse mtime alone. */
async function rewrite(message: string, at: number): Promise<void> {
  await writeRollout(message);
  await fs.utimes(rollout, new Date(at), new Date(at));
}

describe("createSessionPreviewService", () => {
  it("reads the transcript once on the first ask", async () => {
    const svc = service({ "codex:s1": { ...CODEX, sessionPath: rollout } });
    expect(await svc.preview("codex:s1")).toBe("the first answer");
    expect(reads).toEqual([rollout]);
    expect(stats).toEqual([rollout]);
  });

  it("makes no syscall at all for a second ask inside the re-check interval", async () => {
    const svc = service({ "codex:s1": { ...CODEX, sessionPath: rollout } });
    await svc.preview("codex:s1");
    reads = [];
    stats = [];
    clock += 1999;
    expect(await svc.preview("codex:s1")).toBe("the first answer");
    expect(stats).toEqual([]);
    expect(reads).toEqual([]);
  });

  it("stats but does not open a transcript whose stamp has not moved", async () => {
    const svc = service({ "codex:s1": { ...CODEX, sessionPath: rollout } });
    await svc.preview("codex:s1");
    reads = [];
    stats = [];
    clock += 5000;
    expect(await svc.preview("codex:s1")).toBe("the first answer");
    expect(stats).toEqual([rollout]);
    expect(reads).toEqual([]);
  });

  it("reads exactly once when the stamp has moved", async () => {
    const svc = service({ "codex:s1": { ...CODEX, sessionPath: rollout } });
    await svc.preview("codex:s1");
    reads = [];
    await rewrite("the second answer", 2_000_000_000_000);
    clock += 5000;
    expect(await svc.preview("codex:s1")).toBe("the second answer");
    expect(reads).toEqual([rollout]);
  });

  it("counts a size-only change as moved", async () => {
    // A coarse mtime can hide two writes in one tick, which is why the stamp is
    // the pair and not the timestamp alone. Both writes are pinned to one mtime.
    const FIXED = new Date(1_800_000_000_000);
    await fs.utimes(rollout, FIXED, FIXED);
    const svc = service({ "codex:s1": { ...CODEX, sessionPath: rollout } });
    await svc.preview("codex:s1");
    await writeRollout("a noticeably longer second answer");
    await fs.utimes(rollout, FIXED, FIXED);
    reads = [];
    clock += 5000;
    expect(await svc.preview("codex:s1")).toBe("a noticeably longer second answer");
    expect(reads).toEqual([rollout]);
  });

  it("counts an mtime-only change as moved", async () => {
    const svc = service({ "codex:s1": { ...CODEX, sessionPath: rollout } });
    await svc.preview("codex:s1");
    const size = (await fs.stat(rollout)).size;
    await writeRollout("the second answe"); // same length, so only the mtime moves
    expect((await fs.stat(rollout)).size).toBe(size);
    const later = new Date(2_000_000_000_000);
    await fs.utimes(rollout, later, later);
    reads = [];
    clock += 5000;
    expect(await svc.preview("codex:s1")).toBe("the second answe");
    expect(reads).toEqual([rollout]);
  });

  it("shares one read between concurrent asks for the same session", async () => {
    const svc = service({ "codex:s1": { ...CODEX, sessionPath: rollout } });
    const [a, b, c] = await Promise.all([svc.preview("codex:s1"), svc.preview("codex:s1"), svc.preview("codex:s1")]);
    expect([a, b, c]).toEqual(["the first answer", "the first answer", "the first answer"]);
    expect(reads).toEqual([rollout]);
    expect(stats).toEqual([rollout]);
  });

  describe("sources it does not cover", () => {
    it("answers an opencode session without touching the filesystem", async () => {
      const svc = service({ "opencode:s1": { agent: "opencode", sessionId: "s1", sessionPath: rollout } });
      expect(await svc.preview("opencode:s1")).toBeUndefined();
      expect(stats).toEqual([]);
      expect(reads).toEqual([]);
    });

    it("answers a cursor session without touching the filesystem", async () => {
      const svc = service({ "cursor:s1": { agent: "cursor", sessionId: "s1" } });
      expect(await svc.preview("cursor:s1")).toBeUndefined();
      expect(stats).toEqual([]);
      expect(reads).toEqual([]);
    });

    it("answers an unknown entry without touching the filesystem", async () => {
      const svc = service({});
      expect(await svc.preview("codex:missing")).toBeUndefined();
      expect(stats).toEqual([]);
    });

    it("never opens a codex rollout outside the sessions dir", async () => {
      const outside = path.join(dir, "elsewhere.jsonl");
      await fs.writeFile(outside, `${codexEvent("should not be read")}\n`);
      const svc = service({ "codex:gone": { agent: "codex", sessionId: "gone", sessionPath: outside } });
      expect(await svc.preview("codex:gone")).toBeUndefined();
      expect(reads).toEqual([]);
    });

    it("answers a codex session with no rollout at all", async () => {
      const svc = service({ "codex:gone": { agent: "codex", sessionId: "gone" } });
      expect(await svc.preview("codex:gone")).toBeUndefined();
      expect(reads).toEqual([]);
    });

    it("never opens a claude transcript outside the projects dir", async () => {
      const outside = path.join(dir, "loose.jsonl");
      await fs.writeFile(outside, "{}\n");
      const svc = service({ "claude:c1": { agent: "claude", sessionId: "c1", sessionPath: outside } });
      expect(await svc.preview("claude:c1")).toBeUndefined();
      expect(reads).toEqual([]);
    });
  });

  describe("resolution is a moment, not a verdict", () => {
    it("finds a codex rollout the index did not name, by the repo's own fallback", async () => {
      // `rollout_path` is unreliable — `pickRolloutPath` scans by filename when the
      // index path is stale, and the service must inherit that half too (W2).
      const stale = path.join(dir, "stale.jsonl");
      const svc = service({ "codex:s1": { ...CODEX, sessionPath: stale } });
      expect(await svc.preview("codex:s1")).toBe("the first answer");
      expect(reads).toEqual([rollout]);
    });

    it("previews a session whose transcript only appears later", async () => {
      const svc = service({ "codex:late": { agent: "codex", sessionId: "late" } });
      expect(await svc.preview("codex:late")).toBeUndefined();

      const later = path.join(sessionsDir, "rollout-late.jsonl");
      await fs.writeFile(later, `${codexEvent("it finally spoke")}\n`);
      clock += 5000;

      expect(await svc.preview("codex:late")).toBe("it finally spoke");
    });

    it("re-resolves a transcript that moved instead of pinning the old path", async () => {
      const svc = service({ "codex:s1": { ...CODEX, sessionPath: rollout } });
      await svc.preview("codex:s1");

      const moved = path.join(sessionsDir, "nested", "rollout-s1.jsonl");
      await fs.mkdir(path.dirname(moved), { recursive: true });
      await fs.rename(rollout, moved);
      clock += 5000;

      expect(await svc.preview("codex:s1")).toBe("the first answer");
      expect(reads).toEqual([rollout, moved]);
    });

    it("keeps costing nothing for an uncovered source however often it is asked", async () => {
      const svc = service({ "opencode:s1": { agent: "opencode", sessionId: "s1", sessionPath: rollout } });
      for (let i = 0; i < 3; i++) {
        expect(await svc.preview("opencode:s1")).toBeUndefined();
        clock += 5000;
      }
      expect(stats).toEqual([]);
      expect(reads).toEqual([]);
    });
  });

  it("drops the preview when the transcript is gone", async () => {
    // The spec says a transcript the reader cannot read carries no preview at
    // all, so bounded message text must not outlive its file (round-1 W1).
    const svc = service({ "codex:s1": { ...CODEX, sessionPath: rollout } });
    await svc.preview("codex:s1");
    await fs.rm(rollout);
    clock += 5000;
    expect(await svc.preview("codex:s1")).toBeUndefined();
  });

  it("retries on the next ask rather than waiting out an interval it never used", async () => {
    let fail = true;
    const svc = createSessionPreviewService({
      entry: async () => {
        if (fail) {
          throw new Error("vault unavailable");
        }
        return { agent: "codex", sessionId: "s1", sessionPath: rollout };
      },
      roots: { codexSessionsDir: sessionsDir, claudeProjectsDir: projectsDir },
      now: () => clock,
      recheckMs: 2000,
    });
    expect(await svc.preview("codex:s1")).toBeUndefined();
    fail = false;
    expect(await svc.preview("codex:s1")).toBe("the first answer");
  });

  it("bounds what it holds instead of growing with every session seen", async () => {
    const entries: Record<string, PreviewEntry> = {};
    for (let i = 0; i < 6; i++) {
      const file = path.join(sessionsDir, `rollout-n${i}.jsonl`);
      await fs.writeFile(file, `${codexEvent(`answer ${i}`)}\n`);
      entries[`codex:n${i}`] = { agent: "codex", sessionId: `n${i}`, sessionPath: file };
    }
    const svc = service(entries, { cap: 2 });
    for (let i = 0; i < 6; i++) {
      await svc.preview(`codex:n${i}`);
    }
    reads = [];
    // n0 was evicted long ago, so it costs a fresh read; n5 is still held and,
    // inside the interval, costs nothing.
    await svc.preview("codex:n0");
    await svc.preview("codex:n5");
    expect(reads).toEqual([path.join(sessionsDir, "rollout-n0.jsonl")]);
  });
});
