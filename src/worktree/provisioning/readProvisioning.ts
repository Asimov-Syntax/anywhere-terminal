// src/worktree/provisioning/readProvisioning.ts — Decide which of a
// repository's provisioning sources answers, assemble it with the one it named
// to build on, and record the rest (worktree-provisioning.md § 4.1, § 4.2).
//
// Exactly one source supplies the rows unless the repository's OWN file asks
// for another. Two frameworks in one repository usually means one is being
// migrated away from, so unioning them would offer a setup command the user
// believes they retired — and hiding the loser would leave a repository looking
// as if it had never configured the tool it uses. One answers; the others are
// named and one click away (design.md D3, D5).

import * as path from "node:path";
import type { ProvisionContenders, ProvisionEntry, ProvisionModel, ProvisionProvider } from "../../types/messages";
import { asimovAdapter } from "./asimovProvider";
import { NATIVE_PROVIDER_FILE, nativeAdapter } from "./nativeProvider";
import { orcaAdapter } from "./orcaProvider";
import {
  type AdapterRead,
  type Authorized,
  type Draft,
  emptyModel,
  foldWin32Name,
  newBudget,
  newDraft,
  openProviderFile,
  type ProviderAdapter,
  type ProviderBudget,
  type ProviderContext,
  type ProviderDeps,
  problem,
  report,
} from "./providerKit";
import { vscodeTasksAdapter } from "./vscodeTasksProvider";

/**
 * The order, as a module constant.
 *
 * Never a directory listing: an active source that depended on enumeration
 * order or on when a file happened to be written would offer a different
 * section to two users of the same repository. `.vscode/worktree.json` is first
 * because it is the only one that can name its own base (§ 4.1).
 */
export const DETECTION_ORDER: readonly ProviderAdapter[] = [
  nativeAdapter,
  asimovAdapter,
  orcaAdapter,
  vscodeTasksAdapter,
];

/**
 * The adapters `extends` may name — § 3.1–3.3, which is every one but the
 * native file itself.
 *
 * Excluding it is what makes a one-node cycle inexpressible: `"extends":
 * ".vscode/worktree.json"` would otherwise either loop or merge the file with
 * itself, duplicating its ports and setup steps (design.md D2 rule 1). Deeper
 * cycles cannot be written, because no framework format has an `extends`.
 */
const FRAMEWORK_ORDER: readonly ProviderAdapter[] = DETECTION_ORDER.filter((a) => a.id !== "native");

const NATIVE: ProviderContext = { id: "native", file: NATIVE_PROVIDER_FILE };

/**
 * `prefer` first, then the rest of the order unchanged.
 *
 * A preference reorders one entry; it does not replace the order. If the
 * preferred source turns out not to be there, the answer is the same one the
 * plain order would have given, rather than nothing.
 */
function ordered(prefer: ProvisionProvider["id"] | undefined): readonly ProviderAdapter[] {
  if (prefer === undefined) {
    return DETECTION_ORDER;
  }
  const chosen = DETECTION_ORDER.find((a) => a.id === prefer);
  if (chosen === undefined) {
    return DETECTION_ORDER;
  }
  return [chosen, ...DETECTION_ORDER.filter((a) => a !== chosen)];
}

/**
 * Is this source here at all?
 *
 * Asked instead of `read` once a source has already won, because a losing
 * adapter's rows are discarded and the work to build them is not free: an orca
 * glob over a large directory would spend the shared scan account on a section
 * nobody is shown. Present is present whatever the file then yields, so a file
 * that is refused or unreadable counts too (design.md D3).
 */
async function anyFilePresent(deps: ProviderDeps, repoRoot: string, adapter: ProviderAdapter): Promise<boolean> {
  for (const file of adapter.files) {
    const opened = await openProviderFile(deps, repoRoot, { id: adapter.id, file });
    if (opened.kind === "text" || (opened.kind === "problem" && opened.at === "file")) {
      return true;
    }
  }
  return false;
}

/**
 * The adapter an `extends` target names, or nothing.
 *
 * Two rules, and the loose version of this was refuted on both. Membership is
 * asked of the exact path the file wrote, so `../` and an absolute path match no
 * adapter's constant and resolve to nothing without a containment check of their
 * own. And the NAMED FILE must itself be readable here: orca is one provider
 * over two files, so `"extends": "orca.yaml"` in a repository carrying only
 * `.worktreeinclude` would otherwise select orca and inherit a file nobody named
 * (design.md D2 rules 1 and 2). A symlink out of the checkout is refused by
 * `openProviderFile`'s containment check and lands here as unreadable, which is
 * the same answer.
 *
 * Once it resolves, the WHOLE adapter reads — both of orca's files, not the one
 * that was named. Half of orca is a model orca would not recognize.
 */
async function baseFor(
  deps: ProviderDeps,
  repoRoot: string,
  target: string,
): Promise<{ adapter: ProviderAdapter; authorized: Authorized } | null> {
  const adapter = FRAMEWORK_ORDER.find((a) => a.files.includes(target));
  if (adapter === undefined) {
    return null;
  }
  const opened = await openProviderFile(deps, repoRoot, { id: adapter.id, file: target });
  if (opened.kind !== "text") {
    return null;
  }
  // The open that passed IS the open the adapter gets.
  //
  // Authorizing the target and then letting the adapter open it again left a
  // gap: with `.worktreeinclude` named and vanishing in between, orca read only
  // `orca.yaml` and the model inherited a shared directory AND a setup command
  // from a file the user never named — orca marked active, no problem reported
  // (.reviews/round-1.md F002). That is D2 rule 2's own defeater, returning
  // through a seam the rule did not cover.
  //
  // The first fix pinned `deps.readFile`, which is too late in the open: root
  // preparation and the containment check both run BEFORE the read, so a target
  // whose containment answer changed was still refused despite having passed
  // here (.reviews/round-3.md F002). Carrying the whole opened file is the
  // authorization, and nothing re-derives it.
  //
  // One key, the exact name that was named. The adapter's other files still
  // open live, because D2 rule 3 wants the WHOLE adapter.
  return { adapter, authorized: new Map([[target, opened]]) };
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
function identityOf(declared: string): string {
  const normalized = path.posix.normalize(declared);
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

/**
 * Base first, then the repository's own — and the native entry wins the path
 * they share, including its mode (§ 4.2 steps 1–3).
 *
 * The two models were BUILT in the other order, on one budget, so the
 * repository's own declarations get the rows and the scan names first
 * (design.md D3). Only the assembly follows § 4.2.
 */
function mergeEntries(
  base: readonly ProvisionEntry[],
  native: readonly ProvisionEntry[],
  pathKey: (declared: string) => string,
): { entries: ProvisionEntry[]; inline: Set<string> } {
  const inline = new Set(native.map((e) => pathKey(e.path)));
  // Superseded, not excluded: a losing inherited row is dropped rather than
  // listed as something the user deliberately removed (design.md D10).
  return { entries: [...base.filter((e) => !inline.has(pathKey(e.path))), ...native], inline };
}

/**
 * `exclude` runs against what was INHERITED (§ 4.2 step 4).
 *
 * The inline check is explicit rather than implied by the merge, because dedupe
 * has already removed the inherited copy by the time exclusion would see it —
 * so a path declared by base and native and then excluded is indistinguishable
 * from a plain inline one at this point. Removing something you just added is a
 * contradiction to surface, not a rule to implement (design.md D10).
 */
function applyExclude(
  entries: readonly ProvisionEntry[],
  inline: ReadonlySet<string>,
  exclude: readonly string[],
  draft: Draft,
  pathKey: (declared: string) => string,
): { kept: ProvisionEntry[]; excluded: ProvisionEntry[] } {
  const declaredKeys = new Set(entries.map((e) => pathKey(e.path)));
  const removed = new Set<string>();
  for (const declared of exclude) {
    const key = pathKey(declared);
    if (inline.has(key)) {
      report(
        draft,
        `\`${declared}\``,
        problem(NATIVE, "unknownKey", `\`${declared}\` is both declared and excluded here; the row is kept.`),
      );
      continue;
    }
    // An exclusion that removes nothing is reported rather than dropped. It
    // used to pass in silence, which was survivable while identity folded case
    // — a differently-spelled rule still hit its entry. Now that spelling is
    // the whole of identity (D1, D5), a rule spelled `Foo` against an entry
    // spelled `foo` quietly does nothing, and the user's only evidence would
    // have been the row they thought they had removed still sitting there.
    if (!declaredKeys.has(key)) {
      report(
        draft,
        `\`${declared}\``,
        problem(
          NATIVE,
          "unknownKey",
          `\`${declared}\` is excluded here but nothing declares it; the rule did nothing.`,
        ),
      );
      continue;
    }
    removed.add(key);
  }
  // `source` is never rewritten by exclusion: an excluded row keeps the name of
  // the file that declared it, which is what makes it legible as deliberate
  // rather than as something this file produced (§ 4.3).
  return {
    kept: entries.filter((e) => !removed.has(pathKey(e.path))),
    excluded: entries.filter((e) => removed.has(pathKey(e.path))),
  };
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

function foldable(declared: string): string {
  return identityOf(declared)
    .split("/")
    .map((segment) => foldSegment(segment))
    .join("/");
}

function contendersOf(entries: readonly ProvisionEntry[]): ProvisionContenders[] {
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
    const native = members.filter((e) => e.source === NATIVE_PROVIDER_FILE);
    groups.push({
      members: members.map((e) => e.id),
      ...(native.length === 1 && native[0] !== undefined ? { favoured: native[0].id } : {}),
    });
  }
  return groups;
}

/** What the native file's answer becomes once the base it named is resolved. */
async function assemble(
  deps: ProviderDeps,
  repoRoot: string,
  budget: ProviderBudget,
  native: AdapterRead,
): Promise<{ model: ProvisionModel; base: ProviderAdapter | null }> {
  const draft = newDraft(NATIVE, budget);
  const target = native.extends;
  const resolved = target === undefined ? null : await baseFor(deps, repoRoot, target);
  const base = resolved?.adapter ?? null;

  if (target !== undefined && resolved === null) {
    // A path matching no framework adapter and a path whose file is not there
    // are one problem: from the user's side both are "the thing you named is
    // not something I can read", and splitting them would mean explaining the
    // adapter table in an error message (design.md D2).
    report(draft, "`extends`", problem(NATIVE, "missingExtends", `\`${target}\` is not a file this can build on.`));
  }
  // The inline keys are offered whether or not the base resolved. An early
  // return here would discard them for a typo in one other key.
  const inherited = resolved === null ? null : await resolved.adapter.read(deps, repoRoot, budget, resolved.authorized);
  const baseModel = inherited?.model ?? emptyModel();

  const merged = mergeEntries(baseModel.entries, native.model.entries, identityOf);
  const { kept, excluded } = applyExclude(merged.entries, merged.inline, native.exclude ?? [], draft, identityOf);

  return {
    model: {
      entries: kept,
      // Neither deduped nor reordered: two providers may legitimately want the
      // same command run twice, and reordering or dropping steps changes their
      // meaning (§ 4.2 step 5).
      setup: [...baseModel.setup, ...native.model.setup],
      ports: [...baseModel.ports, ...native.model.ports],
      providers: [],
      excluded,
      // Built from the rows that SURVIVED merge and exclusion, so a group never
      // names an id the offer will not carry.
      contenders: contendersOf(kept),
      // Base-first, matching the entry order. The build order is the other way
      // round, so problem order is chosen here rather than falling out of it.
      problems: [...baseModel.problems, ...native.model.problems, ...draft.problems],
    },
    base: inherited === null ? null : base,
  };
}

/**
 * The model one source supplies — plus the one it named to build on, plus a row
 * for every source that did neither.
 *
 * The FIRST source with a file present answers, whatever that file then yields —
 * rows, nothing, or a problem. Presence rather than usefulness, because the
 * alternative reads a repository's own answer as an absence: a checked-in file
 * holding only comments is a repository saying "nothing here", and falling
 * through it would silently offer a different tool's answer to a question this
 * repository already answered (design.md D3).
 *
 * One budget spans every adapter consulted, so a repository cannot buy more scan
 * or more rows by carrying more provider files (design.md D9).
 */
export async function readProvisioning(
  deps: ProviderDeps,
  repoRoot: string,
  prefer?: ProvisionProvider["id"],
): Promise<ProvisionModel> {
  const budget = newBudget();
  const adapters = ordered(prefer);
  let chosen: { adapter: ProviderAdapter; answer: AdapterRead } | null = null;
  const providers: ProvisionProvider[] = [];

  for (const adapter of adapters) {
    if (chosen === null) {
      const answer = await adapter.read(deps, repoRoot, budget);
      if (answer === null) {
        // Not here at all. The one answer that lets detection move on.
        continue;
      }
      chosen = { adapter, answer };
      providers.push({ id: adapter.id, files: [...adapter.files], active: true });
      continue;
    }
    // Detected and not chosen: named, so the section can offer to switch to it,
    // and contributing no row unless the winner asked to build on it.
    if (await anyFilePresent(deps, repoRoot, adapter)) {
      providers.push({ id: adapter.id, files: [...adapter.files], active: false });
    }
  }

  if (chosen === null) {
    return emptyModel();
  }
  // A switch to a FRAMEWORK populates the section from that source alone: the
  // user asked to see that source's answer, and showing it wrapped in the
  // native file's additions would not be that answer (design.md D5).
  //
  // Today no framework adapter answers with an `extends`, so `assemble` would
  // return the same model either way. The guard states the rule rather than
  // leaving it to be true by accident of which adapters currently set the
  // field: a framework format that learned an `extends` would otherwise start
  // merging here silently.
  if (chosen.adapter !== nativeAdapter) {
    // Grouped here too. A framework winner and a switched provider return their
    // adapter's model straight out, and every adapter answers `contenders: []`,
    // so the section that needed the relation most — one file declaring two
    // foldable spellings — was the one branch that never computed it
    // (round-1 F002).
    return { ...chosen.answer.model, providers, contenders: contendersOf(chosen.answer.model.entries) };
  }

  const { model, base } = await assemble(deps, repoRoot, budget, chosen.answer);
  return {
    ...model,
    // `active: false` is what makes a row offer to switch, and offering to
    // switch to the provider you are already building on would be an offer to
    // do what is already done (design.md D4).
    providers: providers.map((p) => (base !== null && p.id === base.id ? { ...p, active: true } : p)),
  };
}
