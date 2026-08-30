import { describe, expect, it } from "vitest";
import { isPathInside, isResolvedPathInside, isWindowsAbsPath, normalizePathForCompare } from "./pathBoundary";

describe("isWindowsAbsPath", () => {
  it("recognizes drive letters in either case and either separator", () => {
    expect(isWindowsAbsPath("C:\\repo")).toBe(true);
    expect(isWindowsAbsPath("c:/repo")).toBe(true);
  });

  it("recognizes a UNC path", () => {
    expect(isWindowsAbsPath("\\\\server\\share")).toBe(true);
  });

  it("does not claim a POSIX path", () => {
    expect(isWindowsAbsPath("/repo")).toBe(false);
  });
});

describe("normalizePathForCompare", () => {
  it("folds Windows separators and case", () => {
    expect(normalizePathForCompare("C:/Repo/Feat")).toBe("c:\\repo\\feat");
  });

  it("leaves a POSIX path untouched, since it is case-sensitive", () => {
    expect(normalizePathForCompare("/Repo/Feat")).toBe("/Repo/Feat");
  });
});

describe("isPathInside", () => {
  it("treats a path as inside itself", () => {
    expect(isPathInside("/repo", "/repo")).toBe(true);
  });

  it("accepts a descendant", () => {
    expect(isPathInside("/repo/packages/api", "/repo")).toBe(true);
  });

  it("rejects a sibling that merely shares a prefix", () => {
    expect(isPathInside("/repo-other", "/repo")).toBe(false);
  });

  it("rejects an ancestor", () => {
    expect(isPathInside("/repo", "/repo/packages")).toBe(false);
  });

  // Round-1 review W5: the naive `root + sep` form builds `//` here and matches nothing.
  it("accepts any absolute path under the POSIX filesystem root", () => {
    expect(isPathInside("/repo/feat", "/")).toBe(true);
    expect(isPathInside("/", "/")).toBe(true);
  });

  it("accepts a path under a Windows drive root without doubling the separator", () => {
    expect(isPathInside("C:\\repo", "C:\\")).toBe(true);
    expect(isPathInside("C:/repo", "C:/")).toBe(true);
  });

  it("compares Windows paths case-insensitively and across separator drift", () => {
    expect(isPathInside("c:/Repo/Feat", "C:\\repo")).toBe(true);
  });

  it("keeps POSIX comparison case-sensitive", () => {
    expect(isPathInside("/Repo/feat", "/repo")).toBe(false);
  });
});

describe("isResolvedPathInside", () => {
  /**
   * A fake filesystem as two maps: `links` is what `realpath` resolves a path
   * to, `present` is what `lstat` can see. Splitting them is the point — a
   * dangling link is present but unresolvable, and that pair is the case the
   * lexical predicate gets wrong.
   */
  const fakeFs = (options: { links?: Record<string, string>; present?: string[]; errors?: Record<string, string> }) => {
    const links = options.links ?? {};
    const errors = options.errors ?? {};
    const present = new Set([...(options.present ?? []), ...Object.keys(links)]);
    const fail = (code: string) => {
      const error = new Error(code) as NodeJS.ErrnoException;
      error.code = code;
      return error;
    };
    return {
      realpath: async (p: string) => {
        if (errors[p]) {
          throw fail(errors[p]);
        }
        if (p in links) {
          return links[p];
        }
        throw fail("ENOENT");
      },
      lstat: async (p: string) => {
        if (!present.has(p)) {
          throw fail("ENOENT");
        }
        return {};
      },
    };
  };

  it("accepts a transcript genuinely inside the root", async () => {
    const deps = fakeFs({
      links: { "/store": "/store", "/store/a/s.jsonl": "/store/a/s.jsonl" },
    });
    expect(await isResolvedPathInside("/store/a/s.jsonl", "/store", deps)).toBe(true);
  });

  it("refuses a link inside the root that resolves out of it", async () => {
    const deps = fakeFs({
      links: { "/store": "/store", "/store/a/s.jsonl": "/elsewhere/s.jsonl" },
    });
    expect(await isResolvedPathInside("/store/a/s.jsonl", "/store", deps)).toBe(false);
  });

  it("accepts a candidate under a root that is itself reached through a link", async () => {
    // The literal spelling never matches; only resolving BOTH sides does.
    const deps = fakeFs({
      links: { "/home/.claude": "/volumes/ext/claude", "/home/.claude/a/s.jsonl": "/volumes/ext/claude/a/s.jsonl" },
    });
    expect(await isResolvedPathInside("/home/.claude/a/s.jsonl", "/home/.claude", deps)).toBe(true);
  });

  it("accepts a transcript that has not been written yet", async () => {
    const deps = fakeFs({ links: { "/store": "/store", "/store/a": "/store/a" } });
    expect(await isResolvedPathInside("/store/a/s.jsonl", "/store", deps)).toBe(true);
  });

  it("accepts a whole absent branch beneath a resolved parent", async () => {
    const deps = fakeFs({ links: { "/store": "/store" } });
    expect(await isResolvedPathInside("/store/a/b/s.jsonl", "/store", deps)).toBe(true);
  });

  it("refuses a DANGLING link inside the root — the case a lexical rebuild lets through", async () => {
    // `realpath` says ENOENT for both the link and the file under it, but the
    // link itself is present. Ascending to `/store` and rejoining the tail would
    // reconstruct `/store/link/s.jsonl` and call it contained; the moment the
    // link's target is created, the read escapes.
    const deps = fakeFs({ links: { "/store": "/store" }, present: ["/store/link"] });
    expect(await isResolvedPathInside("/store/link/s.jsonl", "/store", deps)).toBe(false);
  });

  it("refuses a symlink cycle rather than degrading to spelling", async () => {
    const deps = fakeFs({ links: { "/store": "/store" }, errors: { "/store/loop/s.jsonl": "ELOOP" } });
    expect(await isResolvedPathInside("/store/loop/s.jsonl", "/store", deps)).toBe(false);
  });

  it("refuses an unreadable directory rather than degrading to spelling", async () => {
    const deps = fakeFs({ links: { "/store": "/store" }, errors: { "/store/priv/s.jsonl": "EACCES" } });
    expect(await isResolvedPathInside("/store/priv/s.jsonl", "/store", deps)).toBe(false);
  });

  it("refuses when nothing on the path resolves, with no lexical fallback", async () => {
    const deps = fakeFs({ links: { "/store": "/store" } });
    expect(await isResolvedPathInside("/other/s.jsonl", "/store", deps)).toBe(false);
  });

  it("refuses when the root itself cannot be resolved", async () => {
    const deps = fakeFs({ links: { "/store/a/s.jsonl": "/store/a/s.jsonl" } });
    expect(await isResolvedPathInside("/store/a/s.jsonl", "/store", deps)).toBe(false);
  });

  it("refuses the root itself, unlike isPathInside", async () => {
    // Codex reads this answer as permission to OPEN the path; a directory that
    // passes here silently replaces the filename scan that finds the real file.
    const deps = fakeFs({ links: { "/store": "/store" } });
    expect(isPathInside("/store", "/store")).toBe(true);
    expect(await isResolvedPathInside("/store", "/store", deps)).toBe(false);
  });

  it("refuses a candidate that resolves ONTO the root", async () => {
    const deps = fakeFs({ links: { "/store": "/store", "/store/link": "/store" } });
    expect(await isResolvedPathInside("/store/link", "/store", deps)).toBe(false);
  });

  it("compares Windows paths without separator or drive-case drift", async () => {
    const deps = fakeFs({
      links: { "C:\\store": "C:\\store", "C:\\store\\a\\s.jsonl": "c:/store/a/s.jsonl" },
    });
    expect(await isResolvedPathInside("C:\\store\\a\\s.jsonl", "C:\\store", deps)).toBe(true);
  });
});
