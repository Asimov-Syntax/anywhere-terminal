// src/providers/paneEvidenceRouting.test.ts — every surface routes `paneEvidence`
// to the window's store, including an editor panel VS Code revived.
//
// The routing is what is under test, not the store. A store unit test proves the
// validation and nothing about whether any surface calls it — and the revived
// editor is a distinct construction path (`TerminalPanelSerializer` →
// `TerminalEditorProvider.revive`) that never touches `createPanel`, so a store
// threaded only through the direct path fails silently there.
//
// See: asimov/changes/add-host-pane-evidence/design.md D1, D8.

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
import { createPaneEvidenceStore, type PaneEvidenceStore } from "../session/PaneEvidenceStore";
import { SessionManager } from "../session/SessionManager";
import type { PaneEvidenceMessage } from "../types/messages";
import { TerminalEditorProvider } from "./TerminalEditorProvider";
import { TerminalPanelSerializer } from "./TerminalPanelSerializer";
import { TerminalViewProvider } from "./TerminalViewProvider";

beforeEach(() => {
  __resetAll();
  __setAppRoot("/mock/vscode/app");
  __setWorkspaceFolders([{ uri: { fsPath: "/repo" } }]);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Surfaces ───────────────────────────────────────────────────────

interface Surface {
  send: (msg: unknown) => void;
  dispose: () => void;
}

function makeWebviewSeam() {
  const handlers: Array<(msg: unknown) => void> = [];
  const webview = {
    html: "",
    options: {},
    cspSource: "https://mock.csp.source",
    asWebviewUri: (uri: { fsPath: string }) => uri.fsPath,
    onDidReceiveMessage: (h: (msg: unknown) => void) => {
      handlers.push(h);
      return { dispose: () => {} };
    },
    postMessage: vi.fn(() => Promise.resolve(true)),
  };
  const send = (msg: unknown) => {
    for (const h of handlers) {
      h(msg);
    }
  };
  return { webview, send };
}

/** Sidebar or bottom panel. */
function mountView(store: PaneEvidenceStore, location: "sidebar" | "panel"): Surface {
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
    store,
  );
  const { webview, send } = makeWebviewSeam();
  const webviewView = {
    visible: true,
    viewType: `anywhereTerminal.${location}`,
    webview,
    onDidChangeVisibility: () => ({ dispose: () => {} }),
    onDidDispose: () => ({ dispose: () => {} }),
  } as unknown as vscode.WebviewView;

  provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
  return { send, dispose: () => sessions.dispose() };
}

function makePanelSeam() {
  const { webview, send } = makeWebviewSeam();
  const panel = {
    visible: true,
    active: true,
    viewColumn: 1,
    title: "Terminal",
    webview,
    onDidDispose: () => ({ dispose: () => {} }),
    onDidChangeViewState: () => ({ dispose: () => {} }),
    reveal: vi.fn(),
    dispose: vi.fn(),
  } as unknown as vscode.WebviewPanel;
  return { panel, send };
}

function mockContext(): vscode.ExtensionContext {
  return { extensionUri: { fsPath: "/mock/extension" }, subscriptions: [] } as unknown as vscode.ExtensionContext;
}

/** An editor panel VS Code created directly. */
function mountEditor(store: PaneEvidenceStore): Surface {
  const sessions = new SessionManager();
  const { panel, send } = makePanelSeam();
  vi.spyOn(vscode.window, "createWebviewPanel").mockReturnValue(panel);
  TerminalEditorProvider.createPanel(mockContext(), sessions, null, null, null, store);
  return { send, dispose: () => sessions.dispose() };
}

/** An editor panel VS Code revived after a window reload. */
async function mountRevivedEditor(store: PaneEvidenceStore): Promise<Surface> {
  const sessions = new SessionManager();
  const { panel, send } = makePanelSeam();
  const serializer = new TerminalPanelSerializer(mockContext(), sessions, null, null, null, store);
  await serializer.deserializeWebviewPanel(panel, { panelId: "panel-1" });
  return { send, dispose: () => sessions.dispose() };
}

// ─── Tests ──────────────────────────────────────────────────────────

const REPORT: PaneEvidenceMessage = {
  type: "paneEvidence",
  paneId: "pane-1",
  title: "Fix tests",
  decorated: false,
};

describe("every surface routes pane evidence to the window store", () => {
  const cases: Array<[string, (store: PaneEvidenceStore) => Surface | Promise<Surface>]> = [
    ["sidebar", (store) => mountView(store, "sidebar")],
    ["bottom panel", (store) => mountView(store, "panel")],
    ["editor panel", (store) => mountEditor(store)],
    ["revived editor panel", (store) => mountRevivedEditor(store)],
  ];

  for (const [name, mount] of cases) {
    it(`routes a report from the ${name}`, async () => {
      const store = createPaneEvidenceStore();
      store.create("pane-1");
      const surface = await mount(store);

      surface.send(REPORT);

      expect(store.read("pane-1")?.title).toBe("Fix tests");
      surface.dispose();
    });
  }
});

describe("the store, not the provider, judges a report", () => {
  it("drops a malformed payload without touching held evidence", async () => {
    const store = createPaneEvidenceStore();
    store.create("pane-1");
    store.report(REPORT);
    const surface = mountView(store, "sidebar");

    surface.send({ type: "paneEvidence", paneId: "pane-1", decorated: true });
    surface.send({ type: "paneEvidence", paneId: "pane-1", waiting: "yes" });
    surface.send({ type: "paneEvidence", paneId: "pane-1" });

    expect(store.read("pane-1")?.title).toBe("Fix tests");
    expect(store.read("pane-1")?.waiting).toBeUndefined();
    surface.dispose();
  });

  it("does not let a report create a pane the host never opened", () => {
    const store = createPaneEvidenceStore();
    const surface = mountView(store, "sidebar");

    surface.send({ ...REPORT, paneId: "ghost" });

    expect(store.read("ghost")).toBeUndefined();
    surface.dispose();
  });
});

describe("reporting is independent of the worktree view", () => {
  it("routes a report from a surface that never declared the worktree view visible", () => {
    const store = createPaneEvidenceStore();
    store.create("pane-1");
    // No `worktreeViewVisibility` is ever sent: presence is window state, so a
    // surface showing the sessions body still owns the only view of its panes.
    const surface = mountView(store, "sidebar");

    surface.send(REPORT);

    expect(store.read("pane-1")?.title).toBe("Fix tests");
    surface.dispose();
  });
});
