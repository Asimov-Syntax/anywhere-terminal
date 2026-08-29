// src/webview/worktree/worktreeTreeView.ts — Pure DOM builders for the Worktree
// view: repo group headers, worktree rows, the collapsed presence pill, agent
// rows, subagent history, notices, skeletons, and the empty states. None read
// panel state — interactivity arrives as callbacks, so each builder is
// independently testable. Mirrors src/webview/vault/vaultListView.ts.
//
// Branch names, pane titles, previews, model labels, and git's stderr are all
// UNTRUSTED. Every one of them is written via `textContent`; the only innerHTML
// is a static icon constant or the closed agent-icon map (D1).

import { ACTIVITY_EVIDENCE } from "../../worktree/presenceTypes";
import { getAgentAccent, getAgentIcon } from "../vault/agentIcons";
import { ICON_CHEVRON_DOWN, ICON_FOLDER, ICON_TERMINAL } from "../vault/icons";
import { emptyState } from "../vault/renderAtoms";
import {
  agentCountLabel,
  agentRowTitle,
  ageTimestamp,
  branchLabel,
  compactAge,
  hasProvenIdentity,
  isFallbackActivity,
  type PresenceGroup,
  type PresentedActivity,
  unchangedFor,
  worktreeBadges,
  worktreePills,
  worktreeTooltip,
} from "./worktreeFormat";
import { ICON_BRANCH, ICON_LOCK, ICON_PLUS, ICON_WARNING, ICON_WINDOW } from "./worktreeIcons";
import type {
  DelegationRoster,
  WorktreeAgentRow,
  WorktreeInfo,
  WorktreeRepo,
  WorktreeSubagentRow,
} from "./worktreeViewTypes";

/** Interaction handlers for a worktree row — supplied so the builder stays pure. */
export interface WorktreeRowCallbacks {
  onActivate: (info: WorktreeInfo, row: HTMLElement) => void;
  /** Absent → no listener at all: one that only preventDefaults would leave the
   *  user with no menu, ours or the host's. */
  onContextMenu?: (info: WorktreeInfo, ev: MouseEvent, row: HTMLElement) => void;
  /** Double click opens the folder (§ 6). */
  onOpenFolder?: (info: WorktreeInfo) => void;
}

export interface AgentRowCallbacks {
  onActivate: (row: WorktreeAgentRow, el: HTMLElement) => void;
  /** Absent → no listener, for the same reason as the worktree row's. */
  onContextMenu?: (row: WorktreeAgentRow, ev: MouseEvent, el: HTMLElement) => void;
  /** Toggle this row's subagent disclosure — the SECOND, independent level (§ 3.5). */
  onToggleSubagents?: (row: WorktreeAgentRow) => void;
}

/**
 * A control that lives ON a row and acts independently of it.
 *
 * The row binds a BUBBLING click and keydown (`bindActivation`), so without
 * stopping both here one gesture would run the action AND toggle the row. The
 * tab index starts at -1: the tree exposes one tab stop, and the view raises
 * this to 0 only while its own row holds focus.
 */
function rowAction(icon: string, label: string, activate: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "wt-rowaction";
  btn.tabIndex = -1;
  btn.innerHTML = icon;
  btn.setAttribute("aria-label", label);
  btn.dataset.tip = label;
  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    activate();
  });
  btn.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      // Stopped, not prevented: the button still turns the key into its own
      // click, and that click is stopped above. Preventing here would leave the
      // control keyboard-inert.
      ev.stopPropagation();
    }
  });
  return btn;
}

/** Attach click + Enter/Space to an element that behaves as a row. */
function bindActivation(el: HTMLElement, activate: () => void): void {
  el.addEventListener("click", activate);
  el.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      activate();
    }
  });
}

/**
 * What the glyph announces. `unknown` is not an activity an agent can be IN, so it
 * is read as a statement about the evidence rather than about the agent (§ 7.2).
 */
export function activityLabel(activity: PresentedActivity): string {
  if (activity === "unknown") {
    return "activity unknown";
  }
  return activity === "running-unconfirmed" ? "running, unconfirmed" : activity;
}

/** The same statement made about a worktree row, which speaks for the agents inside it. */
export function worktreeActivityLabel(activity: PresentedActivity): string {
  if (activity === "unknown") {
    return "An agent's activity is unknown";
  }
  return activity === "running-unconfirmed" ? "An agent may be running, unconfirmed" : `An agent is ${activity}`;
}

/**
 * Why a claim is shown as unconfirmed, in the user's terms.
 *
 * A LOWER BOUND, not an exact figure. The hint is written into an attribute when
 * the row renders and read when the pointer arrives, which can be an hour later:
 * an exact "5 minutes" would be false by then, and the row does not repaint again
 * once it has crossed. "over N" is true when written and stays true.
 */
export function unconfirmedHint(elapsedMs: number | undefined): string {
  const base =
    "Inferred from terminal output, not reported by the agent — the terminal is busy, which is not proof of a turn in progress.";
  if (elapsedMs === undefined) {
    return base;
  }
  // `compactAge` reads a TIMESTAMP against now; this is a duration, so it is
  // rendered here rather than by passing an epoch that is really an interval.
  const minutes = Math.floor(elapsedMs / 60_000);
  const span = minutes >= 120 ? `${Math.floor(minutes / 60)} hours` : `${minutes} minutes`;
  // "at least", not "over": the timer fires AT the ceiling, so the first hint a
  // crossing writes is the exact figure, and "over 5 minutes" would be false by a
  // hair at the one moment the change is most visibly making a claim.
  return `Unchanged for at least ${span}. ${base}`;
}

/** The single `~` builder — three near-copies of this drifted apart once already. */
function confidenceMarker(tip: string): HTMLElement {
  const marker = document.createElement("span");
  marker.className = "wt-confidence";
  marker.textContent = "~";
  marker.dataset.tip = tip;
  return marker;
}

/**
 * What the `~` says, or undefined when the row makes no qualified claim. Keyed off
 * the PRESENTED state: an inference the glyph has already withdrawn must not be
 * re-asserted in present tense beside it.
 */
export function confidenceHint(
  row: WorktreeAgentRow,
  activity: PresentedActivity,
  // Required. An optional clock defaulting to `Date.now()` is the same crack S2
  // closed in the dialog: the caller reads one moment, this reads another, and the
  // elapsed figure stops describing the glyph beside it.
  now: number,
): string | undefined {
  if (activity === "running-unconfirmed") {
    return unconfirmedHint(unchangedFor(row, now));
  }
  if (activity === "unknown") {
    // Names the FAILING source, the same word the stale affordance uses, rather
    // than the row's own label — `output` and `title` are both read off `panes`,
    // and pointing at a name the degradation list never mentions is a dead end.
    const failing = ACTIVITY_EVIDENCE[row.activitySource];
    return failing === undefined
      ? "No source reported this row's activity"
      : `Activity came from ${failing}, which is not currently reporting`;
  }
  if (isFallbackActivity(row.activitySource)) {
    return row.activitySource === "output"
      ? "Activity inferred from terminal output — the terminal is busy, which is not proof of an agent turn"
      : `Activity inferred from ${row.activitySource} — not a published agent state`;
  }
  return undefined;
}

/** A leading-slot glyph carrying one of the state shapes (§ 7.2), `unknown` included. */
export function stateShape(activity: PresentedActivity, label?: string): HTMLElement {
  const dot = document.createElement("span");
  dot.className = `wt-state wt-state--${activity}`;
  if (label) {
    dot.setAttribute("role", "img");
    dot.setAttribute("aria-label", label);
  } else {
    dot.setAttribute("aria-hidden", "true");
  }
  return dot;
}

/**
 * Repo group header — rendered ONLY when the tree holds more than one repo
 * (§ 3.1). Strongest emphasis, no leading glyph slot, so it reads as a separator
 * rather than another tree row.
 */
export function renderRepoHeader(
  repo: WorktreeRepo,
  count: number,
  collapsed: boolean,
  onToggle: () => void,
  onCreate?: () => void,
): HTMLElement {
  const header = document.createElement("div");
  header.className = collapsed ? "wt-repo is-collapsed" : "wt-repo";
  header.setAttribute("role", "treeitem");
  header.setAttribute("aria-expanded", collapsed ? "false" : "true");
  header.tabIndex = -1;
  header.dataset.repoId = repo.repoId;

  const name = document.createElement("span");
  name.className = "wt-repo-name";
  name.textContent = repo.label;
  name.dataset.tip = repo.mainPath;

  const countEl = document.createElement("span");
  countEl.className = "wt-repo-count";
  countEl.textContent = String(count);

  const spacer = document.createElement("span");

  const chev = document.createElement("span");
  chev.className = "wt-chev";
  chev.innerHTML = ICON_CHEVRON_DOWN;
  chev.setAttribute("aria-hidden", "true");

  header.append(name, countEl, spacer);
  if (onCreate) {
    header.appendChild(rowAction(ICON_PLUS, `Create worktree in ${repo.label}`, onCreate));
  }
  header.appendChild(chev);
  // A `treeitem` with no name takes one from its contents, so the create
  // control's label was read out as part of every header (round-1 W3).
  header.setAttribute("aria-label", `${repo.label}, ${count} worktree${count === 1 ? "" : "s"}`);
  header.dataset.tip = collapsed ? `Expand ${repo.label}` : `Collapse ${repo.label}`;
  bindActivation(header, onToggle);
  return header;
}

export interface WorktreeRowOptions {
  /** The strongest state among this worktree's agents; undefined → the branch glyph. */
  activity?: PresentedActivity;
  /** Whether the row owns an expandable agent block. */
  hasAgents?: boolean;
  expanded?: boolean;
  /** "3 agents" — announced on the row, since the pill and header are not. */
  agentSummary?: string;
  /** Why this row's glyph is qualified, when it is. */
  confidenceTip?: string;
  /** Positively determined to hold no agents — draws as one dim line. */
  idle?: boolean;
  /** Sits under the idle disclosure, which owns its depth and its reveal. */
  inTail?: boolean;
  /**
   * Whether this worktree is the selected one. `undefined` means the tree is not
   * selectable at all and the row says nothing about selection — announcing
   * `aria-selected="false"` on every row would tell a screen reader there is a
   * selection to make where there is none.
   */
  selected?: boolean;
}

/**
 * One worktree row: state-aware leading glyph, branch, pills, badges. **No path
 * anywhere** (§ 3.2) — it lives in the tooltip and the copy action.
 */
export function renderWorktreeRow(info: WorktreeInfo, opts: WorktreeRowOptions, cb: WorktreeRowCallbacks): HTMLElement {
  const row = document.createElement("div");
  row.className = "wt-row";
  if (info.missing) {
    row.classList.add("is-missing");
  }
  if (opts.idle) {
    row.classList.add("wt-row--idle");
  }
  if (opts.inTail) {
    row.classList.add("wt-row--in-tail");
  }
  row.setAttribute("role", "treeitem");
  row.tabIndex = -1;
  row.dataset.worktreeId = info.id;
  if (opts.selected !== undefined) {
    row.setAttribute("aria-selected", opts.selected ? "true" : "false");
  }
  // The qualification travels WITH the glyph. A collapsed worktree shows a state
  // shape and a pill that assistive tech and the arrow keys both skip, so this row
  // is the only thing a keyboard user reaches — and a `~`-worthy glyph here with no
  // way to read why is the overstatement the ceiling exists to retract.
  row.dataset.tip = opts.confidenceTip ? `${worktreeTooltip(info)}\n${opts.confidenceTip}` : worktreeTooltip(info);
  if (opts.hasAgents) {
    row.setAttribute("aria-expanded", opts.expanded ? "true" : "false");
    // The presence pill and the "N agents" header are hidden from assistive tech
    // (a button is not valid inside `role="tree"`), so the summary they carry
    // visually has to reach a screen reader from the row itself.
    if (opts.agentSummary) {
      row.setAttribute("aria-label", `${branchLabel(info).text}, ${opts.agentSummary}`);
    }
  }

  // One glyph slot, never two: the branch mark at rest, the state shape when any
  // agent inside is active.
  const glyph = document.createElement("span");
  glyph.className = "wt-glyph";
  const glyphActivity = opts.activity;
  if (glyphActivity) {
    glyph.appendChild(stateShape(glyphActivity, worktreeActivityLabel(glyphActivity)));
  } else {
    glyph.innerHTML = ICON_BRANCH;
  }
  row.appendChild(glyph);

  const label = branchLabel(info);
  const branch = document.createElement("span");
  branch.className = label.variant === "branch" ? "wt-branch" : `wt-branch wt-branch--${label.variant}`;
  branch.textContent = label.text;
  row.appendChild(branch);

  const marks = document.createElement("span");
  marks.className = "wt-marks";
  for (const pill of worktreePills(info)) {
    const el = document.createElement("span");
    el.className = pill.kind === "open" ? "wt-pill wt-pill--open" : "wt-pill";
    el.textContent = pill.text;
    if (pill.kind === "open") {
      // Every worktree the workspace holds open carries this, so several rows can
      // — the hint has to say so, or the mark reads as "the one you are in".
      el.dataset.tip = "This worktree is open as a workspace folder";
    }
    marks.appendChild(el);
  }
  for (const badge of worktreeBadges(info)) {
    const el = document.createElement("span");
    el.className = `wt-badge wt-badge--${badge.kind}`;
    if (badge.title) {
      el.dataset.tip = badge.title;
    }
    if (badge.kind === "locked") {
      const icon = document.createElement("span");
      icon.innerHTML = ICON_LOCK;
      icon.setAttribute("aria-hidden", "true");
      el.appendChild(icon);
    }
    el.append(document.createTextNode(badge.kind));
    marks.appendChild(el);
  }
  row.appendChild(marks);

  bindActivation(row, () => cb.onActivate(info, row));
  if (cb.onContextMenu) {
    row.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      cb.onContextMenu?.(info, ev, row);
    });
  }
  if (cb.onOpenFolder) {
    row.addEventListener("dblclick", () => cb.onOpenFolder?.(info));
  }
  return row;
}

/**
 * The collapsed presence pill: state dots grouped by state, up to three agent
 * icons each, then a `+N` count. Height is constant regardless of agent count.
 */
export function renderPresencePill(groups: readonly PresenceGroup[], onExpand: () => void): HTMLElement {
  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "wt-presence";
  pill.tabIndex = -1;
  pill.setAttribute("aria-hidden", "true");
  pill.dataset.tip = "Show agents";

  const wrap = document.createElement("span");
  wrap.className = "wt-presence-groups";
  for (const group of groups) {
    const g = document.createElement("span");
    g.className = "wt-pgroup";
    g.appendChild(stateShape(group.activity));
    const icons = document.createElement("span");
    icons.className = "wt-pgroup-icons";
    for (const agentId of group.agents) {
      const badge = document.createElement("span");
      badge.className = "vault-badge";
      const icon = getAgentIcon(agentId);
      if (icon) {
        // SVG comes ONLY from the closed agent-icon map, never from presence data.
        badge.classList.add(`vault-badge--${icon.accent}`);
        badge.innerHTML = icon.svg;
        badge.dataset.tip = icon.displayName;
      }
      icons.appendChild(badge);
    }
    g.appendChild(icons);
    if (group.overflow > 0) {
      const more = document.createElement("span");
      more.className = "wt-pgroup-more";
      more.textContent = `+${group.overflow}`;
      g.appendChild(more);
    }
    wrap.appendChild(g);
  }

  const chev = document.createElement("span");
  chev.className = "wt-chev";
  chev.innerHTML = ICON_CHEVRON_DOWN;
  chev.setAttribute("aria-hidden", "true");

  pill.append(wrap, chev);
  pill.addEventListener("click", onExpand);
  return pill;
}

/**
 * The expanded presence header — a real row, not a label: it is the collapse
 * control and it carries the count the pill would otherwise have to keep showing.
 */
export function renderAgentsHeader(count: number, onCollapse: () => void): HTMLElement {
  const header = document.createElement("div");
  header.className = "wt-agents";
  header.tabIndex = -1;
  header.setAttribute("aria-hidden", "true");
  header.dataset.tip = "Collapse agents";

  const label = document.createElement("span");
  label.textContent = agentCountLabel(count);

  const chev = document.createElement("span");
  chev.className = "wt-chev";
  chev.innerHTML = ICON_CHEVRON_DOWN;
  chev.setAttribute("aria-hidden", "true");

  header.append(label, chev);
  bindActivation(header, onCollapse);
  return header;
}

export interface AgentRowOptions {
  /**
   * The state to DRAW, which the caller derives because only it holds the
   * degradation list. Required: a default here is how a caller silently draws the
   * wire value, which is the omission round 1 found on two separate surfaces.
   */
  activity: PresentedActivity;
  /** Subagent disclosure state — independent of the worktree's own collapse (§ 3.5). */
  expanded?: boolean;
  selected?: boolean;
  /**
   * Required, for the same reason as `activity` above: an optional clock that
   * falls back to `Date.now()` lets this row's elapsed figure describe a different
   * moment than the state drawn beside it. Making `confidenceHint`'s clock
   * required only moved that crack one frame up into here.
   */
  now: number;
}

/**
 * One agent row. Grid: gutter | state | icon | title | preview | model | +N | age.
 * The gutter always occupies space even with no children, which is what keeps the
 * state dots aligned down a mixed list.
 */
export function renderAgentRow(row: WorktreeAgentRow, opts: AgentRowOptions, cb: AgentRowCallbacks): HTMLElement {
  const el = document.createElement("div");
  el.className = "wt-arow";
  const delegated = row.delegations?.kind === "ok" ? row.delegations.rows : [];
  // The disclosure is offered by the presence of a SESSION, not by children
  // already held: the children are read on expansion, so gating on them would
  // leave nothing to click to cause the read (design.md D9). A row with no
  // resolved session offers nothing, which is also the honest state — there is
  // no roster to ask for, and no claim about whether it delegated.
  const hasSession = row.entryId !== undefined;
  const hasChildren = delegated.length > 0;
  if (hasSession && opts.expanded) {
    el.classList.add("is-open");
  }
  if (opts.selected) {
    el.classList.add("is-selected");
  }
  el.setAttribute("role", "treeitem");
  el.tabIndex = -1;
  el.dataset.rowId = row.rowId;
  if (hasSession) {
    el.setAttribute("aria-expanded", opts.expanded ? "true" : "false");
  }

  // 1 — disclosure gutter. Empty but present when the row has no children.
  const gutter = document.createElement("span");
  gutter.className = "wt-gutter";
  gutter.setAttribute("aria-hidden", "true");
  if (hasSession) {
    gutter.innerHTML = ICON_CHEVRON_DOWN;
    gutter.addEventListener("click", (ev) => {
      ev.stopPropagation();
      cb.onToggleSubagents?.(row);
    });
  }
  el.appendChild(gutter);

  // 2 — state dot. Colour from the state, never from the agent.
  const activity = opts.activity;
  el.appendChild(stateShape(activity, activityLabel(activity)));

  // 3 — agent icon. Absent without a proven identity: `agentSource: "none"` is a
  // plain terminal row, and a guessed glyph would be a claim we cannot support.
  const icon = document.createElement("span");
  icon.className = "wt-aicon";
  if (hasProvenIdentity(row) && row.agent) {
    const brand = getAgentIcon(row.agent);
    const accent = getAgentAccent(row.agent);
    if (brand) {
      icon.innerHTML = brand.svg;
      icon.dataset.tip = brand.displayName;
    }
    // Only a known, closed accent may reach the style attribute (W6).
    if (accent) {
      icon.style.color = `var(--vault-accent-${accent})`;
    }
  } else {
    icon.innerHTML = ICON_TERMINAL;
  }
  el.appendChild(icon);

  // 4 — title, plus the confidence marker when ACTIVITY came from a fallback
  // source. Identity confidence is expressed by the icon above, separately.
  const title = document.createElement("span");
  title.className = "wt-atitle";
  const titleText = agentRowTitle(row);
  title.append(document.createTextNode(titleText));
  title.dataset.tip = titleText;
  // Keyed off the PRESENTED state: an inference the glyph has already withdrawn
  // must not be re-asserted in present tense beside it. When the state is
  // `unknown` the marker names the failure instead of the inference.
  const confidenceTip = confidenceHint(row, activity, opts.now);
  if (confidenceTip !== undefined) {
    title.append(document.createTextNode(" "), confidenceMarker(confidenceTip));
  }
  el.appendChild(title);

  // 5 — preview. Truncates first under width pressure; hidden entirely below 380px.
  const preview = document.createElement("span");
  preview.className = "wt-apreview";
  preview.textContent = row.preview ?? "";
  if (row.preview) {
    preview.dataset.tip = row.preview;
  }
  el.appendChild(preview);

  // 6 — model chip, or the external-scope chip. Never a placeholder for an
  // unknown model; an external row is labelled instead, since it offers no focus.
  const sixth = document.createElement("span");
  if (row.scope === "external") {
    sixth.className = "wt-scope";
    sixth.dataset.tip = "Running in another VS Code window";
    const winIcon = document.createElement("span");
    winIcon.innerHTML = ICON_WINDOW;
    winIcon.setAttribute("aria-hidden", "true");
    sixth.append(winIcon, document.createTextNode("other window"));
  } else if (row.model) {
    sixth.className = "wt-model";
    sixth.textContent = row.model;
    sixth.dataset.tip = row.model;
  }
  el.appendChild(sixth);
  // Same reason as the worktree row above: `el` is what the roving tabindex
  // focuses, and its title / preview live on descendants closest() cannot reach
  // from here.
  // The confidence hint joins it rather than living only on the marker: `Tooltip`
  // resolves `closest('[data-tip]')` and focus lands on `el`, which walks UPWARD
  // and can never reach the marker span inside it. Pointer-only delivery does not
  // satisfy a requirement that makes the elapsed figure and the evidence mandatory
  // parts of the statement. The pointer still gets the marker's own tip, being
  // nearer. Composed last, because this line is what any earlier write loses to.
  el.dataset.tip = [titleText, row.preview, confidenceTip].filter(Boolean).join("\n");

  // 7 — collapsed child count. Disappears when expanded; the children show instead.
  const count = document.createElement("span");
  if (hasChildren && !opts.expanded) {
    count.className = "wt-count";
    count.textContent = `+${delegated.length}`;
  }
  el.appendChild(count);

  // 8 — age, right-aligned against a fixed edge that never truncates.
  const age = document.createElement("span");
  age.className = "wt-age";
  age.textContent = compactAge(ageTimestamp(row), opts.now);
  el.appendChild(age);

  bindActivation(el, () => cb.onActivate(row, el));
  if (cb.onContextMenu) {
    el.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      cb.onContextMenu?.(row, ev, el);
    });
  }
  return el;
}

/**
 * Delegated work, in one of two vocabularies.
 *
 * Transcript-derived rows are history: a rail, a "Past delegations" label, and
 * outcome glyphs. Rows an agent reported itself while they run are not history,
 * and calling them "Past delegations" would describe running work in the past
 * tense (.reviews/round-1.md W3). Activating either focuses the PARENT's pane;
 * a subagent has no pane of its own.
 */
export function renderSubagentSection(
  roster: DelegationRoster | undefined,
  parent: WorktreeAgentRow,
  onActivate: (subagent: WorktreeSubagentRow, parent: WorktreeAgentRow) => void,
  now?: number,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "wt-hist";
  wrap.setAttribute("role", "group");
  wrap.dataset.parentRowId = parent.rowId;

  // Provenance, not row contents, decides the vocabulary: an agent that reported
  // no delegations has reported about NOW, and calling that empty answer "past"
  // describes the wrong tense of the wrong thing (.reviews/round-2.md W3).
  const live = roster !== undefined && roster.kind === "ok" && roster.reported === true;
  if (live) {
    wrap.classList.add("wt-hist-live");
  }

  const label = document.createElement("div");
  label.className = "wt-hist-label";
  label.setAttribute("role", "presentation");
  label.textContent = live ? "Delegations" : "Past delegations";
  wrap.appendChild(label);

  // Four states, one per roster state (design.md D10). An expanded row always
  // renders one of them: silence would read as "this session delegated
  // nothing", which is the one claim an unfinished or failed read cannot make.
  if (roster === undefined) {
    wrap.appendChild(note("Reading…"));
    return wrap;
  }
  if (roster.kind === "failed") {
    wrap.appendChild(note(`Could not be read — ${roster.reason}`));
    return wrap;
  }
  if (roster.rows.length === 0) {
    // Emptiness is a claim, and an incomplete read is not entitled to it: the
    // reader said it dropped records, so "none" would state the one thing it
    // could not observe (design.md D13). Order matters — deciding by row count
    // first is exactly the bug this ordering fixes.
    wrap.appendChild(note(roster.incomplete === true ? "Delegations could not be read" : "No delegations found"));
    return wrap;
  }

  const subagents = roster.rows;
  for (const [i, sub] of subagents.entries()) {
    const row = document.createElement("div");
    row.className = "wt-srow";
    row.setAttribute("role", "treeitem");
    row.tabIndex = -1;
    // A subagent has no id of its own, so its key is derived from the parent and
    // its position. Without one, every subagent row keys as "" and the roving
    // tabindex cannot tell them apart.
    row.dataset.subKey = `${parent.rowId}\u0000${i}`;
    row.dataset.tip = "Focuses the parent pane — a subagent has no pane of its own";

    const outcome = document.createElement("span");
    const failed = sub.status === "failed";
    // A delegation reported running has no outcome yet, so it does not get the
    // completed glyph's vocabulary — that is what made live work read as
    // finished work (round-2.md W3).
    const running = sub.live && sub.status === "running";
    outcome.className = failed
      ? "wt-outcome wt-outcome--failed"
      : running
        ? "wt-outcome wt-outcome--live"
        : "wt-outcome wt-outcome--done";
    outcome.textContent = failed ? "✕" : sub.status === "running" ? "…" : "✓";
    if (running) {
      row.dataset.live = "true";
      // Colour and a glyph are the whole distinction between running work and a
      // recorded outcome, and neither reaches a screen reader. This is the same
      // role/label the activity dot uses when it carries meaning rather than
      // decoration (.reviews/round-3.md W3).
      outcome.setAttribute("role", "img");
      outcome.setAttribute("aria-label", "running");
    } else {
      outcome.setAttribute("aria-hidden", "true");
    }

    const text = document.createElement("span");
    text.className = "wt-stext";
    // The delegated task description is the primary text; the role name is the
    // fallback, not the lead (worktree-panel-ui.md § 3.4).
    text.textContent = sub.title ?? sub.name;
    text.dataset.tip = sub.title ? `${sub.title} — ${sub.name}` : sub.name;

    const age = document.createElement("span");
    age.className = "wt-age";
    // Children inherit the parent's freshness: a stale parent cannot have
    // provably-working children (§ 3.4).
    age.textContent = compactAge(ageTimestamp(parent), now);

    row.append(outcome, text, age);
    bindActivation(row, () => onActivate(sub, parent));
    wrap.appendChild(row);
  }
  // The reader's own admission that records were dropped. Nothing here ever
  // proves the other direction, so the section never says "this is everything".
  if (roster.incomplete === true) {
    wrap.appendChild(note("Older delegations could not be read"));
  }
  return wrap;
}

/** One line of section state — never a row, so it is not mistaken for a delegation. */
function note(text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "wt-hist-note";
  el.textContent = text;
  return el;
}

export interface NoticeSpec {
  tone: "warn" | "error" | "neutral";
  /** Bolded lead sentence. */
  title: string;
  /** Optional plain continuation after the lead. */
  body?: string;
  /** Verbatim source + reason, rendered monospace. */
  reason?: string;
  /** `alert` for an action result the user just caused; `status` for staleness. */
  live?: "alert" | "status";
  actions?: { label: string; onClick: () => void }[];
  onDismiss?: () => void;
}

/**
 * A notice attached to the scope it concerns: a degraded repo, an action error, or
 * an indeterminate outcome. `reason` is git's own words, shown rather than summarized.
 */
export function renderNotice(spec: NoticeSpec): HTMLElement {
  const el = document.createElement("div");
  el.className = spec.tone === "neutral" ? "wt-notice" : `wt-notice wt-notice--${spec.tone}`;
  el.setAttribute("role", spec.live ?? "status");

  const icon = document.createElement("span");
  icon.innerHTML = ICON_WARNING;
  icon.setAttribute("aria-hidden", "true");
  el.appendChild(icon);

  const text = document.createElement("span");
  const strong = document.createElement("b");
  strong.textContent = spec.title;
  text.appendChild(strong);
  if (spec.body) {
    text.append(document.createTextNode(` ${spec.body}`));
  }
  if (spec.reason) {
    const reason = document.createElement("span");
    reason.className = "wt-reason";
    reason.textContent = spec.reason;
    text.appendChild(reason);
  }
  el.appendChild(text);

  const actions = document.createElement("span");
  actions.className = "wt-notice-actions";
  for (const action of spec.actions ?? []) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wt-link";
    btn.textContent = action.label;
    btn.addEventListener("click", action.onClick);
    actions.appendChild(btn);
  }
  if (spec.onDismiss) {
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "wt-dismiss";
    dismiss.setAttribute("aria-label", "Dismiss");
    dismiss.textContent = "✕";
    dismiss.addEventListener("click", spec.onDismiss);
    actions.appendChild(dismiss);
  }
  el.appendChild(actions);
  return el;
}

/** Widths that read as a tree rather than a progress bar. Fixed, so the skeleton
 *  does not shimmer at a different shape on every render. */
const SKELETON_ROWS: readonly { agent: boolean; width: number }[] = [
  { agent: false, width: 52 },
  { agent: true, width: 74 },
  { agent: true, width: 61 },
  { agent: false, width: 40 },
  { agent: false, width: 66 },
];

/** First load only — skeleton rows, never a spinner in a void (§ 5). */
export function renderSkeleton(): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const spec of SKELETON_ROWS) {
    const row = document.createElement("div");
    row.className = spec.agent ? "wt-skel wt-skel--agent" : "wt-skel";
    const glyph = document.createElement("span");
    const bar = document.createElement("span");
    bar.style.width = `${spec.width}%`;
    row.append(glyph, bar);
    frag.appendChild(row);
  }
  return frag;
}

/** A refresh that already holds a tree keeps it and shows this quiet marker (§ 5). */
export function renderRefreshingMarker(): HTMLElement {
  const el = document.createElement("div");
  el.className = "wt-refreshing";
  el.setAttribute("role", "status");
  el.textContent = "Rebuilding the worktree tree…";
  return el;
}

/**
 * The idle tail's disclosure. Its own row kind, not a restyled repo header:
 * `navRows` matches on class and derives depth from it, so borrowing `.wt-repo`
 * would give it depth 0 and route its toggle through a repoId it does not carry.
 */
export function renderIdleDisclosure(
  repoId: string,
  hidden: number,
  folded: boolean,
  onToggle: () => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "wt-idle";
  row.setAttribute("role", "treeitem");
  row.setAttribute("aria-expanded", folded ? "false" : "true");
  row.tabIndex = -1;
  row.dataset.idleKey = repoId;
  const chev = document.createElement("span");
  chev.className = "wt-chev";
  chev.innerHTML = ICON_CHEVRON_DOWN;
  chev.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.className = "wt-idle-label";
  // The count is of the rows the fold actually hides, so it stays exact when a
  // cap has already removed some of them.
  label.textContent = `${hidden} idle worktree${hidden === 1 ? "" : "s"}`;
  row.append(chev, label);
  bindActivation(row, onToggle);
  return row;
}

/** Cap with an affordance rather than truncating silently (§ 8). */
export function renderShowAll(total: number, onShowAll: () => void): HTMLElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "wt-showall";
  btn.textContent = `Show all ${total} worktrees`;
  btn.addEventListener("click", onShowAll);
  return btn;
}

/** The distinct causes of an empty tree. Each gets its own copy — none is an error. */
export type WorktreeEmptyKind = "noFolder" | "noRepo" | "gitMissing" | "noMatch" | "unbranched";

/**
 * `onCreate` is honoured by the `unbranched` state alone — the only one of the
 * five describing something a create can act on.
 */
export function worktreeEmptyState(kind: WorktreeEmptyKind, onCreate?: () => void): HTMLElement {
  switch (kind) {
    case "unbranched": {
      // This one sits INSIDE a tree, under the repository it describes, and a
      // multi-repo workspace can hold several at once. The panel-scale block is
      // for a panel with nothing in it (round-1 W5).
      const state = emptyState(
        ICON_BRANCH,
        "No other worktrees yet",
        "A worktree checks out another branch in its own folder, so you can work on it without stashing or switching this one.",
        onCreate ? { label: "Create worktree", onClick: onCreate } : undefined,
      );
      state.classList.add("wt-empty-inline");
      return state;
    }
    case "noFolder":
      return emptyState(ICON_FOLDER, "No folder open", "Open a folder to see its worktrees.");
    case "noRepo":
      return emptyState(
        ICON_BRANCH,
        "No git repository",
        "This view lists git worktrees. None of the open folders is a repository.",
      );
    case "gitMissing":
      return emptyState(ICON_TERMINAL, "Git not found", "The Worktree view needs git on your PATH.");
    default:
      return emptyState(ICON_BRANCH, "No matching worktrees", "Try a shorter query.");
  }
}
