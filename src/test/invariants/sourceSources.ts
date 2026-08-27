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
