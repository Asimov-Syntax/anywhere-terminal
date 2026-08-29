// src/webview/worktree/WorktreeLaunchDialog.ts — Start an agent in an existing
// worktree (worktree-actions.md § 4).
//
// The create form's post-create launch and this one are the SAME collection: both
// mount `worktreeAgentBox`, so the two entry paths cannot drift into two contracts
// that merely look alike (design.md D7). What this adds around it is the worktree
// the launch names — the one thing create does not have yet when it asks.

import { createWorktreeAgentBox } from "./worktreeAgentBox";
import { dialogTitle, keyHint, openDialogShell, textButton } from "./worktreeDialogShell";
import type { WorktreeLaunchAgent } from "./worktreeViewTypes";

export interface WorktreeLaunchRequest {
  agent: string;
  permissionChoiceId?: string;
  prompt?: string;
}

export interface WorktreeLaunchDialogDeps {
  /** Named in the title, so the user sees WHICH worktree before confirming. */
  worktreeLabel: string;
  /** Only agents the host reported as able to start a fresh session. */
  agents: readonly WorktreeLaunchAgent[];
  onConfirm: (request: WorktreeLaunchRequest) => void;
  onCancel?: () => void;
}

/** Returns the dialog's disposer, or `null` when there was nothing to open. */
export function openWorktreeLaunchDialog(root: HTMLElement, deps: WorktreeLaunchDialogDeps): (() => void) | null {
  // Nothing to launch means nothing to ask about. The menu item is absent in
  // that case too; this is the same rule held at the second door, because a
  // dialog offering an empty picker claims a choice that does not exist.
  if (deps.agents.length === 0) {
    return null;
  }

  const shell = openDialogShell(root, { label: "Start an agent", dismissOnScrim: true, onDismiss: deps.onCancel });
  const cancel = (): void => {
    shell.dispose();
    deps.onCancel?.();
  };

  shell.dialog.appendChild(dialogTitle("Start an agent", deps.worktreeLabel, cancel));

  const box = createWorktreeAgentBox(deps.agents, () => {
    shell.refreshFocusTrap();
    syncStart();
  });
  shell.dialog.appendChild(box.element);

  const startBtn = textButton("Start agent", "primary", () => submit());
  // The same gate the create form applies: an offered posture list with nothing
  // selected is an unmade choice, and this is the second door the rule names.
  const syncStart = (): void => {
    startBtn.disabled = box.needsPosture();
  };
  startBtn.appendChild(keyHint("⌘↵"));
  shell.dialog.appendChild(shell.actions);
  shell.actions.append(textButton("Cancel", "plain", cancel), startBtn);

  // The dialog is removed on submit, but a button reference outlives the DOM —
  // a double click, or a shortcut racing the click, would launch twice.
  let launched = false;

  function submit(): void {
    if (launched || startBtn.disabled) {
      return;
    }
    const choice = box.read();
    // The box only ever reports an agent it was given, so an absent one means
    // the list emptied under us rather than a bad selection — launch nothing.
    if (choice.agentId === undefined) {
      return;
    }
    launched = true;
    shell.dispose();
    deps.onConfirm({
      agent: choice.agentId,
      ...(choice.permissionChoiceId === undefined ? {} : { permissionChoiceId: choice.permissionChoiceId }),
      ...(choice.prompt === undefined ? {} : { prompt: choice.prompt }),
    });
  }

  syncStart();
  shell.dialog.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      submit();
    }
  });

  return () => shell.dispose();
}
