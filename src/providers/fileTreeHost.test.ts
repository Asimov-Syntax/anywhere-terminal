// src/providers/fileTreeHost.test.ts — Pinpoint regression tests for the
// FileTreeHost message dispatch.
//
// The host owns the central dispatch for file-tree messages; both
// TerminalViewProvider and TerminalEditorProvider forward selected message
// types to `fileTreeHost.handleMessage()`. A bug where one of those
// providers forgot to forward `request-file-tree-search` (i.e., the search
// RPC silently lost) is exactly the kind of regression these tests guard.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import type {
  FileTreeCopyPathMessage,
  FileTreeCopyRelativePathMessage,
  FileTreeDeleteMessage,
  FileTreeRevealInOsMessage,
  GitStatus,
  ReadDirectoryResponseMessage,
  RequestFileTreeSearchMessage,
  RequestReadDirectoryMessage,
  WebViewToExtensionMessage,
} from "../types/messages";
import { createTrackedPathResolver, ResolvedPathMemo } from "../utils/resolvedPathMemo";
import { FileTreeHost } from "./fileTreeHost";
import type { WatcherPool } from "./fsWatcherPool";
import type { GitDecorationProvider } from "./gitDecorationProvider";

/**
 * Wait until `condition` holds. Returns silently on timeout so the assertion
 * that follows reports the failure, rather than this helper masking it.
 *
 * Replaces `await new Promise((r) => setTimeout(r, 0))`: a single macrotask tick
 * only outruns the host's async work when the suite has a CPU to itself.
 */
async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Let pending async work run when the assertion is that nothing happened. */
async function settle(ticks = 10): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await new Promise((r) => setTimeout(r, 1));
  }
}

describe("FileTreeHost.handleMessage", () => {
  it("handles `request-file-tree-search` and posts a response back", async () => {
    const host = new FileTreeHost();
    const posted: unknown[] = [];

    const msg: RequestFileTreeSearchMessage = {
      type: "request-file-tree-search",
      requestId: "rq",
      rootGeneration: 0,
      scopePath: "/some/path/not/in/workspace",
      maxResults: 100,
    };

    const handled = host.handleMessage(msg, (m) => posted.push(m));
    expect(handled).toBe(true);

    // Allow the inner promise to resolve. Without a workspace folder set the
    // host falls into the `OUT_OF_WORKSPACE` branch and posts an error —
    // the exact response content isn't the point. We're asserting that the
    // message TYPE was claimed by the host (the dispatch wiring is the
    // regression target).
    await waitFor(() => posted.length > 0);
    expect(posted.length).toBe(1);
    expect((posted[0] as { type?: string }).type).toBe("file-tree-search-response");
  });

  it("returns false for messages it doesn't own (e.g. `input`)", () => {
    const host = new FileTreeHost();
    const noopPost = vi.fn();
    const unrelated = { type: "input", tabId: "t", data: "x" } as WebViewToExtensionMessage;
    expect(host.handleMessage(unrelated, noopPost)).toBe(false);
    expect(noopPost).not.toHaveBeenCalled();
  });

  it("handles `request-open-folder` by showing the native folder picker", async () => {
    const host = new FileTreeHost();
    const postSpy = vi.fn();
    const dialogSpy = vi.spyOn(vscode.window, "showOpenDialog").mockResolvedValue(undefined);

    try {
      const handled = host.handleMessage({ type: "request-open-folder" }, postSpy);
      expect(handled).toBe(true);
      // The dialog is async; let it resolve.
      await waitFor(() => dialogSpy.mock.calls.length > 0);
      expect(dialogSpy).toHaveBeenCalledTimes(1);
      expect(dialogSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
        }),
      );
      // User cancelled (resolved undefined) → no reveal posted.
      expect(postSpy).not.toHaveBeenCalled();
    } finally {
      dialogSpy.mockRestore();
    }
  });

  it("posts `reveal-in-file-tree` with the picked path via attachPost after `request-open-folder` resolves", async () => {
    const host = new FileTreeHost();
    const attachPostSpy = vi.fn();
    // attach() wires the host's stable channel; pass a stub isReady=true so
    // the post is not gated out.
    host.attach({ isReady: () => true, post: attachPostSpy });

    const dialogSpy = vi
      .spyOn(vscode.window, "showOpenDialog")
      .mockResolvedValue([{ fsPath: "/picked/folder" } as vscode.Uri]);

    try {
      const handled = host.handleMessage({ type: "request-open-folder" }, vi.fn());
      expect(handled).toBe(true);
      await waitFor(() => attachPostSpy.mock.calls.length > 0);
      expect(attachPostSpy).toHaveBeenCalledTimes(1);
      expect(attachPostSpy).toHaveBeenCalledWith({
        type: "reveal-in-file-tree",
        absPath: "/picked/folder",
        source: "openFolder",
      });
    } finally {
      dialogSpy.mockRestore();
    }
  });

  it("warns when a picked folder cannot be posted because the webview is no longer ready", async () => {
    const host = new FileTreeHost();
    const attachPostSpy = vi.fn();
    host.attach({ isReady: () => false, post: attachPostSpy });
    const dialogSpy = vi
      .spyOn(vscode.window, "showOpenDialog")
      .mockResolvedValue([{ fsPath: "/picked/folder" } as vscode.Uri]);
    const warningSpy = vi.spyOn(vscode.window, "showWarningMessage").mockResolvedValue(undefined);

    try {
      const handled = host.handleMessage({ type: "request-open-folder" }, vi.fn());
      expect(handled).toBe(true);
      await waitFor(() => warningSpy.mock.calls.length > 0);
      expect(attachPostSpy).not.toHaveBeenCalled();
      expect(warningSpy).toHaveBeenCalledWith(
        "AnyWhere Terminal file tree is no longer available. Reopen it and try again.",
      );
    } finally {
      dialogSpy.mockRestore();
      warningSpy.mockRestore();
    }
  });

  it("surfaces an error message when the folder picker rejects", async () => {
    const host = new FileTreeHost();
    const dialogSpy = vi.spyOn(vscode.window, "showOpenDialog").mockRejectedValue(new Error("boom"));
    const errorSpy = vi.spyOn(vscode.window, "showErrorMessage").mockResolvedValue(undefined);

    try {
      const handled = host.handleMessage({ type: "request-open-folder" }, vi.fn());
      expect(handled).toBe(true);
      await waitFor(() => errorSpy.mock.calls.length > 0);
      expect(errorSpy).toHaveBeenCalledWith("AnyWhere Terminal could not open the folder picker.");
    } finally {
      dialogSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe("FileTreeHost — file-tree path actions", () => {
  const setWorkspaceFolders = (folders: Array<{ uri: { fsPath: string } }> | undefined) => {
    (
      vscode as unknown as { __setWorkspaceFolders(folders: Array<{ uri: { fsPath: string } }> | undefined): void }
    ).__setWorkspaceFolders(folders);
  };

  beforeEach(() => {
    setWorkspaceFolders([{ uri: { fsPath: "/workspace" } }]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setWorkspaceFolders(undefined);
    delete (vscode.workspace.fs as unknown as { delete?: unknown }).delete;
    (vscode.workspace.fs as unknown as { stat: unknown }).stat = async () => ({
      type: vscode.FileType.File,
      ctime: 0,
      mtime: 0,
      size: 1,
    });
  });

  function attachActionHost(host = new FileTreeHost(), isReady = true) {
    const posted: Array<{ type: string; rootGeneration?: number; parent?: string }> = [];
    const sub = host.attach({
      isReady: () => isReady,
      post: (m) => posted.push(m as { type: string; rootGeneration?: number; parent?: string }),
    });
    return { host, posted, sub };
  }

  function installClipboard() {
    const writeText = vi.fn(async (_text: string) => undefined);
    (vscode.env as unknown as { clipboard: { writeText: typeof writeText } }).clipboard = { writeText };
    return writeText;
  }

  it("copies absolute and relative paths under the host-owned workspace root", async () => {
    const { host, sub } = attachActionHost();
    const writeText = installClipboard();

    const copyPath: FileTreeCopyPathMessage = {
      type: "file-tree-copy-path",
      rootGeneration: 0,
      path: "/workspace/src/a.ts",
    };
    const copyRelative: FileTreeCopyRelativePathMessage = {
      type: "file-tree-copy-relative-path",
      rootGeneration: 0,
      path: "/workspace/src/a.ts",
    };

    expect(host.handleMessage(copyPath, vi.fn())).toBe(true);
    expect(host.handleMessage(copyRelative, vi.fn())).toBe(true);
    await Promise.resolve();

    expect(writeText).toHaveBeenNthCalledWith(1, "/workspace/src/a.ts");
    expect(writeText).toHaveBeenNthCalledWith(2, "src/a.ts");
    sub.dispose();
  });

  it("updates the host-owned active root from Open Folder before copy-relative", async () => {
    const { host, posted, sub } = attachActionHost();
    const writeText = installClipboard();
    vi.spyOn(vscode.window, "showOpenDialog").mockResolvedValue([{ fsPath: "/external/root" } as vscode.Uri]);

    expect(host.handleMessage({ type: "request-open-folder" }, vi.fn())).toBe(true);
    await waitFor(() => posted.some((m) => m.type === "reveal-in-file-tree"));

    expect(
      host.handleMessage(
        { type: "file-tree-copy-relative-path", rootGeneration: 0, path: "/external/root/nested/a.ts" },
        vi.fn(),
      ),
    ).toBe(true);
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith("nested/a.ts");
    sub.dispose();
  });

  it("does not adopt an Open Folder root when the reveal cannot be delivered", async () => {
    const { host, sub } = attachActionHost(new FileTreeHost(), false);
    const writeText = installClipboard();
    const dialogSpy = vi
      .spyOn(vscode.window, "showOpenDialog")
      .mockResolvedValue([{ fsPath: "/external/root" } as vscode.Uri]);

    expect(host.handleMessage({ type: "request-open-folder" }, vi.fn())).toBe(true);
    await waitFor(() => dialogSpy.mock.calls.length > 0);
    await settle();

    expect(
      host.handleMessage(
        { type: "file-tree-copy-relative-path", rootGeneration: 0, path: "/external/root/nested/a.ts" },
        vi.fn(),
      ),
    ).toBe(true);
    expect(
      host.handleMessage({ type: "file-tree-copy-relative-path", rootGeneration: 0, path: "/workspace/a.ts" }, vi.fn()),
    ).toBe(true);
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("a.ts");
    sub.dispose();
  });

  it("resets the host-owned active root on attach to match the init workspace root", async () => {
    const host = new FileTreeHost();
    const first = attachActionHost(host);
    const writeText = installClipboard();
    vi.spyOn(vscode.window, "showOpenDialog").mockResolvedValue([{ fsPath: "/external/root" } as vscode.Uri]);

    expect(host.handleMessage({ type: "request-open-folder" }, vi.fn())).toBe(true);
    await waitFor(() => first.posted.some((m) => m.type === "reveal-in-file-tree"));
    first.sub.dispose();

    const second = attachActionHost(host);
    expect(
      host.handleMessage(
        { type: "file-tree-copy-relative-path", rootGeneration: 0, path: "/external/root/nested/a.ts" },
        vi.fn(),
      ),
    ).toBe(true);
    expect(
      host.handleMessage({ type: "file-tree-copy-relative-path", rootGeneration: 0, path: "/workspace/a.ts" }, vi.fn()),
    ).toBe(true);
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("a.ts");
    second.sub.dispose();
  });

  it("reveals contained targets through VS Code's revealFileInOS command", async () => {
    const { host, sub } = attachActionHost();
    const commandSpy = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined);
    const msg: FileTreeRevealInOsMessage = {
      type: "file-tree-reveal-in-os",
      rootGeneration: 0,
      path: "/workspace/src/a.ts",
    };

    expect(host.handleMessage(msg, vi.fn())).toBe(true);
    await Promise.resolve();

    expect(commandSpy).toHaveBeenCalledWith(
      "revealFileInOS",
      expect.objectContaining({ fsPath: "/workspace/src/a.ts" }),
    );
    sub.dispose();
  });

  it("surfaces reveal and copy failures as user-visible errors", async () => {
    const { host, sub } = attachActionHost();
    const errorSpy = vi.spyOn(vscode.window, "showErrorMessage").mockResolvedValue(undefined);
    vi.spyOn(vscode.commands, "executeCommand").mockRejectedValue(new Error("reveal failed"));
    (vscode.env as unknown as { clipboard: { writeText: (text: string) => Promise<void> } }).clipboard = {
      writeText: vi.fn(async () => {
        throw new Error("copy failed");
      }),
    };

    expect(
      host.handleMessage({ type: "file-tree-reveal-in-os", rootGeneration: 0, path: "/workspace/src/a.ts" }, vi.fn()),
    ).toBe(true);
    expect(
      host.handleMessage({ type: "file-tree-copy-path", rootGeneration: 0, path: "/workspace/src/a.ts" }, vi.fn()),
    ).toBe(true);
    expect(
      host.handleMessage(
        { type: "file-tree-copy-relative-path", rootGeneration: 0, path: "/workspace/src/a.ts" },
        vi.fn(),
      ),
    ).toBe(true);
    await waitFor(() => errorSpy.mock.calls.length >= 2);

    expect(errorSpy).toHaveBeenCalledWith("AnyWhere Terminal could not reveal the selected item.");
    expect(errorSpy).toHaveBeenCalledWith("AnyWhere Terminal could not copy the selected path.");
    sub.dispose();
  });

  it("rejects stale-generation and outside-root path actions", async () => {
    const { host, sub } = attachActionHost();
    const writeText = installClipboard();
    host.rootGeneration = 2;

    expect(
      host.handleMessage({ type: "file-tree-copy-path", rootGeneration: 1, path: "/workspace/src/a.ts" }, vi.fn()),
    ).toBe(true);
    expect(host.handleMessage({ type: "file-tree-copy-path", rootGeneration: 2, path: "/outside/a.ts" }, vi.fn())).toBe(
      true,
    );
    await Promise.resolve();

    expect(writeText).not.toHaveBeenCalled();
    sub.dispose();
  });

  it("allows contained paths when the first relative segment starts with two dots", async () => {
    const { host, sub } = attachActionHost();
    const writeText = installClipboard();

    expect(
      host.handleMessage(
        { type: "file-tree-copy-relative-path", rootGeneration: 0, path: "/workspace/..data/a.ts" },
        vi.fn(),
      ),
    ).toBe(true);
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith("..data/a.ts");
    sub.dispose();
  });

  it("cancels delete when the modal is dismissed", async () => {
    const { host, sub } = attachActionHost();
    const deleteSpy = vi.fn(async () => undefined);
    (vscode.workspace.fs as unknown as { delete: typeof deleteSpy }).delete = deleteSpy;
    const warningSpy = vi.spyOn(vscode.window, "showWarningMessage").mockResolvedValue(undefined);

    expect(host.handleMessage({ type: "file-tree-delete", rootGeneration: 0, path: "/workspace/a.ts" }, vi.fn())).toBe(
      true,
    );
    await waitFor(() => warningSpy.mock.calls.length > 0);
    await settle();

    expect(deleteSpy).not.toHaveBeenCalled();
    sub.dispose();
  });

  it("deletes files and invalidates the parent after confirmation", async () => {
    const { host, posted, sub } = attachActionHost();
    const deleteSpy = vi.fn(async () => undefined);
    (vscode.workspace.fs as unknown as { delete: typeof deleteSpy }).delete = deleteSpy;
    vi.spyOn(vscode.window, "showWarningMessage").mockResolvedValue("Delete" as never);

    const msg: FileTreeDeleteMessage = { type: "file-tree-delete", rootGeneration: 0, path: "/workspace/src/a.ts" };
    expect(host.handleMessage(msg, vi.fn())).toBe(true);
    await waitFor(() => deleteSpy.mock.calls.length > 0);

    expect(deleteSpy).toHaveBeenCalledWith(expect.objectContaining({ fsPath: "/workspace/src/a.ts" }), {
      recursive: false,
      useTrash: true,
    });
    expect(posted).toContainEqual({ type: "fs-changes-invalidated", rootGeneration: 0, parent: "/workspace/src" });
    sub.dispose();
  });

  it("deletes folders recursively only after folder-specific confirmation", async () => {
    const { host, sub } = attachActionHost();
    const deleteSpy = vi.fn(async () => undefined);
    (vscode.workspace.fs as unknown as { stat: unknown; delete: typeof deleteSpy }).stat = async () => ({
      type: vscode.FileType.Directory,
      ctime: 0,
      mtime: 0,
      size: 0,
    });
    (vscode.workspace.fs as unknown as { delete: typeof deleteSpy }).delete = deleteSpy;
    const warningSpy = vi.spyOn(vscode.window, "showWarningMessage").mockResolvedValue("Delete" as never);

    expect(host.handleMessage({ type: "file-tree-delete", rootGeneration: 0, path: "/workspace/src" }, vi.fn())).toBe(
      true,
    );
    await waitFor(() => deleteSpy.mock.calls.length > 0);

    expect(warningSpy).toHaveBeenCalledWith(
      'Delete folder "src"?',
      expect.objectContaining({
        modal: true,
        detail: "The folder and its contents at /workspace/src will be moved to the trash.",
      }),
      "Delete",
    );
    expect(deleteSpy).toHaveBeenCalledWith(expect.objectContaining({ fsPath: "/workspace/src" }), {
      recursive: true,
      useTrash: true,
    });
    sub.dispose();
  });

  it("rejects root delete and re-validates generation after confirmation", async () => {
    const { host, sub } = attachActionHost();
    const deleteSpy = vi.fn(async () => undefined);
    (vscode.workspace.fs as unknown as { delete: typeof deleteSpy }).delete = deleteSpy;
    const warningSpy = vi.spyOn(vscode.window, "showWarningMessage").mockImplementation(async () => {
      host.rootGeneration = 1;
      return "Delete" as never;
    });

    expect(host.handleMessage({ type: "file-tree-delete", rootGeneration: 0, path: "/workspace" }, vi.fn())).toBe(true);
    expect(host.handleMessage({ type: "file-tree-delete", rootGeneration: 0, path: "/workspace/a.ts" }, vi.fn())).toBe(
      true,
    );
    await waitFor(() => warningSpy.mock.calls.length > 0);
    await settle();

    expect(deleteSpy).not.toHaveBeenCalled();
    sub.dispose();
  });

  it("rejects active root delete when Windows path casing differs", async () => {
    setWorkspaceFolders([{ uri: { fsPath: "C:\\Root" } }]);
    const { host, sub } = attachActionHost();
    const statSpy = vi.fn(async () => ({
      type: vscode.FileType.Directory,
      ctime: 0,
      mtime: 0,
      size: 0,
    }));
    const deleteSpy = vi.fn(async () => undefined);
    (vscode.workspace.fs as unknown as { stat: typeof statSpy; delete: typeof deleteSpy }).stat = statSpy;
    (vscode.workspace.fs as unknown as { delete: typeof deleteSpy }).delete = deleteSpy;
    const warningSpy = vi.spyOn(vscode.window, "showWarningMessage").mockResolvedValue("Delete" as never);

    expect(host.handleMessage({ type: "file-tree-delete", rootGeneration: 0, path: "c:\\root" }, vi.fn())).toBe(true);
    await settle();

    expect(statSpy).not.toHaveBeenCalled();
    expect(warningSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    sub.dispose();
  });

  it("surfaces stat and delete failures as user-visible errors", async () => {
    const { host, sub } = attachActionHost();
    const errorSpy = vi.spyOn(vscode.window, "showErrorMessage").mockResolvedValue(undefined);
    (vscode.workspace.fs as unknown as { stat: unknown }).stat = async () => {
      throw new Error("stat failed");
    };

    expect(host.handleMessage({ type: "file-tree-delete", rootGeneration: 0, path: "/workspace/a.ts" }, vi.fn())).toBe(
      true,
    );
    await waitFor(() => errorSpy.mock.calls.length > 0);
    expect(errorSpy).toHaveBeenCalledWith("AnyWhere Terminal could not delete the selected item.");

    errorSpy.mockClear();
    (vscode.workspace.fs as unknown as { stat: unknown; delete: unknown }).stat = async () => ({
      type: vscode.FileType.File,
      ctime: 0,
      mtime: 0,
      size: 1,
    });
    (vscode.workspace.fs as unknown as { delete: unknown }).delete = async () => {
      throw new Error("delete failed");
    };
    vi.spyOn(vscode.window, "showWarningMessage").mockResolvedValue("Delete" as never);

    expect(host.handleMessage({ type: "file-tree-delete", rootGeneration: 0, path: "/workspace/a.ts" }, vi.fn())).toBe(
      true,
    );
    await waitFor(() => errorSpy.mock.calls.length > 0);
    expect(errorSpy).toHaveBeenCalledWith("AnyWhere Terminal could not delete the selected item.");
    sub.dispose();
  });
});

describe("FileTreeHost — git decoration stamping on read-directory", () => {
  // Stand up a real on-disk temp directory so the RPC handler can enumerate
  // it through the production code path (no extra mocking of `fs`).
  let tmp: string;
  let fileA: string;
  let fileB: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "atest-gitstamp-"));
    fileA = path.join(tmp, "a.ts");
    fileB = path.join(tmp, "b.ts");
    fs.writeFileSync(fileA, "");
    fs.writeFileSync(fileB, "");
    // The vscode mock doesn't ship a `workspace.fs.readDirectory`; install one
    // that delegates to node:fs so the production RPC handler enumerates the
    // real tmp dir. FileType bit values: File=1, Directory=2 (matches `vscode.FileType`).
    (vscode.workspace.fs as unknown as { readDirectory: unknown }).readDirectory = async (uri: { fsPath: string }) => {
      const entries = fs.readdirSync(uri.fsPath, { withFileTypes: true });
      return entries.map((e): [string, number] => [e.name, e.isDirectory() ? 2 : 1]);
    };
  });

  afterEach(() => {
    delete (vscode.workspace.fs as unknown as { readDirectory?: unknown }).readDirectory;
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  function makeRpc(): RequestReadDirectoryMessage {
    return {
      type: "request-read-directory",
      requestId: "rq",
      rootGeneration: 0,
      path: tmp,
    };
  }

  function fakeProvider(table: ReadonlyMap<string, GitStatus>, revision = 7): GitDecorationProvider {
    return {
      getStatus: (p: string) => {
        const status = table.get(p);
        return { status, revision };
      },
      currentRevision: () => revision,
      getDescendantBuckets: () => undefined,
      onDidChange: () => ({ dispose: () => {} }),
      reset: () => {},
      dispose: () => {},
    };
  }

  async function runRpc(provider: GitDecorationProvider | null): Promise<ReadDirectoryResponseMessage> {
    const host = new FileTreeHost(provider);
    const posted: ReadDirectoryResponseMessage[] = [];
    host.handleMessage(makeRpc(), (m) => posted.push(m as ReadDirectoryResponseMessage));
    // The handler is async and spawns `git check-ignore`, so the wait has to
    // outlast a process spawn on a loaded machine, not just a tick.
    await waitFor(() => posted.length > 0);
    expect(posted.length).toBe(1);
    return posted[0];
  }

  it("stamps every entry with revision and copies higher-severity status", async () => {
    const provider = fakeProvider(new Map([[fileA, "modified"]]), 7);
    const resp = await runRpc(provider);
    expect(resp.entries).toBeDefined();
    const a = resp.entries!.find((e) => e.path === fileA);
    const b = resp.entries!.find((e) => e.path === fileB);
    expect(a?.gitStatus).toBe<GitStatus>("modified");
    expect(a?.gitRevision).toBe(7);
    expect(b?.gitStatus).toBeUndefined();
    expect(b?.gitRevision).toBe(7);
  });

  it("omits gitStatus/gitRevision when no provider is wired", async () => {
    const resp = await runRpc(null);
    expect(resp.entries).toBeDefined();
    for (const e of resp.entries!) {
      expect(e.gitStatus).toBeUndefined();
      expect(e.gitRevision).toBeUndefined();
    }
  });

  it("revision increases across two reads with an intervening provider state change", async () => {
    let currentRev = 3;
    let currentTable = new Map<string, GitStatus>([[fileA, "modified"]]);
    const provider: GitDecorationProvider = {
      getStatus: (p) => ({ status: currentTable.get(p), revision: currentRev }),
      currentRevision: () => currentRev,
      getDescendantBuckets: () => undefined,
      onDidChange: () => ({ dispose: () => {} }),
      reset: () => {},
      dispose: () => {},
    };
    const first = await runRpc(provider);
    expect(first.entries!.find((e) => e.path === fileA)?.gitRevision).toBe(3);
    currentRev = 9;
    currentTable = new Map([[fileA, "added"]]);
    const second = await runRpc(provider);
    expect(second.entries!.find((e) => e.path === fileA)?.gitRevision).toBe(9);
    expect(second.entries!.find((e) => e.path === fileA)?.gitStatus).toBe<GitStatus>("added");
  });
});

describe("FileTreeHost.attach — git delta forwarding", () => {
  it("forwards provider deltas as git-status-changed messages with current rootGeneration", () => {
    let onDelta:
      | ((d: { revision: number; changes: ReadonlyArray<{ path: string; status: GitStatus | null }> }) => void)
      | null = null;
    const provider: GitDecorationProvider = {
      getStatus: () => ({ status: undefined, revision: 0 }),
      currentRevision: () => 0,
      getDescendantBuckets: () => undefined,
      onDidChange: (listener) => {
        onDelta = listener;
        return { dispose: () => {} };
      },
      reset: () => {},
      dispose: () => {},
    };
    const host = new FileTreeHost(provider);
    const posted: Array<{ type: string; rootGeneration?: number; revision?: number }> = [];
    const sub = host.attach({
      isReady: () => true,
      post: (m) => posted.push(m as { type: string; rootGeneration?: number; revision?: number }),
    });
    expect(onDelta).not.toBeNull();

    // Bump generation to 1 so we know the host stamps the current value, not 0.
    host.rootGeneration = 1;
    onDelta!({ revision: 42, changes: [{ path: "/x", status: "modified" }] });

    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe("git-status-changed");
    expect(posted[0].rootGeneration).toBe(1);
    expect(posted[0].revision).toBe(42);

    sub.dispose();
  });

  it("does NOT post deltas when the webview is not ready yet", () => {
    let onDelta:
      | ((d: { revision: number; changes: ReadonlyArray<{ path: string; status: GitStatus | null }> }) => void)
      | null = null;
    const provider: GitDecorationProvider = {
      getStatus: () => ({ status: undefined, revision: 0 }),
      currentRevision: () => 0,
      getDescendantBuckets: () => undefined,
      onDidChange: (listener) => {
        onDelta = listener;
        return { dispose: () => {} };
      },
      reset: () => {},
      dispose: () => {},
    };
    const host = new FileTreeHost(provider);
    const posted: unknown[] = [];
    let ready = false;
    const sub = host.attach({
      isReady: () => ready,
      post: (m) => posted.push(m),
    });
    onDelta!({ revision: 1, changes: [{ path: "/x", status: "modified" }] });
    expect(posted).toHaveLength(0);

    ready = true;
    onDelta!({ revision: 2, changes: [{ path: "/x", status: "added" }] });
    expect(posted).toHaveLength(1);

    sub.dispose();
  });

  it("forwards pool's onDidRequestRehydrate as fs-rehydrate with current rootGeneration (only when ready)", () => {
    let onRehydrate: (() => void) | null = null;
    const pool: WatcherPool = {
      subscribe: () => ({ dispose: () => {} }),
      subscribePattern: () => ({ active: true, dispose: () => {} }),
      onDidRequestRehydrate: (listener) => {
        onRehydrate = listener;
        return { dispose: () => {} };
      },
      dispose: () => {},
    };
    const host = new FileTreeHost(null, pool);
    const posted: Array<{ type: string; rootGeneration?: number }> = [];
    let ready = false;
    const sub = host.attach({
      isReady: () => ready,
      post: (m) => posted.push(m as { type: string; rootGeneration?: number }),
    });
    expect(onRehydrate).not.toBeNull();

    // Not ready yet — drop.
    onRehydrate!();
    expect(posted).toHaveLength(0);

    ready = true;
    host.rootGeneration = 5;
    onRehydrate!();
    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe("fs-rehydrate");
    expect(posted[0].rootGeneration).toBe(5);

    sub.dispose();
  });

  it("bumps rootGeneration on workspace folder change WITHOUT calling provider.reset() (O-W3)", () => {
    // The provider now owns its own workspace-folder reset (subscribes once
    // inside `createGitDecorationProvider`). FileTreeHost must NOT call
    // `provider.reset()` — otherwise the reset fan-out scales with the host
    // count again.
    const resetSpy = vi.fn();
    const provider: GitDecorationProvider = {
      getStatus: () => ({ status: undefined, revision: 0 }),
      currentRevision: () => 0,
      getDescendantBuckets: () => undefined,
      onDidChange: () => ({ dispose: () => {} }),
      reset: resetSpy,
      dispose: () => {},
    };

    let folderHandler: (() => void) | null = null;
    const original = vscode.workspace.onDidChangeWorkspaceFolders;
    (vscode.workspace as { onDidChangeWorkspaceFolders: unknown }).onDidChangeWorkspaceFolders = ((h: () => void) => {
      folderHandler = h;
      return { dispose: () => {} };
    }) as unknown;

    try {
      const host = new FileTreeHost(provider);
      const sub = host.attach({ isReady: () => true, post: () => {} });
      const beforeGen = host.rootGeneration;
      folderHandler!();
      expect(resetSpy).not.toHaveBeenCalled();
      expect(host.rootGeneration).toBe(beforeGen + 1);
      sub.dispose();
    } finally {
      (vscode.workspace as { onDidChangeWorkspaceFolders: unknown }).onDidChangeWorkspaceFolders = original;
    }
  });
});

describe("FileTreeHost — FS subscribe/unsubscribe/rehydrate dispatch", () => {
  function makeFakePool(): {
    pool: WatcherPool;
    subscribeCalls: Array<{ path: string; cb: () => void; dispose: ReturnType<typeof vi.fn> }>;
    fireRehydrate: () => void;
  } {
    const subscribeCalls: Array<{ path: string; cb: () => void; dispose: ReturnType<typeof vi.fn> }> = [];
    let rehydrateListener: (() => void) | null = null;
    const pool: WatcherPool = {
      subscribe: (path: string, cb: () => void) => {
        const dispose = vi.fn();
        subscribeCalls.push({ path, cb, dispose });
        return { dispose };
      },
      subscribePattern: () => ({ active: true, dispose: vi.fn() }),
      onDidRequestRehydrate: (l) => {
        rehydrateListener = l;
        return { dispose: () => {} };
      },
      dispose: () => {},
    };
    return {
      pool,
      subscribeCalls,
      fireRehydrate: () => rehydrateListener?.(),
    };
  }

  function attachHost(host: FileTreeHost): {
    posted: Array<{ type: string; rootGeneration?: number; parent?: string }>;
    sub: vscode.Disposable;
  } {
    const posted: Array<{ type: string; rootGeneration?: number; parent?: string }> = [];
    const sub = host.attach({
      isReady: () => true,
      post: (m) => posted.push(m as { type: string; rootGeneration?: number; parent?: string }),
    });
    return { posted, sub };
  }

  it("(a) request-subscribe-fs-changes calls pool.subscribe once; firing the callback posts fs-changes-invalidated", () => {
    const { pool, subscribeCalls } = makeFakePool();
    const host = new FileTreeHost(null, pool);
    const { posted, sub } = attachHost(host);

    host.handleMessage({ type: "request-subscribe-fs-changes", rootGeneration: 0, path: "/foo" }, () => {});
    expect(subscribeCalls.length).toBe(1);
    expect(subscribeCalls[0].path).toBe("/foo");

    // Invoke the captured callback — the host should post the invalidate.
    subscribeCalls[0].cb();
    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe("fs-changes-invalidated");
    expect(posted[0].parent).toBe("/foo");
    expect(posted[0].rootGeneration).toBe(0);

    sub.dispose();
  });

  it("(b) idempotent — second subscribe to the same path is a no-op", () => {
    const { pool, subscribeCalls } = makeFakePool();
    const host = new FileTreeHost(null, pool);
    const { sub } = attachHost(host);

    host.handleMessage({ type: "request-subscribe-fs-changes", rootGeneration: 0, path: "/foo" }, () => {});
    host.handleMessage({ type: "request-subscribe-fs-changes", rootGeneration: 0, path: "/foo" }, () => {});
    expect(subscribeCalls.length).toBe(1);

    sub.dispose();
  });

  it("(c) stale rootGeneration: subscribe dropped, no pool.subscribe call, no post", () => {
    const { pool, subscribeCalls } = makeFakePool();
    const host = new FileTreeHost(null, pool);
    const { posted, sub } = attachHost(host);
    host.rootGeneration = 7;

    host.handleMessage({ type: "request-subscribe-fs-changes", rootGeneration: 6, path: "/foo" }, () => {});
    expect(subscribeCalls.length).toBe(0);
    expect(posted).toHaveLength(0);

    sub.dispose();
  });

  it("(d) request-unsubscribe-fs-changes disposes each matching map entry; ignores unknown", () => {
    const { pool, subscribeCalls } = makeFakePool();
    const host = new FileTreeHost(null, pool);
    const { sub } = attachHost(host);

    host.handleMessage({ type: "request-subscribe-fs-changes", rootGeneration: 0, path: "/a" }, () => {});
    host.handleMessage({ type: "request-subscribe-fs-changes", rootGeneration: 0, path: "/b" }, () => {});
    expect(subscribeCalls.length).toBe(2);

    host.handleMessage(
      { type: "request-unsubscribe-fs-changes", rootGeneration: 0, paths: ["/a", "/missing"] },
      () => {},
    );
    expect(subscribeCalls[0].dispose).toHaveBeenCalledTimes(1);
    expect(subscribeCalls[1].dispose).not.toHaveBeenCalled();

    // Re-subscribe after unsubscribe creates a NEW pool subscription
    // (idempotency check applies only to active entries).
    host.handleMessage({ type: "request-subscribe-fs-changes", rootGeneration: 0, path: "/a" }, () => {});
    expect(subscribeCalls.length).toBe(3);

    sub.dispose();
  });

  it("(d2) request-unsubscribe-fs-changes bypasses rootGeneration gate (review W1)", () => {
    // After a rapid root rotation A→B→C, the webview posts the bulk
    // unsubscribe for B under generation B, but the host is already at
    // generation C. The unsubscribe MUST still dispose the matching map
    // entry — otherwise the host leaks the subscription forever.
    const { pool, subscribeCalls } = makeFakePool();
    const host = new FileTreeHost(null, pool);
    const { sub } = attachHost(host);

    host.handleMessage({ type: "request-subscribe-fs-changes", rootGeneration: 0, path: "/a" }, () => {});
    expect(subscribeCalls.length).toBe(1);

    // Rotate the host's generation past the message's tag.
    host.rootGeneration = 5;
    host.handleMessage({ type: "request-unsubscribe-fs-changes", rootGeneration: 2, paths: ["/a"] }, () => {});
    expect(subscribeCalls[0].dispose).toHaveBeenCalledTimes(1);

    sub.dispose();
  });

  it("(e) callback closes over LIVE rootGeneration — bump between subscribe and event fire is reflected", () => {
    const { pool, subscribeCalls } = makeFakePool();
    const host = new FileTreeHost(null, pool);
    const { posted, sub } = attachHost(host);

    host.handleMessage({ type: "request-subscribe-fs-changes", rootGeneration: 0, path: "/foo" }, () => {});
    host.rootGeneration = 9;
    subscribeCalls[0].cb();

    expect(posted).toHaveLength(1);
    expect(posted[0].rootGeneration).toBe(9);

    sub.dispose();
  });

  it("(f) rehydrate posts fs-rehydrate only when isReady() is true", () => {
    const { pool, fireRehydrate } = makeFakePool();
    const host = new FileTreeHost(null, pool);
    const posted: Array<{ type: string }> = [];
    let ready = false;
    const sub = host.attach({
      isReady: () => ready,
      post: (m) => posted.push(m as { type: string }),
    });

    fireRehydrate();
    expect(posted).toHaveLength(0);

    ready = true;
    fireRehydrate();
    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe("fs-rehydrate");

    sub.dispose();
  });

  it("(g) attach() cleanup Disposable disposes every subscription + the rehydrate sub", () => {
    const { pool, subscribeCalls } = makeFakePool();
    const host = new FileTreeHost(null, pool);
    const { sub } = attachHost(host);

    host.handleMessage({ type: "request-subscribe-fs-changes", rootGeneration: 0, path: "/a" }, () => {});
    host.handleMessage({ type: "request-subscribe-fs-changes", rootGeneration: 0, path: "/b" }, () => {});

    sub.dispose();
    expect(subscribeCalls[0].dispose).toHaveBeenCalledTimes(1);
    expect(subscribeCalls[1].dispose).toHaveBeenCalledTimes(1);

    // After cleanup, the per-host map is empty — re-attach can re-subscribe.
    const { sub: sub2 } = attachHost(host);
    host.handleMessage({ type: "request-subscribe-fs-changes", rootGeneration: 0, path: "/a" }, () => {});
    expect(subscribeCalls.length).toBe(3);
    sub2.dispose();
  });

  it("(h) when watcherPool is null, subscribe/unsubscribe messages are silently ignored", () => {
    const host = new FileTreeHost(null, null);
    const posted: unknown[] = [];
    const sub = host.attach({ isReady: () => true, post: (m) => posted.push(m) });

    const subResult = host.handleMessage(
      { type: "request-subscribe-fs-changes", rootGeneration: 0, path: "/foo" },
      () => {},
    );
    const unsubResult = host.handleMessage(
      { type: "request-unsubscribe-fs-changes", rootGeneration: 0, paths: ["/foo"] },
      () => {},
    );
    expect(subResult).toBe(true);
    expect(unsubResult).toBe(true);
    expect(posted).toHaveLength(0);

    sub.dispose();
  });
});

describe("FileTreeHost — the resolved workspace root (round-1 B1)", () => {
  function memoOver(links: Record<string, string>) {
    return new ResolvedPathMemo({
      realpath: async (p) => {
        const hit = links[p];
        if (hit === undefined) {
          throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
        }
        return hit;
      },
    });
  }

  it("carries the root's spelling AND where it resolves, as two fields", async () => {
    // They answer different questions: one mounts the tree and is shown to the
    // user, the other decides containment. Collapsing them would show the user
    // a physical path they never typed.
    vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue([{ uri: { fsPath: "/link/repo" } }] as never);
    const host = new FileTreeHost(null, null, createTrackedPathResolver(memoOver({ "/link/repo": "/private/repo" })));
    await waitFor(() => host.initPayload().resolvedWorkspaceRoot === "/private/repo");

    expect(host.initPayload()).toMatchObject({
      workspaceRoot: "/link/repo",
      resolvedWorkspaceRoot: "/private/repo",
    });
  });

  it("answers with the spelling itself before resolution lands, and when it fails", async () => {
    vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue([{ uri: { fsPath: "/link/gone" } }] as never);
    const host = new FileTreeHost(null, null, createTrackedPathResolver(memoOver({})));

    expect(host.initPayload().resolvedWorkspaceRoot).toBe("/link/gone");
    await settle();
    expect(host.initPayload().resolvedWorkspaceRoot).toBe("/link/gone");
  });

  it("behaves exactly as before when no resolver is supplied", () => {
    vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue([{ uri: { fsPath: "/link/repo" } }] as never);
    const host = new FileTreeHost();

    expect(host.initPayload()).toMatchObject({
      workspaceRoot: "/link/repo",
      resolvedWorkspaceRoot: "/link/repo",
    });
  });

  it("re-posts the root once resolution lands, so the webview is not left lexical", async () => {
    // Without the re-post the webview holds the spelling for the window's life:
    // `initPayload` is read once, and nothing else would ever correct it.
    vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue([{ uri: { fsPath: "/link/repo" } }] as never);
    const posted: Array<{ type: string; resolvedRootPath?: string | null }> = [];
    const host = new FileTreeHost(null, null, createTrackedPathResolver(memoOver({ "/link/repo": "/private/repo" })));
    // Attached synchronously, before the constructor's realpath can land — so
    // the post under test is the one that fires when resolution completes.
    const sub = host.attach({ isReady: () => true, post: (m) => posted.push(m as never) });

    await waitFor(() => posted.some((m) => m.resolvedRootPath === "/private/repo"));

    expect(posted.some((m) => m.type === "workspace-root-changed" && m.resolvedRootPath === "/private/repo")).toBe(
      true,
    );
    sub.dispose();
  });
});
