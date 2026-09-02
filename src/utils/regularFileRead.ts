// src/utils/regularFileRead.ts — Opening a path the repository controls, for a
// caller that must ANSWER.
//
// A bounded read is not a bounded open. `open(path, "r")` on a POSIX named pipe
// with no writer waits for a writer that may never come, so a byte cap enforced
// after the open protects nothing — and a caller holding a lock across that open
// never releases it (design.md D1 of `open-a-provider-file-without-waiting-on-it`).

import { constants } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";

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
export function readFlags(c: { O_RDONLY: number; O_NONBLOCK?: number }): number {
  return c.O_RDONLY | (c.O_NONBLOCK ?? 0);
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
export async function openRegularFile(filePath: string, openFile: OpenLike = open): Promise<FileHandle> {
  const handle = await openFile(filePath, readFlags(constants));
  let regular = false;
  try {
    regular = (await handle.stat()).isFile();
  } finally {
    if (!regular) {
      await handle.close().catch(() => {});
    }
  }
  if (!regular) {
    throw Object.assign(new Error("not a regular file"), { code: "ENOTSUP" });
  }
  return handle;
}
