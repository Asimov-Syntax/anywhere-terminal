// src/worktree/provisioning/orcaProvider.ts — Read a repository's orca
// configuration into the normalized model (worktree-provisioning.md § 3.2).
//
// One provider, two files: `orca.yaml` declares shared directories and a setup
// script, `.worktreeinclude` lists paths to copy. Either alone is a repository
// that uses orca, so either alone is a hit (design.md D3), and a row names
// whichever of the two asked for it (§ 4.3).
//
// This adapter records what the file SAYS, never what orca would then require
// of it: a shared directory that is not there is still offered, nothing checks
// gitignore, and a key orca uses for something else is not a misconfiguration
// (design.md D6).

import { parse as parseYaml } from "yaml";
import type { ProvisionModel } from "../../types/messages";
import {
  addSetup,
  type Draft,
  entriesFor,
  ids,
  modelFromDraft,
  newDraft,
  openProviderFile,
  type ProviderAdapter,
  type ProviderBudget,
  type ProviderContext,
  type ProviderDeps,
  problem,
  report,
} from "./providerKit";

export const ORCA_YAML_FILE = "orca.yaml";
export const ORCA_INCLUDE_FILE = ".worktreeinclude";

/** In read order. `providers[]` names both, per design.md D8. */
export const ORCA_PROVIDER_FILES: readonly string[] = [ORCA_YAML_FILE, ORCA_INCLUDE_FILE];

const YAML: ProviderContext = { id: "orca", file: ORCA_YAML_FILE };
const INCLUDE: ProviderContext = { id: "orca", file: ORCA_INCLUDE_FILE };

/**
 * `worktree.sharedDirectories` → link rows.
 *
 * Shared, so linked: the mode is the one the source itself gives the path, and
 * this key exists precisely so one directory is not copied per worktree.
 */
async function readSharedDirectories(
  record: Record<string, unknown>,
  deps: ProviderDeps,
  repoRoot: string,
  root: Parameters<typeof entriesFor>[3],
  nextId: () => string,
  draft: Draft,
): Promise<void> {
  const worktree = record.worktree;
  if (worktree === undefined) {
    return;
  }
  if (typeof worktree !== "object" || worktree === null || Array.isArray(worktree)) {
    report(draft, "`worktree`", problem(YAML, "malformed", "`worktree` must be a mapping."));
    return;
  }
  const declared = (worktree as Record<string, unknown>).sharedDirectories;
  if (declared === undefined) {
    return;
  }
  await entriesFor(declared, "link", repoRoot, root, deps, nextId, draft, "`worktree.sharedDirectories`");
}

/**
 * `scripts.setup` → exactly ONE step.
 *
 * A block scalar is one shell program and orca runs it as one, so splitting it
 * per line turns `if [ -f package.json ]; then / pnpm install / fi` into three
 * steps, two of them syntax errors alone (design.md D7). Conditionals, loops,
 * heredocs, line continuations and a `cd` the next line depends on all break the
 * same way. Trailing whitespace is trimmed and nothing else is touched.
 */
function readSetup(record: Record<string, unknown>, nextId: () => string, draft: Draft): void {
  const scripts = record.scripts;
  if (scripts === undefined) {
    return;
  }
  if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) {
    report(draft, "`scripts`", problem(YAML, "malformed", "`scripts` must be a mapping."));
    return;
  }
  const setup = (scripts as Record<string, unknown>).setup;
  if (setup === undefined) {
    return;
  }
  if (typeof setup !== "string") {
    report(draft, "`scripts.setup`", problem(YAML, "malformed", "`scripts.setup` must be a script."));
    return;
  }
  const script = setup.replace(/\s+$/, "");
  if (script === "") {
    return;
  }
  addSetup(draft, { id: nextId(), kind: "shell", script, source: ORCA_YAML_FILE });
}

/**
 * `.worktreeinclude` → copy rows, one per listed path.
 *
 * A blank line and a `#` comment are the file's own syntax rather than paths, so
 * they are dropped without a problem. Everything else goes through the kit,
 * which is what refuses a path escaping the repository and what expands a glob.
 */
async function readInclude(
  text: string,
  deps: ProviderDeps,
  repoRoot: string,
  root: Parameters<typeof entriesFor>[3],
  nextId: () => string,
  draft: Draft,
): Promise<void> {
  const declared = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  if (declared.length === 0) {
    return;
  }
  await entriesFor(declared, "copy", repoRoot, root, deps, nextId, draft, `\`${ORCA_INCLUDE_FILE}\``);
}

export const orcaAdapter: ProviderAdapter = {
  id: "orca",
  files: ORCA_PROVIDER_FILES,

  /**
   * Fails OPEN, like every adapter: a file that is unreadable or malformed
   * yields a model plus a problem, never a throw. `null` means neither of the
   * two files is there — the one answer that lets detection move on (D3).
   */
  async read(deps: ProviderDeps, repoRoot: string, budget: ProviderBudget): Promise<ProvisionModel | null> {
    const opened = await openProviderFile(deps, repoRoot, YAML);
    if (opened.kind === "problem" && opened.at === "root") {
      // Nothing about this provider can be decided when the checkout itself
      // will not resolve, and it is not this adapter's problem to report.
      return null;
    }
    const root = opened.root;
    const nextId = ids();
    const draft = newDraft(YAML, budget);
    let present = false;

    if (opened.kind === "problem") {
      // Present and refused. Reported rather than skipped: a repository whose
      // orca file cannot be read is one that needs telling, not one that has
      // silently answered "nothing".
      present = true;
      report(draft, `\`${ORCA_YAML_FILE}\``, opened.problem);
    } else if (opened.kind === "text") {
      present = true;
      let parsed: unknown;
      try {
        parsed = parseYaml(opened.text);
      } catch (error) {
        report(
          draft,
          `\`${ORCA_YAML_FILE}\``,
          problem(YAML, "malformed", error instanceof Error ? error.message : String(error)),
        );
        parsed = null;
      }
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        await readSharedDirectories(record, deps, repoRoot, root, nextId, draft);
        readSetup(record, nextId, draft);
        // Every other key is orca's business. Reporting them would make each
        // orca repository look misconfigured by this extension (D6).
      } else if (parsed !== null && parsed !== undefined) {
        report(draft, `\`${ORCA_YAML_FILE}\``, problem(YAML, "malformed", "The file is not a mapping of keys."));
      }
    }

    // The draft moves file, so the rows below name the file that asked for
    // them rather than the one the read started at (§ 4.3).
    draft.ctx = INCLUDE;
    const included = await openProviderFile(deps, repoRoot, INCLUDE, root);
    if (included.kind === "problem") {
      present = true;
      report(draft, `\`${ORCA_INCLUDE_FILE}\``, included.problem);
    } else if (included.kind === "text") {
      present = true;
      await readInclude(included.text, deps, repoRoot, root, nextId, draft);
    }

    if (!present) {
      return null;
    }
    return modelFromDraft(draft);
  },
};
