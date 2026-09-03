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
import { gitdirOf } from "./reattachProbe";
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
  /**
   * The exact bytes that link held when the corroboration read it.
   *
   * Both of this function's reads of `<wt>/.git` are compared against THIS
   * rather than against each other. A live registration restored before the
   * first read makes its own link the baseline, and every self-comparison
   * afterwards passes while the link being replaced is a live one (round-2 F006).
   */
  staleLink: string;
  /**
   * The tip the user was promised for `branch`.
   *
   * Read back from inside the worktree after `repair` and BEFORE the index is
   * rebuilt, which is the order design.md D4 states: the index is work against
   * a branch state, and doing it first spends that work on a state the user was
   * never shown and reports a reset failure instead of the move (round-1 F009).
   */
  expectedBranchOid: string;
}

/**
 * One open `<wt>/.git`, bound to the object it resolved to at open time.
 *
 * The primitives are separate rather than a single `replace` so this module owns
 * the state machine: a truncate that succeeds followed by a write that fails, or
 * a write that fulfils SHORT, are different outcomes with different recoveries,
 * and an adapter that hid them behind one call would put them out of reach of
 * every test.
 */
export interface LinkHandle {
  /**
   * `fstat` at `{ bigint: true }` — the object, not the name.
   *
   * `nlink` comes with it and is load-bearing: `O_NOFOLLOW` refuses a symlink at
   * the leaf but nothing refuses a HARD LINK, and truncating an inode with a
   * second name rewrites a file outside this checkout (round-4 F013).
   */
  identity(): Promise<FileIdentity & { nlink: number | bigint }>;
  /**
   * The whole file from an EXPLICIT position.
   *
   * `FileHandle.readFile` reads from the handle's current offset, so a second
   * sequential read of one handle returns zero bytes — which this module would
   * read as an empty link and refuse every ordinary adoption on its second
   * proof. Both proofs pass 0.
   */
  readAt(position: number): Promise<string>;
  truncate(length: number): Promise<void>;
  /**
   * Bytes written, which is NOT required to be all of them.
   *
   * `FileHandle.write` fulfils with a count; a short write leaves a partial
   * link that both identity checks accept. The caller loops.
   */
  writeAt(data: Buffer, position: number): Promise<number>;
  close(): Promise<void>;
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
  /**
   * Resolve `<wt>/.git` ONCE, and hand back the object rather than the name.
   *
   * Every read and write of that file goes through the returned handle. A
   * writer that REPLACES the file gives the path a new inode while this handle
   * keeps the old one, so a write through it cannot land on the replacement —
   * which is the destructive half of round-1 F006 and rounds 2 and 3's F005.
   * What it does not cover is a writer that truncates the same inode in place,
   * because that is what git's own `write_file_buf` does and nothing here can
   * exclude it (design.md D9).
   */
  openLink(path: string): Promise<LinkHandle>;
  /** `null` when the file is not there. For the entry's own `gitdir`, never for the link. */
  readFile(path: string): Promise<string | null>;
  /**
   * Exclusive create — `wx`, so it fails `EEXIST` rather than truncating.
   *
   * The entry's own files go through this and never through `writeFile`: the
   * `mkdir` claims the directory only at that instant, and an ordinary write
   * into a directory another process has since put there overwrites ITS
   * registration before the identity re-check can notice (round-1 F005).
   */
  createFile(path: string, data: string): Promise<void>;
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
  /** `null` when the entry was withdrawn and only the link has something to say. */
  entryPath: string | null;
  link: AdoptLinkState;
}

/**
 * What the withdrawal could say about `<wt>/.git`.
 *
 * `leftAsFound` is not a failure: the link there names something other than the
 * entry this adoption created, so it is somebody else's and writing over it is
 * the thing rounds 2 and 3 both refused. `unknown` is the one that must never be
 * reported as a clean failure — the claim write began, and the recovery that
 * would have put the old bytes back did not land (round-3 F012).
 */
export type AdoptLinkState = "restored" | "leftAsFound" | "unknown";

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
      /**
       * Let the pinned `<wt>/.git` go, for the caller that KEEPS the adoption.
       *
       * The handle outlives this function because `undo` does. A caller that
       * accepts the registration never calls `undo`, so without this the
       * descriptor leaks for the life of the extension host.
       */
      release(): Promise<void>;
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
  // Opened BEFORE the mkdir, and this open is the only resolution of this name
  // the whole reconstruction makes. Everything after it addresses the OBJECT.
  let link: LinkHandle;
  try {
    link = await fs.openLink(linkPath);
  } catch (error) {
    return {
      ok: false,
      message: `That directory's git link could not be read, so nothing was written: ${reasonOf(error)}`,
    };
  }
  /**
   * Exactly one name for the object we are about to truncate.
   *
   * Observable in the `fstat` already taken, so unlike the in-place writer this
   * is a boundary that CAN be held — and this repository already holds it, at
   * `src/agentHooks/install/lockedJsonFile.ts`. What stays open is an alias made
   * after the last check, the same instant the identity comparison cannot cover.
   */
  const oneName = async (): Promise<boolean> => BigInt((await link.identity()).nlink) === 1n;

  /** Nothing has been created yet, so a refusal here is just a closed handle. */
  const refuse = async (message: string): Promise<AdoptResult> => {
    await link.close().catch(() => {});
    return { ok: false, message };
  };

  // PROVED before anything is created. A read that failed used to answer `null`,
  // which the undo then read as "there was no link", and it removed one it had
  // never seen (round-2 F003). Bytes that differ from the corroborated ones are
  // a link somebody rewrote between the offer and here — including a restored
  // live registration (round-2 F006).
  let opening: string;
  try {
    if (!(await oneName())) {
      return refuse("That directory's git link is also reachable under another name, so nothing was written.");
    }
    opening = await link.readAt(0);
  } catch (error) {
    return refuse(`That directory's git link could not be read, so nothing was written: ${reasonOf(error)}`);
  }
  if (opening !== request.staleLink) {
    return refuse("That directory's git link is not the one this adoption was offered on, so nothing was written.");
  }

  const created = await createEntry(request, fs);
  if (!created.ok) {
    await link.close().catch(() => {});
    return { ok: false, message: created.message };
  }
  const { entryPath, id, identity } = created;
  /** The link this adoption will install, and the only bytes it may overwrite. */
  const ourLink = `gitdir: ${entryPath}\n`;
  /** Has the final write landed WHOLE? Until it has, the link is nobody's to restore. */
  let installed = false;
  /**
   * Set only where the claim write began and the recovery did not finish.
   *
   * Sticky: the undo must not overwrite this with a cheerier answer it reached
   * by reading a file whose content nobody can vouch for.
   */
  let contentUnknown = false;

  /**
   * Write `data` whole, through the handle, at position 0.
   *
   * `truncate` first: a short write over longer old bytes leaves a valid first
   * line followed by a fragment of the old one, and git accepts that first line
   * — a link that reads as VALID and names the wrong administrative directory
   * is worse than one that reads as empty (design.md D9).
   */
  const putLink = async (data: string): Promise<boolean> => {
    const bytes = Buffer.from(data, "utf8");
    try {
      // Counted HERE, not at the callers. This has three of them — the claim,
      // the failed-claim recovery and the undo's restore — and a guard written
      // at the claim site covered one: an alias made after a successful claim
      // was rewritten by both of the others (round-5 F013).
      if (!(await oneName())) {
        return false;
      }
      await link.truncate(0);
      let at = 0;
      while (at < bytes.byteLength) {
        const wrote = await link.writeAt(bytes.subarray(at), at);
        // A fulfilled write of nothing is not progress, and looping on it is a
        // hang rather than an error. `write` may legitimately fulfil short.
        if (wrote <= 0) {
          return false;
        }
        at += wrote;
      }
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Does `<wt>/.git` still name the object this handle holds?
   *
   * Our handle can go on writing its object long after the path stopped naming
   * it, and a restore that lands there would put the stale bytes somewhere
   * nobody reads while the outcome claimed the link was back.
   */
  const stillOurName = async (): Promise<boolean> => {
    try {
      return sameIdentity(await fs.identify(linkPath), await link.identity());
    } catch {
      return false;
    }
  };

  /** Whether the link AT THAT NAME is still the object this adoption wrote its own into. */
  const stillOurLink = async (): Promise<boolean> => {
    let now: string;
    try {
      if (!(await stillOurName())) {
        return false;
      }
      now = await link.readAt(0);
    } catch {
      return false;
    }
    // Resolved, not compared byte for byte. `git worktree repair` rewrites our
    // own link into relative form under `worktree.useRelativePaths`, and every
    // withdrawal D5 reaches runs AFTER repair — byte equality would report our
    // own link as a stranger's on the common failure path and leave `<wt>/.git`
    // naming an entry this undo is about to remove (oracle finding 3).
    const named = gitdirOf(now, request.worktreePath);
    return named !== null && resolve(named) === resolve(entryPath);
  };

  const undo = async (): Promise<AdoptResidue | undefined> => {
    // The LINK first, and the order is the claim: removing the entry before the
    // link goes back leaves an interval in which `<wt>/.git` names a directory
    // that is already gone, and a withdrawal interrupted there hands the user a
    // checkout pointing at nothing (round-4 F005). Reversed, every instant is a
    // coherent pair — git neither lists nor prunes an entry whose `gitdir` names
    // a path that exists, so ours sits inert between the two steps (D4).
    //
    // And the link is left ALONE until this adoption installed its own: before
    // that write there is nothing of ours there to undo, and writing the old
    // bytes back over whatever is there now is how a refused adoption used to
    // destroy another process's newly installed registration (round-2 F005).
    let state: AdoptLinkState = "restored";
    if (contentUnknown) {
      state = "unknown";
    } else if (installed) {
      state = !(await stillOurLink()) ? "leftAsFound" : (await putLink(request.staleLink)) ? "restored" : "unknown";
      // Proved on BOTH sides of the write. The sample before it expires the
      // moment it returns, and while the handle keeps the restore off anyone
      // else's file, a restore that landed on a detached object must not be
      // reported as the link being back (round-4 F005).
      if (state === "restored" && !(await stillOurName())) {
        state = "leftAsFound";
      }
    }

    // The one rule, applied: the entry goes only if nothing SOMEBODY ELSE put
    // there is depending on it. Read BY PATHNAME, which is right here and
    // nowhere else in this file — the question is exactly "what does that name
    // say now", and the answer decides only whether we DELETE something of our
    // own, never what we overwrite.
    //
    // The restored case is deliberately not this case. The stale link names the
    // administrative directory git had already forgotten, and after a pruned
    // checkout that is the very path `createEntry` claims first — so a correct
    // restore leaves the link naming this entry, and removing it is what puts
    // the directory back in the forgotten state the adoption found it in. What
    // must not happen is removing an entry a link this adoption did NOT write
    // is pointing at (round-5 F005).
    if (state !== "restored") {
      let named = true;
      try {
        const visible = await fs.readFile(linkPath);
        const target = visible === null ? null : gitdirOf(visible, request.worktreePath);
        named = target !== null && resolve(target) === resolve(entryPath);
      } catch {
        // Unreadable is not "nothing points at it". Keeping the entry is the
        // answer that cannot strand a link.
        named = true;
      }
      if (named) {
        await link.close().catch(() => {});
        return { entryPath, link: state };
      }
    }

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
    await link.close().catch(() => {});
    return removed && state === "restored" ? undefined : { entryPath: removed ? null : entryPath, link: state };
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
    if ((await link.readAt(0)) !== request.staleLink) {
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
    // The name still means the object this handle holds. A replacement would
    // give the path a new inode, and the write below would then land on one
    // nothing points at — silently, which is what this turns into a refusal.
    if (!sameIdentity(await fs.identify(linkPath), await link.identity())) {
      return failed("That directory's git link was replaced while it was being re-registered.");
    }
    if (!(await putLink(ourLink))) {
      // Begun and not finished. The handle is still open, so the old bytes can
      // be put back where a pathname write had nothing left to try; if THAT
      // fails the content is nobody's guess and the caller must say so rather
      // than report a failure that changed nothing (round-3 F012).
      contentUnknown = !(await putLink(request.staleLink));
      return failed("That directory's git link could not be written.");
    }
    installed = true;
    // And it landed at the NAME, not on an object that was detached from it
    // between the check above and the write. Bounded on purpose: this is a
    // two-sample endpoint test, and an A→B→A substitution passes it (D9).
    if (!sameIdentity(await fs.identify(linkPath), await link.identity())) {
      return failed("That directory's git link was replaced while it was being re-registered.");
    }
  } catch (error) {
    return failed(reasonOf(error));
  }

  const repaired = await repairWorktree(runner, { repoPath: request.repoPath, worktreePath: request.worktreePath });
  if (!repaired.ok) {
    return failed(repaired.message);
  }

  // The tip the user was PROMISED, from inside the worktree. A pre-read cannot
  // carry this claim — an `update-ref` between it and the write defeats it — so
  // the guard is here, and it is here BEFORE the index (D4, D5).
  const head = await runner.run(["rev-parse", "HEAD"], request.worktreePath);
  const at = head.code === 0 && !head.timedOut && !head.failedToSpawn ? head.stdout.toString("utf8").trim() : null;
  if (at !== request.expectedBranchOid) {
    return failed(
      at === null
        ? `The commit ${request.worktreePath} was re-registered at could not be read.`
        : "That branch has moved since it was offered, so it was not re-registered on it.",
    );
  }

  const rebuilt = await resetMixedIndex(runner, { worktreePath: request.worktreePath });
  if (!rebuilt.ok) {
    return failed(rebuilt.message);
  }

  return { ok: true, id, undo, release: () => link.close().catch(() => {}) };
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
        leftBehind: { entryPath, link: "restored" },
      };
    }
  }
  return { ok: false, message: "No unused administrative entry name was available." };
}

type CreatedEntry =
  | { ok: true; entryPath: string; id: string; identity: FileIdentity }
  | { ok: false; message: string; leftBehind?: AdoptResidue };

/** The one errno that MEANS the path is not there. Everything else is an unread answer. */
function readsAsAbsent(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
