// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { openWorktreePruneDialog } from "./WorktreePruneDialog";

afterEach(() => {
  document.body.replaceChildren();
});

function open(count: number) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const confirmed: number[] = [];
  const cancelled = vi.fn();
  openWorktreePruneDialog(host, {
    repoLabel: "/repo",
    count,
    onConfirm: (n) => confirmed.push(n),
    onCancel: cancelled,
  });
  return { host, confirmed, cancelled };
}

function text(host: HTMLElement): string {
  return host.textContent ?? "";
}

describe("prune confirmation", () => {
  it("names how many registrations will be dropped", () => {
    // § 3.5: the confirmation names the count. An unexplained count is worse
    // than a confirmation.
    const { host } = open(3);
    expect(text(host)).toContain("3 registrations");
  });

  it("says it in the singular for one", () => {
    const { host } = open(1);
    expect(text(host)).toContain("1 registration");
    expect(text(host)).not.toContain("1 registrations");
  });

  it("states that no files and no branches are lost", () => {
    // Prune is confirmable rather than refused precisely because nothing at
    // work is at stake; the copy has to say so or the confirmation overstates.
    const { host } = open(2);
    expect(text(host)).toMatch(/No files are deleted/i);
    expect(text(host)).toMatch(/no branch is touched/i);
  });

  it("confirms with the count it displayed", () => {
    const { host, confirmed } = open(2);
    const buttons = [...host.querySelectorAll("button")];
    buttons.find((b) => b.textContent?.includes("Prune"))?.click();
    expect(confirmed).toEqual([2]);
  });

  it("does not confirm when cancelled", () => {
    const { host, confirmed, cancelled } = open(2);
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Cancel")?.click();
    expect(confirmed).toEqual([]);
    expect(cancelled).toHaveBeenCalled();
  });

  it("renders nothing at all when there is nothing prunable", () => {
    // The action is absent in that state, so reaching the dialog is already a
    // bug — rendering "prune 0" would make it a user-visible one.
    const { host, confirmed } = open(0);
    expect(host.children).toHaveLength(0);
    expect(confirmed).toEqual([]);
  });
});
