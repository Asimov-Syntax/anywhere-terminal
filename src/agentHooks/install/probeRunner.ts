// src/agentHooks/install/probeRunner.ts — Running the Windows wrapper once to
// see whether it answers (D14). Everything here is about not trusting the
// process: the executable is named absolutely, `error` and `close` are both
// contained, one deadline bounds the run, and the process group is terminated
// and reaped before any answer is reported.

import { spawn as nodeSpawn } from "node:child_process";
import { win32 } from "node:path";

export interface ProbeResult {
  exitCode: number;
  stdout: string;
}

/** How long the probe may run before it is killed. */
export const PROBE_DEADLINE_MS = 2_000;

/** How long termination is given to be observed before the answer is reported anyway. */
export const REAP_GRACE_MS = 500;

/**
 * The bound a caller wrapping an injected runner should use. Strictly greater
 * than deadline plus reap grace: an outer bound that can fire first cancels the
 * wait for a kill that has already been issued, which is exactly the reap this
 * runner exists to perform (round-3 W1 — both were 2,000 ms).
 */
export const PROBE_OUTER_DEADLINE_MS = PROBE_DEADLINE_MS + REAP_GRACE_MS + 500;

export interface ProbeRunnerDependencies {
  spawn?: typeof nodeSpawn;
  /** Injected so a test can observe termination without a real process group. */
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  platform?: NodeJS.Platform;
  deadlineMs?: number;
  reapGraceMs?: number;
}

const WINDOWS_SYSTEM_ROOT_FALLBACK = "C:\\Windows";

/**
 * A System32 executable named absolutely. Windows searches the working directory
 * before PATH, so a bare `cmd`/`taskkill` would run a repo-local lookalike — the
 * same defect the shipped wrapper carried for `more`.
 */
export function windowsSystemPath(executable: string, environment: NodeJS.ProcessEnv = process.env): string {
  return win32.join(environment.SystemRoot?.trim() || WINDOWS_SYSTEM_ROOT_FALLBACK, "System32", executable);
}

export function runProbe(
  file: string,
  args: string[],
  dependencies: ProbeRunnerDependencies = {},
): Promise<ProbeResult> {
  const spawn = dependencies.spawn ?? nodeSpawn;
  const platform = dependencies.platform ?? process.platform;
  const deadlineMs = dependencies.deadlineMs ?? PROBE_DEADLINE_MS;
  const reapGraceMs = dependencies.reapGraceMs ?? REAP_GRACE_MS;

  return new Promise<ProbeResult>((resolve) => {
    let stdout = "";
    let settled = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let reap: ReturnType<typeof setTimeout> | undefined;
    const finish = (exitCode: number) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(deadline);
      clearTimeout(reap);
      resolve({ exitCode, stdout });
    };

    let child: ReturnType<typeof spawn>;
    try {
      // Detached on POSIX so the child leads its own group and a single kill
      // reaches whatever it spawned; Windows has no groups to lead.
      child = spawn(file, args, {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        detached: platform !== "win32",
      });
    } catch {
      // A synchronous spawn failure is an unreachable probe, not a crash.
      finish(1);
      return;
    }

    deadline = setTimeout(() => {
      terminateTree(child, { spawn, kill: dependencies.kill, platform });
      // Report only once the child is observed gone; the grace keeps an
      // unkillable process from holding the install open forever.
      reap = setTimeout(() => finish(1), reapGraceMs);
      child.once("close", () => finish(1));
    }, deadlineMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => {
      stdout = "";
      finish(1);
    });
    child.on("close", (code) => finish(code ?? 1));
  });
}

function terminateTree(
  child: ReturnType<typeof nodeSpawn>,
  context: { spawn: typeof nodeSpawn; kill?: (pid: number, signal: NodeJS.Signals) => void; platform: NodeJS.Platform },
): void {
  if (child.pid === undefined) {
    return;
  }
  const kill = context.kill ?? ((pid: number, signal: NodeJS.Signals) => process.kill(pid, signal));
  try {
    if (context.platform === "win32") {
      context
        .spawn(windowsSystemPath("taskkill.exe"), ["/pid", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        })
        .on("error", () => child.kill("SIGKILL"));
      return;
    }
    // Negative pid addresses the group the detached spawn created.
    kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

/** Bounds an injected runner that may not honour a deadline of its own. */
export function withProbeDeadline(
  promise: Promise<ProbeResult>,
  milliseconds: number = PROBE_OUTER_DEADLINE_MS,
): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ exitCode: 1, stdout: "" }), milliseconds);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve({ exitCode: 1, stdout: "" });
      },
    );
  });
}
