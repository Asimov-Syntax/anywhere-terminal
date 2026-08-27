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
    const hint = q<HTMLElement>(".wt-fhint").textContent ?? "";
    expect(hint).toContain("-worktree-ui already exists");
    expect(hint).not.toContain("will be created as");
    expect(hint).toContain("a free suffix is chosen");
  });

  it("names the destination once the host has resolved one", () => {
    const { q } = open({
      repos: [createDefaults({ collidedWith: "-worktree-ui", resolvedPath: "/Users/dev/Projects/ai-oss/x-2" })],
    });
    type(q<HTMLInputElement>("#wt-branch"), "feat/worktree-ui");
    const hint = q<HTMLElement>(".wt-fhint").textContent ?? "";
    expect(hint).toContain("will be created as");
    expect(hint).toContain("/Users/dev/Projects/ai-oss/x-2");
  });

  it("switches the required field to the base ref in detached mode", () => {
    const { host, q, submitted } = open();
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
