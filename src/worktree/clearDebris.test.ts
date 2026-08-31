import { describe, expect, it } from "vitest";
import { type ClearDebrisDeps, clearDebris } from "./clearDebris";

const ROOT = "/trees";
const PATH = "/trees/repo-feat";
const IDENTITY = "1:2";

function statLike(dev: number, ino: number, directory = true) {
  return { dev, ino, isDirectory: () => directory, isSymbolicLink: () => false };
}

function deps(over: Partial<ClearDebrisDeps> & { removed?: string[]; remaining?: string[] } = {}): ClearDebrisDeps {
  return {
    lstat: over.lstat ?? (async () => statLike(1, 2)),
    readdir: over.readdir ?? (async () => over.remaining ?? null),
    probeGitEntry: over.probeGitEntry ?? (() => "absent"),
    remove:
      over.remove ??
      (async (p: string) => {
        over.removed?.push(p);
      }),
  };
}

describe("clearDebris", () => {
  it("removes the directory and reports success when nothing remains", async () => {
    const removed: string[] = [];
    const result = await clearDebris(PATH, ROOT, IDENTITY, deps({ removed }));
    expect(result).toEqual({ ok: true });
    expect(removed).toEqual([PATH]);
  });

  it("refuses and removes nothing when the identity no longer matches", async () => {
    const removed: string[] = [];
    const result = await clearDebris(PATH, ROOT, IDENTITY, deps({ removed, lstat: async () => statLike(1, 99) }));
    expect(result.ok).toBe(false);
    expect(removed).toEqual([]);
  });

  it("refuses where the platform gave no identity to bind to", async () => {
    // A null identity must not read as "matches anything".
    const removed: string[] = [];
    const result = await clearDebris(PATH, ROOT, null, deps({ removed, lstat: async () => statLike(1, 0) }));
    expect(result.ok).toBe(false);
    expect(removed).toEqual([]);
  });

  it("refuses where a .git appeared after the authorization", async () => {
    const removed: string[] = [];
    const result = await clearDebris(PATH, ROOT, IDENTITY, deps({ removed, probeGitEntry: () => "present" }));
    expect(result.ok).toBe(false);
    expect(removed).toEqual([]);
  });

  it("refuses where the .git reading could not be taken", async () => {
    const removed: string[] = [];
    const result = await clearDebris(PATH, ROOT, IDENTITY, deps({ removed, probeGitEntry: () => "unknown" }));
    expect(result.ok).toBe(false);
    expect(removed).toEqual([]);
  });

  it("refuses where the directory is gone", async () => {
    const removed: string[] = [];
    const result = await clearDebris(PATH, ROOT, IDENTITY, deps({ removed, lstat: async () => null }));
    expect(result.ok).toBe(false);
    expect(removed).toEqual([]);
  });

  it("refuses where the path is not a directory", async () => {
    const removed: string[] = [];
    const result = await clearDebris(PATH, ROOT, IDENTITY, deps({ removed, lstat: async () => statLike(1, 2, false) }));
    expect(result.ok).toBe(false);
    expect(removed).toEqual([]);
  });

  it("refuses a path outside the create root, whatever the authorization says", async () => {
    const removed: string[] = [];
    const result = await clearDebris("/elsewhere/repo", ROOT, IDENTITY, deps({ removed }));
    expect(result.ok).toBe(false);
    expect(removed).toEqual([]);
  });

  it("refuses the create root itself", async () => {
    const removed: string[] = [];
    const result = await clearDebris(ROOT, ROOT, IDENTITY, deps({ removed }));
    expect(result.ok).toBe(false);
    expect(removed).toEqual([]);
  });

  it("reports what REMAINS when the removal was partial", async () => {
    const result = await clearDebris(PATH, ROOT, IDENTITY, deps({ remaining: ["locked.db", "sub"] }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("locked.db");
  });

  it("treats an emptied directory as cleared", async () => {
    const result = await clearDebris(PATH, ROOT, IDENTITY, deps({ remaining: [] }));
    expect(result).toEqual({ ok: true });
  });

  it("reports a removal that threw, rather than claiming the path is clear", async () => {
    const result = await clearDebris(
      PATH,
      ROOT,
      IDENTITY,
      deps({
        remove: async () => {
          throw new Error("EPERM");
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("EPERM");
  });

  it("takes the identity reading and the .git reading with no await between them and the removal", async () => {
    // The ordering IS the guard (design.md D3). Anything awaited between the
    // last check and the removal is a window where the directory can be
    // replaced, so this asserts the sequence rather than trusting the source.
    const order: string[] = [];
    await clearDebris(PATH, ROOT, IDENTITY, {
      lstat: async () => {
        order.push("lstat");
        return statLike(1, 2);
      },
      probeGitEntry: () => {
        order.push("git");
        return "absent";
      },
      remove: async (p: string) => {
        order.push(`remove:${p}`);
      },
      readdir: async () => {
        order.push("readdir");
        return null;
      },
    });
    expect(order).toEqual(["lstat", "git", `remove:${PATH}`, "readdir"]);
  });
});
