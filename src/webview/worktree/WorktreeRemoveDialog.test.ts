// @vitest-environment jsdom

// The two answers to "remove this worktree?", against docs/ui/worktree.html § 11
// (one confirmation naming every blocker) and § 12 (refused outright).

import { afterEach, describe, expect, it } from "vitest";
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
  const confirmed: string[] = [];
  const shown: string[] = [];
  openWorktreeRemoveDialog(host, {
    info: over.info ?? SPIKE,
    report,
    agentRows: over.agentRows,
    degradedSources: over.degradedSources ?? [],
    now: over.now,
    onConfirm: (fingerprint) => confirmed.push(fingerprint),
    onShowAgent: (row) => shown.push(row.rowId),
  });
  return { host, confirmed, shown };
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
    expect(items.some((t) => t?.includes("2 idle terminals"))).toBe(true);
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
    expect(host.querySelector(".wt-blockers")).toBeNull();
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

  it("does not refuse the removal for a refusal-class check that could not be read", () => {
    // `isRefusedByChecks` refuses on `failed`, never on `unproven` (design.md
    // D2), and D3 retired the blanket withhold — so an unreadable refusal check
    // leaves the control to the confirmable classes rather than making the
    // worktree unremovable.
    const { host } = open(withChecks(confirmableBlocker, { busyAgents: unproven }));

    expect(danger(host), "an unreadable check made the worktree unremovable").not.toBeNull();
    expect(host.querySelector("#wt-confirm-name")).not.toBeNull();
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
