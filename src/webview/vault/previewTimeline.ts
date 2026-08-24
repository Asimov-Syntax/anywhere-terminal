// Pure DOM builders for the preview transcript (root + nested subagent/teammate
// bodies). Stateless humble object: expansion state + nested-loading live in the
// owner; these functions read it and signal back through a callback bag, so the
// produced DOM stays byte-identical to the inlined version. Untrusted strings go
// through textContent only; the lone innerHTML is the closed-map chevron icon.

import type { VaultActivityStep, VaultSessionDetail, VaultTimelineItem } from "../../vault/types";
import { formatRelativeTime } from "./format";
import { ICON_CHEVRON_DOWN } from "./icons";
import { teammateAccent } from "./previewColors";
import {
  activityStep,
  bindActionSource,
  bindMessageSource,
  buildMessageMeta,
  compactionBlock,
  noticeBlock,
  previewMessage,
  questionBlock,
  thinkingBlock,
  timelineGap,
} from "./renderAtoms";
import { renderWorkflowBoard } from "./workflowBoard";

/** A prominent node that breaks the surrounding AI-output run and renders directly
 *  (nested subagent/workflow blocks + threaded/inline teammate communications). A
 *  new prominent kind is added here ONCE, not in both run-grouping conditions. */
function breaksRun(item: VaultTimelineItem): boolean {
  return (
    item.kind === "subagentSession" ||
    item.kind === "teammateTurn" ||
    item.kind === "teammateMessage" ||
    item.kind === "workflowBoard" ||
    item.kind === "question" ||
    item.kind === "notice" ||
    item.kind === "compaction" ||
    item.kind === "gap"
  );
}

/** A workflow board's ephemeral state, persisted by the owner so it survives a
 *  preview re-render (e.g. a load-more rebuild). `expanded` is whether the board's
 *  body (panes) is unfolded; `open` lists the expanded phase keys (`NaN` for the
 *  "Other" bucket); `agentEntryId` is the open agent's transcript id, or null. */
export interface BoardSelection {
  expanded: boolean;
  open: number[];
  agentEntryId: string | null;
}

export interface NestedInvocationFallback {
  agent?: string;
  /** No declared agent type — the reconstructed card must not invent one. */
  undeclared?: boolean;
  title: string;
  prompt?: string;
  result?: string;
  status?: "running" | "completed" | "failed";
}

export interface PreviewTimelineBag {
  /** Whether an AI-run (keyed `<prefix>#<idx>`) is expanded past its cap. */
  isRunExpanded: (key: string) => boolean;
  /** Expand a run and re-render in place (owner preserves scroll). */
  onExpandRun: (key: string) => void;
  /**
   * Whether a nested subagent/teammate block is open. `cardKey` identifies the
   * CARD (its place in this timeline), so two cards addressing the same child
   * open and close independently; an owner that has no per-card state may ignore
   * it and key by `entryId` alone.
   */
  isNestedExpanded: (entryId: string, cardKey: string) => boolean;
  /** Open/close ONE nested card. On close the owner drops that card's share of any
   *  in-flight request — `body` says which — leaving other open cards loading. */
  setNestedExpanded: (entryId: string, expanded: boolean, cardKey: string, body: HTMLElement) => void;
  /** Fill a nested block's body from cache, or lazily fetch the child detail. */
  populateNested: (entryId: string, body: HTMLElement, fallback?: NestedInvocationFallback) => void;
  /** Read a workflow board's persisted selection (keyed by run id), or undefined. */
  getBoardSelection: (boardKey: string) => BoardSelection | undefined;
  /** Persist a workflow board's selection (keyed by run id). Records only — must
   *  NOT trigger a re-render (the board updates its own DOM locally, D4). */
  setBoardSelection: (boardKey: string, selection: BoardSelection) => void;
}

/**
 * Render a timeline (root preview or a nested body) into a container: user
 * messages flush-left; each AI-output run between them is indented and capped
 * behind a "Show N more". Prominent nested nodes (subagent/workflow GROUP and
 * color-highlighted teammateTurns) break the run and always render directly.
 * Run-expansion keys are prefixed by `keyPrefix` so nested runs can't collide.
 */
export function renderTimelineInto(
  container: HTMLElement,
  timeline: VaultTimelineItem[],
  keyPrefix: string,
  bag: PreviewTimelineBag,
): void {
  const cardKeys = nestedCardKeys(timeline, keyPrefix);
  let i = 0;
  let runIndex = 0;
  while (i < timeline.length) {
    const item = timeline[i];
    if (item.kind === "message" && item.role === "user") {
      container.appendChild(renderTimelineItem(item, bag, cardKeys));
      i++;
      continue;
    }
    if (breaksRun(item)) {
      container.appendChild(renderTimelineItem(item, bag, cardKeys));
      i++;
      continue;
    }
    const run: VaultTimelineItem[] = [];
    while (i < timeline.length) {
      const it = timeline[i];
      if (it.kind === "message" && it.role === "user") {
        break;
      }
      if (breaksRun(it)) {
        break;
      }
      run.push(it);
      i++;
    }
    renderRun(container, run, `${keyPrefix}#${runIndex++}`, bag, cardKeys);
  }
}

/** Render a child detail's timeline into a nested container (reuses the shared
 *  run-grouping renderer; `entryId` keys its run expansions apart from the root). */
export function renderNestedInto(
  container: HTMLElement,
  detail: VaultSessionDetail,
  entryId: string,
  bag: PreviewTimelineBag,
): void {
  container.replaceChildren();
  const timeline = detail.timeline ?? [];
  if (timeline.length === 0) {
    const empty = document.createElement("p");
    empty.className = "vault-preview-subagent-empty";
    empty.textContent = "(no messages)";
    container.appendChild(empty);
    return;
  }
  renderTimelineInto(container, timeline, entryId, bag);
  focusInvocationTurn(container, nestedFocusPrompt.get(container));
}

/** Which turn a pending nested load should reveal, keyed by the body it renders
 *  into. The child arrives on an async round trip, so a closure cannot carry the
 *  hint, and the bag contract is shared with the popup and the board (D6). */
const nestedFocusPrompt = new WeakMap<HTMLElement, string>();

function rememberFocusPrompt(body: HTMLElement, prompt: string | undefined): void {
  if (prompt) {
    nestedFocusPrompt.set(body, prompt);
  } else {
    nestedFocusPrompt.delete(body);
  }
}

/** Minimum prompt length worth matching on — below this a prefix is not evidence
 *  that two turns are the same turn. */
const MIN_FOCUS_PROMPT_CHARS = 12;
const MAX_FOCUS_PROMPT_CHARS = 200;

function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The rendered turn is block elements whose `textContent` concatenates with no
 *  separator, so a blank line in the prompt is unmatchable. Match one paragraph. */
function focusNeedle(prompt: string): string | undefined {
  for (const paragraph of prompt.split(/\n\s*\n/)) {
    const needle = normalizeForMatch(paragraph).slice(0, MAX_FOCUS_PROMPT_CHARS);
    if (needle.length >= MIN_FOCUS_PROMPT_CHARS) {
      return needle;
    }
  }
  return undefined;
}

/** Reveal the turn an invocation's prompt began. First match only, and nothing at
 *  all when none matches — never mark an unrelated turn (D6). */
function focusInvocationTurn(container: HTMLElement, prompt: string | undefined): void {
  if (!prompt) {
    return;
  }
  const needle = focusNeedle(prompt);
  if (!needle) {
    return;
  }
  for (const message of container.querySelectorAll<HTMLElement>(".vault-preview-message-user")) {
    const body = normalizeForMatch(message.textContent ?? "");
    if (!body.includes(needle)) {
      continue;
    }
    for (const stale of container.querySelectorAll(".is-invocation-focus")) {
      stale.classList.remove("is-invocation-focus");
    }
    message.classList.add("is-invocation-focus");
    // jsdom and older webviews have no scrollIntoView; the mark still lands.
    message.scrollIntoView?.({ block: "center" });
    return;
  }
}

/** Restore the bounded invocation card when a Cursor child detail cannot be read.
 *  The original source-provided Prompt/Result stays visible; no child transcript is
 *  inferred from the failed request. */
export function renderNestedInvocationFallback(container: HTMLElement, fallback: NestedInvocationFallback): void {
  const item: Extract<VaultActivityStep, { kind: "subagent" }> = {
    kind: "subagent",
    name: fallback.agent ?? "Agent",
    ...(fallback.undeclared ? { undeclared: true } : {}),
    title: fallback.title,
    ...(fallback.prompt !== undefined ? { prompt: fallback.prompt } : {}),
    ...(fallback.result !== undefined ? { result: fallback.result } : {}),
    ...(fallback.status !== undefined ? { status: fallback.status } : {}),
  };
  const card = activityStep(item);
  container.replaceChildren(card);
  card.querySelector<HTMLButtonElement>(".vault-preview-subagent-head")?.click();
}

/**
 * Identify each nested card by `<prefix>|<entryId>|<title>#<n>`, scoped to the
 * timeline it lives in. Two cards addressing one child therefore hold their own
 * expansion state, and because `n` counts only cards identical in BOTH child and
 * title, the key survives a load-more that prepends an older same-child card as
 * well as a live-follow append (an occurrence-in-timeline index survives neither).
 * Cards identical in child AND title remain indistinguishable — the honest floor.
 */
function nestedCardKeys(timeline: VaultTimelineItem[], keyPrefix: string): Map<VaultTimelineItem, string> {
  const keys = new Map<VaultTimelineItem, string>();
  const counts = new Map<string, number>();
  for (const item of timeline) {
    if (item.kind !== "subagentSession" && item.kind !== "teammateTurn") {
      continue;
    }
    const title = item.kind === "subagentSession" ? (item.title ?? "") : (item.preview ?? "");
    // JSON keeps the tuple injective — plain `|` concatenation let a `|` in the
    // free-text title (or an unvalidated entry id) merge distinct cards (W19).
    const identity = JSON.stringify([item.entryId, title]);
    const seen = counts.get(identity) ?? 0;
    counts.set(identity, seen + 1);
    keys.set(item, `${keyPrefix}|${identity}#${seen}`);
  }
  return keys;
}

/** One timeline node: user/assistant message, thinking block, or tool/subagent step. */
function renderTimelineItem(
  item: VaultTimelineItem,
  bag: PreviewTimelineBag,
  cardKeys: Map<VaultTimelineItem, string>,
): HTMLElement {
  if (item.kind === "message") {
    const label = item.role === "assistant" ? "Assistant" : "User";
    const suffix = item.timestamp ? ` · ${formatRelativeTime(item.timestamp)}` : "";
    // Model/tokens ride on assistant messages only (D3); user messages carry neither.
    const meta = item.role === "assistant" ? buildMessageMeta(item.model, item.tokens) : null;
    const el = previewMessage(item.role, `${label}${suffix}`, item.text, true, meta);
    bindMessageSource(el, item); // the shared action bar resolves the element back to this item (D6)
    return el;
  }
  if (item.kind === "thinking") {
    return thinkingBlock(item.text);
  }
  if (item.kind === "question") {
    return questionBlock(item);
  }
  if (item.kind === "subagentSession") {
    return renderSubagentSession(item, bag, cardKeys.get(item) ?? item.entryId);
  }
  if (item.kind === "teammateTurn") {
    return renderTeammateTurn(item, bag, cardKeys.get(item) ?? item.entryId);
  }
  if (item.kind === "teammateMessage") {
    return renderTeammateMessage(item);
  }
  if (item.kind === "workflowBoard") {
    return renderWorkflowBoard(item, bag);
  }
  if (item.kind === "notice") {
    const el = noticeBlock(item);
    bindActionSource(el, item);
    return el;
  }
  if (item.kind === "compaction") {
    const el = compactionBlock(item);
    bindActionSource(el, item);
    return el;
  }
  if (item.kind === "gap") {
    return timelineGap();
  }
  return activityStep(item);
}

/** Render one AI-output run, capped at 3 behind a "Show N more". A capped run's
 *  concluding assistant message is pinned BELOW the expand so the highest-signal
 *  item stays visible: head (CAP-1) + expand + pinned conclusion. */
function renderRun(
  body: HTMLElement,
  run: VaultTimelineItem[],
  key: string,
  bag: PreviewTimelineBag,
  cardKeys: Map<VaultTimelineItem, string>,
): void {
  const CAP = 3;
  if (bag.isRunExpanded(key) || run.length <= CAP) {
    for (const it of run) {
      body.appendChild(renderTimelineItem(it, bag, cardKeys));
    }
    return;
  }

  // Pin the run's LAST assistant message — its concluding text — even when
  // low-signal tool steps trail it (an agent that ends a turn with an
  // AskUserQuestion call, or a final bookkeeping `git status`, leaves its answer
  // second-to-last). A head-only slice would bury that conclusion behind "Show N
  // more". Skip the pin only when the message already falls inside the head window
  // (nothing to rescue); the trailing steps stay collapsed and reappear, in
  // natural order, on expand.
  let pinIndex = -1;
  for (let k = run.length - 1; k >= 0; k--) {
    const it = run[k];
    if (it.kind === "message" && it.role === "assistant" && it.text.trim().length > 0) {
      pinIndex = k;
      break;
    }
  }
  // Pin only when the conclusion would otherwise be hidden — i.e. it sits beyond
  // the CAP-item head a non-pinned run shows. At pinIndex < CAP it's already in
  // that head, so pinning would needlessly reorder it below the expand.
  const pin = pinIndex >= CAP;
  const headCount = pin ? CAP - 1 : CAP;
  for (let k = 0; k < headCount; k++) {
    body.appendChild(renderTimelineItem(run[k], bag, cardKeys));
  }

  const hidden = run.length - CAP;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "vault-preview-expand";
  btn.textContent = `Show ${hidden} more step${hidden === 1 ? "" : "s"}`;
  btn.title = "Show every step in this run";
  body.appendChild(btn);
  const pinned = pin ? renderTimelineItem(run[pinIndex], bag, cardKeys) : null;
  if (pinned) {
    body.appendChild(pinned);
  }

  btn.addEventListener("click", () => {
    // Reveal the hidden items right where the button sits — no preview rebuild, so
    // the items above and the (possibly nested) scroll position stay put (#4). The
    // revealed slice includes the conclusion at its natural index, so drop the pin.
    const frag = document.createDocumentFragment();
    for (let k = headCount; k < run.length; k++) {
      frag.appendChild(renderTimelineItem(run[k], bag, cardKeys));
    }
    btn.replaceWith(frag);
    pinned?.remove();
    bag.onExpandRun(key); // record state so a later full rebuild stays expanded
  });
}

/** A team-member communication turn (D13): a color-highlighted, click-to-open node
 *  threaded into the leader's timeline; expanding lazily fetches its segment. */
function renderTeammateTurn(
  item: Extract<VaultTimelineItem, { kind: "teammateTurn" }>,
  bag: PreviewTimelineBag,
  cardKey: string,
): HTMLElement {
  const entryId = item.entryId;
  const block = document.createElement("div");
  block.className = "vault-preview-teammate";
  block.style.setProperty("--turn-color", teammateAccent(item.color));

  const head = document.createElement("button");
  head.type = "button";
  head.className = "vault-preview-teammate-head";
  const dot = document.createElement("span");
  dot.className = "vault-preview-teammate-dot";
  dot.setAttribute("aria-hidden", "true");
  const name = document.createElement("span");
  name.className = "vault-preview-teammate-name";
  name.textContent = `@${item.agentName}`;
  const dir = document.createElement("span");
  dir.className = "vault-preview-teammate-dir";
  dir.textContent = item.from === "leader" ? "⟵ leader" : `⟵ ${item.from}`;
  const chevron = document.createElement("span");
  chevron.className = "vault-preview-teammate-chevron";
  chevron.innerHTML = ICON_CHEVRON_DOWN;
  chevron.setAttribute("aria-hidden", "true");
  head.append(dot, name, dir, chevron);
  const fromLabel = item.from === "leader" ? "leader" : item.from;
  head.title = `Open @${item.agentName}'s turn (from ${fromLabel})`;
  head.setAttribute("aria-label", `Teammate @${item.agentName} turn from ${fromLabel}`);

  const preview = document.createElement("p");
  preview.className = "vault-preview-teammate-preview";
  preview.textContent = item.preview;

  const body = document.createElement("div");
  body.className = "vault-preview-teammate-body";

  head.addEventListener("click", () => {
    if (bag.isNestedExpanded(entryId, cardKey)) {
      bag.setNestedExpanded(entryId, false, cardKey, body);
      block.classList.remove("is-open");
      head.setAttribute("aria-expanded", "false");
      body.replaceChildren();
    } else {
      bag.setNestedExpanded(entryId, true, cardKey, body);
      block.classList.add("is-open");
      head.setAttribute("aria-expanded", "true");
      bag.populateNested(entryId, body);
    }
  });
  head.setAttribute("aria-expanded", bag.isNestedExpanded(entryId, cardKey) ? "true" : "false");

  block.append(head, preview, body);
  if (bag.isNestedExpanded(entryId, cardKey)) {
    block.classList.add("is-open");
    bag.populateNested(entryId, body);
  }
  return block;
}

/** An inline teammate communication (D16): a color-keyed message shown inline
 *  (not collapsible), labeled `@<sender>` / `⟵ leader` so it never reads as USER. */
function renderTeammateMessage(item: Extract<VaultTimelineItem, { kind: "teammateMessage" }>): HTMLElement {
  const suffix = item.timestamp ? ` · ${formatRelativeTime(item.timestamp)}` : "";
  const label = item.from === "leader" ? `⟵ leader${suffix}` : `@${item.agentName}${suffix}`;
  const el = previewMessage("teammate", label, item.text, true);
  el.style.setProperty("--turn-color", teammateAccent(item.color));
  return el;
}

/** Collapsible nested sub-session (subagent / workflow child): title + first
 *  message collapsed; expanding lazily fetches + renders the child transcript.
 *  A continuation is the same node made subordinate — one agent re-invoked, shown
 *  where the re-invocation happened rather than only at its launch card (D5). */
function renderSubagentSession(
  item: Extract<VaultTimelineItem, { kind: "subagentSession" }>,
  bag: PreviewTimelineBag,
  cardKey: string,
): HTMLElement {
  const entryId = item.entryId;
  const continuation = item.continuation === true;
  const block = document.createElement("div");
  block.className = continuation
    ? "vault-preview-subagent vault-preview-subagent--continuation"
    : "vault-preview-subagent";

  const head = document.createElement("button");
  head.type = "button";
  head.className = "vault-preview-subagent-head";
  const chevron = document.createElement("span");
  chevron.className = "vault-preview-subagent-chevron";
  chevron.innerHTML = ICON_CHEVRON_DOWN;
  chevron.setAttribute("aria-hidden", "true");
  if (continuation) {
    const glyph = document.createElement("span");
    glyph.className = "vault-preview-subagent-resumed";
    glyph.textContent = "\u21bb";
    glyph.setAttribute("aria-hidden", "true");
    const titleEl = document.createElement("span");
    titleEl.className = "vault-preview-subagent-title";
    titleEl.textContent = item.title;
    if (item.agent) {
      const agentEl = document.createElement("span");
      agentEl.className = "vault-preview-subagent-agent";
      agentEl.textContent = `@${item.agent}`;
      const sep = document.createElement("span");
      sep.className = "vault-preview-subagent-sep";
      sep.textContent = "\u00b7";
      sep.setAttribute("aria-hidden", "true");
      head.append(chevron, glyph, agentEl, sep, titleEl);
    } else {
      head.append(chevron, glyph, titleEl);
    }
    const label = item.agent ? `Resumed @${item.agent}: ${item.title}` : `Resumed: ${item.title}`;
    head.setAttribute("aria-label", label);
    head.title = label;
  } else if (item.agent) {
    // Agent runs get a badge + accent `@<agent>` chip; group nodes (workflow/team)
    // carry no single agent and keep the title-only form.
    const badge = document.createElement("span");
    badge.className = "vault-preview-subagent-badge";
    badge.textContent = "agent";
    const agentEl = document.createElement("span");
    agentEl.className = "vault-preview-subagent-agent";
    agentEl.textContent = `@${item.agent}`;
    const sep = document.createElement("span");
    sep.className = "vault-preview-subagent-sep";
    sep.textContent = "·";
    sep.setAttribute("aria-hidden", "true");
    const titleEl = document.createElement("span");
    titleEl.className = "vault-preview-subagent-title";
    titleEl.textContent = item.title;
    head.append(chevron, badge, agentEl, sep, titleEl);
    head.setAttribute("aria-label", `Subagent @${item.agent}: ${item.title}`);
  } else {
    const titleEl = document.createElement("span");
    titleEl.className = "vault-preview-subagent-title";
    titleEl.textContent = item.title;
    head.append(chevron, titleEl);
    head.setAttribute("aria-label", `Nested session: ${item.title}`);
  }
  if (!continuation) {
    head.title = item.agent ? `Toggle subagent @${item.agent}: ${item.title}` : `Toggle ${item.title}`;
  }

  const firstMsg = document.createElement("p");
  firstMsg.className = "vault-preview-subagent-firstmsg";
  firstMsg.textContent = continuation ? "" : (item.firstMessage ?? "");

  const body = document.createElement("div");
  body.className = "vault-preview-subagent-body";
  const fallback =
    item.prompt !== undefined || item.result !== undefined
      ? {
          agent: item.agent,
          undeclared: item.undeclared,
          title: item.title,
          prompt: item.prompt,
          result: item.result,
          status: item.status,
        }
      : undefined;

  head.addEventListener("click", () => {
    if (bag.isNestedExpanded(entryId, cardKey)) {
      bag.setNestedExpanded(entryId, false, cardKey, body);
      block.classList.remove("is-open");
      head.setAttribute("aria-expanded", "false");
      body.replaceChildren();
    } else {
      bag.setNestedExpanded(entryId, true, cardKey, body);
      block.classList.add("is-open");
      head.setAttribute("aria-expanded", "true");
      rememberFocusPrompt(body, item.prompt);
      bag.populateNested(entryId, body, fallback);
    }
  });
  head.setAttribute("aria-expanded", bag.isNestedExpanded(entryId, cardKey) ? "true" : "false");

  // A continuation is a one-line row: its prompt already sits on the launch card.
  if (continuation) {
    block.append(head, body);
  } else {
    block.append(head, firstMsg, body);
  }
  if (bag.isNestedExpanded(entryId, cardKey)) {
    block.classList.add("is-open");
    rememberFocusPrompt(body, item.prompt);
    bag.populateNested(entryId, body, fallback);
  }
  return block;
}
