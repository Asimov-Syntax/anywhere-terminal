// src/providers/resolvedRootWiring.test.ts — every surface that mounts a file
// tree tells its webview where the workspace root RESOLVES, not only how it is
// spelled.
//
// The wiring is what is under test, not the host. Round-1 shipped the resolved
// root through `FileTreeHost` and every production construction still passed
// two arguments, so the third took its `null` default and all four surfaces
// went on comparing containment against the mounted spelling. The tests that
// round wrote injected a host directly — the one shape that cannot see a
// missing argument (round-2 B1).
//
// Four construction paths, because they are genuinely four: the sidebar and the
// bottom panel go through `TerminalViewProvider`, a new editor through
// `TerminalEditorProvider.createPanel`, and a revived one through
// `TerminalPanelSerializer` → `revive`, which never touches `createPanel`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAll, __setAppRoot, __setWorkspaceFolders } from "../test/__mocks__/vscode";

vi.mock("../pty/PtyManager", () => ({
  loadNodePty: vi.fn(() => ({ spawn: vi.fn() })),
  detectShell: vi.fn(() => ({ shell: "/bin/zsh", args: [] })),
  buildEnvironment: vi.fn(() => ({})),
  resolveWorkingDirectory: vi.fn(() => "/tmp"),
}));
vi.mock("../pty/PtySession", () => ({ PtySession: class {} }));
vi.mock("../session/OutputBuffer", () => ({ OutputBuffer: class {} }));

import * as vscode from "vscode";
import { SessionManager } from "../session/SessionManager";
import { ResolvedPathMemo } from "../utils/resolvedPathMemo";
import { TerminalEditorProvider } from "./TerminalEditorProvider";
import { TerminalPanelSerializer } from "./TerminalPanelSerializer";
import { TerminalViewProvider } from "./TerminalViewProvider";

const SPELLED = "/repo";
const PHYSICAL = "/private/repo";

beforeEach(() => {
  __resetAll();
  __setAppRoot("/mock/vscode/app");
  __setWorkspaceFolders([{ uri: { fsPath: SPELLED } }]);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface Surface {
  posted: unknown[];
  boot: () => void;
  /** Drive the panel's own teardown, where a permanent close is observed. */
  close?: () => void;
  dispose: () => void;
}

function memo(): ResolvedPathMemo {
  return new ResolvedPathMemo({
    realpath: async (p) => (p === SPELLED ? PHYSICAL : p),
  });
}

function makeWebviewSeam() {
  const handlers: Array<(msg: unknown) => void> = [];
  const posted: unknown[] = [];
  const webview = {
    html: "",
    options: {},
    cspSource: "https://mock.csp.source",
    asWebviewUri: (uri: { fsPath: string }) => uri.fsPath,
    onDidReceiveMessage: (h: (msg: unknown) => void) => {
      handlers.push(h);
      return { dispose: () => {} };
    },
    postMessage: vi.fn((msg: unknown) => {
      posted.push(msg);
      return Promise.resolve(true);
    }),
  };
  // The host only speaks once the webview says it has booted, so a surface that
  // never sends this posts nothing and the assertion would pass on silence.
  const boot = () => {
    for (const h of handlers) {
      h({ type: "ready" });
    }
  };
  return { webview, posted, boot };
}

function mockContext(): vscode.ExtensionContext {
  return { extensionUri: { fsPath: "/mock/extension" }, subscriptions: [] } as unknown as vscode.ExtensionContext;
}

function makePanelSeam() {
  const { webview, posted, boot } = makeWebviewSeam();
  const closers: Array<() => void> = [];
  const panel = {
    visible: true,
    active: true,
    viewColumn: 1,
    title: "Terminal",
    webview,
    onDidDispose: (h: () => void) => {
      closers.push(h);
      return { dispose: () => {} };
    },
    onDidChangeViewState: () => ({ dispose: () => {} }),
    reveal: vi.fn(),
    dispose: vi.fn(),
  } as unknown as vscode.WebviewPanel;
  const close = () => {
    for (const h of closers) {
      h();
    }
  };
  return { panel, posted, boot, close };
}

function mountView(m: ResolvedPathMemo, location: "sidebar" | "panel"): Surface {
  const sessions = new SessionManager();
  const provider = new TerminalViewProvider(
    { fsPath: "/mock/extension" } as vscode.Uri,
    sessions,
    location,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    m,
  );
  const { webview, posted, boot } = makeWebviewSeam();
  const webviewView = {
    visible: true,
    viewType: `anywhereTerminal.${location}`,
    webview,
    onDidChangeVisibility: () => ({ dispose: () => {} }),
    onDidDispose: () => ({ dispose: () => {} }),
  } as unknown as vscode.WebviewView;

  provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
  return { posted, boot, dispose: () => sessions.dispose() };
}

function mountEditor(m: ResolvedPathMemo): Surface {
  const sessions = new SessionManager();
  const { panel, posted, boot, close } = makePanelSeam();
  vi.spyOn(vscode.window, "createWebviewPanel").mockReturnValue(panel);
  TerminalEditorProvider.createPanel(mockContext(), sessions, null, null, null, null, null, m);
  return { posted, boot, close, dispose: () => sessions.dispose() };
}

async function mountRevivedEditor(m: ResolvedPathMemo): Promise<Surface> {
  const sessions = new SessionManager();
  const { panel, posted, boot, close } = makePanelSeam();
  const serializer = new TerminalPanelSerializer(mockContext(), sessions, null, null, null, null, null, m);
  await serializer.deserializeWebviewPanel(panel, { panelId: "panel-1" });
  return { posted, boot, close, dispose: () => sessions.dispose() };
}

/** Every resolved root this surface has told its webview about — the init
 *  payload and the correction the host posts once `realpath` lands. */
function resolvedRoots(posted: readonly unknown[]): unknown[] {
  return posted
    .map((msg) => {
      const m = msg as { type?: string; resolvedWorkspaceRoot?: unknown; resolvedRootPath?: unknown };
      if (m.type === "init") {
        return m.resolvedWorkspaceRoot;
      }
      return m.type === "workspace-root-changed" ? m.resolvedRootPath : undefined;
    })
    .filter((root) => root !== undefined);
}

describe("every file-tree surface reports where its root resolves", () => {
  const cases: Array<[string, (m: ResolvedPathMemo) => Surface | Promise<Surface>]> = [
    ["sidebar", (m) => mountView(m, "sidebar")],
    ["bottom panel", (m) => mountView(m, "panel")],
    ["editor panel", (m) => mountEditor(m)],
    ["revived editor panel", (m) => mountRevivedEditor(m)],
  ];

  for (const [name, mount] of cases) {
    it(`resolves the root for the ${name}`, async () => {
      const m = memo();
      const surface = await mount(m);
      // The constructor's realpath is in the air at this point; the surface
      // reports the spelling first and corrects itself when it lands.
      await vi.waitFor(() => expect(m.resolvedOr(SPELLED)).toBe(PHYSICAL));
      surface.boot();

      await vi.waitFor(() => expect(resolvedRoots(surface.posted)).toContain(PHYSICAL));
      surface.dispose();
    });
  }

  it("releases the root it claimed when the editor panel closes", async () => {
    // Round-3 B7, at the seam that hides it. Editor panels open and close
    // without bound, and the release lives in the panel's own teardown — a host
    // unit test cannot see whether anything calls it, which is how the round-1
    // wiring gap happened in the first place.
    const m = memo();
    const surface = await mountEditor(m);
    await vi.waitFor(() => expect(m.size).toBe(1));

    surface.close?.();

    expect(m.size).toBe(0);
    surface.dispose();
  });
});
