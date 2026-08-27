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

export interface Declaration {
  readonly title: string;
  /** The `.skip` / `.todo` / … chain, if any. */
  readonly modifiers: string;
}

/** Modifiers that mean the declaration does not run, so it cannot hold an invariant open. */
const INERT = /(^|\.)(skip|todo|failing|concurrent\.skip)($|\.)/;

const IDENT_TAIL = /[A-Za-z0-9_$]/;

/**
 * Every `it(...)` / `test(...)` declaration that a runner would actually execute.
 *
 * A single pass over the characters, tracking whether it is inside a comment, a string, a
 * template, or a regex literal, because a regex over transformed text cannot answer this.
 * Round 1 (B1) found comments counting as coverage; round 2 found the same for string
 * contents — a `it("[I1] …")` inside an ordinary fixture string was live coverage, so the
 * last executable test for an invariant could be deleted and its tag survive in a quoted
 * example. Only a call site reached as CODE counts.
 *
 * `it.skip` and friends are reported with their modifier chain rather than dropped, so the
 * caller can say "a disabled test does not hold an invariant open" in its own words.
 */
export function declarationsIn(source: string): Declaration[] {
  const found: Declaration[] = [];
  let i = 0;
  /** True where a `/` starts a regex literal rather than a division. */
  let regexAllowed = true;

  const skipString = (quote: string): void => {
    i++;
    while (i < source.length) {
      if (source[i] === "\\") {
        i += 2;
        continue;
      }
      if (quote === "`" && source[i] === "$" && source[i + 1] === "{") {
        // Interpolations hold real code, but a declaration inside one is exotic enough
        // that scanning to the matching brace would buy nothing; skip to it.
        let depth = 1;
        i += 2;
        while (i < source.length && depth > 0) {
          if (source[i] === "{") {
            depth++;
          } else if (source[i] === "}") {
            depth--;
          }
          i++;
        }
        continue;
      }
      if (source[i] === quote) {
        i++;
        return;
      }
      i++;
    }
  };

  while (i < source.length) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") {
        i++;
      }
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      skipString(c);
      regexAllowed = false;
      continue;
    }
    if (c === "/" && regexAllowed) {
      i++;
      let inClass = false;
      while (i < source.length) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === "[") {
          inClass = true;
        } else if (source[i] === "]") {
          inClass = false;
        } else if (source[i] === "/" && !inClass) {
          i++;
          break;
        } else if (source[i] === "\n") {
          break;
        }
        i++;
      }
      regexAllowed = false;
      continue;
    }
    if (c === "i" || c === "t") {
      const rest = source.slice(i);
      const name = rest.startsWith("it") ? "it" : rest.startsWith("test") ? "test" : null;
      const before = source[i - 1] ?? " ";
      if (name !== null && !IDENT_TAIL.test(before) && before !== ".") {
        let j = i + name.length;
        const modStart = j;
        while (j < source.length && (source[j] === "." || IDENT_TAIL.test(source[j]))) {
          j++;
        }
        const modifiers = source.slice(modStart, j);
        while (j < source.length && /\s/.test(source[j])) {
          j++;
        }
        if (source[j] === "(") {
          j++;
          while (j < source.length && /\s/.test(source[j])) {
            j++;
          }
          const quote = source[j];
          if (quote === '"' || quote === "'" || quote === "`") {
            const save = i;
            i = j;
            skipString(quote);
            found.push({ title: source.slice(save, i).slice(source.slice(save, i).indexOf(quote) + 1, -1), modifiers });
            regexAllowed = true;
            continue;
          }
        }
      }
    }
    regexAllowed = !IDENT_TAIL.test(c) && c !== ")" && c !== "]";
    i++;
  }
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
