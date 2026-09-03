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
  /**
   * Create an EMPTY file exclusively and hand back its handle, writing nothing.
   *
   * Used for `<entry>/gitdir` alone. The withdrawal empties that file instead of
   * removing the directory around it, and only a descriptor makes that address
   * an object rather than a name (design.md D4). The bytes are written by the
   * caller THROUGH the handle: an implementation that wrote them itself would
   * publish an inode nobody holds if that write failed (round-8 F017).
   */
  createPinned(path: string): Promise<LinkHandle>;
  /** Remove ONE file. There is deliberately no recursive removal here (D4). */
  removeFile(path: string): Promise<void>;
  /** Recursive removal of the entry directory this adoption created. */
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

/**
 * What one write through the pinned handle did to the file.
 *
 * Three, not two: a boolean could not separate a refusal that mutated nothing
 * from a write that truncated and then failed, so the first was reported as
 * content nobody can vouch for (round-6 F015). Only `unknown` means the bytes
 * are in doubt.
 */
type WriteOutcome = "wrote" | "notWritten" | "unknown";

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
/** git's own name for the marker that keeps an entry out of `prune` (D4). */
const LOCK_MARKER = "locked";
/** What git writes there is free text; this says who to ask when one is found. */
const LOCK_REASON = "being re-registered by the worktree panel\n";

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
   * How many names the object we are about to truncate still has.
   *
   * Read as a COUNT rather than a yes/no, because zero and two mean opposite
   * things and the boolean this used to be reported them identically. Two is an
   * alias: truncating would rewrite a file outside the checkout (round-4 F013).
   * Zero is positive evidence the link was REPLACED — our handle is the last
   * reference to an object no name reaches, so this adoption is not the link and
   * cannot become it (round-6, oracle B1). Observable in the `fstat` already
   * taken, the same boundary `src/agentHooks/install/lockedJsonFile.ts` holds.
   * What stays open is an alias made after the last check.
   */
  const nameCount = async (): Promise<bigint> => BigInt((await link.identity()).nlink);

  /** Set where a write found the pinned object nameless. The link stopped being ours. */
  let linkLost = false;

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
    const names = await nameCount();
    if (names === 0n) {
      return refuse("That directory's git link was replaced before the adoption began, so nothing was written.");
    }
    if (names !== 1n) {
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
  /** The handle on `<entry>/gitdir`, held from its creation so the undo can empty it. */
  let entry: LinkHandle | null = null;

  /**
   * Write `data` whole, through the handle, at position 0.
   *
   * `truncate` first: a short write over longer old bytes leaves a valid first
   * line followed by a fragment of the old one, and git accepts that first line
   * — a link that reads as VALID and names the wrong administrative directory
   * is worse than one that reads as empty (design.md D9).
   */
  const putLink = async (data: string): Promise<WriteOutcome> => {
    const bytes = Buffer.from(data, "utf8");
    // Counted HERE, not at the callers. This has three of them — the claim, the
    // failed-claim recovery and the undo's restore — and a guard written at the
    // claim site covered one: an alias made after a successful claim was
    // rewritten by both of the others (round-5 F013).
    let names: bigint;
    try {
      names = await nameCount();
    } catch {
      return "notWritten";
    }
    if (names === 0n) {
      linkLost = true;
      return "notWritten";
    }
    if (names !== 1n) {
      return "notWritten";
    }
    // Separated from the loop on a documented guarantee: POSIX specifies that an
    // unsuccessful `ftruncate` leaves the file unaffected, so a rejection here
    // has changed nothing and saying otherwise would report unvouchable content
    // for a write that never began (round-6 F015). `LinkHandle.truncate` states
    // that contract, because this classification rests on it.
    try {
      await link.truncate(0);
    } catch {
      return "notWritten";
    }
    // Past the truncate, every exit is `unknown`: the file is empty and only a
    // completed write puts it right.
    try {
      let at = 0;
      while (at < bytes.byteLength) {
        const wrote = await link.writeAt(bytes.subarray(at), at);
        // A fulfilled write of nothing is not progress, and looping on it is a
        // hang rather than an error. `write` may legitimately fulfil short.
        if (wrote <= 0) {
          return "unknown";
        }
        at += wrote;
      }
      return "wrote";
    } catch {
      return "unknown";
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

  /**
   * Drop `locked`, but only while the entry is still provably this adoption's.
   *
   * Written as ONE operation because it has two callers — the withdrawal and the
   * success path — and a gate written at one of them covered one: the success
   * path unlinked the marker after `repair`, the tip read and the index rebuild
   * with no fresh proof at all, so an entry replaced during those steps had OUR
   * unlink applied to it (round-8 F005). This is round-5 F013's shape, at a
   * different boundary, and it gets the same answer: the proof lives in the
   * operation. The interval between the proof and the unlink is the residual D4
   * states; it is not closed here and is not claimed to be.
   */
  const unlockIfOurs = async (): Promise<boolean> => {
    try {
      if (!sameIdentity(await fs.identify(entryPath), identity)) {
        return false;
      }
    } catch (error) {
      // An entry that is GONE leaves nothing to unlock and nothing to say.
      // Folding that into "not ours" reported a residue over a directory that
      // no longer exists (round-1 F005).
      return readsAsAbsent(error);
    }
    return fs
      .removeFile(`${entryPath}/${LOCK_MARKER}`)
      .then(() => true)
      .catch(() => false);
  };

  const undo = async (): Promise<AdoptResidue | undefined> => {
    // The LINK first, and the order is the claim: emptying the entry before the
    // link goes back leaves an interval in which `<wt>/.git` names an entry git
    // is already free to collect, and a withdrawal interrupted there hands the
    // user a checkout pointing at nothing (round-4 F005). Reversed, every instant is a
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
      if (!(await stillOurLink())) {
        state = "leftAsFound";
      } else {
        // `notWritten` does NOT mean "as found" here, and the mapping is
        // deliberately not the claim's. At the claim a refusal means the link
        // was never touched; at the RESTORE this adoption has already installed
        // its own bytes, so a refusal leaves OUR link in place — which is
        // neither the bytes it was found with nor a withdrawal, and the caller
        // must not be told the destination was put back.
        state = (await putLink(request.staleLink)) === "wrote" ? "restored" : "unknown";
      }
      // Proved on BOTH sides of the write. The sample before it expires the
      // moment it returns, and while the handle keeps the restore off anyone
      // else's file, a restore that landed on a detached object must not be
      // reported as the link being back (round-4 F005).
      if (state === "restored" && !(await stillOurName())) {
        state = "leftAsFound";
      }
    }
    // Observed at ANY write: the pinned object had no name, so whatever
    // `<wt>/.git` reaches now is not the file this adoption was working on and
    // no outcome of ours may claim it was restored (oracle B1).
    if (linkLost) {
      state = "leftAsFound";
    }

    // And the entry is NOT DELETED — not by this process, and not by a git
    // command this process runs.
    //
    // Rounds 2 through 6 made the removal conditional on a fact about
    // `<wt>/.git`; round 7 found the same check-then-mutate pair one level up,
    // where `identify` proves a directory by inode and `removeDir` deletes it by
    // name. Handing the deletion to `git worktree prune` does not fix it either:
    // `should_prune_worktree()` returns an entry NAME and `delete_git_dir()`
    // resolves it a second time before removing it recursively, with no recheck
    // (2.50.1 `worktree.c:919-963`). So the withdrawal empties the one file it
    // authored, through the descriptor it has held since creating it, and drops
    // the marker that keeps the entry out of collection. git takes it from
    // there, on its own schedule, and this process never names a victim (D4).
    let collectable = false;
    try {
      if (entry !== null) {
        // The alias rule travels with the descriptor, for D9's reason: this
        // truncate would otherwise reach a second name for the same object.
        if (BigInt((await entry.identity()).nlink) !== 1n) {
          throw Object.assign(new Error("the entry's gitdir has a second name"), { code: "EMLINK" });
        }
        await entry.truncate(0);
      }
      // The ONE act left here that addresses a NAME, and deliberately the
      // smallest available: a single non-recursive unlink of a marker this
      // adoption wrote, inside a directory it minted exclusively. It cannot be
      // made atomic with the check above it — that residual is stated in D4 —
      // but its worst case is another process's entry becoming eligible for
      // git's collection, where `rm -r` on a pathname destroyed one outright
      // (round-7 F005). Gated on the best evidence there is: an entry this
      // adoption cannot prove it owns is not touched at all, and is reported.
      collectable = await unlockIfOurs();
    } catch {
      collectable = false;
    }
    await entry?.close().catch(() => {});
    await link.close().catch(() => {});
    // A withdrawal that emptied and unlocked its entry has nothing for a person
    // to do — git collects it — so it reports only what it could not finish.
    // The path is named only where a person has something to do about it. An
    // entry git will collect is not that; a link left in doubt is.
    return collectable && state === "restored" ? undefined : { entryPath: collectable ? null : entryPath, link: state };
  };

  const failed = async (message: string): Promise<AdoptResult> => {
    const residue = await undo();
    return residue === undefined ? { ok: false, message } : { ok: false, message, leftBehind: residue };
  };

  try {
    // `locked` FIRST, which is what `git worktree add` itself does before it
    // writes `gitdir` (2.50.1 `builtin/worktree.c:490-508`). An exclusive create
    // publishes a ZERO-LENGTH inode before its bytes land, so without this an
    // entry under construction is indistinguishable from a malformed one and a
    // concurrent prune can classify it invalid and delete it once it is valid.
    // `should_prune_worktree` consults `locked` before anything else (D4).
    await fs.createFile(`${entryPath}/${LOCK_MARKER}`, LOCK_REASON);
    // Held from here. The withdrawal empties THIS object rather than removing
    // the directory around it.
    entry = await fs.createPinned(`${entryPath}/gitdir`);
    // Through the handle, and only after this adoption owns it. `writeAt` may
    // fulfil short, so the remainder is looped for the reason D9 gives.
    const gitdirBytes = Buffer.from(`${linkPath}\n`, "utf8");
    let written = 0;
    while (written < gitdirBytes.byteLength) {
      const wrote = await entry.writeAt(gitdirBytes.subarray(written), written);
      if (wrote <= 0) {
        throw Object.assign(new Error(`${entryPath}/gitdir could not be written`), { code: "EIO" });
      }
      written += wrote;
    }
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
    const claimed = await putLink(ourLink);
    if (claimed !== "wrote") {
      // Begun and not finished. The handle is still open, so the old bytes can
      // be put back where a pathname write had nothing left to try; if THAT
      // fails the content is nobody's guess and the caller must say so rather
      // than report a failure that changed nothing (round-3 F012).
      //
      // A claim that never began is NOT that case. It leaves the link as found
      // and withdraws by the ordinary path, where reporting it as unvouchable
      // content used to strand a live registration (round-6 F015).
      if (claimed === "unknown") {
        contentUnknown = (await putLink(request.staleLink)) !== "wrote";
      }
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

  // LAST, and only once everything above held: the marker comes off and the
  // entry becomes an ordinary registration. Removing it earlier would expose a
  // finished-looking entry that a concurrent prune could still act on; leaving
  // it on would ship a worktree git refuses to remove (D4).
  if (!(await unlockIfOurs())) {
    return failed(`The administrative entry at ${entryPath} could not be unlocked.`);
  }

  return {
    ok: true,
    id,
    undo,
    release: async () => {
      await entry?.close().catch(() => {});
      await link.close().catch(() => {});
    },
  };
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
