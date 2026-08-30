import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { ResolvedPathMemo } from "./resolvedPathMemo";

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

  it("reads a prepared path synchronously", async () => {
    const fs = counting({ "/link/wt": "/private/real/wt" });
    const memo = new ResolvedPathMemo(fs);

    await memo.prepare(["/link/wt"]);

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

  it("prepares a batch with one syscall per distinct path", async () => {
    const fs = counting({ "/a": "/real/a", "/b": "/real/b" });
    const memo = new ResolvedPathMemo(fs);

    await memo.prepare(["/a", "/b", "/a", "/a/../a"]);

    expect(fs.calls.sort()).toEqual(["/a", "/b"]);
    expect(memo.resolvedOr("/b")).toBe("/real/b");
  });

  it("stops answering synchronously for a path that was invalidated", async () => {
    const fs = counting({ "/link/wt": "/private/real/wt" });
    const memo = new ResolvedPathMemo(fs);

    await memo.prepare(["/link/wt"]);
    memo.invalidate("/link/wt");

    expect(memo.resolvedOr("/link/wt")).toBe(path.resolve("/link/wt"));
  });
});
