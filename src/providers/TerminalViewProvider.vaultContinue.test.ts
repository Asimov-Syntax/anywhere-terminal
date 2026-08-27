// src/providers/TerminalViewProvider.vaultContinue.test.ts — continue-from-a-message
// routing: resolve → recover text → compose the handoff → launch a NEW session
// (improve-vault-transcript-messages 5_3).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAll, __setAppRoot, __setWorkspaceFolders } from "../test/__mocks__/vscode";

vi.mock("../pty/processCwd", async () => (await import("../test/sessionMocks")).processCwdMock());
vi.mock("../pty/PtyManager", async () => (await import("../test/sessionMocks")).ptyManagerMock());
vi.mock("../pty/PtySession", async () => (await import("../test/sessionMocks")).ptySessionMock());
vi.mock("../session/OutputBuffer", async () => (await import("../test/sessionMocks")).outputBufferMock());

// The registry's own probe spawns each agent executable. Real here, it competes
// with the whole suite for process slots and the reply misses its deadline — a
// flake that says nothing about routing. Detection is covered in registry.test.ts
// against a fake exec; what THIS file owns is which capability was asked for and
// what came back.
const STUB_TARGETS = {
  start: [{ agent: "claude", displayName: "Claude Code", permissionChoices: [], canSeedPrompt: true }],
  continue: [{ agent: "codex", displayName: "Codex", permissionChoices: [], canSeedPrompt: true }],
} as const;
vi.mock("../vault/registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../vault/registry")>()),
  detectLaunchTargets: vi.fn(async (capability: "continue" | "start") => STUB_TARGETS[capability]),
}));

import type * as vscode from "vscode";
import { SessionManager } from "../session/SessionManager";
import { MAX_CONTINUATION_INSTRUCTION } from "../vault/continuationLimits";
import type { VaultLauncher } from "../vault/VaultLauncher";
import type { VaultService } from "../vault/VaultService";
import { TerminalViewProvider } from "./TerminalViewProvider";
import type { WorktreeHost } from "./WorktreeHost";

beforeEach(() => {
  __resetAll();
  __setAppRoot("/mock/vscode/app");
  __setWorkspaceFolders([{ uri: { fsPath: "/mock/workspace" } }]);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const ENTRY = {
  id: "claude:s1",
  agent: "claude",
  sessionId: "s1",
  title: "t",
  cwd: "/work/proj",
  modified: 1,
  flags: {},
  canFork: false,
  sessionPath: "/store/s1.jsonl",
};

const ASSISTANT_RECORD = JSON.stringify({
  type: "assistant",
  uuid: "a-1",
  message: { role: "assistant", content: "the previous reply" },
});

const USER_RECORD = JSON.stringify({
  type: "user",
  uuid: "u-1",
  message: { role: "user", content: "make the parser bounded" },
});

type FakeVault = {
  getEntry: ReturnType<typeof vi.fn>;
  readMessageRecord: ReturnType<typeof vi.fn>;
};

function makeVault(over: Partial<FakeVault> = {}): FakeVault {
  return {
    getEntry: vi.fn(async () => ENTRY),
    readMessageRecord: vi.fn(async () => ({ ok: true, line: ASSISTANT_RECORD })),
    ...over,
  };
}

const okResolve = () =>
  vi.fn(async (_entryId: string, _mode: string, _prompt?: string) => ({
    shell: "claude",
    shellArgs: ["seeded"],
    cwd: "/work/proj",
    env: {},
    isAgentLaunch: true,
  }));

function mount(vault: FakeVault, resolve: ReturnType<typeof okResolve> | ReturnType<typeof vi.fn> = okResolve()) {
  const sm = new SessionManager();
  // Only the two members this file exercises: the start capability is answered
  // by the host now, because the host is what admits launches against it.
  const publishLaunchTargets = vi.fn(async () => {});
  const worktreeHost = {
    initPayload: () => ({ worktreeHasRepo: false }),
    attach: () => ({ setDisplayed: () => {}, dispose: () => {} }),
    handleMessage: () => {},
    publishLaunchTargets,
    mutationBindings: () => {
      throw new Error("not exercised here");
    },
    reportMutation: () => {},
    dispose: () => {},
  } as unknown as WorktreeHost;
  const provider = new TerminalViewProvider(
    { fsPath: "/mock/extension" } as vscode.Uri,
    sm,
    "sidebar",
    null,
    null,
    vault as unknown as VaultService,
    { resolve } as unknown as VaultLauncher,
    null,
    worktreeHost,
  );
  const messageHandlers: Array<(msg: unknown) => void> = [];
  const postMessageSpy = vi.fn((_m: unknown) => Promise.resolve(true));
  const webviewView = {
    visible: true,
    viewType: "anywhereTerminal.sidebar",
    webview: {
      html: "",
      options: {},
      cspSource: "https://mock.csp.source",
      asWebviewUri: (uri: { fsPath: string }) => uri.fsPath,
      onDidReceiveMessage: (h: (msg: unknown) => void) => {
        messageHandlers.push(h);
        return { dispose: () => {} };
      },
      postMessage: postMessageSpy,
    },
    onDidChangeVisibility: () => ({ dispose: () => {} }),
    onDidDispose: () => ({ dispose: () => {} }),
  } as unknown as vscode.WebviewView;
  provider.resolveWebviewView(webviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
  return {
    send: (msg: unknown) => {
      for (const h of messageHandlers) {
        h(msg);
      }
    },
    resolve,
    publishLaunchTargets,
    postMessageSpy,
    dispose: () => sm.dispose(),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function errors(spy: ReturnType<typeof vi.fn>): string[] {
  return spy.mock.calls
    .map(([m]) => m as { type?: string; message?: string })
    .filter((m) => m.type === "error")
    .map((m) => m.message ?? "");
}

describe("vaultContinueSession", () => {
  // D10: the reader authors the instruction in the confirm dialog, so the host
  // composes around it rather than reading a message record for its text.
  const confirmed = {
    type: "vaultContinueSession" as const,
    entryId: "claude:s1",
    instruction: "make the parser bounded",
    confirmIntent: false,
  };

  it("launches a new session in continue mode, seeded from the confirmed instruction", async () => {
    const vault = makeVault();
    const { send, resolve, postMessageSpy, dispose } = mount(vault);

    send({ ...confirmed, anchorRef: "a-1" });
    await tick();

    expect(resolve).toHaveBeenCalledTimes(1);
    const [entryId, mode, prompt] = resolve.mock.calls[0] as unknown as [string, string, string];
    expect(entryId).toBe("claude:s1");
    expect(mode).toBe("continue");
    expect(prompt).toContain("make the parser bounded");
    expect(prompt).toContain("a-1");
    expect(vault.readMessageRecord).toHaveBeenCalledWith("claude:s1", "a-1");
    // A new tab, not a resume of the stored session.
    expect(postMessageSpy.mock.calls.some(([m]) => (m as { type?: string }).type === "tabCreated")).toBe(true);
    expect(errors(postMessageSpy)).toEqual([]);
    dispose();
  });

  it("carries the intent block only when the reader left the check on", async () => {
    const vault = makeVault();
    const { send, resolve, dispose } = mount(vault);

    send({ ...confirmed, confirmIntent: true });
    await tick();

    const [, , prompt] = resolve.mock.calls[0] as unknown as [string, string, string];
    expect(prompt).toMatch(/wait for my confirmation/i);
    dispose();
  });

  it("rejects an anchor that resolves to a user record", async () => {
    const vault = makeVault({ readMessageRecord: vi.fn(async () => ({ ok: true, line: USER_RECORD })) });
    const { send, resolve, postMessageSpy, dispose } = mount(vault);

    send({ ...confirmed, anchorRef: "u-1" });
    await tick();

    expect(resolve).not.toHaveBeenCalled();
    expect(errors(postMessageSpy)).toEqual(["Continuation anchor is not an assistant message."]);
    dispose();
  });

  it("rejects an anchor the store cannot return completely", async () => {
    const vault = makeVault({ readMessageRecord: vi.fn(async () => ({ ok: false, reason: "too-large" })) });
    const { send, resolve, postMessageSpy, dispose } = mount(vault);

    send({ ...confirmed, anchorRef: "a-1" });
    await tick();

    expect(resolve).not.toHaveBeenCalled();
    expect(errors(postMessageSpy)).toEqual(["Continuation anchor is too large."]);
    dispose();
  });

  it("rejects a forged instruction above the shared cap before composing a prompt", async () => {
    const vault = makeVault();
    const { send, resolve, postMessageSpy, dispose } = mount(vault);

    send({ ...confirmed, instruction: "x".repeat(MAX_CONTINUATION_INSTRUCTION + 1) });
    await tick();

    expect(resolve).not.toHaveBeenCalled();
    expect(errors(postMessageSpy)).toEqual([`Instruction exceeds ${MAX_CONTINUATION_INSTRUCTION} characters.`]);
    dispose();
  });

  it("reports an empty instruction instead of launching an unseeded session", async () => {
    const vault = makeVault();
    const { send, resolve, postMessageSpy, dispose } = mount(vault);

    send({ ...confirmed, instruction: "   " });
    await tick();

    expect(resolve).not.toHaveBeenCalled();
    expect(errors(postMessageSpy)).toEqual(["Could not compose a handoff prompt for this session."]);
    dispose();
  });

  it("reports an unknown entry instead of launching", async () => {
    const vault = makeVault({ getEntry: vi.fn(async () => null) });
    const { send, resolve, postMessageSpy, dispose } = mount(vault);

    send({ ...confirmed, entryId: "claude:gone" });
    await tick();

    expect(resolve).not.toHaveBeenCalled();
    expect(errors(postMessageSpy)).toEqual(["Session not found."]);
    dispose();
  });

  it("surfaces a launch failure as an error notice, not a broken tab", async () => {
    const vault = makeVault();
    const resolve = vi.fn(async (_entryId: string, _mode: string, _prompt?: string) => {
      throw new Error("claude has no continue command");
    });
    const { send, postMessageSpy, dispose } = mount(vault, resolve);

    send(confirmed);
    await tick();

    expect(errors(postMessageSpy)).toEqual(["claude has no continue command"]);
    expect(postMessageSpy.mock.calls.some(([m]) => (m as { type?: string }).type === "tabCreated")).toBe(false);
    dispose();
  });
});

describe("requestVaultLaunchTargets", () => {
  function replies(spy: ReturnType<typeof vi.fn>): { capability?: string; targets: { agent: string }[] }[] {
    return spy.mock.calls
      .map(([m]) => m as { type?: string; capability?: string; targets?: { agent: string }[] })
      .filter((m) => m.type === "vaultLaunchTargets")
      .map((m) => ({ capability: m.capability, targets: m.targets ?? [] }));
  }

  it("hands the start capability to the host, which answers it and remembers doing so", async () => {
    // The provider used to answer this itself. It cannot any more: admission
    // checks the set the surface was OFFERED, and an answer the host did not
    // give is one it cannot check against (round-2 B1).
    const h = mount(makeVault());
    h.send({ type: "requestVaultLaunchTargets", capability: "start" });
    await tick();
    expect(h.publishLaunchTargets).toHaveBeenCalledTimes(1);
    expect(replies(h.postMessageSpy)).toEqual([]);
    h.dispose();
  });

  it("treats an absent capability as continue, so the existing dialog is unchanged", async () => {
    const h = mount(makeVault());
    h.send({ type: "requestVaultLaunchTargets" });
    await tick();
    expect(replies(h.postMessageSpy)[0]?.capability).toBe("continue");
    h.dispose();
  });

  it("answers the continuation capability itself, and never with the other set", async () => {
    // An EQUALITY, not a loop over the postures: where no agent resolves, a loop
    // runs zero times and the test passes having checked nothing.
    const h = mount(makeVault());
    h.send({ type: "requestVaultLaunchTargets", capability: "continue" });
    await tick();
    expect(replies(h.postMessageSpy)).toEqual([{ capability: "continue", targets: STUB_TARGETS.continue }]);
    expect(h.publishLaunchTargets).not.toHaveBeenCalled();
    h.dispose();
  });
});
