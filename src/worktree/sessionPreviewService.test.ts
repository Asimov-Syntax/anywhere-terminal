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

const claudeAssistant = (text: string): string =>
  JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } });
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

  describe("a hint is judged where it resolves", () => {
    it("leaves the row unresolved when the hint escapes the projects root through a link", async () => {
      // Lexically inside; resolves out. The row must stay retryable rather than
      // being recorded as uncovered — the store may be repaired underneath it.
      const outside = path.join(dir, "stolen.jsonl");
      await fs.writeFile(outside, `${claudeAssistant("not yours")}\n`);
      const hint = path.join(projectsDir, "-repo", "escape.jsonl");
      await fs.mkdir(path.join(projectsDir, "-repo"), { recursive: true });
      await fs.symlink(outside, hint);

      const svc = service({ "claude:c1": { agent: "claude", sessionId: "c1", sessionPath: hint } });
      expect(await svc.preview("claude:c1")).toBeUndefined();
      expect(reads).toEqual([]);
    });

    it("still previews a hint under a projects root that is itself a link", async () => {
      const realProjects = path.join(dir, "volume-projects", "-repo");
      await fs.mkdir(realProjects, { recursive: true });
      const transcript = path.join(realProjects, "c2.jsonl");
      await fs.writeFile(transcript, `${claudeAssistant("across the volume")}\n`);
      const linkedProjects = path.join(dir, "linked-projects");
      await fs.symlink(path.join(dir, "volume-projects"), linkedProjects);

      const svc = createSessionPreviewService({
        entry: async () => ({
          agent: "claude",
          sessionId: "c2",
          sessionPath: path.join(linkedProjects, "-repo", "c2.jsonl"),
        }),
        read: async (file, format) => readLastActivityLine(file, format),
        stat: async (file) => {
          const s = await fs.stat(file);
          return { mtimeMs: s.mtimeMs, size: s.size };
        },
        roots: { codexSessionsDir: sessionsDir, claudeProjectsDir: linkedProjects },
        now: () => clock,
        recheckMs: 2000,
      });
      expect(await svc.preview("claude:c2")).toBe("across the volume");
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

    it("backs an unresolvable row off instead of scanning every interval", async () => {
      // Resolving a Codex session with no rollout walks the whole sessions tree.
      // On the freshness cadence that recurs at 0.5 Hz forever for one row
      // (round-2 B1-R2), so consecutive failures have to decay.
      let resolutions = 0;
      const svc = createSessionPreviewService({
        entry: async () => {
          resolutions += 1;
          return { agent: "codex", sessionId: "never", sessionPath: undefined };
        },
        roots: { codexSessionsDir: sessionsDir, claudeProjectsDir: projectsDir },
        now: () => clock,
        recheckMs: 2000,
      });

      // Ten intervals of a row that never resolves.
      for (let i = 0; i < 10; i++) {
        expect(await svc.preview("codex:never")).toBeUndefined();
        clock += 2000;
      }

      // Ungated this is one scan per interval; backed off it is a handful.
      expect(resolutions).toBeLessThan(5);
    });

    it("puts an entry back on the freshness cadence once it resolves", async () => {
      const svc = service({ "codex:late": { agent: "codex", sessionId: "late" } });
      for (let i = 0; i < 3; i++) {
        await svc.preview("codex:late");
        clock += 60_000; // past any backoff, so the next look really runs
      }

      const later = path.join(sessionsDir, "rollout-late.jsonl");
      await fs.writeFile(later, `${codexEvent("it finally spoke")}\n`);
      expect(await svc.preview("codex:late")).toBe("it finally spoke");

      // Back on the ordinary interval: still gated at 1999 ms, looking at 2001.
      stats = [];
      clock += 1999;
      await svc.preview("codex:late");
      expect(stats).toEqual([]);
      clock += 2;
      await svc.preview("codex:late");
      expect(stats).toEqual([later]);
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

  it("asks the vault nothing when a healthy row is merely re-checked", async () => {
    // `deps.entry()` routes to the provider's own entry reader, whose no-SQLite
    // branch walks the whole sessions tree. A row that only needs its stamp
    // re-checked must not pay for that (round-3 B1-R3).
    let lookups = 0;
    const svc = createSessionPreviewService({
      entry: async () => {
        lookups += 1;
        return { agent: "codex", sessionId: "s1", sessionPath: rollout };
      },
      stat: async (file) => {
        stats.push(file);
        const st = await fs.stat(file);
        return { mtimeMs: st.mtimeMs, size: st.size };
      },
      roots: { codexSessionsDir: sessionsDir, claudeProjectsDir: projectsDir },
      now: () => clock,
      recheckMs: 2000,
    });

    expect(await svc.preview("codex:s1")).toBe("the first answer");
    expect(lookups).toBe(1);

    for (let i = 0; i < 5; i++) {
      clock += 2001;
      await svc.preview("codex:s1");
    }
    expect(stats).toHaveLength(6); // still re-checked every interval
    expect(lookups).toBe(1); // but the vault was asked exactly once
  });

  it("goes back to the vault after losing a transcript rather than keeping a dead target", async () => {
    // What carries recovery is dropping the TARGET: `look`'s guard re-fetches the
    // entry whenever the target is not resolved. A failed recovery that left the
    // target resolved would strand the row on a path that no longer exists. The
    // paired `entry = undefined` is tidiness — reverting it alone fails nothing,
    // which is why this test does not claim to guard it (S2-R4).
    let lookups = 0;
    let sessionPath = rollout;
    const svc = createSessionPreviewService({
      entry: async () => {
        lookups += 1;
        return { agent: "claude", sessionId: "c1", sessionPath };
      },
      roots: { codexSessionsDir: sessionsDir, claudeProjectsDir: projectsDir },
      now: () => clock,
      recheckMs: 2000,
    });

    const first = path.join(projectsDir, "c1.jsonl");
    await fs.writeFile(first, `${claudeAssistant("said here")}\n`);
    sessionPath = first;
    expect(await svc.preview("claude:c1")).toBe("said here");
    expect(lookups).toBe(1);

    // The transcript moves and the vault will report the new path.
    const moved = path.join(projectsDir, "moved", "c1.jsonl");
    await fs.mkdir(path.dirname(moved), { recursive: true });
    await fs.rename(first, moved);
    sessionPath = moved;

    clock += 5000;
    expect(await svc.preview("claude:c1")).toBeUndefined(); // the held path is gone
    clock += 60_000;
    expect(await svc.preview("claude:c1")).toBe("said here"); // asked the vault again
    expect(lookups).toBeGreaterThan(1);
  });

  it("backs off a row whose lookup keeps returning nothing", async () => {
    // Not a guard for W1-R3: once B1-R3 cached the entry, a null lookup over a
    // stale resolved target became unreachable, so both the old and the new
    // predicate back this off. What it pins is that an entry the vault does not
    // know does not stay on the freshness cadence.
    let lookups = 0;
    const svc = createSessionPreviewService({
      entry: async () => {
        lookups += 1;
        return null;
      },
      roots: { codexSessionsDir: sessionsDir, claudeProjectsDir: projectsDir },
      now: () => clock,
      recheckMs: 2000,
    });

    for (let i = 0; i < 10; i++) {
      expect(await svc.preview("codex:s1")).toBeUndefined();
      clock += 2000;
    }
    expect(lookups).toBeLessThan(5);
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

  it("gates a rejecting lookup at the cadence like any other unproductive look", async () => {
    // A 250 ms floor re-examined a rejecting session eight times inside one
    // interval, against the spec's "at most once per interval" (round-3 W2-R3).
    let fail = true;
    let lookups = 0;
    const svc = createSessionPreviewService({
      entry: async () => {
        lookups += 1;
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
    clock += 1999;
    expect(await svc.preview("codex:s1")).toBeUndefined();
    expect(lookups).toBe(1);

    // And it decays from there rather than retrying every interval forever.
    for (let i = 0; i < 8; i++) {
      clock += 2001;
      await svc.preview("codex:s1");
    }
    expect(lookups).toBeLessThan(5);

    fail = false;
    clock += 600_000;
    expect(await svc.preview("codex:s1")).toBe("the first answer");
  });

  it("re-adopts an evicted session rather than reading it a second time", async () => {
    // Eviction used to hand the next ask a blank entry, which is how a stalled look
    // came to be started twice against the same path — once per cadence tick, for as
    // long as it stayed stalled. The row that was evicted must come back holding what
    // it already knew, and must not pay for a second read to learn it.
    let park: ((value: string | null) => void) | undefined;
    let parked: (() => void) | undefined;
    const atGate = new Promise<void>((resolve) => {
      parked = resolve;
    });
    let stall = false;
    const expiries: Array<() => void> = [];
    const other = path.join(sessionsDir, "rollout-other.jsonl");
    await fs.writeFile(other, `${codexEvent("another session")}\n`);

    const svc = createSessionPreviewService({
      entry: async (entryId) => ({ agent: "codex", sessionId: entryId.slice("codex:".length) }),
      read: async (file, format) => {
        reads.push(file);
        if (!stall || file !== rollout) {
          return readLastActivityLine(file, format);
        }
        return new Promise<string | null>((resolve) => {
          park = resolve;
          parked?.();
        });
      },
      stat: async (file) => {
        stats.push(file);
        try {
          const st = await fs.stat(file);
          return { mtimeMs: st.mtimeMs, size: st.size };
        } catch {
          return null;
        }
      },
      roots: { codexSessionsDir: sessionsDir, claudeProjectsDir: projectsDir },
      now: () => clock,
      recheckMs: 2000,
      cap: 1,
      wait: () => {
        const gate = new Promise<void>((resolve) => {
          expiries.push(resolve);
        });
        return gate;
      },
    });

    expect(await svc.preview("codex:s1")).toBe("the first answer");

    await rewrite("the second answer", 2_000_000_000_000);
    clock += 5000;
    stall = true;
    const stalled = svc.preview("codex:s1");
    await atGate;
    expiries.splice(0).forEach((fire) => {
      fire();
    });
    expect(await stalled).toBe("the first answer");

    await svc.preview("codex:other"); // cap 1 — evicts the abandoned s1 entry
    const before = reads.filter((file) => file === rollout).length;

    // s1 is gone from what the service retains, but its read is still open. The ask
    // is answered from the entry that owns it, and starts no second read.
    expect(await svc.preview("codex:s1")).toBe("the first answer");
    expect(reads.filter((file) => file === rollout).length).toBe(before);

    park?.("the second answer");
  });

  it("never has more reads outstanding than the sessions it retains", async () => {
    // The cap bounds memory on its own; this is the claim that it bounds work. Six
    // rows ask at once, every read parks, and the service must stop starting them.
    for (let i = 0; i < 6; i++) {
      await fs.writeFile(path.join(sessionsDir, `rollout-w${i}.jsonl`), `${codexEvent(`w${i}`)}\n`);
    }
    const svc = createSessionPreviewService({
      entry: async (entryId) => ({ agent: "codex", sessionId: entryId.slice("codex:".length) }),
      read: async (file) => {
        reads.push(file);
        return new Promise<string | null>(() => {});
      },
      stat: async (file) => {
        try {
          const st = await fs.stat(file);
          return { mtimeMs: st.mtimeMs, size: st.size };
        } catch {
          return null;
        }
      },
      roots: { codexSessionsDir: sessionsDir, claudeProjectsDir: projectsDir },
      now: () => clock,
      recheckMs: 2000,
      cap: 2,
      wait: () => new Promise<void>(() => {}),
    });

    for (let i = 0; i < 6; i++) {
      void svc.preview(`codex:w${i}`);
    }
    // Asserted as an equality, not a ceiling: a flush too short to start any read
    // would satisfy `<= 2` while proving nothing.
    for (let turn = 0; turn < 40; turn++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(reads.length).toBe(2);
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

describe("a look that outlives its deadline", () => {
  /** A deferred the test resolves by hand, so no case waits on a real timer. */
  function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  /**
   * Same shape as `service` above, plus the two seams the deadline needs: a `read`
   * the test can hold open, and a `wait` it can fire on demand. The read rather
   * than the stat, deliberately — releasing it settles the look on its own
   * continuation, so a test can assert on what the abandoned attempt did with
   * what it found rather than race an asynchronous re-resolve.
   */
  function stallable() {
    const expiries: Array<() => void> = [];
    let held: ((value: string | null) => void) | undefined;
    let stall = false;
    // Resolved the moment a read is actually parked. Nothing may expire or release
    // before that: `stat` is a real syscall, so a deadline fired on a fixed number
    // of microtasks would land while the look was still short of its read, leaving
    // no parked read to release and the late settlement this suite exists for
    // never happening at all.
    let reached = deferred<void>();
    return {
      parked: () => reached.promise,
      // Fires every deadline queued so far. A look that already answered leaves its
      // own gate behind, so firing only the oldest would trip that one instead.
      expire: () => {
        expiries.splice(0).forEach((fire) => {
          fire();
        });
      },
      hold: () => {
        stall = true;
      },
      /** Let the abandoned read finish, reporting `answer`, and settle its look. */
      release: async (answer: string | null) => {
        await reached.promise;
        const target = held;
        held = undefined;
        stall = false;
        reached = deferred<void>();
        target?.(answer);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      },
      svc: createSessionPreviewService({
        entry: async (entryId) => (entryId === "codex:s1" ? CODEX : null),
        read: async (file, format) => {
          reads.push(file);
          if (!stall) {
            return readLastActivityLine(file, format);
          }
          const gate = deferred<string | null>();
          held = gate.resolve;
          reached.resolve();
          return gate.promise;
        },
        stat: async (file) => {
          stats.push(file);
          try {
            const st = await fs.stat(file);
            return { mtimeMs: st.mtimeMs, size: st.size };
          } catch {
            return null;
          }
        },
        roots: { codexSessionsDir: sessionsDir, claudeProjectsDir: projectsDir },
        now: () => clock,
        recheckMs: 2000,
        wait: () => {
          const gate = deferred<void>();
          expiries.push(gate.resolve);
          return gate.promise;
        },
      }),
    };
  }

  /** A look that stalls on the read, expires, and hands the row its old line back. */
  async function stallPastDeadline(harness: ReturnType<typeof stallable>): Promise<string | undefined> {
    await rewrite("the second answer", 2_000_000_000_000);
    clock += 5000;
    harness.hold();
    const stalled = harness.svc.preview("codex:s1");
    await harness.parked();
    harness.expire();
    return stalled;
  }

  it("answers with the line it last read instead of waiting on the filesystem", async () => {
    const harness = stallable();
    expect(await harness.svc.preview("codex:s1")).toBe("the first answer");

    expect(await stallPastDeadline(harness)).toBe("the first answer");
  });

  it("commits nothing an abandoned look goes on to find", async () => {
    const harness = stallable();
    expect(await harness.svc.preview("codex:s1")).toBe("the first answer");
    await stallPastDeadline(harness);

    // The abandoned read now completes, holding the newer line. It arrives for an
    // attempt the row has already stopped waiting on, so it establishes nothing —
    // neither this line nor the stamp that would make the next look skip its read.
    await harness.release("the second answer");

    expect(await harness.svc.preview("codex:s1")).toBe("the first answer");
  });

  it("does not let an abandoned look retire the line it was told to keep", async () => {
    const harness = stallable();
    expect(await harness.svc.preview("codex:s1")).toBe("the first answer");
    await stallPastDeadline(harness);

    // The same interleaving, ending the other way: the abandoned read finds nothing
    // readable. Committed, that blanks the very line the deadline promised to keep.
    await harness.release(null);

    expect(await harness.svc.preview("codex:s1")).toBe("the first answer");
  });

  it("scores one hung look once, not once per settlement", async () => {
    const harness = stallable();
    expect(await harness.svc.preview("codex:s1")).toBe("the first answer");
    await stallPastDeadline(harness);
    await harness.release("the second answer");

    // One miss: the next look is due at recheckMs * 2. Scoring the late settlement
    // as a second miss would push it to * 4 and this ask would find the gate shut.
    const before = stats.length;
    clock += 4001;
    await harness.svc.preview("codex:s1");

    expect(stats.length).toBeGreaterThan(before);
  });

  it("starts no second read into a session whose abandoned look is still out", async () => {
    const harness = stallable();
    expect(await harness.svc.preview("codex:s1")).toBe("the first answer");
    await stallPastDeadline(harness);

    // Far past the backoff, so the cadence gate is open and only the session's own
    // outstanding read is holding this ask back. Retrying into a stalled path is
    // what made the work unbounded; the row waits on the attempt it already has.
    const before = reads.length;
    clock += 100_000;

    expect(await harness.svc.preview("codex:s1")).toBe("the first answer");
    expect(reads.length).toBe(before);
  });

  it("still retires the line when the read fails outright rather than stalling", async () => {
    const svc = createSessionPreviewService({
      entry: async () => CODEX,
      read: async () => {
        throw new Error("unreadable");
      },
      stat: async (file) => {
        const st = await fs.stat(file);
        return { mtimeMs: st.mtimeMs, size: st.size };
      },
      roots: { codexSessionsDir: sessionsDir, claudeProjectsDir: projectsDir },
      now: () => clock,
      recheckMs: 2000,
    });

    expect(await svc.preview("codex:s1")).toBeUndefined();
  });
});
