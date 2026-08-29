// @vitest-environment jsdom

// The create form, against docs/ui/worktree.html § 9 (default) and § 10 (invalid
// branch, collided path, agent picker expanded).

import { afterEach, describe, expect, it, vi } from "vitest";
import { openWorktreeCreateDialog, sanitizeBranchForPath } from "./WorktreeCreateDialog";
import { createDefaults } from "./worktreeFixtures";
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
    const { host, q, submitted } = open();
    // Branch source moved into the disclosure, so reaching it is now a step.
    q<HTMLButtonElement>(".wt-advanced-toggle").click();
    const detached = Array.from(host.querySelectorAll<HTMLButtonElement>(".vault-segmented button")).find(
      (b) => b.dataset.mode === "detached",
    );
    detached?.click();
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
