import { describe, expect, it } from "vitest";
import {
  type CreatePathContext,
  type CreatePathDeps,
  resolveCreateRoot,
  suggestFreePath,
  validateCreatePath,
} from "./createPath";

/** A fake filesystem: paths that exist, which of them are links, dir contents. */
function fsOf(spec: {
  links?: string[];
  dirs?: Record<string, string[]>;
  files?: string[];
  platform?: NodeJS.Platform;
  /** Per-path inode; anything unlisted gets a stable one derived from its path. */
  inos?: Record<string, number>;
}): CreatePathDeps {
  const links = new Set(spec.links ?? []);
  const dirs = spec.dirs ?? {};
  const files = new Set(spec.files ?? []);
  const exists = (p: string) => links.has(p) || p in dirs || files.has(p);
  const inoOf = (p: string) => spec.inos?.[p] ?? [...p].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 100_000;
  const sep = (spec.platform ?? "darwin") === "win32" ? "\\" : "/";
  return {
    platform: spec.platform ?? "darwin",
    async lstat(p) {
      return exists(p)
        ? { isSymbolicLink: () => links.has(p), isDirectory: () => p in dirs, dev: 1, ino: inoOf(p) }
        : null;
    },
    async readdir(p) {
      return dirs[p] ?? null;
    },
    // Stand-in for normalizeWorktreePath: resolves a symlinked ancestor to its
    // target, exactly as the real one does via realpath.
    async normalize(raw) {
      for (const link of links) {
        if (raw === link || raw.startsWith(`${link}${sep}`)) {
          return raw.replace(link, `${link}-target`);
        }
      }
      return raw;
    },
  };
}

const ctx = { mainWorktree: "/repo", linkedWorktrees: ["/repo/wt-existing"] };

describe("validateCreatePath", () => {
  it("accepts a free absolute path under the main worktree", async () => {
    // The default root lives inside main (worktree-rpc.md:202), so this is the
    // ordinary case, not an exception.
    const result = await validateCreatePath("/repo/.claude/worktrees/feature", ctx, fsOf({ dirs: { "/repo": [] } }));
    expect(result).toMatchObject({ ok: true, path: "/repo/.claude/worktrees/feature" });
  });

  it("refuses a relative path", async () => {
    const result = await validateCreatePath("relative/path", ctx, fsOf({}));
    expect(result).toMatchObject({ ok: false });
  });

  it("refuses a symlinked component instead of resolving through it", async () => {
    // THE ordering bug: normalizeWorktreePath realpaths the nearest existing
    // ancestor, so normalizing first turns /safe/link/new into the link's
    // target and the component walk never sees `link` at all. The lexical walk
    // has to run BEFORE the normalizer.
    const deps = fsOf({ links: ["/safe/link"], dirs: { "/safe": ["link"] } });
    const result = await validateCreatePath("/safe/link/new", ctx, deps);
    expect(result).toMatchObject({ ok: false });
    expect((result as { reason: string }).reason).toMatch(/symbolic link/i);
  });

  it("refuses a path that IS a symlink", async () => {
    const deps = fsOf({ links: ["/safe/link"], dirs: { "/safe": ["link"] } });
    expect(await validateCreatePath("/safe/link", ctx, deps)).toMatchObject({ ok: false });
  });

  it("accepts an existing empty directory", async () => {
    const deps = fsOf({ dirs: { "/repo": [], "/repo/empty": [] } });
    expect(await validateCreatePath("/repo/empty", ctx, deps)).toMatchObject({ ok: true });
  });

  it("refuses an existing non-empty directory", async () => {
    const deps = fsOf({ dirs: { "/repo": [], "/repo/full": ["a.txt"] } });
    expect(await validateCreatePath("/repo/full", ctx, deps)).toMatchObject({ ok: false });
  });

  it("refuses a path that exists as a file", async () => {
    const deps = fsOf({ dirs: { "/repo": [] }, files: ["/repo/afile"] });
    expect(await validateCreatePath("/repo/afile", ctx, deps)).toMatchObject({ ok: false });
  });

  it("refuses a path inside a LINKED worktree", async () => {
    const result = await validateCreatePath("/repo/wt-existing/inner", ctx, fsOf({}));
    expect(result).toMatchObject({ ok: false });
  });

  it("refuses the main worktree itself", async () => {
    const result = await validateCreatePath("/repo", ctx, fsOf({ dirs: { "/repo": [] } }));
    expect(result).toMatchObject({ ok: false });
  });

  it("records the candidate's own identity when the candidate already exists", async () => {
    // When the candidate exists as an empty directory, the nearest EXISTING
    // ancestor is the candidate — not its parent. Recording the parent would
    // leave a swap of the candidate directory itself undetected.
    const deps = fsOf({ dirs: { "/repo": [], "/repo/empty": [] } });
    const result = await validateCreatePath("/repo/empty", ctx, deps);
    expect(result).toMatchObject({ ok: true, recheckPath: "/repo/empty", mustBeEmpty: true });
  });

  it("records the nearest existing ancestor when the candidate does not exist", async () => {
    const deps = fsOf({ dirs: { "/repo": [], "/repo/roots": [] } });
    const result = await validateCreatePath("/repo/roots/new/deeper", ctx, deps);
    expect(result).toMatchObject({ ok: true, recheckPath: "/repo/roots", mustBeEmpty: false });
  });
});

describe("resolveCreateRoot", () => {
  it("prefers an explicitly set setting over everything", () => {
    const root = resolveCreateRoot({
      configured: { value: "/custom/root", explicitlySet: true },
      linkedWorktrees: ["/elsewhere/a", "/elsewhere/b"],
      mainWorktree: "/repo",
    });
    expect(root).toBe("/custom/root");
  });

  it("honours an explicit setting even when its value equals the default", () => {
    // A user who deliberately sets the default has still stated a preference,
    // and must outrank detection. Comparing against the declared default cannot
    // tell the two apart — only the configuration's own resolution can.
    const root = resolveCreateRoot({
      configured: { value: ".claude/worktrees", explicitlySet: true },
      linkedWorktrees: ["/elsewhere/a", "/elsewhere/b"],
      mainWorktree: "/repo",
    });
    expect(root).toBe("/repo/.claude/worktrees");
  });

  it("detects the mode of the parents of existing linked worktrees", () => {
    const root = resolveCreateRoot({
      configured: { value: undefined, explicitlySet: false },
      linkedWorktrees: ["/trees/a", "/trees/b", "/other/c"],
      mainWorktree: "/repo",
    });
    expect(root).toBe("/trees");
  });

  it("falls back to the documented default when there is nothing to detect", () => {
    const root = resolveCreateRoot({
      configured: { value: undefined, explicitlySet: false },
      linkedWorktrees: [],
      mainWorktree: "/repo",
    });
    expect(root).toBe("/repo/.claude/worktrees");
  });

  it("infers the root only, never the naming pattern", () => {
    // One root can hold worktrees named two ways; inferring a pattern from them
    // would encode one tool's convention as the repository's.
    const root = resolveCreateRoot({
      configured: { value: undefined, explicitlySet: false },
      linkedWorktrees: ["/trees/feat-login", "/trees/2026-08-thing"],
      mainWorktree: "/repo",
    });
    expect(root).toBe("/trees");
  });
});

describe("suggestFreePath", () => {
  it("returns the plain path when it is free", () => {
    expect(suggestFreePath("/trees", "login", () => false)).toBe("/trees/login");
  });

  it("suffixes until free rather than offering a taken path", () => {
    const taken = new Set(["/trees/login", "/trees/login-2"]);
    expect(suggestFreePath("/trees", "login", (p) => taken.has(p))).toBe("/trees/login-3");
  });
});

describe("a POSIX component containing a backslash", () => {
  it("is one component, and the symlink below it is still found", async () => {
    // A backslash is a legal POSIX filename character. Splitting on it probed
    // `/safe/foo`, missed, and returned early — so the link at `/safe/foo\\bar/link`
    // was never examined and the path reached git resolved (round-2 B3).
    const result = await validateCreatePath(
      "/safe/foo\\bar/link/new",
      { mainWorktree: "/repo", linkedWorktrees: [] },
      fsOf({
        links: ["/safe/foo\\bar/link"],
        dirs: { "/safe": ["foo\\bar"], "/safe/foo\\bar": ["link"] },
      }),
    );

    expect(result).toMatchObject({ ok: false });
    expect((result as { reason: string }).reason).toContain("/safe/foo\\bar/link");
  });

  it("still accepts one with nothing linked in it", async () => {
    const result = await validateCreatePath(
      "/safe/foo\\bar/new",
      { mainWorktree: "/repo", linkedWorktrees: [] },
      fsOf({ dirs: { "/safe": ["foo\\bar"], "/safe/foo\\bar": [] } }),
    );

    expect(result).toMatchObject({ ok: true });
  });
});

describe("validateCreatePath on Windows", () => {
  const winCtx = { mainWorktree: "C:\\repo", linkedWorktrees: ["C:\\repo\\wt-existing"] };

  it("refuses a drive-rooted path whose ancestor is a link", async () => {
    // The lexical walk used to rebuild from a bare separator, so it probed
    // `\\C:` — never present, so it returned null on the first step and let a
    // junction straight through to git (round-1 B3). The barrier must fire on
    // the platform it exists for.
    const result = await validateCreatePath(
      "C:\\safe\\link\\new",
      winCtx,
      fsOf({
        platform: "win32",
        links: ["C:\\safe\\link"],
        dirs: { "C:\\safe": ["link"] },
      }),
    );
    expect(result).toMatchObject({ ok: false });
    expect((result as { reason: string }).reason).toContain("symbolic link");
  });

  it("keeps a UNC share root intact rather than walking through it", async () => {
    // `\\\\server\\share` is the root, not two components. Walking it as
    // components would probe `\\server`, miss, and fail open exactly as the
    // drive-root case did.
    const result = await validateCreatePath(
      "\\\\server\\share\\link\\new",
      { mainWorktree: "\\\\server\\share\\repo", linkedWorktrees: [] },
      fsOf({
        platform: "win32",
        links: ["\\\\server\\share\\link"],
        dirs: { "\\\\server\\share": ["link"] },
      }),
    );
    expect(result).toMatchObject({ ok: false });
    expect((result as { reason: string }).reason).toContain("\\\\server\\share\\link");
  });

  it("accepts an ordinary drive-rooted path", async () => {
    // The negatives above only mean something if the walk still passes a path
    // with no link in it.
    const result = await validateCreatePath(
      "C:\\repo\\.claude\\worktrees\\feature",
      winCtx,
      fsOf({ platform: "win32", dirs: { "C:\\repo": [] } }),
    );
    expect(result).toMatchObject({ ok: true, path: "C:\\repo\\.claude\\worktrees\\feature" });
  });
});

describe("the identity a re-check compares against", () => {
  it("records the candidate's own identity when the candidate already exists", async () => {
    const fs = fsOf({ dirs: { "/repo/wt/new": [] }, inos: { "/repo/wt/new": 4242 } });
    const result = await validateCreatePath("/repo/wt/new", ctx, fs);
    expect(result).toMatchObject({ ok: true, recheckPath: "/repo/wt/new", mustBeEmpty: true });
    expect((result as { recheckIdentity: string }).recheckIdentity).toBe("1:4242");
  });

  it("records the nearest existing ancestor's identity when the candidate does not exist", async () => {
    const fs = fsOf({ dirs: { "/repo/wt": [] }, inos: { "/repo/wt": 77 } });
    const result = await validateCreatePath("/repo/wt/new", ctx, fs);
    expect(result).toMatchObject({ ok: true, recheckPath: "/repo/wt", mustBeEmpty: false });
    expect((result as { recheckIdentity: string }).recheckIdentity).toBe("1:77");
  });

  it("distinguishes a replaced-but-still-empty directory from the one it validated", async () => {
    // THE case emptiness cannot see: both observations find an empty directory
    // at the same path, and only the inode says they are different directories
    // (round-1 B4).
    const before = await validateCreatePath(
      "/repo/wt/new",
      ctx,
      fsOf({ dirs: { "/repo/wt/new": [] }, inos: { "/repo/wt/new": 1 } }),
    );
    const after = await validateCreatePath(
      "/repo/wt/new",
      ctx,
      fsOf({ dirs: { "/repo/wt/new": [] }, inos: { "/repo/wt/new": 2 } }),
    );
    expect((before as { recheckIdentity: string }).recheckIdentity).not.toBe(
      (after as { recheckIdentity: string }).recheckIdentity,
    );
  });

  it("reports no identity where the platform supplies none, rather than a false one", async () => {
    // Windows reports ino 0 on volumes that have no stable file id. Two zeroes
    // comparing equal would ACCEPT a substitution, so the absence is reported
    // and the re-check falls back to existence and emptiness.
    const fs = fsOf({ dirs: { "/repo/wt/new": [] }, inos: { "/repo/wt/new": 0 } });
    const result = await validateCreatePath("/repo/wt/new", ctx, fs);
    expect((result as { recheckIdentity: string | null }).recheckIdentity).toBeNull();
  });
});

describe("layout resolution follows the platform it will run on", () => {
  it("joins a relative configured root with the platform separator", () => {
    const root = resolveCreateRoot({
      configured: { value: ".worktrees", explicitlySet: true },
      linkedWorktrees: [],
      mainWorktree: "C:\\repo",
      platform: "win32",
    });
    expect(root).toBe("C:\\repo\\.worktrees");
  });

  it("detects a Windows layout's parent rather than reading it as one segment", () => {
    const root = resolveCreateRoot({
      configured: { value: undefined, explicitlySet: false },
      linkedWorktrees: ["C:\\trees\\a", "C:\\trees\\b"],
      mainWorktree: "C:\\repo",
      platform: "win32",
    });
    expect(root).toBe("C:\\trees");
  });

  it("suggests a Windows path with backslashes", () => {
    expect(suggestFreePath("C:\\trees", "feature", () => false, "win32")).toBe("C:\\trees\\feature");
  });
});

describe("a create path carrying characters nobody typed", () => {
  // Round-3 B10: the path reaches `info/exclude` and the git argv, and a
  // newline in it turned one create into two exclude rules.
  const ctx: CreatePathContext = { mainWorktree: "/repo", linkedWorktrees: [] };
  const deps: CreatePathDeps = {
    platform: "darwin",
    lstat: async () => null,
    readdir: async () => null,
    normalize: async (raw) => raw,
  };

  it("rejects a newline", async () => {
    const result = await validateCreatePath("/trees/x\n*", ctx, deps);
    expect(result).toMatchObject({ ok: false });
  });

  it("rejects a carriage return", async () => {
    expect(await validateCreatePath("/trees/x\r*", ctx, deps)).toMatchObject({ ok: false });
  });

  it("rejects a NUL, which would truncate the path at the syscall boundary", async () => {
    expect(await validateCreatePath("/trees/x\u0000/evil", ctx, deps)).toMatchObject({ ok: false });
  });

  it("rejects an escape character", async () => {
    expect(await validateCreatePath("/trees/\u001b[2Jx", ctx, deps)).toMatchObject({ ok: false });
  });

  it("still accepts an ordinary path, spaces and unicode included", async () => {
    // The negative that keeps the rule from being "reject anything unusual".
    expect(await validateCreatePath("/trees/my worktree \u2014 caf\u00e9", ctx, deps)).toMatchObject({ ok: true });
  });
});
