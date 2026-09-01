import { describe, expect, it } from "vitest";
import { ORCA_INCLUDE_FILE, ORCA_PROVIDER_FILES, ORCA_YAML_FILE, orcaAdapter } from "./orcaProvider";
import { MAX_MODEL_ROWS, newBudget, type ProviderDeps } from "./providerKit";

const ROOT = "/repo";

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

function repo(spec: { yaml?: string; include?: string; dirs?: Record<string, string[]> }): ProviderDeps {
  const files: Record<string, string> = {};
  if (spec.yaml !== undefined) {
    files[`${ROOT}/${ORCA_YAML_FILE}`] = spec.yaml;
  }
  if (spec.include !== undefined) {
    files[`${ROOT}/${ORCA_INCLUDE_FILE}`] = spec.include;
  }
  return fs({ files, dirs: spec.dirs });
}

const read = (deps: ProviderDeps) => orcaAdapter.read(deps, ROOT, newBudget());

/** What an orca repository actually looks like. */
const YAML = `
worktree:
  sharedDirectories:
    - node_modules
    - .cache

scripts:
  setup: |
    if [ -f package.json ]; then
      pnpm install
    fi
`;

describe("orcaAdapter", () => {
  it("reads both files: shared directories link, the include list copies", async () => {
    const model = await read(repo({ yaml: YAML, include: ".env\nconfig/local.json\n" }));
    if (model === null) {
      throw new Error("expected orca to be detected");
    }

    expect(model.entries.filter((e) => e.mode === "link").map((e) => e.path)).toEqual(["node_modules", ".cache"]);
    expect(model.entries.filter((e) => e.mode === "copy").map((e) => e.path)).toEqual([".env", "config/local.json"]);
    expect(model.problems).toEqual([]);
  });

  it("[D7] keeps a multi-line setup block as ONE step, still a single program", async () => {
    const model = await read(repo({ yaml: YAML }));
    if (model === null) {
      throw new Error("expected orca to be detected");
    }

    expect(model.setup).toHaveLength(1);
    // Split per line, the `if` and the `fi` become separate steps that are
    // syntax errors on their own. The whole block is what runs.
    expect(model.setup[0]?.script).toBe("if [ -f package.json ]; then\n  pnpm install\nfi");
    expect(model.setup[0]?.kind).toBe("shell");
  });

  it("[§ 4.3] gives each row the file that asked for it", async () => {
    const model = await read(repo({ yaml: YAML, include: "shared.txt\n" }));
    if (model === null) {
      throw new Error("expected orca to be detected");
    }

    expect(model.entries.filter((e) => e.mode === "link").every((e) => e.source === ORCA_YAML_FILE)).toBe(true);
    expect(model.entries.filter((e) => e.mode === "copy").map((e) => e.source)).toEqual([ORCA_INCLUDE_FILE]);
    expect(model.setup.map((s) => s.source)).toEqual([ORCA_YAML_FILE]);
  });

  it("names both files it reads, in read order", () => {
    expect(ORCA_PROVIDER_FILES).toEqual(["orca.yaml", ".worktreeinclude"]);
    expect(orcaAdapter.files).toEqual(ORCA_PROVIDER_FILES);
    expect(orcaAdapter.id).toBe("orca");
  });
});

describe("either file alone is still orca", () => {
  it("reads an orca.yaml with no .worktreeinclude beside it", async () => {
    const model = await read(repo({ yaml: YAML }));
    if (model === null) {
      throw new Error("expected orca to be detected");
    }

    expect(model.entries.map((e) => e.path)).toEqual(["node_modules", ".cache"]);
    expect(model.problems).toEqual([]);
  });

  it("reads a .worktreeinclude with no orca.yaml beside it", async () => {
    const model = await read(repo({ include: ".env\n" }));
    if (model === null) {
      throw new Error("expected orca to be detected");
    }

    expect(model.entries.map((e) => e.path)).toEqual([".env"]);
    expect(model.setup).toEqual([]);
    expect(model.problems).toEqual([]);
  });

  it("answers null only when neither file is there", async () => {
    expect(await read(repo({}))).toBeNull();
  });

  it("[D3] is detected even when the file it has declares nothing", async () => {
    const model = await read(repo({ include: "# only a comment\n\n" }));

    // Present and empty is a repository's own answer. Reading it as an absence
    // would offer some other tool's answer to a question this repo answered.
    expect(model).not.toBeNull();
    expect(model?.entries).toEqual([]);
    expect(model?.problems).toEqual([]);
  });
});

describe("[D6] stated intent, not orca's preconditions", () => {
  it("offers a shared directory the repository does not contain", async () => {
    const model = await read(repo({ yaml: "worktree:\n  sharedDirectories:\n    - node_modules\n" }));

    // What the material turns out to be is an apply-time outcome; the section
    // says what the file declared.
    expect(model?.entries.map((e) => e.path)).toEqual(["node_modules"]);
    expect(model?.problems).toEqual([]);
  });

  it("reports nothing for the keys orca uses for everything else", async () => {
    const model = await read(
      repo({
        yaml: "agents:\n  - claude\nrunner: local\nworktree:\n  sharedDirectories: [node_modules]\n  branchPrefix: x\n",
      }),
    );

    // Reporting them would make every orca repository look misconfigured by an
    // extension that is not orca.
    expect(model?.problems).toEqual([]);
    expect(model?.entries.map((e) => e.path)).toEqual(["node_modules"]);
  });

  it("drops blank lines and comments from the include list without a problem", async () => {
    const model = await read(repo({ include: "\n# secrets\n  .env  \n\n#trailing\nconfig\n" }));

    expect(model?.entries.map((e) => e.path)).toEqual([".env", "config"]);
    expect(model?.problems).toEqual([]);
  });
});

describe("a file that is present and wrong is named, never thrown", () => {
  it("names orca.yaml when its YAML does not parse", async () => {
    const model = await read(repo({ yaml: "worktree:\n  sharedDirectories:\n  - a\n - b\n" }));

    expect(model?.problems).toHaveLength(1);
    expect(model?.problems[0]?.file).toBe(ORCA_YAML_FILE);
    expect(model?.problems[0]?.reason).toBe("malformed");
  });

  it("names orca.yaml when it is not a mapping at all", async () => {
    const model = await read(repo({ yaml: "- just\n- a\n- list\n" }));

    expect(model?.problems.map((p) => p.detail)).toEqual(["The file is not a mapping of keys."]);
  });

  it("refuses a shared directory that escapes the repository, and keeps the rest", async () => {
    const model = await read(repo({ yaml: "worktree:\n  sharedDirectories: [../elsewhere, node_modules]\n" }));

    expect(model?.entries.map((e) => e.path)).toEqual(["node_modules"]);
    expect(model?.problems.map((p) => p.detail)).toEqual(["`../elsewhere` does not resolve inside the repository."]);
  });

  it("refuses a provider file that is itself a symlink out, before it is read", async () => {
    let opened = 0;
    const deps: ProviderDeps = {
      ...fs({
        files: { [`${ROOT}/${ORCA_YAML_FILE}`]: "worktree: {sharedDirectories: [x]}" },
        links: { [`${ROOT}/${ORCA_YAML_FILE}`]: "/elsewhere/orca.yaml" },
      }),
      readFile: async (p) => {
        if (p.endsWith(ORCA_YAML_FILE)) {
          opened += 1;
        }
        throw Object.assign(new Error(`ENOENT ${p}`), { code: "ENOENT" });
      },
    };
    const model = await orcaAdapter.read(deps, ROOT, newBudget());

    // Opening it is what would follow the link, so the refusal has to come
    // first — not after.
    expect(opened).toBe(0);
    expect(model?.problems.map((p) => p.file)).toEqual([ORCA_YAML_FILE]);
    expect(model?.entries).toEqual([]);
  });

  it("names a present-but-unreadable orca.yaml rather than calling it absent", async () => {
    const deps: ProviderDeps = {
      ...fs({}),
      readFile: async (p) => {
        if (p.endsWith(ORCA_YAML_FILE)) {
          throw Object.assign(new Error("denied"), { code: "EACCES" });
        }
        throw Object.assign(new Error(`ENOENT ${p}`), { code: "ENOENT" });
      },
    };
    const model = await orcaAdapter.read(deps, ROOT, newBudget());

    expect(model?.problems.map((p) => p.reason)).toEqual(["unreadable"]);
    expect(model?.problems[0]?.detail).toContain("EACCES");
  });

  it("reports a setup block that is not a script", async () => {
    const model = await read(repo({ yaml: "scripts:\n  setup:\n    - pnpm install\n" }));

    expect(model?.setup).toEqual([]);
    expect(model?.problems.map((p) => p.detail)).toEqual(["`scripts.setup` must be a script."]);
  });
});

describe("[round-1 F002] the setup step is charged like every other row", () => {
  it("is refused when shared-directory expansion already filled the model", async () => {
    const budget = newBudget();
    budget.rows = MAX_MODEL_ROWS;
    const deps = fs({
      files: {
        [`${ROOT}/${ORCA_YAML_FILE}`]:
          "worktree:\n  sharedDirectories: [node_modules]\nscripts:\n  setup: pnpm install\n",
      },
    });

    const model = await orcaAdapter.read(deps, ROOT, budget);

    // One row past a cap already reached is still past it, and this is the
    // append that had no check in front of it.
    expect(model?.setup).toEqual([]);
  });
});
