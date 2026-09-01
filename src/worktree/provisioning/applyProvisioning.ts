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
import type { EntryGateRoots } from "./entryGate";

/**
 * Copy before link, whatever order the provider listed them in
 * (worktree-apply.md § 1).
 *
 * A link is only ever to material the copy pass may have just put there, so
 * this is a prerequisite rule rather than a precedence one.
 */
function copiesFirst(entries: readonly ProvisionEntry[]): ProvisionEntry[] {
  return [...entries].sort((a, b) => Number(a.mode === "link") - Number(b.mode === "link"));
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
  for (const entry of copiesFirst(entries)) {
    answered.set(entry, await applyEntry(entry, roots, budget, deps));
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
