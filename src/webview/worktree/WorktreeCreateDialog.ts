// src/webview/worktree/WorktreeCreateDialog.ts — The create-worktree form
// (worktree-panel-ui § 5, worktree-actions § 3.2).
//
// Presentation only in this phase: `onSubmit` receives the draft and nothing here
// spawns git. What the form DOES own is the truthfulness rules the design fixes:
//
//  - The branch name starts empty. A wrong-but-plausible suggestion is worse than
//    a blank field, so none is offered.
//  - The path is derived from the branch, and when the derived path collided the
//    form shows the FINAL suffixed path before submit — not the one that was taken.
//  - The agent picker lives inside the form, because creating a worktree in order
//    to put an agent in it is one intent.
//  - A dangerous permission posture is labelled and never preselected.
//  - The repo picker appears only once the workspace holds more than one repo.

import { dialogTitle, field, keyHint, openDialogShell, selectControl, textButton } from "./worktreeDialogShell";
import type {
  WorktreeBranchMode,
  WorktreeCreateDefaults,
  WorktreeCreateDraft,
  WorktreeOpenAfter,
} from "./worktreeViewTypes";

const BRANCH_MODES: readonly { id: WorktreeBranchMode; label: string }[] = [
  { id: "new", label: "New branch" },
  { id: "existing", label: "Existing" },
  { id: "detached", label: "Detached" },
];

const OPEN_AFTER: readonly { value: WorktreeOpenAfter; label: string }[] = [
  { value: "none", label: "Nothing" },
  { value: "terminal", label: "Open a terminal here" },
  { value: "agent", label: "Start an agent" },
  { value: "newWindow", label: "Open folder in a new window" },
  { value: "addToWorkspace", label: "Add folder to workspace" },
];

/** Permission postures. The dangerous one is last and never the initial value. */
const PERMISSIONS: readonly { id: string; label: string; dangerous?: boolean }[] = [
  { id: "ask", label: "Ask before edits" },
  { id: "acceptEdits", label: "Accept edits" },
  { id: "skipAll", label: "Skip all prompts", dangerous: true },
];

export interface WorktreeCreateDialogDeps {
  /** One entry per repo; a single entry suppresses the picker entirely (§ 3.2). */
  repos: WorktreeCreateDefaults[];
  /** Which repo the create was invoked from. */
  initialRepoId?: string;
  /**
   * Validate a branch name the way `git check-ref-format --branch` would. Supplied
   * by the owner so the form holds no git knowledge; returns the message to show.
   */
  validateBranch?: (name: string) => string | undefined;
  onSubmit: (draft: WorktreeCreateDraft) => void;
  onCancel?: () => void;
}

/** `feat/worktree ui` → `feat-worktree-ui`, the segment the default path appends. */
export function sanitizeBranchForPath(branch: string): string {
  return branch
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/** Mount the create form and return its disposer. */
export function openWorktreeCreateDialog(root: HTMLElement, deps: WorktreeCreateDialogDeps): () => void {
  const repos = deps.repos;
  const first = repos[0];
  if (!first) {
    throw new Error("openWorktreeCreateDialog requires at least one repo");
  }

  const draft: WorktreeCreateDraft = {
    repoId: deps.initialRepoId ?? first.repoId,
    branchMode: "new",
    branchName: "",
    baseRef: "",
    path: "",
    openAfter: "none",
    permissionMode: PERMISSIONS[0]?.id,
  };
  /** True until the user edits the path themselves; after that we stop deriving it. */
  let pathIsDerived = true;

  const currentRepo = (): WorktreeCreateDefaults => repos.find((r) => r.repoId === draft.repoId) ?? first;

  const shell = openDialogShell(root, {
    label: "Create worktree",
    wide: true,
    dismissOnScrim: true,
    onDismiss: () => deps.onCancel?.(),
  });
  const cancel = (): void => {
    deps.onCancel?.();
    shell.dispose();
  };

  shell.dialog.appendChild(dialogTitle("Create worktree", undefined, cancel));

  // ── Repository (only with more than one) ────────────────────────────────
  const repoHint = document.createElement("span");
  repoHint.className = "wt-fhint";
  if (repos.length > 1) {
    const repoField = field("Repository", "wt-repo-select");
    const repoSelect = selectControl(
      "wt-repo-select",
      repos.map((r) => ({ value: r.repoId, label: r.repoLabel })),
      draft.repoId,
    );
    repoSelect.addEventListener("change", () => {
      draft.repoId = repoSelect.value;
      syncAgents();
      syncDerived();
    });
    repoField.append(repoSelect, repoHint);
    shell.dialog.appendChild(repoField);
  }

  // ── Branch mode ─────────────────────────────────────────────────────────
  const modeField = field("Branch");
  const segmented = document.createElement("div");
  segmented.className = "vault-segmented";
  segmented.setAttribute("role", "tablist");
  segmented.setAttribute("aria-label", "Branch mode");
  for (const mode of BRANCH_MODES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.mode = mode.id;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", mode.id === draft.branchMode ? "true" : "false");
    btn.textContent = mode.label;
    btn.addEventListener("click", () => {
      draft.branchMode = mode.id;
      for (const other of Array.from(segmented.querySelectorAll<HTMLButtonElement>("button"))) {
        other.setAttribute("aria-selected", other.dataset.mode === draft.branchMode ? "true" : "false");
      }
      syncDerived();
    });
    segmented.appendChild(btn);
  }
  modeField.appendChild(segmented);
  shell.dialog.appendChild(modeField);

  // ── Name + base ref, side by side ───────────────────────────────────────
  const cols = document.createElement("div");
  cols.className = "wt-cols";

  const nameField = field("Name", "wt-branch");
  const nameInput = document.createElement("input");
  nameInput.className = "wt-input";
  nameInput.id = "wt-branch";
  nameInput.type = "text";
  nameInput.placeholder = "feat/…";
  const nameError = document.createElement("span");
  nameError.className = "wt-ferror";
  nameError.hidden = true;
  nameField.append(nameInput, nameError);

  const baseField = field("Base ref", "wt-base", true);
  const baseInput = document.createElement("input");
  baseInput.className = "wt-input wt-input--mono";
  baseInput.id = "wt-base";
  baseInput.type = "text";
  baseInput.placeholder = "HEAD";
  baseField.appendChild(baseInput);

  cols.append(nameField, baseField);
  shell.dialog.appendChild(cols);

  // ── Path ────────────────────────────────────────────────────────────────
  const pathField = field("Path", "wt-path");
  const pathInput = document.createElement("input");
  pathInput.className = "wt-input wt-input--mono";
  pathInput.id = "wt-path";
  pathInput.type = "text";
  const pathHint = document.createElement("span");
  pathHint.className = "wt-fhint";
  pathField.append(pathInput, pathHint);
  shell.dialog.appendChild(pathField);

  // ── After creating ──────────────────────────────────────────────────────
  const afterField = field("After creating", "wt-after");
  const afterSelect = selectControl(
    "wt-after",
    OPEN_AFTER.map((o) => ({ value: o.value, label: o.label })),
    draft.openAfter,
  );
  afterSelect.addEventListener("change", () => {
    draft.openAfter = afterSelect.value as WorktreeOpenAfter;
    syncAgentBox();
    shell.refreshFocusTrap();
  });
  afterField.appendChild(afterSelect);
  shell.dialog.appendChild(afterField);

  // ── Agent box — shown only for `openAfter: "agent"` ─────────────────────
  const agentBox = document.createElement("div");
  agentBox.className = "wt-agentbox";
  agentBox.hidden = true;

  const agentCols = document.createElement("div");
  agentCols.className = "wt-cols";
  const agentField = field("Agent", "wt-agent");
  const agentSelect = selectControl("wt-agent", []);
  agentSelect.addEventListener("change", () => {
    draft.agentId = agentSelect.value;
  });
  /** Which agents resolve is a property of the REPO, so switching repo rebuilds the
   *  list and drops a selection the new repo does not offer. */
  const syncAgents = (): void => {
    const agents = currentRepo().agents;
    const keep = agents.some((a) => a.id === draft.agentId) ? draft.agentId : agents[0]?.id;
    agentSelect.replaceChildren();
    for (const a of agents) {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = a.label;
      opt.selected = a.id === keep;
      agentSelect.appendChild(opt);
    }
    draft.agentId = keep;
  };
  syncAgents();
  agentField.appendChild(agentSelect);

  const permField = field("Permissions", "wt-perm");
  const permSelect = selectControl(
    "wt-perm",
    PERMISSIONS.map((p) => ({ value: p.id, label: p.dangerous ? `${p.label} (dangerous)` : p.label })),
    draft.permissionMode,
  );
  permSelect.addEventListener("change", () => {
    draft.permissionMode = permSelect.value;
  });
  permField.appendChild(permSelect);
  agentCols.append(agentField, permField);

  const promptField = field("First prompt", "wt-prompt", true);
  const promptInput = document.createElement("textarea");
  promptInput.className = "wt-textarea";
  promptInput.id = "wt-prompt";
  promptInput.placeholder = "Sent once the agent's composer is ready…";
  promptInput.addEventListener("input", () => {
    draft.firstPrompt = promptInput.value;
  });
  promptField.appendChild(promptInput);

  const agentHint = document.createElement("span");
  agentHint.className = "wt-fhint";
  agentHint.append(document.createTextNode("Only agents whose executable resolves are listed."));
  const dangerTag = document.createElement("span");
  dangerTag.className = "wt-danger-tag";
  dangerTag.textContent = "dangerous";
  agentHint.append(dangerTag, document.createTextNode("choices are never preselected."));

  agentBox.append(agentCols, promptField, agentHint);
  shell.dialog.appendChild(agentBox);

  // ── Actions ─────────────────────────────────────────────────────────────
  const cancelBtn = textButton("Cancel", "plain", cancel);
  const createBtn = textButton("Create worktree", "primary", () => submit());
  createBtn.appendChild(keyHint("⌘↵"));
  shell.actions.append(cancelBtn, createBtn);
  shell.dialog.appendChild(shell.actions);

  function submit(): void {
    if (createBtn.disabled) {
      return;
    }
    deps.onSubmit({ ...draft });
    shell.dispose();
  }

  function syncAgentBox(): void {
    agentBox.hidden = draft.openAfter !== "agent";
    if (!agentBox.hidden && !draft.agentId) {
      draft.agentId = agentSelect.value || undefined;
    }
  }

  /**
   * Re-derive the path and its hint from the branch, and re-validate. The hint
   * names the collided path AND the suffixed one the create will actually use —
   * showing only the pretty default would be a claim the form cannot keep.
   */
  function syncDerived(): void {
    const repo = currentRepo();
    repoHint.textContent = repo.mainPath;

    const detached = draft.branchMode === "detached";
    nameInput.disabled = detached;
    nameInput.placeholder = draft.branchMode === "existing" ? "existing-branch" : "feat/…";
    baseInput.placeholder = detached ? "a ref to detach at" : "HEAD";

    draft.branchName = nameInput.value;
    draft.baseRef = baseInput.value;

    const slug = sanitizeBranchForPath(detached ? draft.baseRef : draft.branchName);
    const derived = slug ? `${repo.pathParent}/${repo.pathPrefix}-${slug}` : "";
    if (pathIsDerived) {
      draft.path = derived;
      pathInput.value = derived;
    }
    pathInput.placeholder = `…/${repo.pathPrefix}-<branch>`;

    pathHint.replaceChildren();
    if (repo.collidedWith) {
      const taken = document.createElement("b");
      taken.textContent = repo.collidedWith;
      pathHint.append(document.createTextNode("…"), taken, document.createTextNode(" already exists"));
      // Only the host can resolve the suffix it will actually take. Naming the
      // derived path here would point at the directory that is already occupied.
      if (repo.resolvedPath) {
        const final = document.createElement("b");
        final.textContent = repo.resolvedPath;
        pathHint.append(document.createTextNode(", so this will be created as "), final, document.createTextNode("."));
      } else {
        pathHint.append(document.createTextNode("; a free suffix is chosen when the worktree is created."));
      }
    } else {
      const b = document.createElement("b");
      b.textContent = `…/${repo.pathPrefix}-<branch>`;
      pathHint.append(
        document.createTextNode("Defaults to "),
        b,
        document.createTextNode(" once the branch is named."),
      );
    }

    const error = detached ? undefined : deps.validateBranch?.(draft.branchName);
    draft.branchError = error;
    nameError.textContent = error ?? "";
    nameError.hidden = !error;
    nameInput.classList.toggle("is-invalid", Boolean(error));
    if (error) {
      nameInput.setAttribute("aria-invalid", "true");
    } else {
      nameInput.removeAttribute("aria-invalid");
    }

    // A create with no target is not offered — the button is disabled, not a
    // dialog that fails after the click.
    const named = detached ? draft.baseRef.trim().length > 0 : draft.branchName.trim().length > 0;
    createBtn.disabled = Boolean(error) || !named || draft.path.trim().length === 0;
    shell.refreshFocusTrap();
  }

  nameInput.addEventListener("input", syncDerived);
  baseInput.addEventListener("input", syncDerived);
  pathInput.addEventListener("input", () => {
    pathIsDerived = false;
    draft.path = pathInput.value;
    syncDerived();
  });
  shell.dialog.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      submit();
    }
  });

  syncAgentBox();
  syncDerived();
  shell.focusInitial(nameInput);

  return shell.dispose;
}
