import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SqliteSnapshot, withSqliteSnapshot } from "../sqlite";
import {
  cursorIdeDbPath,
  lookupCursorIdeEntry,
  readCursorIdeDetail,
  readCursorIdeEntry,
  readCursorIdeSessions,
} from "./cursorIdeReader";
import { readCursorDetail, readCursorSessions } from "./cursorReader";
import { limitedDetail } from "./detail";
import { expectDetailContract, expectLimitGrowth } from "./detailContract.testkit";

let root: string;
let dbPath: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "anywhere-cursor-ide-"));
  dbPath = path.join(root, "state.vscdb");
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

interface ComposerFixture {
  id: string;
  workspaceId?: string;
  cwd?: string;
  name?: string;
  archived?: boolean;
  composerData?: boolean;
  headers?: Array<{ bubbleId: string; type: number }>;
  bubbles?: Record<string, Record<string, unknown>>;
}

async function writeIdeStore(fixtures: ComposerFixture[]): Promise<void> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("CREATE TABLE cursorDiskKV(key TEXT PRIMARY KEY, value BLOB NOT NULL)");
    db.exec(`CREATE TABLE composerHeaders(
      composerId TEXT PRIMARY KEY,
      workspaceId TEXT,
      createdAt INTEGER,
      lastUpdatedAt INTEGER,
      isArchived INTEGER,
      isSubagent INTEGER,
      value TEXT
    )`);
    const insert = db.prepare("INSERT INTO cursorDiskKV(key, value) VALUES (?, ?)");
    const insertHeader = db.prepare(
      "INSERT INTO composerHeaders(composerId, workspaceId, createdAt, lastUpdatedAt, isArchived, isSubagent, value) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (const fixture of fixtures) {
      const headers = fixture.headers ?? [
        { bubbleId: "user-1", type: 1 },
        { bubbleId: "assistant-1", type: 2 },
      ];
      const workspaceId = fixture.workspaceId ?? "workspace-1";
      const header = {
        composerId: fixture.id,
        name: fixture.name ?? "Composer chat",
        isArchived: fixture.archived ?? false,
        isDraft: false,
        workspaceIdentifier: {
          id: workspaceId,
          uri: { fsPath: fixture.cwd ?? "/Users/me/project" },
        },
      };
      insertHeader.run(fixture.id, workspaceId, 1000, 2000, fixture.archived ? 1 : 0, 0, JSON.stringify(header));
      if (fixture.composerData !== false) {
        insert.run(
          `composerData:${fixture.id}`,
          Buffer.from(
            JSON.stringify({
              composerId: fixture.id,
              createdAt: 1000,
              lastUpdatedAt: 2000,
              fullConversationHeadersOnly: headers,
              unknownFutureField: { tolerated: true },
            }),
            "utf8",
          ),
        );
        for (const [bubbleId, bubble] of Object.entries(
          fixture.bubbles ?? {
            "user-1": { bubbleId: "user-1", text: "Question", createdAt: 1100 },
            "assistant-1": { bubbleId: "assistant-1", text: "Answer", createdAt: 1200 },
          },
        )) {
          insert.run(`bubbleId:${fixture.id}:${bubbleId}`, Buffer.from(JSON.stringify(bubble), "utf8"));
        }
      }
    }
  } finally {
    db.close();
  }
}

describe("Cursor IDE Composer list", () => {
  it("emits source-qualified, previewable, non-resumable entries", async () => {
    await writeIdeStore([{ id: "composer-1", workspaceId: "workspace-1", cwd: "/Users/me/project" }]);

    const result = await readCursorIdeSessions({ ideDbPath: dbPath });

    expect(result.unreadable).toBe(0);
    expect(result.sources[dbPath]).toMatchObject({ size: expect.any(Number), mtimeMs: expect.any(Number) });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      id: "cursor:ide:d29ya3NwYWNlLTE:composer-1",
      agent: "cursor",
      sessionId: "ide:d29ya3NwYWNlLTE:composer-1",
      title: "Composer chat",
      cwd: "/Users/me/project",
      modified: 2000,
      canResume: false,
      canFork: false,
      source: "ide",
    });
  });

  it("rejects duplicate source identities from a malformed snapshot", async () => {
    const value = JSON.stringify({
      composerId: "composer-1",
      name: "Duplicate",
      workspaceIdentifier: { id: "workspace-1", uri: { fsPath: "/Users/me/project" } },
    });
    const row = {
      composerId: "composer-1",
      workspaceId: "workspace-1",
      createdAt: 1000,
      lastUpdatedAt: 2000,
      isArchived: 0,
      isSubagent: 0,
      value,
    };
    const duplicateSnapshot = (async (_path: string, callback: (snapshot: SqliteSnapshot) => Promise<unknown>) => {
      const snapshot: SqliteSnapshot = {
        query: async () => ({ status: "ok", rows: [row, row] }),
      };
      return { status: "ok", value: await callback(snapshot) };
    }) as typeof withSqliteSnapshot;

    await expect(
      readCursorIdeSessions({ ideDbPath: dbPath, withSqliteSnapshotFn: duplicateSnapshot }),
    ).resolves.toEqual({
      entries: [],
      unreadable: 2,
      sources: {},
    });
  });

  it("integrates IDE entries and details through the combined Cursor reader", async () => {
    await writeIdeStore([{ id: "composer-1" }]);
    const chatsDir = path.join(root, "chats");
    const projectsDir = path.join(root, "projects");
    await Promise.all([fs.mkdir(chatsDir), fs.mkdir(projectsDir)]);

    const listed = await readCursorSessions(undefined, { chatsDir, projectsDir, ideDbPath: dbPath });
    expect(listed.entries.map((entry) => entry.sessionId)).toEqual(["ide:d29ya3NwYWNlLTE:composer-1"]);

    const detail = await readCursorDetail("ide:d29ya3NwYWNlLTE:composer-1", undefined, {
      chatsDir,
      projectsDir,
      ideDbPath: dbPath,
    });
    expect(detail?.contentKind).toBe("timeline");
    expect(detail?.timeline.map((item) => item.kind)).toEqual(["message", "message"]);
  });

  it("skips archived, malformed, and cwd-less composers without failing the provider", async () => {
    await writeIdeStore([{ id: "archived", archived: true }, { id: "no-cwd", cwd: "relative/path" }, { id: "valid" }]);

    const result = await readCursorIdeSessions({ ideDbPath: dbPath });
    expect(result.entries.map((entry) => entry.sessionId)).toEqual(["ide:d29ya3NwYWNlLTE:valid"]);
    expect(result.unreadable).toBe(1);
  });

  it("returns an empty result for a missing store and degrades query failure", async () => {
    await expect(readCursorIdeSessions({ ideDbPath: dbPath })).resolves.toEqual({
      entries: [],
      unreadable: 0,
      sources: {},
    });

    const failedSnapshot = (async () => ({
      status: "query-error" as const,
      error: "locked",
    })) as typeof withSqliteSnapshot;
    await expect(readCursorIdeSessions({ ideDbPath: dbPath, withSqliteSnapshotFn: failedSnapshot })).resolves.toEqual({
      entries: [],
      unreadable: 1,
      sources: {},
    });
  });
});

describe("Cursor IDE Composer detail", () => {
  it("keeps header-only sessions previewable with metadata fallback", async () => {
    await writeIdeStore([{ id: "composer-1", composerData: false }]);
    const sessionId = "ide:d29ya3NwYWNlLTE:composer-1";

    await expect(readCursorIdeEntry(sessionId, { ideDbPath: dbPath })).resolves.toMatchObject({ source: "ide" });
    await expect(readCursorIdeDetail(sessionId, undefined, { ideDbPath: dbPath })).resolves.toMatchObject({
      contentKind: "metadata-only",
      partial: true,
      timeline: [],
    });
  });

  it("builds the metadata fallback through the shared constructor, field for field", async () => {
    // Deep equality, so a hand-written literal that drifts from `limitedDetail`
    // — a stray `truncated`, a missing `contentKind` — fails here rather than
    // surviving as a second definition of the limited view.
    await writeIdeStore([{ id: "composer-1", composerData: false }]);
    const sessionId = "ide:d29ya3NwYWNlLTE:composer-1";
    const detail = await readCursorIdeDetail(sessionId, undefined, { ideDbPath: dbPath });
    expect(detail).toEqual(limitedDetail(`cursor:${sessionId}`, detail?.limitedReason ?? ""));
    // Deep equality alone cannot catch a drift inside `limitedDetail` itself —
    // both sides move together — so state the contract independently.
    expectDetailContract(detail, "cursor ide metadata-only");
  });

  it("satisfies the shared detail contract, and pages to the end", async () => {
    const headers = Array.from({ length: 60 }, (_v, i) => ({ bubbleId: `b${i}`, type: i % 2 === 0 ? 1 : 2 }));
    const bubbles = Object.fromEntries(
      headers.map((h, i) => [h.bubbleId, { bubbleId: h.bubbleId, text: `turn ${i}`, createdAt: 1000 + i }]),
    );
    await writeIdeStore([{ id: "composer-1", headers, bubbles }]);
    const sessionId = "ide:d29ya3NwYWNlLTE:composer-1";
    const read = (limit?: number) => readCursorIdeDetail(sessionId, limit, { ideDbPath: dbPath });

    expectDetailContract(await read(), "cursor ide");
    await expectLimitGrowth((limit) => read(limit), { start: 8, label: "cursor ide" });
  });

  it("renders headers in order, skips thought bubbles, and normalizes tool activity", async () => {
    await writeIdeStore([
      {
        id: "composer-1",
        headers: [
          { bubbleId: "user-1", type: 1 },
          { bubbleId: "thought-1", type: 2 },
          { bubbleId: "tool-1", type: 2 },
          { bubbleId: "assistant-1", type: 2 },
        ],
        bubbles: {
          "user-1": { bubbleId: "user-1", text: "Question", createdAt: 1100 },
          "thought-1": { bubbleId: "thought-1", text: "hidden", isThought: true },
          "tool-1": {
            bubbleId: "tool-1",
            text: "tool output",
            toolFormerData: { name: "read_file", rawArgs: JSON.stringify({ file_path: "/tmp/a.ts" }) },
          },
          "assistant-1": { bubbleId: "assistant-1", text: "Answer", createdAt: "1970-01-01T00:00:01.200Z" },
        },
      },
    ]);
    const sessionId = "ide:d29ya3NwYWNlLTE:composer-1";

    const detail = await readCursorIdeDetail(sessionId, undefined, { ideDbPath: dbPath });

    expect(detail?.contentKind).toBe("timeline");
    expect(detail?.timeline).toEqual([
      { kind: "message", role: "user", text: "Question", timestamp: 1100 },
      { kind: "tool", tool: "read_file", detail: "/tmp/a.ts" },
      { kind: "message", role: "assistant", text: "Answer", timestamp: 1200 },
    ]);
    expect(detail?.stats).toEqual({ messageCount: 2, toolCount: 1, subagentCount: 0 });
  });

  it("bounds Composer headers to the most recent conversation window", async () => {
    const headers = Array.from({ length: 501 }, (_, index) => ({ bubbleId: `bubble-${index}`, type: 1 }));
    const bubbles = Object.fromEntries(headers.map(({ bubbleId }, index) => [bubbleId, { text: String(index) }]));
    await writeIdeStore([{ id: "composer-1", headers, bubbles }]);

    const detail = await readCursorIdeDetail("ide:d29ya3NwYWNlLTE:composer-1", undefined, { ideDbPath: dbPath });

    expect(detail?.timeline).toHaveLength(500);
    expect(detail?.timeline[0]).toMatchObject({ kind: "message", text: "1" });
    expect(detail?.timeline.at(-1)).toMatchObject({ kind: "message", text: "500" });
    // The header cap is fixed — no larger limit recovers bubble-0, so this is
    // source omission, not something the preview can page in.
    expect(detail?.partial).toBe(true);
    expect(detail?.limitedReason?.length).toBeGreaterThan(0);
    expect(detail?.truncated).not.toBe(true);
    expect(detail?.contentKind).toBe("timeline");

    // Below the retained count, both signals hold at once.
    const paged = await readCursorIdeDetail("ide:d29ya3NwYWNlLTE:composer-1", 50, { ideDbPath: dbPath });
    expect(paged?.timeline).toHaveLength(50);
    expect(paged?.partial).toBe(true);
    expect(paged?.truncated).toBe(true);
    expect(paged?.contentKind).toBe("timeline");
  });

  it("bounds normalized transcript text independently of requested item limits", async () => {
    const text = "x".repeat(256 * 1024);
    const headers = Array.from({ length: 9 }, (_, index) => ({ bubbleId: `bubble-${index}`, type: 2 }));
    const bubbles = Object.fromEntries(headers.map(({ bubbleId }) => [bubbleId, { text }]));
    await writeIdeStore([{ id: "composer-1", headers, bubbles }]);

    const detail = await readCursorIdeDetail("ide:d29ya3NwYWNlLTE:composer-1", undefined, { ideDbPath: dbPath });

    expect(detail?.timeline).toHaveLength(8);
    // The normalized-text ceiling is fixed too: the 9th bubble is unreachable at
    // any limit, so it is partial — and there is nothing left to page.
    expect(detail?.partial).toBe(true);
    expect(detail?.limitedReason?.length).toBeGreaterThan(0);
    expect(detail?.truncated).not.toBe(true);
    expect(detail?.contentKind).toBe("timeline");

    const paged = await readCursorIdeDetail("ide:d29ya3NwYWNlLTE:composer-1", 4, { ideDbPath: dbPath });
    expect(paged?.timeline).toHaveLength(4);
    expect(paged?.partial).toBe(true);
    expect(paged?.truncated).toBe(true);
    expect(paged?.contentKind).toBe("timeline");
  });

  it("resolves a safe entry and rejects malformed or cross-workspace ids", async () => {
    await writeIdeStore([{ id: "composer-1" }]);

    await expect(readCursorIdeEntry("ide:d29ya3NwYWNlLTE:composer-1", { ideDbPath: dbPath })).resolves.toMatchObject({
      source: "ide",
      canResume: false,
    });
    await expect(readCursorIdeEntry("ide:%%%:composer-1", { ideDbPath: dbPath })).resolves.toBeNull();
    await expect(readCursorIdeEntry("ide:b3RoZXI:composer-1", { ideDbPath: dbPath })).resolves.toBeNull();
  });

  it("bounds the timeline and reports truncation", async () => {
    await writeIdeStore([
      {
        id: "composer-1",
        headers: [
          { bubbleId: "one", type: 1 },
          { bubbleId: "two", type: 2 },
        ],
        bubbles: {
          one: { text: "one" },
          two: { text: "two" },
        },
      },
    ]);

    const detail = await readCursorIdeDetail("ide:d29ya3NwYWNlLTE:composer-1", 1, { ideDbPath: dbPath });
    expect(detail?.timeline).toEqual([{ kind: "message", role: "assistant", text: "two" }]);
    expect(detail?.truncated).toBe(true);
  });
});

describe("cursorIdeDbPath", () => {
  it("honors an explicit test path", () => {
    expect(cursorIdeDbPath({ ideDbPath: "/tmp/cursor-state.vscdb" })).toBe("/tmp/cursor-state.vscdb");
  });
});

describe("lookupCursorIdeEntry: an inner query that did not run is not absence", () => {
  const ID = "ide:d29ya3NwYWNlLTE:composer-1";
  const snapshotOf = (query: SqliteSnapshot["query"]) =>
    (async (_path: string, callback: (snapshot: SqliteSnapshot) => Promise<unknown>) => ({
      status: "ok" as const,
      value: await callback({ query }),
    })) as typeof withSqliteSnapshot;

  it("says unknown when the header query failed inside an opened snapshot", async () => {
    // The outer snapshot opens fine, so this used to read as a completed query
    // that matched nothing — a false absent that would retire a live row (B1).
    const fn = snapshotOf(async () => ({ status: "query-error", rows: [], error: "locked" }));
    expect(await lookupCursorIdeEntry(ID, { withSqliteSnapshotFn: fn })).toEqual({ status: "unknown" });
  });

  it("says unknown when the header row is there and cannot be parsed", async () => {
    const fn = snapshotOf(async () => ({ status: "ok", rows: [{ nothing: "usable" }] }));
    expect(await lookupCursorIdeEntry(ID, { withSqliteSnapshotFn: fn })).toEqual({ status: "unknown" });
  });

  it("still says absent when the header query ran and matched nothing", async () => {
    const fn = snapshotOf(async () => ({ status: "ok", rows: [] }));
    expect(await lookupCursorIdeEntry(ID, { withSqliteSnapshotFn: fn })).toEqual({ status: "absent" });
  });

  it("keeps readCursorIdeEntry nullable for both", async () => {
    const failed = snapshotOf(async () => ({ status: "query-error", rows: [], error: "locked" }));
    expect(await readCursorIdeEntry(ID, { withSqliteSnapshotFn: failed })).toBeNull();
  });
});
