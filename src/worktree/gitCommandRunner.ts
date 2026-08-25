// src/worktree/gitCommandRunner.ts — The one bounded seam every git call uses.
// See: asimov/changes/enumerate-git-worktrees/design.md D1
//
// stdout stays a Buffer because `worktree list -z` splits on NUL: decoding to a
// string first is what turns an unusually-encoded path into an unparseable one.

import { execFile } from "node:child_process";

/** docs/DESIGN.md § 10 — git command timeout, read-only listings. */
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BUFFER_BYTES = 32 * 1024 * 1024;

export interface GitCommandResult {
  /** Exit code, or -1 when the process never produced one. */
  code: number;
  stdout: Buffer;
  stderr: string;
  timedOut: boolean;
  /** The executable could not be spawned — git absent or not executable. */
  failedToSpawn: boolean;
}

export interface GitCommandRunner {
  run(args: readonly string[], cwd: string): Promise<GitCommandResult>;
}

interface ExecFileFailure extends Error {
  code?: number | string;
  killed?: boolean;
}

export interface GitCommandRunnerOptions {
  executable?: string;
  timeoutMs?: number;
  maxBufferBytes?: number;
}

/**
 * A runner that resolves with the command's outcome and never rejects — a
 * failing git degrades one repository (spec: Confine a repository failure to
 * that repository) rather than propagating out of discovery.
 */
export function createGitCommandRunner(options: GitCommandRunnerOptions = {}): GitCommandRunner {
  const executable = options.executable ?? "git";
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;

  return {
    run(args, cwd) {
      return new Promise<GitCommandResult>((resolve) => {
        execFile(executable, [...args], { cwd, timeout, maxBuffer, encoding: "buffer" }, (error, stdout, stderr) => {
          const out = Buffer.isBuffer(stdout) ? stdout : Buffer.alloc(0);
          const errText = (Buffer.isBuffer(stderr) ? stderr : Buffer.alloc(0)).toString();
          if (!error) {
            resolve({ code: 0, stdout: out, stderr: errText, timedOut: false, failedToSpawn: false });
            return;
          }
          const failure = error as ExecFileFailure;
          const overflowed = failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
          resolve({
            code: typeof failure.code === "number" ? failure.code : -1,
            stdout: out,
            stderr: errText || failure.message,
            // maxBuffer overflow also kills the child; that is not a timeout.
            timedOut: !overflowed && failure.killed === true,
            failedToSpawn: failure.code === "ENOENT" || failure.code === "EACCES" || failure.code === "EPERM",
          });
        });
      });
    },
  };
}
