// @vitest-environment jsdom
// src/webview/fileTree/FileTreeController.test.ts — Tests for the
// FileTreeController's git-status-changed dispatch (generation gate + revision
// passthrough to the data source via FileTreePanel).
//
// See: asimov/changes/add-file-tree-git-decorations/tasks.md task 4_3
//      asimov/changes/add-file-tree-git-decorations/specs/git-decoration-source/spec.md
//        #requirement-incremental-change-message

import { describe, expect, it, vi } from "vitest";
import type { GitStatusChangedMessage } from "../../types/messages";
import { FileTreeController } from "./FileTreeController";
import type { FileTreePanel } from "./FileTreePanel";

function makePanelStub(currentGen: number) {
  const handleGitStatusChanged = vi.fn();
  const panel = {
    getCurrentRootGeneration: () => currentGen,
    handleGitStatusChanged,
  } as unknown as FileTreePanel;
  return { panel, handleGitStatusChanged };
}

// Helper to bypass `mount()` (which requires DOM + store + post wiring) and
// construct a controller with a stub panel directly. We reach through the
// private constructor via `Object.create` + index-write — clearer than
// trying to widen the TypeScript surface for tests.
function makeController(panel: FileTreePanel): FileTreeController {
  const proto = (FileTreeController as unknown as { prototype: object }).prototype;
  const controller = Object.create(proto) as FileTreeController;
  const mutable = controller as unknown as Record<string, unknown>;
  mutable.panel = panel;
  mutable.lastWorkspaceRoot = null;
  mutable.deps = {};
  return controller;
}

describe("FileTreeController.handleGitStatusChanged", () => {
  it("forwards an in-generation message to the panel", () => {
    const { panel, handleGitStatusChanged } = makePanelStub(3);
    const controller = makeController(panel);
    const msg: GitStatusChangedMessage = {
      type: "git-status-changed",
      rootGeneration: 3,
      revision: 7,
      changes: [{ path: "/x", status: "modified" }],
    };
    controller.handleGitStatusChanged(msg);
    expect(handleGitStatusChanged).toHaveBeenCalledTimes(1);
    expect(handleGitStatusChanged).toHaveBeenCalledWith(7, [{ path: "/x", status: "modified" }]);
  });

  it("drops a message whose rootGeneration does not match the current panel state", () => {
    const { panel, handleGitStatusChanged } = makePanelStub(3);
    const controller = makeController(panel);
    controller.handleGitStatusChanged({
      type: "git-status-changed",
      rootGeneration: 2,
      revision: 7,
      changes: [{ path: "/x", status: "modified" }],
    });
    expect(handleGitStatusChanged).not.toHaveBeenCalled();
  });
});

describe("FileTreeController.handleFsChangesInvalidated + handleFsRehydrate", () => {
  it("forwards fs-changes-invalidated to the panel verbatim", () => {
    const handleFsChangesInvalidated = vi.fn();
    const panel = { handleFsChangesInvalidated } as unknown as FileTreePanel;
    const controller = makeController(panel);
    const msg = { type: "fs-changes-invalidated", rootGeneration: 4, parent: "/abs" } as const;
    controller.handleFsChangesInvalidated(msg);
    expect(handleFsChangesInvalidated).toHaveBeenCalledTimes(1);
    expect(handleFsChangesInvalidated).toHaveBeenCalledWith(msg);
  });

  it("forwards fs-rehydrate to the panel verbatim", () => {
    const handleFsRehydrate = vi.fn();
    const panel = { handleFsRehydrate } as unknown as FileTreePanel;
    const controller = makeController(panel);
    const msg = { type: "fs-rehydrate", rootGeneration: 4 } as const;
    controller.handleFsRehydrate(msg);
    expect(handleFsRehydrate).toHaveBeenCalledTimes(1);
    expect(handleFsRehydrate).toHaveBeenCalledWith(msg);
  });
});

describe("FileTreeController.handleWorkspaceRootChanged", () => {
  function makeRootStub(currentGen: number) {
    const handleRootChanged = vi.fn();
    const setResolvedWorkspaceRoot = vi.fn();
    const panel = {
      getCurrentRootGeneration: () => currentGen,
      handleRootChanged,
      setResolvedWorkspaceRoot,
    } as unknown as FileTreePanel;
    return { panel, handleRootChanged, setResolvedWorkspaceRoot };
  }

  function mounted(panel: FileTreePanel, root: string): FileTreeController {
    const controller = makeController(panel);
    (controller as unknown as Record<string, unknown>).lastWorkspaceRoot = root;
    return controller;
  }

  it("takes the resolved root without remounting when the mount did not change", () => {
    // Round-2 W1. The host posts this a second time when the root's realpath
    // lands. Re-rooting on it exits search, disposes the tree and clears every
    // expanded path — the user loses their place because a syscall was slow.
    const { panel, handleRootChanged, setResolvedWorkspaceRoot } = makeRootStub(4);
    const controller = mounted(panel, "/repo");

    controller.handleWorkspaceRootChanged({
      type: "workspace-root-changed",
      rootPath: "/repo",
      resolvedRootPath: "/private/repo",
      rootGeneration: 4,
    });

    expect(setResolvedWorkspaceRoot).toHaveBeenCalledWith("/repo", "/private/repo");
    expect(handleRootChanged).not.toHaveBeenCalled();
  });

  it("remounts when the root itself changed", () => {
    const { panel, handleRootChanged } = makeRootStub(4);
    const controller = mounted(panel, "/repo");

    controller.handleWorkspaceRootChanged({
      type: "workspace-root-changed",
      rootPath: "/other",
      resolvedRootPath: "/private/other",
      rootGeneration: 5,
    });

    expect(handleRootChanged).toHaveBeenCalledTimes(1);
  });

  it("remounts when the same path is re-rooted under a new generation", () => {
    // Re-rooting to the spelling already mounted is a real re-root: the tree is
    // rebuilt from that directory again, and only the generation says so.
    const { panel, handleRootChanged } = makeRootStub(4);
    const controller = mounted(panel, "/repo");

    controller.handleWorkspaceRootChanged({
      type: "workspace-root-changed",
      rootPath: "/repo",
      resolvedRootPath: "/private/repo",
      rootGeneration: 5,
    });

    expect(handleRootChanged).toHaveBeenCalledTimes(1);
  });
});
