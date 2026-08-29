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
import { attachTooltip } from "../ui/Tooltip";
import { createWorktreeAgentBox } from "./worktreeAgentBox";
import { dialogTitle, field, keyHint, openDialogShell, selectControl, textButton } from "./worktreeDialogShell";
import type {
  WorktreeBranchMode,
  WorktreeCreateDefaults,
  WorktreeCreateDraft,
  WorktreeOpenAfter,
} from "./worktreeViewTypes";

/**
 * The destination, shortened for reading. Two trailing segments: one is not
 * enough to tell `…/anywhere-terminal-feat-x` in one root from the same name in
 * another, and the exact value is a focus or a hover away regardless.
 */
function shortPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join("/")}`;
}

function lastSegment(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

const BRANCH_MODES: readonly { id: WorktreeBranchMode; label: string }[] = [
  { id: "new", label: "New branch" },
  { id: "existing", label: "Existing" },
  { id: "detached", label: "Detached" },
];

/**
 * What the form OFFERS, which is not the wire vocabulary. Opening the folder is
 * one intent with two destinations, and listing them as two peers of "Nothing"
 * made the choice read as four ways to open something. The pair is reached
 * through a secondary control instead; no wire value becomes unreachable.
 */
type AfterChoice = "none" | "terminal" | "agent" | "folder";

const AFTER_CHOICES: readonly { value: AfterChoice; label: string }[] = [
  { value: "none", label: "Nothing" },
  { value: "terminal", label: "Open a terminal here" },
  { value: "agent", label: "Start an agent" },
  { value: "folder", label: "Open the folder" },
];

/** The two the folder choice resolves to. Adding to the workspace leads: opening
 *  a second window on a folder the user is already in is the disruptive one. */
const FOLDER_MODES: readonly { value: WorktreeOpenAfter; label: string }[] = [
  { value: "addToWorkspace", label: "Add to this workspace" },
  { value: "newWindow", label: "Open in a new window" },
];

/**
 * `agent` is offered only where something can perform it — the option is built
 * from the repo's own agent list, so a host that reported none leaves it absent
 * rather than selectable-and-refused. The folder choice is always performable.
 */
function openAfterOptions(canLaunch: boolean): { value: AfterChoice; label: string }[] {
  return AFTER_CHOICES.filter((o) => o.value !== "agent" || canLaunch);
}

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
  /** What the user picked, in the form's vocabulary. `draft.openAfter` is derived
   *  from this and `folderMode` — one wire value, never two sources for it. */
  let afterChoice: AfterChoice = "none";
  let folderMode: WorktreeOpenAfter = "addToWorkspace";

  const currentRepo = (): WorktreeCreateDefaults => repos.find((r) => r.repoId === draft.repoId) ?? first;

  const shell = openDialogShell(root, {
    label: "Create worktree",
    wide: true,
    dismissOnScrim: true,
    // Escape and the scrim dispose the shell from inside it, so the tooltip has
    // to be released here too — `disposeAll` is not on that path.
    onDismiss: () => {
      disposeDestTip();
      deps.onCancel?.();
    },
  });
  const cancel = (): void => {
    deps.onCancel?.();
    disposeAll();
  };
  /** Every exit goes through here — the tooltip outlives `shell.dispose` alone. */
  const disposeAll = (restoreFocus = true): void => {
    disposeDestTip();
    shell.dispose(restoreFocus);
  };

  shell.dialog.appendChild(dialogTitle("Create worktree", undefined, cancel));

  // ── Branch name — the lead input, with nothing above it ──────────────────
  // It is the one thing only the user can supply; everything else on this form
  // is derived, defaulted, or advanced (worktree-actions § 3.2.1).
  const nameField = field("Branch name", "wt-branch");
  const nameInput = document.createElement("input");
  nameInput.className = "wt-input";
  nameInput.id = "wt-branch";
  nameInput.type = "text";
  nameInput.placeholder = "feat/…";
  const nameError = document.createElement("span");
  nameError.className = "wt-ferror";
  nameError.hidden = true;
  nameField.append(nameInput, nameError);
  shell.dialog.appendChild(nameField);

  // ── Destination — one derived line, not a field ─────────────────────────
  // Stated once, shortened. `aria-label` and the tooltip carry the exact value,
  // so shortening costs nothing: the safety property is that the user sees where
  // the write lands before authorizing it, not that they read it in full.
  const destWrap = document.createElement("div");
  destWrap.className = "wt-dest-wrap";
  const dest = document.createElement("div");
  dest.className = "wt-dest";
  // `attachTooltip` exposes its target on focus, but does not make it focusable.
  // Without this the exact value is a mouse-only affordance.
  dest.tabIndex = 0;
  const destNote = document.createElement("div");
  destNote.className = "wt-dest-note";
  destNote.hidden = true;
  destWrap.append(dest, destNote);
  shell.dialog.appendChild(destWrap);
  /** The exact path the line is currently shortening; read on every show. */
  let destExact = "";
  const disposeDestTip = attachTooltip(dest, { getText: () => destExact });

  // ── Repository (only with more than one) ────────────────────────────────
  // Below the destination it derives, never above the lead input.
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

  // ── Branch source — inside the disclosure (built below) ─────────────────
  const modeField = field("Branch source");
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

  const baseField = field("Base ref", "wt-base", true);
  const baseInput = document.createElement("input");
  baseInput.className = "wt-input wt-input--mono";
  baseInput.id = "wt-base";
  baseInput.type = "text";
  baseInput.placeholder = "HEAD";
  baseField.appendChild(baseInput);

  // The override, which is a different thing from a statement of where the
  // worktree will go — hence its home here rather than on the form's face.
  const pathField = field("Destination override", "wt-path", true);
  const pathInput = document.createElement("input");
  pathInput.className = "wt-input wt-input--mono";
  pathInput.id = "wt-path";
  pathInput.type = "text";
  pathField.appendChild(pathInput);

  // ── After creating ──────────────────────────────────────────────────────
  const afterField = field("After creating", "wt-after");
  const afterSelect = selectControl(
    "wt-after",
    openAfterOptions(currentRepo().agents.length > 0).map((o) => ({ value: o.value, label: o.label })),
    afterChoice,
  );
  afterSelect.addEventListener("change", () => {
    afterChoice = afterSelect.value as AfterChoice;
    syncOpenAfter();
  });
  afterField.appendChild(afterSelect);

  // The secondary control on the folder choice, revealed by it the same way the
  // agent block is revealed by the agent choice.
  const folderField = field("Where", "wt-folder-mode");
  folderField.classList.add("wt-folder-mode");
  const folderSelect = selectControl("wt-folder-mode", [...FOLDER_MODES], folderMode);
  folderSelect.addEventListener("change", () => {
    folderMode = folderSelect.value as WorktreeOpenAfter;
    syncOpenAfter();
  });
  folderField.appendChild(folderSelect);
  folderField.hidden = true;
  shell.dialog.append(afterField, folderField);

  // ── Agent box — shown only for `openAfter: "agent"` ─────────────────────
  // The block itself is shared with the standalone launch dialog, so create-then-
  // launch and launch-here collect the same thing rather than two things that
  // happen to look alike (design.md D7).
  const agentBox = createWorktreeAgentBox(currentRepo().agents);
  agentBox.setVisible(false);
  shell.dialog.appendChild(agentBox.element);

  // ── Advanced — collapsed, and out of the focus order while it is ────────
  // The same reveal idiom the agent block uses: a toggle carrying `aria-expanded`
  // over a region carrying `hidden`. `openDialogShell`'s focus trap already
  // filters on `[hidden]`, so nothing inside reaches Tab until it opens — which a
  // native `<details>` would not have given us without widening that filter.
  const advanced = document.createElement("div");
  advanced.className = "wt-advanced";
  const advToggle = document.createElement("button");
  advToggle.type = "button";
  advToggle.className = "wt-advanced-toggle";
  advToggle.id = "wt-advanced-toggle";
  advToggle.setAttribute("aria-expanded", "false");
  advToggle.setAttribute("aria-controls", "wt-advanced-body");
  advToggle.textContent = "Advanced";
  const advBody = document.createElement("div");
  advBody.className = "wt-advanced-body";
  advBody.id = "wt-advanced-body";
  advBody.hidden = true;
  advBody.append(modeField, baseField, pathField);
  advToggle.addEventListener("click", () => {
    advBody.hidden = !advBody.hidden;
    advToggle.setAttribute("aria-expanded", advBody.hidden ? "false" : "true");
    shell.refreshFocusTrap();
  });
  advanced.append(advToggle, advBody);
  shell.dialog.appendChild(advanced);

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
    const launch = afterChoice === "agent" ? agentBox.read() : {};
    deps.onSubmit({ ...draft, ...launch });
    disposeAll();
  }

  /**
   * The one place the offered choice becomes a wire value, and the one place the
   * two reveals it drives are applied. Two different questions, and the agent box
   * keeps them apart: "this create is not launching" is ours, "there is nothing
   * to launch" is its own.
   */
  function syncOpenAfter(): void {
    draft.openAfter = afterChoice === "folder" ? folderMode : afterChoice;
    agentBox.setVisible(afterChoice === "agent");
    folderField.hidden = afterChoice !== "folder";
    shell.refreshFocusTrap();
  }

  /** A repo switch can withdraw the launch — the mode goes with it, not just the box. */
  function rebuildAfterOptions(): void {
    const offered = openAfterOptions(currentRepo().agents.length > 0);
    // Only a choice the rebuild actually withdrew is reset. The folder choice is
    // always offered, so a repo switch that drops the agent one must leave it —
    // and its secondary selection — exactly where the user put them.
    if (!offered.some((o) => o.value === afterChoice)) {
      afterChoice = "none";
    }
    afterSelect.replaceChildren(
      ...offered.map((o) => {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        return opt;
      }),
    );
    afterSelect.value = afterChoice;
    syncOpenAfter();
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

    // The line states the path the SUBMISSION carries, which is the override the
    // moment there is one. Two values — the host's answer and `draft.path` — can
    // disagree the instant the display stops being the input, and a line showing
    // the host default over a submitted override is the worse of the two lies.
    const overridden = !pathIsDerived;
    const stated = overridden ? draft.path : repo.resolvedPath;
    dest.replaceChildren();
    if (stated) {
      destExact = stated;
      dest.setAttribute("aria-label", stated);
      dest.textContent = shortPath(stated);
      dest.classList.remove("wt-dest--pending");
    } else {
      // Nothing is resolved yet, so nothing is claimed. The default SHAPE is not
      // a destination and is not shortened as though it were one.
      destExact = "";
      dest.removeAttribute("aria-label");
      dest.textContent = `Defaults to …/${repo.pathPrefix}-<branch>`;
      dest.classList.add("wt-dest--pending");
    }

    // One line, and it names the RESULT. The destination above already carries
    // the path, so repeating it in full here is the second statement the form
    // exists to stop making. An override retires the note with the derived path
    // it described.
    destNote.hidden = true;
    destNote.replaceChildren();
    if (repo.collidedWith && !overridden) {
      destNote.hidden = false;
      const taken = document.createElement("b");
      taken.textContent = repo.collidedWith;
      destNote.append(document.createTextNode("…"), taken, document.createTextNode(" already exists"));
      if (repo.resolvedPath) {
        const final = document.createElement("b");
        final.textContent = lastSegment(repo.resolvedPath);
        destNote.append(document.createTextNode(", so this is created as "), final, document.createTextNode("."));
      } else {
        destNote.append(document.createTextNode("; a free suffix is chosen when the worktree is created."));
      }
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

  syncOpenAfter();
  syncDerived();
  shell.focusInitial(nameInput);

  return disposeAll;
}
