import { describe, expect, it } from "vitest";
import { ASIMOV_PROVIDER_FILE } from "./asimovProvider";
import { NATIVE_PROVIDER_FILE } from "./nativeProvider";
import { ORCA_INCLUDE_FILE, ORCA_YAML_FILE } from "./orcaProvider";
import { MAX_MODEL_ROWS, MAX_SCAN, type ProviderDeps } from "./providerKit";
import { DETECTION_ORDER, readProvisioning } from "./readProvisioning";
import { VSCODE_TASKS_FILE } from "./vscodeTasksProvider";

const ROOT = "/repo";

type Repo = { native?: string; asimov?: string; orcaYaml?: string; orcaInclude?: string; tasks?: string };

function fs(spec: Repo, dirs: Record<string, string[]> = {}): ProviderDeps {
  const files: Record<string, string> = {};
  const put = (rel: string, text: string | undefined) => {
    if (text !== undefined) {
      files[`${ROOT}/${rel}`] = text;
    }
  };
  put(NATIVE_PROVIDER_FILE, spec.native);
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
    // The native file is first because it is the only one that can name its own
    // base, so it must be consulted before anything it might build on (§ 4.1).
    expect(DETECTION_ORDER.map((a) => a.id)).toEqual(["native", "asimov", "orca", "vscodeTasks"]);
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

  it("falls back to the plain order for a preference whose file is not there", async () => {
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

describe("[round-1 F003] a checkout that will not resolve elects nobody", () => {
  it("does not activate the last adapter in the order when the root fails", async () => {
    const deps: ProviderDeps = {
      ...fs({}),
      realpath: async () => {
        throw Object.assign(new Error("ELOOP"), { code: "ELOOP" });
      },
    };
    const model = await readProvisioning(deps, ROOT);

    // Root failure is neither presence nor absence. Asimov and orca already
    // answer `null` for it; the tasks adapter answered with a model, and the
    // dispatcher reads any model as detection — so an unresolvable checkout
    // named `.vscode/tasks.json` active with no file ever opened.
    expect(model.providers).toEqual([]);
  });
});

describe("a repository can build on a source instead of replacing it", () => {
  const ORCA_SHARED =
    "worktree:\n  sharedDirectories: [node_modules, third_party]\n  \nscripts:\n  setup: pnpm install\n";

  it("lists both files' material, each row naming its own declaring file", async () => {
    const model = await readProvisioning(
      fs({
        native: `{"extends": "orca.yaml", "copy": [".env.local"], "setup": ["node esbuild.js"]}`,
        orcaYaml: ORCA_SHARED,
      }),
      ROOT,
    );

    // Inherited first, then the repository's own — § 4.2's assembly order, not
    // the order the two drafts were built in (design.md D3).
    expect(model.entries.map((e) => [e.path, e.mode, e.source])).toEqual([
      ["node_modules", "link", ORCA_YAML_FILE],
      ["third_party", "link", ORCA_YAML_FILE],
      [".env.local", "copy", NATIVE_PROVIDER_FILE],
    ]);
    expect(model.problems).toEqual([]);
  });

  it("marks the base active too, so it does not offer to switch to itself", async () => {
    const model = await readProvisioning(
      fs({ native: `{"extends": "orca.yaml"}`, orcaYaml: ORCA_SHARED, tasks: TASKS_JSON }),
      ROOT,
    );

    expect(model.providers).toEqual([
      { id: "native", files: [NATIVE_PROVIDER_FILE], active: true },
      { id: "orca", files: [ORCA_YAML_FILE, ORCA_INCLUDE_FILE], active: true },
      { id: "vscodeTasks", files: [VSCODE_TASKS_FILE], active: false },
    ]);
  });

  it("reads the WHOLE base adapter, not only the file that was named", async () => {
    // Orca is one provider over two files by its own design. Reading half of it
    // would produce a model orca itself would not recognize (design.md D2).
    const model = await readProvisioning(
      fs({ native: `{"extends": ".worktreeinclude"}`, orcaYaml: ORCA_SHARED, orcaInclude: "shared.txt\n" }),
      ROOT,
    );

    expect(model.entries.map((e) => [e.path, e.source])).toEqual([
      ["node_modules", ORCA_YAML_FILE],
      ["third_party", ORCA_YAML_FILE],
      ["shared.txt", ORCA_INCLUDE_FILE],
    ]);
  });

  it("inherits nothing when the native file names no base", async () => {
    // Inline keys never implicitly overlay the first detected framework: a file
    // would then inherit whether or not it asked to, and there would be no way
    // to say "only what I wrote here" (§ 4.1).
    const model = await readProvisioning(fs({ native: `{"copy": [".env.local"]}`, orcaYaml: ORCA_SHARED }), ROOT);

    expect(model.entries.map((e) => e.path)).toEqual([".env.local"]);
    expect(model.providers).toEqual([
      { id: "native", files: [NATIVE_PROVIDER_FILE], active: true },
      { id: "orca", files: [ORCA_YAML_FILE, ORCA_INCLUDE_FILE], active: false },
    ]);
  });

  it("offers both files' setup steps, in order, duplicates intact", async () => {
    const model = await readProvisioning(
      fs({ native: `{"extends": "orca.yaml", "setup": ["pnpm install"]}`, orcaYaml: ORCA_SHARED }),
      ROOT,
    );

    // Two providers may legitimately want the same command run twice, and
    // reordering or dropping steps changes their meaning (§ 4.2 step 5).
    expect(model.setup.map((s) => [s.script, s.source])).toEqual([
      ["pnpm install", ORCA_YAML_FILE],
      ["pnpm install", NATIVE_PROVIDER_FILE],
    ]);
  });
});

describe("the repository's own declaration wins the path it shares", () => {
  const ORCA_LINKS = "worktree:\n  sharedDirectories: [node_modules]\n";

  it("offers one row for a shared path, with the native file's mode and source", async () => {
    const model = await readProvisioning(
      fs({ native: `{"extends": "orca.yaml", "copy": ["node_modules"]}`, orcaYaml: ORCA_LINKS }),
      ROOT,
    );

    expect(model.entries.map((e) => [e.path, e.mode, e.source])).toEqual([
      ["node_modules", "copy", NATIVE_PROVIDER_FILE],
    ]);
  });

  it("[D3] still wins when the inherited file would have spent the whole budget", async () => {
    // Base-first BUILD order starves this: the inherited model can consume all
    // 200 rows before a single native entry is appended, and then "the native
    // entry wins" is false precisely when the file is large — the case where a
    // user most needs their own override to hold.
    const many = Array.from({ length: MAX_MODEL_ROWS + 50 }, (_, i) => `d${i}`);
    const model = await readProvisioning(
      fs({
        native: `{"extends": "orca.yaml", "copy": ["node_modules"]}`,
        orcaYaml: `worktree:\n  sharedDirectories: [${["node_modules", ...many].join(", ")}]\n`,
      }),
      ROOT,
    );

    // The scenario is only live if the budget actually ran out — otherwise this
    // asserts nothing about starvation, only about dedupe.
    expect(model.problems.some((p) => p.detail.includes("are not offered"))).toBe(true);
    const shared = model.entries.filter((e) => e.path === "node_modules");
    expect(shared.map((e) => [e.mode, e.source])).toEqual([["copy", NATIVE_PROVIDER_FILE]]);
  });

  it("[D3] offers no row at all when the native file's OWN list runs past the cap", async () => {
    // Native-first does not save an overlap declared past row 199 of the native
    // file's own list: the cap refuses it, and refuses the inherited copy too.
    // The documented outcome is zero rows for that path plus the diagnostic —
    // not a silently shorter list.
    const own = Array.from({ length: MAX_MODEL_ROWS + 5 }, (_, i) => `n${i}`);
    const model = await readProvisioning(
      fs({
        native: `{"extends": "orca.yaml", "copy": ${JSON.stringify([...own, "node_modules"])}}`,
        orcaYaml: "worktree:\n  sharedDirectories: [node_modules]\n",
      }),
      ROOT,
    );

    expect(model.entries.some((e) => e.path === "node_modules")).toBe(false);
    expect(model.problems.some((p) => p.reason === "malformed" && p.detail.includes("are not offered"))).toBe(true);
  });
});

describe("a path the repository removed is shown as deliberate", () => {
  const ORCA_TWO = "worktree:\n  sharedDirectories: [node_modules, .code-review-graph]\n";

  it("moves an inherited path to excluded, keeping the file that declared it", async () => {
    const model = await readProvisioning(
      fs({ native: `{"extends": "orca.yaml", "exclude": [".code-review-graph"]}`, orcaYaml: ORCA_TWO }),
      ROOT,
    );

    expect(model.entries.map((e) => e.path)).toEqual(["node_modules"]);
    expect(model.excluded.map((e) => [e.path, e.source])).toEqual([[".code-review-graph", ORCA_YAML_FILE]]);
  });

  it("[D10] keeps a row the native file both declares and excludes, and reports it", async () => {
    const model = await readProvisioning(
      fs({
        native: `{"extends": "orca.yaml", "copy": [".code-review-graph"], "exclude": [".code-review-graph"]}`,
        orcaYaml: ORCA_TWO,
      }),
      ROOT,
    );

    expect(model.entries.map((e) => [e.path, e.mode, e.source])).toEqual([
      ["node_modules", "link", ORCA_YAML_FILE],
      [".code-review-graph", "copy", NATIVE_PROVIDER_FILE],
    ]);
    expect(model.problems.map((p) => [p.file, p.reason])).toEqual([[NATIVE_PROVIDER_FILE, "unknownKey"]]);
    // The inherited copy was superseded by dedupe, not removed by the user.
    // Listing it here would attribute a choice they did not make.
    expect(model.excluded).toEqual([]);
  });
});

describe("[D2] extends reaches only a present framework file inside the repository", () => {
  const INLINE = `"copy": [".env.local"]`;

  it.each([
    ["a path outside the checkout", `"../elsewhere/worktree.yaml"`],
    ["the native file itself", `".vscode/worktree.json"`],
    ["a file no adapter reads", `"Makefile"`],
  ])("reports %s as a missing base, and still offers the inline keys", async (_name, target) => {
    const model = await readProvisioning(
      fs({ native: `{"extends": ${target}, ${INLINE}}`, asimov: ASIMOV_YAML }),
      ROOT,
    );

    expect(model.problems.map((p) => [p.file, p.reason])).toEqual([[NATIVE_PROVIDER_FILE, "missingExtends"]]);
    expect(model.entries.map((e) => e.path)).toEqual([".env.local"]);
    expect(model.providers.find((p) => p.id === "asimov")?.active).toBe(false);
  });

  it("reports a base naming one orca file while only the other is present", async () => {
    // Adapter presence is not file presence. Resolving by membership alone
    // would select orca, get a non-null model, and silently inherit a file the
    // user never named — with no missingExtends anywhere.
    const model = await readProvisioning(
      fs({ native: `{"extends": "orca.yaml", ${INLINE}}`, orcaInclude: "shared.txt\n" }),
      ROOT,
    );

    expect(model.problems.map((p) => p.reason)).toEqual(["missingExtends"]);
    expect(model.entries.map((e) => e.path)).toEqual([".env.local"]);
  });

  it("refuses a base that is a symlink out of the checkout", async () => {
    const deps: ProviderDeps = {
      ...fs({ native: `{"extends": "asimov/worktree.yaml", ${INLINE}}`, asimov: ASIMOV_YAML }),
      realpath: async (p) => (p.endsWith(ASIMOV_PROVIDER_FILE) ? "/elsewhere/worktree.yaml" : p),
    };
    const model = await readProvisioning(deps, ROOT);

    expect(model.problems.map((p) => p.reason)).toEqual(["missingExtends"]);
    expect(model.entries.map((e) => e.path)).toEqual([".env.local"]);
  });
});

describe("[D5] a preference for a framework answers alone; a preference for native does not", () => {
  const REPO: Repo = {
    native: `{"extends": "orca.yaml", "copy": [".env.local"]}`,
    orcaYaml: "worktree:\n  sharedDirectories: [node_modules]\n",
  };

  it("shows the framework's own answer, without the native file's additions", async () => {
    const model = await readProvisioning(fs(REPO), ROOT, "orca");

    expect(model.entries.map((e) => [e.path, e.source])).toEqual([["node_modules", ORCA_YAML_FILE]]);
    expect(model.providers).toEqual([
      { id: "orca", files: [ORCA_YAML_FILE, ORCA_INCLUDE_FILE], active: true },
      { id: "native", files: [NATIVE_PROVIDER_FILE], active: false },
    ]);
  });

  it("takes the ordinary native path when native is preferred, extends and all", async () => {
    // The way back must lead back: after switching to a framework the native row
    // is inactive, so clicking it sends `provider: "native"`. If that answered
    // alone it would return the inline rows WITHOUT the base they declare.
    const model = await readProvisioning(fs(REPO), ROOT, "native");

    expect(model.entries.map((e) => e.path)).toEqual(["node_modules", ".env.local"]);
  });
});

describe("[D9] one read spends one budget, across every file it touches", () => {
  it("does not exceed the row bound when a native draft at the cap inherits a malformed file", async () => {
    // The defeater: an early-return problem path that builds `problems: []` by
    // hand charges nothing, so the inherited file's malformed diagnostic became
    // a 201st row on a read that was already full.
    const own = Array.from({ length: MAX_MODEL_ROWS + 5 }, (_, i) => `n${i}`);
    const model = await readProvisioning(
      fs({
        native: `{"extends": "asimov/worktree.yaml", "copy": ${JSON.stringify(own)}}`,
        asimov: "copy: [unclosed\n",
      }),
      ROOT,
    );

    const rows =
      model.entries.length + model.setup.length + model.ports.length + model.problems.length + model.excluded.length;
    expect(rows).toBeLessThanOrEqual(MAX_MODEL_ROWS);
    // And the read really did reach the cap, so the bound above is being tested
    // rather than merely satisfied by a short list.
    expect(model.problems.some((p) => p.detail.includes("are not offered"))).toBe(true);
  });
});

describe("one unreadable part never discards the rest of a configuration", () => {
  it("reports a malformed key, an unread key and a missing base as three distinct reasons", async () => {
    const model = await readProvisioning(
      fs({
        native: `{"extends": "Makefile", "exclude": ".x", "nope": 1, "copy": [".env.local"]}`,
        asimov: ASIMOV_YAML,
      }),
      ROOT,
    );

    // Three reasons, not one bucket: the user can act on each differently, and
    // a single "could not read your config" would say which file but not what
    // was lost.
    expect(new Set(model.problems.map((p) => p.reason))).toEqual(
      new Set(["malformed", "unknownKey", "missingExtends"]),
    );
    // None of the three discarded the rest of the file.
    expect(model.entries.map((e) => [e.path, e.source])).toEqual([[".env.local", NATIVE_PROVIDER_FILE]]);
    // The base never resolved, so asimov stays a detected, inactive source.
    expect(model.providers.find((p) => p.id === "asimov")?.active).toBe(false);
  });

  it("keeps the rest of a file whose base is malformed", async () => {
    const model = await readProvisioning(
      fs({ native: `{"extends": "asimov/worktree.yaml", "copy": [".env.local"]}`, asimov: "copy: [unclosed\n" }),
      ROOT,
    );

    expect(model.problems.map((p) => [p.file, p.reason])).toEqual([[ASIMOV_PROVIDER_FILE, "malformed"]]);
    // A base that parsed to nothing does not take the native file's rows with
    // it, and the base is still the source being built on.
    expect(model.entries.map((e) => [e.path, e.source])).toEqual([[".env.local", NATIVE_PROVIDER_FILE]]);
    expect(model.providers.find((p) => p.id === "asimov")?.active).toBe(true);
  });

  it("offers the inline keys of a file that names a base which is not there", async () => {
    const model = await readProvisioning(
      fs({
        native: `{"extends": "asimov/worktree.yaml", "copy": [".env.local"], "ports": {"APP": null}, "setup": ["pnpm i"]}`,
      }),
      ROOT,
    );

    expect(model.problems.map((p) => p.reason)).toEqual(["missingExtends"]);
    expect(model.entries.map((e) => e.path)).toEqual([".env.local"]);
    expect(model.ports.map((p) => p.name)).toEqual(["APP"]);
    expect(model.setup.map((s) => s.script)).toEqual(["pnpm i"]);
  });
});

describe("[round-1 F001] one path is one row, however the two files spell it", () => {
  it("dedupes an inherited spelling the native file wrote differently", async () => {
    // Raw-string comparison offered both, so an inherited LINK survived beside
    // the native COPY for the same destination on disk — and the link is the
    // one that writes through to the main checkout.
    const model = await readProvisioning(
      fs({
        native: `{"extends": "orca.yaml", "copy": ["node_modules"]}`,
        orcaYaml: "worktree:\n  sharedDirectories: ['./node_modules']\n",
      }),
      ROOT,
    );

    expect(model.entries.map((e) => [e.path, e.mode, e.source])).toEqual([
      ["node_modules", "copy", NATIVE_PROVIDER_FILE],
    ]);
  });

  it("excludes an inherited path the exclusion spelled differently", async () => {
    const model = await readProvisioning(
      fs({
        native: `{"extends": "orca.yaml", "exclude": ["./.cache"]}`,
        orcaYaml: "worktree:\n  sharedDirectories: ['.cache', 'node_modules']\n",
      }),
      ROOT,
    );

    expect(model.entries.map((e) => e.path)).toEqual(["node_modules"]);
    // The row keeps the spelling ITS file used. Only the identity was
    // canonical; § 4.3 forbids rewriting what a row displays.
    expect(model.excluded.map((e) => [e.path, e.source])).toEqual([[".cache", ORCA_YAML_FILE]]);
  });

  it("reports the D10 contradiction across two spellings", async () => {
    const model = await readProvisioning(
      fs({
        native: `{"extends": "orca.yaml", "copy": [".cache"], "exclude": ["./.cache"]}`,
        orcaYaml: "worktree:\n  sharedDirectories: ['.cache']\n",
      }),
      ROOT,
    );

    expect(model.entries.map((e) => [e.path, e.source])).toEqual([[".cache", NATIVE_PROVIDER_FILE]]);
    expect(model.problems.map((p) => p.reason)).toEqual(["unknownKey"]);
    expect(model.excluded).toEqual([]);
  });
});

describe("[round-1 F002] the file that was authorized is the file that is read", () => {
  it("inherits the named file's own material, not a sibling's, when it changes under the read", async () => {
    // The base was authorized by opening `.worktreeinclude`; the adapter then
    // opened it a second time. In the gap the file went away, orca read only
    // `orca.yaml`, and the model inherited a setup command from a file the user
    // never named — with orca marked active and no problem at all.
    let opens = 0;
    const deps: ProviderDeps = {
      ...fs({
        native: `{"extends": ".worktreeinclude"}`,
        orcaInclude: ".env\n",
        orcaYaml: "worktree:\n  sharedDirectories: [node_modules]\nscripts:\n  setup: pnpm install\n",
      }),
      readFile: async (p) => {
        if (p.endsWith(ORCA_INCLUDE_FILE)) {
          opens += 1;
          if (opens > 1) {
            throw Object.assign(new Error("gone"), { code: "ENOENT" });
          }
          return ".env\n";
        }
        if (p.endsWith(NATIVE_PROVIDER_FILE)) {
          return `{"extends": ".worktreeinclude"}`;
        }
        if (p.endsWith(ORCA_YAML_FILE)) {
          return "worktree:\n  sharedDirectories: [node_modules]\nscripts:\n  setup: pnpm install\n";
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    };
    const model = await readProvisioning(deps, ROOT);

    expect(model.entries.map((e) => [e.path, e.source])).toContainEqual([".env", ORCA_INCLUDE_FILE]);
  });
});

describe("[round-3 F002] authorization is a result, not a byte source", () => {
  it("keeps the named file's rows when its containment answer changes under the read", async () => {
    // Round 1 pinned `readFile` beneath the second open, and the ENOENT witness
    // above passed because absence falls THROUGH to the pinned bytes. Nothing
    // that fails EARLIER does: root preparation and the containment check both
    // run first, so `.worktreeinclude` resolving outside on the adapter's own
    // open dropped the named file out of the offer while `orca.yaml` — which
    // the user never named — still contributed `node_modules` and a setup
    // command, with orca marked active.
    const INCLUDE_AT = `${ROOT}/${ORCA_INCLUDE_FILE}`;
    let resolutions = 0;
    const deps: ProviderDeps = {
      ...fs({
        native: `{"extends": ".worktreeinclude"}`,
        orcaInclude: ".env\n",
        orcaYaml: "worktree:\n  sharedDirectories: [node_modules]\nscripts:\n  setup: pnpm install\n",
      }),
      realpath: async (p) => {
        if (p !== INCLUDE_AT) {
          return p;
        }
        resolutions += 1;
        // Authorized on the first resolution, outside the checkout on every
        // one after it.
        return resolutions > 1 ? `/elsewhere/${ORCA_INCLUDE_FILE}` : p;
      },
    };
    const model = await readProvisioning(deps, ROOT);

    expect(model.entries.map((e) => [e.path, e.source])).toEqual([
      ["node_modules", ORCA_YAML_FILE],
      [".env", ORCA_INCLUDE_FILE],
    ]);
    // The escape is never reached, so there is nothing to report — the named
    // file was authorized once and answered from that authorization.
    expect(model.problems).toEqual([]);
    expect(model.providers.find((p) => p.id === "orca")?.active).toBe(true);
  });
});

describe("[round-7 F001, F013] identity is the declared spelling, and nothing folds it", () => {
  const CASE_REPO: Repo = {
    native: `{"extends": "orca.yaml", "copy": ["MixedCase"]}`,
    orcaYaml: "worktree:\n  sharedDirectories: [mixedcase]\n",
  };

  it("is one row for one path however the two files spell it", async () => {
    // Round-1 F001, and the half of this decision that never moved: two
    // spellings of one path differing only by dot-segments are one row and one
    // exclusion target, on every platform.
    const model = await readProvisioning(
      fs({
        native: `{"extends": "orca.yaml", "copy": ["a/../node_modules"]}`,
        orcaYaml: "worktree:\n  sharedDirectories: [./node_modules]\n",
      }),
      ROOT,
    );

    expect(model.entries.map((e) => [e.path, e.mode])).toEqual([["a/../node_modules", "copy"]]);
  });

  it("keeps case-variant spellings apart on EVERY platform", async () => {
    // No platform guard, deliberately. The version this replaced skipped itself
    // wherever the fold was active, so it could only ever pass — the one lane
    // that could have caught round-7 F013 was the lane it declined to run on.
    const model = await readProvisioning(fs(CASE_REPO), ROOT);

    expect(model.entries.map((e) => [e.path, e.source])).toEqual([
      ["mixedcase", ORCA_YAML_FILE],
      ["MixedCase", NATIVE_PROVIDER_FILE],
    ]);
  });

  it.each([
    ["\u0130", "i\u0307", "NTFS keeps these apart; toLowerCase does not"],
    ["\u1E9E", "\u00DF", "same"],
    ["\u03CF", "\u03D7", "same"],
    ["Stra\u00DFe", "STRASSE", "one file on APFS, two keys under any fold"],
    ["\uFB00", "ff", "same"],
    ["foo", "foo.", "one object to Win32; no case fold closes it"],
  ])("conserves both declarations for %s against %s", async (inherited, native) => {
    // The count is the claim. Every mechanism this replaced failed by mapping
    // two declarations to one key, and every one of those failures deleted a
    // row the repository had written down (design.md, obligation ledger).
    const model = await readProvisioning(
      fs({
        native: JSON.stringify({ extends: "orca.yaml", copy: [native] }),
        orcaYaml: `worktree:\n  sharedDirectories: [${JSON.stringify(inherited)}]\n`,
      }),
      ROOT,
    );

    expect(model.entries.length + model.excluded.length).toBe(2);
    expect(model.entries.map((e) => e.path).sort()).toEqual([inherited, native].sort());
  });

  it("[round-5 F009] makes NO filesystem call to decide identity, not even for a raw exclusion", async () => {
    // The witness for F009, and the reason it is closed by construction rather
    // than fixed: `exclude` is a raw list off the provider file, and the
    // mechanism this replaced handed it to `realpath`, which resolved
    // `../outside` clean out of the checkout. Identity now reads nothing at all,
    // so an escaping spelling has nothing to escape through.
    const asked: string[] = [];
    const base = fs({
      native: `{"extends": "orca.yaml", "exclude": ["../outside/probe", "/etc/passwd", "..\\\\outside\\\\probe"]}`,
      orcaYaml: "worktree:\n  sharedDirectories: [kept]\n",
    });
    const model = await readProvisioning(
      {
        ...base,
        realpath: async (p) => {
          asked.push(p);
          return p;
        },
        lstat: async (p) => {
          asked.push(p);
          return {};
        },
      },
      ROOT,
    );

    // The read still happens — the provider files are opened and contained.
    expect(model.entries.map((e) => e.path)).toEqual(["kept"]);
    // ...but nothing outside the checkout was ever named to the filesystem.
    expect(asked.filter((p) => !p.startsWith(`${ROOT}/`) && p !== ROOT)).toEqual([]);
    // NOT asserted: that `asked` is empty, nor that no declared path appears in
    // it. Both are false and would have to be weakened later — provider files
    // are opened, and `kept` is resolved on purpose, because CONTAINMENT must
    // check where a declared path lands. That is the security property and it
    // stays. What identity must not do is let the answer change the model.
    expect(asked.some((p) => p.includes("outside") || p.includes("passwd"))).toBe(false);
  });

  it("gives the same model whatever the filesystem answers about the declared paths", async () => {
    // The witness for "identity reads nothing", stated so it can fail. Identity
    // is a pure function of the declared spelling, so two filesystems that
    // disagree about every declared path — one resolving each to itself, one
    // resolving each to a single shared canonical path, which is exactly what a
    // case-folding volume would report — must still produce the same rows.
    // Under the mechanism this replaced the second fake collapsed the two rows.
    const repo = {
      native: `{"extends": "orca.yaml", "copy": ["MixedCase"]}`,
      orcaYaml: "worktree:\n  sharedDirectories: [mixedcase]\n",
    };
    const asItself = await readProvisioning(fs(repo), ROOT);
    const base = fs(repo);
    const asOneFile = await readProvisioning(
      {
        ...base,
        realpath: async (p) => (p.endsWith("MixedCase") || p.endsWith("mixedcase") ? `${ROOT}/mixedcase` : p),
      },
      ROOT,
    );

    expect(asOneFile.entries.map((e) => [e.path, e.mode, e.source])).toEqual(
      asItself.entries.map((e) => [e.path, e.mode, e.source]),
    );
    expect(asOneFile.entries.length).toBe(2);
  });

  it("matches an exclusion against the normalized path, not the raw spelling", async () => {
    const model = await readProvisioning(
      fs({
        native: `{"extends": "orca.yaml", "exclude": ["./mixedcase"]}`,
        orcaYaml: "worktree:\n  sharedDirectories: [mixedcase]\n",
      }),
      ROOT,
    );

    expect(model.entries).toEqual([]);
    expect(model.excluded.map((e) => [e.path, e.source])).toEqual([["mixedcase", ORCA_YAML_FILE]]);
  });

  it("reports an exclusion that matched nothing, and keeps the row it missed", async () => {
    // Both halves. Reporting alone would be noise; keeping the row alone is the
    // old silent behaviour. Under D1 the spelling IS the identity, so a rule
    // spelled one way against an entry spelled another does nothing at all, and
    // the only thing that tells the user is this report.
    const model = await readProvisioning(
      fs({
        native: `{"extends": "orca.yaml", "exclude": ["MixedCase"]}`,
        orcaYaml: "worktree:\n  sharedDirectories: [mixedcase]\n",
      }),
      ROOT,
    );

    expect(model.entries.map((e) => e.path)).toEqual(["mixedcase"]);
    expect(model.excluded).toEqual([]);
    expect(model.problems.map((p) => p.reason)).toEqual(["unknownKey"]);
    expect(model.problems[0]?.detail).toContain("MixedCase");
  });

  it("still reports the contradiction when one file both declares and excludes a path", async () => {
    const model = await readProvisioning(fs({ native: `{"copy": ["x"], "exclude": ["./x"]}` }), ROOT);

    expect(model.entries.map((e) => e.path)).toEqual(["x"]);
    expect(model.problems.map((p) => p.reason)).toEqual(["unknownKey"]);
    expect(model.excluded).toEqual([]);
  });
});
