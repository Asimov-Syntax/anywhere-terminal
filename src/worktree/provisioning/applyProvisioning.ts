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

import type { ProvisionEntry, ProvisionStepResult } from "../../types/messages";
import type { ResolvedPathInsideDeps } from "../../utils/resolvedPathBoundary";
import { type ApplyBudget, type ApplyFsDeps, applyEntry } from "./applyEntries";
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

/** A set of selected declarations that may name one destination, and the repository's own. */
interface Contest {
  readonly favoured: ProvisionEntry;
  readonly held: readonly ProvisionEntry[];
}

/** How this names the other side of a dispute in a reason a person reads. */
const declaredAs = (entry: ProvisionEntry): string => `${entry.path} (declared in ${entry.source})`;

/**
 * The contests among the entries the create actually carried.
 *
 * Recomputed rather than carried on the wire (design.md D1): the offer's own
 * groups answered a question about every offered row, and the user has since
 * unticked some of them. A group with no favoured member left is not a contest
 * — nothing in it claims priority — so its members are applied as they are.
 */
function contestsOf(entries: readonly ProvisionEntry[]): Contest[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const contests: Contest[] = [];
  for (const group of contendersOf(entries, NATIVE_PROVIDER_FILE)) {
    const favoured = group.favoured === undefined ? undefined : byId.get(group.favoured);
    if (favoured === undefined) {
      continue;
    }
    const held = group.members
      .filter((id) => id !== favoured.id)
      .map((id) => byId.get(id))
      .filter((entry): entry is ProvisionEntry => entry !== undefined);
    if (held.length > 0) {
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
 */
type Reading = "absent" | "present" | "unreadable" | "inadmissible";

const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code;

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
): Promise<ProvisionStepResult[]> {
  const answered = new Map<ProvisionEntry, ProvisionStepResult>();
  const step = (entry: ProvisionEntry, reason: string): ProvisionStepResult => ({
    id: entry.id,
    path: entry.path,
    outcome: { kind: "refused", reason },
  });

  /**
   * Observe one member's destination — the fact, not its contents.
   *
   * The gate owns where an entry lands, so this asks it rather than resolving
   * the path a second way.
   */
  const read = async (entry: ProvisionEntry): Promise<Reading> => {
    const admitted = await admitEntry(entry, roots, deps);
    if (!admitted.ok) {
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
  const contended = (readings: readonly Reading[]): boolean => readings.some((reading) => reading !== "absent");

  /** Refuse every member that is still claiming, naming the whole contest. */
  const refuseContest = async (contest: Contest, why: string): Promise<void> => {
    const members = [contest.favoured, ...contest.held];
    for (const member of members) {
      if (answered.has(member)) {
        continue;
      }
      answered.set(member, step(member, `${members.map(declaredAs).join(", ")} ${why}`));
    }
  };

  const contests = contestsOf(entries);
  const held = new Map<ProvisionEntry, Contest>();
  const live = new Map<ProvisionEntry, Contest>();

  // BEFORE the ordered pass, so what it reads is what was already in the
  // worktree rather than what this apply has since written (design.md D3).
  for (const contest of contests) {
    const members = [contest.favoured, ...contest.held];
    if (contended(await Promise.all(members.map(read)))) {
      // The whole group, not only the loser: leaving the favoured member to run
      // would merge it into a destination it did not create — `makeDirectory`
      // answers `written` for an existing directory — installing neither its
      // material nor its mode, while only the loser was reported.
      await refuseContest(contest, "may name this same destination, and it could not be shown to be free before the apply began");
      continue;
    }
    live.set(contest.favoured, contest);
    for (const member of contest.held) {
      held.set(member, contest);
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
      const members = [contest.favoured, ...contest.held];
      if (contended(await Promise.all(members.map(read)))) {
        await refuseContest(contest, "may name this same destination, and it could not be shown to be free at this entry own turn");
        for (const member of contest.held) {
          held.delete(member);
        }
        continue;
      }
    }
    answered.set(entry, await applyEntry(entry, roots, budget, deps));
  }

  // The held members, once the favoured one has had its ordinary turn. A
  // deferred copy starves nothing: a link entry points OUT of the worktree, and
  // a symlink recreated inside a copied tree resolves within that tree.
  for (const [member, contest] of held) {
    if (answered.has(member)) {
      continue;
    }
    const claimed = answered.get(contest.favoured)?.outcome.kind;
    if (claimed !== "copied" && claimed !== "linked" && claimed !== "degradedToCopy") {
      const unclaimed = `${declaredAs(contest.favoured)} may name this same destination and did not claim it`;
      answered.set(member, step(member, unclaimed));
      continue;
    }
    if ((await read(member)) !== "absent") {
      // It may be the favoured member's own material under a folded name, a
      // descendant another entry's directory copy wrote, or a name another
      // process created — and nothing here tells those apart. Reporting it as
      // awarded would claim a causal fact this apply cannot establish
      // (design.md D4).
      const unattributable = `${declaredAs(contest.favoured)} may name this same destination, and what is there now was not put there by this apply`;
      answered.set(member, step(member, unattributable));
      continue;
    }
    answered.set(member, await applyEntry(member, roots, budget, deps));
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
  return produced;
}
