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
  /**
   * The provisioning manifest's raw text, or a throw when there is none.
   *
   * `.git/worktrees/<id>/anywhere-terminal-provision.json`, which git itself
   * deletes with the worktree (worktree-apply.md § 2.6).
   */
  readManifest(): Promise<string>;
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
  | { kind: "measured"; entries: number; bytes: number; provisioned?: { entries: number } }
  | { kind: "unproven"; reason: "budget" | "unreadable" };

/** The manifest shape this reader recognises. A later writer may mean something else. */
const MANIFEST_VERSION = 1;

/**
 * How many entries the manifest says we provisioned, or `undefined`.
 *
 * Missing, unreadable, malformed and unrecognised-version are ONE answer: we did
 * not differentiate. Its absence is how the report says so — a zero would claim
 * we looked and found none of it was ours.
 *
 * Nothing here infers provenance from a path. `.env.worktree` looking like ours
 * is not evidence it is ours, and a guess produces the sentence "the 4 files
 * this worktree was set up with" about files the user wrote.
 */
function provisionedEntries(text: string): number | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const record = parsed as { version?: unknown; materialized?: unknown } | null;
  if (record === null || typeof record !== "object" || record.version !== MANIFEST_VERSION) {
    return undefined;
  }
  return Array.isArray(record.materialized) ? record.materialized.length : undefined;
}

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
  // Read only once the walk finished. The manifest says what we provisioned, not
  // how much is there, so attaching it to a walk that gave up would decorate a
  // measurement nobody took.
  let provisioned: number | undefined;
  try {
    provisioned = provisionedEntries(await deps.readManifest());
  } catch {
    provisioned = undefined;
  }
  return {
    kind: "measured",
    entries,
    bytes,
    ...(provisioned === undefined ? {} : { provisioned: { entries: provisioned } }),
  };
}

/**
 * The one production read behind {@link measureIgnoredMaterial}.
 *
 * Split from the measurement so the budget logic stays testable without a disk,
 * and so this half — which is all seam and no decision — has exactly one place
 * to be wrong.
 */
export interface DiskIgnoredOptions {
  /** The worktree's own directory. Every relative path is joined onto it. */
  worktreePath: string;
  run(args: readonly string[], cwd: string): Promise<{ code: number; stdout: Buffer; timedOut: boolean }>;
  stat(absPath: string): Promise<{ size: number }>;
  readFile(absPath: string): Promise<string>;
  join(...parts: string[]): string;
  now?(): number;
}

/**
 * `--ignored=matching`, not the default `--ignored=traditional`.
 *
 * Traditional collapses an ignored directory to one entry, and a `node_modules/`
 * stat's are the directory inode — a few hundred bytes standing in for a
 * gigabyte. Matching names every ignored FILE, which is both the count worth
 * reporting and the population the entry budget exists to stop.
 */
export function diskIgnoredDeps(options: DiskIgnoredOptions): IgnoredMaterialDeps {
  const { worktreePath, run, stat, readFile, join } = options;
  return {
    ignoredEntries: async function* () {
      const result = await run(["status", "--porcelain", "--ignored=matching"], worktreePath);
      if (result.code !== 0 || result.timedOut) {
        // Not an empty listing: the walk did not establish that there is
        // nothing here, and `measureIgnoredMaterial` reports the throw as
        // `unreadable` rather than as a measured zero.
        throw new Error(`git status --ignored exited ${result.code}`);
      }
      for (const line of result.stdout.toString("utf8").split("\n")) {
        if (!line.startsWith("!! ")) {
          continue;
        }
        const path = line.slice(3);
        yield path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path;
      }
    },
    size: async (relPath) => (await stat(join(worktreePath, relPath))).size,
    readManifest: async () => {
      // The worktree's OWN git dir — `.git/worktrees/<name>` — which is where
      // the apply path writes the manifest and which git deletes along with the
      // worktree (worktree-apply.md § 2.6).
      const dir = await run(["rev-parse", "--absolute-git-dir"], worktreePath);
      if (dir.code !== 0 || dir.timedOut) {
        throw new Error(`git rev-parse --absolute-git-dir exited ${dir.code}`);
      }
      return await readFile(join(dir.stdout.toString("utf8").trim(), "anywhere-terminal-provision.json"));
    },
    now: options.now ?? Date.now,
  };
}
