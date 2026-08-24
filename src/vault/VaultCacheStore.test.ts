// src/vault/VaultCacheStore.test.ts — Round-trip, corruption, and atomic-write
// behavior of the vault list cache (cache-vault-load task 1_1).

import { beforeEach, describe, expect, it } from "vitest";
import type * as vscode from "vscode";
import type { FsLike } from "../session/SessionStorage";
import {
  MAX_CURSOR_IDE_CACHE_ENTRIES,
  MAX_CURSOR_IDE_SOURCE_STAMPS,
  MAX_CURSOR_LOCATION_IDS,
  MAX_CURSOR_PROJECT_CACHE_ENTRIES,
  VAULT_CACHE_VERSION,
  type VaultListCacheFileV1,
} from "./cacheTypes";
import { VaultCacheStore } from "./VaultCacheStore";

/** In-memory FsLike: records the temp/rename sequence and the modes used. */
function makeFakeFs() {
  const files = new Map<string, string>();
  const writeOrder: string[] = [];
  const renameOrder: Array<[string, string]> = [];
  const writeModes: Array<number | undefined> = [];
  let mkdirMode: number | undefined;

  const fs = {
    existsSync: (file: string) => files.has(file),
    readFileSync: (file: string) => {
      const v = files.get(file);
      if (v === undefined) {
        throw new Error(`ENOENT: ${file}`);
      }
      return v;
    },
    // Unused by VaultCacheStore but required by the FsLike shape.
    writeFileSync: () => undefined,
    mkdirSync: () => undefined,
    unlinkSync: (file: string) => void files.delete(file),
    readdirSync: () => [],
    renameSync: () => undefined,
    promises: {
      mkdir: async (_dir: string, opts?: { mode?: number }) => {
        mkdirMode = opts?.mode;
        return undefined;
      },
      writeFile: async (file: string, data: string, opts?: { mode?: number }) => {
        files.set(file, data);
        writeOrder.push(file);
        writeModes.push(opts?.mode);
      },
      readFile: async (file: string) => files.get(file) ?? "",
      unlink: async (file: string) => void files.delete(file),
      rename: async (from: string, to: string) => {
        const v = files.get(from);
        if (v === undefined) {
          throw new Error(`ENOENT rename: ${from}`);
        }
        files.set(to, v);
        files.delete(from);
        renameOrder.push([from, to]);
      },
    },
  } satisfies FsLike;

  return {
    fs,
    files,
    writeOrder,
    renameOrder,
    writeModes,
    get mkdirMode() {
      return mkdirMode;
    },
  };
}

const globalStorageUri = { fsPath: "/glob" } as vscode.Uri;
const CACHE_FILE = "/glob/vault-cache/list.json";

function cursorEntry(sessionId: string, source?: "cli" | "ide") {
  return {
    id: `cursor:${sessionId}`,
    agent: "cursor" as const,
    sessionId,
    title: "Cursor chat",
    cwd: "/work",
    modified: 10,
    flags: {},
    canFork: false,
    canResume: source === "cli",
    ...(source ? { source } : {}),
  };
}

function doc(overrides: Partial<VaultListCacheFileV1> = {}): VaultListCacheFileV1 {
  return {
    version: VAULT_CACHE_VERSION,
    savedAt: 123,
    agents: {},
    entries: [
      {
        id: "claude:s1",
        agent: "claude",
        sessionId: "s1",
        title: "hello",
        cwd: "/work",
        modified: 10,
        flags: {},
        canFork: false,
      },
    ],
    unreadable: { count: 0, reasons: [] },
    ...overrides,
  };
}

describe("VaultCacheStore", () => {
  let harness: ReturnType<typeof makeFakeFs>;
  let store: VaultCacheStore;

  beforeEach(() => {
    harness = makeFakeFs();
    store = new VaultCacheStore(globalStorageUri, harness.fs);
  });

  it("returns null when no cache file exists", () => {
    expect(store.load()).toBeNull();
  });

  it("round-trips a valid v1 document", async () => {
    const d = doc();
    await store.save(d);
    expect(store.load()).toEqual(d);
  });

  it("writes to a temp path then renames onto the canonical file (atomic)", async () => {
    await store.save(doc());
    expect(harness.writeOrder).toHaveLength(1);
    expect(harness.writeOrder[0]).toMatch(/list\.json\.tmp\.\d+\.\d+$/);
    expect(harness.renameOrder).toEqual([[harness.writeOrder[0], CACHE_FILE]]);
  });

  it("uses owner-only modes (0o600 file, 0o700 dir)", async () => {
    await store.save(doc());
    expect(harness.writeModes[0]).toBe(0o600);
    expect(harness.mkdirMode).toBe(0o700);
  });

  it("treats unparseable JSON as a cache miss", () => {
    harness.files.set(CACHE_FILE, "{ not json");
    expect(store.load()).toBeNull();
  });

  it("discards an unrecognized version (→ full rebuild)", () => {
    harness.files.set(CACHE_FILE, JSON.stringify({ ...doc(), version: VAULT_CACHE_VERSION + 1 }));
    expect(store.load()).toBeNull();
  });

  it("discards stale version 5 caches without source-qualified Cursor metadata", () => {
    harness.files.set(CACHE_FILE, JSON.stringify({ ...doc(), version: 5 }));
    expect(store.load()).toBeNull();
  });

  it("discards stale version 1 caches that could contain old Codex root rows", () => {
    harness.files.set(
      CACHE_FILE,
      JSON.stringify({
        ...doc({
          entries: [
            {
              id: "codex:child-thread",
              agent: "codex",
              sessionId: "child-thread",
              title: "stale child",
              cwd: "/work",
              modified: 10,
              flags: {},
              canFork: false,
            },
          ],
        }),
        version: 1,
      }),
    );
    expect(store.load()).toBeNull();
  });

  it("discards stale version 3 caches whose Claude entries hold a first-wins permissionMode", () => {
    harness.files.set(
      CACHE_FILE,
      JSON.stringify({
        ...doc({
          entries: [
            {
              id: "claude:sess",
              agent: "claude",
              sessionId: "sess",
              title: "stale mode",
              cwd: "/work",
              modified: 10,
              flags: { permissionMode: "bypassPermissions" },
              canFork: false,
            },
          ],
        }),
        version: 3,
      }),
    );
    expect(store.load()).toBeNull();
  });

  it("rejects a structurally-invalid document (missing entries array)", () => {
    harness.files.set(CACHE_FILE, JSON.stringify({ version: VAULT_CACHE_VERSION, agents: {}, unreadable: {} }));
    expect(store.load()).toBeNull();
  });

  it("rejects a document with a malformed entry (non-string title)", () => {
    const bad = doc();
    (bad.entries[0] as unknown as { title: unknown }).title = 42;
    harness.files.set(CACHE_FILE, JSON.stringify(bad));
    expect(store.load()).toBeNull();
  });

  it("rejects a document whose unreadable.reasons is not an array", () => {
    harness.files.set(CACHE_FILE, JSON.stringify({ ...doc(), unreadable: { count: 0, reasons: "nope" } }));
    expect(store.load()).toBeNull();
  });

  it("gives each save a fresh temp id", async () => {
    await store.save(doc());
    await store.save(doc());
    expect(harness.writeOrder[0]).not.toBe(harness.writeOrder[1]);
  });

  // F2 (review round-2): a malformed per-agent `agents` cache must void the WHOLE
  // cache, never reach a reader as `prev` (where `sameStamps`/`Object.keys` would
  // throw, failing the reader and dropping the agent).
  describe("F2: agents cache validation", () => {
    it("rejects a store cache whose sources is null", () => {
      const bad = { ...doc(), agents: { codex: { kind: "store", sources: null, entries: [], unreadable: 0 } } };
      harness.files.set(CACHE_FILE, JSON.stringify(bad));
      expect(store.load()).toBeNull();
    });

    it("rejects a store cache with a non-finite unreadable", () => {
      const bad = { ...doc(), agents: { codex: { kind: "store", sources: {}, entries: [], unreadable: "x" } } };
      harness.files.set(CACHE_FILE, JSON.stringify(bad));
      expect(store.load()).toBeNull();
    });

    it("rejects a files cache whose stamp is not numeric", () => {
      const bad = {
        ...doc(),
        agents: {
          claude: {
            kind: "files",
            files: { "/a/b.jsonl": { stamp: { mtimeMs: "x", size: 1 }, entry: doc().entries[0] } },
          },
        },
      };
      harness.files.set(CACHE_FILE, JSON.stringify(bad));
      expect(store.load()).toBeNull();
    });

    it("rejects a files cache whose entry is malformed", () => {
      const badEntry = { ...doc().entries[0], title: 42 };
      const bad = {
        ...doc(),
        agents: {
          claude: { kind: "files", files: { "/a/b.jsonl": { stamp: { mtimeMs: 1, size: 2 }, entry: badEntry } } },
        },
      };
      harness.files.set(CACHE_FILE, JSON.stringify(bad));
      expect(store.load()).toBeNull();
    });

    it("rejects an unknown reader-cache discriminant", () => {
      harness.files.set(CACHE_FILE, JSON.stringify({ ...doc(), agents: { claude: { kind: "weird" } } }));
      expect(store.load()).toBeNull();
    });

    it("accepts well-formed files + store agent caches (round-trip)", async () => {
      const good = doc({
        agents: {
          claude: {
            kind: "files",
            files: { "/a/b.jsonl": { stamp: { mtimeMs: 5, size: 9 }, entry: doc().entries[0] } },
          },
          codex: { kind: "store", sources: { "/c/d.db": { mtimeMs: 1, size: 2 } }, entries: [], unreadable: 0 },
        },
      });
      await store.save(good);
      expect(store.load()).toEqual(good);
    });

    it("round-trips metadata-only CLI, project, and IDE Cursor caches", async () => {
      const cliEntry = cursorEntry("chat-1", "cli");
      const projectEntry = cursorEntry("project:YnVja2V0LWE:project-1");
      const ideEntry = cursorEntry("ide:d29ya3NwYWNlLTE:composer-1", "ide");
      const good = doc({
        agents: {
          cursor: {
            kind: "cursor-files",
            chats: {
              "chat-1": { metaStamp: { mtimeMs: 5, size: 9 }, dbPresent: true, entry: cliEntry },
            },
            locations: {
              byId: { "chat-1": ["bucket-a"], "duplicate-chat": ["bucket-a", "bucket-b"] },
              overflowed: false,
            },
            projects: {
              "/home/me/.cursor/projects/bucket-a/agent-transcripts/project-1.jsonl": {
                stamp: { mtimeMs: 6, size: 10 },
                entry: projectEntry,
              },
            },
            ide: {
              sources: {
                "/home/me/.config/Cursor/User/globalStorage/state.vscdb": { mtimeMs: 7, size: 11 },
                "/home/me/.config/Cursor/User/globalStorage/state.vscdb-wal": { mtimeMs: 8, size: 12 },
              },
              entries: [ideEntry],
              unreadable: 2,
            },
            unreadableById: { "duplicate-chat": 2 },
            rejected: 1,
          },
        },
      });
      await store.save(good);
      expect(store.load()).toEqual(good);
    });

    it("rejects transcript detail fields in persisted Cursor metadata", () => {
      const badEntry = { ...cursorEntry("chat", "cli"), timeline: [{ kind: "message", text: "private" }] };
      const bad = doc({
        agents: {
          cursor: {
            kind: "cursor-files",
            chats: { chat: { metaStamp: { mtimeMs: 1, size: 2 }, dbPresent: true, entry: badEntry } },
            locations: { byId: { chat: ["bucket-a"] }, overflowed: false },
          },
        },
      });
      harness.files.set(CACHE_FILE, JSON.stringify(bad));
      expect(store.load()).toBeNull();
    });

    it("rejects malformed or oversized project transcript metadata", () => {
      const projects = Object.fromEntries(
        Array.from({ length: MAX_CURSOR_PROJECT_CACHE_ENTRIES + 1 }, (_, index) => [
          `/tmp/project-${index}.jsonl`,
          { stamp: { mtimeMs: 1, size: 2 }, entry: cursorEntry(`project:YnVja2V0LWE:project-${index}`) },
        ]),
      );
      const bad = doc({
        agents: {
          cursor: {
            kind: "cursor-files",
            chats: {},
            locations: { byId: {}, overflowed: false },
            projects,
          },
        },
      });
      harness.files.set(CACHE_FILE, JSON.stringify(bad));
      expect(store.load()).toBeNull();
    });

    it("rejects malformed or oversized Cursor IDE metadata", () => {
      const sources = Object.fromEntries(
        Array.from({ length: MAX_CURSOR_IDE_SOURCE_STAMPS + 1 }, (_, index) => [
          `/tmp/state.vscdb-${index}`,
          { mtimeMs: 1, size: 2 },
        ]),
      );
      const entries = Array.from({ length: MAX_CURSOR_IDE_CACHE_ENTRIES + 1 }, (_, index) =>
        cursorEntry(`ide:d29ya3NwYWNlLTE:composer-${index}`, "ide"),
      );
      const bad = doc({
        agents: {
          cursor: {
            kind: "cursor-files",
            chats: {},
            locations: { byId: {}, overflowed: false },
            ide: { sources, entries, unreadable: 0 },
          },
        },
      });
      harness.files.set(CACHE_FILE, JSON.stringify(bad));
      expect(store.load()).toBeNull();
    });

    it("rejects a Cursor cache entry with a non-boolean canResume capability", () => {
      const badEntry = {
        ...cursorEntry("chat", "cli"),
        canResume: "false",
      };
      const bad = doc({
        agents: {
          cursor: {
            kind: "cursor-files",
            chats: { chat: { metaStamp: { mtimeMs: 1, size: 2 }, dbPresent: true, entry: badEntry as never } },
            locations: { byId: { chat: ["bucket-a"] }, overflowed: false },
          },
        },
      });
      harness.files.set(CACHE_FILE, JSON.stringify(bad));
      expect(store.load()).toBeNull();
    });

    it("rejects an oversized Cursor location index", () => {
      const byId = Object.fromEntries(
        Array.from({ length: MAX_CURSOR_LOCATION_IDS + 1 }, (_, index) => [`chat-${index}`, ["bucket-a"]]),
      );
      const bad = doc({
        agents: { cursor: { kind: "cursor-files", chats: {}, locations: { byId, overflowed: false } } },
      });
      harness.files.set(CACHE_FILE, JSON.stringify(bad));
      expect(store.load()).toBeNull();
    });

    it.each([
      ["missing chats", { kind: "cursor-files", locations: { byId: {}, overflowed: false }, rejected: 0 }],
      ["missing locations", { kind: "cursor-files", chats: {}, rejected: 0 }],
      [
        "malformed location buckets",
        { kind: "cursor-files", chats: {}, locations: { byId: { chat: [42] }, overflowed: false } },
      ],
      [
        "non-boolean database presence",
        {
          kind: "cursor-files",
          chats: { chat: { metaStamp: { mtimeMs: 1, size: 2 }, dbPresent: "yes", entry: doc().entries[0] } },
          locations: { byId: { chat: ["bucket-a"] }, overflowed: false },
        },
      ],
      [
        "malformed metadata stamp",
        {
          kind: "cursor-files",
          chats: { chat: { metaStamp: { mtimeMs: "x", size: 2 }, dbPresent: true, entry: doc().entries[0] } },
          locations: { byId: { chat: ["bucket-a"] }, overflowed: false },
        },
      ],
      [
        "malformed entry",
        {
          kind: "cursor-files",
          chats: {
            chat: { metaStamp: { mtimeMs: 1, size: 2 }, dbPresent: true, entry: { ...doc().entries[0], title: 42 } },
          },
          locations: { byId: { chat: ["bucket-a"] }, overflowed: false },
        },
      ],
      [
        "negative unreadable count",
        { kind: "cursor-files", chats: {}, locations: { byId: {}, overflowed: false }, unreadableById: { chat: -1 } },
      ],
      [
        "non-finite unreadable count",
        { kind: "cursor-files", chats: {}, locations: { byId: {}, overflowed: false }, unreadableById: { chat: "x" } },
      ],
      [
        "negative rejected count",
        { kind: "cursor-files", chats: {}, locations: { byId: {}, overflowed: false }, rejected: -1 },
      ],
      [
        "non-finite rejected count",
        { kind: "cursor-files", chats: {}, locations: { byId: {}, overflowed: false }, rejected: "x" },
      ],
    ])("rejects a Cursor cache with %s", (_reason, cursorCache) => {
      harness.files.set(CACHE_FILE, JSON.stringify({ ...doc(), agents: { cursor: cursorCache } }));
      expect(store.load()).toBeNull();
    });
  });

  // F-Win (review round-2): rename onto list.json retries the transient lock errors
  // common on Windows (EPERM/EBUSY/EACCES), and a final failure unlinks the spool so
  // no titles+cwds leak in a temp file until the next activate cleanup.
  describe("F-Win: rename retry + temp cleanup", () => {
    function errno(code: string): NodeJS.ErrnoException {
      const e = new Error(code) as NodeJS.ErrnoException;
      e.code = code;
      return e;
    }

    it("retries a transient EPERM and commits on a later attempt", async () => {
      const h = makeFakeFs();
      const realRename = h.fs.promises.rename;
      let attempts = 0;
      h.fs.promises.rename = async (from: string, to: string) => {
        attempts++;
        if (attempts < 3) {
          throw errno("EPERM");
        }
        return realRename(from, to);
      };
      const s = new VaultCacheStore(globalStorageUri, h.fs);
      await s.save(doc());
      expect(attempts).toBe(3);
      expect(h.files.has(CACHE_FILE)).toBe(true);
      expect([...h.files.keys()].some((k) => k.includes("list.json.tmp."))).toBe(false);
    });

    it("gives up after max attempts on a persistent lock error and unlinks the temp", async () => {
      const h = makeFakeFs();
      h.fs.promises.rename = async () => {
        throw errno("EBUSY");
      };
      const s = new VaultCacheStore(globalStorageUri, h.fs);
      await expect(s.save(doc())).rejects.toThrow();
      expect(h.files.has(CACHE_FILE)).toBe(false);
      expect([...h.files.keys()].some((k) => k.includes("list.json.tmp."))).toBe(false);
    });

    it("does NOT retry a non-transient error and unlinks the temp", async () => {
      const h = makeFakeFs();
      let calls = 0;
      h.fs.promises.rename = async () => {
        calls++;
        throw errno("ENOSPC");
      };
      const s = new VaultCacheStore(globalStorageUri, h.fs);
      await expect(s.save(doc())).rejects.toThrow();
      expect(calls).toBe(1);
      expect([...h.files.keys()].some((k) => k.includes("list.json.tmp."))).toBe(false);
    });
  });
});
