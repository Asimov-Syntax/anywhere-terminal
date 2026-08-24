import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type CursorTranscriptCandidate,
  cursorProjectSessionId,
  listCursorTranscriptCandidates,
  MAX_CURSOR_TRANSCRIPT_LINE_BYTES,
  readCursorTranscript,
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

  it("rejects duplicate transcript ids across project buckets", async () => {
    await writeNested("project-a", "chat-1", "");
    await writeNested("project-b", "chat-1", "");

    const result = await listCursorTranscriptCandidates({ projectsDir: root });
    expect(result.candidates).toEqual([]);
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
      { kind: "tool", tool: "Read", detail: "contents" },
    ]);
    expect(result.stats).toEqual({ messageCount: 2, toolCount: 2, subagentCount: 0 });
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
