import { describe, expect, it } from "vitest";
import type { ProvisionPortResult, ProvisionSetupResult, ProvisionStepResult } from "../../types/messages";
import type { DirectoryStatLike } from "../../utils/authorizedDirectory";
import {
  deriveProvisionManifest,
  PROVISION_MANIFEST_FILE,
  type ProvisionManifestDeps,
  type ProvisionManifestLockedFile,
  writeProvisionManifest,
} from "./provisionManifest";

/** A directory entry `authorizeDirectory`/`directoryStillAuthorized` will accept. */
function dir(ino: number): DirectoryStatLike {
  return {
    dev: 1,
    ino,
    isDirectory: () => true,
    isSymbolicLink: () => false,
  };
}

/** `lstat` over one fixed absolute-git-dir path, `/repo/.git/worktrees/wt-a` by default. */
function lstatFor(gitDir: string): (target: string) => Promise<DirectoryStatLike> {
  const components = gitDir.split("/").filter(Boolean);
  let current = "";
  const known = new Set<string>(["/"]);
  for (const segment of components) {
    current += `/${segment}`;
    known.add(current);
  }
  return async (target: string) => {
    if (!known.has(target)) {
      throw Object.assign(new Error(`ENOENT ${target}`), { code: "ENOENT" });
    }
    return dir([...known].indexOf(target) + 1);
  };
}

const GIT_DIR = "/repo/.git/worktrees/wt-a";

function run(gitDir = GIT_DIR) {
  return async (args: readonly string[]) =>
    args[0] === "rev-parse"
      ? { code: 0, timedOut: false, stdout: Buffer.from(`${gitDir}\n`, "utf8") }
      : { code: 1, timedOut: false, stdout: Buffer.alloc(0) };
}

/** Records every `atomicReplace` call and answers `ok` unless told otherwise. */
function recordingLockedFile(ok = true) {
  const calls: { target: string; contents: string; mode: number | undefined }[] = [];
  const lockedFile = (target: string): ProvisionManifestLockedFile => ({
    atomicReplace: async (contents, mode) => {
      calls.push({ target, contents, mode });
      return ok;
    },
  });
  return { calls, lockedFile };
}

const COPIED: ProvisionStepResult = { id: "e1", path: ".env.worktree", outcome: { kind: "copied" } };
const LINKED: ProvisionStepResult = { id: "e2", path: "third_party", outcome: { kind: "linked" } };
const DEGRADED: ProvisionStepResult = { id: "e3", path: "vendor", outcome: { kind: "degradedToCopy" } };
const SKIPPED: ProvisionStepResult = {
  id: "e4",
  path: "already-there",
  outcome: { kind: "skipped", reason: "the destination already exists" },
};
const REFUSED: ProvisionStepResult = {
  id: "e5",
  path: "contested",
  outcome: { kind: "refused", reason: "may name this same destination" },
};
const FAILED_STEP: ProvisionStepResult = { id: "e6", path: "broken", outcome: { kind: "failed", reason: "denied" } };

const ALLOCATED: ProvisionPortResult = { id: "p1", name: "APP_PORT", outcome: { kind: "allocated", port: 4001 } };
const REUSED: ProvisionPortResult = { id: "p2", name: "DB_PORT", outcome: { kind: "reused", port: 4002 } };
const FAILED_PORT: ProvisionPortResult = {
  id: "p3",
  name: "CACHE_PORT",
  outcome: { kind: "failed", reason: "no distinct port could be allocated" },
};

const OK_SETUP: ProvisionSetupResult = { id: "s1", source: ".vscode/tasks.json", script: "npm ci", outcome: { kind: "ok" } };
const FAILED_SETUP: ProvisionSetupResult = {
  id: "s2",
  source: "package.json",
  script: "npm run bootstrap",
  outcome: { kind: "failed", reason: "exited 1" },
};
const SKIPPED_SETUP: ProvisionSetupResult = {
  id: "s3",
  source: "package.json",
  script: "npm run seed",
  outcome: { kind: "skipped", reason: "an earlier step failed" },
};

describe("deriveProvisionManifest", () => {
  it("keeps only material this process actually wrote", () => {
    const manifest = deriveProvisionManifest(
      [COPIED, LINKED, DEGRADED, SKIPPED, REFUSED, FAILED_STEP],
      [],
      [],
      0,
    );

    expect(manifest.materialized).toEqual([
      { path: ".env.worktree", mode: "copy" },
      { path: "third_party", mode: "link" },
      { path: "vendor", mode: "copy" },
    ]);
  });

  it("keeps only authoritative allocated or reused ports, never a failed one", () => {
    const manifest = deriveProvisionManifest([], [ALLOCATED, REUSED, FAILED_PORT], [], 0);

    expect(manifest.ports).toEqual([
      { name: "APP_PORT", port: 4001 },
      { name: "DB_PORT", port: 4002 },
    ]);
  });

  it("records every selected setup source, ok and failed and skipped alike", () => {
    const manifest = deriveProvisionManifest([], [], [OK_SETUP, FAILED_SETUP, SKIPPED_SETUP], 0);

    expect(manifest.setup).toEqual([
      { source: ".vscode/tasks.json", outcome: "ok" },
      { source: "package.json", outcome: "failed" },
      { source: "package.json", outcome: "skipped" },
    ]);
  });

  it("stamps version 1 and an ISO createdAt from the given clock", () => {
    const manifest = deriveProvisionManifest([], [], [], 1_700_000_000_000);

    expect(manifest.version).toBe(1);
    expect(manifest.createdAt).toBe(new Date(1_700_000_000_000).toISOString());
  });
});

describe("writeProvisionManifest", () => {
  function deps(over: Partial<ProvisionManifestDeps> = {}): ProvisionManifestDeps {
    return {
      run: run(),
      lstat: lstatFor(GIT_DIR),
      now: () => 0,
      ...over,
    };
  }

  it("resolves the destination through readWorktreeGitDir and writes there at mode 0o600", async () => {
    const { calls, lockedFile } = recordingLockedFile();

    const outcome = await writeProvisionManifest("/repo/wt-a", [COPIED], [ALLOCATED], [OK_SETUP], deps({ lockedFile }));

    expect(outcome).toEqual({});
    expect(calls).toHaveLength(1);
    expect(calls[0]?.target).toBe(`${GIT_DIR}/${PROVISION_MANIFEST_FILE}`);
    expect(calls[0]?.mode).toBe(0o600);
    const written = JSON.parse(calls[0]?.contents ?? "{}");
    expect(written.materialized).toEqual([{ path: ".env.worktree", mode: "copy" }]);
    expect(written.ports).toEqual([{ name: "APP_PORT", port: 4001 }]);
    expect(written.setup).toEqual([{ source: ".vscode/tasks.json", outcome: "ok" }]);
  });

  it("reports a warning rather than throwing when the administrative directory cannot be resolved", async () => {
    const { calls, lockedFile } = recordingLockedFile();
    const failingRun = async () => ({ code: 128, timedOut: false, stdout: Buffer.alloc(0) });

    const outcome = await writeProvisionManifest("/repo/wt-a", [], [], [], deps({ run: failingRun, lockedFile }));

    expect(outcome.warning).toBeDefined();
    expect(calls).toEqual([]);
  });

  it("reports a warning when the administrative directory cannot be authorized", async () => {
    const { calls, lockedFile } = recordingLockedFile();
    const unauthorizable: ProvisionManifestDeps["lstat"] = async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    };

    const outcome = await writeProvisionManifest("/repo/wt-a", [], [], [], deps({ lstat: unauthorizable, lockedFile }));

    expect(outcome.warning).toBeDefined();
    expect(calls).toEqual([]);
  });

  it("refuses to write when the administrative directory was substituted after authorization", async () => {
    // First pass of `lstat` (authorization) succeeds; the recheck immediately
    // before the write is the one this substitution defeats.
    const { calls, lockedFile } = recordingLockedFile();
    let calls_ = 0;
    const substituting: ProvisionManifestDeps["lstat"] = async (target) => {
      calls_ += 1;
      // `authorizeDirectory` itself walks every component twice (build, then
      // its own internal recheck) before this module's explicit recheck runs
      // a third time — so the substitution has to appear only on that third
      // pass to be attributable to this module's own recheck and not to
      // `authorizeDirectory` refusing on its own.
      if (calls_ <= 10) {
        return lstatFor(GIT_DIR)(target);
      }
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    };

    const outcome = await writeProvisionManifest("/repo/wt-a", [], [], [], deps({ lstat: substituting, lockedFile }));

    expect(outcome.warning).toBeDefined();
    expect(calls).toEqual([]);
  });

  it("reports a warning without throwing when the atomic replace fails", async () => {
    const { calls, lockedFile } = recordingLockedFile(false);

    const outcome = await writeProvisionManifest("/repo/wt-a", [], [], [], deps({ lockedFile }));

    expect(outcome.warning).toBeDefined();
    expect(calls).toHaveLength(1);
  });

  it("replaces the same manifest on a setup-only retry, without re-deriving prior material or ports", async () => {
    const { calls, lockedFile } = recordingLockedFile();
    const retryDeps = deps({ lockedFile });

    await writeProvisionManifest("/repo/wt-a", [COPIED], [ALLOCATED], [FAILED_SETUP], retryDeps);
    await writeProvisionManifest("/repo/wt-a", [COPIED], [ALLOCATED], [OK_SETUP], retryDeps);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.target).toBe(calls[1]?.target);
    const first = JSON.parse(calls[0]?.contents ?? "{}");
    const second = JSON.parse(calls[1]?.contents ?? "{}");
    // Retained material and port records survive the retry unchanged.
    expect(second.materialized).toEqual(first.materialized);
    expect(second.ports).toEqual(first.ports);
    // Only the setup outcome moved, from the failed attempt to the retried success.
    expect(first.setup).toEqual([{ source: "package.json", outcome: "failed" }]);
    expect(second.setup).toEqual([{ source: ".vscode/tasks.json", outcome: "ok" }]);
  });
});
