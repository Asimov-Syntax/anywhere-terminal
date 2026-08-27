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
