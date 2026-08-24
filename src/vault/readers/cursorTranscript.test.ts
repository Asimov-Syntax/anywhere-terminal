import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CursorTranscriptCandidate,
  cursorProjectBucketForCwd,
  cursorProjectSessionId,
  listCursorTranscriptCandidates,
  MAX_CURSOR_PROJECT_BUCKETS,
  MAX_CURSOR_TRANSCRIPT_LINE_BYTES,
  readCursorTranscript,
  resolveCursorProjectCwd,
  resolveCursorProjectTranscriptSession,
  resolveCursorTranscriptCandidate,
} from "./cursorTranscript";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "anywhere-cursor-transcript-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function writeNested(project: string, id: string, contents: string): Promise<CursorTranscriptCandidate> {
  const dir = path.join(root, project, "agent-transcripts", id);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.jsonl`);
  await fs.writeFile(filePath, contents);
  return { transcriptId: id, projectBucket: project, filePath, layout: "nested" };
}

async function writeFlat(project: string, id: string, contents: string): Promise<CursorTranscriptCandidate> {
  const dir = path.join(root, project, "agent-transcripts");
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.jsonl`);
  await fs.writeFile(filePath, contents);
  return { transcriptId: id, projectBucket: project, filePath, layout: "flat" };
}

function line(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

/** Synthetic stand-in for the injected background-completion template (see
 *  cursorStore.test.ts) — no private transcript content. */
const INJECTED_NOTIFICATION = [
  "The background agent (task_id: task-42) has completed",
  "This is an automated notification; do not reply to it directly.",
  "Result: all checks green",
].join("\n");

describe("Cursor project transcript discovery", () => {
  it("discovers nested and legacy flat transcripts but not subagent files", async () => {
    await writeNested("project-a", "chat-nested", line({ role: "user", message: { content: "nested" } }));
    await writeFlat("project-a", "chat-flat", line({ role: "user", message: { content: "flat" } }));
    const subagentDir = path.join(root, "project-a", "agent-transcripts", "chat-nested", "subagents");
    await fs.mkdir(subagentDir, { recursive: true });
    await fs.writeFile(
      path.join(subagentDir, "child.jsonl"),
      line({ role: "assistant", message: { content: "child" } }),
    );

    const result = await listCursorTranscriptCandidates({ projectsDir: root });

    expect(result.candidates.map((candidate) => [candidate.transcriptId, candidate.layout])).toEqual([
      ["chat-flat", "flat"],
      ["chat-nested", "nested"],
    ]);
    expect(result.ambiguousIds.size).toBe(0);
  });

  it("keeps duplicate ids source-qualified while rejecting id-only resolution", async () => {
    await writeNested("project-a", "chat-1", "");
    await writeNested("project-b", "chat-1", "");

    const result = await listCursorTranscriptCandidates({ projectsDir: root });
    expect(result.candidates.map((candidate) => cursorProjectSessionId(candidate)).sort()).toEqual([
      "project:cHJvamVjdC1h:chat-1",
      "project:cHJvamVjdC1i:chat-1",
    ]);
    expect(result.ambiguousIds.has("chat-1")).toBe(true);
    await expect(resolveCursorTranscriptCandidate("chat-1", { projectsDir: root })).resolves.toBeNull();
  });

  it("resolves one source-qualified project transcript without crossing buckets", async () => {
    const candidate = await writeNested("project-a", "chat-1", "");
    await writeNested("project-b", "chat-1", "");
    const sessionId = cursorProjectSessionId(candidate);

    await expect(resolveCursorProjectTranscriptSession(sessionId, { projectsDir: root })).resolves.toEqual(candidate);
    await expect(
      resolveCursorProjectTranscriptSession("project:cHJvamVjdC1i:chat-1", { projectsDir: root }),
    ).resolves.toMatchObject({ projectBucket: "project-b" });
  });

  it("decodes one filesystem-validated project cwd without guessing hyphen boundaries", async () => {
    const cwdPath = path.join(root, "workspaces", "my-hyphenated-project");
    await fs.mkdir(cwdPath, { recursive: true });
    const cwd = await fs.realpath(cwdPath);
    const bucket = cursorProjectBucketForCwd(cwd);

    await expect(resolveCursorProjectCwd(bucket)).resolves.toBe(cwd);
  });

  it("rejects an encoded project cwd when multiple real paths match", async () => {
    const basePath = path.join(root, "ambiguous");
    const firstPath = path.join(basePath, "a-b", "c");
    const secondPath = path.join(basePath, "a", "b-c");
    await Promise.all([fs.mkdir(firstPath, { recursive: true }), fs.mkdir(secondPath, { recursive: true })]);
    const [first, second] = await Promise.all([fs.realpath(firstPath), fs.realpath(secondPath)]);
    const bucket = cursorProjectBucketForCwd(first);
    expect(cursorProjectBucketForCwd(second)).toBe(bucket);

    await expect(resolveCursorProjectCwd(bucket)).resolves.toBeNull();
  });

  it("fails closed when project discovery exceeds its bucket ceiling", async () => {
    const fakeDirectory = (name: string) =>
      ({ name, isDirectory: () => true, isFile: () => false }) as unknown as import("node:fs").Dirent;
    const pathsFs = {
      readdir: vi.fn(async (dir: string) =>
        dir === root
          ? Array.from({ length: MAX_CURSOR_PROJECT_BUCKETS + 1 }, (_, index) => fakeDirectory(`project-${index}`))
          : [],
      ),
      stat: vi.fn(),
    };

    const result = await listCursorTranscriptCandidates({ projectsDir: root, pathsFs });

    expect(result.candidates).toEqual([]);
    expect(result.overflowed).toBe(true);
    expect(pathsFs.readdir).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed project sessions and ambiguous layouts", async () => {
    await writeNested("project-a", "chat-1", "");
    await writeFlat("project-a", "chat-1", "");

    await expect(
      resolveCursorProjectTranscriptSession("project:cHJvamVjdC1h:chat-1", { projectsDir: root }),
    ).resolves.toBeNull();
    await expect(
      resolveCursorProjectTranscriptSession("project:%%%:chat-1", { projectsDir: root }),
    ).resolves.toBeNull();
    await expect(
      resolveCursorProjectTranscriptSession("project:cHJvamVjdC1h:../chat-1", { projectsDir: root }),
    ).resolves.toBeNull();
  });

  it("never resolves an unsafe transcript id into a path", async () => {
    await writeNested("project-a", "safe-id", "");
    await expect(resolveCursorTranscriptCandidate("../safe-id", { projectsDir: root })).resolves.toBeNull();
  });
});

describe("readCursorTranscript", () => {
  it("preserves text and tool activity while skipping malformed and turn-ended records", async () => {
    const candidate = await writeNested(
      "project-a",
      "chat-1",
      [
        line({ role: "user", message: { content: [{ type: "text", text: "Question" }] } }),
        "not-json\n",
        line({
          role: "assistant",
          message: {
            content: [
              { type: "text", text: "Answer" },
              { type: "tool_use", name: "Read", input: { file_path: "/tmp/a.ts" } },
              { type: "tool_result", name: "Read", content: "contents" },
            ],
          },
        }),
        line({ type: "turn_ended" }),
      ].join(""),
    );

    const result = await readCursorTranscript(candidate, { projectsDir: root });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    expect(result.timeline).toEqual([
      { kind: "message", role: "user", text: "Question" },
      { kind: "message", role: "assistant", text: "Answer" },
      { kind: "tool", tool: "Read", detail: "/tmp/a.ts" },
    ]);
    expect(result.stats).toEqual({ messageCount: 2, toolCount: 1, subagentCount: 0 });
  });

  it("classifies wrapped queries, injected bootstrap, notices, and subagents like the CLI store", async () => {
    const candidate = await writeNested(
      "project-a",
      "chat-classify",
      [
        line({ role: "user", message: { content: "<user_info>Directory: /work</user_info>\nEnvironment ready." } }),
        line({
          role: "user",
          message: {
            content: "<timestamp>2026-08-24T10:00:00Z</timestamp>\n<user_query>Fix the failing test</user_query>",
          },
        }),
        line({
          role: "assistant",
          message: {
            content: [
              { type: "tool_use", name: "Task", input: { subagent_type: "code-reviewer", description: "Review" } },
              { type: "tool_use", name: "Read", input: { file_path: "/tmp/a.ts" } },
            ],
          },
        }),
        line({ type: "tool_result", name: "Read", content: "contents" }),
        line({ role: "user", message: { content: `<user_query>${INJECTED_NOTIFICATION}</user_query>` } }),
        line({
          role: "user",
          message: { content: "<user_query>Did the task_id notification fire once it has completed?</user_query>" },
        }),
      ].join(""),
    );

    const result = await readCursorTranscript(candidate, { projectsDir: root });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    expect(result.timeline).toEqual([
      { kind: "message", role: "user", text: "Fix the failing test" },
      { kind: "subagent", name: "code-reviewer", title: "Review" },
      { kind: "tool", tool: "Read", detail: "/tmp/a.ts" },
      {
        kind: "notice",
        summary: "The background agent (task_id: task-42) has completed",
        body: "This is an automated notification; do not reply to it directly.\nResult: all checks green",
      },
      { kind: "message", role: "user", text: "Did the task_id notification fire once it has completed?" },
    ]);
    expect(result.recentActivity).toEqual([
      { kind: "subagent", name: "code-reviewer", title: "Review" },
      { kind: "tool", tool: "Read", detail: "/tmp/a.ts" },
    ]);
    expect(result.stats).toEqual({ messageCount: 2, toolCount: 1, subagentCount: 1 });
  });

  /** D11: the mirror reuses the normalizer without the store's correlation maps,
   *  so it must run the same one-card-per-agent merge itself. */
  it("collapses resume continuations of one agent into a single card", async () => {
    const candidate = await writeNested(
      "project-a",
      "chat-merge",
      [
        line({
          role: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                name: "Task",
                input: { subagent_type: "asm-oracle", description: "Oracle advisor ready", prompt: "Stand by" },
              },
            ],
          },
        }),
        line({
          role: "assistant",
          message: {
            content: [
              { type: "tool_use", name: "Task", input: { description: "Follow-up 1", resume: "oracle-1" } },
              { type: "tool_use", name: "Read", input: { file_path: "/tmp/a.ts" } },
            ],
          },
        }),
        line({
          role: "assistant",
          message: {
            content: [{ type: "tool_use", name: "Task", input: { description: "Follow-up 2", resume: "oracle-1" } }],
          },
        }),
      ].join(""),
    );

    const result = await readCursorTranscript(candidate, { projectsDir: root });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    // The mirror carries no `Agent ID:` correlation, so the launch call stays its
    // own card; the two continuations naming one agent become one.
    expect(result.timeline).toEqual([
      { kind: "subagent", name: "asm-oracle", title: "Oracle advisor ready", prompt: "Stand by" },
      { kind: "subagent", name: "Task", title: "Follow-up 1", childAgentId: "oracle-1" },
      { kind: "tool", tool: "Read", detail: "/tmp/a.ts" },
    ]);
    expect(result.stats.subagentCount).toBe(2);
  });

  it("consumes a valid final JSON record without a newline", async () => {
    const candidate = await writeFlat(
      "project-a",
      "chat-1",
      JSON.stringify({ role: "assistant", message: { content: "Final answer" } }),
    );

    const result = await readCursorTranscript(candidate, { projectsDir: root });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    expect(result.pendingTail).toBe(false);
    expect(result.timeline).toEqual([{ kind: "message", role: "assistant", text: "Final answer" }]);
  });

  it("keeps an incomplete tail pending and resumes from its byte offset", async () => {
    const first = line({ role: "user", message: { content: "First" } });
    const candidate = await writeNested("project-a", "chat-1", `${first}{"role":"assistant"`);

    const initial = await readCursorTranscript(candidate, { projectsDir: root });
    expect(initial.status).toBe("ok");
    if (initial.status !== "ok") {
      return;
    }
    expect(initial.pendingTail).toBe(true);
    expect(initial.nextOffset).toBe(Buffer.byteLength(first));

    await fs.appendFile(candidate.filePath, ',"message":{"content":"Second"}}\n');
    const resumed = await readCursorTranscript(candidate, { projectsDir: root, fromOffset: initial.nextOffset });
    expect(resumed.status).toBe("ok");
    if (resumed.status !== "ok") {
      return;
    }
    expect(resumed.timeline).toEqual([{ kind: "message", role: "assistant", text: "Second" }]);
  });

  it("skips an oversized physical record without materializing it as transcript content", async () => {
    const candidate = await writeNested(
      "project-a",
      "chat-1",
      `${"x".repeat(MAX_CURSOR_TRANSCRIPT_LINE_BYTES + 1)}\n${line({ role: "user", message: { content: "Visible" } })}`,
    );

    const result = await readCursorTranscript(candidate, { projectsDir: root });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    expect(result.truncated).toBe(true);
    expect(result.timeline).toEqual([{ kind: "message", role: "user", text: "Visible" }]);
  });

  it("strips the observed reasoning-leak suffix from assistant mirror text", async () => {
    const candidate = await writeNested(
      "project-a",
      "chat-1",
      line({
        role: "assistant",
        message: { content: "Visible answer\n\n**Considering user response**\n\nprivate planning" },
      }),
    );

    const result = await readCursorTranscript(candidate, { projectsDir: root });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    expect(result.timeline).toEqual([{ kind: "message", role: "assistant", text: "Visible answer" }]);
  });

  it("rejects a forged candidate outside the projects root", async () => {
    const outside = path.join(path.dirname(root), "outside.jsonl");
    await fs.writeFile(outside, line({ role: "user", message: { content: "private" } }));
    try {
      const result = await readCursorTranscript(
        { transcriptId: "chat-1", projectBucket: "project-a", filePath: outside, layout: "flat" },
        { projectsDir: root },
      );
      expect(result.status).toBe("limited");
    } finally {
      await fs.rm(outside, { force: true });
    }
  });
});
