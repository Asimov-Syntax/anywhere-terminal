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
  await fs.mkdir(sessionsDir, { recursive: true });
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
    roots: { codexSessionsDir: sessionsDir },
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

    it("refuses a codex rollout outside the sessions dir", async () => {
      const outside = path.join(dir, "elsewhere.jsonl");
      await fs.writeFile(outside, `${codexEvent("should not be read")}\n`);
      const svc = service({ "codex:s1": { ...CODEX, sessionPath: outside } });
      expect(await svc.preview("codex:s1")).toBeUndefined();
      expect(reads).toEqual([]);
    });

    it("answers a codex session with no rollout at all", async () => {
      const svc = service({ "codex:s1": CODEX });
      expect(await svc.preview("codex:s1")).toBeUndefined();
      expect(reads).toEqual([]);
    });
  });

  it("keeps a preview when the transcript disappears rather than failing", async () => {
    const svc = service({ "codex:s1": { ...CODEX, sessionPath: rollout } });
    await svc.preview("codex:s1");
    await fs.rm(rollout);
    clock += 5000;
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
