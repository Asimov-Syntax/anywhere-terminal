import { describe, expect, it } from "vitest";
import { ASIMOV_PROVIDER_FILE } from "./asimovProvider";
import { ORCA_INCLUDE_FILE, ORCA_YAML_FILE } from "./orcaProvider";
import { MAX_SCAN, type ProviderDeps } from "./providerKit";
import { DETECTION_ORDER, readProvisioning } from "./readProvisioning";
import { VSCODE_TASKS_FILE } from "./vscodeTasksProvider";

const ROOT = "/repo";

type Repo = { asimov?: string; orcaYaml?: string; orcaInclude?: string; tasks?: string };

function fs(spec: Repo, dirs: Record<string, string[]> = {}): ProviderDeps {
  const files: Record<string, string> = {};
  const put = (rel: string, text: string | undefined) => {
    if (text !== undefined) {
      files[`${ROOT}/${rel}`] = text;
    }
  };
  put(ASIMOV_PROVIDER_FILE, spec.asimov);
  put(ORCA_YAML_FILE, spec.orcaYaml);
  put(ORCA_INCLUDE_FILE, spec.orcaInclude);
  put(VSCODE_TASKS_FILE, spec.tasks);
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
    realpath: async (p) => p,
    lstat: async () => ({}),
  };
}

const ASIMOV_YAML = "copy:\n  - .env\n";
const ORCA_YAML = "worktree:\n  sharedDirectories: [node_modules]\n";
const TASKS_JSON = `{ "tasks": [{ "label": "i", "type": "shell", "command": "pnpm i", "runOptions": { "runOn": "worktreeCreated" } }] }`;

describe("one source answers", () => {
  it("reads asimov alone", async () => {
    const model = await readProvisioning(fs({ asimov: ASIMOV_YAML }), ROOT);

    expect(model.entries.map((e) => e.path)).toEqual([".env"]);
    expect(model.providers).toEqual([{ id: "asimov", files: [ASIMOV_PROVIDER_FILE], active: true }]);
  });

  it("reads orca alone", async () => {
    const model = await readProvisioning(fs({ orcaYaml: ORCA_YAML }), ROOT);

    expect(model.entries.map((e) => e.path)).toEqual(["node_modules"]);
    expect(model.providers.map((p) => p.id)).toEqual(["orca"]);
  });

  it("reads the task file alone", async () => {
    const model = await readProvisioning(fs({ tasks: TASKS_JSON }), ROOT);

    expect(model.setup.map((s) => s.script)).toEqual(["pnpm i"]);
    expect(model.providers.map((p) => p.id)).toEqual(["vscodeTasks"]);
  });

  it("answers an empty model when a repository configures nothing", async () => {
    const model = await readProvisioning(fs({}), ROOT);

    expect(model.providers).toEqual([]);
    expect(model.entries).toEqual([]);
    expect(model.problems).toEqual([]);
  });
});

describe("exactly one detected source supplies the offer", () => {
  const ALL: Repo = {
    asimov: ASIMOV_YAML,
    orcaYaml: ORCA_YAML,
    orcaInclude: "shared.txt\n",
    tasks: TASKS_JSON,
  };

  it("takes the first in order and lists the rest inactive", async () => {
    const model = await readProvisioning(fs(ALL), ROOT);

    expect(model.entries.map((e) => e.path)).toEqual([".env"]);
    // None of orca's or the task file's rows are among the offered ones.
    expect(model.entries.map((e) => e.source)).toEqual([ASIMOV_PROVIDER_FILE]);
    expect(model.setup).toEqual([]);
    expect(model.providers).toEqual([
      { id: "asimov", files: [ASIMOV_PROVIDER_FILE], active: true },
      { id: "orca", files: [ORCA_YAML_FILE, ORCA_INCLUDE_FILE], active: false },
      { id: "vscodeTasks", files: [VSCODE_TASKS_FILE], active: false },
    ]);
  });

  it("[D8] names both of orca's files on its row", async () => {
    const model = await readProvisioning(fs({ asimov: ASIMOV_YAML, orcaInclude: "x\n" }), ROOT);

    // One provider over two files by orca's own design; with either present, no
    // single value truthfully answers which file it read.
    expect(model.providers.find((p) => p.id === "orca")?.files).toEqual([ORCA_YAML_FILE, ORCA_INCLUDE_FILE]);
  });

  it("chooses without enumerating a single directory", async () => {
    const listed: string[] = [];
    const deps: ProviderDeps = {
      ...fs(ALL),
      readdir: async (p: string) => {
        listed.push(p);
        return ["asimov", "orca.yaml", ".worktreeinclude", ".vscode"];
      },
    };
    const model = await readProvisioning(deps, ROOT);

    // The order is a module constant precisely so two users of one repository
    // are never shown different sections. An implementation that listed a
    // directory to find its providers could answer differently on two machines;
    // this asserts none is listed at all, so none can.
    expect(listed).toEqual([]);
    expect(model.providers[0]).toEqual({ id: "asimov", files: [ASIMOV_PROVIDER_FILE], active: true });
  });

  it("is the order the constant declares", () => {
    expect(DETECTION_ORDER.map((a) => a.id)).toEqual(["asimov", "orca", "vscodeTasks"]);
  });
});

describe("[D3] a present source answers even when its answer is nothing", () => {
  it("offers an EMPTY section for a comment-only asimov file beside a populated orca one", async () => {
    const model = await readProvisioning(fs({ asimov: "# nothing to bring over\n", orcaYaml: ORCA_YAML }), ROOT);

    // The repository already answered this question. Falling through to orca
    // would offer another tool's answer, silently.
    expect(model.entries).toEqual([]);
    expect(model.setup).toEqual([]);
    expect(model.problems).toEqual([]);
    expect(model.providers).toEqual([
      { id: "asimov", files: [ASIMOV_PROVIDER_FILE], active: true },
      { id: "orca", files: [ORCA_YAML_FILE, ORCA_INCLUDE_FILE], active: false },
    ]);
  });

  it("stops at a first source that is present and unreadable, and reports it", async () => {
    const deps: ProviderDeps = {
      ...fs({ orcaYaml: ORCA_YAML }),
      readFile: async (p) => {
        if (p.endsWith(ASIMOV_PROVIDER_FILE)) {
          throw Object.assign(new Error("denied"), { code: "EACCES" });
        }
        return p.endsWith(ORCA_YAML_FILE)
          ? ORCA_YAML
          : Promise.reject(Object.assign(new Error("x"), { code: "ENOENT" }));
      },
    };
    const model = await readProvisioning(deps, ROOT);

    expect(model.problems.map((p) => p.file)).toEqual([ASIMOV_PROVIDER_FILE]);
    expect(model.entries).toEqual([]);
    expect(model.providers[0]).toEqual({ id: "asimov", files: [ASIMOV_PROVIDER_FILE], active: true });
  });
});

describe("a preference reorders one entry, it does not replace the order", () => {
  const BOTH: Repo = { asimov: ASIMOV_YAML, orcaYaml: ORCA_YAML };

  it("lets a later source supply the offer when it is preferred", async () => {
    const model = await readProvisioning(fs(BOTH), ROOT, "orca");

    expect(model.entries.map((e) => e.path)).toEqual(["node_modules"]);
    expect(model.providers).toEqual([
      { id: "orca", files: [ORCA_YAML_FILE, ORCA_INCLUDE_FILE], active: true },
      { id: "asimov", files: [ASIMOV_PROVIDER_FILE], active: false },
    ]);
  });

  it("falls back to the plain order for a preference that is not there", async () => {
    const model = await readProvisioning(fs(BOTH), ROOT, "vscodeTasks");

    expect(model.providers[0]).toEqual({ id: "asimov", files: [ASIMOV_PROVIDER_FILE], active: true });
    expect(model.entries.map((e) => e.path)).toEqual([".env"]);
  });

  it("falls back to the plain order for a preference no adapter answers to", async () => {
    const model = await readProvisioning(fs(BOTH), ROOT, "native");

    expect(model.providers[0]?.id).toBe("asimov");
  });
});

describe("[D9] one budget, and nothing spent on a source that did not win", () => {
  it("charges a losing source no scan at all", async () => {
    let listed = 0;
    const deps: ProviderDeps = {
      ...fs({ asimov: "# nothing\n", orcaYaml: "worktree:\n  sharedDirectories: [big/*]\n" }),
      readdir: async () => {
        listed += 1;
        return [];
      },
    };
    const model = await readProvisioning(deps, ROOT);

    // orca is named so the section can offer to switch to it, and its rows are
    // never built: expanding a glob for a section nobody is shown spends the
    // shared account on nothing.
    expect(model.providers.map((p) => p.id)).toEqual(["asimov", "orca"]);
    expect(listed).toBe(0);
  });

  it("gives the source that did win one account across its globs", async () => {
    let seen = 0;
    const noise = Array.from({ length: MAX_SCAN }, (_, i) => `n${i}.txt`);
    const deps: ProviderDeps = {
      ...fs({ asimov: "copy:\n  - a/*.env\n  - b/*.env\n" }),
      readdir: async function* () {
        for (const name of noise) {
          seen += 1;
          yield name;
        }
      },
    };
    await readProvisioning(deps, ROOT);

    // Per-glob accounts would let one file's declarations cost MAX_SCAN each.
    expect(seen).toBeLessThanOrEqual(MAX_SCAN + 1);
  });
});
