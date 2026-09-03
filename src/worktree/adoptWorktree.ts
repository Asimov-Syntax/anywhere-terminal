// src/worktree/adoptWorktree.ts — Writing the administrative entry git will not write.
// See: asimov/changes/re-register-a-surviving-checkout/design.md D4
//      docs/design/worktree-create.md § 2.4
//
// No git command attaches a populated directory: `repair` requires the entry to
// already exist and `add` refuses a non-empty destination before `--force` is
// consulted. So the entry is reconstructed by hand and then handed to git's own
// repair — four small files, and nothing written inside the working tree.

import { basename } from "node:path";
import { type FileIdentity, sameIdentity } from "../utils/fileIdentity";
import { readsAsFlag } from "../utils/readsAsFlag";
import type { GitCommandRunner } from "./gitCommandRunner";
import { repairWorktree, resetMixedIndex } from "./worktreeMutations";

export interface AdoptRequest {
  /** Any worktree of the repository — where `git worktree repair` runs. */
  repoPath: string;
  /** `$GIT_COMMON_DIR`; the entry is created under its `worktrees/`. */
  commonDir: string;
  /** The surviving checkout, already proven to be a directory. */
  worktreePath: string;
  /** The branch the reconstructed `HEAD` will name. It must already exist (D2). */
  branch: string;
}

/** The filesystem this needs, injected so every failure below is witnessable. */
export interface AdoptFs {
  /** NON-recursive: it must fail `EEXIST` on a directory that is already there. */
  mkdir(path: string): Promise<void>;
  /** `lstat` at `{ bigint: true }`, for the identity the writes are checked against. */
  identify(path: string): Promise<FileIdentity>;
  /** `null` when the file is not there — an absent link is restored as absent. */
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, data: string): Promise<void>;
  /** Remove the link this adoption wrote where the directory had none before. */
  removeFile(path: string): Promise<void>;
  /** Recursive removal of the entry directory this adoption created. */
  removeDir(path: string): Promise<void>;
}

/**
 * What an undo could not put back.
 *
 * Absent on a clean withdrawal. Present means the caller must say so: reporting
 * a plain failure would send the user looking for a directory that is still
 * registered, and reporting a create would be worse.
 */
export interface AdoptResidue {
  entryPath: string;
  worktreeLinkRestored: boolean;
}

export type AdoptResult =
  | {
      ok: true;
      /** The entry directory's name under `worktrees/`. */
      id: string;
      /**
       * Withdraw the registration after the caller's own post-write checks.
       *
       * Success is not the end of the guards — the branch-claim re-read and the
       * tip check run at the caller, and both can refuse (design.md D5). An undo
       * they cannot reach would mean discovering the conflict and leaving it.
       */
      undo(): Promise<AdoptResidue | undefined>;
    }
  | { ok: false; message: string; leftBehind?: AdoptResidue };

/** git refuses more than this many colliding names long before we would. */
const MAX_ID_ATTEMPTS = 100;

export async function adoptWorktree(
  runner: GitCommandRunner,
  request: AdoptRequest,
  fs: AdoptFs,
): Promise<AdoptResult> {
  if (readsAsFlag(request.worktreePath) || readsAsFlag(request.repoPath)) {
    return { ok: false, message: "That path reads as a git option, so nothing was written." };
  }

  const linkPath = `${request.worktreePath}/.git`;
  // Read BEFORE the mkdir: this is the only copy of what the undo restores, and
  // a read taken after the entry exists would be a read of a state this
  // function had already started changing.
  const originalLink = await fs.readFile(linkPath).catch(() => null);

  const created = await createEntry(request, fs);
  if (created === undefined) {
    return { ok: false, message: "No unused administrative entry name was available." };
  }
  const { entryPath, id, identity } = created;

  const undo = async (): Promise<AdoptResidue | undefined> => {
    // Identity first, and it is the whole point: `prune` can remove an entry
    // whose `gitdir` is missing and an external `add` can mint the same id, so
    // removing by pathname alone could delete a registration we never made.
    let stillOurs = false;
    try {
      stillOurs = sameIdentity(await fs.identify(entryPath), identity);
    } catch {
      stillOurs = false;
    }
    let removed = !stillOurs;
    if (stillOurs) {
      removed = await fs
        .removeDir(entryPath)
        .then(() => true)
        .catch(() => false);
    }
    const restored = await restoreLink(fs, linkPath, originalLink);
    return removed && restored ? undefined : { entryPath, worktreeLinkRestored: restored };
  };

  const failed = async (message: string): Promise<AdoptResult> => {
    const residue = await undo();
    return residue === undefined ? { ok: false, message } : { ok: false, message, leftBehind: residue };
  };

  try {
    // `gitdir` FIRST. `git worktree prune` removes an entry whose gitdir file is
    // missing, and the link it names already exists, so from this write onwards
    // the entry survives a concurrent prune (design.md D4).
    await fs.writeFile(`${entryPath}/gitdir`, `${linkPath}\n`);
    await fs.writeFile(`${entryPath}/commondir`, "../..\n");
    await fs.writeFile(`${entryPath}/HEAD`, `ref: refs/heads/${request.branch}\n`);
  } catch (error) {
    return failed(reasonOf(error));
  }

  // Between the mkdir and here the entry could have been collected and remade
  // by someone else. Node exposes no descriptor-relative write, so comparing
  // the identity is what turns a substitution from silent into refused.
  try {
    if (!sameIdentity(await fs.identify(entryPath), identity)) {
      return failed("The administrative entry was replaced while it was being written.");
    }
  } catch (error) {
    return failed(reasonOf(error));
  }

  // LAST. Until this lands the entry links nowhere, so git neither lists it nor
  // collects it, and every failure above is invisible to the repository.
  try {
    await fs.writeFile(linkPath, `gitdir: ${entryPath}\n`);
  } catch (error) {
    return failed(reasonOf(error));
  }

  const repaired = await repairWorktree(runner, { repoPath: request.repoPath, worktreePath: request.worktreePath });
  if (!repaired.ok) {
    return failed(repaired.message);
  }

  const rebuilt = await resetMixedIndex(runner, { worktreePath: request.worktreePath });
  if (!rebuilt.ok) {
    return failed(rebuilt.message);
  }

  return { ok: true, id, undo };
}

/**
 * Create the entry directory, or answer that no name was free.
 *
 * The `mkdir` is the claim — non-recursive, so it fails on anything already
 * there. No pre-check: a check followed by a create is a window, and the create
 * alone answers the same question without one.
 */
async function createEntry(
  request: AdoptRequest,
  fs: AdoptFs,
): Promise<{ entryPath: string; id: string; identity: FileIdentity } | undefined> {
  const stem = basename(request.worktreePath);
  for (let attempt = 1; attempt <= MAX_ID_ATTEMPTS; attempt++) {
    const id = attempt === 1 ? stem : `${stem}-${attempt}`;
    const entryPath = `${request.commonDir}/worktrees/${id}`;
    try {
      await fs.mkdir(entryPath);
    } catch {
      continue;
    }
    try {
      return { entryPath, id, identity: await fs.identify(entryPath) };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Put the worktree's link back, including putting an absent one back as absent. */
async function restoreLink(fs: AdoptFs, linkPath: string, original: string | null): Promise<boolean> {
  if (original === null) {
    // Nothing was there, so the link this adoption wrote has to GO. Leaving it
    // would point the directory at an entry the undo just removed — precisely
    // the broken state adoption exists to repair, manufactured by the repair.
    return fs
      .removeFile(linkPath)
      .then(() => true)
      .catch(() => false);
  }
  return fs
    .writeFile(linkPath, original)
    .then(() => true)
    .catch(() => false);
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
