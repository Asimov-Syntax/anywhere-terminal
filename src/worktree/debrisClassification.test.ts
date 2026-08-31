import { describe, expect, it } from "vitest";
import { classifyDestination, type GitEntryProbe } from "./debrisClassification";

const absent: GitEntryProbe = () => "absent";
const present: GitEntryProbe = () => "present";
const unknown: GitEntryProbe = () => "unknown";

describe("classifyDestination", () => {
  it("calls an unregistered directory with no .git debris", () => {
    expect(classifyDestination("/trees/repo-feat", false, absent)).toEqual({ kind: "debris" });
  });

  it("never calls a directory holding a .git file debris — that is a checkout WT-012.15 re-registers", () => {
    expect(classifyDestination("/trees/repo-feat", false, present)).toEqual({ kind: "free" });
  });

  it("never calls a registered worktree debris, whatever is on disk", () => {
    // The probe would say debris. Registration outranks it, and this asserts the
    // order rather than a shared answer: `absent` is the debris-producing reading.
    expect(classifyDestination("/trees/repo-feat", true, absent)).toEqual({ kind: "free" });
  });

  it("fails closed where the entry could not be read", () => {
    // Not proven to be debris is not debris. An EACCES on `.git` must not
    // authorize deleting the directory that holds it.
    expect(classifyDestination("/trees/repo-feat", false, unknown)).toEqual({ kind: "free" });
  });

  it("asks about `.git` inside the candidate, not the candidate itself", () => {
    const asked: string[] = [];
    classifyDestination("/trees/repo-feat", false, (p) => {
      asked.push(p);
      return "absent";
    });
    expect(asked).toEqual(["/trees/repo-feat/.git"]);
  });

  it("does not probe at all for a registered path", () => {
    let calls = 0;
    classifyDestination("/trees/repo-feat", true, () => {
      calls += 1;
      return "absent";
    });
    expect(calls).toBe(0);
  });
});
