import { describe, expect, it, vi } from "vitest";
import { createGitCapabilities } from "./gitCapabilities";
import type { GitCommandResult, GitCommandRunner } from "./gitCommandRunner";
import { type GitApiAccessor, resolveRepoOutcomes, resolveRepoRoots } from "./repoRoots";

type Reply = { code?: number; stdout?: string; stderr?: string; timedOut?: boolean; failedToSpawn?: boolean };

/** Stub runner keyed on `<cwd>|<args joined>`, with a `*` cwd wildcard. */
function makeRunner(table: Record<string, Reply>) {
  const run = vi.fn(async (args: readonly string[], cwd: string): Promise<GitCommandResult> => {
    const reply = table[`${cwd}|${args.join(" ")}`] ?? table[`*|${args.join(" ")}`];
    if (!reply) {
      return { code: 128, stdout: Buffer.alloc(0), stderr: "fatal", timedOut: false, failedToSpawn: false };
    }
    return {
      code: reply.code ?? 0,
      stdout: Buffer.from(reply.stdout ?? ""),
      stderr: reply.stderr ?? "",
      timedOut: reply.timedOut ?? false,
      failedToSpawn: reply.failedToSpawn ?? false,
    };
  });
  return { runner: { run } as unknown as GitCommandRunner, run };
}

const identityNormalize = async (p: string) => p.replace(/\/+$/, "") || "/";

function deps(runner: GitCommandRunner, getGitApi?: GitApiAccessor) {
  return {
    runner,
    capabilities: createGitCapabilities(runner),
    normalize: identityNormalize,
    getGitApi,
  };
}

const api =
  (state: "initialized" | "uninitialized", roots: string[]): GitApiAccessor =>
  () =>
    ({ state, repositories: roots.map((fsPath) => ({ rootUri: { fsPath } })) }) as ReturnType<GitApiAccessor>;

const PATH_FORMAT = "rev-parse --path-format=absolute --git-common-dir";
const BARE_COMMON = "rev-parse --git-common-dir";
const TOPLEVEL = "rev-parse --show-toplevel";

describe("resolveRepoRoots", () => {
  it("returns nothing for an empty workspace", async () => {
    const { runner, run } = makeRunner({});
    expect(await resolveRepoRoots([], deps(runner))).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it("uses the git API's repository root when one matches the folder", async () => {
    const { runner } = makeRunner({ [`/repo|${PATH_FORMAT}`]: { stdout: "/repo/.git\n" } });
    const repos = await resolveRepoRoots(["/repo/packages/api"], deps(runner, api("initialized", ["/repo"])));
    expect(repos).toEqual([{ repoId: "/repo/.git", rootPath: "/repo" }]);
  });

  it("matches the repository whose root is the longest prefix", async () => {
    const { runner } = makeRunner({ [`/repo/inner|${PATH_FORMAT}`]: { stdout: "/repo/inner/.git\n" } });
    const repos = await resolveRepoRoots(
      ["/repo/inner/src"],
      deps(runner, api("initialized", ["/repo", "/repo/inner"])),
    );
    expect(repos[0].rootPath).toBe("/repo/inner");
  });

  it("falls back to rev-parse when the API is still uninitialized", async () => {
    const { runner } = makeRunner({
      "/repo|rev-parse --show-toplevel": { stdout: "/repo\n" },
      [`/repo|${PATH_FORMAT}`]: { stdout: "/repo/.git\n" },
    });
    const repos = await resolveRepoRoots(["/repo"], deps(runner, api("uninitialized", ["/repo"])));
    expect(repos).toEqual([{ repoId: "/repo/.git", rootPath: "/repo" }]);
  });

  it("falls back to rev-parse when there is no git extension at all", async () => {
    const { runner } = makeRunner({
      "/repo|rev-parse --show-toplevel": { stdout: "/repo\n" },
      [`/repo|${PATH_FORMAT}`]: { stdout: "/repo/.git\n" },
    });
    expect(
      await resolveRepoRoots(
        ["/repo"],
        deps(runner, () => undefined),
      ),
    ).toHaveLength(1);
  });

  // spec: A linked worktree opened beside its parent repo is one group
  it("dedupes two folders that share a git common dir, keeping workspace order", async () => {
    const { runner } = makeRunner({
      [`/repo|${PATH_FORMAT}`]: { stdout: "/repo/.git\n" },
      [`/repo-wt/feat|${PATH_FORMAT}`]: { stdout: "/repo/.git\n" },
      [`/other|${PATH_FORMAT}`]: { stdout: "/other/.git\n" },
    });
    const repos = await resolveRepoRoots(
      ["/repo", "/repo-wt/feat", "/other"],
      deps(runner, api("initialized", ["/repo", "/repo-wt/feat", "/other"])),
    );
    expect(repos.map((r) => r.repoId)).toEqual(["/repo/.git", "/other/.git"]);
    expect(repos[0].rootPath).toBe("/repo");
  });

  it("skips a folder that is not a repository, without a reason", async () => {
    const { runner } = makeRunner({
      "/plain|rev-parse --show-toplevel": { code: 128, stderr: "not a git repository" },
      "/repo|rev-parse --show-toplevel": { stdout: "/repo\n" },
      [`/repo|${PATH_FORMAT}`]: { stdout: "/repo/.git\n" },
    });
    const repos = await resolveRepoRoots(
      ["/plain", "/repo"],
      deps(runner, () => undefined),
    );
    expect(repos.map((r) => r.repoId)).toEqual(["/repo/.git"]);
  });

  // design.md D7: old git exits 0 and echoes the flag back.
  it("drops to the bare flag when --path-format is echoed instead of honoured", async () => {
    const { runner } = makeRunner({
      [`/repo|${PATH_FORMAT}`]: { stdout: "--path-format=absolute\n/repo/.git\n" },
      [`/repo|${BARE_COMMON}`]: { stdout: "/repo/.git\n" },
    });
    const repos = await resolveRepoRoots(["/repo"], deps(runner, api("initialized", ["/repo"])));
    expect(repos).toEqual([{ repoId: "/repo/.git", rootPath: "/repo" }]);
  });

  it("resolves a relative bare-flag answer against the repository root", async () => {
    const { runner } = makeRunner({
      [`/repo|${PATH_FORMAT}`]: { stdout: "--path-format=absolute\n" },
      [`/repo|${BARE_COMMON}`]: { stdout: ".git\n" },
    });
    const repos = await resolveRepoRoots(["/repo"], deps(runner, api("initialized", ["/repo"])));
    expect(repos[0].repoId).toBe("/repo/.git");
  });

  it("remembers the echo so a second repo does not re-probe the flag", async () => {
    const { runner, run } = makeRunner({
      [`*|${PATH_FORMAT}`]: { stdout: "--path-format=absolute\n" },
      [`/a|${BARE_COMMON}`]: { stdout: "/a/.git\n" },
      [`/b|${BARE_COMMON}`]: { stdout: "/b/.git\n" },
    });
    await resolveRepoRoots(["/a", "/b"], deps(runner, api("initialized", ["/a", "/b"])));
    const pathFormatCalls = run.mock.calls.filter((c) => c[0].join(" ") === PATH_FORMAT);
    expect(pathFormatCalls).toHaveLength(1);
  });

  it("skips a repository whose common dir cannot be read", async () => {
    const { runner } = makeRunner({
      [`/broken|${PATH_FORMAT}`]: { code: 128, stderr: "fatal: bad object" },
      [`/broken|${BARE_COMMON}`]: { code: 128, stderr: "fatal: bad object" },
      [`/ok|${PATH_FORMAT}`]: { stdout: "/ok/.git\n" },
    });
    const repos = await resolveRepoRoots(["/broken", "/ok"], deps(runner, api("initialized", ["/broken", "/ok"])));
    expect(repos.map((r) => r.repoId)).toEqual(["/ok/.git"]);
  });
});

// Round-1 review W2, W5.
describe("resolveRepoRoots — capability and boundary edges", () => {
  // design.md D7: only the exit-zero echo marks the flag unsupported. Error
  // text is locale-dependent and belongs to the repo, not to the capability.
  it("keeps the path-format capability intact when a repo fails with it in stderr", async () => {
    const { runner, run } = makeRunner({
      [`/broken|${PATH_FORMAT}`]: { code: 128, stderr: "fatal: --path-format cannot be used here" },
      [`/broken|${BARE_COMMON}`]: { code: 128, stderr: "fatal: bad object" },
      [`/ok|${PATH_FORMAT}`]: { stdout: "/ok/.git\n" },
    });
    const repos = await resolveRepoRoots(["/broken", "/ok"], deps(runner, api("initialized", ["/broken", "/ok"])));
    expect(repos.map((r) => r.repoId)).toEqual(["/ok/.git"]);
    const probed = run.mock.calls.filter((c) => c[0].join(" ") === PATH_FORMAT).map((c) => c[1]);
    expect(probed).toEqual(["/broken", "/ok"]);
  });

  it("matches a repository whose root is the filesystem root", async () => {
    const { runner } = makeRunner({ [`/|${PATH_FORMAT}`]: { stdout: "/.git\n" } });
    const repos = await resolveRepoRoots(["/work/app"], deps(runner, api("initialized", ["/"])));
    expect(repos).toEqual([{ repoId: "/.git", rootPath: "/" }]);
  });

  it("still refuses a repository root that merely shares a prefix", async () => {
    const { runner } = makeRunner({ [`/repo|${PATH_FORMAT}`]: { stdout: "/repo/.git\n" } });
    const repos = await resolveRepoRoots(["/repo-other/src"], deps(runner, api("initialized", ["/repo"])));
    expect(repos).toEqual([]);
  });
});

// Round-2 review R2-W1 / design.md D7: the echo only counts on an exit-zero run.
describe("resolveRepoRoots — path-format echo requires exit zero", () => {
  it("does not mark the flag unsupported when a failing run echoes it", async () => {
    const { runner, run } = makeRunner({
      [`/broken|${PATH_FORMAT}`]: { code: 128, stdout: "--path-format=absolute\n", stderr: "fatal: bad object" },
      [`/broken|${BARE_COMMON}`]: { code: 128, stderr: "fatal: bad object" },
      [`/ok|${PATH_FORMAT}`]: { stdout: "/ok/.git\n" },
    });
    const repos = await resolveRepoRoots(["/broken", "/ok"], deps(runner, api("initialized", ["/broken", "/ok"])));
    expect(repos.map((r) => r.repoId)).toEqual(["/ok/.git"]);
    const probed = run.mock.calls.filter((c) => c[0].join(" ") === PATH_FORMAT).map((c) => c[1]);
    expect(probed).toEqual(["/broken", "/ok"]);
  });
});

// Audit A1 / design.md D1: a folder that is not a repository and a git that could
// not answer both produced `undefined` before, so the caller deleted a live repo
// group whenever a `rev-parse` timed out.
describe("resolveRepoOutcomes — absence is not failure", () => {
  it("reports a folder that is genuinely not a repository as absent", async () => {
    const { runner } = makeRunner({ [`/plain|${TOPLEVEL}`]: { code: 128, stderr: "fatal: not a git repository" } });
    const outcomes = await resolveRepoOutcomes(["/plain"], deps(runner));
    expect(outcomes).toEqual([{ folder: "/plain", outcome: { kind: "absent" } }]);
  });

  it("reports a toplevel that timed out as failed, naming the command", async () => {
    const { runner } = makeRunner({ [`/repo|${TOPLEVEL}`]: { code: -1, timedOut: true } });
    const outcomes = await resolveRepoOutcomes(["/repo"], deps(runner));
    expect(outcomes[0].outcome.kind).toBe("failed");
    expect((outcomes[0].outcome as { reason: string }).reason).toContain("timed out");
  });

  it("reports a git that could not be spawned as failed, not absent", async () => {
    const { runner } = makeRunner({ [`/repo|${TOPLEVEL}`]: { code: -1, failedToSpawn: true } });
    const outcomes = await resolveRepoOutcomes(["/repo"], deps(runner));
    expect(outcomes[0].outcome.kind).toBe("failed");
  });

  it("treats a common-dir failure as failed — a resolved toplevel proves it is a repository", async () => {
    const { runner } = makeRunner({
      [`/repo|${TOPLEVEL}`]: { stdout: "/repo\n" },
      [`/repo|${PATH_FORMAT}`]: { code: 128, stderr: "fatal: bad object" },
      [`/repo|${BARE_COMMON}`]: { code: 128, stderr: "fatal: bad object" },
    });
    const outcomes = await resolveRepoOutcomes(["/repo"], deps(runner));
    expect(outcomes[0].outcome.kind).toBe("failed");
  });

  it("reports a resolved folder with its repository", async () => {
    const { runner } = makeRunner({
      [`/repo|${TOPLEVEL}`]: { stdout: "/repo\n" },
      [`/repo|${PATH_FORMAT}`]: { stdout: "/repo/.git\n" },
    });
    const outcomes = await resolveRepoOutcomes(["/repo"], deps(runner));
    expect(outcomes).toEqual([
      { folder: "/repo", outcome: { kind: "resolved", repo: { repoId: "/repo/.git", rootPath: "/repo" } } },
    ]);
  });

  it("keeps every folder's outcome, including two folders sharing one repository", async () => {
    const { runner } = makeRunner({
      [`*|${TOPLEVEL}`]: { stdout: "/repo\n" },
      [`*|${PATH_FORMAT}`]: { stdout: "/repo/.git\n" },
    });
    const outcomes = await resolveRepoOutcomes(["/repo/a", "/repo/b"], deps(runner));
    expect(outcomes.map((o) => o.folder)).toEqual(["/repo/a", "/repo/b"]);
    expect(outcomes.every((o) => o.outcome.kind === "resolved")).toBe(true);
  });
});

// Review round 1, W1. A nonzero exit is not proof of a missing repository, and
// the two paths differ in what they cost: a false `failed` retains a listing
// that is marked stale, a false `absent` deletes it.
describe("resolveRepoOutcomes — a nonzero toplevel that is not an absence", () => {
  it("reports an ownership refusal as failed, carrying git's own words", async () => {
    const stderr = "fatal: detected dubious ownership in repository at '/repo'";
    const { runner } = makeRunner({ [`/repo|${TOPLEVEL}`]: { code: 128, stderr } });

    const outcomes = await resolveRepoOutcomes(["/repo"], deps(runner));

    expect(outcomes[0].outcome).toEqual({ kind: "failed", reason: stderr });
  });

  it("still reports a genuinely absent repository as absent", async () => {
    const { runner } = makeRunner({
      [`/plain|${TOPLEVEL}`]: {
        code: 128,
        stderr: "fatal: not a git repository (or any of the parent directories): .git",
      },
    });

    expect((await resolveRepoOutcomes(["/plain"], deps(runner)))[0].outcome).toEqual({ kind: "absent" });
  });
});
