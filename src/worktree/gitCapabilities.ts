// src/worktree/gitCapabilities.ts — What this git can do, and for how long we believe it.
// See: asimov/changes/enumerate-git-worktrees/design.md D2, D7, D8
//      docs/research/20260826-orca-git-worktree-mechanics.md § 1, § 3

import type { GitCommandResult, GitCommandRunner } from "./gitCommandRunner";

export type GitCapability = "worktree-list-z" | "rev-parse-path-format";

/**
 * A negative answer expires: the realistic mid-session move is a git *upgrade*,
 * by the user we just told their git was too old. Positives are permanent.
 */
export const GIT_CAPABILITY_RETRY_INTERVAL_MS = 30 * 60_000;

export const MIN_GIT_MAJOR = 2;
export const MIN_GIT_MINOR = 31;

export type GitVersionOutcome =
  | { kind: "supported"; version: string }
  | { kind: "unsupported"; version: string; reason: string }
  | { kind: "absent"; reason: string };

export type CapabilityAttempt<T> = { supported: true; value: T } | { supported: false };

export interface GitCapabilities {
  probeVersion(): Promise<GitVersionOutcome>;
  runWithFallback<T>(
    capability: GitCapability,
    preferred: () => Promise<CapabilityAttempt<T>>,
    fallback: () => Promise<T>,
  ): Promise<T>;
}

/**
 * `-z` rejection. Exit 129 is git's usage-error code and is locale-independent;
 * the message regex is only a backup for a git that reports it some other way.
 */
export function isUnsupportedZResult(result: GitCommandResult): boolean {
  if (result.code === 129) {
    return true;
  }
  return /(?:unknown|invalid|unrecognized) (?:switch|option).*`?-?z'?/i.test(result.stderr);
}

/**
 * `--path-format` rejection. Old git exits 0 and echoes the flag as an output
 * line, so exit status proves nothing here.
 */
export function hasUnsupportedPathFormatEcho(stdout: Buffer | string): boolean {
  const text = Buffer.isBuffer(stdout) ? stdout.toString("utf8") : stdout;
  return text.split(/\r?\n/).some((line) => line.startsWith("--path-format"));
}

function parseVersion(stdout: Buffer): { version: string; major: number; minor: number } | null {
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(stdout.toString("utf8"));
  if (!match) {
    return null;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return { version: match[3] ? `${major}.${minor}.${match[3]}` : `${major}.${minor}`, major, minor };
}

function isNegative(outcome: GitVersionOutcome): boolean {
  return outcome.kind !== "supported";
}

export function createGitCapabilities(runner: GitCommandRunner, now: () => number = Date.now): GitCapabilities {
  let versionOutcome: GitVersionOutcome | null = null;
  let versionRetryAfter = 0;
  let versionInFlight: Promise<GitVersionOutcome> | null = null;

  const unsupportedUntil = new Map<GitCapability, number>();
  const inFlight = new Map<GitCapability, Promise<unknown>>();

  async function probeVersionOnce(): Promise<GitVersionOutcome> {
    const result = await runner.run(["--version"], process.cwd());
    if (result.failedToSpawn || result.code !== 0) {
      return { kind: "absent", reason: "No usable `git` executable was found." };
    }
    const parsed = parseVersion(result.stdout);
    if (!parsed) {
      return { kind: "absent", reason: "Could not read a version from `git --version`." };
    }
    if (parsed.major < MIN_GIT_MAJOR || (parsed.major === MIN_GIT_MAJOR && parsed.minor < MIN_GIT_MINOR)) {
      return {
        kind: "unsupported",
        version: parsed.version,
        reason: `git ${parsed.version} is below the supported floor of ${MIN_GIT_MAJOR}.${MIN_GIT_MINOR}.`,
      };
    }
    return { kind: "supported", version: parsed.version };
  }

  return {
    async probeVersion() {
      if (versionOutcome && (!isNegative(versionOutcome) || now() < versionRetryAfter)) {
        return versionOutcome;
      }
      if (versionInFlight) {
        return versionInFlight;
      }

      versionInFlight = probeVersionOnce()
        .then((outcome) => {
          versionOutcome = outcome;
          if (isNegative(outcome)) {
            versionRetryAfter = now() + GIT_CAPABILITY_RETRY_INTERVAL_MS;
          }
          return outcome;
        })
        .finally(() => {
          versionInFlight = null;
        });
      return versionInFlight;
    },

    async runWithFallback<T>(
      capability: GitCapability,
      preferred: () => Promise<CapabilityAttempt<T>>,
      fallback: () => Promise<T>,
    ): Promise<T> {
      const retryAfter = unsupportedUntil.get(capability);
      if (retryAfter !== undefined && now() < retryAfter) {
        return fallback();
      }

      const pending = inFlight.get(capability);
      if (pending) {
        await pending.catch(() => undefined);
        const settled = unsupportedUntil.get(capability);
        if (settled !== undefined && now() < settled) {
          return fallback();
        }
      }

      const attempt = preferred();
      inFlight.set(capability, attempt);
      let outcome: CapabilityAttempt<T>;
      try {
        outcome = await attempt;
      } finally {
        if (inFlight.get(capability) === attempt) {
          inFlight.delete(capability);
        }
      }

      if (outcome.supported) {
        unsupportedUntil.delete(capability);
        return outcome.value;
      }
      unsupportedUntil.set(capability, now() + GIT_CAPABILITY_RETRY_INTERVAL_MS);
      return fallback();
    },
  };
}
