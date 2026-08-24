// src/vault/readers/cursorReader.test.ts — Unit tests for bounded Cursor CLI
// metadata indexing and explicit transcript detail decoding.

import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReaderListCache } from "../cacheTypes";
import {
  type CursorFsDeps,
  MAX_META_BYTES,
  readCursorDetail,
  readCursorEntry,
  readCursorMessageRecord,
  readCursorSessions,
} from "./cursorReader";

let tmpRoot: string;
let chatsDir: string;
let projectsDir: string;
let ideDbPath: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "anywhere-cursor-"));
  chatsDir = path.join(tmpRoot, "chats");
  projectsDir = path.join(tmpRoot, "projects");
  ideDbPath = path.join(tmpRoot, "missing-state.vscdb");
  await Promise.all([fs.mkdir(chatsDir, { recursive: true }), fs.mkdir(projectsDir, { recursive: true })]);
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function opts(fsDeps?: CursorFsDeps, pathsFs?: import("./cursorPaths").CursorPathFsDeps) {
  return { chatsDir, projectsDir, ideDbPath, ...(fsDeps ? { fs: fsDeps } : {}), ...(pathsFs ? { pathsFs } : {}) };
}

function createPassthroughPathFs(): import("./cursorPaths").CursorPathFsDeps {
  return {
    readdir: vi.fn(async (p: string) => fs.readdir(p, { withFileTypes: true })),
    stat: vi.fn(async (p: string) => fs.stat(p)),
  };
}

/**
 * A plain pass-through `stat`/`open` pair (still delegating to the real fs),
 * built as ordinary `vi.fn`s so individual tests can assert call targets or
 * inject a one-off TOCTOU override — no ESM module mocking (`vi.mock` /
 * `vi.importActual`) is used, so this seam works under both Vitest and Bun's
 * test runner.
 */
function createPassthroughFs(): CursorFsDeps {
  return {
    stat: vi.fn(async (p: string) => fs.stat(p)),
    open: vi.fn(async (p: string, flags: string) => fs.open(p, flags)),
  };
}

async function writeIdeHeader(title: string): Promise<void> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(ideDbPath);
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS composerHeaders(
      composerId TEXT PRIMARY KEY,
      workspaceId TEXT,
      createdAt INTEGER,
      lastUpdatedAt INTEGER,
      isArchived INTEGER,
      isSubagent INTEGER,
      value TEXT
    )`);
    db.exec("CREATE TABLE IF NOT EXISTS cursorDiskKV(key TEXT PRIMARY KEY, value BLOB NOT NULL)");
    const value = JSON.stringify({
      composerId: "composer-1",
      name: title,
      workspaceIdentifier: { id: "workspace-1", uri: { fsPath: "/Users/me/ide-project" } },
    });
    db.prepare(
      "INSERT OR REPLACE INTO composerHeaders(composerId, workspaceId, createdAt, lastUpdatedAt, isArchived, isSubagent, value) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("composer-1", "workspace-1", 1000, title === "IDE one" ? 2000 : 3000, 0, 0, value);
  } finally {
    db.close();
  }
}

interface MetaFields {
  schemaVersion?: unknown;
  hasConversation?: unknown;
  isSubagent?: unknown;
  cwd?: unknown;
  title?: unknown;
  createdAtMs?: unknown;
  updatedAtMs?: unknown;
}

const BASE_META: MetaFields = {
  schemaVersion: 1,
  hasConversation: true,
  isSubagent: false,
  cwd: "/Users/me/proj",
  title: "Fix the flaky test",
  createdAtMs: 1_000,
  updatedAtMs: 2_000,
};

/** Write `<chatsDir>/<bucket>/<chatId>/meta.json` (+ optional sibling store.db). */
async function writeChat(bucket: string, chatId: string, meta: MetaFields | string, withDb = true): Promise<string> {
  const dir = path.join(chatsDir, bucket, chatId);
  await fs.mkdir(dir, { recursive: true });
  const body = typeof meta === "string" ? meta : JSON.stringify(meta);
  await fs.writeFile(path.join(dir, "meta.json"), body, "utf8");
  if (withDb) {
    await fs.writeFile(path.join(dir, "store.db"), "sqlite-bytes", "utf8");
  }
  return dir;
}

function fixtureHash(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function fixtureField(fieldNumber: number, value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([Buffer.from([fieldNumber * 8 + 2, bytes.length]), bytes]);
}

async function writeProjectTranscript(project: string, chatId: string, records: unknown[]): Promise<void> {
  const dir = path.join(projectsDir, project, "agent-transcripts", chatId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${chatId}.jsonl`),
    records.map((record) => JSON.stringify(record)).join("\n"),
    "utf8",
  );
}

async function writeCompatibleStore(dir: string, chatId: string, records: unknown[]): Promise<void> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(dir, "store.db"));
  try {
    db.exec("PRAGMA user_version = 1");
    db.exec("CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    db.exec("CREATE TABLE blobs(id TEXT PRIMARY KEY, data BLOB NOT NULL)");
    const blobs = records.map((record) => Buffer.from(JSON.stringify(record), "utf8"));
    const root = Buffer.concat(blobs.map((blob) => fixtureField(1, fixtureHash(blob))));
    const rootId = fixtureHash(root);
    db.prepare("INSERT INTO meta(key, value) VALUES ('0', ?)").run(
      Buffer.from(JSON.stringify({ agentId: chatId, latestRootBlobId: rootId }), "utf8").toString("hex"),
    );
    const insert = db.prepare("INSERT INTO blobs(id, data) VALUES (?, ?)");
    insert.run(rootId, root);
    for (const blob of blobs) {
      insert.run(fixtureHash(blob), blob);
    }
  } finally {
    db.close();
  }
}

/** A valid, eligible meta.json serialized to EXACTLY `totalBytes` (ASCII-only
 *  padding, so byte length equals char length) — for precise bound testing. */
function metaAtExactSize(totalBytes: number): string {
  const skeleton = { ...BASE_META, title: "", pad: "" };
  const withoutPad = JSON.stringify(skeleton);
  const padLen = totalBytes - withoutPad.length;
  if (padLen < 0) {
    throw new Error(`target size ${totalBytes} smaller than empty-pad skeleton ${withoutPad.length}`);
  }
  return JSON.stringify({ ...skeleton, pad: "x".repeat(padLen) });
}

describe("readCursorSessions: eligibility and mapped bounds", () => {
  it("lists an eligible schema-1 chat exactly once with mapped fields", async () => {
    await writeChat("bucket-a", "chat-1", BASE_META);
    const { entries, unreadable } = await readCursorSessions(undefined, opts());
    expect(entries).toHaveLength(1);
    expect(unreadable).toBe(0);
    const e = entries[0];
    expect(e.id).toBe("cursor:chat-1");
    expect(e.agent).toBe("cursor");
    expect(e.sessionId).toBe("chat-1");
    expect(e.cwd).toBe("/Users/me/proj");
    expect(e.title).toBe("Fix the flaky test");
    expect(e.modified).toBe(2000);
    expect((e as { canResume?: boolean }).canResume).toBe(true);
  });

  it("excludes (without counting unreadable) a chat with hasConversation: false", async () => {
    await writeChat("bucket-a", "chat-no-convo", { ...BASE_META, hasConversation: false });
    const { entries, unreadable } = await readCursorSessions(undefined, opts());
    expect(entries).toHaveLength(0);
    expect(unreadable).toBe(0);
  });

  it("excludes a subagent chat", async () => {
    await writeChat("bucket-a", "chat-subagent", { ...BASE_META, isSubagent: true });
    const { entries, unreadable } = await readCursorSessions(undefined, opts());
    expect(entries).toHaveLength(0);
    expect(unreadable).toBe(0);
  });

  it("excludes a chat with no sibling store.db, without reading any blob", async () => {
    await writeChat("bucket-a", "chat-no-db", BASE_META, false);
    const { entries, unreadable } = await readCursorSessions(undefined, opts());
    expect(entries).toHaveLength(0);
    expect(unreadable).toBe(0);
    // store.db must never exist as a read target — only its presence was checked.
    await expect(fs.access(path.join(chatsDir, "bucket-a", "chat-no-db", "store.db"))).rejects.toThrow();
  });

  it("rejects schemaVersion other than 1 as unreadable", async () => {
    await writeChat("bucket-a", "chat-v2", { ...BASE_META, schemaVersion: 2 });
    const { entries, unreadable } = await readCursorSessions(undefined, opts());
    expect(entries).toHaveLength(0);
    expect(unreadable).toBe(1);
  });

  it("rejects malformed JSON as unreadable", async () => {
    await writeChat("bucket-a", "chat-bad-json", "{not json");
    const { entries, unreadable } = await readCursorSessions(undefined, opts());
    expect(entries).toHaveLength(0);
    expect(unreadable).toBe(1);
  });

  it("rejects a meta.json larger than 64 KiB as unreadable, without a full read", async () => {
    const big = { ...BASE_META, title: "x".repeat(70 * 1024) };
    await writeChat("bucket-a", "chat-big", big);
    const { entries, unreadable } = await readCursorSessions(undefined, opts());
    expect(entries).toHaveLength(0);
    expect(unreadable).toBe(1);
  });

  it("rejects a non-absolute cwd as unreadable", async () => {
    await writeChat("bucket-a", "chat-rel-cwd", { ...BASE_META, cwd: "relative/path" });
    const { entries, unreadable } = await readCursorSessions(undefined, opts());
    expect(entries).toHaveLength(0);
    expect(unreadable).toBe(1);
  });

  it("rejects a cwd containing control characters as unreadable", async () => {
    await writeChat("bucket-a", "chat-ctrl-cwd", { ...BASE_META, cwd: "/Users/me/proj" });
    const { entries, unreadable } = await readCursorSessions(undefined, opts());
    expect(entries).toHaveLength(0);
    expect(unreadable).toBe(1);
  });

  it("rejects a cwd longer than 16 KiB as unreadable", async () => {
    await writeChat("bucket-a", "chat-long-cwd", { ...BASE_META, cwd: `/${"a".repeat(17 * 1024)}` });
    const { entries, unreadable } = await readCursorSessions(undefined, opts());
    expect(entries).toHaveLength(0);
    expect(unreadable).toBe(1);
  });

  it("bounds the title to <=120 chars and strips newlines", async () => {
    await writeChat("bucket-a", "chat-long-title", { ...BASE_META, title: `line one\nline two ${"y".repeat(200)}` });
    const { entries } = await readCursorSessions(undefined, opts());
    expect(entries).toHaveLength(1);
    expect(entries[0].title.length).toBeLessThanOrEqual(120);
    expect(entries[0].title).not.toContain("\n");
  });

  it("falls back to filesystem time when timestamps are missing/invalid", async () => {
    await writeChat("bucket-a", "chat-bad-ts", { ...BASE_META, createdAtMs: -1, updatedAtMs: "not-a-number" });
    const stat = await fs.stat(path.join(chatsDir, "bucket-a", "chat-bad-ts", "meta.json"));
    const { entries } = await readCursorSessions(undefined, opts());
    expect(entries).toHaveLength(1);
    expect(entries[0].modified).toBe(stat.mtimeMs);
  });

  it("returns zero entries (not an error) when the chats root is absent", async () => {
    const { entries, unreadable } = await readCursorSessions(undefined, {
      chatsDir: path.join(tmpRoot, "nope"),
      ideDbPath,
    });
    expect(entries).toEqual([]);
    expect(unreadable).toBe(0);
  });
});

describe("readCursorSessions: duplicate chat-id ambiguity", () => {
  it("omits every candidate sharing a chat id across buckets and counts both unreadable", async () => {
    await writeChat("bucket-a", "dup-id", BASE_META);
    await writeChat("bucket-b", "dup-id", BASE_META);
    const { entries, unreadable } = await readCursorSessions(undefined, opts());
    expect(entries).toHaveLength(0);
    expect(unreadable).toBe(2);
  });

  it("omits the ambiguous id from point lookup too", async () => {
    await writeChat("bucket-a", "dup-id", BASE_META);
    await writeChat("bucket-b", "dup-id", BASE_META);
    expect(await readCursorEntry("dup-id", opts())).toBeNull();
  });
});

describe("readCursorSessions: id and path safety", () => {
  it("counts a traversal-shaped directory id unreadable without accessing its paths", async () => {
    await writeChat("bucket-a", "..hidden-id", BASE_META);
    const deps = createPassthroughFs();
    const { entries, unreadable } = await readCursorSessions(undefined, opts(deps));
    expect(entries).toHaveLength(0);
    expect(unreadable).toBe(1);
    expect(deps.stat).not.toHaveBeenCalled();
    expect(deps.open).not.toHaveBeenCalled();
  });

  it("rejects an id containing '..' even when it matches the filename charset", async () => {
    expect(await readCursorEntry("a..b", opts())).toBeNull();
  });
});

describe("readCursorSessions: bounded read, not trusted-stat sized", () => {
  it("accepts a meta.json exactly at the 64 KiB bound", async () => {
    const dir = path.join(chatsDir, "bucket-a", "chat-exact-max");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "meta.json"), metaAtExactSize(MAX_META_BYTES), "utf8");
    await fs.writeFile(path.join(dir, "store.db"), "x", "utf8");
    const stat = await fs.stat(path.join(dir, "meta.json"));
    expect(stat.size).toBe(MAX_META_BYTES);

    const { entries, unreadable } = await readCursorSessions(undefined, opts());
    expect(entries).toHaveLength(1);
    expect(unreadable).toBe(0);
  });

  it("rejects a meta.json exactly one byte over the 64 KiB bound", async () => {
    const dir = path.join(chatsDir, "bucket-a", "chat-over-max");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "meta.json"), metaAtExactSize(MAX_META_BYTES + 1), "utf8");
    await fs.writeFile(path.join(dir, "store.db"), "x", "utf8");
    const stat = await fs.stat(path.join(dir, "meta.json"));
    expect(stat.size).toBe(MAX_META_BYTES + 1);

    const { entries, unreadable } = await readCursorSessions(undefined, opts());
    expect(entries).toHaveLength(0);
    expect(unreadable).toBe(1);
  });

  it("rejects a file that GROWS past the bound after being stat'd, via the read cap itself", async () => {
    // Regression for the stat-then-read TOCTOU gap: the read must reject
    // overflow on its own, independent of whatever stat() reported earlier.
    const dir = path.join(chatsDir, "bucket-a", "chat-grows");
    await fs.mkdir(dir, { recursive: true });
    const metaPath = path.join(dir, "meta.json");
    await fs.writeFile(metaPath, metaAtExactSize(1024), "utf8"); // small at first stat
    await fs.writeFile(path.join(dir, "store.db"), "x", "utf8");

    const deps = createPassthroughFs();
    (deps.stat as ReturnType<typeof vi.fn>).mockImplementationOnce(async (p: string) => {
      const before = await fs.stat(p); // the small, pre-growth stamp
      if (p === metaPath) {
        // Grow the file to exceed the bound AFTER stat() but BEFORE the
        // reader's subsequent open/read — simulating a concurrent writer.
        await fs.writeFile(metaPath, metaAtExactSize(MAX_META_BYTES + 10), "utf8");
      }
      return before;
    });

    const { entries, unreadable } = await readCursorSessions(undefined, opts(deps));
    expect(entries).toHaveLength(0);
    expect(unreadable).toBe(1);
  });
});

describe("readCursorSessions: regular-file requirement (no directory stat/read)", () => {
  it("rejects a meta.json path that is actually a directory", async () => {
    const dir = path.join(chatsDir, "bucket-a", "chat-meta-dir");
    await fs.mkdir(path.join(dir, "meta.json"), { recursive: true });
    await fs.writeFile(path.join(dir, "store.db"), "x", "utf8");
    const { entries, unreadable } = await readCursorSessions(undefined, opts());
    expect(entries).toHaveLength(0);
    expect(unreadable).toBe(1);
  });

  it("treats a directory named store.db as absent (excluded, not counted unreadable)", async () => {
    const dir = path.join(chatsDir, "bucket-a", "chat-db-dir");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(BASE_META), "utf8");
    await fs.mkdir(path.join(dir, "store.db"));
    const { entries, unreadable } = await readCursorSessions(undefined, opts());
    expect(entries).toHaveLength(0);
    expect(unreadable).toBe(0);
  });

  it("resolves point lookup to null when meta.json is a directory", async () => {
    const dir = path.join(chatsDir, "bucket-a", "chat-meta-dir-entry");
    await fs.mkdir(path.join(dir, "meta.json"), { recursive: true });
    await fs.writeFile(path.join(dir, "store.db"), "x", "utf8");
    expect(await readCursorEntry("chat-meta-dir-entry", opts())).toBeNull();
  });

  it("resolves point lookup to null when store.db is a directory (not eligible)", async () => {
    const dir = path.join(chatsDir, "bucket-a", "chat-db-dir-entry");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(BASE_META), "utf8");
    await fs.mkdir(path.join(dir, "store.db"));
    expect(await readCursorEntry("chat-db-dir-entry", opts())).toBeNull();
  });
});

describe("readCursorSessions: store.db content is never opened or read", () => {
  it("never calls open with the store.db path — only stat proves its presence", async () => {
    await writeChat("bucket-a", "chat-db-untouched", BASE_META);
    const dbPath = path.join(chatsDir, "bucket-a", "chat-db-untouched", "store.db");
    const deps = createPassthroughFs();

    const { entries } = await readCursorSessions(undefined, opts(deps));
    expect(entries).toHaveLength(1);
    const openMock = deps.open as ReturnType<typeof vi.fn>;
    expect(openMock.mock.calls.some((args: unknown[]) => args[0] === dbPath)).toBe(false);
    const statMock = deps.stat as ReturnType<typeof vi.fn>;
    expect(statMock.mock.calls.some((args: unknown[]) => args[0] === dbPath)).toBe(true);
  });
});

describe("readCursorSessions: cache reuse and fallback", () => {
  it("reuses the cached entry object (skips re-parsing meta.json) when unchanged", async () => {
    await writeChat("bucket-a", "chat-cached", BASE_META);
    const first = await readCursorSessions(undefined, opts());
    expect(first.entries).toHaveLength(1);
    expect(first.cache.kind).toBe("cursor-files");

    // No mutation between calls: a stamp+db-presence match must return the SAME
    // entry object built on the first read, not a freshly mapped one — the only
    // way `mapCursorMeta` is skipped on the second call.
    const second = await readCursorSessions(first.cache, opts());
    expect(second.entries).toHaveLength(1);
    expect(second.entries[0]).toBe(first.entries[0]);
  });

  it("re-reads when the meta stamp changes (mtime/size)", async () => {
    await writeChat("bucket-a", "chat-refresh", BASE_META);
    const first = await readCursorSessions(undefined, opts());
    expect(first.entries[0].title).toBe("Fix the flaky test");

    await new Promise((r) => setTimeout(r, 5));
    const metaPath = path.join(chatsDir, "bucket-a", "chat-refresh", "meta.json");
    await fs.writeFile(metaPath, JSON.stringify({ ...BASE_META, title: "Updated title" }), "utf8");

    const second = await readCursorSessions(first.cache, opts());
    expect(second.entries).toHaveLength(1);
    expect(second.entries[0].title).toBe("Updated title");
  });

  it("does not cache an excluded chat, so it stays excluded across refreshes", async () => {
    await writeChat("bucket-a", "chat-excluded", { ...BASE_META, hasConversation: false });
    const first = await readCursorSessions(undefined, opts());
    expect(first.entries).toHaveLength(0);
    const cache = first.cache as Extract<ReaderListCache, { kind: "cursor-files" }>;
    expect(cache.chats["chat-excluded"]).toBeUndefined();
    const second = await readCursorSessions(first.cache, opts());
    expect(second.entries).toHaveLength(0);
  });

  it("drops a chat from the list once its store.db is removed, re-reading eligibility", async () => {
    await writeChat("bucket-a", "chat-db-removed", BASE_META);
    const first = await readCursorSessions(undefined, opts());
    expect(first.entries).toHaveLength(1);

    await fs.rm(path.join(chatsDir, "bucket-a", "chat-db-removed", "store.db"));
    const second = await readCursorSessions(first.cache, opts());
    expect(second.entries).toHaveLength(0);
  });

  it("refreshes only the hinted Cursor source while preserving other source metadata", async () => {
    const chatDir = await writeChat("bucket-a", "chat-1", BASE_META);
    await writeIdeHeader("IDE one");
    const first = await readCursorSessions(undefined, opts());
    const firstCli = first.entries.find((entry) => entry.source === "cli");
    expect(first.entries.map((entry) => entry.title).sort()).toEqual(["Fix the flaky test", "IDE one"]);

    await writeIdeHeader("IDE two");
    const projectFile = path.join(projectsDir, "bucket-a", "agent-transcripts", "chat-1.jsonl");
    await fs.mkdir(path.dirname(projectFile), { recursive: true });
    await fs.writeFile(projectFile, "{}\n");
    const deps = createPassthroughFs();
    const ideRefresh = await readCursorSessions(first.cache, opts(deps), {
      paths: [projectFile, `${ideDbPath}-wal`],
    });
    expect(ideRefresh.entries.map((entry) => entry.title).sort()).toEqual(["Fix the flaky test", "IDE two"]);
    expect(ideRefresh.entries.find((entry) => entry.source === "cli")).toBe(firstCli);
    expect(deps.stat).not.toHaveBeenCalled();
    expect(deps.open).not.toHaveBeenCalled();

    await fs.rm(ideDbPath);
    await fs.writeFile(path.join(chatDir, "meta.json"), JSON.stringify({ ...BASE_META, title: "CLI two" }), "utf8");
    const cliRefresh = await readCursorSessions(ideRefresh.cache, opts(), {
      paths: [path.join(chatDir, "meta.json")],
    });
    expect(cliRefresh.entries.map((entry) => entry.title).sort()).toEqual(["CLI two", "IDE two"]);

    const ideDelete = await readCursorSessions(cliRefresh.cache, opts(), { paths: [ideDbPath] });
    expect(ideDelete.entries.map((entry) => entry.title)).toEqual(["CLI two"]);
  });

  it("keeps list metadata unchanged for project transcript-only hints", async () => {
    const chatDir = await writeChat("bucket-a", "chat-1", BASE_META);
    await writeIdeHeader("IDE one");
    const first = await readCursorSessions(undefined, opts());
    const projectFile = path.join(projectsDir, "bucket-a", "agent-transcripts", "chat-1.jsonl");
    await fs.mkdir(path.dirname(projectFile), { recursive: true });
    await fs.writeFile(projectFile, "{}\n");
    await Promise.all([fs.rm(chatDir, { recursive: true }), fs.rm(ideDbPath)]);

    const refreshed = await readCursorSessions(first.cache, opts(), { paths: [projectFile] });

    expect(refreshed.entries).toEqual(first.entries);
    expect(refreshed.cache).toEqual(first.cache);
  });

  it("targeted refresh resolves persisted bucket locations without enumerating historical buckets", async () => {
    const changedDir = await writeChat("bucket-a", "chat-changed", BASE_META);
    const untouchedDir = await writeChat("bucket-z", "chat-untouched", { ...BASE_META, title: "Untouched" });
    const pathsFs = createPassthroughPathFs();
    const first = await readCursorSessions(undefined, opts(undefined, pathsFs));
    const firstCache = first.cache as Extract<ReaderListCache, { kind: "cursor-files" }>;
    expect(firstCache.locations).toEqual({
      byId: { "chat-changed": ["bucket-a"], "chat-untouched": ["bucket-z"] },
      overflowed: false,
    });
    const deps = createPassthroughFs();
    (pathsFs.readdir as ReturnType<typeof vi.fn>).mockClear();
    (pathsFs.stat as ReturnType<typeof vi.fn>).mockClear();

    await fs.writeFile(path.join(changedDir, "meta.json"), JSON.stringify({ ...BASE_META, title: "Changed" }), "utf8");
    const second = await readCursorSessions(first.cache, opts(deps, pathsFs), {
      paths: [path.join(changedDir, "meta.json")],
    });

    expect(second.entries.map((entry) => entry.title).sort()).toEqual(["Changed", "Untouched"]);
    expect(pathsFs.readdir).not.toHaveBeenCalled();
    expect(pathsFs.stat).toHaveBeenCalledTimes(1);
    expect(pathsFs.stat).toHaveBeenCalledWith(changedDir);
    const touched = [
      ...(deps.stat as ReturnType<typeof vi.fn>).mock.calls,
      ...(deps.open as ReturnType<typeof vi.fn>).mock.calls,
    ].map(([filePath]) => filePath as string);
    expect(touched.some((filePath) => filePath.startsWith(untouchedDir))).toBe(false);
    expect(touched.some((filePath) => filePath === path.join(changedDir, "meta.json"))).toBe(true);
    expect(touched.some((filePath) => filePath === path.join(changedDir, "store.db"))).toBe(true);
  });

  it.each([
    ["missing", undefined],
    ["malformed", { byId: { "chat-changed": [42] }, overflowed: false }],
    ["overflowed", { byId: {}, overflowed: true }],
  ])("promotes %s persisted location state to a complete safe scan", async (_reason, locations) => {
    const changedDir = await writeChat("bucket-a", "chat-changed", BASE_META);
    const pathsFs = createPassthroughPathFs();
    const first = await readCursorSessions(undefined, opts(undefined, pathsFs));
    const stale = {
      ...(first.cache as Extract<ReaderListCache, { kind: "cursor-files" }>),
      locations,
    } as unknown as ReaderListCache;
    (pathsFs.readdir as ReturnType<typeof vi.fn>).mockClear();

    await fs.writeFile(path.join(changedDir, "meta.json"), JSON.stringify({ ...BASE_META, title: "Changed" }), "utf8");
    const refreshed = await readCursorSessions(stale, opts(undefined, pathsFs), {
      paths: [path.join(changedDir, "meta.json")],
    });

    expect(refreshed.entries[0].title).toBe("Changed");
    expect(pathsFs.readdir).toHaveBeenCalledWith(chatsDir, { withFileTypes: true });
  });

  it("targeted create and store deletion add then remove only the affected chat", async () => {
    await writeChat("bucket-a", "chat-untouched", { ...BASE_META, title: "Untouched" });
    const first = await readCursorSessions(undefined, opts());
    const createdDir = await writeChat("bucket-a", "chat-created", { ...BASE_META, title: "Created" });
    const afterCreate = await readCursorSessions(first.cache, opts(), {
      paths: [path.join(createdDir, "meta.json")],
    });
    expect(afterCreate.entries.map((entry) => entry.title).sort()).toEqual(["Created", "Untouched"]);

    await fs.rm(path.join(createdDir, "store.db"));
    const afterDelete = await readCursorSessions(afterCreate.cache, opts(), {
      paths: [path.join(createdDir, "store.db")],
    });
    expect(afterDelete.entries.map((entry) => entry.title)).toEqual(["Untouched"]);
  });

  it("targeted duplicate creation omits the id, then deletion restores the remaining candidate", async () => {
    const originalDir = await writeChat("bucket-a", "chat-dup-transition", BASE_META);
    const first = await readCursorSessions(undefined, opts());
    const duplicateDir = await writeChat("bucket-b", "chat-dup-transition", BASE_META);
    const ambiguous = await readCursorSessions(first.cache, opts(), {
      paths: [path.join(duplicateDir, "meta.json")],
    });
    expect(ambiguous.entries).toEqual([]);
    expect(ambiguous.unreadable).toBe(2);

    await fs.rm(duplicateDir, { recursive: true });
    const restored = await readCursorSessions(ambiguous.cache, opts(), {
      paths: [path.join(duplicateDir, "meta.json")],
    });
    expect(restored.entries.map((entry) => entry.id)).toEqual(["cursor:chat-dup-transition"]);
    expect(restored.entries[0].cwd).toBe(BASE_META.cwd);
    expect(restored.unreadable).toBe(0);
    await expect(fs.access(path.join(originalDir, "store.db"))).resolves.toBeUndefined();
  });

  it("recounts unsafe targeted transitions exactly without statting or opening their paths", async () => {
    const firstUnsafeDir = await writeChat("bucket-a", "..unsafe-one", BASE_META);
    const first = await readCursorSessions(undefined, opts());
    expect(first.unreadable).toBe(1);

    const secondUnsafeDir = await writeChat("bucket-a", "..unsafe-two", BASE_META);
    const deps = createPassthroughFs();
    const afterCreate = await readCursorSessions(first.cache, opts(deps), {
      paths: [path.join(secondUnsafeDir, "store.db")],
    });
    expect(afterCreate.unreadable).toBe(2);

    await fs.rm(firstUnsafeDir, { recursive: true });
    const afterDelete = await readCursorSessions(afterCreate.cache, opts(deps), {
      paths: [path.join(firstUnsafeDir, "store.db")],
    });
    expect(afterDelete.unreadable).toBe(1);

    const touched = [
      ...(deps.stat as ReturnType<typeof vi.fn>).mock.calls,
      ...(deps.open as ReturnType<typeof vi.fn>).mock.calls,
    ].map(([filePath]) => filePath as string);
    expect(touched.some((filePath) => filePath.includes("..unsafe-one") || filePath.includes("..unsafe-two"))).toBe(
      false,
    );
  });
});

describe("readCursorEntry: point lookup", () => {
  it("resolves a single eligible chat by id", async () => {
    await writeChat("bucket-a", "chat-solo", BASE_META);
    const entry = await readCursorEntry("chat-solo", opts());
    expect(entry?.id).toBe("cursor:chat-solo");
    expect((entry as { canResume?: boolean } | null)?.canResume).toBe(true);
  });

  it("returns null for an unknown id", async () => {
    expect(await readCursorEntry("nope", opts())).toBeNull();
  });

  it("returns null for an ineligible chat", async () => {
    await writeChat("bucket-a", "chat-ineligible", { ...BASE_META, hasConversation: false });
    expect(await readCursorEntry("chat-ineligible", opts())).toBeNull();
  });
});

describe("readCursorDetail: bounded CLI transcript", () => {
  it("returns a decoded timeline for a compatible store", async () => {
    const dir = await writeChat("bucket-a", "chat-detail-ok", BASE_META);
    await fs.rm(path.join(dir, "store.db"));
    await writeCompatibleStore(dir, "chat-detail-ok", [
      { role: "user", content: "Please inspect it" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Done" },
          { type: "tool_use", name: "Read", input: { file_path: "/tmp/file.ts" } },
        ],
      },
    ]);

    const detail = await readCursorDetail("chat-detail-ok", undefined, opts());
    expect(detail?.partial).toBe(false);
    expect(detail?.contentKind).toBe("timeline");
    expect(detail?.timeline.map((item) => item.kind)).toEqual(["message", "message", "tool"]);
    expect(detail?.timeline.every((item) => !("msgRef" in item))).toBe(true);
    expect(detail?.stats).toEqual({ messageCount: 2, toolCount: 1, subagentCount: 0 });
  });

  it("uses a matching project transcript as a detail fallback without duplicating the CLI row", async () => {
    await writeChat("bucket-a", "chat-jsonl", BASE_META);
    await writeProjectTranscript("project-a", "chat-jsonl", [
      { role: "user", message: { content: [{ type: "text", text: "From mirror" }] } },
      {
        role: "assistant",
        message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/tmp/mirror.ts" } }] },
      },
    ]);

    const listed = await readCursorSessions(undefined, opts());
    expect(listed.entries.filter((entry) => entry.sessionId === "chat-jsonl")).toHaveLength(1);

    const detail = await readCursorDetail("chat-jsonl", undefined, opts());
    expect(detail?.contentKind).toBe("timeline");
    expect(detail?.timeline).toEqual([
      { kind: "message", role: "user", text: "From mirror" },
      { kind: "tool", tool: "Read", detail: "/tmp/mirror.ts" },
    ]);
  });

  it("marks a limited timeline truncated while keeping recent activity independently capped at 12", async () => {
    const dir = await writeChat("bucket-a", "chat-detail-limit", BASE_META);
    await fs.rm(path.join(dir, "store.db"));
    await writeCompatibleStore(
      dir,
      "chat-detail-limit",
      Array.from({ length: 15 }, (_, index) => ({
        role: "assistant",
        content: [
          { type: "text", text: `message ${index}` },
          { type: "tool_use", name: `Tool${index}`, input: { path: `/tmp/${index}` } },
        ],
      })),
    );

    const detail = await readCursorDetail("chat-detail-limit", 3, opts());
    expect(detail?.timeline).toHaveLength(3);
    expect(detail?.truncated).toBe(true);
    expect(detail?.recentActivity).toHaveLength(12);
    expect(detail?.recentActivity[0]).toMatchObject({ kind: "tool", tool: "Tool3" });
    expect(detail?.recentActivity[11]).toMatchObject({ kind: "tool", tool: "Tool14" });
  });

  it("returns a partial detail with an empty timeline and a limited-reason notice", async () => {
    await writeChat("bucket-a", "chat-detail", BASE_META);
    const detail = await readCursorDetail("chat-detail", undefined, opts());
    expect(detail?.entryId).toBe("cursor:chat-detail");
    expect(detail?.partial).toBe(true);
    expect(typeof detail?.limitedReason).toBe("string");
    expect(detail?.limitedReason?.length).toBeGreaterThan(0);
    expect(detail?.timeline).toEqual([]);
    expect(detail?.recentActivity).toEqual([]);
    expect(detail?.stats).toEqual({ messageCount: 0, toolCount: 0, subagentCount: 0 });
  });

  it("returns null when the chat cannot be resolved", async () => {
    expect(await readCursorDetail("missing", undefined, opts())).toBeNull();
  });
});

describe("readCursorMessageRecord: no raw-record access to store.db", () => {
  it("always reports not-found, never opening store.db", async () => {
    await writeChat("bucket-a", "chat-record", BASE_META);
    const result = await readCursorMessageRecord("chat-record", "#1");
    expect(result).toEqual({ ok: false, reason: "not-found" });
  });
});
