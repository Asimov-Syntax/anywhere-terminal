// src/worktree/provisioning/applyProvisioning.ts — the order the selected
// entries are applied in, and the claim discipline over a destination two of
// them may both name.
//
// Extracted from the `applyProvision` lambda in `src/extension.ts`, which held
// the copy-before-link sort and the per-entry loop inside a closure in the
// activation path (design.md D5). A rule nothing can call is a rule nothing can
// test, and this one is about which declaration wins a destination.
//
// Nothing here deletes, truncates or overwrites. `ApplyFsDeps` offers no
// primitive that could.

import type { ProvisionEntry, ProvisionResultContest, ProvisionStepResult } from "../../types/messages";
import type { ResolvedPathInsideDeps } from "../../utils/resolvedPathBoundary";
import { type ApplyBudget, type ApplyFsDeps, applyEntry, applyExclusiveEntry, CLAIM_LOST } from "./applyEntries";
import { admitEntry, type EntryGateRoots } from "./entryGate";
import { NATIVE_PROVIDER_FILE } from "./nativeProvider";
import { contendersOf } from "./providerKit";

/**
 * Copy before link, whatever order the provider listed them in
 * (worktree-apply.md § 1).
 *
 * A link is only ever to material the copy pass may have just put there, so
 * this is a prerequisite rule rather than a precedence one. Nothing is ever
 * promoted OUT of this order: a favoured link moved ahead of the copy pass
 * gives an uncontested copy beneath its name a refusal it never had
 * (design.md D2).
 */
function copiesFirst(entries: readonly ProvisionEntry[]): ProvisionEntry[] {
  return [...entries].sort((a, b) => Number(a.mode === "link") - Number(b.mode === "link"));
}

/** What the apply answers with: a step per entry, and each contest named once. */
export interface ApplyProvisioningResult {
  readonly steps: readonly ProvisionStepResult[];
  readonly contests: readonly ProvisionResultContest[];
}

/** A set of selected declarations that may name one destination, and the repository's own. */
interface Contest {
  /**
   * Absent when more than one member is the repository's own: priority is
   * claimed twice, nothing available can choose between them, and the group is
   * refused entire rather than left to the ordinary pass (design.md D3b).
   */
  readonly favoured: ProvisionEntry | undefined;
  readonly held: readonly ProvisionEntry[];
}

/** Every member of a contest, favoured first when it has one. */
const membersOf = (contest: Contest): readonly ProvisionEntry[] =>
  contest.favoured === undefined ? contest.held : [contest.favoured, ...contest.held];

/** What the report needs to name one member: never the entry itself. */
const memberOf = (entry: ProvisionEntry) => ({ id: entry.id, path: entry.path, source: entry.source });

/**
 * The contests among the entries the create actually carried.
 *
 * Recomputed rather than carried on the wire (design.md D1): the offer's own
 * groups answered a question about every offered row, and the user has since
 * unticked some of them. A group with no favoured member left is not a contest
 * — nothing in it claims priority — so its members are applied as they are,
 * UNLESS priority was claimed twice, which is the opposite state (design.md
 * D3b).
 */
function contestsOf(entries: readonly ProvisionEntry[]): Contest[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const contests: Contest[] = [];
  for (const group of contendersOf(entries, NATIVE_PROVIDER_FILE)) {
    const favoured = group.favoured === undefined ? undefined : byId.get(group.favoured);
    if (favoured === undefined && group.priorityClaimedTwice !== true) {
      continue;
    }
    const held = group.members
      .filter((id) => id !== favoured?.id)
      .map((id) => byId.get(id))
      .filter((entry): entry is ProvisionEntry => entry !== undefined);
    // A group refused entire is a contest of its own members; one with a
    // favoured row needs someone for it to be weighed against.
    if (favoured === undefined ? held.length > 1 : held.length > 0) {
      contests.push({ favoured, held });
    }
  }
  return contests;
}

/**
 * What one observation of a destination established (design.md D3).
 *
 * Not a boolean. Collapsing `unreadable` into `absent` lets a transient
 * `EACCES` authorize the write path after failing to prove the destination
 * free, and collapsing `inadmissible` into `present` reports a collision
 * nobody observed while discarding the refusal the gate actually had
 * (.reviews/round-1.md F002).
 *
 * `refused` and `inadmissible` are both gate refusals and are NOT the same
 * reading (design.md D3a). Only `inadmissible` reached the filesystem, so only
 * it leaves the destination unproven; `refused` is a fact about this member's
 * own name or mode and says nothing about the destination at all
 * (.reviews/round-6.md OOB-F016).
 */
type Reading = "absent" | "present" | "unreadable" | "inadmissible" | "refused";

const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code;

/**
 * The contest index of every member, by entry id.
 *
 * One map for both the ordinary pass and the failure path below, so a member's
 * index cannot be right in one and absent in the other.
 */
function indexByMember(contests: readonly Contest[]): Map<string, number> {
  const at = new Map<string, number>();
  for (const [index, contest] of contests.entries()) {
    for (const member of membersOf(contest)) {
      at.set(member.id, index);
    }
  }
  return at;
}

/** The contests as the wire carries them: membership once, per contest. */
const wireContests = (contests: readonly Contest[]): ProvisionResultContest[] =>
  contests.map((contest) => ({ members: membersOf(contest).map(memberOf) }));

/**
 * Every entry failed, for one reason that is nothing to do with any entry.
 *
 * The caller that could not read the worktree at all still owes the dialog the
 * same structured answer the ordinary path gives: a contested declaration is in
 * a contest whether or not the apply ever got far enough to have an opinion
 * about it, and a step with no `contest` tells the renderer the row is
 * unrelated to the dispute it is displaying (.reviews/round-5.md F011).
 *
 * Built here rather than at the call site because `contestsOf` is the only
 * definition of which entries are contesting, and a second one in the error
 * path is the drift this module exists to prevent.
 */
export function failEveryEntry(entries: readonly ProvisionEntry[], reason: string): ApplyProvisioningResult {
  const contests = contestsOf(entries);
  const at = indexByMember(contests);
  return {
    steps: entries.map((entry) => {
      const contest = at.get(entry.id);
      return {
        id: entry.id,
        path: entry.path,
        outcome: { kind: "failed" as const, reason },
        ...(contest === undefined ? {} : { contest }),
      };
    }),
    contests: wireContests(contests),
  };
}

/**
 * Apply every selected entry, and answer for every one of them.
 *
 * The answer is in the order the answers were PRODUCED — copies before links,
 * a deferred contest member where it was settled — which is what the closure
 * this replaced returned (design.md D5). The webview keys its provisioning
 * state off the whole sequence, so re-sorting it here would be a visible
 * change dressed as a refactor (.reviews/round-1.md F003). `applyEntry` never
 * throws, so this has no failure of its own to report.
 */
export async function applyProvisioning(
  entries: readonly ProvisionEntry[],
  roots: EntryGateRoots,
  budget: ApplyBudget,
  deps: ApplyFsDeps & ResolvedPathInsideDeps,
): Promise<ApplyProvisioningResult> {
  const answered = new Map<ProvisionEntry, ProvisionStepResult>();
  const contests = contestsOf(entries);
  const indexOf = new Map<Contest, number>(contests.map((contest, at) => [contest, at]));
  const step = (entry: ProvisionEntry, reason: string, contest?: Contest): ProvisionStepResult => ({
    id: entry.id,
    path: entry.path,
    outcome: { kind: "refused", reason },
    ...(contest === undefined ? {} : { contest: indexOf.get(contest) }),
  });

  /**
   * Observe one member's destination — the fact, not its contents.
   *
   * The gate owns where an entry lands, so this asks it rather than resolving
   * the path a second way.
   */
  /** The reason a member was refused for what it IS, until it can be answered. */
  const refusedItself = new Map<ProvisionEntry, string>();

  const read = async (entry: ProvisionEntry): Promise<Reading> => {
    const admitted = await admitEntry(entry, roots, deps);
    if (!admitted.ok) {
      if (!admitted.observedDestination) {
        refusedItself.set(entry, admitted.reason);
        return "refused";
      }
      return "inadmissible";
    }
    try {
      await deps.lstat(admitted.destination);
      return "present";
    } catch (error) {
      return codeOf(error) === "ENOENT" ? "absent" : "unreadable";
    }
  };

  /**
   * A contest whose destination nobody can prove free is refused, not written
   * into. Anything but `absent` — including a gate refusal, which reaches the
   * filesystem itself and so cannot be told apart from an unreadable
   * destination (`resolvedPathBoundary.ts:117-121`).
   */
  const contended = (readings: readonly Reading[]): boolean =>
    readings.some((reading) => reading !== "absent" && reading !== "refused");

  /** Refuse every member that is still claiming, naming the whole contest. */
  const refuseContest = async (contest: Contest, why: string): Promise<void> => {
    const members = membersOf(contest);
    for (const member of members) {
      if (answered.has(member)) {
        continue;
      }
      answered.set(member, step(member, why, contest));
    }
  };

  const held = new Map<ProvisionEntry, Contest>();
  const live = new Map<ProvisionEntry, Contest>();

  // BEFORE the ordered pass, so what it reads is what was already in the
  // worktree rather than what this apply has since written (design.md D3).
  for (const contest of contests) {
    if (contest.favoured === undefined) {
      // Priority claimed twice. Declaration order inside one file is not a
      // precedence the spec gives, and inventing one would decide a user's
      // config silently — so nothing is written and every member is named
      // (design.md D3b).
      await refuseContest(
        contest,
        "may name this same destination, and more than one of them is the repository's own declaration",
      );
      continue;
    }
    const members = membersOf(contest);
    if (contended(await Promise.all(members.map(read)))) {
      // The whole group, not only the loser: leaving the favoured member to run
      // would merge it into a destination it did not create — `makeDirectory`
      // answers `written` for an existing directory — installing neither its
      // material nor its mode, while only the loser was reported.
      await refuseContest(
        contest,
        "may name this same destination, and it could not be shown to be free before the apply began",
      );
      continue;
    }
    // A member refused for what it IS is refused ALONE, keeping the rule that
    // actually fired (D4b) decorated with its contest (D4a). The contest goes
    // on without it, so an admissible favoured member still claims a
    // destination no reading found present (design.md D3a).
    for (const member of members) {
      const reason = refusedItself.get(member);
      if (reason !== undefined) {
        answered.set(member, step(member, reason, contest));
      }
    }
    for (const member of contest.held) {
      if (!answered.has(member)) {
        held.set(member, contest);
      }
    }
    // A favoured member refused this way did not claim, which is D4 row 3 —
    // the held members are refused by the pass below, never written in its
    // place.
    if (!answered.has(contest.favoured)) {
      live.set(contest.favoured, contest);
    }
  }

  for (const entry of copiesFirst(entries)) {
    if (answered.has(entry) || held.has(entry)) {
      continue;
    }
    const contest = live.get(entry);
    if (contest !== undefined) {
      // AGAIN, immediately before this member's own turn. Between the reading
      // above and here, an earlier uncontested entry can have created the name
      // — a copy of `MixedCase/seed` has to create `MixedCase` — and the
      // favoured member would then merge into a destination an unrelated writer
      // owns while reporting that it claimed it (.reviews/round-1.md F001).
      const members = membersOf(contest);
      if (contended(await Promise.all(members.map(read)))) {
        await refuseContest(
          contest,
          "may name this same destination, and it could not be shown to be free at this entry own turn",
        );
        for (const member of contest.held) {
          held.delete(member);
        }
        continue;
      }
    }
    // A contested member claims its top-level destination exclusively. The
    // reading above says it was absent moments ago, so an `EEXIST` now is
    // another writer taking it, not material this apply may merge into
    // (.reviews/round-2.md F001).
    const applied =
      contest === undefined
        ? await applyEntry(entry, roots, budget, deps)
        : await applyExclusiveEntry(entry, roots, budget, deps);
    if (contest !== undefined && applied === CLAIM_LOST) {
      await refuseContest(
        contest,
        "may name this same destination, and it was taken before this entry could create it",
      );
      for (const member of contest.held) {
        held.delete(member);
      }
      continue;
    }
    const result = applied as ProvisionStepResult;
    // EVERY contested step points at its contest, whatever its outcome: the
    // favoured member that copied belongs to the dispute as much as the one
    // that lost it, and the type says the index is there when the step is a
    // member (`.reviews/round-1.md` F003 of this change). A refused one keeps
    // its own rule as well — D4a is about what a refusal says, not about which
    // one it is.
    answered.set(entry, contest === undefined ? result : { ...result, contest: indexOf.get(contest) });
  }

  // The held members, once the favoured one has had its ordinary turn — and
  // none of them is ever written.
  //
  // A held member's destination reading `absent` here looks like proof that
  // this volume keeps the two spellings apart. It is equally the signature of
  // the favoured member's just-written object being unlinked underneath the
  // apply: on a folding volume both spellings then read `ENOENT`, and writing
  // the held member there makes the INHERITED declaration the owner of the
  // destination this whole rule exists to give the repository's own. No
  // primitive tells those two states apart — rechecking and then writing is
  // not atomic, an open handle proves the object still exists but not that the
  // name still binds it, and checking afterwards is too late for an apply that
  // owns no deletion (.reviews/round-2.md F005, design.md D4).
  //
  // So it refuses. On a genuinely case-sensitive volume that costs the held
  // declaration its material, which is the price of never handing the
  // destination to the wrong one.
  for (const [member, contest] of held) {
    if (answered.has(member)) {
      continue;
    }
    // Every member, in every reason. A step result carries only its own path
    // and the notice renders `path: reason`, so a reason that names only the
    // counterparty leaves the user unable to tell which config files are in
    // dispute (.reviews/round-1.md F004).
    const claimed = contest.favoured === undefined ? undefined : answered.get(contest.favoured)?.outcome.kind;
    const why =
      claimed === "copied" || claimed === "linked" || claimed === "degradedToCopy"
        ? "may name this same destination, and it was claimed by the repository's own declaration"
        : "may name this same destination, and it was never claimed";
    answered.set(member, step(member, why, contest));
  }

  // Insertion order IS production order, and an entry that reached neither
  // pass still owes the dialog a row.
  const produced = [...answered.values()];
  for (const entry of entries) {
    if (!answered.has(entry)) {
      produced.push({
        id: entry.id,
        path: entry.path,
        outcome: { kind: "failed" as const, reason: "this entry was never applied" },
      });
    }
  }
  return { steps: produced, contests: wireContests(contests) };
}
