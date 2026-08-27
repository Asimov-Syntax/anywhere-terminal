// src/agentHooks/install/probeRunner.test.ts — The probe is the one place this
// change starts a process, so every way that can go wrong is pinned here: a
// descendant outliving its leader, a spawn that never starts, a kill nobody
// waits for, and an outer bound that preempts the reap (D14).

import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PROBE_DEADLINE_MS,
  PROBE_OUTER_DEADLINE_MS,
  REAP_GRACE_MS,
  runProbe,
  windowsSystemPath,
  withProbeDeadline,
} from "./probeRunner";

const tempDirectories: string[] = [];

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "probe-runner-"));
  tempDirectories.push(directory);
  return directory;
}

const settle = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

/** Whether `pid` is gone, waited for rather than assumed. */
async function gone(pid: number, timeoutMs = 2_000): Promise<boolean> {
  for (let waited = 0; waited <= timeoutMs; waited += 25) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await settle(25);
  }
  return false;
}

describe("runProbe", () => {
  it("returns what a well-behaved probe printed", async () => {
    await expect(runProbe("/bin/sh", ["-c", 'printf "{}\\n"'])).resolves.toEqual({ exitCode: 0, stdout: "{}\n" });
  });

  it("reports a non-zero exit rather than throwing", async () => {
    await expect(runProbe("/bin/sh", ["-c", "exit 3"])).resolves.toMatchObject({ exitCode: 3 });
  });

  it("contains a spawn that never starts", async () => {
    await expect(runProbe(join(await scratch(), "does-not-exist"), [])).resolves.toEqual({ exitCode: 1, stdout: "" });
  });

  it("contains a synchronous spawn failure", async () => {
    const throwing = (() => {
      throw new Error("EINVAL");
    }) as never;

    await expect(runProbe("/bin/sh", [], { spawn: throwing })).resolves.toEqual({ exitCode: 1, stdout: "" });
  });

  it("kills a hung probe rather than only ceasing to wait for it", async () => {
    const marker = join(await scratch(), "survived.txt");

    const result = await runProbe("/bin/sh", ["-c", `sleep 0.4; : > '${marker}'`], { deadlineMs: 100 });

    expect(result).toEqual({ exitCode: 1, stdout: "" });
    // Long enough that an unkilled child would have created the marker.
    await settle(700);
    await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("takes a descendant with the leader it kills", async () => {
    const marker = join(await scratch(), "grandchild.txt");
    // The child backgrounds a grandchild, then sleeps. Killing only the leader
    // would leave the grandchild to create the marker (round-2 W1).
    const result = await runProbe("/bin/sh", ["-c", `(sleep 0.4; : > '${marker}') & sleep 5`], { deadlineMs: 100 });

    expect(result).toEqual({ exitCode: 1, stdout: "" });
    await settle(700);
    await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("waits for the kill to be observed before reporting", async () => {
    const killed: Array<[number, NodeJS.Signals]> = [];
    const started = Date.now();

    const result = await runProbe("/bin/sh", ["-c", "sleep 5"], {
      deadlineMs: 50,
      reapGraceMs: 300,
      // Records the kill without performing it, so the reap grace is what ends
      // the wait — the elapsed time proves the wait happened at all.
      kill: (pid, signal) => {
        killed.push([pid, signal]);
      },
    });

    expect(result).toEqual({ exitCode: 1, stdout: "" });
    expect(killed).toHaveLength(1);
    expect(killed[0]?.[0]).toBeLessThan(0);
    expect(killed[0]?.[1]).toBe("SIGKILL");
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
  });

  it("terminates the group, not merely the leader", async () => {
    const killed: number[] = [];
    let pid = 0;

    await runProbe("/bin/sh", ["-c", "sleep 5"], {
      deadlineMs: 50,
      reapGraceMs: 100,
      spawn: ((file: string, args: string[], options: object) => {
        const child = spawn(file, args, options);
        pid = child.pid as number;
        return child;
      }) as never,
      kill: (target, signal) => {
        killed.push(target);
        process.kill(target, signal);
      },
    });

    expect(killed).toEqual([-pid]);
  });

  it("reports leader-only termination when the absolute taskkill cannot start (round-4 W4)", async () => {
    let leader: number | undefined;
    const spawnOrFail = ((file: string, args: string[], options: object) => {
      if (file.endsWith("taskkill.exe")) {
        // A taskkill that never starts: on Windows the fallback reaches cmd.exe
        // and not the curl it spawned, so the result must say so.
        return spawn(join(tmpdir(), "no-such-taskkill"), [], options);
      }
      const child = spawn(file, args, options);
      leader = child.pid;
      return child;
    }) as never;

    const result = await runProbe("/bin/sh", ["-c", "sleep 5"], {
      deadlineMs: 50,
      reapGraceMs: 400,
      platform: "win32",
      spawn: spawnOrFail,
    });

    expect(result).toEqual({ exitCode: 1, stdout: "", leaderOnlyTermination: true });
    expect(leader).toBeGreaterThan(0);
    await settle(50);
    // The leader is still killed — the fallback is partial, not absent.
    expect(() => process.kill(leader as number, 0)).toThrow();
  });

  it("reports leader-only termination when a started taskkill exits nonzero (round-7 B12)", async () => {
    let leader: number | undefined;
    const spawnOrFail = ((file: string, args: string[], options: object) => {
      if (file.endsWith("taskkill.exe")) {
        // Starts fine and fails: access denied, or a pid already reaped. No
        // `error` event is emitted at all, so only the exit status shows it.
        return spawn("/bin/sh", ["-c", "exit 1"], options);
      }
      const child = spawn(file, args, options);
      leader = child.pid;
      return child;
    }) as never;

    const result = await runProbe("/bin/sh", ["-c", "sleep 5"], {
      deadlineMs: 50,
      reapGraceMs: 400,
      platform: "win32",
      spawn: spawnOrFail,
    });

    expect(result).toEqual({ exitCode: 1, stdout: "", leaderOnlyTermination: true });
    // Polled rather than slept on: a fixed grace is a coin flip on a loaded machine.
    expect(await gone(leader as number)).toBe(true);
  });

  it("does not report a clean kill it has not yet observed (round-7 B12)", async () => {
    let released: (() => void) | undefined;
    const spawnSlowKiller = ((file: string, args: string[], options: object) => {
      if (file.endsWith("taskkill.exe")) {
        // Still running when the child is already gone: settling on the child's
        // close alone would report a termination whose result is unknown.
        const killer = spawn("/bin/sh", ["-c", "sleep 0.2; exit 1"], options);
        released = () => killer.kill("SIGKILL");
        return killer;
      }
      return spawn(file, args, options);
    }) as never;

    const result = await runProbe("/bin/sh", ["-c", "sleep 5"], {
      deadlineMs: 50,
      reapGraceMs: 2_000,
      platform: "win32",
      spawn: spawnSlowKiller,
      kill: (pid, signal) => process.kill(pid, signal),
    });

    expect(result.leaderOnlyTermination).toBe(true);
    released?.();
  });

  it("waits for the terminator when the leader closes first (round-9 B12)", async () => {
    const spawnSlowKiller = ((file: string, args: string[], options: object) => {
      if (file.endsWith("taskkill.exe")) {
        // Reports after the leader is already gone.
        return spawn("/bin/sh", ["-c", "sleep 0.3; exit 1"], options);
      }
      return spawn(file, args, options);
    }) as never;

    // The leader exits on its own shortly after the deadline. The listener
    // registered at spawn ran before the gated one, so it settled here with a
    // clean exit code and no incomplete-termination signal, while the kill it
    // was reporting on had not answered and in fact failed (round-9 B12).
    const result = await runProbe("/bin/sh", ["-c", "sleep 0.12"], {
      deadlineMs: 50,
      reapGraceMs: 2_000,
      platform: "win32",
      spawn: spawnSlowKiller,
    });

    expect(result.leaderOnlyTermination).toBe(true);
  });

  it("reports incomplete termination when the grace expires before the killer answers", async () => {
    const spawnSilentKiller = ((file: string, args: string[], options: object) =>
      file.endsWith("taskkill.exe")
        ? spawn("/bin/sh", ["-c", "sleep 5"], options)
        : spawn(file, args, options)) as never;

    const result = await runProbe("/bin/sh", ["-c", "sleep 5"], {
      deadlineMs: 50,
      reapGraceMs: 100,
      platform: "win32",
      spawn: spawnSilentKiller,
    });

    // Nothing is known about the tree here, and unknown is not clean.
    expect(result).toEqual({ exitCode: 1, stdout: "", leaderOnlyTermination: true });
  });

  it("kills on Windows through an absolute System32 path", async () => {
    const spawned: string[] = [];
    const recording = ((file: string, args: string[], options: object) => {
      spawned.push(file);
      return spawn(file, args, options);
    }) as never;

    await runProbe("/bin/sh", ["-c", "sleep 5"], {
      deadlineMs: 50,
      reapGraceMs: 100,
      platform: "win32",
      spawn: recording,
    });

    // A bare `taskkill` would resolve against the working directory first.
    expect(spawned[1]).toBe(windowsSystemPath("taskkill.exe"));
    expect(spawned[1]?.startsWith("C:\\") || spawned[1]?.includes(":\\")).toBe(true);
    expect(spawned[1]?.endsWith("\\System32\\taskkill.exe")).toBe(true);
  });
});

describe("windowsSystemPath", () => {
  it("honours SystemRoot when it is set", () => {
    expect(windowsSystemPath("cmd.exe", { SystemRoot: "D:\\Win" })).toBe("D:\\Win\\System32\\cmd.exe");
  });

  it.each([{}, { SystemRoot: "" }, { SystemRoot: "   " }])("falls back to C:\\Windows for %s", (environment) => {
    expect(windowsSystemPath("cmd.exe", environment)).toBe("C:\\Windows\\System32\\cmd.exe");
  });
});

describe("withProbeDeadline", () => {
  it("is strictly looser than the runner's own bound, so it never preempts the reap", () => {
    // Round-3 W1: both were 2,000 ms, so the outer one cancelled the wait for a
    // kill that had already been issued.
    expect(PROBE_OUTER_DEADLINE_MS).toBeGreaterThan(PROBE_DEADLINE_MS + REAP_GRACE_MS);
  });

  it("bounds an injected runner that honours no deadline of its own", async () => {
    await expect(withProbeDeadline(new Promise<never>(() => undefined), 50)).resolves.toEqual({
      exitCode: 1,
      stdout: "",
    });
  });

  it("contains a rejected runner instead of propagating it", async () => {
    await expect(withProbeDeadline(Promise.reject(new Error("boom")))).resolves.toEqual({ exitCode: 1, stdout: "" });
  });

  it("passes a timely answer straight through", async () => {
    await expect(withProbeDeadline(Promise.resolve({ exitCode: 0, stdout: "{}" }))).resolves.toEqual({
      exitCode: 0,
      stdout: "{}",
    });
  });
});
