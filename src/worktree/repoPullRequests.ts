// src/worktree/repoPullRequests.ts — The open pull requests the create dialog offers, bounded.
// See: asimov/changes/offer-a-pull-request-as-a-source/design.md D1, D2, D3
//      docs/design/worktree-create.md § 5

import type { GitCommandRunner } from "./gitCommandRunner";

/**
 * The ceiling on pull requests the dialog offers.
 *
 * Open pull requests grow with a repository's activity and nothing here prunes
 * them, so the same bound `MAX_REFS` puts on branches applies — asked one over
 * so a full page is distinguishable from a repository that has exactly this
 * many.
 */
export const MAX_PULL_REQUESTS = 100;

/** One selectable pull request in the create dialog's list. */
export interface PullRequest {
  number: number;
  title: string;
  /** The branch the pull request is FROM. Never the branch a create mints. */
  headRefName: string;
  /** What a create from this pull request branches off. */
  baseRefName: string;
  /** The head lives on a fork, so a remote would have to be configured. */
  fromFork: boolean;
  /** Whose fork, when it is one — what the form names before authorizing. */
  headOwner: string;
}

export interface PullRequestsInput {
  /** Where the read runs — any worktree of the repository. */
  cwd: string;
}

/**
 * `ok: false` is the ONE unavailable state.
 *
 * A missing client, a refused call, a timeout and unparseable output are all
 * different facts and none of them is a different answer here: § 5 renders one
 * quiet row, and branch search keeps working underneath it either way.
 */
export type PullRequestsRead = { ok: true; pullRequests: readonly PullRequest[]; truncated: boolean } | { ok: false };

function fieldString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * A row is kept only when it can answer what a selection needs: a number to
 * mint `pr/<number>` from, and a base to branch off. A row missing either would
 * render as an offer that cannot resolve.
 */
function toPullRequest(value: unknown): PullRequest | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const row = value as Record<string, unknown>;
  const number = row.number;
  const baseRefName = fieldString(row, "baseRefName");
  if (typeof number !== "number" || !Number.isInteger(number) || number <= 0 || baseRefName === null) {
    return null;
  }
  const owner = row.headRepositoryOwner;
  const login =
    typeof owner === "object" && owner !== null ? fieldString(owner as Record<string, unknown>, "login") : null;
  return {
    number,
    title: fieldString(row, "title") ?? "",
    headRefName: fieldString(row, "headRefName") ?? "",
    baseRefName,
    fromFork: row.isCrossRepository === true,
    headOwner: login ?? "",
  };
}

/**
 * The repository's open pull requests, capped.
 *
 * Runs through the shared command runner with `gh` as the executable (design.md
 * D2): it already resolves rather than rejects, and already tells a missing
 * executable from a non-zero exit from a timeout — the classification this read
 * needs, without a second process seam.
 */
export async function readPullRequests(runner: GitCommandRunner, input: PullRequestsInput): Promise<PullRequestsRead> {
  const result = await runner.run(
    [
      "pr",
      "list",
      "--state=open",
      "--json=number,title,headRefName,baseRefName,isCrossRepository,headRepositoryOwner",
      `--limit=${MAX_PULL_REQUESTS + 1}`,
    ],
    input.cwd,
  );
  if (result.failedToSpawn || result.timedOut || result.code !== 0) {
    return { ok: false };
  }

  // A zero exit is not a promise of parseable output: an updated client can
  // print a notice on stdout. This read is started beside the refs read, so a
  // throw here would take that answer down with it.
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout.toString("utf8"));
  } catch {
    return { ok: false };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false };
  }

  const truncated = parsed.length > MAX_PULL_REQUESTS;
  const pullRequests = parsed
    .slice(0, MAX_PULL_REQUESTS)
    .map(toPullRequest)
    .filter((pr): pr is PullRequest => pr !== null);

  return { ok: true, pullRequests, truncated };
}
