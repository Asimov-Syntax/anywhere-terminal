// src/utils/regularFileRead.ts — Opening a path the repository controls, for a
// caller that must ANSWER.
//
// A bounded read is not a bounded open. `open(path, "r")` on a POSIX named pipe
// with no writer waits for a writer that may never come, so a byte cap enforced
// after the open protects nothing — and a caller holding a lock across that open
// never releases it (design.md D1 of `open-a-provider-file-without-waiting-on-it`).

import { constants } from "node:fs";
import { type FileHandle, lstat, open } from "node:fs/promises";

/** The `open` a caller with injected filesystem dependencies passes in. */
export type OpenLike = (path: string, flags: number) => Promise<FileHandle>;

/**
 * Read-only, and nonblocking WHERE THE PLATFORM HAS IT.
 *
 * A pure function of its constants rather than an inline expression, because
 * `O_NONBLOCK` is undefined on win32: computed inline the degradation happens at
 * module load and cannot be witnessed on the platform CI runs. What holds on
 * win32 is the handle test below — a named pipe there lives in `\\.\pipe\`, which
 * no repository-contained pathname reaches (D3).
 */
export function readFlags(c: Constants, noFollow = false): number {
  return c.O_RDONLY | (c.O_NONBLOCK ?? 0) | (noFollow ? (c.O_NOFOLLOW ?? 0) : 0);
}

/** What the platform's `fs.constants` supplies; every optional bit degrades to zero. */
export interface Constants {
  O_RDONLY: number;
  O_NONBLOCK?: number;
  O_NOFOLLOW?: number;
}

/** The identity a `stat` answers with, read at full precision. */
interface Identity {
  readonly dev: number | bigint;
  readonly ino: number | bigint;
}

export interface OpenRegularFileOptions {
  /**
   * Refuse a symlink AT `filePath` itself, for a caller that edits the file in
   * place rather than merely reading it.
   *
   * Off by default: a provider file the repository reads legitimately may be a
   * link, and `provisioningDeps.readBounded` depends on that.
   */
  noFollow?: boolean;
  /** Overridable so the win32 arm — no `O_NOFOLLOW` — is witnessable anywhere. */
  constants?: Constants;
  /** Overridable so a substitution can be scheduled after the inspection. */
  lstatFile?: (path: string) => Promise<Identity & { isSymbolicLink(): boolean }>;
}

/**
 * Open `filePath` for reading, or refuse it as `ENOTSUP`.
 *
 * Both halves are load-bearing and neither works alone. Without the flag the
 * open waits on a writerless pipe. Without the check, the flag makes that same
 * pipe open and read as ZERO BYTES — an empty configuration, which says the
 * opposite of unreadable and is worse than the hang for being silent.
 *
 * The type is taken from the OPEN HANDLE, never from the path: a path checked
 * before the open describes a file the open need not have landed on, and the
 * handle cannot be swapped underneath. That is also what makes this safe for a
 * caller that already `lstat`ed — there is no window between the two answers,
 * because there is only one.
 *
 * `ENOTSUP` rather than a sentinel so callers that classify by errno keep
 * working: it is not `ENOENT`/`ENOTDIR`, so every reader that separates absence
 * from failure files it under failure with no change.
 */
export async function openRegularFile(
  filePath: string,
  openFile: OpenLike = open,
  options: OpenRegularFileOptions = {},
): Promise<FileHandle> {
  const platform = options.constants ?? constants;
  const noFollow = options.noFollow === true;

  // Read before the open, so the identity below has something to compare
  // against. `O_NOFOLLOW` alone cannot carry the refusal: win32 does not define
  // it, exactly as it does not define `O_NONBLOCK`.
  let inspected: Identity | undefined;
  if (noFollow) {
    const seen = await (options.lstatFile ?? ((p: string) => lstat(p, { bigint: true })))(filePath);
    if (seen.isSymbolicLink()) {
      throw notRegular();
    }
    inspected = seen;
  }

  const handle = await openFile(filePath, readFlags(platform, noFollow));
  let regular = false;
  try {
    const opened = await handle.stat({ bigint: true });
    // A link installed between the inspection and the open makes the open land
    // on a DIFFERENT object, and the two identities diverge. Bounded on purpose:
    // inode reuse defeats it, and Windows exposes a 64-bit id Microsoft does not
    // guarantee unique on ReFS (design.md D5).
    regular =
      opened.isFile() &&
      (inspected === undefined ||
        (BigInt(opened.dev) === BigInt(inspected.dev) && BigInt(opened.ino) === BigInt(inspected.ino)));
  } finally {
    if (!regular) {
      await handle.close().catch(() => {});
    }
  }
  if (!regular) {
    throw notRegular();
  }
  return handle;
}

function notRegular(): NodeJS.ErrnoException {
  return Object.assign(new Error("not a regular file"), { code: "ENOTSUP" });
}
