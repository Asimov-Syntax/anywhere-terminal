// src/webview/worktree/WorktreePruneDialog.ts — Prune's confirmation
// (worktree-actions.md § 3.5, design.md D13).
//
// Prune touches registrations, not working directories, so it is the least
// destructive mutating action — and it is still confirmed, because "prune"
// reads as dangerous and an unexplained count is worse than a confirmation.
// The count comes from the HOST, which is the only side that can know it.

import { dialogTitle, openDialogShell, textButton } from "./worktreeDialogShell";

export interface PruneDialogDeps {
  repoLabel: string;
  /** Registrations that will be dropped. Never rendered when this is zero. */
  count: number;
  onConfirm: (count: number) => void;
  onCancel?: () => void;
}

export function openWorktreePruneDialog(root: HTMLElement, deps: PruneDialogDeps): void {
  // Nothing prunable means no action to offer, so there is nothing to confirm
  // either — the menu should not have reached here.
  if (deps.count <= 0) {
    return;
  }

  const shell = openDialogShell(root, {
    label: "Prune worktree registrations",
    onDismiss: deps.onCancel,
  });

  shell.dialog.appendChild(dialogTitle("Prune worktree registrations?", deps.repoLabel, () => shell.dispose()));

  const body = document.createElement("p");
  body.className = "wt-dialog-body";
  const n = deps.count;
  const strong = document.createElement("b");
  strong.textContent = `${n} registration${n === 1 ? "" : "s"}`;
  body.append(
    document.createTextNode("Git is holding "),
    strong,
    document.createTextNode(
      n === 1
        ? " for a worktree directory that is gone. Pruning drops it."
        : " for worktree directories that are gone. Pruning drops them.",
    ),
  );
  shell.dialog.appendChild(body);

  // Say what is NOT lost: the whole reason this is confirmable rather than
  // refused is that no working file is at stake.
  const spared = document.createElement("p");
  spared.className = "wt-dialog-note";
  spared.textContent = "No files are deleted — the directories are already gone, and no branch is touched.";
  shell.dialog.appendChild(spared);

  shell.dialog.appendChild(shell.actions);
  shell.actions.append(
    textButton("Cancel", "plain", () => {
      shell.dispose();
      deps.onCancel?.();
    }),
    textButton(`Prune ${n}`, "danger", () => {
      shell.dispose();
      deps.onConfirm(n);
    }),
  );
  shell.focusInitial();
}
