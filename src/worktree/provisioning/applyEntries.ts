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

import path from "node:path";
import type { ProvisionEntry, ProvisionStepResult } from "../../types/messages";
import { isResolvedPathInsideRoot, type ResolvedPathInsideDeps } from "../../utils/resolvedPathBoundary";
import type { Deadline } from "../deadline";
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

/** Thrown to stop a walk at once; carries the reason the entry reports. */
class BudgetExceeded extends Error {}

const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === "string" ? error : "unknown error";

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

  // Poll-able rather than raced: racing reports a failure while the walk keeps
  // writing, and the whole point of the budget is to stop holding the queue.
  let expired = false;
  const watch = budget.deadline.elapsed.then(() => {
    expired = true;
  });
  void watch;

  const details: Detail[] = [];
  let nodes = 0;
  let bytes = 0;

  /** Falls back to the spelled path when it cannot resolve — the containment check then refuses it. */
  const realpath = async (p: string): Promise<string> => {
    try {
      return (await deps.realpath?.(p)) ?? p;
    } catch {
      return p;
    }
  };

  const spend = (): void => {
    nodes += 1;
    if (expired) {
      throw new BudgetExceeded("provisioning took too long and was stopped partway");
    }
    if (nodes > budget.maxNodes) {
      throw new BudgetExceeded(`too many files to bring over — stopped after ${budget.maxNodes}`);
    }
    if (bytes > budget.maxBytes) {
      throw new BudgetExceeded(`too large to bring over — stopped after ${budget.maxBytes} bytes`);
    }
  };

  /** Relative spelling of an absolute destination, for a `details` row. */
  const shown = (absolute: string): string =>
    path.posix.join(entry.path, path.relative(admitted.destination, absolute) || "");

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

  async function walk(source: string, destination: string): Promise<NodeResult> {
    spend();
    const node = await deps.lstat(source);

    if (node.isSymbolicLink()) {
      // Never traversed, which is also why a loop terminates here.
      return copyLink(source, destination);
    }

    if (node.isFile()) {
      try {
        bytes += await deps.copyFileNoFollow(source, destination, node.mode);
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

    try {
      await deps.mkdir(destination, node.mode);
    } catch (error) {
      if (codeOf(error) !== "EEXIST") {
        throw error;
      }
      // EEXIST is not "fine, carry on". What is actually THERE decides whether
      // there is anything to descend into — and a symlink there is the
      // intermediate-component escape the exclusive primitive cannot see.
      const existing = await deps.lstat(destination);
      if (existing.isSymbolicLink()) {
        return { kind: "refused", reason: "the destination is a symlink, and provisioning never writes through one" };
      }
      if (!existing.isDirectory()) {
        return { kind: "skipped", reason: "a file is already there, so its contents were not brought over" };
      }
    }

    for (const child of await deps.readdir(source)) {
      const childDestination = path.join(destination, child);
      const result = await walk(path.join(source, child), childDestination);
      if (result.kind !== "written") {
        details.push({ path: shown(childDestination), reason: result.reason });
      }
    }
    return WRITTEN;
  }

  try {
    const result = await walk(admitted.source, admitted.destination);
    if (result.kind === "skipped" || result.kind === "refused") {
      return step({ kind: result.kind, reason: result.reason }, details);
    }
    return step(entry.mode === "link" ? { kind: "linked" } : { kind: "copied" }, details);
  } catch (error) {
    if (error instanceof BudgetExceeded) {
      return step({ kind: "failed", reason: error.message }, details);
    }
    return step({ kind: "failed", reason: messageOf(error) }, details);
  } finally {
    budget.deadline.cancel();
  }
}
