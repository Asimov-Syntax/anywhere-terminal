// src/vault/VaultService.watchTargets.test.ts — FS-watch target resolution for
// auto-refresh (D4) and live-follow (D5). These globs/paths are what the host's
// watchers subscribe to, so they are contract-tested even though the watcher
// wiring itself is verified manually.

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { VaultService } from "./VaultService";

const svc = new VaultService();

describe("VaultService.getStoreWatchTargets", () => {
  const targets = svc.getStoreWatchTargets();

  it("covers existing stores with change-catching globs", () => {
    // Claude projects tree (append-grows via **/*.jsonl).
    const claude = targets.find((t) => t.baseDir.endsWith(path.join(".claude", "projects")));
    expect(claude?.glob).toBe("**/*.jsonl");

    // Codex: SQLite index (+ -wal/-shm via trailing *) AND the rollout JSONL tree.
    const codexDb = targets.find((t) => t.glob === "state_5.sqlite*");
    expect(codexDb).toBeDefined();
    const codexSessions = targets.find((t) => t.baseDir.endsWith("sessions") && t.glob === "**/*.jsonl");
    expect(codexSessions).toBeDefined();

    // OpenCode WAL DB (db + -wal/-shm).
    const opencode = targets.find((t) => t.glob === "opencode.db*");
    expect(opencode?.baseDir.endsWith("opencode")).toBe(true);
  });

  it("watches each Cursor source with source-targeted events", () => {
    const cursor = targets.filter((target) => target.agent === "cursor");

    expect(cursor).toEqual(
      expect.arrayContaining([
        {
          baseDir: expect.any(String),
          glob: "**/meta.json",
          events: ["create", "change", "delete"],
          agent: "cursor",
        },
        { baseDir: expect.any(String), glob: "**/store.db", events: ["create", "delete"], agent: "cursor" },
        {
          baseDir: expect.stringContaining(path.join(".cursor", "projects")),
          glob: "**/agent-transcripts/**/*.jsonl",
          events: ["create", "change", "delete"],
          agent: "cursor",
        },
        {
          baseDir: expect.stringContaining(path.join("Cursor", "User", "globalStorage")),
          glob: "state.vscdb",
          events: ["create", "change", "delete"],
          agent: "cursor",
        },
        {
          baseDir: expect.stringContaining(path.join("Cursor", "User", "globalStorage")),
          glob: "state.vscdb-wal",
          events: ["create", "change", "delete"],
          agent: "cursor",
        },
      ]),
    );
  });
});

describe("VaultService.resolveSessionWatchTargets", () => {
  it("scopes codex to the session's rollout file + the index db", async () => {
    const targets = await svc.resolveSessionWatchTargets("codex:abc-123");
    expect(targets.map((t) => t.glob)).toEqual(expect.arrayContaining(["**/*-abc-123.jsonl", "state_5.sqlite*"]));
  });

  it("watches the opencode db for an opencode session", async () => {
    const targets = await svc.resolveSessionWatchTargets("opencode:sess1");
    expect(targets).toHaveLength(1);
    expect(targets[0].glob).toBe("opencode.db*");
  });

  it("resolves exact CLI, project transcript, and IDE follow targets", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "anywhere-cursor-watch-"));
    try {
      const chatsDir = path.join(root, "chats");
      const projectsDir = path.join(root, "projects");
      const ideDbPath = path.join(root, "state.vscdb");
      const chatDir = path.join(chatsDir, "bucket-a", "chat-1");
      const transcriptDir = path.join(projectsDir, "project-a", "agent-transcripts", "chat-1");
      await Promise.all([fs.mkdir(chatDir, { recursive: true }), fs.mkdir(transcriptDir, { recursive: true })]);
      await Promise.all([
        fs.writeFile(path.join(chatDir, "meta.json"), "{}"),
        fs.writeFile(path.join(chatDir, "store.db"), ""),
        fs.writeFile(path.join(transcriptDir, "chat-1.jsonl"), ""),
      ]);
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(ideDbPath);
      try {
        db.exec(`CREATE TABLE composerHeaders(
          composerId TEXT PRIMARY KEY, workspaceId TEXT, createdAt INTEGER, lastUpdatedAt INTEGER,
          isArchived INTEGER, isSubagent INTEGER, value TEXT
        )`);
        db.exec("CREATE TABLE cursorDiskKV(key TEXT PRIMARY KEY, value BLOB NOT NULL)");
        const value = JSON.stringify({
          composerId: "composer-1",
          workspaceIdentifier: { id: "workspace-1", uri: { fsPath: "/work" } },
        });
        db.prepare(
          "INSERT INTO composerHeaders(composerId, workspaceId, createdAt, lastUpdatedAt, isArchived, isSubagent, value) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).run("composer-1", "workspace-1", 1, 2, 0, 0, value);
      } finally {
        db.close();
      }
      const cursorSvc = new VaultService({ cursorReaderOptions: { chatsDir, projectsDir, ideDbPath } });

      const cli = await cursorSvc.resolveSessionWatchTargets("cursor:chat-1");
      expect(cli.map((target) => target.glob)).toEqual(["store.db", "store.db-wal", "chat-1.jsonl"]);
      await expect(cursorSvc.resolveSessionWatchTargets("cursor:project:cHJvamVjdC1h:chat-1")).resolves.toEqual([
        { baseDir: transcriptDir, glob: "chat-1.jsonl" },
      ]);
      await expect(cursorSvc.resolveSessionWatchTargets("cursor:ide:d29ya3NwYWNlLTE:composer-1")).resolves.toEqual([
        { baseDir: root, glob: "state.vscdb" },
        { baseDir: root, glob: "state.vscdb-wal" },
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("returns nothing for an unknown agent", async () => {
    expect(await svc.resolveSessionWatchTargets("bogus:x")).toEqual([]);
  });

  it("rejects a glob-unsafe session id (no injection into the watch glob)", async () => {
    expect(await svc.resolveSessionWatchTargets("codex:../../*")).toEqual([]);
    expect(await svc.resolveSessionWatchTargets("codex:a/b")).toEqual([]);
  });
});
