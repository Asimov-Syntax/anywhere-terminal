// src/worktree/provisioning/asimovProvider.ts — Read `asimov/worktree.yaml`
// into the normalized model (worktree-provisioning.md § 3.1).
//
// One provider, one function. There is no adapter interface and no registry
// here: WT-012.3 adds the other three and WT-012.4 owns detection order and the
// merge rule, and that is the task that learns what the seam between adapters
// actually needs. A registry built for one entry is a shape the second has to
// be bent into.
//
// Nothing in this module writes. It reads the provider file and, for a glob,
// the directory that glob names — and every path it touches is checked for
// containment first.

import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  ProvisionEntry,
  ProvisionModel,
  ProvisionPort,
  ProvisionProblem,
  ProvisionSetupStep,
} from "../../types/messages";
import { isResolvedPathInsideRoot, type PreparedRoot, prepareResolvedRoot } from "../../utils/resolvedPathBoundary";

/** Repo-relative, POSIX. The one file this adapter reads. */
export const ASIMOV_PROVIDER_FILE = "asimov/worktree.yaml";

export interface AsimovProviderDeps {
  readFile(p: string): Promise<string>;
  /** Names only, no types — the glob cares what is there, not what kind it is. */
  readdir(p: string): Promise<readonly string[]>;
  realpath?(p: string): Promise<string>;
  lstat?(p: string): Promise<unknown>;
}

/**
 * A parser message can quote arbitrary file content (§ 7), so it is bounded
 * before it is stored and rendered as text by whoever displays it.
 */
const DETAIL_MAX = 300;

function bounded(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= DETAIL_MAX ? oneLine : `${oneLine.slice(0, DETAIL_MAX - 1)}…`;
}

/** The four keys § 3.1 maps. Anything else is reported rather than ignored. */
const KNOWN_KEYS = new Set(["copy", "link", "ports", "setup"]);

/**
 * The most rows one offer may carry.
 *
 * A glob's directory is repository-controlled, so `*` against a `node_modules`
 * sibling would otherwise push unbounded rows through `postMessage` and into the
 * DOM (round-1 B7). The budget is on the MODEL rather than per glob, because
 * many small globs cost the same as one large one.
 */
export const MAX_MODEL_ROWS = 200;

/**
 * Absence, told apart from failure.
 *
 * Every other errno — EACCES, ELOOP, EIO, EFBIG from the bounded reader — means
 * the material is THERE and we could not read it, which the spec requires be
 * named. Swallowing them made the section say "Nothing configured" about a
 * repository whose provider file exists, which is an affirmative false claim
 * (round-1 B8).
 */
function isAbsence(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** The errno, for a problem detail. Never the message: it can carry a path. */
function errnoOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "unknown error";
}

/**
 * Ids are minted per offer as a counter.
 *
 * Deliberately not derived from the path: an id that encoded one would be a
 * path the webview could read back out and reason about, and an id from a
 * superseded offer would still name something. A counter resolves to nothing
 * once its offer is gone, which is the answer § 4.0 wants.
 */
function ids(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `i${n}`;
  };
}

type Draft = {
  entries: ProvisionEntry[];
  setup: ProvisionSetupStep[];
  ports: ProvisionPort[];
  problems: ProvisionProblem[];
};

function problem(reason: ProvisionProblem["reason"], detail: string): ProvisionProblem {
  return { file: ASIMOV_PROVIDER_FILE, reason, detail: bounded(detail) };
}

function emptyModel(): ProvisionModel {
  return { entries: [], setup: [], ports: [], providers: [], excluded: [], problems: [] };
}

/**
 * Split `dir/prefix*suffix` into its parts, or refuse.
 *
 * § 3.1 permits a `*` in the FINAL segment only. A pattern with more than one,
 * or with one earlier in the path, is refused rather than interpreted
 * generously — a best-effort reading of a pattern we do not implement produces
 * a list of files different from the one the user was shown, which is the one
 * failure this section exists to prevent.
 */
function splitGlob(relPath: string): { dir: string; prefix: string; suffix: string } | null {
  const star = relPath.indexOf("*");
  if (star === -1 || relPath.indexOf("*", star + 1) !== -1) {
    return null;
  }
  const lastSlash = relPath.lastIndexOf("/");
  if (star < lastSlash) {
    return null;
  }
  const segment = lastSlash === -1 ? relPath : relPath.slice(lastSlash + 1);
  const dir = lastSlash === -1 ? "" : relPath.slice(0, lastSlash);
  const segStar = segment.indexOf("*");
  return { dir, prefix: segment.slice(0, segStar), suffix: segment.slice(segStar + 1) };
}

async function contained(
  relPath: string,
  repoRoot: string,
  root: PreparedRoot,
  deps: AsimovProviderDeps,
): Promise<boolean> {
  if (relPath === "" || path.isAbsolute(relPath)) {
    return false;
  }
  const absolute = path.resolve(repoRoot, relPath);
  return isResolvedPathInsideRoot(absolute, root, { realpath: deps.realpath, lstat: deps.lstat });
}

/**
 * One declared path becomes zero, one, or many entries.
 *
 * A glob expands HERE, at read time, because the list the user is shown must be
 * the list that would actually be copied (§ 3.1). Every expanded entry carries
 * the glob's own source file, per § 4.3 — provenance answers which file asked
 * for this, and expansion does not change the answer.
 */
async function entriesFor(
  declared: unknown,
  mode: ProvisionEntry["mode"],
  repoRoot: string,
  root: PreparedRoot,
  deps: AsimovProviderDeps,
  nextId: () => string,
  draft: Draft,
): Promise<void> {
  if (!Array.isArray(declared)) {
    draft.problems.push(problem("malformed", `\`${mode}\` must be a list of paths.`));
    return;
  }
  for (const raw of declared) {
    if (typeof raw !== "string" || raw.trim() === "") {
      draft.problems.push(problem("malformed", `\`${mode}\` holds an entry that is not a path.`));
      continue;
    }
    const relPath = raw.trim();
    if (!relPath.includes("*")) {
      if (await contained(relPath, repoRoot, root, deps)) {
        draft.entries.push({ id: nextId(), path: relPath, mode, source: ASIMOV_PROVIDER_FILE });
      } else {
        // Refused and reported, never clamped: clamping turns a suspicious
        // entry into a silently different one (§ 7).
        draft.problems.push(problem("malformed", `\`${relPath}\` does not resolve inside the repository.`));
      }
      continue;
    }
    const glob = splitGlob(relPath);
    if (glob === null) {
      draft.problems.push(problem("malformed", `\`${relPath}\` may hold one \`*\`, in its last segment only.`));
      continue;
    }
    // The DIRECTORY is checked before it is read, so a `../*` pattern cannot
    // cause a read outside the repository in the course of being rejected.
    //
    // A root-level glob is exempt because the directory it names IS the repo
    // root, and `isResolvedPathInsideRoot` refuses a candidate equal to the root
    // on purpose — its callers are about to read the candidate as a file. Asking
    // it here would report `*.md` as escaping the repository, which is a lie.
    if (glob.dir !== "" && !(await contained(glob.dir, repoRoot, root, deps))) {
      draft.problems.push(problem("malformed", `\`${relPath}\` does not resolve inside the repository.`));
      continue;
    }
    let names: readonly string[];
    try {
      names = await deps.readdir(path.resolve(repoRoot, glob.dir));
    } catch (error) {
      if (!isAbsence(error)) {
        // Present and unreadable is not the same as absent. Reported, so the
        // section does not claim the repository declared nothing (B8).
        draft.problems.push(
          problem("unreadable", `\`${glob.dir === "" ? "." : glob.dir}\` could not be read (${errnoOf(error)}).`),
        );
        continue;
      }
      // A directory that is not there contributes no entries, and a repo
      // legitimately carries optional material (§ 3.1).
      continue;
    }
    for (const name of [...names].sort()) {
      if (name.length < glob.prefix.length + glob.suffix.length) {
        continue;
      }
      if (!name.startsWith(glob.prefix) || !name.endsWith(glob.suffix)) {
        continue;
      }
      if (draft.entries.length >= MAX_MODEL_ROWS) {
        // Reported, never silently truncated: a shorter list than the repository
        // asked for is exactly the "shown list differs from the copied list"
        // failure this module exists to prevent, so it is stated (B7).
        draft.problems.push(
          problem(
            "malformed",
            `\`${relPath}\` fills the ${MAX_MODEL_ROWS}-row budget; it and anything after it are not offered.`,
          ),
        );
        // Returns rather than continues: the budget is model-wide, so every
        // later declaration would be refused too, and one honest message beats
        // one per remaining path.
        return;
      }
      const expanded = glob.dir === "" ? name : `${glob.dir}/${name}`;
      // Per MATCH, not per parent. A contained directory says nothing about a
      // child symlink, and an expanded entry is what a later task materializes
      // (round-1 B2) — which is the same authorization D4 gives literal entries.
      if (!(await contained(expanded, repoRoot, root, deps))) {
        draft.problems.push(problem("malformed", `\`${expanded}\` does not resolve inside the repository.`));
        continue;
      }
      draft.entries.push({ id: nextId(), path: expanded, mode, source: ASIMOV_PROVIDER_FILE });
    }
  }
}

/**
 * The repository's own provisioning file, as the normalized model.
 *
 * Fails OPEN by design: a file that is absent, unreadable or malformed yields a
 * model plus a `problems[]` entry, never a throw. § 9 keeps the create enabled —
 * a broken provisioning config is not a reason to refuse to make a worktree,
 * and nothing executes from this model in this change anyway.
 */
export async function readAsimovProvisioning(deps: AsimovProviderDeps, repoRoot: string): Promise<ProvisionModel> {
  // The root is prepared FIRST, because the provider file has to be authorized
  // before it is opened. Its relative name is a constant, but the file itself
  // can be a symlink out of the checkout — and reading it is what follows the
  // link (round-1 B2). The old order read first and checked later, which is no
  // check at all.
  const root = await prepareResolvedRoot(repoRoot, { realpath: deps.realpath, lstat: deps.lstat });
  if (root === null) {
    return {
      ...emptyModel(),
      problems: [problem("unreadable", "The repository root could not be resolved.")],
    };
  }

  const providers = [{ id: "asimov" as const, file: ASIMOV_PROVIDER_FILE, active: true }];
  if (!(await contained(ASIMOV_PROVIDER_FILE, repoRoot, root, deps))) {
    return {
      ...emptyModel(),
      providers,
      problems: [problem("malformed", `\`${ASIMOV_PROVIDER_FILE}\` does not resolve inside the repository.`)],
    };
  }

  const file = path.resolve(repoRoot, ASIMOV_PROVIDER_FILE);
  let text: string;
  try {
    text = await deps.readFile(file);
  } catch (error) {
    if (!isAbsence(error)) {
      // Present and unreadable — denied, a symlink loop, an I/O error, or the
      // bounded reader refusing an oversized file (W1). The spec requires the
      // file be NAMED; returning an empty model would say the opposite (B8).
      return {
        ...emptyModel(),
        providers,
        problems: [problem("unreadable", `\`${ASIMOV_PROVIDER_FILE}\` could not be read (${errnoOf(error)}).`)],
      };
    }
    // No provider file is not a problem — it is the ordinary case for most
    // repositories, and the section says what the worktree will lack anyway.
    return emptyModel();
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (error) {
    return {
      ...emptyModel(),
      providers,
      problems: [problem("malformed", error instanceof Error ? error.message : String(error))],
    };
  }
  if (parsed === null || parsed === undefined) {
    return { ...emptyModel(), providers };
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...emptyModel(), providers, problems: [problem("malformed", "The file is not a mapping of keys.")] };
  }

  const nextId = ids();
  const draft: Draft = { entries: [], setup: [], ports: [], problems: [] };
  const record = parsed as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!KNOWN_KEYS.has(key)) {
      draft.problems.push(problem("unknownKey", `\`${key}\` is not a key this reads.`));
    }
  }

  if (record.copy !== undefined) {
    await entriesFor(record.copy, "copy", repoRoot, root, deps, nextId, draft);
  }
  if (record.link !== undefined) {
    await entriesFor(record.link, "link", repoRoot, root, deps, nextId, draft);
  }

  if (record.ports !== undefined) {
    if (typeof record.ports !== "object" || record.ports === null || Array.isArray(record.ports)) {
      draft.problems.push(problem("malformed", "`ports` must be a mapping of names."));
    } else {
      for (const name of Object.keys(record.ports as Record<string, unknown>)) {
        // No number: the name is what the file declares, and probing for a free
        // port is WT-012.6's. The row is offered without one.
        draft.ports.push({ id: nextId(), name, source: ASIMOV_PROVIDER_FILE });
      }
    }
  }

  if (record.setup !== undefined) {
    if (!Array.isArray(record.setup)) {
      draft.problems.push(problem("malformed", "`setup` must be a list of commands."));
    } else {
      for (const raw of record.setup) {
        if (typeof raw !== "string" || raw.trim() === "") {
          draft.problems.push(problem("malformed", "`setup` holds an entry that is not a command."));
          continue;
        }
        // Stored exactly as written. It is display text here and the shell's
        // single script argument later — never concatenated into one.
        draft.setup.push({ id: nextId(), kind: "shell", script: raw, source: ASIMOV_PROVIDER_FILE });
      }
    }
  }

  return {
    entries: draft.entries,
    setup: draft.setup,
    ports: draft.ports,
    providers,
    excluded: [],
    problems: draft.problems,
  };
}
