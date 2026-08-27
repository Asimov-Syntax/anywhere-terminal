// src/test/invariants/sourceBytes.test.ts — No raw control bytes in the sources.
// See asimov/changes/verify-cross-layer-scale/design.md D7.
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

/**
 * Owned by task WT-006.2 in another session, so this change does not touch it. Listed rather
 * than pattern-excluded: the second assertion fails once the peer fixes it, which is the signal
 * to delete this entry instead of leaving a stale exemption behind.
 */
const PEER_OWNED = ["src/agentHooks/install/managedEntryLedger.ts"];

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
    expect(offenders().filter((rel) => !PEER_OWNED.includes(rel))).toEqual([]);
  });

  it("keeps the peer-owned exemption honest, so a fixed file stops being exempt", () => {
    expect(offenders().filter((rel) => PEER_OWNED.includes(rel))).toEqual(PEER_OWNED);
  });
});

// ── I10: no direct destructive filesystem call in production ─────────────
//
// design.md D10. A test cannot prove "the extension never deletes files directly" — it can
// only prove that the paths it happens to walk delegate to git. Round 3 was right that
// writing the gap into the registry documented it rather than closing it, so this asserts
// the property over the SOURCE, the same shape as the byte scan above.

/** Destructive `node:fs` calls, in every spelling the repo could reach them by. */
const DESTRUCTIVE = /\b(?:fs|fsp|fsPromises|promises)\s*\.\s*(?:rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync)\s*\(/;

/**
 * The code I10 is actually about: the worktree subsystem and the host that drives it.
 *
 * Deliberately NOT every production file. Six modules outside this path delete files they
 * themselves wrote — a clipboard temp file, an injected shell-integration script, session
 * storage, the vault cache, a sqlite temp file, and the peer-owned locked-JSON writer. None
 * of them is a worktree directory, and a rule that failed on them would be a rule about
 * `fs.rm` rather than about I10, and would be turned off within a week. The claim being
 * enforced is that the code which removes WORKTREES delegates that to git.
 */
function isWorktreeRemovalCode(file: string): boolean {
  const rel = path.relative(REPO_ROOT, file);
  if (rel.includes(".test.") || rel.includes("/bench/")) {
    return false;
  }
  return rel.startsWith("src/worktree/") || rel === "src/providers/WorktreeHost.ts";
}

describe("[I10] the extension deletes no directory itself", () => {
  it("makes a direct destructive fs call in production code a suite failure", () => {
    const offenders = tsFiles(SRC)
      .filter(isWorktreeRemovalCode)
      .filter((file) => DESTRUCTIVE.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(REPO_ROOT, file));

    // Directory removal is delegated to git, which is what bounds OUR bugs — git's own
    // recursive consequences are its to own (docs/DESIGN.md § 8.4 I10).
    expect(offenders).toEqual([]);
    // And the rule has something to be true OF: an empty file list would make it vacuous.
    expect(tsFiles(SRC).filter(isWorktreeRemovalCode).length).toBeGreaterThan(10);
  });

  it("would notice one, so the empty list above is a result and not an absence", () => {
    expect(DESTRUCTIVE.test("await fs.rm(target, { recursive: true });")).toBe(true);
    expect(DESTRUCTIVE.test("fs.rmSync(dir);")).toBe(true);
    expect(DESTRUCTIVE.test("await fs.promises.unlink(p);")).toBe(true);
    // Not a deletion, and a rule that fired on these would be turned off within a week.
    expect(DESTRUCTIVE.test("fs.readFileSync(p);")).toBe(false);
    expect(DESTRUCTIVE.test("runner.run(['worktree', 'remove', target], repo);")).toBe(false);
  });
});
