// src/webview/worktree/WorktreeInspector.ts — The detail drawer under the tree
// (worktree-panel-ui § 3.7, DESIGN.md D29).
//
// A drawer, not a body swap: at sidebar width replacing the body makes selection
// destructive — the user loses the list they were comparing against and needs a
// back control to return. So the tree stays above, and this is capped to half the
// panel so it stays scannable.
//
// It is NOT modal. It takes no focus on opening, and the tree above it stays
// reachable; a focus trap here would make the very thing the cap preserves
// unreachable. Everything it draws comes from a renderer or a builder the tree
// already uses, because every truthfulness rule in them cost a review round and
// a second implementation is a second place for one to go missing.

import type { ContextMenuItem } from "../shared/contextMenuShell";
import type { WorktreeMenuActions } from "./WorktreeContextMenu";
import { worktreeActionItems } from "./worktreeActionItems";
import { activationFor } from "./worktreeActivation";
import { agentRowTitle, branchLabel, presentedActivity } from "./worktreeFormat";
import { worktreeScopeSignature } from "./worktreeRenderSignature";
import type { RosterRequests } from "./worktreeRosterRequests";
import { renderAgentRow, renderSubagentSection } from "./worktreeTreeView";
import type {
  PresenceDegradation,
  WorktreeAgentRow,
  WorktreeInfo,
  WorktreePresence,
  WorktreeRowActivation,
  WorktreeSubagentRow,
  WorktreeTree,
} from "./worktreeViewTypes";

export interface WorktreeInspectorDeps {
  /**
   * The same capability record the context menu holds. Absent → the drawer
   * offers no actions at all, rather than buttons that resolve to nothing.
   */
  actions?: WorktreeMenuActions;
  /** The window's one asked-once set, shared with the tree (design.md D6). */
  rosters: RosterRequests;
  onRequestSubagents?: (row: WorktreeAgentRow) => void;
  onActivateAgent?: (row: WorktreeAgentRow, activation: WorktreeRowActivation) => void;
  onActivateSubagent?: (subagent: WorktreeSubagentRow, parent: WorktreeAgentRow) => void;
  /** A getter, because the setting is live — same reason the tree takes one. */
  rowActivation?: () => WorktreeRowActivation;
  /**
   * The drawer closed. The owner returns focus to the row it was describing —
   * only this knows whether focus was inside, only the owner can find the row.
   */
  onClosed?: (worktreeId: string, focusWasInside: boolean) => void;
  now?: () => number;
}

/**
 * Everything inside the drawer that can hold focus across a redraw.
 *
 * The rows carry their own identity already — `data-row-id` on an agent row,
 * `data-sub-key` on a delegation — and the drawer makes both focusable, so a
 * scheme that knew only about its own `data-focus` controls left every row it
 * drew unrestorable (.reviews/round-1.md B1).
 */
const FOCUSABLE = "[data-focus],[data-row-id],[data-sub-key]";

/**
 * One namespaced key per focusable thing. Namespaced because the three sources
 * are different vocabularies: an action label and a row id that happened to
 * match would otherwise be the same key.
 */
function focusKeyOf(el: HTMLElement): string | null {
  const own = el.dataset.focus;
  if (own !== undefined) {
    return `act\u0000${own}`;
  }
  const sub = el.dataset.subKey;
  if (sub !== undefined) {
    return `sub\u0000${sub}`;
  }
  const row = el.dataset.rowId;
  return row === undefined ? null : `row\u0000${row}`;
}

export class WorktreeInspector {
  readonly element: HTMLElement;

  private readonly deps: WorktreeInspectorDeps;
  private worktreeId: string | null = null;
  private tree: WorktreeTree | null = null;
  private presence: WorktreePresence | null = null;
  /**
   * What the DOM currently reflects. `null` while closed, so reopening on the
   * same worktree after a dismissal always draws rather than being guarded out.
   */
  private signature: string | null = null;

  static mount(deps: WorktreeInspectorDeps): WorktreeInspector {
    return new WorktreeInspector(deps);
  }

  private constructor(deps: WorktreeInspectorDeps) {
    this.deps = deps;
    this.element = document.createElement("div");
    this.element.className = "wt-inspector";
    this.element.setAttribute("role", "region");
    this.element.hidden = true;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  isOpen(): boolean {
    return this.worktreeId !== null;
  }

  open(worktreeId: string): void {
    // Opening on the worktree already shown is a no-op by design; every path
    // that empties the DOM — `close`, and an envelope without this worktree —
    // drops the signature there, so a reopen after one of those always draws.
    this.worktreeId = worktreeId;
    this.draw();
  }

  close(): void {
    if (this.worktreeId === null) {
      return;
    }
    const was = this.worktreeId;
    const focusWasInside = this.element.contains(document.activeElement);
    this.worktreeId = null;
    this.signature = null;
    this.element.hidden = true;
    this.element.replaceChildren();
    this.deps.onClosed?.(was, focusWasInside);
  }

  /**
   * Redraw on the next `setData`/`refresh` even if the data is identical.
   *
   * The guard is over the worktree and its rows, which is everything the drawer
   * DERIVES its contents from — except the action capabilities, which live in a
   * record the host mutates in place. A launch target arriving is invisible to
   * every field in the key, so the drawer went on offering the actions it had
   * when it opened (.reviews/round-1.md B3).
   */
  invalidate(): void {
    this.signature = null;
  }

  /** A new envelope. Redraws only if what this drawer draws actually moved. */
  setData(tree: WorktreeTree | null, presence: WorktreePresence | null): void {
    this.tree = tree;
    this.presence = presence;
    this.draw();
  }

  /**
   * Re-derive claims that move with the clock rather than with a push.
   *
   * Driven by the tree's existing one-shot ceiling timer rather than a second
   * one, so the two surfaces cannot disagree about a row's state at any moment
   * (§ 6.1, design.md D7).
   */
  refresh(): void {
    this.draw();
  }

  /** The selected worktree, from the tree last received. */
  private info(): WorktreeInfo | undefined {
    if (this.worktreeId === null) {
      return undefined;
    }
    for (const repo of this.tree?.repos ?? []) {
      for (const wt of repo.worktrees) {
        if (wt.id === this.worktreeId) {
          return wt;
        }
      }
    }
    return undefined;
  }

  private rows(): readonly WorktreeAgentRow[] {
    return this.worktreeId === null ? [] : (this.presence?.rowsByWorktreeId[this.worktreeId] ?? []);
  }

  private degraded(): readonly PresenceDegradation[] {
    return this.presence?.degradedSources ?? [];
  }

  private draw(): void {
    const info = this.info();
    if (info === undefined) {
      // Closed, or open on a worktree this envelope does not carry. The owner
      // closes it on a selection that left the tree; until that arrives, showing
      // the last worktree's details under the new tree would be a stale claim.
      this.element.hidden = true;
      this.element.replaceChildren();
      this.signature = null;
      return;
    }
    const now = this.now();
    const rows = this.rows();
    const next = worktreeScopeSignature(info, rows, this.degraded(), now);
    if (next === this.signature) {
      return;
    }
    this.signature = next;

    // `replaceChildren` below detaches whatever holds focus, and focus falls to
    // <body> — so a poll would throw a keyboard user out of the drawer mid-use.
    // Restored by key, the drawer's analogue of the tree's row key.
    const held = this.element.contains(document.activeElement)
      ? (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(FOCUSABLE)
      : null;
    const restoreTo = held === null || held === undefined ? null : focusKeyOf(held);

    const label = branchLabel(info);
    this.element.setAttribute("aria-label", `${label.text} details`);
    this.element.hidden = false;
    this.element.replaceChildren(
      this.header(label.text),
      this.path(info),
      this.actions(info),
      this.agents(info, rows, now),
    );

    if (restoreTo !== null) {
      // Matched by value rather than built into a selector: an action key carries
      // a user-facing label, and there is no need to make a control's name part
      // of a query language to find the control again.
      for (const el of this.element.querySelectorAll<HTMLElement>(FOCUSABLE)) {
        if (focusKeyOf(el) === restoreTo) {
          el.focus();
          break;
        }
      }
    }
    // After the DOM is committed — a dep answering synchronously would otherwise
    // re-enter this and replace the tree it is standing in.
    try {
      this.deps.rosters.flush((row) => this.deps.onRequestSubagents?.(row));
    } catch (err) {
      // `RosterRequests` re-queues what it could not send, but the signature
      // above already claims this data is drawn — so an identical push or a
      // ceiling tick returns early and nothing ever asks again, leaving those
      // histories on "Reading…" for the session (.reviews/round-2.md W4).
      this.signature = null;
      throw err;
    }
  }

  private header(branch: string): HTMLElement {
    const head = document.createElement("div");
    head.className = "wt-ihead";

    const title = document.createElement("span");
    title.className = "wt-ibranch";
    title.textContent = branch;

    const close = document.createElement("button");
    close.type = "button";
    close.className = "wt-idismiss";
    close.setAttribute("aria-label", "Close inspector");
    close.dataset.focus = "close";
    close.textContent = "✕";
    close.addEventListener("click", () => this.close());

    head.append(title, close);
    return head;
  }

  /**
   * The full path. One of only two places it appears in full — rows never show
   * one, because at sidebar width it crowds out the branch (§ 3.2, D16).
   */
  private path(info: WorktreeInfo): HTMLElement {
    const path = document.createElement("div");
    path.className = "wt-ipath";
    path.textContent = info.displayPath;
    path.dataset.tip = info.displayPath;
    return path;
  }

  private actions(info: WorktreeInfo): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "wt-iactions";
    if (this.deps.actions === undefined) {
      return bar;
    }
    // `repoScoped: false` — this surface is about one worktree, so create and
    // prune are absent rather than silently acting on its repository. Every other
    // withdrawal (missing, main, an unsupplied capability) comes from the same
    // builder the context menu uses, so the two can never disagree.
    const items = worktreeActionItems(info, this.deps.actions, { prunableCount: 0, repoScoped: false });
    for (const entry of items) {
      if (entry === "sep") {
        continue;
      }
      bar.appendChild(this.actionButton(entry));
    }
    return bar;
  }

  private actionButton(entry: ContextMenuItem): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wt-ibtn";
    btn.dataset.focus = `act:${entry.label}`;
    btn.dataset.act = entry.label;
    const icon = document.createElement("span");
    icon.className = "wt-ibtn-icon";
    // Static icon constants only, per `ContextMenuItem.icon` — never row-derived.
    icon.innerHTML = entry.icon;
    icon.setAttribute("aria-hidden", "true");
    btn.append(icon, document.createTextNode(entry.label));
    btn.addEventListener("click", () => entry.act());
    return btn;
  }

  /**
   * The agents in this worktree, each naming its model, each followed by its
   * delegation history.
   *
   * The history is drawn unconditionally: this is the detail surface, so putting
   * it behind a second disclosure would leave the drawer saying nothing the row
   * above it does not already say. The rows therefore own no disclosure, which is
   * why they draw no chevron and announce no `aria-expanded`.
   */
  private agents(info: WorktreeInfo, rows: readonly WorktreeAgentRow[], now: number): HTMLElement {
    const list = document.createElement("div");
    list.className = "wt-iagents";
    list.setAttribute("role", "list");
    list.setAttribute("aria-label", `Agents in ${branchLabel(info).text}`);
    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "wt-inote";
      empty.textContent = "No agents in this worktree";
      list.appendChild(empty);
      return list;
    }
    const degraded = this.degraded();
    for (const row of rows) {
      // Queued, not sent: `flush` runs once the DOM below is committed.
      this.deps.rosters.want(row);
      // One item per agent, holding the row AND the history under it. Two sibling
      // items — the first shape this took — makes the list announce twice the
      // agents there are, and leaves each history a peer of the row it describes
      // rather than part of it (.reviews/round-2.md W1).
      const item = document.createElement("div");
      item.setAttribute("role", "listitem");
      item.className = "wt-iagent";
      item.appendChild(
        renderAgentRow(
          row,
          {
            activity: presentedActivity(row, degraded, now),
            now,
            // A button, because that is what it is: activating it focuses the
            // pane or opens the preview, and `bindActivation` already answers
            // Enter and Space. `listitem` belongs to the wrapper above, and
            // claiming it here is what put two of them in the list.
            role: "button",
            focusable: true,
            disclosure: false,
            showModel: true,
          },
          {
            onActivate: (target) => {
              this.deps.onActivateAgent?.(target, activationFor(target, this.deps.rowActivation?.() ?? "focus"));
            },
          },
        ),
      );
      // A labelled group, not a second list: three of the four roster states list
      // nothing at all, and a `list` that never lists is worse than no list role.
      // The label is what ties a history to the agent it belongs to.
      const history = renderSubagentSection(
        row.delegations,
        row,
        (subagent, parent) => this.deps.onActivateSubagent?.(subagent, parent),
        now,
        {
          rowRole: "button",
          focusable: true,
          // Nothing will ever be asked for this row, so an unread roster here
          // is unreadable rather than pending.
          noSession: row.entryId === undefined,
        },
      );
      history.setAttribute("aria-label", `Delegations of ${agentRowTitle(row)}`);
      item.appendChild(history);
      list.appendChild(item);
    }
    return list;
  }
}
