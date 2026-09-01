// src/worktree/provisioning/nativeProvider.ts — Read `.vscode/worktree.json`,
// the repository's own provisioning file (worktree-provisioning.md § 3.4).
//
// It is the only file that can name another to build on and the only one that
// can remove what it inherited, and it resolves neither here: whether `extends`
// names a framework file, whether that file is present, and what `exclude` then
// removes are the dispatcher's three questions (design.md D2). This module
// reads one file and answers what it said.
//
// The four inline keys are not mapped here either — `readInlineKeys` owns them,
// so this file and `asimov/worktree.yaml` cannot learn a key separately
// (design.md D7).

import { type ParseError, parse as parseJsonc } from "jsonc-parser";
import {
  type AdapterRead,
  type Authorized,
  type Draft,
  ids,
  modelFromDraft,
  newDraft,
  openProviderFile,
  type ProviderAdapter,
  type ProviderBudget,
  type ProviderContext,
  type ProviderDeps,
  problem,
  readInlineKeys,
  report,
} from "./providerKit";

/** Repo-relative, POSIX. The one file this adapter reads. */
export const NATIVE_PROVIDER_FILE = ".vscode/worktree.json";

const NATIVE: ProviderContext = { id: "native", file: NATIVE_PROVIDER_FILE };

/** The six keys § 3.4 maps. Anything else is reported rather than ignored. */
const KNOWN_KEYS = new Set(["extends", "copy", "link", "ports", "setup", "exclude"]);

/**
 * The file to build on, as this file spelled it.
 *
 * Read before the inline keys so a declaration that the budget has no room to
 * act on still travels: which provider is `active` is a different question from
 * how many of its rows fit (design.md D4).
 */
function extendsOf(record: Record<string, unknown>, draft: Draft): string | undefined {
  const declared = record.extends;
  if (declared === undefined) {
    return undefined;
  }
  if (typeof declared !== "string" || declared.trim() === "") {
    report(draft, "`extends`", problem(NATIVE, "malformed", "`extends` must name a file to build on."));
    return undefined;
  }
  return declared.trim();
}

/** Paths to drop from what was inherited. Each is reported, none is resolved. */
function excludeOf(record: Record<string, unknown>, draft: Draft): readonly string[] | undefined {
  const declared = record.exclude;
  if (declared === undefined) {
    return undefined;
  }
  if (!Array.isArray(declared)) {
    report(draft, "`exclude`", problem(NATIVE, "malformed", "`exclude` must be a list of paths."));
    return undefined;
  }
  const paths: string[] = [];
  for (const raw of declared) {
    if (typeof raw !== "string" || raw.trim() === "") {
      report(draft, "`exclude`", problem(NATIVE, "malformed", "`exclude` holds an entry that is not a path."));
      continue;
    }
    paths.push(raw.trim());
  }
  return paths;
}

export const nativeAdapter: ProviderAdapter = {
  id: "native",
  files: [NATIVE_PROVIDER_FILE],

  async read(
    deps: ProviderDeps,
    repoRoot: string,
    budget: ProviderBudget,
    authorized?: Authorized,
  ): Promise<AdapterRead | null> {
    const opened = await openProviderFile(deps, repoRoot, NATIVE, undefined, authorized);
    if (opened.kind === "absent" || (opened.kind === "problem" && opened.at === "root")) {
      // Absence is not "declared nothing", and a root that will not resolve is
      // neither presence nor absence. Answering a model for either would elect
      // this adapter over a framework file the repository does carry.
      return null;
    }
    const draft = newDraft(NATIVE, budget);

    if (opened.kind === "problem") {
      report(draft, `\`${NATIVE_PROVIDER_FILE}\``, opened.problem);
      return { model: modelFromDraft(draft) };
    }

    const errors: ParseError[] = [];
    const parsed: unknown = parseJsonc(opened.text, errors, {
      // The format, not a defect in it: this lives beside `.vscode/tasks.json`
      // and is edited by the same hands, which write comments in it.
      disallowComments: false,
      allowTrailingComma: true,
      allowEmptyContent: true,
    });
    // Reported, and then read anyway. `jsonc-parser` is error-tolerant: it hands
    // back the keys it could read alongside the errors it hit, so a damaged
    // `exclude` between a valid `copy` and a valid `setup` still yields both.
    // Returning an empty model here threw those away, which is the one thing
    // "none of them SHALL discard the rest of the file" forbids
    // (.reviews/round-1.md F003).
    const damaged = errors.length > 0;
    if (damaged) {
      report(
        draft,
        `\`${NATIVE_PROVIDER_FILE}\``,
        problem(NATIVE, "malformed", `\`${NATIVE_PROVIDER_FILE}\` is not valid JSON with comments.`),
      );
    }
    if (parsed === undefined) {
      return { model: modelFromDraft(draft) };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      // One reason per file, not two: a damaged file that recovered no mapping
      // has already been named, and saying it twice reads as two defects.
      if (!damaged) {
        report(
          draft,
          `\`${NATIVE_PROVIDER_FILE}\``,
          problem(NATIVE, "malformed", "The file is not a mapping of keys."),
        );
      }
      return { model: modelFromDraft(draft) };
    }

    const record = parsed as Record<string, unknown>;
    const base = extendsOf(record, draft);
    const dropped = excludeOf(record, draft);
    await readInlineKeys(record, KNOWN_KEYS, repoRoot, opened.root, deps, ids(), draft);

    return { model: modelFromDraft(draft), extends: base, exclude: dropped };
  },
};
