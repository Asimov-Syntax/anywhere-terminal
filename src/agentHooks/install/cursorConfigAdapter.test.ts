// src/agentHooks/install/cursorConfigAdapter.test.ts — The Windows wrapper's
// executable resolution. Windows searches the working directory before PATH, so
// a bare name here is code a repository can substitute (round-7 B11); this holds
// the rule for the whole wrapper rather than for the one binary that was missed.

import { describe, expect, it } from "vitest";
import { claudeWrapperScripts } from "./claudeConfigAdapter";
import { cursorWrapperScripts } from "./cursorConfigAdapter";

/** Batch-file lines that invoke nothing, or invoke a shell builtin. */
const BUILTIN = /^(?:@echo|echo|setlocal|endlocal|if|goto|exit|rem|set|:)/i;

/** The leading token of every line that actually runs a program. */
function invocations(script: string): string[] {
  return script
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !BUILTIN.test(line))
    .map((line) => (line.startsWith('"') ? (line.match(/^"[^"]*"/)?.[0] ?? line) : (line.split(/\s+/)[0] ?? line)));
}

describe.each([
  ["cursor", cursorWrapperScripts],
  ["claude", claudeWrapperScripts],
])("the %s Windows wrapper", (_agent, scripts) => {
  it("invokes every executable through an absolute system path", () => {
    const invoked = invocations(scripts().windows);

    expect(invoked.length).toBeGreaterThan(0);
    for (const executable of invoked) {
      expect(executable, executable).toMatch(/^"%SystemRoot%\\System32\\[^"]+"$/);
    }
  });

  it("names no interpreter a repository could shadow", () => {
    // The exact spellings that resolve against the working directory first.
    for (const bare of ["powershell", "pwsh", "cmd", "curl", "more", "findstr", "certutil"]) {
      expect(scripts().windows).not.toMatch(new RegExp(`(?:^|[\\s|&(])${bare}(?:\\.exe|\\.com)?\\s`, "im"));
    }
  });
});
