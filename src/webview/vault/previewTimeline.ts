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
  /** Whether a nested subagent/teammate block is open (keyed by child entryId). */
  isNestedExpanded: (entryId: string) => boolean;
  /** Open/close a nested block; on close the owner also drops any in-flight request. */
  setNestedExpanded: (entryId: string, expanded: boolean) => void;
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
  let i = 0;
  let runIndex = 0;
  while (i < timeline.length) {
    const item = timeline[i];
    if (item.kind === "message" && item.role === "user") {
      container.appendChild(renderTimelineItem(item, bag));
      i++;
      continue;
    }
    if (breaksRun(item)) {
      container.appendChild(renderTimelineItem(item, bag));
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
    renderRun(container, run, `${keyPrefix}#${runIndex++}`, bag);
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
}

/** Restore the bounded invocation card when a Cursor child detail cannot be read.
 *  The original source-provided Prompt/Result stays visible; no child transcript is
 *  inferred from the failed request. */
export function renderNestedInvocationFallback(container: HTMLElement, fallback: NestedInvocationFallback): void {
  const item: Extract<VaultActivityStep, { kind: "subagent" }> = {
    kind: "subagent",
    name: fallback.agent ?? "Agent",
    title: fallback.title,
    ...(fallback.prompt !== undefined ? { prompt: fallback.prompt } : {}),
    ...(fallback.result !== undefined ? { result: fallback.result } : {}),
    ...(fallback.status !== undefined ? { status: fallback.status } : {}),
  };
  const card = activityStep(item);
  container.replaceChildren(card);
  card.querySelector<HTMLButtonElement>(".vault-preview-subagent-head")?.click();
}

/** One timeline node: user/assistant message, thinking block, or tool/subagent step. */
function renderTimelineItem(item: VaultTimelineItem, bag: PreviewTimelineBag): HTMLElement {
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
    return renderSubagentSession(item, bag);
  }
  if (item.kind === "teammateTurn") {
    return renderTeammateTurn(item, bag);
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
function renderRun(body: HTMLElement, run: VaultTimelineItem[], key: string, bag: PreviewTimelineBag): void {
  const CAP = 3;
  if (bag.isRunExpanded(key) || run.length <= CAP) {
    for (const it of run) {
      body.appendChild(renderTimelineItem(it, bag));
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
    body.appendChild(renderTimelineItem(run[k], bag));
  }

  const hidden = run.length - CAP;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "vault-preview-expand";
  btn.textContent = `Show ${hidden} more step${hidden === 1 ? "" : "s"}`;
  btn.title = "Show every step in this run";
  body.appendChild(btn);
  const pinned = pin ? renderTimelineItem(run[pinIndex], bag) : null;
  if (pinned) {
    body.appendChild(pinned);
  }

  btn.addEventListener("click", () => {
    // Reveal the hidden items right where the button sits — no preview rebuild, so
    // the items above and the (possibly nested) scroll position stay put (#4). The
    // revealed slice includes the conclusion at its natural index, so drop the pin.
    const frag = document.createDocumentFragment();
    for (let k = headCount; k < run.length; k++) {
      frag.appendChild(renderTimelineItem(run[k], bag));
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
    if (bag.isNestedExpanded(entryId)) {
      bag.setNestedExpanded(entryId, false);
      block.classList.remove("is-open");
      head.setAttribute("aria-expanded", "false");
      body.replaceChildren();
    } else {
      bag.setNestedExpanded(entryId, true);
      block.classList.add("is-open");
      head.setAttribute("aria-expanded", "true");
      bag.populateNested(entryId, body);
    }
  });
  head.setAttribute("aria-expanded", bag.isNestedExpanded(entryId) ? "true" : "false");

  block.append(head, preview, body);
  if (bag.isNestedExpanded(entryId)) {
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
 *  message collapsed; expanding lazily fetches + renders the child transcript. */
function renderSubagentSession(
  item: Extract<VaultTimelineItem, { kind: "subagentSession" }>,
  bag: PreviewTimelineBag,
): HTMLElement {
  const entryId = item.entryId;
  const block = document.createElement("div");
  block.className = "vault-preview-subagent";

  const head = document.createElement("button");
  head.type = "button";
  head.className = "vault-preview-subagent-head";
  const chevron = document.createElement("span");
  chevron.className = "vault-preview-subagent-chevron";
  chevron.innerHTML = ICON_CHEVRON_DOWN;
  chevron.setAttribute("aria-hidden", "true");
  // Agent runs get a badge + accent `@<agent>` chip; group nodes (workflow/team)
  // carry no single agent and keep the title-only form.
  if (item.agent) {
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
  head.title = item.agent ? `Toggle subagent @${item.agent}: ${item.title}` : `Toggle ${item.title}`;

  const firstMsg = document.createElement("p");
  firstMsg.className = "vault-preview-subagent-firstmsg";
  firstMsg.textContent = item.firstMessage ?? "";

  const body = document.createElement("div");
  body.className = "vault-preview-subagent-body";
  const fallback =
    item.prompt !== undefined || item.result !== undefined
      ? { agent: item.agent, title: item.title, prompt: item.prompt, result: item.result, status: item.status }
      : undefined;

  head.addEventListener("click", () => {
    if (bag.isNestedExpanded(entryId)) {
      bag.setNestedExpanded(entryId, false);
      block.classList.remove("is-open");
      head.setAttribute("aria-expanded", "false");
      body.replaceChildren();
    } else {
      bag.setNestedExpanded(entryId, true);
      block.classList.add("is-open");
      head.setAttribute("aria-expanded", "true");
      bag.populateNested(entryId, body, fallback);
    }
  });
  head.setAttribute("aria-expanded", bag.isNestedExpanded(entryId) ? "true" : "false");

  block.append(head, firstMsg, body);
  if (bag.isNestedExpanded(entryId)) {
    block.classList.add("is-open");
    bag.populateNested(entryId, body, fallback);
  }
  return block;
}
