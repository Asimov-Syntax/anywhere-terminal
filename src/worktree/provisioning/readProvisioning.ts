// src/worktree/provisioning/readProvisioning.ts — Decide which of a
// repository's provisioning sources answers, and record the rest
// (worktree-provisioning.md § 4.1).
//
// Exactly one source supplies the rows. Two frameworks in one repository
// usually means one is being migrated away from, so unioning them would offer a
// setup command the user believes they retired — and hiding the loser would
// leave a repository looking as if it had never configured the tool it uses.
// One answers; the others are named and one click away (design.md D3, D5).

import type { ProvisionModel, ProvisionProvider } from "../../types/messages";
import { asimovAdapter } from "./asimovProvider";
import { orcaAdapter } from "./orcaProvider";
import { emptyModel, newBudget, openProviderFile, type ProviderAdapter, type ProviderDeps } from "./providerKit";
import { vscodeTasksAdapter } from "./vscodeTasksProvider";

/**
 * The order, as a module constant.
 *
 * Never a directory listing: an active source that depended on enumeration
 * order or on when a file happened to be written would offer a different
 * section to two users of the same repository. WT-012.4 inserts
 * `.vscode/worktree.json` at the front of this array, where § 4.1 puts it.
 */
export const DETECTION_ORDER: readonly ProviderAdapter[] = [asimovAdapter, orcaAdapter, vscodeTasksAdapter];

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
 * The model one source supplies, plus a row for every source that did not.
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
  let chosen: { adapter: ProviderAdapter; model: ProvisionModel } | null = null;
  const providers: ProvisionProvider[] = [];

  for (const adapter of adapters) {
    if (chosen === null) {
      const answer = await adapter.read(deps, repoRoot, budget);
      if (answer === null) {
        // Not here at all. The one answer that lets detection move on.
        continue;
      }
      chosen = { adapter, model: answer.model };
      providers.push({ id: adapter.id, files: [...adapter.files], active: true });
      continue;
    }
    // Detected and not chosen: named, so the section can offer to switch to it,
    // and contributing no row, so the shown list is one source's.
    if (await anyFilePresent(deps, repoRoot, adapter)) {
      providers.push({ id: adapter.id, files: [...adapter.files], active: false });
    }
  }

  if (chosen === null) {
    return emptyModel();
  }
  return { ...chosen.model, providers };
}
