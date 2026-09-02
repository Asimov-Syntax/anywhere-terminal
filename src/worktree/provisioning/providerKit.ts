// src/worktree/provisioning/providerKit.ts — The half of a provider adapter that
// is not about any one provider: authorize a file, read it under a budget,
// expand a glob, and say what went wrong.
//
// Extracted from `asimovProvider.ts`, which was the only adapter when it was
// written and stamped `asimov/worktree.yaml` into every problem and every entry
// it built. Three adapters now read three checked-in, untrusted files, and they
// need ONE containment rule, ONE budget and one ordering of open-after-check —
// not three copies that can drift (design.md D2).
//
// Nothing here writes, spawns, or deletes. `ProviderDeps` offers four reads and
// nothing else, and `readOnly.test.ts` asserts no module on this path imports a
// capability the interface withholds.

import * as path from "node:path";
import { getNodeValue, type ParseError, parseTree } from "jsonc-parser";
import type {
  ProvisionContenders,
  ProvisionEntry,
  ProvisionModel,
  ProvisionPort,
  ProvisionProblem,
  ProvisionProvider,
  ProvisionSetupStep,
} from "../../types/messages";
import { isResolvedPathInsideRoot, type PreparedRoot, prepareResolvedRoot } from "../../utils/resolvedPathBoundary";

export interface ProviderDeps {
  readFile(p: string): Promise<string>;
  /**
   * Names only, no types — the glob cares what is there, not what kind it is.
   *
   * An async iterable is accepted so a directory can be scanned under a budget
   * rather than materialized: the enumeration cost is unbounded even when every
   * name fails the pattern (.reviews/round-2.md B7). An array is still accepted
   * for callers that have one already.
   */
  readdir(p: string): Promise<readonly string[]> | AsyncIterable<string>;
  realpath?(p: string): Promise<string>;
  lstat?(p: string): Promise<unknown>;
}

/**
 * Who is asking, and about which of their files.
 *
 * Every problem's `file` and every entry's `source` is stamped from here. It is
 * a parameter rather than a module constant because the previous shape — a
 * constant — would have made an orca entry claim it came from
 * `asimov/worktree.yaml`, with the whole asimov suite green, since that is
 * exactly what those tests assert (design.md D2).
 *
 * An adapter reading two files changes `file` between them: provenance answers
 * which file said so, and orca splits what asimov keeps together.
 */
export interface ProviderContext {
  readonly id: ProvisionProvider["id"];
  readonly file: string;
}

/**
 * A parser message can quote arbitrary file content (§ 7), so it is bounded
 * before it is stored and rendered as text by whoever displays it.
 */
export const DETAIL_MAX = 300;

export function bounded(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= DETAIL_MAX ? oneLine : `${oneLine.slice(0, DETAIL_MAX - 1)}…`;
}

/**
 * The most rows one offer may carry.
 *
 * A glob's directory is repository-controlled, so `*` against a `node_modules`
 * sibling would otherwise push unbounded rows through `postMessage` and into the
 * DOM (round-1 B7). The budget is on the MODEL rather than per glob, because
 * many small globs cost the same as one large one.
 */
export const MAX_MODEL_ROWS = 200;

/**
 * The most directory entries one glob may look at.
 *
 * Separate from the row budget because they bound different costs: a directory
 * of a million non-matching names produces no rows at all and was still read in
 * full (round-2 B7). Larger than the row budget so an ordinary directory holding
 * some noise still expands completely.
 */
export const MAX_SCAN = 2000;

/**
 * Absence, told apart from failure.
 *
 * Every other errno — EACCES, ELOOP, EIO, EFBIG from the bounded reader — means
 * the material is THERE and we could not read it, which the spec requires be
 * named. Swallowing them made the section say "Nothing configured" about a
 * repository whose provider file exists, which is an affirmative false claim
 * (round-1 B8).
 */
export function isAbsence(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** The errno, for a problem detail. Never the message: it can carry a path. */
export function errnoOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "unknown error";
}

/**
 * A counter, one per read.
 *
 * Callers take theirs from `ProviderBudget.nextId` rather than calling this,
 * so every row of one read is numbered from one sequence (design.md D7). This
 * stays exported for the budget to build and for tests that want a bare one.
 *
 * Deliberately not derived from the path: an id that encoded one would be a
 * path the webview could read back out and reason about, and an id from a
 * superseded offer would still name something. A counter resolves to nothing
 * once its offer is gone, which is the answer § 4.0 wants.
 */
export function ids(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `i${n}`;
  };
}

/**
 * Two accounts, spent once per read.
 *
 * They are separate because they bound different costs and neither implies the
 * other: `rows` bounds what crosses `postMessage` and reaches the DOM, `scanned`
 * bounds the work done to decide what those rows are. A directory of
 * non-matching names costs the second and nothing of the first, which is how a
 * repository declaring many globs stayed unbounded under a row cap alone
 * (design.md D9).
 *
 * They are also on the BUDGET rather than on a draft, because a provider that
 * reads two files builds two drafts and must not get two budgets for it.
 */
export interface ProviderBudget {
  rows: number;
  scanned: number;
  /** The cap's reason has been recorded against this budget; do not record it again. */
  capped: boolean;
  /**
   * One id sequence for the whole read (design.md D7).
   *
   * It lives here because this object already has exactly the scope wanted: D9
   * gives one budget to every adapter consulted in one read, and `assemble`
   * hands the same one to the base adapter it builds on. An adapter that mints
   * from its own `ids()` restarts at `i1`, so a base row and a native row that
   * both survive the merge can carry the same id — which round-1 F003 showed
   * collapses a contender group down a map keyed on it, silently and totally.
   */
  nextId: () => string;
}

/**
 * Read a JSONC document without letting a member NAME reach the prototype.
 *
 * `jsonc-parser`'s `parse()` builds its result with ordinary property
 * assignment, so a `"__proto__"` member does not become a key — it replaces the
 * object's prototype. The parser reports no error, `Object.keys` never sees it,
 * and an ordinary lookup for `extends` then resolves through the chain: values
 * consumed from a key the file's own key list does not carry, and which the
 * unknown-key report therefore never names (.reviews/round-7.md F012).
 *
 * `parseTree` keeps the member names it read, and `getNodeValue` materializes
 * them onto `Object.create(null)` at every depth. So `__proto__` becomes an own
 * key — reported like any other name the system does not read — and no lookup
 * can resolve a value the file did not declare.
 *
 * Error tolerance is unchanged, which is the point: both forms report the same
 * errors and recover the same keys, including a member whose value failed to
 * parse, where `getNodeValue` skips the member exactly as `parse()` does.
 * Building the record by hand instead is what a plan attack refuted — the
 * obvious loop reads a value node that a damaged member does not have, and
 * throws where the accepted contract says the file must be recovered.
 */
export function readJsonc(text: string, errors: ParseError[]): unknown {
  const tree = parseTree(text, errors, {
    // The format, not a defect in it: both files this reads are edited by hands
    // that write comments and leave a trailing comma.
    disallowComments: false,
    allowTrailingComma: true,
    allowEmptyContent: true,
  });
  return tree === undefined ? undefined : getNodeValue(tree);
}

export function newBudget(): ProviderBudget {
  return { rows: 0, scanned: 0, capped: false, nextId: ids() };
}

export type Draft = {
  /** Stamped onto everything this draft emits. Reassigned when a source moves file. */
  ctx: ProviderContext;
  /** Shared with every other draft of the same read. */
  budget: ProviderBudget;
  entries: ProvisionEntry[];
  setup: ProvisionSetupStep[];
  ports: ProvisionPort[];
  problems: ProvisionProblem[];
};

export function newDraft(ctx: ProviderContext, budget: ProviderBudget = newBudget()): Draft {
  return { ctx, budget, entries: [], setup: [], ports: [], problems: [] };
}

/** True once this budget's row cap has been recorded. */
export function capped(draft: Draft): boolean {
  return draft.budget.capped;
}

// Every append is charged AND refused by the same call, so the count cannot
// drift from the collections it claims to bound. A direct `.push` on a draft is
// one defect these prevent; the other is a caller that charges the budget and
// never asks whether it had room, which is how a task file of 250 declared
// steps produced 250 rows under a 200-row cap (.reviews/round-1.md F002).
//
// Each returns whether the row was taken, so a loop over repository-controlled
// input can stop instead of spinning against a full budget.
export function addEntry(draft: Draft, entry: ProvisionEntry): boolean {
  return addRow(draft, `\`${entry.path}\``, draft.entries, entry);
}

export function addPort(draft: Draft, port: ProvisionPort): boolean {
  return addRow(draft, `port \`${port.name}\``, draft.ports, port);
}

export function addSetup(draft: Draft, step: ProvisionSetupStep): boolean {
  return addRow(draft, "a setup step", draft.setup, step);
}

function addRow<T>(draft: Draft, what: string, sink: T[], row: T): boolean {
  if (full(draft, what)) {
    return false;
  }
  draft.budget.rows += 1;
  sink.push(row);
  return true;
}

function addProblem(draft: Draft, p: ProvisionProblem): void {
  draft.budget.rows += 1;
  draft.problems.push(p);
}

export function problem(ctx: ProviderContext, reason: ProvisionProblem["reason"], detail: string): ProvisionProblem {
  return { file: ctx.file, reason, detail: bounded(detail) };
}

/**
 * How many rows the read has already committed to.
 *
 * One account across ALL four collections and every draft sharing the budget.
 * Counting `entries` alone let ports, setup steps and problems past a cap
 * described as model-wide (round-2 B7) — and a refused match emits a problem, so
 * an all-escaping directory was as unbounded as an all-matching one.
 */
export function emitted(draft: Draft): number {
  return draft.budget.rows;
}

/** True once the offer is full. Records the reason exactly once. */
export function full(draft: Draft, what: string): boolean {
  // One slot reserved for the message itself, so the budget bounds the rows the
  // webview actually receives rather than that number plus one.
  if (emitted(draft) < MAX_MODEL_ROWS - 1) {
    return false;
  }
  if (!draft.budget.capped) {
    draft.budget.capped = true;
    // Reported, never silently truncated: a shorter list than the repository
    // asked for is the "shown list differs from the copied list" failure this
    // module exists to prevent.
    addProblem(
      draft,
      problem(draft.ctx, "malformed", `More than ${MAX_MODEL_ROWS} rows; ${what} and after are not offered.`),
    );
  }
  return true;
}

/**
 * Record a problem, unless the budget is already spent.
 *
 * EVERY problem append goes through here. An earlier version put the cap in
 * front of the three row collections and in front of a refused match, which left
 * the file that can produce the most output entirely unbounded: an unrecognized
 * key emits a problem and nothing else, so a file of nothing but unknown keys
 * never reached a check (.reviews/round-3.md B7). The cap protects the
 * postMessage and the DOM, and a problem row costs those what an entry row does.
 */
export function report(draft: Draft, what: string, p: ProvisionProblem): void {
  if (full(draft, what)) {
    return;
  }
  addProblem(draft, p);
}

/** True once no glob may look at another name. */
export function scanExhausted(budget: ProviderBudget): boolean {
  return budget.scanned >= MAX_SCAN;
}

/**
 * Which destination a declared path names.
 *
 * Two files spelling one destination differently — `node_modules` against
 * `./node_modules`, or `a/../node_modules` — compared as raw strings stayed two
 * rows, so an inherited LINK survived beside the native COPY for the same place,
 * and `exclude: ["./x"]` matched an inherited `x` not at all
 * (.reviews/round-1.md F001). Normalization closes that on every platform.
 *
 * Case is folded on the PLATFORM's answer and nothing else. Five mechanisms that
 * asked the FILESYSTEM instead were each refuted, always in the same direction:
 * a probe reads an OBJECT, and the question is about a NAME. Existence is not
 * folding (round-4 F005); a case-toggled symlink makes two spellings resolve
 * alike on a volume that folds nothing; `realpath` dereferences, so two symlink
 * aliases to one file collapsed into one row and a declared row vanished
 * (round-5 F008); `dev`+`ino` is object identity, so two hard links and a
 * symlinked parent collapse the same way. Merging is the direction that DISCARDS
 * something the repository asked for, and no available primitive can prove two
 * names are one destination slot (design.md D11).
 *
 * So this reads nothing. The identity path makes no filesystem call at all,
 * which is also why a raw `exclude` spelling can no longer reach outside the
 * checkout (round-5 F009) and why there is nothing here to bound (F010).
 *
 * A seventh answer was tested and rejected before this landed: folding ASCII
 * only. It closes the over-merge (`İ`/`i̇`, `ẞ`/`ß`, `Ϗ`/`ϗ` stay apart, as NTFS
 * keeps them) but makes the other direction worse — `Straße`/`STRASSE` and
 * `ﬀ`/`ff` are ONE file on APFS, so splitting them reproduces the defect. Every
 * fold has a volume it is wrong on, because folding is a property of the
 * destination directory and this code runs before that directory exists.
 *
 * So there is no fold here at all. Two spellings that differ stay two rows; a
 * pair that MAY be one destination travels as a contender group instead, and
 * the apply side settles it where the answer can actually be observed
 * (design.md D1, D2, D3).
 *
 * Used for identity only. What a row DISPLAYS and what it names as its `source`
 * are never touched — § 4.3 forbids rewriting either, and a row that showed the
 * canonical form would be telling the user something their file does not say.
 */
export function identityOf(declared: string): string {
  const normalized = path.posix.normalize(declared);
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

/**
 * A key two spellings share when some supported filesystem would fold them.
 *
 * Deliberately generous and deliberately not a proof (design.md D4). Three
 * attempts at this predicate have now been rejected, each of which passed its
 * own witnesses, so the shape of the answer matters more than the characters:
 *
 * - Lexical normalization only. Missed everything.
 * - `NFC` + `toLowerCase`. Missed `Straße`/`STRASSE`, the `ﬀ` ligature, and a
 *   Win32 dot on a non-final segment.
 * - `NFKC` + lowercase + a curated expansion list. Missed Greek `σ`/`ς`.
 *
 * A union with `Intl.Collator` was proposed to close the third and refuted
 * before it was built: against every default full fold in Unicode 16 it still
 * missed 64 pairs, all of which are one file on APFS — Greek ypogegrammeni
 * expansion, where `ᾳ` and `αι` name one destination. `ᾼ`/`ᾳ` is ordinary case
 * mapping and was always grouped, which is exactly why no curated witness
 * revealed the class.
 *
 * `toUpperCase` is what performs the multi-character and Greek expansions
 * `toLowerCase` does not, so the key uppercases LAST (design.md D9). Two
 * orderings are load-bearing and are asserted rather than trusted: lowercase
 * must precede uppercase, because it is what turns `ẞ` into `ß` so the
 * uppercase step can expand it to `SS`; and the FINAL `NFKC` is not decoration,
 * because without it eight Greek iota-with-dialytika code points stop folding.
 *
 * Per SEGMENT, because Win32 strips trailing dots and spaces from every
 * component rather than from the end of the path.
 *
 * It over-groups — `NFKC` alone maps `Ⅻ` onto `xii`, and `I`/`ı` group though
 * APFS keeps them apart. That is the direction D4 permits.
 */
export function foldSegment(segment: string): string {
  return foldWin32Name(segment.normalize("NFKC").toLowerCase()).toUpperCase().normalize("NFKC");
}

/**
 * The key a common filesystem might fold two spellings onto.
 *
 * Deliberately NOT a proof, and never used to merge. It answers "could these be
 * one destination", and it is allowed to say yes when the answer is no: a false
 * positive costs an ordering constraint on two entries that never collide. A
 * false NEGATIVE is the one that still loses a guarantee, so this folds
 * everything a supported filesystem is known to fold and does not try to be
 * exact (design.md D4):
 *
 *  - Win32 ignores trailing dots and spaces and the `::$DATA` stream suffix, so
 *    `foo` and `foo.` are one object there — and no case fold closes that.
 *  - APFS and NTFS both compare case-insensitively by default, though NOT by the
 *    same table, which is why the answer belongs to the volume and not here.
 *  - macOS stores NFD and compares canonically, so `é` composed and `é` decomposed
 *    are one name.
 */

function foldable(declared: string): string {
  return identityOf(declared)
    .split("/")
    .map((segment) => foldSegment(segment))
    .join("/");
}

export function contendersOf(entries: readonly ProvisionEntry[], favouredSource?: string): ProvisionContenders[] {
  const byKey = new Map<string, ProvisionEntry[]>();
  for (const entry of entries) {
    const key = foldable(entry.path);
    const held = byKey.get(key);
    if (held === undefined) {
      byKey.set(key, [entry]);
    } else {
      held.push(entry);
    }
  }
  const groups: ProvisionContenders[] = [];
  for (const members of byKey.values()) {
    if (members.length < 2) {
      continue;
    }
    // By declaring FILE, not by id: `ids()` mints a fresh sequence per adapter,
    // so a base row and a native row can carry the same id, and identifying the
    // repository's own row that way silently matched both — which cost every
    // group its favoured member. The source is what "the repository's own
    // declaration" actually means anyway (§ 4.3).
    const native = favouredSource === undefined ? [] : members.filter((e) => e.source === favouredSource);
    groups.push({
      members: members.map((e) => e.id),
      // Reported, not adjudicated. Which members are the repository's own is a
      // fact about the offer; which one wins depends on what is still selected,
      // and only the caller looking at a selection can answer that (D3c).
      natives: native.map((e) => e.id),
    });
  }
  return groups;
}

/**
 * The model an adapter's draft became.
 *
 * One assembly point, so a field added to `ProvisionModel` cannot reach two
 * adapters and miss the third — and so a rule that belongs to every adapter has
 * somewhere to live (.reviews/round-1.md F007). `providers` stays empty here:
 * which sources were detected is the dispatcher's answer, never an adapter's.
 */
export function modelFromDraft(draft: Draft): ProvisionModel {
  return {
    entries: draft.entries,
    setup: draft.setup,
    ports: draft.ports,
    providers: [],
    excluded: [],
    // Filled HERE, at the one model assembly point, so no adapter can ship a
    // model whose contender relation was never computed — which is what
    // round-3 F006 found behind the directly-exported reader. No favoured
    // source: one draft carries one declaring file, so nothing in it can be
    // "the repository's own" relative to the rest (design.md D3).
    contenders: contendersOf(draft.entries),
    problems: draft.problems,
  };
}

/**
 * The four keys `asimov/worktree.yaml` and `.vscode/worktree.json` share, read
 * from an already-parsed mapping (worktree-provisioning.md § 3.1, § 3.4).
 *
 * One reader, because the two formats declare the same shapes and two readers of
 * one shape drift silently — both emit rows that look right until one of them
 * learns a key the other does not. The caller supplies its own known-key set and
 * its own parse; what happens to `copy`, `link`, `ports` and `setup` afterwards
 * is the same question for both files.
 *
 * Provenance comes from `draft.ctx`, never a literal. The asimov version stamped
 * its own file name into every port, every setup step and every problem it
 * raised — shared unchanged, that would have made the native file's rows claim
 * they came from `asimov/worktree.yaml`, with the whole asimov suite still green
 * because that is exactly what it asserts (design.md D7).
 */
export async function readInlineKeys(
  record: Record<string, unknown>,
  known: ReadonlySet<string>,
  repoRoot: string,
  root: PreparedRoot,
  deps: ProviderDeps,
  nextId: () => string,
  draft: Draft,
): Promise<void> {
  const ctx = draft.ctx;
  for (const key of Object.keys(record)) {
    if (capped(draft)) {
      break;
    }
    if (!known.has(key)) {
      report(draft, `\`${key}\``, problem(ctx, "unknownKey", `\`${key}\` is not a key this reads.`));
    }
  }

  // Once the cap is recorded the model is closed, so the remaining sections are
  // not walked at all. Skipping them is what keeps a capped draft cheap and
  // keeps the cap to exactly one row — every section below would otherwise call
  // `report`, find the budget spent, and do nothing, one no-op per declaration
  // in a file we have already refused to finish reading (round-3 B7).
  if (record.copy !== undefined && !capped(draft)) {
    await entriesFor(record.copy, "copy", repoRoot, root, deps, nextId, draft);
  }
  if (record.link !== undefined && !capped(draft)) {
    await entriesFor(record.link, "link", repoRoot, root, deps, nextId, draft);
  }

  if (record.ports !== undefined && !capped(draft)) {
    if (typeof record.ports !== "object" || record.ports === null || Array.isArray(record.ports)) {
      report(draft, "`ports`", problem(ctx, "malformed", "`ports` must be a mapping of names."));
    } else {
      for (const name of Object.keys(record.ports as Record<string, unknown>)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
          report(
            draft,
            `port \`${name}\``,
            problem(ctx, "malformed", `port \`${name}\` is not a portable environment name.`),
          );
          continue;
        }
        if (/^(?:ANYWHERE_TERMINAL_|ASIMOV_)/i.test(name)) {
          report(
            draft,
            `port \`${name}\``,
            problem(ctx, "malformed", `port \`${name}\` uses a reserved environment namespace.`),
          );
          continue;
        }
        // No number: the name is what the file declares, and probing for a free
        // port is WT-012.6's. The row is offered without one.
        if (!addPort(draft, { id: nextId(), name, source: ctx.file })) {
          break;
        }
      }
    }
  }

  if (record.setup !== undefined && !capped(draft)) {
    if (!Array.isArray(record.setup)) {
      report(draft, "`setup`", problem(ctx, "malformed", "`setup` must be a list of commands."));
    } else {
      for (const raw of record.setup) {
        if (typeof raw !== "string" || raw.trim() === "") {
          report(draft, "a setup step", problem(ctx, "malformed", "`setup` holds an entry that is not a command."));
          continue;
        }
        // Stored exactly as written. It is display text here and the shell's
        // single script argument later — never concatenated into one.
        if (!addSetup(draft, { id: nextId(), kind: "shell", script: raw, source: ctx.file })) {
          break;
        }
      }
    }
  }
}

export function emptyModel(): ProvisionModel {
  return { entries: [], setup: [], ports: [], providers: [], excluded: [], contenders: [], problems: [] };
}

/**
 * Split `dir/prefix*suffix` into its parts, or refuse.
 *
 * § 3.1 permits a `*` in the FINAL segment only. A pattern with more than one,
 * or with one earlier in the path, is refused rather than interpreted
 * generously — a best-effort reading of a pattern we do not implement produces
 * a list of files different from the one the user was shown, which is the one
 * failure this section exists to prevent.
 */
export function splitGlob(relPath: string): { dir: string; prefix: string; suffix: string } | null {
  const star = relPath.indexOf("*");
  if (star === -1 || relPath.indexOf("*", star + 1) !== -1) {
    return null;
  }
  const lastSlash = relPath.lastIndexOf("/");
  if (star < lastSlash) {
    return null;
  }
  const segment = lastSlash === -1 ? relPath : relPath.slice(lastSlash + 1);
  const dir = lastSlash === -1 ? "" : relPath.slice(0, lastSlash);
  const segStar = segment.indexOf("*");
  return { dir, prefix: segment.slice(0, segStar), suffix: segment.slice(segStar + 1) };
}

/**
 * Inside, proven outside, or not decidable.
 *
 * `isResolvedPathInsideRoot` answers a bare `false` for a path that resolves
 * outside AND for a resolution that failed — EACCES on a parent, ELOOP on a
 * cycle. Reporting both as an escape states something the code has not
 * established (.reviews/round-2.md W6). The refusal is identical either way;
 * only the reason differs.
 */
export type Containment = "inside" | "outside" | "unresolvable";

export async function contained(
  relPath: string,
  repoRoot: string,
  root: PreparedRoot,
  deps: ProviderDeps,
): Promise<Containment> {
  if (relPath === "" || path.isAbsolute(relPath)) {
    return "outside";
  }
  const absolute = path.resolve(repoRoot, relPath);
  if (await isResolvedPathInsideRoot(absolute, root, { realpath: deps.realpath, lstat: deps.lstat })) {
    return "inside";
  }
  // Refused either way. This only asks WHY, and never decides containment —
  // `resolvedPathBoundary` stays the one authority on that.
  if (deps.realpath !== undefined) {
    try {
      await deps.realpath(absolute);
    } catch {
      return "unresolvable";
    }
  }
  return "outside";
}

/** The problem a refusal deserves, given what could be proven about it. */
export function refusal(ctx: ProviderContext, where: Containment, relPath: string): ProvisionProblem {
  return where === "unresolvable"
    ? problem(ctx, "unreadable", `\`${relPath}\` could not be resolved.`)
    : problem(ctx, "malformed", `\`${relPath}\` does not resolve inside the repository.`);
}

export type OpenedProviderFile =
  | { kind: "text"; text: string; root: PreparedRoot }
  | { kind: "absent"; root: PreparedRoot }
  /**
   * `at` says whether the REPOSITORY or the provider's own file is the thing
   * that failed. A file problem still carries the root, because a provider that
   * reads two files has a second one to open after the first is refused.
   */
  | { kind: "problem"; at: "file"; problem: ProvisionProblem; root: PreparedRoot }
  | { kind: "problem"; at: "root"; problem: ProvisionProblem };

/**
 * Prepare the root, prove the file is inside it, and only then open it.
 *
 * The three steps are one operation because their ORDER is the property: the
 * provider file's relative name is a constant, but the file itself can be a
 * symlink out of the checkout, and reading it is what follows the link. This
 * repository has already shipped the other order once, which is no check at all
 * (round-1 B2), and three adapters opening three files should not each re-derive
 * it (design.md D2).
 *
 * `root` is accepted so an adapter reading two files prepares it once.
 */
export async function openProviderFile(
  deps: ProviderDeps,
  repoRoot: string,
  ctx: ProviderContext,
  root?: PreparedRoot,
  authorized?: Authorized,
): Promise<OpenedProviderFile> {
  // An already-authorized file is answered from, never re-opened.
  //
  // Pinning `deps.readFile` beneath this function was tried first and refuted:
  // the root preparation and containment check below run BEFORE any read, so a
  // target that resolves outside the checkout on THIS call never reaches the
  // pinned bytes — the named file drops out of the offer while its unnamed
  // sibling still contributes paths and a shell command (.reviews/round-3.md
  // F002). The authorization has to arrive as a result, not as a byte source.
  const already = authorized?.get(ctx.file);
  if (already !== undefined) {
    return already;
  }
  const prepared = root ?? (await prepareResolvedRoot(repoRoot, { realpath: deps.realpath, lstat: deps.lstat }));
  if (prepared === null) {
    return {
      kind: "problem",
      at: "root",
      problem: problem(ctx, "unreadable", "The repository root could not be resolved."),
    };
  }
  const where = await contained(ctx.file, repoRoot, prepared, deps);
  // An absent file resolves as unreadable here rather than outside, and the read
  // below is what tells absence from failure — so only a PROVEN escape
  // short-circuits, and everything else falls through to be classified there.
  if (where === "outside") {
    return { kind: "problem", at: "file", problem: refusal(ctx, where, ctx.file), root: prepared };
  }
  try {
    return { kind: "text", text: await deps.readFile(path.resolve(repoRoot, ctx.file)), root: prepared };
  } catch (error) {
    if (isAbsence(error)) {
      // No provider file is not a problem — it is the ordinary case for most
      // repositories, and the section says what the worktree will lack anyway.
      return { kind: "absent", root: prepared };
    }
    // Present and unreadable — denied, a symlink loop, an I/O error, or the
    // bounded reader refusing an oversized file (W1). The spec requires the file
    // be NAMED; answering "absent" would say the opposite (B8).
    return {
      kind: "problem",
      at: "file",
      problem: problem(ctx, "unreadable", `\`${ctx.file}\` could not be read (${errnoOf(error)}).`),
      root: prepared,
    };
  }
}

/**
 * Read names from a directory, charging what is read to the shared account.
 *
 * Sorted after collection so expansion order stays deterministic, and bounded
 * before it so a hostile directory cannot be materialized (round-2 B7). The
 * budget is the READ's, not this call's: the previous per-call counter let every
 * glob in a file scan a fresh `MAX_SCAN` names, so a file declaring twenty of
 * them cost twenty times the bound while emitting no rows at all (design.md D9).
 */
export async function scanNames(
  listing: Promise<readonly string[]> | AsyncIterable<string>,
  budget: ProviderBudget,
): Promise<{ names: string[]; truncated: boolean }> {
  const names: string[] = [];
  let truncated = false;
  const room = () => Math.max(MAX_SCAN - budget.scanned, 0);
  if (room() === 0) {
    // Before the first pull, not after it. `for await` asks for a name and only
    // then checks the room, so every later glob read one more name than the
    // bound allows — a bound that admits an extra read per declaration is a
    // different bound from the one D9 states (.reviews/round-1.md F005).
    return { names, truncated: true };
  }
  if (Symbol.asyncIterator in Object(listing)) {
    for await (const name of listing as AsyncIterable<string>) {
      if (room() === 0) {
        truncated = true;
        break;
      }
      budget.scanned += 1;
      names.push(name);
    }
  } else {
    const all = await (listing as Promise<readonly string[]>);
    const take = Math.min(all.length, room());
    truncated = all.length > take;
    budget.scanned += take;
    names.push(...all.slice(0, take));
  }
  names.sort();
  return { names, truncated };
}

/**
 * One declared path becomes zero, one, or many entries.
 *
 * A glob expands HERE, at read time, because the list the user is shown must be
 * the list that would actually be copied (§ 3.1). Every expanded entry carries
 * the DRAFT's current source file, per § 4.3 — provenance answers which file
 * asked for this, and expansion does not change the answer.
 */
export async function entriesFor(
  declared: unknown,
  mode: ProvisionEntry["mode"],
  repoRoot: string,
  root: PreparedRoot,
  deps: ProviderDeps,
  nextId: () => string,
  draft: Draft,
  label = `\`${mode}\``,
): Promise<void> {
  const ctx = draft.ctx;
  if (!Array.isArray(declared)) {
    report(draft, label, problem(ctx, "malformed", `${label} must be a list of paths.`));
    return;
  }
  for (const raw of declared) {
    if (typeof raw !== "string" || raw.trim() === "") {
      report(draft, label, problem(ctx, "malformed", `${label} holds an entry that is not a path.`));
      continue;
    }
    const relPath = raw.trim();
    if (full(draft, `\`${relPath}\``)) {
      return;
    }
    if (!relPath.includes("*")) {
      const where = await contained(relPath, repoRoot, root, deps);
      if (where === "inside") {
        addEntry(draft, { id: nextId(), path: relPath, mode, source: ctx.file });
      } else {
        // Refused and reported, never clamped: clamping turns a suspicious
        // entry into a silently different one (§ 7).
        report(draft, `\`${relPath}\``, refusal(ctx, where, relPath));
      }
      continue;
    }
    const glob = splitGlob(relPath);
    if (glob === null) {
      report(
        draft,
        `\`${relPath}\``,
        problem(ctx, "malformed", `\`${relPath}\` may hold one \`*\`, in its last segment only.`),
      );
      continue;
    }
    // The DIRECTORY is checked before it is read, so a `../*` pattern cannot
    // cause a read outside the repository in the course of being rejected.
    //
    // A root-level glob is exempt because the directory it names IS the repo
    // root, and `isResolvedPathInsideRoot` refuses a candidate equal to the root
    // on purpose — its callers are about to read the candidate as a file. Asking
    // it here would report `*.md` as escaping the repository, which is a lie.
    if (glob.dir !== "") {
      const parent = await contained(glob.dir, repoRoot, root, deps);
      if (parent !== "inside") {
        report(draft, `\`${relPath}\``, refusal(ctx, parent, relPath));
        continue;
      }
    }
    if (scanExhausted(draft.budget)) {
      // The syscall is the cost. Checked here rather than inside `scanNames`,
      // because by the time a listing has been handed over the directory has
      // already been read and only the array is left to bound.
      report(
        draft,
        `\`${relPath}\``,
        problem(ctx, "malformed", `\`${relPath}\` is past the scan budget; it is not offered.`),
      );
      continue;
    }
    let scanned: { names: string[]; truncated: boolean };
    try {
      scanned = await scanNames(deps.readdir(path.resolve(repoRoot, glob.dir)), draft.budget);
    } catch (error) {
      if (!isAbsence(error)) {
        // Present and unreadable is not the same as absent. Reported, so the
        // section does not claim the repository declared nothing (B8).
        report(
          draft,
          `\`${relPath}\``,
          problem(ctx, "unreadable", `\`${glob.dir === "" ? "." : glob.dir}\` could not be read (${errnoOf(error)}).`),
        );
        continue;
      }
      // A directory that is not there contributes no entries, and a repo
      // legitimately carries optional material (§ 3.1).
      continue;
    }
    if (scanned.truncated) {
      report(
        draft,
        `\`${relPath}\``,
        problem(ctx, "malformed", `\`${relPath}\` names a directory too large to scan; it is not offered.`),
      );
      continue;
    }
    for (const name of scanned.names) {
      if (name.length < glob.prefix.length + glob.suffix.length) {
        continue;
      }
      if (!name.startsWith(glob.prefix) || !name.endsWith(glob.suffix)) {
        continue;
      }
      const expanded = glob.dir === "" ? name : `${glob.dir}/${name}`;
      // Returns rather than continues: the budget is model-wide, so every later
      // declaration would be refused too, and one honest message beats one per
      // remaining path.
      if (full(draft, `\`${expanded}\``)) {
        return;
      }
      // Per MATCH, not per parent. A contained directory says nothing about a
      // child symlink, and an expanded entry is what a later task materializes
      // (round-1 B2) — which is the same authorization D4 gives literal entries.
      const where = await contained(expanded, repoRoot, root, deps);
      if (where !== "inside") {
        report(draft, `\`${expanded}\``, refusal(ctx, where, expanded));
        continue;
      }
      addEntry(draft, { id: nextId(), path: expanded, mode, source: ctx.file });
    }
  }
}

/**
 * One provider, behind one shape.
 *
 * `files` is the whole list the provider reads, in read order — orca is one
 * provider over two files, and D8 has the row the user sees name every one of
 * them. `read` answers `null` for a provider that is not here at all, and a
 * model for one that is, however empty or broken that model turns out to be:
 * telling "absent" from "present and says nothing" is the whole of D3's
 * detection rule, and a single `null` for both would collapse it.
 *
 * The budget is passed in rather than made here, so a read that consults more
 * than one adapter spends one budget across all of them.
 */
/**
 * What one adapter answers for a repository.
 *
 * A record rather than a bare model, because `.vscode/worktree.json` can name a
 * file to build on and a set of inherited paths to drop, and both must come out
 * of the SAME read that parsed its inline keys. Asking the module a second time
 * would open the file twice, and this directory already rejected that: a second
 * open is a second chance for the file to change under the check
 * (`asimovProvider.fromOpened`, design.md D1).
 *
 * The three framework adapters answer `{ model }` — no format but the native one
 * has an `extends`.
 */
export interface AdapterRead {
  readonly model: ProvisionModel;
  /** Repo-relative path of a file to build on, exactly as the file spelled it. */
  readonly extends?: string;
  /** Repo-relative paths to drop from what was inherited. */
  readonly exclude?: readonly string[];
}

/**
 * Files whose open already passed, keyed by the repo-relative name the caller
 * asked for. Only the dispatcher builds one, and only for a file it authorized
 * itself (design.md D1).
 */
export type Authorized = ReadonlyMap<string, OpenedProviderFile>;

export interface ProviderAdapter {
  readonly id: ProvisionProvider["id"];
  readonly files: readonly string[];
  read(
    deps: ProviderDeps,
    repoRoot: string,
    budget: ProviderBudget,
    authorized?: Authorized,
  ): Promise<AdapterRead | null>;
}

/**
 * Whether the platform underneath applies Win32 filename rules.
 *
 * NOT "does this platform fold filename case" — it was called that while the
 * read path used it to fold identity, and that use is gone. Folding is a
 * property of a DIRECTORY, not of a platform: a case-sensitive APFS volume
 * mounts inside a case-insensitive one, and Windows carries case sensitivity
 * per directory. Every fold keyed on the platform is therefore wrong on some
 * volume, which is why identity no longer asks (design.md D1).
 *
 * What survives is the one question a platform CAN answer: which naming rules
 * the kernel applies, so `entryGate.ts` can strip the trailing dots, trailing
 * spaces and `::$DATA` suffix Win32 treats as the same name before it decides
 * whether a destination is a lockfile it must refuse. That refusal is safe to
 * be over-eager — it stays visible to the user — which a merge key never was.
 *
 * `path.sep` is the plainest true statement about it, and `path` here is the
 * platform-bound module.
 */
/**
 * The trailing dots, trailing spaces and `::$DATA` suffix Win32 treats as the
 * same name, removed to a fixed point. Expects an already-lower-cased segment.
 *
 * To a fixed point because the two compose in either order and one pass cannot
 * follow them: `pnpm-lock.yaml::$DATA.` needs the dot stripped before the
 * stream suffix is even visible, and `pnpm-lock.yaml. ::$DATA` needs the
 * reverse.
 *
 * One owner for two callers with different reasons to ask. `entryGate.ts` asks
 * about the destination it is deciding whether to refuse, and asks only where
 * the platform actually applies these rules. The contender detector asks about
 * a declared spelling, on every platform, because it is looking for a pair some
 * supported filesystem would fold and it is allowed to be generous
 * (design.md D4, D8). Two implementations of one rule drift, and `oneOwner.test.ts`
 * exists because that drift has already happened here twice.
 */
export function foldWin32Name(lowerName: string): string {
  const STREAM = "::$data";
  let folded = lowerName;
  for (;;) {
    const trimmed = folded.replace(/[. ]+$/, "");
    const unstreamed = trimmed.endsWith(STREAM) ? trimmed.slice(0, -STREAM.length) : trimmed;
    if (unstreamed === folded) {
      return folded;
    }
    folded = unstreamed;
  }
}

export function platformUsesWin32FilenameRules(): boolean {
  return path.sep === "\\";
}
