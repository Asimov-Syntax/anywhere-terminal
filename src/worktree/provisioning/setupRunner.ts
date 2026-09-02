import type { NodePtyModule, Pty } from "../../pty/PtyManager";
import { buildEnvironment, detectShell, loadNodePty } from "../../pty/PtyManager";
import type { ProvisionSetupResult, ProvisionSetupStep } from "../../types/messages";
import { type AuthorizedDirectory, directoryStillAuthorized } from "../../utils/authorizedDirectory";
import { messageOf } from "../errorMessage";

const SETUP_DEADLINE_MS = 2 * 60 * 60 * 1000;

export interface SetupRunInput {
  readonly repoId: string;
  readonly mainPath: string;
  readonly worktreeId: string;
  readonly worktreePath: string;
  readonly branch: string;
  readonly steps: readonly ProvisionSetupStep[];
  readonly asimovEnvironment: boolean;
  readonly ports: Readonly<Record<string, number>>;
  readonly authorization: AuthorizedDirectory;
}

export interface SetupRunResult {
  readonly steps: readonly ProvisionSetupResult[];
  readonly succeeded: boolean;
}

export interface SetupRunTerminal {
  /** Creates and shows the pseudoterminal, resolving only once VS Code opens its write sink. */
  open(): Promise<boolean>;
  /** Starts forwarding one child to the terminal. */
  attach(child: Pty): void;
  /** Called when VS Code closes the pseudoterminal. */
  onClose?(listener: () => void): { dispose(): void };
}

export interface SetupRunnerDependencies {
  readonly pty?: NodePtyModule;
  readonly terminal: SetupRunTerminal;
  readonly platform?: NodeJS.Platform;
  readonly detectShell?: () => { shell: string; args: string[] };
  readonly buildEnvironment?: () => Record<string, string>;
  readonly directoryStillAuthorized?: (authorization: AuthorizedDirectory) => Promise<boolean>;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

/** Run the redeemed setup scripts with one aggregate deadline and no command-line interpolation. */
export async function runSetup(input: SetupRunInput, dependencies: SetupRunnerDependencies): Promise<SetupRunResult> {
  const pty = dependencies.pty ?? loadNodePty();
  const platform = dependencies.platform ?? process.platform;
  const stillAuthorized = dependencies.directoryStillAuthorized ?? directoryStillAuthorized;
  const now = dependencies.now ?? Date.now;
  const deadline = now() + (dependencies.timeoutMs ?? SETUP_DEADLINE_MS);
  const results: ProvisionSetupResult[] = [];
  let stoppedReason: string | undefined;

  const opened = await waitForOpen(dependencies.terminal, Math.max(0, deadline - now()));
  if (!opened) {
    stoppedReason = now() >= deadline ? "setup deadline exceeded" : "setup terminal was closed";
  }

  for (const step of input.steps) {
    if (stoppedReason !== undefined) {
      results.push(
        skipped(
          step,
          stoppedReason === "previous setup step failed" ? stoppedReason : `setup stopped: ${stoppedReason}`,
        ),
      );
      continue;
    }
    if (now() >= deadline) {
      stoppedReason = "setup deadline exceeded";
      results.push(failed(step, stoppedReason));
      continue;
    }
    if (!(await stillAuthorized(input.authorization))) {
      stoppedReason = "worktree directory is no longer authorized";
      results.push(failed(step, stoppedReason));
      continue;
    }

    const outcome = await runStep(step, input, {
      pty,
      terminal: dependencies.terminal,
      platform,
      detectShell: dependencies.detectShell ?? detectShell,
      buildEnvironment: dependencies.buildEnvironment ?? buildEnvironment,
      now,
      deadline,
    });
    results.push(outcome.result);
    if (!outcome.ok) {
      stoppedReason = "previous setup step failed";
    }
  }

  return { steps: results, succeeded: results.every((result) => result.outcome.kind === "ok") };
}

interface StepDependencies {
  readonly pty: NodePtyModule;
  readonly terminal: SetupRunTerminal;
  readonly platform: NodeJS.Platform;
  readonly detectShell: () => { shell: string; args: string[] };
  readonly buildEnvironment: () => Record<string, string>;
  readonly now: () => number;
  readonly deadline: number;
}

async function runStep(
  step: ProvisionSetupStep,
  input: SetupRunInput,
  dependencies: StepDependencies,
): Promise<{ ok: boolean; reason: string; result: ProvisionSetupResult }> {
  const command = commandFor(step.script, dependencies.platform, dependencies.detectShell);
  let child: Pty;
  try {
    child = dependencies.pty.spawn(command.file, command.args, {
      cwd: input.worktreePath,
      env: setupEnvironment(input, dependencies.buildEnvironment()),
    });
  } catch (error) {
    const reason = `could not start: ${messageOf(error)}`;
    return { ok: false, reason, result: failed(step, reason) };
  }

  dependencies.terminal.attach(child);
  const settled = await waitForExit(
    child,
    dependencies.terminal,
    Math.max(0, dependencies.deadline - dependencies.now()),
  );
  if (settled.kind === "exit" && settled.exitCode === 0 && settled.signal === undefined) {
    return { ok: true, reason: "", result: ok(step) };
  }
  let reason: string;
  if (settled.kind === "timeout") {
    reason = "setup deadline exceeded";
  } else if (settled.kind === "closed") {
    reason = "setup terminal was closed";
  } else if (settled.signal !== undefined) {
    reason = `terminated by signal ${settled.signal}`;
  } else {
    reason = `exited with code ${settled.exitCode}`;
  }
  return { ok: false, reason, result: failed(step, reason) };
}

function commandFor(
  script: string,
  platform: NodeJS.Platform,
  shell: () => { shell: string; args: string[] },
): { file: string; args: string[] } {
  if (platform === "win32") {
    return {
      file: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    };
  }
  const detected = shell();
  return { file: detected.shell, args: [...detected.args, "-c", script] };
}

function setupEnvironment(input: SetupRunInput, base: Record<string, string>): Record<string, string> {
  const environment: Record<string, string> = {
    ...base,
    ANYWHERE_TERMINAL_WORKTREE_PATH: input.worktreePath,
    ANYWHERE_TERMINAL_MAIN_PATH: input.mainPath,
    ANYWHERE_TERMINAL_BRANCH: input.branch,
  };
  for (const [name, port] of Object.entries(input.ports)) {
    environment[name] = String(port);
  }
  if (input.asimovEnvironment) {
    environment.ASIMOV_WORKTREE_PATH = input.worktreePath;
    environment.ASIMOV_MAIN_ROOT = input.mainPath;
    environment.ASIMOV_BRANCH = input.branch;
  }
  return environment;
}

function waitForOpen(terminal: SetupRunTerminal, timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (opened: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(opened);
    };
    const timer = setTimeout(() => settle(false), timeout);
    try {
      void terminal.open().then(settle, () => settle(false));
    } catch {
      settle(false);
    }
  });
}

type ProcessSettlement = { kind: "exit"; exitCode: number; signal?: number } | { kind: "timeout" } | { kind: "closed" };

function waitForExit(child: Pty, terminal: SetupRunTerminal, timeout: number): Promise<ProcessSettlement> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let exitSubscription: { dispose(): void } | undefined;
    let closeSubscription: { dispose(): void } | undefined;
    const settle = (result: ProcessSettlement): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      closeSubscription?.dispose();
      exitSubscription?.dispose();
      resolve(result);
    };
    exitSubscription = child.onExit((event) => settle({ kind: "exit", ...event }));
    if (settled) {
      exitSubscription.dispose();
      return;
    }
    closeSubscription = terminal.onClose?.(() => {
      child.kill();
      settle({ kind: "closed" });
    });
    if (settled) {
      closeSubscription?.dispose();
      return;
    }
    timer = setTimeout(() => {
      child.kill();
      settle({ kind: "timeout" });
    }, timeout);
  });
}

function ok(step: ProvisionSetupStep): ProvisionSetupResult {
  return { id: step.id, source: step.source, script: step.script, outcome: { kind: "ok" } };
}

function failed(step: ProvisionSetupStep, reason: string): ProvisionSetupResult {
  return { id: step.id, source: step.source, script: step.script, outcome: { kind: "failed", reason } };
}

function skipped(step: ProvisionSetupStep, reason: string): ProvisionSetupResult {
  return { id: step.id, source: step.source, script: step.script, outcome: { kind: "skipped", reason } };
}
