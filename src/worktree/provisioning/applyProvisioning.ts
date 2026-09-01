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
 * Apply every selected entry, and answer for every one of them.
 *
 * The answer is in the order the entries ARRIVED, not the order they ran: the
 * dialog reads it beside the rows it drew. `applyEntry` never throws, so this
 * has no failure of its own to report.
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

  /** Where an entry lands, asked of the one gate that owns the answer. */
  const destinationOf = async (entry: ProvisionEntry): Promise<string | null> => {
    const admitted = await admitEntry(entry, roots, deps);
    return admitted.ok ? admitted.destination : null;
  };

  /** Present, not its contents. `undefined` for a destination the gate refuses. */
  const present = async (entry: ProvisionEntry): Promise<boolean | undefined> => {
    const destination = await destinationOf(entry);
    if (destination === null) {
      return undefined;
    }
    try {
      await deps.lstat(destination);
      return true;
    } catch {
      return false;
    }
  };

  const contests = contestsOf(entries);
  const held = new Map<ProvisionEntry, Contest>();

  // BEFORE the ordered pass, so what it reads is what was already there rather
  // than what this apply has since written (design.md D3). `EEXIST` cannot make
  // the distinction: `makeDirectory` answers `written` for a directory that was
  // already there and the walk then merges into it.
  for (const contest of contests) {
    const members = [contest.favoured, ...contest.held];
    const readings = await Promise.all(members.map(present));
    if (readings.some((reading) => reading === true)) {
      // The whole group, not only the loser: leaving the favoured member to run
      // would merge it into a destination it did not create and install neither
      // its material nor its mode, while only the loser was reported.
      for (const member of members) {
        const others = members
          .filter((other) => other !== member)
          .map(declaredAs)
          .join(", ");
        const already = `${others} may name this same destination, and something was already there`;
        answered.set(member, step(member, already));
      }
      continue;
    }
    for (const member of contest.held) {
      held.set(member, contest);
    }
  }

  for (const entry of copiesFirst(entries)) {
    if (answered.has(entry) || held.has(entry)) {
      continue;
    }
    answered.set(entry, await applyEntry(entry, roots, budget, deps));
  }

  // The held members, once the favoured one has had its ordinary turn. A
  // deferred copy starves nothing: a link entry points OUT of the worktree, and
  // a symlink recreated inside a copied tree resolves within that tree.
  for (const [member, contest] of held) {
    const claimed = answered.get(contest.favoured)?.outcome.kind;
    if (claimed !== "copied" && claimed !== "linked" && claimed !== "degradedToCopy") {
      const unclaimed = `${declaredAs(contest.favoured)} may name this same destination and did not claim it`;
      answered.set(member, step(member, unclaimed));
      continue;
    }
    if ((await present(member)) !== false) {
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

  return entries.map(
    (entry) =>
      answered.get(entry) ?? {
        id: entry.id,
        path: entry.path,
        outcome: { kind: "failed" as const, reason: "this entry was never applied" },
      },
  );
}
