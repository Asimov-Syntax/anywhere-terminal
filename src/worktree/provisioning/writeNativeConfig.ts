// src/worktree/provisioning/writeNativeConfig.ts — the ONE provisioning file
// this extension writes (worktree-provisioning.md § 6).
//
// It is in this directory and deliberately NOT on `readOnly.test.ts`'s
// READ_PATH: that suite holds the property that nothing turning provider files
// into a model can run a command or change a byte, and its completeness check
// fails on any module here that declares itself neither way. Being listed as a
// module that writes is the point.
//
// Every other provisioning file belongs to the tool that defined it. Nothing
// below can name one: the module takes a repository root and a divergence, and
// computes its single destination itself (design.md D5, D7).

import * as path from "node:path";
import { applyEdits, type FormattingOptions, getNodeValue, modify, parseTree } from "jsonc-parser";
import { LockedFile, type LockedFileDependencies } from "../../agentHooks/install/lockedJsonFile";
import { isResolvedPathInsideRoot, prepareResolvedRoot } from "../../utils/resolvedPathBoundary";
import { NATIVE_PROVIDER_FILE } from "./nativeProvider";

/** What the selection diverges to, in the vocabulary the native file has (design.md D6). */
export interface NativeConfigDivergence {
  /** Inherited paths to add to `exclude`. */
  readonly exclude: readonly string[];
  /** Paths the native file declares inline and the user cleared, to remove from `copy`/`link`. */
  readonly drop: readonly string[];
  /** The present file to build on, when the user took a different source. */
  readonly extends?: string;
}

export type NativeConfigWrite =
  | { readonly ok: true; readonly wrote: boolean }
  | { readonly ok: false; readonly reason: NativeConfigRefusal };

/**
 * Why a save did not happen.
 *
 * `unavailable` covers both a lock another process holds and a directory that
 * could not be created, because `LockedFile.acquireLock` answers `undefined` to
 * both — reporting one of them specifically would be a guess (design.md D9).
 */
export type NativeConfigRefusal = "unavailable" | "outside" | "malformed" | "unwritable";

export interface NativeConfigStat {
  isSymbolicLink(): boolean;
  readonly mode: number;
}

export interface NativeConfigDeps {
  realpath(p: string): Promise<string>;
  lstat(p: string): Promise<NativeConfigStat>;
  /** Passed through to `LockedFile`, so a test can fail one syscall and nothing else. */
  readonly locked?: LockedFileDependencies;
}

/** The keys this writer is allowed to touch. Nothing else is added, removed or reordered. */
const WRITTEN_KEYS = ["extends", "exclude", "copy", "link"] as const;

function notFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

/**
 * The file's own indentation and line ending, so an edit does not restyle its
 * neighbourhood. `format()` is never called on the document — reformatting a
 * file is a change to parts the user did not ask to change.
 */
function formattingOf(text: string): FormattingOptions {
  const indented = /^([ \t]+)\S/m.exec(text);
  const lead = indented?.[1] ?? "  ";
  const crlf = (text.match(/\r\n/g)?.length ?? 0) * 2 > (text.match(/\n/g)?.length ?? 0);
  return {
    tabSize: lead.startsWith("\t") ? 1 : lead.length,
    insertSpaces: !lead.startsWith("\t"),
    eol: crlf ? "\r\n" : "\n",
  };
}

/** `undefined` for a value that is absent; `null` for one whose shape this writer cannot edit. */
function readKey(root: Record<string, unknown>, key: string, want: "array" | "string"): unknown[] | string | null | undefined {
  const held = root[key];
  if (held === undefined) {
    return undefined;
  }
  if (want === "array") {
    return Array.isArray(held) ? (held as unknown[]) : null;
  }
  return typeof held === "string" ? held : null;
}

interface Planned {
  readonly edits: readonly { key: string; value: unknown }[];
}

/**
 * What has to change, or `null` when the document cannot be edited safely.
 *
 * A document `parseTree` reports errors for is refused rather than repaired:
 * `modify` will happily rewrite a broken file and leave it broken, and a
 * wrong-shaped `exclude` makes it throw outright (design.md D4).
 */
function planEdits(text: string, divergence: NativeConfigDivergence): Planned | null {
  const errors: Parameters<typeof parseTree>[1] = [];
  const tree = parseTree(text, errors, { disallowComments: false, allowTrailingComma: true, allowEmptyContent: true });
  if (errors.length > 0 || tree === undefined) {
    return null;
  }
  const value: unknown = getNodeValue(tree);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const root = value as Record<string, unknown>;

  const held: Record<string, unknown> = {};
  for (const key of WRITTEN_KEYS) {
    const read = readKey(root, key, key === "extends" ? "string" : "array");
    if (read === null) {
      return null;
    }
    held[key] = read;
  }

  const edits: { key: string; value: unknown }[] = [];

  const excluded = (held.exclude as string[] | undefined) ?? [];
  const added = divergence.exclude.filter((p) => !excluded.includes(p));
  if (added.length > 0) {
    edits.push({ key: "exclude", value: [...excluded, ...added] });
  }

  for (const key of ["copy", "link"] as const) {
    const declared = held[key] as unknown[] | undefined;
    if (declared === undefined) {
      continue;
    }
    const kept = declared.filter((p) => !(typeof p === "string" && divergence.drop.includes(p)));
    if (kept.length !== declared.length) {
      edits.push({ key, value: kept });
    }
  }

  if (divergence.extends !== undefined && held.extends !== divergence.extends) {
    edits.push({ key: "extends", value: divergence.extends });
  }

  return { edits };
}

/** The document a repository with no configuration of its own gets. */
function firstDocument(divergence: NativeConfigDivergence): string | null {
  const fresh: Record<string, unknown> = {};
  if (divergence.extends !== undefined) {
    fresh.extends = divergence.extends;
  }
  if (divergence.exclude.length > 0) {
    fresh.exclude = [...divergence.exclude];
  }
  // `drop` cannot apply: a file that does not exist declares nothing inline.
  return Object.keys(fresh).length === 0 ? null : `${JSON.stringify(fresh, null, 2)}\n`;
}

/**
 * Record `divergence` in the repository's own provisioning configuration.
 *
 * The destination is computed here and nowhere else. `.vscode` is resolved ONCE
 * and every operation after that names the resolved directory, so swapping the
 * logical name for a symlink after the check cannot redirect the write — the
 * bypass that a parent-only check let through. The target itself is refused when
 * it is a symlink, which that check never covered at all (design.md D7).
 */
export async function writeNativeConfig(
  deps: NativeConfigDeps,
  repoRoot: string,
  divergence: NativeConfigDivergence,
): Promise<NativeConfigWrite> {
  const prepared = await prepareResolvedRoot(repoRoot, deps);
  if (prepared === null) {
    return { ok: false, reason: "outside" };
  }
  const dir = path.join(repoRoot, path.dirname(NATIVE_PROVIDER_FILE));
  if (!(await isResolvedPathInsideRoot(dir, prepared, deps))) {
    return { ok: false, reason: "outside" };
  }
  let here = dir;
  try {
    here = await deps.realpath(dir);
  } catch (error) {
    if (!notFound(error)) {
      return { ok: false, reason: "outside" };
    }
    // Not there yet. `LockedFile` creates it, beneath a parent already checked.
  }
  const target = path.join(here, path.basename(NATIVE_PROVIDER_FILE));

  let mode: number | undefined;
  try {
    const stat = await deps.lstat(target);
    if (stat.isSymbolicLink()) {
      // A configuration that is a link is not one this control edits: the write
      // would land wherever it points, which is the whole question containment
      // was asked.
      return { ok: false, reason: "outside" };
    }
    mode = stat.mode & 0o777;
  } catch (error) {
    if (!notFound(error)) {
      return { ok: false, reason: "unwritable" };
    }
  }

  const file = new LockedFile(target, deps.locked);
  return file.withLock<NativeConfigWrite>(
    async () => {
      // Inside the lock, not before it. Two saves that both read first produce
      // serialized renames and a lost update — serializing the syscall is not
      // serializing the operation (design.md D3).
      const text = mode === undefined ? undefined : await file.readText();
      if (text === undefined) {
        const fresh = firstDocument(divergence);
        if (fresh === null) {
          return { ok: true, wrote: false };
        }
        const staged = await file.stageReplacement(fresh, undefined);
        if (staged === undefined) {
          return { ok: false, reason: "unwritable" };
        }
        try {
          // `create` links the temporary into place and refuses a file that
          // appeared while this save was being prepared.
          return (await staged.commit("create")) ? { ok: true, wrote: true } : { ok: false, reason: "unwritable" };
        } finally {
          await staged.discard();
        }
      }
      const planned = planEdits(text, divergence);
      if (planned === null) {
        return { ok: false, reason: "malformed" };
      }
      if (planned.edits.length === 0) {
        return { ok: true, wrote: false };
      }
      const formattingOptions = formattingOf(text);
      let next = text;
      for (const edit of planned.edits) {
        next = applyEdits(next, modify(next, [edit.key], edit.value, { formattingOptions }));
      }
      return (await file.atomicReplace(next, mode)) ? { ok: true, wrote: true } : { ok: false, reason: "unwritable" };
    },
    { ok: false, reason: "unavailable" },
    { ok: false, reason: "unwritable" },
  );
}
