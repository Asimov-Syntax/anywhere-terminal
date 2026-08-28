// src/test/invariants/fsDeletionGate.ts — I10: the extension deletes no directory itself.
// See asimov/changes/verify-cross-layer-scale/design.md D10 (revised after review round 5).
//
// Run: pnpm run gate:fs-deletion
//
// Three hand-written versions of this rule each resolved identifiers by hand — a regex, then an
// AST binding walk — and round 5 walked past all of them (`const wipe = fs.promises.rm`,
// `fs.promises["rm"]`, nested destructuring) while ALSO firing on a harmless parameter named `rm`.
// Resolving what an identifier refers to is the type checker's job, so it does that job here.
//
// The rule rejects ACQUISITION, not the eventual call: chasing an alias to its call site is the
// part that kept going wrong, and acquiring the symbol is the auditable event either way.

import path from "node:path";
import * as tsmod from "typescript";

// `ts.sys` is undefined when the namespace import is used directly under bun.
const ts: typeof tsmod = (tsmod as { default?: typeof tsmod }).default ?? tsmod;

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/** Repo-relative and `/`-joined: every predicate below compares against `/` literals (W5). */
function relativeTo(fileName: string): string {
  return path.relative(REPO_ROOT, fileName).split(path.sep).join("/");
}

/** The `node:fs` members that remove something from disk. */
const DESTRUCTIVE = new Set(["rm", "rmSync", "rmdir", "rmdirSync", "unlink", "unlinkSync"]);

/**
 * Production code the worktree removal path is made of.
 *
 * A stated list, and the rule claims no more than a stated list. Six modules elsewhere delete
 * files they wrote themselves — a clipboard temp file, an injected shell script, session storage,
 * the vault cache, a sqlite temp, the peer-owned locked-JSON writer — and a rule that failed on
 * those would be a rule about `fs.rm`, not about I10.
 */
function isRemovalPath(rel: string): boolean {
  if (rel.includes(".test.") || rel.includes("/bench/")) {
    return false;
  }
  return rel.startsWith("src/worktree/") || rel === "src/providers/WorktreeHost.ts";
}

const FIXTURES = "src/test/invariants/fixtures/fsDeletion/";

export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly why: string;
}

/** Whether this symbol IS a destructive `node:fs` member, wherever it was renamed to. */
function isDestructiveFsSymbol(checker: tsmod.TypeChecker, symbol: tsmod.Symbol | undefined): boolean {
  if (symbol === undefined) {
    return false;
  }
  const resolved = (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
  if (!DESTRUCTIVE.has(resolved.getName())) {
    return false;
  }
  return (resolved.getDeclarations() ?? []).some((d) => d.getSourceFile().fileName.includes("@types/node/fs"));
}

/** Whether this type carries `node:fs` deletion members — an fs module object, or an alias of one. */
function isFsBearingType(checker: tsmod.TypeChecker, type: tsmod.Type): boolean {
  return [...DESTRUCTIVE].some((name) => isDestructiveFsSymbol(checker, type.getProperty(name)));
}

/** `any` erases the property symbol, so nothing below it can be resolved — or trusted. */
function isErased(type: tsmod.Type): boolean {
  return (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0;
}

/**
 * The member name a key expression selects, or `undefined` when it is decided at runtime.
 *
 * Round-6 B15: all four bypasses were name extraction, reimplemented inline at each AST shape.
 * `{ "rm": wipe }` read as the four characters `"rm"` INCLUDING its quotes, so the lookup missed.
 * One function, used by every shape, is what stops the next shape from inventing a fifth answer.
 */
/**
 * The member an INDEX expression selects: `obj["rm"]` yes, `obj[member]` no.
 *
 * Separate from `memberName` deliberately. An identifier means opposite things in the two
 * positions — a literal key in `{ rm: … }`, a runtime value in `obj[rm]` — and reading them with
 * one function is how `fs.promises[member]` came back as the key "member" and quietly resolved
 * to nothing.
 */
function elementKey(expression: tsmod.Expression): string | undefined {
  if (ts.isStringLiteralLike(expression) || ts.isNumericLiteral(expression)) {
    return expression.text;
  }
  return undefined;
}

function memberName(name: tsmod.Node): string | undefined {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) {
    return name.text;
  }
  if (ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name)) {
    return ts.isStringLiteralLike(name.expression) ? name.expression.text : undefined;
  }
  return undefined;
}

function scan(file: tsmod.SourceFile, checker: tsmod.TypeChecker): Finding[] {
  const found: Finding[] = [];
  const rel = relativeTo(file.fileName);
  const report = (node: tsmod.Node, why: string): void => {
    found.push({
      file: rel,
      line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
      text: node.getText(file).split("\n")[0].slice(0, 80),
      why,
    });
  };

  /**
   * One acquisition: `key` selected off an object of type `owner`.
   *
   * Both unresolved cases are rejections, not passes. D10 says fail closed, and round 6 found
   * this function's predecessor treating "the checker returned no symbol" as "not fs" — the
   * rule contradicting its own stated policy, three lines under a comment restating it.
   */
  const acquires = (node: tsmod.Node, owner: tsmod.Type, key: string | undefined): void => {
    if (key === undefined) {
      if (isFsBearingType(checker, owner) || isErased(owner)) {
        report(node, "selects a member of an fs module with a key decided at runtime");
      }
      return;
    }
    if (isDestructiveFsSymbol(checker, owner.getProperty(key))) {
      report(node, `acquires the destructive fs member ${key}`);
      return;
    }
    if (isErased(owner) && DESTRUCTIVE.has(key)) {
      report(node, `acquires ${key} through a type the checker cannot resolve`);
    }
  };

  const visit = (node: tsmod.Node): void => {
    if (ts.isImportSpecifier(node) && isDestructiveFsSymbol(checker, checker.getSymbolAtLocation(node.name))) {
      report(node, "imports a destructive fs member");
    } else if (ts.isPropertyAccessExpression(node)) {
      acquires(node, checker.getTypeAtLocation(node.expression), node.name.text);
    } else if (ts.isElementAccessExpression(node)) {
      acquires(node, checker.getTypeAtLocation(node.expression), elementKey(node.argumentExpression));
    } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const key = node.propertyName !== undefined ? memberName(node.propertyName) : memberName(node.name);
      acquires(node, checker.getTypeAtLocation(node.parent), key);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isObjectLiteralExpression(node.left)
    ) {
      // `({ rm: wipe } = fs.promises)` — a destructuring ASSIGNMENT is an object literal on the
      // left of `=`, not a binding pattern, so the binding-element branch never sees it.
      const owner = checker.getTypeAtLocation(node.right);
      for (const property of node.left.properties) {
        if (ts.isShorthandPropertyAssignment(property)) {
          acquires(property, owner, property.name.text);
        } else if (ts.isPropertyAssignment(property)) {
          acquires(property, owner, memberName(property.name));
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(file);
  return found;
}

function main(): void {
  const configPath = path.join(REPO_ROOT, "tsconfig.json");
  const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
  if (error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
  }
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, REPO_ROOT);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const checker = program.getTypeChecker();
  const sources = program.getSourceFiles().filter((f) => !f.isDeclarationFile);

  const offenders: Finding[] = [];
  const missed: string[] = [];
  const falsePositives: Finding[] = [];
  let proven = 0;

  for (const file of sources) {
    const rel = relativeTo(file.fileName);
    if (isRemovalPath(rel)) {
      offenders.push(...scan(file, checker));
      continue;
    }
    if (!rel.startsWith(FIXTURES)) {
      continue;
    }
    // The fixtures are what stop an empty offender list from being an absence rather than a
    // result. A `flag-` case the rule cannot see is the same defect as a `pass-` case it fires on.
    const hits = scan(file, checker);
    const name = path.basename(rel);
    if (name.startsWith("flag-")) {
      if (hits.length === 0) {
        missed.push(rel);
      } else {
        proven += 1;
      }
    }
    if (name.startsWith("pass-")) {
      falsePositives.push(...hits);
    }
  }

  const lines: string[] = [];
  for (const f of offenders) {
    lines.push(`  ${f.file}:${f.line} ${f.why} — ${f.text}`);
  }
  for (const rel of missed) {
    lines.push(`  ${rel} is a flag- fixture the rule did not catch — the rule has a blind spot`);
  }
  for (const f of falsePositives) {
    lines.push(`  ${f.file}:${f.line} is a pass- fixture the rule fired on — ${f.why}`);
  }

  if (lines.length > 0) {
    console.error("[I10] direct filesystem deletion in the worktree removal path:");
    console.error(lines.join("\n"));
    process.exit(1);
  }
  const scoped = sources.filter((f) => isRemovalPath(relativeTo(f.fileName))).length;
  if (scoped === 0 || proven === 0) {
    console.error(`[I10] vacuous — ${scoped} modules in scope, ${proven} spellings proven visible`);
    process.exit(1);
  }
  console.log(`[I10] ok — ${scoped} modules delegate removal to git; ${proven} bypass spellings proven visible`);
}

main();
