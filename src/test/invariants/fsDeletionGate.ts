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

/** Whether this expression evaluates to something carrying `node:fs` deletion members. */
function isFsBearing(checker: tsmod.TypeChecker, node: tsmod.Expression): boolean {
  const type = checker.getTypeAtLocation(node);
  return [...DESTRUCTIVE].some((name) => isDestructiveFsSymbol(checker, type.getProperty(name)));
}

function scan(file: tsmod.SourceFile, checker: tsmod.TypeChecker): Finding[] {
  const found: Finding[] = [];
  const rel = path.relative(REPO_ROOT, file.fileName);
  const report = (node: tsmod.Node, why: string): void => {
    found.push({
      file: rel,
      line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
      text: node.getText(file).split("\n")[0].slice(0, 80),
      why,
    });
  };

  const visit = (node: tsmod.Node): void => {
    if (ts.isImportSpecifier(node) && isDestructiveFsSymbol(checker, checker.getSymbolAtLocation(node.name))) {
      report(node, "imports a destructive fs member");
    } else if (
      ts.isPropertyAccessExpression(node) &&
      isDestructiveFsSymbol(checker, checker.getSymbolAtLocation(node.name))
    ) {
      report(node, "reads a destructive fs member");
    } else if (ts.isElementAccessExpression(node)) {
      const key = node.argumentExpression;
      if (ts.isStringLiteralLike(key)) {
        const property = checker.getTypeAtLocation(node.expression).getProperty(key.text);
        if (isDestructiveFsSymbol(checker, property)) {
          report(node, "reads a destructive fs member by name");
        }
      } else if (isFsBearing(checker, node.expression)) {
        // Fail closed. Which member this reaches is decided at runtime, and in this narrow scope
        // an unauditable destructive call is not a thing to settle at review time.
        report(node, "indexes an fs module with a computed key");
      }
    } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const name = (node.propertyName ?? node.name).getText(file);
      const property = checker.getTypeAtLocation(node.parent).getProperty(name);
      if (isDestructiveFsSymbol(checker, property)) {
        report(node, "destructures a destructive fs member");
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
    const rel = path.relative(REPO_ROOT, file.fileName);
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
  const scoped = sources.filter((f) => isRemovalPath(path.relative(REPO_ROOT, f.fileName))).length;
  if (scoped === 0 || proven === 0) {
    console.error(`[I10] vacuous — ${scoped} modules in scope, ${proven} spellings proven visible`);
    process.exit(1);
  }
  console.log(`[I10] ok — ${scoped} modules delegate removal to git; ${proven} bypass spellings proven visible`);
}

main();
