import * as fs from "node:fs";
import * as path from "node:path";
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
 * Two limits, stated rather than hidden. The walk follows CALL SITES, so a
 * helper handed across as a bare value — `mergeEntries(a, b, probe)` — is an
 * edge it cannot see; that is why every root is walked on its own instead of
 * relying on one graph to cover the others, and why dropping a root from this
 * list silently drops a guarantee. And it reads one file: a hook reached
 * through an imported helper is caught only because passing `deps` to that
 * helper is visible in the caller's own body, which is what the pattern below
 * matches first.
 */
const IDENTITY_ROOTS = ["identityOf", "foldable", "mergeEntries", "applyExclude", "contendersOf"] as const;

/** Every dep hook, plus the value that carries them and the keyword they need. */
const CONSULTS_A_FILESYSTEM = /\bdeps\b|\bawait\b|\.(?:readFile|readdir|realpath|lstat)\s*\(/;

/** `function name(` at the left margin, and everything up to the next one. */
function topLevelFunctions(source: string): Map<string, string> {
  const marks = [...source.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm)];
  const bodies = new Map<string, string>();
  marks.forEach((mark, i) => {
    const start = mark.index ?? 0;
    const end = i + 1 < marks.length ? (marks[i + 1]?.index ?? source.length) : source.length;
    const name = mark[1];
    if (name !== undefined) {
      bodies.set(name, source.slice(start, end));
    }
  });
  return bodies;
}

/**
 * The roots and everything they call, transitively.
 *
 * A name that resolves to an import rather than a local function is not in the
 * map and cannot be walked — which is why the pattern above matches `deps`
 * itself. Handing the deps to somebody else is the only way an import can reach
 * a hook, and that hand-off is visible in the caller's own body.
 */
function reachableFrom(source: string, roots: readonly string[]): Set<string> {
  const bodies = topLevelFunctions(source);
  const seen = new Set<string>();
  const queue = [...roots];
  for (;;) {
    const name = queue.pop();
    if (name === undefined) {
      return seen;
    }
    const body = bodies.get(name);
    if (body === undefined || seen.has(name)) {
      continue;
    }
    seen.add(name);
    for (const other of bodies.keys()) {
      if (other !== name && new RegExp(`\\b${other}\\s*\\(`).test(body)) {
        queue.push(other);
      }
    }
  }
}

describe("identity never reaches a filesystem", () => {
  const source = sourceOf("readProvisioning.ts");

  it("names roots that all still exist, so the walk below is not vacuous", () => {
    const bodies = topLevelFunctions(source);

    expect(IDENTITY_ROOTS.filter((root) => !bodies.has(root))).toEqual([]);
  });

  it.each(IDENTITY_ROOTS)("%s reaches no dep hook, directly or through a helper", (root) => {
    const bodies = topLevelFunctions(source);
    const offenders = [...reachableFrom(source, [root])].filter((name) =>
      CONSULTS_A_FILESYSTEM.test(bodies.get(name) ?? ""),
    );

    expect(offenders).toEqual([]);
  });

  it("catches a root that calls a hook itself", () => {
    const direct = [
      "async function identityOf(declared: string, deps: ProviderDeps): Promise<string> {",
      "  return await deps.realpath(declared);",
      "}",
    ].join("\n");

    expect(reachableFrom(direct, ["identityOf"]).size).toBe(1);
    expect(CONSULTS_A_FILESYSTEM.test(topLevelFunctions(direct).get("identityOf") ?? "")).toBe(true);
  });

  it("catches a root that reaches one through a second helper", () => {
    // The root itself is clean here. A check that read only the root's own body
    // would pass this, which is the whole reason the walk exists.
    const indirect = [
      "function identityOf(declared: string, io: Io): string {",
      "  return inspect(declared, io);",
      "}",
      "async function inspect(declared: string, deps: ProviderDeps): Promise<string> {",
      "  return deps.realpath(declared);",
      "}",
    ].join("\n");
    const bodies = topLevelFunctions(indirect);
    const reached = reachableFrom(indirect, ["identityOf"]);

    expect(CONSULTS_A_FILESYSTEM.test(bodies.get("identityOf") ?? "")).toBe(false);
    expect([...reached].filter((n) => CONSULTS_A_FILESYSTEM.test(bodies.get(n) ?? ""))).toEqual(["inspect"]);
  });

  it("does not fire on a helper that only reads the declared spelling", () => {
    const clean = [
      "function identityOf(declared: string): string {",
      "  return path.posix.normalize(declared).replace(/\\/+$/, '');",
      "}",
    ].join("\n");
    const bodies = topLevelFunctions(clean);

    expect(CONSULTS_A_FILESYSTEM.test(bodies.get("identityOf") ?? "")).toBe(false);
  });
});
