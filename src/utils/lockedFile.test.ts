import { describe, expect, it, vi } from "vitest";
import { type LockDeadline, LockedFile } from "./lockedFile";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolve_, reject_) => {
    resolve = resolve_;
    reject = reject_;
  });
  return { promise, resolve, reject };
}

function manualDeadline() {
  const elapsed = deferred<void>();
  let expired = false;
  const deadline: LockDeadline = {
    elapsed: elapsed.promise,
    get expired() {
      return expired;
    },
    cancel: vi.fn(),
  };
  return {
    deadline,
    expire: () => {
      expired = true;
      elapsed.resolve();
    },
    moveClockBack: () => {
      expired = false;
    },
  };
}

function fileStat(ino: number) {
  return {
    dev: 7,
    ino,
    mode: 0o600,
    nlink: 1,
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
  };
}

describe("LockedFile non-vacuous identity", () => {
  it("refuses a staged replacement whose opened identity is unavailable", async () => {
    const unlink = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const handle = {
      writeFile: vi.fn(async () => undefined),
      chmod: vi.fn(async () => undefined),
      stat: vi.fn(async () => fileStat(0)),
      close,
    };
    const locked = new LockedFile("/repo/.env.worktree", {
      fs: {
        mkdir: vi.fn(async () => undefined),
        open: vi.fn(async () => handle as never),
        unlink,
      },
      randomBytes: () => new Uint8Array(16),
    });

    await expect(locked.stageReplacement("APP=5183\n", 0o600)).resolves.toBeUndefined();
    expect(unlink).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("never unlinks a lock pathname when its opened identity is unavailable", async () => {
    const unlink = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const releaseFailed = vi.fn();
    const handle = {
      stat: vi.fn(async () => fileStat(0)),
      close,
    };
    const locked = new LockedFile("/repo/.env.worktree", {
      fs: {
        mkdir: vi.fn(async () => undefined),
        open: vi.fn(async () => handle as never),
        lstat: vi.fn(async () => fileStat(0) as never),
        unlink,
      },
    });

    await expect(locked.withLock(async () => "done", "unavailable", "failed", releaseFailed)).resolves.toBe("done");
    expect(releaseFailed).toHaveBeenCalledWith("/repo/.env.worktree.anywhere-terminal.lock");
    expect(unlink).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("LockedFile deadline gate", () => {
  function lockHarness(openLock?: () => Promise<unknown>) {
    const unlink = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const handle = { stat: vi.fn(async () => fileStat(31)), close };
    const open = vi.fn(async () => (openLock === undefined ? handle : openLock()));
    const locked = new LockedFile("/repo/.env.worktree", {
      fs: {
        mkdir: vi.fn(async () => undefined),
        open: open as never,
        lstat: vi.fn(async () => fileStat(31) as never),
        unlink,
      },
    });
    return { locked, handle, close, open, unlink };
  }

  it("releases a clean timeout and reports no retained lock", async () => {
    const { deadline, expire } = manualDeadline();
    const { locked, unlink } = lockHarness();
    const started = deferred<void>();
    const result = locked.withLock(
      deadline,
      async () => {
        started.resolve();
        return new Promise<string>(() => undefined);
      },
      "failed",
    );
    await started.promise;

    expire();

    await expect(result).resolves.toEqual({ kind: "timedOut" });
    await vi.waitFor(() => expect(unlink).toHaveBeenCalledWith(locked.lockPath));
  });

  it("retains the lock when a protected mutation is still in flight", async () => {
    const { deadline, expire } = manualDeadline();
    const { locked, unlink, close } = lockHarness();
    const mutation = deferred<void>();
    const started = deferred<void>();
    const result = locked.withLock(
      deadline,
      async (gate) => {
        await gate.guard(async () => {
          started.resolve();
          return mutation.promise;
        });
        return "done";
      },
      "failed",
    );
    await started.promise;

    expire();

    await expect(result).resolves.toEqual({ kind: "timedOut", retainedLockPath: locked.lockPath });
    expect(unlink).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    mutation.resolve();
  });

  it("treats an exclusive open that may land late as retained", async () => {
    const { deadline, expire } = manualDeadline();
    const lateOpen = deferred<unknown>();
    const { locked, close, open, unlink } = lockHarness(() => lateOpen.promise);
    const result = locked.withLock(deadline, async () => "done", "failed");
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());

    expire();

    await expect(result).resolves.toEqual({ kind: "timedOut", retainedLockPath: locked.lockPath });
    lateOpen.resolve({ stat: async () => fileStat(31), close } as never);
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(unlink).not.toHaveBeenCalled();
  });

  it("never reopens after the timer latches even if the wall clock moves backward", async () => {
    const { deadline, expire, moveClockBack } = manualDeadline();
    const { locked } = lockHarness();
    const continueWork = deferred<void>();
    const started = deferred<void>();
    const protectedStep = vi.fn(async () => undefined);
    const result = locked.withLock(
      deadline,
      async (gate) => {
        started.resolve();
        await continueWork.promise;
        await expect(gate.guard(protectedStep)).rejects.toThrow();
        return "done";
      },
      "failed",
    );
    await started.promise;

    expire();
    await expect(result).resolves.toEqual({ kind: "timedOut" });
    moveClockBack();
    continueWork.resolve();
    await vi.waitFor(() => expect(protectedStep).not.toHaveBeenCalled());
  });

  it("starts no exclusive open when the deadline is already spent", async () => {
    const { deadline, expire } = manualDeadline();
    const { locked, open } = lockHarness();
    expire();

    await expect(locked.withLock(deadline, async () => "done", "failed")).resolves.toEqual({ kind: "timedOut" });
    expect(open).not.toHaveBeenCalled();
  });

  it("classifies a late parent mkdir as clean and never starts exclusive open", async () => {
    const { deadline, expire } = manualDeadline();
    const makingParent = deferred<void>();
    const open = vi.fn();
    const locked = new LockedFile("/repo/.env.worktree", {
      fs: { mkdir: vi.fn(() => makingParent.promise) as never, open: open as never },
    });
    const result = locked.withLock(deadline, async () => "done", "failed");

    expire();

    await expect(result).resolves.toEqual({ kind: "timedOut" });
    expect(open).not.toHaveBeenCalled();
    makingParent.resolve();
  });

  it("abandons a staged temporary that resolves after dirty timeout", async () => {
    const { deadline, expire } = manualDeadline();
    const stageOpen = deferred<unknown>();
    const lockClose = vi.fn(async () => undefined);
    const temporaryClose = vi.fn(async () => undefined);
    const unlink = vi.fn(async () => undefined);
    const open = vi.fn(async (candidate: string) =>
      candidate.endsWith(".anywhere-terminal.lock")
        ? ({ stat: async () => fileStat(51), close: lockClose } as never)
        : stageOpen.promise,
    );
    const locked = new LockedFile("/repo/.env.worktree", {
      fs: { mkdir: vi.fn(async () => undefined), open: open as never, unlink },
      randomBytes: () => new Uint8Array(16),
    });
    const stageStarted = deferred<void>();
    const result = locked.withLock(
      deadline,
      async (gate) => {
        stageStarted.resolve();
        await locked.stageReplacement("APP=5183\n", 0o600, gate);
        return "done";
      },
      "failed",
    );
    await stageStarted.promise;
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(2));

    expire();

    await expect(result).resolves.toEqual({ kind: "timedOut", retainedLockPath: locked.lockPath });
    stageOpen.resolve({ close: temporaryClose } as never);
    await vi.waitFor(() => expect(temporaryClose).toHaveBeenCalledOnce());
    expect(unlink).not.toHaveBeenCalled();
  });

  it("retains an in-flight publication and excludes a second lock owner", async () => {
    const { deadline, expire } = manualDeadline();
    const publication = deferred<void>();
    const publicationStarted = deferred<void>();
    const temporaryHandle = {
      writeFile: vi.fn(async () => undefined),
      chmod: vi.fn(async () => undefined),
      stat: vi.fn(async () => fileStat(71)),
      close: vi.fn(async () => undefined),
    };
    const lockHandle = { stat: vi.fn(async () => fileStat(72)), close: vi.fn(async () => undefined) };
    let lockHeld = false;
    const open = vi.fn(async (candidate: string) => {
      if (!candidate.endsWith(".anywhere-terminal.lock")) {
        return temporaryHandle as never;
      }
      if (lockHeld) {
        throw Object.assign(new Error("held"), { code: "EEXIST" });
      }
      lockHeld = true;
      return lockHandle as never;
    });
    const locked = new LockedFile("/repo/.env.worktree", {
      fs: {
        mkdir: vi.fn(async () => undefined),
        open: open as never,
        lstat: vi.fn(async () => fileStat(71) as never),
        link: vi.fn(async () => {
          publicationStarted.resolve();
          return publication.promise;
        }),
        unlink: vi.fn(async () => undefined),
      },
      sleep: async () => undefined,
      randomBytes: () => new Uint8Array(16),
    });
    const staged = await locked.stageReplacement("APP=5183\n", 0o600);
    if (staged === undefined) {
      throw new Error("the test could not stage its replacement");
    }
    const first = locked.withLock(
      deadline,
      async (gate) => ((await staged.commit("create", gate)) ? "published" : "failed"),
      "failed",
    );
    await publicationStarted.promise;

    expire();

    await expect(first).resolves.toEqual({ kind: "timedOut", retainedLockPath: locked.lockPath });
    const secondWork = vi.fn(async () => "second");
    await expect(locked.withLock(secondWork, "unavailable", "failed")).resolves.toBe("unavailable");
    expect(secondWork).not.toHaveBeenCalled();
    publication.resolve();
  });

  it("never unlinks a successor that replaced the owned lock pathname", async () => {
    const { deadline } = manualDeadline();
    const unlink = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const releaseFailed = vi.fn();
    const locked = new LockedFile("/repo/.env.worktree", {
      fs: {
        mkdir: vi.fn(async () => undefined),
        open: vi.fn(async () => ({ stat: async () => fileStat(81), close }) as never),
        lstat: vi.fn(async () => fileStat(82) as never),
        unlink,
      },
    });

    await expect(locked.withLock(deadline, async () => "done", "failed", releaseFailed)).resolves.toEqual({
      kind: "done",
      value: "done",
    });
    expect(releaseFailed).toHaveBeenCalledWith(locked.lockPath);
    expect(unlink).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("keeps committed work successful when lock release outlives the deadline", async () => {
    const { deadline, expire } = manualDeadline();
    const releaseStat = deferred<ReturnType<typeof fileStat>>();
    const releaseStarted = deferred<void>();
    const releaseFailed = vi.fn();
    const close = vi.fn(async () => undefined);
    const locked = new LockedFile("/repo/.env.worktree", {
      fs: {
        mkdir: vi.fn(async () => undefined),
        open: vi.fn(
          async () =>
            ({
              stat: () => {
                releaseStarted.resolve();
                return releaseStat.promise;
              },
              close,
            }) as never,
        ),
      },
    });
    const workStarted = deferred<void>();
    const result = locked.withLock(
      deadline,
      async () => {
        workStarted.resolve();
        return "committed";
      },
      "failed",
      releaseFailed,
    );
    await workStarted.promise;
    await releaseStarted.promise;

    expire();

    await expect(result).resolves.toEqual({ kind: "done", value: "committed" });
    expect(releaseFailed).toHaveBeenCalledWith(locked.lockPath);
    releaseStat.resolve(fileStat(61));
  });

  it("leaves a create temporary until separately discarded", async () => {
    const unlink = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const link = vi.fn(async () => undefined);
    const handle = {
      writeFile: vi.fn(async () => undefined),
      chmod: vi.fn(async () => undefined),
      stat: vi.fn(async () => fileStat(41)),
      close,
    };
    const locked = new LockedFile("/repo/.env.worktree", {
      fs: {
        mkdir: vi.fn(async () => undefined),
        open: vi.fn(async () => handle as never),
        lstat: vi.fn(async () => fileStat(41) as never),
        link,
        unlink,
      },
      randomBytes: () => new Uint8Array(16),
    });
    const staged = await locked.stageReplacement("APP=5183\n", 0o600);

    await expect(staged?.commit("create")).resolves.toBe(true);
    expect(link).toHaveBeenCalledOnce();
    expect(unlink).not.toHaveBeenCalled();
    await expect(staged?.discard()).resolves.toBe(true);
    expect(unlink).toHaveBeenCalledWith(staged?.path);
  });
});
