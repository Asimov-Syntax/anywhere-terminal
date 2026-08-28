// src/test/invariants/sourceSources.ts — Reading this repo's own sources, honestly.
// See asimov/changes/verify-cross-layer-scale/design.md D7.
//
// Everything here reads through `node:fs`, never a shell. Five sources in this repo embed a
// literal NUL, which makes BSD grep classify them as binary and skip them printing nothing to
// stdout — that is how this change's own discovery first read two wired call sites as dead.

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
