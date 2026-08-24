// @vitest-environment jsdom

// Confirms the panel's two contract points:
//   - empty-state when no workspace folder is open
//   - click-to-open file rows post `OpenFileMessage` with both `path` AND a
//     non-null `sessionId` resolved via the injected `getActiveSessionId()`
//     helper (mirroring DragDropHandler — see design.md Risk Map).
//
// The Tree's listWidget needs `ResizeObserver` and `matchMedia` shims under
// JSDOM (see `src/test/vendor-import.test.ts`).

import { beforeAll, describe, expect, it, vi } from "vitest";
import type {
  CancelFileTreeSearchMessage,
  FileTreeCopyPathMessage,
  FileTreeCopyRelativePathMessage,
  FileTreeDeleteMessage,
  FileTreeRevealInOsMessage,
  OpenFileMessage,
  RequestFileTreeSearchMessage,
  RequestReadDirectoryMessage,
} from "../../types/messages";
import { FileTreePanel } from "./FileTreePanel";
import type { FileNode } from "./IFileSystemProvider";

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  }
  if (typeof globalThis.matchMedia === "undefined") {
    globalThis.matchMedia = (() => ({
      matches: false,
      media: "",
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof matchMedia;
  }
});

type AnyMsg =
  | RequestReadDirectoryMessage
  | OpenFileMessage
  | import("../../types/messages").RequestOpenFolderMessage
  | RequestFileTreeSearchMessage
  | CancelFileTreeSearchMessage
  | FileTreeRevealInOsMessage
  | FileTreeCopyPathMessage
  | FileTreeCopyRelativePathMessage
  | FileTreeDeleteMessage
  | import("../../types/messages").RequestSubscribeFsChangesMessage
  | import("../../types/messages").RequestUnsubscribeFsChangesMessage;

/**
 * Persisted state with `/workspace` expanded — the panel now mounts collapsed
 * by default, so tests that drive the mounted tree seed a state where the user
 * had left the root expanded.
 */
function expandedRootState(): { position: "left"; expandedPaths: string[] } {
  return { position: "left", expandedPaths: ["/workspace"] };
}

function createHost(): HTMLElement {
  const host = document.createElement("div");
  host.style.height = "200px";
  host.style.width = "300px";
  document.body.appendChild(host);
  return host;
}

describe("FileTreePanel", () => {
  it("renders empty-state placeholder when workspaceRoot is null", () => {
    const host = createHost();
    const panel = new FileTreePanel({
      host,
      workspaceRoot: null,
      rootGeneration: 0,
      getActiveSessionId: () => "any-session",
      postMessage: () => {},
    });

    const empty = host.querySelector(".file-tree-empty");
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain("No folder open");
    // No Tree should have been constructed — host itself is NOT stamped with role="tree".
    expect(host.getAttribute("role")).toBeNull();

    panel.dispose();
  });

  it("posts OpenFileMessage with both path AND sessionId on file activation", () => {
    const host = createHost();
    const posted: AnyMsg[] = [];

    const panel = new FileTreePanel({
      host,
      workspaceRoot: "/workspace",
      rootGeneration: 5,
      getActiveSessionId: () => "sess-A",
      postMessage: (m) => posted.push(m),
    });

    panel.handleActivate({
      name: "main.ts",
      path: "/workspace/src/main.ts",
      kind: "file",
    });

    const openFileMsgs = posted.filter((m): m is OpenFileMessage => m.type === "openFile");
    expect(openFileMsgs).toHaveLength(1);
    expect(openFileMsgs[0]).toMatchObject({
      type: "openFile",
      path: "/workspace/src/main.ts",
      sessionId: "sess-A",
    });

    panel.dispose();
  });

  it("does NOT post OpenFileMessage when getActiveSessionId returns null", () => {
    const host = createHost();
    const posted: AnyMsg[] = [];

    const panel = new FileTreePanel({
      host,
      workspaceRoot: "/workspace",
      rootGeneration: 5,
      getActiveSessionId: () => null,
      postMessage: (m) => posted.push(m),
    });

    panel.handleActivate({
      name: "main.ts",
      path: "/workspace/src/main.ts",
      kind: "file",
    });

    const openFileMsgs = posted.filter((m): m is OpenFileMessage => m.type === "openFile");
    expect(openFileMsgs).toHaveLength(0);

    panel.dispose();
  });

  it("does NOT activate synthetic search footer rows", () => {
    const host = createHost();
    const posted: AnyMsg[] = [];

    const panel = new FileTreePanel({
      host,
      workspaceRoot: "/workspace",
      rootGeneration: 5,
      getActiveSessionId: () => "sess-A",
      postMessage: (m) => posted.push(m),
    });

    panel.handleActivate({
      name: "Showing first 2000 files in scope — narrow your scope to see more",
      path: "__overflow__",
      kind: "file",
      searchRow: { relativePath: "__overflow__", variant: "overflow-footer" },
    });

    const openFileMsgs = posted.filter((m): m is OpenFileMessage => m.type === "openFile");
    expect(openFileMsgs).toHaveLength(0);

    panel.dispose();
  });

  it("constructs a Tree (body stamped role='tree') when workspaceRoot is provided", () => {
    const host = createHost();
    const panel = new FileTreePanel({
      host,
      workspaceRoot: "/workspace",
      rootGeneration: 0,
      getActiveSessionId: () => "sess-A",
      postMessage: () => {},
    });

    // The Tree now mounts inside `.file-tree-body` (header sits above it),
    // so role="tree" lands on the body, not the panel host.
    const body = host.querySelector(".file-tree-body");
    expect(body?.getAttribute("role")).toBe("tree");
    expect(host.querySelector(".file-tree-empty")).toBeNull();
    // Header strip with the move button should be present alongside the body.
    expect(host.querySelector(".file-tree-header__btn")).not.toBeNull();

    panel.dispose();
  });

  it("opens row context menu and posts file-tree action messages without a root/header menu", async () => {
    const host = createHost();
    const posted: AnyMsg[] = [];
    const panel = new FileTreePanel({
      host,
      workspaceRoot: "/workspace",
      rootGeneration: 7,
      getActiveSessionId: () => "sess-A",
      postMessage: (m) => posted.push(m),
      getPersistedState: expandedRootState,
    });
    const dataSource = (panel as unknown as { dataSource: { handleResponse(m: unknown): void } | null }).dataSource;
    if (!dataSource) {
      throw new Error("panel.dataSource was null after mount");
    }
    const initial = posted.filter((m): m is RequestReadDirectoryMessage => m.type === "request-read-directory");
    dataSource.handleResponse({
      type: "read-directory-response",
      requestId: initial[0].requestId,
      rootGeneration: 7,
      entries: [{ name: "a.ts", path: "/workspace/a.ts", kind: "file" }],
    });
    await Promise.resolve();
    await Promise.resolve();
    panel.layout(300, 200);

    const rootHeader = host.querySelector<HTMLElement>(".file-tree-header__root");
    rootHeader?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(document.querySelector(".file-tree-context-menu")).toBeNull();

    const row = host.querySelector<HTMLElement>(".file-tree-row");
    expect(row).not.toBeNull();
    row?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 12, clientY: 18 }));
    expect(document.querySelector(".file-tree-context-menu")).not.toBeNull();

    const clickItem = (label: string) => {
      const item = [...document.querySelectorAll<HTMLButtonElement>(".file-tree-context-menu [role='menuitem']")].find(
        (button) => button.textContent === label,
      );
      expect(item).not.toBeNull();
      item?.click();
    };

    clickItem("Copy Path");
    row?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 12, clientY: 18 }));
    clickItem("Copy Relative Path");
    row?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 12, clientY: 18 }));
    clickItem("Delete");

    const actionMessages = posted.filter(
      (m): m is FileTreeCopyPathMessage | FileTreeCopyRelativePathMessage | FileTreeDeleteMessage =>
        m.type === "file-tree-copy-path" || m.type === "file-tree-copy-relative-path" || m.type === "file-tree-delete",
    );
    expect(actionMessages).toEqual([
      { type: "file-tree-copy-path", rootGeneration: 7, path: "/workspace/a.ts" },
      { type: "file-tree-copy-relative-path", rootGeneration: 7, path: "/workspace/a.ts" },
      { type: "file-tree-delete", rootGeneration: 7, path: "/workspace/a.ts" },
    ]);

    panel.dispose();
  });

  it("closes open row context menu on remount and keeps actions pinned to the open generation", async () => {
    const host = createHost();
    const posted: AnyMsg[] = [];
    const panel = new FileTreePanel({
      host,
      workspaceRoot: "/workspace",
      rootGeneration: 7,
      getActiveSessionId: () => "sess-A",
      postMessage: (m) => posted.push(m),
      getPersistedState: expandedRootState,
    });
    const dataSource = (panel as unknown as { dataSource: { handleResponse(m: unknown): void } | null }).dataSource;
    if (!dataSource) {
      throw new Error("panel.dataSource was null after mount");
    }
    const initial = posted.filter((m): m is RequestReadDirectoryMessage => m.type === "request-read-directory");
    dataSource.handleResponse({
      type: "read-directory-response",
      requestId: initial[0].requestId,
      rootGeneration: 7,
      entries: [{ name: "a.ts", path: "/workspace/a.ts", kind: "file" }],
    });
    await Promise.resolve();
    await Promise.resolve();
    panel.layout(300, 200);

    const row = host.querySelector<HTMLElement>(".file-tree-row");
    expect(row).not.toBeNull();
    row?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 12, clientY: 18 }));
    expect(document.querySelector(".file-tree-context-menu")).not.toBeNull();

    (panel as unknown as { currentRootGeneration: number }).currentRootGeneration = 8;
    const copyPath = [
      ...document.querySelectorAll<HTMLButtonElement>(".file-tree-context-menu [role='menuitem']"),
    ].find((button) => button.textContent === "Copy Path");
    copyPath?.click();
    expect(posted).toContainEqual({ type: "file-tree-copy-path", rootGeneration: 7, path: "/workspace/a.ts" });

    row?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 12, clientY: 18 }));
    expect(document.querySelector(".file-tree-context-menu")).not.toBeNull();
    panel.handleRootChanged({ rootPath: "/other", rootGeneration: 9 });
    expect(document.querySelector(".file-tree-context-menu")).toBeNull();

    panel.dispose();
  });
});

describe("FileTreePanel — refreshDirectoryByPath + refreshRootAndExpandedDirectories", () => {
  // Drive mountTree → initial read-directory → respond with entries → assert
  // refresh-driven re-reads. This exercises the real Tree + FileSystemDataSource
  // wiring end-to-end through the panel's public surface.

  function setupPanel(): {
    panel: FileTreePanel;
    posted: AnyMsg[];
    /** Resolve a pending request-read-directory by requestId. */
    respond: (requestId: string, entries: Array<{ name: string; path: string; kind: "file" | "directory" }>) => void;
  } {
    const host = createHost();
    const posted: AnyMsg[] = [];
    const panel = new FileTreePanel({
      host,
      workspaceRoot: "/workspace",
      rootGeneration: 1,
      getActiveSessionId: () => "sess",
      postMessage: (m) => posted.push(m),
      getPersistedState: expandedRootState,
    });
    // The data source isn't exposed by the panel API; reach in by reading
    // the private field via a casted accessor for test purposes ONLY. The
    // alternative — driving Tree's refresh through DOM events — is more
    // fragile and brittle than this small encapsulation break.
    const dataSource = (panel as unknown as { dataSource: { handleResponse(m: unknown): void } | null }).dataSource;
    if (!dataSource) {
      throw new Error("panel.dataSource was null after mount — expected mountTree to construct it");
    }
    const respond = (requestId: string, entries: Array<{ name: string; path: string; kind: "file" | "directory" }>) => {
      dataSource.handleResponse({
        type: "read-directory-response",
        requestId,
        rootGeneration: 1,
        entries,
      });
    };
    return { panel, posted, respond };
  }

  function readDirectoryPosts(posted: AnyMsg[]): Array<{ requestId: string; path: string }> {
    return posted
      .filter((m): m is RequestReadDirectoryMessage => m.type === "request-read-directory")
      .map((m) => ({ requestId: m.requestId, path: m.path }));
  }

  it("(i) refreshDirectoryByPath(workspaceRoot) refreshes the root node (re-posts read-directory for the root)", async () => {
    const { panel, posted, respond } = setupPanel();
    // Initial mount issued a read for the root; satisfy it so the root has children.
    const initial = readDirectoryPosts(posted);
    expect(initial[0].path).toBe("/workspace");
    respond(initial[0].requestId, []);
    await Promise.resolve();
    await Promise.resolve();
    const beforeCount = readDirectoryPosts(posted).length;

    panel.refreshDirectoryByPath("/workspace");
    await Promise.resolve();
    await Promise.resolve();
    const after = readDirectoryPosts(posted);
    expect(after.length).toBeGreaterThan(beforeCount);
    // The new request is for the root path.
    expect(after[after.length - 1].path).toBe("/workspace");

    panel.dispose();
  });

  it("(ii) refreshDirectoryByPath(cached dir) refreshes that cached subtree", async () => {
    const { panel, posted, respond } = setupPanel();
    const initial = readDirectoryPosts(posted);
    respond(initial[0].requestId, [{ name: "src", path: "/workspace/src", kind: "directory" }]);
    await Promise.resolve();
    await Promise.resolve();
    const beforeCount = readDirectoryPosts(posted).length;

    panel.refreshDirectoryByPath("/workspace/src");
    await Promise.resolve();
    await Promise.resolve();
    const after = readDirectoryPosts(posted);
    expect(after.length).toBeGreaterThan(beforeCount);
    expect(after[after.length - 1].path).toBe("/workspace/src");

    panel.dispose();
  });

  it("(iii) refreshDirectoryByPath(uncached path) no-ops — no new read", async () => {
    const { panel, posted, respond } = setupPanel();
    respond(readDirectoryPosts(posted)[0].requestId, []);
    await Promise.resolve();
    await Promise.resolve();
    const beforeCount = readDirectoryPosts(posted).length;

    panel.refreshDirectoryByPath("/never-cached/anywhere");
    await Promise.resolve();
    await Promise.resolve();
    expect(readDirectoryPosts(posted).length).toBe(beforeCount);

    panel.dispose();
  });

  it("(iv) refreshRootAndExpandedDirectories with root + 1 expanded refreshes both", async () => {
    const { panel, posted, respond } = setupPanel();
    const initial = readDirectoryPosts(posted);
    respond(initial[0].requestId, [{ name: "src", path: "/workspace/src", kind: "directory" }]);
    await Promise.resolve();
    await Promise.resolve();
    const internals = panel as unknown as {
      dataSource: { getCachedNode(absPath: string): FileNode | undefined } | null;
      tree: { expand(node: FileNode): void } | null;
    };
    const srcNode = internals.dataSource?.getCachedNode("/workspace/src");
    expect(srcNode).toBeDefined();
    internals.tree?.expand(srcNode as FileNode);
    await Promise.resolve();
    await Promise.resolve();
    const afterPrep = readDirectoryPosts(posted);
    const srcPrepResp = afterPrep[afterPrep.length - 1];
    respond(srcPrepResp.requestId, []);
    await Promise.resolve();
    await Promise.resolve();
    const baseline = readDirectoryPosts(posted).length;

    panel.refreshRootAndExpandedDirectories();
    await Promise.resolve();
    await Promise.resolve();
    const newPosts = readDirectoryPosts(posted).slice(baseline);
    // Root + expanded /workspace/src = 2 new reads
    const paths = newPosts.map((p) => p.path).sort();
    expect(paths).toEqual(["/workspace", "/workspace/src"]);

    panel.dispose();
  });

  it("(iv-b) refreshRootAndExpandedDirectories skips cached dirs that are not actually expanded", async () => {
    const { panel, posted, respond } = setupPanel();
    const initial = readDirectoryPosts(posted);
    respond(initial[0].requestId, [{ name: "src", path: "/workspace/src", kind: "directory" }]);
    await Promise.resolve();
    await Promise.resolve();
    (panel as unknown as { expandedPaths: Set<string> }).expandedPaths.add("/workspace/src");
    const baseline = readDirectoryPosts(posted).length;

    panel.refreshRootAndExpandedDirectories();
    await Promise.resolve();
    await Promise.resolve();
    const newPosts = readDirectoryPosts(posted).slice(baseline);
    expect(newPosts.map((p) => p.path)).toEqual(["/workspace"]);

    panel.dispose();
  });

  it("(vi) panel callbacks fan out to the search controller (onFsInvalidated + onRehydrate)", async () => {
    const { panel, respond, posted } = setupPanel();
    respond(readDirectoryPosts(posted)[0].requestId, []);
    await Promise.resolve();
    await Promise.resolve();
    // Reach in for the search controller; eagerly construct it so the
    // callbacks have somewhere to fan out (the production code lazy-creates
    // on first search-bar open). We use the private getOrCreateSearchController
    // path indirectly by writing the field.
    const onFsInvalidated = vi.fn();
    const onRehydrate = vi.fn();
    const fakeSearchController = { onFsInvalidated, onRehydrate };
    (panel as unknown as { searchController: unknown }).searchController = fakeSearchController;

    // Drive the data source's invalidate / rehydrate dispatch end-to-end —
    // these are what the panel callbacks wrap.
    panel.handleFsChangesInvalidated({
      type: "fs-changes-invalidated",
      rootGeneration: 1,
      parent: "/workspace",
    } as never);
    expect(onFsInvalidated).toHaveBeenCalledWith("/workspace");

    panel.handleFsRehydrate({ type: "fs-rehydrate", rootGeneration: 1 } as never);
    expect(onRehydrate).toHaveBeenCalledTimes(1);

    panel.dispose();
  });

  it("(vi-b) callbacks tolerate null searchController without throwing", async () => {
    const { panel, respond, posted } = setupPanel();
    respond(readDirectoryPosts(posted)[0].requestId, []);
    await Promise.resolve();
    await Promise.resolve();
    expect((panel as unknown as { searchController: unknown }).searchController).toBeNull();
    expect(() =>
      panel.handleFsChangesInvalidated({
        type: "fs-changes-invalidated",
        rootGeneration: 1,
        parent: "/workspace",
      } as never),
    ).not.toThrow();
    expect(() => panel.handleFsRehydrate({ type: "fs-rehydrate", rootGeneration: 1 } as never)).not.toThrow();
    panel.dispose();
  });

  it("(focus-steal) revealPath with source='autoReveal' MUST NOT call tree.domFocus", async () => {
    // Regression: ActiveFileRevealer posts reveal-in-file-tree with
    // source='autoReveal' whenever VS Code's active editor changes (e.g.
    // user clicked a different file in the Explorer). Previously the panel
    // unconditionally called tree.domFocus() which stole keyboard focus
    // from whatever the user was actually interacting with.
    const { panel, posted, respond } = setupPanel();
    respond(readDirectoryPosts(posted)[0].requestId, [{ name: "a.ts", path: "/workspace/a.ts", kind: "file" }]);
    await Promise.resolve();
    await Promise.resolve();

    const tree = (panel as unknown as { tree: { domFocus(): void } | null }).tree;
    if (!tree) {
      throw new Error("Test setup: panel.tree was null after mount");
    }
    const focusSpy = vi.spyOn(tree, "domFocus");

    await panel.revealPath("/workspace/a.ts", { source: "autoReveal" });
    expect(focusSpy).not.toHaveBeenCalled();

    panel.dispose();
  });

  it("(focus-steal) revealPath with source='osc7' DOES call tree.domFocus (user-initiated reveal)", async () => {
    // User-initiated reveals (OSC 7 from a terminal `cd`, "Reveal in File
    // Tree" command) intentionally pull focus into the tree. Verifies the
    // autoReveal carve-out hasn't broken the user-driven path.
    const { panel, posted, respond } = setupPanel();
    respond(readDirectoryPosts(posted)[0].requestId, [{ name: "a.ts", path: "/workspace/a.ts", kind: "file" }]);
    await Promise.resolve();
    await Promise.resolve();

    const tree = (panel as unknown as { tree: { domFocus(): void } | null }).tree;
    if (!tree) {
      throw new Error("Test setup: panel.tree was null after mount");
    }
    const focusSpy = vi.spyOn(tree, "domFocus");

    await panel.revealPath("/workspace/a.ts", { source: "osc7" });
    expect(focusSpy).toHaveBeenCalled();

    panel.dispose();
  });

  it("(v) refreshRootAndExpandedDirectories dedups when root is also recorded as expanded", async () => {
    const { panel, posted, respond } = setupPanel();
    const initial = readDirectoryPosts(posted);
    respond(initial[0].requestId, []);
    await Promise.resolve();
    await Promise.resolve();
    // Mount records the root in expandedPaths already; verify it's present.
    const expanded = (panel as unknown as { expandedPaths: Set<string> }).expandedPaths;
    expect(expanded.has("/workspace")).toBe(true);
    const baseline = readDirectoryPosts(posted).length;

    panel.refreshRootAndExpandedDirectories();
    await Promise.resolve();
    await Promise.resolve();
    const newPosts = readDirectoryPosts(posted).slice(baseline);
    // Only ONE read for the root, not two.
    expect(newPosts.map((p) => p.path)).toEqual(["/workspace"]);

    panel.dispose();
  });
});

describe("FileTreePanel — root-collapsed (header-only) mode", () => {
  // Covers oracle action item: when the user has explicitly collapsed the
  // root via the header chevron, external reveals must NOT pop the body open.
  // OSC 7 cd outside the workspace silently re-roots while staying collapsed
  // so the header tracks shell PWD; in-root reveals are no-ops.

  type TreeInternals = {
    rootNode: FileNode | null;
    workspaceRootPath: string | null;
    tree: {
      isExpanded(n: FileNode): boolean;
      collapse(n: FileNode): void;
      domFocus(): void;
      revealElement(n: FileNode, top?: number): void;
    } | null;
  };

  function setupCollapsedPanel(): {
    panel: FileTreePanel;
    posted: AnyMsg[];
    wrapper: HTMLElement;
    internals: TreeInternals;
    respond: (requestId: string, entries: Array<{ name: string; path: string; kind: "file" | "directory" }>) => void;
  } {
    const wrapper = document.createElement("div");
    wrapper.className = "webview-layout";
    document.body.appendChild(wrapper);
    const host = createHost();
    const posted: AnyMsg[] = [];
    const panel = new FileTreePanel({
      host,
      layoutWrapper: wrapper,
      workspaceRoot: "/workspace",
      rootGeneration: 1,
      getActiveSessionId: () => "sess",
      postMessage: (m) => posted.push(m),
    });
    const internals = panel as unknown as TreeInternals & {
      dataSource: { handleResponse(m: unknown): void } | null;
    };
    if (!internals.dataSource) {
      throw new Error("panel.dataSource was null after mount");
    }
    const ds = internals.dataSource;
    const respond = (requestId: string, entries: Array<{ name: string; path: string; kind: "file" | "directory" }>) => {
      ds.handleResponse({ type: "read-directory-response", requestId, rootGeneration: 1, entries });
    };
    return { panel, posted, wrapper, internals, respond };
  }

  function readDirectoryPosts(posted: AnyMsg[]): Array<{ requestId: string; path: string }> {
    return posted
      .filter((m): m is RequestReadDirectoryMessage => m.type === "request-read-directory")
      .map((m) => ({ requestId: m.requestId, path: m.path }));
  }

  it("revealPath(osc7, outside-workspace) re-roots silently and stays collapsed", async () => {
    const { panel, posted, wrapper, internals, respond } = setupCollapsedPanel();
    respond(readDirectoryPosts(posted)[0].requestId, []);
    await Promise.resolve();
    await Promise.resolve();

    // User explicitly collapses the root via the header chevron equivalent.
    const root = internals.rootNode;
    if (!root || !internals.tree) {
      throw new Error("test setup: tree or rootNode missing after mount");
    }
    internals.tree.collapse(root);
    expect(wrapper.classList.contains("file-tree--root-collapsed")).toBe(true);

    // Spy on the post-collapse tree's focus/reveal methods so we can prove
    // the silent re-root does NOT steal focus or scroll the user's view.
    // The NEW tree is created inside setRoot, so we need to spy AFTER reveal.

    await panel.revealPath("/other/repo", { source: "osc7" });
    await Promise.resolve();
    await Promise.resolve();

    // Root path tracked the cd.
    expect(internals.workspaceRootPath).toBe("/other/repo");
    expect(internals.rootNode?.path).toBe("/other/repo");

    // Still collapsed: wrapper class persists across the silent re-root.
    expect(wrapper.classList.contains("file-tree--root-collapsed")).toBe(true);
    if (internals.rootNode && internals.tree) {
      expect(internals.tree.isExpanded(internals.rootNode)).toBe(false);
    }

    panel.dispose();
    wrapper.remove();
  });

  it("revealPath(osc7, inside-workspace) is a no-op while collapsed", async () => {
    const { panel, posted, wrapper, internals, respond } = setupCollapsedPanel();
    respond(readDirectoryPosts(posted)[0].requestId, [{ name: "a.ts", path: "/workspace/a.ts", kind: "file" }]);
    await Promise.resolve();
    await Promise.resolve();

    const root = internals.rootNode;
    if (!root || !internals.tree) {
      throw new Error("test setup: tree or rootNode missing after mount");
    }
    internals.tree.collapse(root);
    const focusSpy = vi.spyOn(internals.tree, "domFocus");
    const revealSpy = vi.spyOn(internals.tree, "revealElement");
    const beforeReads = readDirectoryPosts(posted).length;

    await panel.revealPath("/workspace/a.ts", { source: "osc7" });

    expect(focusSpy).not.toHaveBeenCalled();
    expect(revealSpy).not.toHaveBeenCalled();
    expect(readDirectoryPosts(posted).length).toBe(beforeReads);
    expect(internals.workspaceRootPath).toBe("/workspace");
    expect(wrapper.classList.contains("file-tree--root-collapsed")).toBe(true);

    panel.dispose();
    wrapper.remove();
  });

  it("revealPath(autoReveal) is a no-op while collapsed", async () => {
    const { panel, posted, wrapper, internals, respond } = setupCollapsedPanel();
    respond(readDirectoryPosts(posted)[0].requestId, [{ name: "a.ts", path: "/workspace/a.ts", kind: "file" }]);
    await Promise.resolve();
    await Promise.resolve();

    const root = internals.rootNode;
    if (!root || !internals.tree) {
      throw new Error("test setup: tree or rootNode missing after mount");
    }
    internals.tree.collapse(root);
    const focusSpy = vi.spyOn(internals.tree, "domFocus");
    const revealSpy = vi.spyOn(internals.tree, "revealElement");

    await panel.revealPath("/workspace/a.ts", { source: "autoReveal" });

    expect(focusSpy).not.toHaveBeenCalled();
    expect(revealSpy).not.toHaveBeenCalled();
    expect(wrapper.classList.contains("file-tree--root-collapsed")).toBe(true);

    panel.dispose();
    wrapper.remove();
  });

  it("revealPath(openFolder) expands and focuses the picked folder even while collapsed", async () => {
    const { panel, posted, wrapper, internals, respond } = setupCollapsedPanel();
    respond(readDirectoryPosts(posted)[0].requestId, []);
    await Promise.resolve();
    await Promise.resolve();

    const root = internals.rootNode;
    if (!root || !internals.tree) {
      throw new Error("test setup: tree or rootNode missing after mount");
    }
    internals.tree.collapse(root);
    expect(wrapper.classList.contains("file-tree--root-collapsed")).toBe(true);

    await panel.revealPath("/other/repo", { source: "openFolder" });
    await Promise.resolve();
    await Promise.resolve();

    expect(internals.workspaceRootPath).toBe("/other/repo");
    expect(wrapper.classList.contains("file-tree--root-collapsed")).toBe(false);
    if (internals.rootNode && internals.tree) {
      expect(internals.tree.isExpanded(internals.rootNode)).toBe(true);
    }

    panel.dispose();
    wrapper.remove();
  });

  it("handleRootChanged preserves collapse intent across workspace folder change", async () => {
    const { panel, posted, wrapper, internals, respond } = setupCollapsedPanel();
    respond(readDirectoryPosts(posted)[0].requestId, []);
    await Promise.resolve();
    await Promise.resolve();

    const root = internals.rootNode;
    if (!root || !internals.tree) {
      throw new Error("test setup: tree or rootNode missing after mount");
    }
    internals.tree.collapse(root);
    expect(wrapper.classList.contains("file-tree--root-collapsed")).toBe(true);

    panel.handleRootChanged({ rootPath: "/new-workspace", rootGeneration: 2 });
    await Promise.resolve();
    await Promise.resolve();

    expect(internals.workspaceRootPath).toBe("/new-workspace");
    expect(wrapper.classList.contains("file-tree--root-collapsed")).toBe(true);
    if (internals.rootNode && internals.tree) {
      expect(internals.tree.isExpanded(internals.rootNode)).toBe(false);
    }

    panel.dispose();
    wrapper.remove();
  });

  it("syncRootCollapsedClass does NOT stamp the class when no workspace is open", () => {
    const wrapper = document.createElement("div");
    wrapper.className = "webview-layout";
    document.body.appendChild(wrapper);
    const host = createHost();

    const panel = new FileTreePanel({
      host,
      layoutWrapper: wrapper,
      workspaceRoot: null,
      rootGeneration: 0,
      getActiveSessionId: () => null,
      postMessage: () => {},
    });

    // No workspace → empty state visible, wrapper must NOT carry the
    // collapsed class even though the header's aria-expanded is "false".
    expect(wrapper.classList.contains("file-tree--root-collapsed")).toBe(false);
    expect(host.querySelector(".file-tree-empty")).not.toBeNull();

    panel.dispose();
    wrapper.remove();
  });

  // ─── Position menu (anchored dropdown for the Move File Tree button) ──
  it("position menu: opens with 4 items, selecting one calls setPosition and closes the menu", () => {
    const host = createHost();
    const posted: AnyMsg[] = [];
    const panel = new FileTreePanel({
      host,
      workspaceRoot: null,
      rootGeneration: 0,
      getActiveSessionId: () => null,
      postMessage: (m) => posted.push(m),
    });

    const moveBtn = host.querySelector<HTMLButtonElement>('.file-tree-header__btn[aria-haspopup="menu"]');
    expect(moveBtn).not.toBeNull();
    expect(moveBtn?.getAttribute("aria-expanded")).toBe("false");

    moveBtn?.click();

    const menu = document.querySelector<HTMLElement>(".file-tree-position-menu");
    expect(menu).not.toBeNull();
    expect(moveBtn?.getAttribute("aria-expanded")).toBe("true");
    const items = menu?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [];
    expect(items).toHaveLength(4);
    expect(Array.from(items).map((el) => el.textContent)).toEqual(["Top", "Bottom", "Left", "Right"]);

    // Click "Right" — panel should record the new position; menu unmounts.
    items[3]?.click();
    expect(document.querySelector(".file-tree-position-menu")).toBeNull();
    expect(moveBtn?.getAttribute("aria-expanded")).toBe("false");
    expect(panel.getPosition()).toBe("right");

    // No request-set-file-tree-position should ever be posted — the menu
    // calls setPosition locally without an IPC roundtrip.
    expect(posted.some((m) => (m as { type: string }).type === "request-set-file-tree-position")).toBe(false);

    panel.dispose();
  });

  it("position menu: Escape closes the menu and returns focus to the move button", () => {
    const host = createHost();
    const panel = new FileTreePanel({
      host,
      workspaceRoot: null,
      rootGeneration: 0,
      getActiveSessionId: () => null,
      postMessage: () => {},
    });

    const moveBtn = host.querySelector<HTMLButtonElement>('.file-tree-header__btn[aria-haspopup="menu"]');
    moveBtn?.click();
    expect(document.querySelector(".file-tree-position-menu")).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".file-tree-position-menu")).toBeNull();
    expect(document.activeElement).toBe(moveBtn);

    panel.dispose();
  });

  it("position menu: Tab closes the menu without forcing focus back to the move button", () => {
    const host = createHost();
    const panel = new FileTreePanel({
      host,
      workspaceRoot: null,
      rootGeneration: 0,
      getActiveSessionId: () => null,
      postMessage: () => {},
    });

    const moveBtn = host.querySelector<HTMLButtonElement>('.file-tree-header__btn[aria-haspopup="menu"]');
    moveBtn?.click();
    const firstItem = document.querySelector<HTMLButtonElement>('.file-tree-position-menu [role="menuitemradio"]');
    expect(firstItem).not.toBeNull();
    firstItem?.focus();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.querySelector(".file-tree-position-menu")).toBeNull();
    expect(moveBtn?.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).not.toBe(moveBtn);

    panel.dispose();
  });

  it("position menu: re-clicking the button closes the menu", () => {
    const host = createHost();
    const panel = new FileTreePanel({
      host,
      workspaceRoot: null,
      rootGeneration: 0,
      getActiveSessionId: () => null,
      postMessage: () => {},
    });

    const moveBtn = host.querySelector<HTMLButtonElement>('.file-tree-header__btn[aria-haspopup="menu"]');
    moveBtn?.click();
    expect(document.querySelector(".file-tree-position-menu")).not.toBeNull();
    moveBtn?.click();
    expect(document.querySelector(".file-tree-position-menu")).toBeNull();

    panel.dispose();
  });

  it("position menu: dispose cleans up an open menu", () => {
    const host = createHost();
    const panel = new FileTreePanel({
      host,
      workspaceRoot: null,
      rootGeneration: 0,
      getActiveSessionId: () => null,
      postMessage: () => {},
    });

    const moveBtn = host.querySelector<HTMLButtonElement>('.file-tree-header__btn[aria-haspopup="menu"]');
    moveBtn?.click();
    expect(document.querySelector(".file-tree-position-menu")).not.toBeNull();

    panel.dispose();
    expect(document.querySelector(".file-tree-position-menu")).toBeNull();
  });

  it("header vault button fires onToggleVault", () => {
    const host = createHost();
    let toggles = 0;
    const panel = new FileTreePanel({
      host,
      workspaceRoot: null,
      rootGeneration: 0,
      getActiveSessionId: () => null,
      postMessage: () => {},
      onToggleVault: () => {
        toggles++;
      },
    });

    const vaultBtn = host.querySelector<HTMLButtonElement>('.file-tree-header__btn[aria-label="AI Vault"]');
    expect(vaultBtn).not.toBeNull();
    vaultBtn?.click();
    vaultBtn?.click();
    expect(toggles).toBe(2);

    panel.dispose();
  });

  it("mounts the resize sash on regionEl when provided", () => {
    const host = createHost();
    const regionEl = document.createElement("div");
    document.body.appendChild(regionEl);
    regionEl.appendChild(host);

    const panel = new FileTreePanel({
      host,
      workspaceRoot: "/workspace",
      rootGeneration: 1,
      getActiveSessionId: () => null,
      postMessage: () => {},
      regionEl,
    });

    // The sash is a direct child of the region wrapper, not the panel host.
    expect(regionEl.querySelector(":scope > .sash")).not.toBeNull();
    expect(host.querySelector(".sash")).toBeNull();

    panel.dispose();
  });
});
