import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { CURSOR_HOOK_COMMAND } from "../src/cursor/CursorHookInstaller.ts";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function optionalHash(path) {
  try {
    return sha256(await readFile(path));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function run(file, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs);
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr, stdout });
    });
  });
}

const workspace = await mkdtemp(join(tmpdir(), "cursor-inline-spike-"));
const userConfig = join(homedir(), ".cursor", "hooks.json");
const userHashBefore = await optionalHash(userConfig);
const startupMarker = join(workspace, "shell-startup-ran.txt");
const startupFile = join(workspace, "bash-env.sh");
const bodies = [];
const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => {
    body += String(chunk);
  });
  request.on("end", () => {
    bodies.push(body);
    response.writeHead(204).end();
  });
});

try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("listener did not expose a TCP port");
  }

  const sessionId = randomUUID();
  const token = randomBytes(32).toString("hex");
  const url = `http://127.0.0.1:${address.port}/${sessionId}/${token}`;
  const cursorDirectory = join(workspace, ".cursor");
  await mkdir(cursorDirectory, { recursive: true });
  await writeFile(startupFile, `printf 'sourced\\n' >> '${startupMarker}'\n`);
  const projectConfig = join(cursorDirectory, "hooks.json");
  await writeFile(
    projectConfig,
    `${JSON.stringify(
      {
        version: 1,
        hooks: {
          sessionStart: [{ command: CURSOR_HOOK_COMMAND, timeout: 2 }],
          sessionEnd: [{ command: CURSOR_HOOK_COMMAND, timeout: 2 }],
        },
      },
      null,
      2,
    )}\n`,
  );
  const projectHashBefore = await optionalHash(projectConfig);

  const version = await run("cursor-agent", ["--version"], { timeoutMs: 10_000 });
  if (version.code !== 0) {
    throw new Error(`cursor-agent --version exited ${version.code}`);
  }
  const shell = await run("/bin/sh", ["--version"], { timeoutMs: 10_000 });
  const agent = await run("cursor-agent", ["--trust", "-p", "say the word PONG and nothing else"], {
    cwd: workspace,
    env: {
      ANYWHERE_TERMINAL_CURSOR_URL: url,
      BASH_ENV: startupFile,
      "BASH_FUNC_awk%%": "() { printf 'imported-awk-function\\n' >&2; return 1; }",
      "BASH_FUNC_command%%": "() { printf 'imported-command-function\\n' >&2; return 1; }",
      SHELLOPTS: "xtrace",
    },
    timeoutMs: 120_000,
  });
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (agent.code !== 0) {
    throw new Error(`cursor-agent exited ${agent.code}: ${agent.stderr.slice(0, 500)}`);
  }
  if (/imported-(?:awk|command)-function/.test(agent.stderr)) {
    throw new Error("the hook executed an inherited utility function");
  }
  if (agent.stderr.includes('"hook_event_name"')) {
    throw new Error("the hook payload appeared in traced stderr");
  }

  const events = bodies.map((body) => {
    const parsed = JSON.parse(body);
    return typeof parsed.hook_event_name === "string" ? parsed.hook_event_name : "<missing>";
  });
  for (const required of ["sessionStart", "sessionEnd"]) {
    if (!events.includes(required)) {
      throw new Error(`real Cursor Agent did not deliver ${required}; received ${events.join(", ")}`);
    }
  }
  if ((await optionalHash(projectConfig)) !== projectHashBefore) {
    throw new Error("cursor-agent changed the scratch project hook configuration");
  }
  if ((await optionalHash(userConfig)) !== userHashBefore) {
    throw new Error("cursor-agent changed the user's ~/.cursor/hooks.json");
  }

  let startupSourced = false;
  try {
    startupSourced = (await readFile(startupMarker, "utf8")).length > 0;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  console.log(
    JSON.stringify(
      {
        agentExitCode: agent.code,
        commandBytes: Buffer.byteLength(CURSOR_HOOK_COMMAND),
        commandSha256: sha256(CURSOR_HOOK_COMMAND),
        cursorAgentVersion: version.stdout.trim(),
        deliveredEvents: [...new Set(events)],
        projectConfigUnchanged: true,
        shellStartupFileSourced: startupSourced,
        shellVersion: (shell.stdout || shell.stderr).trim().split("\n")[0],
        userConfigState: userHashBefore === undefined ? "absent-before-and-after" : "sha256-unchanged",
      },
      null,
      2,
    ),
  );
} finally {
  await new Promise((resolve) => server.close(() => resolve()));
  await rm(workspace, { recursive: true, force: true });
}
