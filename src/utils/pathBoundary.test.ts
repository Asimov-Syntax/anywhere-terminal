import { describe, expect, it } from "vitest";
import { isPathInside, isWindowsAbsPath, normalizePathForCompare } from "./pathBoundary";

describe("isWindowsAbsPath", () => {
  it("recognizes drive letters in either case and either separator", () => {
    expect(isWindowsAbsPath("C:\\repo")).toBe(true);
    expect(isWindowsAbsPath("c:/repo")).toBe(true);
  });

  it("recognizes a UNC path", () => {
    expect(isWindowsAbsPath("\\\\server\\share")).toBe(true);
  });

  it("does not claim a POSIX path", () => {
    expect(isWindowsAbsPath("/repo")).toBe(false);
  });
});

describe("normalizePathForCompare", () => {
  it("folds Windows separators and case", () => {
    expect(normalizePathForCompare("C:/Repo/Feat")).toBe("c:\\repo\\feat");
  });

  it("leaves a POSIX path untouched, since it is case-sensitive", () => {
    expect(normalizePathForCompare("/Repo/Feat")).toBe("/Repo/Feat");
  });
});

describe("isPathInside", () => {
  it("treats a path as inside itself", () => {
    expect(isPathInside("/repo", "/repo")).toBe(true);
  });

  it("accepts a descendant", () => {
    expect(isPathInside("/repo/packages/api", "/repo")).toBe(true);
  });

  it("rejects a sibling that merely shares a prefix", () => {
    expect(isPathInside("/repo-other", "/repo")).toBe(false);
  });

  it("rejects an ancestor", () => {
    expect(isPathInside("/repo", "/repo/packages")).toBe(false);
  });

  // Round-1 review W5: the naive `root + sep` form builds `//` here and matches nothing.
  it("accepts any absolute path under the POSIX filesystem root", () => {
    expect(isPathInside("/repo/feat", "/")).toBe(true);
    expect(isPathInside("/", "/")).toBe(true);
  });

  it("accepts a path under a Windows drive root without doubling the separator", () => {
    expect(isPathInside("C:\\repo", "C:\\")).toBe(true);
    expect(isPathInside("C:/repo", "C:/")).toBe(true);
  });

  it("compares Windows paths case-insensitively and across separator drift", () => {
    expect(isPathInside("c:/Repo/Feat", "C:\\repo")).toBe(true);
  });

  it("keeps POSIX comparison case-sensitive", () => {
    expect(isPathInside("/Repo/feat", "/repo")).toBe(false);
  });
});
