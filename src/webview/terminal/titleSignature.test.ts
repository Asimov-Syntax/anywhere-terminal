// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { applyTitleChange, type TitleTrackedInstance, titleSignature } from "./titleSignature";

describe("titleSignature", () => {
  it("collapses braille spinner frames to one signature", () => {
    expect(titleSignature("⠋ Fix tests")).toBe(titleSignature("⠙ Fix tests"));
    expect(titleSignature("⠿ Fix tests")).toBe(titleSignature("⠈ Fix tests"));
  });

  it("collapses Claude 2.1 quarter-circle frames to one signature", () => {
    expect(titleSignature("◐ Building")).toBe(titleSignature("◓ Building"));
    expect(titleSignature("◑ Building")).toBe(titleSignature("◒ Building"));
  });

  it("keeps a real text change distinguishable behind an unchanged frame", () => {
    expect(titleSignature("⠋ Fix tests")).not.toBe(titleSignature("⠋ Run build"));
  });

  it("normalises the whitespace a stripped frame leaves behind", () => {
    // Stripping the glyph leaves a double space; without collapsing, the
    // decorated and undecorated forms would differ.
    expect(titleSignature("⠋ Fix tests")).toBe("Fix tests");
    expect(titleSignature("Fix   tests")).toBe("Fix tests");
    expect(titleSignature("  Fix tests\t")).toBe("Fix tests");
  });

  it("leaves an undecorated title alone", () => {
    expect(titleSignature("user@host:~/dir")).toBe("user@host:~/dir");
    expect(titleSignature("node index.js")).toBe("node index.js");
  });

  it("reduces an all-decoration title to the empty string", () => {
    expect(titleSignature("⠋⠙⠹")).toBe("");
    expect(titleSignature("")).toBe("");
  });
});

describe("applyTitleChange", () => {
  function makeInstance(): TitleTrackedInstance {
    return { name: "Terminal 1" };
  }

  it("renders the first title after creation", () => {
    const instance = makeInstance();
    const render = vi.fn();
    applyTitleChange(instance, "⠋ Fix tests", render);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("does not re-render when only the spinner frame advanced", () => {
    const instance = makeInstance();
    const render = vi.fn();
    applyTitleChange(instance, "⠋ Fix tests", render);
    applyTitleChange(instance, "⠙ Fix tests", render);
    applyTitleChange(instance, "⠹ Fix tests", render);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("still assigns the raw newest title while suppressing the render", () => {
    const instance = makeInstance();
    const render = vi.fn();
    applyTitleChange(instance, "⠋ Fix tests", render);
    applyTitleChange(instance, "⠙ Fix tests", render);
    // The tab must show the newest frame the moment anything else forces a
    // render — so `name` tracks the raw title even when the render is skipped.
    expect(instance.name).toBe("⠙ Fix tests");
  });

  it("re-renders when the text behind the spinner changes", () => {
    const instance = makeInstance();
    const render = vi.fn();
    applyTitleChange(instance, "⠋ Fix tests", render);
    applyTitleChange(instance, "⠙ Fix tests", render);
    applyTitleChange(instance, "⠹ Run build", render);
    expect(render).toHaveBeenCalledTimes(2);
    expect(instance.name).toBe("⠹ Run build");
  });

  it("ignores an empty title without touching name or render", () => {
    const instance = makeInstance();
    const render = vi.fn();
    applyTitleChange(instance, "", render);
    expect(render).not.toHaveBeenCalled();
    expect(instance.name).toBe("Terminal 1");
  });

  it("re-renders when the spinner disappears, so no frozen glyph is left on the tab", () => {
    // The label is rendered from the RAW name (TabBarUtils displayName), so
    // `⠋ Fix tests` → `Fix tests` DOES change what the tab shows even though the
    // signature is identical. Suppressing it froze a spinner on a finished
    // agent's tab. See .reviews/round-1.md [W1].
    const instance = makeInstance();
    const render = vi.fn();
    applyTitleChange(instance, "⠋ Fix tests", render);
    applyTitleChange(instance, "⠙ Fix tests", render);
    expect(render).toHaveBeenCalledTimes(1);

    applyTitleChange(instance, "Fix tests", render);
    expect(render).toHaveBeenCalledTimes(2);
    expect(instance.name).toBe("Fix tests");
  });

  it("re-renders when a spinner appears on previously plain text", () => {
    const instance = makeInstance();
    const render = vi.fn();
    applyTitleChange(instance, "Fix tests", render);
    applyTitleChange(instance, "⠋ Fix tests", render);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("still suppresses frame churn once the decoration bit is stable", () => {
    const instance = makeInstance();
    const render = vi.fn();
    applyTitleChange(instance, "⠋ Fix tests", render);
    for (const frame of ["⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]) {
      applyTitleChange(instance, `${frame} Fix tests`, render);
    }
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("always renders an oversized title instead of scanning it twice per frame", () => {
    const instance = makeInstance();
    const render = vi.fn();
    const huge = `x${"y".repeat(1024)}`;
    applyTitleChange(instance, huge, render);
    applyTitleChange(instance, huge, render);
    expect(render).toHaveBeenCalledTimes(2);
  });
});
