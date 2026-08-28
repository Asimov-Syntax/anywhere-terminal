// src/test/fixtures/repoFixture.ts — One real git repository, built the same way twice.
// See asimov/changes/verify-cross-layer-scale/design.md D2; round-5 W2.
//
// Runtime-neutral on purpose: `pnpm run bench:scale` is a plain bun process, so anything
// importing `vitest` cannot be shared with it. An earlier Risk Map row claimed the bench
// already reused the integration suite's fixture — it never could, and the two copies drifted
// apart in tmp prefix and lifecycle while both claimed to build "the published fixture".
//
// Lifecycle is the caller's: vitest wants beforeEach/afterEach, the bench wants a handle it
// disposes when it is done. Owning it here would force one of them into the other's shape.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface RepoFixture {
  /** The temporary root. Linked worktrees are siblings of `repo` inside it. */
  readonly tmp: string;
  /** The main worktree — an initialised repo with one commit. */
  readonly repo: string;
  /** Run git inside the fixture, defaulting to the main worktree. */
  git(args: string[], cwd?: string): string;
  dispose(): void;
}

export interface RepoFixtureOptions {
  /** Distinguishes one suite's leftovers from another's when a run is killed. */
  readonly prefix: string;
  /**
   * Total worktrees INCLUDING the main one `git init` already made.
   *
   * Round-1 W1: adding this many linked worktrees on top built eleven against a published
   * fixture of ten. The published size is frozen (D2), so the count is stated as the total.
   */
  readonly worktrees?: number;
}

export function createRepoFixture(options: RepoFixtureOptions): RepoFixture {
  // realpath: macOS hands back /var/… while git reports /private/var/…, which is the
  // aliasing `normalizeWorktreePath` exists for.
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), options.prefix)));
  const repo = path.join(tmp, "repo");
  fs.mkdirSync(repo);

  const git = (args: string[], cwd: string = repo): string => execFileSync("git", args, { cwd, encoding: "utf8" });

  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "t@example.com"]);
  git(["config", "user.name", "T"]);
  fs.writeFileSync(path.join(repo, "README.md"), "hello\n");
  git(["add", "."]);
  git(["commit", "-qm", "init"]);

  for (let i = 0; i < (options.worktrees ?? 1) - 1; i++) {
    git(["worktree", "add", "-q", "-b", `feat-${i}`, path.join(tmp, `wt-${i}`)]);
  }

  return {
    tmp,
    repo,
    git,
    dispose: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}
