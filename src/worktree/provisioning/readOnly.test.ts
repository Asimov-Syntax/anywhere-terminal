import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The modules that turn four checked-in, untrusted files into a model.
 *
 * The obligation these tests hold: nothing on this path can run a command or
 * change a byte on disk. `ProviderDeps` offers four reads and withholds
 * everything else, but an interface only constrains what a module is HANDED —
 * it says nothing about what the module imports for itself, and an import is
 * one line away at any time. This is the check that notices.
 */
const READ_PATH = [
  "providerKit.ts",
  "asimovProvider.ts",
  "nativeProvider.ts",
  "orcaProvider.ts",
  "vscodeTasksProvider.ts",
  "readProvisioning.ts",
];

/** Executing something, or changing something. Either ends the property. */
const FORBIDDEN: readonly { name: string; pattern: RegExp }[] = [
  { name: "child_process", pattern: /from\s+["']node:child_process["']|require\(\s*["']node:child_process["']/ },
  { name: "worker_threads", pattern: /from\s+["']node:worker_threads["']|require\(\s*["']node:worker_threads["']/ },
  { name: "vm", pattern: /from\s+["']node:vm["']|require\(\s*["']node:vm["']/ },
  // A named fs import is how a write would arrive: the module already imports
  // `node:path`, so an `fs` line next to it would not look out of place.
  {
    name: "an fs mutation",
    // A CALL, not the word: these modules discuss symlinks and truncation in
    // prose, and a matcher that fired on prose would be turned off within a
    // week for crying wolf.
    pattern:
      /\b(writeFile|writeFileSync|appendFile|appendFileSync|rename|renameSync|unlink|unlinkSync|rmdir|rmdirSync|mkdir|mkdirSync|rmSync|copyFile|copyFileSync|symlink|symlinkSync|chmod|chmodSync|truncate|truncateSync)\s*\(/,
  },
  // The whole module, imported wholesale, carries every one of the above.
  { name: "the fs module", pattern: /from\s+["']node:fs(\/promises)?["']|require\(\s*["']node:fs(\/promises)?["']/ },
];

/**
 * The rest of the directory: modules that legitimately write, and the fake that
 * stands in for one. Declared rather than filtered so a NEW module lands in
 * neither list and fails the completeness check below.
 */
const NOT_READ_PATH = [
  "applyEntries.ts",
  "applyEntries.fake.ts",
  "applyProvisioning.ts",
  "entryGate.ts",
  "offerStore.ts",
  "provisioningDeps.ts",
  "writeNativeConfig.ts",
];

/** Source with its comments removed — this asks what the code does, not what it says. */
function sourceOf(file: string): string {
  return fs
    .readFileSync(path.join(__dirname, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("the provisioning read path can neither run nor write", () => {
  it.each(READ_PATH)("%s imports nothing that executes or mutates", (file) => {
    const source = sourceOf(file);
    const found = FORBIDDEN.filter((f) => f.pattern.test(source)).map((f) => f.name);

    expect(found).toEqual([]);
  });

  it("names every module of the read path", () => {
    // A module added to the directory and left off this list would be
    // unchecked, and the list is what makes the check complete rather than
    // merely true of five files somebody remembered.
    const shipped = fs.readdirSync(__dirname).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"));

    expect([...shipped].sort()).toEqual([...READ_PATH, ...NOT_READ_PATH].sort());
  });
});

describe("the check itself would fail if the property broke", () => {
  // Every matcher, run over source that violates it. Without this the suite
  // above passes just as happily against a typo in a regex as against a clean
  // module — an assertion that cannot fail proves nothing.
  it.each(FORBIDDEN.map((f) => f.name))("catches %s", (name) => {
    const violations: Record<string, string> = {
      child_process: `import { execSync } from "node:child_process";`,
      worker_threads: `import { Worker } from "node:worker_threads";`,
      vm: `import * as vm from "node:vm";`,
      "an fs mutation": "await handle.writeFile(destination, text);",
      "the fs module": `import { readFile } from "node:fs/promises";`,
    };
    const matcher = FORBIDDEN.find((f) => f.name === name);
    const violation = violations[name];
    if (matcher === undefined || violation === undefined) {
      throw new Error(`no violation written for ${name}`);
    }

    expect(matcher.pattern.test(violation)).toBe(true);
    // And does not fire on the ordinary shape of these modules.
    expect(matcher.pattern.test(`import * as path from "node:path";\nconst names = await deps.readdir(dir);`)).toBe(
      false,
    );
  });
});
