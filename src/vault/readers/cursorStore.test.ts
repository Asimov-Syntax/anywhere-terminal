import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withSqliteSnapshot } from "../sqlite";
import { readCursorStoreDetail } from "./cursorStore";

let tmpRoot: string;
let dbPath: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "anywhere-cursor-store-"));
  dbPath = path.join(tmpRoot, "store.db");
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function hash(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function varint(value: number): Buffer {
  const out: number[] = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) byte |= 0x80;
    out.push(byte);
  } while (remaining > 0);
  return Buffer.from(out);
}

function field(fieldNumber: number, value: Uint8Array | string): Buffer {
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
  return Buffer.concat([varint(fieldNumber * 8 + 2), varint(bytes.length), bytes]);
}

interface StoreFixture {
  agentId?: string;
  userVersion?: number;
  root?: Buffer;
  rootField?: "latestRootBlobId" | "rootBlobId";
  blobs?: Array<{ id?: string; data: Buffer }>;
}

async function writeStore(fixture: StoreFixture): Promise<void> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`PRAGMA user_version = ${fixture.userVersion ?? 1}`);
    db.exec("CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    db.exec("CREATE TABLE blobs(id TEXT PRIMARY KEY, data BLOB NOT NULL)");
    const root = fixture.root ?? Buffer.alloc(0);
    const rootId = hash(root);
    const rootField = fixture.rootField ?? "latestRootBlobId";
    const meta = Buffer.from(JSON.stringify({ agentId: fixture.agentId ?? "chat-1", [rootField]: rootId }), "utf8");
    db.prepare("INSERT INTO meta(key, value) VALUES ('0', ?)").run(meta.toString("hex"));
    const insert = db.prepare("INSERT INTO blobs(id, data) VALUES (?, ?)");
    insert.run(rootId, root);
    for (const blob of fixture.blobs ?? []) insert.run(blob.id ?? hash(blob.data), blob.data);
  } finally {
    db.close();
  }
}

function json(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), "utf8");
}

describe("readCursorStoreDetail", () => {
  it("decodes archived messages before current messages and recognizes tool blocks", async () => {
    const archivedUser = json({ role: "user", content: "Earlier question" });
    const archivedAssistant = json({ role: "assistant", content: [{ type: "text", text: "Earlier answer" }] });
    const currentUser = json({ role: "user", content: [{ type: "text", text: "Current question" }] });
    const currentAssistant = json({
      role: "assistant",
      content: [
        { type: "text", text: "Current answer" },
        { type: "tool_use", name: "Read", input: { file_path: "/tmp/a.ts" } },
      ],
    });
    const archive = Buffer.concat([field(1, hash(archivedUser)), field(1, hash(archivedAssistant))]);
    const root = Buffer.concat([
      field(1, hash(currentUser)),
      field(13, hash(archive)),
      field(1, hash(currentAssistant)),
    ]);
    await writeStore({
      root,
      blobs: [archivedUser, archivedAssistant, archive, currentUser, currentAssistant].map((data) => ({ data })),
    });

    const result = await readCursorStoreDetail(dbPath, "chat-1");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.timeline).toEqual([
      { kind: "message", role: "user", text: "Earlier question" },
      { kind: "message", role: "assistant", text: "Earlier answer" },
      { kind: "message", role: "user", text: "Current question" },
      { kind: "message", role: "assistant", text: "Current answer" },
      { kind: "tool", tool: "Read", detail: "/tmp/a.ts" },
    ]);
    expect(result.stats).toEqual({ messageCount: 4, toolCount: 1, subagentCount: 0 });
  });

  it("ignores unreachable blobs, including an unrelated bad hash", async () => {
    const message = json({ role: "user", content: "Reachable" });
    const root = field(1, hash(message));
    await writeStore({
      root,
      blobs: [{ data: message }, { id: "0".repeat(64), data: Buffer.from("unrelated private value") }],
    });

    const result = await readCursorStoreDetail(dbPath, "chat-1");
    expect(result.status).toBe("ok");
  });

  it("reads transcript rows that exist only in the live WAL snapshot", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbPath);
    try {
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA wal_autocheckpoint = 0");
      db.exec("PRAGMA user_version = 1");
      db.exec("CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)");
      db.exec("CREATE TABLE blobs(id TEXT PRIMARY KEY, data BLOB NOT NULL)");
      const message = json({ role: "user", content: "WAL message" });
      const messageId = hash(message);
      const root = field(1, messageId);
      const rootId = hash(root);
      const meta = Buffer.from(JSON.stringify({ agentId: "chat-1", latestRootBlobId: rootId }), "utf8");
      db.prepare("INSERT INTO meta(key, value) VALUES ('0', ?)").run(meta.toString("hex"));
      const insert = db.prepare("INSERT INTO blobs(id, data) VALUES (?, ?)");
      insert.run(rootId, root);
      insert.run(messageId, message);

      const result = await readCursorStoreDetail(dbPath, "chat-1");
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.timeline).toEqual([{ kind: "message", role: "user", text: "WAL message" }]);
    } finally {
      db.close();
    }
  });

  it("uses latestRootBlobId canonically and keeps rootBlobId as an explicit compatibility fallback", async () => {
    const message = json({ role: "user", content: "Fallback" });
    await writeStore({ rootField: "rootBlobId", root: field(1, hash(message)), blobs: [{ data: message }] });

    const result = await readCursorStoreDetail(dbPath, "chat-1");
    expect(result.status).toBe("ok");
  });

  it("queries only root-reachable hashes from one snapshot", async () => {
    const message = json({ role: "user", content: "Reachable" });
    const messageId = hash(message);
    const root = field(1, messageId);
    const rootId = hash(root);
    const privateBlob = Buffer.from("unrelated private blob", "utf8");
    const privateId = hash(privateBlob);
    const blobs = new Map([
      [rootId, root],
      [messageId, message],
      [privateId, privateBlob],
    ]);
    const metaValue = Buffer.from(JSON.stringify({ agentId: "chat-1", latestRootBlobId: rootId }), "utf8").toString(
      "hex",
    );
    const queries: string[] = [];
    const withSnapshot = (async (_path, callback) => {
      const value = await callback({
        query: async (sql: string) => {
          queries.push(sql);
          if (sql.includes("pragma_user_version")) {
            return {
              status: "ok" as const,
              rows: [
                {
                  user_version: 1,
                  meta_columns: 2,
                  meta_key: 1,
                  meta_value_column: 1,
                  blob_columns: 2,
                  blob_id: 1,
                  blob_data: 1,
                  meta_value: metaValue,
                },
              ],
            };
          }
          const id = sql.match(/WHERE id = '([0-9a-f]{64})'/)?.[1];
          const data = id ? blobs.get(id) : undefined;
          return data
            ? { status: "ok" as const, rows: [{ id, data_hex: data.toString("hex"), byte_length: data.length }] }
            : { status: "ok" as const, rows: [] };
        },
      });
      return { status: "ok" as const, value };
    }) as typeof withSqliteSnapshot;

    const result = await readCursorStoreDetail(dbPath, "chat-1", { withSqliteSnapshotFn: withSnapshot });
    expect(result.status).toBe("ok");
    expect(queries.filter((sql) => sql.includes("FROM blobs"))).toHaveLength(2);
    expect(queries.every((sql) => !sql.includes(privateId))).toBe(true);
    expect(queries.filter((sql) => sql.includes("FROM blobs")).every((sql) => sql.includes("WHERE id ="))).toBe(true);
  });

  it("normalizes recognized tool-result records and blocks as bounded activity", async () => {
    const toolRecord = json({ role: "tool", name: "Read", content: "file contents" });
    const assistant = json({
      role: "assistant",
      content: [{ type: "tool_result", name: "Shell", content: "command output" }],
    });
    await writeStore({
      root: Buffer.concat([field(1, hash(toolRecord)), field(1, hash(assistant))]),
      blobs: [toolRecord, assistant].map((data) => ({ data })),
    });

    const result = await readCursorStoreDetail(dbPath, "chat-1");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.timeline).toEqual([
      { kind: "tool", tool: "Read", detail: "file contents" },
      { kind: "tool", tool: "Shell", detail: "command output" },
    ]);
    expect(result.recentActivity).toEqual(result.timeline);
  });

  it.each([
    ["stored agent mismatch", { agentId: "different-chat" }],
    ["unsupported schema", { userVersion: 2 }],
  ])("fails closed for %s without returning transcript content", async (_name, fixture) => {
    const message = json({ role: "user", content: "private transcript" });
    await writeStore({ ...fixture, root: field(1, hash(message)), blobs: [{ data: message }] });

    const result = await readCursorStoreDetail(dbPath, "chat-1");
    expect(result).toEqual({ status: "limited", reason: "Cursor transcript is unavailable for this store." });
  });

  it("fails closed when a reachable blob does not match its SHA-256 id", async () => {
    const claimedId = "a".repeat(64);
    await writeStore({
      root: field(1, claimedId),
      blobs: [{ id: claimedId, data: json({ role: "user", content: "private" }) }],
    });

    const result = await readCursorStoreDetail(dbPath, "chat-1");
    expect(result.status).toBe("limited");
  });

  it("filters system and generated summary records", async () => {
    const system = json({ role: "system", content: "secret system prompt" });
    const summary = json({ role: "assistant", content: "generated", isSummary: true });
    const user = json({ role: "user", content: "Visible" });
    await writeStore({
      root: Buffer.concat([field(1, hash(system)), field(1, hash(summary)), field(1, hash(user))]),
      blobs: [system, summary, user].map((data) => ({ data })),
    });

    const result = await readCursorStoreDetail(dbPath, "chat-1");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.timeline).toEqual([{ kind: "message", role: "user", text: "Visible" }]);
    expect(result.timeline[0]).not.toHaveProperty("msgRef");
  });
});
