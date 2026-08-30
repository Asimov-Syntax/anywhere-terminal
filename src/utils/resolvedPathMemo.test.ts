import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { createTrackedPathResolver, ResolvedPathMemo } from "./resolvedPathMemo";

function counting(map: Record<string, string> = {}): {
  realpath: (p: string) => Promise<string>;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    realpath: async (p) => {
      calls.push(p);
      const hit = map[p];
      if (hit === undefined) {
        const error: NodeJS.ErrnoException = new Error(`ENOENT: ${p}`);
        error.code = "ENOENT";
        throw error;
      }
      return hit;
    },
  };
}

describe("ResolvedPathMemo", () => {
  it("resolves a path to its real form", async () => {
    const fs = counting({ "/link/wt": "/private/real/wt" });
    const memo = new ResolvedPathMemo(fs);

    expect(await memo.resolve("/link/wt")).toBe("/private/real/wt");
  });

  it("costs a single realpath however many times one spelling is asked for", async () => {
    // The whole point of the memo: the cost axis is distinct paths the window
    // works with, never the number of comparisons those paths take part in.
    const fs = counting({ "/link/wt": "/private/real/wt" });
    const memo = new ResolvedPathMemo(fs);

    for (let i = 0; i < 5; i++) {
      expect(await memo.resolve("/link/wt")).toBe("/private/real/wt");
    }

    expect(fs.calls).toEqual(["/link/wt"]);
  });

  it("gives concurrent callers one syscall rather than a race", async () => {
    const fs = counting({ "/link/wt": "/private/real/wt" });
    const memo = new ResolvedPathMemo(fs);

    const all = await Promise.all([memo.resolve("/link/wt"), memo.resolve("/link/wt"), memo.resolve("/link/wt")]);

    expect(all).toEqual(["/private/real/wt", "/private/real/wt", "/private/real/wt"]);
    expect(fs.calls).toEqual(["/link/wt"]);
  });

  it("keys on the resolved spelling, so equivalent spellings share one entry", async () => {
    const fs = counting({ "/link/wt": "/private/real/wt" });
    const memo = new ResolvedPathMemo(fs);

    await memo.resolve("/link/wt");
    await memo.resolve("/link/./wt");
    await memo.resolve("/link/sub/../wt");

    expect(fs.calls).toEqual(["/link/wt"]);
  });

  it("answers with the lexical form when the path cannot be resolved", async () => {
    // A worktree mid-creation is the ordinary case here. Refusing to answer
    // would drop every row under it, which is worse than answering as today.
    const fs = counting({});
    const memo = new ResolvedPathMemo(fs);

    expect(await memo.resolve("/gone/wt")).toBe(path.resolve("/gone/wt"));
  });

  it("retries a path that failed, rather than caching the fallback forever", async () => {
    // The fallback is a stand-in for an answer, not the answer. Memoizing it
    // would leave a worktree lexical for the window's life because of one
    // syscall taken while it was still being created.
    const map: Record<string, string> = {};
    const fs = counting(map);
    const memo = new ResolvedPathMemo(fs);

    expect(await memo.resolve("/late/wt")).toBe(path.resolve("/late/wt"));
    map["/late/wt"] = "/private/real/wt";

    expect(await memo.resolve("/late/wt")).toBe("/private/real/wt");
    expect(fs.calls).toEqual(["/late/wt", "/late/wt"]);
  });

  it("re-resolves one path after that path is invalidated", async () => {
    const map: Record<string, string> = { "/link/wt": "/private/real/wt" };
    const fs = counting(map);
    const memo = new ResolvedPathMemo(fs);

    await memo.resolve("/link/wt");
    map["/link/wt"] = "/private/moved/wt";
    expect(await memo.resolve("/link/wt")).toBe("/private/real/wt");

    memo.invalidate("/link/wt");

    expect(await memo.resolve("/link/wt")).toBe("/private/moved/wt");
  });

  it("invalidates by any spelling of the same path", async () => {
    const map: Record<string, string> = { "/link/wt": "/private/real/wt" };
    const fs = counting(map);
    const memo = new ResolvedPathMemo(fs);

    await memo.resolve("/link/wt");
    map["/link/wt"] = "/private/moved/wt";
    memo.invalidate("/link/./wt");

    expect(await memo.resolve("/link/wt")).toBe("/private/moved/wt");
  });

  it("drops every entry when the structure it described changed", async () => {
    const map: Record<string, string> = { "/a": "/real/a", "/b": "/real/b" };
    const fs = counting(map);
    const memo = new ResolvedPathMemo(fs);

    await memo.resolve("/a");
    await memo.resolve("/b");
    map["/a"] = "/moved/a";
    map["/b"] = "/moved/b";

    memo.invalidateAll();

    expect(await memo.resolve("/a")).toBe("/moved/a");
    expect(await memo.resolve("/b")).toBe("/moved/b");
  });

  it("holds one entry per distinct path, which is the bound it promises", async () => {
    const fs = counting({ "/a": "/real/a", "/b": "/real/b" });
    const memo = new ResolvedPathMemo(fs);

    await memo.resolve("/a");
    await memo.resolve("/a");
    await memo.resolve("/b");

    expect(memo.size).toBe(2);
    memo.invalidateAll();
    expect(memo.size).toBe(0);
  });

  it("does not let a flight that started before invalidate write its answer", async () => {
    // Round-1 B3. The invalidation happens WHILE the realpath is in the air —
    // the ordering a structural event and a slow syscall actually produce.
    let release: (real: string) => void = () => {};
    const memo = new ResolvedPathMemo({
      realpath: () => new Promise<string>((resolve) => (release = resolve)),
    });

    const inFlight = memo.resolve("/link/wt");
    memo.invalidate("/link/wt");
    release("/private/stale");
    await inFlight;

    expect(memo.resolvedOr("/link/wt")).toBe(path.resolve("/link/wt"));
  });

  it("does not let a flight cleared by invalidateAll write its answer", async () => {
    let release: (real: string) => void = () => {};
    const memo = new ResolvedPathMemo({
      realpath: () => new Promise<string>((resolve) => (release = resolve)),
    });

    const inFlight = memo.resolve("/link/wt");
    memo.invalidateAll();
    release("/private/stale");
    await inFlight;

    expect(memo.resolvedOr("/link/wt")).toBe(path.resolve("/link/wt"));
    expect(memo.size).toBe(0);
  });

  it("does not let a superseded flight delete the entry that replaced it", async () => {
    // The failure path is the dangerous half: it deletes by key, so a stale
    // rejection used to evict a NEWER in-flight resolution for the same path.
    // Asserted as a syscall count, because the answer survives either way —
    // what the bogus delete destroys is the memo entry, so the next caller
    // pays a realpath the memo exists to prevent.
    const calls: string[] = [];
    const releases: Array<(real: string) => void> = [];
    const rejects: Array<(err: Error) => void> = [];
    const memo = new ResolvedPathMemo({
      realpath: (p) => {
        calls.push(p);
        return new Promise<string>((resolve, reject) => {
          releases.push(resolve);
          rejects.push(reject);
        });
      },
    });

    const first = memo.resolve("/link/wt");
    memo.invalidate("/link/wt");
    const second = memo.resolve("/link/wt");

    rejects[0](new Error("ENOENT"));
    await first;
    releases[1]("/private/current");
    await second;

    expect(memo.resolvedOr("/link/wt")).toBe("/private/current");
    expect(memo.size).toBe(1);

    await memo.resolve("/link/wt");
    expect(calls).toEqual(["/link/wt", "/link/wt"]);
  });

  it("reads a prepared path synchronously", async () => {
    const fs = counting({ "/link/wt": "/private/real/wt" });
    const memo = new ResolvedPathMemo(fs);

    await createTrackedPathResolver(memo).prepare(["/link/wt"]);

    expect(memo.resolvedOr("/link/wt")).toBe("/private/real/wt");
  });

  it("answers lexically for a path nobody prepared, rather than losing the answer", async () => {
    // A site that never prepared must behave exactly as it did before this memo
    // existed. Returning undefined here would drop rows instead of misfiling one.
    const fs = counting({ "/link/wt": "/private/real/wt" });
    const memo = new ResolvedPathMemo(fs);

    expect(memo.resolvedOr("/link/wt")).toBe(path.resolve("/link/wt"));
    expect(fs.calls).toEqual([]);
  });

  it("claims a batch with one syscall per distinct path", async () => {
    const fs = counting({ "/a": "/real/a", "/b": "/real/b" });
    const memo = new ResolvedPathMemo(fs);

    await createTrackedPathResolver(memo).prepare(["/a", "/b", "/a", "/a/../a"]);

    expect(fs.calls.sort()).toEqual(["/a", "/b"]);
    expect(memo.resolvedOr("/b")).toBe("/real/b");
  });

  it("stops answering synchronously for a path that was invalidated", async () => {
    const fs = counting({ "/link/wt": "/private/real/wt" });
    const memo = new ResolvedPathMemo(fs);

    await createTrackedPathResolver(memo).prepare(["/link/wt"]);
    memo.invalidate("/link/wt");

    expect(memo.resolvedOr("/link/wt")).toBe(path.resolve("/link/wt"));
  });
});

describe("createTrackedPathResolver claims", () => {
  it("keeps a path resolved for the claimants that still hold it", async () => {
    // Round-2 B4. The memo is shared, so one consumer's bookkeeping must not
    // delete a fact another consumer is standing on. Decorations prepare only
    // on a workspace-folder change, so an entry they lose is lost for the
    // window's life — the very fallback this change exists to remove.
    const fs = counting({ "/link/root": "/private/root" });
    const memo = new ResolvedPathMemo(fs);
    const decorations = createTrackedPathResolver(memo);
    const panes = createTrackedPathResolver(memo);

    await decorations.prepare(["/link/root"]);
    await panes.prepare(["/link/root"]);
    await panes.prepare([]);

    expect(decorations.resolvedOr("/link/root")).toBe("/private/root");
    expect(memo.size).toBe(1);
  });

  it("drops the entry once the last claimant lets go", async () => {
    const fs = counting({ "/link/root": "/private/root" });
    const memo = new ResolvedPathMemo(fs);
    const decorations = createTrackedPathResolver(memo);
    const panes = createTrackedPathResolver(memo);

    await decorations.prepare(["/link/root"]);
    await panes.prepare(["/link/root"]);
    await panes.prepare([]);
    await decorations.prepare([]);

    expect(memo.size).toBe(0);
    expect(memo.resolvedOr("/link/root")).toBe("/link/root");
  });

  it("clears claimed entries too when a structural event invalidates everything", async () => {
    // D4 governs freshness: an event that moves the filesystem makes the answer
    // wrong for every claimant, so claims do not hold it back.
    const fs = counting({ "/link/root": "/private/root" });
    const memo = new ResolvedPathMemo(fs);
    const decorations = createTrackedPathResolver(memo);

    await decorations.prepare(["/link/root"]);
    memo.invalidateAll();

    expect(memo.size).toBe(0);
    expect(decorations.resolvedOr("/link/root")).toBe("/link/root");
  });

  it("re-resolves after every claimant has let go", async () => {
    // The claim set must not leave a tombstone: a path claimed again after a
    // full release is a fresh question, not a cached refusal.
    const fs = counting({ "/link/root": "/private/root" });
    const memo = new ResolvedPathMemo(fs);
    const panes = createTrackedPathResolver(memo);

    await panes.prepare(["/link/root"]);
    await panes.prepare([]);
    await panes.prepare(["/link/root"]);

    expect(panes.resolvedOr("/link/root")).toBe("/private/root");
    expect(fs.calls).toEqual(["/link/root", "/link/root"]);
  });
});

describe("a claim ends", () => {
  it("releases a path that leaves the set, wherever in the set it was", async () => {
    // Round-3 B6. `prepare` reconciled a `tracked` half and claimed a `pinned`
    // half forever, on the theory that pinned was the caller's standing set.
    // Repository discovery passes the workspace folders there and those change,
    // so a closed folder kept a claim nothing could ever drop.
    const fs = counting({ "/link/a": "/private/a", "/link/b": "/private/b" });
    const memo = new ResolvedPathMemo(fs);
    const repos = createTrackedPathResolver(memo);

    await repos.prepare(["/link/a", "/link/b"]);
    await repos.prepare(["/link/b"]);

    expect(memo.size).toBe(1);
    expect(memo.resolvedOr("/link/a")).toBe("/link/a");
    expect(repos.resolvedOr("/link/b")).toBe("/private/b");
  });

  it("lets go of everything when its owner disposes", async () => {
    // Round-3 B7. Every file-tree surface mints a resolver and closing the
    // surface released nothing, so opening and closing the same editor left a
    // dead claimant holding the root — which blocks the final release rather
    // than merely leaking one entry.
    const fs = counting({ "/link/root": "/private/root" });
    const memo = new ResolvedPathMemo(fs);
    const surface = createTrackedPathResolver(memo);

    await surface.prepare(["/link/root"]);
    surface.dispose();

    expect(memo.size).toBe(0);
  });

  it("survives a second dispose", async () => {
    const fs = counting({ "/link/root": "/private/root" });
    const memo = new ResolvedPathMemo(fs);
    const standing = createTrackedPathResolver(memo);
    const surface = createTrackedPathResolver(memo);

    await standing.prepare(["/link/root"]);
    await surface.prepare(["/link/root"]);
    surface.dispose();
    surface.dispose();

    expect(standing.resolvedOr("/link/root")).toBe("/private/root");
    expect(memo.size).toBe(1);
  });

  it("does not let one transaction release another's in-flight paths", async () => {
    // Round-3 B8. `prepare` mutates its set synchronously and then awaits, so a
    // second pass through ONE handle released the first pass's paths mid-flight;
    // the superseded resolution then declined to publish and the first caller
    // read its paths lexically. On the removal path that answer is the blocker
    // set for an irreversible destroy, so the miss is a pane nobody was warned
    // about. Separate transactions, separate claims.
    const fs = counting({ "/link/a": "/private/a", "/link/b": "/private/b" });
    const memo = new ResolvedPathMemo(fs);

    const first = createTrackedPathResolver(memo);
    const second = createTrackedPathResolver(memo);
    const a = first.prepare(["/link/a"]);
    const b = second.prepare(["/link/b"]);
    await Promise.all([a, b]);

    expect(first.resolvedOr("/link/a")).toBe("/private/a");
    expect(second.resolvedOr("/link/b")).toBe("/private/b");
    first.dispose();
    second.dispose();
    expect(memo.size).toBe(0);
  });
});
