import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { withSqliteSnapshot } from "../sqlite";
import {
  MAX_CURSOR_BLOB_BYTES,
  MAX_CURSOR_STORE_BYTES,
  readCursorStoreDetail,
  verifyCursorStoreIdentity,
} from "./cursorStore";

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
    if (remaining > 0) {
      byte |= 0x80;
    }
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
    for (const blob of fixture.blobs ?? []) {
      insert.run(blob.id ?? hash(blob.data), blob.data);
    }
  } finally {
    db.close();
  }
}

function json(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), "utf8");
}

/** A synthetic stand-in for the injected background-completion template: the
 *  opening phrase plus every marker the real envelope carries. No private
 *  transcript content is used. */
const INJECTED_NOTIFICATION = [
  "The background agent (task_id: task-42) has completed",
  "This is an automated notification; do not reply to it directly.",
  "Result: all checks green",
].join("\n");

function blobQueries(queries: string[]): string[] {
  return queries.filter((sql) => sql.includes("FROM blobs"));
}

/** An in-memory stand-in for one WAL-aware snapshot, so tests can observe the
 *  exact SQL the decoder issues without a private fixture store. */
function fakeSnapshot(blobs: Map<string, Buffer>, rootId: string, queries: string[]): typeof withSqliteSnapshot {
  const metaValue = Buffer.from(JSON.stringify({ agentId: "chat-1", latestRootBlobId: rootId }), "utf8").toString(
    "hex",
  );
  return (async (_path, callback) => {
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
                meta_key_rows: 1,
                meta_value_column: 1,
                blob_columns: 2,
                blob_id: 1,
                blob_data: 1,
                meta_value: metaValue,
              },
            ],
          };
        }
        const ids = (sql.match(/'[0-9a-f]{64}'/g) ?? []).map((quoted) => quoted.slice(1, -1));
        const rows = ids
          .map((id) => ({ id, data: blobs.get(id) }))
          .filter((row): row is { id: string; data: Buffer } => row.data !== undefined)
          .map((row) => ({ id: row.id, data_hex: row.data.toString("hex"), byte_length: row.data.length }));
        return { status: "ok" as const, rows };
      },
    });
    return { status: "ok" as const, value };
  }) as typeof withSqliteSnapshot;
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
    if (result.status !== "ok") {
      return;
    }
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
      if (result.status !== "ok") {
        return;
      }
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
    const queries: string[] = [];
    const withSnapshot = fakeSnapshot(
      new Map([
        [rootId, root],
        [messageId, message],
        [privateId, privateBlob],
      ]),
      rootId,
      queries,
    );

    const result = await readCursorStoreDetail(dbPath, "chat-1", { withSqliteSnapshotFn: withSnapshot });
    expect(result.status).toBe("ok");
    expect(blobQueries(queries)).toHaveLength(2);
    expect(queries.every((sql) => !sql.includes(privateId))).toBe(true);
    expect(blobQueries(queries).every((sql) => sql.includes("WHERE id IN ("))).toBe(true);
  });

  it("batches proven root-reachable message reads while keeping per-blob and total bounds", async () => {
    const messages = Array.from({ length: 70 }, (_, index) => json({ role: "user", content: `Message ${index}` }));
    const root = Buffer.concat(messages.map((message) => field(1, hash(message))));
    const rootId = hash(root);
    const blobs = new Map<string, Buffer>([[rootId, root]]);
    for (const message of messages) {
      blobs.set(hash(message), message);
    }
    const queries: string[] = [];

    const result = await readCursorStoreDetail(dbPath, "chat-1", {
      withSqliteSnapshotFn: fakeSnapshot(blobs, rootId, queries),
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    expect(result.timeline).toHaveLength(70);
    // One root read plus bounded batches — never one query per blob.
    const reads = blobQueries(queries);
    expect(reads.length).toBeGreaterThan(1);
    expect(reads.length).toBeLessThanOrEqual(4);
    for (const sql of reads) {
      expect(sql).toContain(`length(data) <= ${MAX_CURSOR_BLOB_BYTES}`);
      expect((sql.match(/'[0-9a-f]{64}'/g) ?? []).length).toBeLessThanOrEqual(64);
    }
  });

  it("caps cumulative selected bytes inside the batch query, not only per row", async () => {
    const messages = Array.from({ length: 70 }, (_, index) => json({ role: "user", content: `Message ${index}` }));
    const root = Buffer.concat(messages.map((message) => field(1, hash(message))));
    const rootId = hash(root);
    const blobs = new Map<string, Buffer>([[rootId, root]]);
    for (const message of messages) {
      blobs.set(hash(message), message);
    }
    const queries: string[] = [];

    const result = await readCursorStoreDetail(dbPath, "chat-1", {
      withSqliteSnapshotFn: fakeSnapshot(blobs, rootId, queries),
    });
    expect(result.status).toBe("ok");

    const budgets = blobQueries(queries).map((sql) => {
      // A per-row `length(data)` cap alone lets 64 ids materialize 64x the cap:
      // the query itself must stop at the remaining TOTAL budget.
      expect(sql).toContain("SUM(len) OVER (ORDER BY id ROWS UNBOUNDED PRECEDING)");
      const guard = sql.match(/running_bytes <= (\d+)/);
      expect(guard).not.toBeNull();
      return Number(guard?.[1]);
    });
    expect(budgets.length).toBeGreaterThan(1);
    expect(budgets[0]).toBe(MAX_CURSOR_STORE_BYTES);
    // Each batch is capped by what the already-read bytes left behind.
    for (let index = 1; index < budgets.length; index++) {
      expect(budgets[index]).toBeLessThan(budgets[index - 1]);
      expect(budgets[index]).toBeLessThanOrEqual(MAX_CURSOR_STORE_BYTES);
    }
  });

  it("fails closed when a batched blob does not match its SHA-256 id", async () => {
    const messages = Array.from({ length: 70 }, (_, index) => json({ role: "user", content: `Message ${index}` }));
    const root = Buffer.concat(messages.map((message) => field(1, hash(message))));
    const rootId = hash(root);
    const blobs = new Map<string, Buffer>([[rootId, root]]);
    for (const message of messages) {
      blobs.set(hash(message), message);
    }
    blobs.set(hash(messages[69]), Buffer.from("tampered private payload", "utf8"));

    const result = await readCursorStoreDetail(dbPath, "chat-1", {
      withSqliteSnapshotFn: fakeSnapshot(blobs, rootId, []),
    });
    expect(result).toEqual({ status: "limited", reason: "Cursor transcript is unavailable for this store." });
  });

  it("ignores standalone tool results instead of counting them as activity", async () => {
    const call = json({
      role: "assistant",
      content: [{ type: "tool-call", toolName: "Read", args: { file_path: "/tmp/a.ts" }, toolCallId: "call-1" }],
    });
    const toolRecord = json({ type: "tool-result", toolName: "Read", result: "file contents", toolCallId: "call-1" });
    const orphanResult = json({ role: "tool", name: "Shell", content: "command output" });
    await writeStore({
      root: Buffer.concat([field(1, hash(call)), field(1, hash(toolRecord)), field(1, hash(orphanResult))]),
      blobs: [call, toolRecord, orphanResult].map((data) => ({ data })),
    });

    const result = await readCursorStoreDetail(dbPath, "chat-1");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    expect(result.timeline).toEqual([{ kind: "tool", tool: "Read", detail: "/tmp/a.ts" }]);
    expect(result.recentActivity).toEqual(result.timeline);
    expect(result.stats).toEqual({ messageCount: 0, toolCount: 1, subagentCount: 0 });
  });

  it("shows only the wrapped user query and discards injected bootstrap context", async () => {
    const bootstrap = json({
      role: "user",
      content: "<user_info>Directory: /work\nShell: zsh</user_info>\nEnvironment ready.",
    });
    const real = json({
      role: "user",
      content: "<timestamp>2026-08-24T10:00:00Z</timestamp>\n<user_query>Fix the failing test</user_query>",
    });
    await writeStore({
      root: Buffer.concat([field(1, hash(bootstrap)), field(1, hash(real))]),
      blobs: [bootstrap, real].map((data) => ({ data })),
    });

    const result = await readCursorStoreDetail(dbPath, "chat-1");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    expect(result.timeline).toEqual([{ kind: "message", role: "user", text: "Fix the failing test" }]);
    expect(result.stats).toEqual({ messageCount: 1, toolCount: 0, subagentCount: 0 });
  });

  it("retains unknown tags in a real user query", async () => {
    const real = json({ role: "user", content: "<user_query>Explain <Foo> in bar.ts</user_query>" });
    await writeStore({ root: field(1, hash(real)), blobs: [{ data: real }] });

    const result = await readCursorStoreDetail(dbPath, "chat-1");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    expect(result.timeline).toEqual([{ kind: "message", role: "user", text: "Explain <Foo> in bar.ts" }]);
  });

  it("turns an injected background completion into a bounded notice, not a message", async () => {
    const notice = json({
      role: "user",
      content: [
        {
          type: "text",
          text: `<user_query>${INJECTED_NOTIFICATION}\n${"result line ".repeat(500)}</user_query>`,
        },
      ],
    });
    await writeStore({ root: field(1, hash(notice)), blobs: [{ data: notice }] });

    const result = await readCursorStoreDetail(dbPath, "chat-1");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    expect(result.timeline).toHaveLength(1);
    const item = result.timeline[0];
    expect(item.kind).toBe("notice");
    if (item.kind !== "notice") {
      return;
    }
    expect(item.summary).toBe("The background agent (task_id: task-42) has completed");
    expect(item.body?.length).toBeLessThanOrEqual(2000);
    expect(result.stats).toEqual({ messageCount: 0, toolCount: 0, subagentCount: 0 });
  });

  it.each([
    ["a question about notification wiring", "Did the task_id notification fire after the job has completed?"],
    ["a report about a completed task", "My background task has completed but no notification arrived for task_id 7"],
    ["a partial template quote", "The task_id has completed — do not ask me again"],
  ])("keeps human text mentioning %s as a real prompt", async (_name, prompt) => {
    const record = json({ role: "user", content: `<user_query>${prompt}</user_query>` });
    await writeStore({ root: field(1, hash(record)), blobs: [{ data: record }] });

    const result = await readCursorStoreDetail(dbPath, "chat-1");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    expect(result.timeline).toEqual([{ kind: "message", role: "user", text: prompt }]);
    expect(result.stats).toEqual({ messageCount: 1, toolCount: 0, subagentCount: 0 });
  });

  it("maps Task and Agent calls to bounded subagent steps counted apart from tools", async () => {
    const assistant = json({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolName: "Task",
          toolCallId: "call-1",
          args: { subagent_type: "code-reviewer", description: "Review the diff", run_in_background: true },
        },
        {
          type: "tool-call",
          toolName: "Task",
          toolCallId: "call-2",
          args: { subagent_type: "test-runner", prompt: "x".repeat(5000), run_in_background: true },
        },
        {
          type: "tool-call",
          toolName: "Agent",
          toolCallId: "call-3",
          args: { subagent_type: "docs-writer", description: "Write release notes" },
        },
        { type: "tool-call", toolName: "Read", toolCallId: "call-4", args: { file_path: "/tmp/a.ts" } },
      ],
    });
    await writeStore({ root: field(1, hash(assistant)), blobs: [{ data: assistant }] });

    const result = await readCursorStoreDetail(dbPath, "chat-1");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    expect(result.timeline).toEqual([
      { kind: "subagent", name: "code-reviewer", title: "Review the diff", background: true },
      { kind: "subagent", name: "test-runner", prompt: "x".repeat(2000), background: true },
      { kind: "subagent", name: "docs-writer", title: "Write release notes" },
      { kind: "tool", tool: "Read", detail: "/tmp/a.ts" },
    ]);
    expect(result.stats).toEqual({ messageCount: 0, toolCount: 1, subagentCount: 3 });
  });

  it("correlates blocking and background Task results without emitting notices or result tools", async () => {
    const calls = json({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolName: "Task",
          toolCallId: "blocking-call",
          args: { subagent_type: "Explore", description: "Find the listener", prompt: "Inspect the watcher flow" },
        },
        {
          type: "tool-call",
          toolName: "Task",
          toolCallId: "background-call",
          args: {
            subagent_type: "generalPurpose",
            description: "Check the architecture",
            prompt: "Review the source layout",
            run_in_background: true,
          },
        },
      ],
    });
    const blockingResult = json({
      type: "tool-result",
      toolName: "Task",
      toolCallId: "blocking-call",
      result: "The listener is in VaultWatchCoordinator.\n\nAgent ID: child-1",
    });
    const backgroundLaunch = json({
      type: "tool-result",
      toolName: "Task",
      toolCallId: "background-call",
      result: "Background task launched (task_id: task-42)",
    });
    const completion = json({
      role: "user",
      content: `<user_query>${INJECTED_NOTIFICATION}\nAgent ID: background-child</user_query>`,
    });
    await writeStore({
      root: Buffer.concat(
        [calls, blockingResult, backgroundLaunch, completion].map((record) => field(1, hash(record))),
      ),
      blobs: [calls, blockingResult, backgroundLaunch, completion].map((data) => ({ data })),
    });

    const result = await readCursorStoreDetail(dbPath, "chat-1");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    expect(result.timeline).toEqual([
      {
        kind: "subagent",
        name: "Explore",
        title: "Find the listener",
        prompt: "Inspect the watcher flow",
        result: "The listener is in VaultWatchCoordinator.\n\nAgent ID: child-1",
        childAgentId: "child-1",
        status: "completed",
      },
      {
        kind: "subagent",
        name: "generalPurpose",
        title: "Check the architecture",
        prompt: "Review the source layout",
        result: "all checks green\nAgent ID: background-child",
        childAgentId: "background-child",
        background: true,
        status: "completed",
      },
    ]);
    expect(result.recentActivity).toEqual(result.timeline);
    expect(result.stats).toEqual({ messageCount: 0, toolCount: 0, subagentCount: 2 });
  });

  /** The shape observed in chat e02838b2: one background launch declaring the
   *  type, then two continuations that carry only `resume` — one agent, three
   *  invocations, and the continuations' results never repeat the Agent ID line. */
  it("keeps a launch and its resume continuations as one agent at their own positions", async () => {
    const launch = json({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolName: "Task",
          toolCallId: "call-launch",
          args: {
            subagent_type: "asm-oracle",
            description: "Oracle advisor ready",
            prompt: "Stand by",
            run_in_background: true,
          },
        },
      ],
    });
    const launched = json({
      type: "tool-result",
      toolName: "Task",
      toolCallId: "call-launch",
      result: "Subagent is running in the background.\n\nAgent ID: oracle-1",
    });
    const continuations = [1, 2].flatMap((turn) => [
      json({
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolName: "Task",
            toolCallId: `call-resume-${turn}`,
            args: { description: `Oracle follow-up ${turn}`, prompt: `Question ${turn}`, resume: "oracle-1" },
          },
        ],
      }),
      json({
        type: "tool-result",
        toolName: "Task",
        toolCallId: `call-resume-${turn}`,
        result: `Answer ${turn}`,
      }),
    ]);
    const records = [launch, launched, ...continuations];
    await writeStore({
      root: Buffer.concat(records.map((record) => field(1, hash(record)))),
      blobs: records.map((data) => ({ data })),
    });

    const result = await readCursorStoreDetail(dbPath, "chat-1");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    expect(result.timeline).toEqual([
      {
        kind: "subagent",
        name: "asm-oracle",
        title: "Oracle advisor ready",
        prompt: "Stand by",
        background: true,
        childAgentId: "oracle-1",
        status: "running",
      },
      {
        kind: "subagent",
        name: "asm-oracle",
        title: "Oracle follow-up 1",
        prompt: "Question 1",
        childAgentId: "oracle-1",
        result: "Answer 1",
        status: "completed",
        continuation: true,
      },
      {
        kind: "subagent",
        name: "asm-oracle",
        title: "Oracle follow-up 2",
        prompt: "Question 2",
        childAgentId: "oracle-1",
        result: "Answer 2",
        status: "completed",
        continuation: true,
      },
    ]);
    expect(result.recentActivity).toEqual(result.timeline);
    // Three invocations, one agent (D4).
    expect(result.stats).toEqual({ messageCount: 0, toolCount: 0, subagentCount: 1 });
  });

  it("keeps invocations apart when the resume identity is unsafe or absent", async () => {
    const calls = json({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolName: "Task",
          toolCallId: "call-1",
          args: { subagent_type: "asm-oracle", description: "Launch" },
        },
        {
          type: "tool-call",
          toolName: "Task",
          toolCallId: "call-2",
          args: { description: "Traversing resume", resume: "../../etc/passwd" },
        },
        { type: "tool-call", toolName: "Task", toolCallId: "call-3", args: { description: "No identity at all" } },
      ],
    });
    await writeStore({
      root: field(1, hash(calls)),
      blobs: [{ data: calls }],
    });

    const result = await readCursorStoreDetail(dbPath, "chat-1");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    expect(result.timeline).toHaveLength(3);
    expect(result.stats.subagentCount).toBe(3);
    expect(JSON.stringify(result.timeline)).not.toContain("passwd");
  });

  it("caps a correlated subagent result", async () => {
    const call = json({
      role: "assistant",
      content: [{ type: "tool-call", toolName: "Task", toolCallId: "call-1", args: { subagent_type: "Explore" } }],
    });
    const toolResult = json({
      type: "tool-result",
      toolName: "Task",
      toolCallId: "call-1",
      result: "x".repeat(100 * 1024),
    });
    await writeStore({
      root: Buffer.concat([field(1, hash(call)), field(1, hash(toolResult))]),
      blobs: [call, toolResult].map((data) => ({ data })),
    });

    const result = await readCursorStoreDetail(dbPath, "chat-1");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    const subagent = result.timeline[0];
    expect(subagent.kind).toBe("subagent");
    if (subagent.kind !== "subagent") {
      return;
    }
    expect(subagent.result).toHaveLength(64 * 1024);
  });

  it.each([
    // A readable store naming another agent is flagged as contradicted so the
    // caller withholds the project mirror too; schema drift only limits detail.
    ["stored agent mismatch", { agentId: "different-chat" }, true],
    ["unsupported schema", { userVersion: 2 }, false],
  ])("fails closed for %s without returning transcript content", async (_name, fixture, contradicted) => {
    const message = json({ role: "user", content: "private transcript" });
    await writeStore({ ...fixture, root: field(1, hash(message)), blobs: [{ data: message }] });

    const result = await readCursorStoreDetail(dbPath, "chat-1");
    expect(result).toEqual({
      status: "limited",
      reason: "Cursor transcript is unavailable for this store.",
      ...(contradicted ? { identityContradicted: true } : {}),
    });
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
    if (result.status !== "ok") {
      return;
    }
    expect(result.timeline).toEqual([{ kind: "message", role: "user", text: "Visible" }]);
    expect(result.timeline[0]).not.toHaveProperty("msgRef");
  });
});

describe("verifyCursorStoreIdentity", () => {
  it("matches when the bounded store's agentId equals the candidate chat id", async () => {
    await writeStore({ agentId: "chat-1", root: Buffer.alloc(0) });
    await expect(verifyCursorStoreIdentity(dbPath, "chat-1")).resolves.toBe(true);
  });

  it("rejects a mismatched stored identity", async () => {
    await writeStore({ agentId: "different-chat", root: Buffer.alloc(0) });
    await expect(verifyCursorStoreIdentity(dbPath, "chat-1")).resolves.toBe(false);
  });

  it("rejects an unsupported schema", async () => {
    await writeStore({ agentId: "chat-1", userVersion: 2, root: Buffer.alloc(0) });
    await expect(verifyCursorStoreIdentity(dbPath, "chat-1")).resolves.toBe(false);
  });

  it("rejects malformed meta JSON", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbPath);
    try {
      db.exec("PRAGMA user_version = 1");
      db.exec("CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)");
      db.exec("CREATE TABLE blobs(id TEXT PRIMARY KEY, data BLOB NOT NULL)");
      db.prepare("INSERT INTO meta(key, value) VALUES ('0', ?)").run(Buffer.from("not json", "utf8").toString("hex"));
    } finally {
      db.close();
    }
    await expect(verifyCursorStoreIdentity(dbPath, "chat-1")).resolves.toBe(false);
  });

  it("rejects an absent store", async () => {
    await expect(verifyCursorStoreIdentity(dbPath, "chat-1")).resolves.toBe(false);
  });

  it("rejects a locked/unreadable snapshot", async () => {
    const locked: typeof withSqliteSnapshot = async () => ({ status: "query-error", error: "database is locked" });
    await expect(verifyCursorStoreIdentity(dbPath, "chat-1", { withSqliteSnapshotFn: locked })).resolves.toBe(false);
  });

  it("never follows the transcript root — only profile and identity are read", async () => {
    const message = json({ role: "user", content: "private transcript" });
    const root = field(1, hash(message));
    const rootId = hash(root);
    const queries: string[] = [];
    const withSnapshot = fakeSnapshot(
      new Map([
        [rootId, root],
        [hash(message), message],
      ]),
      rootId,
      queries,
    );

    await expect(verifyCursorStoreIdentity(dbPath, "chat-1", { withSqliteSnapshotFn: withSnapshot })).resolves.toBe(
      true,
    );
    expect(blobQueries(queries)).toHaveLength(0);
  });

  it("rejects an unsafe candidate chat id without opening the store", async () => {
    await writeStore({ agentId: "chat-1", root: Buffer.alloc(0) });
    await expect(verifyCursorStoreIdentity(dbPath, "../escape")).resolves.toBe(false);
  });

  /** B16: `LIMIT 1` picks one of several key-0 rows, so ambiguity must be
   *  rejected by counting rows and requiring the supported unique-key schema. */
  it("rejects an ambiguous identity: duplicate, absent, or non-unique key rows", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const metaHex = (agentId: string) =>
      Buffer.from(JSON.stringify({ agentId, latestRootBlobId: hash(Buffer.alloc(0)) }), "utf8").toString("hex");

    const write = (schema: string, rows: Array<[string, string]>) => {
      const db = new DatabaseSync(dbPath);
      try {
        db.exec("PRAGMA user_version = 1");
        db.exec(schema);
        db.exec("CREATE TABLE blobs(id TEXT PRIMARY KEY, data BLOB NOT NULL)");
        const insert = db.prepare("INSERT INTO meta(key, value) VALUES (?, ?)");
        for (const [key, value] of rows) {
          insert.run(key, value);
        }
      } finally {
        db.close();
      }
    };

    const nonUnique = "CREATE TABLE meta(key TEXT, value TEXT NOT NULL)";
    const unique = "CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)";

    write(nonUnique, [
      ["0", metaHex("chat-1")],
      ["0", metaHex("someone-else")],
    ]);
    await expect(verifyCursorStoreIdentity(dbPath, "chat-1")).resolves.toBe(false);
    expect((await readCursorStoreDetail(dbPath, "chat-1")).status).toBe("limited");

    await fs.rm(dbPath, { force: true });
    write(unique, [["1", metaHex("chat-1")]]);
    await expect(verifyCursorStoreIdentity(dbPath, "chat-1")).resolves.toBe(false);

    await fs.rm(dbPath, { force: true });
    write(nonUnique, [["0", metaHex("chat-1")]]);
    await expect(verifyCursorStoreIdentity(dbPath, "chat-1")).resolves.toBe(false);
  });
});
