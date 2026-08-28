import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const { CLAUDE_HOOK_COMMAND } = await import("../src/agentHooks/install/ClaudeHookInstaller.ts");
const CLI_TIMEOUT_MS = 60_000;
const OUTPUT_LIMIT_BYTES = 1_048_576;
const EXPECTED_CLI_VERSION = "2.1.250 (Claude Code)";

function fail(message) {
  throw new Error(`Claude inline hook verification failed: ${message}`);
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

async function fingerprint(path) {
  try {
    const contents = await readFile(path);
    return { bytes: contents.length, sha256: sha256(contents) };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { missing: true };
    }
    throw error;
  }
}

function quotePosix(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function run(command, args, { cwd, env, timeoutMs = CLI_TIMEOUT_MS } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let exceededOutput = false;
    let timedOut = false;
    const append = (current, chunk) => {
      const next = current + chunk.toString("utf8");
      if (Buffer.byteLength(next) > OUTPUT_LIMIT_BYTES) {
        exceededOutput = true;
        child.kill("SIGTERM");
      }
      return next;
    };
    const settle = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(deadline);
      resolveRun(result);
    };
    const deadline = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1_000).unref();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.once("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(deadline);
        rejectRun(error);
      }
    });
    child.once("close", (code, signal) => {
      settle({ code, signal, stdout, stderr, timedOut, exceededOutput });
    });
  });
}

async function openRecorder(token) {
  const payloads = [];
  const expectedPrefix = "/inline-hook/";
  const server = createServer((request, response) => {
    const expectedPath = `${expectedPrefix}${token}/claude`;
    if (request.method !== "POST" || request.url !== expectedPath) {
      response.writeHead(404).end();
      return;
    }
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > OUTPUT_LIMIT_BYTES) {
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        const payload = JSON.parse(body);
        if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
          response.writeHead(400).end();
          return;
        }
        payloads.push({ body, payload });
        response.writeHead(204).end();
      } catch {
        response.writeHead(400).end();
      }
    });
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise((resolveClose) => server.close(resolveClose));
    fail("loopback listener did not provide a TCP port");
  }
  return {
    endpoint: `http://127.0.0.1:${address.port}${expectedPrefix}${token}`,
    payloads,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

function hookSettings(command) {
  return {
    hooks: Object.fromEntries(
      ["SessionStart", "Stop"].map((event) => [event, [{ hooks: [{ type: "command", command }] }]]),
    ),
  };
}

function commandFromSettings(settings, event) {
  const handler = settings.hooks?.[event]?.[0]?.hooks?.[0];
  return handler?.type === "command" ? handler.command : undefined;
}

async function main() {
  const commandBytes = Buffer.byteLength(CLAUDE_HOOK_COMMAND);
  const commandHash = sha256(CLAUDE_HOOK_COMMAND);
  const actualUserSettings = join(process.env.HOME ?? "", ".claude", "settings.json");
  const actualUserBefore = await fingerprint(actualUserSettings);
  const cliVersion = await run("claude", ["--version"], { timeoutMs: 10_000 });
  const shellVersion = await run("/bin/sh", ["--version"], { timeoutMs: 10_000 });
  const cliVersionText = cliVersion.stdout.trim();
  const shellVersionText = [shellVersion.stdout, shellVersion.stderr].join("\n").trim();
  if (cliVersion.code !== 0 || cliVersionText !== EXPECTED_CLI_VERSION) {
    fail("installed Claude Code version differs from the pinned 2.1.250 release");
  }

  const scratch = await mkdtemp(join(tmpdir(), "anywhere-terminal-claude-inline-hook-"));
  let recorder;
  try {
    const project = join(scratch, "project");
    const scratchHome = join(scratch, "home");
    const explicitSettings = join(scratch, "explicit-settings.json");
    const projectSettings = join(project, ".claude", "settings.json");
    const localSettings = join(project, ".claude", "settings.local.json");
    const userSettings = join(scratchHome, ".claude", "settings.json");
    const userSentinel = join(scratch, "user-source-fired");
    const localSentinel = join(scratch, "local-source-fired");

    await mkdir(join(project, ".claude"), { recursive: true });
    await mkdir(join(scratchHome, ".claude"), { recursive: true });
    await writeFile(explicitSettings, `${JSON.stringify(hookSettings(CLAUDE_HOOK_COMMAND), null, 2)}\n`);
    await writeFile(projectSettings, `${JSON.stringify({ permissions: { allow: [] } }, null, 2)}\n`);
    await writeFile(localSettings, `${JSON.stringify(hookSettings(`printf %s local > ${quotePosix(localSentinel)}`), null, 2)}\n`);
    await writeFile(userSettings, `${JSON.stringify(hookSettings(`printf %s user > ${quotePosix(userSentinel)}`), null, 2)}\n`);

    const settingsBefore = await Promise.all(
      [explicitSettings, projectSettings, localSettings, userSettings].map(async (path) => [path, await fingerprint(path)]),
    );
    const loadedSettings = JSON.parse(await readFile(explicitSettings, "utf8"));
    for (const event of ["SessionStart", "Stop"]) {
      if (commandFromSettings(loadedSettings, event) !== CLAUDE_HOOK_COMMAND) {
        fail(`explicit ${event} handler is not byte-equal to the exported command`);
      }
    }

    recorder = await openRecorder(randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""));
    const environment = {
      ...process.env,
      ANYWHERE_TERMINAL_CLAUDE_URL: recorder.endpoint,
      CLAUDE_CONFIG_DIR: join(scratchHome, ".claude"),
      HOME: scratchHome,
    };
    const result = await run(
      "claude",
      [
        "--print",
        "--no-session-persistence",
        "--session-id",
        randomUUID(),
        "--setting-sources",
        "project",
        "--settings",
        explicitSettings,
        "Reply with exactly: hook-boundary-ok",
      ],
      { cwd: project, env: environment },
    );
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    if (result.timedOut || result.exceededOutput || result.code !== 0 || result.signal !== null) {
      fail("bounded non-interactive Claude invocation did not exit successfully");
    }
    const actualUserAfter = await fingerprint(actualUserSettings);
    if (JSON.stringify(actualUserBefore) !== JSON.stringify(actualUserAfter)) {
      fail("the real user Claude settings changed");
    }
    for (const [path, before] of settingsBefore) {
      const after = await fingerprint(path);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        fail("a scratch settings source changed");
      }
    }
    for (const sentinel of [userSentinel, localSentinel]) {
      const sentinelState = await fingerprint(sentinel);
      if (!sentinelState.missing) {
        fail("an explicitly excluded settings source fired its sentinel hook");
      }
    }
    const events = recorder.payloads.map(({ payload }) => payload.hook_event_name);
    for (const event of ["SessionStart", "Stop"]) {
      if (!events.includes(event)) {
        fail(`Claude Code did not deliver ${event} through the frozen command`);
      }
    }
    const startup = recorder.payloads.find(({ payload }) => payload.hook_event_name === "SessionStart" && payload.source === "startup");
    if (!startup) {
      fail("SessionStart did not carry Claude Code's startup source");
    }
    for (const { body } of recorder.payloads) {
      if (result.stderr.includes(body)) {
        fail("a lifecycle payload appeared on Claude stderr");
      }
    }
    if (result.stderr.includes(recorder.endpoint) || result.stderr.includes(commandHash)) {
      fail("Claude stderr exposed listener or command verification data");
    }

    console.log(`Claude Code: ${cliVersionText}`);
    console.log(`Shell: /bin/sh ${shellVersionText || "does not support --version"}`);
    console.log(`Command: ${commandBytes} bytes sha256 ${commandHash}`);
    console.log(`Events: ${events.join(", ")}`);
    console.log("Startup probe: SessionStart source=startup");
    console.log("Excluded sources: user and local sentinels did not fire");
    console.log("Settings: scratch and real user settings unchanged; stderr carried no payload");
  } finally {
    if (recorder) {
      await recorder.close();
    }
    await rm(scratch, { recursive: true, force: true });
  }
}

await main();
