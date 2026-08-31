/**
 * WT-012.14 spike harness — does a hand-written administrative entry attach a
 * surviving checkout on Windows?
 *
 * `docs/design/worktree-create.md` § 2.4 records the reconstruction recipe as
 * verified against git 2.50.1 on macOS only. Every one of its four files carries
 * a path and one of them is absolute, so Windows can differ on separator, drive
 * letter, case sensitivity, and what `git worktree repair` normalises. A platform
 * where the recipe half-works is worse than one where it plainly fails, which is
 * why this runs before WT-012.15 is built on top of it.
 *
 * Run it on the platform you want the answer for — it builds its own throwaway
 * repository under the OS temp directory, touches nothing else, and removes what
 * it made:
 *
 *     node scripts/verify-windows-worktree-entry.mjs
 *
 * It prints a RESULT block at the end. Paste that block back verbatim; it is
 * what gets recorded into § 2.4. A macOS or Linux run is a useful control — the
 * interesting output is the diff between platforms, not this script's own
 * pass/fail.
 */

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { EOL, platform, tmpdir } from "node:os";
import { join, sep } from "node:path";

const TIMEOUT_MS = 60_000;

function run(file, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => {
      stdout += c.toString();
    });
    child.stderr.on("data", (c) => {
      stderr += c.toString();
    });
    child.once("error", reject);
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

/** Fails loudly: a step that did not run makes every later reading meaningless. */
async function git(cwd, ...args) {
  const r = await run("git", args, cwd);
  if (r.code !== 0) {
    throw new Error(`git ${args.join(" ")} exited ${r.code}\n${r.stderr || r.stdout}`);
  }
  return r.stdout;
}

async function gitAllowingFailure(cwd, ...args) {
  return await run("git", args, cwd);
}

/**
 * git prints `worktree` paths with forward slashes on every platform, and on
 * Windows the drive letter's case is not stable between what we spawn and what
 * git records. Comparing raw strings would report a platform difference that is
 * only a spelling difference — the exact mistake this spike exists to avoid.
 */
function samePath(a, b) {
  const norm = (p) => {
    const forward = p.replace(/\\/g, "/").replace(/\/+$/, "");
    return process.platform === "win32" ? forward.toLowerCase() : forward;
  };
  return norm(a) === norm(b);
}

function listedWorktrees(porcelain) {
  return porcelain
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

async function readOrNull(path) {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch {
    return null;
  }
}

const checks = [];
function record(name, ok, detail) {
  checks.push({ name, ok, detail });
  process.stdout.write(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}\n`);
}

async function main() {
  // realpath: the macOS temp directory is reached through a symlink, and git
  // records the resolved path. Without this every path comparison below fails
  // for a reason that has nothing to do with the platform under test.
  const root = await realpath(await mkdtemp(join(tmpdir(), "wt-012-14-")));
  const repo = join(root, "repo");
  const tree = join(root, "surviving-checkout");
  const branch = "adopt-me";

  try {
    // ── A real repository with a real commit ──
    await git(root, "init", "--initial-branch=main", repo);
    await git(repo, "config", "user.email", "spike@example.invalid");
    await git(repo, "config", "user.name", "WT-012.14 spike");
    await writeFile(join(repo, "README.md"), `seed${EOL}`);
    await git(repo, "add", "README.md");
    await git(repo, "commit", "-m", "seed");

    // ── A worktree git itself created, so the entry we later hand-write has a
    //    known-good shape to be compared against ──
    await git(repo, "worktree", "add", "-b", branch, tree);
    await writeFile(join(tree, "work.txt"), `work${EOL}`);
    await git(tree, "add", "work.txt");
    await git(tree, "commit", "-m", "work in the worktree");
    const tipBefore = await git(tree, "rev-parse", "HEAD");

    const commonDir = await git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir");
    const id = "surviving-checkout";
    const adminDir = join(commonDir, "worktrees", id);
    const genuine = {
      dotGit: await readOrNull(join(tree, ".git")),
      gitdir: await readOrNull(join(adminDir, "gitdir")),
      commondir: await readOrNull(join(adminDir, "commondir")),
      head: await readOrNull(join(adminDir, "HEAD")),
    };

    // ── The state adopt exists for: the checkout survives, the administrative
    //    entry does not. `prune` is how git itself gets there. ──
    await rm(adminDir, { recursive: true, force: true });
    await rm(join(tree, ".git"), { force: true });
    const listedAfterLoss = listedWorktrees(await git(repo, "worktree", "list", "--porcelain"));
    record(
      "the checkout is unregistered once its entry is gone",
      !listedAfterLoss.some((p) => samePath(p, tree)),
      `git lists ${listedAfterLoss.length} worktree(s)`,
    );

    // ── § 2.4's stated non-starters, re-checked on THIS platform ──
    const repairWithoutEntry = await gitAllowingFailure(repo, "worktree", "repair", tree);
    record(
      "`worktree repair` still refuses to create a missing entry",
      repairWithoutEntry.code !== 0 || !(await readOrNull(join(adminDir, "gitdir"))),
      `exit ${repairWithoutEntry.code}: ${(repairWithoutEntry.stderr || repairWithoutEntry.stdout).split(/\r?\n/)[0] || "(silent)"}`,
    );
    const addOntoPopulated = await gitAllowingFailure(repo, "worktree", "add", "--force", "--force", tree, branch);
    record(
      "`worktree add --force --force` still refuses a non-empty destination",
      addOntoPopulated.code !== 0,
      `exit ${addOntoPopulated.code}: ${(addOntoPopulated.stderr || addOntoPopulated.stdout).split(/\r?\n/)[0] || "(silent)"}`,
    );

    // ── The guard git cannot supply (§ 2.4): no live worktree may hold the
    //    branch. Asserted here so the recipe is never run without it. ──
    const claims = (await git(repo, "worktree", "list", "--porcelain"))
      .split(/\r?\n/)
      .filter((line) => line === `branch refs/heads/${branch}`);
    record("no live worktree claims the branch", claims.length === 0, `${claims.length} claim(s)`);
    if (claims.length > 0) {
      throw new Error("refusing to reconstruct while the branch is claimed — this is § 2.4's hard refusal");
    }

    // ── Reconstruct: the four files, exactly as § 2.4 states them ──
    await rm(adminDir, { recursive: true, force: true });
    await mkdir(adminDir, { recursive: true });
    await writeFile(join(tree, ".git"), `gitdir: ${join(commonDir, "worktrees", id)}${EOL}`);
    await writeFile(join(adminDir, "gitdir"), `${join(tree, ".git")}${EOL}`);
    await writeFile(join(adminDir, "commondir"), `../..${EOL}`);
    await writeFile(join(adminDir, "HEAD"), `ref: refs/heads/${branch}${EOL}`);
    const written = {
      dotGit: await readOrNull(join(tree, ".git")),
      gitdir: await readOrNull(join(adminDir, "gitdir")),
      commondir: await readOrNull(join(adminDir, "commondir")),
      head: await readOrNull(join(adminDir, "HEAD")),
    };

    const repaired = await gitAllowingFailure(repo, "worktree", "repair", tree);
    record(
      "`worktree repair` accepts the reconstructed entry",
      repaired.code === 0,
      `exit ${repaired.code}${repaired.stderr ? `: ${repaired.stderr.split(/\r?\n/)[0]}` : ""}`,
    );
    const afterRepair = {
      dotGit: await readOrNull(join(tree, ".git")),
      gitdir: await readOrNull(join(adminDir, "gitdir")),
      commondir: await readOrNull(join(adminDir, "commondir")),
      head: await readOrNull(join(adminDir, "HEAD")),
    };

    const resetResult = await gitAllowingFailure(tree, "reset", "--mixed");
    record("`reset --mixed` rebuilds the per-worktree index", resetResult.code === 0, `exit ${resetResult.code}`);

    // ── The four acceptance outcomes ──
    const listed = listedWorktrees(await git(repo, "worktree", "list", "--porcelain"));
    record(
      "it lists",
      listed.some((p) => samePath(p, tree)),
      listed.join(" | "),
    );

    const tipAfter = await gitAllowingFailure(tree, "rev-parse", "HEAD");
    record(
      "it keeps its branch tip",
      tipAfter.code === 0 && tipAfter.stdout === tipBefore,
      `${tipBefore.slice(0, 8)} → ${tipAfter.stdout.slice(0, 8) || "(unreadable)"}`,
    );

    // The index is the whole reason `reset --mixed` is in the recipe: without it
    // every tracked file reports as deleted AND untracked.
    const status = await gitAllowingFailure(tree, "status", "--porcelain");
    record(
      "the working tree reports clean (the index was really rebuilt)",
      status.code === 0 && status.stdout === "",
      status.stdout ? status.stdout.split(/\r?\n/).slice(0, 5).join(" | ") : "clean",
    );

    await git(repo, "worktree", "prune");
    const afterPrune = listedWorktrees(await git(repo, "worktree", "list", "--porcelain"));
    record(
      "it survives a prune",
      afterPrune.some((p) => samePath(p, tree)),
      afterPrune.join(" | "),
    );

    await writeFile(join(tree, "after-adopt.txt"), `after${EOL}`);
    const added = await gitAllowingFailure(tree, "add", "after-adopt.txt");
    const committed = await gitAllowingFailure(tree, "commit", "-m", "commit after adoption");
    const branchTip = await gitAllowingFailure(repo, "rev-parse", `refs/heads/${branch}`);
    const worktreeTip = await gitAllowingFailure(tree, "rev-parse", "HEAD");
    record(
      "it commits back, and the repository sees the commit",
      added.code === 0 &&
        committed.code === 0 &&
        branchTip.code === 0 &&
        branchTip.stdout === worktreeTip.stdout &&
        branchTip.stdout !== tipBefore,
      `branch ${branchTip.stdout.slice(0, 8) || "?"} / worktree ${worktreeTip.stdout.slice(0, 8) || "?"}`,
    );

    // ── The RESULT block: this is what gets pasted back and recorded ──
    const gitVersion = await git(root, "--version");
    const failed = checks.filter((c) => !c.ok);
    const lines = [
      "",
      "════════ RESULT — paste this block back verbatim ════════",
      `platform:        ${platform()} (${process.platform}) sep=${JSON.stringify(sep)}`,
      `git:             ${gitVersion}`,
      `node:            ${process.version}`,
      `verdict:         ${failed.length === 0 ? "RECIPE WORKS" : `RECIPE FAILS (${failed.length} of ${checks.length})`}`,
      "",
      "checks:",
      ...checks.map((c) => `  [${c.ok ? "x" : " "}] ${c.name}${c.detail ? ` — ${c.detail}` : ""}`),
      "",
      "the four files, as git wrote them itself:",
      `  <wt>/.git                 ${JSON.stringify(genuine.dotGit)}`,
      `  worktrees/<id>/gitdir     ${JSON.stringify(genuine.gitdir)}`,
      `  worktrees/<id>/commondir  ${JSON.stringify(genuine.commondir)}`,
      `  worktrees/<id>/HEAD       ${JSON.stringify(genuine.head)}`,
      "",
      "the four files, as this recipe wrote them:",
      `  <wt>/.git                 ${JSON.stringify(written.dotGit)}`,
      `  worktrees/<id>/gitdir     ${JSON.stringify(written.gitdir)}`,
      `  worktrees/<id>/commondir  ${JSON.stringify(written.commondir)}`,
      `  worktrees/<id>/HEAD       ${JSON.stringify(written.head)}`,
      "",
      "the four files, after `git worktree repair` normalised them:",
      `  <wt>/.git                 ${JSON.stringify(afterRepair.dotGit)}`,
      `  worktrees/<id>/gitdir     ${JSON.stringify(afterRepair.gitdir)}`,
      `  worktrees/<id>/commondir  ${JSON.stringify(afterRepair.commondir)}`,
      `  worktrees/<id>/HEAD       ${JSON.stringify(afterRepair.head)}`,
      "═════════════════════════════════════════════════════════",
      "",
    ];
    process.stdout.write(lines.join("\n"));
    process.exitCode = failed.length === 0 ? 0 : 1;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stdout.write(`\nThe harness itself failed before it could answer: ${error?.message ?? error}\n`);
  process.stdout.write("That is not a verdict on the recipe — rerun, or report this failure as-is.\n");
  process.exitCode = 2;
});
