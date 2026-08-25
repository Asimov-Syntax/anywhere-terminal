import { describe, expect, it } from "vitest";
import { AGENT_USES_CTRL_V, VAULT_AGENT_IDS, type VaultAgentId } from "../vault/types";
import { ALT_V_PASTE, BRACKETED_EMPTY_PASTE, CTRL_V_PASTE, getImagePastePtyTrigger } from "./imagePasteTrigger";

describe("AGENT_USES_CTRL_V completeness", () => {
  it("declares a trigger for every vault agent", () => {
    expect(Object.keys(AGENT_USES_CTRL_V).sort()).toEqual([...VAULT_AGENT_IDS].sort());
  });

  it("cannot be declared with an agent missing", () => {
    // `check-types` only accepts the complete record; it can never prove an
    // incomplete one is rejected. This line compiles as an error on purpose —
    // if the record stops being required, `@ts-expect-error` goes unused and
    // the type check fails, which is the alarm.
    // @ts-expect-error — `cursor` omitted.
    const incomplete = { claude: false, codex: true, opencode: true } satisfies Record<VaultAgentId, boolean>;
    expect(incomplete).toBeTruthy();
  });
});

describe("getImagePastePtyTrigger", () => {
  it("always sends Ctrl+V for Codex/OpenCode/Grok, regardless of OS", () => {
    for (const kind of ["codex", "opencode", "grok"]) {
      for (const platform of ["darwin", "win32", "linux"] as const) {
        expect(getImagePastePtyTrigger(kind, platform)).toBe(CTRL_V_PASTE);
      }
    }
    expect(CTRL_V_PASTE).toBe("\x16");
  });

  it("uses the OS-native signal for Claude and unknown/shell sessions", () => {
    // macOS → empty bracketed paste; Windows → Alt+V (Claude Code's binding there);
    // Linux → Ctrl+V.
    for (const agent of ["claude", undefined]) {
      expect(getImagePastePtyTrigger(agent, "darwin")).toBe(BRACKETED_EMPTY_PASTE);
      expect(getImagePastePtyTrigger(agent, "win32")).toBe(ALT_V_PASTE);
      expect(getImagePastePtyTrigger(agent, "linux")).toBe(CTRL_V_PASTE);
    }
    expect(BRACKETED_EMPTY_PASTE).toBe("\x1b[200~\x1b[201~");
    expect(ALT_V_PASTE).toBe("\x1bv");
  });
});
