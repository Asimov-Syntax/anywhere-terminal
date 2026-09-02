// src/webview/worktree/WorktreeCreateDialog.ts — The create-worktree form
// (worktree-panel-ui § 5, worktree-actions § 3.2).
//
// Presentation only in this phase: `onSubmit` receives the draft and nothing here
// spawns git. What the form DOES own is the truthfulness rules the design fixes:
//
//  - The branch name starts empty. A wrong-but-plausible suggestion is worse than
//    a blank field, so none is offered.
//  - The path is derived from the branch, and when the derived path collided the
//    form shows the FINAL suffixed path before submit — not the one that was taken.
//  - The agent picker lives inside the form, because creating a worktree in order
//    to put an agent in it is one intent.
//  - A dangerous permission posture is labelled and never preselected.
//  - The repo picker appears only once the workspace holds more than one repo.

import type {
  DebrisAuthorization,
  ProbeBase,
  PullRequestOffer,
  ResolvedMode,
  WorktreeCreateResolutionMessage,
  WorktreeDebrisAuthorizedMessage,
} from "../../types/messages";
import { sanitizeBranchForPath } from "../../worktree/branchSlug";
import { attachTooltip } from "../ui/Tooltip";
import { createWorktreeAgentBox } from "./worktreeAgentBox";
import { dialogTitle, field, keyHint, openDialogShell, selectControl, textButton } from "./worktreeDialogShell";
import type {
  WorktreeBranchMode,
  WorktreeCreateDefaults,
  WorktreeCreateDraft,
  WorktreeOpenAfter,
  WorktreeProvisionOffer,
  WorktreePullRequestOffer,
  WorktreeRef,
  WorktreeRefOffer,
} from "./worktreeViewTypes";

/**
 * The destination, shortened for reading. Two trailing segments: one is not
 * enough to tell `…/anywhere-terminal-feat-x` in one root from the same name in
 * another, and the exact value is a focus or a hover away regardless.
 */
function segments(path: string): string[] {
  // Both separators. The host builds these with `node:path`, which produces `\\`
  // on Windows — splitting on `/` alone leaves such a path whole, so the line
  // renders unshortened and the collision note restates it in full: the two
  // things this form exists to stop doing. Same idiom the file-tree panel and
  // its data source already use, both module-private to their own files.
  return path.split(/[/\\]/).filter(Boolean);
}

function shortPath(path: string): string {
  const parts = segments(path);
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join("/")}`;
}

function lastSegment(path: string): string {
  return segments(path).at(-1) ?? path;
}

/**
 * One row of the branch list: an existing ref, or the always-present entry that
 * creates the typed name.
 *
 * The create-new row is a member rather than a special case below the list —
 * it is what makes a repository whose enumeration failed still usable, so it
 * cannot be something the list's presence gates.
 */
type BranchChoice =
  | { kind: "existing"; ref: WorktreeRef }
  | { kind: "pr"; pr: PullRequestOffer }
  | { kind: "prsUnavailable" }
  | { kind: "new" };

/** How many characters of a typed name the create-new row echoes back. */
const CREATE_ROW_LABEL = "Create branch";

/**
 * Ordered by what the typed text most likely means: the exact match, then the
 * prefixes, then create-new. With nothing typed every ref is offered.
 *
 * Refs that neither match exactly nor by prefix are dropped — the list is a
 * filter over one dataset, which is the whole reason § 4.1 rejected tabs.
 */
function orderChoices(
  refs: readonly WorktreeRef[],
  typed: string,
  pullRequests?: WorktreePullRequestOffer,
): BranchChoice[] {
  const query = typed.trim();
  const exact: BranchChoice[] = [];
  const prefixed: BranchChoice[] = [];
  for (const ref of refs) {
    if (query.length === 0 || ref.name === query) {
      (query.length === 0 ? prefixed : exact).push({ kind: "existing", ref });
    } else if (ref.name.startsWith(query)) {
      prefixed.push({ kind: "existing", ref });
    }
  }
  return [...exact, ...prefixed, ...pullRequestChoices(pullRequests, query), { kind: "new" }];
}

/**
 * The pull-request part of the one list, between the prefix matches and
 * create-new (§ 4.1).
 *
 * `undefined` is "not asked yet" and contributes nothing — the form must not
 * claim a forge state it has not been told. `available: false` contributes the
 * single quiet row § 5 asks for, whatever the reason was.
 *
 * Matching is on the number and on the title, because those are what a user
 * has in hand. Never on `headRefName`: the branch a create mints is
 * `pr/<number>` and offering to match the fork's own branch name would suggest
 * that is what gets checked out.
 *
 * The title matches ANYWHERE, where a ref matches only by prefix. That
 * asymmetry is deliberate: a branch name is hierarchical and a prefix is what
 * someone is completing, while a title is prose and a prefix rule would make
 * titles effectively unsearchable.
 */
/**
 * What a capped list says about itself.
 *
 * Branches and pull requests are capped independently and answer the typed text
 * differently: a branch past the cap can still be reached by typing, because the
 * host re-reads on the query, while pull requests are filtered locally out of
 * the one page that was fetched. So the two are not one sentence with a
 * substituted noun (.reviews/round-1.md B3).
 */
function partialListText(refsPartial: boolean, prsPartial: boolean): string {
  const parts: string[] = [];
  if (refsPartial) {
    parts.push("Showing part of this repository's branches — type to find others.");
  }
  if (prsPartial) {
    parts.push("Showing part of this repository's open pull requests; the rest are not searchable here.");
  }
  return parts.join(" ");
}

function pullRequestChoices(offer: WorktreePullRequestOffer | undefined, query: string): BranchChoice[] {
  if (offer === undefined) {
    return [];
  }
  if (!offer.available) {
    return [{ kind: "prsUnavailable" }];
  }
  const needle = query.toLowerCase();
  return offer.list
    .filter(
      (pr) => needle.length === 0 || String(pr.number).startsWith(needle) || pr.title.toLowerCase().includes(needle),
    )
    .map((pr) => ({ kind: "pr", pr }) as const);
}

/**
 * What the form OFFERS, which is not the wire vocabulary. Opening the folder is
 * one intent with two destinations, and listing them as two peers of "Nothing"
 * made the choice read as four ways to open something. The pair is reached
 * through a secondary control instead; no wire value becomes unreachable.
 */
type AfterChoice = "none" | "terminal" | "agent" | "folder";

const AFTER_CHOICES: readonly { value: AfterChoice; label: string }[] = [
  { value: "none", label: "Nothing" },
  { value: "terminal", label: "Open a terminal here" },
  { value: "agent", label: "Start an agent" },
  { value: "folder", label: "Open the folder" },
];

/** The two the folder choice resolves to. Adding to the workspace leads: opening
 *  a second window on a folder the user is already in is the disruptive one. */
const FOLDER_MODES: readonly { value: WorktreeOpenAfter; label: string }[] = [
  { value: "addToWorkspace", label: "Add to this workspace" },
  { value: "newWindow", label: "Open in a new window" },
];

/**
 * `agent` is offered only where something can perform it — the option is built
 * from the repo's own agent list, so a host that reported none leaves it absent
 * rather than selectable-and-refused. The folder choice is always performable.
 */
function openAfterOptions(canLaunch: boolean): { value: AfterChoice; label: string }[] {
  return AFTER_CHOICES.filter((o) => o.value !== "agent" || canLaunch);
}

/** Everything the host needs to say what a submit of this form would do. */
export interface CreateSelection {
  repoId: string;
  /** The branch being named, or the ref being detached at. */
  branch: string;
  /** Absent where the mode refuses a base, so no verdict is asked for one. */
  base?: ProbeBase;
  /** Present only where the user typed over the derived destination. */
  candidatePath?: string;
}

export interface WorktreeCreateDialogDeps {
  /** One entry per repo; a single entry suppresses the picker entirely (§ 3.2). */
  repos: WorktreeCreateDefaults[];
  /** Which repo the create was invoked from. */
  initialRepoId?: string;
  /**
   * Validate a branch name the way `git check-ref-format --branch` would. Supplied
   * by the owner so the form holds no git knowledge; returns the message to show.
   */
  validateBranch?: (name: string) => string | undefined;
  /**
   * The selection changed, so what a create would do has to be resolved again —
   * only the host can say which path is free and whether the base names a
   * commit. Called on every SETTLED edit, and it carries the whole selection
   * rather than just the branch: a base or a destination the host is never told
   * about is a field the resolution cannot be about (round-3 B4).
   */
  onSelectionChange?: (selection: CreateSelection) => void;
  /**
   * Receive the function that applies a fresh answer from the host. Kept as a
   * callback rather than a return value so the form stays a single expression
   * for every caller that does not need to update it.
   */
  bindDefaults?: (apply: (next: WorktreeCreateDefaults) => void) => void;
  /**
   * Receive the function that applies a fresh provisioning offer.
   *
   * Separate from `bindDefaults` on purpose. The destination is answered per
   * keystroke and the form gates Create on that answer being current;
   * provisioning is answered once and gates nothing. Routing the offer through
   * the destination's callback let it clear that gate, so Create went live on
   * the path resolved for the opening ask (.reviews/round-1.md B4).
   */
  bindProvisioning?: (apply: (repoId: string, offer: WorktreeProvisionOffer) => void) => void;
  /**
   * Receive the function that applies the repository's branch list.
   *
   * Its own channel for the same reason as `bindProvisioning`: this answers
   * once per form and gates nothing, while the destination is answered per
   * settled edit and Create waits on it. Routing one through the other's
   * callback is what B4 was.
   */
  bindRefs?: (apply: (repoId: string, refs: WorktreeRefOffer) => void) => void;
  /**
   * Populate the section from a source that was detected but did not win.
   *
   * Carries the provider's ID and a sequence this form mints, and nothing else.
   * A dep that could carry a file, a path or a model would make the webview the
   * authority on what the host reads (design.md D5). Taking it submits nothing:
   * the host answers with a fresh offer, which arrives through
   * `bindProvisioning` like any other.
   */
  onProvisionSwitch?: (request: { repoId: string; switch: number; provider: string }) => void;
  /**
   * Record the current selection in the repository's own configuration.
   *
   * Carries the host's opaque item ids, the offer that named them, and the
   * ordering fields — no path, no key, no file text. A dep that could carry any
   * of those would make the webview the authority on what the repository's
   * configuration SAYS, which is the same rule `onProvisionSwitch` obeys one
   * hop earlier (design.md D1).
   *
   * `switch` comes from the same sequence the switch mints, so a save and a
   * source change order against each other rather than racing (design.md D8).
   */
  onProvisionSave?: (request: { repoId: string; switch: number; offerId: string; kept: readonly string[] }) => void;
  /** The forge's answer, on its own channel — it must never gate `bindRefs`. */
  bindPullRequests?: (apply: (repoId: string, offer: WorktreePullRequestOffer) => void) => void;
  /**
   * What a create against the settled selection would actually do.
   *
   * The form applies an answer only while `query` still matches what is typed:
   * a resolution the user has typed past describes a selection that is gone,
   * and applying it would state a mode nobody chose (design.md D1).
   */
  bindResolution?: (apply: (resolution: WorktreeCreateResolutionMessage) => void) => void;
  /**
   * Ask the host to authorize clearing this directory.
   *
   * Its own request, sent only when the user ACCEPTS the offer. The resolution
   * carries no authorization because it is answered on every settled edit, and
   * a token minted per keystroke is one nobody asked for (design.md D6).
   */
  onAuthorizeDebris?: (request: { repoId: string; ask: number; path: string }) => void;
  /**
   * Receive the function that applies the host's answer to that request.
   *
   * Paired with `onAuthorizeDebris`: without both, no answer can ever arrive,
   * and an offer that cannot be authorized is a control that does nothing — so
   * the offer is not rendered at all.
   */
  bindDebrisAuthorization?: (apply: (answer: WorktreeDebrisAuthorizedMessage) => void) => void;
  onSubmit: (draft: WorktreeCreateDraft) => void;
  onCancel?: () => void;
}

// Re-exported from branchSlug, the one definition the host shares, so the form
// and the host cannot disagree about what a branch turns into (round-3 B12).
export { sanitizeBranchForPath };

/** Mount the create form and return its disposer. */
/**
 * One offered item, flattened out of the model.
 *
 * `verb` and `subject` are separate because only the subject comes from the
 * provider file: it is untrusted text set with `textContent`, and it is the
 * half a row is identified by. `checked` is the row's initial state, not a
 * value anything reads yet — WT-012.2 is where a checkbox first decides
 * anything.
 */
interface BringRow {
  id: string;
  verb: string;
  subject: string;
  source: string;
  checked: boolean;
  /** Linked rows only: writing through the link changes the main checkout. */
  warn?: string;
  /**
   * Removed by the repository's own `exclude`: drawn, never offered.
   *
   * Shown rather than omitted because the two are different statements — a path
   * that is simply absent looks like something the host failed to find, and a
   * user comparing the section against the file it came from would go looking
   * for the difference. It carries no checkbox, so there is no state in which
   * it can be submitted.
   */
  excluded?: boolean;
  /**
   * Named partners this row may turn out to share a destination with.
   *
   * Advisory about WHICH rows may share a destination — the worktree does not
   * exist while this is drawn, so nothing here can be proven (design D2).
   * Whether this row will be applied is `yields` below, not this.
   */
  contender?: readonly string[];
  /**
   * This row loses its destination to the repository's own declaration.
   *
   * The apply refuses a held member on EVERY volume — a destination that reads
   * absent after the favoured member claimed cannot be told from that member's
   * material having been removed — so leaving the row checked promised the user
   * something that would be refused, and counted it into "N copied" first
   * (`award-a-contested-destination-or-refuse-it/.reviews/round-3.md` F007).
   *
   * Offered unchecked rather than withheld: the user can still tick it, and
   * unticking the repository's own is what makes it arrive.
   */
  yields?: true;
  /**
   * More than one of the repository's own declarations names this destination.
   *
   * Carries the paths that claim it, because no single one of them can be
   * unticked to rescue the row — leaving exactly one selected is what settles
   * it, and the user has to be told which ones are competing to do that
   * (design.md D3c).
   */
  contested?: true;
  /**
   * Index into `model.contenders`, for the notes above.
   *
   * A pointer, never a copy of the membership: a group is every entry sharing
   * one fold key, so at `MAX_MODEL_ROWS` it can hold every row the cap allows,
   * and copying its declarations into each note it explains is quadratic in a
   * checked-in file's own rows (.reviews/round-8.md F019).
   */
  group?: number;
}

/**
 * Each grouped row against the spellings it may collide with, by id.
 *
 * The group travels as ids so the wire carries no second copy of a path
 * (design D3); the paths are read back from the entries the ids name, which
 * keeps § 4.3 true — a row still displays the spelling its own file wrote.
 */
/**
 * Rows the apply will refuse, against the spelling that takes their place.
 *
 * Decided by the repository declarations still SELECTED, which is the predicate
 * the apply applies to the entries it is submitted (design.md D3c): exactly one
 * makes that one favoured and the rest yield, none leaves nothing claiming
 * priority, and more than one is refused entire — that last case has no single
 * counterpart to name, so `refusedEntire` below carries it instead.
 *
 * Reading the SELECTION rather than the offer is the whole point. A winner
 * computed once against the full offer goes stale the moment a row is unticked,
 * which is how this statement diverged from the apply at rounds 3, 5 and 7.
 */
function yieldsTo(
  model: WorktreeProvisionOffer["model"],
  selected: ReadonlySet<string>,
): Map<string, { id: string; path: string }> {
  const pathOf = new Map(model.entries.map((e) => [e.id, e.path] as const));
  const losers = new Map<string, { id: string; path: string }>();
  for (const group of model.contenders) {
    const claiming = group.natives.filter((member) => selected.has(member));
    const id = claiming.length === 1 ? claiming[0] : undefined;
    const path = id === undefined ? undefined : pathOf.get(id);
    if (id === undefined || path === undefined) {
      continue;
    }
    for (const member of group.members) {
      if (member !== id) {
        losers.set(member, { id, path });
      }
    }
  }
  return losers;
}

function contenderPartners(model: WorktreeProvisionOffer["model"]): Map<string, string[]> {
  const pathOf = new Map(model.entries.map((e) => [e.id, e.path] as const));
  const partners = new Map<string, string[]>();
  for (const group of model.contenders) {
    for (const id of group.members) {
      const named = group.members
        .filter((other) => other !== id)
        .flatMap((other) => {
          const path = pathOf.get(other);
          return path === undefined ? [] : [path];
        });
      if (named.length > 0) {
        partners.set(id, named);
      }
    }
  }
  return partners;
}

/**
 * Which contender group each entry belongs to, and which of them are the
 * repository's own declarations.
 *
 * The notes are rendered against the group rather than against the declaration
 * the OFFERED selection favours, for the same reason both of them are shown by
 * a count: with more than one repository declaration nothing is favoured at the
 * offered selection, and a note that was never rendered cannot appear when the
 * user unselects one and makes another the favoured declaration. WHICH
 * declarations a note names is settled at selection time, not here.
 */
function groupIndex(model: WorktreeProvisionOffer["model"]): Map<string, { group: number; native: boolean }> {
  const of = new Map<string, { group: number; native: boolean }>();
  model.contenders.forEach((contest, group) => {
    const natives = new Set(contest.natives);
    for (const member of contest.members) {
      of.set(member, { group, native: natives.has(member) });
    }
  });
  return of;
}

/** `A and B are both selected` / `A, B and C are all selected`. */
function bothOrAll(paths: readonly string[]): string {
  return paths.length === 2
    ? `${paths[0]} and ${paths[1]} are both selected`
    : `${paths.slice(0, -1).join(", ")} and ${paths[paths.length - 1]} are all selected`;
}

/**
 * The repository's own declarations of each group that the selection still holds.
 *
 * The other half of D3c's predicate, and the half with no counterpart to name:
 * nothing decides between two of the repository's own declarations, so no
 * single row can be unticked to rescue the group — the user has to leave one of
 * them selected, which is why every member says so rather than one of them.
 *
 * Selected is the ORDINARY default for such a group, unlike a yielder. Unticking
 * is what makes a yielder's group succeed, so unticked is the state its note
 * describes; this group has no succeeding state to default to, and offering it
 * unselected would make every row's note false at the very selection it was
 * offered at — and would read as "nothing claims priority", which is the state
 * the apply APPLIES.
 */
function claimingPerGroup(
  model: WorktreeProvisionOffer["model"],
  selected: ReadonlySet<string>,
): readonly (readonly string[])[] {
  return model.contenders.map((contest) => contest.natives.filter((id) => selected.has(id)));
}

/** The members no selection of theirs can bring over, for the selection held. */
function refusedEntire(model: WorktreeProvisionOffer["model"], selected: ReadonlySet<string>): ReadonlySet<string> {
  const refused = new Set<string>();
  const claiming = claimingPerGroup(model, selected);
  model.contenders.forEach((contest, group) => {
    if ((claiming[group]?.length ?? 0) > 1) {
      for (const member of contest.members) {
        refused.add(member);
      }
    }
  });
  return refused;
}

/**
 * The offer as one flat list, in the order the section renders.
 *
 * Flat rather than grouped by kind because § 2.4's selection is one flat list of
 * ids — a UI that sorted rows by kind would have to be undone to submit them —
 * and one row per ITEM rather than the mockup's one row per kind because the
 * spec says each row names the file that declared it, which a "Copy 2 files"
 * row cannot do once two files came from two providers.
 */
function bringRows(model: WorktreeProvisionOffer["model"]): BringRow[] {
  const rows: BringRow[] = [];
  const partners = contenderPartners(model);
  // The initial render has no selection yet, so it asks the predicate what the
  // DEFAULT would receive: every entry selected. That default is a fixed point
  // — a yielder is then refused and offered unticked, and an undecidable group
  // is refused and says so while staying ticked, because no tick state of it
  // succeeds (design.md D3c).
  const holding = new Set(model.entries.map((e) => e.id));
  const yielding = yieldsTo(model, holding);
  const grouped = groupIndex(model);
  const natives = model.contenders.map((c) => c.natives.length);
  for (const entry of model.entries) {
    const named = partners.get(entry.id);
    const loses = yielding.get(entry.id);
    const place = grouped.get(entry.id);
    const claiming = place === undefined ? 0 : (natives[place.group] ?? 0);
    rows.push({
      id: entry.id,
      verb: entry.mode === "link" ? "Link" : "Copy",
      subject: entry.path,
      source: entry.source,
      checked: loses === undefined,
      ...(entry.mode === "link" ? { warn: "writes to main" } : {}),
      ...(named === undefined ? {} : { contender: named }),
      ...(place === undefined ? {} : { group: place.group }),
      ...(place !== undefined && !place.native && claiming > 0 ? { yields: true } : {}),
      ...(claiming > 1 ? { contested: true } : {}),
    });
  }
  for (const port of model.ports) {
    rows.push({
      id: port.id,
      verb: "Allocate port",
      subject: port.port === undefined ? `${port.name} · preview unavailable` : `${port.name}=${port.port} · preview`,
      source: port.source,
      checked: true,
    });
  }
  for (const step of model.setup) {
    rows.push({
      id: step.id,
      verb: "Run setup",
      subject: step.script,
      source: step.source,
      // OFF. A command a provider file supplied is not consent because a
      // checkbox arrived pre-ticked (worktree-provisioning.md § 7).
      checked: false,
    });
  }
  // Last, and after everything the section WILL do. `source` is the file that
  // originally declared the path, never the file that removed it: the row says
  // what was inherited and then dropped, and rewriting it would attribute the
  // declaration to the wrong file (§ 4.3).
  for (const entry of model.excluded) {
    rows.push({
      id: entry.id,
      verb: "Excluded",
      subject: entry.path,
      source: entry.source,
      checked: false,
      excluded: true,
    });
  }
  return rows;
}

/**
 * `2 copied · 1 linked · 1 port · 1 setup step` — what the section will do.
 *
 * Three states, three sentences. "Nothing configured" is a repository that
 * declares nothing; "Could not be read" is a provider file that failed. They are
 * not the same claim, and a single blank summary would make them look alike.
 */
function bringSummary(model: WorktreeProvisionOffer["model"], selected: ReadonlySet<string>): string {
  // The entry counts follow the SELECTION, not the model. A member yielding to
  // the repository's own starts unticked, so counting the model would say a
  // file will be brought over that the apply refuses on every volume
  // (`award-a-contested-destination-or-refuse-it/.reviews/round-3.md` F007) —
  // and the user may then untick the favoured one and tick the yielder, which
  // reverses which of the two arrives (round-1 F001).
  //
  // Ports and setup steps still count what the offer DECLARES. That is
  // pre-existing — a setup step is offered unticked and still counted, because
  // the line says what the repository asks for and the checkbox says whether it
  // is granted — and this change does not own it.
  const yielding = yieldsTo(model, selected);
  const contested = refusedEntire(model, selected);
  const brought = model.entries.filter((e) => {
    if (!selected.has(e.id)) {
      return false;
    }
    // Nothing in a group with two selected repository declarations arrives:
    // the apply refuses it entire before it reads anything (design.md D3b).
    if (contested.has(e.id)) {
      return false;
    }
    // Selected is not the same as arriving. A yielder the user ticked BACK ON
    // while its counterpart is still selected is refused by the apply exactly
    // as if it had been left unticked, so counting it says the row will arrive
    // while the note on that same row says it will be refused
    // (`.reviews/round-5.md` F007).
    const favoured = yielding.get(e.id);
    return favoured === undefined || !selected.has(favoured.id);
  });
  const copied = brought.filter((e) => e.mode === "copy").length;
  const linked = brought.length - copied;
  const parts: string[] = [];
  if (copied > 0) {
    parts.push(`${copied} copied`);
  }
  if (linked > 0) {
    parts.push(`${linked} linked`);
  }
  if (model.ports.length > 0) {
    parts.push(`${model.ports.length} port${model.ports.length === 1 ? "" : "s"}`);
  }
  if (model.setup.length > 0) {
    parts.push(`${model.setup.length} setup step${model.setup.length === 1 ? "" : "s"}`);
  }
  if (model.contenders.length > 0) {
    // The counts above exclude the members that yield, but a group with no
    // favoured member yields nobody: its rows are all offered, all counted, and
    // which one gives way cannot be known before the worktree exists (design
    // D2). The line covers both — a settled group still tells the user why a
    // spelling it can see is not in the count.
    //
    // Counted from the members, never called a "pair": a group is a connected
    // component and three spellings of one name are one group, so the word
    // understated a three-way collision by exactly the row it did not mention
    // (round-1 F004).
    const groups = model.contenders;
    const first = groups[0];
    parts.push(
      groups.length === 1 && first !== undefined
        ? `${first.members.length} spellings may be one file`
        : `${groups.length} sets of spellings may each be one file`,
    );
  }
  if (parts.length > 0) {
    return parts.join(" \u00b7 ");
  }
  // Nothing to do. WHY there is nothing is the distinction that matters: a file
  // that failed to parse would have produced entries if it had parsed.
  return model.problems.length > 0 ? "Could not be read" : "Nothing configured";
}

/**
 * A provider file that is present and unusable, named.
 *
 * `detail` can quote arbitrary content back out of a parser, so it is set with
 * `textContent` and never interpreted. There is no "Open file" affordance: the
 * only open-a-file message this webview has resolves its path against a
 * terminal's cwd, and an inert button is worse than none.
 */
function bringProblem(problem: WorktreeProvisionOffer["model"]["problems"][number]): HTMLElement {
  const el = document.createElement("div");
  el.className = "wt-bring-problem";
  const file = document.createElement("b");
  file.className = "wt-bring-problem-file";
  file.textContent = problem.file;
  const detail = document.createElement("span");
  detail.className = "wt-bring-problem-detail";
  detail.textContent = problem.detail;
  el.append(file, detail);
  return el;
}

/**
 * A source that was detected and did not supply the offer.
 *
 * One row per source, naming every file it reads — orca is one provider over
 * two, and a row naming one of them would be telling the user something other
 * than what the host read (design.md D8). Hiding it instead would leave a
 * repository looking as if it had never configured the tool it uses.
 */
function switchRow(provider: WorktreeProvisionOffer["model"]["providers"][number], take: () => void): HTMLElement {
  const el = document.createElement("div");
  el.className = "wt-bring-switch";
  const files = document.createElement("span");
  files.className = "wt-bring-switch-files";
  // Provider-file text, set with `textContent` like every other piece of it.
  files.textContent = provider.files.join(", ");
  const take_ = document.createElement("button");
  // Explicitly a button. A default-type button inside the form SUBMITS, and a
  // switch that created a worktree is the one thing this must never do.
  take_.type = "button";
  take_.className = "wt-bring-switch-take";
  take_.textContent = "Use this instead";
  // The visible label is the same on every row, and the file list that tells
  // them apart sits beside the button rather than inside it — so to a screen
  // reader walking the controls every choice announced itself identically
  // (.reviews/round-1.md F006). Naming the button after its own source is what
  // makes the rows distinguishable without changing what is drawn.
  take_.setAttribute("aria-label", `Use ${provider.files.join(", ")} instead`);
  take_.addEventListener("click", take);
  el.append(files, take_);
  return el;
}

/**
 * One row: a checkbox, the verb and its source on the first line, the subject on
 * the second.
 *
 * Every piece of provider-file text — the subject and the source path — is set
 * with `textContent`. None of it is interpreted as markup, which is the rule the
 * whole untrusted-provider-file model rests on.
 */
function bringRow(row: BringRow, index: number): HTMLElement {
  const el = document.createElement("div");
  el.className = row.excluded === true ? "wt-brow wt-brow--excluded" : "wt-brow";
  const topId = `wt-brow-top-${index}`;
  const metaId = `wt-brow-meta-${index}`;
  const top = document.createElement("label");
  top.className = "wt-brow-top";
  top.id = topId;
  const verb = document.createElement("b");
  verb.textContent = row.verb;
  top.appendChild(verb);
  if (row.warn !== undefined) {
    // Part of the row, not a notice: the spec makes this statement
    // unsuppressible, and anything dismissible is suppressible.
    const warn = document.createElement("span");
    warn.className = "wt-brow-warn";
    warn.textContent = row.warn;
    top.appendChild(warn);
  }
  if (row.excluded === true) {
    // Says the removal was asked for. Without it the row reads as one more
    // thing the create will do, which is the opposite of what it means.
    const mark = document.createElement("span");
    mark.className = "wt-brow-excluded";
    mark.textContent = "removed on purpose";
    top.appendChild(mark);
  }
  const src = document.createElement("span");
  src.className = "wt-brow-src";
  src.textContent = row.source;
  top.appendChild(src);
  const meta = document.createElement("div");
  meta.className = "wt-brow-meta";
  meta.id = metaId;
  const code = document.createElement("code");
  code.className = "wt-brow-code";
  code.textContent = row.subject;
  meta.appendChild(code);
  if (row.contender !== undefined) {
    // Inside the meta line the subject already owns, not a sibling block: the
    // note is about THIS spelling, and `wt-brow` keeps one rendering owner.
    // The partner spelling is provider-file text like any other subject, so it
    // is set with `textContent`.
    const note = document.createElement("span");
    note.className = "wt-brow-note";
    note.textContent = `may be the same file as ${row.contender.join(", ")}`;
    meta.appendChild(note);
  }
  if (row.yields === true && row.group !== undefined) {
    // Said, not merely unchecked: an unticked row with no reason reads as an
    // oversight, and the reason is the one thing that tells the user ticking it
    // will not work while its counterpart stays selected.
    //
    // Left empty here and filled by `syncYieldNotes` from the selection: WHICH
    // declaration this row yields to is not a fact about the offer once the
    // group holds more than one of the repository's own.
    const note = document.createElement("span");
    note.className = "wt-brow-note wt-brow-yield";
    note.dataset.group = String(row.group);
    meta.appendChild(note);
  }
  if (row.contested === true && row.group !== undefined) {
    // Live like the yielding note, and for the same reason: the user settles
    // this by leaving exactly one of the group's declarations selected, and a
    // standing notice would then describe a state that has lapsed. Which
    // declarations it NAMES follows the selection too — visibility needs only
    // two of them, so naming a third the user unticked describes a selection
    // nobody holds (.reviews/round-8.md F018).
    const note = document.createElement("span");
    note.className = "wt-brow-note wt-brow-contested";
    note.dataset.group = String(row.group);
    meta.appendChild(note);
  }
  if (row.excluded === true) {
    // No checkbox at all, rather than a disabled one: a disabled input is still
    // an input, and the submit path collects `.wt-brow-cb` by class. An id that
    // never reaches the DOM cannot reach the draft.
    el.append(top, meta);
    return el;
  }
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.className = "wt-brow-cb";
  cb.id = `wt-brow-${index}`;
  // The host's own opaque id. Never the path: a value carrying one would make
  // the webview the authority on what gets materialized (§ 4.0).
  cb.value = row.id;
  cb.checked = row.checked;
  // The subject is what distinguishes one row from another, and it sits outside
  // the label to keep the mockup's two-line shape — so five rows from one
  // provider announced as five identical "Copy asimov/worktree.yaml"
  // (.reviews/round-1.md W3). Both halves are named explicitly instead.
  cb.setAttribute("aria-labelledby", `${topId} ${metaId}`);
  top.htmlFor = cb.id;
  el.append(cb, top, meta);
  return el;
}

export function openWorktreeCreateDialog(root: HTMLElement, deps: WorktreeCreateDialogDeps): () => void {
  const repos = deps.repos;
  const first = repos[0];
  if (!first) {
    throw new Error("openWorktreeCreateDialog requires at least one repo");
  }

  const draft: WorktreeCreateDraft = {
    repoId: deps.initialRepoId ?? first.repoId,
    branchMode: "new",
    branchName: "",
    baseRef: "",
    path: "",
    openAfter: "none",
  };
  /** True until the user edits the path themselves; after that we stop deriving it. */
  let pathIsDerived = true;
  /**
   * The destination the user typed — the QUESTION, never the answer (D8).
   *
   * `draft.path` is what the form states and submits, and once a resolution has
   * landed that is the resolution's own target. Keeping the candidate here is
   * what lets the two differ: a candidate the host suffixed past, or refused
   * because it resolves outside the create root, stays askable and visible in
   * the field while the create carries the path the host actually answered.
   */
  let supplied = "";
  /** What the user picked, in the form's vocabulary. `draft.openAfter` is derived
   *  from this and `folderMode` — one wire value, never two sources for it. */
  let afterChoice: AfterChoice = "none";
  let folderMode: WorktreeOpenAfter = "addToWorkspace";

  const currentRepo = (): WorktreeCreateDefaults => repos.find((r) => r.repoId === draft.repoId) ?? first;

  const shell = openDialogShell(root, {
    label: "Create worktree",
    wide: true,
    dismissOnScrim: true,
    // Escape and the scrim dispose the shell from inside it, so the tooltip has
    // to be released here too — `disposeAll` is not on that path.
    onDismiss: () => {
      releaseDestTip();
      // Escape and the scrim never reach `disposeAll`, so setting `closed`
      // only there left the guard passing on the DOM being gone rather than on
      // the guard firing (round-2 W2).
      closed = true;
      deps.onCancel?.();
    },
    // The list owns Escape only while it is open (D7). Asked by the shell
    // rather than raced with it: the shell binds Escape on `document` in the
    // capture phase before this form exists, so nothing added here could run
    // first, and two owners deciding by registration order is not a contract.
    onEscape: () => {
      if (!listOpen) {
        return false;
      }
      closeList();
      return true;
    },
  });
  const cancel = (): void => {
    deps.onCancel?.();
    disposeAll();
  };
  /** Every exit goes through here — the tooltip outlives `shell.dispose` alone. */
  const disposeAll = (restoreFocus = true): void => {
    releaseDestTip();
    // Every applier the controller still holds a reference to goes inert here.
    // The controller cannot unregister them — it learns a form closed only
    // through the view — so the form has to be the one that stops answering.
    //
    // Defensive, and honestly so: round-1 W2 named this, and the write it stops
    // is currently unobservable. A reopening rebinds before any reply can be
    // misrouted, and a reply landing between close and reopen mutates a closure
    // with no DOM left. No test can tell the two apart, so none pretends to —
    // the guard is here because writing into a disposed form is wrong, not
    // because a symptom was measured.
    closed = true;
    shell.dispose(restoreFocus);
  };
  /** True once this opening is over. Read by every bound applier. */
  let closed = false;

  shell.dialog.appendChild(dialogTitle("Create worktree", undefined, cancel));

  // ── Branch name — the lead input, with nothing above it ──────────────────
  // It is the one thing only the user can supply; everything else on this form
  // is derived, defaulted, or advanced (worktree-actions § 3.2.1).
  const nameField = field("Branch name", "wt-branch");
  const nameInput = document.createElement("input");
  nameInput.className = "wt-input";
  nameInput.id = "wt-branch";
  nameInput.type = "text";
  nameInput.placeholder = "feat/…";
  const nameError = document.createElement("span");
  nameError.className = "wt-ferror";
  nameError.hidden = true;

  // ── The branch list — one box, refs and create-new together ─────────────
  // Plain listbox markup rather than the vendored virtualized widget: the list
  // is capped host-side, and the widget brings its own focus and keyboard model
  // into a dialog that already owns a focus trap and an Escape contract (D6).
  nameInput.setAttribute("role", "combobox");
  nameInput.setAttribute("aria-autocomplete", "list");
  nameInput.setAttribute("aria-expanded", "false");
  nameInput.setAttribute("aria-controls", "wt-branch-list");
  // Described by the notice, so the "this list is partial" claim reaches a
  // reader who never sees it rendered (round-1 S1).
  nameInput.setAttribute("aria-describedby", "wt-branch-partial");
  nameInput.autocomplete = "off";

  const listBox = document.createElement("ul");
  listBox.className = "wt-branch-list";
  listBox.id = "wt-branch-list";
  listBox.setAttribute("role", "listbox");
  listBox.setAttribute("aria-label", "Branches");
  listBox.hidden = true;

  const partialNote = document.createElement("span");
  partialNote.className = "wt-fhint";
  partialNote.id = "wt-branch-partial";
  partialNote.hidden = true;

  /** What the user picked, and the ONLY source of new-versus-existing (D4). */
  let choice: BranchChoice = { kind: "new" };
  /**
   * The fork head of the pull request currently selected, and which selection it
   * describes.
   *
   * Carried WITH its repository and branch rather than as a bare flag: the note
   * is a claim about one create, and the same rule the resolutions follow
   * applies — an answer the user has typed past describes a selection that is
   * gone, so it is withdrawn by not matching rather than by every caller
   * remembering to clear it.
   */
  let forkHead: { repoId: string; branch: string; owner: string } | null = null;
  /** Rows the list is currently offering, in order. Index into `listBox`. */
  let choices: BranchChoice[] = [];
  /** Which row is active while the list is open; -1 when none is. */
  let activeAt = -1;
  let listOpen = false;

  // The popup is positioned against this field, so the field is the containing
  // block. Scoped to a class rather than `.wt-field` — every other field on the
  // form would inherit a positioning context it has no use for.
  nameField.classList.add("wt-field--combo");
  nameField.append(nameInput, listBox, partialNote, nameError);
  shell.dialog.appendChild(nameField);

  // ── Destination — one derived line, not a field ─────────────────────────
  // Stated once, shortened. `aria-label` and the tooltip carry the exact value,
  // so shortening costs nothing: the safety property is that the user sees where
  // the write lands before authorizing it, not that they read it in full.
  const destWrap = document.createElement("div");
  destWrap.className = "wt-dest-wrap";
  const dest = document.createElement("div");
  dest.className = "wt-dest";
  // `attachTooltip` exposes its target on focus, but does not make it focusable.
  // Without this the exact value is a mouse-only affordance.
  dest.tabIndex = 0;
  /** The shortened text, which is for reading and not for announcing. */
  const destShort = document.createElement("span");
  destShort.setAttribute("aria-hidden", "true");
  /**
   * The exact value, for assistive tech only. NOT `aria-label` on `dest`: its
   * implicit role is `generic`, which prohibits naming, so the attribute is
   * simply not exposed — the attribute stays for tests and for anything reading
   * the DOM, but this element is what actually announces the path.
   */
  const destExactText = document.createElement("span");
  destExactText.className = "wt-visually-hidden";
  dest.append(destShort, destExactText);
  const destNote = document.createElement("div");
  destNote.className = "wt-dest-note";
  destNote.hidden = true;
  /**
   * What the create would DO, stated where the destination is.
   *
   * The spec requires the form to say which of create / check out / repair the
   * create performs, and the base-ref rule to be legible. Both lived inside the
   * collapsed Advanced body, so neither was discoverable without expanding
   * unrelated content (round-1 B3, W6).
   */
  const actionNote = document.createElement("div");
  actionNote.className = "wt-dest-note";
  actionNote.id = "wt-action-note";
  actionNote.hidden = true;
  /**
   * The recover offer: a destination the suffixing skipped because a directory
   * with no `.git` sits there (worktree-create.md § 2.2).
   *
   * A checkbox rather than a bare statement, because accepting it is what asks
   * the host for the authorization — the offer is the question, and Create is
   * the authorization. It sits with the destination because it CHANGES the
   * destination: recovered, the create takes the skipped path, not the suffix.
   */
  /**
   * The fork remote, stated before the create is authorized (§ 5, D5).
   *
   * With the destination rather than in the list, because it describes what the
   * create would DO to the repository — configuring a remote is a
   * repository-level side effect, and § 5 requires it to be legible while the
   * create can still be abandoned rather than reported after it.
   */
  const forkNote = document.createElement("div");
  forkNote.className = "wt-dest-note";
  forkNote.id = "wt-fork-note";
  forkNote.hidden = true;
  const recoverField = document.createElement("div");
  recoverField.className = "wt-recover";
  recoverField.id = "wt-recover";
  recoverField.hidden = true;
  const recoverLabel = document.createElement("label");
  recoverLabel.className = "wt-recover-label";
  recoverLabel.htmlFor = "wt-recover-accept";
  const recoverBox = document.createElement("input");
  recoverBox.type = "checkbox";
  recoverBox.id = "wt-recover-accept";
  const recoverText = document.createElement("span");
  recoverLabel.append(recoverBox, recoverText);
  /** What is there, or why it will not be cleared. Never a claim about a path this create left behind. */
  const recoverNote = document.createElement("p");
  recoverNote.className = "wt-fhint";
  recoverNote.id = "wt-recover-note";
  recoverNote.hidden = true;
  recoverField.append(recoverLabel, recoverNote);
  destWrap.append(dest, destNote, actionNote, forkNote, recoverField);
  shell.dialog.appendChild(destWrap);
  /** The exact path the line is currently shortening; read on every show. */
  let destExact = "";
  /**
   * Attached the first time there IS a destination, not at construction.
   * `attachTooltip` resolves its text once at attach and returns a no-op when it
   * is empty — and at construction `destExact` is "", so attaching here bound
   * nothing at all and every release path below released nothing.
   */
  let disposeDestTip: (() => void) | null = null;
  const ensureDestTip = (): void => {
    if (disposeDestTip === null && destExact !== "") {
      disposeDestTip = attachTooltip(dest, { getText: () => destExact });
    }
  };
  const releaseDestTip = (): void => {
    disposeDestTip?.();
    disposeDestTip = null;
  };

  // ── Repository (only with more than one) ────────────────────────────────
  // Below the destination it derives, never above the lead input.
  const repoHint = document.createElement("span");
  repoHint.className = "wt-fhint";
  if (repos.length > 1) {
    const repoField = field("Repository", "wt-repo-select");
    const repoSelect = selectControl(
      "wt-repo-select",
      repos.map((r) => ({ value: r.repoId, label: r.repoLabel })),
      draft.repoId,
    );
    repoSelect.addEventListener("change", () => {
      draft.repoId = repoSelect.value;
      agentBox.setAgents(currentRepo().agents);
      rebuildAfterOptions();
      // The branch list belongs to a repository. The same typed name can be an
      // existing branch in one and a new one in the next, and it can be held in
      // one and free in the other — both are re-answered here (B2, W1).
      deriveChoice();
      if (listOpen) {
        renderList();
      }
      syncDerived(true);
    });
    repoField.append(repoSelect, repoHint);
    shell.dialog.appendChild(repoField);
  }

  // ── Branch source — inside the disclosure (built below) ─────────────────
  // Only `detached` lives here now. New-versus-existing is the combobox's, and
  // one wire value never takes two sources (D4): a control that also wrote
  // `branchMode` would disagree with the row the user picked.
  const modeField = field("Branch source");
  const detachToggle = document.createElement("button");
  detachToggle.type = "button";
  detachToggle.className = "vault-segmented";
  detachToggle.id = "wt-detached";
  detachToggle.dataset.mode = "detached";
  detachToggle.setAttribute("aria-pressed", "false");
  detachToggle.textContent = "Detach at a ref instead";
  detachToggle.addEventListener("click", () => {
    const now = draft.branchMode !== "detached";
    draft.branchMode = now ? "detached" : "new";
    detachToggle.setAttribute("aria-pressed", now ? "true" : "false");
    if (now) {
      // Detached SURRENDERS the pull request as the source: it creates at a ref
      // and mints no branch, so `pr/<n>` is no longer what this create is about.
      // Withdrawn here rather than hidden by the guard, because leaving detached
      // re-derives the still-present text as an ordinary branch and would
      // otherwise resurrect a statement nobody re-selected (.reviews/round-2.md
      // B2).
      forkHead = null;
    }
    // Leaving detached hands the mode back to the box, which has to re-ask the
    // question: refs may have landed while detached was on, and `choice` was
    // not being maintained under it.
    if (!now) {
      deriveChoice();
    }
    closeList();
    syncDerived(true);
  });
  modeField.appendChild(detachToggle);

  const baseField = field("Base ref", "wt-base", true);
  const baseInput = document.createElement("input");
  baseInput.className = "wt-input wt-input--mono";
  baseInput.id = "wt-base";
  baseInput.type = "text";
  baseInput.placeholder = "HEAD";
  baseField.appendChild(baseInput);
  // Disabled, never hidden (D5): a field that vanishes when the mode changes
  // reads as a bug, and a base ref silently ignored is what § 2.1 forbids.
  const baseNote = document.createElement("p");
  baseNote.className = "wt-fhint";
  baseNote.id = "wt-base-note";
  baseNote.hidden = true;
  baseInput.setAttribute("aria-describedby", "wt-base-note");
  baseField.appendChild(baseNote);

  // The override, which is a different thing from a statement of where the
  // worktree will go — hence its home here rather than on the form's face.
  const pathField = field("Destination override", "wt-path", true);
  const pathInput = document.createElement("input");
  pathInput.className = "wt-input wt-input--mono";
  pathInput.id = "wt-path";
  pathInput.type = "text";
  pathField.appendChild(pathInput);
  // The same rule the base ref carries, for the same reason: a mode whose
  // target is not the user's to choose says so rather than accepting a value it
  // will not use. A repair acts on the registration's own directory, and an
  // override here displayed one path while the request carried another
  // (round-4 B3).
  const pathNote = document.createElement("p");
  pathNote.className = "wt-fhint";
  pathNote.id = "wt-path-note";
  pathNote.hidden = true;
  pathInput.setAttribute("aria-describedby", "wt-path-note");
  pathField.appendChild(pathNote);

  // ── Bring over — what the new worktree will NOT inherit ─────────────────
  // Below the destination and above the after-create choice, because it
  // describes the worktree being made rather than what happens once it exists.
  // The section is never a gate: a repository that declares nothing, and one
  // whose provider file cannot be read, both still submit.
  const bringField = field("Bring over");
  bringField.classList.add("wt-bring");
  const bringSum = document.createElement("span");
  bringSum.className = "wt-bring-sum";
  bringField.firstChild?.appendChild(bringSum);
  const bringBox = document.createElement("div");
  bringBox.className = "wt-bring-box";
  // Not an empty list. "This repository needs nothing brought over" and "we did
  // not look" are different statements, and an empty box says neither — so the
  // empty case is the sentence, naming what the worktree will actually lack.
  const bringEmpty = document.createElement("div");
  bringEmpty.className = "wt-bring-empty";
  bringEmpty.textContent = "This worktree will have no .env and no node_modules.";
  bringField.append(bringBox, bringEmpty);
  shell.dialog.appendChild(bringField);

  // Attached only while an offer is drawn, and removed rather than disabled
  // when one is not: a Configure pressed before the host has answered would
  // record the empty selection as "bring nothing over", which is a statement
  // the user never made.
  const saveRow = document.createElement("div");
  saveRow.className = "wt-bring-save-row";
  const saveButton = document.createElement("button");
  // Explicitly a button, like the switch rows: a default-type button inside the
  // form SUBMITS, and a create started by pressing Configure is the one thing
  // this must never do.
  saveButton.type = "button";
  saveButton.className = "wt-bring-save";
  saveButton.textContent = "Configure…";
  // What the repository will NOT keep, said before the save rather than after
  // it. Setup steps and ports are the two choices the configuration has no
  // vocabulary for — § 7 forbids persisting a pre-ticked command, and an
  // unallocated port has no path for `exclude` to match (design.md D6).
  const saveNote = document.createElement("span");
  saveNote.className = "wt-bring-save-note";
  saveNote.textContent = "Setup steps and ports apply to this create only.";
  saveRow.append(saveButton, saveNote);
  saveButton.addEventListener("click", () => {
    // Resolved at event time, never captured: item ids are offer-local and
    // every offer starts at `i1`, so a handler closing over one redraw's set
    // would write another offer's selection under a colliding id (round-2 W5).
    if (drawnOfferId === null) {
      return;
    }
    const ticked = checkedByOffer.get(drawnOfferId);
    if (ticked === undefined) {
      return;
    }
    switchSeq += 1;
    deps.onProvisionSave?.({
      repoId: draft.repoId,
      switch: switchSeq,
      offerId: drawnOfferId,
      kept: [...ticked],
    });
  });

  /** The offer currently drawn, so an unchanged one is not redrawn. */
  let drawnOfferId: string | null = null;
  // The model behind `drawnOfferId`, so the toggle handler can restate the
  // summary without a redraw — redrawing on a tick is what W2 forbids.
  let drawnModel: WorktreeProvisionOffer["model"] | null = null;
  /**
   * What the user has ticked, per offer.
   *
   * Kept outside the DOM because the section is rebuilt when a new offer
   * supersedes the old one and when the repo picker moves. Nothing reads this
   * yet — WT-012.2 owns redemption — but losing a choice silently is a defect
   * whether or not anything acts on it (.reviews/round-1.md W2).
   */
  const checkedByOffer = new Map<string, Set<string>>();

  // Registered ONCE. Inside the redraw it added a handler per rebuild, each
  // closing over that redraw's own set — and item ids are offer-local, every
  // offer starting at `i1`, so a stale handler wrote another offer's selection
  // under a colliding id (.reviews/round-2.md W5). The set is resolved at event
  // time instead of captured.
  bringBox.addEventListener("change", (ev) => {
    const cb = ev.target;
    if (!(cb instanceof HTMLInputElement) || !cb.classList.contains("wt-brow-cb") || drawnOfferId === null) {
      return;
    }
    const ticked = checkedByOffer.get(drawnOfferId);
    if (cb.checked) {
      ticked?.add(cb.value);
    } else {
      ticked?.delete(cb.value);
    }
    // The counts and the yielding notes are claims about what this create will
    // bring over, so they are restated from the selection that just changed
    // rather than left at whatever the first render computed (round-1 F001).
    // Text and one hidden flag: no row is rebuilt, so no checkbox is reset.
    if (drawnModel !== null && ticked !== undefined) {
      bringSum.textContent = bringSummary(drawnModel, ticked);
      syncYieldNotes(ticked);
    }
  });

  /**
   * Show each yielding note only while the declaration it names is selected.
   *
   * The note states a condition, so it is displayed exactly when the condition
   * holds. Unticking the favoured member leaves the other one uncontested — the
   * apply recomputes its contests from what was submitted and finds no favoured
   * member — so the refusal it warns about is no longer the one that will
   * happen (round-1 F001).
   */
  function syncYieldNotes(ticked: ReadonlySet<string>): void {
    if (drawnModel === null) {
      return;
    }
    const pathOf = new Map(drawnModel.entries.map((e) => [e.id, e.path] as const));
    // Once per GROUP, not once per note. Every note pointing at a group asks the
    // same question of the same list, and a group is every entry sharing one
    // fold key, so it can hold every row the cap allows: reading it per note
    // made one checked-in file quadratic in its own rows
    // (.reviews/round-8.md F019).
    const claiming = claimingPerGroup(drawnModel, ticked).map((ids) =>
      ids.flatMap((id) => {
        const path = pathOf.get(id);
        return path === undefined ? [] : [path];
      }),
    );
    for (const note of bringBox.querySelectorAll<HTMLElement>(".wt-brow-yield")) {
      const held = claiming[Number(note.dataset.group)] ?? [];
      // Exactly one, which is D3c's favoured case. None leaves nothing claiming
      // priority and the apply applies the group, so there is no refusal to
      // warn about; more than one refuses it entire, which the note below owns.
      note.hidden = held.length !== 1;
      if (held[0] !== undefined) {
        note.textContent = `refused while ${held[0]} is selected`;
      }
    }
    for (const note of bringBox.querySelectorAll<HTMLElement>(".wt-brow-contested")) {
      const held = claiming[Number(note.dataset.group)] ?? [];
      note.hidden = held.length < 2;
      if (held.length >= 2) {
        note.textContent = `refused while ${bothOrAll(held)} — the repository declares this destination more than once`;
      }
    }
  }

  /**
   * Monotonic per dialog, minted here.
   *
   * The host orders answers by it, so it must increase across every switch this
   * form takes — including switches for different repositories, which is why it
   * is one counter and not one per repo.
   */
  let switchSeq = 0;

  /** Redraw the section from the repo's offer. Called on every derive. */
  function syncBringOver(offer: WorktreeProvisionOffer | undefined): void {
    if (offer === undefined) {
      // No offer has arrived. Saying nothing is right here and only here: the
      // form has not been told what this repository needs, and an empty section
      // would claim it needs nothing.
      bringField.hidden = true;
      bringSum.textContent = "";
      bringBox.replaceChildren();
      saveRow.remove();
      drawnOfferId = null;
      drawnModel = null;
      return;
    }
    // `syncDerived` runs on every keystroke, and rebuilding there reset every
    // checkbox — so unticking Run setup and typing one more character silently
    // put it back (W2). The offer is the only thing this section renders, so its
    // id is the only thing that can require a redraw.
    if (drawnOfferId === offer.offerId) {
      return;
    }
    drawnOfferId = offer.offerId;
    drawnModel = offer.model;
    bringField.hidden = false;
    bringField.appendChild(saveRow);
    let ticked = checkedByOffer.get(offer.offerId);
    if (ticked === undefined) {
      ticked = new Set(
        bringRows(offer.model)
          .filter((r) => r.checked)
          .map((r) => r.id),
      );
      checkedByOffer.set(offer.offerId, ticked);
    }
    // After the selection exists, never before: the counts are read off it.
    bringSum.textContent = bringSummary(offer.model, ticked);
    const held = ticked;
    const rows = bringRows(offer.model).map((row) => ({ ...row, checked: held.has(row.id) }));
    // Every source the host detected and did not choose. `active` is the host's
    // word for which one supplied the rows above.
    const inactive = offer.model.providers.filter((p) => !p.active);
    // Problems sit inside the box beside the rows, not instead of them: an
    // unknown key does not discard the keys that parsed, and reporting only the
    // problem would understate what the create is about to do.
    // Replaced, never appended: a redrawn offer that added its switch rows to
    // the previous offer's would grow a row per switch taken.
    bringBox.replaceChildren(
      ...rows.map((row, i) => bringRow(row, i)),
      ...offer.model.problems.map((problem) => bringProblem(problem)),
      ...inactive.map((provider) =>
        switchRow(provider, () => {
          switchSeq += 1;
          deps.onProvisionSwitch?.({ repoId: draft.repoId, switch: switchSeq, provider: provider.id });
        }),
      ),
    );
    syncYieldNotes(held);
    bringBox.hidden = bringBox.childElementCount === 0;
    // The sentence stands in only where there is genuinely nothing to list. A
    // file that failed to parse has a problem row, which is a different answer,
    // and a switch row is an offer rather than something this worktree gets —
    // so a present source declaring nothing still says what the worktree lacks.
    bringEmpty.hidden = rows.length + offer.model.problems.length > 0;
  }

  // ── After creating ──────────────────────────────────────────────────────
  const afterField = field("After creating", "wt-after");
  const afterSelect = selectControl(
    "wt-after",
    openAfterOptions(currentRepo().agents.length > 0).map((o) => ({ value: o.value, label: o.label })),
    afterChoice,
  );
  afterSelect.addEventListener("change", () => {
    afterChoice = afterSelect.value as AfterChoice;
    syncOpenAfter();
  });
  afterField.appendChild(afterSelect);

  // The secondary control on the folder choice, revealed by it the same way the
  // agent block is revealed by the agent choice.
  const folderField = field("Where", "wt-folder-mode");
  folderField.classList.add("wt-folder-mode");
  const folderSelect = selectControl("wt-folder-mode", [...FOLDER_MODES], folderMode);
  folderSelect.addEventListener("change", () => {
    folderMode = folderSelect.value as WorktreeOpenAfter;
    syncOpenAfter();
  });
  folderField.appendChild(folderSelect);
  folderField.hidden = true;
  shell.dialog.append(afterField, folderField);

  // ── Agent box — shown only for `openAfter: "agent"` ─────────────────────
  // The block itself is shared with the standalone launch dialog, so create-then-
  // launch and launch-here collect the same thing rather than two things that
  // happen to look alike (design.md D7).
  const agentBox = createWorktreeAgentBox(currentRepo().agents, () => syncDerived());
  agentBox.setVisible(false);
  shell.dialog.appendChild(agentBox.element);

  // ── Advanced — collapsed, and out of the focus order while it is ────────
  // The same reveal idiom the agent block uses: a toggle carrying `aria-expanded`
  // over a region carrying `hidden`. `openDialogShell`'s focus trap already
  // filters on `[hidden]`, so nothing inside reaches Tab until it opens — which a
  // native `<details>` would not have given us without widening that filter.
  const advanced = document.createElement("div");
  advanced.className = "wt-advanced";
  const advToggle = document.createElement("button");
  advToggle.type = "button";
  advToggle.className = "wt-advanced-toggle";
  advToggle.id = "wt-advanced-toggle";
  advToggle.setAttribute("aria-expanded", "false");
  advToggle.setAttribute("aria-controls", "wt-advanced-body");
  advToggle.textContent = "Advanced";
  const advBody = document.createElement("div");
  advBody.className = "wt-advanced-body";
  advBody.id = "wt-advanced-body";
  advBody.hidden = true;
  advBody.append(modeField, baseField, pathField);
  advToggle.addEventListener("click", () => {
    advBody.hidden = !advBody.hidden;
    advToggle.setAttribute("aria-expanded", advBody.hidden ? "false" : "true");
    shell.refreshFocusTrap();
  });
  advanced.append(advToggle, advBody);
  shell.dialog.appendChild(advanced);

  // ── Actions ─────────────────────────────────────────────────────────────
  const cancelBtn = textButton("Cancel", "plain", cancel);
  const createBtn = textButton("Create worktree", "primary", () => submit());
  createBtn.appendChild(keyHint("⌘↵"));
  shell.actions.append(cancelBtn, createBtn);
  shell.dialog.appendChild(shell.actions);

  /**
   * The offer on screen and what is ticked in it, or nothing.
   *
   * Nothing in two cases that are NOT the same: no offer ever arrived, so the
   * form was never told what this repository needs; or an offer arrived and the
   * user unticked every row, which is a decision and travels as an empty list.
   * Collapsing the second into the first would let a host that provisions by
   * default provision against a user who said no.
   */
  function settledProvision(): { offerId: string; itemIds: readonly string[] } | undefined {
    if (drawnOfferId === null) {
      return undefined;
    }
    return { offerId: drawnOfferId, itemIds: [...(checkedByOffer.get(drawnOfferId) ?? [])] };
  }

  function submit(): void {
    if (createBtn.disabled || heldBranch() !== undefined) {
      return;
    }
    const launch = afterChoice === "agent" ? agentBox.read() : {};
    // The classification travels WITH the submission, so the owner builds the
    // request from the answer this form was showing rather than from its own
    // second copy of it (round-3 B3).
    // The mode the toggle discarded does not travel either: the owner builds the
    // request from it, so sending a classification of text that is not a branch
    // name would turn a detached create into the repair the form refused.
    const carried = draft.branchMode === "detached" ? null : effective;
    // The grant, only where it still covers the destination this form is
    // showing. Absent, the create is an ordinary one against a free path — the
    // form never asks for a removal it cannot name the authorization for.
    const disposition = settledDisposition();
    // The last hop. `checkedByOffer` has held this since WT-012.1 and nothing
    // read it, so every tick the user made was discarded at the submit and the
    // whole provisioning flow was inert end to end (.reviews/round-1.md F005).
    const provision = settledProvision();
    deps.onSubmit({
      ...draft,
      ...launch,
      ...(carried === null ? {} : { resolved: carried.mode }),
      ...(disposition === undefined ? {} : { disposition }),
      ...(provision === undefined ? {} : { provision }),
    });
    disposeAll();
  }

  /**
   * The one place the offered choice becomes a wire value, and the one place the
   * two reveals it drives are applied. Two different questions, and the agent box
   * keeps them apart: "this create is not launching" is ours, "there is nothing
   * to launch" is its own.
   */
  function syncOpenAfter(): void {
    draft.openAfter = afterChoice === "folder" ? folderMode : afterChoice;
    agentBox.setVisible(afterChoice === "agent");
    folderField.hidden = afterChoice !== "folder";
    // The submit gate reads the revealed block, so revealing one has to re-ask
    // it. `syncDerived` does not call back here, so this does not recurse.
    syncDerived();
  }

  /** A repo switch can withdraw the launch — the mode goes with it, not just the box. */
  function rebuildAfterOptions(): void {
    const offered = openAfterOptions(currentRepo().agents.length > 0);
    // Only a choice the rebuild actually withdrew is reset. The folder choice is
    // always offered, so a repo switch that drops the agent one must leave it —
    // and its secondary selection — exactly where the user put them.
    if (!offered.some((o) => o.value === afterChoice)) {
      afterChoice = "none";
    }
    afterSelect.replaceChildren(
      ...offered.map((o) => {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        return opt;
      }),
    );
    afterSelect.value = afterChoice;
    syncOpenAfter();
  }

  /** The repo AND branch the last host request was made for, so edits do not
   *  re-ask — and so a repo switch is not mistaken for the same question. The
   *  request is repo-scoped; a key that is not reuses one repo's answer for
   *  another, and the destination line is what states that answer. */
  let askedFor: string | null = null;
  /**
   * The repo and branch of the same request, kept separately because the
   * DEFAULTS reply can only echo those two — a base or destination edit changes
   * `askedFor` without changing the question that reply is answering.
   */
  let defaultsAskedFor: string | null = null;
  /**
   * The whole selection, so an edit to the base or the destination re-asks.
   * Keyed on the same value the request carries — anything the key drops is a
   * field the form could change without the host ever hearing about it.
   */
  const askKey = (s: CreateSelection): string =>
    JSON.stringify([s.repoId, s.branch, s.base ?? null, s.candidatePath ?? null]);

  /** True while a destination request has no answer yet. Submit waits for it. */
  let outstanding = false;
  /**
   * The ONE resolution this form is acting on (D8).
   *
   * Mode, the stated action and the guards all read this rather than each
   * interpreting the answer for themselves — two interpretations of one answer
   * is how a repair could act on a different path from the one on screen.
   */
  let effective: WorktreeCreateResolutionMessage | null = null;
  /**
   * True while the classification for the typed selection has not landed.
   *
   * Submit waits for it as well as the destination. Without this the form could
   * submit an existing branch as fresh while its own classification was still in
   * flight — the failure-after-submit this change exists to remove (round-1 B2).
   */
  let resolutionOutstanding = false;

  /** The user accepted the recover offer. Withdrawn by any change of selection. */
  let recoverWanted = false;
  /** The authorization the host issued, and the entries it was digested over. */
  let recoverGrant: { path: string; authorization: DebrisAuthorization; entries: readonly string[] } | null = null;
  /**
   * Which request is outstanding, or null.
   *
   * A generation rather than a flag: an answer that arrives after the offer was
   * withdrawn names the same path and would otherwise be kept, so a later
   * re-acceptance reused a reading that acceptance never made (round-1 W2).
   */
  let recoverAsked: number | null = null;
  let recoverAsks = 0;
  /** Why the host refused, stated where the offer was — a refusal is an answer, not silence. */
  let recoverRefused: string | null = null;

  /**
   * The directory this form would offer to clear, or null where it offers none.
   *
   * Only a candidate the suffixing SKIPPED, only where the resolution classified
   * it as debris, and only where the create would actually take that path once
   * it is cleared: under `reattach` the create acts on the registration's own
   * path, so the skipped candidate is a directory this create never touches, and
   * offering to delete it would be the round-3 B3 defect with a delete attached.
   */
  function debrisOffer(): string | null {
    if (deps.onAuthorizeDebris === undefined || deps.bindDebrisAuthorization === undefined) {
      // Nothing can answer the request, so the offer would be a control that
      // cannot be acted on.
      return null;
    }
    if (effective === null) {
      return null;
    }
    const occupied = effective.occupiedCandidate;
    if (occupied === undefined || occupied.disposition.kind !== "debris") {
      return null;
    }
    // The MODE, said outright. Comparing `targetOf` against `freePath` was a
    // proxy for it, and the two coincide whenever a stale registration's own
    // path is also the first free candidate — which armed a clearance the
    // service's repair branch never performs (round-1 B7).
    if (draft.branchMode !== "detached" && effective.mode.kind === "reattach") {
      return null;
    }
    return targetOf(effective) === effective.freePath ? occupied.path : null;
  }

  /** The disposition the form settled on — `debris` only under a grant for the path on screen. */
  function settledDisposition(): { kind: "debris"; authorization: DebrisAuthorization } | undefined {
    const offer = debrisOffer();
    if (!recoverWanted || offer === null || recoverGrant === null || recoverGrant.path !== offer) {
      return undefined;
    }
    return { kind: "debris", authorization: recoverGrant.authorization };
  }

  /** Forget an acceptance and its grant. The authorization binds one path and one content. */
  function withdrawRecover(): void {
    recoverWanted = false;
    recoverGrant = null;
    recoverAsked = null;
    recoverRefused = null;
    recoverBox.checked = false;
  }

  recoverBox.addEventListener("change", () => {
    const offer = debrisOffer();
    if (offer === null) {
      recoverBox.checked = false;
      return;
    }
    if (!recoverBox.checked) {
      withdrawRecover();
      syncDerived();
      return;
    }
    recoverWanted = true;
    recoverRefused = null;
    if (recoverGrant?.path !== offer) {
      // A grant for a different directory authorizes nothing here.
      recoverGrant = null;
      recoverAsks += 1;
      recoverAsked = recoverAsks;
      deps.onAuthorizeDebris?.({ repoId: draft.repoId, ask: recoverAsked, path: offer });
    }
    syncDerived();
  });

  /** What the form would start a new branch from, where the mode takes one. */
  function probeBase(): ProbeBase | undefined {
    // The toggle and the field, and nothing the ANSWER set: `branchMode` also
    // carries `existing` and `reattach`, which the resolution writes back, so
    // reading those here would change the question every time it was answered.
    // Which modes refuse a base is the HOST's to decide — it withholds the
    // verdict itself (D7).
    if (draft.branchMode === "detached") {
      return { kind: "detached" };
    }
    const ref = draft.baseRef.trim();
    return ref.length === 0 ? undefined : { kind: "ref", ref };
  }

  /** The selection as the host would be told it. */
  function selection(): CreateSelection {
    const base = probeBase();
    return {
      repoId: draft.repoId,
      branch: draft.branchMode === "detached" ? draft.baseRef : draft.branchName,
      ...(base === undefined ? {} : { base }),
      // Only an override travels. The derived path is the host's own answer
      // coming back, and sending it would pin the resolution to the value it
      // just produced instead of letting it re-derive.
      ...(pathIsDerived || supplied.trim().length === 0 ? {} : { candidatePath: supplied }),
    };
  }

  /**
   * The directory this resolution's create would act on.
   *
   * A repair acts on the registration's OWN path; `freePath` is the free suffix
   * the create would have taken instead, and stating that beside a checkout
   * already sitting there described a directory this create will never touch
   * (round-3 B3).
   */
  function targetOf(resolution: WorktreeCreateResolutionMessage): string {
    // The mode the FORM holds, not the one the answer carried: under detached
    // the classification is discarded (D5), so a repair path it named is not a
    // directory this create will ever act on.
    const mode = resolution.mode;
    return mode.kind === "reattach" && draft.branchMode !== "detached" ? mode.repairPath : resolution.freePath;
  }

  /** Ask the host what this selection would do, at most once each. */
  function askForDestination(): void {
    const now = selection();
    const key = askKey(now);
    if (key === askedFor) {
      return;
    }
    askedFor = key;
    defaultsAskedFor = `${now.repoId}\u0000${now.branch}`;
    if (deps.onSelectionChange !== undefined) {
      // EVERY changed selection, the destination override included. Exempting
      // it — on the reasoning that an override changes which path is reported
      // on rather than what the create does — left the override submittable
      // against an answer that was never about it, and under `reattach` left
      // the form showing the override while the request carried the repair
      // target (round-4 B3).
      outstanding = true;
      // A new question invalidates the old answer immediately, rather than
      // leaving the previous classification readable until the reply lands.
      effective = null;
      // And with it the acceptance: an authorization is issued over ONE path and
      // what was in it, so carrying it across a changed selection would submit a
      // token for a directory this create is no longer aimed at.
      withdrawRecover();
      // Only where an answer is actually coming. With no resolver bound none
      // ever arrives, and gating on it would leave Create permanently disabled
      // rather than waiting for something.
      resolutionOutstanding = deps.bindResolution !== undefined;
      deps.onSelectionChange(now);
    }
  }

  /**
   * The directory holding the branch this form would submit, if one does.
   *
   * The guard, stated once and read in two places: `syncDerived` to disable
   * Create, and `submit` to refuse a route that reached it without re-deriving.
   */
  function heldBranch(): string | undefined {
    if (draft.branchMode === "detached") {
      return undefined;
    }
    // A repair is not blocked by the registration it repairs. `heldBy` comes
    // from the listing, which reports a prunable holder exactly like a live
    // one; the resolution is what told these apart, and it says `blockedBy`
    // when a LIVE worktree holds the branch and `reattach` when the holder is
    // the stale registration this create would fix (design.md D3).
    if (draft.branchMode === "reattach") {
      return undefined;
    }
    // The RESOLUTION when there is one. It is the answer that told a live
    // holder from the stale registration a repair would fix, so re-deriving the
    // holder from the listing here was a second interpretation of it
    // (round-3 B3).
    if (effective !== null) {
      return effective.blockedBy?.ownerPath;
    }
    // Otherwise from the typed NAME against the current repository's list, not
    // from `choice`. Committing the create-new row deliberately sets `choice`
    // to `new` while leaving the typed text alone, so a guard reading `choice`
    // stops seeing the holder and submits a branch another worktree holds
    // (round-2 B4).
    //
    // Still the current repository's list and nothing else: the round-1 W1
    // fallback to a standing selection is not restored, because it could not
    // tell "this repo has the ref and it is free" from "this repo does not
    // have it".
    const typed = nameInput.value.trim();
    return typed.length === 0 ? undefined : offeredRefs().find((ref) => ref.name === typed)?.heldBy;
  }

  /**
   * Re-decide what the typed text means, against the repository the form is on
   * NOW. The single source D4 claims: mode is derived here and nowhere else.
   *
   * Two-way on purpose. Only ever upgrading to `existing` left a branch that
   * exists in one repository still submitting as `existing` after a switch to
   * one where it does not (round-1 B2).
   */
  function deriveChoice(): void {
    const typed = nameInput.value.trim();
    const exact = typed.length === 0 ? undefined : offeredRefs().find((r) => r.name === typed);
    choice = exact === undefined ? { kind: "new" } : { kind: "existing", ref: exact };
    if (draft.branchMode !== "detached") {
      draft.branchMode = choiceMode(choice);
    }
  }

  /**
   * Why the base ref is unavailable, per mode. Absent means it applies.
   *
   * A total map rather than a condition, so a mode added later has to answer
   * the question rather than inherit an answer nobody wrote for it.
   */
  /**
   * What the create will do, in the user's terms.
   *
   * The spec requires the form to state which of create / check out / repair the
   * create would perform, before submit rather than as a failure after it.
   */
  const DETACHED_ACTION = "Creates a detached worktree at the commit this ref names.";

  const ACTION_BY_MODE: Record<ResolvedMode["kind"], string> = {
    fresh: "Creates a new branch here.",
    reuse: "Checks out the branch that already exists.",
    reattach: "Repairs the stale registration of the checkout already on disk.",
    adopt: "That checkout's administrative entry is gone, so a new worktree is created instead.",
  };

  /**
   * Why the destination override is unavailable, per mode. Absent means it
   * applies. Total, for the same reason `BASE_REFUSED_BY` is.
   */
  const DEST_REFUSED_BY: Record<WorktreeBranchMode, string | undefined> = {
    new: undefined,
    detached: undefined,
    existing: undefined,
    reattach: "This repairs a checkout that is already on disk, so it keeps the directory it is in.",
  };

  const BASE_REFUSED_BY: Record<WorktreeBranchMode, string | undefined> = {
    new: undefined,
    detached: undefined,
    existing: "This branch already exists, so it starts where it already is.",
    reattach: "This repairs a checkout that is already on disk, so it keeps the commit it is on.",
  };

  /** The wire mode a choice means. `detached` is the toggle's and never a row's. */
  function choiceMode(c: BranchChoice): WorktreeBranchMode {
    return c.kind === "existing" ? "existing" : "new";
  }

  /** The refs the current repository was told about; empty until it is told. */
  function offeredRefs(): readonly WorktreeRef[] {
    return currentRepo().refs?.list ?? [];
  }

  function setActive(next: number): void {
    activeAt = next;
    const rows = Array.from(listBox.children) as HTMLElement[];
    rows.forEach((row, at) => {
      row.classList.toggle("is-active", at === activeAt);
      row.setAttribute("aria-selected", at === activeAt ? "true" : "false");
    });
    const active = activeAt >= 0 ? rows[activeAt] : undefined;
    if (active === undefined) {
      nameInput.removeAttribute("aria-activedescendant");
    } else {
      nameInput.setAttribute("aria-activedescendant", active.id);
      // The popup scrolls, so past its visible rows Enter would otherwise
      // commit an option the user cannot see (round-2 B1). Guarded because
      // jsdom does not implement it.
      active.scrollIntoView?.({ block: "nearest" });
    }
  }

  /** Redraw the rows for the text currently typed. Does not open or close. */
  function renderList(): void {
    choices = orderChoices(offeredRefs(), nameInput.value, currentRepo().pullRequests);
    listBox.replaceChildren();
    choices.forEach((c, at) => {
      const row = document.createElement("li");
      row.id = `wt-branch-opt-${at}`;
      row.className = "wt-branch-opt";
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", "false");
      if (c.kind === "new") {
        row.dataset.kind = "new";
        const typed = nameInput.value.trim();
        row.textContent = typed.length > 0 ? `${CREATE_ROW_LABEL} “${typed}”` : CREATE_ROW_LABEL;
      } else if (c.kind === "prsUnavailable") {
        // A statement, not an offer: announced and reachable, never selectable.
        // Same reason the held-by row stays — saying nothing would leave the
        // user thinking the repository has no pull requests (§ 5).
        row.dataset.kind = "prs-unavailable";
        row.setAttribute("aria-disabled", "true");
        row.textContent = "Pull requests unavailable";
      } else if (c.kind === "pr") {
        row.dataset.kind = "pr";
        row.dataset.branch = `pr-${c.pr.number}`;
        row.dataset.pr = String(c.pr.number);
        row.textContent = `#${c.pr.number} ${c.pr.title}`;
      } else {
        row.dataset.kind = "existing";
        row.dataset.branch = c.ref.name;
        row.textContent = c.ref.name;
        if (c.ref.heldBy !== undefined) {
          // `aria-disabled`, never `disabled`: the row's whole purpose is to say
          // WHY the branch is unavailable and which directory has it, so it has
          // to stay reachable and announced. Removing it would put the name back
          // to looking free, which is the failure this task deletes (D5).
          row.setAttribute("aria-disabled", "true");
          row.dataset.heldBy = c.ref.heldBy;
          const badge = document.createElement("span");
          badge.className = "wt-branch-held";
          // A NAME, never a path — the badge is the narrowest slot in the form
          // and the host already applied the shortening (D2, § 4.2).
          badge.textContent = `in ${c.ref.heldBy}`;
          row.appendChild(badge);
        }
      }
      row.addEventListener("mousedown", (ev) => {
        // `mousedown`, not `click`: the input blurs first otherwise and the
        // blur handler closes the list out from under the pointer.
        ev.preventDefault();
        commit(at);
      });
      listBox.appendChild(row);
    });
    setActive(Math.min(activeAt, choices.length - 1));
  }

  function openList(): void {
    listOpen = true;
    renderList();
    listBox.hidden = false;
    nameInput.setAttribute("aria-expanded", "true");
    measureRoom();
    shell.refreshFocusTrap();
  }

  /**
   * Publish the room actually below the input, for the popup's ceiling.
   *
   * CSS alone cannot express this: a `calc` against `100%` resolves to the
   * FIELD's height, not to where the field sits in the viewport, so the round-2
   * attempt read as a measurement and was not one (round-3 S3). The element is
   * the only thing that knows its own position, so it hands the number over.
   */
  function measureRoom(): void {
    const room = nameInput.getBoundingClientRect?.();
    if (room === undefined) {
      return; // jsdom, or a detached node — the stylesheet's own floor applies
    }
    const below = Math.round(window.innerHeight - room.bottom - 12);
    listBox.style.setProperty("--wt-branch-room", `${Math.max(below, 0)}px`);
  }

  function closeList(): void {
    listOpen = false;
    listBox.hidden = true;
    nameInput.setAttribute("aria-expanded", "false");
    nameInput.removeAttribute("aria-activedescendant");
    activeAt = -1;
    shell.refreshFocusTrap();
  }

  /**
   * What a pull request names as a branch: `pr/<number>` and nothing else (D4).
   *
   * Not the title, not `headRefName` — both belong to the pull request's author
   * and both can be renamed. A worktree that changes identity when someone edits
   * a title is not the same worktree tomorrow.
   */
  function branchOfPullRequest(pr: PullRequestOffer): string {
    return `pr/${pr.number}`;
  }

  /** Take row `at` as the selection, close the list, and re-derive. */
  function commit(at: number): void {
    const row = choices[at];
    if (row === undefined || row.kind === "prsUnavailable") {
      return;
    }
    // A pull request is a SOURCE, not a third kind of branch. It names a branch
    // and a base, and from there it is the same question a typed name asks — so
    // it is decided here against the same refs, and below by the same
    // resolution: reuse, held-by and collision stay answered in one place.
    const named = row.kind === "pr" ? branchOfPullRequest(row.pr) : undefined;
    const already = named === undefined ? undefined : offeredRefs().find((ref) => ref.name === named);
    const picked: BranchChoice =
      named === undefined ? row : already === undefined ? { kind: "new" } : { kind: "existing", ref: already };
    if (picked.kind === "existing" && picked.ref.heldBy !== undefined) {
      // Refused, and SAID. Silence here is indistinguishable from a dropped
      // keypress, and the explanation already exists (round-1 S2).
      nameError.textContent = `${picked.ref.name} is checked out in ${picked.ref.heldBy}`;
      nameError.hidden = false;
      return;
    }
    choice = picked;
    if (picked.kind === "existing") {
      nameInput.value = picked.ref.name;
    }
    if (named !== undefined && row.kind === "pr") {
      // The two fields the pull request answers. `syncDerived` reads both back
      // into the draft, so writing them here is the whole of what feeds the
      // existing path — there is no second resolution for pull requests.
      nameInput.value = named;
      baseInput.value = row.pr.baseRefName;
      forkHead = row.pr.fromFork ? { repoId: draft.repoId, branch: named, owner: row.pr.headOwner } : null;
    }
    if (draft.branchMode !== "detached") {
      draft.branchMode = choiceMode(choice);
    }
    closeList();
    nameInput.focus();
    // Picking a row settles the name in one action — there is no keystroke
    // after it for a `change` event to ride.
    syncDerived(true);
  }

  /** How many entries the note names before it summarises the rest. */
  const RECOVER_ENTRY_CAP = 6;

  /**
   * State the offer, and what accepting it would remove.
   *
   * The list is the one the AUTHORIZATION was digested over, so what is shown
   * and what is bound cannot differ — a list read separately for display would
   * be a second answer to the question the token already answered.
   */
  function renderRecover(): void {
    const offer = debrisOffer();
    if (offer === null) {
      recoverField.hidden = true;
      recoverNote.hidden = true;
      recoverNote.textContent = "";
      recoverBox.checked = false;
      return;
    }
    recoverField.hidden = false;
    recoverBox.checked = recoverWanted;
    recoverText.textContent = `Recover ${lastSegment(offer)} — clear this directory and create here.`;
    const note =
      recoverRefused ??
      (recoverAsked !== null
        ? "Reading what is there…"
        : recoverGrant !== null && recoverGrant.path === offer
          ? recoverGrant.entries.length === 0
            ? `Removes ${offer}, which is empty.`
            : `Removes ${recoverGrant.entries.length} item(s) from ${offer}: ${listed(recoverGrant.entries)}`
          : `${offer} is not a git checkout. Accepting clears it before the worktree is created.`);
    recoverNote.hidden = false;
    // `textContent`, not markup: these are directory names off the user's disk.
    recoverNote.textContent = note;
  }

  /** The first few names, and a count for the rest — a capped list never reads as the whole set. */
  function listed(entries: readonly string[]): string {
    const shown = entries.slice(0, RECOVER_ENTRY_CAP).join(", ");
    const rest = entries.length - RECOVER_ENTRY_CAP;
    return rest > 0 ? `${shown} and ${rest} more.` : `${shown}.`;
  }

  /**
   * Re-derive the path and its hint from the branch, and re-validate. The hint
   * names the collided path AND the suffixed one the create will actually use —
   * showing only the pretty default would be a claim the form cannot keep.
   */
  function syncDerived(settled = false): void {
    const repo = currentRepo();
    repoHint.textContent = repo.mainPath;
    syncBringOver(repo.provisioning);

    const detached = draft.branchMode === "detached";
    nameInput.disabled = detached;
    nameInput.placeholder = draft.branchMode === "existing" ? "existing-branch" : "feat/…";
    baseInput.placeholder = detached ? "a ref to detach at" : "HEAD";
    // From `draft.branchMode` ALONE (D5), the same single-source rule the name
    // field already applies. The destination's disposition deliberately does
    // not enter into it: clearing the ground does not change where a new
    // branch starts (§ 2.1).
    const baseRefused = BASE_REFUSED_BY[draft.branchMode];
    baseInput.disabled = baseRefused !== undefined;
    baseNote.hidden = baseRefused === undefined;
    baseNote.textContent = baseRefused ?? "";
    const destRefused = DEST_REFUSED_BY[draft.branchMode];
    pathInput.disabled = destRefused !== undefined;
    pathNote.hidden = destRefused === undefined;
    pathNote.textContent = destRefused ?? "";
    if (destRefused !== undefined) {
      // WITHDRAWN, not merely ignored. Leaving the override standing would keep
      // it in `draft.path` and in the ask key, which is the split itself: the
      // form would submit the override while the mode carried the repair
      // target. The derivation below then refills the field with that target,
      // so the disabled control shows the directory actually being used.
      pathIsDerived = true;
    }
    // The host's verdict on the base, which only applies where a base applies.
    // Reported BEFORE submit rather than as a git failure after it (D7).
    const verdict = baseRefused === undefined ? effective?.baseValid : undefined;
    const baseUnresolvable = verdict !== undefined && verdict.ok === false;
    // Stated where the destination is, so it is legible without expanding the
    // Advanced body the base field lives in (round-1 W6).
    const actionText = baseUnresolvable
      ? (verdict as { ok: false; reason: string }).reason
      : detached
        ? // The mode the form will EXECUTE, not the one the answer carried. The
          // toggle discards the classification (D5), and the action note is a
          // statement of mode — leaving it on the answer's said a repair would
          // run while a detached create was submitted (round-6 B11).
          DETACHED_ACTION
        : effective === null
          ? undefined
          : ACTION_BY_MODE[effective.mode.kind];
    actionNote.hidden = actionText === undefined;
    actionNote.textContent = actionText ?? "";
    actionNote.classList.toggle("wt-dest-note--error", baseUnresolvable);
    // Said, rather than left to look complete: a capped list presented as the
    // repository's whole set is the one claim this control must not make. Both
    // lists are capped independently, and the pull requests were silent about it
    // (.reviews/round-1.md B3).
    const refsPartial = repo.refs?.truncated === true;
    const prsPartial = repo.pullRequests?.available === true && repo.pullRequests.truncated;
    partialNote.hidden = !refsPartial && !prsPartial;
    partialNote.textContent = partialListText(refsPartial, prsPartial);

    draft.branchName = nameInput.value;
    draft.baseRef = baseInput.value;

    // Only while it still describes THIS selection, on THIS repository, under a
    // mode that still uses the pull request as its source. Detached submits a
    // base and no branch at all, so the pull request is not what it creates
    // from and the statement would describe a different operation
    // (.reviews/round-1.md B2). Entering detached also CLEARS `forkHead`, which
    // is what stops the note coming back on the way out (round-2 B2); this
    // condition stays so the note is off under detached whatever set the state.
    const forkStated =
      forkHead !== null &&
      forkHead.repoId === draft.repoId &&
      forkHead.branch === nameInput.value.trim() &&
      draft.branchMode !== "detached"
        ? forkHead
        : null;
    forkNote.hidden = forkStated === null;
    // What is TRUE, not what would be convenient. Configuring the remote is a
    // repository-level write no part of this create performs (D5), and a
    // statement made to earn an authorization has to describe the create being
    // authorized (.reviews/round-1.md B1). So it states the requirement the fork
    // head carries and says plainly that this create does not meet it.
    forkNote.textContent =
      forkStated === null
        ? ""
        : `This pull request's head is on ${forkStated.owner}'s fork, so fetching that head requires a remote for ${forkStated.owner}. This create does not configure one.`;

    const slug = sanitizeBranchForPath(detached ? draft.baseRef : draft.branchName);
    // The HOST's answer wins whenever it has given one. The locally derived
    // path is the placeholder shape only — it is what the form would guess, and
    // guessing is exactly what the spec forbids: a create names the destination
    // it will actually use, and only the host knows which candidates are free
    // (round-3 B12).
    // The RESOLUTION's own path first: it answered the whole selection, and the
    // defaults reply answered only the branch (round-3 B3).
    // An accepted recover replaces it: clearing the ground is what makes the
    // skipped candidate available, so that — not the suffix — is where this
    // create lands, and the line has to say so before Create authorizes it.
    const recovered = settledDisposition() === undefined ? undefined : recoverGrant?.path;
    const answered = recovered ?? (effective === null ? undefined : targetOf(effective));
    const resolvedPath = answered ?? repo.resolvedPath;
    const derived = resolvedPath ?? (slug ? `${repo.pathParent}/${repo.pathPrefix}-${slug}` : "");
    if (pathIsDerived) {
      // Whoever owns the caret owns the text. Guarding the CALLERS was the
      // round-2 fix and it left the other eight unguarded by construction — the
      // answer callback arrives on the host's schedule, so it is the one that can
      // land while the user is mid-edit, and the characters they type next append
      // to a value they cannot see. The rule belongs at the write.
      if (document.activeElement !== pathInput) {
        pathInput.value = derived;
      }
    }
    pathInput.placeholder = `…/${repo.pathPrefix}-<branch>`;

    // The answer owns the destination once it lands, override or not: a supplied
    // path is the candidate the probe carried, and what the form states and
    // submits is what came back about it (D8). Before any answer there is only
    // the candidate, or the derived shape.
    const stated = answered ?? (pathIsDerived ? derived : supplied);
    // ONE value, read by the line and by the submission — the split between them
    // is what let a create display one directory and hand git another.
    draft.path = stated;
    if (stated) {
      destExact = stated;
      dest.setAttribute("aria-label", stated);
      destShort.textContent = shortPath(stated);
      destExactText.textContent = stated;
      dest.classList.remove("wt-dest--pending");
      ensureDestTip();
    } else {
      // Nothing is resolved yet, so nothing is claimed. The default SHAPE is not
      // a destination and is not shortened as though it were one.
      destExact = "";
      dest.removeAttribute("aria-label");
      destShort.textContent = `Defaults to …/${repo.pathPrefix}-<branch>`;
      destExactText.textContent = "";
      dest.classList.add("wt-dest--pending");
    }

    // One line, and it names the RESULT. The destination above already carries
    // the path, so repeating it in full here is the second statement the form
    // exists to stop making. An override retires the note with the derived path
    // it described.
    destNote.hidden = true;
    destNote.replaceChildren();
    // The candidate the suffixing SKIPPED, from the resolution that skipped it.
    // `collidedWith` is the defaults reply's answer to the narrower question,
    // and kept only until a resolution has spoken (round-3 B3).
    // Before any answer an override retires it: the defaults reply answered the
    // branch, and it knows nothing about the path the user then typed. Once the
    // answer lands the note is the whole point of an override — it is what says
    // the candidate was occupied and names what the create took instead.
    // An accepted recover retires it: the candidate is not being skipped any
    // more, and "so this is created as <suffix>" would name a path this create
    // no longer takes.
    const skipped =
      recovered !== undefined
        ? ""
        : effective === null
          ? pathIsDerived
            ? repo.collidedWith
            : ""
          : lastSegment(effective.occupiedCandidate?.path ?? "");
    if (skipped) {
      destNote.hidden = false;
      const taken = document.createElement("b");
      taken.textContent = skipped;
      // No leading `…`. The host sends a directory name, so there is nothing
      // elided to mark — and when this field still carried a whole path, the
      // marker shortened none of it (worktree-create.md § 4.2).
      destNote.append(taken, document.createTextNode(" already exists"));
      if (resolvedPath) {
        const final = document.createElement("b");
        final.textContent = lastSegment(resolvedPath);
        destNote.append(document.createTextNode(", so this is created as "), final, document.createTextNode("."));
      } else {
        destNote.append(document.createTextNode("; a free suffix is chosen when the worktree is created."));
      }
    }

    renderRecover();

    const heldBy = heldBranch();
    const error =
      heldBy !== undefined
        ? `${draft.branchName.trim()} is checked out in ${heldBy}`
        : detached
          ? undefined
          : deps.validateBranch?.(draft.branchName);
    draft.branchError = error;
    nameError.textContent = error ?? "";
    nameError.hidden = !error;
    nameInput.classList.toggle("is-invalid", Boolean(error));
    if (error) {
      nameInput.setAttribute("aria-invalid", "true");
    } else {
      nameInput.removeAttribute("aria-invalid");
    }

    // Asked here, before the button state below reads `outstanding` — a request
    // raised after it would leave Create enabled for one render on a path the
    // host has not resolved yet.
    //
    // Only on a SETTLED edit. `syncDerived` runs per keystroke to keep the form
    // responsive, and asking from there made this a request per character
    // despite the comment on `edited` promising otherwise (round-3 B6). The
    // drift guard below is what makes waiting safe.
    if (settled) {
      askForDestination();
    }
    // The selection on screen is not the one the host answered about. Between a
    // keystroke and the edit settling that is the normal state, and submitting
    // in it would submit against a classification for different text.
    const unasked = deps.onSelectionChange !== undefined && askKey(selection()) !== askedFor;

    // A create with no target is not offered — the button is disabled, not a
    // dialog that fails after the click.
    const named = detached ? draft.baseRef.trim().length > 0 : draft.branchName.trim().length > 0;
    // `outstanding`: the destination on screen is not yet the one the host
    // resolved for this branch, so submitting now submits a stale path.
    // A revealed posture list with nothing selected is an unmade choice, not a
    // default — submitting here would launch under a posture the user never
    // picked, which is the whole point of never preselecting one.
    const postureMissing = afterChoice === "agent" && agentBox.needsPosture();
    createBtn.disabled =
      Boolean(error) ||
      heldBy !== undefined ||
      !named ||
      draft.path.trim().length === 0 ||
      outstanding ||
      unasked ||
      resolutionOutstanding ||
      // The user accepted a removal and the host has not said what it would
      // remove. Submitting here would submit a recover with no authorization,
      // which the host refuses — so the form waits instead of failing after.
      recoverAsked !== null ||
      baseUnresolvable ||
      postureMissing;
    shell.refreshFocusTrap();
  }

  // `change` rather than `input`: asking the host on every keystroke would be a
  // request per character. `input` still re-renders locally, so the field never
  // feels laggy — only the authoritative destination waits for the edit to settle.
  const edited = (): void => {
    syncDerived(true);
  };
  nameInput.addEventListener("input", () => {
    // Typing re-decides what the text MEANS, on the same rule the ordering
    // states: an exact match is the branch the user named, anything else is a
    // branch they are about to create.
    deriveChoice();
    openList();
    syncDerived();
  });
  nameInput.addEventListener("change", edited);
  nameInput.addEventListener("blur", () => {
    closeList();
    syncDerived(true);
  });
  nameInput.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      if (!listOpen) {
        openList();
      }
      if (choices.length > 0) {
        const step = ev.key === "ArrowDown" ? 1 : -1;
        setActive((activeAt + step + choices.length) % choices.length);
      }
      return;
    }
    // Enter takes the ACTIVE row while the list is open, and otherwise falls
    // through to the form — a listbox that swallowed Enter with nothing active
    // would make the keyboard path unable to submit at all.
    if (ev.key === "Enter" && listOpen && activeAt >= 0) {
      ev.preventDefault();
      commit(activeAt);
    }
  });
  baseInput.addEventListener("input", () => syncDerived());
  baseInput.addEventListener("change", edited);
  pathInput.addEventListener("change", edited);
  pathInput.addEventListener("input", () => {
    // Clearing the field is not an override of "nowhere" — it is withdrawing the
    // override. One-way, the face showed a derivation that had been switched off
    // and Create was disabled with the explaining control behind the disclosure.
    pathIsDerived = pathInput.value.trim() === "";
    supplied = pathInput.value;
    syncDerived();
  });
  shell.dialog.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      submit();
    }
  });

  // A fresh answer replaces the repo's seed and re-renders. Only the path the
  // user has not typed over moves — an edited path is theirs.
  deps.bindDefaults?.((next) => {
    // Replies race the typing that produced them. An answer for a branch the
    // form has already moved past would put a destination on screen that no
    // longer matches the name beside it (round-4 B12).
    // Compared against the key the question was asked under, so an answer for the
    // right branch but the wrong repository is discarded like any other stale one.
    if (next.answersBranch !== undefined && `${next.repoId}\u0000${next.answersBranch}` !== defaultsAskedFor) {
      return;
    }
    const at = repos.findIndex((r) => r.repoId === next.repoId);
    if (at >= 0) {
      // The DESTINATION is what was asked for, and the only part of the answer
      // this dialog may take. `createRepos()` stamps the panel's live agent list
      // into every answer, and the host answers per keystroke — splicing the
      // record wholesale would relabel the user's choice as they type, and
      // `A launch is submitted as the offer it was shown` says a dialog submits
      // what it was OPENED against. An earlier fix here took the whole record
      // and did exactly that; keeping the agents is what makes the refresh safe.
      const opened = repos[at];
      repos[at] = opened === undefined ? next : { ...next, agents: opened.agents };
    } else {
      repos.push(next);
    }
    outstanding = false;
    syncDerived();
  });

  // The offer's own channel. It redraws the section and touches nothing else —
  // in particular not `outstanding`, which is the destination's gate (B4).
  deps.bindProvisioning?.((repoId, offer) => {
    const at = repos.findIndex((r) => r.repoId === repoId);
    const opened = repos[at];
    if (at < 0 || opened === undefined) {
      return;
    }
    repos[at] = { ...opened, provisioning: offer };
    if (repoId === draft.repoId) {
      syncBringOver(offer);
    }
  });

  // The branch list's own channel, on the same terms: it touches `outstanding`
  // no more than the offer does. Stored here and rendered by the combobox.
  // Indexed once. A linear scan per reply is O(repos²) across a workspace's
  // answers — the shape round-1 S1 named on the destination channel (W3).
  const repoAt = new Map(repos.map((r, at) => [r.repoId, at]));
  // Its own channel, and deliberately not folded into `bindRefs`: the whole
  // point of the separate message is that the local list never waits for the
  // forge (§ 4.1), and one binding would put them back on one arrival.
  deps.bindPullRequests?.((repoId, offer) => {
    if (closed) {
      return;
    }
    const at = repoAt.get(repoId);
    const opened = at === undefined ? undefined : repos[at];
    if (at === undefined || opened === undefined) {
      return;
    }
    repos[at] = { ...opened, pullRequests: offer };
    if (repoId !== draft.repoId) {
      return;
    }
    if (listOpen) {
      renderList();
    }
    // The partial notice has exactly one writer, and this is the path the forge
    // actually takes — the seeded offer was the only one that ever reached it
    // (.reviews/round-2.md B3). Unsettled, as `bindRefs` leaves it: an answer
    // arriving is not the user finishing an edit, and the destination gate is
    // not this callback's to arm.
    syncDerived();
  });
  deps.bindRefs?.((repoId, refs) => {
    if (closed) {
      return;
    }
    const at = repoAt.get(repoId);
    const opened = at === undefined ? undefined : repos[at];
    if (at === undefined || opened === undefined) {
      return;
    }
    repos[at] = { ...opened, refs };
    if (repoId !== draft.repoId) {
      return;
    }
    // A list that lands while the user has already typed re-decides what the
    // typed text means — in both directions, which is why it goes through the
    // one derivation rather than upgrading in place (B2).
    deriveChoice();
    if (listOpen) {
      renderList();
    }
    syncDerived();
  });

  // What the create would DO, on its own channel — and, since the resolution
  // now owns the destination it names, an answer to the same question the
  // defaults reply answers (round-3 B3).
  deps.bindResolution?.((resolution) => {
    if (closed || resolution.repoId !== draft.repoId) {
      return;
    }
    // An answer the user has typed past describes a selection that is gone.
    // This is what `query` echoes for — the token separates two OPENINGS, and
    // only this separates two edits within one (design.md D1).
    // Under detached the selection's branch is the REF, so that is what the echo
    // is compared against — the branch field is not what was asked about.
    const detached = draft.branchMode === "detached";
    if (resolution.query.trim() !== (detached ? baseInput.value : nameInput.value).trim()) {
      return;
    }
    // `adopt` is reported so the resolver can name the state it found; the form
    // does not offer it, and WT-012.15 is where it becomes an action. Until
    // then it behaves as the fresh it falls back to.
    // Every mode, not only `reattach`. Dropping the others left `fresh`,
    // `reuse` and `adopt` on whatever the local text derivation last guessed,
    // so a declined corroboration kept the form armed for a repair the host had
    // just withdrawn (round-1 B3).
    effective = resolution;
    resolutionOutstanding = false;
    // It carries `freePath`, which is the destination the form states and
    // submits, so this answer settles the destination question too.
    outstanding = false;
    // Detached is the user's own toggle and outranks a classification of the
    // typed text: the resolution answers "what is this branch name", and under
    // detached the field is not a branch name at all. It outranks the MODE and
    // nothing else — the answer's destination is no less true for the toggle
    // being on, and discarding it wholesale left a detached create offered
    // against a destination nobody had resolved (D5, round-5 B10).
    switch (detached ? "detached" : resolution.mode.kind) {
      case "detached":
        break;
      case "reattach":
        draft.branchMode = "reattach";
        break;
      case "reuse":
        draft.branchMode = "existing";
        break;
      // `adopt` is reported so the resolver can name the state it found; the
      // form does not offer it, and WT-012.15 is where it becomes an action.
      // Until then it behaves as the fresh it falls back to.
      case "adopt":
      case "fresh":
        draft.branchMode = "new";
        break;
    }
    // Settled, because applying a resolution can CHANGE the selection: a mode
    // that refuses the destination withdraws the override, and the form must
    // ask about the selection it now holds rather than sit behind a gate for a
    // question nobody will ask. It converges — the second answer withdraws
    // nothing further, so the key is stable (round-4 B3).
    syncDerived(true);
  });

  // The answer to the ONE request the acceptance sent. Anything about another
  // directory is dropped rather than applied: an authorization is bound to a
  // path, and applying one issued for a different path is exactly the confusion
  // the fingerprint exists to stop.
  deps.bindDebrisAuthorization?.((answer) => {
    if (closed || answer.repoId !== draft.repoId) {
      return;
    }
    const offer = debrisOffer();
    // THIS request, not merely some request for this path. Accept, withdraw and
    // accept again asks twice inside one opening, and the first answer arriving
    // late would otherwise satisfy the second with a reading that request never
    // made (round-1 W2, round-2 W2).
    if (offer === null || recoverAsked === null || answer.ask !== recoverAsked || answer.path !== offer) {
      return;
    }
    recoverAsked = null;
    if (answer.granted) {
      recoverGrant = { path: answer.path, authorization: answer.authorization, entries: answer.entries };
      recoverRefused = null;
    } else {
      // Not debris, or unreadable — either way there is nothing to authorize,
      // so the acceptance is withdrawn and the create falls back to the suffix.
      recoverGrant = null;
      recoverWanted = false;
      recoverRefused =
        answer.because === "notDebris"
          ? "That directory holds a repository, so it will not be cleared."
          : "That directory could not be read, so it will not be cleared.";
    }
    syncDerived();
  });

  syncOpenAfter();
  shell.focusInitial(nameInput);

  return disposeAll;
}
