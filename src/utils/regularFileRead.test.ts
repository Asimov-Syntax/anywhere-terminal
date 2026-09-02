// src/utils/regularFileRead.test.ts — against a REAL filesystem, because every
// obligation here is one: a named pipe, a hard link and a permission bit are
// exactly what a fake models badly, and modelling them badly is how a witness
// passes over a broken implementation.

import { execFile } from "node:child_process";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openRegularFile, readFlags } from "./regularFileRead";

const run = promisify(execFile);
const posixOnly = process.platform === "win32" ? it.skip : it;

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "rfr-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/** A pipe with nothing on the other end — the object whose open never returns. */
async function pipe(name: string): Promise<string> {
  const at = path.join(root, name);
  await run("mkfifo", [at]);
  return at;
}

/**
 * Every witness for a blocking object runs against a clock.
 *
 * A regression here does not fail — it HANGS, and a hung worker reports as a
 * timeout on whatever test the runner blames next. The race turns that into an
 * assertion on this test.
 */
async function within<T>(work: Promise<T>, ms = 3000): Promise<T | "waited"> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<"waited">((resolve) => {
        timer = setTimeout(() => resolve("waited"), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function textOf(at: string): Promise<string> {
  const handle = await openRegularFile(at);
  try {
    const buf = Buffer.alloc(64);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

describe("what the flags compose to", () => {
  it("asks for nonblocking where the platform has it", () => {
    expect(readFlags({ O_RDONLY: 0, O_NONBLOCK: 4 })).toBe(4);
  });

  // win32 defines no `O_NONBLOCK`, and this is the only way to witness that arm
  // on the platform CI runs. What holds there is the handle test, not the flag:
  // a Windows named pipe lives in `\\.\pipe\` and no repository-contained
  // pathname reaches one (design.md D3).
  it("degrades to a plain read where the platform has not", () => {
    expect(readFlags({ O_RDONLY: 0 })).toBe(0);
  });

  it("keeps the platform's own read-only bit rather than assuming zero", () => {
    expect(readFlags({ O_RDONLY: 1, O_NONBLOCK: 4 })).toBe(5);
  });

  it("composes the constants this host actually ships", () => {
    expect(readFlags(constants)).toBe(constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  });
});

describe("an object that is not an ordinary file", () => {
  posixOnly("refuses a pipe nothing is writing to, rather than waiting for one", async () => {
    const at = await pipe("waiting");

    const outcome = await within(
      openRegularFile(at)
        .then(() => "opened" as const)
        .catch((e) => e),
    );

    expect(outcome).not.toBe("waited");
    expect((outcome as NodeJS.ErrnoException).code).toBe("ENOTSUP");
  });

  // A pipe WITH a writer opens promptly even without the flag, so the flag alone
  // would let this one through and read a stream as a configuration. The handle
  // test is what refuses it, and refusing both keeps the answer independent of
  // whether anyone happens to be writing (design.md D1).
  posixOnly("refuses a pipe that something IS writing to", async () => {
    const at = await pipe("busy");
    const writer = fs.open(at, "w");

    await expect(openRegularFile(at)).rejects.toMatchObject({ code: "ENOTSUP" });

    await (await writer).close();
  });

  it("refuses a directory", async () => {
    const at = path.join(root, "adir");
    await fs.mkdir(at);

    await expect(openRegularFile(at)).rejects.toMatchObject({ code: "ENOTSUP" });
  });

  it("leaves absence to the caller, with its errno intact", async () => {
    await expect(openRegularFile(path.join(root, "nothing"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("an ordinary file, however it is named", () => {
  it("reads a plain one", async () => {
    const at = path.join(root, "plain");
    await fs.writeFile(at, "copy:\n", "utf8");

    expect(await textOf(at)).toBe("copy:\n");
  });

  // A hard link IS a regular file, and a repository that keeps one configuration
  // under two names is not doing anything this bound is aimed at.
  it("reads through a hard link", async () => {
    const at = path.join(root, "linked");
    await fs.writeFile(at, "copy:\n", "utf8");
    const other = path.join(root, "other");
    await fs.link(at, other);

    expect(await textOf(other)).toBe("copy:\n");
  });

  // `open` follows the link before `fstat` sees anything, so what is tested is
  // the TARGET's type. Containment is decided elsewhere and before this call.
  it("reads through a symlink to one", async () => {
    const at = path.join(root, "target");
    await fs.writeFile(at, "copy:\n", "utf8");
    const link = path.join(root, "pointer");
    await fs.symlink(at, link);

    expect(await textOf(link)).toBe("copy:\n");
  });

  posixOnly("refuses a symlink whose target is a pipe, since the target is what opens", async () => {
    const at = await pipe("pointed-at");
    const link = path.join(root, "pointer");
    await fs.symlink(at, link);

    const outcome = await within(
      openRegularFile(link)
        .then(() => "opened" as const)
        .catch((e) => e),
    );

    expect(outcome).not.toBe("waited");
    expect((outcome as NodeJS.ErrnoException).code).toBe("ENOTSUP");
  });
});

describe("the injected open", () => {
  it("is used instead of the module's own, so a caller keeps its dependencies", async () => {
    const at = path.join(root, "injected");
    await fs.writeFile(at, "copy:\n", "utf8");
    const asked: number[] = [];

    const handle = await openRegularFile(at, async (p, flags) => {
      asked.push(flags as number);
      return fs.open(p as string, flags as number);
    });
    await handle.close();

    expect(asked).toEqual([readFlags(constants)]);
  });

  it("closes the handle it refuses, rather than leaking it", async () => {
    const at = path.join(root, "adir");
    await fs.mkdir(at);
    let closed = false;

    await expect(
      openRegularFile(at, async (p, flags) => {
        const handle = await fs.open(p as string, flags as number);
        const close = handle.close.bind(handle);
        handle.close = async () => {
          closed = true;
          return close();
        };
        return handle;
      }),
    ).rejects.toMatchObject({ code: "ENOTSUP" });

    expect(closed).toBe(true);
  });
});
