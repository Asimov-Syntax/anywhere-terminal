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

import { ICON_TERMINAL } from "../vault/icons";
import { dialogTitle, openDialogShell, textButton } from "./worktreeDialogShell";
import { ICON_LOCK, ICON_WARNING, ICON_WINDOW } from "./worktreeIcons";
import { renderAgentRow } from "./worktreeTreeView";
import type { WorktreeAgentRow, WorktreeInfo, WorktreeRemoveBlocker } from "./worktreeViewTypes";

export interface WorktreeRemoveDialogDeps {
  info: WorktreeInfo;
  blocker: WorktreeRemoveBlocker;
  /** Rows in this worktree; the refusal names the busy ones. */
  agentRows?: WorktreeAgentRow[];
  /** Re-sends the remove with `force: true` AND the fingerprint the user was shown. */
  onConfirm: (fingerprint: string) => void;
  /** Reveal the agent that blocks the removal. */
  onShowAgent?: (row: WorktreeAgentRow) => void;
  onCancel?: () => void;
  now?: number;
}

/** True when no confirmation can authorize this removal (§ 3.3). */
export function isRemoveRefused(blocker: WorktreeRemoveBlocker): boolean {
  return blocker.isMain || blocker.busyAgents > 0;
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
export function buildBlockerList(blocker: WorktreeRemoveBlocker, info: WorktreeInfo): HTMLElement {
  const list = document.createElement("ul");
  list.className = "wt-blockers";
  if (blocker.dirty) {
    list.appendChild(blockerItem(ICON_WARNING, (s) => countLine(s, "Tracked files", "have uncommitted changes.")));
  }
  if (blocker.untracked > 0) {
    list.appendChild(
      blockerItem(ICON_WARNING, (s) =>
        countLine(s, `${blocker.untracked} untracked file${blocker.untracked === 1 ? "" : "s"}`, "in the folder."),
      ),
    );
  }
  if (blocker.idlePanes > 0) {
    list.appendChild(
      blockerItem(ICON_TERMINAL, (s) =>
        countLine(
          s,
          `${blocker.idlePanes} idle terminal${blocker.idlePanes === 1 ? "" : "s"}`,
          "in this window have it as their working directory.",
        ),
      ),
    );
  }
  if (blocker.externalAgents > 0) {
    list.appendChild(
      blockerItem(ICON_WINDOW, (s) =>
        countLine(
          s,
          `${blocker.externalAgents} session${blocker.externalAgents === 1 ? "" : "s"} in another window`,
          blocker.externalAgents === 1 ? "is rooted here." : "are rooted here.",
        ),
      ),
    );
  }
  if (blocker.locked) {
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
function buildForceWarning(blocker: WorktreeRemoveBlocker, info: WorktreeInfo): HTMLElement {
  const box = document.createElement("div");
  box.className = "wt-warnbox";
  const lead = document.createElement("b");
  lead.textContent = "Force remove deletes everything under that path, irreversibly";
  box.append(lead, document.createTextNode(" — including files written after you confirm."));
  if (blocker.locked) {
    box.append(document.createTextNode(" The lock is overridden."));
  }
  if (blocker.idlePanes > 0) {
    box.append(
      document.createTextNode(
        ` The ${blocker.idlePanes === 1 ? "terminal keeps" : `${blocker.idlePanes} terminals keep`} running in a deleted directory.`,
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
  const { info, blocker } = deps;
  const refused = isRemoveRefused(blocker);
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
    const box = document.createElement("div");
    box.className = "wt-refusebox";
    const lead = document.createElement("b");
    if (blocker.isMain) {
      lead.textContent = "This is the repository's main worktree.";
      box.append(lead, document.createTextNode(" It cannot be removed — no confirmation overrides it."));
    } else {
      lead.textContent = "An agent is mid-turn in this worktree.";
      box.append(
        lead,
        document.createTextNode(
          " Stop it first — there is no confirmation that removes a folder out from under a working agent.",
        ),
      );
    }
    shell.dialog.appendChild(box);

    // Name the agent rather than the count: "stop it first" is only actionable if
    // the user can see which one.
    const busy = (deps.agentRows ?? []).filter((r) => r.activity === "running" || r.activity === "waiting");
    for (const row of busy) {
      const el = renderAgentRow(
        row,
        { now: deps.now },
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
    if (busy[0] && deps.onShowAgent) {
      const firstBusy = busy[0];
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

  shell.dialog.append(buildBlockerList(blocker, info), buildForceWarning(blocker, info));
  const cancelBtn = textButton("Cancel", "plain", cancel);
  shell.actions.append(
    cancelBtn,
    textButton("Force remove", "danger", () => {
      // Re-sent with the fingerprint the user was SHOWN: force is authorization for
      // this blocker set, not a blanket one.
      deps.onConfirm(blocker.fingerprint);
      shell.dispose();
    }),
  );
  shell.dialog.appendChild(shell.actions);
  shell.refreshFocusTrap();
  // Focus lands on Cancel, never on the destructive button: an accidental Enter
  // on open must not be the authorization.
  shell.focusInitial(cancelBtn);
  return shell.dispose;
}
