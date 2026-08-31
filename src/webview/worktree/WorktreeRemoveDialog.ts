// src/webview/worktree/WorktreeRemoveDialog.ts — The two outcomes of asking to
// remove a worktree (worktree-panel-ui § 5, worktree-actions § 3.3).
//
// They are one dialog because they are one question with two answers, and keeping
// them together is what stops the refusal from drifting into a disabled button:
//
//  - CONFIRMABLE: every check is named in one list with its own outcome, and the
//    warning says what the confirmation authorizes — irrevocable deletion of
//    everything under the path, INCLUDING files written after the confirmation —
//    plus what it leaves behind (panes still running in a deleted directory, the
//    branch kept). Said for an ordinary confirmation as much as a forced one; a
//    confirmable risk that failed or could not be read is what earns the force.
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

/**
 * Which confirmation this assessment earned, decided once (design.md D2).
 *
 * Reads the CLASS the host sent rather than a list of ids, which is why it lands
 * on the right side for a check whose class is computed host-side —
 * `externalAgents` is a refusal or a confirmable risk depending on what was found
 * — without this file knowing that rule exists. A safety rule implemented in two
 * places is one that will disagree with itself (worktree-removal.md § 2.2).
 */
export function confirmationFor(checks: readonly RemovalCheck[]): "refused" | "typed" | "ordinary" {
  if (isRefusedByChecks(checks)) {
    return "refused";
  }
  const earned = checks.some((c) => c.cls === "confirmable" && (c.outcome === "failed" || c.outcome === "unproven"));
  return earned ? "typed" : "ordinary";
}

/** `<b>7 tracked files</b> have uncommitted changes.` */
function countLine(span: HTMLElement, count: string, rest: string): void {
  const b = document.createElement("b");
  b.textContent = count;
  span.append(b, document.createTextNode(` ${rest}`));
}

/**
 * How one check is worded, per outcome.
 *
 * A table rather than a chain of `if (failed(...))`, because worktree-removal.md
 * § 2.1 asks for every check including the ones that passed, and a chain can only
 * express the failing half. It also silently owned the check inventory, which is
 * how `notApplicable` stayed invisible despite being put on the wire precisely so
 * the UI could tell it apart (design.md D1).
 */
interface Presenter {
  readonly icon: string;
  /** The failing sentence, which is where a count or a reason is named. */
  readonly failed: (check: RemovalCheck, info: WorktreeInfo, span: HTMLElement) => void;
  readonly passed: string;
  readonly unproven: string;
  readonly notApplicable: string;
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

const REPORT: Record<string, Presenter> = {
  isMain: {
    icon: ICON_WARNING,
    failed: (_c, _i, s) => s.append(document.createTextNode("This is the repository's main worktree.")),
    passed: "Not the repository's main worktree.",
    unproven: "Could not tell whether this is the main worktree.",
    notApplicable: "Does not apply to this worktree.",
  },
  busyAgents: {
    icon: ICON_WARNING,
    failed: (c, _i, s) =>
      countLine(s, `${c.count ?? 0} ${plural(c.count ?? 0, "agent", "agents")}`, "mid-turn in this worktree."),
    passed: "No agent is mid-turn in this worktree.",
    unproven: "Could not tell whether an agent is mid-turn here.",
    notApplicable: "No agent has ever run here.",
  },
  containsWorktrees: {
    icon: ICON_WARNING,
    failed: (c, _i, s) =>
      countLine(s, `${c.count ?? 0} other ${plural(c.count ?? 0, "worktree", "worktrees")}`, "live inside this one."),
    passed: "No other worktree lives inside this one.",
    unproven: "Could not tell what lives inside this one.",
    notApplicable: "Nothing can live inside this one.",
  },
  dirty: {
    icon: ICON_WARNING,
    failed: (_c, _i, s) => countLine(s, "Tracked files", "have uncommitted changes."),
    passed: "No tracked file has uncommitted changes.",
    unproven: "Could not read the working tree's status.",
    notApplicable: "There is no working tree to read.",
  },
  untracked: {
    icon: ICON_WARNING,
    failed: (c, _i, s) =>
      countLine(s, `${c.count ?? 0} untracked ${plural(c.count ?? 0, "file", "files")}`, "in the folder."),
    passed: "No untracked files in the folder.",
    unproven: "Could not count the untracked files.",
    notApplicable: "There is no folder to count.",
  },
  idlePanes: {
    icon: ICON_TERMINAL,
    failed: (c, _i, s) =>
      countLine(
        s,
        `${c.count ?? 0} idle ${plural(c.count ?? 0, "terminal", "terminals")}`,
        `in this window ${plural(c.count ?? 0, "has", "have")} it as their working directory.`,
      ),
    passed: "No terminal in this window is working in it.",
    unproven: "Could not tell which terminals are working in it.",
    notApplicable: "This window has no terminals.",
  },
  externalAgents: {
    icon: ICON_WINDOW,
    failed: (c, _i, s) =>
      countLine(
        s,
        `${c.count ?? 0} ${plural(c.count ?? 0, "session", "sessions")} in another window`,
        `${plural(c.count ?? 0, "is", "are")} rooted here.`,
      ),
    passed: "No session in another window is rooted here.",
    unproven: "Could not read the session registry.",
    notApplicable: "No session registry applies here.",
  },
  locked: {
    icon: ICON_LOCK,
    failed: (_c, info, s) => {
      const b = document.createElement("b");
      b.textContent = "locked";
      s.append(document.createTextNode("The worktree is "), b);
      s.append(document.createTextNode(info.lockReason ? ` — “${info.lockReason}”.` : "."));
    },
    passed: "The worktree is not locked.",
    unproven: "Could not tell whether the worktree is locked.",
    notApplicable: "There is no lock to override.",
  },
  ignored: {
    icon: ICON_WARNING,
    failed: (c, _i, s) =>
      countLine(
        s,
        `${c.count ?? 0} ignored ${plural(c.count ?? 0, "entry", "entries")}`,
        c.detail ?? "will be deleted with the folder.",
      ),
    passed: "No ignored content to delete.",
    unproven: "Could not measure the ignored content.",
    notApplicable: "No ignored content applies here.",
  },
  lockAged: {
    icon: ICON_LOCK,
    failed: (_c, _i, s) => s.append(document.createTextNode("The lock is recent.")),
    passed: "The lock is older than the abandonment threshold.",
    unproven: "Could not read the lock's age.",
    notApplicable: "The worktree is not locked, so it has no lock age.",
  },
  ownerGone: {
    icon: ICON_WINDOW,
    failed: (_c, _i, s) => s.append(document.createTextNode("A recorded process still owns this worktree.")),
    passed: "No recorded process owns this worktree.",
    unproven: "Could not tell whether a process owns this worktree.",
    notApplicable: "No owning process was ever recorded.",
  },
  branchMerged: {
    icon: ICON_WARNING,
    failed: (_c, _i, s) => s.append(document.createTextNode("The branch is not merged into the default branch.")),
    passed: "The branch is merged into the default branch.",
    unproven: "Could not tell whether the branch is merged.",
    notApplicable: "There is no branch to compare.",
  },
};

/**
 * A check the table does not know. Rendered rather than dropped: the host owns
 * the inventory, and a check that renders nowhere until someone edits the webview
 * is the failure D1 exists to stop.
 */
function unknownPresenter(id: string): Presenter {
  return {
    icon: ICON_WARNING,
    failed: (_c, _i, s) => s.append(document.createTextNode(`${id}: failed.`)),
    passed: `${id}: passed.`,
    unproven: `${id}: could not be evaluated.`,
    notApplicable: `${id}: does not apply.`,
  };
}

/** One line, carrying its own outcome so a reader can tell the four apart. */
function checkItem(check: RemovalCheck, info: WorktreeInfo): HTMLLIElement {
  const presenter = REPORT[check.id] ?? unknownPresenter(check.id);
  const li = document.createElement("li");
  li.dataset.check = check.id;
  li.dataset.outcome = check.outcome;
  const iconEl = document.createElement("span");
  iconEl.innerHTML = presenter.icon;
  iconEl.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  if (check.outcome === "failed") {
    presenter.failed(check, info, text);
  } else if (check.outcome === "passed") {
    text.textContent = presenter.passed;
  } else if (check.outcome === "unproven") {
    text.textContent = presenter.unproven;
  } else {
    text.textContent = presenter.notApplicable;
  }
  li.append(iconEl, text);
  return li;
}

/**
 * Every check that describes a risk, in the order the host evaluated them.
 *
 * The order is the assessment's own: it evaluates them together and in a stable
 * order, and a second ordering here is a second thing to disagree (design.md D1).
 */
export function buildBlockerList(checks: readonly RemovalCheck[], info: WorktreeInfo): HTMLElement {
  const list = document.createElement("ul");
  list.className = "wt-blockers";
  for (const check of checks) {
    if (check.cls !== "proof") {
      list.appendChild(checkItem(check, info));
    }
  }
  return list;
}

/**
 * The proofs, apart from the risks and worded as what they would unlock.
 *
 * Rendered beside the confirmable checks a proof reads as a reason the removal is
 * dangerous, which is the misreading that would make an unfetched default branch
 * look like a hazard (design.md D4).
 */
export function buildProofList(checks: readonly RemovalCheck[], info: WorktreeInfo): HTMLElement | null {
  const proofs = checks.filter((c) => c.cls === "proof");
  if (proofs.length === 0) {
    return null;
  }
  const box = document.createElement("div");
  const heading = document.createElement("p");
  heading.className = "wt-report-heading";
  heading.textContent = "Whether this worktree looks abandoned. These unlock options; they never block the removal.";
  const list = document.createElement("ul");
  list.className = "wt-blockers wt-proofs";
  for (const proof of proofs) {
    list.appendChild(checkItem(proof, info));
  }
  box.append(heading, list);
  return box;
}

/**
 * What force actually authorizes. Assembled rather than templated so each clause
 * only appears when it is true — a warning that names two terminals that do not
 * exist is the same class of lie as a state dot that is not live.
 */
/**
 * What the removal destroys and what it spares — stated for the ordinary
 * confirmation as well as the forced one (worktree-panel § A removal states what
 * it destroys and what it spares, design.md D5).
 *
 * Each clause keeps its own truth condition: a lock is overridden only where one
 * failed, panes keep running only where panes were counted, a branch is spared
 * only where there is one. The lead names the control actually mounted — a box
 * that opens "Force remove…" beside a button reading "Remove" describes an
 * action the user was never offered.
 */
function buildRemovalWarning(checks: readonly RemovalCheck[], info: WorktreeInfo): HTMLElement {
  const idlePanes = countOf(checks, "idlePanes");
  const box = document.createElement("div");
  box.className = "wt-warnbox";
  const lead = document.createElement("b");
  const action = confirmationFor(checks) === "typed" ? "Force remove" : "Remove";
  lead.textContent = `${action} deletes everything under that path, irreversibly`;
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

  shell.dialog.append(buildBlockerList(checks, info));
  const proofs = buildProofList(checks, info);
  if (proofs !== null) {
    shell.dialog.append(proofs);
  }
  shell.dialog.append(buildRemovalWarning(checks, info));
  const cancelBtn = textButton("Cancel", "plain", cancel);
  shell.actions.append(cancelBtn);
  const typed = confirmationFor(checks) === "typed";
  const confirm = textButton(typed ? "Force remove" : "Remove", "danger", () => {
    // Re-sent with the fingerprint the user was SHOWN: this authorizes the
    // blocker set they read, not a blanket one. Typing raises the bar over that
    // same set; it never widens it.
    deps.onConfirm(deps.report.fingerprint);
    shell.dispose();
  });
  if (typed) {
    // A speed bump for the cases that earned one. It replaces the round-1 W2
    // guard, which withheld the button entirely whenever a confirmable check was
    // unproven — correct while the report could not describe the gap, and wrong
    // once it names it, because it left a worktree with an unreadable status
    // permanently unremovable (design.md D3).
    const label = document.createElement("label");
    label.className = "wt-confirm-name";
    label.htmlFor = "wt-confirm-name";
    label.textContent = `Type ${branch} to confirm:`;
    const field = document.createElement("input");
    field.id = "wt-confirm-name";
    field.type = "text";
    field.autocomplete = "off";
    confirm.disabled = true;
    field.addEventListener("input", () => {
      confirm.disabled = field.value !== branch;
    });
    shell.dialog.append(label, field);
  }
  shell.actions.append(confirm);
  shell.dialog.appendChild(shell.actions);
  shell.refreshFocusTrap();
  // Focus lands on Cancel, never on the destructive button: an accidental Enter
  // on open must not be the authorization.
  shell.focusInitial(cancelBtn);
  return shell.dispose;
}
