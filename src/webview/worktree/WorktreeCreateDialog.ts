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

import { sanitizeBranchForPath } from "../../worktree/branchSlug";
import { createWorktreeAgentBox } from "./worktreeAgentBox";
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

/**
 * `agent` is offered only where something can perform it — the option is built
 * from the repo's own agent list, so a host that reported none leaves it absent
 * rather than selectable-and-refused.
 */
function openAfterOptions(canLaunch: boolean): { value: WorktreeOpenAfter; label: string }[] {
  return OPEN_AFTER.filter((o) => o.value !== "agent" || canLaunch);
}

const OPEN_AFTER: readonly { value: WorktreeOpenAfter; label: string }[] = [
  { value: "none", label: "Nothing" },
  { value: "terminal", label: "Open a terminal here" },
  { value: "agent", label: "Start an agent" },
  { value: "newWindow", label: "Open folder in a new window" },
  { value: "addToWorkspace", label: "Add folder to workspace" },
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
  /**
   * The branch changed, so the destination has to be resolved again — only the
   * host can say which path is free. Called on every settled edit; the owner
   * answers by calling the function it received from `bindDefaults`.
   */
  onBranchChange?: (repoId: string, branch: string) => void;
  /**
   * Receive the function that applies a fresh answer from the host. Kept as a
   * callback rather than a return value so the form stays a single expression
   * for every caller that does not need to update it.
   */
  bindDefaults?: (apply: (next: WorktreeCreateDefaults) => void) => void;
  onSubmit: (draft: WorktreeCreateDraft) => void;
  onCancel?: () => void;
}

// Re-exported from branchSlug, the one definition the host shares, so the form
// and the host cannot disagree about what a branch turns into (round-3 B12).
export { sanitizeBranchForPath };

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
      agentBox.setAgents(currentRepo().agents);
      rebuildAfterOptions();
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
    openAfterOptions(currentRepo().agents.length > 0).map((o) => ({ value: o.value, label: o.label })),
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
  // The block itself is shared with the standalone launch dialog, so create-then-
  // launch and launch-here collect the same thing rather than two things that
  // happen to look alike (design.md D7).
  const agentBox = createWorktreeAgentBox(currentRepo().agents);
  agentBox.setVisible(false);
  shell.dialog.appendChild(agentBox.element);

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
    const launch = draft.openAfter === "agent" ? agentBox.read() : {};
    deps.onSubmit({ ...draft, ...launch });
    shell.dispose();
  }

  /**
   * Two different questions, and the box keeps them apart: "this create is not
   * launching" is ours, "there is nothing to launch" is its own.
   */
  function syncAgentBox(): void {
    agentBox.setVisible(draft.openAfter === "agent");
  }

  /** A repo switch can withdraw the launch — the mode goes with it, not just the box. */
  function rebuildAfterOptions(): void {
    const offered = openAfterOptions(currentRepo().agents.length > 0);
    if (!offered.some((o) => o.value === draft.openAfter)) {
      draft.openAfter = "none";
    }
    afterSelect.replaceChildren(
      ...offered.map((o) => {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        return opt;
      }),
    );
    afterSelect.value = draft.openAfter;
    syncAgentBox();
  }

  /** The branch the last host request was made for, so edits do not re-ask. */
  let askedFor: string | null = null;
  /** True while a destination request has no answer yet. Submit waits for it. */
  let outstanding = false;

  /** Ask the host for the destination this branch would take, at most once each. */
  function askForDestination(): void {
    const detached = draft.branchMode === "detached";
    const branch = detached ? draft.baseRef : draft.branchName;
    if (branch === askedFor) {
      return;
    }
    askedFor = branch;
    if (deps.onBranchChange !== undefined) {
      outstanding = true;
      deps.onBranchChange(draft.repoId, branch);
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
    // The HOST's answer wins whenever it has given one. The locally derived
    // path is the placeholder shape only — it is what the form would guess, and
    // guessing is exactly what the spec forbids: a create names the destination
    // it will actually use, and only the host knows which candidates are free
    // (round-3 B12).
    const derived = repo.resolvedPath ?? (slug ? `${repo.pathParent}/${repo.pathPrefix}-${slug}` : "");
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

    // Asked here, before the button state below reads `outstanding` — a request
    // raised after it would leave Create enabled for one render on a path the
    // host has not resolved yet.
    askForDestination();

    // A create with no target is not offered — the button is disabled, not a
    // dialog that fails after the click.
    const named = detached ? draft.baseRef.trim().length > 0 : draft.branchName.trim().length > 0;
    // `outstanding`: the destination on screen is not yet the one the host
    // resolved for this branch, so submitting now submits a stale path.
    createBtn.disabled = Boolean(error) || !named || draft.path.trim().length === 0 || outstanding;
    shell.refreshFocusTrap();
  }

  // `change` rather than `input`: asking the host on every keystroke would be a
  // request per character. `input` still re-renders locally, so the field never
  // feels laggy — only the authoritative destination waits for the edit to settle.
  const edited = (): void => {
    syncDerived();
  };
  nameInput.addEventListener("input", syncDerived);
  nameInput.addEventListener("change", edited);
  baseInput.addEventListener("input", syncDerived);
  baseInput.addEventListener("change", edited);
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

  // A fresh answer replaces the repo's seed and re-renders. Only the path the
  // user has not typed over moves — an edited path is theirs.
  deps.bindDefaults?.((next) => {
    // Replies race the typing that produced them. An answer for a branch the
    // form has already moved past would put a destination on screen that no
    // longer matches the name beside it (round-4 B12).
    if (next.answersBranch !== undefined && next.answersBranch !== askedFor) {
      return;
    }
    const at = repos.findIndex((r) => r.repoId === next.repoId);
    if (at >= 0) {
      repos[at] = next;
    } else {
      repos.push(next);
    }
    outstanding = false;
    syncDerived();
  });

  syncAgentBox();
  syncDerived();
  shell.focusInitial(nameInput);

  return shell.dispose;
}
