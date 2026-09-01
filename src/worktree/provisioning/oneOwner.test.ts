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
