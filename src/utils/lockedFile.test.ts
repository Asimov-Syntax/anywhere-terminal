import { describe, expect, it, vi } from "vitest";
import { LockedFile } from "./lockedFile";

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
