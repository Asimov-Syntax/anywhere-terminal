// src/worktree/provisioning/applyEntries.fake.ts — a filesystem small enough to
// state a defeater in, and honest about the three things the walk turns on:
// what `lstat` says, what `realpath` resolves to, and what the no-follow open
// refuses.
//
// Test-only. Production takes node:fs/promises.

import path from "node:path";
import type { ResolvedPathInsideDeps } from "../../utils/resolvedPathBoundary";
import type { ApplyFsDeps, LstatLike } from "./applyEntries";

export type FakeNode =
  | { kind: "file"; mode?: number; size?: number }
  | { kind: "dir"; mode?: number }
  | { kind: "link"; target: string }
  | { kind: "special" };

const err = (code: string, p: string): never => {
  const error = new Error(`${code}: ${p}`) as NodeJS.ErrnoException;
  error.code = code;
  throw error;
};

const stat = (node: FakeNode): LstatLike => ({
  isFile: () => node.kind === "file",
  isDirectory: () => node.kind === "dir",
  isSymbolicLink: () => node.kind === "link",
  mode: node.kind === "file" || node.kind === "dir" ? (node.mode ?? 0o644) : 0o777,
  size: node.kind === "file" ? (node.size ?? 1) : 0,
});

// An intersection rather than an `extends`: both halves declare `lstat`, with
// the walk's narrower `LstatLike` return, and TypeScript refuses an interface
// that inherits two non-identical signatures for one name.
export type FakeFs = ApplyFsDeps &
  ResolvedPathInsideDeps & {
    /** Every path this walk created, in order. */
    readonly created: string[];
    nodes: Map<string, FakeNode>;
    /** Runs before each lstat answers, so a test can swap a node mid-walk. */
    beforeLstat?: (p: string) => void;
  };

export function fakeFs(initial: Record<string, FakeNode>): FakeFs {
  const nodes = new Map<string, FakeNode>(Object.entries(initial));
  const created: string[] = [];

  const at = (p: string): FakeNode | undefined => nodes.get(p);

  /** Resolve symlinks component by component, the way realpath does. */
  const realpath = (p: string): string => {
    const parts = p.split("/").filter(Boolean);
    let current = "";
    for (let i = 0; i < parts.length; i += 1) {
      const next = `${current}/${parts[i]}`;
      const node = at(next);
      if (node === undefined) {
        return err("ENOENT", next);
      }
      if (node.kind === "link") {
        const target = node.target.startsWith("/") ? node.target : path.posix.resolve(current || "/", node.target);
        current = realpath(target);
        continue;
      }
      current = next;
    }
    return current === "" ? "/" : current;
  };

  const fs: FakeFs = {
    created,
    nodes,
    realpath: async (p) => realpath(p),
    // `lstat` refuses to follow the FINAL component only — every component
    // above it resolves exactly as it does for any other call. A fake that
    // looked the whole path up literally would make an entry beneath a
    // symlinked ancestor unreachable, and the relocation case untestable.
    lstat: async (p) => {
      fs.beforeLstat?.(p);
      const parent = path.posix.dirname(p);
      const base = path.posix.basename(p);
      const resolvedParent = parent === p ? p : realpath(parent);
      const node = at(resolvedParent === "/" ? `/${base}` : `${resolvedParent}/${base}`) ?? at(p);
      return node === undefined ? err("ENOENT", p) : stat(node);
    },
    readdir: async (p) => {
      const prefix = `${realpath(p)}/`;
      return [...nodes.keys()]
        .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/"))
        .map((k) => k.slice(prefix.length))
        .sort();
    },
    readlink: async (p) => {
      const parent = path.posix.dirname(p);
      const resolved = parent === p ? p : `${realpath(parent)}/${path.posix.basename(p)}`;
      const node = at(resolved) ?? at(p);
      return node?.kind === "link" ? node.target : err("EINVAL", p);
    },
    mkdir: async (p, mode) => {
      if (at(p) !== undefined) {
        return err("EEXIST", p);
      }
      nodes.set(p, { kind: "dir", mode });
      created.push(p);
    },
    symlink: async (target, p) => {
      if (at(p) !== undefined) {
        return err("EEXIST", p);
      }
      nodes.set(p, { kind: "link", target });
      created.push(p);
    },
    copyFileNoFollow: async (source, destination, mode) => {
      const from = at(source) ?? at(`${realpath(path.posix.dirname(source))}/${path.posix.basename(source)}`);
      if (from === undefined) {
        return err("ENOENT", source);
      }
      // The no-follow open is the point of this primitive: a source that became
      // a symlink after it was stat-ed fails here rather than being read through.
      if (from.kind === "link") {
        return err("ELOOP", source);
      }
      if (from.kind !== "file") {
        return err("EINVAL", source);
      }
      if (at(destination) !== undefined) {
        return err("EEXIST", destination);
      }
      nodes.set(destination, { kind: "file", mode, size: from.size ?? 1 });
      created.push(destination);
      return from.size ?? 1;
    },
  };
  return fs;
}
