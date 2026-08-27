import { describe, expect, it } from "vitest";
import { normalizeWorktreePath } from "./normalizePath";

/** realpath stub: exact-match table, ENOENT for anything absent. */
function realpathFrom(table: Record<string, string>) {
  return async (p: string): Promise<string> => {
    const hit = table[p];
    if (hit === undefined) {
      const err = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }
    return hit;
  };
}

/** Identity realpath — every path exists and resolves to itself. */
const identity = async (p: string) => p;

describe("normalizeWorktreePath — posix", () => {
  const posix = { platform: "darwin" as NodeJS.Platform, realpath: identity };

  it("rejects empty and non-absolute input", async () => {
    expect(await normalizeWorktreePath("", posix)).toBeNull();
    expect(await normalizeWorktreePath("   ", posix)).toBeNull();
    expect(await normalizeWorktreePath("relative/path", posix)).toBeNull();
    expect(await normalizeWorktreePath("./x", posix)).toBeNull();
  });

  it("collapses repeated separators and strips trailing ones", async () => {
    expect(await normalizeWorktreePath("/a//b///c/", posix)).toBe("/a/b/c");
    expect(await normalizeWorktreePath("/a/b/c///", posix)).toBe("/a/b/c");
  });

  it("preserves the bare root", async () => {
    expect(await normalizeWorktreePath("/", posix)).toBe("/");
  });

  it("applies Unicode NFC so decomposed and composed spellings agree", async () => {
    const decomposed = "/repo/cafe\u0301"; // e + combining acute
    const composed = "/repo/caf\u00e9"; // é
    expect(await normalizeWorktreePath(decomposed, posix)).toBe(await normalizeWorktreePath(composed, posix));
  });

  // spec: A symlinked root reported two ways is one worktree
  it("resolves a symlinked root so both spellings share one identity", async () => {
    const realpath = realpathFrom({
      "/var/folders/x/repo": "/private/var/folders/x/repo",
      "/private/var/folders/x/repo": "/private/var/folders/x/repo",
    });
    const fromGit = await normalizeWorktreePath("/var/folders/x/repo", { ...posix, realpath });
    const fromOs = await normalizeWorktreePath("/private/var/folders/x/repo", {
      ...posix,
      realpath,
    });
    expect(fromGit).toBe("/private/var/folders/x/repo");
    expect(fromGit).toBe(fromOs);
  });

  it("normalizes a missing path via its nearest existing ancestor", async () => {
    const realpath = realpathFrom({ "/var/w": "/private/var/w" });
    expect(await normalizeWorktreePath("/var/w/gone/deeper", { ...posix, realpath })).toBe(
      "/private/var/w/gone/deeper",
    );
  });

  it("falls back to the lexical path when no ancestor resolves", async () => {
    const realpath = realpathFrom({});
    expect(await normalizeWorktreePath("/nowhere/at/all", { ...posix, realpath })).toBe("/nowhere/at/all");
  });

  it("keeps posix case, which is significant", async () => {
    expect(await normalizeWorktreePath("/Repo/Src", posix)).toBe("/Repo/Src");
  });
});

describe("normalizeWorktreePath — win32", () => {
  const win = { platform: "win32" as NodeJS.Platform, realpath: identity };

  // spec: A drive letter spelled two ways is one worktree
  it("folds drive-letter and path case into one identity", async () => {
    const lower = await normalizeWorktreePath("c:\\src\\repo", win);
    const mixed = await normalizeWorktreePath("C:\\Src\\Repo", win);
    expect(lower).toBe("C:\\src\\repo");
    expect(lower).toBe(mixed);
  });

  it("folds forward slashes onto the native separator", async () => {
    expect(await normalizeWorktreePath("C:/Src/Repo", win)).toBe("C:\\src\\repo");
  });

  it("collapses repeated separators and strips trailing ones", async () => {
    expect(await normalizeWorktreePath("C:\\a\\\\b\\", win)).toBe("C:\\a\\b");
  });

  it("preserves a bare drive root", async () => {
    expect(await normalizeWorktreePath("C:\\", win)).toBe("C:\\");
  });

  it("preserves the UNC double-separator prefix", async () => {
    expect(await normalizeWorktreePath("\\\\Server\\Share\\Repo", win)).toBe("\\\\server\\share\\repo");
  });

  it("rejects a non-absolute windows path", async () => {
    expect(await normalizeWorktreePath("src\\repo", win)).toBeNull();
  });
});
