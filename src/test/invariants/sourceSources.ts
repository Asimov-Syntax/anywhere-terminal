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
  /** The `.skip` / `.todo` / … chain, if any, without a leading dot. */
  readonly modifiers: string;
}

/** Modifiers that mean the declaration does not run, so it cannot hold an invariant open. */
const INERT = /(^|\.)(skip|todo|failing|concurrent\.skip)($|\.)/;

/**
 * Every `it(...)` / `test(...)` declaration a runner would actually execute.
 *
 * Parsed, not lexed. Three hand-written scanners each failed the one property this exists
 * for — that only a real call site counts — and each failure was certified as correct by
 * its own fixture: a commented-out declaration (round 1), one inside a string, template or
 * regex literal (round 2), and `item(` read as `it` with the modifier `em` (round 3). Three
 * misses through one mechanism is a wrong mechanism, so the mechanism is gone. Comments,
 * literals and identifier boundaries are not cases to remember here; they are simply not
 * call expressions, and the parser already knows that.
 */
export function declarationsIn(source: string): Declaration[] {
  const file = ts.createSourceFile("scan.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Declaration[] = [];

  /** `it` / `test` at the root of the callee, plus the `.skip`-style chain hung off it. */
  const declarationOf = (callee: ts.Expression): string | null => {
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
    if (!ts.isIdentifier(node) || (node.text !== "it" && node.text !== "test")) {
      return null;
    }
    return parts.join(".");
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const modifiers = declarationOf(node.expression);
      const title = node.arguments[0];
      if (
        modifiers !== null &&
        title !== undefined &&
        (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title))
      ) {
        found.push({ title: title.text, modifiers });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(file);
  return found;
}

/** A declaration a runner would actually execute. */
export function isActive(declaration: Declaration): boolean {
  return !INERT.test(declaration.modifiers);
}

/**
 * The source with its comments blanked out, positions preserved.
 *
 * Round-1 B1: the declaration scan was a regex over raw text, so a commented-out `it(...)`
 * counted as live coverage — the last executable test for an invariant could be commented
 * out and the suite stayed green. That is the exact failure the scan exists to prevent, in
 * the file whose only job is to prevent it.
 *
 * A comment is only a comment outside a string, and a quote is only a quote outside a
 * comment, so the two cannot be decided separately — this walks the source once, tracking
 * which of the two it is inside. Regex literals are not tracked: a `/` that opens one is
 * ambiguous without a parser, and the only cost of misreading one is that its contents are
 * scanned as code, which cannot manufacture a declaration that is not there.
 */
export function withoutComments(source: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") {
        out.push(" ");
        i++;
      }
      continue;
    }
    if (c === "/" && next === "*") {
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        // Newlines are kept so a later line/column read still lands where it should.
        out.push(source[i] === "\n" ? "\n" : " ");
        i++;
      }
      out.push(" ", " ");
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out.push(c);
      i++;
      while (i < source.length) {
        if (source[i] === "\\") {
          out.push(source[i], source[i + 1] ?? "");
          i += 2;
          continue;
        }
        out.push(source[i]);
        if (source[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join("");
}
