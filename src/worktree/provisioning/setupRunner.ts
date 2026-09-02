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
  readonly timeoutMs?: number;
}

/** Run the redeemed setup scripts with one aggregate deadline and no command-line interpolation. */
export async function runSetup(input: SetupRunInput, dependencies: SetupRunnerDependencies): Promise<SetupRunResult> {
  const pty = dependencies.pty ?? loadNodePty();
  const platform = dependencies.platform ?? process.platform;
  const stillAuthorized = dependencies.directoryStillAuthorized ?? directoryStillAuthorized;
  const cancellation = createCancellation(dependencies.terminal, dependencies.timeoutMs ?? SETUP_DEADLINE_MS);
  const results: ProvisionSetupResult[] = [];
  let stoppedReason: string | undefined;

  try {
    const opened = await waitForOpen(dependencies.terminal, cancellation);
    if (!opened) {
      stoppedReason = cancellation.reason() ?? "setup terminal was closed";
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
      const stopped = cancellation.reason();
      if (stopped !== undefined) {
        results.push(failed(step, stopped));
        stoppedReason = "previous setup step failed";
        continue;
      }
      const authorized = await waitForAuthorization(stillAuthorized(input.authorization), cancellation);
      if (typeof authorized === "string") {
        results.push(failed(step, authorized));
        stoppedReason = "previous setup step failed";
        continue;
      }
      if (!authorized) {
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
        cancellation,
      });
      results.push(outcome.result);
      if (!outcome.ok) {
        stoppedReason = "previous setup step failed";
      }
    }

    return { steps: results, succeeded: results.every((result) => result.outcome.kind === "ok") };
  } finally {
    cancellation.dispose();
  }
}

interface StepDependencies {
  readonly pty: NodePtyModule;
  readonly terminal: SetupRunTerminal;
  readonly platform: NodeJS.Platform;
  readonly detectShell: () => { shell: string; args: string[] };
  readonly buildEnvironment: () => Record<string, string>;
  readonly cancellation: SetupCancellation;
}

async function runStep(
  step: ProvisionSetupStep,
  input: SetupRunInput,
  dependencies: StepDependencies,
): Promise<{ ok: boolean; reason: string; result: ProvisionSetupResult }> {
  const stopped = dependencies.cancellation.reason();
  if (stopped !== undefined) {
    return { ok: false, reason: stopped, result: failed(step, stopped) };
  }
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
  const settled = await waitForExit(child, dependencies.cancellation);
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
  const environment: Record<string, string> = { ...base };
  for (const [name, port] of Object.entries(input.ports)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !/^(?:ANYWHERE_TERMINAL_|ASIMOV_)/i.test(name)) {
      environment[name] = String(port);
    }
  }
  environment.ANYWHERE_TERMINAL_WORKTREE_PATH = input.worktreePath;
  environment.ANYWHERE_TERMINAL_MAIN_PATH = input.mainPath;
  environment.ANYWHERE_TERMINAL_BRANCH = input.branch;
  if (input.asimovEnvironment) {
    environment.ASIMOV_WORKTREE_PATH = input.worktreePath;
    environment.ASIMOV_MAIN_ROOT = input.mainPath;
    environment.ASIMOV_BRANCH = input.branch;
  }
  return environment;
}

type SetupStopReason = "setup deadline exceeded" | "setup terminal was closed";

type Disposable = { dispose(): void };

interface SetupCancellation {
  reason(): SetupStopReason | undefined;
  onStop(listener: (reason: SetupStopReason) => void): Disposable;
  dispose(): void;
}

function createCancellation(terminal: SetupRunTerminal, timeout: number): SetupCancellation {
  const listeners = new Set<(reason: SetupStopReason) => void>();
  let stopped: SetupStopReason | undefined;
  let closeSubscription: Disposable | undefined;
  const stop = (reason: SetupStopReason): void => {
    if (stopped !== undefined) {
      return;
    }
    stopped = reason;
    for (const listener of listeners) {
      listener(reason);
    }
    listeners.clear();
  };
  const timer = setTimeout(() => stop("setup deadline exceeded"), Math.max(0, timeout));
  closeSubscription = terminal.onClose?.(() => stop("setup terminal was closed"));
  if (stopped !== undefined) {
    closeSubscription?.dispose();
  }
  return {
    reason: () => stopped,
    onStop: (listener) => {
      if (stopped !== undefined) {
        listener(stopped);
        return { dispose: () => undefined };
      }
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    dispose: () => {
      clearTimeout(timer);
      closeSubscription?.dispose();
      listeners.clear();
    },
  };
}

async function waitForOpen(terminal: SetupRunTerminal, cancellation: SetupCancellation): Promise<boolean> {
  let opened: Promise<boolean>;
  try {
    opened = terminal.open();
  } catch {
    return false;
  }
  const result = await waitForBoundary(opened, cancellation);
  return result.kind === "value" && result.value;
}

async function waitForAuthorization(
  authorized: Promise<boolean>,
  cancellation: SetupCancellation,
): Promise<boolean | SetupStopReason> {
  const result = await waitForBoundary(authorized, cancellation);
  return result.kind === "value" ? result.value : result.reason;
}

function waitForBoundary<T>(
  value: Promise<T>,
  cancellation: SetupCancellation,
): Promise<{ kind: "value"; value: T } | { kind: "stopped"; reason: SetupStopReason }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stopSubscription: Disposable | undefined;
    const finish = (result: { kind: "value"; value: T } | { kind: "stopped"; reason: SetupStopReason }): void => {
      if (settled) {
        return;
      }
      settled = true;
      stopSubscription?.dispose();
      resolve(result);
    };
    stopSubscription = cancellation.onStop((reason) => finish({ kind: "stopped", reason }));
    if (settled) {
      stopSubscription.dispose();
      return;
    }
    void value.then(
      (result) => finish({ kind: "value", value: result }),
      (error: unknown) => {
        if (!settled) {
          settled = true;
          stopSubscription?.dispose();
          reject(error);
        }
      },
    );
  });
}

type ProcessSettlement = { kind: "exit"; exitCode: number; signal?: number } | { kind: "timeout" } | { kind: "closed" };

function waitForExit(child: Pty, cancellation: SetupCancellation): Promise<ProcessSettlement> {
  return new Promise((resolve) => {
    let settled = false;
    let exitSubscription: Disposable | undefined;
    let stopSubscription: Disposable | undefined;
    const settle = (result: ProcessSettlement): void => {
      if (settled) {
        return;
      }
      settled = true;
      stopSubscription?.dispose();
      exitSubscription?.dispose();
      resolve(result);
    };
    exitSubscription = child.onExit((event) => settle({ kind: "exit", ...event }));
    if (settled) {
      exitSubscription.dispose();
      return;
    }
    stopSubscription = cancellation.onStop((reason) => {
      safeKill(child);
      settle({ kind: reason === "setup deadline exceeded" ? "timeout" : "closed" });
    });
    if (settled) {
      stopSubscription.dispose();
    }
  });
}

function safeKill(child: Pty): void {
  try {
    child.kill();
  } catch {
    // The process may already have exited; cancellation settlement still wins.
  }
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
