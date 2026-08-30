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
  WorktreeProvisionOffer,
} from "./worktreeViewTypes";

/**
 * The destination, shortened for reading. Two trailing segments: one is not
 * enough to tell `…/anywhere-terminal-feat-x` in one root from the same name in
 * another, and the exact value is a focus or a hover away regardless.
 */
function segments(path: string): string[] {
  // Both separators. The host builds these with `node:path`, which produces `\\`
  // on Windows — splitting on `/` alone leaves such a path whole, so the line
  // renders unshortened and the collision note restates it in full: the two
  // things this form exists to stop doing. Same idiom the file-tree panel and
  // its data source already use, both module-private to their own files.
  return path.split(/[/\\]/).filter(Boolean);
}

function shortPath(path: string): string {
  const parts = segments(path);
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join("/")}`;
}

function lastSegment(path: string): string {
  return segments(path).at(-1) ?? path;
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
  /**
   * Receive the function that applies a fresh provisioning offer.
   *
   * Separate from `bindDefaults` on purpose. The destination is answered per
   * keystroke and the form gates Create on that answer being current;
   * provisioning is answered once and gates nothing. Routing the offer through
   * the destination's callback let it clear that gate, so Create went live on
   * the path resolved for the opening ask (.reviews/round-1.md B4).
   */
  bindProvisioning?: (apply: (repoId: string, offer: WorktreeProvisionOffer) => void) => void;
  onSubmit: (draft: WorktreeCreateDraft) => void;
  onCancel?: () => void;
}

// Re-exported from branchSlug, the one definition the host shares, so the form
// and the host cannot disagree about what a branch turns into (round-3 B12).
export { sanitizeBranchForPath };

/** Mount the create form and return its disposer. */
/**
 * One offered item, flattened out of the model.
 *
 * `verb` and `subject` are separate because only the subject comes from the
 * provider file: it is untrusted text set with `textContent`, and it is the
 * half a row is identified by. `checked` is the row's initial state, not a
 * value anything reads yet — WT-012.2 is where a checkbox first decides
 * anything.
 */
interface BringRow {
  id: string;
  verb: string;
  subject: string;
  source: string;
  checked: boolean;
  /** Linked rows only: writing through the link changes the main checkout. */
  warn?: string;
}

/**
 * The offer as one flat list, in the order the section renders.
 *
 * Flat rather than grouped by kind because § 2.4's selection is one flat list of
 * ids — a UI that sorted rows by kind would have to be undone to submit them —
 * and one row per ITEM rather than the mockup's one row per kind because the
 * spec says each row names the file that declared it, which a "Copy 2 files"
 * row cannot do once two files came from two providers.
 */
function bringRows(model: WorktreeProvisionOffer["model"]): BringRow[] {
  const rows: BringRow[] = [];
  for (const entry of model.entries) {
    rows.push({
      id: entry.id,
      verb: entry.mode === "link" ? "Link" : "Copy",
      subject: entry.path,
      source: entry.source,
      checked: true,
      ...(entry.mode === "link" ? { warn: "writes to main" } : {}),
    });
  }
  for (const port of model.ports) {
    rows.push({
      id: port.id,
      // No number: allocation is WT-012.6's, and a placeholder here would read
      // as an allocation nobody made.
      verb: "Allocate port",
      subject: port.name,
      source: port.source,
      checked: true,
    });
  }
  for (const step of model.setup) {
    rows.push({
      id: step.id,
      verb: "Run setup",
      subject: step.script,
      source: step.source,
      // OFF. A command a provider file supplied is not consent because a
      // checkbox arrived pre-ticked (worktree-provisioning.md § 7).
      checked: false,
    });
  }
  return rows;
}

/**
 * `2 copied · 1 linked · 1 port · 1 setup step` — what the section will do.
 *
 * Three states, three sentences. "Nothing configured" is a repository that
 * declares nothing; "Could not be read" is a provider file that failed. They are
 * not the same claim, and a single blank summary would make them look alike.
 */
function bringSummary(model: WorktreeProvisionOffer["model"]): string {
  const copied = model.entries.filter((e) => e.mode === "copy").length;
  const linked = model.entries.length - copied;
  const parts: string[] = [];
  if (copied > 0) {
    parts.push(`${copied} copied`);
  }
  if (linked > 0) {
    parts.push(`${linked} linked`);
  }
  if (model.ports.length > 0) {
    parts.push(`${model.ports.length} port${model.ports.length === 1 ? "" : "s"}`);
  }
  if (model.setup.length > 0) {
    parts.push(`${model.setup.length} setup step${model.setup.length === 1 ? "" : "s"}`);
  }
  if (parts.length > 0) {
    return parts.join(" \u00b7 ");
  }
  // Nothing to do. WHY there is nothing is the distinction that matters: a file
  // that failed to parse would have produced entries if it had parsed.
  return model.problems.length > 0 ? "Could not be read" : "Nothing configured";
}

/**
 * A provider file that is present and unusable, named.
 *
 * `detail` can quote arbitrary content back out of a parser, so it is set with
 * `textContent` and never interpreted. There is no "Open file" affordance: the
 * only open-a-file message this webview has resolves its path against a
 * terminal's cwd, and an inert button is worse than none.
 */
function bringProblem(problem: WorktreeProvisionOffer["model"]["problems"][number]): HTMLElement {
  const el = document.createElement("div");
  el.className = "wt-bring-problem";
  const file = document.createElement("b");
  file.className = "wt-bring-problem-file";
  file.textContent = problem.file;
  const detail = document.createElement("span");
  detail.className = "wt-bring-problem-detail";
  detail.textContent = problem.detail;
  el.append(file, detail);
  return el;
}

/**
 * One row: a checkbox, the verb and its source on the first line, the subject on
 * the second.
 *
 * Every piece of provider-file text — the subject and the source path — is set
 * with `textContent`. None of it is interpreted as markup, which is the rule the
 * whole untrusted-provider-file model rests on.
 */
function bringRow(row: BringRow, index: number): HTMLElement {
  const el = document.createElement("div");
  el.className = "wt-brow";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.className = "wt-brow-cb";
  cb.id = `wt-brow-${index}`;
  // The host's own opaque id. Never the path: a value carrying one would make
  // the webview the authority on what gets materialized (§ 4.0).
  cb.value = row.id;
  cb.checked = row.checked;
  const topId = `wt-brow-top-${index}`;
  const metaId = `wt-brow-meta-${index}`;
  // The subject is what distinguishes one row from another, and it sits outside
  // the label to keep the mockup's two-line shape — so five rows from one
  // provider announced as five identical "Copy asimov/worktree.yaml"
  // (.reviews/round-1.md W3). Both halves are named explicitly instead.
  cb.setAttribute("aria-labelledby", `${topId} ${metaId}`);
  const top = document.createElement("label");
  top.className = "wt-brow-top";
  top.id = topId;
  top.htmlFor = cb.id;
  const verb = document.createElement("b");
  verb.textContent = row.verb;
  top.appendChild(verb);
  if (row.warn !== undefined) {
    // Part of the row, not a notice: the spec makes this statement
    // unsuppressible, and anything dismissible is suppressible.
    const warn = document.createElement("span");
    warn.className = "wt-brow-warn";
    warn.textContent = row.warn;
    top.appendChild(warn);
  }
  const src = document.createElement("span");
  src.className = "wt-brow-src";
  src.textContent = row.source;
  top.appendChild(src);
  const meta = document.createElement("div");
  meta.className = "wt-brow-meta";
  meta.id = metaId;
  const code = document.createElement("code");
  code.className = "wt-brow-code";
  code.textContent = row.subject;
  meta.appendChild(code);
  el.append(cb, top, meta);
  return el;
}

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
      releaseDestTip();
      deps.onCancel?.();
    },
  });
  const cancel = (): void => {
    deps.onCancel?.();
    disposeAll();
  };
  /** Every exit goes through here — the tooltip outlives `shell.dispose` alone. */
  const disposeAll = (restoreFocus = true): void => {
    releaseDestTip();
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
  /** The shortened text, which is for reading and not for announcing. */
  const destShort = document.createElement("span");
  destShort.setAttribute("aria-hidden", "true");
  /**
   * The exact value, for assistive tech only. NOT `aria-label` on `dest`: its
   * implicit role is `generic`, which prohibits naming, so the attribute is
   * simply not exposed — the attribute stays for tests and for anything reading
   * the DOM, but this element is what actually announces the path.
   */
  const destExactText = document.createElement("span");
  destExactText.className = "wt-visually-hidden";
  dest.append(destShort, destExactText);
  const destNote = document.createElement("div");
  destNote.className = "wt-dest-note";
  destNote.hidden = true;
  destWrap.append(dest, destNote);
  shell.dialog.appendChild(destWrap);
  /** The exact path the line is currently shortening; read on every show. */
  let destExact = "";
  /**
   * Attached the first time there IS a destination, not at construction.
   * `attachTooltip` resolves its text once at attach and returns a no-op when it
   * is empty — and at construction `destExact` is "", so attaching here bound
   * nothing at all and every release path below released nothing.
   */
  let disposeDestTip: (() => void) | null = null;
  const ensureDestTip = (): void => {
    if (disposeDestTip === null && destExact !== "") {
      disposeDestTip = attachTooltip(dest, { getText: () => destExact });
    }
  };
  const releaseDestTip = (): void => {
    disposeDestTip?.();
    disposeDestTip = null;
  };

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

  // ── Bring over — what the new worktree will NOT inherit ─────────────────
  // Below the destination and above the after-create choice, because it
  // describes the worktree being made rather than what happens once it exists.
  // The section is never a gate: a repository that declares nothing, and one
  // whose provider file cannot be read, both still submit.
  const bringField = field("Bring over");
  bringField.classList.add("wt-bring");
  const bringSum = document.createElement("span");
  bringSum.className = "wt-bring-sum";
  bringField.firstChild?.appendChild(bringSum);
  const bringBox = document.createElement("div");
  bringBox.className = "wt-bring-box";
  // Not an empty list. "This repository needs nothing brought over" and "we did
  // not look" are different statements, and an empty box says neither — so the
  // empty case is the sentence, naming what the worktree will actually lack.
  const bringEmpty = document.createElement("div");
  bringEmpty.className = "wt-bring-empty";
  bringEmpty.textContent = "This worktree will have no .env and no node_modules.";
  bringField.append(bringBox, bringEmpty);
  shell.dialog.appendChild(bringField);

  /** The offer currently drawn, so an unchanged one is not redrawn. */
  let drawnOfferId: string | null = null;
  /**
   * What the user has ticked, per offer.
   *
   * Kept outside the DOM because the section is rebuilt when a new offer
   * supersedes the old one and when the repo picker moves. Nothing reads this
   * yet — WT-012.2 owns redemption — but losing a choice silently is a defect
   * whether or not anything acts on it (.reviews/round-1.md W2).
   */
  const checkedByOffer = new Map<string, Set<string>>();

  // Registered ONCE. Inside the redraw it added a handler per rebuild, each
  // closing over that redraw's own set — and item ids are offer-local, every
  // offer starting at `i1`, so a stale handler wrote another offer's selection
  // under a colliding id (.reviews/round-2.md W5). The set is resolved at event
  // time instead of captured.
  bringBox.addEventListener("change", (ev) => {
    const cb = ev.target;
    if (!(cb instanceof HTMLInputElement) || !cb.classList.contains("wt-brow-cb") || drawnOfferId === null) {
      return;
    }
    const ticked = checkedByOffer.get(drawnOfferId);
    if (cb.checked) {
      ticked?.add(cb.value);
    } else {
      ticked?.delete(cb.value);
    }
  });

  /** Redraw the section from the repo's offer. Called on every derive. */
  function syncBringOver(offer: WorktreeProvisionOffer | undefined): void {
    if (offer === undefined) {
      // No offer has arrived. Saying nothing is right here and only here: the
      // form has not been told what this repository needs, and an empty section
      // would claim it needs nothing.
      bringField.hidden = true;
      bringSum.textContent = "";
      bringBox.replaceChildren();
      drawnOfferId = null;
      return;
    }
    // `syncDerived` runs on every keystroke, and rebuilding there reset every
    // checkbox — so unticking Run setup and typing one more character silently
    // put it back (W2). The offer is the only thing this section renders, so its
    // id is the only thing that can require a redraw.
    if (drawnOfferId === offer.offerId) {
      return;
    }
    drawnOfferId = offer.offerId;
    bringField.hidden = false;
    bringSum.textContent = bringSummary(offer.model);
    let ticked = checkedByOffer.get(offer.offerId);
    if (ticked === undefined) {
      ticked = new Set(
        bringRows(offer.model)
          .filter((r) => r.checked)
          .map((r) => r.id),
      );
      checkedByOffer.set(offer.offerId, ticked);
    }
    const held = ticked;
    const rows = bringRows(offer.model).map((row) => ({ ...row, checked: held.has(row.id) }));
    // Problems sit inside the box beside the rows, not instead of them: an
    // unknown key does not discard the keys that parsed, and reporting only the
    // problem would understate what the create is about to do.
    bringBox.replaceChildren(
      ...rows.map((row, i) => bringRow(row, i)),
      ...offer.model.problems.map((problem) => bringProblem(problem)),
    );
    bringBox.hidden = bringBox.childElementCount === 0;
    // The sentence stands in only where there is genuinely nothing to list. A
    // file that failed to parse has a problem row, which is a different answer.
    bringEmpty.hidden = bringBox.childElementCount > 0;
  }

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
  const agentBox = createWorktreeAgentBox(currentRepo().agents, () => syncDerived());
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
    // The submit gate reads the revealed block, so revealing one has to re-ask
    // it. `syncDerived` does not call back here, so this does not recurse.
    syncDerived();
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

  /** The repo AND branch the last host request was made for, so edits do not
   *  re-ask — and so a repo switch is not mistaken for the same question. The
   *  request is repo-scoped; a key that is not reuses one repo's answer for
   *  another, and the destination line is what states that answer. */
  let askedFor: string | null = null;
  const askKey = (branch: string): string => `${draft.repoId}\u0000${branch}`;
  /** True while a destination request has no answer yet. Submit waits for it. */
  let outstanding = false;

  /** Ask the host for the destination this branch would take, at most once each. */
  function askForDestination(): void {
    const detached = draft.branchMode === "detached";
    const branch = detached ? draft.baseRef : draft.branchName;
    if (askKey(branch) === askedFor) {
      return;
    }
    askedFor = askKey(branch);
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
    syncBringOver(repo.provisioning);

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
      // Whoever owns the caret owns the text. Guarding the CALLERS was the
      // round-2 fix and it left the other eight unguarded by construction — the
      // answer callback arrives on the host's schedule, so it is the one that can
      // land while the user is mid-edit, and the characters they type next append
      // to a value they cannot see. The rule belongs at the write.
      if (document.activeElement !== pathInput) {
        pathInput.value = derived;
      }
    }
    pathInput.placeholder = `…/${repo.pathPrefix}-<branch>`;

    // The line states the path the SUBMISSION carries, which is the override the
    // moment there is one. Two values — the host's answer and `draft.path` — can
    // disagree the instant the display stops being the input, and a line showing
    // the host default over a submitted override is the worse of the two lies.
    const overridden = !pathIsDerived;
    const stated = overridden ? draft.path : repo.resolvedPath;
    if (stated) {
      destExact = stated;
      dest.setAttribute("aria-label", stated);
      destShort.textContent = shortPath(stated);
      destExactText.textContent = stated;
      dest.classList.remove("wt-dest--pending");
      ensureDestTip();
    } else {
      // Nothing is resolved yet, so nothing is claimed. The default SHAPE is not
      // a destination and is not shortened as though it were one.
      destExact = "";
      dest.removeAttribute("aria-label");
      destShort.textContent = `Defaults to …/${repo.pathPrefix}-<branch>`;
      destExactText.textContent = "";
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
      // No leading `…`. The host sends a directory name, so there is nothing
      // elided to mark — and when this field still carried a whole path, the
      // marker shortened none of it (worktree-create.md § 4.2).
      destNote.append(taken, document.createTextNode(" already exists"));
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
    // A revealed posture list with nothing selected is an unmade choice, not a
    // default — submitting here would launch under a posture the user never
    // picked, which is the whole point of never preselecting one.
    const postureMissing = afterChoice === "agent" && agentBox.needsPosture();
    createBtn.disabled = Boolean(error) || !named || draft.path.trim().length === 0 || outstanding || postureMissing;
    shell.refreshFocusTrap();
  }

  // `change` rather than `input`: asking the host on every keystroke would be a
  // request per character. `input` still re-renders locally, so the field never
  // feels laggy — only the authoritative destination waits for the edit to settle.
  const edited = (): void => {
    syncDerived();
  };
  nameInput.addEventListener("input", () => syncDerived());
  nameInput.addEventListener("change", edited);
  baseInput.addEventListener("input", () => syncDerived());
  baseInput.addEventListener("change", edited);
  pathInput.addEventListener("input", () => {
    // Clearing the field is not an override of "nowhere" — it is withdrawing the
    // override. One-way, the face showed a derivation that had been switched off
    // and Create was disabled with the explaining control behind the disclosure.
    pathIsDerived = pathInput.value.trim() === "";
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
    // Compared against the key the question was asked under, so an answer for the
    // right branch but the wrong repository is discarded like any other stale one.
    if (next.answersBranch !== undefined && `${next.repoId}\u0000${next.answersBranch}` !== askedFor) {
      return;
    }
    const at = repos.findIndex((r) => r.repoId === next.repoId);
    if (at >= 0) {
      // The DESTINATION is what was asked for, and the only part of the answer
      // this dialog may take. `createRepos()` stamps the panel's live agent list
      // into every answer, and the host answers per keystroke — splicing the
      // record wholesale would relabel the user's choice as they type, and
      // `A launch is submitted as the offer it was shown` says a dialog submits
      // what it was OPENED against. An earlier fix here took the whole record
      // and did exactly that; keeping the agents is what makes the refresh safe.
      const opened = repos[at];
      repos[at] = opened === undefined ? next : { ...next, agents: opened.agents };
    } else {
      repos.push(next);
    }
    outstanding = false;
    syncDerived();
  });

  // The offer's own channel. It redraws the section and touches nothing else —
  // in particular not `outstanding`, which is the destination's gate (B4).
  deps.bindProvisioning?.((repoId, offer) => {
    const at = repos.findIndex((r) => r.repoId === repoId);
    const opened = repos[at];
    if (at < 0 || opened === undefined) {
      return;
    }
    repos[at] = { ...opened, provisioning: offer };
    if (repoId === draft.repoId) {
      syncBringOver(offer);
    }
  });

  syncOpenAfter();
  shell.focusInitial(nameInput);

  return disposeAll;
}
