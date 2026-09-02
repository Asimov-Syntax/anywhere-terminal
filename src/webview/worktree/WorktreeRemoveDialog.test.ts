// @vitest-environment jsdom

// The two answers to "remove this worktree?", against docs/ui/worktree.html § 11
// (one confirmation naming every blocker) and § 12 (refused outright).

import { afterEach, describe, expect, it } from "vitest";
import type { BranchDeleteRequest } from "../../types/messages";
import { isRemoveRefused, openWorktreeRemoveDialog } from "./WorktreeRemoveDialog";
import { agentRow, confirmableBlocker, refusedBlocker, worktree } from "./worktreeFixtures";
import { CONFIRMATION_CEILING_MS } from "./worktreeFormat";
import type {
  PresenceDegradation,
  RemovalCheck,
  WorktreeAgentRow,
  WorktreeInfo,
  WorktreeRemoveReport,
} from "./worktreeViewTypes";

/**
 * A report with named checks overridden. Keeps each case reading as the one
 * thing it varies — `busy(0)`, `main(true)` — rather than as a whole check list
 * respelled per test.
 */
function withChecks(
  base: WorktreeRemoveReport,
  over: Partial<Record<string, { outcome: RemovalCheck["outcome"]; count?: number }>>,
  contained: WorktreeRemoveReport["contained"] = base.contained,
): WorktreeRemoveReport {
  return {
    ...base,
    contained,
    checks: base.checks.map((c) => {
      const patch = over[c.id];
      return patch === undefined
        ? c
        : { ...c, outcome: patch.outcome, ...(patch.count === undefined ? {} : { count: patch.count }) };
    }),
  };
}

const passed = { outcome: "passed" as const, count: 0 };
const failedWith = (count?: number) => ({ outcome: "failed" as const, ...(count === undefined ? {} : { count }) });

const SPIKE: WorktreeInfo = worktree({
  id: "/Volumes/ext/anywhere-terminal-wt/spike-hooks",
  branch: "spike/hooks",
  head: "e".repeat(40),
  locked: true,
  lockReason: "spike, keep until Friday",
});

afterEach(() => {
  document.body.replaceChildren();
});

function open(
  report: WorktreeRemoveReport,
  over: {
    info?: WorktreeInfo;
    agentRows?: WorktreeAgentRow[];
    degradedSources?: PresenceDegradation[];
    now?: number;
  } = {},
) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const confirmed: (string | null)[] = [];
  const deleteBranchRequests: (BranchDeleteRequest | undefined)[] = [];
  const shown: string[] = [];
  openWorktreeRemoveDialog(host, {
    info: over.info ?? SPIKE,
    report,
    agentRows: over.agentRows,
    degradedSources: over.degradedSources ?? [],
    now: over.now,
    onConfirm: (fingerprint, deleteBranch) => {
      confirmed.push(fingerprint);
      deleteBranchRequests.push(deleteBranch);
    },
    onShowAgent: (row) => shown.push(row.rowId),
  });
  return { host, confirmed, deleteBranchRequests, shown };
}

const NESTED = [{ worktreeId: "/repo-wt/spike/inner", displayPath: "/repo-wt/spike/inner" }];

/** A worktree nothing is wrong with, so the report has only passing checks to show. */
const CLEAN: WorktreeInfo = worktree({
  id: "/Volumes/ext/anywhere-terminal-wt/quiet",
  branch: "quiet",
  head: "f".repeat(40),
});

/**
 * Every check the host evaluates, including the three proofs — the fixtures
 * predate them and carry only the checks their own case needed.
 */
const FULL_REPORT: WorktreeRemoveReport = {
  fingerprint: "sha256:full-v1",
  checks: [
    { id: "isMain", cls: "refusal", outcome: "passed" },
    { id: "busyAgents", cls: "refusal", outcome: "passed", count: 0 },
    { id: "containsWorktrees", cls: "refusal", outcome: "passed", count: 0 },
    { id: "dirty", cls: "confirmable", outcome: "passed", count: 0 },
    { id: "untracked", cls: "confirmable", outcome: "passed", count: 0 },
    { id: "idlePanes", cls: "confirmable", outcome: "passed", count: 0 },
    { id: "externalAgents", cls: "confirmable", outcome: "passed", count: 0 },
    { id: "locked", cls: "confirmable", outcome: "notApplicable" },
    { id: "ignored", cls: "confirmable", outcome: "passed", count: 0 },
    { id: "lockAged", cls: "proof", outcome: "notApplicable" },
    { id: "ownerGone", cls: "proof", outcome: "unproven" },
    { id: "branchMerged", cls: "proof", outcome: "passed" },
  ],
  contained: [],
};

const reported = (host: HTMLElement): string[] =>
  [...host.querySelectorAll("[data-check]")].map((e) => e.getAttribute("data-check") ?? "");

const outcomeOf = (host: HTMLElement, id: string): string | null =>
  host.querySelector(`[data-check="${id}"]`)?.getAttribute("data-outcome") ?? null;

/** What the user actually reads. The attribute is for styling; this is the claim. */
const saidOf = (host: HTMLElement, id: string): string => host.querySelector(`[data-check="${id}"]`)?.textContent ?? "";

describe("the removal report", () => {
  it("[1_1] lists every check the assessment ran, in the order the host sent them", () => {
    // A report that lists only problems gives the user no way to judge how much
    // was actually looked at (worktree-removal.md § 2.1).
    const { host } = open(FULL_REPORT, { info: CLEAN });

    expect(reported(host)).toEqual(FULL_REPORT.checks.map((c) => c.id));
  });

  it("[1_1] renders a check that could not be evaluated as neither passed nor failed", () => {
    const { host } = open(FULL_REPORT, { info: CLEAN });

    expect(outcomeOf(host, "ownerGone")).toBe("unproven");
    expect(outcomeOf(host, "dirty")).toBe("passed");
    // The SENTENCE, not only the attribute: the attribute styles the line, and a
    // user who reads "no process owns this" where nothing could be read has been
    // told a check ran that did not.
    expect(saidOf(host, "ownerGone")).toContain("Could not tell");
    expect(saidOf(host, "ownerGone")).not.toBe(saidOf(host, "branchMerged"));
  });

  it("[1_1] renders a check that did not apply as neither passed nor failed", () => {
    // `notApplicable` is on the wire for exactly this: an unlocked worktree has
    // no lock age, and rendering that as passed claims a check ran that never
    // applied (worktree-removal.md § 2.2).
    const { host } = open(FULL_REPORT, { info: CLEAN });

    expect(outcomeOf(host, "locked")).toBe("notApplicable");
    expect(outcomeOf(host, "lockAged")).toBe("notApplicable");
    // Distinct from the passing sentence, and saying why the question did not
    // arise rather than answering it.
    expect(saidOf(host, "lockAged")).toContain("not locked, so it has no lock age");
    expect(saidOf(host, "locked")).toContain("no lock to override");
    expect(saidOf(host, "locked")).not.toContain("The worktree is not locked.");
  });

  it("[1_1] keeps the proofs in their own group, apart from the risks", () => {
    // A proof describes no risk. Rendered beside the confirmable checks it reads
    // as a reason the removal is dangerous (worktree-removal.md § 2.2, § 4).
    const { host } = open(FULL_REPORT, { info: CLEAN });

    const proofs = host.querySelector(".wt-proofs");
    expect(proofs, "the proofs have no group of their own").not.toBeNull();
    expect([...(proofs?.querySelectorAll("[data-check]") ?? [])].map((e) => e.getAttribute("data-check"))).toEqual([
      "lockAged",
      "ownerGone",
      "branchMerged",
    ]);
    const risks = host.querySelector(".wt-blockers");
    expect(risks?.querySelector('[data-check="branchMerged"]'), "a proof rendered among the risks").toBeNull();
  });
});

describe("isRemoveRefused", () => {
  it("refuses on a busy agent, the main worktree, or a nested worktree, and nothing else", () => {
    expect(isRemoveRefused(refusedBlocker.checks)).toBe(true);
    expect(isRemoveRefused(withChecks(refusedBlocker, { busyAgents: passed, isMain: failedWith() }).checks)).toBe(true);
    // D4: git's `remove --force` would delete the child's files and leave a
    // prunable child record behind, and no confirmation about THIS worktree can
    // honestly describe losing that one.
    expect(
      isRemoveRefused(
        withChecks(refusedBlocker, { busyAgents: passed, containsWorktrees: failedWith(NESTED.length) }, NESTED).checks,
      ),
    ).toBe(true);
    expect(isRemoveRefused(confirmableBlocker.checks)).toBe(false);
  });
});

describe("remove worktree — refused for containment (design.md D4)", () => {
  function openNested(children = NESTED) {
    return open(
      withChecks(refusedBlocker, { busyAgents: passed, containsWorktrees: failedWith(children.length) }, children),
    );
  }

  it("offers no confirm button", () => {
    const { host } = openNested();
    expect(host.querySelector(".wt-dialog-confirm")).toBeNull();
  });

  it("does NOT explain the refusal as a busy agent", () => {
    // The refusal box used to be a two-branch if/else, so a third reason fell
    // into the agent branch and told the user to stop an agent that is not
    // running. That is worse than saying nothing.
    const { host } = openNested();
    const text = host.querySelector(".wt-refusebox")?.textContent ?? "";
    expect(text).not.toMatch(/agent/i);
  });

  it("names the worktree that would be destroyed with it", () => {
    const { host } = openNested();
    expect(host.querySelector(".wt-refusebox")?.textContent).toContain("/repo-wt/spike/inner");
  });

  it("names every nested worktree, not only the first", () => {
    const { host } = openNested([
      { worktreeId: "/repo-wt/spike/a", displayPath: "/repo-wt/spike/a" },
      { worktreeId: "/repo-wt/spike/b", displayPath: "/repo-wt/spike/b" },
    ]);
    const text = host.querySelector(".wt-refusebox")?.textContent ?? "";
    expect(text).toContain("/repo-wt/spike/a");
    expect(text).toContain("/repo-wt/spike/b");
  });

  it("still explains the main worktree as the main worktree when both apply", () => {
    // isMain is the more fundamental refusal and stays the headline.
    const { host } = open(
      withChecks(
        refusedBlocker,
        { busyAgents: passed, isMain: failedWith(), containsWorktrees: failedWith(NESTED.length) },
        NESTED,
      ),
    );
    expect(host.querySelector(".wt-refusebox")?.textContent).toContain("main worktree");
  });
});

describe("remove worktree — confirmation (§ 11)", () => {
  it("names the path and every blocker in one list", () => {
    const { host } = open(confirmableBlocker);
    expect(host.querySelector(".wt-dialog-path")?.textContent).toBe(SPIKE.id);
    const items = Array.from(host.querySelectorAll(".wt-blockers li")).map((li) => li.textContent);
    expect(items.some((t) => t?.includes("uncommitted changes"))).toBe(true);
    expect(items.some((t) => t?.includes("3 untracked files"))).toBe(true);
    // Not "2 idle terminals" — the producer counts every non-exited pane (W2).
    expect(items.some((t) => t?.includes("2 terminals"))).toBe(true);
    expect(items.some((t) => t?.includes("1 session in another window"))).toBe(true);
    expect(items.some((t) => t?.includes("spike, keep until Friday"))).toBe(true);
  });

  it("stays at the reading measure — it is a question, not a form", () => {
    const { host } = open(confirmableBlocker);
    expect(host.querySelector(".wt-dialog")?.classList.contains("wt-dialog--wide")).toBe(false);
  });

  it("says what force authorizes, including files written after the confirmation", () => {
    const { host } = open(confirmableBlocker);
    const warn = host.querySelector(".wt-warnbox")?.textContent ?? "";
    expect(warn).toContain("irreversibly");
    expect(warn).toContain("including files written after you confirm");
    expect(warn).toContain("The lock is overridden");
    expect(warn).toContain("running in a deleted directory");
    // Branch deletion is not part of removal, and the confirmation says so.
    expect(warn).toContain("The branch spike/hooks is kept.");
  });

  it("omits a clause for a blocker that is not present", () => {
    const { host } = open(withChecks(confirmableBlocker, { locked: passed, idlePanes: passed }));
    const warn = host.querySelector(".wt-warnbox")?.textContent ?? "";
    expect(warn).not.toContain("The lock is overridden");
    expect(warn).not.toContain("deleted directory");
    // The list now carries every check, so what "not present" means here is the
    // OUTCOME, not the absence of a line (§ 2.1).
    expect(host.querySelectorAll('.wt-blockers li[data-outcome="failed"]')).toHaveLength(3);
    expect(outcomeOf(host, "locked")).toBe("passed");
  });

  it("opens with focus on Cancel, never on the destructive button", () => {
    // A modal that opens with focus outside it is silent to a screen reader, and
    // landing on Force remove would make a stray Enter the authorization.
    const { host } = open(confirmableBlocker);
    const dialog = host.querySelector(".wt-dialog");
    expect(dialog?.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.textContent).toBe("Cancel");
  });

  it("re-sends the fingerprint the user was shown", () => {
    const { host, confirmed } = open(confirmableBlocker);
    // A failing confirmable risk now earns the typed confirmation (1_2), so the
    // name is entered before the button will answer at all.
    const field = host.querySelector<HTMLInputElement>("#wt-confirm-name");
    if (field !== null) {
      field.value = SPIKE.branch ?? "";
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
    host.querySelector<HTMLButtonElement>(".wt-btn--danger")?.click();
    expect(confirmed).toEqual([confirmableBlocker.fingerprint]);
  });

  it("is not dismissed by a stray click on the scrim", () => {
    const { host, confirmed } = open(confirmableBlocker);
    host.querySelector<HTMLElement>(".wt-scrim")?.click();
    expect(host.querySelector(".wt-dialog")).not.toBeNull();
    expect(confirmed).toHaveLength(0);
  });
});

describe("remove worktree — refused (§ 12)", () => {
  const busy = agentRow({
    rowId: "busy",
    agent: "claude",
    activity: "waiting",
    title: "INTEGRATE-WORKTREE",
    preview: "Approve the git worktree add?",
  });

  it("offers no confirm button at all, not a disabled one", () => {
    const { host } = open(refusedBlocker, { agentRows: [busy] });
    expect(host.querySelector(".wt-refusebox")).not.toBeNull();
    expect(host.querySelector(".wt-btn--danger")).toBeNull();
    expect(host.querySelectorAll(".wt-btn:disabled")).toHaveLength(0);
  });

  it("[1_4] lists the checks the assessment reported, as every other report does", () => {
    // Round-1 B2: the refusal branch returned before the lists were appended, so
    // the one dialog a user cannot argue with was also the one that never said
    // how much had been looked at. The requirement names no dialog.
    const { host } = open(refusedBlocker, { agentRows: [busy] });

    expect(reported(host)).toEqual(refusedBlocker.checks.map((c) => c.id));
    expect(outcomeOf(host, "busyAgents")).toBe("failed");
    expect(outcomeOf(host, "isMain")).toBe("passed");
    // Still no control: listing what was checked is not offering a way past it.
    expect(host.querySelector(".wt-btn--danger")).toBeNull();
    expect(host.querySelector("#wt-confirm-name")).toBeNull();
  });

  it("[1_4] says what the counted terminals share, not that they are idle", () => {
    // Round-1 W2: the producer counts every pane whose working directory is the
    // worktree and is not exited — running and waiting ones included — so
    // "idle terminals" understates active use right before deleting their cwd.
    const { host } = open(withChecks(confirmableBlocker, { idlePanes: failedWith(2) }));

    expect(saidOf(host, "idlePanes")).not.toMatch(/idle/i);
    expect(saidOf(host, "idlePanes")).toMatch(/working directory/i);
    expect(saidOf(host, "idlePanes")).toContain("2 terminals");
  });

  const refusebox = (host: HTMLElement): string => host.querySelector(".wt-refusebox")?.textContent ?? "";
  const unprovenOutcome = { outcome: "unproven" as const };

  it("[1_6] does not turn an unreadable check into a past-tense claim", () => {
    // Round-2 W3. 1_5 routed an unproven refusal check into this branch, whose
    // chain tested only `failed`, so every unproven refusal fell through to the
    // local-agent copy — "An agent WAS mid-turn" from a check that read nothing,
    // one line above the list saying it could not tell.
    const { host } = open(withChecks(refusedBlocker, { busyAgents: unprovenOutcome }));

    expect(refusebox(host), "an unproven check was reported as a fact").not.toMatch(/was mid-turn/i);
    expect(refusebox(host)).toMatch(/could not/i);
    expect(host.querySelector("button.wt-btn--danger")).toBeNull();
  });

  it("[1_6] explains a session in another window as one, not as a local agent", () => {
    // `externalAgents` is refusal-class in a refused assessment, and "stop it
    // first" points at a row this window does not have.
    const { host } = open({
      ...withChecks(refusedBlocker, { busyAgents: passed }),
      checks: [
        ...withChecks(refusedBlocker, { busyAgents: passed }).checks,
        { id: "externalAgents", cls: "refusal", outcome: "failed", count: 1 },
      ],
    });

    expect(refusebox(host)).toMatch(/another window/i);
    expect(refusebox(host), "a refusal from another window told the user to stop a local agent").not.toMatch(
      /stop it first/i,
    );
  });

  it("[1_6] keeps the reason-specific copy for a refusal that actually failed", () => {
    // The negative: this task must not cost the reachable refusals their own
    // explanations (worktree-panel § A refusal names the reason it actually has).
    const { host } = open(refusedBlocker, { agentRows: [busy] });

    expect(refusebox(host)).toMatch(/mid-turn/i);
    expect(refusebox(host)).toMatch(/stop it first/i);
  });

  it("[1_6] picks the refusing check by class, not merely the first bad outcome", () => {
    // A confirmable check earlier in the list must not be mistaken for the one
    // that refused: today's producers happen to order the refusal checks first,
    // so without this the class test could be dropped and nothing would notice.
    const { host } = open({
      ...refusedBlocker,
      checks: [
        { id: "dirty", cls: "confirmable", outcome: "failed", count: 4 },
        { id: "isMain", cls: "refusal", outcome: "passed" },
        { id: "busyAgents", cls: "refusal", outcome: "unproven" },
      ],
    });

    // The refusal is explained by `busyAgents`, the check that refused — not by
    // the failing `dirty`, which is a risk a confirmation would have covered.
    expect(refusebox(host)).toMatch(/could not tell whether an agent/i);
    expect(refusebox(host), "a confirmable risk was presented as the refusal reason").not.toMatch(/uncommitted/i);
  });

  it("[1_7] explains the FIRST refusing check when two of them failed at once", () => {
    // Round-3 W3. 1_6 picked the refusing check correctly but left the failed
    // branches dispatching on `failed(...)`, so a busy agent plus a nested
    // worktree fell past the agent copy into the containment one — naming a
    // reason that is true but is not the one the user must act on first.
    const { host } = open(
      withChecks(refusedBlocker, { busyAgents: failedWith(1), containsWorktrees: failedWith(NESTED.length) }, NESTED),
      { agentRows: [busy] },
    );

    expect(refusebox(host), "the containment copy displaced the agent that refused first").toMatch(/mid-turn/i);
    expect(refusebox(host)).not.toMatch(/live inside this one/i);
  });

  it("[1_7] takes the host's order as the priority, even ahead of isMain", () => {
    // The host's order IS the priority — "the first refusal-class check in host
    // order" is the rule, not "isMain wins". Today isMain happens to be listed
    // first, so without a report that says otherwise this branch could go back to
    // testing `failed(isMain)` and no test would notice.
    const { host } = open({
      ...refusedBlocker,
      checks: [
        { id: "busyAgents", cls: "refusal", outcome: "failed", count: 1 },
        { id: "isMain", cls: "refusal", outcome: "failed" },
      ],
    });

    expect(refusebox(host), "a later check displaced the one the host listed first").toMatch(/mid-turn/i);
    expect(refusebox(host)).not.toMatch(/main worktree/i);
  });

  it("[1_6] does not explain an unproven containment check as a busy agent", () => {
    const { host } = open(withChecks(refusedBlocker, { busyAgents: passed, containsWorktrees: unprovenOutcome }));

    expect(refusebox(host)).not.toMatch(/agent/i);
    expect(refusebox(host)).toMatch(/inside this one/i);
  });

  it("also lands focus inside the refusal", () => {
    const { host } = open(refusedBlocker, { agentRows: [busy] });
    expect(host.querySelector(".wt-dialog")?.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.textContent).toBe("Close");
  });

  it("names the agent that blocks it rather than just a count", () => {
    const { host, shown } = open(refusedBlocker, { agentRows: [busy] });
    expect(host.querySelector(".wt-arow .wt-atitle")?.textContent).toContain("INTEGRATE-WORKTREE");
    host.querySelector<HTMLButtonElement>(".wt-btn--primary")?.click();
    expect(shown).toEqual(["busy"]);
  });

  // The dialog borrows `renderAgentRow`, so the row's second line arrives here too.
  it("carries the row's preview line into the dialog unchanged", () => {
    const { host } = open(refusedBlocker, { agentRows: [{ ...busy, preview: "- Approve the git worktree add?" }] });
    expect(host.querySelector(".wt-arow .wt-apreview")?.textContent).toBe("- Approve the git worktree add?");
    expect(host.querySelector(".wt-arow .wt-model")).toBeNull();
  });

  it("stops asserting a turn is in progress when every readable row is unconfirmed", () => {
    const NOW = 1_700_000_000_000;
    const stale = agentRow({
      rowId: "stale",
      agent: "claude",
      activity: "running",
      activitySource: "output",
      title: "worker",
      stateStartedAt: NOW - CONFIRMATION_CEILING_MS,
    });
    const { host } = open(refusedBlocker, { agentRows: [stale], now: NOW });
    const copy = host.querySelector(".wt-refusebox")?.textContent ?? "";
    // The refusal STAYS — warning about a possibly-working agent is the safe side
    // of deleting a folder. What must not stay is the certainty: this same dialog
    // draws that row with the `~` hint saying a busy terminal is not proof of a
    // turn in progress, and the lead sentence sat directly above it saying it was.
    expect(host.querySelector(".wt-btn--danger")).toBeNull();
    expect(copy).toContain("may be mid-turn");
    expect(copy).toContain("outlived what can confirm it");
    expect(copy).not.toContain("An agent is mid-turn");
  });

  it("keeps naming the unreadable rows while softening the certainty", () => {
    const NOW = 1_700_000_000_000;
    const stale = agentRow({
      rowId: "stale",
      agent: "claude",
      activity: "running",
      activitySource: "output",
      title: "worker",
      stateStartedAt: NOW - CONFIRMATION_CEILING_MS,
    });
    const dark = agentRow({ rowId: "dark", agent: "codex", activity: "running", activitySource: "hook" });
    const { host } = open(refusedBlocker, {
      agentRows: [stale, dark],
      degradedSources: [{ source: "hook", reason: "endpoint down", since: NOW }],
      now: NOW,
    });
    const copy = host.querySelector(".wt-refusebox")?.textContent ?? "";
    // Softening the claim must not silently drop what the previous chain said.
    expect(copy).toContain("may be mid-turn");
    expect(copy).toContain("outlived what can confirm it");
    expect(copy).toContain("cannot be read at all");
  });

  it("names the unconfirmed part of a list it can otherwise vouch for", () => {
    const NOW = 1_700_000_000_000;
    const live = agentRow({
      rowId: "live",
      agent: "claude",
      activity: "running",
      activitySource: "hook",
      title: "reported",
    });
    const stale = agentRow({
      rowId: "stale",
      agent: "codex",
      activity: "running",
      activitySource: "output",
      title: "worker",
      stateStartedAt: NOW - CONFIRMATION_CEILING_MS,
    });
    const { host } = open(refusedBlocker, { agentRows: [live, stale], now: NOW });
    const copy = host.querySelector(".wt-refusebox")?.textContent ?? "";
    // The vouched-for row earns the flat claim, and the stale one still has to be
    // accounted for: a sentence that mentions only the strongest evidence drops
    // the row whose glyph is drawn qualified two lines below it.
    expect(copy).toContain("An agent is mid-turn in this worktree");
    expect(copy).toContain("outlived what can confirm it");
  });

  it("shows only the rows that are actually mid-turn", () => {
    const idle = agentRow({ rowId: "idle", agent: "codex", activity: "idle", title: "zsh" });
    const { host } = open(refusedBlocker, { agentRows: [busy, idle] });
    expect(host.querySelectorAll(".wt-arow")).toHaveLength(1);
  });

  it("explains the main worktree separately, since no confirmation overrides it", () => {
    const main = worktree({ id: "/repo", kind: "main", branch: "main" });
    const { host } = open(withChecks(refusedBlocker, { busyAgents: passed, isMain: failedWith() }), { info: main });
    expect(host.querySelector(".wt-refusebox")?.textContent).toContain("main worktree");
    expect(host.querySelector(".wt-btn--danger")).toBeNull();
  });
});

describe("the confirmation states what it destroys and what it spares", () => {
  it("names all three consequences in one reading, not one at a time", () => {
    // An invariant-level check: each clause is asserted elsewhere, but a user
    // reads the box once. Losing any one of them turns the confirmation into a
    // partial account of what force does.
    const { host } = open(withChecks(confirmableBlocker, { idlePanes: failedWith(2) }));
    const text = host.querySelector(".wt-warnbox")?.textContent ?? "";
    expect(text).toMatch(/irreversibl/i);
    expect(text).toMatch(/branch/i);
    expect(text).toMatch(/is kept/i);
    expect(text).toMatch(/running in a deleted directory/i);
  });

  it("does not claim the losses were reviewed, because they can still change", () => {
    const { host } = open(confirmableBlocker);
    const text = host.querySelector(".wt-warnbox")?.textContent ?? "";
    expect(text).toMatch(/files written after you confirm/i);
  });

  it("[1_3] states the same consequences for an ordinary confirmation", () => {
    // The requirement is about a REMOVAL confirmation, not a forced one
    // (worktree-panel § A removal states what it destroys and what it spares).
    // A user removing a clean worktree is owed the same account of what goes and
    // what stays.
    const { host } = open(FULL_REPORT, { info: CLEAN });
    const text = host.querySelector(".wt-warnbox")?.textContent ?? "";
    expect(text).toMatch(/irreversibl/i);
    expect(text).toContain("The branch quiet is kept.");
  });

  it("[1_3] does not name a force the user was never offered", () => {
    // The box led with "Force remove deletes everything" whatever control was
    // mounted, so an ordinary confirmation described an action whose button is
    // not on screen (design.md D5).
    const { host } = open(FULL_REPORT, { info: CLEAN });
    const text = host.querySelector(".wt-warnbox")?.textContent ?? "";

    expect(
      host.querySelector("button.wt-btn--danger")?.textContent,
      "this case is meant to be the ordinary control",
    ).toBe("Remove");
    expect(text, "the ordinary confirmation described a force").not.toMatch(/force/i);
  });

  it("[1_3] still names the force where one is actually offered", () => {
    const { host } = open(confirmableBlocker);

    expect(host.querySelector("button.wt-btn--danger")?.textContent).toBe("Force remove");
    expect(host.querySelector(".wt-warnbox")?.textContent ?? "").toMatch(/force remove/i);
  });

  it("[1_3] claims nothing about a branch a detached worktree does not have", () => {
    // Each clause keeps its own truth condition: no branch, no promise to spare
    // one (design.md D5).
    const detached = worktree({
      id: "/Volumes/ext/anywhere-terminal-wt/detached",
      head: "a".repeat(40),
      detached: true,
    });
    const { host } = open(FULL_REPORT, { info: detached });
    const text = host.querySelector(".wt-warnbox")?.textContent ?? "";

    expect(text).toMatch(/irreversibl/i);
    expect(text, "a worktree with no branch was told its branch is kept").not.toMatch(/is kept/i);
  });
});

describe("a check nobody could evaluate (round-1 W2)", () => {
  const unproven = { outcome: "unproven" as const };

  // `textButton` renders `wt-btn wt-btn--danger`. Round-2 W3: the first spelling
  // of this helper queried `.danger`, which matches nothing, so its assertions
  // held whether or not the button was there.
  function danger(host: HTMLElement): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>("button.wt-btn--danger");
  }

  it("names every check it could not read", () => {
    // The report now NAMES the checks it could not evaluate, which is what the
    // withholding was standing in for. The control this earns is 1_2's; what is
    // asserted here is that the gap is described rather than silent.
    const { host } = open(
      withChecks(confirmableBlocker, {
        dirty: unproven,
        untracked: unproven,
        idlePanes: unproven,
        externalAgents: unproven,
        locked: unproven,
      }),
    );

    expect(host.querySelectorAll('.wt-blockers li[data-outcome="unproven"]').length).toBe(5);
  });

  it("[1_5] refuses when a refusal-class check could not be read", () => {
    // Fail-closed is per CLASS (design.md D2, DESIGN.md D43): an agent that
    // cannot be ruled out is treated as live, so no confirmation is offered —
    // whereas an unreadable CONFIRMABLE check is gated rather than refused, which
    // is the case immediately below.
    const { host } = open(withChecks(confirmableBlocker, { busyAgents: unproven }));

    expect(host.querySelector(".wt-refusebox"), "an unreadable refusal check offered a confirmation").not.toBeNull();
    expect(danger(host)).toBeNull();
    expect(host.querySelector("#wt-confirm-name")).toBeNull();
  });

  it("[1_2] asks for an ordinary confirmation when only a proof could not be evaluated", () => {
    // Nothing about an unfetched default branch makes deleting the worktree more
    // dangerous, so a withheld proof never earns the speed bump (§ 2.4).
    const { host, confirmed } = open(FULL_REPORT, { info: CLEAN });

    expect(host.querySelector("#wt-confirm-name"), "a proof demanded a typed confirmation").toBeNull();
    const button = danger(host);
    expect(button?.disabled).toBe(false);
    button?.click();
    expect(confirmed).toEqual([FULL_REPORT.fingerprint]);
  });

  it("[1_2] asks the user to type the name when a confirmable risk failed", () => {
    const { host, confirmed } = open(confirmableBlocker);
    const field = host.querySelector<HTMLInputElement>("#wt-confirm-name");
    expect(field, "a failing confirmable risk asked for no typed confirmation").not.toBeNull();

    expect(danger(host)?.disabled).toBe(true);
    danger(host)?.click();
    expect(confirmed, "the destructive button authorized before the name was typed").toEqual([]);

    if (field !== null) {
      field.value = "not-the-name";
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
    expect(danger(host)?.disabled).toBe(true);

    if (field !== null) {
      field.value = SPIKE.branch ?? "";
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
    expect(danger(host)?.disabled).toBe(false);
    danger(host)?.click();
    // The SAME fingerprint: typing is a stronger gesture over the set the user
    // was shown, not authorization for a wider one.
    expect(confirmed).toEqual([confirmableBlocker.fingerprint]);
  });

  it("[1_2] offers the removal behind a typed confirmation when a confirmable risk could not be read", () => {
    // The report now names the gap, so the removal is offered with the higher
    // bar rather than withheld — a slow or unreadable disk must not make a
    // worktree unremovable (design.md D3).
    const { host } = open(
      withChecks(confirmableBlocker, {
        dirty: unproven,
        untracked: unproven,
        idlePanes: unproven,
        externalAgents: unproven,
        locked: unproven,
      }),
    );

    expect(danger(host), "the removal was withheld rather than gated").not.toBeNull();
    expect(host.querySelector("#wt-confirm-name")).not.toBeNull();
    expect(danger(host)?.disabled).toBe(true);
  });

  it("still offers force when every check was actually evaluated", () => {
    // The guard must not cost the reachable case its confirmation.
    const { host } = open(confirmableBlocker);

    expect([...host.querySelectorAll("button")].map((b) => b.textContent)).toContain("Force remove");
  });

  it("still offers force when the only unproven checks are PROOFS", () => {
    // The three proofs are routinely unproven — a lock nobody can stat, a
    // default branch that does not resolve — and they describe no risk. Counting
    // them here would withhold force from every removal, which is a proof
    // refusing one (worktree-removal.md § 2.2, design.md D2).
    const { host } = open({
      ...confirmableBlocker,
      checks: [
        ...confirmableBlocker.checks,
        { id: "lockAged", cls: "proof", outcome: "unproven" },
        { id: "ownerGone", cls: "proof", outcome: "unproven" },
        { id: "branchMerged", cls: "proof", outcome: "unproven" },
      ],
    });

    expect(danger(host)).not.toBeNull();
  });

  it("still raises the bar when a RISK is unproven beside the proofs", () => {
    // The negative that gives the case above its meaning: the exclusion is by
    // class. An unproven RISK earns the typed confirmation where an unproven
    // proof earns nothing.
    // The unproven RISK is the only thing here that could earn the bar: every
    // other confirmable passed, so the assertion fails if the class test drops
    // `unproven`.
    const onlyDirtyUnread = withChecks(confirmableBlocker, {
      dirty: unproven,
      untracked: passed,
      idlePanes: passed,
      externalAgents: passed,
      locked: passed,
    });
    const { host } = open({
      ...onlyDirtyUnread,
      checks: [...onlyDirtyUnread.checks, { id: "lockAged", cls: "proof", outcome: "unproven" }],
    });

    expect(host.querySelector("#wt-confirm-name")).not.toBeNull();
    expect(danger(host)?.disabled).toBe(true);
  });
});

describe("[2_3] the confirmation carries only the authority its report was handed", () => {
  const CLEAN_REPORT: WorktreeRemoveReport = { ...FULL_REPORT, fingerprint: "sha256:clean-v1" };

  it("hands back confirmation authority for a clean report", () => {
    const { host, confirmed } = open(CLEAN_REPORT, { info: CLEAN });

    host.querySelector<HTMLButtonElement>("button.wt-btn--danger")?.click();

    expect(confirmed).toEqual(["sha256:clean-v1"]);
  });

  it("fails closed when a confirmable report carries no authority", () => {
    const { host, confirmed } = open({ ...CLEAN_REPORT, fingerprint: null }, { info: CLEAN });

    expect(host.querySelector("button.wt-btn--danger")).toBeNull();
    expect(confirmed).toEqual([]);
  });

  it("hands back the exact fingerprint a report carried, never a substitute", () => {
    const { host, confirmed } = open(FULL_REPORT, { info: CLEAN });

    host.querySelector<HTMLButtonElement>("button.wt-btn--danger")?.click();

    expect(confirmed).toEqual(["sha256:full-v1"]);
  });

  it("asks for the ordinary confirmation when every risk merely does not apply", () => {
    // D9: `notApplicable` is not `failed`, so it earns no speed bump. Pinned
    // here rather than branched in `confirmationFor`, whose class test already
    // lands on the right side — a second branch could only disagree with it.
    const { host } = open({
      ...CLEAN_REPORT,
      checks: CLEAN_REPORT.checks.map((c) =>
        c.cls === "confirmable" ? { ...c, outcome: "notApplicable" as const } : c,
      ),
    });

    expect(host.querySelector("#wt-confirm-name"), "a notApplicable risk demanded a typed confirmation").toBeNull();
    expect(host.querySelector("button.wt-btn--danger")?.textContent).toBe("Remove");
  });
});

describe("[3_1] the branch-delete opt-in (design.md D1)", () => {
  const BRANCH_DELETE = {
    branch: "spike/hooks",
    branchOid: "a".repeat(40),
    defaultBranch: "main",
    defaultOid: "b".repeat(40),
  };

  const WITH_OFFER = { ...confirmableBlocker, branchDelete: BRANCH_DELETE };
  const checkbox = (host: HTMLElement) => host.querySelector<HTMLInputElement>("#wt-delete-branch");

  it("offers nothing when the assessment carries no branch-delete evidence", () => {
    const { host } = open(confirmableBlocker);
    expect(checkbox(host)).toBeNull();
  });

  it("offers the control, off by default, naming the branch, when evidence is present", () => {
    const { host } = open(WITH_OFFER);
    const input = checkbox(host);
    expect(input).not.toBeNull();
    expect(input?.checked).toBe(false);
    expect(host.querySelector(".wt-delete-branch")?.textContent).toContain("spike/hooks");
  });

  it("stays independent of the typed confirmation: typing it leaves the checkbox untouched", () => {
    const { host } = open(WITH_OFFER);
    const field = host.querySelector<HTMLInputElement>("#wt-confirm-name");
    expect(field, "this report earns the typed confirmation too").not.toBeNull();
    if (field !== null) {
      field.value = SPIKE.branch ?? "";
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
    expect(checkbox(host)?.checked).toBe(false);
  });

  it("stays independent of the typed confirmation: checking it leaves the confirm button gated", () => {
    const { host } = open(WITH_OFFER);
    const input = checkbox(host);
    if (input !== null) {
      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    expect(host.querySelector<HTMLButtonElement>(".wt-btn--danger")?.disabled).toBe(true);
  });

  it("sends no deleteBranch when the box is left unchecked", () => {
    const { host, confirmed, deleteBranchRequests } = open(WITH_OFFER);
    const field = host.querySelector<HTMLInputElement>("#wt-confirm-name");
    if (field !== null) {
      field.value = SPIKE.branch ?? "";
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
    host.querySelector<HTMLButtonElement>(".wt-btn--danger")?.click();
    expect(confirmed).toEqual([WITH_OFFER.fingerprint]);
    expect(deleteBranchRequests).toEqual([undefined]);
  });

  it("sends deleteBranch, echoing the offer's names and OIDs, only when the box is checked", () => {
    const { host, deleteBranchRequests } = open(WITH_OFFER);
    const field = host.querySelector<HTMLInputElement>("#wt-confirm-name");
    if (field !== null) {
      field.value = SPIKE.branch ?? "";
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const input = checkbox(host);
    if (input !== null) {
      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    host.querySelector<HTMLButtonElement>(".wt-btn--danger")?.click();
    expect(deleteBranchRequests).toEqual([
      {
        branch: BRANCH_DELETE.branch,
        expectedBranchOid: BRANCH_DELETE.branchOid,
        defaultBranch: BRANCH_DELETE.defaultBranch,
        expectedDefaultOid: BRANCH_DELETE.defaultOid,
        fingerprint: WITH_OFFER.fingerprint,
      },
    ]);
  });
});
