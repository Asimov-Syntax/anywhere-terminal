// src/test/invariants/sourceBytes.test.ts — No raw control bytes in the sources.
// See asimov/changes/verify-cross-layer-scale/design.md D7.
//
// A literal NUL used as a join separator is runtime-identical to the "\0" escape, but it makes
// BSD grep classify the whole file as binary and skip it while printing nothing to stdout.
// Every grep-based tool then reads the file as empty — review agents and this change's own
// invariant audit included, which is how two wired call sites were first read as dead code.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { tsFiles } from "./sourceSources";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SRC = path.join(REPO_ROOT, "src");

/**
 * Owned by task WT-006.2 in another session, so this change does not touch it. Listed rather
 * than pattern-excluded: the second assertion fails once the peer fixes it, which is the signal
 * to delete this entry instead of leaving a stale exemption behind.
 */
const PEER_OWNED = ["src/agentHooks/install/managedEntryLedger.ts"];

const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const FIRST_PRINTABLE = 0x20;

/** Tab, LF and CR are ordinary source bytes; every other byte below 0x20 is not. */
function hasControlByte(bytes: Buffer): boolean {
  return bytes.some((byte) => byte < FIRST_PRINTABLE && byte !== TAB && byte !== LF && byte !== CR);
}

function offenders(): string[] {
  return tsFiles(SRC)
    .filter((full) => hasControlByte(fs.readFileSync(full)))
    .map((full) => path.relative(REPO_ROOT, full));
}

describe("source hygiene — raw control bytes", () => {
  it("leaves no source unreadable to a grep-based tool", () => {
    expect(offenders().filter((rel) => !PEER_OWNED.includes(rel))).toEqual([]);
  });

  it("keeps the peer-owned exemption honest, so a fixed file stops being exempt", () => {
    expect(offenders().filter((rel) => PEER_OWNED.includes(rel))).toEqual(PEER_OWNED);
  });
});

// ── I10: no direct destructive filesystem call in production ─────────────
//
// design.md D10. A test cannot prove "the extension never deletes files directly" — it can
// only prove that the paths it happens to walk delegate to git. Round 3 was right that
// writing the gap into the registry documented it rather than closing it, so this asserts
// the property over the SOURCE, the same shape as the byte scan above.

/** The `node:fs` members that remove something from disk. */
const DESTRUCTIVE = new Set(["rm", "rmSync", "rmdir", "rmdirSync", "unlink", "unlinkSync"]);

function isFsModule(specifier: string): boolean {
  return specifier === "fs" || specifier === "fs/promises" || specifier.startsWith("node:fs");
}

/**
 * Every destructive `node:fs` call in `source`, found by resolving fs bindings rather than
 * by matching text.
 *
 * Round-4 B2: the first version of this rule was a regex over `<namespace>.rm*(`, so
 * `import { rm } from "node:fs/promises"` and then `rm(dir)` — the shortest spelling, and
 * the one a new call site is most likely to use — was invisible to it. A rule that only
 * catches the verbose spelling of the thing it forbids is not a rule.
 */
function destructiveCalls(source: string): string[] {
  const file = ts.createSourceFile("scan.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  /** Names holding an fs module object: `fs`, `nodeFs`, a local alias of `promises`. */
  const namespaces = new Set<string>();
  /** Names holding a destructive function directly: `rm`, or `removeIt` from an alias. */
  const direct = new Map<string, string>();

  const bindNamed = (exported: string, local: string): void => {
    if (DESTRUCTIVE.has(exported)) {
      direct.set(local, exported);
    } else if (exported === "promises" || exported === "default") {
      namespaces.add(local);
    }
  };

  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    if (!isFsModule(statement.moduleSpecifier.text)) {
      continue;
    }
    const clause = statement.importClause;
    if (clause?.name !== undefined) {
      namespaces.add(clause.name.text);
    }
    const named = clause?.namedBindings;
    if (named !== undefined && ts.isNamespaceImport(named)) {
      namespaces.add(named.name.text);
    }
    if (named !== undefined && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        bindNamed((element.propertyName ?? element.name).text, element.name.text);
      }
    }
  }

  /** Whether `node` evaluates to an fs module object — `fs`, or `fs.promises`. */
  const isNamespace = (node: ts.Expression): boolean => {
    if (ts.isIdentifier(node)) {
      return namespaces.has(node.text);
    }
    return ts.isPropertyAccessExpression(node) && node.name.text === "promises" && isNamespace(node.expression);
  };

  // A second pass: `const { rm } = fs.promises` hands the function to a bare name, which the
  // import pass above cannot see because the binding is not an import.
  const collectDestructures = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined && isNamespace(node.initializer)) {
      if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          if (ts.isIdentifier(element.name)) {
            bindNamed(
              (element.propertyName !== undefined ? element.propertyName : element.name).getText(),
              element.name.text,
            );
          }
        }
      } else if (ts.isIdentifier(node.name)) {
        namespaces.add(node.name.text);
      }
    }
    ts.forEachChild(node, collectDestructures);
  };
  collectDestructures(file);

  const calls: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && direct.has(callee.text)) {
        calls.push(callee.text);
      } else if (
        ts.isPropertyAccessExpression(callee) &&
        DESTRUCTIVE.has(callee.name.text) &&
        isNamespace(callee.expression)
      ) {
        calls.push(`${callee.expression.getText()}.${callee.name.text}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return calls;
}

function isWorktreeRemovalCode(file: string): boolean {
  const rel = path.relative(REPO_ROOT, file);
  if (rel.includes(".test.") || rel.includes("/bench/")) {
    return false;
  }
  return rel.startsWith("src/worktree/") || rel === "src/providers/WorktreeHost.ts";
}

describe("[I10] the extension deletes no directory itself", () => {
  it("makes a direct destructive fs call in production code a suite failure", () => {
    const offenders = tsFiles(SRC)
      .filter(isWorktreeRemovalCode)
      .filter((file) => destructiveCalls(fs.readFileSync(file, "utf8")).length > 0)
      .map((file) => path.relative(REPO_ROOT, file));

    // Directory removal is delegated to git, which is what bounds OUR bugs — git's own
    // recursive consequences are its to own (docs/DESIGN.md § 8.4 I10).
    expect(offenders).toEqual([]);
    // And the rule has something to be true OF: an empty file list would make it vacuous.
    expect(tsFiles(SRC).filter(isWorktreeRemovalCode).length).toBeGreaterThan(10);
  });

  it("would notice one, so the empty list above is a result and not an absence", () => {
    const NS = 'import fs from "node:fs";\n';
    expect(destructiveCalls(`${NS}await fs.rm(target, { recursive: true });`)).toEqual(["fs.rm"]);
    expect(destructiveCalls(`${NS}fs.rmSync(dir);`)).toEqual(["fs.rmSync"]);
    expect(destructiveCalls(`${NS}await fs.promises.unlink(p);`)).toEqual(["fs.promises.unlink"]);
    // Round-4 B2: every one of these bypassed the regex this rule used to be.
    expect(destructiveCalls('import { rm } from "node:fs/promises";\nawait rm(dir);')).toEqual(["rm"]);
    expect(destructiveCalls('import { rm as wipe } from "node:fs/promises";\nawait wipe(dir);')).toEqual(["wipe"]);
    expect(destructiveCalls('import * as nodeFs from "node:fs";\nnodeFs.rmSync(dir);')).toEqual(["nodeFs.rmSync"]);
    expect(destructiveCalls(`${NS}const { rm } = fs.promises;\nawait rm(dir);`)).toEqual(["rm"]);

    // Not deletions, and a rule that fired on these would be turned off within a week.
    expect(destructiveCalls(`${NS}fs.readFileSync(p);`)).toEqual([]);
    expect(destructiveCalls(`${NS}runner.run(["worktree", "remove", target], repo);`)).toEqual([]);
    // A local helper that merely shares the name is not an fs deletion.
    expect(destructiveCalls("const rm = (x: string) => log(x);\nrm(dir);")).toEqual([]);
  });
});
