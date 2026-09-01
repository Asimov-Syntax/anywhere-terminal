// src/worktree/provisioning/asimovProvider.ts — Read `asimov/worktree.yaml`
// into the normalized model (worktree-provisioning.md § 3.1).
//
// What is left here is what is true of THIS provider only: its file name, its
// four keys, and how a YAML mapping becomes rows. Containment, the budget, glob
// expansion and problem reporting moved to `providerKit.ts` when the second and
// third adapters arrived — three copies of a containment rule is three chances
// for one of them to drift (design.md D2).
//
// Nothing in this module writes. It reads the provider file and, for a glob,
// the directory that glob names — and every path it touches is checked for
// containment first.

import { parse as parseYaml } from "yaml";
import type { ProvisionModel } from "../../types/messages";
import {
  type Draft,
  emptyModel,
  ids,
  modelFromDraft,
  newBudget,
  newDraft,
  type OpenedProviderFile,
  openProviderFile,
  type ProviderAdapter,
  type ProviderBudget,
  type ProviderContext,
  type ProviderDeps,
  problem,
  readInlineKeys,
} from "./providerKit";

/** Repo-relative, POSIX. The one file this adapter reads. */
export const ASIMOV_PROVIDER_FILE = "asimov/worktree.yaml";

/** The kit's dependencies, under this adapter's original name. */
export type AsimovProviderDeps = ProviderDeps;

// The budgets belong to the kit now, but they are part of this module's
// published surface and its suite asserts against them by name.
export { MAX_MODEL_ROWS, MAX_SCAN } from "./providerKit";

const ASIMOV: ProviderContext = { id: "asimov", file: ASIMOV_PROVIDER_FILE };

/** The four keys § 3.1 maps. Anything else is reported rather than ignored. */
const KNOWN_KEYS = new Set(["copy", "link", "ports", "setup"]);

const PROVIDERS = [{ id: "asimov" as const, files: [ASIMOV_PROVIDER_FILE], active: true }];

/**
 * The repository's own provisioning file, as the normalized model.
 *
 * Fails OPEN by design: a file that is absent, unreadable or malformed yields a
 * model plus a `problems[]` entry, never a throw. § 9 keeps the create enabled —
 * a broken provisioning config is not a reason to refuse to make a worktree,
 * and nothing executes from this model in this change anyway.
 */
export async function readAsimovProvisioning(deps: AsimovProviderDeps, repoRoot: string): Promise<ProvisionModel> {
  const opened = await openProviderFile(deps, repoRoot, ASIMOV);
  if (opened.kind === "absent") {
    // No provider file is not a problem — it is the ordinary case for most
    // repositories, and the section says what the worktree will lack anyway.
    return emptyModel();
  }
  return fromOpened(opened, deps, repoRoot, newBudget());
}

export const asimovAdapter: ProviderAdapter = {
  id: "asimov",
  files: [ASIMOV_PROVIDER_FILE],

  /**
   * `null` for an absent file and a model for every other outcome.
   *
   * The distinction the plain reader does not make: it answers an empty model
   * for a file that is not there AND for one that declares nothing, which are
   * the same section but not the same detection answer. Falling through a
   * present-but-empty file would offer another tool's answer to a question this
   * repository has already answered (design.md D3).
   */
  async read(deps: ProviderDeps, repoRoot: string, budget: ProviderBudget): Promise<ProvisionModel | null> {
    const opened = await openProviderFile(deps, repoRoot, ASIMOV);
    if (opened.kind === "absent" || (opened.kind === "problem" && opened.at === "root")) {
      return null;
    }
    return fromOpened(opened, deps, repoRoot, budget);
  },
};

/**
 * Everything after the file has been authorized and opened.
 *
 * Split out so the adapter and the plain reader each open the file exactly once
 * and then agree on every other outcome — a second open is a second chance for
 * the file to change under the check.
 */
async function fromOpened(
  opened: Exclude<OpenedProviderFile, { kind: "absent" }>,
  deps: ProviderDeps,
  repoRoot: string,
  budget: ProviderBudget,
): Promise<ProvisionModel> {
  if (opened.kind === "problem") {
    // A root that will not resolve is not this provider being present, so it is
    // the one problem reported without a providers row.
    return {
      ...emptyModel(),
      ...(opened.at === "root" ? {} : { providers: PROVIDERS }),
      problems: [opened.problem],
    };
  }
  const root = opened.root;

  let parsed: unknown;
  try {
    parsed = parseYaml(opened.text);
  } catch (error) {
    return {
      ...emptyModel(),
      providers: PROVIDERS,
      problems: [problem(ASIMOV, "malformed", error instanceof Error ? error.message : String(error))],
    };
  }
  if (parsed === null || parsed === undefined) {
    return { ...emptyModel(), providers: PROVIDERS };
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ...emptyModel(),
      providers: PROVIDERS,
      problems: [problem(ASIMOV, "malformed", "The file is not a mapping of keys.")],
    };
  }

  const nextId = ids();
  const draft: Draft = newDraft(ASIMOV, budget);
  await readInlineKeys(parsed as Record<string, unknown>, KNOWN_KEYS, repoRoot, root, deps, nextId, draft);

  // `providers` is the one field this reader owns: `readAsimovProvisioning` is
  // WT-012.1's single-source entry point and still answers for itself, while the
  // adapter's copy is replaced by the dispatcher.
  return { ...modelFromDraft(draft), providers: PROVIDERS };
}
