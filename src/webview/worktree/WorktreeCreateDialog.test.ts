// @vitest-environment jsdom

// The create form, against docs/ui/worktree.html § 9 (default) and § 10 (invalid
// branch, collided path, agent picker expanded).

import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorktreeCreateResolutionMessage } from "../../types/messages";
import { openWorktreeCreateDialog, sanitizeBranchForPath } from "./WorktreeCreateDialog";
import {
  createDefaults,
  emptyProvisionModel,
  malformedProvisionModel,
  provisionModel,
  provisionOffer,
  REPO_ID,
} from "./worktreeFixtures";
import type { WorktreeCreateDraft } from "./worktreeViewTypes";

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * The form BEFORE any host answer — no `onBranchChange`, no `bindDefaults`, so
 * the destination is the local guess and `outstanding` never arms. Production
 * always supplies both (`WorktreeController.createDialogDeps`), so anything
 * asserting what a create SUBMITS wants the wired shape instead: `resolved()`
 * and `twoRepos()` below. Round-1 W4 — this file had seven tests submitting
 * through a branch production never reaches.
 */
function open(over: Partial<Parameters<typeof openWorktreeCreateDialog>[1]> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const submitted: WorktreeCreateDraft[] = [];
  const dispose = openWorktreeCreateDialog(host, {
    repos: [createDefaults()],
    onSubmit: (draft) => submitted.push(draft),
    ...over,
  });
  const q = <T extends HTMLElement>(sel: string): T => {
    const el = host.querySelector<T>(sel);
    if (!el) {
      throw new Error(`missing ${sel}`);
    }
    return el;
  };
  return { host, submitted, dispose, q };
}

function type(input: HTMLInputElement, value: string): void {
  // Focus is part of typing, and the destination field now has a rule that reads
  // it — a stand-in that skips the focus cannot see that rule at all.
  input.focus();
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("sanitizeBranchForPath", () => {
  it("turns a branch into one safe path segment", () => {
    expect(sanitizeBranchForPath("feat/worktree ui")).toBe("feat-worktree-ui");
    expect(sanitizeBranchForPath("  --Fix--  ")).toBe("fix");
  });
});

describe("create worktree — default state (§ 9)", () => {
  it("starts with an empty branch name and offers no suggestion", () => {
    const { q } = open();
    expect(q<HTMLInputElement>("#wt-branch").value).toBe("");
    expect(q<HTMLInputElement>("#wt-branch").placeholder).toBe("feat/…");
  });

  it("takes the wide card — the form outgrows the sidebar's measure", () => {
    const { q } = open();
    expect(q(".wt-dialog").classList.contains("wt-dialog--wide")).toBe(true);
  });

  it("disables Create until there is something to create", () => {
    const { q } = open();
    const create = q<HTMLButtonElement>(".wt-btn--primary");
    expect(create.disabled).toBe(true);
    type(q<HTMLInputElement>("#wt-branch"), "feat/x");
    expect(create.disabled).toBe(false);
  });

  it("hides the repo picker for a single repo and shows it for two", () => {
    const { host } = open();
    expect(host.querySelector("#wt-repo-select")).toBeNull();
    document.body.replaceChildren();
    const { host: multi } = open({
      repos: [createDefaults(), createDefaults({ repoId: "/other/.git", repoLabel: "other" })],
    });
    expect(multi.querySelector("#wt-repo-select")).not.toBeNull();
  });

  it("derives the path from the branch name", () => {
    const { q } = open();
    type(q<HTMLInputElement>("#wt-branch"), "feat/worktree-ui");
    // The override still carries the derived value; it just no longer leads.
    expect(q<HTMLInputElement>("#wt-path").value).toBe("/Users/dev/Projects/ai-oss/anywhere-terminal-feat-worktree-ui");
  });

  it("stops deriving once the user edits the path themselves", () => {
    const { q } = open();
    type(q<HTMLInputElement>("#wt-branch"), "feat/a");
    type(q<HTMLInputElement>("#wt-path"), "/custom/place");
    type(q<HTMLInputElement>("#wt-branch"), "feat/b");
    expect(q<HTMLInputElement>("#wt-path").value).toBe("/custom/place");
  });

  it("rebuilds the agent list when the repository changes", () => {
    // Which agents resolve is a property of the repo; a stale list can submit a
    // draft naming an agent the selected repo does not offer.
    const { host, q } = open({
      repos: [
        createDefaults(),
        createDefaults({
          repoId: "/other/.git",
          repoLabel: "other",
          agents: [{ id: "codex", label: "Codex", canSeedPrompt: true, permissionChoices: [] }],
        }),
      ],
    });
    const after = q<HTMLSelectElement>("#wt-after");
    after.value = "agent";
    after.dispatchEvent(new Event("change"));
    expect(Array.from(q<HTMLSelectElement>("#wt-agent").options).map((o) => o.value)).toEqual([
      "claude",
      "codex",
      "opencode",
    ]);

    const repo = q<HTMLSelectElement>("#wt-repo-select");
    repo.value = "/other/.git";
    repo.dispatchEvent(new Event("change"));
    const agents = host.querySelector<HTMLSelectElement>("#wt-agent");
    expect(Array.from(agents?.options ?? []).map((o) => o.value)).toEqual(["codex"]);
    expect(agents?.value).toBe("codex");
  });

  it("submits no launch details on a create that is not launching", () => {
    // Was "submits the agent the rebuilt list actually offers". The protocol now
    // REJECTS an agent, posture or prompt on any mode but `agent`, so carrying
    // the picker's value on a `none` create is the defect, not the feature. That
    // the rebuilt list drives the picker is asserted by the case above.
    const { q, submitted } = open({
      repos: [
        createDefaults(),
        createDefaults({
          repoId: "/other/.git",
          repoLabel: "other",
          agents: [{ id: "codex", label: "Codex", canSeedPrompt: true, permissionChoices: [] }],
        }),
      ],
    });
    const repo = q<HTMLSelectElement>("#wt-repo-select");
    repo.value = "/other/.git";
    repo.dispatchEvent(new Event("change"));
    type(q<HTMLInputElement>("#wt-branch"), "feat/x");
    q<HTMLButtonElement>(".wt-btn--primary").click();
    expect(submitted[0]?.openAfter).toBe("none");
    expect(submitted[0]).not.toHaveProperty("agentId");
    expect(submitted[0]).not.toHaveProperty("permissionChoiceId");
    expect(submitted[0]).not.toHaveProperty("prompt");
  });

  it("offers the agent mode where agents exist and omits it where none do", () => {
    // WT-005.3 supplies the launch the mode names, so the option is offered —
    // but only against a repo that reported an agent. A repo with none leaves it
    // absent rather than selectable-and-refused (design.md D9).
    const { q } = open();
    expect([...q<HTMLSelectElement>("#wt-after").options].map((o) => o.value)).toContain("agent");
    document.body.replaceChildren();
    const { q: bare } = open({ repos: [createDefaults({ agents: [] })] });
    expect([...bare<HTMLSelectElement>("#wt-after").options].map((o) => o.value)).not.toContain("agent");
  });

  it("unhides the agent picker when After creating asks for one", () => {
    const { q } = open();
    expect(q<HTMLElement>(".wt-agentbox").hidden).toBe(true);
    const after = q<HTMLSelectElement>("#wt-after");
    after.value = "agent";
    after.dispatchEvent(new Event("change"));
    expect(q<HTMLElement>(".wt-agentbox").hidden).toBe(false);
  });

  it("drops the agent mode when the chosen repo withdraws its agents", () => {
    // Leaving `agent` selected against a repo offering none would submit a launch
    // nothing can perform.
    const { q } = open({
      repos: [createDefaults(), createDefaults({ repoId: "/other/.git", repoLabel: "other", agents: [] })],
    });
    const after = q<HTMLSelectElement>("#wt-after");
    after.value = "agent";
    after.dispatchEvent(new Event("change"));
    const repo = q<HTMLSelectElement>("#wt-repo-select");
    repo.value = "/other/.git";
    repo.dispatchEvent(new Event("change"));
    expect([...after.options].map((o) => o.value)).not.toContain("agent");
    expect(after.value).toBe("none");
    expect(q<HTMLElement>(".wt-agentbox").hidden).toBe(true);
  });

  it("never preselects the dangerous permission posture", () => {
    // The postures are the CHOSEN AGENT's own now, not a shared three — permission
    // is agent-shaped, so the ids moved with them. The rule did not: whatever the
    // agent declares, the initial value is never its dangerous one.
    const { q } = open();
    const perm = q<HTMLSelectElement>("#wt-perm");
    expect(perm.value).toBe("default");
    const options = Array.from(perm.options).map((o) => o.textContent);
    // It is offered, and labelled as what it is.
    expect(options).toContain("Bypass permission checks (dangerous)");
  });

  it("submits the draft on the primary button and on the keyboard shortcut", () => {
    const { q, submitted } = open();
    type(q<HTMLInputElement>("#wt-branch"), "feat/x");
    type(q<HTMLInputElement>("#wt-base"), "origin/main");
    q<HTMLButtonElement>(".wt-btn--primary").click();
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({ branchMode: "new", branchName: "feat/x", baseRef: "origin/main" });

    const second = open();
    type(second.q<HTMLInputElement>("#wt-branch"), "feat/y");
    second
      .q<HTMLElement>(".wt-dialog")
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true }));
    expect(second.submitted).toHaveLength(1);
  });

  it("cancels without submitting", () => {
    const { host, submitted } = open();
    host.querySelector<HTMLButtonElement>(".wt-btn")?.click();
    expect(submitted).toHaveLength(0);
    expect(host.querySelector(".wt-dialog")).toBeNull();
  });

  it("closes on Escape", () => {
    const { host } = open();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(host.querySelector(".wt-dialog")).toBeNull();
    expect(host.querySelector(".wt-scrim")).toBeNull();
  });
});

describe("create worktree — invalid and collided (§ 10)", () => {
  it("shows git's own message under an invalid branch name and refuses Create", () => {
    const { q } = open({
      validateBranch: (name) =>
        name.includes(" ") ? "git check-ref-format: a branch name cannot contain a space." : undefined,
    });
    const input = q<HTMLInputElement>("#wt-branch");
    type(input, "feat/worktree ui");
    expect(input.classList.contains("is-invalid")).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(q<HTMLElement>(".wt-ferror").textContent).toBe(
      "git check-ref-format: a branch name cannot contain a space.",
    );
    expect(q<HTMLButtonElement>(".wt-btn--primary").disabled).toBe(true);
  });

  it("reports the collision without naming a destination the host has not resolved", () => {
    // The derived path IS the occupied one, so claiming it as the destination
    // would tell the user the create lands where it cannot.
    const { q } = open({ repos: [createDefaults({ collidedWith: "-worktree-ui" })] });
    type(q<HTMLInputElement>("#wt-branch"), "feat/worktree-ui");
    const note = q<HTMLElement>(".wt-dest-note").textContent ?? "";
    expect(note).toContain("-worktree-ui already exists");
    expect(note).not.toContain("created as");
    expect(note).toContain("a free suffix is chosen");
  });

  it("opens the note with the taken name, marking no elision it does not have", () => {
    // The host sends a directory NAME. A leading `…` announces a truncation
    // that is not there — and it announced one that WAS there, unshortened,
    // back when this field carried a whole path. Every case below asserts with
    // `toContain`, which a stray `…` satisfies, and that is why this survived.
    const { q } = open({
      repos: [createDefaults({ collidedWith: "repo-feat-x", resolvedPath: "/Users/dev/trees/repo-feat-x-2" })],
    });
    type(q<HTMLInputElement>("#wt-branch"), "feat/x");
    const note = (q<HTMLElement>(".wt-dest-note").textContent ?? "").trim();

    expect(note.startsWith("repo-feat-x already exists")).toBe(true);
    expect(note).not.toContain("…");
  });

  it("names the destination once the host has resolved one", () => {
    const { q } = open({
      repos: [createDefaults({ collidedWith: "-worktree-ui", resolvedPath: "/Users/dev/Projects/ai-oss/x-2" })],
    });
    type(q<HTMLInputElement>("#wt-branch"), "feat/worktree-ui");
    // One line, naming the result — and NOT a second full path. The destination
    // line above it already carries the path; repeating it in full here is the
    // duplication this requirement removed.
    const note = q<HTMLElement>(".wt-dest-note").textContent ?? "";
    expect(note).toContain("-worktree-ui already exists");
    expect(note).toContain("x-2");
    expect(note).not.toContain("/Users/dev/Projects/ai-oss/x-2");
    expect(q<HTMLElement>(".wt-dest").getAttribute("aria-label")).toBe("/Users/dev/Projects/ai-oss/x-2");
  });

  it("switches the required field to the base ref in detached mode", () => {
    const { q, submitted } = open();
    // Branch source moved into the disclosure, so reaching it is now a step.
    q<HTMLButtonElement>(".wt-advanced-toggle").click();
    // The branch-source control is the detached toggle now — new-versus-existing
    // is the combobox's, and one wire value never takes two sources (D4).
    q<HTMLButtonElement>("#wt-detached").click();
    expect(q<HTMLInputElement>("#wt-branch").disabled).toBe(true);
    expect(q<HTMLButtonElement>(".wt-btn--primary").disabled).toBe(true);
    type(q<HTMLInputElement>("#wt-base"), "9f2c1ab");
    expect(q<HTMLButtonElement>(".wt-btn--primary").disabled).toBe(false);
    q<HTMLButtonElement>(".wt-btn--primary").click();
    expect(submitted[0]).toMatchObject({ branchMode: "detached", baseRef: "9f2c1ab" });
  });
});

describe("the form waits for the destination it is going to submit (round-4 B12)", () => {
  /** Open with the host wiring the panel really supplies. */
  function wired() {
    const asked: { repoId: string; branch: string }[] = [];
    let apply: ((next: ReturnType<typeof createDefaults>) => void) | undefined;
    const h = open({
      onBranchChange: (repoId, branch) => asked.push({ repoId, branch }),
      bindDefaults: (fn) => {
        apply = fn;
      },
    });
    return { ...h, asked, answer: (next: ReturnType<typeof createDefaults>) => apply?.(next) };
  }

  /** The Create button, by its label — the form gives it no id. */
  function createButton(host: HTMLElement): HTMLButtonElement {
    const btn = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      /create worktree/i.test(b.textContent ?? ""),
    );
    if (!btn) {
      throw new Error("no Create button");
    }
    return btn;
  }

  function commit(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("holds Create until the host has answered for the branch on screen", () => {
    const h = wired();
    commit(h.q<HTMLInputElement>("#wt-branch"), "feat/a");
    expect(h.asked.at(-1)?.branch).toBe("feat/a");
    // The destination shown is still the previous branch's. Submitting now
    // would submit a path that does not belong to this name.
    expect(createButton(h.host).disabled).toBe(true);

    h.answer(createDefaults({ resolvedPath: "/trees/repo-feat-a", answersBranch: "feat/a" }));
    expect(createButton(h.host).disabled).toBe(false);
  });

  it("ignores an answer for a branch the form has already moved past", () => {
    const h = wired();
    commit(h.q<HTMLInputElement>("#wt-branch"), "feat/a");
    commit(h.q<HTMLInputElement>("#wt-branch"), "feat/b");
    // The slow answer to the FIRST question arrives last.
    h.answer(createDefaults({ resolvedPath: "/trees/repo-feat-a", answersBranch: "feat/a" }));
    expect(h.host.textContent ?? "").not.toContain("/trees/repo-feat-a");
    expect(createButton(h.host).disabled).toBe(true);

    h.answer(createDefaults({ resolvedPath: "/trees/repo-feat-b", answersBranch: "feat/b" }));
    expect(createButton(h.host).disabled).toBe(false);
  });
});

describe("the form is a worktree form (§ 3.2.1)", () => {
  const FULL = "/Users/dev/Projects/ai-oss/anywhere-terminal-feat-x";

  /** Open with the host wiring, already answered for one branch. */
  function resolved(answer: Partial<ReturnType<typeof createDefaults>> = {}) {
    let apply: ((next: ReturnType<typeof createDefaults>) => void) | undefined;
    const h = open({
      onBranchChange: () => {},
      bindDefaults: (fn) => {
        apply = fn;
      },
    });
    type(h.q<HTMLInputElement>("#wt-branch"), "feat/x");
    h.q<HTMLInputElement>("#wt-branch").dispatchEvent(new Event("change", { bubbles: true }));
    // The answer REPLACES the seed for its repo, so a collision has to arrive on
    // the answer — setting it on the opening `repos` is overwritten right here.
    apply?.(createDefaults({ resolvedPath: FULL, answersBranch: "feat/x", ...answer }));
    return h;
  }

  it("leads with the branch name — no control sits above it", () => {
    const { host, q } = open();
    const controls = [
      ...host.querySelectorAll<HTMLElement>(".wt-dialog input, .wt-dialog select, .wt-dialog textarea"),
    ];
    expect(controls[0]?.id).toBe("wt-branch");
    expect(document.activeElement).toBe(q("#wt-branch"));
  });

  it("keeps the branch first even where the repository picker exists", () => {
    // The picker is the one control that used to sit above the lead input, and a
    // single-repo fixture is exactly what would hide its return.
    const { host } = open({
      repos: [createDefaults(), createDefaults({ repoId: "/other/.git", repoLabel: "other" })],
    });
    const controls = [
      ...host.querySelectorAll<HTMLElement>(".wt-dialog input, .wt-dialog select, .wt-dialog textarea"),
    ];
    expect(controls[0]?.id).toBe("wt-branch");
    expect(controls.map((c) => c.id)).toContain("wt-repo-select");
  });

  it("states the destination once, shortened, with the exact value on the element", () => {
    const { host, q } = resolved();
    const dest = q<HTMLElement>(".wt-dest");
    expect(host.querySelectorAll(".wt-dest")).toHaveLength(1);
    // Shortened for reading; the exact value is what the element announces and
    // what its tooltip carries, so it never leaves the dialog to be checked.
    expect(dest.querySelector("[aria-hidden]")?.textContent).toBe("…/ai-oss/anywhere-terminal-feat-x");
    expect(dest.getAttribute("aria-label")).toBe(FULL);
    // `attachTooltip` listens for focus but does not make its target focusable —
    // without this the exact value is reachable by mouse only.
    expect(dest.tabIndex).toBe(0);
  });

  it("does not state a full path outside the advanced override", () => {
    const { host } = resolved();
    const advanced = host.querySelector(".wt-advanced-body");
    const carries = [...host.querySelectorAll<HTMLElement>(".wt-dialog *")].filter(
      (el) => el.children.length === 0 && (el.textContent ?? "").includes(FULL) && !advanced?.contains(el),
    );
    // Nothing SIGHTED states it in full — the line is shortened and the override
    // is behind the disclosure.
    expect(carries.filter((el) => !el.classList.contains("wt-visually-hidden"))).toHaveLength(0);
    // And the exact value is carried exactly once, by the element that exists to
    // announce it. "Stated once" is a claim about the statement, not a ban on the
    // accessible name of that same statement.
    expect(carries).toHaveLength(1);
  });

  it("follows the override, and withdraws the collision note with it", () => {
    const { host, q, submitted } = resolved({ collidedWith: "-feat-x" });
    expect(q<HTMLElement>(".wt-dest-note").hidden).toBe(false);
    q<HTMLButtonElement>(".wt-advanced-toggle").click();
    type(q<HTMLInputElement>("#wt-path"), "/custom/place");
    // The statement is of the path the create will take, so an override moves it.
    // Showing the host's default while submitting the override is the failure
    // this asserts against.
    expect(q<HTMLElement>(".wt-dest").getAttribute("aria-label")).toBe("/custom/place");
    expect(q<HTMLElement>(".wt-dest-note").hidden).toBe(true);
    expect(q<HTMLElement>(".wt-dest-note").textContent).toBe("");
    expect(host.textContent ?? "").not.toContain("already exists");
    q<HTMLButtonElement>(".wt-btn--primary").click();
    expect(submitted[0]?.path).toBe("/custom/place");
  });

  it("keeps the advanced inputs out of the focus order until they are opened", () => {
    const { host, q } = open();
    const toggle = q<HTMLButtonElement>(".wt-advanced-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const tabbable = (): string[] =>
      [...host.querySelectorAll<HTMLElement>(".wt-dialog input, .wt-dialog select, .wt-dialog button")]
        .filter((el) => !el.closest("[hidden]"))
        .map((el) => el.id)
        .filter(Boolean);
    expect(tabbable()).not.toContain("wt-base");
    expect(tabbable()).not.toContain("wt-path");
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(tabbable()).toContain("wt-base");
    expect(tabbable()).toContain("wt-path");
  });

  it("holds the focus trap and its dismissals through the restructure", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { host } = open();
    const trapped = (): HTMLElement[] =>
      [
        ...host.querySelectorAll<HTMLElement>(
          '.wt-dialog input, .wt-dialog select, .wt-dialog button, .wt-dialog [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => !el.closest("[hidden]") && !(el instanceof HTMLButtonElement && el.disabled));
    const first = trapped()[0];
    const last = trapped()[trapped().length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    // Forward off the last wraps to the first; backward off the first wraps to the last.
    last?.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(first);
    first?.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(last);
    // And dismissal still returns focus to whatever opened the dialog.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.activeElement).toBe(opener);
    expect(host.querySelector(".wt-dialog")).toBeNull();
  });

  it("dismisses from the title control as well as from Cancel", () => {
    const { host, submitted } = open();
    host.querySelector<HTMLButtonElement>(".wt-dismiss")?.click();
    expect(host.querySelector(".wt-dialog")).toBeNull();
    expect(submitted).toHaveLength(0);
  });
});

describe("After creating offers four choices (§ 3.2.1)", () => {
  const choices = (q: (sel: string) => HTMLElement): string[] =>
    [...(q("#wt-after") as HTMLSelectElement).options].map((o) => o.value);

  function choose(q: <T extends HTMLElement>(sel: string) => T, value: string): void {
    const after = q<HTMLSelectElement>("#wt-after");
    after.value = value;
    after.dispatchEvent(new Event("change"));
  }

  it("offers one folder choice, not two window-shaped ones", () => {
    const { q } = open();
    expect(choices(q)).toEqual(["none", "terminal", "agent", "folder"]);
  });

  it("reveals the window-or-workspace control on the folder choice only", () => {
    const { q } = open();
    expect(q<HTMLElement>(".wt-folder-mode").hidden).toBe(true);
    choose(q, "folder");
    expect(q<HTMLElement>(".wt-folder-mode").hidden).toBe(false);
    choose(q, "terminal");
    expect(q<HTMLElement>(".wt-folder-mode").hidden).toBe(true);
  });

  it("defaults the folder choice to adding to the workspace", () => {
    // Opening a second window on a folder the user is already in is the more
    // disruptive of the two, so it is the one they have to ask for.
    const { q, submitted } = open();
    choose(q, "folder");
    expect(q<HTMLSelectElement>("#wt-folder-mode").value).toBe("addToWorkspace");
    type(q<HTMLInputElement>("#wt-branch"), "feat/x");
    q<HTMLButtonElement>(".wt-btn--primary").click();
    expect(submitted[0]?.openAfter).toBe("addToWorkspace");
  });

  it("submits the new-window mode when the secondary control asks for it", () => {
    const { q, submitted } = open();
    choose(q, "folder");
    const mode = q<HTMLSelectElement>("#wt-folder-mode");
    mode.value = "newWindow";
    mode.dispatchEvent(new Event("change"));
    type(q<HTMLInputElement>("#wt-branch"), "feat/x");
    q<HTMLButtonElement>(".wt-btn--primary").click();
    expect(submitted[0]?.openAfter).toBe("newWindow");
  });

  it("leaves no open-after mode unreachable from the form", () => {
    // Four choices over five wire values is exactly where one goes missing, so
    // the assertion is on the wire values the form can actually submit.
    const reached = new Set<string>();
    for (const [choice, mode] of [
      ["none", undefined],
      ["terminal", undefined],
      ["agent", undefined],
      ["folder", "addToWorkspace"],
      ["folder", "newWindow"],
    ] as const) {
      document.body.replaceChildren();
      // Wired, because this asserts what production SUBMITS — the bare shape
      // reaches submit down a path the panel never takes.
      let apply: ((next: ReturnType<typeof createDefaults>) => void) | undefined;
      const { q, submitted } = open({
        onBranchChange: () => {},
        bindDefaults: (fn) => {
          apply = fn;
        },
      });
      choose(q, choice);
      if (mode !== undefined) {
        const sel = q<HTMLSelectElement>("#wt-folder-mode");
        sel.value = mode;
        sel.dispatchEvent(new Event("change"));
      }
      const branch = q<HTMLInputElement>("#wt-branch");
      branch.value = "feat/x";
      branch.dispatchEvent(new Event("input", { bubbles: true }));
      branch.dispatchEvent(new Event("change", { bubbles: true }));
      apply?.(createDefaults({ resolvedPath: "/trees/repo-feat-x", answersBranch: "feat/x" }));
      q<HTMLButtonElement>(".wt-btn--primary").click();
      const openAfter = submitted[0]?.openAfter;
      if (openAfter !== undefined) {
        reached.add(openAfter);
      }
    }
    expect(reached).toEqual(new Set(["none", "terminal", "agent", "newWindow", "addToWorkspace"]));
  });

  it("keeps the folder choice and its mode when a repo switch withdraws the agent one", () => {
    // `rebuildAfterOptions` resets the draft when the SELECTED choice is
    // withdrawn. The folder choice is always performable, so it must survive a
    // rebuild that removes a different one.
    const { q } = open({
      repos: [createDefaults(), createDefaults({ repoId: "/other/.git", repoLabel: "other", agents: [] })],
    });
    choose(q, "folder");
    const mode = q<HTMLSelectElement>("#wt-folder-mode");
    mode.value = "newWindow";
    mode.dispatchEvent(new Event("change"));
    const repo = q<HTMLSelectElement>("#wt-repo-select");
    repo.value = "/other/.git";
    repo.dispatchEvent(new Event("change"));
    expect(choices(q)).not.toContain("agent");
    expect(q<HTMLSelectElement>("#wt-after").value).toBe("folder");
    expect(q<HTMLSelectElement>("#wt-folder-mode").value).toBe("newWindow");
    expect(q<HTMLElement>(".wt-folder-mode").hidden).toBe(false);
  });

  it("keeps the agent block out of the focus order while no agent was asked for", () => {
    // The reveal rule was implemented but unpinned by anything that would notice
    // it moving, and a restructure is exactly what moves it.
    const { host, q } = open();
    const reachable = (): string[] =>
      [...host.querySelectorAll<HTMLElement>(".wt-dialog input, .wt-dialog select, .wt-dialog textarea")]
        .filter((el) => !el.closest("[hidden]"))
        .map((el) => el.id);
    expect(reachable()).not.toContain("wt-agent");
    expect(reachable()).not.toContain("wt-perm");
    choose(q, "agent");
    expect(reachable()).toContain("wt-agent");
    expect(reachable()).toContain("wt-perm");
  });
});

describe("a create that cannot name a posture cannot be submitted", () => {
  const RECKLESS = {
    id: "reckless",
    label: "Reckless",
    canSeedPrompt: true,
    permissionChoices: [{ id: "yolo", label: "Skip every prompt", dangerous: true }],
  };

  it("holds Create while a revealed posture list has nothing selected", () => {
    const { q, submitted } = open({ repos: [createDefaults({ agents: [RECKLESS] })] });
    type(q<HTMLInputElement>("#wt-branch"), "feat/x");
    const after = q<HTMLSelectElement>("#wt-after");
    after.value = "agent";
    after.dispatchEvent(new Event("change"));
    expect(q<HTMLButtonElement>(".wt-btn--primary").disabled).toBe(true);
    const perm = q<HTMLSelectElement>("#wt-perm");
    perm.value = "yolo";
    perm.dispatchEvent(new Event("change"));
    expect(q<HTMLButtonElement>(".wt-btn--primary").disabled).toBe(false);
    q<HTMLButtonElement>(".wt-btn--primary").click();
    expect(submitted[0]?.permissionChoiceId).toBe("yolo");
  });

  it("does not hold Create on a create that is not launching", () => {
    // The gate belongs to the revealed block, not to the form.
    const { q } = open({ repos: [createDefaults({ agents: [RECKLESS] })] });
    type(q<HTMLInputElement>("#wt-branch"), "feat/x");
    expect(q<HTMLButtonElement>(".wt-btn--primary").disabled).toBe(false);
  });
});

describe("round-1 review fixes", () => {
  const FULL_A = "/trees/repo-a-feat-x";
  const FULL_B = "/trees/repo-b-feat-x";

  /** Two repos and the host wiring the panel really supplies. */
  function twoRepos() {
    const asked: { repoId: string; branch: string }[] = [];
    let apply: ((next: ReturnType<typeof createDefaults>) => void) | undefined;
    const h = open({
      repos: [createDefaults(), createDefaults({ repoId: "/other/.git", repoLabel: "other" })],
      onBranchChange: (repoId, branch) => asked.push({ repoId, branch }),
      bindDefaults: (fn) => {
        apply = fn;
      },
    });
    return { ...h, asked, answer: (next: ReturnType<typeof createDefaults>) => apply?.(next) };
  }

  function commit(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("[B1] re-asks the host when the repository changes under a named branch", () => {
    const h = twoRepos();
    commit(h.q<HTMLInputElement>("#wt-branch"), "feat/x");
    h.answer(createDefaults({ resolvedPath: FULL_A, answersBranch: "feat/x" }));
    expect(h.q<HTMLElement>(".wt-dest").getAttribute("aria-label")).toBe(FULL_A);

    const repo = h.q<HTMLSelectElement>("#wt-repo-select");
    repo.value = "/other/.git";
    repo.dispatchEvent(new Event("change"));
    // The request is repo-scoped; deduping it on the branch alone reuses repo A's
    // answer for repo B, and the line the form now leans on says so.
    expect(h.asked.at(-1)).toEqual({ repoId: "/other/.git", branch: "feat/x" });
    expect(h.q<HTMLButtonElement>(".wt-btn--primary").disabled).toBe(true);

    h.answer(createDefaults({ repoId: "/other/.git", resolvedPath: FULL_B, answersBranch: "feat/x" }));
    expect(h.q<HTMLElement>(".wt-dest").getAttribute("aria-label")).toBe(FULL_B);
    expect(h.q<HTMLButtonElement>(".wt-btn--primary").disabled).toBe(false);
  });

  it("[W1] exposes the exact destination to assistive tech and to a hover", () => {
    const h = twoRepos();
    commit(h.q<HTMLInputElement>("#wt-branch"), "feat/x");
    h.answer(createDefaults({ resolvedPath: FULL_A, answersBranch: "feat/x" }));
    const dest = h.q<HTMLElement>(".wt-dest");
    // `aria-label` on a bare div is not exposed — role `generic` prohibits naming —
    // so the exact value needs an element AT will actually read.
    expect(dest.querySelector(".wt-visually-hidden")?.textContent).toBe(FULL_A);
    // And the tooltip: `attachTooltip` returns a no-op when its text is empty at
    // attach time, so attaching before any destination existed attached nothing.
    expect(dest.getAttribute("aria-describedby")).toBe("webview-tooltip-widget");
  });

  it("[W2] shortens a Windows path too", () => {
    const h = twoRepos();
    commit(h.q<HTMLInputElement>("#wt-branch"), "feat/x");
    h.answer(
      createDefaults({
        resolvedPath: "C:\\Users\\dev\\trees\\repo-feat-x",
        collidedWith: "-feat-x",
        answersBranch: "feat/x",
      }),
    );
    // Splitting on "/" alone leaves a Windows path whole, so both the line and
    // the collision note render a full path — the two things this change removed.
    expect(h.q<HTMLElement>(".wt-dest").querySelector("[aria-hidden]")?.textContent).toBe("…/trees/repo-feat-x");
    expect(h.q<HTMLElement>(".wt-dest-note").textContent).toContain("repo-feat-x");
    expect(h.q<HTMLElement>(".wt-dest-note").textContent).not.toContain("C:\\Users");
  });

  it("[W3] returns to the derivation when the override is cleared", () => {
    const h = twoRepos();
    commit(h.q<HTMLInputElement>("#wt-branch"), "feat/x");
    h.answer(createDefaults({ resolvedPath: FULL_A, answersBranch: "feat/x" }));
    h.q<HTMLButtonElement>(".wt-advanced-toggle").click();
    const path = h.q<HTMLInputElement>("#wt-path");
    type(path, "/custom/place");
    expect(h.q<HTMLElement>(".wt-dest").getAttribute("aria-label")).toBe("/custom/place");
    // Emptying it was a one-way door: the face showed a derivation that had been
    // switched off, Create was disabled, and the control that explained it had
    // gone behind the disclosure.
    type(path, "   ");
    expect(h.q<HTMLElement>(".wt-dest").getAttribute("aria-label")).toBe(FULL_A);
    // The LINE returns to the derivation; the field stays as the user left it.
    // What happens inside the field is [R2]'s.
    expect(path.value).toBe("   ");
    expect(h.q<HTMLButtonElement>(".wt-btn--primary").disabled).toBe(false);
  });
});

describe("round-2 review fixes", () => {
  const RECKLESS = {
    id: "reckless",
    label: "Reckless",
    canSeedPrompt: true,
    permissionChoices: [{ id: "yolo", label: "Skip every prompt", dangerous: true }],
  };

  function wired(over: Partial<Parameters<typeof openWorktreeCreateDialog>[1]> = {}) {
    let apply: ((next: ReturnType<typeof createDefaults>) => void) | undefined;
    const h = open({
      onBranchChange: () => {},
      bindDefaults: (fn) => {
        apply = fn;
      },
      ...over,
    });
    return { ...h, answer: (next: ReturnType<typeof createDefaults>) => apply?.(next) };
  }

  function commit(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("[R1] keeps the posture the user chose across the answers a branch edit provokes", () => {
    const h = wired();
    const after = h.q<HTMLSelectElement>("#wt-after");
    after.value = "agent";
    after.dispatchEvent(new Event("change"));
    const perm = h.q<HTMLSelectElement>("#wt-perm");
    perm.value = "acceptEdits";
    perm.dispatchEvent(new Event("change"));

    commit(h.q<HTMLInputElement>("#wt-branch"), "feat/x");
    h.answer(createDefaults({ resolvedPath: "/trees/x", answersBranch: "feat/x" }));
    commit(h.q<HTMLInputElement>("#wt-branch"), "feat/xy");
    h.answer(createDefaults({ resolvedPath: "/trees/xy", answersBranch: "feat/xy" }));

    // The host answers per keystroke. Rebuilding the block on each answer reset
    // the posture to the first safe one every time the user touched the branch.
    expect(h.q<HTMLSelectElement>("#wt-perm").value).toBe("acceptEdits");
    h.q<HTMLButtonElement>(".wt-btn--primary").click();
    expect(h.submitted[0]?.permissionChoiceId).toBe("acceptEdits");
  });

  it("[R1] submits the offer the dialog was opened against, not a refreshed one", () => {
    // The base requirement is explicit: what a dialog submits is what it was
    // OPENED against. `createRepos()` stamps the panel's live agent list into
    // every answer, so admitting it here relabels the choice under the user.
    const h = wired();
    const after = h.q<HTMLSelectElement>("#wt-after");
    after.value = "agent";
    after.dispatchEvent(new Event("change"));
    const opened = [...h.q<HTMLSelectElement>("#wt-agent").options].map((o) => o.value);
    commit(h.q<HTMLInputElement>("#wt-branch"), "feat/x");
    h.answer(createDefaults({ resolvedPath: "/trees/x", answersBranch: "feat/x", agents: [RECKLESS] }));
    expect([...h.q<HTMLSelectElement>("#wt-agent").options].map((o) => o.value)).toEqual(opened);
    // And the destination the answer DID carry still lands — the splice keeps the
    // agents, not the whole stale record.
    expect(h.q<HTMLElement>(".wt-dest").getAttribute("aria-label")).toBe("/trees/x");
    // Submitted, not just displayed: the name of this test is a claim about what
    // leaves the dialog, and reading the options alone does not check it.
    h.q<HTMLButtonElement>(".wt-btn--primary").click();
    expect(h.submitted[0]?.agentId).toBe(opened[0]);
  });

  it("[R1] a repo switch restores the agents that repo was opened with", () => {
    // The answer is spliced, not swapped, so the record the repo-switch handler
    // re-reads still carries the opening agents. Without that, an answer whose
    // list is empty withdraws the agent choice the next time the user comes back
    // to this repo — a relabelling of the offer one step removed from the answer.
    let apply: ((next: ReturnType<typeof createDefaults>) => void) | undefined;
    const h = open({
      repos: [createDefaults(), createDefaults({ repoId: "/other/.git", repoLabel: "other" })],
      onBranchChange: () => {},
      bindDefaults: (fn) => {
        apply = fn;
      },
    });
    commit(h.q<HTMLInputElement>("#wt-branch"), "feat/x");
    apply?.(createDefaults({ resolvedPath: "/trees/x", answersBranch: "feat/x", agents: [] }));
    const repoSelect = h.q<HTMLSelectElement>("#wt-repo-select");
    repoSelect.value = "/other/.git";
    repoSelect.dispatchEvent(new Event("change"));
    repoSelect.value = createDefaults().repoId;
    repoSelect.dispatchEvent(new Event("change"));
    expect([...h.q<HTMLSelectElement>("#wt-after").options].map((o) => o.value)).toContain("agent");
  });

  it("[R2] clearing the override leaves the field empty for what the user types next", () => {
    const h = wired();
    commit(h.q<HTMLInputElement>("#wt-branch"), "feat/x");
    h.answer(createDefaults({ resolvedPath: "/trees/repo-feat-x", answersBranch: "feat/x" }));
    h.q<HTMLButtonElement>(".wt-advanced-toggle").click();
    const path = h.q<HTMLInputElement>("#wt-path");
    type(path, "/custom/place");
    // Select-all-Delete. Refilling the field from the derivation in this same
    // event is invisible to the user, so their next characters append to a value
    // they believe is gone.
    type(path, "");
    expect(path.value).toBe("");
    expect(h.q<HTMLElement>(".wt-dest").getAttribute("aria-label")).toBe("/trees/repo-feat-x");
    type(path, "/elsewhere");
    expect(path.value).toBe("/elsewhere");
    h.q<HTMLButtonElement>(".wt-btn--primary").click();
    expect(h.submitted[0]?.path).toBe("/elsewhere");
  });

  it("[R2] an answer landing mid-edit does not refill the field under the caret", () => {
    // The round-2 fix guarded the input's own handler, which is the one caller
    // that cannot be the problem: the user is not typing during it, they just
    // typed. The answer callback is the one that arrives on its own schedule,
    // and it lands while the field is focused and empty.
    const h = wired();
    commit(h.q<HTMLInputElement>("#wt-branch"), "feat/x");
    h.answer(createDefaults({ resolvedPath: "/trees/x", answersBranch: "feat/x" }));
    h.q<HTMLButtonElement>(".wt-advanced-toggle").click();
    const path = h.q<HTMLInputElement>("#wt-path");
    type(path, "/custom/place");
    type(path, "");
    // Editing the branch asks again; the reply lands with the caret still in the
    // path field the user has just emptied.
    commit(h.q<HTMLInputElement>("#wt-branch"), "feat/xy");
    h.answer(createDefaults({ resolvedPath: "/trees/xy", answersBranch: "feat/xy" }));
    expect(path.value).toBe("");
    type(path, "mine");
    h.q<HTMLButtonElement>(".wt-btn--primary").click();
    expect(h.submitted[0]?.path).toBe("mine");
  });

  it("[R3] the tooltip shows the exact path, not the shortened one", () => {
    vi.useFakeTimers();
    try {
      const h = wired();
      commit(h.q<HTMLInputElement>("#wt-branch"), "feat/x");
      h.answer(createDefaults({ resolvedPath: "/trees/deep/repo-feat-x", answersBranch: "feat/x" }));
      const dest = h.q<HTMLElement>(".wt-dest");
      dest.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
      vi.advanceTimersByTime(400);
      // Asserting that SOMETHING was attached leaves a getText returning the
      // shortened text green, which is the whole content of the promise.
      expect(document.getElementById("webview-tooltip-widget")?.textContent).toBe("/trees/deep/repo-feat-x");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Bring over — what the new worktree will lack", () => {
  /** The form opened against a repository whose provisioning offer has arrived. */
  function withOffer(over: Parameters<typeof provisionOffer>[0] = {}) {
    return open({ repos: [createDefaults({ provisioning: provisionOffer(over) })] });
  }

  const rows = (host: HTMLElement): HTMLElement[] => Array.from(host.querySelectorAll<HTMLElement>(".wt-brow"));

  it("gives every offered item its own row", () => {
    // Five declared items — two copied, one linked, one port, one setup step.
    // The mockup draws one row per KIND; the spec says one row per ITEM, because
    // the selection it feeds is a flat list of ids.
    const { host } = withOffer();
    expect(rows(host)).toHaveLength(5);
  });

  it("names the file that declared each row", () => {
    const { host } = withOffer();
    const sources = rows(host).map((r) => r.querySelector(".wt-brow-src")?.textContent);
    expect(sources).toEqual(Array(5).fill("asimov/worktree.yaml"));
  });

  it("names each row's own subject, not a count", () => {
    const { host } = withOffer();
    const subjects = rows(host).map((r) => r.querySelector(".wt-brow-code")?.textContent);
    expect(subjects).toEqual([
      ".env",
      ".claude/settings.local.json",
      ".env.local",
      "APP",
      "pnpm install --frozen-lockfile",
    ]);
  });

  it("gives every checkbox the host's own opaque id, never a path", () => {
    // The submission quotes ids back (§ 2.4). A checkbox valued with a path
    // would make the webview the authority on what gets materialized.
    const { host } = withOffer();
    const values = Array.from(host.querySelectorAll<HTMLInputElement>(".wt-brow-cb")).map((cb) => cb.value);
    expect(values).toEqual(["i1", "i2", "i3", "i4", "i5"]);
  });

  it("says a linked row writes to the main checkout, and offers no way to hide it", () => {
    const { host } = withOffer();
    const linked = rows(host).find((r) => r.querySelector(".wt-brow-code")?.textContent === ".env.local");
    expect(linked?.querySelector(".wt-brow-warn")?.textContent).toBe("writes to main");
    // Unsuppressible: nothing in the row dismisses it, and clearing the row's
    // own checkbox leaves the statement standing.
    expect(linked?.querySelector("button")).toBeNull();
    const cb = linked?.querySelector<HTMLInputElement>(".wt-brow-cb");
    if (cb) {
      cb.checked = false;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    }
    expect(linked?.querySelector(".wt-brow-warn")?.textContent).toBe("writes to main");
  });

  it("marks only the linked row", () => {
    const { host } = withOffer();
    expect(host.querySelectorAll(".wt-brow-warn")).toHaveLength(1);
  });

  it("leaves a setup command unchecked — a provider file is not consent", () => {
    const { host } = withOffer();
    const checked = rows(host).map((r) => r.querySelector<HTMLInputElement>(".wt-brow-cb")?.checked);
    expect(checked).toEqual([true, true, true, true, false]);
  });

  it("renders a port row without inventing a number for it", () => {
    // Allocation is a later task. A placeholder here reads as an allocation
    // nobody made.
    const { host } = withOffer();
    const port = rows(host).find((r) => r.querySelector(".wt-brow-code")?.textContent === "APP");
    expect(port?.textContent).not.toMatch(/\d/);
  });

  it("summarizes the section by what it will do", () => {
    const { host } = withOffer();
    expect(host.querySelector(".wt-bring-sum")?.textContent).toBe("2 copied · 1 linked · 1 port · 1 setup step");
  });

  it("shows a setup command as text, never as markup", () => {
    const { host } = withOffer({
      model: provisionModel({
        entries: [],
        ports: [],
        setup: [{ id: "i9", kind: "shell", script: "<img src=x onerror=alert(1)>", source: "asimov/worktree.yaml" }],
      }),
    });
    const code = host.querySelector(".wt-brow-code");
    expect(code?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(code?.querySelector("img")).toBeNull();
  });

  it("still offers Create when the repository declares nothing to bring over", () => {
    // The section is not a gate. This asserts the create path is untouched;
    // what the empty section SAYS is the next task's.
    const { q } = open({ repos: [createDefaults()] });
    type(q<HTMLInputElement>("#wt-branch"), "feat/x");
    expect(q<HTMLButtonElement>(".wt-btn--primary").disabled).toBe(false);
  });
});

describe("Bring over — a repository that declares nothing, and a file that cannot be read", () => {
  function withModel(model: ReturnType<typeof provisionModel>) {
    return open({ repos: [createDefaults({ provisioning: provisionOffer({ model }) })] });
  }

  it("says what an empty repository will still lack, rather than showing an empty list", () => {
    // "This repo needs nothing brought over" and "we did not look" are different
    // statements, and only the second is a defect. An empty box says neither.
    const { host } = withModel(emptyProvisionModel());
    expect(host.querySelectorAll(".wt-brow")).toHaveLength(0);
    const said = host.querySelector(".wt-bring-empty")?.textContent ?? "";
    expect(said).toContain(".env");
    expect(said).toContain("node_modules");
  });

  it("marks the empty section as configuring nothing, not as unread", () => {
    const { host } = withModel(emptyProvisionModel());
    expect(host.querySelector(".wt-bring-sum")?.textContent).toBe("Nothing configured");
  });

  it("shows nothing at all until an offer arrives", () => {
    // Absent is not empty: the form has not been told yet, and an empty section
    // here would claim the repository needs nothing.
    const { host } = open({ repos: [createDefaults()] });
    expect(host.querySelector(".wt-bring")?.hasAttribute("hidden")).toBe(true);
  });

  it("names a provider file it could not read", () => {
    const { host } = withModel(malformedProvisionModel());
    const problem = host.querySelector(".wt-bring-problem");
    expect(problem?.querySelector(".wt-bring-problem-file")?.textContent).toBe("asimov/worktree.yaml");
    expect(problem?.textContent).toContain("Unexpected key `copyFiles` at line 12.");
    expect(host.querySelector(".wt-bring-sum")?.textContent).toBe("Could not be read");
  });

  it("still offers Create when the provider file is malformed", () => {
    // A broken provisioning config is not a reason to refuse to make a worktree.
    const { host, q } = withModel(malformedProvisionModel());
    type(q<HTMLInputElement>("#wt-branch"), "feat/x");
    expect(host.querySelector(".wt-bring-problem")).not.toBeNull();
    expect(q<HTMLButtonElement>(".wt-btn--primary").disabled).toBe(false);
  });

  it("quotes a parser message as text, never as markup", () => {
    // The detail can carry arbitrary file content back out of the parser.
    const { host } = withModel(
      malformedProvisionModel({
        problems: [{ file: "asimov/worktree.yaml", reason: "malformed", detail: "<b>at</b> line 12" }],
      }),
    );
    // Scoped to the detail: the row's own file name is a `<b>`, so asking the
    // whole row whether it holds one proves nothing either way.
    const detail = host.querySelector(".wt-bring-problem-detail");
    expect(detail?.textContent).toBe("<b>at</b> line 12");
    expect(detail?.childElementCount).toBe(0);
  });

  it("shows the rows it did read beside the key it could not", () => {
    // An unknown key does not discard the keys that parsed. Reporting only the
    // problem would understate what the create is about to do.
    const { host } = withModel(
      provisionModel({
        problems: [
          { file: "asimov/worktree.yaml", reason: "unknownKey", detail: "`exclude` is not a key this reads." },
        ],
      }),
    );
    expect(host.querySelectorAll(".wt-brow")).toHaveLength(5);
    expect(host.querySelectorAll(".wt-bring-problem")).toHaveLength(1);
    // The summary still describes what will happen, not the problem.
    expect(host.querySelector(".wt-bring-sum")?.textContent).toBe("2 copied · 1 linked · 1 port · 1 setup step");
  });

  it("names every unreadable file, not just the first", () => {
    const { host } = withModel(
      malformedProvisionModel({
        problems: [
          { file: "asimov/worktree.yaml", reason: "malformed", detail: "bad" },
          { file: ".vscode/worktree.json", reason: "unreadable", detail: "denied" },
        ],
      }),
    );
    const files = Array.from(host.querySelectorAll(".wt-bring-problem-file")).map((f) => f.textContent);
    expect(files).toEqual(["asimov/worktree.yaml", ".vscode/worktree.json"]);
  });
});

describe("Bring over — the offer's own channel (round-1 B4, W2, W3, S1)", () => {
  /** The form wired the way production wires it: destination AND provisioning. */
  function wired() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let applyDefaults: ((next: ReturnType<typeof createDefaults>) => void) | undefined;
    let applyOffer: ((repoId: string, offer: ReturnType<typeof provisionOffer>) => void) | undefined;
    const asked: string[] = [];
    const dispose = openWorktreeCreateDialog(host, {
      repos: [createDefaults()],
      onSubmit: () => {},
      onBranchChange: (_repoId, branch) => asked.push(branch),
      bindDefaults: (apply) => {
        applyDefaults = apply;
      },
      bindProvisioning: (apply) => {
        applyOffer = apply;
      },
    });
    const q = <T extends HTMLElement>(sel: string): T => {
      const el = host.querySelector<T>(sel);
      if (!el) {
        throw new Error(`missing ${sel}`);
      }
      return el;
    };
    return { host, q, dispose, asked, offer: (o = provisionOffer()) => applyOffer?.(REPO_ID, o), applyDefaults };
  }

  it("[B4] an offer arriving mid-edit does not enable Create on a stale path", () => {
    // The destination is answered per keystroke; provisioning is answered once.
    // Routing the offer through the destination's callback cleared its pending
    // gate, so Create went live on the path resolved for the OPENING ask.
    const { q, offer } = wired();
    const create = () => q<HTMLButtonElement>(".wt-btn--primary");
    type(q<HTMLInputElement>("#wt-branch"), "feat/x");
    expect(create().disabled).toBe(true);

    offer();

    expect(create().disabled).toBe(true);
  });

  it("[B4] the offer still renders while the destination is pending", () => {
    // Isolating the channel must not cost the section its answer.
    const { host, q, offer } = wired();
    type(q<HTMLInputElement>("#wt-branch"), "feat/x");
    offer();

    expect(host.querySelectorAll(".wt-brow")).toHaveLength(5);
  });

  it("[W2] keeps the boxes the user ticked when the form re-derives", () => {
    // syncDerived runs on every keystroke and rebuilt every row, so unticking
    // Run setup and typing one more character silently put it back.
    const { host, q, offer } = wired();
    offer();
    const setup = Array.from(host.querySelectorAll<HTMLInputElement>(".wt-brow-cb")).at(-1);
    const first = host.querySelector<HTMLInputElement>(".wt-brow-cb");
    if (!setup || !first) {
      throw new Error("expected rows");
    }
    setup.checked = true;
    setup.dispatchEvent(new Event("change", { bubbles: true }));
    first.checked = false;
    first.dispatchEvent(new Event("change", { bubbles: true }));

    type(q<HTMLInputElement>("#wt-branch"), "feat/xy");

    const now = Array.from(host.querySelectorAll<HTMLInputElement>(".wt-brow-cb")).map((cb) => cb.checked);
    expect(now).toEqual([false, true, true, true, true]);
  });

  it("[W2] does not rebuild the rows when nothing about the offer changed", () => {
    const { host, q, offer } = wired();
    offer();
    const before = host.querySelector(".wt-brow");
    type(q<HTMLInputElement>("#wt-branch"), "feat/xyz");

    // The same node, not an equal one: a rebuild is what loses user state.
    expect(host.querySelector(".wt-brow")).toBe(before);
  });

  it("[W2] does rebuild when a new offer supersedes the old one", () => {
    const { host, offer } = wired();
    offer();
    const before = host.querySelector(".wt-brow");
    offer(provisionOffer({ offerId: "provision-2", model: provisionModel({ ports: [], setup: [] }) }));

    expect(host.querySelector(".wt-brow")).not.toBe(before);
    expect(host.querySelectorAll(".wt-brow")).toHaveLength(3);
  });

  it("[W2] follows the repository picker, and keeps each repo's ticks", () => {
    // A repo switch redraws from a different offer, so the checked ids cannot
    // live in the DOM. Reachable from the manifest: two repositories, one with
    // an offer and one without.
    const host = document.createElement("div");
    document.body.appendChild(host);
    let applyOffer: ((repoId: string, offer: ReturnType<typeof provisionOffer>) => void) | undefined;
    const other = createDefaults({ repoId: "/other/.git", repoLabel: "other", mainPath: "/other" });
    openWorktreeCreateDialog(host, {
      repos: [createDefaults(), other],
      onSubmit: () => {},
      bindProvisioning: (apply) => {
        applyOffer = apply;
      },
    });
    applyOffer?.(REPO_ID, provisionOffer());
    const setup = Array.from(host.querySelectorAll<HTMLInputElement>(".wt-brow-cb")).at(-1);
    if (!setup) {
      throw new Error("expected rows");
    }
    setup.checked = true;
    setup.dispatchEvent(new Event("change", { bubbles: true }));

    const picker = host.querySelector<HTMLSelectElement>("#wt-repo-select");
    if (!picker) {
      throw new Error("expected a repo picker");
    }
    picker.value = "/other/.git";
    picker.dispatchEvent(new Event("change", { bubbles: true }));
    // The other repository has no offer, which is "not told yet" — not an empty
    // section claiming it needs nothing.
    expect(host.querySelector<HTMLElement>(".wt-bring")?.hidden).toBe(true);

    picker.value = REPO_ID;
    picker.dispatchEvent(new Event("change", { bubbles: true }));

    const back = Array.from(host.querySelectorAll<HTMLInputElement>(".wt-brow-cb")).map((cb) => cb.checked);
    expect(back).toEqual([true, true, true, true, true]);
  });

  it("[r2 W5] a redraw does not leave a handler writing another offer's selection", () => {
    // A listener per redraw, each closing over that redraw's set — and item ids
    // are offer-local, every offer starting at `i1`, so toggling in one repo
    // wrote the SAME id into the other repo's saved selection.
    const host = document.createElement("div");
    document.body.appendChild(host);
    let applyOffer: ((repoId: string, offer: ReturnType<typeof provisionOffer>) => void) | undefined;
    const other = createDefaults({ repoId: "/other/.git", repoLabel: "other", mainPath: "/other" });
    openWorktreeCreateDialog(host, {
      repos: [createDefaults(), other],
      onSubmit: () => {},
      bindProvisioning: (apply) => {
        applyOffer = apply;
      },
    });
    applyOffer?.(REPO_ID, provisionOffer());
    // A second repository whose offer carries the same adapter-local ids.
    applyOffer?.("/other/.git", provisionOffer({ offerId: "provision-2" }));

    const picker = host.querySelector<HTMLSelectElement>("#wt-repo-select");
    if (!picker) {
      throw new Error("expected a repo picker");
    }
    const switchTo = (repoId: string) => {
      picker.value = repoId;
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const boxes = () => Array.from(host.querySelectorAll<HTMLInputElement>(".wt-brow-cb"));
    // Several redraws, which is what stacked the handlers.
    switchTo("/other/.git");
    switchTo(REPO_ID);
    switchTo("/other/.git");
    switchTo(REPO_ID);

    // Untick the first row in THIS repository only.
    const first = boxes()[0];
    if (!first) {
      throw new Error("expected rows");
    }
    first.checked = false;
    first.dispatchEvent(new Event("change", { bubbles: true }));

    switchTo("/other/.git");

    // The other repository never had a box touched, so its defaults stand.
    expect(boxes().map((cb) => cb.checked)).toEqual([true, true, true, true, false]);
  });

  it("[W3] names each checkbox by its subject, not only by its verb", () => {
    // Five rows from one provider otherwise announce as five identical
    // "Copy asimov/worktree.yaml".
    const { host, offer } = wired();
    offer();
    const names = Array.from(host.querySelectorAll<HTMLInputElement>(".wt-brow-cb")).map((cb) => {
      const ids = (cb.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
      return (
        ids
          // `getElementById` rather than a selector: this jsdom has no CSS.escape.
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
      );
    });

    expect(names).toHaveLength(5);
    expect(new Set(names).size).toBe(5);
    expect(names[0]).toContain(".env");
    expect(names.at(-1)).toContain("pnpm install --frozen-lockfile");
  });
});

// ── The branch list — one box, refs and create-new together (§ 4.1) ────────

describe("the create dialog offers branches and a create-new entry in one list", () => {
  const REFS = [
    { name: "main" },
    { name: "feat/search" },
    { name: "feat/search-ui" },
    { name: "fix/lock", heldBy: "lock-spike" },
  ] as const;

  function withRefs(truncated = false) {
    return open({ repos: [createDefaults({ refs: { list: [...REFS], truncated } })] });
  }

  const rows = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>("#wt-branch-list [role='option']"));
  const labels = (host: HTMLElement) => rows(host).map((r) => r.dataset.branch ?? r.dataset.kind);
  const listOpen = (host: HTMLElement) => host.querySelector<HTMLElement>("#wt-branch-list")?.hidden === false;

  it("carries no tab bar — one list, not a mode chosen before typing", () => {
    const { host } = withRefs();
    expect(host.querySelector("[role='tablist']")).toBeNull();
  });

  it("offers every branch and the create-new entry when nothing is typed", () => {
    const { host, q } = withRefs();
    q<HTMLInputElement>("#wt-branch").focus();
    q<HTMLInputElement>("#wt-branch").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));

    expect(labels(host)).toEqual(["main", "feat/search", "feat/search-ui", "fix/lock", "new"]);
  });

  it("orders the exact match first, then the prefixes, then create-new", () => {
    const { host, q } = withRefs();
    type(q<HTMLInputElement>("#wt-branch"), "feat/search");

    expect(labels(host)).toEqual(["feat/search", "feat/search-ui", "new"]);
  });

  it("keeps the create-new entry for a name that matches nothing", () => {
    // The row is not gated on the list: a repository whose enumeration failed,
    // or simply a new name, must still be creatable.
    const { host, q } = withRefs();
    type(q<HTMLInputElement>("#wt-branch"), "totally-new");

    expect(labels(host)).toEqual(["new"]);
    expect(rows(host)[0]?.textContent).toContain("totally-new");
  });

  it("offers the create-new entry with no list at all", () => {
    const { host, q } = open();
    type(q<HTMLInputElement>("#wt-branch"), "feat/x");

    expect(labels(host)).toEqual(["new"]);
    expect(q<HTMLButtonElement>(".wt-btn--primary").disabled).toBe(false);
  });

  it("gains the list when the host's answer lands after the form opened", () => {
    let apply: ((repoId: string, refs: { list: typeof REFS; truncated: boolean }) => void) | undefined;
    const { host, q } = open({
      bindRefs: (fn) => {
        apply = fn as typeof apply;
      },
    });
    type(q<HTMLInputElement>("#wt-branch"), "feat/search");
    expect(labels(host)).toEqual(["new"]);

    apply?.(REPO_ID, { list: REFS, truncated: false });

    q<HTMLInputElement>("#wt-branch").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(labels(host)).toEqual(["feat/search", "feat/search-ui", "new"]);
  });

  it("says a capped list is partial rather than showing it as the whole set", () => {
    const { q } = withRefs(true);
    expect(q<HTMLElement>("#wt-branch-partial").hidden).toBe(false);
    expect(q<HTMLElement>("#wt-branch-partial").textContent).toContain("part of");
  });

  it("claims nothing about completeness when the list is whole", () => {
    const { q } = withRefs(false);
    expect(q<HTMLElement>("#wt-branch-partial").hidden).toBe(true);
  });

  it("picking a ref means existing; the create-new row means new", () => {
    const { host, q, submitted } = withRefs();
    type(q<HTMLInputElement>("#wt-branch"), "feat/search");
    rows(host)[0]?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    q<HTMLButtonElement>(".wt-btn--primary").click();

    expect(submitted[0]).toMatchObject({ branchMode: "existing", branchName: "feat/search" });
  });

  it("a typed name that matches no ref submits as a new branch", () => {
    const { q, submitted } = withRefs();
    type(q<HTMLInputElement>("#wt-branch"), "feat/brand-new");
    q<HTMLButtonElement>(".wt-btn--primary").click();

    expect(submitted[0]).toMatchObject({ branchMode: "new", branchName: "feat/brand-new" });
  });

  it("a typed name that IS a ref submits as existing — the exact match is what it means", () => {
    const { q, submitted } = withRefs();
    type(q<HTMLInputElement>("#wt-branch"), "main");
    q<HTMLButtonElement>(".wt-btn--primary").click();

    expect(submitted[0]).toMatchObject({ branchMode: "existing", branchName: "main" });
  });

  it("reaches every entry from the keyboard, including the last", () => {
    const { host, q } = withRefs();
    const input = q<HTMLInputElement>("#wt-branch");
    input.focus();
    const seen: (string | undefined)[] = [];
    for (let i = 0; i < 5; i += 1) {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      seen.push(input.getAttribute("aria-activedescendant") ?? undefined);
    }

    expect(seen).toEqual(rows(host).map((r) => r.id));
  });

  it("wraps from the last entry back to the first rather than dead-ending", () => {
    const { host, q } = withRefs();
    const input = q<HTMLInputElement>("#wt-branch");
    input.focus();
    for (let i = 0; i < 6; i += 1) {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    }

    expect(input.getAttribute("aria-activedescendant")).toBe(rows(host)[0]?.id);
  });

  it("does not intercept the arrow keys while the list is closed", () => {
    const { host, q } = withRefs();
    const input = q<HTMLInputElement>("#wt-branch");
    type(input, "feat/search");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(listOpen(host)).toBe(false);

    // Reopening is the arrow's own job; what it must not do is move a hidden
    // selection that a screen reader would then announce.
    expect(input.getAttribute("aria-activedescendant")).toBeNull();
  });

  it("takes the active entry on Enter while the list is open", () => {
    const { q, submitted } = withRefs();
    const input = q<HTMLInputElement>("#wt-branch");
    type(input, "feat/search");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(input.value).toBe("feat/search");
    q<HTMLButtonElement>(".wt-btn--primary").click();
    expect(submitted[0]).toMatchObject({ branchMode: "existing", branchName: "feat/search" });
  });
});

describe("Escape closes the branch list before it dismisses the dialog (D7)", () => {
  const REFS = [{ name: "main" }, { name: "feat/search" }];

  function openWithList() {
    const cancelled: true[] = [];
    const h = open({
      repos: [createDefaults({ refs: { list: REFS, truncated: false } })],
      onCancel: () => cancelled.push(true),
    });
    type(h.q<HTMLInputElement>("#wt-branch"), "feat");
    return { ...h, cancelled };
  }
  const esc = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  const listOpen = (host: HTMLElement) => host.querySelector<HTMLElement>("#wt-branch-list")?.hidden === false;

  it("[4_2][r3 S3] bounds the popup by the room measured below the input", () => {
    // CSS cannot compute this: `calc(100vh - 100%)` resolves `100%` against the
    // FIELD's height, not its position, so the round-2 rule read as a
    // measurement without being one. The element publishes the number instead.
    const { host } = open({ repos: [createDefaults({ refs: { list: REFS, truncated: false } })] });
    const input = host.querySelector<HTMLInputElement>("#wt-branch");
    if (input === null) {
      throw new Error("no branch input");
    }
    input.getBoundingClientRect = () => ({ bottom: 600 }) as DOMRect;
    Object.defineProperty(window, "innerHeight", { value: 700, configurable: true });

    type(input, "feat");

    const listBox = host.querySelector<HTMLElement>("#wt-branch-list");
    expect(listBox?.style.getPropertyValue("--wt-branch-room")).toBe("88px");
  });

  it("[4_2][r2 B1] scrolls the row the keyboard moved to into view", () => {
    // The popup scrolls, and focus never leaves the input — only
    // `aria-activedescendant` moves. Without this, arrowing past the visible
    // rows leaves Enter committing an option the user cannot see.
    const scrolled: unknown[] = [];
    const proto = globalThis.HTMLElement.prototype as unknown as { scrollIntoView?: unknown };
    const had = Object.hasOwn(proto, "scrollIntoView");
    const prior = proto.scrollIntoView;
    proto.scrollIntoView = function (opts: unknown) {
      scrolled.push({ branch: (this as HTMLElement).dataset.branch, opts });
    };
    try {
      const { host } = openWithList();
      host
        .querySelector<HTMLInputElement>("#wt-branch")
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    } finally {
      if (had) {
        proto.scrollIntoView = prior;
      } else {
        delete proto.scrollIntoView;
      }
    }

    expect(scrolled).toHaveLength(1);
    expect(scrolled[0]).toMatchObject({ opts: { block: "nearest" } });
  });

  it("the first Escape closes the list and leaves the dialog standing", () => {
    const { host, cancelled } = openWithList();
    expect(listOpen(host)).toBe(true);

    esc();

    expect(listOpen(host)).toBe(false);
    expect(host.querySelector(".wt-dialog")).not.toBeNull();
    expect(cancelled).toEqual([]);
  });

  it("the second Escape dismisses the dialog", () => {
    const { host, cancelled } = openWithList();
    esc();
    esc();

    expect(host.querySelector(".wt-dialog")).toBeNull();
    expect(cancelled).toEqual([true]);
  });

  it("Escape dismisses on the first press when no list is open", () => {
    const cancelled: true[] = [];
    const { host } = open({
      repos: [createDefaults({ refs: { list: REFS, truncated: false } })],
      onCancel: () => cancelled.push(true),
    });
    esc();

    expect(host.querySelector(".wt-dialog")).toBeNull();
    expect(cancelled).toEqual([true]);
  });
});

// ── A held branch is offered, explained, and unsubmittable (D5) ────────────

describe("a branch another worktree holds is offered but not selectable", () => {
  const REFS = [{ name: "main" }, { name: "fix/lock", heldBy: "lock-spike" }];

  function held(over: Partial<Parameters<typeof openWorktreeCreateDialog>[1]> = {}) {
    return open({ repos: [createDefaults({ refs: { list: REFS, truncated: false } })], ...over });
  }
  const rowFor = (host: HTMLElement, branch: string) =>
    host.querySelector<HTMLElement>(`#wt-branch-list [data-branch="${branch}"]`);
  const create = (q: <T extends HTMLElement>(s: string) => T) => q<HTMLButtonElement>(".wt-btn--primary");

  it("names the directory holding it, and never a path", () => {
    const { host, q } = held();
    type(q<HTMLInputElement>("#wt-branch"), "fix/lock");
    const badge = rowFor(host, "fix/lock")?.querySelector(".wt-branch-held")?.textContent ?? "";

    expect(badge).toContain("lock-spike");
    expect(badge).not.toContain("/");
  });

  it("stays reachable and announced rather than hidden", () => {
    // Removing the row would return the branch to looking free — which is the
    // failure this task deletes, not a tidier list.
    const { host, q } = held();
    q<HTMLInputElement>("#wt-branch").focus();
    q<HTMLInputElement>("#wt-branch").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    const row = rowFor(host, "fix/lock");

    expect(row).not.toBeNull();
    expect(row?.getAttribute("aria-disabled")).toBe("true");
    expect(row?.hasAttribute("disabled")).toBe(false);
  });

  it("refuses a create for a held branch the user TYPED rather than clicked", () => {
    // The route that never touches the row. A guard living on the attribute
    // cannot see this at all.
    const { q, submitted } = held();
    type(q<HTMLInputElement>("#wt-branch"), "fix/lock");

    expect(create(q).disabled).toBe(true);
    create(q).click();
    expect(submitted).toEqual([]);
  });

  it("refuses when create-new is CLICKED after a held name was typed", () => {
    // The create-new row is always present, so it is always reachable after a
    // held branch has been typed. Committing it sets the mode to `new` and
    // leaves the typed name alone, and a guard reading only the selection stops
    // seeing the holder — which submitted a create for a branch another
    // worktree holds (round-2 B4).
    const { host, q, submitted } = held();
    type(q<HTMLInputElement>("#wt-branch"), "fix/lock");
    const newRow = host.querySelector<HTMLElement>('#wt-branch-list [data-kind="new"]');
    expect(newRow).not.toBeNull();
    // `mousedown`, not `click` — the row commits on mousedown so the input does
    // not blur first, and a test clicking it would assert nothing at all.
    newRow?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(q<HTMLInputElement>("#wt-branch").value).toBe("fix/lock");
    expect(create(q).disabled).toBe(true);
    create(q).click();
    expect(submitted).toEqual([]);
  });

  it("refuses when create-new is committed from the KEYBOARD after a held name", () => {
    const { host, q, submitted } = held();
    const input = q<HTMLInputElement>("#wt-branch");
    type(input, "fix/lock");
    const rows = Array.from(host.querySelectorAll<HTMLElement>("#wt-branch-list .wt-branch-opt"));
    const newAt = rows.findIndex((r) => r.dataset.kind === "new");
    expect(newAt).toBeGreaterThanOrEqual(0);
    for (let i = 0; i <= newAt; i += 1) {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    }
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(input.value).toBe("fix/lock");
    create(q).click();
    expect(submitted).toEqual([]);
  });

  it("says which directory has it rather than failing silently", () => {
    const { q } = held();
    type(q<HTMLInputElement>("#wt-branch"), "fix/lock");

    expect(q<HTMLElement>(".wt-ferror").textContent).toContain("lock-spike");
    expect(q<HTMLElement>(".wt-ferror").hidden).toBe(false);
  });

  it("does not take a held row when it is committed from the keyboard", () => {
    const { q } = held();
    const input = q<HTMLInputElement>("#wt-branch");
    type(input, "fix");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(input.value).toBe("fix");
  });

  it("refuses when the list arrives AFTER the name was typed", () => {
    // The name was free when it was typed. The answer that says otherwise lands
    // later, and a form that only checked at typing time would submit it.
    let apply: ((repoId: string, refs: { list: typeof REFS; truncated: boolean }) => void) | undefined;
    const { q, submitted } = open({
      bindRefs: (fn) => {
        apply = fn as typeof apply;
      },
    });
    type(q<HTMLInputElement>("#wt-branch"), "fix/lock");
    expect(create(q).disabled).toBe(false);

    apply?.(REPO_ID, { list: REFS, truncated: false });

    expect(create(q).disabled).toBe(true);
    create(q).click();
    expect(submitted).toEqual([]);
  });

  it("submit itself refuses, not only the disabled button", () => {
    // The button is a rendering too. A route that reached submit without
    // re-deriving — a keyboard shortcut, a stale render — still stops.
    const { q, host, submitted } = held();
    type(q<HTMLInputElement>("#wt-branch"), "fix/lock");
    create(q).disabled = false;
    host
      .querySelector(".wt-dialog")
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));

    expect(submitted).toEqual([]);
  });

  it("lets a free branch through untouched", () => {
    const { q, submitted } = held();
    type(q<HTMLInputElement>("#wt-branch"), "main");
    create(q).click();

    expect(submitted[0]).toMatchObject({ branchMode: "existing", branchName: "main" });
  });

  it("a failed enumeration still permits a create", () => {
    // No list is not "every branch is taken". The create-new row is not gated
    // on the enumeration, and neither is this guard.
    const { q, submitted } = open();
    type(q<HTMLInputElement>("#wt-branch"), "fix/lock");
    create(q).click();

    expect(submitted[0]).toMatchObject({ branchMode: "new", branchName: "fix/lock" });
  });

  it("re-checks against the repository the form is now on, not the one it was typed under", () => {
    // The selection is a ref object from the OLD repo's list. Switching
    // repositories changes which branches are taken without changing a
    // character of the typed name, so a guard reading only the picked object
    // would carry the old repository's answer into the new one.
    const { q, submitted } = open({
      repos: [
        createDefaults({ refs: { list: [{ name: "fix/lock" }], truncated: false } }),
        createDefaults({
          repoId: "/other/.git",
          repoLabel: "other",
          agents: [],
          refs: { list: [{ name: "fix/lock", heldBy: "lock-spike" }], truncated: false },
        }),
      ],
    });
    type(q<HTMLInputElement>("#wt-branch"), "fix/lock");
    expect(create(q).disabled).toBe(false);

    const repo = q<HTMLSelectElement>("#wt-repo-select");
    repo.value = "/other/.git";
    repo.dispatchEvent(new Event("change"));

    expect(create(q).disabled).toBe(true);
    create(q).click();
    expect(submitted).toEqual([]);
  });

  it("a detached create is not blocked by a held branch name", () => {
    const { q, submitted } = held();
    type(q<HTMLInputElement>("#wt-branch"), "fix/lock");
    q<HTMLButtonElement>(".wt-advanced-toggle").click();
    q<HTMLButtonElement>("#wt-detached").click();
    type(q<HTMLInputElement>("#wt-base"), "9f2c1ab");
    create(q).click();

    expect(submitted[0]).toMatchObject({ branchMode: "detached", baseRef: "9f2c1ab" });
  });
});

// ── Round-1 fixes: the mode is re-decided per repository ───────────────────

describe("switching repository re-decides what the typed name means (round-1 B2, W1)", () => {
  const create = (q: <T extends HTMLElement>(s: string) => T) => q<HTMLButtonElement>(".wt-btn--primary");

  /** `feat/x` exists in the first repo and does not in the second. */
  function twoRepos(second: { name: string; heldBy?: string }[]) {
    return open({
      repos: [
        createDefaults({ refs: { list: [{ name: "feat/x" }], truncated: false } }),
        createDefaults({
          repoId: "/other/.git",
          repoLabel: "other",
          agents: [],
          refs: { list: second, truncated: false },
        }),
      ],
    });
  }
  function switchRepo(q: <T extends HTMLElement>(s: string) => T) {
    const repo = q<HTMLSelectElement>("#wt-repo-select");
    repo.value = "/other/.git";
    repo.dispatchEvent(new Event("change"));
  }

  it("drops `existing` for a branch the new repository does not have", () => {
    // Only ever upgrading to existing left the wire carrying `reuse` for a
    // branch that is not there — the failure D4's single-source rule exists to
    // stop, arriving through the one route nothing re-derived.
    const { q, submitted } = twoRepos([{ name: "unrelated" }]);
    type(q<HTMLInputElement>("#wt-branch"), "feat/x");
    expect(create(q).disabled).toBe(false);

    switchRepo(q);
    create(q).click();

    expect(submitted[0]).toMatchObject({ branchMode: "new", branchName: "feat/x" });
  });

  it("takes `existing` up when the new repository does have it", () => {
    const { q, submitted } = twoRepos([{ name: "feat/x" }]);
    type(q<HTMLInputElement>("#wt-branch"), "nothing-like-it");
    switchRepo(q);
    type(q<HTMLInputElement>("#wt-branch"), "feat/x");
    create(q).click();

    expect(submitted[0]).toMatchObject({ branchMode: "existing", branchName: "feat/x" });
  });

  it("drops a holder that belonged to the repository the form left", () => {
    // The reverse of 2_2's case. A lookup that fell back to the standing
    // selection whenever the current repo's record had no holder could not tell
    // "free here" from "absent here", so it kept naming the other repo's
    // directory and refused a legitimate create.
    const { q, submitted } = open({
      repos: [
        createDefaults({ refs: { list: [{ name: "feat/x", heldBy: "spike" }], truncated: false } }),
        createDefaults({
          repoId: "/other/.git",
          repoLabel: "other",
          agents: [],
          refs: { list: [{ name: "feat/x" }], truncated: false },
        }),
      ],
    });
    type(q<HTMLInputElement>("#wt-branch"), "feat/x");
    expect(create(q).disabled).toBe(true);

    switchRepo(q);

    expect(create(q).disabled).toBe(false);
    create(q).click();
    expect(submitted[0]).toMatchObject({ branchMode: "existing", branchName: "feat/x" });
  });

  it("re-asks the question when detached is switched back off", () => {
    // `choice` is not maintained under detached, and a list can land while it
    // is on. Handing the mode back to the box without re-deriving restored
    // whatever was true before.
    let apply: ((repoId: string, refs: { list: { name: string }[]; truncated: boolean }) => void) | undefined;
    const { q, submitted } = open({
      bindRefs: (fn) => {
        apply = fn as typeof apply;
      },
    });
    type(q<HTMLInputElement>("#wt-branch"), "feat/x");
    q<HTMLButtonElement>(".wt-advanced-toggle").click();
    q<HTMLButtonElement>("#wt-detached").click();

    apply?.(REPO_ID, { list: [{ name: "feat/x" }], truncated: false });
    q<HTMLButtonElement>("#wt-detached").click();
    create(q).click();

    expect(submitted[0]).toMatchObject({ branchMode: "existing", branchName: "feat/x" });
  });

  it("says why a held row was refused from the keyboard (round-1 S2)", () => {
    const { q } = open({
      repos: [createDefaults({ refs: { list: [{ name: "fix/lock", heldBy: "lock-spike" }], truncated: false } })],
    });
    const input = q<HTMLInputElement>("#wt-branch");
    type(input, "fix");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(q<HTMLElement>(".wt-ferror").hidden).toBe(false);
    expect(q<HTMLElement>(".wt-ferror").textContent).toContain("lock-spike");
  });

  it("points the combobox at the partial notice (round-1 S1)", () => {
    const { q } = open({ repos: [createDefaults({ refs: { list: [], truncated: true } })] });

    expect(q<HTMLInputElement>("#wt-branch").getAttribute("aria-describedby")).toBe("wt-branch-partial");
  });
});

// ── The base ref is refused where the mode cannot apply it (§ 2.1, D5) ────

describe("the base ref states when it cannot apply", () => {
  const RESOLVED_REFS = [{ name: "main" }, { name: "feat/search" }, { name: "fix/lock", heldBy: "lock-spike" }];

  function withResolution(over: Partial<Parameters<typeof openWorktreeCreateDialog>[1]> = {}) {
    let apply: ((resolution: WorktreeCreateResolutionMessage) => void) | undefined;
    const h = open({
      repos: [createDefaults({ refs: { list: RESOLVED_REFS, truncated: false } })],
      bindResolution: (fn) => {
        apply = fn;
      },
      ...over,
    });
    return {
      ...h,
      base: () => h.q<HTMLInputElement>("#wt-base"),
      note: () => h.q<HTMLElement>("#wt-base-note"),
      resolve: (msg: Partial<WorktreeCreateResolutionMessage> & { mode: WorktreeCreateResolutionMessage["mode"] }) =>
        apply?.({
          type: "worktreeCreateResolution",
          repoId: REPO_ID,
          token: 1,
          seq: 0,
          query: "feat/search",
          freePath: "/trees/repo-feat-search",
          ...msg,
        }),
    };
  }

  it("offers the base ref for a branch nothing has heard of", () => {
    const h = withResolution();
    type(h.q<HTMLInputElement>("#wt-branch"), "brand-new");

    expect(h.base().disabled).toBe(false);
    expect(h.note().hidden).toBe(true);
  });

  it("refuses the base ref for an existing branch, and says why", () => {
    const h = withResolution();
    type(h.q<HTMLInputElement>("#wt-branch"), "feat/search");

    expect(h.base().disabled).toBe(true);
    expect(h.note().hidden).toBe(false);
    expect(h.note().textContent).toContain("already exists");
  });

  it("refuses the base ref for a repair, with its own reason", () => {
    const h = withResolution();
    type(h.q<HTMLInputElement>("#wt-branch"), "feat/search");
    h.resolve({ mode: { kind: "reattach", repairPath: "/trees/stale", expectedOid: "abc" } });

    expect(h.base().disabled).toBe(true);
    expect(h.note().textContent).toContain("already on disk");
  });

  it("keeps the base ref for a detached create, which is the one that needs it", () => {
    const h = withResolution();
    h.q<HTMLButtonElement>("#wt-detached").click();

    expect(h.base().disabled).toBe(false);
    expect(h.note().hidden).toBe(true);
  });

  it("does not hide the control it disables", () => {
    // A field that vanishes when the mode changes reads as a bug rather than
    // as a rule (D5).
    const h = withResolution();
    type(h.q<HTMLInputElement>("#wt-branch"), "feat/search");

    expect(h.base().hidden).toBe(false);
    expect(h.base().isConnected).toBe(true);
  });

  it("ignores a resolution for a query the user has typed past", () => {
    const h = withResolution();
    type(h.q<HTMLInputElement>("#wt-branch"), "brand-new");
    h.resolve({ query: "feat/search", mode: { kind: "reattach", repairPath: "/x", expectedOid: "abc" } });

    expect(h.base().disabled, "a stale answer disabled the base ref").toBe(false);
  });

  it("lets the user's own detached toggle outrank a classification of the text", () => {
    const h = withResolution();
    type(h.q<HTMLInputElement>("#wt-branch"), "feat/search");
    h.q<HTMLButtonElement>("#wt-detached").click();
    h.resolve({ query: "feat/search", mode: { kind: "reattach", repairPath: "/x", expectedOid: "abc" } });

    expect(h.base().disabled).toBe(false);
  });

  it("lets a corroborated repair submit the branch its own stale registration holds", () => {
    // `heldBy` comes from the listing, which reports a prunable holder exactly
    // like a live one. Without the repair exception the guard that stops a
    // branch being checked out twice also stops the one action that fixes the
    // registration, and reattach could never be reached at all.
    const h = withResolution();
    type(h.q<HTMLInputElement>("#wt-branch"), "fix/lock");
    expect(h.q<HTMLButtonElement>(".wt-btn--primary").disabled, "the setup never armed the held-branch guard").toBe(
      true,
    );

    h.resolve({ query: "fix/lock", mode: { kind: "reattach", repairPath: "/trees/lock-spike", expectedOid: "abc" } });

    expect(h.q<HTMLButtonElement>(".wt-btn--primary").disabled).toBe(false);
  });

  it("still refuses a branch a LIVE worktree holds", () => {
    // The exception above is for the repair and nothing else: a resolution
    // that did not say `reattach` leaves the guard exactly where it was.
    const h = withResolution();
    type(h.q<HTMLInputElement>("#wt-branch"), "fix/lock");
    h.resolve({ query: "fix/lock", mode: { kind: "reuse" }, blockedBy: { ownerPath: "/trees/lock-spike" } });

    expect(h.q<HTMLButtonElement>(".wt-btn--primary").disabled).toBe(true);
  });

  it("ignores a resolution for another repository", () => {
    const h = withResolution();
    type(h.q<HTMLInputElement>("#wt-branch"), "feat/search");
    h.resolve({
      repoId: "/other/.git",
      mode: { kind: "reattach", repairPath: "/x", expectedOid: "abc" },
    });

    // Still `existing` — the repair reason would have replaced this one.
    expect(h.note().textContent).toContain("already exists");
  });
});
