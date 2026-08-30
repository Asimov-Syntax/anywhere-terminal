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
      // Checked AFTER the await as well. One pathologically slow stat can run
      // past the whole budget on its own, and the check at the top of the next
      // iteration never runs when that entry is the last (round-1 B4).
      if (deps.now() - startedAt > MAX_IGNORED_MS) {
        return { kind: "unproven", reason: "budget" };
      }
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
  run(
    args: readonly string[],
    cwd: string,
    runOptions?: { timeoutMs?: number },
  ): Promise<{ code: number; stdout: Buffer; timedOut: boolean }>;
  stat(absPath: string): Promise<{ size: number }>;
  readFile(absPath: string): Promise<string>;
  join(...parts: string[]): string;
  now?(): number;
}

/**
 * `git ls-files --others --ignored --exclude-standard -z`, not `git status --ignored`.
 *
 * `git status --ignored` reports an ignored DIRECTORY as one entry — verified
 * against git 2.50.1, where `--ignored=matching` and `--ignored=traditional`
 * both emit `!! node_modules/` for a directory the .gitignore names. Stat-ing
 * that entry sizes the directory inode, so a gigabyte reports as one entry and
 * a few hundred bytes: a number that looks measured and is wrong by six orders
 * of magnitude (round-1 B3). `ls-files` enumerates the files themselves, which
 * is both the count worth reporting and the population the entry budget exists
 * to stop.
 *
 * `-z` for the same reason it is used everywhere else git paths are read: the
 * line-delimited form c-quotes any path holding a quote, a backslash, a control
 * character or a non-ASCII byte, and NUL-delimited output is never quoted — so
 * the quoting grammar this adapter would otherwise have to implement, and get
 * wrong, does not arise (round-1 W1).
 */
export function diskIgnoredDeps(options: DiskIgnoredOptions): IgnoredMaterialDeps {
  const { worktreePath, run, stat, readFile, join } = options;
  return {
    ignoredEntries: async function* () {
      // The listing is buffered whole before the first entry is admitted, so
      // the walk's own deadline has to reach git rather than leaving the
      // enumeration on the runner's much larger default (round-1 B4). The
      // whole-walk bound is therefore this budget for the listing plus the same
      // budget for the sizing, not one budget across both.
      const result = await run(["ls-files", "--others", "--ignored", "--exclude-standard", "-z"], worktreePath, {
        timeoutMs: MAX_IGNORED_MS,
      });
      if (result.code !== 0 || result.timedOut) {
        // Not an empty listing: the walk did not establish that there is
        // nothing here, and `measureIgnoredMaterial` reports the throw as
        // `unreadable` rather than as a measured zero.
        throw new Error(`git ls-files --ignored exited ${result.code}`);
      }
      for (const entry of result.stdout.toString("utf8").split("\0")) {
        if (entry.length > 0) {
          yield entry;
        }
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
