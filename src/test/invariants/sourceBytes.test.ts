// src/test/invariants/sourceBytes.test.ts — No raw control bytes in the sources.
// See asimov/changes/verify-cross-layer-scale/design.md D7.
//
// I10's source rule used to live here too. It needs a type checker to resolve what an identifier
// refers to, and a Program costs ~1 s to build — wrong for the unit suite, so it moved to the
// standalone `pnpm run gate:fs-deletion` (design.md D10, revised after round 5).
//
// A literal NUL used as a join separator is runtime-identical to the "\0" escape, but it makes
// BSD grep classify the whole file as binary and skip it while printing nothing to stdout.
// Every grep-based tool then reads the file as empty — review agents and this change's own
// invariant audit included, which is how two wired call sites were first read as dead code.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tsFiles } from "./sourceSources";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SRC = path.join(REPO_ROOT, "src");

const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const FIRST_PRINTABLE = 0x20;

/** Tab, LF and CR are ordinary source bytes; every other byte below 0x20 is not. */
function hasControlByte(bytes: Buffer): boolean {
  return bytes.some((byte) => byte < FIRST_PRINTABLE && byte !== TAB && byte !== LF && byte !== CR);
}

function offenders(): string[] {
  return tsFiles(SRC)
    .filter((full) => hasControlByte(fs.readFileSync(full)))
    .map((full) => path.relative(REPO_ROOT, full));
}

describe("source hygiene — raw control bytes", () => {
  it("leaves no source unreadable to a grep-based tool", () => {
    expect(offenders()).toEqual([]);
  });
});
