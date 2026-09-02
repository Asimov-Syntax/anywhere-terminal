import { describe, expect, it, vi } from "vitest";
import type { Pty } from "../../pty/PtyManager";
import type { AuthorizedDirectory } from "../../utils/authorizedDirectory";
import { runSetup } from "./setupRunner";

function authorization(path: string): AuthorizedDirectory {
  return { path, platform: "linux", components: [] };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>((settle) => (resolve = settle)), resolve };
}

function child(exitCode: number, signal: number | undefined = undefined): Pty {
  let exit: ((event: { exitCode: number; signal?: number }) => void) | undefined;
  return {
    pid: 1,
    cols: 80,
    rows: 24,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    onData: () => ({ dispose: vi.fn() }),
    onExit: (listener) => {
      exit = listener;
      queueMicrotask(() => exit?.({ exitCode, signal }));
      return { dispose: vi.fn() };
    },
  };
}

describe("runSetup", () => {
  it("runs exact POSIX payloads serially with the authorized cwd and setup environment", async () => {
    const first = child(0);
    const second = child(0);
    const spawn = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const terminal = { open: vi.fn(async () => true), attach: vi.fn(), detach: vi.fn(), close: vi.fn() };
    const stillAuthorized = vi.fn(async () => true);

    const result = await runSetup(
      {
        repoId: "repo",
        mainPath: "/main",
        worktreeId: "worktree",
        worktreePath: "/worktree",
        branch: "feature/quoted",
        authorization: authorization("/worktree"),
        asimovEnvironment: true,
        ports: { PORT: 3210 },
        steps: [
          { id: "one", source: ".anywhere.json", kind: "shell", script: "echo 'one' && echo two\r\nnext" },
          { id: "two", source: ".anywhere.json", kind: "shell", script: "echo $PORT" },
        ],
      },
      {
        platform: "linux",
        detectShell: () => ({ shell: "/bin/zsh", args: ["--login"] }),
        pty: { spawn },
        terminal,
        directoryStillAuthorized: stillAuthorized,
      },
    );

    expect(terminal.open).toHaveBeenCalledBefore(spawn);
    expect(spawn).toHaveBeenNthCalledWith(1, "/bin/zsh", ["--login", "-c", "echo 'one' && echo two\r\nnext"], {
      cwd: "/worktree",
      env: expect.objectContaining({
        ANYWHERE_TERMINAL_WORKTREE_PATH: "/worktree",
        ANYWHERE_TERMINAL_MAIN_PATH: "/main",
        ANYWHERE_TERMINAL_BRANCH: "feature/quoted",
        ASIMOV_WORKTREE_PATH: "/worktree",
        ASIMOV_MAIN_ROOT: "/main",
        ASIMOV_BRANCH: "feature/quoted",
        PORT: "3210",
      }),
    });
    expect(terminal.attach).toHaveBeenCalledWith(first);
    expect(terminal.detach).toHaveBeenNthCalledWith(1, first);
    expect(terminal.detach).toHaveBeenNthCalledWith(2, second);
    expect(stillAuthorized).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      succeeded: true,
      steps: [
        { id: "one", source: ".anywhere.json", script: "echo 'one' && echo two\r\nnext", outcome: { kind: "ok" } },
        { id: "two", source: ".anywhere.json", script: "echo $PORT", outcome: { kind: "ok" } },
      ],
    });
  });

  it("uses one UTF-16LE PowerShell encoded payload and skips after a failure", async () => {
    const failed = child(7);
    const spawn = vi.fn(() => failed);
    const terminal = { open: vi.fn(async () => true), attach: vi.fn(), close: vi.fn() };
    const script = "Write-Output 'quoted'\r\nWrite-Output $env:PORT";

    const result = await runSetup(
      {
        repoId: "repo",
        mainPath: "C:\\main",
        worktreeId: "worktree",
        worktreePath: "C:\\worktree",
        branch: "feature",
        authorization: { ...authorization("C:\\worktree"), platform: "win32" },
        asimovEnvironment: false,
        ports: { PORT: 3210 },
        steps: [
          { id: "one", source: "source", kind: "shell", script },
          { id: "two", source: "source", kind: "shell", script: "never" },
        ],
      },
      { platform: "win32", pty: { spawn }, terminal, directoryStillAuthorized: async () => true },
    );

    const [, args] = spawn.mock.calls[0] as unknown as [string, string[]];
    expect(spawn).toHaveBeenCalledWith(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", expect.any(String)],
      expect.anything(),
    );
    expect(Buffer.from(args[3] as string, "base64").toString("utf16le")).toBe(script);
    expect(result.steps[0]?.outcome).toEqual({ kind: "failed", reason: "exited with code 7" });
    expect(result.steps[1]?.outcome).toEqual({ kind: "skipped", reason: "previous setup step failed" });
  });

  it("refuses a substituted directory before spawning and marks later steps skipped", async () => {
    const spawn = vi.fn();
    const result = await runSetup(
      {
        repoId: "repo",
        mainPath: "/main",
        worktreeId: "worktree",
        worktreePath: "/worktree",
        branch: "feature",
        authorization: authorization("/worktree"),
        asimovEnvironment: false,
        ports: {},
        steps: [
          { id: "one", source: "source", kind: "shell", script: "first" },
          { id: "two", source: "source", kind: "shell", script: "second" },
        ],
      },
      {
        pty: { spawn },
        terminal: { open: async () => true, attach: vi.fn() },
        directoryStillAuthorized: async () => false,
      },
    );

    expect(spawn).not.toHaveBeenCalled();
    expect(result.steps[0]?.outcome).toEqual({ kind: "failed", reason: "worktree directory is no longer authorized" });
    expect(result.steps[1]?.outcome).toEqual({
      kind: "skipped",
      reason: "setup stopped: worktree directory is no longer authorized",
    });
  });

  it("settles a child that reports exit while its subscription is being installed", async () => {
    const immediate = {
      ...child(0),
      onExit: vi.fn((listener: (event: { exitCode: number; signal?: number }) => void) => {
        listener({ exitCode: 0 });
        return { dispose: vi.fn() };
      }),
    };

    const result = await runSetup(
      {
        repoId: "repo",
        mainPath: "/main",
        worktreeId: "worktree",
        worktreePath: "/worktree",
        branch: "feature",
        authorization: authorization("/worktree"),
        asimovEnvironment: false,
        ports: {},
        steps: [{ id: "one", source: "source", kind: "shell", script: "true" }],
      },
      {
        pty: { spawn: () => immediate },
        terminal: { open: async () => true, attach: vi.fn() },
        directoryStillAuthorized: async () => true,
      },
    );

    expect(result.steps[0]?.outcome).toEqual({ kind: "ok" });
  });

  it("turns a synchronous terminal-open failure into stopped setup outcomes", async () => {
    const spawn = vi.fn();
    const result = await runSetup(
      {
        repoId: "repo",
        mainPath: "/main",
        worktreeId: "worktree",
        worktreePath: "/worktree",
        branch: "feature",
        authorization: authorization("/worktree"),
        asimovEnvironment: false,
        ports: {},
        steps: [{ id: "one", source: "source", kind: "shell", script: "true" }],
      },
      {
        pty: { spawn },
        terminal: {
          open: () => {
            throw new Error("terminal unavailable");
          },
          attach: vi.fn(),
        },
        directoryStillAuthorized: async () => true,
      },
    );

    expect(spawn).not.toHaveBeenCalled();
    expect(result.steps[0]?.outcome).toEqual({ kind: "skipped", reason: "setup stopped: setup terminal was closed" });
  });

  it("kills a hung current child at the shared deadline", async () => {
    vi.useFakeTimers();
    const hung = {
      ...child(0),
      onExit: vi.fn(() => ({ dispose: vi.fn() })),
    };
    const spawn = vi.fn(() => hung);
    const run = runSetup(
      {
        repoId: "repo",
        mainPath: "/main",
        worktreeId: "worktree",
        worktreePath: "/worktree",
        branch: "feature",
        authorization: authorization("/worktree"),
        asimovEnvironment: false,
        ports: {},
        steps: [
          { id: "one", source: "source", kind: "shell", script: "hung" },
          { id: "two", source: "source", kind: "shell", script: "skipped" },
        ],
      },
      {
        pty: { spawn },
        terminal: { open: async () => true, attach: vi.fn() },
        directoryStillAuthorized: async () => true,
        timeoutMs: 10,
      },
    );
    await vi.advanceTimersByTimeAsync(10);
    const result = await run;
    vi.useRealTimers();

    expect(hung.kill).toHaveBeenCalledWith();
    expect(result.steps[0]?.outcome).toEqual({ kind: "failed", reason: "setup deadline exceeded" });
    expect(result.steps[1]?.outcome).toEqual({ kind: "skipped", reason: "previous setup step failed" });
  });

  it("keeps host identity authoritative over malformed reserved port input", async () => {
    const spawn = vi.fn(() => child(0));

    await runSetup(
      {
        repoId: "repo",
        mainPath: "/main",
        worktreeId: "worktree",
        worktreePath: "/worktree",
        branch: "feature",
        authorization: authorization("/worktree"),
        asimovEnvironment: true,
        ports: {
          PORT: 3210,
          ANYWHERE_TERMINAL_WORKTREE_PATH: 1,
          aSiMoV_ChAnGe_Id: 2,
        },
        steps: [{ id: "one", source: "source", kind: "shell", script: "true" }],
      },
      {
        platform: "linux",
        pty: { spawn },
        terminal: { open: async () => true, attach: vi.fn() },
        directoryStillAuthorized: async () => true,
      },
    );

    const [, , options] = spawn.mock.calls[0] as unknown as [string, string[], { env: Record<string, string> }];
    expect(options.env).toMatchObject({
      PORT: "3210",
      ANYWHERE_TERMINAL_WORKTREE_PATH: "/worktree",
      ASIMOV_WORKTREE_PATH: "/worktree",
    });
    expect(options.env).not.toHaveProperty("aSiMoV_ChAnGe_Id");
  });

  it("cancels a hanging authorization without spawning after it later resolves", async () => {
    const checked = deferred<boolean>();
    let close: (() => void) | undefined;
    const spawn = vi.fn();
    const run = runSetup(
      {
        repoId: "repo",
        mainPath: "/main",
        worktreeId: "worktree",
        worktreePath: "/worktree",
        branch: "feature",
        authorization: authorization("/worktree"),
        asimovEnvironment: false,
        ports: {},
        steps: [{ id: "one", source: "source", kind: "shell", script: "true" }],
      },
      {
        pty: { spawn },
        terminal: {
          open: async () => true,
          attach: vi.fn(),
          onClose: (listener) => {
            close = listener;
            return { dispose: vi.fn() };
          },
        },
        directoryStillAuthorized: () => checked.promise,
      },
    );
    await vi.waitFor(() => expect(close).toBeTypeOf("function"));

    close?.();
    checked.resolve(true);
    const result = await run;

    expect(spawn).not.toHaveBeenCalled();
    expect(result.steps[0]?.outcome).toEqual({ kind: "failed", reason: "setup terminal was closed" });
  });

  it("bounds a hanging authorization with the shared deadline", async () => {
    vi.useFakeTimers();
    const spawn = vi.fn();
    const run = runSetup(
      {
        repoId: "repo",
        mainPath: "/main",
        worktreeId: "worktree",
        worktreePath: "/worktree",
        branch: "feature",
        authorization: authorization("/worktree"),
        asimovEnvironment: false,
        ports: {},
        steps: [{ id: "one", source: "source", kind: "shell", script: "true" }],
      },
      {
        pty: { spawn },
        terminal: { open: async () => true, attach: vi.fn() },
        directoryStillAuthorized: () => new Promise<boolean>(() => undefined),
        timeoutMs: 10,
      },
    );

    await vi.advanceTimersByTimeAsync(10);
    const result = await run;
    vi.useRealTimers();

    expect(spawn).not.toHaveBeenCalled();
    expect(result.steps[0]?.outcome).toEqual({ kind: "failed", reason: "setup deadline exceeded" });
  });

  it("settles a timed-out child even when PTY termination throws", async () => {
    vi.useFakeTimers();
    const hung = {
      ...child(0),
      kill: vi.fn(() => {
        throw new Error("already exited");
      }),
      onExit: vi.fn(() => ({ dispose: vi.fn() })),
    };
    const run = runSetup(
      {
        repoId: "repo",
        mainPath: "/main",
        worktreeId: "worktree",
        worktreePath: "/worktree",
        branch: "feature",
        authorization: authorization("/worktree"),
        asimovEnvironment: false,
        ports: {},
        steps: [{ id: "one", source: "source", kind: "shell", script: "hung" }],
      },
      {
        pty: { spawn: () => hung },
        terminal: { open: async () => true, attach: vi.fn() },
        directoryStillAuthorized: async () => true,
        timeoutMs: 10,
      },
    );

    await vi.advanceTimersByTimeAsync(10);
    await expect(run).resolves.toMatchObject({
      succeeded: false,
      steps: [{ outcome: { kind: "failed", reason: "setup deadline exceeded" } }],
    });
    vi.useRealTimers();
  });
});
