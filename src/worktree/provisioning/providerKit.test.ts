import { describe, expect, it } from "vitest";
import { asimovAdapter } from "./asimovProvider";
import { orcaAdapter } from "./orcaProvider";
import {
  type AdapterRead,
  addSetup,
  contained,
  contendersOf,
  emitted,
  emptyModel,
  entriesFor,
  ids,
  MAX_MODEL_ROWS,
  MAX_SCAN,
  newBudget,
  newDraft,
  openProviderFile,
  type ProviderContext,
  type ProviderDeps,
  problem,
  readInlineKeys,
  refusal,
  scanNames,
} from "./providerKit";
import { vscodeTasksAdapter } from "./vscodeTasksProvider";

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

  it("refuses non-portable and reserved port environment names before offering them", async () => {
    const deps = fs({ files: { [`${ROOT}/${ORCA.file}`]: "" } });
    const opened = await openProviderFile(deps, ROOT, ORCA);
    if (opened.kind !== "text") {
      throw new Error(`expected the file to open, got ${opened.kind}`);
    }
    const draft = newDraft(ORCA);

    await readInlineKeys(
      {
        ports: {
          APP_PORT: null,
          "BAD-NAME": null,
          "1PORT": null,
          ANYWHERE_TERMINAL_WORKTREE_PATH: null,
          aSiMoV_ChAnGe_Id: null,
        },
      },
      new Set(["ports"]),
      ROOT,
      opened.root,
      deps,
      ids(),
      draft,
    );

    expect(draft.ports.map((port) => port.name)).toEqual(["APP_PORT"]);
    expect(draft.problems).toHaveLength(4);
    expect(draft.problems.map((entry) => entry.reason)).toEqual(["malformed", "malformed", "malformed", "malformed"]);
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

describe("one read, two accounts", () => {
  /** A directory of `count` names, none of which the glob below can match. */
  function noise(count: number): string[] {
    return Array.from({ length: count }, (_, i) => `n${String(i).padStart(5, "0")}.txt`);
  }

  it("[D9] two non-matching globs share one scan budget rather than one each", async () => {
    // The defect this closes: a per-call counter let each glob scan MAX_SCAN
    // names while emitting nothing, so the ROW cap — the only budget there
    // was — never engaged and the real cost was unbounded in the number of
    // globs a repository declares.
    let seen = 0;
    const deps: ProviderDeps = {
      ...fs({ files: { [`${ROOT}/${ORCA.file}`]: "" } }),
      readdir: async function* (p: string) {
        for (const name of noise(MAX_SCAN)) {
          seen += 1;
          yield `${p === `${ROOT}/a` ? "a" : "b"}-${name}`;
        }
      },
    };
    const opened = await openProviderFile(deps, ROOT, ORCA);
    if (opened.kind !== "text") {
      throw new Error(`expected the file to open, got ${opened.kind}`);
    }
    const budget = newBudget();
    const draft = newDraft(ORCA, budget);
    await entriesFor(["a/*.env", "b/*.env"], "copy", ROOT, opened.root, deps, ids(), draft);

    expect(draft.entries).toEqual([]);
    expect(budget.scanned).toBeLessThanOrEqual(MAX_SCAN);
    // One name past the cap is what breaking out of an iterator costs; two
    // full directories would be twice MAX_SCAN.
    expect(seen).toBeLessThanOrEqual(MAX_SCAN + 1);
  });

  it("[D9] a second glob is refused outright once the scan budget is spent", async () => {
    const deps: ProviderDeps = {
      ...fs({ files: { [`${ROOT}/${ORCA.file}`]: "" } }),
      readdir: async (p: string) => (p === `${ROOT}/a` ? noise(MAX_SCAN + 10) : ["wanted.env"]),
    };
    const opened = await openProviderFile(deps, ROOT, ORCA);
    if (opened.kind !== "text") {
      throw new Error(`expected the file to open, got ${opened.kind}`);
    }
    const draft = newDraft(ORCA, newBudget());
    await entriesFor(["a/*.env", "b/*.env"], "copy", ROOT, opened.root, deps, ids(), draft);

    // Reported, not silently dropped: the shown list must not differ from the
    // list that would be copied.
    expect(draft.entries).toEqual([]);
    // The two say different things now, and they are different things. `a/*.env`
    // was read and found too large; `b/*.env` was never read at all, because the
    // account was already spent when its turn came (round-1 F005). The old
    // wording said the second directory was too large to scan, which was untrue
    // of a directory holding one file that nothing ever looked at.
    expect(draft.problems.map((p) => p.detail)).toEqual([
      "`a/*.env` names a directory too large to scan; it is not offered.",
      "`b/*.env` is past the scan budget; it is not offered.",
    ]);
  });

  it("[D9] two drafts sharing one budget stop at the combined row cap, reported once", async () => {
    const deps = fs({ files: { [`${ROOT}/${ORCA.file}`]: "" } });
    const opened = await openProviderFile(deps, ROOT, ORCA);
    if (opened.kind !== "text") {
      throw new Error(`expected the file to open, got ${opened.kind}`);
    }
    const budget = newBudget();
    const half = Array.from({ length: MAX_MODEL_ROWS }, (_, i) => `f${String(i).padStart(4, "0")}.env`);
    const first = newDraft(ORCA, budget);
    const second = newDraft({ id: "orca", file: ".worktreeinclude" }, budget);
    await entriesFor(half, "copy", ROOT, opened.root, deps, ids(), first);
    await entriesFor(half, "link", ROOT, opened.root, deps, ids(), second);

    expect(budget.rows).toBeLessThanOrEqual(MAX_MODEL_ROWS);
    expect(first.entries.length + second.entries.length).toBeLessThan(2 * MAX_MODEL_ROWS);
    // The cap belongs to the budget, so the reason is recorded once no matter
    // how many drafts run out on it.
    const caps = [...first.problems, ...second.problems].filter((p) => p.detail.startsWith("More than"));
    expect(caps).toHaveLength(1);
  });

  it("a fresh budget starts empty, and carries the read's one id sequence", () => {
    const budget = newBudget();

    expect(budget).toMatchObject({ rows: 0, scanned: 0, capped: false });
    // The sequence is the budget's, not each adapter's: two adapters taking
    // ids from one budget cannot both mint `i1` (design.md D7).
    expect([budget.nextId(), budget.nextId()]).toEqual(["i1", "i2"]);
    expect(newBudget().nextId()).toBe("i1");
  });
});

describe("[round-1 F002] the cap lives where rows are appended", () => {
  // 1_2 wrote "every append is charged, so the count cannot drift from the
  // collections it claims to bound" — and then charged without ever refusing.
  // A caller that forgot `full()` was unbounded, which is exactly what the VS
  // Code task loop did. Enforcing at the append is what makes the comment true.
  it("refuses a setup step once the model is full, however the caller loops", () => {
    const draft = newDraft(ORCA, newBudget());

    let taken = 0;
    for (let i = 0; i < MAX_MODEL_ROWS + 50; i += 1) {
      if (addSetup(draft, { id: `s${i}`, kind: "shell", script: "echo", source: ORCA.file })) {
        taken += 1;
      }
    }

    expect(taken).toBeLessThan(MAX_MODEL_ROWS);
    expect(draft.setup.length).toBeLessThan(MAX_MODEL_ROWS);
    expect(emitted(draft)).toBeLessThanOrEqual(MAX_MODEL_ROWS);
    // Refused, and said so — a shorter list than the repository asked for is
    // never allowed to be a silent one.
    expect(draft.problems.map((x) => x.reason)).toContain("malformed");
  });

  it("would not pass if the append merely counted", () => {
    // The mutant this kills: `addSetup` incrementing the budget and pushing
    // anyway. Without this the suite above could be satisfied by a caller-side
    // check that a future caller forgets, which is the defect being fixed.
    const draft = newDraft(ORCA, newBudget());
    for (let i = 0; i < MAX_MODEL_ROWS + 5; i += 1) {
      addSetup(draft, { id: `s${i}`, kind: "shell", script: "echo", source: ORCA.file });
    }

    expect(draft.setup.length + draft.problems.length).toBeLessThanOrEqual(MAX_MODEL_ROWS);
  });
});

describe("[round-1 F005] an exhausted scan account reads nothing more", () => {
  it("does not pull a name when the account is already spent", async () => {
    const budget = newBudget();
    budget.scanned = MAX_SCAN;
    let pulled = 0;
    const listing = (async function* () {
      pulled += 1;
      yield "a.txt";
    })();

    const scanned = await scanNames(listing, budget);

    // `for await` asks for a name and only then checks the room, so every later
    // glob read one more name than the bound allows. D9 says MAX_SCAN, and a
    // bound that admits one extra read per declaration is a different bound.
    expect(pulled).toBe(0);
    expect(scanned.names).toEqual([]);
    expect(scanned.truncated).toBe(true);
  });

  it("does not enumerate a directory it has no room to take", async () => {
    // The syscall is the cost, so the check has to come before it. Returning a
    // truncated result after the read has already happened bounds the array and
    // not the work.
    let listed = 0;
    const deps = fs({ files: { [`${ROOT}/${ORCA.file}`]: "" }, dirs: { "/repo/big": ["n0.env"] } });
    const counting: ProviderDeps = {
      ...deps,
      readdir: async (dirPath) => {
        listed += 1;
        return deps.readdir(dirPath) as Promise<readonly string[]>;
      },
    };
    const opened = await openProviderFile(counting, ROOT, ORCA);
    if (opened.kind !== "text") {
      throw new Error(`expected the file to open, got ${opened.kind}`);
    }
    const budget = newBudget();
    budget.scanned = MAX_SCAN;
    const draft = newDraft(ORCA, budget);

    await entriesFor(["big/*.env"], "copy", ROOT, opened.root, counting, ids(), draft);

    expect(listed).toBe(0);
    expect(draft.entries).toEqual([]);
  });
});

describe("[D1] an adapter answers from one open of each file it reads", () => {
  // The seam widened so `.vscode/worktree.json` can hand back the file it
  // builds on ALONGSIDE its model. The tempting alternative — leave `read()`
  // returning a model and ask the module again for its `extends` — is what this
  // refuses: a second open is a second chance for the file to change under the
  // check, so the target could name a file other than the one whose inline keys
  // were parsed. Counting opens is how that stays refused.
  const ADAPTERS = [
    { name: "asimov", adapter: asimovAdapter, files: { "asimov/worktree.yaml": "copy:\n  - .env\n" } },
    {
      name: "orca",
      adapter: orcaAdapter,
      files: { "orca.yaml": "worktree:\n  sharedDirectories: [node_modules]\n", ".worktreeinclude": "shared.txt\n" },
    },
    {
      name: "vscodeTasks",
      adapter: vscodeTasksAdapter,
      files: {
        ".vscode/tasks.json":
          '{ "tasks": [{ "label": "i", "type": "shell", "command": "pnpm i", "runOptions": { "runOn": "worktreeCreated" } }] }',
      },
    },
  ];

  it.each(ADAPTERS)("$name opens each of its files once", async ({ adapter, files }) => {
    const opens: string[] = [];
    const held: Record<string, string> = {};
    for (const [rel, text] of Object.entries(files)) {
      held[`${ROOT}/${rel}`] = text;
    }
    const deps: ProviderDeps = {
      readFile: async (p) => {
        opens.push(p);
        const text = held[p];
        if (text === undefined) {
          throw Object.assign(new Error(`ENOENT ${p}`), { code: "ENOENT" });
        }
        return text;
      },
      readdir: async () => [],
      realpath: async (p) => p,
      lstat: async () => ({}),
    };

    const answer = await adapter.read(deps, ROOT, newBudget());

    expect(answer).not.toBeNull();
    expect(opens.length).toBe(new Set(opens).size);
  });

  it("carries a declared base and exclusions out of the same record", () => {
    // The shape the native adapter fills in 2_1. Asserted here so the seam is
    // not silently narrowed back to a bare model before anything uses it.
    const answer: AdapterRead = { model: emptyModel(), extends: "asimov/worktree.yaml", exclude: [".cache"] };

    expect(answer.extends).toBe("asimov/worktree.yaml");
    expect(answer.exclude).toEqual([".cache"]);
  });
});

// [round-7 F007 / D3c] A group used to carry a pre-computed winner. A winner
// computed against the whole offer is stale the moment the user unticks a row,
// which is how the dialog kept stating an arriving set the apply then refused.
// What the group carries now is WHICH members the repository's own file
// declared, so both sides answer the same question against the selection in
// front of them: more than one → refused entire, exactly one → favoured, none →
// nothing claims priority.
describe("[round-7 F007] a contender group names the repository's own declarations", () => {
  const NATIVE = ".vscode/worktree.json";
  const INHERITED = "asimov/worktree.yaml";
  const at = (path: string, source: string, id: string) => ({ id, path, mode: "copy" as const, source });

  it("names the one repository declaration in an ordinary contest", () => {
    const groups = contendersOf([at("MixedCase", NATIVE, "i1"), at("mixedcase", INHERITED, "i2")], NATIVE);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.natives).toEqual(["i1"]);
  });

  it("names both when the repository's own file declares the destination twice", () => {
    const groups = contendersOf(
      [at("MixedCase", NATIVE, "i1"), at("MIXEDCASE", NATIVE, "i2"), at("mixedcase", INHERITED, "i3")],
      NATIVE,
    );
    expect(groups[0]?.natives).toEqual(["i1", "i2"]);
  });

  it("names none when nothing in the group claims priority", () => {
    const groups = contendersOf([at("MixedCase", INHERITED, "i1"), at("mixedcase", INHERITED, "i2")], NATIVE);
    expect(groups[0]?.natives).toEqual([]);
  });

  it("names none at all when no repository file was given", () => {
    const groups = contendersOf([at("MixedCase", NATIVE, "i1"), at("mixedcase", INHERITED, "i2")]);
    expect(groups[0]?.natives).toEqual([]);
  });

  it("keeps the list a subset of the members, in members order", () => {
    const groups = contendersOf(
      [at("mixedcase", INHERITED, "i1"), at("MixedCase", NATIVE, "i2"), at("MIXEDCASE", NATIVE, "i3")],
      NATIVE,
    );
    const group = groups[0];
    expect(group?.members).toEqual(["i1", "i2", "i3"]);
    expect(group?.natives).toEqual(["i2", "i3"]);
  });

  it("drops a group the folding key does not actually collide", () => {
    expect(contendersOf([at("a", NATIVE, "i1"), at("b", INHERITED, "i2")], NATIVE)).toEqual([]);
  });
});
