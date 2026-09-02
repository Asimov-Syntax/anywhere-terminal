// src/worktree/provisioning/writeNativeConfig.test.ts — the writer against a
// REAL filesystem, for the same reason `applyEntries.node.test.ts` is: every
// obligation this module carries is a filesystem fact. A symlinked target, a
// hard link, a permission bit and a rename that fails are exactly what a fake
// models badly, and modelling them badly is how a witness passes over a broken
// implementation.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyEdits, modify } from "jsonc-parser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LockedFileDependencies } from "../../agentHooks/install/lockedJsonFile";
import type { ProvisionEntry, ProvisionModel } from "../../types/messages";
import { NATIVE_PROVIDER_FILE } from "./nativeProvider";
import {
  divergenceOf,
  type NativeConfigDeps,
  type NativeConfigDivergence,
  writeNativeConfig,
} from "./writeNativeConfig";

let root: string;
let target: string;

const realDeps: NativeConfigDeps = { realpath: (p) => fs.realpath(p), lstat: (p) => fs.lstat(p) };

const nothing: NativeConfigDivergence = { exclude: [], drop: [] };
const div = (over: Partial<NativeConfigDivergence> = {}): NativeConfigDivergence => ({
  ...nothing,
  ...over,
});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "wnc-"));
  target = path.join(root, NATIVE_PROVIDER_FILE);
  await fs.mkdir(path.join(root, ".vscode"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function put(text: string, mode?: number): Promise<void> {
  await fs.writeFile(target, text, "utf8");
  if (mode !== undefined) {
    await fs.chmod(target, mode);
  }
}

/** Every path this save opens for writing, through the binding production uses. */
function recording(): { paths: string[]; locked: LockedFileDependencies } {
  const paths: string[] = [];
  const seen = (p: string) => {
    paths.push(p);
  };
  return {
    paths,
    locked: {
      fs: {
        open: async (p, ...rest) => {
          seen(String(p));
          return (await fs.open(p as string, ...(rest as []))) as never;
        },
        writeFile: async (p, ...rest) => {
          seen(String(p));
          return fs.writeFile(p as string, ...(rest as [string]));
        },
        rename: async (from, to) => {
          seen(String(to));
          return fs.rename(from as string, to as string);
        },
        link: async (from, to) => {
          seen(String(to));
          return fs.link(from as string, to as string);
        },
        mkdir: ((p: string) => fs.mkdir(p, { recursive: true })) as never,
      },
    },
  };
}

describe("only the repository's own configuration is written", () => {
  it("opens nothing outside the target, its lock and its temporary", async () => {
    await put(`{ "copy": [".env"] }\n`);
    const { paths, locked } = recording();

    const wrote = await writeNativeConfig({ ...realDeps, locked }, root, div({ exclude: ["node_modules"] }));

    expect(wrote).toEqual({ ok: true, wrote: true });
    // The RESOLVED directory, which is what the module writes through (D7) —
    // on macOS the temporary root is reached through a symlinked `/var`, so
    // comparing against the unresolved spelling would pass for the wrong reason.
    const here = await fs.realpath(path.dirname(target));
    const stray = paths.filter((p) => path.dirname(p) !== here);
    expect(stray).toEqual([]);
    expect(paths).toContain(path.join(here, path.basename(target)));
  });

  it("opens nothing at all when a refusal answers first", async () => {
    await put("{ not json\n");
    const { paths, locked } = recording();

    const wrote = await writeNativeConfig({ ...realDeps, locked }, root, div({ exclude: ["x"] }));

    expect(wrote).toEqual({ ok: false, reason: "malformed" });
    expect(paths.filter((p) => p === target)).toEqual([]);
  });

  it("writes nothing when there is nothing left to record", async () => {
    await put(`{ "exclude": ["node_modules"] }\n`);
    const before = await fs.readFile(target, "utf8");

    const wrote = await writeNativeConfig(realDeps, root, div({ exclude: ["node_modules"] }));

    expect(wrote).toEqual({ ok: true, wrote: false });
    expect(await fs.readFile(target, "utf8")).toBe(before);
  });
});

describe("a file another tool defined keeps its bytes", () => {
  it("refuses a target that is a symlink, leaving what it points at alone", async () => {
    const framework = path.join(root, "asimov", "worktree.yaml");
    await fs.mkdir(path.dirname(framework), { recursive: true });
    await fs.writeFile(framework, "copy:\n  - .env\n", "utf8");
    await fs.symlink(framework, target);

    const wrote = await writeNativeConfig(realDeps, root, div({ exclude: ["node_modules"] }));

    expect(wrote).toEqual({ ok: false, reason: "outside" });
    expect(await fs.readFile(framework, "utf8")).toBe("copy:\n  - .env\n");
  });

  it("rebinds the name when the target is a HARD link, so the other name keeps its bytes", async () => {
    // A hard link is not a symlink, so this one is written — and what protects
    // the framework's file is that replacement is a RENAME over the pathname.
    // An in-place write would follow the inode and destroy it through our name.
    const other = path.join(root, "asimov", "worktree.json");
    await fs.mkdir(path.dirname(other), { recursive: true });
    await fs.writeFile(other, `{ "copy": [".env"] }\n`, "utf8");
    await fs.link(other, target);

    const wrote = await writeNativeConfig(realDeps, root, div({ exclude: ["node_modules"] }));

    expect(wrote).toEqual({ ok: true, wrote: true });
    expect(await fs.readFile(other, "utf8")).toBe(`{ "copy": [".env"] }\n`);
    expect(await fs.readFile(target, "utf8")).toContain("node_modules");
  });
});

describe("what the edit is allowed to disturb", () => {
  it("changes no byte outside the spans jsonc-parser itself returns", async () => {
    const original = `{\r\n\t// keep me\r\n\t"copy": [".env"],\r\n\t"exclude": ["dist"]\r\n}\r\n`;
    await put(original);

    await writeNativeConfig(realDeps, root, div({ exclude: ["node_modules"] }));
    const after = await fs.readFile(target, "utf8");

    // The spans come from `modify` directly, not from the implementation: an
    // implementation that nominated a whole-file span would make this vacuous.
    const edits = modify(original, ["exclude"], ["dist", "node_modules"], {
      formattingOptions: { tabSize: 1, insertSpaces: false, eol: "\r\n" },
    });
    expect(after).toBe(applyEdits(original, edits));
    // And the comment, which lives outside every edit span, is still there.
    expect(after).toContain("// keep me");
  });

  it("keeps the file's permissions", async () => {
    await put(`{ "copy": [".env"] }\n`, 0o644);

    await writeNativeConfig(realDeps, root, div({ exclude: ["node_modules"] }));

    expect((await fs.lstat(target)).mode & 0o777).toBe(0o644);
  });
});

describe("a configuration that cannot be edited safely is not edited", () => {
  it("refuses a document that does not parse", async () => {
    const original = `{ "copy": [".env",\n`;
    await put(original);

    const wrote = await writeNativeConfig(realDeps, root, div({ exclude: ["x"] }));

    expect(wrote).toEqual({ ok: false, reason: "malformed" });
    expect(await fs.readFile(target, "utf8")).toBe(original);
  });

  it("refuses a key this writer touches that has the wrong shape", async () => {
    // `modify` throws on this one rather than misbehaving quietly, and a throw
    // inside the lock would be reported as `unwritable` — the wrong reason.
    const original = `{ "exclude": "dist" }\n`;
    await put(original);

    const wrote = await writeNativeConfig(realDeps, root, div({ exclude: ["x"] }));

    expect(wrote).toEqual({ ok: false, reason: "malformed" });
    expect(await fs.readFile(target, "utf8")).toBe(original);
  });
});

describe("the destination is computed, never accepted", () => {
  it("refuses when the configuration directory resolves outside the repository", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "wnc-out-"));
    await fs.rm(path.join(root, ".vscode"), { recursive: true, force: true });
    await fs.symlink(outside, path.join(root, ".vscode"));

    const wrote = await writeNativeConfig(realDeps, root, div({ exclude: ["x"] }));

    expect(wrote).toEqual({ ok: false, reason: "outside" });
    expect(await fs.readdir(outside)).toEqual([]);
    await fs.rm(outside, { recursive: true, force: true });
  });
});

describe("a save that fails leaves the file as it was", () => {
  it("changes nothing when the replacement cannot land", async () => {
    const original = `{ "copy": [".env"] }\n`;
    await put(original);

    const wrote = await writeNativeConfig(
      { ...realDeps, locked: { rename: async () => Promise.reject(new Error("EXDEV")) } },
      root,
      div({ exclude: ["node_modules"] }),
    );

    expect(wrote).toEqual({ ok: false, reason: "unwritable" });
    expect(await fs.readFile(target, "utf8")).toBe(original);
    expect((await fs.readdir(path.dirname(target))).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("leaves no temporary behind when a first write cannot be linked into place", async () => {
    const wrote = await writeNativeConfig(
      { ...realDeps, locked: { fs: { link: async () => Promise.reject(new Error("EPERM")) } } },
      root,
      div({ extends: "asimov/worktree.yaml" }),
    );

    expect(wrote).toEqual({ ok: false, reason: "unwritable" });
    expect(await fs.readdir(path.dirname(target))).toEqual([]);
  });

  it("refuses rather than waiting forever when the lock is held", async () => {
    const original = `{ "copy": [".env"] }\n`;
    await put(original);
    await fs.writeFile(`${target}.anywhere-terminal.lock`, "", { flag: "wx" });

    const wrote = await writeNativeConfig(
      { ...realDeps, locked: { sleep: async () => undefined } },
      root,
      div({ exclude: ["node_modules"] }),
    );

    expect(wrote).toEqual({ ok: false, reason: "unavailable" });
    expect(await fs.readFile(target, "utf8")).toBe(original);
  });
});

describe("two saves do not lose one another's work", () => {
  it("keeps both exclusions when two saves run at once", async () => {
    // The read is inside the lock. With it outside, both saves read the same
    // original and the second commits text that never had the first's exclusion.
    await put(`{ "exclude": [] }\n`);

    const [a, b] = await Promise.all([
      writeNativeConfig(realDeps, root, div({ exclude: ["first"] })),
      writeNativeConfig(realDeps, root, div({ exclude: ["second"] })),
    ]);

    expect([a.ok, b.ok]).toEqual([true, true]);
    const after = await fs.readFile(target, "utf8");
    expect(after).toContain("first");
    expect(after).toContain("second");
  });
});

describe("a repository with no configuration of its own", () => {
  it("writes one naming the source it builds on", async () => {
    const wrote = await writeNativeConfig(realDeps, root, div({ extends: ".worktreeinclude" }));

    expect(wrote).toEqual({ ok: true, wrote: true });
    expect(JSON.parse(await fs.readFile(target, "utf8"))).toEqual({ extends: ".worktreeinclude" });
  });

  it("writes nothing when there is nothing to record", async () => {
    const wrote = await writeNativeConfig(realDeps, root, nothing);

    expect(wrote).toEqual({ ok: true, wrote: false });
    await expect(fs.lstat(target)).rejects.toThrow();
  });

  it("creates the configuration directory when it is not there", async () => {
    await fs.rm(path.join(root, ".vscode"), { recursive: true, force: true });

    const wrote = await writeNativeConfig(realDeps, root, div({ extends: "orca.yaml" }));

    expect(wrote).toEqual({ ok: true, wrote: true });
    expect(JSON.parse(await fs.readFile(target, "utf8"))).toEqual({ extends: "orca.yaml" });
  });
});

describe("saving twice does not grow the file", () => {
  it("is byte-identical after a repeated save", async () => {
    await put(`{\n  "extends": "orca.yaml",\n  "copy": [".env", ".env.local"]\n}\n`);
    const change = div({ exclude: ["node_modules"], drop: [".env.local"], extends: "orca.yaml" });

    await writeNativeConfig(realDeps, root, change);
    const once = await fs.readFile(target, "utf8");
    const second = await writeNativeConfig(realDeps, root, change);

    expect(second).toEqual({ ok: true, wrote: false });
    expect(await fs.readFile(target, "utf8")).toBe(once);
    expect(JSON.parse(once)).toEqual({
      extends: "orca.yaml",
      copy: [".env"],
      exclude: ["node_modules"],
    });
  });
});

describe("what the selection diverges to", () => {
  const entry = (over: Partial<ProvisionEntry> & { id: string }): ProvisionEntry => ({
    path: over.id,
    mode: "copy",
    source: "asimov/worktree.yaml",
    ...over,
  });

  const model = (over: Partial<ProvisionModel> = {}): ProvisionModel => ({
    entries: [],
    setup: [],
    ports: [],
    providers: [],
    excluded: [],
    contenders: [],
    problems: [],
    ...over,
  });

  it("excludes an inherited entry the user cleared", () => {
    const m = model({ entries: [entry({ id: "e1", path: "node_modules" }), entry({ id: "e2", path: ".env" })] });

    expect(divergenceOf(m, new Set(["e2"]))).toEqual({ exclude: ["node_modules"], drop: [] });
  });

  it("drops an entry the native file declared itself, rather than excluding it", () => {
    // `exclude` has no effect on inline keys (worktree-provisioning.md § 3.4),
    // so excluding a path the native file declares records a contradiction the
    // read side then reports as a problem.
    const m = model({
      entries: [entry({ id: "e1", path: ".env.local", source: NATIVE_PROVIDER_FILE })],
    });

    expect(divergenceOf(m, new Set())).toEqual({ exclude: [], drop: [".env.local"] });
  });

  it("records nothing for an entry the user left alone", () => {
    const m = model({ entries: [entry({ id: "e1", path: ".env" })] });

    expect(divergenceOf(m, new Set(["e1"]))).toEqual({ exclude: [], drop: [] });
  });

  it("takes no interest in ports, setup steps or already-excluded rows", () => {
    // Each is out for its own reason, and design.md D6 states them: a setup
    // step's unticked box is § 7's safety rule rather than a preference, a port
    // has no path for `exclude` to match, and an excluded row is already
    // recorded.
    const m = model({
      ports: [{ id: "p1", name: "APP", source: "asimov/worktree.yaml" }],
      setup: [{ id: "s1", script: "pnpm i", kind: "shell", source: "asimov/worktree.yaml" }],
      excluded: [entry({ id: "x1", path: "dist" })],
    });

    expect(divergenceOf(m, new Set())).toEqual({ exclude: [], drop: [] });
  });

  it("names the active source's file that is actually there", () => {
    // `present[0]`, never `files[0]`: a provider detected through only the
    // second of its files would otherwise be given an `extends` naming a file
    // that is not there.
    const m = model({
      providers: [
        { id: "asimov", files: ["asimov/worktree.yaml"], present: ["asimov/worktree.yaml"], active: false },
        { id: "orca", files: ["orca.yaml", ".worktreeinclude"], present: [".worktreeinclude"], active: true },
      ],
    });

    expect(divergenceOf(m, new Set()).extends).toBe(".worktreeinclude");
  });

  it("names the active source rather than a detected one the user did not take", () => {
    // A switch re-reads with the taken provider preferred, so by the time
    // Configure is pressed the source the user took IS the active one — and a
    // source named on the wire beside it could only ever disagree with the
    // offer the user was looking at (D1). The one that supplied the rows is the
    // one that gets named.
    const m = model({
      providers: [
        { id: "orca", files: ["orca.yaml"], present: ["orca.yaml"], active: true },
        { id: "vscodeTasks", files: [".vscode/tasks.json"], present: [".vscode/tasks.json"], active: false },
      ],
    });

    expect(divergenceOf(m, new Set()).extends).toBe("orca.yaml");
  });

  it("names what detection made active when the user took no source", () => {
    // What a first write has to record: `extends` names whatever supplied the
    // offer, not the entries it resolved to.
    const m = model({
      providers: [{ id: "asimov", files: ["asimov/worktree.yaml"], present: ["asimov/worktree.yaml"], active: true }],
    });

    expect(divergenceOf(m, new Set()).extends).toBe("asimov/worktree.yaml");
  });

  it("never names the native file itself, which would be self-extension", () => {
    // § 3.4 excludes the native file from what `extends` can name: a one-level
    // resolver would merge the file with itself and duplicate its declarations.
    const m = model({
      providers: [
        { id: "native", files: [NATIVE_PROVIDER_FILE], present: [NATIVE_PROVIDER_FILE], active: true },
        { id: "orca", files: ["orca.yaml"], present: ["orca.yaml"], active: false },
      ],
    });

    expect(divergenceOf(m, new Set()).extends).toBeUndefined();
  });

  it("names nothing when the active source has no file left to name", () => {
    // `present` can be empty on a provider that WAS detected: there when it was
    // read, gone when presence was taken. Naming `files[0]` anyway would write
    // an `extends` the read side reports as `missingExtends`.
    const m = model({
      providers: [{ id: "orca", files: ["orca.yaml", ".worktreeinclude"], present: [], active: true }],
    });

    expect(divergenceOf(m, new Set()).extends).toBeUndefined();
  });

  it("names nothing when the model made no provider active", () => {
    // Not the same state as "no providers": one detected source that lost is
    // still a source, and naming it would record an `extends` for a file the
    // offer on screen never resolved.
    const m = model({
      providers: [{ id: "orca", files: ["orca.yaml"], present: ["orca.yaml"], active: false }],
    });

    expect(divergenceOf(m, new Set()).extends).toBeUndefined();
    expect(divergenceOf(model(), new Set()).extends).toBeUndefined();
  });
});
