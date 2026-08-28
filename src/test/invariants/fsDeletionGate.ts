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

/** Whether this node sits in a type position, where nothing executes. */
function isTypePosition(node: tsmod.Node): boolean {
  for (let n: tsmod.Node | undefined = node.parent; n !== undefined; n = n.parent) {
    if (ts.isTypeNode(n) || ts.isTypeQueryNode(n) || ts.isImportTypeNode(n)) {
      return true;
    }
  }
  return false;
}

/**
 * Every executable reference in `file` that names a destructive `node:fs` function.
 *
 * A tripwire, and only a tripwire. Four mechanisms have been defeated here, and round 9 settled
 * why the fourth is different: TypeScript's type identity is STRUCTURAL, so an fs function reached
 * through a structurally-compatible local type no longer resolves to `@types/node/fs`. Deciding
 * that soundly needs value-flow analysis, which this is not and does not claim to be.
 *
 * What it catches is a contributor reaching for `fs.rmSync(dir)` because it is convenient — the
 * way this invariant will actually be broken. What it does not catch is written down in D10 AND
 * asserted by the `gap-` fixtures, so a stated limit fails the moment it stops being true.
 */
function scan(file: tsmod.SourceFile, checker: tsmod.TypeChecker): Finding[] {
  const found: Finding[] = [];
  const rel = relativeTo(file.fileName);

  const visit = (node: tsmod.Node): void => {
    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      // The name half of a member access is resolved with its owner, not on its own.
      const isMemberName = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
      if (!isMemberName && !isTypePosition(node) && isDestructiveFsType(checker.getTypeAtLocation(node))) {
        found.push({
          file: rel,
          line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
          text: node.getText(file).split("\n")[0].slice(0, 80),
          why: "names a destructive fs function",
        });
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
  const closed: string[] = [];
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
    // A `gap-` case is a limit D10 states out loud. Asserting it is what makes the limit a fact
    // rather than prose — the "reachable from the removal path" overclaim survived five rounds
    // precisely because nothing checked it. A gap that closes is good news that must be recorded,
    // not absorbed silently, so it fails here until the fixture is reclassified.
    if (name.startsWith("gap-") && hits.length > 0) {
      closed.push(rel);
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
  for (const rel of closed) {
    lines.push(`  ${rel} is a gap- fixture the rule NOW catches — the stated limit closed, reclassify it as flag-`);
  }

  if (lines.length > 0) {
    console.error("[I10] direct filesystem deletion in the worktree removal path:");
    console.error(lines.join("\n"));
    process.exit(1);
  }
  const scoped = sources.filter((f) => isRemovalPath(relativeTo(f.fileName))).length;
  const closedCount = sources.filter((f) => path.basename(relativeTo(f.fileName)).startsWith("gap-")).length;
  if (scoped === 0 || proven === 0) {
    console.error(`[I10] vacuous — ${scoped} modules in scope, ${proven} spellings proven visible`);
    process.exit(1);
  }
  console.log(
    `[I10] ok — ${scoped} modules delegate removal to git; ${proven} spellings caught, ` +
      `${closedCount} stated gaps still open`,
  );
}

main();
