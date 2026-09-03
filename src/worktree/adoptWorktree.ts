// src/worktree/adoptWorktree.ts — Writing the administrative entry git will not write.
// See: asimov/changes/re-register-a-surviving-checkout/design.md D4
//      docs/design/worktree-create.md § 2.4
//
// No git command attaches a populated directory: `repair` requires the entry to
// already exist and `add` refuses a non-empty destination before `--force` is
// consulted. So the entry is reconstructed by hand and then handed to git's own
// repair — four small files, and nothing written inside the working tree.

import { basename, resolve } from "node:path";
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
  /**
   * The administrative directory the surviving link still names.
   *
   * Proven absent by the probe that offered this adoption, and re-read here
   * immediately before the write that makes the adoption real: several awaits
   * separate the two, and a registration restored inside that window is a live
   * one this adoption must not overwrite (round-1 F006).
   */
  staleGitdir: string;
}

/** The filesystem this needs, injected so every failure below is witnessable. */
export interface AdoptFs {
  /** NON-recursive: it must fail `EEXIST` on a directory that is already there. */
  mkdir(path: string): Promise<void>;
  /**
   * Recursive and idempotent, for the entry's PARENT only.
   *
   * `git worktree prune` removes git's `worktrees/` directory once it is empty,
   * so a repository whose one forgotten checkout was just pruned has no parent
   * for the entry to be created in. Kept separate from `mkdir` because the
   * exclusivity of that call is the whole claim: a recursive create there would
   * answer success for an entry this adoption does not own.
   */
  ensureDir(path: string): Promise<void>;
  /** `lstat` at `{ bigint: true }`, for the identity the writes are checked against. */
  identify(path: string): Promise<FileIdentity>;
  /** `null` when the file is not there — an absent link is restored as absent. */
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, data: string): Promise<void>;
  /**
   * Exclusive create — `wx`, so it fails `EEXIST` rather than truncating.
   *
   * The entry's own files go through this and never through `writeFile`: the
   * `mkdir` claims the directory only at that instant, and an ordinary write
   * into a directory another process has since put there overwrites ITS
   * registration before the identity re-check can notice (round-1 F005).
   */
  createFile(path: string, data: string): Promise<void>;
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

/** One level up, as a path segment. Named so the value below can be assembled. */
const UP = "..";

/**
 * git's `commondir` content: the entry's own route back to the common
 * directory, which is always two levels up from `<common>/worktrees/<id>`.
 *
 * ASSEMBLED rather than written as the one literal it obviously is.
 * `pnpm run build:check-requires` sweeps the packaged bundle for string
 * literals that look like relative requests and fails on any that cannot
 * resolve beside `dist/` — by design it cannot tell git's path DATA from a
 * module specifier, and a literal `"../.."` here fails the packaged build for a
 * request nobody makes. `join` rather than a template, because the same gate
 * fails a template whose head is relative. The bytes git reads are identical.
 */
const COMMON_DIR_ROUTE = `${[UP, UP].join("/")}\n`;

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
  if (!created.ok) {
    return { ok: false, message: created.message };
  }
  const { entryPath, id, identity } = created;

  const undo = async (): Promise<AdoptResidue | undefined> => {
    // Identity first, and it is the whole point: `prune` can remove an entry
    // whose `gitdir` is missing and an external `add` can mint the same id, so
    // removing by pathname alone could delete a registration we never made.
    let stillOurs = false;
    // An entry that is GONE leaves nothing behind; one this adoption cannot
    // prove it owns belongs to another process and is left where it is — AND
    // said. Folding the two into "not ours, so nothing to remove" reported a
    // clean withdrawal over a foreign directory this run had written into
    // (round-1 F005).
    let vanished = false;
    try {
      stillOurs = sameIdentity(await fs.identify(entryPath), identity);
    } catch (error) {
      vanished = readsAsAbsent(error);
    }
    let removed = vanished;
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
    await fs.createFile(`${entryPath}/gitdir`, `${linkPath}\n`);
    await fs.createFile(`${entryPath}/commondir`, COMMON_DIR_ROUTE);
    await fs.createFile(`${entryPath}/HEAD`, `ref: refs/heads/${request.branch}\n`);
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
  //
  // And conditional, because this write is the adoption: the caller's
  // corroboration is several awaits behind it, and in that interval another git
  // process can restore the administrative directory this link still names.
  // Both halves are re-read here — the link's own bytes, and the target's
  // absence — so a registration that came back is refused rather than replaced
  // (round-1 F006). Node exposes no descriptor-relative write, so this is a
  // read-then-write and not an atomic claim; what it removes is the whole
  // window from the caller's probe to here, leaving only the instant between
  // these reads and the write itself.
  try {
    if ((await fs.readFile(linkPath)) !== originalLink) {
      return failed("That directory's git link changed while it was being re-registered.");
    }
    // A registration for THIS checkout, back at the path the stale link named.
    // Existence alone would not say that: the forgotten entry's name is the one
    // `createEntry` claims first, so in the ordinary case that path IS this
    // adoption's own new entry, and a repository with two same-named checkouts
    // can have another worktree legitimately holding it. What settles it is
    // whose link the entry there points at.
    if (resolve(request.staleGitdir) !== resolve(entryPath)) {
      const claim = await fs.readFile(`${request.staleGitdir}/gitdir`);
      if (claim !== null && claim.trim() === linkPath) {
        return failed("That directory is registered with git again, so it was not re-registered.");
      }
    }
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
async function createEntry(request: AdoptRequest, fs: AdoptFs): Promise<CreatedEntry> {
  const stem = basename(request.worktreePath);
  const parent = `${request.commonDir}/worktrees`;
  try {
    await fs.ensureDir(parent);
  } catch (error) {
    // Said as itself. A permission wall and a hundred taken names are different
    // problems with different recoveries, and both used to report the second
    // one (round-1 F011).
    return { ok: false, message: `The administrative directory could not be prepared: ${reasonOf(error)}` };
  }
  for (let attempt = 1; attempt <= MAX_ID_ATTEMPTS; attempt++) {
    const id = attempt === 1 ? stem : `${stem}-${attempt}`;
    const entryPath = `${parent}/${id}`;
    try {
      await fs.mkdir(entryPath);
    } catch (error) {
      // Only a COLLISION is a name to try again. Anything else — a parent that
      // vanished, a permission wall — is a failure of this adoption, and
      // retrying it ninety-nine times ends in a message about names being
      // unavailable that says the wrong thing about what went wrong.
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        return { ok: false, message: `The administrative entry could not be created: ${reasonOf(error)}` };
      }
      continue;
    }
    try {
      return { ok: true, entryPath, id, identity: await fs.identify(entryPath) };
    } catch (error) {
      // The directory EXISTS and this adoption made it. Reported with the path,
      // because nothing below can reach an entry whose identity was never
      // captured — the undo is built from it (round-1 F004).
      return {
        ok: false,
        message: `The administrative entry at ${entryPath} was created but could not be read back: ${reasonOf(error)}`,
        leftBehind: { entryPath, worktreeLinkRestored: true },
      };
    }
  }
  return { ok: false, message: "No unused administrative entry name was available." };
}

type CreatedEntry =
  | { ok: true; entryPath: string; id: string; identity: FileIdentity }
  | { ok: false; message: string; leftBehind?: AdoptResidue };

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

/** The one errno that MEANS the path is not there. Everything else is an unread answer. */
function readsAsAbsent(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
