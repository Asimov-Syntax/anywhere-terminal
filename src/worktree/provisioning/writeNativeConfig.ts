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
import { applyEdits, type FormattingOptions, type JSONPath, modify, type ParseError } from "jsonc-parser";
import { isNotFound, LockedFile, type LockedFileDependencies } from "../../agentHooks/install/lockedJsonFile";
import type { ProvisionModel } from "../../types/messages";
import { authorizedPathInsideRoot, prepareResolvedRoot } from "../../utils/resolvedPathBoundary";
import { NATIVE_PROVIDER_FILE } from "./nativeProvider";
import { type ProviderDeps, readJsonc } from "./providerKit";
import { baseFor } from "./readProvisioning";

/** What the selection diverges to, in the vocabulary the native file has (design.md D6). */
export interface NativeConfigDivergence {
  /** Inherited paths to add to `exclude`. */
  readonly exclude: readonly string[];
  /** Paths the native file declares inline and the user cleared, to remove from `copy`/`link`. */
  readonly drop: readonly string[];
  /**
   * Selected fallback suggestions to append to `copy` — the one positive
   * consent a suggestion can become (suggest-worktree-initialization D3).
   * Optional so a divergence recorded before suggestions existed still reads.
   */
  readonly addCopy?: readonly string[];
  /** The present file to build on. */
  readonly extends?: string;
  /**
   * An active non-native provider was found and none of its files is there
   * (design.md D12).
   *
   * Reported rather than re-derived by the caller: `divergenceOf` is what looked
   * for the source and failed to name one.
   */
  readonly unnamedSource: boolean;
  /**
   * The user took a source other than the one the form opened on, as the HOST
   * derived it (design.md D18). It decides whether a document worth writing
   * exists at all when nothing else diverges — never which file gets named.
   */
  readonly tookSource: boolean;
}

/**
 * The save took a lock and may not have got rid of it.
 *
 * A flag, NOT a pathname. The wire carries no identity, and a person acts on
 * what it says minutes later — by which time the name can have been rebound, so
 * "remove this file" is advice that can delete a live lock belonging to someone
 * else. Set only for the releases this process can vouch for (design.md D1, D3).
 *
 * Orthogonal to the outcome, because the release runs after ANY outcome that
 * acquired the lock — hanging it off success alone loses it exactly on the
 * refusal paths, where the next save is already going to struggle.
 */
interface MayStillBeLocked {
  readonly mayStillBeLocked?: true;
}

export type NativeConfigWrite =
  | ({ readonly ok: true; readonly wrote: boolean } & MayStillBeLocked)
  | ({ readonly ok: false; readonly reason: NativeConfigRefusal } & MayStillBeLocked);

/**
 * Why a save did not happen.
 *
 * `unavailable` covers both a lock another process holds and a directory that
 * could not be created, because `LockedFile.acquireLock` answers `undefined` to
 * both — reporting one of them specifically would be a guess (design.md D9).
 *
 * `unnamed` is the source's absence, not the destination's: the file to build on
 * was gone when the write was about to happen, or the active source had no file
 * left to name at all. Recording a choice against a base that is not there is
 * how one exclusion becomes every exclusion (design.md D12, D17).
 */
export type NativeConfigRefusal = "unavailable" | "outside" | "malformed" | "unwritable" | "unnamed";

export interface NativeConfigStat {
  isSymbolicLink(): boolean;
  readonly mode: number;
}

export interface NativeConfigDeps {
  realpath(p: string): Promise<string>;
  lstat(p: string): Promise<NativeConfigStat>;
  /**
   * The reader's own dependencies, so the base is authorized by `baseFor`
   * rather than by a rule this module keeps (design.md D17). Wired from
   * `createProvisioningDeps()` beside the `readProvisioning` wiring, so the
   * save and the read that follows it cannot disagree about a base.
   */
  provider: ProviderDeps;
  /** Passed through to `LockedFile`, so a test can fail one syscall and nothing else. */
  readonly locked?: LockedFileDependencies;
  /**
   * The process's file-creation mask, injectable because a vitest worker refuses
   * `process.umask(mask)` — so a witness for the masking can only be written by
   * supplying the mask (.reviews/round-3.md F022, and the same constraint
   * `applyEntries.node.test.ts` records).
   */
  umask?(): number;
}

/**
 * What the user's selection diverges to, in the vocabulary the native file has.
 *
 * Pure, and derived from the HOST-held model plus ids — never from anything the
 * webview spelled (design.md D1). Which key an unticked entry lands in is
 * decided by which file declared it: `exclude` has no effect on inline keys
 * (worktree-provisioning.md § 3.4), so excluding a path the native file itself
 * declares would record a contradiction rather than a preference.
 *
 * Ports, setup steps and already-excluded rows are deliberately untouched, each
 * for its own reason — design.md D6.
 */
export function divergenceOf(
  model: ProvisionModel,
  kept: ReadonlySet<string>,
  tookSource: boolean,
): NativeConfigDivergence {
  const exclude: string[] = [];
  const drop: string[] = [];
  const addCopy: string[] = [];
  for (const entry of model.entries) {
    // A suggestion is consent, never preference: unticked is nothing at all —
    // not an exclusion — and ticked is a positive copy request
    // (suggest-worktree-initialization D3).
    if (entry.suggestion !== undefined) {
      if (kept.has(entry.id) && !addCopy.includes(entry.path)) {
        addCopy.push(entry.path);
      }
      continue;
    }
    if (kept.has(entry.id)) {
      continue;
    }
    const into = entry.source === NATIVE_PROVIDER_FILE ? drop : exclude;
    if (!into.includes(entry.path)) {
      into.push(entry.path);
    }
  }
  // Which source, and then which of ITS files.
  //
  // The active one, and nothing the caller names. A switch re-reads with the
  // taken provider preferred, so the source the user took is already `active`
  // in the model they are looking at, and the model is the host's own — a
  // source named separately would be a second answer to a question the offer
  // has already answered, free to disagree with it (design.md D1).
  //
  // What makes a rewrite a no-op is the file already naming this base, and the
  // writer's own idempotence answers that (design.md D10); it is not this
  // function's to guess.
  //
  // Except the native file itself: a configuration that extends its own path is
  // self-extension, which § 3.4 excludes from what `extends` can name.
  const taken = model.providers.find((p) => p.active);
  // `present[0]`, never `files[0]`: `files` is what the adapter can read, and a
  // provider detected through only the second of them would be given an
  // `extends` naming a file that is not there. An empty `present` names
  // nothing — the provider's file went away between the read and the probe, and
  // there is no truthful answer to give.
  const inherited = taken !== undefined && taken.id !== "native";
  const base = inherited ? taken.present[0] : undefined;
  // Reported, not swallowed: a source that supplied the offer and can no longer
  // be named is the state D12 refuses, and the writer is where the document
  // being created is known.
  const unnamedSource = inherited && base === undefined;
  const rest = { exclude, drop, addCopy, unnamedSource, tookSource };
  return base === undefined ? rest : { ...rest, extends: base };
}

/** The keys this writer is allowed to touch. Nothing else is added, removed or reordered. */
const WRITTEN_KEYS = ["extends", "exclude", "copy", "link"] as const;

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
function readKey(
  root: Record<string, unknown>,
  key: string,
  want: "array" | "string",
): unknown[] | string | null | undefined {
  const held = root[key];
  if (held === undefined) {
    return undefined;
  }
  if (want === "array") {
    return Array.isArray(held) ? (held as unknown[]) : null;
  }
  return typeof held === "string" ? held : null;
}

/** One `modify` call. `value: undefined` removes; `insert` adds without replacing. */
interface Op {
  readonly path: JSONPath;
  readonly value: unknown;
  readonly insert?: true;
}

/**
 * One key's change: the narrow operations that make it, and the value the key
 * must hold afterwards either way.
 *
 * The second is not bookkeeping. `modify` is checked against it after the
 * narrow form runs, because on the pinned 3.3.1 the narrow form is not always
 * safe — see `applyEdit`.
 */
interface Edit {
  readonly key: string;
  readonly ops: readonly Op[];
  readonly whole: unknown;
}

interface Planned {
  readonly edits: readonly Edit[];
  /** The base an edit writes. */
  readonly writes?: string;
  /** The base the document already names, which no edit touches. */
  readonly declared?: string;
}

/** The value `key` holds in `text`, or `undefined` for a document that will not parse. */
function keyOf(text: string, key: string): unknown {
  const errors: ParseError[] = [];
  const value = readJsonc(text, errors);
  if (errors.length > 0 || typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return (value as Record<string, unknown>)[key];
}

/**
 * `text` with one key's edit applied, or `null` when it cannot be made at all.
 *
 * The narrow form is tried first and then CHECKED, because jsonc-parser 3.3.1
 * does not always honour it: removing the LAST element of a single-line array
 * eats the closing bracket — `{"copy": [".env", ".env.local"]}` minus index 1
 * comes back as `{"copy": [".env""]}`. Probed; a multi-line array and any
 * non-last index are correct. So the result is parsed and compared with the
 * value the edit is for, and only a document that actually holds it is kept.
 *
 * The fallback replaces the whole key, which reflows that one array and loses
 * comments inside it (.reviews/round-1.md F004). That is the trade this makes
 * where the narrow form is unusable: a correct document, one array's comments
 * lost, over a corrupt file with its comments intact.
 */
function applyEdit(text: string, edit: Edit, formattingOptions: FormattingOptions): string | null {
  const holds = (candidate: string): boolean =>
    JSON.stringify(keyOf(candidate, edit.key)) === JSON.stringify(edit.whole);

  let narrow = text;
  for (const op of edit.ops) {
    narrow = applyEdits(narrow, modify(narrow, op.path, op.value, { formattingOptions, isArrayInsertion: op.insert }));
  }
  if (holds(narrow)) {
    return narrow;
  }
  const wide = applyEdits(text, modify(text, [edit.key], edit.whole, { formattingOptions }));
  return holds(wide) ? wide : null;
}

/**
 * What has to change, or `null` when the document cannot be edited safely.
 *
 * A document `readJsonc` reports errors for is refused rather than repaired:
 * `modify` will happily rewrite a broken file and leave it broken, and a
 * wrong-shaped `exclude` makes it throw outright (design.md D4). The parse is
 * the READER's — `providerKit.readJsonc` — so this writer and the native adapter
 * cannot come to disagree about which documents are well-formed
 * (.reviews/round-1.md F011).
 *
 * An empty or comment-only document is not one of them. `parseTree` answers
 * `undefined` with NO errors there, which is the same answer the reader treats
 * as a present configuration declaring nothing, so it is edited as the empty
 * object it is (.reviews/round-1.md F010). `modify` appends the comment after
 * the object it creates rather than keeping it above; the content survives, its
 * position does not.
 *
 * Every array edit names ONE ELEMENT. Replacing an array's whole value reflows
 * it and deletes every comment inside, including comments on elements the edit
 * keeps — which satisfied D4's letter by nominating a span wide enough to make
 * it vacuous (.reviews/round-1.md F004). Two consequences of the narrow form,
 * both probed against the pinned 3.3.1 and both deliberate:
 *
 * - Removals are emitted in DESCENDING index order. Indices are read off the
 *   ORIGINAL array, and removing a lower one first shifts every higher one down:
 *   ascending `1` then `2` over `[a,b,c,d]` removes `b` and `d`.
 * - Removing an element takes the comment that preceded the element AFTER it.
 *   The removed element's own leading comment stays. That is the bound this
 *   claims — comments are preserved outside the removed element's immediate
 *   neighbourhood, not everywhere.
 */
function planEdits(text: string, divergence: NativeConfigDivergence): Planned | null {
  const errors: ParseError[] = [];
  const value = readJsonc(text, errors);
  if (errors.length > 0) {
    return null;
  }
  // `undefined` with no errors is an empty or comment-only document.
  if (value !== undefined && (typeof value !== "object" || value === null || Array.isArray(value))) {
    return null;
  }
  const root = (value ?? {}) as Record<string, unknown>;

  const held: Record<string, unknown> = {};
  for (const key of WRITTEN_KEYS) {
    const read = readKey(root, key, key === "extends" ? "string" : "array");
    if (read === null) {
      return null;
    }
    held[key] = read;
  }

  const edits: Edit[] = [];

  for (const key of ["copy", "link"] as const) {
    const declared = held[key] as unknown[] | undefined;
    // One edit per key, removals and additions together, because `applyEdit`
    // verifies the key against ONE `whole` afterwards — two edits on `copy`
    // would each carry a different truth about it.
    const adds = key === "copy" ? (divergence.addCopy ?? []).filter((p) => !(declared ?? []).includes(p)) : [];
    if (declared === undefined) {
      if (adds.length > 0) {
        edits.push({ key, ops: [{ path: [key], value: adds }], whole: adds });
      }
      continue;
    }
    const ops: Op[] = [];
    for (let index = declared.length - 1; index >= 0; index -= 1) {
      const at = declared[index];
      if (typeof at === "string" && divergence.drop.includes(at)) {
        ops.push({ path: [key, index], value: undefined });
      }
    }
    const survivors = declared.filter((at) => !(typeof at === "string" && divergence.drop.includes(at)));
    // Appended AFTER the removals run, so the insertion index is the shrunk
    // array's — `applyEdit` applies ops in order.
    for (const [offset, p] of adds.entries()) {
      ops.push({ path: [key, survivors.length + offset], value: p, insert: true });
    }
    if (ops.length > 0) {
      edits.push({ key, ops, whole: [...survivors, ...adds] });
    }
  }

  const excluded = (held.exclude as string[] | undefined) ?? [];
  const added = divergence.exclude.filter((p) => !excluded.includes(p));
  if (added.length > 0) {
    const whole = [...excluded, ...added];
    const ops: Op[] =
      held.exclude === undefined
        ? // Nothing to preserve inside an array that is not there.
          [{ path: ["exclude"], value: whole }]
        : added.map((p, offset) => ({ path: ["exclude", excluded.length + offset], value: p, insert: true }) as const);
    edits.push({ key: "exclude", ops, whole });
  }

  // A take changes which source is named. A document that names none gets one
  // whenever it is about to record something else, whatever route it arrived
  // by: an `exclude` with no base to subtract from is not one exclusion, it is
  // every one of them (design.md D12).
  //
  // And only then. A form the user changed nothing on writes no file at all,
  // even where a source is active and could be named — recording a base is not
  // a decision anyone made (spec: a save that has nothing to record writes
  // nothing).
  const declaredBase = held.extends as string | undefined;
  const namesBase = divergence.extends !== undefined && divergence.extends !== declaredBase;
  const needed = divergence.tookSource || (declaredBase === undefined && edits.length > 0);
  const writes = namesBase && needed ? divergence.extends : undefined;
  if (writes !== undefined) {
    edits.push({ key: "extends", ops: [{ path: ["extends"], value: writes }], whole: writes });
  }

  return { edits, writes, declared: declaredBase };
}

/**
 * Record `divergence` in the repository's own provisioning configuration.
 *
 * The destination is computed here and nowhere else. `.vscode` is resolved ONCE
 * and every operation after that names the resolved directory, so swapping the
 * logical name for a symlink after the check cannot redirect the write — the
 * bypass that a parent-only check let through. The target itself is refused when
 * it is a symlink, which that check never covered at all (design.md D7).
 *
 * NOT closed here: an adversary who can rename `.vscode` between the resolve and
 * the lock still redirects everything downstream of it, because `LockedFile`
 * serializes an INODE while every path here names a STRING. Closing it needs
 * descriptor-relative `openat`/`renameat` semantics, which every caller of
 * `LockedFile` would inherit — a new invariant owner, and so its own change that
 * this one depends on (design.md D16). What moved inside the lock below closes
 * the ordinary races, and this comment is here so the remaining one is not read
 * as an oversight.
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
  // The destination is built from the value the check AUTHORIZED, which is the
  // check's own resolution and not the spelling handed to it. Resolving here and
  // then checking that answer looks like one resolution and is two: the
  // predicate re-resolves by contract, and a second answer that differs but
  // stays inside the root is authorized while the caller's stale spelling names
  // the file (.reviews/round-3.md F019, design.md D7).
  //
  // An absent directory needs no separate branch — the walk reconstructs the
  // unresolved tail beneath a resolved ancestor, and that is the path
  // `LockedFile` then creates.
  const here = await authorizedPathInsideRoot(dir, prepared, deps);
  if (here === null) {
    return { ok: false, reason: "outside" };
  }
  const target = path.join(here, path.basename(NATIVE_PROVIDER_FILE));

  const file = new LockedFile(target, deps.locked);
  let inTheWay = false;
  const written = await file.withLock<NativeConfigWrite>(
    async () => {
      // Inside the lock, not before it — the whole read-modify-write, and that
      // includes deciding WHAT is being written to. A symlink verdict or a mode
      // taken outside the lock describes a file the write need not be landing
      // on: the target can be replaced in between, and `readText` follows
      // symlinks (design.md D3, .reviews/round-1.md F003).
      let mode: number | undefined;
      try {
        const stat = await deps.lstat(target);
        if (stat.isSymbolicLink()) {
          // A configuration that is a link is not one this control edits: the
          // write would land wherever it points, which is the whole question
          // containment was asked.
          return { ok: false, reason: "outside" };
        }
        mode = stat.mode & 0o777;
      } catch (error) {
        if (!isNotFound(error)) {
          return { ok: false, reason: "unwritable" };
        }
      }
      // The same locked observation decides the branch, so a file that appeared
      // or vanished cannot put this on the wrong one.
      const existing = mode === undefined ? undefined : await file.readText();
      const planned = planEdits(existing ?? "", divergence);
      if (planned === null) {
        return { ok: false, reason: "malformed" };
      }
      // A source that supplied the offer and can no longer be named. Writing the
      // user's choice into a document that names no base records the opposite of
      // what they chose, and a take that names nothing records nothing at all
      // (design.md D12).
      //
      // A base the document ALREADY declares does not excuse it: the exclusions
      // were computed against the source the user was looking at, and committing
      // them under a different base records the choice against something else
      // while losing the source change entirely (.reviews/round-2.md F021).
      if (divergence.unnamedSource && (planned.edits.length > 0 || divergence.tookSource)) {
        return { ok: false, reason: "unnamed" };
      }
      if (planned.edits.length === 0) {
        return { ok: true, wrote: false };
      }
      // The offer's `present` chose this base; it never authorized it. Confirmed
      // here, inside the lock, immediately before the write — the file can go
      // away between the read the form was built from and this save, and the
      // read side then answers `missingExtends` for a document we just wrote
      // (design.md D17).
      //
      // The base IN FORCE, which is the one being written when there is one and
      // otherwise the one the document already names. D17 says the base is
      // confirmed before the write; it never said "only a base this call adds",
      // and reading it that way left a declared base unprobed
      // (.reviews/round-2.md F021).
      const base = planned.writes ?? planned.declared;
      if (base !== undefined) {
        // Asked of the reader, whole. `baseFor` performs exact membership in
        // the framework adapters, resolved containment AND the bounded readable
        // open, with D2 rule 2's requirement that the named file itself be
        // readable — one operation, and the same one `assemble` will run
        // against this document a moment from now.
        //
        // This module held its own version of that check for four review rounds
        // and had a different clause missing each time: the declared base
        // uncovered, then unvalidated, then validated as a name, then as a
        // contained path whose readability nobody asked about. A base one byte
        // over `MAX_PROVIDER_BYTES` saved and read back `unreadable`, which is
        // precisely the disagreement D17 exists to prevent
        // (.reviews/round-5.md F025).
        //
        // Both refusals land as `unnamed`: the target that names no adapter or
        // is not there, and the one that is there and will not read. They are
        // one fact the user acts on one way, which is the judgement `assemble`
        // already makes when it reports both as `missingExtends`.
        if ((await baseFor(deps.provider, repoRoot, base)).ok !== true) {
          return { ok: false, reason: "unnamed" };
        }
      }
      const formattingOptions = formattingOf(existing ?? "");
      let next = existing ?? "";
      for (const edit of planned.edits) {
        const applied = applyEdit(next, edit, formattingOptions);
        if (applied === null) {
          // The document is fine; the edit is what could not be made. Nothing
          // this cannot express is written half-way.
          return { ok: false, reason: "unwritable" };
        }
        next = applied;
      }
      if (existing === undefined) {
        // `LockedFile` opens its temporary `0o600` and skips the chmod when no
        // mode is given, so a file created through it landed at the temporary's
        // own mode — one nobody chose, and unlike every sibling in the
        // repository (.reviews/round-2.md F022).
        //
        // Masked before it is passed. `stageReplacement` opens `wx` with the
        // mode — which the umask DOES narrow — and then chmods it exactly,
        // which the umask does not: `0o644` under `umask 0077` produced a
        // world-readable file where the process's own policy says `0600`
        // (.reviews/round-3.md F022). Masking here lands the chmod on the same
        // value the create would have produced alone.
        const staged = await file.stageReplacement(next, mode ?? 0o644 & ~(deps.umask ?? process.umask)());
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
      return (await file.atomicReplace(next, mode)) ? { ok: true, wrote: true } : { ok: false, reason: "unwritable" };
    },
    { ok: false, reason: "unavailable" },
    { ok: false, reason: "unwritable" },
    (_lockPath, release) => {
      inTheWay = release === "stuck" || release === "movedAway";
    },
  );
  return inTheWay ? { ...written, mayStillBeLocked: true } : written;
}
