// src/test/invariants/fsDeletionGate.ts — I10: the extension deletes no directory itself.
// See asimov/changes/verify-cross-layer-scale/design.md D10 (revised after review round 5).
//
// Run: pnpm run gate:fs-deletion
//
// Four versions of this rule enumerated the ways a name can COME TO HOLD an fs member — regex,
// then an AST binding walk, then the checker over acquisition shapes. Each round found another
// shape: renamed imports, assigned members, element access, quoted binding keys, destructuring
// assignment, `as any`, and finally a NESTED destructuring assignment. That set is open-ended.
//
// The set of ways a value is USED is not: you name it, or you select a member of something. So
// the question is asked at the reference — does this expression's type resolve to a destructive
// `node:fs` function — and the checker answers it whatever syntax bound the name.

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

/** Every constituent of a union, or the type itself. */
function constituents(type: tsmod.Type): readonly tsmod.Type[] {
  return type.isUnion() ? type.types : [type];
}

/** Whether this TYPE is a destructive `node:fs` function, however the value was bound or renamed. */
function isDestructiveFsType(type: tsmod.Type): boolean {
  return constituents(type).some((part) => {
    const symbol = part.getSymbol() ?? part.aliasSymbol;
    if (symbol === undefined || !DESTRUCTIVE.has(symbol.getName())) {
      return false;
    }
    return (symbol.getDeclarations() ?? []).some((d) => d.getSourceFile().fileName.includes("@types/node/fs"));
  });
}

/** Whether this type carries `node:fs` deletion members — an fs module object, or an alias of one. */
function isFsBearingType(type: tsmod.Type): boolean {
  return constituents(type).some((part) =>
    [...DESTRUCTIVE].some((name) => {
      const property = part.getProperty(name);
      const declarations = property?.getDeclarations() ?? [];
      return declarations.some((d) => d.getSourceFile().fileName.includes("@types/node/fs"));
    }),
  );
}

/** `any` and `unknown` erase the symbol, so nothing below them can be resolved — or trusted. */
function isErased(type: tsmod.Type): boolean {
  return (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0;
}

/** Look through casts and parentheses for the expression the checker can still type. */
function typedSource(expression: tsmod.Expression): tsmod.Expression {
  let node: tsmod.Expression = expression;
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
    node = node.expression;
  }
  return node;
}

/**
 * Every reference in `file` that names a destructive `node:fs` function.
 *
 * Rounds 4-7 each enumerated BINDING forms — import, property access, element access, binding
 * element, destructuring assignment, nested destructuring assignment — and each round found
 * another one, because that set is open-ended. The set of REFERENCE forms is not: a value is used
 * by naming it, or by selecting a member of something. So the question is asked once, at the use,
 * and the checker answers it whatever syntax bound the name.
 */
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
   * An erased type cannot be resolved, so it is judged by where it CAME FROM.
   *
   * Round-7 W7: the previous rule rejected any destructive-looking member on an erased owner, so
   * an unrelated `cache.rm(key)` was reported as filesystem deletion. Provenance is what separates
   * `(fs.promises as any).rm` — rejected, its chain is fs — from a cache that never touched fs.
   */
  const seen = new Set<tsmod.Node>();
  const fromFs = (expression: tsmod.Expression): boolean => {
    const node = typedSource(expression);
    if (seen.has(node)) {
      return false;
    }
    seen.add(node);
    const type = checker.getTypeAtLocation(node);
    if (isFsBearingType(type) || isDestructiveFsType(type)) {
      return true;
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      return fromFs(node.expression);
    }
    // `const anyFs: any = fs.promises` erases the provenance at the DECLARATION, so the one hop
    // that recovers it is to what the name was initialised from. A parameter has no initializer,
    // which is why an unrelated erased argument stays a pass (W7).
    if (ts.isIdentifier(node)) {
      const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
      if (declaration !== undefined && ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
        return fromFs(declaration.initializer);
      }
    }
    return false;
  };

  const visit = (node: tsmod.Node): void => {
    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      // Skip the name half of a member access: it is resolved with its owner, not on its own.
      const isMemberName = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
      if (!isMemberName) {
        if (isDestructiveFsType(checker.getTypeAtLocation(node))) {
          report(node, "names a destructive fs function");
        } else if (
          (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
          isErased(checker.getTypeAtLocation(node)) &&
          fromFs(node.expression)
        ) {
          report(node, "selects a member of an fs module through a type the checker cannot resolve");
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
