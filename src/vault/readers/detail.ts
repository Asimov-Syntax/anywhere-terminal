// src/vault/readers/detail.ts — Shared, bounded, defensive substrate for the
// on-demand session-detail readers (redesign-vault-panel-ui D4/D5/D6).
//
// IO-free helpers + a classifier for Claude-style mixed-event JSONL transcripts
// (also reused by Codex rollout traces). Everything here is bounded (D5) and
// records tool/subagent CALLS only — never tool results as standalone steps
// (D6). `firstPrompt`/`latestMessage` are captured independently of the bounded
// recent-activity tail, and synthetic / sidechain records are excluded so the
// preview reflects the main conversation.

import type { VaultActivityStep, VaultMessageTokens, VaultSessionDetail, VaultTimelineItem } from "../types";
import { classifyUserRecord } from "./userRecord";

/** ~600-char cap per text field (D5). */
export const MAX_DETAIL_TEXT = 600;
/** Most-recent-N activity steps surfaced in the bounded `recentActivity` (D5). */
export const MAX_ACTIVITY_STEPS = 12;
/** Length cap for the timeline bodies that stay bounded (user prompts, reasoning).
 *  Assistant message bodies render in full via {@link normalizeRich}; the timeline
 *  is still bounded by item count + the head/tail record windows. */
export const MAX_MESSAGE_TEXT = 2000;
/** Most-recent-N timeline items surfaced (the preview is still bounded). */
export const MAX_TIMELINE_ITEMS = 400;
/** Hard ceiling on a webview-supplied `limit` — caps how far load-more can grow
 *  the timeline so a forged/garbage value can't disable the bound (W2). */
export const MAX_DETAIL_LIMIT = 5000;
/** Records kept from the head of a transcript (enough for `firstPrompt` + early
 *  context) when a file is too large to materialize whole (W1). */
export const DETAIL_HEAD_RECORDS = 100;
/** Records kept from the tail of a transcript (the most-recent timeline) when a
 *  file is too large to materialize whole (W1). */
export const DETAIL_TAIL_RECORDS = 4000;

/**
 * Clamp a webview-supplied `limit` to a finite, positive integer ≤
 * {@link MAX_DETAIL_LIMIT}. `undefined` / non-finite / ≤0 → `undefined` so the
 * reader falls back to its default bound (W2). Without this, `Infinity`/`NaN`
 * would slip past `typeof === "number"` and defeat `boundTimeline`.
 */
export function clampDetailLimit(limit: number | undefined): number | undefined {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
    return undefined;
  }
  return Math.min(Math.floor(limit), MAX_DETAIL_LIMIT);
}

/**
 * Bounded record collector for streaming a transcript without materializing the
 * whole file (W1). Push every parsed record; `result()` returns the retained
 * records IN ORDER plus `truncated` when the middle was dropped. Keeps the first
 * `headMax` records (so `firstPrompt`/early context survive) and the last
 * `tailMax` via an O(1) ring buffer (so the most-recent timeline survives).
 * Below `headMax + tailMax` total, every record is kept (exact, untruncated).
 */
export function createBoundedRecordBuffer(headMax = DETAIL_HEAD_RECORDS, tailMax = DETAIL_TAIL_RECORDS) {
  const cap = headMax + tailMax;
  let all: Rec[] | null = [];
  const head: Rec[] = [];
  const ring: Rec[] = new Array(Math.max(1, tailMax));
  let ringStart = 0;
  let ringCount = 0;

  function ringPush(rec: Rec): void {
    ring[(ringStart + ringCount) % tailMax] = rec;
    if (ringCount < tailMax) {
      ringCount++;
    } else {
      ringStart = (ringStart + 1) % tailMax;
    }
  }

  return {
    push(rec: Rec): void {
      if (all) {
        all.push(rec);
        if (all.length > cap) {
          // Switch to bounded mode: freeze the head, stream the rest through the ring.
          for (let i = 0; i < headMax; i++) {
            head.push(all[i]);
          }
          for (let i = headMax; i < all.length; i++) {
            ringPush(all[i]);
          }
          all = null;
        }
        return;
      }
      ringPush(rec);
    },
    result(): { records: Rec[]; truncated: boolean } {
      if (all) {
        return { records: all, truncated: false };
      }
      const tail: Rec[] = [];
      for (let i = 0; i < ringCount; i++) {
        tail.push(ring[(ringStart + i) % tailMax]);
      }
      return { records: [...head, GAP_RECORD, ...tail], truncated: true };
    },
  };
}

/** Keep only the most-recent `limit` items; flag when older were dropped. */
export function boundTimeline(
  items: VaultTimelineItem[],
  limit = MAX_TIMELINE_ITEMS,
): { timeline: VaultTimelineItem[]; truncated: boolean } {
  const cap = Math.max(1, limit);
  if (items.length <= cap) {
    return { timeline: items, truncated: false };
  }
  return { timeline: items.slice(items.length - cap), truncated: true };
}

type Rec = Record<string, unknown>;
const GAP_RECORD: Rec = Object.freeze({ type: "__vault_gap__" });

/**
 * A discovered sub-session (Claude `Agent`/`Task` spawn) the classifier can fold
 * into the parent timeline as a lazy `subagentSession`, matched to its spawning
 * tool call by `description`.
 */
export interface ClaudeChildStub {
  /** Resolvable `<agent>:<id>` the webview fetches on expand. */
  entryId: string;
  /** `agentType` / `subagent_type` — the agent persona. */
  agentType?: string;
  /** The spawn description (matches the tool call's `input.description`). */
  description?: string;
  /** The `tool_use` id of the `Agent`/`Task` call that spawned this subagent
   *  (from `agent-<id>.meta.json`). When present it is the EXACT parent edge — the
   *  call lives in the parent transcript (root or another subagent) — so the stub
   *  binds to its spawn block by id only, never by description. Absent on legacy
   *  transcripts written before this field, and on synthetic group nodes. */
  toolUseId?: string;
  /** The subagent's first prompt (collapsed-block preview). */
  firstMessage?: string;
  /** First-record timestamp (placement fallback for unmatched stubs). */
  timestamp?: number;
  /**
   * Render this nested node TITLE-ONLY: use `description` as the title and omit
   * the `@<agent>` chip (nest-workflow-team-sessions D8). Set for synthetic
   * workflow/team GROUP nodes and for their synthesized children (workflow
   * agents, team members), whose `description` already carries the full label —
   * so they don't inherit the `"subagent"` agent fallback. Unset (false) for real
   * subagents, which keep their `@<agentType>` prefix.
   */
  isGroup?: boolean;
}

export interface ClassifyOptions {
  /** Most-recent timeline-item cap (incremental load-more grows it). */
  limit?: number;
  /** Keep `isSidechain` records — true when classifying a subagent file whose
   *  content IS the sidechain (vs. the main file, where they are noise). */
  includeSidechain?: boolean;
  /** Sub-sessions to fold in at their spawning `Agent`/`Task` call. */
  childStubs?: ClaudeChildStub[];
  /**
   * Optional team-tag parser (nest-workflow-team-sessions D16). When a `user`
   * record's RAW text is an incoming `<teammate-message …>`, this returns the
   * sender + clean body so it is emitted as a `teammateMessage` timeline item
   * instead of a generic user message bearing the literal tag. Injected by the
   * Claude reader (which owns `parseTeammateTag`) — keeps this generic classifier
   * decoupled from the team concept; absent → the old plain-message behavior.
   */
  teammateMessage?: (rawText: string) => { agentName: string; from: string; color?: string; body: string } | null;
}

/** Result of classifying a transcript — `readDetail` adds `entryId`. */
export interface ClassifiedDetail {
  firstPrompt?: string;
  recentActivity: VaultActivityStep[];
  latestMessage?: { role: "user" | "assistant"; text: string; timestamp: number };
  timeline: VaultTimelineItem[];
  truncated?: boolean;
  stats: { messageCount: number; toolCount: number; subagentCount: number; tokenCount?: number };
}

/** Shown when a transcript was too large to read whole (head+tail kept). */
export const SOURCE_TRUNCATED_REASON =
  "Very large session — showing the start and the most recent messages. Resume to see all of it.";

/**
 * What the read could and could not see. Independent of `parts.truncated`, which
 * says only whether a larger `limit` would return more items (contracts P2).
 */
export type DetailSource = { kind: "complete" } | { kind: "partial"; reason: string };

/**
 * Everything a reader decoded and already bounded. The verdict fields are the
 * constructor's to set, so they are absent here — but the omission only binds
 * fresh object literals, which is why `finalizeDetail` also wins them at runtime.
 */
export type DetailParts = Omit<VaultSessionDetail, "entryId" | "contentKind" | "partial" | "limitedReason">;

/** A record reader's boolean source-truncation flag, as a verdict. */
export function sourceVerdict(truncated: boolean, reason: string = SOURCE_TRUNCATED_REASON): DetailSource {
  return truncated ? { kind: "partial", reason } : { kind: "complete" };
}

/**
 * Assemble a `VaultSessionDetail` from a classifier result. A SOURCE read
 * truncation (the bounded head+tail read dropped the middle — NOT recoverable
 * by raising `limit`) is surfaced via `partial` + `limitedReason`, kept DISTINCT
 * from the classifier's own `truncated`, which means the timeline was bounded to
 * the requested window and IS pageable via load-more (W1 / contracts P2).
 */
export function finalizeDetail(entryId: string, parts: DetailParts, source: DetailSource): VaultSessionDetail {
  // Verdict fields are written AFTER the spread. A caller may pass a whole
  // `VaultSessionDetail` as parts (`readOpenCodeDetail` does) and a variable
  // stays assignable to the Omit, so precedence — not the type — is what makes
  // this constructor authoritative over what it owns.
  const { partial: _partial, limitedReason: _limitedReason, ...carried } = parts as VaultSessionDetail;
  return {
    ...carried,
    entryId,
    contentKind: "timeline",
    ...(source.kind === "partial" ? { partial: true, limitedReason: source.reason } : {}),
  };
}

/**
 * The limited view: metadata only, no transcript. Takes no parts, so timeline
 * content cannot be passed in and silently dropped. `truncated` stays unset —
 * there is nothing to page through, so the preview must offer no load-more.
 */
export function limitedDetail(entryId: string, reason: string): VaultSessionDetail {
  return {
    entryId,
    recentActivity: [],
    timeline: [],
    stats: { messageCount: 0, toolCount: 0, subagentCount: 0 },
    partial: true,
    limitedReason: reason,
    contentKind: "metadata-only",
  };
}

/** Collapse whitespace, trim, cap at `max`, append an ellipsis when cut. */
export function truncate(text: string, max = MAX_DETAIL_TEXT): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/**
 * Normalize a message body for the rich preview renderer (D17) WITHOUT capping its
 * length: line breaks, code indentation, and table alignment all survive — only
 * line endings, per-line trailing whitespace, and runaway blank-line runs are
 * tidied; interior spaces are never collapsed. Use for assistant message bodies,
 * which render in full. {@link truncateRich} adds the length cap for bounded bodies.
 */
export function normalizeRich(text: string): string {
  return text
    .replace(/\r\n?/g, "\n") // CRLF / CR → LF
    .replace(/[ \t]+$/gm, "") // drop per-line trailing whitespace
    .replace(/\n{3,}/g, "\n\n") // cap long blank-line runs
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

/**
 * Like {@link normalizeRich} but length-capped with an ellipsis (like `truncate`).
 * Use for bounded full-transcript bodies (user prompts, reasoning); keep `truncate`
 * for compact single-line previews (titles, latest, tool labels).
 */
export function truncateRich(text: string, max = MAX_MESSAGE_TEXT): string {
  const normalized = normalizeRich(text);
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

/** Keep only the most-recent `max` steps (the tail). */
export function boundActivity<T>(steps: T[], max = MAX_ACTIVITY_STEPS): T[] {
  return steps.length > max ? steps.slice(steps.length - max) : steps;
}

/** One AskUserQuestion Q&A pair, shared by the per-agent question extractors. */
export type QuestionPair = Extract<VaultTimelineItem, { kind: "question" }>["questions"][number];

/**
 * Build a question's option list from raw `{label, description}` records, flagging
 * options whose label the user picked. Shared by the per-agent extractors (OpenCode
 * `state.metadata.answers`, Claude `toolUseResult.answers`); both feed the same
 * expandable question block in the preview.
 */
export function buildQuestionOptions(rawOptions: unknown[], picked: Set<string>): NonNullable<QuestionPair["options"]> {
  const options: NonNullable<QuestionPair["options"]> = [];
  for (const o of rawOptions) {
    const opt = o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : undefined;
    const label = str(opt?.label);
    if (!label) {
      continue;
    }
    const description = str(opt?.description);
    options.push({
      label: truncate(label),
      ...(description ? { description: truncate(description) } : {}),
      ...(picked.has(label) ? { chosen: true } : {}),
    });
  }
  return options;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function asObj(v: unknown): Rec | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : undefined;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Concise primary argument for a tool call (D6). */
export function toolLabel(name: string, input: unknown): string | undefined {
  const obj = asObj(input) ?? {};
  switch (name) {
    case "Read":
    case "Edit":
    case "MultiEdit":
    case "Write":
      return str(obj.file_path);
    case "Bash":
      return str(obj.command);
    case "Grep":
    case "Glob":
      return str(obj.pattern);
    default: {
      for (const v of Object.values(obj)) {
        const s = str(v);
        if (s) {
          return s;
        }
      }
      return undefined;
    }
  }
}

const COMMAND_NAME_RE = /<command-name>([\s\S]*?)<\/command-name>/;
const COMMAND_ARGS_RE = /<command-args>([\s\S]*?)<\/command-args>/;

const REMINDER_OPEN = "<system-reminder>";
const REMINDER_CLOSE = "</system-reminder>";

/**
 * Remove every `<system-reminder>…</system-reminder>` block from a message.
 * Claude appends these INSIDE an otherwise-human message, so an anchored
 * `startsWith` never sees them and the reader rendered the whole envelope as
 * the user's prompt. An unclosed block is left intact — a truncated tag is more
 * likely a human quoting the tag than a real injection, and eating the rest of
 * the message would be the worse failure. indexOf only: no regex over untrusted text.
 */
export function stripSystemReminders(text: string): string {
  if (!text.includes(REMINDER_OPEN)) {
    return text;
  }
  let out = "";
  let from = 0;
  for (;;) {
    const open = text.indexOf(REMINDER_OPEN, from);
    if (open < 0) {
      break;
    }
    const close = text.indexOf(REMINDER_CLOSE, open + REMINDER_OPEN.length);
    if (close < 0) {
      break; // unclosed — keep the remainder verbatim
    }
    out += text.slice(from, open);
    from = close + REMINDER_CLOSE.length;
    if (text[from] === "\n") {
      from++; // a reminder on its own line must not leave a blank one behind
    }
  }
  return `${out}${text.slice(from)}`.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Strip Claude Code's local-command wrappers from a user message, returning the
 * human-typed prompt — or `undefined` when the message is pure plumbing.
 *
 * Claude injects synthetic `user` records the human never typed: the
 * `<local-command-caveat>` banner, command stdout, and slash-command wrappers
 * (`<command-name>/foo</command-name><command-args>…`). A bare slash command
 * (`/clear`, `/compact`) carries no prompt, so it's dropped and the next real
 * message wins; a command WITH args surfaces those args (the real intent).
 *
 * The wrapper detection is anchored with `startsWith`, NOT a loose `includes`:
 * a real command record IS the wrapper (it starts with it), whereas a genuine
 * human prompt that merely *mentions* `<command-message>` / `<command-name>`
 * (e.g. a meta-prompt about Claude commands, or a pasted transcript) must be
 * kept verbatim — an `includes` check silently dropped such prompts whole.
 */
export function cleanPromptText(raw: string): string | undefined {
  const t = stripSystemReminders(raw).trim();
  if (!t) {
    return undefined;
  }
  // An incoming team message wraps the real text in `<teammate-message …>BODY
  // </teammate-message>`. Surface BODY only — the tag is plumbing the human never
  // typed, so a member's title/first-prompt reads as the instruction, not markup
  // (D16). ReDoS-safe: anchored `[^>]*` (no backtracking) + indexOf for the close.
  if (t.startsWith("<teammate-message")) {
    const open = /^<teammate-message\b[^>]*>/.exec(t);
    if (open) {
      const after = t.slice(open[0].length);
      const closeAt = after.indexOf("</teammate-message>");
      const body = (closeAt >= 0 ? after.slice(0, closeAt) : after).trim();
      return body || undefined;
    }
  }
  if (
    t.startsWith("<local-command-caveat>") ||
    t.startsWith("<local-command-stdout>") ||
    t.startsWith("<command-stdout>")
  ) {
    return undefined; // injected banner / command output — never a prompt
  }
  if (t.startsWith("<command-name>") || t.startsWith("<command-message>")) {
    const name = COMMAND_NAME_RE.exec(t)?.[1]?.trim() ?? "";
    const args = COMMAND_ARGS_RE.exec(t)?.[1]?.trim() ?? "";
    if (!args) {
      return undefined; // bare command (e.g. /clear) — no prompt to surface
    }
    return name ? `${name} ${args}` : args;
  }
  return t;
}

/** Join `text` blocks (or a string) from a message's `content`. */
export function extractText(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content.trim() || undefined;
  }
  if (Array.isArray(content)) {
    const text = content
      .filter((b): b is Rec => !!b && typeof b === "object")
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join(" ")
      .trim();
    return text || undefined;
  }
  return undefined;
}

/**
 * Claude addresses a record by its own `uuid`, so that is the locator (D4).
 * Spread into the item so a record without one carries no key at all.
 */
function msgRefOf(rec: Rec): { msgRef?: string } {
  const uuid = str(rec.uuid);
  return uuid ? { msgRef: uuid } : {};
}

function parseTimestamp(rec: Rec): number {
  const t = rec.timestamp;
  if (typeof t === "number") {
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof t === "string") {
    const ms = Date.parse(t);
    return Number.isNaN(ms) ? 0 : ms;
  }
  return 0;
}

/** Cheap diff stat from an Edit's old/new strings (newline delta only). */
function lineDelta(oldStr: unknown, newStr: unknown): { added: number; removed: number } | undefined {
  if (typeof oldStr !== "string" || typeof newStr !== "string") {
    return undefined;
  }
  const oldLines = oldStr === "" ? 0 : oldStr.split("\n").length;
  const newLines = newStr === "" ? 0 : newStr.split("\n").length;
  const added = Math.max(0, newLines - oldLines);
  const removed = Math.max(0, oldLines - newLines);
  return added === 0 && removed === 0 ? undefined : { added, removed };
}

/**
 * Pre-scan: map each AskUserQuestion `tool_use` id → the user's answers
 * (question-text → chosen text), recovered from the matching `tool_result`
 * record's structured `toolUseResult.answers`. The answer lives in a LATER record
 * than the call, so a single forward pass collects them before the main walk.
 */
function collectQuestionAnswers(records: Rec[]): Map<string, Record<string, string>> {
  const map = new Map<string, Record<string, string>>();
  for (const rec of records) {
    const answers = asObj(asObj(rec?.toolUseResult)?.answers);
    const content = asObj(rec?.message)?.content;
    if (!answers || !Array.isArray(content)) {
      continue;
    }
    const norm: Record<string, string> = {};
    for (const [q, a] of Object.entries(answers)) {
      const s = str(a);
      if (s) {
        norm[q] = s;
      }
    }
    for (const b of content) {
      const id = asObj(b)?.type === "tool_result" ? str(asObj(b)?.tool_use_id) : undefined;
      if (id) {
        map.set(id, norm);
      }
    }
  }
  return map;
}

/**
 * An AskUserQuestion `tool_use` → a structured question item: each question with
 * its options and the user's recovered answer (matched by question text; absent
 * when the call went unanswered). Returns null when nothing is parseable.
 */
function buildClaudeQuestionItem(
  input: unknown,
  answers: Record<string, string> | undefined,
  ts: number,
): Extract<VaultTimelineItem, { kind: "question" }> | null {
  const questions = Array.isArray(asObj(input)?.questions) ? (asObj(input)?.questions as unknown[]) : [];
  const pairs: QuestionPair[] = [];
  for (const q of questions) {
    const qObj = asObj(q);
    const qText = str(qObj?.question);
    const prompt = qText ?? str(qObj?.header);
    if (!prompt) {
      continue;
    }
    const answer = qText && answers ? str(answers[qText]) : undefined;
    // Claude joins a MULTI-select answer into one ", "-string (per the AskUserQuestion
    // source) — split it to match each picked option; a single-select answer (whose
    // own label may contain ", ") is matched whole.
    const picked = answer ? (qObj?.multiSelect === true ? answer.split(", ").map((s) => s.trim()) : [answer]) : [];
    const options = buildQuestionOptions(
      Array.isArray(qObj?.options) ? (qObj?.options as unknown[]) : [],
      new Set(picked.filter(Boolean)),
    );
    pairs.push({
      prompt: truncate(prompt),
      ...(answer ? { answer: truncate(answer) } : {}),
      ...(options.length ? { options } : {}),
    });
  }
  return pairs.length > 0 ? { kind: "question", questions: pairs, timestamp: ts } : null;
}

/**
 * Whole-stream collector of `Agent`/`Task` spawn `tool_use` ids — the parent edges
 * used to scope a transcript to its DIRECT children (support-nested-subagent-preview
 * D2). Pass `.onRecord` to `streamClaudeRecords` so it sees EVERY record (even those
 * the head+tail bound later drops — a direct child whose spawn call sits in the
 * truncated middle is still recognized), then read `.ids`. Mirrors the classifier's
 * record filtering: a ROOT read counts non-`isSidechain` records only (an older mixed
 * root file can carry a subagent's own spawn ids, which must NOT surface a nested
 * child at root); a SUBAGENT read (`includeSidechain`) counts all, since that file IS
 * the sidechain conversation.
 */
export function createSpawnIdCollector(includeSidechain: boolean): {
  ids: Set<string>;
  onRecord: (rec: Record<string, unknown>) => void;
} {
  const ids = new Set<string>();
  return {
    ids,
    onRecord: (rec) => {
      if (!rec || typeof rec !== "object") {
        return;
      }
      if (rec.isSidechain === true && !includeSidechain) {
        return;
      }
      if (rec.isMeta === true || rec.type !== "assistant") {
        return;
      }
      const content = asObj(rec.message)?.content;
      if (!Array.isArray(content)) {
        return;
      }
      for (const b of content) {
        const block = asObj(b);
        if (block?.type !== "tool_use") {
          continue;
        }
        const name = str(block.name);
        if (name === "Task" || name === "Agent") {
          const id = str(block.id);
          if (id) {
            ids.add(id);
          }
        }
      }
    },
  };
}

/**
 * Keep only the stubs that are THIS transcript's direct children: a stub WITH a
 * `toolUseId` survives iff that id was spawned in this transcript (`spawnIds`); a
 * stub WITHOUT one (legacy transcript / synthetic group node) is always kept and
 * falls back to description/timestamp matching downstream
 * (support-nested-subagent-preview D2/D4).
 */
export function scopeDirectChildren(stubs: ClaudeChildStub[], spawnIds: Set<string>): ClaudeChildStub[] {
  return stubs.filter((s) => s.toolUseId == null || spawnIds.has(s.toolUseId));
}

/**
 * Classify Claude-style mixed-event records into bounded session detail.
 * Records are the parsed JSONL objects (each with `type`, `message`,
 * `isSidechain?`, `timestamp?`). Only `user`/`assistant`, non-sidechain records
 * are considered; everything else (summary, last-prompt, ai-title, system, …)
 * is ignored.
 */
export function classifyClaudeStyleEvents(records: Rec[], opts: ClassifyOptions = {}): ClassifiedDetail {
  const limit = opts.limit ?? MAX_TIMELINE_ITEMS;
  const includeSidechain = opts.includeSidechain === true;
  // Mutable pool — each Agent/Task call consumes its matching stub (by
  // description); whatever is left is appended after the walk.
  const stubs = [...(opts.childStubs ?? [])];
  const totalStubs = opts.childStubs?.length ?? 0;
  // AskUserQuestion answers live in a later record than the call (the tool_result);
  // pre-scan them so the question item can carry the answer inline.
  const questionAnswers = collectQuestionAnswers(records);
  let firstPrompt: string | undefined;
  const activity: VaultActivityStep[] = [];
  let timeline: VaultTimelineItem[] = [];
  let latestMessage: ClassifiedDetail["latestMessage"];
  let messageCount = 0;
  let toolCount = 0;
  let spawnCalls = 0;
  let outputTokens = 0;
  let lastContextTokens = 0;
  let sawUsage = false;

  for (const rec of records) {
    if (!rec || typeof rec !== "object") {
      continue;
    }
    if (rec.type === "__vault_gap__") {
      timeline.push({ kind: "gap" });
      continue;
    }
    if (rec.isSidechain === true && !includeSidechain) {
      continue; // subagent-thread record, not the main conversation (D5)
    }
    if (rec.isMeta === true) {
      continue; // injected (caveat banner, skill/context, system reminder) — not a human turn
    }
    const type = rec.type;
    if (type !== "user" && type !== "assistant") {
      continue; // summary / last-prompt / system / … are not conversation
    }
    const msg = asObj(rec.message);
    if (!msg) {
      continue;
    }
    const content = msg.content;

    if (type === "user") {
      const raw = extractText(content);
      // An incoming teammate communication is stored as a `user` record wrapping
      // a `<teammate-message …>` tag. Surface it as a distinct, color-keyed
      // teammate message (clean body + sender) rather than a raw "USER" bubble
      // showing the literal tag (D16). Runs on the RAW text, before the
      // command-wrapper stripping `cleanPromptText` would mangle the tag.
      const tm = raw && opts.teammateMessage ? opts.teammateMessage(raw) : null;
      if (tm?.body) {
        messageCount++;
        const ts = parseTimestamp(rec);
        const text = truncateRich(tm.body, MAX_MESSAGE_TEXT);
        latestMessage = { role: "user", text: truncate(tm.body), timestamp: ts };
        timeline.push({
          kind: "teammateMessage",
          agentName: tm.agentName,
          ...(tm.color ? { color: tm.color } : {}),
          from: tm.from,
          text,
          timestamp: ts,
        });
        continue;
      }
      // Everything else in the user role goes through the one classifier: a real
      // prompt, plumbing to drop, a background-task notification, or a compaction
      // summary. Only a prompt is a conversation turn — the other two get their
      // own timeline kind and touch neither `messageCount` nor `latestMessage`.
      const cls = classifyUserRecord(rec);
      const ts = parseTimestamp(rec);
      const ref = msgRefOf(rec);
      if (cls.kind === "prompt") {
        messageCount++;
        if (firstPrompt === undefined) {
          firstPrompt = truncate(cls.text);
        }
        latestMessage = { role: "user", text: truncate(cls.text), timestamp: ts };
        timeline.push({
          kind: "message",
          role: "user",
          text: truncateRich(cls.text, MAX_MESSAGE_TEXT),
          timestamp: ts,
          ...ref,
        });
      } else if (cls.kind === "notice") {
        timeline.push({
          kind: "notice",
          summary: truncate(cls.summary),
          ...(cls.status ? { status: truncate(cls.status) } : {}),
          ...(cls.body ? { body: truncateRich(cls.body, MAX_MESSAGE_TEXT) } : {}),
          timestamp: ts,
          ...ref,
        });
      } else if (cls.kind === "compaction") {
        timeline.push({ kind: "compaction", text: truncateRich(cls.text, MAX_MESSAGE_TEXT), timestamp: ts, ...ref });
      }
      continue;
    }

    // assistant
    messageCount++;
    const ts = parseTimestamp(rec);
    const text = extractText(content);
    if (text) {
      latestMessage = { role: "assistant", text: truncate(text), timestamp: ts };
    }
    // Per-message model + token usage (enhance-vault-sessions D3). Assistant turns
    // only; attached to each text item emitted below. `input` is the context/prompt
    // size (input + cache read/creation), `output` the generated tokens.
    const msgModel = str(msg.model);
    const usageForMsg = asObj(msg.usage);
    const msgTokens: VaultMessageTokens | undefined = usageForMsg
      ? {
          input:
            num(usageForMsg.input_tokens) +
            num(usageForMsg.cache_read_input_tokens) +
            num(usageForMsg.cache_creation_input_tokens),
          output: num(usageForMsg.output_tokens),
        }
      : undefined;
    const msgMeta = {
      ...(msgModel ? { model: msgModel } : {}),
      ...(msgTokens ? { tokens: msgTokens } : {}),
      ...msgRefOf(rec),
    };
    if (Array.isArray(content)) {
      // Walk the content blocks in order so thinking / text / tool calls land in
      // the timeline in the sequence the assistant produced them.
      for (const b of content) {
        const block = asObj(b);
        if (!block) {
          continue;
        }
        if (block.type === "text" && typeof block.text === "string") {
          const t = (block.text as string).trim();
          if (t) {
            timeline.push({
              kind: "message",
              role: "assistant",
              text: normalizeRich(t),
              timestamp: ts,
              ...msgMeta,
            });
          }
        } else if (block.type === "thinking" && typeof block.thinking === "string") {
          const t = (block.thinking as string).trim();
          if (t) {
            timeline.push({ kind: "thinking", text: truncateRich(t, MAX_MESSAGE_TEXT), timestamp: ts });
          }
        } else if (block.type === "tool_use") {
          const name = str(block.name) ?? "tool";
          const input = block.input;
          if (name === "Task" || name === "Agent") {
            spawnCalls++;
            const inObj = asObj(input) ?? {};
            const sub = str(inObj.subagent_type) ?? str(inObj.agent) ?? "subagent";
            const prompt = str(inObj.prompt) ?? str(inObj.description);
            // Fold in a stored subagent transcript as a lazy nested block; else
            // surface the call as a plain subagent step. A stub carrying a
            // `toolUseId` (the spawn call's id) binds to THIS block by id ONLY — the
            // exact parent edge (support-nested-subagent-preview D1); legacy stubs
            // without one fall back to description (matchStub).
            const callId = str(block.id);
            const idIdx = callId ? stubs.findIndex((s) => s.toolUseId != null && s.toolUseId === callId) : -1;
            const matchIdx = idIdx >= 0 ? idIdx : matchStub(stubs, str(inObj.description), sub);
            if (matchIdx >= 0) {
              const [stub] = stubs.splice(matchIdx, 1);
              activity.push({ kind: "subagent", name: sub, prompt: prompt ? truncate(prompt) : undefined });
              timeline.push(stubToItem(stub, sub, prompt, ts));
            } else {
              const step: VaultActivityStep = {
                kind: "subagent",
                name: sub,
                prompt: prompt ? truncate(prompt) : undefined,
              };
              activity.push(step);
              timeline.push(step);
            }
          } else if (name === "Workflow") {
            // Suppressed (D5): the run is surfaced as a `workflowBoard` item, so drop
            // the raw tool_use here — don't render it or count it as a tool call.
          } else {
            // AskUserQuestion is a user decision point — surface the Q + options +
            // recovered answer as a first-class question item (parity with the
            // OpenCode reader). An unparseable one, and every other tool, falls
            // through to a generic tool step rather than vanishing.
            const question =
              name === "AskUserQuestion"
                ? buildClaudeQuestionItem(input, questionAnswers.get(str(block.id) ?? ""), ts)
                : null;
            toolCount++;
            if (question) {
              timeline.push(question);
            } else {
              const label = toolLabel(name, input);
              const inObj = asObj(input) ?? {};
              const diff =
                name === "Edit" || name === "MultiEdit" ? lineDelta(inObj.old_string, inObj.new_string) : undefined;
              const step: VaultActivityStep = {
                kind: "tool",
                tool: name,
                detail: label ? truncate(label) : undefined,
                diff,
              };
              activity.push(step);
              timeline.push(step);
            }
          }
        }
      }
    } else if (text) {
      timeline.push({ kind: "message", role: "assistant", text: normalizeRich(text), timestamp: ts, ...msgMeta });
    }

    const usage = asObj(msg.usage);
    if (usage) {
      sawUsage = true;
      outputTokens += num(usage.output_tokens);
      // Last turn's context ≈ input + cache. Overwritten each turn so it's the
      // final context size, not a (double-counting) cumulative input sum (D7).
      lastContextTokens =
        num(usage.input_tokens) + num(usage.cache_read_input_tokens) + num(usage.cache_creation_input_tokens);
    }
  }

  // Subagent files with no matched spawn call (e.g. a teammate launched a
  // different way) still surface — merged into the timeline at their timestamp
  // (placement fallback) rather than dumped after newer messages (W6).
  timeline = mergeUnmatchedStubs(timeline, stubs);

  // Count distinct subagents as max(spawn calls, transcript stubs): when both
  // exist but a description mismatch leaves a call unmatched, this avoids
  // double-counting the same child (the plain step AND the appended stub) (W4).
  const subagentCount = Math.max(spawnCalls, totalStubs);
  const tokenCount = sawUsage ? outputTokens + lastContextTokens : undefined;
  const bounded = boundTimeline(timeline, limit);
  return {
    firstPrompt,
    recentActivity: boundActivity(activity),
    latestMessage,
    timeline: bounded.timeline,
    ...(bounded.truncated ? { truncated: true } : {}),
    stats: {
      messageCount,
      toolCount,
      subagentCount,
      ...(tokenCount !== undefined ? { tokenCount } : {}),
    },
  };
}

/** Index of the first unconsumed stub whose description (else agentType) matches
 *  a spawn call, or -1. Description match is exact (trimmed); agentType is the
 *  fallback when the call carries no description. Stubs carrying a `toolUseId` are
 *  skipped here — they bind to their spawn block by id only (handled at the call
 *  site), so description must never re-home one to the wrong same-description call
 *  (support-nested-subagent-preview D2). */
function matchStub(stubs: ClaudeChildStub[], description: string | undefined, agentType: string): number {
  const want = description?.trim();
  if (want) {
    const i = stubs.findIndex((s) => s.toolUseId == null && s.description?.trim() === want);
    if (i >= 0) {
      return i;
    }
  }
  return stubs.findIndex((s) => s.toolUseId == null && s.agentType && s.agentType === agentType);
}

function timelineTimestamp(item: VaultTimelineItem): number | undefined {
  if ("timestamp" in item && typeof item.timestamp === "number" && Number.isFinite(item.timestamp)) {
    return item.timestamp;
  }
  return undefined;
}

/**
 * Stable linear merge of timestamped `extra` items into an already-ordered
 * `timeline` by timestamp. Each timestamped base item flushes any pending extra
 * older than it first; leftover extras append at the end. Base items with no
 * timestamp (bare tool/subagent steps) don't trigger placement, so the base
 * transcript order is kept intact (W6). `extra` is sorted by timestamp here, so
 * callers may pass it unordered.
 */
export function mergeTimestampedItems(timeline: VaultTimelineItem[], extra: VaultTimelineItem[]): VaultTimelineItem[] {
  if (extra.length === 0) {
    return timeline;
  }
  const sorted = [...extra].sort((a, b) => (timelineTimestamp(a) ?? 0) - (timelineTimestamp(b) ?? 0));
  const merged: VaultTimelineItem[] = [];
  let i = 0;
  for (const item of timeline) {
    const ts = timelineTimestamp(item);
    while (ts !== undefined && i < sorted.length && (timelineTimestamp(sorted[i]) ?? 0) < ts) {
      merged.push(sorted[i++]);
    }
    merged.push(item);
  }
  while (i < sorted.length) {
    merged.push(sorted[i++]);
  }
  return merged;
}

/**
 * Merge unmatched child stubs (each → a `subagentSession`) into the parent
 * timeline by timestamp — a thin wrapper over {@link mergeTimestampedItems}.
 */
function mergeUnmatchedStubs(timeline: VaultTimelineItem[], stubs: ClaudeChildStub[]): VaultTimelineItem[] {
  if (stubs.length === 0) {
    return timeline;
  }
  const items = stubs.map((stub) => stubToItem(stub, stub.agentType ?? "subagent", undefined, stub.timestamp));
  return mergeTimestampedItems(timeline, items);
}

/** Build a `subagentSession` timeline item from a matched stub + spawn call. A
 *  group/synthesized node (`stub.isGroup`) renders title-only: its `description`
 *  is the title and the `@<agent>` chip is omitted (D8). */
function stubToItem(
  stub: ClaudeChildStub,
  agentType: string,
  prompt: string | undefined,
  ts: number | undefined,
): VaultTimelineItem {
  const firstMessage = stub.firstMessage ?? prompt;
  const agent = stub.isGroup ? undefined : (stub.agentType ?? agentType);
  return {
    kind: "subagentSession",
    entryId: stub.entryId,
    title: stub.description || agentType,
    ...(firstMessage ? { firstMessage: truncate(firstMessage) } : {}),
    ...(agent ? { agent } : {}),
    ...(ts !== undefined ? { timestamp: ts } : {}),
  };
}

/**
 * Assemble a synthetic group detail (nest-workflow-team-sessions D1/D8): a
 * `VaultSessionDetail` whose `timeline` is one nested `subagentSession` per
 * `child` stub — used to resolve a workflow / team GROUP id into its members,
 * which the webview then renders (and lazily expands) through the SAME recursive
 * path as any nested session. No conversation of its own → empty
 * `recentActivity`; `subagentCount` is the descendant count for the group label.
 */
export function synthesizeGroupDetail(
  entryId: string,
  children: ClaudeChildStub[],
  opts: { firstPrompt?: string; subagentCount: number; limit?: number },
): VaultSessionDetail {
  const items: VaultTimelineItem[] = children.map((c) =>
    stubToItem(c, c.agentType ?? "subagent", undefined, c.timestamp),
  );
  // Bound the synthetic timeline like any other detail (review W4) so a group
  // with very many children can't ship an unbounded payload over IPC. A group is
  // NON-pageable in the nested renderer (review N2): the cap is MAX_TIMELINE_ITEMS
  // (400) — far above any realistic workflow (~30) / team (a handful), so it never
  // truncates in practice — and the group NODE label always states the TRUE total
  // count, so the rare >cap case is still surfaced (not silently hidden). Nested
  // load-more would require a webview change, which D1 forbids (host-only change).
  const bounded = boundTimeline(items, opts.limit ?? MAX_TIMELINE_ITEMS);
  return finalizeDetail(
    entryId,
    {
      ...(opts.firstPrompt ? { firstPrompt: truncate(opts.firstPrompt) } : {}),
      recentActivity: [],
      timeline: bounded.timeline,
      ...(bounded.truncated ? { truncated: true } : {}),
      stats: { messageCount: 0, toolCount: 0, subagentCount: opts.subagentCount },
    },
    { kind: "complete" },
  );
}
