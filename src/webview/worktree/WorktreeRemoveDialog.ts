// src/webview/worktree/WorktreeRemoveDialog.ts — The two outcomes of asking to
// remove a worktree (worktree-panel-ui § 5, worktree-actions § 3.3).
//
// They are one dialog because they are one question with two answers, and keeping
// them together is what stops the refusal from drifting into a disabled button:
//
//  - CONFIRMABLE: every blocker is named in one list, and the warning says what
//    force actually authorizes — irrevocable deletion of everything under the path,
//    INCLUDING files written after the confirmation — plus what it leaves behind
//    (panes still running in a deleted directory, the branch kept).
//  - REFUSED: `busyAgents > 0` or `isMain`. No confirm button EXISTS to click; the
//    dialog names the agent instead and offers to show it. A disabled confirm would
//    imply some other input could enable it.

import { countOf, failed, isRefusedByChecks } from "../../worktree/removalChecks";
import { ICON_TERMINAL } from "../vault/icons";
import { dialogTitle, openDialogShell, textButton } from "./worktreeDialogShell";
import { presentedActivity } from "./worktreeFormat";
import { ICON_LOCK, ICON_WARNING, ICON_WINDOW } from "./worktreeIcons";
import { renderAgentRow } from "./worktreeTreeView";
import type {
  PresenceDegradation,
  RemovalCheck,
  WorktreeAgentRow,
  WorktreeInfo,
  WorktreeRemoveReport,
} from "./worktreeViewTypes";

export interface WorktreeRemoveDialogDeps {
  info: WorktreeInfo;
  report: WorktreeRemoveReport;
  /** Rows in this worktree; the refusal names the busy ones. */
  agentRows?: WorktreeAgentRow[];
  /**
   * Presence sources currently failing, so a listed row is drawn with what is
   * known about it. Required: a default here is how a caller silently draws the
   * wire value, which is the omission review found on two other surfaces.
   */
  degradedSources: readonly PresenceDegradation[];
  /** Re-sends the remove with `force: true` AND the fingerprint the user was shown. */
  onConfirm: (fingerprint: string) => void;
  /** Reveal the agent that blocks the removal. */
  onShowAgent?: (row: WorktreeAgentRow) => void;
  onCancel?: () => void;
  now?: number;
}

/**
 * True when no confirmation can authorize this removal (§ 3.3, design.md D4).
 *
 * Reads the class the host sent rather than re-listing which checks refuse.
 * The old form named `isMain`, `busyAgents` and `containsWorktrees` here as
 * well as host-side, so the safety rule lived in two places that could drift.
 */
export function isRemoveRefused(checks: readonly RemovalCheck[]): boolean {
  return isRefusedByChecks(checks);
}

function blockerItem(icon: string, build: (span: HTMLElement) => void): HTMLLIElement {
  const li = document.createElement("li");
  const iconEl = document.createElement("span");
  iconEl.innerHTML = icon;
  iconEl.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  build(text);
  li.append(iconEl, text);
  return li;
}

/** `<b>7 tracked files</b> have uncommitted changes.` */
function countLine(span: HTMLElement, count: string, rest: string): void {
  const b = document.createElement("b");
  b.textContent = count;
  span.append(b, document.createTextNode(` ${rest}`));
}

/** Every non-zero blocker, in one list, so one confirmation covers the whole risk. */
export function buildBlockerList(checks: readonly RemovalCheck[], info: WorktreeInfo): HTMLElement {
  const untracked = countOf(checks, "untracked");
  const idlePanes = countOf(checks, "idlePanes");
  const externalAgents = countOf(checks, "externalAgents");
  const list = document.createElement("ul");
  list.className = "wt-blockers";
  if (failed(checks, "dirty")) {
    list.appendChild(blockerItem(ICON_WARNING, (s) => countLine(s, "Tracked files", "have uncommitted changes.")));
  }
  if (untracked > 0) {
    list.appendChild(
      blockerItem(ICON_WARNING, (s) =>
        countLine(s, `${untracked} untracked file${untracked === 1 ? "" : "s"}`, "in the folder."),
      ),
    );
  }
  if (idlePanes > 0) {
    list.appendChild(
      blockerItem(ICON_TERMINAL, (s) =>
        countLine(
          s,
          `${idlePanes} idle terminal${idlePanes === 1 ? "" : "s"}`,
          "in this window have it as their working directory.",
        ),
      ),
    );
  }
  if (externalAgents > 0) {
    list.appendChild(
      blockerItem(ICON_WINDOW, (s) =>
        countLine(
          s,
          `${externalAgents} session${externalAgents === 1 ? "" : "s"} in another window`,
          externalAgents === 1 ? "is rooted here." : "are rooted here.",
        ),
      ),
    );
  }
  if (failed(checks, "locked")) {
    list.appendChild(
      blockerItem(ICON_LOCK, (s) => {
        const b = document.createElement("b");
        b.textContent = "locked";
        s.append(document.createTextNode("The worktree is "), b);
        if (info.lockReason) {
          s.append(document.createTextNode(` — “${info.lockReason}”.`));
        } else {
          s.append(document.createTextNode("."));
        }
      }),
    );
  }
  return list;
}

/**
 * What force actually authorizes. Assembled rather than templated so each clause
 * only appears when it is true — a warning that names two terminals that do not
 * exist is the same class of lie as a state dot that is not live.
 */
function buildForceWarning(checks: readonly RemovalCheck[], info: WorktreeInfo): HTMLElement {
  const idlePanes = countOf(checks, "idlePanes");
  const box = document.createElement("div");
  box.className = "wt-warnbox";
  const lead = document.createElement("b");
  lead.textContent = "Force remove deletes everything under that path, irreversibly";
  box.append(lead, document.createTextNode(" — including files written after you confirm."));
  if (failed(checks, "locked")) {
    box.append(document.createTextNode(" The lock is overridden."));
  }
  if (idlePanes > 0) {
    box.append(
      document.createTextNode(
        ` The ${idlePanes === 1 ? "terminal keeps" : `${idlePanes} terminals keep`} running in a deleted directory.`,
      ),
    );
  }
  // Branch deletion is not part of removal, and saying so is what stops a user
  // believing they just deleted the work as well as the checkout.
  if (info.branch) {
    const branch = document.createElement("b");
    branch.textContent = info.branch;
    box.append(document.createTextNode(" The branch "), branch, document.createTextNode(" is kept."));
  }
  return box;
}

/** Mount the remove dialog — confirmation or refusal — and return its disposer. */
export function openWorktreeRemoveDialog(root: HTMLElement, deps: WorktreeRemoveDialogDeps): () => void {
  const { info } = deps;
  const { checks, contained } = deps.report;
  const refused = isRemoveRefused(checks);
  const branch = info.branch ?? info.displayPath;

  const shell = openDialogShell(root, {
    label: refused ? "Cannot remove worktree" : "Remove worktree",
    // A confirmation is answered, not dismissed by a stray click on the scrim.
    dismissOnScrim: refused,
    onDismiss: () => deps.onCancel?.(),
  });
  const cancel = (): void => {
    deps.onCancel?.();
    shell.dispose();
  };

  shell.dialog.appendChild(refused ? dialogTitle("Can't remove", branch) : dialogTitle("Remove", `${branch}?`));

  const path = document.createElement("p");
  path.className = "wt-dialog-path";
  path.textContent = info.displayPath;
  shell.dialog.appendChild(path);

  if (refused) {
    const degraded = deps.degradedSources;
    // Named before the copy branches, because the copy asks whether any listed
    // row is one no live source can vouch for.
    // The filter stays on the WIRE value, so a source going down never shrinks
    // this refusal — warning about a possibly-working agent is the safe side of
    // deleting a folder. What the source decides is the CLAIM made about each row.
    const busy = (deps.agentRows ?? []).filter((r) => r.activity === "running" || r.activity === "waiting");
    // ONE reading for the whole paint: the copy below and the rows further down
    // describe the same instant, and `renderAgentRow` would otherwise resolve its
    // own `Date.now()` when `deps.now` is absent.
    const now = deps.now ?? Date.now();
    const presented = busy.map((row) => [row, presentedActivity(row, degraded, now)] as const);
    const confirmed = presented.filter(([, a]) => a !== "unknown").length;
    // A claim past the ceiling is readable but not vouched for. It still blocks —
    // that is the safe side — but the prose must not promote it to certainty.
    const vouched = presented.filter(([, a]) => a !== "unknown" && a !== "running-unconfirmed").length;
    const box = document.createElement("div");
    box.className = "wt-refusebox";
    const lead = document.createElement("b");
    // Three refusal reasons, three explanations. An if/else over two of them
    // would render the agent copy for a containment refusal — telling the user
    // to stop an agent that is not running (round-1 P1 / oracle O3).
    if (failed(checks, "isMain")) {
      lead.textContent = "This is the repository's main worktree.";
      box.append(lead, document.createTextNode(" It cannot be removed — no confirmation overrides it."));
    } else if (failed(checks, "containsWorktrees")) {
      const n = countOf(checks, "containsWorktrees");
      lead.textContent =
        n === 1 ? "Another worktree lives inside this one." : `${n} other worktrees live inside this one.`;
      box.append(
        lead,
        document.createTextNode(
          " Removing this folder would delete them too, leaving git holding registrations for directories that are gone. Remove them first.",
        ),
      );
      const nested = document.createElement("ul");
      nested.className = "wt-blockers";
      for (const child of contained) {
        const li = document.createElement("li");
        li.textContent = child.displayPath;
        nested.appendChild(li);
      }
      box.appendChild(nested);
    } else {
      // Four cases, because a list can be part confirmed and part unreadable, and
      // one sentence for the whole list would misdescribe whichever part it is not
      // about. Nothing listed is the LEAST evidenced case, so it gets the weakest
      // claim — the blocker counted an agent that no row can now show.
      // The follow-on sentence belongs INSIDE the chain: "stop it first" presupposes
      // a row the user can act on, and the empty branch has just said there is none.
      const stopIt = " Stop it first — there is no confirmation that removes a folder out from under a working agent.";
      const unread = presented.length - confirmed;
      const unconfirmed = confirmed - vouched;
      if (presented.length === 0) {
        lead.textContent = "An agent was mid-turn in this worktree, and no row can be shown for it now.";
        box.append(lead, document.createTextNode(" It is no longer listed here — retry the removal."));
      } else {
        // COMPOSED, not a branch per combination. A list can hold vouched-for rows,
        // rows past the ceiling, and rows no source can read, in any mixture; the
        // earlier chain picked one sentence and silently dropped whichever parts it
        // was not about. Each clause is added only when its own count is non-zero,
        // so the sentence says everything true of this list and nothing else.
        const clauses: string[] = [];
        if (vouched > 0) {
          clauses.push("An agent is mid-turn in this worktree");
          if (unconfirmed > 0) {
            clauses.push(
              unconfirmed === 1
                ? "another claim here has outlived what can confirm it"
                : "other claims here have outlived what can confirm them",
            );
          }
        } else if (confirmed > 0) {
          clauses.push(
            "An agent may be mid-turn in this worktree",
            "the activity here has outlived what can confirm it",
          );
        } else {
          clauses.push("An agent may be mid-turn in this worktree", "nothing can currently confirm it");
        }
        if (unread > 0) {
          clauses.push(unread === 1 ? "another here cannot be read at all" : "others here cannot be read at all");
        }
        const [first, ...rest] = clauses;
        lead.textContent = rest.length === 0 ? `${first}.` : `${first}, and ${rest.join(", and ")}.`;
        box.append(lead, document.createTextNode(stopIt));
      }
    }
    shell.dialog.appendChild(box);

    // Name the agent rather than the count: "stop it first" is only actionable if
    // the user can see which one.
    for (const [row, activity] of presented) {
      const el = renderAgentRow(
        row,
        { activity, now },
        {
          onActivate: () => deps.onShowAgent?.(row),
          onContextMenu: () => {},
        },
      );
      el.style.paddingLeft = "0";
      el.style.paddingRight = "0";
      shell.dialog.appendChild(el);
    }

    const close = textButton("Close", "plain", cancel);
    shell.actions.append(close);
    // Point at a row the copy vouches for where there is one: offering to show an
    // agent the paragraph just said it cannot read is the same claim it withdrew.
    const showable = presented.find(([, a]) => a !== "unknown")?.[0] ?? busy[0];
    if (showable && deps.onShowAgent) {
      const firstBusy = showable;
      shell.actions.append(
        textButton("Show the agent", "primary", () => {
          deps.onShowAgent?.(firstBusy);
          shell.dispose();
        }),
      );
    }
    shell.dialog.appendChild(shell.actions);
    shell.refreshFocusTrap();
    shell.focusInitial(close);
    return shell.dispose;
  }

  shell.dialog.append(buildBlockerList(checks, info), buildForceWarning(checks, info));
  const cancelBtn = textButton("Cancel", "plain", cancel);
  shell.actions.append(cancelBtn);
  // A check nobody could evaluate renders nothing — `buildBlockerList` keys every
  // line on `failed` or a positive count, and `unproven` is neither. Offering
  // force underneath that empty list would ask the user to authorize destroying a
  // risk set the dialog just failed to describe, which is the one direction this
  // action must never fail in (round-1 W2).
  //
  // Withholding the button rather than explaining the gap is deliberate. The
  // copy that makes an unreadable report legible is WT-013.4's, and WT-013.1 is
  // what first routes an `unproven` check here at all — today `checksFor` emits
  // one only for an `unavailable` assessment, which the service answers
  // elsewhere. So this guard changes no reachable rendering; it makes the
  // unreachable case fail closed instead of fail open when that changes.
  if (!checks.some((c) => c.outcome === "unproven")) {
    shell.actions.append(
      textButton("Force remove", "danger", () => {
        // Re-sent with the fingerprint the user was SHOWN: force is authorization for
        // this blocker set, not a blanket one.
        deps.onConfirm(deps.report.fingerprint);
        shell.dispose();
      }),
    );
  }
  shell.dialog.appendChild(shell.actions);
  shell.refreshFocusTrap();
  // Focus lands on Cancel, never on the destructive button: an accidental Enter
  // on open must not be the authorization.
  shell.focusInitial(cancelBtn);
  return shell.dispose;
}
