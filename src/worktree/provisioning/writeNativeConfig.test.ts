// src/worktree/provisioning/writeNativeConfig.test.ts — the writer against a
// REAL filesystem, for the same reason `applyEntries.node.test.ts` is: every
// obligation this module carries is a filesystem fact. A symlinked target, a
// hard link, a permission bit and a rename that fails are exactly what a fake
// models badly, and modelling them badly is how a witness passes over a broken
// implementation.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parse as parseJsonc } from "jsonc-parser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LockedFileDependencies } from "../../agentHooks/install/lockedJsonFile";
import type { ProvisionEntry, ProvisionModel } from "../../types/messages";
import { NATIVE_PROVIDER_FILE, nativeAdapter } from "./nativeProvider";
import { newBudget } from "./providerKit";
import { createProvisioningDeps, MAX_PROVIDER_BYTES } from "./provisioningDeps";
import { readProvisioning } from "./readProvisioning";
import {
  divergenceOf,
  type NativeConfigDeps,
  type NativeConfigDivergence,
  writeNativeConfig,
} from "./writeNativeConfig";

let root: string;
let target: string;

// The reader's real dependencies, because the base check IS the reader's now:
// a fake here would let the save agree with a reader nobody ships (D17).
const realDeps: NativeConfigDeps = {
  realpath: (p) => fs.realpath(p),
  lstat: (p) => fs.lstat(p),
  provider: createProvisioningDeps(),
};

const nothing: NativeConfigDivergence = { exclude: [], drop: [], unnamedSource: false, tookSource: false };
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

/** A file for `extends` to name. D17 confirms it exists before the write. */
async function base(name: string): Promise<string> {
  const at = path.join(root, name);
  await fs.mkdir(path.dirname(at), { recursive: true });
  await fs.writeFile(at, "copy:\n  - .env\n", "utf8");
  return name;
}

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
  // A comment on BOTH neighbours of the element that goes, one inside the array
  // that grows, and one on a key nothing touches. The assertions below are
  // stated in the user's own content rather than in `modify`'s return, so an
  // implementation cannot discharge them by nominating a span wide enough to
  // make the property vacuous (.reviews/round-1.md F004, F005).
  const commented = [
    "{",
    "  // the whole file",
    '  "copy": [',
    "    // keep a",
    '    ".env",',
    "    // the one that goes",
    '    ".env.local",',
    "    // follows the one that goes",
    '    ".config"',
    "  ],",
    '  "exclude": [',
    "    // already excluded",
    '    "dist"',
    "  ]",
    "}",
    "",
  ].join("\n");

  it("keeps the comments on the parts it did not change", async () => {
    await put(commented);

    const wrote = await writeNativeConfig(realDeps, root, div({ exclude: ["node_modules"], drop: [".env.local"] }));
    const after = await fs.readFile(target, "utf8");

    expect(wrote).toEqual({ ok: true, wrote: true });
    expect(after).toContain("// the whole file");
    expect(after).toContain("// keep a");
    expect(after).toContain("// already excluded");
    expect(parseJsonc(after)).toEqual({
      copy: [".env", ".config"],
      exclude: ["dist", "node_modules"],
    });
  });

  it("takes, with a removed element, the comment on the element after it", async () => {
    // The bound, asserted rather than hoped for: jsonc-parser's removal span
    // runs to the start of the following element, so the comment introducing
    // THAT element goes with it while the removed element's own comment stays.
    // Preservation is bounded to the removed element's neighbourhood, and this
    // fails if that ever stops being true.
    await put(commented);

    await writeNativeConfig(realDeps, root, div({ drop: [".env.local"] }));
    const after = await fs.readFile(target, "utf8");

    expect(after).toContain("// the one that goes");
    expect(after).not.toContain("// follows the one that goes");
  });

  it("removes every element asked for when several go from one array", async () => {
    // Indices are read off the ORIGINAL array, so they have to be applied from
    // the back: removing a lower one first shifts every higher one down and the
    // second removal takes the wrong element — ascending `1` then `2` over
    // `[a,b,c,d]` removes `b` and `d` (design.md D4). The check on each edit
    // catches the wrong VALUE either way, so what ordering buys is the comment:
    // a failed narrow edit falls back to replacing the whole array, and the
    // array's comments go with it.
    await put(`{\n  "copy": [\n    // keep a\n    "a",\n    "b",\n    "c",\n    "d"\n  ]\n}\n`);

    const wrote = await writeNativeConfig(realDeps, root, div({ drop: ["b", "c"] }));
    const after = await fs.readFile(target, "utf8");

    expect(wrote).toEqual({ ok: true, wrote: true });
    expect(parseJsonc(after)).toEqual({ copy: ["a", "d"] });
    expect(after).toContain("// keep a");
  });

  it("never writes a document its own edit corrupted", async () => {
    // Probed on the pinned 3.3.1: removing the LAST element of a single-line
    // array eats the closing bracket — `[".env", ".env.local"]` minus index 1
    // comes back as `[".env""]`. The narrow edit is checked and the wide form
    // takes over, so what lands parses and holds the value asked for.
    await put(`{ "copy": [".env", ".env.local"], "exclude": ["dist"] }\n`);

    const wrote = await writeNativeConfig(realDeps, root, div({ drop: [".env.local"] }));
    const after = await fs.readFile(target, "utf8");

    expect(wrote).toEqual({ ok: true, wrote: true });
    expect(JSON.parse(after)).toEqual({ copy: [".env"], exclude: ["dist"] });
  });

  it("edits an empty configuration rather than refusing it", async () => {
    // `parseTree("")` answers `undefined` with NO errors, and the read side
    // treats the same file as a present configuration declaring nothing. A
    // writer calling it malformed would leave an ordinary file unconfigurable
    // (.reviews/round-1.md F010).
    await put("");

    const wrote = await writeNativeConfig(realDeps, root, div({ exclude: ["dist"], extends: await base("orca.yaml") }));

    expect(wrote).toEqual({ ok: true, wrote: true });
    expect(JSON.parse(await fs.readFile(target, "utf8"))).toEqual({ exclude: ["dist"], extends: "orca.yaml" });
  });

  it("keeps the content of a configuration that is only a comment", async () => {
    await put("// mine\n");

    const wrote = await writeNativeConfig(realDeps, root, div({ exclude: ["dist"], extends: await base("orca.yaml") }));

    expect(wrote).toEqual({ ok: true, wrote: true });
    expect(await fs.readFile(target, "utf8")).toContain("// mine");
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

describe("the destination is the resolution that was checked", () => {
  it("writes to the value the check authorized, not to the spelling it was handed", async () => {
    // Resolving here and then checking THAT answer is two resolutions, and the
    // predicate authorizes its own — so the pair could disagree about which
    // path was approved. This is the state where the disagreement escapes: the
    // directory resolves to somewhere OUTSIDE the repository, and that place in
    // turn resolves back inside it. Checking the first answer's resolution says
    // "inside" and the write then lands at the first answer, outside the root
    // (.reviews/round-3.md F019 and its plan attack).
    //
    // Not two answers for one path: one answer per path, which is what a
    // symlink chain actually is. A counter would model a filesystem that
    // changes under the caller, and D16 owns that.
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "wnc-outside-"));
    const backInside = path.join(root, "back-inside");
    await fs.mkdir(backInside, { recursive: true });
    const dir = path.dirname(target);
    const chain = new Map([
      [dir, outside],
      [outside, await fs.realpath(backInside)],
    ]);
    const chained: NativeConfigDeps = {
      provider: createProvisioningDeps(),
      lstat: (p) => fs.lstat(p),
      realpath: async (p) => chain.get(p) ?? fs.realpath(p),
    };

    const wrote = await writeNativeConfig(chained, root, div({ exclude: ["dist"] }));

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
      div({ extends: await base("asimov/worktree.yaml"), tookSource: true }),
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

describe("what the lock covers", () => {
  it("takes the target's identity and mode inside the lock, not before it", async () => {
    // `readText` follows symlinks, so a symlink verdict taken before the lock
    // describes a file the write need not be landing on. The order is the
    // property: everything the write depends on is observed under the lock
    // (.reviews/round-1.md F003).
    await put(`{ "copy": [".env"] }\n`, 0o644);
    const order: string[] = [];
    const deps: NativeConfigDeps = {
      realpath: (p) => fs.realpath(p),
      provider: createProvisioningDeps(),
      lstat: async (p) => {
        order.push(`lstat ${path.basename(p)}`);
        return fs.lstat(p);
      },
      locked: {
        fs: {
          open: (async (p: string, ...rest: unknown[]) => {
            order.push(`open ${path.basename(p)}`);
            return fs.open(p, ...(rest as []));
          }) as never,
        },
      },
    };

    const wrote = await writeNativeConfig(deps, root, div({ exclude: ["node_modules"] }));

    expect(wrote).toEqual({ ok: true, wrote: true });
    const lock = order.indexOf(`open ${path.basename(target)}.anywhere-terminal.lock`);
    const identity = order.indexOf(`lstat ${path.basename(target)}`);
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(identity).toBeGreaterThan(lock);
  });
});

describe("what the native reader makes of what was written", () => {
  it("reads back the source it named and the exclusion it recorded", async () => {
    // The witness that was missing: nothing round-tripped a written document
    // through the REAL reader, which is what turns "the bytes look right" into
    // "the configuration means what the user chose" (.reviews/round-1.md F002).
    const named = await base("orca.yaml");

    const wrote = await writeNativeConfig(realDeps, root, div({ exclude: ["node_modules"], extends: named }));

    expect(wrote).toEqual({ ok: true, wrote: true });
    const read = await nativeAdapter.read(
      { readFile: (p) => fs.readFile(p, "utf8"), readdir: (p) => fs.readdir(p) },
      root,
      newBudget(),
    );
    expect(read?.extends).toBe("orca.yaml");
    expect(read?.exclude).toEqual(["node_modules"]);
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
    const wrote = await writeNativeConfig(
      realDeps,
      root,
      div({ extends: await base(".worktreeinclude"), tookSource: true }),
    );

    expect(wrote).toEqual({ ok: true, wrote: true });
    expect(JSON.parse(await fs.readFile(target, "utf8"))).toEqual({ extends: ".worktreeinclude" });
  });

  it("names the source an exclusion has to subtract from, even with no source taken", async () => {
    // Without it the next read picks the native adapter, finds no base, and
    // contributes NO inherited entry: the one path the user removed becomes
    // every path removed (design.md D12).
    const wrote = await writeNativeConfig(realDeps, root, div({ exclude: ["dist"], extends: await base("orca.yaml") }));

    expect(wrote).toEqual({ ok: true, wrote: true });
    expect(JSON.parse(await fs.readFile(target, "utf8"))).toEqual({ exclude: ["dist"], extends: "orca.yaml" });
  });

  it("writes nothing when there is nothing to record", async () => {
    const wrote = await writeNativeConfig(realDeps, root, nothing);

    expect(wrote).toEqual({ ok: true, wrote: false });
    await expect(fs.lstat(target)).rejects.toThrow();
  });

  it("creates no file for an untouched form, even where a source could be named", async () => {
    // A base is not a decision anyone made: pressing Configure and changing
    // nothing leaves the repository with nothing new to commit.
    const wrote = await writeNativeConfig(realDeps, root, div({ extends: await base("orca.yaml") }));

    expect(wrote).toEqual({ ok: true, wrote: false });
    await expect(fs.lstat(target)).rejects.toThrow();
  });

  it("refuses when the source it would name is gone by the time the save runs", async () => {
    // The offer's `present` chose the candidate; it never authorized it. The
    // file can go between the read the form was built from and this save, and
    // the read side then answers `missingExtends` for what we just wrote
    // (design.md D17).
    const wrote = await writeNativeConfig(realDeps, root, div({ extends: "orca.yaml", tookSource: true }));

    expect(wrote).toEqual({ ok: false, reason: "unnamed" });
    await expect(fs.lstat(target)).rejects.toThrow();
  });

  it("refuses when the active source has no file left to name at all", async () => {
    const wrote = await writeNativeConfig(realDeps, root, div({ exclude: ["dist"], unnamedSource: true }));

    expect(wrote).toEqual({ ok: false, reason: "unnamed" });
    await expect(fs.lstat(target)).rejects.toThrow();
  });

  it("creates the configuration directory when it is not there", async () => {
    const named = await base("orca.yaml");
    await fs.rm(path.join(root, ".vscode"), { recursive: true, force: true });

    const wrote = await writeNativeConfig(realDeps, root, div({ extends: named, tookSource: true }));

    expect(wrote).toEqual({ ok: true, wrote: true });
    expect(JSON.parse(await fs.readFile(target, "utf8"))).toEqual({ extends: "orca.yaml" });
  });
});

describe("saving twice does not grow the file", () => {
  it("is byte-identical after a repeated save", async () => {
    await put(`{\n  "extends": "orca.yaml",\n  "copy": [".env", ".env.local"]\n}\n`);
    const change = div({ exclude: ["node_modules"], drop: [".env.local"], extends: await base("orca.yaml") });

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

describe("the base a save records against", () => {
  it("refuses when the base the document already names has gone", async () => {
    // D17 confirms the base before the write, and "the base" is the one in
    // force — not only one this call is adding. A document whose declared base
    // has gone records the user's choice against nothing
    // (.reviews/round-2.md F021).
    await put(`{ "extends": "orca.yaml", "copy": [".env"] }\n`);
    const before = await fs.readFile(target, "utf8");

    const wrote = await writeNativeConfig(realDeps, root, div({ exclude: ["dist"] }));

    expect(wrote).toEqual({ ok: false, reason: "unnamed" });
    expect(await fs.readFile(target, "utf8")).toBe(before);
  });

  it("refuses an unnameable source even where the document names some other base", async () => {
    // The exclusions were computed against the source the user was LOOKING at.
    // Committing them under a base that is not that source records the choice
    // against something else and loses the source change entirely.
    await put(`{ "extends": "asimov/worktree.yaml", "copy": [".env"] }\n`);
    await base("asimov/worktree.yaml");
    const before = await fs.readFile(target, "utf8");

    const wrote = await writeNativeConfig(realDeps, root, div({ exclude: ["dist"], unnamedSource: true }));

    expect(wrote).toEqual({ ok: false, reason: "unnamed" });
    expect(await fs.readFile(target, "utf8")).toBe(before);
  });

  it("creates a first configuration readable the way its siblings are", async () => {
    // `LockedFile` opens its temporary `0o600`; a file created through it took
    // that mode, which nobody chose (.reviews/round-2.md F022).
    const wrote = await writeNativeConfig(realDeps, root, div({ extends: await base("orca.yaml"), tookSource: true }));

    expect(wrote).toEqual({ ok: true, wrote: true });
    expect((await fs.lstat(target)).mode & 0o777).toBe(0o644 & ~process.umask());
  });

  it("never creates one broader than the process's own policy allows", async () => {
    // The mask is SUPPLIED, because the assertion above cannot tell the two
    // apart on a machine whose umask is the usual `0o022` — `0o644` masked by
    // it is `0o644` again — and a vitest worker refuses `process.umask(mask)`.
    // `stageReplacement` chmods the mode exactly, and a chmod is not narrowed
    // the way the create is, so an unmasked `0o644` under `umask 0o077` landed
    // world-readable against the process's own policy (.reviews/round-3.md F022).
    const strict: NativeConfigDeps = { ...realDeps, umask: () => 0o077 };

    const wrote = await writeNativeConfig(strict, root, div({ extends: await base("orca.yaml"), tookSource: true }));

    expect(wrote).toEqual({ ok: true, wrote: true });
    expect((await fs.lstat(target)).mode & 0o777).toBe(0o600);
  });

  // The property four rounds of partial checks kept missing: the save and the
  // read must agree about a base. Stated as agreement rather than as a list of
  // refusals, because a list is what got reconstructed one clause per round —
  // the reader is asked directly, so a rule this writer does not know about
  // cannot go missing here (.reviews/round-5.md F025).
  describe.each([
    [
      "one over the byte bound",
      async (at: string) => {
        await fs.writeFile(at, `copy:\n${"#".repeat(MAX_PROVIDER_BYTES)}\n`, "utf8");
      },
    ],
    [
      "a directory",
      async (at: string) => {
        await fs.mkdir(at, { recursive: true });
      },
    ],
    [
      "one that will not open",
      async (at: string) => {
        await fs.writeFile(at, "copy:\n", "utf8");
        await fs.chmod(at, 0o000);
      },
    ],
  ])("a base that is %s", (_what, make) => {
    it("is refused by the save, and by the read that follows it", async () => {
      const at = path.join(root, "asimov", "worktree.yaml");
      await fs.mkdir(path.dirname(at), { recursive: true });
      await make(at);
      await put(`{ "extends": "asimov/worktree.yaml", "copy": [".env"] }\n`);
      const before = await fs.readFile(target, "utf8");

      const wrote = await writeNativeConfig(realDeps, root, div({ exclude: ["dist"] }));
      const read = await readProvisioning(createProvisioningDeps(), root);

      expect(wrote).toEqual({ ok: false, reason: "unnamed" });
      // The file IS there in all three, so the reader's own word for it is
      // `unreadable`, not `missingExtends` — agreement is that both refuse the
      // same base, on the reader's rule.
      expect(read.problems.map((p) => p.reason)).toContain("unreadable");
      expect(await fs.readFile(target, "utf8")).toBe(before);
      await fs.chmod(at, 0o700).catch(() => {});
    });
  });

  it("refuses a base whose ancestor leaves the repository, however ordinary its name", async () => {
    // The name check proves the spelling is an adapter's; it proves nothing
    // about where that spelling leads. `asimov/` as a symlink out of the
    // checkout leaves `asimov/worktree.yaml` a perfectly well-known name
    // resolving to a file the repository does not contain — so the probe still
    // reported an outside path's existence, and the save still succeeded under
    // a base the next read refuses (.reviews/round-4.md F025). No race: this is
    // a directory that simply IS a link.
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "wnc-ancestor-"));
    await fs.writeFile(path.join(outside, "worktree.yaml"), "copy:\n", "utf8");
    await fs.symlink(outside, path.join(root, "asimov"));
    await put(`{ "extends": "asimov/worktree.yaml", "copy": [".env"] }\n`);
    const before = await fs.readFile(target, "utf8");
    const asked: string[] = [];
    const watching: NativeConfigDeps = {
      ...realDeps,
      lstat: async (p) => {
        asked.push(p);
        return fs.lstat(p);
      },
    };

    const wrote = await writeNativeConfig(watching, root, div({ exclude: ["dist"] }));

    expect(wrote).toEqual({ ok: false, reason: "unnamed" });
    expect(asked.filter((p) => p.includes(path.basename(outside)))).toEqual([]);
    expect(await fs.readFile(target, "utf8")).toBe(before);
    await fs.rm(outside, { recursive: true, force: true });
  });

  it("refuses a base that names no adapter file without asking the filesystem about it", async () => {
    // `extends` is untrusted repository text. Probing it before establishing
    // that it names an adapter file at all made this confirmation a filesystem
    // oracle: a committed `../../elsewhere` reported whether an arbitrary path
    // outside the checkout exists. Membership is asked of the read side's own
    // list, exactly as `baseFor` asks it (.reviews/round-3.md F025, design.md D2).
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "wnc-probe-"));
    const reaching = path.relative(root, path.join(outside, "present.yaml"));
    await fs.writeFile(path.join(outside, "present.yaml"), "copy:\n", "utf8");
    await put(`{ "extends": ${JSON.stringify(reaching)}, "copy": [".env"] }\n`);
    const before = await fs.readFile(target, "utf8");
    const asked: string[] = [];
    const watching: NativeConfigDeps = {
      ...realDeps,
      lstat: async (p) => {
        asked.push(p);
        return fs.lstat(p);
      },
    };

    const wrote = await writeNativeConfig(watching, root, div({ exclude: ["dist"] }));

    expect(wrote).toEqual({ ok: false, reason: "unnamed" });
    // Not merely refused — never probed. A refusal that still asked would leak
    // the same bit through timing and through the `unwritable` answer a
    // permission error would give instead.
    expect(asked.filter((p) => p.includes(path.basename(outside)))).toEqual([]);
    expect(await fs.readFile(target, "utf8")).toBe(before);
    await fs.rm(outside, { recursive: true, force: true });
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

    expect(divergenceOf(m, new Set(["e2"]), false)).toEqual({
      exclude: ["node_modules"],
      drop: [],
      addCopy: [],
      unnamedSource: false,
      tookSource: false,
    });
  });

  it("drops an entry the native file declared itself, rather than excluding it", () => {
    // `exclude` has no effect on inline keys (worktree-provisioning.md § 3.4),
    // so excluding a path the native file declares records a contradiction the
    // read side then reports as a problem.
    const m = model({
      entries: [entry({ id: "e1", path: ".env.local", source: NATIVE_PROVIDER_FILE })],
    });

    expect(divergenceOf(m, new Set(), false)).toEqual({
      exclude: [],
      drop: [".env.local"],
      addCopy: [],
      unnamedSource: false,
      tookSource: false,
    });
  });

  it("records nothing for an entry the user left alone", () => {
    const m = model({ entries: [entry({ id: "e1", path: ".env" })] });

    expect(divergenceOf(m, new Set(["e1"]), false)).toEqual({
      exclude: [],
      drop: [],
      addCopy: [],
      unnamedSource: false,
      tookSource: false,
    });
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

    expect(divergenceOf(m, new Set(), false)).toEqual({
      exclude: [],
      drop: [],
      addCopy: [],
      unnamedSource: false,
      tookSource: false,
    });
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

    expect(divergenceOf(m, new Set(), false).extends).toBe(".worktreeinclude");
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

    expect(divergenceOf(m, new Set(), false).extends).toBe("orca.yaml");
  });

  it("names what detection made active when the user took no source", () => {
    // What a first write has to record: `extends` names whatever supplied the
    // offer, not the entries it resolved to.
    const m = model({
      providers: [{ id: "asimov", files: ["asimov/worktree.yaml"], present: ["asimov/worktree.yaml"], active: true }],
    });

    expect(divergenceOf(m, new Set(), false).extends).toBe("asimov/worktree.yaml");
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

    expect(divergenceOf(m, new Set(), false).extends).toBeUndefined();
  });

  it("names nothing when the active source has no file left to name", () => {
    // `present` can be empty on a provider that WAS detected: there when it was
    // read, gone when presence was taken. Naming `files[0]` anyway would write
    // an `extends` the read side reports as `missingExtends`.
    const m = model({
      providers: [{ id: "orca", files: ["orca.yaml", ".worktreeinclude"], present: [], active: true }],
    });

    expect(divergenceOf(m, new Set(), false).extends).toBeUndefined();
    // And says so, rather than leaving the writer to re-derive it: this is the
    // function that looked for the source and could not name one (design.md
    // D12). A save against it is refused, not written without a base.
    expect(divergenceOf(m, new Set(), false).unnamedSource).toBe(true);
  });

  it("reports a source that is merely inactive as named, not as unnameable", () => {
    // Nothing was lost — nothing was active. Refusing here would refuse every
    // save in a repository with no detected source at all.
    const m = model({
      providers: [{ id: "orca", files: ["orca.yaml"], present: [], active: false }],
    });

    expect(divergenceOf(m, new Set(), false).unnamedSource).toBe(false);
    expect(divergenceOf(model(), new Set(), true)).toEqual({
      exclude: [],
      drop: [],
      addCopy: [],
      unnamedSource: false,
      tookSource: true,
    });
  });

  it("names nothing when the model made no provider active", () => {
    // Not the same state as "no providers": one detected source that lost is
    // still a source, and naming it would record an `extends` for a file the
    // offer on screen never resolved.
    const m = model({
      providers: [{ id: "orca", files: ["orca.yaml"], present: ["orca.yaml"], active: false }],
    });

    expect(divergenceOf(m, new Set(), false).extends).toBeUndefined();
    expect(divergenceOf(model(), new Set(), false).extends).toBeUndefined();
  });
});

// Against a REAL filesystem and a real lock, because the failure this covers is
// a syscall that never returns: the lock is taken, the read waits forever, and
// `withLock` cannot reach its release. A fake read models that away.
describe("a target that is not an ordinary file", () => {
  const posixOnly = process.platform === "win32" ? it.skip : it;

  const lockOf = (at: string) => `${at}.anywhere-terminal.lock`;

  async function raced<T>(work: Promise<T>): Promise<T | "waited"> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<"waited">((resolve) => {
          timer = setTimeout(() => resolve("waited"), 3000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  posixOnly("refuses a pipe already there, and leaves the next save able to run", async () => {
    await fs.rm(target, { force: true });
    await promisify(execFile)("mkfifo", [target]);

    const first = await raced(writeNativeConfig(realDeps, root, div({ exclude: ["dist"] })));
    const second = await raced(writeNativeConfig(realDeps, root, div({ exclude: ["dist"] })));

    expect(first).not.toBe("waited");
    // Named exactly, not merely "answered": answering is what the timer above
    // proves, and a save that returned success over a pipe would satisfy that
    // and still be wrong (.reviews/round-7.md F027).
    expect(first).toEqual({ ok: false, reason: "unwritable" });
    expect(second).toEqual({ ok: false, reason: "unwritable" });
    // And the second call is why both are asserted: a stranded lock answers
    // `unavailable` for every later save, which is a persistent denial rather
    // than a refusal.
    await expect(fs.stat(lockOf(target))).rejects.toMatchObject({ code: "ENOENT" });
  });

  // The race the plan attack found, and the reason this bound lives in the open
  // rather than in a check before it: a target that IS a regular file when the
  // writer observes it, and a pipe by the time the read opens it. A file-type
  // test taken from the path cannot close this window; taking the type from the
  // opened handle means there is no window (design.md D4).
  posixOnly("refuses a pipe that replaced the target after it was observed", async () => {
    await put(`{ "copy": [".env"] }\n`);
    const deps: NativeConfigDeps = {
      ...realDeps,
      // Matched on the basename: the writer resolves the directory first, so on
      // a host where the temporary root is reached through a symlink the path it
      // hands us is not the spelling this suite holds.
      lstat: async (p) => {
        const stat = await fs.lstat(p);
        if (path.basename(p) === path.basename(target)) {
          await fs.rm(p, { force: true });
          await promisify(execFile)("mkfifo", [p]);
        }
        return stat;
      },
    };

    const wrote = await raced(writeNativeConfig(deps, root, div({ exclude: ["dist"] })));

    expect(wrote).not.toBe("waited");
    expect(wrote).toEqual({ ok: false, reason: "unwritable" });
    await expect(fs.stat(lockOf(target))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("a save that may have left a lock in the way", () => {
  /** Refuses to remove the lock, and nothing else — the one release we can vouch for. */
  const stuck = {
    fs: {
      unlink: async (p: unknown) => {
        if (String(p).endsWith(".lock")) {
          throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
        }
      },
    },
  };

  /** The lock's name identifies a different file — never ours to speak about. */
  const notOurs = {
    fs: {
      lstat: (async (p: string, o?: { bigint?: boolean }) =>
        String(p).endsWith(".lock")
          ? {
              dev: o?.bigint ? 1n : 1,
              ino: o?.bigint ? 4242n : 4242,
              nlink: o?.bigint ? 1n : 1,
              isFile: () => true,
              isSymbolicLink: () => false,
            }
          : fs.lstat(p, o as never)) as never,
    },
  };

  it("says so when the write landed", async () => {
    await put(`{ "copy": [".env"] }\n`);

    const wrote = await writeNativeConfig({ ...realDeps, locked: stuck }, root, div({ exclude: ["node_modules"] }));

    expect(wrote).toEqual({ ok: true, wrote: true, mayStillBeLocked: true });
  });

  it("says so without claiming a write, when there was nothing to write", async () => {
    await put(`{ "exclude": ["node_modules"] }\n`);

    const wrote = await writeNativeConfig({ ...realDeps, locked: stuck }, root, div({ exclude: ["node_modules"] }));

    expect(wrote).toEqual({ ok: true, wrote: false, mayStillBeLocked: true });
  });

  it("says so while keeping a refusal's own reason", async () => {
    await put(`{ "copy": [".env"] }\n`);

    const wrote = await writeNativeConfig(
      { ...realDeps, locked: { ...stuck, rename: async () => Promise.reject(new Error("EXDEV")) } },
      root,
      div({ exclude: ["node_modules"] }),
    );

    expect(wrote).toEqual({ ok: false, reason: "unwritable", mayStillBeLocked: true });
  });

  // A lock we cannot vouch for is not a lock we tell the user about. The name
  // belongs to something else, so there is nothing here for them to wait on.
  it("says nothing when the lock's name is not ours", async () => {
    await put(`{ "copy": [".env"] }\n`);

    const wrote = await writeNativeConfig({ ...realDeps, locked: notOurs }, root, div({ exclude: ["node_modules"] }));

    expect(wrote).toEqual({ ok: true, wrote: true });
  });

  it("says nothing for an ordinary save", async () => {
    await put(`{ "copy": [".env"] }\n`);

    const wrote = await writeNativeConfig(realDeps, root, div({ exclude: ["node_modules"] }));

    expect(wrote).toEqual({ ok: true, wrote: true });
  });
});

describe("a suggestion is consent to record, never a preference (suggest-worktree-initialization D3)", () => {
  const SUGGESTED: ProvisionModel = {
    entries: [
      { id: "s1", path: ".env.local", mode: "copy", source: ".env.local", suggestion: "root file" },
      { id: "s2", path: ".envrc", mode: "copy", source: ".envrc", suggestion: "root file" },
    ],
    setup: [{ id: "s3", kind: "shell", script: "pnpm install", source: "pnpm-lock.yaml", suggestion: "lockfile" }],
    ports: [],
    providers: [],
    excluded: [],
    contenders: [],
    problems: [],
  };

  it("derives nothing at all from untouched suggestions", () => {
    // The smallest failure this guards: an unchecked `.env` suggestion becoming
    // `exclude: [".env"]` — a preference nobody expressed.
    expect(divergenceOf(SUGGESTED, new Set(), false)).toEqual({
      exclude: [],
      drop: [],
      addCopy: [],
      unnamedSource: false,
      tookSource: false,
    });
  });

  it("turns only the ticked suggested file into a copy addition; setup never enters", () => {
    const d = divergenceOf(SUGGESTED, new Set(["s1", "s3"]), false);

    expect(d.addCopy).toEqual([".env.local"]);
    expect(d.exclude).toEqual([]);
    expect(d.drop).toEqual([]);
    expect(JSON.stringify(d)).not.toContain("pnpm install");
  });

  it("creates the first configuration from a saved suggestion, inline and without extends", async () => {
    const wrote = await writeNativeConfig(realDeps, root, div({ addCopy: [".env.local"] }));

    expect(wrote).toEqual({ ok: true, wrote: true });
    expect(JSON.parse(await fs.readFile(target, "utf8"))).toEqual({ copy: [".env.local"] });
  });

  it("appends a saved suggestion to an existing copy list without restyling it", async () => {
    await put('{\n  // keep\n  "copy": [\n    ".env"\n  ]\n}\n');

    const wrote = await writeNativeConfig(realDeps, root, div({ addCopy: [".env.local"] }));

    expect(wrote).toEqual({ ok: true, wrote: true });
    const after = await fs.readFile(target, "utf8");
    expect(after).toContain("// keep");
    expect(parseJsonc(after)).toEqual({ copy: [".env", ".env.local"] });
  });

  it("records a copy it already holds exactly once", async () => {
    await put('{ "copy": [".env.local"] }\n');
    const before = await fs.readFile(target, "utf8");

    const wrote = await writeNativeConfig(realDeps, root, div({ addCopy: [".env.local"] }));

    expect(wrote).toEqual({ ok: true, wrote: false });
    expect(await fs.readFile(target, "utf8")).toBe(before);
  });

  it("a saved suggestion becomes the provisioning source, and every suggestion disappears", async () => {
    await fs.writeFile(path.join(root, ".env.local"), "SECRET=1\n", "utf8");
    await fs.writeFile(path.join(root, "pnpm-lock.yaml"), "", "utf8");
    const before = await readProvisioning(createProvisioningDeps(), root);
    // The witness is non-vacuous only if the suggestions were actually offered.
    expect(before.entries.map((e) => e.path)).toEqual([".env.local"]);
    expect(before.setup.map((s) => s.script)).toEqual(["pnpm install"]);
    const envId = before.entries[0]?.id ?? "";

    const wrote = await writeNativeConfig(realDeps, root, divergenceOf(before, new Set([envId]), false));
    const after = await readProvisioning(createProvisioningDeps(), root);

    expect(wrote).toEqual({ ok: true, wrote: true });
    // The saved copy returns as a native configured entry — no suggestion
    // marker, so it starts checked like any configured row.
    expect(after.entries.map((e) => [e.path, e.source, e.suggestion])).toEqual([
      [".env.local", NATIVE_PROVIDER_FILE, undefined],
    ]);
    // The unsaved setup suggestion does not survive the save: the native file
    // now governs, and fallback authority ended with the configuration-free
    // state (spec: a saved configuration replaces fallback suggestions).
    expect(after.setup).toEqual([]);
    expect(after.providers.map((p) => [p.id, p.active])).toEqual([["native", true]]);
  });

  it("an untouched suggestion set saved writes no file", async () => {
    await fs.writeFile(path.join(root, ".env.local"), "SECRET=1\n", "utf8");
    const before = await readProvisioning(createProvisioningDeps(), root);
    expect(before.entries).toHaveLength(1);

    const wrote = await writeNativeConfig(realDeps, root, divergenceOf(before, new Set(), false));

    expect(wrote).toEqual({ ok: true, wrote: false });
    await expect(fs.lstat(target)).rejects.toThrow();
  });
});
