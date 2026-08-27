import { describe, expect, it } from "vitest";
import { parseWorktreeList } from "./porcelainParser";

/** Build a `-z` payload: fields NUL-terminated, records closed by an empty field. */
function nul(...records: string[][]): Buffer {
  return Buffer.from(records.map((fields) => `${fields.map((f) => `${f}\0`).join("")}\0`).join(""));
}

/** Build a line-delimited payload: fields per line, records closed by a blank line. */
function lines(...records: string[][]): string {
  return `${records.map((fields) => `${fields.join("\n")}\n`).join("\n")}\n`;
}

const MAIN = ["worktree /repo", "HEAD abc123", "branch refs/heads/main"];
const LINKED = ["worktree /repo-wt/feat", "HEAD def456", "branch refs/heads/feat"];

describe("parseWorktreeList — token mapping", () => {
  it("maps the token table and marks the first record main", () => {
    const { worktrees, reasons } = parseWorktreeList(nul(MAIN, LINKED), { nulDelimited: true });
    expect(reasons).toEqual([]);
    expect(worktrees).toHaveLength(2);
    expect(worktrees[0]).toMatchObject({
      path: "/repo",
      head: "abc123",
      branch: "main",
      kind: "main",
      bare: false,
      detached: false,
      locked: false,
      prunable: false,
    });
    expect(worktrees[1]).toMatchObject({ path: "/repo-wt/feat", branch: "feat", kind: "linked" });
  });

  it("parses the line-delimited form into the same worktrees", () => {
    const fromLines = parseWorktreeList(lines(MAIN, LINKED));
    const fromNul = parseWorktreeList(nul(MAIN, LINKED), { nulDelimited: true });
    expect(fromLines.worktrees).toEqual(fromNul.worktrees);
  });

  it("maps bare, detached, locked and prunable", () => {
    const { worktrees } = parseWorktreeList(
      nul(
        ["worktree /repo", "bare"],
        ["worktree /wt/det", "HEAD abc", "detached", "locked on removable media"],
        [
          "worktree /wt/old",
          "HEAD def",
          "branch refs/heads/old",
          "prunable gitdir file points to non-existent location",
        ],
      ),
      { nulDelimited: true },
    );
    expect(worktrees[0]).toMatchObject({ bare: true, kind: "main" });
    expect(worktrees[1]).toMatchObject({
      detached: true,
      locked: true,
      lockReason: "on removable media",
    });
    expect(worktrees[1].branch).toBeUndefined();
    expect(worktrees[2]).toMatchObject({ prunable: true, locked: false });
  });

  it("accepts a bare `locked` with no reason", () => {
    const { worktrees } = parseWorktreeList(nul(["worktree /repo", "HEAD abc", "locked"]), {
      nulDelimited: true,
    });
    expect(worktrees[0].locked).toBe(true);
    expect(worktrees[0].lockReason).toBeUndefined();
  });

  it("leaves head absent on an unborn branch", () => {
    const { worktrees } = parseWorktreeList(nul(["worktree /repo", "branch refs/heads/main"]), {
      nulDelimited: true,
    });
    expect(worktrees[0].head).toBeUndefined();
    expect(worktrees[0].branch).toBe("main");
  });
});

describe("parseWorktreeList — lock reason encoding", () => {
  // Verified against git 2.50: `-z` emits the reason raw, newline and all.
  it("keeps a raw multi-line reason in the -z form", () => {
    const { worktrees } = parseWorktreeList(nul(["worktree /repo", "HEAD abc", 'locked multi\nline "quoted" reason']), {
      nulDelimited: true,
    });
    expect(worktrees[0].lockReason).toBe('multi\nline "quoted" reason');
  });

  // Verified against git 2.50: the line form c-quotes the same reason.
  it("decodes a c-quoted reason in the line form", () => {
    const { worktrees } = parseWorktreeList(
      lines(["worktree /repo", "HEAD abc", 'locked "multi\\nline \\"quoted\\" reason"']),
    );
    expect(worktrees[0].lockReason).toBe('multi\nline "quoted" reason');
  });

  it("leaves an unquoted line-form reason alone", () => {
    const { worktrees } = parseWorktreeList(
      lines(["worktree /repo", "HEAD abc", "prunable gitdir file points to non-existent location"]),
    );
    expect(worktrees[0].prunable).toBe(true);
  });

  it("decodes octal escapes as UTF-8", () => {
    const { worktrees } = parseWorktreeList(lines(["worktree /repo", 'locked "caf\\303\\251"']));
    expect(worktrees[0].lockReason).toBe("café");
  });
});

describe("parseWorktreeList — ambiguous records", () => {
  // research § 2: non-`-z` porcelain emits paths unquoted, so a newline in a
  // path cannot be decoded — only detected. Recording the truncated path would
  // invent a worktree that does not exist.
  it("skips a line-form record whose path contains a newline", () => {
    const payload = "worktree /repo/we\nird\nHEAD abc\nbranch refs/heads/odd\n\n";
    const { worktrees, reasons } = parseWorktreeList(payload);
    expect(worktrees).toEqual([]);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/unparseable/i);
  });

  it("keeps the good records around a skipped one", () => {
    const payload = `${lines(MAIN)}worktree /repo/we\nird\nHEAD abc\n\n${lines(LINKED)}`;
    const { worktrees, reasons } = parseWorktreeList(payload);
    expect(worktrees.map((w) => w.path)).toEqual(["/repo", "/repo-wt/feat"]);
    expect(reasons).toHaveLength(1);
  });

  it("handles the same path correctly in the -z form", () => {
    const { worktrees, reasons } = parseWorktreeList(
      nul(["worktree /repo/we\nird", "HEAD abc", "branch refs/heads/odd"]),
      { nulDelimited: true },
    );
    expect(reasons).toEqual([]);
    expect(worktrees[0].path).toBe("/repo/we\nird");
  });

  it("deduplicates repeated reasons", () => {
    const bad = "worktree /repo/a\nstray\n\nworktree /repo/b\nstray\n\n";
    const { worktrees, reasons } = parseWorktreeList(bad);
    expect(worktrees).toEqual([]);
    expect(reasons).toHaveLength(1);
  });

  it("drops a record that carries no worktree path", () => {
    const { worktrees } = parseWorktreeList(nul(["HEAD abc", "branch refs/heads/x"]), {
      nulDelimited: true,
    });
    expect(worktrees).toEqual([]);
  });

  it("returns nothing for empty output", () => {
    expect(parseWorktreeList("").worktrees).toEqual([]);
    expect(parseWorktreeList(Buffer.alloc(0), { nulDelimited: true }).worktrees).toEqual([]);
  });
});

// Round-1 review B1, B2, W3.
describe("parseWorktreeList — undecodable bytes", () => {
  it("skips a record whose path bytes are not valid UTF-8 rather than substituting", () => {
    const payload = Buffer.concat([Buffer.from("worktree /repo/"), Buffer.from([0xff]), Buffer.from("\0HEAD abc\0\0")]);
    const { worktrees, reasons, skipped } = parseWorktreeList(payload, { nulDelimited: true });
    expect(worktrees).toEqual([]);
    expect(skipped).toBe(1);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/utf-8/i);
  });

  it("never emits the replacement character as part of a path", () => {
    const payload = Buffer.concat([Buffer.from("worktree /repo/"), Buffer.from([0xff]), Buffer.from("\0HEAD abc\0\0")]);
    const { worktrees } = parseWorktreeList(payload, { nulDelimited: true });
    expect(worktrees.map((w) => w.path).join("")).not.toContain("�");
  });

  it("keeps a valid non-ASCII path intact", () => {
    const { worktrees, reasons } = parseWorktreeList(nul(["worktree /repo/café", "HEAD abc"]), { nulDelimited: true });
    expect(reasons).toEqual([]);
    expect(worktrees[0].path).toBe("/repo/café");
  });

  it("keeps good records around an undecodable one", () => {
    const payload = Buffer.concat([
      nul(MAIN),
      Buffer.from("worktree /repo/"),
      Buffer.from([0xff]),
      Buffer.from("\0\0"),
      nul(LINKED),
    ]);
    const { worktrees, skipped } = parseWorktreeList(payload, { nulDelimited: true });
    expect(worktrees.map((w) => w.path)).toEqual(["/repo", "/repo-wt/feat"]);
    expect(skipped).toBe(1);
  });
});

describe("parseWorktreeList — kind follows the record ordinal", () => {
  // Git always emits the main worktree first, so a skipped record must not
  // hand its "main" role to whichever record happened to parse first.
  it("does not promote a linked worktree when the first record is skipped", () => {
    const payload = `worktree /repo/we\nird\nHEAD abc\n\n${lines(LINKED)}`;
    const { worktrees } = parseWorktreeList(payload);
    expect(worktrees).toHaveLength(1);
    expect(worktrees[0]).toMatchObject({ path: "/repo-wt/feat", kind: "linked" });
  });

  it("does not promote a linked worktree when a pathless record leads", () => {
    const { worktrees } = parseWorktreeList(nul(["HEAD abc"], ["worktree /repo-wt/feat", "HEAD def"]), {
      nulDelimited: true,
    });
    expect(worktrees).toHaveLength(1);
    expect(worktrees[0].kind).toBe("linked");
  });

  it("still marks the first record main when nothing is skipped", () => {
    const { worktrees } = parseWorktreeList(nul(MAIN, LINKED), { nulDelimited: true });
    expect(worktrees.map((w) => w.kind)).toEqual(["main", "linked"]);
  });
});

describe("parseWorktreeList — skipped count", () => {
  it("counts every skipped record while deduplicating the displayed reason", () => {
    const bad = "worktree /repo/a\nstray\n\nworktree /repo/b\nstray\n\n";
    const { reasons, skipped } = parseWorktreeList(bad);
    expect(reasons).toHaveLength(1);
    expect(skipped).toBe(2);
  });

  it("reports zero skipped for a clean listing", () => {
    expect(parseWorktreeList(nul(MAIN, LINKED), { nulDelimited: true }).skipped).toBe(0);
  });
});

// Round-2 review R2-B1: only the path is identity, so only the path is fatal.
describe("parseWorktreeList — display metadata decodes leniently", () => {
  function withRawSuffix(prefix: string, byte: number): Buffer {
    return Buffer.concat([Buffer.from(prefix), Buffer.from([byte]), Buffer.from("\0\0")]);
  }

  it("keeps a worktree whose lock reason carries undecodable bytes", () => {
    const payload = withRawSuffix("worktree /repo\0HEAD abc\0locked on disk ", 0xff);
    const { worktrees, reasons, skipped } = parseWorktreeList(payload, { nulDelimited: true });
    expect(skipped).toBe(0);
    expect(reasons).toEqual([]);
    expect(worktrees).toHaveLength(1);
    expect(worktrees[0]).toMatchObject({ path: "/repo", locked: true });
  });

  it("keeps a worktree whose branch carries undecodable bytes", () => {
    const payload = withRawSuffix("worktree /repo\0HEAD abc\0branch refs/heads/od", 0xff);
    const { worktrees, skipped } = parseWorktreeList(payload, { nulDelimited: true });
    expect(skipped).toBe(0);
    expect(worktrees).toHaveLength(1);
    expect(worktrees[0].path).toBe("/repo");
  });

  it("still drops the record when the path itself is undecodable", () => {
    const payload = withRawSuffix("worktree /repo/", 0xff);
    const { worktrees, skipped } = parseWorktreeList(payload, { nulDelimited: true });
    expect(worktrees).toEqual([]);
    expect(skipped).toBe(1);
  });
});
