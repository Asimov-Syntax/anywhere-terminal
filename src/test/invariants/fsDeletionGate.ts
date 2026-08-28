// src/test/invariants/fsDeletionGate.ts — I10's regression tripwire.
// See asimov/changes/verify-cross-layer-scale/design.md D10.
//
// Run: pnpm run gate:fs-deletion
//
// This does NOT prove the extension deletes no directory itself — the real-git integration tests
// in src/extension.worktreeMutations.integration.test.ts do, by driving the removal path. This asks
// one narrower question of the scoped modules: does any expression's type resolve to a destructive
// `node:fs` function?
//
// An earlier version of this header claimed the set of reference forms was closed — every use is an
// identifier or a member selection — and so the checker would answer for any binding syntax. Round 9
// disproved it: TypeScript's type identity is STRUCTURAL, so an fs function reached through a
// structurally-compatible local type is no longer typed by `@types/node/fs`, and a call result is
// never asked at all. What the rule cannot see is enumerated in the `gap-` fixtures, which fail if
// they ever start being caught.

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

/**
 * The limits D10 states out loud, named rather than counted.
 *
 * Counting whatever happened to be present let a stated gap disappear in silence and let any file
 * called `gap-*` inflate the total (round-10 W12) — the same shape of defect as the "reachable from
 * the removal path" overclaim, which survived five rounds because nothing checked it.
 */
const EXPECTED_GAPS = new Set([
  "gap-any-cast.ts",
  "gap-call-produced.ts",
  "gap-erased-alias.ts",
  "gap-structural-parameter.ts",
]);

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
 * Whether this identifier is a name being DECLARED or BOUND rather than a value being used.
 *
 * A declaration's name is a SIBLING of its annotation, not a descendant, so `isTypePosition` never
 * saw it: `declare const ambient: typeof fs.promises.rm` was reported as deletion (round-10 W8).
 * The member half of `fs.promises.rm` lands here too — it is resolved with its owner, not alone.
 */
function isBindingName(node: tsmod.Node): boolean {
  const parent = node.parent;
  if (parent === undefined) {
    return false;
  }
  // `{ rm }` in an object literal is a use of `rm`; `{ rm }` in a destructure is a binding.
  if (ts.isShorthandPropertyAssignment(parent)) {
    return false;
  }
  if (
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent)
  ) {
    return true;
  }
  return (parent as { name?: tsmod.Node }).name === node;
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
      if (!isBindingName(node) && !isTypePosition(node) && isDestructiveFsType(checker.getTypeAtLocation(node))) {
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
  const seenGaps = new Set<string>();
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
    if (name.startsWith("gap-")) {
      seenGaps.add(name);
      if (hits.length > 0) {
        closed.push(rel);
      }
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
  for (const name of EXPECTED_GAPS) {
    if (!seenGaps.has(name)) {
      lines.push(`  ${FIXTURES}${name} is a limit D10 states but no fixture asserts — restore it or amend D10`);
    }
  }

  if (lines.length > 0) {
    console.error("[I10] fs-deletion tripwire failed:");
    console.error(lines.join("\n"));
    process.exit(1);
  }
  const scoped = sources.filter((f) => isRemovalPath(relativeTo(f.fileName))).length;
  if (scoped === 0 || proven === 0) {
    console.error(`[I10] vacuous — ${scoped} modules in scope, ${proven} spellings proven visible`);
    process.exit(1);
  }
  // Reports the search, not a property. "Delegates removal to git" is what the real-git
  // integration tests prove; all this command found is the absence of a reference it can recognize,
  // and the gap count is the standing reminder that those are not the same claim (round-10 B19).
  console.log(
    `[I10] ok — ${scoped} scoped modules scanned, no recognised destructive node:fs reference; ` +
      `${proven} flag fixtures caught, ${seenGaps.size} declared gaps still undetected`,
  );
}

main();
