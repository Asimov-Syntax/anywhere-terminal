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

import type { ProvisionEntry, ProvisionModel, ProvisionProblem, ProvisionProvider } from "../../types/messages";
import { type PreparedRoot, prepareResolvedRoot } from "../../utils/resolvedPathBoundary";
import { asimovAdapter } from "./asimovProvider";
import { NATIVE_PROVIDER_FILE, nativeAdapter } from "./nativeProvider";
import { orcaAdapter } from "./orcaProvider";
import {
  type AdapterRead,
  type Authorized,
  contendersOf,
  type Draft,
  emptyModel,
  identityOf,
  newBudget,
  newDraft,
  type OpenedProviderFile,
  openProviderFile,
  type ProviderAdapter,
  type ProviderBudget,
  type ProviderContext,
  type ProviderDeps,
  problem,
  report,
} from "./providerKit";
import { type SuggestDeps, suggestProvisioning } from "./suggestProvisioning";
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
 * One pass's opens, so no provider file is opened twice to answer one read.
 *
 * `openProviderFile` answers an already-authorized file from this map instead
 * of re-opening it, but it does not populate the map — the caller decides what
 * an authorization covers. Detection and presence are one pass over one tree,
 * so they share one.
 */
type Opens = Map<string, OpenedProviderFile>;

/**
 * Open a provider file once per pass, against a root resolved once per pass.
 *
 * Without the prepared root every probe re-ran `prepareResolvedRoot`, which is
 * a `realpath` plus an `lstat` per file, for an answer that cannot change
 * inside one read. Without the map, detection's probe and presence's probe
 * opened the same file twice (round-1 F017).
 */
async function openOnce(
  deps: ProviderDeps,
  repoRoot: string,
  ctx: ProviderContext,
  root: PreparedRoot | null,
  opens: Opens,
): Promise<OpenedProviderFile> {
  const opened = await openProviderFile(deps, repoRoot, ctx, root ?? undefined, opens as Authorized);
  if (!opens.has(ctx.file)) {
    opens.set(ctx.file, opened);
  }
  return opened;
}

/** Present is present whatever the file then yields, so refused and unreadable both count (design.md D3). */
function counts(opened: OpenedProviderFile): boolean {
  return opened.kind === "text" || (opened.kind === "problem" && opened.at === "file");
}

/**
 * Is this source here at all?
 *
 * Asked instead of `read` once a source has already won, because a losing
 * adapter's rows are discarded and the work to build them is not free: an orca
 * glob over a large directory would spend the shared scan account on a section
 * nobody is shown.
 */
async function filesPresent(
  deps: ProviderDeps,
  repoRoot: string,
  adapter: ProviderAdapter,
  root: PreparedRoot | null,
  opens: Opens,
): Promise<string[]> {
  const found: string[] = [];
  for (const file of adapter.files) {
    if (counts(await openOnce(deps, repoRoot, { id: adapter.id, file }, root, opens))) {
      found.push(file);
    }
  }
  return found;
}

/** Does any of this adapter's files exist? Stops at the first one, so it opens no more than it must. */
async function anyFilePresent(
  deps: ProviderDeps,
  repoRoot: string,
  adapter: ProviderAdapter,
  root: PreparedRoot | null,
  opens: Opens,
): Promise<boolean> {
  for (const file of adapter.files) {
    if (counts(await openOnce(deps, repoRoot, { id: adapter.id, file }, root, opens))) {
      return true;
    }
  }
  return false;
}

/**
 * Fill `present` for every adapter detection kept, in detection order.
 *
 * Runs AFTER the model is assembled, and that ordering is load-bearing rather
 * than tidy. Probing presence is an OPEN, and `openProviderFile` authorizes the
 * bytes it returns — so a probe that runs before the assembly consumes the read
 * the assembly was going to authorize. A `.worktreeinclude` that goes away
 * between two opens then loses its rows to a sibling the user never named,
 * which is the defect round-1 F002 exists to prevent. Probing last cannot take
 * a read from anything.
 *
 * `present` can therefore come back EMPTY for a provider that was detected: the
 * file was there when it was read and gone when it was probed. That is the
 * truthful answer for the question `present` is asked — a file that is no
 * longer there is not one `extends` can name — and a consumer must handle it.
 *
 * `present` is a CANDIDATE, never an authorization. It says a file was there at
 * this moment, and sharing one pass's opens (F017) widens the gap between that
 * moment and any later use of it. Anything that writes a name taken from here
 * confirms the file again at the point of writing — design.md D17, after a plan
 * attack deleted a base between the offer and the save and watched the write
 * record an `extends` the next read reported as `missingExtends`.
 */
async function publish(
  deps: ProviderDeps,
  repoRoot: string,
  detected: readonly { adapter: ProviderAdapter; active: boolean }[],
  root: PreparedRoot | null,
  opens: Opens,
): Promise<ProvisionProvider[]> {
  const published: ProvisionProvider[] = [];
  for (const { adapter, active } of detected) {
    published.push({
      id: adapter.id,
      files: [...adapter.files],
      present: await filesPresent(deps, repoRoot, adapter, root, opens),
      active,
    });
  }
  return published;
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
export type BaseResolution =
  | { ok: true; adapter: ProviderAdapter; authorized: Authorized }
  | { ok: false; why: "missing" }
  | { ok: false; why: "unreadable"; problem: ProvisionProblem };

export async function baseFor(deps: ProviderDeps, repoRoot: string, target: string): Promise<BaseResolution> {
  const adapter = FRAMEWORK_ORDER.find((a) => a.files.includes(target));
  if (adapter === undefined) {
    return { ok: false, why: "missing" };
  }
  const opened = await openProviderFile(deps, repoRoot, { id: adapter.id, file: target });
  if (opened.kind !== "text") {
    // On the problem's REASON, not on the open's kind. Two non-`text` answers
    // must keep the diagnosis they already have: a target resolving out of the
    // checkout is `malformed` and is a name that was never eligible rather than
    // a read that failed (D2), and a root failure is neither presence nor
    // absence and belongs to the diagnostic D8 defers — reporting it against
    // the base file's name would misattribute it besides.
    const failed = opened.kind === "problem" && opened.at === "file" && opened.problem.reason === "unreadable";
    return failed && opened.kind === "problem"
      ? { ok: false, why: "unreadable", problem: opened.problem }
      : { ok: false, why: "missing" };
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
  return { ok: true, adapter, authorized: new Map([[target, opened]]) };
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
  const base = resolved?.ok === true ? resolved.adapter : null;

  if (target !== undefined && resolved !== null && !resolved.ok) {
    if (resolved.why === "unreadable") {
      // The file IS there and the read failed. Calling that missing points the
      // user at the one repair that cannot work — adding a file that exists —
      // while `anyFilePresent` counts the same file as present, so the section
      // could offer the provider as switchable and call it absent at once
      // (.reviews/round-7.md F014). The problem carried is `openProviderFile`'s
      // own, so the reason a reader sees is the rule that actually fired.
      report(draft, "`extends`", resolved.problem);
    } else {
      // A path matching no framework adapter and a path whose file is not there
      // are one problem: from the user's side both are "the thing you named is
      // not something I can read", and splitting them would mean explaining the
      // adapter table in an error message (design.md D2).
      report(draft, "`extends`", problem(NATIVE, "missingExtends", `\`${target}\` is not a file this can build on.`));
    }
  }
  // The inline keys are offered whether or not the base resolved. An early
  // return here would discard them for a typo in one other key.
  const inherited =
    resolved?.ok === true ? await resolved.adapter.read(deps, repoRoot, budget, resolved.authorized) : null;
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
      contenders: contendersOf(kept, NATIVE_PROVIDER_FILE),
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
  deps: ProviderDeps & SuggestDeps,
  repoRoot: string,
  prefer?: ProvisionProvider["id"],
): Promise<ProvisionModel> {
  const budget = newBudget();
  // Once per read. Every probe below resolved it again for an answer that
  // cannot change inside one pass (round-1 F017).
  const root = await prepareResolvedRoot(repoRoot, { realpath: deps.realpath, lstat: deps.lstat });
  const opens: Opens = new Map();
  const adapters = ordered(prefer);
  let chosen: { adapter: ProviderAdapter; answer: AdapterRead } | null = null;
  const detected: { adapter: ProviderAdapter; active: boolean }[] = [];

  for (const adapter of adapters) {
    if (chosen === null) {
      const answer = await adapter.read(deps, repoRoot, budget);
      if (answer === null) {
        // Not here at all. The one answer that lets detection move on.
        continue;
      }
      chosen = { adapter, answer };
      detected.push({ adapter, active: true });
      continue;
    }
    // Detected and not chosen: named, so the section can offer to switch to it,
    // and contributing no row unless the winner asked to build on it.
    //
    // This gate short-circuits at the first file it finds, which is what keeps
    // it from opening a file the assembly has not read yet. The per-file list
    // `present` needs is taken later, by `publish`.
    if (await anyFilePresent(deps, repoRoot, adapter, root, opens)) {
      detected.push({ adapter, active: false });
    }
  }

  if (chosen === null) {
    // No source at all — not even an empty or unreadable one, both of which
    // answered above. Only here may the bounded fallback speak: a present
    // source, whatever it says, is the repository's answer, and suggestions
    // never override an answer (suggest-worktree-initialization design.md D1).
    return suggestProvisioning(deps, repoRoot, budget);
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
    return { ...chosen.answer.model, providers: await publish(deps, repoRoot, detected, root, opens) };
  }

  const { model, base } = await assemble(deps, repoRoot, budget, chosen.answer);
  const providers = await publish(deps, repoRoot, detected, root, opens);
  return {
    ...model,
    // `active: false` is what makes a row offer to switch, and offering to
    // switch to the provider you are already building on would be an offer to
    // do what is already done (design.md D4).
    providers: providers.map((p) => (base !== null && p.id === base.id ? { ...p, active: true } : p)),
  };
}
