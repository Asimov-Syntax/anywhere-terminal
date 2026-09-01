import * as fs from "node:fs";
import * as path from "node:path";
import * as tsmod from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Two round-1 findings were about ownership, not behaviour: a second POSIX
 * quoting helper (F004) and a third copy of the model assembly (F007). Both
 * were fixed, and neither fix had a test that could fail — the D4 rendering
 * assertions passed happily while the duplicate existed, because a duplicate
 * produces the SAME output. That is exactly why duplication is dangerous and
 * exactly why a behavioural test cannot see it (.reviews/round-2.md F008).
 *
 * So these are structural, like `readOnly.test.ts` next door. The property is
 * "one owner", and the only way to state it is over the source.
 */
const SHIPPED = fs
  .readdirSync(__dirname)
  .filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))
  .sort();

/** Source with comments stripped — the claim is about code, not about prose. */
function sourceOf(file: string): string {
  return fs
    .readFileSync(path.join(__dirname, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/**
 * The apostrophe-escape sequence, however it is spelled.
 *
 * `'\''` is the whole of POSIX single-argument quoting, so any module that
 * contains it is quoting for itself. Written to match both the `replaceAll`
 * form the shared helper uses and the `split`/`join` form the adapter had.
 */
const QUOTE_ESCAPE = /'\\\\''|"'\\\\''"|`'\\\\''`/;

/** A model built from a literal rather than from the one assembly point. */
const MODEL_LITERAL = /providers:\s*(\[\]|PROVIDERS)\s*,\s*\n?\s*excluded:/;

describe("one owner for the quoting rule", () => {
  it.each(SHIPPED)("%s does not spell its own POSIX escape", (file) => {
    expect(QUOTE_ESCAPE.test(sourceOf(file))).toBe(false);
  });

  it("catches a module that spells it", () => {
    // Without this the check above passes just as happily against a typo in the
    // pattern as against a clean directory.
    expect(QUOTE_ESCAPE.test(`return \`'\${word.split("'").join(\`'\\\\''\`)}'\`;`)).toBe(true);
    expect(QUOTE_ESCAPE.test(`return \`'\${value.replaceAll("'", "'\\\\''")}'\`;`)).toBe(true);
  });

  it("does not fire on a module that merely calls the shared helper", () => {
    expect(QUOTE_ESCAPE.test("words.push(posixShellQuote(value));")).toBe(false);
  });
});

describe("one owner for the model assembly", () => {
  it("is providerKit alone", () => {
    const assemblers = SHIPPED.filter((file) => MODEL_LITERAL.test(sourceOf(file)));

    // An adapter that assembles its own is how a field added to ProvisionModel
    // reaches two adapters and misses the third.
    expect(assemblers).toEqual(["providerKit.ts"]);
  });

  it("catches an adapter that assembles its own", () => {
    const copied = [
      "  return {",
      "    entries: draft.entries,",
      "    setup: draft.setup,",
      "    ports: draft.ports,",
      "    providers: [],",
      "    excluded: [],",
      "    problems: draft.problems,",
      "  };",
    ].join("\n");

    expect(MODEL_LITERAL.test(copied)).toBe(true);
  });
});

/**
 * The four inline keys `.vscode/worktree.json` shares with `asimov/worktree.yaml`
 * (worktree-provisioning.md § 3.4: "same shapes as the asimov adapter").
 *
 * A module OWNS that mapping when it names all four keys and turns them into
 * rows. Naming them without expanding — a known-key set handed to the reader —
 * is a caller, not an owner.
 */
const INLINE_KEY_MAPPING = [/"copy"/, /"link"/, /`ports`|"ports"/, /`setup`|"setup"/, /entriesFor\(/];

describe("one owner for the four inline keys", () => {
  it("is providerKit alone", () => {
    const owners = SHIPPED.filter((file) => {
      const source = sourceOf(file);
      return INLINE_KEY_MAPPING.every((m) => m.test(source));
    });

    // Two readers of one format drift, and the drift is silent: both emit rows
    // that look right until one of them learns a key the other does not.
    expect(owners).toEqual(["providerKit.ts"]);
  });

  it("catches a second module that maps them", () => {
    const copied = [
      'const KNOWN = new Set(["copy", "link", "ports", "setup"]);',
      'await entriesFor(record.copy, "copy", repoRoot, root, deps, nextId, draft);',
      'await entriesFor(record.link, "link", repoRoot, root, deps, nextId, draft);',
    ].join("\n");

    expect(INLINE_KEY_MAPPING.every((m) => m.test(copied))).toBe(true);
  });

  it("does not fire on a module that only declares which keys it reads", () => {
    const caller = 'const KNOWN_KEYS = new Set(["copy", "link", "ports", "setup"]);';

    expect(INLINE_KEY_MAPPING.every((m) => m.test(caller))).toBe(false);
  });
});

/**
 * A thrown value converted to display text, inline.
 *
 * `messageOf` was extracted on round-1 F011 after three copies had already
 * drifted — two answered `String(error)` and the newest answered a literal
 * `"unknown error"` on the wire. Round 4 found two more still here, so the
 * property gets a test instead of a fourth review round (.reviews/round-4.md
 * F011).
 */
const INLINE_CONVERSION = /instanceof Error\s*\?[\s\S]{0,80}?\.message\s*:/;

describe("one owner for turning a thrown value into display text", () => {
  it("is errorMessage.ts alone, and no provisioning module keeps its own", () => {
    const owners = SHIPPED.filter((file) => INLINE_CONVERSION.test(sourceOf(file)));

    expect(owners).toEqual([]);
  });

  it("catches a copy, so the assertion above is not vacuous", () => {
    const copied =
      'report(draft, label, problem(ASIMOV, "malformed", error instanceof Error ? error.message : String(error)));';

    expect(INLINE_CONVERSION.test(copied)).toBe(true);
  });

  it("does not fire on a module that merely narrows a thrown value", () => {
    const narrowing = 'if (err instanceof Error && err.code === "ENOENT") {\n  return null;\n}';

    expect(INLINE_CONVERSION.test(narrowing)).toBe(false);
  });
});

/**
 * A site that decides for itself whether a name is a lockfile.
 *
 * The direct entry and the descendant walk answer the same question, and rounds
 * 2 and 4 were both about the two answers drifting apart. Whoever classifies
 * reaches into `LOCKFILES` — so counting reaches counts owners, and a caller of
 * `refusedLockfile` reaches zero times (.reviews/round-5.md F029).
 */
const LOCKFILE_CLASSIFIER = /LOCKFILES\.has\(/g;

describe("one owner for the lockfile rule", () => {
  it("decides it in exactly one place", () => {
    const reaches = SHIPPED.map((file) => [file, sourceOf(file).match(LOCKFILE_CLASSIFIER)?.length ?? 0] as const);

    expect(reaches.filter(([, n]) => n > 0)).toEqual([["entryGate.ts", 1]]);
  });

  it("catches the second owner this replaced", () => {
    // The shape task 4_1 left behind, verbatim in structure: `refusedMaterial`
    // folding and looking up for itself instead of asking the exported rule.
    const copied = [
      "export function refusedLockfile(d: string): string | null {",
      "  return LOCKFILES.has(filesystemIdentity(path.basename(d))) ? LOCKFILE_REASON : null;",
      "}",
      "function refusedMaterial(d: string, mode: Mode): string | null {",
      "  const base = filesystemIdentity(path.basename(d));",
      "  if (LOCKFILES.has(base)) {",
      "    return LOCKFILE_REASON;",
      "  }",
      "  return null;",
      "}",
    ].join("\n");

    expect(copied.match(LOCKFILE_CLASSIFIER)?.length).toBe(2);
  });

  it("does not fire on a module that merely asks the rule", () => {
    expect("const material = refusedLockfile(destination);".match(LOCKFILE_CLASSIFIER)).toBeNull();
  });
});

/**
 * Identity is decided from the declared spellings and nothing else.
 *
 * Seven mechanisms for "are these two paths one file?" have now been refuted,
 * and six of them were filesystem probes. Each was correct-looking and each
 * dropped a declaration on some volume, so the property worth gating is not
 * "the current helper does not call `realpath`" — it is that NOTHING the
 * identity or exclusion path reaches can consult a filesystem at all
 * (design.md D1, and the obligation ledger's first row).
 *
 * REACHABILITY, not naming: a helper that calls `inspect()` which calls
 * `deps.realpath()` defeats a lexical match on the helper alone, and that is
 * exactly the shape the eighth mechanism will have.
 *
 * Round 1 F005 replaced the regex this started as. That version recognised only
 * `function` at the left margin, so an arrow-function helper — the ordinary way
 * anyone would write one — walked straight past a gate whose whole job is to
 * stop the next mechanism. It also followed CALL sites only, so a helper handed
 * across as a bare value was an invisible edge. Both are closed by parsing:
 * every named callable form is a node, and every identifier REFERENCE is an
 * edge, whether or not it is called where it is named.
 *
 * What it still does not do is cross a module boundary, and that is why the
 * pattern below matches `deps` itself: handing the deps to an imported helper
 * is the only way one can reach a hook, and that hand-off is visible here.
 */
const IDENTITY_ROOTS: readonly (readonly [file: string, root: string])[] = [
  ["providerKit.ts", "identityOf"],
  ["providerKit.ts", "foldSegment"],
  ["providerKit.ts", "foldable"],
  ["providerKit.ts", "contendersOf"],
  ["readProvisioning.ts", "mergeEntries"],
  ["readProvisioning.ts", "applyExclude"],
];

/** Every dep hook, plus the value that carries them and the keyword they need. */
const CONSULTS_A_FILESYSTEM = /\bdeps\b|\bawait\b|\.(?:readFile|readdir|realpath|lstat)\s*\(/;

/** `ts.sys` is undefined when the namespace import is used directly under bun. */
const ts: typeof tsmod = (tsmod as { default?: typeof tsmod }).default ?? tsmod;

/**
 * Every named callable in the file, whatever form it was written in.
 *
 * Declarations, `const f = () => {}`, `const f = function () {}`, and object or
 * class methods. Nesting is walked too: a helper declared inside another
 * function is still a helper.
 */
function callablesOf(source: string): Map<string, tsmod.Node> {
  const file = ts.createSourceFile("probe.ts", source, ts.ScriptTarget.Latest, true);
  const found = new Map<string, tsmod.Node>();

  const visit = (node: tsmod.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      found.set(node.name.text, node);
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      const init = node.initializer;
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        found.set(node.name.text, init);
      }
    } else if ((ts.isMethodDeclaration(node) || ts.isPropertyAssignment(node)) && ts.isIdentifier(node.name)) {
      const body = ts.isMethodDeclaration(node) ? node : node.initializer;
      if (
        body !== undefined &&
        (ts.isMethodDeclaration(body) || ts.isArrowFunction(body) || ts.isFunctionExpression(body))
      ) {
        found.set(node.name.text, body);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(file);
  return found;
}

/** Every identifier a node mentions — a reference, not only a call. */
function referencesOf(node: tsmod.Node): Set<string> {
  const names = new Set<string>();
  const visit = (child: tsmod.Node): void => {
    if (ts.isIdentifier(child)) {
      names.add(child.text);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return names;
}

/**
 * The roots and everything they reach, transitively.
 *
 * A name that resolves to an import rather than a local callable is not in the
 * map and cannot be walked, which is the one limit left and the reason the
 * pattern matches `deps` itself.
 */
function reachableFrom(source: string, roots: readonly string[]): Set<string> {
  const callables = callablesOf(source);
  const seen = new Set<string>();
  const queue = [...roots];
  for (;;) {
    const name = queue.pop();
    if (name === undefined) {
      return seen;
    }
    const node = callables.get(name);
    if (node === undefined || seen.has(name)) {
      continue;
    }
    seen.add(name);
    for (const other of referencesOf(node)) {
      if (other !== name && callables.has(other)) {
        queue.push(other);
      }
    }
  }
}

/** The source of one reachable callable, comments stripped like everything else here. */
function bodyOf(source: string, name: string): string {
  const node = callablesOf(source).get(name);
  return node === undefined ? "" : node.getText();
}

describe("identity never reaches a filesystem", () => {
  it("names roots that all still exist, so the walk below is not vacuous", () => {
    // Named per FILE since the fold and the grouping moved to `providerKit.ts`
    // so one model assembly point could fill the relation for every adapter.
    // A root that silently stopped resolving would make its own check pass.
    const missing = IDENTITY_ROOTS.filter(([file, root]) => !callablesOf(sourceOf(file)).has(root));

    expect(missing).toEqual([]);
  });

  it.each(IDENTITY_ROOTS)("%s#%s reaches no dep hook, in any callable shape", (file, root) => {
    const source = sourceOf(file);
    const offenders = [...reachableFrom(source, [root])].filter((name) =>
      CONSULTS_A_FILESYSTEM.test(bodyOf(source, name)),
    );

    expect(offenders).toEqual([]);
  });

  it("catches a root that calls a hook itself", () => {
    const direct = [
      "async function identityOf(declared: string, deps: ProviderDeps): Promise<string> {",
      "  return await deps.realpath(declared);",
      "}",
    ].join("\n");

    expect(CONSULTS_A_FILESYSTEM.test(bodyOf(direct, "identityOf"))).toBe(true);
  });

  it("[round-1 F005] catches an ARROW helper, which the regex walk could not see", () => {
    // The shape anyone would actually write. The old walk matched `function` at
    // the left margin, so this file was green while the hook was one hop away.
    const arrow = [
      "function identityOf(declared: string, io: Io): string {",
      "  return inspect(declared, io);",
      "}",
      "const inspect = async (declared: string, deps: ProviderDeps): Promise<string> => {",
      "  return deps.realpath(declared);",
      "};",
    ].join("\n");
    const reached = reachableFrom(arrow, ["identityOf"]);

    expect(CONSULTS_A_FILESYSTEM.test(bodyOf(arrow, "identityOf"))).toBe(false);
    expect([...reached].filter((n) => CONSULTS_A_FILESYSTEM.test(bodyOf(arrow, n)))).toEqual(["inspect"]);
  });

  it("[round-1 F005] catches a helper handed across as a value rather than called", () => {
    // `mergeEntries(a, b, probe)` never writes `probe(`, so a call-site walk
    // sees no edge at all. Every identifier reference is an edge now.
    const passed = [
      "function identityOf(declared: string, io: Io): string {",
      "  return mergeEntries(declared, io, probe);",
      "}",
      "const probe = async (declared: string, deps: ProviderDeps): Promise<string> => {",
      "  return deps.realpath(declared);",
      "};",
    ].join("\n");

    expect(reachableFrom(passed, ["identityOf"]).has("probe")).toBe(true);
  });

  it("[round-1 F005] catches a hook reached through an object method", () => {
    const method = [
      "function identityOf(declared: string): string {",
      "  return probes.resolve(declared);",
      "}",
      "const probes = {",
      "  resolve(declared: string) {",
      "    return deps.realpath(declared);",
      "  },",
      "};",
    ].join("\n");
    const reached = reachableFrom(method, ["identityOf"]);

    expect([...reached].filter((n) => CONSULTS_A_FILESYSTEM.test(bodyOf(method, n)))).toEqual(["resolve"]);
  });

  it("[round-1 F005] proves the shapes above are ones the lexical walk could not see", () => {
    // Non-vacuity for the three tests before this. The walk this replaced found
    // callables with `^(?:export )?(?:async )?function NAME`, so if that pattern
    // still matched them the AST would be doing no work worth having.
    const LEFT_MARGIN_FUNCTION = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm;
    const shapes = [
      "const inspect = async (declared: string, deps: ProviderDeps): Promise<string> => {\n  return deps.realpath(declared);\n};",
      "const probe = async (declared: string, deps: ProviderDeps) => deps.realpath(declared);",
      "const probes = {\n  resolve(declared: string) {\n    return deps.realpath(declared);\n  },\n};",
    ];

    for (const shape of shapes) {
      expect(shape.match(LEFT_MARGIN_FUNCTION)).toBeNull();
      expect(callablesOf(shape).size).toBeGreaterThan(0);
    }
  });

  it("does not fire on a helper that only reads the declared spelling", () => {
    const clean = [
      "function identityOf(declared: string): string {",
      "  return path.posix.normalize(declared).replace(/\\/+$/, '');",
      "}",
    ].join("\n");

    expect(CONSULTS_A_FILESYSTEM.test(bodyOf(clean, "identityOf"))).toBe(false);
  });
});
