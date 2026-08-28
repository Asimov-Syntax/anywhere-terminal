import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLAUDE_HOOK_EVENTS } from "../agents/claude";
import { CLAUDE_HOOK_COMMAND, ClaudeHookInstaller } from "./ClaudeHookInstaller";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "claude-hooks-"));
  directories.push(directory);
  return { directory, path: join(directory, "settings.json") };
}

describe("ClaudeHookInstaller", () => {
  it("snapshots the destination once per operation and writes the exact D7 command", async () => {
    const { directory, path } = await fixture();
    let calls = 0;
    const installer = new ClaudeHookInstaller({
      configuredDirectory: () => {
        calls += 1;
        return directory;
      },
    });
    await expect(installer.install()).resolves.toEqual({ installed: true });
    expect(calls).toBe(1);
    const document = JSON.parse(await readFile(path, "utf8"));
    expect(document.hooks[CLAUDE_HOOK_EVENTS[0]][0].hooks[0].command).toBe(CLAUDE_HOOK_COMMAND);
  });

  it("refuses a symlink and malformed document byte-for-byte", async () => {
    const { directory, path } = await fixture();
    const target = join(directory, "target.json");
    await writeFile(target, "{ broken");
    await symlink(target, path);
    const installer = new ClaudeHookInstaller({ configuredDirectory: () => directory });
    await expect(installer.install()).resolves.toEqual({ installed: false, reason: "unsupported-config" });
    expect(await readFile(target, "utf8")).toBe("{ broken");
  });

  it("refuses ownership conflicts without rewriting bytes", async () => {
    const { directory, path } = await fixture();
    const contents =
      '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"true","timeout":2}]}]}}';
    await writeFile(path, contents);
    const installer = new ClaudeHookInstaller({ configuredDirectory: () => directory, command: "true" });
    await expect(installer.install()).resolves.toEqual({ installed: false, reason: "ownership-conflict" });
    expect(await readFile(path, "utf8")).toBe(contents);
  });

  it("removes current-destination handlers only", async () => {
    const { directory, path } = await fixture();
    const installer = new ClaudeHookInstaller({ configuredDirectory: () => directory });
    await installer.install();
    await expect(installer.uninstall()).resolves.toEqual({ removed: true });
    expect(await readFile(path, "utf8")).not.toContain(CLAUDE_HOOK_COMMAND);
  });

  it("serializes concurrent installers and leaves one exact handler per event", async () => {
    const { directory, path } = await fixture();
    const first = new ClaudeHookInstaller({ configuredDirectory: () => directory, command: "true" });
    const second = new ClaudeHookInstaller({ configuredDirectory: () => directory, command: "true" });
    await expect(Promise.all([first.install(), second.install()])).resolves.toEqual([
      { installed: true },
      { installed: true },
    ]);
    const contents = await readFile(path, "utf8");
    expect(contents.match(/"command": "true"/g) ?? []).toHaveLength(CLAUDE_HOOK_EVENTS.length);
  });

  it("does not reclaim a live lock or mutate its document", async () => {
    const { directory, path } = await fixture();
    const lock = `${path}.anywhere-terminal.lock`;
    await writeFile(path, "{}\n");
    await writeFile(lock, "held");
    const installer = new ClaudeHookInstaller(
      { configuredDirectory: () => directory },
      { sleep: async () => undefined },
    );
    await expect(installer.install()).resolves.toEqual({ installed: false, reason: "lock-unavailable" });
    expect(await readFile(path, "utf8")).toBe("{}\n");
    expect(await readFile(lock, "utf8")).toBe("held");
  });

  it("preserves mode atomically and reports lock-release residue after a commit", async () => {
    const { directory, path } = await fixture();
    await writeFile(path, "{}\n");
    await chmod(path, 0o640);
    const installer = new ClaudeHookInstaller(
      { configuredDirectory: () => directory },
      {
        fs: {
          unlink: async (file) => {
            if (String(file).endsWith(".anywhere-terminal.lock")) {
              throw Object.assign(new Error("held"), { code: "EACCES" });
            }
          },
        },
      },
    );
    await expect(installer.install()).resolves.toEqual({
      installed: true,
      unresolved: [`${path}.anywhere-terminal.lock`],
    });
    expect((await stat(path)).mode & 0o777).toBe(0o640);
  });

  it("performs no I/O on Windows", async () => {
    const readFile = vi.fn();
    const installer = new ClaudeHookInstaller({ platform: "win32" }, { fs: { readFile } });
    await expect(installer.install()).resolves.toEqual({ installed: false, reason: "unsupported-platform" });
    await expect(installer.uninstall()).resolves.toEqual({ removed: false, reason: "unsupported-platform" });
    expect(readFile).not.toHaveBeenCalled();
  });
});

/** Runs the exact D7 literal through the real POSIX shell selected by Claude Code. */
function runD7(
  input: string,
  env: NodeJS.ProcessEnv,
  script = CLAUDE_HOOK_COMMAND,
): Promise<{ stdout: string; stderr: string; code: number | null; ms: number }> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const child = spawn("/bin/sh", ["-c", script], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code, ms: Date.now() - start }));
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });
}

interface CapturedRequest {
  url: string;
  method: string;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

async function withHttpListener<T>(run: (port: number, requests: CapturedRequest[]) => Promise<T>): Promise<T> {
  const requests: CapturedRequest[] = [];
  const server = createHttpServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push({ url: req.url ?? "", method: req.method ?? "", body, headers: req.headers });
      res.writeHead(200);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected a bound TCP address");
    }
    return await run(address.port, requests);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function token(): string {
  return randomBytes(32).toString("hex");
}
function loopbackUrl(port: number, segment: string, tokenValue = token()): string {
  return `http://127.0.0.1:${port}/${encodeURIComponent(segment)}/${tokenValue}`;
}

/** Binds an ephemeral loopback port, then releases it so nothing listens there. */
async function freeLoopbackPort(): Promise<number> {
  const server = createHttpServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a bound TCP address");
  }
  const { port } = address;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe("D7 frozen POSIX command", () => {
  it("drains stdin and emits neutral output when coordinates are absent", async () => {
    const result = await runD7('{"event":"Stop"}', { ANYWHERE_TERMINAL_CLAUDE_URL: "" });
    expect(result.stdout).toBe("{}\n");
    expect(result.code).toBe(0);
  });

  it("delivers a payload with a generic encodeURIComponent session segment and lowercase 64-hex token", async () => {
    const payload = '{"event":"SessionStart","transcript_path":"/tmp/x"}';
    await withHttpListener(async (port, requests) => {
      const url = loopbackUrl(port, "session déjà-vu/42 (v1)!'");
      const result = await runD7(payload, { ANYWHERE_TERMINAL_CLAUDE_URL: url });
      expect(result.stdout).toBe("{}\n");
      expect(result.code).toBe(0);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.method).toBe("POST");
      expect(requests[0]?.body).toBe(payload);
      expect(requests[0]?.url).toBe(`${new URL(url).pathname}/claude`);
    });
  });

  it("makes no request and drains when CLAUDE_JOB_DIR is non-empty, even with valid coordinates", async () => {
    await withHttpListener(async (port, requests) => {
      const url = loopbackUrl(port, "background-job");
      const result = await runD7('{"event":"Stop"}', {
        ANYWHERE_TERMINAL_CLAUDE_URL: url,
        CLAUDE_JOB_DIR: "/tmp/some-job",
      });
      expect(result.stdout).toBe("{}\n");
      expect(result.code).toBe(0);
      expect(requests).toHaveLength(0);
    });
  });

  it("rejects a malformed percent-escape in the session segment and sends nothing", async () => {
    await withHttpListener(async (port, requests) => {
      const url = `http://127.0.0.1:${port}/bad%2gsegment/${token()}`;
      const result = await runD7('{"event":"Stop"}', { ANYWHERE_TERMINAL_CLAUDE_URL: url });
      expect(result.stdout).toBe("{}\n");
      expect(result.code).toBe(0);
      expect(requests).toHaveLength(0);
    });
  });

  it.each([0, 65536, -1])("rejects an out-of-range decimal port %i and sends nothing", async (port) => {
    await withHttpListener(async (listenerPort, requests) => {
      const url = `http://127.0.0.1:${port}/segment/${token()}`;
      const result = await runD7('{"event":"Stop"}', { ANYWHERE_TERMINAL_CLAUDE_URL: url });
      expect(result.stdout).toBe("{}\n");
      expect(result.code).toBe(0);
      expect(requests).toHaveLength(0);
      void listenerPort;
    });
  });

  it("rejects a non-decimal port and sends nothing", async () => {
    await withHttpListener(async (port, requests) => {
      const url = `http://127.0.0.1:abc/segment/${token()}`;
      const result = await runD7('{"event":"Stop"}', { ANYWHERE_TERMINAL_CLAUDE_URL: url });
      expect(result.stdout).toBe("{}\n");
      expect(result.code).toBe(0);
      expect(requests).toHaveLength(0);
      void port;
    });
  });

  it.each([
    "A".repeat(64),
    "0".repeat(63),
    "0".repeat(65),
  ])("rejects a malformed runtime token %s and sends nothing", async (badToken) => {
    await withHttpListener(async (port, requests) => {
      const url = loopbackUrl(port, "segment", badToken);
      const result = await runD7('{"event":"Stop"}', { ANYWHERE_TERMINAL_CLAUDE_URL: url });
      expect(result.stdout).toBe("{}\n");
      expect(result.code).toBe(0);
      expect(requests).toHaveLength(0);
    });
  });

  it("rejects a non-HTTP scheme and sends nothing", async () => {
    await withHttpListener(async (port, requests) => {
      const url = `https://127.0.0.1:${port}/segment/${token()}`;
      const result = await runD7('{"event":"Stop"}', { ANYWHERE_TERMINAL_CLAUDE_URL: url });
      expect(result.stdout).toBe("{}\n");
      expect(result.code).toBe(0);
      expect(requests).toHaveLength(0);
    });
  });

  it("rejects a non-loopback host and sends nothing", async () => {
    await withHttpListener(async (port, requests) => {
      const url = `http://localhost:${port}/segment/${token()}`;
      const result = await runD7('{"event":"Stop"}', { ANYWHERE_TERMINAL_CLAUDE_URL: url });
      expect(result.stdout).toBe("{}\n");
      expect(result.code).toBe(0);
      expect(requests).toHaveLength(0);
    });
  });

  it("drains without a request when the loopback port has no listener", async () => {
    const url = loopbackUrl(await freeLoopbackPort(), "no-listener");
    const result = await runD7('{"event":"Stop"}', { ANYWHERE_TERMINAL_CLAUDE_URL: url });
    expect(result.stdout).toBe("{}\n");
    expect(result.code).toBe(0);
    expect(result.ms).toBeLessThan(2000);
  });

  it("bounds a black-hole listener within max-time and exits 0", async () => {
    const sockets = new Set<import("node:net").Socket>();
    const server = createNetServer((socket) => {
      sockets.add(socket);
      socket.on("error", () => undefined);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("expected a bound TCP address");
      }
      const url = loopbackUrl(address.port, "black-hole");
      const result = await runD7('{"event":"Stop"}', { ANYWHERE_TERMINAL_CLAUDE_URL: url });
      expect(result.stdout).toBe("{}\n");
      expect(result.code).toBe(0);
      expect(result.ms).toBeGreaterThanOrEqual(1400);
      expect(result.ms).toBeLessThan(2000);
    } finally {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("ignores inherited PATH, hostile shell functions, and command lookup failure via command -p", async () => {
    const sentinel = join((await fixture()).directory, "sentinel");
    const hostileFunctions = ["cat", "awk", "curl", "printf", "read"]
      .map((name) => `${name}() { echo hijacked >> '${sentinel}'; }`)
      .join("; ");
    await withHttpListener(async (port, requests) => {
      const payload = '{"event":"Stop"}';
      const url = loopbackUrl(port, "path-hijack");
      const result = await runD7(
        payload,
        { ANYWHERE_TERMINAL_CLAUDE_URL: url, PATH: "/nonexistent/hostile/path" },
        `${hostileFunctions}; ${CLAUDE_HOOK_COMMAND}`,
      );
      expect(result.stdout).toBe("{}\n");
      expect(result.code).toBe(0);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.body).toBe(payload);
    });
    await expect(readFile(sentinel, "utf8").catch(() => "")).resolves.toBe("");
  });

  it("bypasses ambient proxy variables via --noproxy '*'", async () => {
    await withHttpListener(async (port, requests) => {
      const payload = '{"event":"Stop"}';
      const url = loopbackUrl(port, "proxy-bypass");
      const result = await runD7(payload, {
        ANYWHERE_TERMINAL_CLAUDE_URL: url,
        http_proxy: "http://127.0.0.1:1/",
        https_proxy: "http://127.0.0.1:1/",
        ALL_PROXY: "http://127.0.0.1:1/",
      });
      expect(result.stdout).toBe("{}\n");
      expect(result.code).toBe(0);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.body).toBe(payload);
    });
  });

  it("ignores curl startup files via --disable", async () => {
    const { directory } = await fixture();
    await writeFile(join(directory, ".curlrc"), 'header = "x-hijacked: 1"\n');
    await withHttpListener(async (port, requests) => {
      const payload = '{"event":"Stop"}';
      const url = loopbackUrl(port, "curlrc-bypass");
      const result = await runD7(payload, { ANYWHERE_TERMINAL_CLAUDE_URL: url, HOME: directory, CURL_HOME: directory });
      expect(result.stdout).toBe("{}\n");
      expect(result.code).toBe(0);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.body).toBe(payload);
      expect(requests[0]?.headers["x-hijacked"]).toBeUndefined();
    });
  });

  it("keeps no payload in stderr trace after entry despite inherited tracing", async () => {
    const payload = '{"event":"Stop","secret":"do-not-leak"}';
    const traced = `set -x; ${CLAUDE_HOOK_COMMAND}`;
    const result = await runD7(payload, { ANYWHERE_TERMINAL_CLAUDE_URL: "" }, traced);
    expect(result.stdout).toBe("{}\n");
    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain("do-not-leak");
  });

  it("ignores a broken stdout pipe via trap PIPE and still exits 0", async () => {
    const child = spawn("/bin/sh", ["-c", CLAUDE_HOOK_COMMAND], {
      env: { ANYWHERE_TERMINAL_CLAUDE_URL: "" },
      stdio: ["pipe", "pipe", "ignore"],
    });
    child.stdout.destroy();
    child.stdin.on("error", () => undefined);
    const exit = new Promise<number | null>((resolve) => child.on("close", resolve));
    child.stdin.end('{"event":"Stop"}');
    await expect(exit).resolves.toBe(0);
  });

  it("ignores an internal EPIPE when curl exits before a large payload finishes writing", async () => {
    const url = loopbackUrl(await freeLoopbackPort(), "epipe");
    const result = await runD7("x".repeat(2_000_000), { ANYWHERE_TERMINAL_CLAUDE_URL: url });
    expect(result.stdout).toBe("{}\n");
    expect(result.code).toBe(0);
  });
});
