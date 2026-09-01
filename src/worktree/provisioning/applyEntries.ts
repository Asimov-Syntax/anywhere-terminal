// src/worktree/provisioning/applyEntries.ts — writing provider-declared material
// into a worktree git made seconds ago (design.md D5, D6, D9, D10).
//
// Three rules the word "copy" does not supply:
//
//  1. **No-follow on both ends.** The source's final component is opened
//     `O_NOFOLLOW` and stat-ed on THAT fd; the destination's is opened
//     `O_CREAT | O_EXCL`, which POSIX forbids from following a final symlink.
//     `copyFile` cannot express either, which is why this is not `copyFile`.
//  2. **Every intermediate component is re-checked at descent.** `mkdir` EEXIST
//     is not "fine, carry on" — the node is `lstat`-ed and must be a real
//     directory. A symlink there is a refusal, because `COPYFILE_EXCL` guards
//     the FINAL component only and an intermediate swap escapes right past it.
//  3. **A symlink is validated where it will live, not only where it was
//     found.** A relative target inside the repository at its source can resolve
//     outside the worktree once it lands at a different depth.
//
// The window this does NOT close is between the `lstat` of an intermediate
// directory and the `open` beneath it. POSIX closes it with `openat` on a
// directory handle; Node exposes none, so the design names it as a residual
// rather than implying it away.
//
// Nothing here deletes. A walk that fails partway reports what it managed and
// leaves it — unwinding would mean deleting inside a live worktree, which is
// what the I10 gate keeps out of these paths.

import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { ProvisionEntry, ProvisionStepResult } from "../../types/messages";
import { isResolvedPathInsideRoot, type ResolvedPathInsideDeps } from "../../utils/resolvedPathBoundary";
import type { Deadline } from "../deadline";
import { messageOf } from "../errorMessage";
import { admitEntry, type EntryGateRoots } from "./entryGate";

/** The subset of `fs.Stats` this walk turns on. */
export interface LstatLike {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  mode: number;
  size: number;
}

export interface ApplyFsDeps {
  /** No-follow by definition — reports the link, never its target. */
  lstat(p: string): Promise<LstatLike>;
  readdir(p: string): Promise<readonly string[]>;
  readlink(p: string): Promise<string>;
  /** Non-recursive. `EEXIST` is expected and handled, never pre-empted by a probe. */
  mkdir(p: string, mode: number): Promise<void>;
  symlink(target: string, p: string): Promise<void>;
  /**
   * Copy one regular file, following nothing at either end, and answer with the
   * bytes written. Rejects `ELOOP` when the source is a symlink and `EEXIST`
   * when the destination already exists.
   */
  copyFileNoFollow(source: string, destination: string, mode: number): Promise<number>;
}

/**
 * What stops a walk that a finite list of ENTRIES does not.
 *
 * One selected directory can hold a million files, and this runs inside the
 * per-repository mutation queue — so an unbounded walk delays the create result
 * and every mutation queued behind it (design.md D10).
 */
export interface ApplyBudget {
  readonly maxNodes: number;
  readonly maxBytes: number;
  readonly deadline: Deadline;
}

interface Detail {
  readonly path: string;
  readonly reason: string;
}

/**
 * What became of ONE node.
 *
 * The walk returns this rather than only recording it, because the entry's own
 * outcome is its top-level node's disposition. Reporting `copied` for an entry
 * whose single file was skipped, or whose source turned out to be a socket, is
 * exactly the overclaim `skipped` and `refused` exist to prevent.
 */
type NodeResult = { kind: "written" } | { kind: "skipped"; reason: string } | { kind: "refused"; reason: string };

const WRITTEN: NodeResult = { kind: "written" };

/**
 * How many per-descendant rows one entry reports.
 *
 * The walk's node budget is in the thousands and this list is read by a human
 * in a panel, so the two cannot share a bound.
 */
const MAX_DETAILS = 100;

/** Thrown to stop a walk at once; carries the reason the entry reports. */
class BudgetExceeded extends Error {}

/**
 * The platform saying it has no symlink to give — Windows without Developer
 * Mode or elevation. Anything else from `symlink` is a real failure and is
 * reported as one, because a degradation the user did not need hands them a
 * copy where they asked for write-through.
 */
const NO_SYMLINK: ReadonlySet<string> = new Set(["EPERM", "ENOSYS", "UNKNOWN"]);

const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code;

/**
 * Apply one entry, and never throw for it.
 *
 * Every exit is a `ProvisionStepResult`: the caller reports it beside the
 * create's own outcome and the create's success does not depend on it.
 */
export async function applyEntry(
  entry: ProvisionEntry,
  roots: EntryGateRoots,
  budget: ApplyBudget,
  deps: ApplyFsDeps & ResolvedPathInsideDeps,
): Promise<ProvisionStepResult> {
  const step = (outcome: ProvisionStepResult["outcome"], details?: readonly Detail[]): ProvisionStepResult => ({
    id: entry.id,
    path: entry.path,
    outcome,
    ...(details !== undefined && details.length > 0 ? { details } : {}),
  });

  const admitted = await admitEntry(entry, roots, deps);
  if (!admitted.ok) {
    return step({ kind: "refused", reason: admitted.reason });
  }
  // Held as plain values: a closure below reads them, and narrowing on the
  // union does not survive into one.
  const { source: entrySource, destination: entryDestination } = admitted;

  const details: Detail[] = [];
  let dropped = 0;
  let nodes = 0;
  let bytes = 0;

  /**
   * `details` rides one `postMessage` and is documented display-ready, so its
   * only bound cannot be `maxNodes` — nineteen thousand rows is not a list
   * anybody reads. Overflow is COUNTED rather than dropped silently: a caller
   * must be able to tell a short list from a trimmed one.
   */
  const note = (detail: Detail): void => {
    if (details.length < MAX_DETAILS) {
      details.push(detail);
      return;
    }
    dropped += 1;
  };

  const reported = (): readonly Detail[] =>
    dropped === 0 ? details : [...details, { path: entry.path, reason: `and ${dropped} more not listed` }];

  /**
   * Resolve a directory the way the KERNEL will when it walks it.
   *
   * The fallback is `fs.realpath`, not the spelled path — the same one
   * `resolvedPathBoundary.ts` uses. Falling back to the spelling made an
   * omitted dependency degrade silently into lexical resolution, which is
   * exactly how round-1 F003 shipped: the test fake supplied `realpath` and
   * `nodeApplyFsDeps` did not, so the suite proved a path production never ran.
   *
   * A path that cannot be resolved at all still answers with its spelling; the
   * containment check downstream then refuses it.
   */
  const realpath = async (p: string): Promise<string> => {
    try {
      return await (deps.realpath ?? ((q: string) => fs.realpath(q)))(p);
    } catch {
      return p;
    }
  };

  /**
   * Charge the budget, then check it — for `extra` nodes about to be taken on.
   *
   * `extra` exists because a `readdir` materializes a whole listing in one
   * operation: bounding it one child at a time bounds the walk but not the
   * read that produced it.
   */
  const spend = (extra = 1): void => {
    if (budget.deadline.expired) {
      throw new BudgetExceeded("provisioning took too long and was stopped partway");
    }
    if (nodes + extra > budget.maxNodes) {
      throw new BudgetExceeded(`too many files to bring over — stopped after ${budget.maxNodes}`);
    }
    nodes += extra;
  };

  /**
   * Charge `size` bytes BEFORE the write that spends them.
   *
   * Checking afterwards bounds a sequence of copies and bounds no single one:
   * one file of any size passed a budget that had not been spent yet, so the
   * cap simply did not apply to a one-file entry (round-1 F002).
   */
  const spendBytes = (size: number): void => {
    if (bytes + size > budget.maxBytes) {
      throw new BudgetExceeded(`too large to bring over — stopped after ${budget.maxBytes} bytes`);
    }
    bytes += size;
  };

  /** Relative spelling of an absolute destination, for a `details` row. */
  const shown = (absolute: string): string =>
    // `path.relative` answers in the PLATFORM's separator and `path.posix.join`
    // does not re-split it, so a Windows display path came out as one opaque
    // segment in the one place the user reads to find out what was refused.
    path.posix.join(entry.path, path.relative(entryDestination, absolute).split(path.sep).join("/") || "");

  /**
   * A symlink is recreated only when its target lands inside the main checkout
   * from where it was FOUND and inside the worktree from where it will LIVE.
   * Either check alone is wrong, in a different direction (design.md D6).
   */
  async function copyLink(source: string, destination: string): Promise<NodeResult> {
    const target = await deps.readlink(source);
    // From the REAL directories, not the spelled ones. An entry reached through
    // a symlinked ancestor (`alias -> deep/a/b`) has a lexical dirname that is
    // not where the link actually lives, and resolving a relative target from it
    // refuses links that are genuinely inside — the false negative that mirrors
    // the escape this pair of checks exists to catch.
    const [sourceDir, destinationDir] = await Promise.all([
      realpath(path.dirname(source)),
      realpath(path.dirname(destination)),
    ]);
    const fromSource = path.resolve(sourceDir, target);
    const fromDestination = path.resolve(destinationDir, target);
    const [sourceInside, destinationInside] = await Promise.all([
      isResolvedPathInsideRoot(fromSource, roots.source.prepared, deps),
      isResolvedPathInsideRoot(fromDestination, roots.destination.prepared, deps),
    ]);
    if (!sourceInside || !destinationInside) {
      return {
        kind: "refused",
        reason: "a symlink whose target resolves outside the repository is never followed or recreated",
      };
    }
    try {
      await deps.symlink(target, destination);
    } catch (error) {
      if (codeOf(error) === "EEXIST") {
        return { kind: "skipped", reason: "already there" };
      }
      throw error;
    }
    return WRITTEN;
  }

  /**
   * `mkdir` one destination component, and say what was already there.
   *
   * Shared by the walk and by the parent-creation below so both answer EEXIST
   * the same way: a symlink is a refusal, because an intermediate swap is the
   * escape `O_CREAT | O_EXCL` structurally cannot see (D5).
   */
  async function makeDirectory(destination: string, mode: number): Promise<NodeResult> {
    try {
      await deps.mkdir(destination, mode);
    } catch (error) {
      if (codeOf(error) !== "EEXIST") {
        throw error;
      }
      const existing = await deps.lstat(destination);
      if (existing.isSymbolicLink()) {
        return { kind: "refused", reason: "the destination is a symlink, and provisioning never writes through one" };
      }
      if (!existing.isDirectory()) {
        return { kind: "skipped", reason: "a file is already there, so its contents were not brought over" };
      }
    }
    return WRITTEN;
  }

  /**
   * Make the directories an entry's own destination needs.
   *
   * A worktree git made seconds ago holds only tracked files, so a declared
   * entry under an ignored directory — `apps/web/.env` — has no parent to land
   * in and used to fail with a raw errno (round-1 F012). Each component is
   * created through `makeDirectory`, so a planted symlink is refused here on
   * the same rule the descent uses, and each is containment-checked, so this
   * does not become a second way into the tree with weaker rules than the walk.
   */
  async function ensureParents(): Promise<NodeResult> {
    const relative = path.relative(roots.destination.prepared.resolved, path.dirname(entryDestination));
    if (relative === "" || relative.startsWith("..")) {
      return WRITTEN;
    }
    let at = roots.destination.prepared.resolved;
    for (const segment of relative.split(path.sep)) {
      at = path.join(at, segment);
      spend();
      if (!(await isResolvedPathInsideRoot(at, roots.destination.prepared, deps))) {
        return { kind: "refused", reason: "a parent directory of this entry resolves outside the worktree" };
      }
      const made = await makeDirectory(at, 0o755);
      if (made.kind !== "written") {
        return made;
      }
    }
    return WRITTEN;
  }

  async function walk(source: string, destination: string): Promise<NodeResult> {
    spend();
    const node = await deps.lstat(source);

    if (node.isSymbolicLink()) {
      // Never traversed, which is also why a loop terminates here.
      return copyLink(source, destination);
    }

    if (node.isFile()) {
      spendBytes(node.size);
      try {
        await deps.copyFileNoFollow(source, destination, node.mode);
      } catch (error) {
        if (codeOf(error) === "EEXIST") {
          return { kind: "skipped", reason: "already there" };
        }
        throw error;
      }
      return WRITTEN;
    }

    if (!node.isDirectory()) {
      return {
        kind: "refused",
        reason: "not a file, a directory or a symlink — devices, sockets and FIFOs are never configuration",
      };
    }

    // EEXIST is not "fine, carry on". What is actually THERE decides whether
    // there is anything to descend into — and a symlink there is the
    // intermediate-component escape the exclusive primitive cannot see.
    const made = await makeDirectory(destination, node.mode);
    if (made.kind !== "written") {
      return made;
    }

    const children = await deps.readdir(source);
    spend(children.length);
    for (const child of children) {
      const childDestination = path.join(destination, child);
      const result = await walk(path.join(source, child), childDestination);
      if (result.kind !== "written") {
        note({ path: shown(childDestination), reason: result.reason });
      }
    }
    return WRITTEN;
  }

  /**
   * A link entry is ONE node, never a walk.
   *
   * It points OUT of the worktree on purpose — that is what "link" means, and
   * why D6's destination-side containment governs links found inside a copied
   * tree rather than this. What makes it safe is already established: the entry
   * gate put the target inside the main checkout and the link inside the
   * worktree.
   */
  async function makeLink(): Promise<NodeResult | "degrade"> {
    const target = path.relative(path.dirname(entryDestination), entrySource);
    try {
      await deps.symlink(target, entryDestination);
    } catch (error) {
      const code = codeOf(error);
      if (code === "EEXIST") {
        return { kind: "skipped", reason: "already there" };
      }
      if (code !== undefined && NO_SYMLINK.has(code)) {
        return "degrade";
      }
      throw error;
    }
    return WRITTEN;
  }

  try {
    const parents = await ensureParents();
    if (parents.kind !== "written") {
      return step({ kind: parents.kind, reason: parents.reason }, reported());
    }
    if (entry.mode === "link") {
      const linked = await makeLink();
      if (linked !== "degrade") {
        return linked.kind === "written"
          ? step({ kind: "linked" })
          : step({ kind: linked.kind, reason: linked.reason });
      }
      // The material still arrives; it just arrives as a copy, and the report
      // says which — a link and a copy differ in the way the dialog told the
      // user about, so neither a silent success nor a failure is honest here.
      const copied = await walk(entrySource, entryDestination);
      if (copied.kind !== "written") {
        return step({ kind: copied.kind, reason: copied.reason }, reported());
      }
      return step({ kind: "degradedToCopy" }, reported());
    }

    const result = await walk(entrySource, entryDestination);
    if (result.kind === "skipped" || result.kind === "refused") {
      return step({ kind: result.kind, reason: result.reason }, reported());
    }
    // The link branch above returns for every link entry, so what reaches here
    // is a copy — the mode ternary that used to sit here could not be false.
    return step({ kind: "copied" }, reported());
  } catch (error) {
    if (error instanceof BudgetExceeded) {
      return step({ kind: "failed", reason: error.message }, reported());
    }
    return step({ kind: "failed", reason: messageOf(error) }, reported());
  } finally {
    budget.deadline.cancel();
  }
}

/**
 * The production binding, beside the walk that depends on its flags.
 *
 * `O_NOFOLLOW` on the source and `O_CREAT | O_EXCL` on the destination are the
 * two halves of "follows nothing at either end". Putting them in wiring instead
 * would let them drift from the reasoning that needs them.
 */
export const nodeApplyFsDeps: ApplyFsDeps & ResolvedPathInsideDeps = {
  lstat: (p) => fs.lstat(p),
  readdir: (p) => fs.readdir(p),
  readlink: (p) => fs.readlink(p),
  // Present because it was ABSENT: the walk's two-sided symlink check resolves
  // through this, and omitting it is what made D6 run on lexical dirnames in
  // production while every test ran the corrected path (round-1 F003).
  realpath: (p) => fs.realpath(p),
  mkdir: async (p, mode) => void (await fs.mkdir(p, { mode })),
  symlink: (target, p) => fs.symlink(target, p),
  copyFileNoFollow: async (source, destination, mode) => {
    // Windows has no O_NOFOLLOW; `?? 0` degrades to a following open there
    // rather than throwing, and the platform's own symlink story is why link
    // entries degrade to copies on it at all (D7).
    const source_ = await fs.open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    // The streams own the handles from the moment they exist, and closing a
    // handle a stream still holds NEVER SETTLES — `close()` waits on a
    // reference `autoClose: false` guarantees is never released, so the
    // original spelling of this function hung on the first byte of the first
    // file and held the mutation queue behind it forever. Found by the
    // real-filesystem suite; the injected fake copies without streams, so no
    // amount of care over there could have reached it.
    let unstreamed = true;
    try {
      const stat = await source_.stat();
      if (!stat.isFile()) {
        const error = new Error(`not a regular file: ${source}`) as NodeJS.ErrnoException;
        error.code = "EINVAL";
        throw error;
      }
      const destination_ = await fs.open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, mode);
      unstreamed = false;
      await pipeline(source_.createReadStream(), destination_.createWriteStream());
      return stat.size;
    } finally {
      if (unstreamed) {
        await source_.close();
      }
    }
  },
};
