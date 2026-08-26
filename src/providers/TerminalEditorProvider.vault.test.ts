// The two vault READS an editor surface needs, and only those. The worktree
// panel offers "Open Session Preview" on every surface, but the overlay it opens
// is fed by these replies — without them an editor surface silently refused every
// host-approved preview (round-1 B1).

import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { SessionManager } from "../session/SessionManager";
import * as vscodeApi from "../test/__mocks__/vscode";
import { __resetAll } from "../test/__mocks__/vscode";
import type { VaultListResult, VaultSessionDetail } from "../vault/types";
import type { VaultService } from "../vault/VaultService";
import { TerminalEditorProvider } from "./TerminalEditorProvider";

beforeEach(() => {
  __resetAll();
  vi.restoreAllMocks();
});

function listResult(...ids: string[]): VaultListResult {
  return {
    entries: ids.map((id) => ({ id, agent: "claude", sessionId: id, title: id, cwd: "/repo" })),
    unreadable: { count: 0, reasons: [] },
  } as unknown as VaultListResult;
}

function panelSeam(): { panel: vscode.WebviewPanel; handlers: Array<(msg: unknown) => void> } {
  const handlers: Array<(msg: unknown) => void> = [];
  const panel = {
    visible: true,
    active: true,
    viewColumn: 1,
    title: "Terminal",
    webview: {
      html: "",
      options: {},
      cspSource: "https://mock.csp.source",
      asWebviewUri: (uri: { fsPath: string }) => uri.fsPath,
      onDidReceiveMessage: (h: (msg: unknown) => void) => {
        handlers.push(h);
        return { dispose: () => {} };
      },
      postMessage: vi.fn(() => Promise.resolve(true)),
    },
    onDidDispose: () => ({ dispose: () => {} }),
    onDidChangeViewState: () => ({ dispose: () => {} }),
    reveal: vi.fn(),
    dispose: vi.fn(),
  } as unknown as vscode.WebviewPanel;
  return { panel, handlers };
}

function mount(vault: Partial<VaultService> | null, seam = panelSeam()) {
  const sessions = new SessionManager();
  const { panel, handlers } = seam;
  vi.spyOn(vscodeApi.window, "createWebviewPanel").mockReturnValue(panel as never);
  TerminalEditorProvider.createPanel(
    { extensionUri: { fsPath: "/mock/extension" }, subscriptions: [] } as unknown as vscode.ExtensionContext,
    sessions,
    null,
    null,
    null,
    null,
    vault as VaultService | null,
  );
  return {
    send: (msg: unknown) => {
      for (const h of handlers) {
        h(msg);
      }
    },
    postTypes: () =>
      (panel.webview.postMessage as ReturnType<typeof vi.fn>).mock.calls.map(
        ([m]) => (m as { type?: string }).type ?? "",
      ),
    posts: (type: string) =>
      (panel.webview.postMessage as ReturnType<typeof vi.fn>).mock.calls
        .map(([m]) => m as Record<string, unknown>)
        .filter((m) => m.type === type),
    dispose: () => sessions.dispose(),
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("an editor surface answers the vault reads a preview needs", () => {
  it("serves the cache first, then the authoritative list", async () => {
    // The cached post paints the panel immediately; the refresh is the truth.
    const view = mount({
      listCached: () => listResult("claude:cached"),
      refresh: async () => listResult("claude:fresh"),
    });
    view.send({ type: "requestVaultSessions" });
    await settle();

    expect(view.posts("vaultSessionsResponse").map((m) => m.fromCache)).toEqual([true, false]);
    view.dispose();
  });

  it("drops a refresh a newer request already superseded", async () => {
    // Two lists racing would otherwise let the older one win the panel.
    let resolveFirst: ((r: VaultListResult) => void) | undefined;
    const view = mount({
      listCached: () => null,
      refresh: vi
        .fn()
        .mockImplementationOnce(() => new Promise<VaultListResult>((r) => (resolveFirst = r)))
        .mockImplementationOnce(async () => listResult("claude:second")),
    });
    view.send({ type: "requestVaultSessions" });
    view.send({ type: "requestVaultSessions" });
    await settle();
    resolveFirst?.(listResult("claude:first"));
    await settle();

    const served = view.posts("vaultSessionsResponse");
    expect(served).toHaveLength(1);
    expect((served[0]?.result as VaultListResult | undefined)?.entries[0]?.id).toBe("claude:second");
    view.dispose();
  });

  it("abandons a stale list even when a newer request lands during its retry sleep", async () => {
    // The first delivery FAILS, so a 50ms retry is queued; a newer request lands
    // in that window. Dropping the supersession check only after the refresh is
    // not enough — the older list is already past it, and its retry would repaint
    // the panel with a list two requests old.
    const seam = panelSeam();
    const post = seam.panel.webview.postMessage as ReturnType<typeof vi.fn>;
    post.mockImplementation(() => Promise.resolve(false));
    const view = mount(
      {
        listCached: () => null,
        refresh: vi
          .fn()
          .mockImplementationOnce(async () => listResult("claude:first"))
          .mockImplementation(async () => listResult("claude:second")),
      },
      seam,
    );
    view.send({ type: "requestVaultSessions" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    view.send({ type: "requestVaultSessions" });
    await new Promise((resolve) => setTimeout(resolve, 300));

    const firstAttempts = view
      .posts("vaultSessionsResponse")
      .filter((m) => (m.result as VaultListResult).entries[0]?.id === "claude:first");
    expect(firstAttempts).toHaveLength(1);
    view.dispose();
  });

  it("answers the overlay's detail read, echoing the request token", async () => {
    const view = mount({
      listCached: () => null,
      refresh: async () => listResult(),
      getDetail: async () => ({ entryId: "claude:s1", timeline: [] }) as unknown as VaultSessionDetail,
    });
    view.send({ type: "requestVaultSessionDetail", entryId: "claude:s1", requestId: "r1" });
    await settle();

    expect(view.posts("vaultSessionDetailResponse")[0]).toMatchObject({ entryId: "claude:s1", requestId: "r1" });
    view.dispose();
  });

  it("says a session could not be read rather than inventing why", async () => {
    // Not-in-the-store and could-not-be-read are indistinguishable here, so the
    // reply must not assert either one.
    const view = mount({ listCached: () => null, refresh: async () => listResult(), getDetail: async () => null });
    view.send({ type: "requestVaultSessionDetail", entryId: "claude:gone" });
    await settle();

    expect(view.posts("vaultSessionDetailResponse")[0]?.error).toBe("Session not found or could not be read.");
    view.dispose();
  });

  it("reports a read that threw instead of dropping the request", async () => {
    const view = mount({
      listCached: () => null,
      refresh: async () => listResult(),
      getDetail: async () => {
        throw new Error("EACCES");
      },
    });
    view.send({ type: "requestVaultSessionDetail", entryId: "claude:s1" });
    await settle();

    expect(view.posts("vaultSessionDetailResponse")[0]?.error).toBe("EACCES");
    view.dispose();
  });

  it("declares that it cannot perform vault actions, so no control offers one", async () => {
    // The list this surface now serves is what makes vault rows reachable here.
    // Declaring the truth is what keeps their inert controls off the screen
    // rather than present and silently doing nothing (round-2 B4).
    vi.spyOn(SessionManager.prototype, "getAllSessionsForView").mockReturnValue([{ id: "t1" }] as never);
    const view = mount({ listCached: () => null, refresh: async () => listResult() });
    view.send({ type: "ready" });
    await settle();

    const init = view.posts("init")[0];
    expect(init?.vaultActionsAvailable).toBe(false);
    view.dispose();
  });

  it("answers nothing, and does not throw, on a surface with no vault wired", async () => {
    const view = mount(null);
    view.send({ type: "requestVaultSessions" });
    view.send({ type: "requestVaultSessionDetail", entryId: "claude:s1" });
    await settle();

    expect(view.posts("vaultSessionsResponse")).toEqual([]);
    expect(view.posts("vaultSessionDetailResponse")).toEqual([]);
    view.dispose();
  });
});

describe("a cold-created editor surface orders activation after init", () => {
  it("does not let the activation post overtake a retried init", async () => {
    // 7_3 fixed the ordering in BOTH providers but pinned it in only one. This
    // provider has its own message loop, its own retry helper, and its own
    // construction path, so the view provider's case constrains none of it — an
    // editor-only refactor could reintroduce W2 with every sidebar and panel test
    // still green (round-3 W3).
    vi.spyOn(SessionManager.prototype, "createSession").mockReturnValue(undefined as never);
    vi.spyOn(SessionManager.prototype, "getTabsForView").mockReturnValue([] as never);
    const seam = panelSeam();
    const post = seam.panel.webview.postMessage as ReturnType<typeof vi.fn>;
    // Fail the FIRST init only, by message type: other pushes precede it, so a
    // bare mockImplementationOnce would land on one of those instead.
    let initAttempts = 0;
    post.mockImplementation((msg: unknown) => {
      if ((msg as { type?: string }).type === "init") {
        initAttempts += 1;
        return Promise.resolve(initAttempts > 1);
      }
      return Promise.resolve(true);
    });
    const view = mount({ listCached: () => null, refresh: async () => listResult() }, seam);

    view.send({ type: "ready" });
    // Past the 50ms retry sleep, so the retry that actually lands is observed.
    await new Promise((resolve) => setTimeout(resolve, 200));
    await settle();

    // The first init ATTEMPT is synchronous either way, so the telling order is
    // against the retry that landed: activation must follow the LAST init push.
    const types = view.postTypes();
    expect(types.filter((t) => t === "init")).toHaveLength(2);
    expect(types.indexOf("worktreeRowActivation")).toBeGreaterThan(types.lastIndexOf("init"));
    view.dispose();
  });
});
