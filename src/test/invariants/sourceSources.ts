// src/test/invariants/sourceSources.ts — Reading this repo's own sources, honestly.
// See asimov/changes/verify-cross-layer-scale/design.md D1.
//
// Shared by coverage.test.ts and sourceBytes.test.ts, which both walk `src/` and both used
// to carry their own copy of the walk.
//
// Everything here reads through `node:fs`, never a shell. Five sources in this repo embed a
// literal NUL, which makes BSD grep classify them as binary and skip them printing nothing
// to stdout — that is how this change's own discovery first read two wired call sites as dead.

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/** Every `.ts` file under `dir`, recursively. */
export function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...tsFiles(full));
    } else if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

export interface Declaration {
  readonly title: string;
  /** The `.skip` / `.todo` / … chain hung off the declaration itself, without a leading dot. */
  readonly modifiers: string;
  /** Whether some enclosing `describe(...)` is itself disabled. */
  readonly enclosingInert: boolean;
}

/** Modifiers that mean the declaration does not run, so it cannot hold an invariant open. */
const INERT = /(^|\.)(skip|todo|failing|concurrent\.skip)($|\.)/;

/** Nodes that introduce a binding scope, so a name declared inside one shadows the outer name. */
function isScope(node: ts.Node): boolean {
  return (
    ts.isSourceFile(node) ||
    ts.isBlock(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isForStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isCaseBlock(node)
  );
}

/** The names `scope` declares directly — not those its nested scopes declare. */
function scopeDeclarations(scope: ts.Node): Set<string> {
  const names = new Set<string>();
  const addBinding = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) {
      names.add(name.text);
      return;
    }
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) {
        addBinding(element.name);
      }
    }
  };
  const walk = (node: ts.Node): void => {
    if (isScope(node)) {
      return;
    }
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
      addBinding(node.name);
    }
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name !== undefined) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(scope, walk);
  return names;
}

interface Bindings {
  /** Local names bound to vitest's `it` / `test`. */
  readonly runners: ReadonlySet<string>;
  /** Local names bound to vitest's `describe` / `suite`. */
  readonly suites: ReadonlySet<string>;
}

/**
 * The local names this file actually imported from vitest.
 *
 * A file that imports nothing from vitest declares no tests, whatever it names its functions.
 * All 235 test files in this repo import their runner explicitly, so requiring the import
 * costs no real coverage and removes a whole family of false positives.
 */
function vitestBindings(file: ts.SourceFile): Bindings {
  const runners = new Set<string>();
  const suites = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    if (statement.moduleSpecifier.text !== "vitest") {
      continue;
    }
    const named = statement.importClause?.namedBindings;
    if (named === undefined || !ts.isNamedImports(named)) {
      continue;
    }
    for (const element of named.elements) {
      const exported = (element.propertyName ?? element.name).text;
      if (exported === "it" || exported === "test") {
        runners.add(element.name.text);
      }
      if (exported === "describe" || exported === "suite") {
        suites.add(element.name.text);
      }
    }
  }
  return { runners, suites };
}

/** The root identifier of a callee and the `.skip`-style chain hung off it. */
function chainOf(callee: ts.Expression): { root: string; modifiers: string } | null {
  const parts: string[] = [];
  let node: ts.Expression = callee;
  // `it.each([...])("title", …)` puts a CALL in the callee position, so the chain has to
  // walk through one as well as through property accesses.
  while (ts.isPropertyAccessExpression(node) || ts.isCallExpression(node)) {
    if (ts.isCallExpression(node)) {
      node = node.expression;
      continue;
    }
    parts.unshift(node.name.text);
    node = node.expression;
  }
  return ts.isIdentifier(node) ? { root: node.text, modifiers: parts.join(".") } : null;
}

/**
 * Every `it(...)` / `test(...)` declaration a runner would actually execute.
 *
 * Parsed, not lexed, and read for execution rather than existence. Four scanners have now
 * failed the one property this exists for — that only a declaration which really runs counts
 * — and each failure was certified as correct by its own fixture:
 *
 *   1. a commented-out declaration (round 1)
 *   2. one inside a string, template or regex literal (round 2)
 *   3. `item(` read as `it` with the modifier `em` (round 3)
 *   4. one under `describe.skip`, or calling a locally shadowed `it` (round 4)
 *
 * The first three were lexical and the parser retired them: comments, literals and identifier
 * boundaries are not cases to remember, they are simply not call expressions. The fourth was
 * not lexical at all — the call site was real, and still did not run. So the scan resolves
 * `it` to the name the file imported from vitest, refuses it where an inner scope rebinds it,
 * and carries the enclosing suite's disabled state down to the declaration.
 */
export function declarationsIn(source: string): Declaration[] {
  const file = ts.createSourceFile("scan.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const { runners, suites } = vitestBindings(file);
  const found: Declaration[] = [];
  const scopes: Set<string>[] = [];
  const shadowed = (name: string): boolean => scopes.some((scope) => scope.has(name));

  const visit = (node: ts.Node, inert: boolean): void => {
    const opensScope = isScope(node);
    if (opensScope) {
      scopes.push(scopeDeclarations(node));
    }

    let childInert = inert;
    if (ts.isCallExpression(node)) {
      const chain = chainOf(node.expression);
      if (chain !== null && !shadowed(chain.root)) {
        const selfInert = INERT.test(chain.modifiers);
        const title = node.arguments[0];
        if (
          runners.has(chain.root) &&
          title !== undefined &&
          (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title))
        ) {
          found.push({ title: title.text, modifiers: chain.modifiers, enclosingInert: inert });
        }
        if (suites.has(chain.root)) {
          childInert = inert || selfInert;
        }
      }
    }

    ts.forEachChild(node, (child) => visit(child, childInert));
    if (opensScope) {
      scopes.pop();
    }
  };

  visit(file, false);
  return found;
}

/** A declaration a runner would actually execute. */
export function isActive(declaration: Declaration): boolean {
  return !declaration.enclosingInert && !INERT.test(declaration.modifiers);
}
