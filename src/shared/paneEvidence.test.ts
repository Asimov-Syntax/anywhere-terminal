import { describe, expect, it } from "vitest";
import {
  classifyTitle,
  explainLiveActivity,
  explainPaneActivity,
  type LiveActivityEvidence,
  MAX_REPORTED_TITLE_CHARS,
  OUTPUT_IDLE_WINDOW_MS,
  projectLiveActivity,
  projectPaneActivity,
} from "./paneEvidence";

const NOTHING: LiveActivityEvidence = {
  waiting: false,
  semanticWorking: false,
  outputActive: false,
  titleClass: "unknown",
};

describe("projectLiveActivity", () => {
  it("is idle when nothing is set", () => {
    expect(projectLiveActivity(NOTHING)).toBe("idle");
  });

  it("is running on recent output", () => {
    expect(projectLiveActivity({ ...NOTHING, outputActive: true })).toBe("running");
  });

  it("is running on semantic working evidence with no output", () => {
    expect(projectLiveActivity({ ...NOTHING, semanticWorking: true })).toBe("running");
  });

  it("is waiting even while output is flowing", () => {
    expect(projectLiveActivity({ ...NOTHING, waiting: true, semanticWorking: true, outputActive: true })).toBe(
      "waiting",
    );
  });
});

describe("projectPaneActivity", () => {
  it("is exited regardless of every other signal", () => {
    expect(
      projectPaneActivity({ ...NOTHING, waiting: true, semanticWorking: true, outputActive: true, exited: true }),
    ).toBe("exited");
  });

  it("agrees with projectLiveActivity while the pane has not exited", () => {
    const cases: LiveActivityEvidence[] = [
      NOTHING,
      { ...NOTHING, outputActive: true },
      { ...NOTHING, semanticWorking: true },
      { ...NOTHING, waiting: true },
    ];
    for (const evidence of cases) {
      expect(projectPaneActivity({ ...evidence, exited: false })).toBe(projectLiveActivity(evidence));
    }
  });
});

describe("constants", () => {
  it("keeps the idle window the tab tracker already used", () => {
    expect(OUTPUT_IDLE_WINDOW_MS).toBe(1500);
  });

  it("caps a reported title", () => {
    expect(MAX_REPORTED_TITLE_CHARS).toBe(1024);
  });
});

describe("title rules", () => {
  it("forces idle when the title names a shell, overriding output", () => {
    // The shell has reclaimed the pane, so recent output is the shell's, not an
    // agent's (worktree-agent-presence.md § 6).
    expect(projectLiveActivity({ ...NOTHING, outputActive: true, titleClass: "shell" })).toBe("idle");
  });

  it("forces idle when the title names a shell, overriding semantic working evidence", () => {
    expect(projectLiveActivity({ ...NOTHING, semanticWorking: true, titleClass: "shell" })).toBe("idle");
  });

  it("does NOT let a shell title hide a pane that is waiting", () => {
    // D6: a false idle on a pane blocked on the user hides a prompt they must
    // answer — the costlier of the two errors.
    expect(projectLiveActivity({ ...NOTHING, waiting: true, titleClass: "shell" })).toBe("waiting");
  });

  it("does not let a shell title override an exited pty", () => {
    expect(projectPaneActivity({ ...NOTHING, titleClass: "shell", exited: true })).toBe("exited");
  });

  it("leaves activity alone for a neutral title", () => {
    // `Terminal` is not proof the agent ended.
    expect(projectLiveActivity({ ...NOTHING, outputActive: true, titleClass: "neutral" })).toBe("running");
    expect(projectLiveActivity({ ...NOTHING, titleClass: "neutral" })).toBe("idle");
  });

  it("leaves activity alone for an agent title", () => {
    expect(projectLiveActivity({ ...NOTHING, outputActive: true, titleClass: "agent" })).toBe("running");
    expect(projectLiveActivity({ ...NOTHING, titleClass: "agent" })).toBe("idle");
  });

  it("treats an unreported title exactly as before the rules existed", () => {
    expect(projectLiveActivity({ ...NOTHING, outputActive: true, titleClass: "unknown" })).toBe("running");
    expect(projectLiveActivity({ ...NOTHING, waiting: true, titleClass: "unknown" })).toBe("waiting");
    expect(projectLiveActivity({ ...NOTHING, titleClass: "unknown" })).toBe("idle");
  });

  it("never derives running from a title alone", () => {
    // D7: decoration is stripped before it reaches the host, so a frozen spinner
    // is indistinguishable from an animating one. Output is the activity evidence.
    for (const titleClass of ["shell", "agent", "neutral", "unknown"] as const) {
      expect(projectLiveActivity({ ...NOTHING, titleClass })).not.toBe("running");
    }
  });
});

describe("explainLiveActivity names the rule that decided", () => {
  it("credits the shell title only where it overruled live work", () => {
    // Same outcome both ways. Reading the cause off the outcome — an idle pane
    // that happens to carry a shell title — reports a provenance that is false
    // whenever the pane had nothing to do anyway.
    expect(explainLiveActivity({ ...NOTHING, titleClass: "shell", outputActive: true })).toEqual({
      activity: "idle",
      rule: "shell-title",
    });
    expect(explainLiveActivity({ ...NOTHING, titleClass: "shell" })).toEqual({
      activity: "idle",
      rule: "quiet",
    });
  });

  it("credits semantic evidence the same as output, both being work", () => {
    expect(explainLiveActivity({ ...NOTHING, semanticWorking: true })).toEqual({
      activity: "running",
      rule: "working",
    });
    expect(explainLiveActivity({ ...NOTHING, outputActive: true })).toEqual({
      activity: "running",
      rule: "working",
    });
  });

  it("names waiting as its own rule, above the shell title", () => {
    expect(explainLiveActivity({ ...NOTHING, waiting: true, titleClass: "shell", outputActive: true })).toEqual({
      activity: "waiting",
      rule: "waiting",
    });
  });

  it("agrees with projectLiveActivity on every combination", () => {
    for (const titleClass of ["shell", "agent", "neutral", "unknown"] as const) {
      for (const waiting of [false, true]) {
        for (const semanticWorking of [false, true]) {
          for (const outputActive of [false, true]) {
            const evidence = { titleClass, waiting, semanticWorking, outputActive };
            expect(explainLiveActivity(evidence).activity).toBe(projectLiveActivity(evidence));
          }
        }
      }
    }
  });

  it("reports an exited pane without attributing it to a rule", () => {
    expect(explainPaneActivity({ ...NOTHING, exited: true, outputActive: true })).toEqual({
      activity: "exited",
      rule: "quiet",
    });
  });
});

describe("classifyTitle", () => {
  it("separates never-reported from reported-nothing", () => {
    expect(classifyTitle(undefined)).toBe("unknown");
    expect(classifyTitle("")).toBe("neutral");
    expect(classifyTitle("   ")).toBe("neutral");
  });

  it("recognises a shell and an agent as whole tokens", () => {
    expect(classifyTitle("zsh")).toBe("shell");
    expect(classifyTitle("claude — fix the projector")).toBe("agent");
    expect(classifyTitle("openclaude")).toBe("neutral");
  });
});
