import { describe, expect, it } from "vitest";
import {
  contained,
  entriesFor,
  ids,
  newDraft,
  openProviderFile,
  type ProviderContext,
  type ProviderDeps,
  problem,
  refusal,
} from "./providerKit";

const ROOT = "/repo";

/**
 * A provider that is deliberately NOT asimov.
 *
 * The whole point of the extraction is that provenance comes from the caller.
 * A suite written against the asimov context would pass with the file name
 * hardcoded back into the kit, which is exactly the defect the kit exists to
 * make impossible — so nothing here mentions `asimov/worktree.yaml`.
 */
const ORCA: ProviderContext = { id: "orca", file: ".orca/orca.yaml" };

/**
 * A fake checkout. `files` maps absolute paths to text, `dirs` to the names
 * inside them, and `links` redirects `realpath` so a path can resolve somewhere
 * else — which is how a file that is a symlink out of the tree is spelled.
 */
function fs(spec: {
  files?: Record<string, string>;
  dirs?: Record<string, string[]>;
  links?: Record<string, string>;
}): ProviderDeps {
  const files = spec.files ?? {};
  const dirs = spec.dirs ?? {};
  const links = spec.links ?? {};
  const missing = (p: string) => Object.assign(new Error(`ENOENT ${p}`), { code: "ENOENT" });
  return {
    readFile: async (p) => {
      const held = files[p];
      if (held === undefined) {
        throw missing(p);
      }
      return held;
    },
    readdir: async (p) => {
      const held = dirs[p];
      if (held === undefined) {
        throw missing(p);
      }
      return held;
    },
    realpath: async (p) => links[p] ?? p,
    lstat: async () => ({}),
  };
}

describe("the kit stamps the provider that called it", () => {
  it("gives an entry the calling context's file as its source", async () => {
    const deps = fs({ files: { [`${ROOT}/${ORCA.file}`]: "" } });
    const opened = await openProviderFile(deps, ROOT, ORCA);
    if (opened.kind !== "text") {
      throw new Error(`expected the file to open, got ${opened.kind}`);
    }
    const draft = newDraft(ORCA);
    await entriesFor([".env"], "copy", ROOT, opened.root, deps, ids(), draft);

    expect(draft.entries).toEqual([{ id: "i1", path: ".env", mode: "copy", source: ".orca/orca.yaml" }]);
  });

  it("gives an expanded glob's entries the same source, not the directory's", async () => {
    const deps = fs({
      files: { [`${ROOT}/${ORCA.file}`]: "" },
      dirs: { [`${ROOT}/envs`]: ["a.env", "b.env", "notes.md"] },
    });
    const opened = await openProviderFile(deps, ROOT, ORCA);
    if (opened.kind !== "text") {
      throw new Error(`expected the file to open, got ${opened.kind}`);
    }
    const draft = newDraft(ORCA);
    await entriesFor(["envs/*.env"], "link", ROOT, opened.root, deps, ids(), draft);

    expect(draft.entries.map((e) => e.path)).toEqual(["envs/a.env", "envs/b.env"]);
    expect(draft.entries.every((e) => e.source === ".orca/orca.yaml")).toBe(true);
  });

  it("gives a problem the calling context's file", () => {
    expect(problem(ORCA, "malformed", "  two   words  ")).toEqual({
      file: ".orca/orca.yaml",
      reason: "malformed",
      detail: "two words",
    });
    expect(refusal(ORCA, "outside", "../x").file).toBe(".orca/orca.yaml");
  });

  it("moves the stamp when a draft moves to the provider's other file", async () => {
    // orca reads two files, and § 4.3's question is which one asked for a row.
    // One draft answers it twice.
    const deps = fs({ files: { [`${ROOT}/${ORCA.file}`]: "" } });
    const opened = await openProviderFile(deps, ROOT, ORCA);
    if (opened.kind !== "text") {
      throw new Error(`expected the file to open, got ${opened.kind}`);
    }
    const draft = newDraft(ORCA);
    await entriesFor([".env"], "copy", ROOT, opened.root, deps, ids(), draft);
    draft.ctx = { id: "orca", file: ".worktreeinclude" };
    await entriesFor(["shared"], "link", ROOT, opened.root, deps, ids(), draft);

    expect(draft.entries.map((e) => e.source)).toEqual([".orca/orca.yaml", ".worktreeinclude"]);
  });
});

describe("openProviderFile authorizes before it opens", () => {
  it("answers absent for a file that is not there", async () => {
    const opened = await openProviderFile(fs({}), ROOT, ORCA);

    expect(opened.kind).toBe("absent");
  });

  it("refuses a provider file whose relative name escapes the root", async () => {
    const outside: ProviderContext = { id: "orca", file: "../elsewhere/orca.yaml" };
    const deps = fs({ files: { "/elsewhere/orca.yaml": "shared: [x]" } });
    const opened = await openProviderFile(deps, ROOT, outside);
    if (opened.kind !== "problem") {
      throw new Error(`expected a problem, got ${opened.kind}`);
    }

    expect(opened.at).toBe("file");
    expect(opened.problem.file).toBe("../elsewhere/orca.yaml");
    expect(opened.problem.reason).toBe("malformed");
  });

  it("refuses a provider file that is itself a symlink out of the root", async () => {
    // The name is an ordinary relative path; only the RESOLUTION escapes. This
    // is the case that makes the order load-bearing — opening the file first is
    // what would follow the link.
    const deps = fs({
      files: { [`${ROOT}/${ORCA.file}`]: "shared: [x]" },
      links: { [`${ROOT}/${ORCA.file}`]: "/elsewhere/orca.yaml" },
    });
    const opened = await openProviderFile(deps, ROOT, ORCA);
    if (opened.kind !== "problem") {
      throw new Error(`expected a problem, got ${opened.kind}`);
    }

    expect(opened.at).toBe("file");
    expect(opened.problem.file).toBe(".orca/orca.yaml");
  });

  it("names the file rather than calling it absent when it is there and unreadable", async () => {
    const deps: ProviderDeps = {
      ...fs({}),
      readFile: async () => {
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      },
    };
    const opened = await openProviderFile(deps, ROOT, ORCA);
    if (opened.kind !== "problem") {
      throw new Error(`expected a problem, got ${opened.kind}`);
    }

    expect(opened.at).toBe("file");
    expect(opened.problem.reason).toBe("unreadable");
    expect(opened.problem.detail).toContain("EACCES");
  });

  it("reuses a root it is handed rather than preparing a second one", async () => {
    // orca opens two files; the root is proven once. A kit that re-prepared it
    // per file would resolve the checkout twice per read.
    let prepared = 0;
    const deps: ProviderDeps = {
      ...fs({ files: { [`${ROOT}/${ORCA.file}`]: "" } }),
      realpath: async (p) => {
        if (p === ROOT) {
          prepared += 1;
        }
        return p;
      },
    };
    const first = await openProviderFile(deps, ROOT, ORCA);
    if (first.kind !== "text") {
      throw new Error(`expected the file to open, got ${first.kind}`);
    }
    const before = prepared;
    await openProviderFile(deps, ROOT, { id: "orca", file: ".worktreeinclude" }, first.root);

    expect(before).toBeGreaterThan(0);
    expect(prepared).toBe(before);
  });
});

describe("containment stays the kit's one rule", () => {
  it("tells a proven escape from one it could not resolve", async () => {
    const deps = fs({ files: { [`${ROOT}/${ORCA.file}`]: "" } });
    const opened = await openProviderFile(deps, ROOT, ORCA);
    if (opened.kind !== "text") {
      throw new Error(`expected the file to open, got ${opened.kind}`);
    }
    const broken: ProviderDeps = {
      ...deps,
      realpath: async (p) => {
        if (p === `${ROOT}/tangled`) {
          throw Object.assign(new Error("loop"), { code: "ELOOP" });
        }
        return p;
      },
    };

    expect(await contained("../up", ROOT, opened.root, deps)).toBe("outside");
    expect(await contained("tangled", ROOT, opened.root, broken)).toBe("unresolvable");
    expect(refusal(ORCA, "unresolvable", "tangled").reason).toBe("unreadable");
  });
});
