// src/webview/vault/renderAtoms.ts — Pure DOM "atom" builders for the AI-vault
// panel + preview. Each takes data and returns an HTMLElement; none read panel
// state (`this`). Untrusted text is ALWAYS written via textContent (or the safe
// markdown-lite renderer, which never uses innerHTML) — never raw innerHTML.

import type {
  VaultActivityStep,
  VaultMessageTokens,
  VaultSessionDetail,
  VaultSessionEntry,
  VaultTimelineItem,
} from "../../vault/types";
import { attachTooltip } from "../ui/Tooltip";
import { formatRelativeTime, formatStats, leafSegment } from "./format";
import { ICON_CHEVRON_DOWN, ICON_COPY } from "./icons";
import { bindLatestSuccess } from "./latestSuccess";
import { renderMarkdownLite } from "./markdownLite";

/** Reasoning longer than this (or multi-line) collapses to a single-line gist
 *  with a chevron — reasoning is low-signal at a glance, so the preview keeps it
 *  to one clean line until the user expands it. */
const THINKING_INLINE_MAX = 90;

/** Which of the entry's values a meta-block copy affordance writes. The value is
 *  text the preview is already rendering, so the copy happens here rather than
 *  round-tripping through the host (D4). */
export type MetaCopyTarget = "cwd" | "gitBranch" | "sessionId" | "sessionPath";

/**
 * One click-to-copy meta value: shows `text`, discloses `tooltip` (the
 * untruncated value) on hover, and on click copies before flashing a tick.
 * The tooltip goes through the shared widget, not native `title` — a webview
 * never renders the native one, which is why no meta row disclosed anything.
 *
 * The tick waits for `onCopy` to resolve and is skipped when it rejects: a tick
 * is a claim that the clipboard now holds the value, and confirming a copy that
 * never landed is worse than not confirming at all.
 */
export function copyableValue(opts: {
  text: string;
  /** Untruncated value, disclosed on hover. */
  tooltip: string;
  onCopy: () => void | Promise<void>;
  /** Names the copy for assistive tech — "Copy branch name" reads better than
   *  the raw value, which the tooltip already carries. */
  action: string;
  /** Extra class alongside `.vault-preview-copyable` (the branch chip's pill). */
  className?: string;
  /** Leading glyph rendered before the text (the branch `⎇`). */
  prefix?: HTMLElement;
}): { element: HTMLElement; dispose: () => void } {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = opts.className ? `vault-preview-copyable ${opts.className}` : "vault-preview-copyable";
  btn.setAttribute("aria-label", opts.action);
  const glyph = document.createElement("span");
  glyph.className = "vault-preview-copyable-icon";
  glyph.innerHTML = ICON_COPY; // static icon constant, never session-derived (W6)
  glyph.setAttribute("aria-hidden", "true");
  if (opts.prefix) {
    btn.append(opts.prefix);
  }
  const label = document.createElement("span");
  label.className = "vault-preview-copyable-text";
  label.textContent = opts.text;
  btn.append(label, glyph);
  const disposeCopy = bindLatestSuccess(btn, opts.onCopy);
  const disposeTooltip = attachTooltip(btn, { text: opts.tooltip });
  return {
    element: btn,
    dispose: () => {
      disposeCopy();
      disposeTooltip();
    },
  };
}

/** A meta row's plain-text value. Wrapped rather than appended as a bare text
 *  node so the row's one-line ellipsis can apply to it — a text node in a flex
 *  row has no box to clamp. */
function metaText(text: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "vault-preview-meta-text";
  span.textContent = text;
  return span;
}

/** The session's git branch as a `⎇ <branch>` chip in the Folder row — itself a
 *  copy affordance, so the branch name can be lifted like every other value. */
function branchChip(branch: string, onCopy: () => void | Promise<void>) {
  const icon = document.createElement("span");
  icon.className = "vault-preview-branch-icon";
  icon.textContent = "⎇";
  icon.setAttribute("aria-hidden", "true");
  return copyableValue({
    text: branch,
    tooltip: `Git branch: ${branch}`,
    action: "Copy branch name",
    onCopy,
    className: "vault-preview-branch-chip",
    prefix: icon,
  });
}

/**
 * Preview meta block: Folder (+ branch), Session (id + transcript path), and
 * Activity (age, joined by the stats once the detail is in). Exactly three rows,
 * all present from the first render — the age is known at open time, so the
 * block does not grow a row underneath the reader when the detail lands (D6).
 */
export function buildPreviewMeta(
  entry: VaultSessionEntry,
  detail?: VaultSessionDetail,
  onCopy?: (target: MetaCopyTarget) => void,
): { element: HTMLElement; disposers: Array<() => void> } {
  const dl = document.createElement("dl");
  dl.className = "vault-preview-meta";
  const disposers: Array<() => void> = [];
  const addRow = (term: string, ...values: Array<Node | string>) => {
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.append(...values);
    dl.append(dt, dd);
  };
  const copyable = (text: string, tooltip: string, action: string, target: MetaCopyTarget): HTMLElement => {
    const { element, dispose } = copyableValue({ text, tooltip, action, onCopy: () => onCopy?.(target) });
    disposers.push(dispose);
    return element;
  };

  const folder: Array<Node | string> = [copyable(leafSegment(entry.cwd), entry.cwd, "Copy folder path", "cwd")];
  if (entry.gitBranch) {
    const chip = branchChip(entry.gitBranch, () => onCopy?.("gitBranch"));
    disposers.push(chip.dispose);
    folder.push(chip.element);
  }
  addRow("Folder", ...folder);

  const session: Array<Node | string> = [copyable(entry.sessionId, entry.sessionId, "Copy session id", "sessionId")];
  if (entry.sessionPath) {
    // Labelled "transcript", not the path itself: every character of Claude's
    // path is the folder or the id, both already on screen. A word says what
    // the copy yields; an icon made the reader guess.
    session.push(copyable("transcript", entry.sessionPath, "Copy transcript path", "sessionPath"));
  }
  addRow("Session", ...session);

  const age = formatRelativeTime(entry.modified);
  const stats = detail ? formatStats(detail.stats) : "";
  addRow("Activity", metaText([age, stats].filter(Boolean).join(" · ")));
  return { element: dl, disposers };
}

/** Loading placeholder body. */
export function loadingBody(): HTMLElement {
  const body = document.createElement("div");
  body.className = "vault-preview-loading";
  body.textContent = "Loading…";
  return body;
}

/** Leading dot for a preview message's role line (kind tints it via CSS). */
function roleDot(): HTMLElement {
  const dot = document.createElement("span");
  dot.className = "vault-preview-dot";
  dot.setAttribute("aria-hidden", "true");
  return dot;
}

/**
 * One preview message block (role line + body). The body is rendered either as
 * plain `textContent` (compact labels) or, when `rich`, through the safe
 * markdown-lite renderer (D17) so prose keeps its line breaks, code blocks, and
 * tables. Both paths put untrusted text into the DOM via textContent ONLY —
 * `renderMarkdownLite` never uses innerHTML — so the textContent-only safety rule
 * holds either way.
 */
/**
 * Which timeline item a rendered message came from, for the shared action bar
 * (D6). A WeakMap rather than a dataset index: re-rendering a run replaces
 * elements, and a stale index would silently copy the wrong message.
 */
export type VaultActionSource = Extract<VaultTimelineItem, { kind: "message" | "notice" | "compaction" }>;

const actionSources = new WeakMap<HTMLElement, VaultActionSource>();

export function bindActionSource(el: HTMLElement, item: VaultActionSource): void {
  actionSources.set(el, item);
  // A bound item carries actions, so it has to be reachable by Tab — the hover
  // bar is otherwise mouse-only. A collapsible item already has a focusable head.
  if (!el.querySelector("button, input, select, textarea, [tabindex]")) {
    el.tabIndex = 0;
  }
}

export function bindMessageSource(el: HTMLElement, item: Extract<VaultTimelineItem, { kind: "message" }>): void {
  bindActionSource(el, item);
}

export function actionSourceOf(el: HTMLElement): VaultActionSource | undefined {
  return actionSources.get(el);
}

export function messageSourceOf(el: HTMLElement): Extract<VaultTimelineItem, { kind: "message" }> | undefined {
  const source = actionSourceOf(el);
  return source?.kind === "message" ? source : undefined;
}

export function previewMessage(
  kind: string,
  roleLabel: string,
  text: string,
  rich = false,
  meta?: HTMLElement | null,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = `vault-preview-message vault-preview-message-${kind}`;
  const role = document.createElement("div");
  role.className = "vault-preview-message-role";
  const roleText = document.createElement("span");
  roleText.textContent = roleLabel;
  role.append(roleDot(), roleText);
  if (rich) {
    const body = document.createElement("div");
    body.className = "vault-md";
    body.appendChild(renderMarkdownLite(text));
    wrap.append(role, body);
  } else {
    const p = document.createElement("p");
    p.textContent = text;
    wrap.append(role, p);
  }
  // Per-message model + token usage (enhance-vault-sessions D3/D6) — assistant
  // messages only; omitted entirely when the reader recorded no model/tokens.
  if (meta) {
    wrap.appendChild(meta);
  }
  return wrap;
}

/** Compact token count: 1234 → "1.2k", 12345 → "12k", 456 → "456". */
function formatTokenCount(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  }
  return String(n);
}

/**
 * Per-assistant-message meta line (enhance-vault-sessions D3/D6): model + input/
 * output token usage, plus the context window when the agent records it (Codex).
 * Returns null when there is nothing to show so the caller omits the line entirely.
 */
export function buildMessageMeta(model?: string, tokens?: VaultMessageTokens): HTMLElement | null {
  const parts: string[] = [];
  if (model) {
    parts.push(model);
  }
  if (tokens) {
    if (typeof tokens.input === "number") {
      parts.push(`${formatTokenCount(tokens.input)} in`);
    }
    if (typeof tokens.output === "number") {
      parts.push(`${formatTokenCount(tokens.output)} out`);
    }
    if (typeof tokens.contextWindow === "number") {
      parts.push(`${formatTokenCount(tokens.contextWindow)} ctx`);
    }
  }
  if (parts.length === 0) {
    return null;
  }
  const el = document.createElement("div");
  el.className = "vault-preview-message-meta";
  el.textContent = parts.join(" · ");
  return el;
}

/** First non-empty line of reasoning, stripped of markdown noise — used as the
 *  one-line gist shown while a thinking block is collapsed. */
function thinkingGist(text: string): string {
  const firstLine = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return (firstLine ?? text.trim())
    .replace(/^[#>\-*\s]+/, "")
    .replace(/[*_`]/g, "")
    .trim();
}

/**
 * A reasoning block. Short reasoning renders inline. Long / multi-line reasoning
 * collapses to a single-line gist (`● THINKING  <gist…>  ⌄`) that expands to the
 * full markdown on click — reasoning is low-signal at a glance, and a 1-line
 * ellipsis is reliable where a multi-line clamp on the `.vault-md` block is not
 * (R5: `-webkit-line-clamp` can collapse block-child containers to height 0).
 */
export function thinkingBlock(text: string): HTMLElement {
  if (text.trim().length <= THINKING_INLINE_MAX && !text.includes("\n")) {
    return previewMessage("thinking", "Thinking", text, true);
  }
  return collapsibleMessage({
    kind: "thinking",
    label: "Thinking",
    gist: thinkingGist(text),
    body: text,
    legacyClass: "vault-preview-thinking",
    expandTitle: "Show the full reasoning",
    collapseTitle: "Collapse the reasoning",
  });
}

/**
 * One collapsed line — role chip + single-line gist + chevron — expanding to a
 * markdown body on click. Shared by reasoning, background-task notices and
 * compaction summaries: all three are bulk the reader wants folded away until
 * asked for. `legacyClass` keeps a kind's original per-element class alongside
 * the shared one so existing selectors still resolve.
 */
export function collapsibleMessage(spec: {
  kind: string;
  label: string;
  gist: string;
  body: string;
  legacyClass?: string;
  expandTitle: string;
  collapseTitle: string;
}): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = `vault-preview-message vault-preview-message-${spec.kind} is-collapsible`;
  const cls = (name: string) => {
    const shared = `vault-preview-collapsible-${name}`;
    return spec.legacyClass ? `${shared} ${spec.legacyClass}-${name}` : shared;
  };

  const head = document.createElement("button");
  head.type = "button";
  head.className = cls("head");
  head.title = spec.expandTitle;
  head.setAttribute("aria-expanded", "false");

  const role = document.createElement("span");
  role.className = "vault-preview-message-role";
  const label = document.createElement("span");
  label.textContent = spec.label;
  role.append(roleDot(), label);

  const gist = document.createElement("span");
  gist.className = cls("gist");
  gist.textContent = spec.gist;

  const chevron = document.createElement("span");
  chevron.className = cls("chevron");
  chevron.innerHTML = ICON_CHEVRON_DOWN;
  chevron.setAttribute("aria-hidden", "true");
  head.append(role, gist, chevron);

  const body = document.createElement("div");
  body.className = `vault-md ${cls("body")}`;
  body.appendChild(renderMarkdownLite(spec.body));

  head.addEventListener("click", () => {
    const expanded = wrap.classList.toggle("is-expanded");
    head.setAttribute("aria-expanded", expanded ? "true" : "false");
    head.title = expanded ? spec.collapseTitle : spec.expandTitle;
  });

  wrap.append(head, body);
  return wrap;
}

/**
 * A background-task notification: the summary is the whole story at a glance, so
 * it is the gist; the result body — which can be a full agent report — stays
 * folded. No body → a plain line with no expander.
 */
export function noticeBlock(item: Extract<VaultTimelineItem, { kind: "notice" }>): HTMLElement {
  const label = item.status ? `Background task · ${item.status}` : "Background task";
  if (!item.body) {
    return previewMessage("notice", label, item.summary);
  }
  return collapsibleMessage({
    kind: "notice",
    label,
    gist: item.summary,
    body: `${item.summary}\n\n${item.body}`,
    expandTitle: "Show the task output",
    collapseTitle: "Hide the task output",
  });
}

/** A context-compaction summary — tens of KB the human never typed, so it reads
 *  as one line until expanded. */
export function compactionBlock(item: Extract<VaultTimelineItem, { kind: "compaction" }>): HTMLElement {
  const text = item.text.trim();
  if (text.length <= THINKING_INLINE_MAX && !text.includes("\n")) {
    return previewMessage("compaction", "Context compacted", text);
  }
  return collapsibleMessage({
    kind: "compaction",
    label: "Context compacted",
    gist: thinkingGist(text),
    body: text,
    expandTitle: "Show the compaction summary",
    collapseTitle: "Hide the compaction summary",
  });
}

export function timelineGap(): HTMLElement {
  const gap = document.createElement("div");
  gap.className = "vault-preview-gap";
  gap.textContent = "Earlier transcript omitted";
  return gap;
}

/**
 * An AskUserQuestion turn: each question with the user's chosen answer (or an
 * italic "Awaiting answer" when the call was still pending). The prompt + answer
 * always show; when the call carried options, the role line becomes a toggle that
 * reveals the full choice list (descriptions, picked one highlighted) on click.
 */
export function questionBlock(item: Extract<VaultTimelineItem, { kind: "question" }>): HTMLElement {
  const hasOptions = item.questions.some((q) => (q.options?.length ?? 0) > 0);
  const wrap = document.createElement("div");
  wrap.className = "vault-preview-message vault-preview-message-question";
  const roleLabel = item.questions.length > 1 ? `Question · ${item.questions.length}` : "Question";

  if (hasOptions) {
    wrap.classList.add("is-collapsible");
    const head = document.createElement("button");
    head.type = "button";
    head.className = "vault-preview-message-role vault-preview-question-head";
    head.title = "Show the options";
    const firstPrompt = item.questions[0]?.prompt;
    head.setAttribute("aria-label", firstPrompt ? `Show options for: ${firstPrompt}` : "Show the options");
    head.setAttribute("aria-expanded", "false");
    const label = document.createElement("span");
    label.textContent = roleLabel;
    const chevron = document.createElement("span");
    chevron.className = "vault-preview-question-chevron";
    chevron.innerHTML = ICON_CHEVRON_DOWN;
    chevron.setAttribute("aria-hidden", "true");
    head.append(roleDot(), label, chevron);
    head.addEventListener("click", () => {
      const expanded = wrap.classList.toggle("is-expanded");
      head.setAttribute("aria-expanded", expanded ? "true" : "false");
      head.title = expanded ? "Hide the options" : "Show the options";
    });
    wrap.append(head);
  } else {
    const role = document.createElement("div");
    role.className = "vault-preview-message-role";
    const label = document.createElement("span");
    label.textContent = roleLabel;
    role.append(roleDot(), label);
    wrap.append(role);
  }

  for (const q of item.questions) {
    const prompt = document.createElement("p");
    prompt.className = "vault-preview-question-prompt";
    prompt.textContent = q.prompt;
    const answer = document.createElement("p");
    answer.className = "vault-preview-question-answer";
    if (q.answer) {
      const arrow = document.createElement("span");
      arrow.className = "vault-preview-question-arrow";
      arrow.textContent = "→ ";
      arrow.setAttribute("aria-hidden", "true");
      answer.append(arrow, document.createTextNode(q.answer));
    } else {
      answer.classList.add("is-pending");
      answer.textContent = "Awaiting answer";
    }
    wrap.append(prompt, answer);
    if (q.options?.length) {
      wrap.append(questionOptions(q.options));
    }
  }
  return wrap;
}

/** The collapsible option list for one question — each option's label + optional
 *  description, with the user's pick highlighted. Hidden until the block expands. */
function questionOptions(
  options: NonNullable<Extract<VaultTimelineItem, { kind: "question" }>["questions"][number]["options"]>,
): HTMLElement {
  const list = document.createElement("ul");
  list.className = "vault-preview-question-options";
  for (const o of options) {
    const li = document.createElement("li");
    li.className = "vault-preview-question-option";
    if (o.chosen) {
      li.classList.add("is-chosen");
    }
    const label = document.createElement("span");
    label.className = "vault-preview-question-option-label";
    label.textContent = o.label;
    li.append(label);
    if (o.description) {
      const desc = document.createElement("span");
      desc.className = "vault-preview-question-option-desc";
      desc.textContent = o.description;
      li.append(desc);
    }
    list.append(li);
  }
  return list;
}

/** Render one recent-activity step (tool call or subagent invocation). */
export function activityStep(step: VaultActivityStep): HTMLElement {
  if (step.kind === "subagent") {
    const block = document.createElement("div");
    block.className = "vault-preview-subagent";

    const head = document.createElement("button");
    head.type = "button";
    head.className = "vault-preview-subagent-head";
    head.setAttribute("aria-expanded", "false");
    const chevron = document.createElement("span");
    chevron.className = "vault-preview-subagent-chevron";
    chevron.innerHTML = ICON_CHEVRON_DOWN;
    chevron.setAttribute("aria-hidden", "true");
    const title = document.createElement("span");
    title.className = "vault-preview-subagent-title";
    title.textContent = step.title ?? step.prompt ?? step.name;
    if (step.undeclared) {
      // Source never declared an agent type — title only, no invented chip.
      head.append(chevron, title);
      head.setAttribute("aria-label", `Subagent: ${title.textContent}`);
      head.title = `Toggle subagent: ${title.textContent}`;
    } else {
      const badge = document.createElement("span");
      badge.className = "vault-preview-subagent-badge";
      badge.textContent = "agent";
      const agent = document.createElement("span");
      agent.className = "vault-preview-subagent-agent";
      agent.textContent = `@${step.name}`;
      const sep = document.createElement("span");
      sep.className = "vault-preview-subagent-sep";
      sep.textContent = "·";
      sep.setAttribute("aria-hidden", "true");
      head.append(chevron, badge, agent, sep, title);
      head.setAttribute("aria-label", `Subagent @${step.name}: ${title.textContent}`);
      head.title = `Toggle subagent @${step.name}: ${title.textContent}`;
    }

    const body = document.createElement("div");
    body.className = "vault-preview-subagent-body";
    const populateBody = () => {
      body.replaceChildren();
      if (step.prompt && step.prompt !== step.title) {
        body.append(previewMessage("user", "Prompt", step.prompt, true));
      }
      if (step.result) {
        const suffix = step.status ? ` · ${step.status}` : "";
        body.append(previewMessage("assistant", `Result${suffix}`, step.result, true));
      }
    };

    head.addEventListener("click", () => {
      const open = !block.classList.contains("is-open");
      block.classList.toggle("is-open", open);
      head.setAttribute("aria-expanded", String(open));
      if (open) {
        populateBody();
      } else {
        body.replaceChildren();
      }
    });
    block.append(head, body);
    return block;
  }
  const wrap = document.createElement("div");
  wrap.className = "vault-preview-message vault-preview-message-tool";
  const role = document.createElement("div");
  role.className = "vault-preview-message-role";
  const roleText = document.createElement("span");
  roleText.textContent = step.tool;
  role.append(roleDot(), roleText);
  const p = document.createElement("p");
  p.textContent = step.detail ?? "";
  if (step.diff) {
    const sep = document.createElement("span");
    sep.className = "vault-preview-mute";
    sep.textContent = " · ";
    const add = document.createElement("span");
    add.className = "vault-preview-diff-add";
    add.textContent = `+${step.diff.added}`;
    const del = document.createElement("span");
    del.className = "vault-preview-diff-del";
    del.textContent = ` −${step.diff.removed}`;
    p.append(sep, add, del);
  }
  wrap.append(role, p);
  return wrap;
}

/** Build an empty / no-match panel (icon + title + body), all via textContent. */
export function emptyState(iconSvg: string, title: string, body: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "vault-empty";
  const icon = document.createElement("span");
  icon.className = "vault-empty-icon";
  icon.innerHTML = iconSvg;
  icon.setAttribute("aria-hidden", "true");
  const titleEl = document.createElement("div");
  titleEl.className = "vault-empty-title";
  titleEl.textContent = title;
  const bodyEl = document.createElement("div");
  bodyEl.className = "vault-empty-body";
  bodyEl.textContent = body;
  wrap.append(icon, titleEl, bodyEl);
  return wrap;
}
