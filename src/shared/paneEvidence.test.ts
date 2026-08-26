import { describe, expect, it } from "vitest";
import {
  type LiveActivityEvidence,
  MAX_REPORTED_TITLE_CHARS,
  OUTPUT_IDLE_WINDOW_MS,
  projectLiveActivity,
  projectPaneActivity,
} from "./paneEvidence";

const NOTHING: LiveActivityEvidence = { waiting: false, semanticWorking: false, outputActive: false };

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
    expect(projectLiveActivity({ waiting: true, semanticWorking: true, outputActive: true })).toBe("waiting");
  });
});

describe("projectPaneActivity", () => {
  it("is exited regardless of every other signal", () => {
    expect(projectPaneActivity({ waiting: true, semanticWorking: true, outputActive: true, exited: true })).toBe(
      "exited",
    );
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
