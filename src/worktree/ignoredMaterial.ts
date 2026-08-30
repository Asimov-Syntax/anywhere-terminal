// src/worktree/ignoredMaterial.ts — What a removal will actually delete.
//
// `git status --porcelain` reports tracked changes and untracked files and says
// nothing about IGNORED material — and this subsystem deliberately creates
// ignored material in every worktree it provisions: `.env.worktree`, copied
// local configuration, installed dependencies, build output. A report where
// every check passed, followed by deleting a `node_modules` and a copied
// `.env`, did not mention the thing the user most needed to hear
// (worktree-removal.md § 2.3).
//
// The reads are injected, so the suite needs no disk.

/** Entries scanned before the walk gives up. */
export const MAX_IGNORED_ENTRIES = 5000;

/** Milliseconds spent walking before the walk gives up. */
export const MAX_IGNORED_MS = 1500;

export interface IgnoredMaterialDeps {
  /**
   * The worktree's ignored entries, one at a time.
   *
   * An async iterable rather than a list: a materialized listing is unbounded
   * before any budget can apply to it, which is the cost this walk exists to
   * bound.
   */
  ignoredEntries(): AsyncIterable<string>;
  /** Bytes at one entry. Throws rather than answering 0 for a failed stat. */
  size(relPath: string): Promise<number>;
  now(): number;
}

/**
 * What one bounded walk found, or why it could not finish.
 *
 * `unproven` carries no count, in either variant. § 2.5 renders `count` inside
 * its own element as a reading that was taken, so a partial total is worse than
 * no total — it reads as a number somebody measured.
 */
export type IgnoredMaterial =
  | { kind: "measured"; entries: number; bytes: number }
  | { kind: "unproven"; reason: "budget" | "unreadable" };

/**
 * Count and size the ignored material, under one entry budget and one time
 * budget spanning both the enumeration and the sizing.
 *
 * Unproven here is CONFIRMABLE, never refusing: § 2.3 is explicit that a slow
 * or unreadable disk must not make a worktree unremovable.
 */
export async function measureIgnoredMaterial(deps: IgnoredMaterialDeps): Promise<IgnoredMaterial> {
  const startedAt = deps.now();
  let entries = 0;
  let bytes = 0;
  try {
    for await (const relPath of deps.ignoredEntries()) {
      // Checked before the entry is admitted, so the caps bound what is stat'd
      // and not merely what is reported.
      if (entries >= MAX_IGNORED_ENTRIES || deps.now() - startedAt > MAX_IGNORED_MS) {
        return { kind: "unproven", reason: "budget" };
      }
      entries += 1;
      bytes += await deps.size(relPath);
    }
  } catch {
    // A stat that failed and an enumeration that threw are the same answer: we
    // do not know the total. Counting a failed stat as 0 bytes would state one
    // the walk never established.
    return { kind: "unproven", reason: "unreadable" };
  }
  return { kind: "measured", entries, bytes };
}
