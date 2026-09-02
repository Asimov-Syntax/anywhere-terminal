import { describe, expect, it } from "vitest";
import { NATIVE_PROVIDER_FILE, nativeAdapter } from "./nativeProvider";
import { MAX_MODEL_ROWS, newBudget, type ProviderDeps } from "./providerKit";

const ROOT = "/repo";

/**
 * A fake checkout, on the same terms as `asimovProvider.test.ts`: `files` maps
 * absolute paths to text, `dirs` maps absolute directories to the names inside
 * them, and containment resolves lexically because `realpath` is the identity.
 * The symlink cases belong to `resolvedPathBoundary.test.ts`.
 */
function fs(spec: { files?: Record<string, string>; dirs?: Record<string, string[]> }): ProviderDeps {
  const files = spec.files ?? {};
  const dirs = spec.dirs ?? {};
  return {
    readFile: async (p) => {
      const held = files[p];
      if (held === undefined) {
        throw Object.assign(new Error(`ENOENT ${p}`), { code: "ENOENT" });
      }
      return held;
    },
    readdir: async (p) => {
      const held = dirs[p];
      if (held === undefined) {
        throw Object.assign(new Error(`ENOENT ${p}`), { code: "ENOENT" });
      }
      return held;
    },
    realpath: async (p) => p,
    lstat: async () => ({}),
  };
}

function withJson(text: string, dirs?: Record<string, string[]>): ProviderDeps {
  return fs({ files: { [`${ROOT}/${NATIVE_PROVIDER_FILE}`]: text }, dirs: { [ROOT]: [".vscode"], ...dirs } });
}

function read(deps: ProviderDeps) {
  return nativeAdapter.read(deps, ROOT, newBudget());
}

describe("the native file's own declarations", () => {
  it("reads the four inline keys, the base it names, and what it removes", async () => {
    // § 3.4's example, verbatim in shape: one comment, one trailing comma, all
    // six keys. The parser is the one VS Code uses, so both are the format.
    const answer = await read(
      withJson(`{
  // What this repository builds on.
  "extends": "asimov/worktree.yaml",
  "copy": [".env.local"],
  "link": ["third_party"],
  "setup": ["pnpm install --frozen-lockfile"],
  "ports": { "APP": null },
  "exclude": [".code-review-graph"],
}`),
    );

    expect(answer).not.toBeNull();
    expect(answer?.extends).toBe("asimov/worktree.yaml");
    expect(answer?.exclude).toEqual([".code-review-graph"]);
    expect(answer?.model.entries.map((e) => [e.path, e.mode, e.source])).toEqual([
      [".env.local", "copy", NATIVE_PROVIDER_FILE],
      ["third_party", "link", NATIVE_PROVIDER_FILE],
    ]);
    expect(answer?.model.setup.map((s) => [s.script, s.source])).toEqual([
      ["pnpm install --frozen-lockfile", NATIVE_PROVIDER_FILE],
    ]);
    expect(answer?.model.ports.map((p) => [p.name, p.source])).toEqual([["APP", NATIVE_PROVIDER_FILE]]);
    expect(answer?.model.problems).toEqual([]);
  });

  it("stamps its own file on every row, never the reader's previous caller", async () => {
    // The inline reader is shared with `asimov/worktree.yaml`, and the version
    // it was extracted from stamped that name into every port, setup step and
    // problem it raised. A shared reader that kept a literal would make these
    // rows claim a file this repository may not even carry (design.md D7).
    const answer = await read(withJson(`{"ports": {"APP": null}, "setup": ["echo hi"], "nope": 1}`));

    const sources = [
      ...(answer?.model.ports.map((p) => p.source) ?? []),
      ...(answer?.model.setup.map((s) => s.source) ?? []),
      ...(answer?.model.problems.map((p) => p.file) ?? []),
    ];
    expect(sources).toEqual([NATIVE_PROVIDER_FILE, NATIVE_PROVIDER_FILE, NATIVE_PROVIDER_FILE]);
  });

  it("reads the whole file from one open", async () => {
    // `extends` travels out of the SAME read that parsed the inline keys. A
    // second open is a second chance for the file to change under the check,
    // and could name a base other than the one whose keys were read (D1).
    const opens: string[] = [];
    const deps: ProviderDeps = {
      ...withJson(`{"extends": "orca.yaml", "copy": [".env.local"]}`),
      readFile: async (p) => {
        opens.push(p);
        if (p !== `${ROOT}/${NATIVE_PROVIDER_FILE}`) {
          throw Object.assign(new Error(`ENOENT ${p}`), { code: "ENOENT" });
        }
        return `{"extends": "orca.yaml", "copy": [".env.local"]}`;
      },
    };
    const answer = await read(deps);

    expect(answer?.extends).toBe("orca.yaml");
    expect(opens).toEqual([`${ROOT}/${NATIVE_PROVIDER_FILE}`]);
  });

  it("names a base without resolving it", async () => {
    // This module decides nothing about the target: whether it belongs to a
    // framework adapter, whether it is present, and whether it is inside the
    // repository are the dispatcher's three rules (D2). A path that will fail
    // all three still travels out of the read as written.
    const answer = await read(withJson(`{"extends": "../elsewhere/worktree.yaml"}`));

    expect(answer?.extends).toBe("../elsewhere/worktree.yaml");
    expect(answer?.model.problems).toEqual([]);
  });
});

describe("one unreadable part never discards the rest", () => {
  it("reports an unread key and still offers what the others declared", async () => {
    const answer = await read(withJson(`{"copy": [".env.local"], "extend": "asimov/worktree.yaml"}`));

    expect(answer?.model.problems).toEqual([
      { file: NATIVE_PROVIDER_FILE, reason: "unknownKey", detail: "`extend` is not a key this reads." },
    ]);
    expect(answer?.model.entries.map((e) => e.path)).toEqual([".env.local"]);
    // The typo is not silently read as the key it resembles.
    expect(answer?.extends).toBeUndefined();
  });

  it("reports a malformed file as its own reason, distinct from an unread key", async () => {
    const answer = await read(withJson(`{"copy": [".env.local"`));

    expect(answer?.model.problems.map((p) => p.reason)).toEqual(["malformed"]);
    // The entry assertion here used to be `[]`. That encoded the discard this
    // round removed: the parser recovers `copy` from an unterminated document,
    // and keeping it is what the requirement asks for (round-1 F003).
    expect(answer?.model.entries.map((e) => e.path)).toEqual([".env.local"]);
  });

  it("reports a base that is not a path, and keeps the rest of the file", async () => {
    const answer = await read(withJson(`{"extends": [], "copy": [".env.local"]}`));

    expect(answer?.extends).toBeUndefined();
    expect(answer?.model.problems.map((p) => p.reason)).toEqual(["malformed"]);
    expect(answer?.model.entries.map((e) => e.path)).toEqual([".env.local"]);
  });

  it("reports an exclusion that is not a list, and keeps the rest of the file", async () => {
    const answer = await read(withJson(`{"exclude": ".code-review-graph", "copy": [".env.local"]}`));

    expect(answer?.exclude).toBeUndefined();
    expect(answer?.model.problems.map((p) => p.reason)).toEqual(["malformed"]);
    expect(answer?.model.entries.map((e) => e.path)).toEqual([".env.local"]);
  });

  it("drops one bad exclusion entry and keeps the others", async () => {
    const answer = await read(withJson(`{"exclude": [".a", 7, ".b"]}`));

    expect(answer?.exclude).toEqual([".a", ".b"]);
    expect(answer?.model.problems.map((p) => p.reason)).toEqual(["malformed"]);
  });
});

describe("presence, absence, and refusal are three different answers", () => {
  it("answers null for a repository that does not carry the file", async () => {
    // Absent is not "declared nothing": answering a model here would elect this
    // adapter and leave a framework file the repository does carry unread.
    expect(await read(fs({ dirs: { [ROOT]: [] } }))).toBeNull();
  });

  it("names a file that is there and cannot be read", async () => {
    const deps: ProviderDeps = {
      ...fs({ dirs: { [ROOT]: [".vscode"] } }),
      readFile: async () => {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      },
    };
    const answer = await read(deps);

    expect(answer?.model.problems).toEqual([
      {
        file: NATIVE_PROVIDER_FILE,
        reason: "unreadable",
        detail: `\`${NATIVE_PROVIDER_FILE}\` could not be read (EACCES).`,
      },
    ]);
  });

  it("answers null when the repository root itself will not resolve", async () => {
    const deps: ProviderDeps = {
      ...withJson(`{"copy": [".env.local"]}`),
      realpath: async () => {
        throw Object.assign(new Error("ELOOP"), { code: "ELOOP" });
      },
    };

    expect(await read(deps)).toBeNull();
  });

  it("declares nothing for an empty file rather than failing it", async () => {
    const answer = await read(withJson("   "));

    expect(answer?.model.problems).toEqual([]);
    expect(answer?.model.entries).toEqual([]);
  });

  it("reports a file that is not a mapping", async () => {
    const answer = await read(withJson(`["copy"]`));

    expect(answer?.model.problems.map((p) => p.reason)).toEqual(["malformed"]);
  });
});

describe("the shared budget", () => {
  it("charges the malformed file's problem, so a later file cannot exceed the cap", async () => {
    // The defeater D9 names: an early return that builds `problems: []` by hand
    // charges nothing, and this read is the FIRST of two. What is not charged
    // here is what the inherited file gets to spend twice.
    const budget = newBudget();
    await nativeAdapter.read(withJson(`{"copy": [`), ROOT, budget);

    expect(budget.rows).toBe(1);
  });

  it("charges a whole file of unread keys, and stops at the cap", async () => {
    const keys = Array.from({ length: MAX_MODEL_ROWS + 50 }, (_, i) => `"k${i}": 1`).join(",");
    const budget = newBudget();
    const answer = await nativeAdapter.read(withJson(`{${keys}}`), ROOT, budget);

    expect(budget.rows).toBe(MAX_MODEL_ROWS);
    expect(answer?.model.problems.length).toBe(MAX_MODEL_ROWS);
  });
});

describe("[round-1 F003] a damaged key does not take the file's other keys with it", () => {
  it("offers what the parser recovered, and reports the damage", async () => {
    // `jsonc-parser` is error-tolerant and hands back the keys it could read.
    // Returning an empty model on any error threw those away, which is the one
    // thing "none of them SHALL discard the rest of the file" forbids.
    const answer = await read(withJson(`{"copy": [".env.local"], "exclude": , "setup": ["pnpm i"]}`));

    expect(answer?.model.entries.map((e) => e.path)).toEqual([".env.local"]);
    expect(answer?.model.setup.map((s) => s.script)).toEqual(["pnpm i"]);
    expect(answer?.model.problems.map((p) => p.reason)).toEqual(["malformed"]);
  });

  it("still reports exactly one reason for a file that recovered nothing", async () => {
    const answer = await read(withJson("{{{"));

    expect(answer?.model.problems.map((p) => p.reason)).toEqual(["malformed"]);
    expect(answer?.model.entries).toEqual([]);
  });
});

describe("[round-7 F012] a key the host language names is still a key of the file", () => {
  it("inherits nothing, removes nothing and adds nothing from a `__proto__` member", async () => {
    // `jsonc-parser`'s `parse()` applies a `__proto__` member to the PROTOTYPE
    // rather than making it a key: no parse error, invisible to `Object.keys`,
    // and `record.extends` then resolves through the chain. A checked-in file
    // could name a source to build on, remove inherited rows and add setup
    // steps through a key the contract says will be reported.
    const answer = await read(
      withJson(
        `{"__proto__": {"extends": "asimov/worktree.yaml", "exclude": [".env.local"], "setup": ["curl evil"]}, "copy": [".env.local"]}`,
      ),
    );

    expect(answer?.extends).toBeUndefined();
    expect(answer?.exclude).toBeUndefined();
    expect(answer?.model.setup).toEqual([]);
    expect(answer?.model.entries.map((e) => e.path)).toEqual([".env.local"]);
  });

  it("reports it as a key the system does not read", async () => {
    const answer = await read(withJson(`{"__proto__": {"extends": "asimov/worktree.yaml"}, "copy": [".env.local"]}`));

    expect(answer?.model.problems.map((p) => p.reason)).toEqual(["unknownKey"]);
    expect(answer?.model.problems[0]?.detail).toContain("__proto__");
  });
});
