// @vitest-environment jsdom

// The create form, against docs/ui/worktree.html § 9 (default) and § 10 (invalid
// branch, collided path, agent picker expanded).

import { afterEach, describe, expect, it } from "vitest";
import { openWorktreeCreateDialog, sanitizeBranchForPath } from "./WorktreeCreateDialog";
import { createDefaults } from "./worktreeFixtures";
import type { WorktreeCreateDraft } from "./worktreeViewTypes";

afterEach(() => {
  document.body.replaceChildren();
});

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
    const controls = [...host.querySelectorAll<HTMLElement>(".wt-dialog input, .wt-dialog select, .wt-dialog textarea")];
    expect(controls[0]?.id).toBe("wt-branch");
    expect(document.activeElement).toBe(q("#wt-branch"));
  });

  it("keeps the branch first even where the repository picker exists", () => {
    // The picker is the one control that used to sit above the lead input, and a
    // single-repo fixture is exactly what would hide its return.
    const { host } = open({
      repos: [createDefaults(), createDefaults({ repoId: "/other/.git", repoLabel: "other" })],
    });
    const controls = [...host.querySelectorAll<HTMLElement>(".wt-dialog input, .wt-dialog select, .wt-dialog textarea")];
    expect(controls[0]?.id).toBe("wt-branch");
    expect(controls.map((c) => c.id)).toContain("wt-repo-select");
  });

  it("states the destination once, shortened, with the exact value on the element", () => {
    const { host, q } = resolved();
    const dest = q<HTMLElement>(".wt-dest");
    expect(host.querySelectorAll(".wt-dest")).toHaveLength(1);
    // Shortened for reading; the exact value is what the element announces and
    // what its tooltip carries, so it never leaves the dialog to be checked.
    expect(dest.textContent).toBe("…/ai-oss/anywhere-terminal-feat-x");
    expect(dest.getAttribute("aria-label")).toBe(FULL);
    // `attachTooltip` listens for focus but does not make its target focusable —
    // without this the exact value is reachable by mouse only.
    expect(dest.tabIndex).toBe(0);
  });

  it("does not state a full path outside the advanced override", () => {
    const { host } = resolved();
    const advanced = host.querySelector(".wt-advanced-body");
    const statesFull = [...host.querySelectorAll<HTMLElement>(".wt-dialog *")].filter(
      (el) => el.children.length === 0 && (el.textContent ?? "").includes(FULL) && !advanced?.contains(el),
    );
    expect(statesFull).toHaveLength(0);
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
    expect(host).toBeDefined();
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
    const { host, q } = open();
    const trapped = (): HTMLElement[] =>
      [...host.querySelectorAll<HTMLElement>('.wt-dialog input, .wt-dialog select, .wt-dialog button, .wt-dialog [tabindex]:not([tabindex="-1"])')].filter(
        (el) => !el.closest("[hidden]") && !(el instanceof HTMLButtonElement && el.disabled),
      );
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
    expect(q === undefined).toBe(false);
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
      const { q, submitted } = open();
      choose(q, choice);
      if (mode !== undefined) {
        const sel = q<HTMLSelectElement>("#wt-folder-mode");
        sel.value = mode;
        sel.dispatchEvent(new Event("change"));
      }
      type(q<HTMLInputElement>("#wt-branch"), "feat/x");
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
