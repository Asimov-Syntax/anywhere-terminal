// src/worktree/mutationCoordinator.ts — The one order every mutating worktree
// action runs in (design.md D12).
//
//   acquire mutationQueue(repoId)
//     → await a forced rebuildGate barrier   (resolve against the rebuilt tree)
//     → re-resolve the target / re-validate the path
//     → run git
//     → force and await the post-attempt rebuild
//     → release in `finally`
//
// The queue (D1) keeps two mutations from interleaving, but a lock alone does
// not satisfy worktree-rpc.md:238 — an action arriving while a watcher-driven
// rebuild is in flight would otherwise re-resolve from the cache that rebuild is
// replacing. The barrier is what makes the re-resolution mean anything.
//
// LOCK ORDER IS ONE-WAY: mutationQueue → rebuildGate. A gate callback that
// awaits the mutation queue closes the cycle and deadlocks. `rebuild()` acquires
// no mutation lock today; this file is where that invariant is written down.

import type { MutationQueue } from "./mutationQueue";
import type { RebuildGate } from "./rebuildGate";

export interface MutationCoordinatorDeps {
  queue: MutationQueue;
  gate: Pick<RebuildGate, "request">;
}

export interface MutationStep<TTarget, TResult> {
  /**
   * Re-resolve the action's target against the tree as it stands now. Returning
   * `null` means the id no longer names anything, and the body never runs.
   */
  resolve(): Promise<TTarget | null>;
  /**
   * What to do when the id names nothing any more. Absent → the step throws,
   * which is right for a verb that has nothing to clean up.
   *
   * A removal is the exception: the disappearance IS the observation D15 turns
   * a confirmation on, so the token has to be spent on this path rather than
   * left alive for whatever is created at the same location next (round-3 B5).
   */
  missing?(): Promise<TResult>;
  body(target: TTarget, ctx: MutationSettle): Promise<TResult>;
}

/** The post-attempt rebuild, owned by the coordinator and performed exactly once. */
export interface MutationSettle {
  /**
   * Force and await the rebuild that follows the attempt. Idempotent: a body
   * that needs the rebuilt tree to classify its own result calls this, and the
   * coordinator's own post-attempt call then finds the work already done
   * rather than rebuilding a third time (round-3 W5).
   */
  settle(): Promise<void>;
}

export interface MutationCoordinator {
  run<TTarget, TResult>(repoId: string, step: MutationStep<TTarget, TResult>): Promise<TResult>;
}

export function createMutationCoordinator(deps: MutationCoordinatorDeps): MutationCoordinator {
  return {
    run<TTarget, TResult>(repoId: string, step: MutationStep<TTarget, TResult>): Promise<TResult> {
      return deps.queue.run(repoId, async () => {
        // Marked done AFTER the rebuild resolves, never before it. Setting the
        // flag first marked a rebuild that had not happened, so a rejected one
        // left `finally` unable to retry and the tree unsynced (round-4 W10).
        // The queue serializes per repo, so there are no concurrent callers to
        // de-duplicate — only this ordering matters.
        let done = false;
        const settle = async (): Promise<void> => {
          if (done) {
            return;
          }
          await deps.gate.request(repoId, { force: true });
          done = true;
        };
        try {
          await deps.gate.request(repoId, { force: true });
          const target = await step.resolve();
          if (target === null) {
            if (step.missing) {
              return await step.missing();
            }
            throw new Error(`The worktree this action names no longer exists in ${repoId}.`);
          }
          return await step.body(target, { settle });
        } finally {
          // After EVERY attempt, including a throw and including a timeout: a
          // killed mutation has already changed an unknown amount of state, and
          // leaving the tree unsynced would show the user a repository that no
          // longer exists (D11).
          //
          // Swallowed HERE only: this is the retry, and a failed rebuild must
          // not replace the outcome the body already produced. A body that
          // depends on the rebuild awaits `settle()` itself and sees the
          // rejection there.
          await settle().catch(() => {});
        }
      });
    },
  };
}
