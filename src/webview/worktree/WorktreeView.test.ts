// @vitest-environment jsdom

// The Worktree body, state by state against docs/ui/worktree.html and the test
// cases in docs/design/worktree-panel-ui.md § 9. The assertions that matter most
// are the truthfulness ones — no path on a row, no icon without proven identity,
// no live dot on history, no focus offered on an external row.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ICON_TERMINAL } from "../vault/icons";
import type { WorktreeMenuActions } from "./WorktreeContextMenu";
import { MAX_WORKTREES_PER_REPO, WorktreeView, type WorktreeViewDeps } from "./WorktreeView";
import {
  agentRow,
  confirmableBlocker,
  createDefaults,
  gitGoneWithRetainedTree,
  gitMissingTree,
  noRepoTree,
  refusedBlocker,
  removeErrorResult,
  removeIndeterminateResult,
  singleRepoPresence,
  singleRepoTree,
  twoRepoTree,
  worktree,
} from "./worktreeFixtures";
import type {
  DelegationRoster,
  WorktreeActionResult,
  WorktreeAgentRow,
  WorktreeInfo,
  WorktreePresence,
  WorktreeRowActivation,
  WorktreeTree,
} from "./worktreeViewTypes";

const NOW = 1_700_000_000_000;
const MAIN_PATH = "/Users/dev/Projects/ai-oss/anywhere-terminal";
const PANEL_WT = "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/worktree-panel";

afterEach(() => {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function noopActions(): WorktreeMenuActions {
  const noop = (): void => {};
  return {
    openFolderInNewWindow: noop,
    addFolderToWorkspace: noop,
    openTerminalHere: noop,
    revealWorktree: noop,
    copyWorktreePath: noop,
    toggleLock: noop,
    removeWorktree: noop,
    focusPane: noop,
    openPreview: noop,
    resumeHere: noop,
    copyResumeCommand: noop,
    revealAgentCwd: noop,
    copyAgentPath: noop,
  };
}

function mount(over: Partial<WorktreeViewDeps> = {}): { view: WorktreeView; host: HTMLElement } {
  const host = document.createElement("div");
  host.className = "vault-panel";
  document.body.appendChild(host);
  const view = new WorktreeView({
    host,
    actions: noopActions(),
    onActivateAgent: () => {},
    now: () => NOW,
    ...over,
  });
  host.appendChild(view.element);
  return { view, host };
}

function populated(over: Partial<{ tree: WorktreeTree; presence: WorktreePresence }> = {}) {
  return {
    tree: over.tree ?? singleRepoTree(),
    presence: over.presence ?? singleRepoPresence(NOW),
  };
}

function rowFor(view: WorktreeView, branch: string): HTMLElement | undefined {
  return Array.from(view.element.querySelectorAll<HTMLElement>(".wt-row")).find(
    (r) => r.querySelector(".wt-branch")?.textContent === branch,
  );
}

// ── § 3: first load, refresh, and the three empty causes ──────────────────

describe("loading and empty states", () => {
  it("renders skeleton rows on first load, never a spinner in a void", () => {
    const { view } = mount();
    view.setData({ tree: null, presence: null, loading: true });
    expect(view.element.querySelectorAll(".wt-skel").length).toBeGreaterThan(0);
    expect(view.element.getAttribute("aria-busy")).toBe("true");
  });

  it("keeps the tree on a refresh and marks it quietly", () => {
    const { view } = mount();
    view.setData({ ...populated(), refreshing: true });
    expect(view.element.querySelectorAll(".wt-skel")).toHaveLength(0);
    expect(view.element.querySelector(".wt-refreshing")).not.toBeNull();
    expect(view.element.querySelectorAll(".wt-row").length).toBeGreaterThan(0);
  });

  it("gives each empty cause its own copy and no error styling", () => {
    const cases: [Partial<Parameters<WorktreeView["setData"]>[0]>, string][] = [
      [{ tree: noRepoTree(), presence: null, noFolder: true }, "No folder open"],
      [{ tree: noRepoTree(), presence: null }, "No git repository"],
      [{ tree: gitMissingTree(), presence: null }, "Git not found"],
    ];
    for (const [data, title] of cases) {
      const { view } = mount();
      view.setData({ tree: null, presence: null, ...data } as Parameters<WorktreeView["setData"]>[0]);
      expect(view.element.querySelector(".vault-empty-title")?.textContent).toBe(title);
      expect(view.element.querySelector(".wt-notice")).toBeNull();
    }
  });

  // Audit A2: the cache retains the last good listing when git goes away, and
  // the view used to hide it behind the "Git not found" empty state.
  it("[I1] shows a retained listing under a staleness notice instead of an empty state", () => {
    const { view } = mount();
    view.setData({ tree: gitGoneWithRetainedTree(), presence: null });

    expect(view.element.querySelector(".vault-empty-title")).toBeNull();
    expect(view.element.querySelectorAll(".wt-row").length).toBeGreaterThan(0);

    const notice = view.element.querySelector(".wt-notice");
    expect(notice?.textContent).toContain("Git is unavailable");
    expect(notice?.getAttribute("role")).toBe("status");
    expect(notice?.textContent).toContain("2.31");
  });

  it("still shows the git-not-found empty state when nothing was retained", () => {
    const { view } = mount();
    view.setData({ tree: gitMissingTree(), presence: null });
    expect(view.element.querySelector(".vault-empty-title")?.textContent).toBe("Git not found");
  });

  it("names git once at tree scope, and leaves each repo its own degraded affordance", () => {
    const { view } = mount();
    view.setData({ tree: gitGoneWithRetainedTree(), presence: null });

    const notices = [...view.element.querySelectorAll(".wt-notice")];
    // Tree scope and repo scope are different claims and the spec requires both:
    // "git is gone" is not the same statement as "this repository is stale".
    const gitNotices = notices.filter((n) => n.textContent?.includes("Git is unavailable"));
    expect(gitNotices).toHaveLength(1);
    expect(notices.length).toBeGreaterThan(gitNotices.length);
  });
});

// ── § 1 / § 2: the tree itself ────────────────────────────────────────────

describe("tree structure", () => {
  it("renders no group header for a single repo, and one per repo for two", () => {
    const { view } = mount();
    view.setData(populated());
    expect(view.element.querySelectorAll(".wt-repo")).toHaveLength(0);

    const { view: multi } = mount();
    multi.setData({ tree: twoRepoTree(), presence: null });
    expect(Array.from(multi.element.querySelectorAll(".wt-repo-name")).map((e) => e.textContent)).toEqual([
      "anywhere-terminal",
      "cyberk-skills",
    ]);
  });

  it("never renders a filesystem path at any level", () => {
    const { view } = mount();
    view.setData(populated());
    expect(view.element.textContent).not.toContain(MAIN_PATH);
    // It is reachable from the tooltip instead.
    expect(rowFor(view, "main")?.title).toContain(MAIN_PATH);
  });

  it("renders a zero-agent worktree with no twisty and no presence element", () => {
    const { view } = mount();
    view.setData(populated());
    const row = rowFor(view, "asimov-validator-autofix");
    expect(row).toBeDefined();
    expect(row?.hasAttribute("aria-expanded")).toBe(false);
    expect(row?.parentElement?.classList.contains("wt-card")).toBe(false);
  });

  it("labels a detached worktree by its short sha and a bare one as bare", () => {
    const { view } = mount();
    view.setData(populated());
    expect(view.element.querySelector(".wt-branch--sha")?.textContent).toBe("9f2c1ab");
    const { view: two } = mount();
    two.setData({ tree: twoRepoTree(), presence: null });
    expect(two.element.querySelector(".wt-branch--bare")?.textContent).toBe("bare");
  });

  it("reads the strongest agent state on the worktree glyph", () => {
    const { view } = mount();
    view.setData(populated());
    // `main` holds one waiting agent among running ones — it must read as waiting.
    const glyph = rowFor(view, "main")?.querySelector(".wt-glyph .wt-state");
    expect(glyph?.className).toContain("wt-state--waiting");
  });

  it("wraps an expanded worktree and its agent rows in one card", () => {
    const { view } = mount();
    view.setData(populated());
    const card = view.element.querySelector(".wt-card");
    expect(card?.querySelector(".wt-branch")?.textContent).toBe("main");
    expect(card?.querySelectorAll(".wt-arow").length).toBe(5);
  });

  it("caps a large repo with a Show all affordance rather than truncating silently", () => {
    const many: WorktreeInfo[] = Array.from({ length: 34 }, (_, i) =>
      worktree({ id: `/wt/${i}`, branch: `feat/${i}`, head: "a".repeat(40) }),
    );
    const tree: WorktreeTree = {
      gitAvailable: true,
      unreadable: { count: 0, reasons: [] },
      repos: [{ repoId: "/r/.git", label: "r", mainPath: "/r", worktrees: many }],
    };
    const { view } = mount();
    view.setData({ tree, presence: null });
    // The cap itself, not just the affordance: raising the slice by one used to leave every
    // assertion here green, which is the fifth acceptance clause going unverified (round-4 B14).
    expect(view.element.querySelectorAll(".wt-row")).toHaveLength(MAX_WORKTREES_PER_REPO);
    const showAll = view.element.querySelector<HTMLButtonElement>(".wt-showall");
    expect(showAll?.textContent).toBe("Show all 34 worktrees");
    showAll?.click();
    expect(view.element.querySelectorAll(".wt-row")).toHaveLength(34);
    expect(view.element.querySelector(".wt-showall"), "the affordance survives expansion").toBeNull();
  });
});

// ── § 3.5: the two independent disclosure levels ──────────────────────────

describe("presence disclosure", () => {
  it("renders the collapsed pill with grouped dots and a +N overflow", () => {
    const { view } = mount();
    view.setData(populated());
    const pill = view.element.querySelector(".wt-presence");
    expect(pill).not.toBeNull();
    expect(pill?.querySelectorAll(".wt-pgroup")).toHaveLength(2);
    expect(pill?.querySelector(".wt-pgroup-more")?.textContent).toBe("+2");
  });

  it("keeps a nine-agent pill the same height as a two-agent one", () => {
    const nine: WorktreePresence = {
      scannedAt: NOW,
      degradedSources: [],
      rowsByWorktreeId: {
        [PANEL_WT]: Array.from({ length: 9 }, (_, i) =>
          agentRow({ rowId: `n${i}`, agent: "claude", activity: "running" }),
        ),
      },
    };
    const { view } = mount();
    view.setData({ tree: singleRepoTree(), presence: nine });
    const pill = view.element.querySelector(".wt-presence");
    // One group, three icons, the rest as a count — the pill never grows a row.
    expect(pill?.querySelectorAll(".wt-pgroup")).toHaveLength(1);
    expect(pill?.querySelectorAll(".wt-pgroup-icons .vault-badge")).toHaveLength(3);
    expect(pill?.querySelector(".wt-pgroup-more")?.textContent).toBe("+6");
  });

  it("expands the pill into an N agents header plus one row per agent", () => {
    const { view } = mount();
    view.setData(populated());
    view.element.querySelector<HTMLButtonElement>(".wt-presence")?.click();
    const headers = Array.from(view.element.querySelectorAll(".wt-agents")).map((e) => e.textContent);
    expect(headers.some((t) => t?.startsWith("7 agents"))).toBe(true);
    // The header is a mouse affordance; the count reaches assistive tech from the row.
    expect(rowFor(view, "feat/worktree-panel")?.getAttribute("aria-label")).toBe("feat/worktree-panel, 7 agents");
  });

  it("keeps per-agent expansion when the worktree collapses and back", () => {
    const persistedCollapsed: string[][] = [];
    const persistedRows: string[][] = [];
    const { view } = mount({
      persistCollapsed: (ids) => persistedCollapsed.push(ids),
      persistExpandedRows: (ids) => persistedRows.push(ids),
    });
    view.setData(populated());

    // Level two: open the first agent row's subagents.
    view.element.querySelector<HTMLElement>(".wt-arow .wt-gutter")?.click();
    expect(view.element.querySelector(".wt-hist")).not.toBeNull();
    expect(persistedRows.at(-1)).toEqual(["main-claude"]);

    // Level one: collapse the worktree. The row expansion must survive it.
    rowFor(view, "main")?.click();
    expect(view.element.querySelector(".wt-card")).toBeNull();
    expect(persistedCollapsed.at(-1)).toContain(MAIN_PATH);
    expect(persistedRows.at(-1)).toEqual(["main-claude"]);

    rowFor(view, "main")?.click();
    expect(view.element.querySelector(".wt-hist")).not.toBeNull();
  });

  it("restores both persisted levels on construction", () => {
    // A restored set is authoritative in both directions: `main` stays collapsed
    // despite being the workspace folder, and the worktree it omits stays expanded.
    const { view } = mount({
      getInitialCollapsed: () => [MAIN_PATH],
      getInitialExpandedRows: () => ["main-claude"],
    });
    view.setData(populated());
    expect(rowFor(view, "main")?.parentElement?.classList.contains("wt-card")).toBe(false);
    expect(view.element.querySelectorAll(".wt-presence").length).toBe(1);
    expect(rowFor(view, "feat/worktree-panel")?.parentElement?.classList.contains("wt-card")).toBe(true);
  });

  it("drops expansion state for a worktree that disappeared", () => {
    const persisted: string[][] = [];
    const { view } = mount({
      getInitialCollapsed: () => ["/gone/worktree"],
      persistCollapsed: (ids) => persisted.push(ids),
    });
    view.setData(populated());
    expect(persisted.at(-1)).not.toContain("/gone/worktree");
  });
});

// ── § 3.3: the agent row ──────────────────────────────────────────────────

describe("agent rows", () => {
  function agentRows(view: WorktreeView): HTMLElement[] {
    return Array.from(view.element.querySelectorAll<HTMLElement>(".wt-arow"));
  }

  it("reserves the disclosure gutter even with no children, so dots stay aligned", () => {
    const { view } = mount();
    view.setData(populated());
    const rows = agentRows(view);
    expect(rows.every((r) => r.querySelector(".wt-gutter") !== null)).toBe(true);
    expect(rows[1]?.querySelector(".wt-gutter")?.innerHTML).toBe("");
  });

  // The [I2] tag moved to the composed test in webview/integration/paneEvidenceReporting.test.ts
  // (design.md D5). This builds its row by hand, so it proves the renderer honours
  // `agentSource` — it cannot prove production ever sets it to anything but "launch".
  it("shows no agent icon when identity is unproven", () => {
    const { view } = mount();
    view.setData(populated());
    const shell = agentRows(view).find((r) => r.querySelector(".wt-atitle")?.textContent?.startsWith("zsh"));
    // `shell?.…` on a missing row yields undefined, and `expect(undefined).not.toBeNull()`
    // passes — so the row has to be pinned before anything is asked of it (round-4 B2).
    expect(shell, "no unproven-identity row in the fixture").toBeDefined();
    const icon = shell?.querySelector<HTMLElement>(".wt-aicon");
    expect(icon).not.toBeNull();
    // The three things that separate a plain terminal glyph from a brand badge: the glyph
    // is the shared terminal icon, no brand name reaches the tooltip, and no agent accent
    // reaches the style attribute. Asserting only "some svg is present" cannot tell a
    // terminal glyph from the Claude mark.
    // Through a parse on both sides: jsdom rewrites `<rect …/>` to `<rect …></rect>`, so
    // comparing rendered markup against the raw constant fails on the serializer, not the claim.
    const expected = document.createElement("span");
    expected.innerHTML = ICON_TERMINAL;
    expect(icon?.innerHTML).toBe(expected.innerHTML);
    expect(icon?.title).toBe("");
    expect(icon?.style.color).toBe("");
  });

  it("marks a fallback activity source without touching the icon", () => {
    const { view } = mount();
    view.setData(populated());
    const row = agentRows(view).find((r) => r.querySelector(".wt-atitle")?.textContent?.includes("opencode"));
    expect(row?.querySelector(".wt-confidence")?.textContent).toBe("~");
    // Identity was proven by `process`, so the icon stays: the two are independent.
    expect(row?.querySelector<HTMLElement>(".wt-aicon")?.style.color).toContain("--vault-accent-opencode");
  });

  it("omits the model chip when the model is unknown, never a placeholder", () => {
    const { view } = mount();
    view.setData(populated());
    const rows = agentRows(view);
    expect(rows[0]?.querySelector(".wt-model")?.textContent).toBe("sonnet-4-6");
    const noModel = rows.find((r) => r.querySelector(".wt-atitle")?.textContent?.startsWith("zsh"));
    expect(noModel?.querySelector(".wt-model")).toBeNull();
  });

  it("[I3] labels an external row and gives it no focus affordance", () => {
    const { view } = mount();
    view.setData(populated());
    const external = agentRows(view).find((r) => r.querySelector(".wt-scope"));
    expect(external?.querySelector(".wt-scope")?.textContent).toContain("other window");

    const external2 = external;
    if (!external2) {
      throw new Error("external row missing");
    }
    external2.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const labels = Array.from(document.querySelectorAll(".vault-context-menu button")).map((b) => b.textContent);
    // Absent, not disabled — there is no pane in this window to reveal.
    expect(labels).not.toContain("Focus Pane");
    expect(labels).toContain("Open Session Preview");
  });

  it("offers Focus Pane on a window-scope row", () => {
    const { view } = mount();
    view.setData(populated());
    const row = agentRows(view)[0];
    row?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const labels = Array.from(document.querySelectorAll(".vault-context-menu button")).map((b) => b.textContent);
    expect(labels).toContain("Focus Pane");
  });

  it("shows +N while children are collapsed and drops it once they are visible", () => {
    const { view } = mount();
    view.setData(populated());
    expect(agentRows(view)[0]?.querySelector(".wt-count")?.textContent).toBe("+2");
    view.element.querySelector<HTMLElement>(".wt-arow .wt-gutter")?.click();
    expect(agentRows(view)[0]?.querySelector(".wt-count")?.textContent).toBeUndefined();
  });
});

// ── § 3.4: subagents are history ──────────────────────────────────────────

describe("subagent rows", () => {
  it("[I5] render in a historical treatment, never the live dot vocabulary", () => {
    const { view } = mount({ getInitialExpandedRows: () => ["main-claude"] });
    view.setData(populated());
    const hist = view.element.querySelector(".wt-hist");
    expect(hist?.querySelector(".wt-hist-label")?.textContent).toBe("Past delegations");
    expect(hist?.querySelectorAll(".wt-state")).toHaveLength(0);
    const srows = [...(hist?.querySelectorAll<HTMLElement>(".wt-srow") ?? [])];
    expect(srows).toHaveLength(2);
    expect(hist?.querySelector(".wt-outcome--failed")).not.toBeNull();
    // Round-4, specialist-direct: counting the rows and checking the label left the actual
    // claim — that a transcript row never presents as live — asserted nowhere under this tag.
    // The live path stamps `data-live="true"` (asserted in the live-roster case below), so
    // its absence here is the invariant, not an unset attribute nobody writes.
    expect(srows.filter((r) => r.dataset.live === "true")).toEqual([]);
    expect(hist?.querySelector(".wt-outcome--live")).toBeNull();
  });

  it("render a reported roster as live work rather than as history", () => {
    // The label, the rail and the glyph all had to change: a signature fix alone
    // left live delegations looking exactly like transcript history
    // (.reviews/round-2.md W3).
    const { view } = mount({ getInitialExpandedRows: () => ["main-claude"] });
    view.setData(
      withRoster({
        kind: "ok",
        reported: true,
        rows: [{ name: "explorer", title: "Map the seam", status: "running", live: true }],
      }),
    );

    const hist = view.element.querySelector(".wt-hist");
    expect(hist?.classList.contains("wt-hist-live")).toBe(true);
    expect(hist?.querySelector(".wt-hist-label")?.textContent).toBe("Delegations");
    expect(hist?.querySelector(".wt-outcome--live")).not.toBeNull();
    expect(hist?.querySelector(".wt-outcome--done")).toBeNull();
    expect(hist?.querySelector<HTMLElement>(".wt-srow")?.dataset.live).toBe("true");
    // Colour and glyph are the whole visual distinction, and neither reaches a
    // screen reader — so running work must say so (.reviews/round-3.md W3).
    const glyph = hist?.querySelector(".wt-outcome--live");
    expect(glyph?.getAttribute("aria-label")).toBe("running");
    expect(glyph?.hasAttribute("aria-hidden")).toBe(false);
  });

  it("calls a reported roster with no delegations live, not past", () => {
    // An agent reporting no delegations has reported about NOW. Deriving the
    // label from the rows would call that empty answer history.
    const { view } = mount({ getInitialExpandedRows: () => ["main-claude"] });
    view.setData(withRoster({ kind: "ok", reported: true, rows: [] }));

    const hist = view.element.querySelector(".wt-hist");
    expect(hist?.querySelector(".wt-hist-label")?.textContent).toBe("Delegations");
    expect(hist?.querySelector(".wt-hist-note")?.textContent).toBe("No delegations found");
  });

  // Tagged [I5] because this is the case where the two sources disagree: the row says
  // `status: "running"` and `live: false`, and history must follow `live`.
  it("[I5] still calls a transcript roster past, whatever it recorded", () => {
    const { view } = mount({ getInitialExpandedRows: () => ["main-claude"] });
    view.setData(withRoster({ kind: "ok", rows: [{ name: "librarian", status: "running", live: false }] }));

    const hist = view.element.querySelector(".wt-hist");
    expect(hist?.classList.contains("wt-hist-live")).toBe(false);
    expect(hist?.querySelector(".wt-hist-label")?.textContent).toBe("Past delegations");
    expect(hist?.querySelector(".wt-outcome--live")).toBeNull();
  });

  it("[I11] render no agent icon and nest exactly one level", () => {
    const { view } = mount({ getInitialExpandedRows: () => ["main-claude"] });
    view.setData(populated());
    const hist = view.element.querySelector(".wt-hist");
    expect(hist?.querySelector(".wt-aicon")).toBeNull();
    expect(hist?.querySelector(".wt-hist")).toBeNull();
  });

  it("[I11] carries no pane identity of its own", () => {
    // Round-1 B2: I11 has three clauses and only two were tagged. This is the third — a
    // subagent row is a view of its parent's work, so a paneId on it would make it
    // separately focusable, separately closeable, and separately wrong.
    const { view } = mount({ getInitialExpandedRows: () => ["main-claude"] });
    view.setData(populated());
    // Round-2 B2: this read `.wt-hist`, the CONTAINER, which never carried a paneId to
    // begin with. The rows are `.wt-srow` (worktreeTreeView.ts:485), and they are what the
    // invariant is about.
    const rows = [...view.element.querySelectorAll<HTMLElement>(".wt-srow")];
    expect(rows.length, "no subagent row rendered, so its lack of identity proves nothing").toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.dataset.paneId).toBeUndefined();
    }
  });

  it("[I11] activating one targets the parent's pane", () => {
    const activated: string[] = [];
    const { view } = mount({
      getInitialExpandedRows: () => ["main-claude"],
      onActivateSubagent: (_sub, parent) => activated.push(parent.rowId),
    });
    view.setData(populated());
    view.element.querySelector<HTMLElement>(".wt-srow")?.click();
    expect(activated).toEqual(["main-claude"]);
  });

  it("leads with the delegated task, falling back to the role name", () => {
    const { view } = mount({ getInitialExpandedRows: () => ["main-claude"] });
    view.setData(
      withRoster({
        kind: "ok",
        rows: [
          { name: "reviewer", title: "Review the row anatomy", status: "completed", live: false },
          { name: "librarian", status: "completed", live: false },
        ],
      }),
    );
    expect(subagentTexts(view)).toEqual(["Review the row anatomy", "librarian"]);
  });
});

// ── § 3.4: the four states a lazily-read roster can be in ─────────────────

/** The one presence fixture these need: a single row whose roster the test sets. */
function withRoster(delegations: DelegationRoster | undefined, over: Partial<WorktreeAgentRow> = {}) {
  return {
    tree: singleRepoTree(),
    presence: {
      scannedAt: NOW,
      degradedSources: [],
      rowsByWorktreeId: {
        [MAIN_PATH]: [
          agentRow({
            rowId: "main-claude",
            agent: "claude",
            activity: "waiting",
            activitySource: "hook",
            title: "INTEGRATE-WORKTREE",
            entryId: "claude:abc",
            paneId: "pane-1",
            ...(delegations === undefined ? {} : { delegations }),
            ...over,
          }),
        ],
      },
    } satisfies WorktreePresence,
  };
}

function sectionText(view: WorktreeView): string {
  return view.element.querySelector(".wt-hist")?.textContent ?? "";
}

function subagentTexts(view: WorktreeView): string[] {
  return Array.from(view.element.querySelectorAll(".wt-stext")).map((e) => e.textContent ?? "");
}

describe("the delegation section states", () => {
  it("says it is reading while the answer is still coming", () => {
    const { view } = mount({ getInitialExpandedRows: () => ["main-claude"] });
    view.setData(withRoster(undefined));
    expect(sectionText(view)).toContain("Reading");
    expect(view.element.querySelectorAll(".wt-srow")).toHaveLength(0);
  });

  it("says a read found nothing only once a read actually found nothing", () => {
    const { view } = mount({ getInitialExpandedRows: () => ["main-claude"] });
    view.setData(withRoster({ kind: "ok", rows: [] }));
    expect(sectionText(view)).toContain("No delegations found");
  });

  it("says a failed read failed, and why — never that the session delegated nothing", () => {
    const { view } = mount({ getInitialExpandedRows: () => ["main-claude"] });
    view.setData(withRoster({ kind: "failed", reason: "EACCES /vault" }));
    const text = sectionText(view);
    expect(text).toContain("Could not be read");
    expect(text).toContain("EACCES /vault");
    expect(text).not.toContain("No delegations found");
  });

  it("shows an incomplete roster's rows and admits the rest are unreadable", () => {
    const { view } = mount({ getInitialExpandedRows: () => ["main-claude"] });
    view.setData(
      withRoster({
        kind: "ok",
        rows: [{ name: "librarian", status: "completed", live: false }],
        incomplete: true,
      }),
    );
    expect(view.element.querySelectorAll(".wt-srow")).toHaveLength(1);
    expect(sectionText(view)).toContain("Older delegations could not be read");
  });

  it("does not call an incomplete read empty — that is the one claim it cannot make", () => {
    // The reader said it dropped records, so "No delegations found" would state
    // the one thing it could not observe (design.md D13).
    const { view } = mount({ getInitialExpandedRows: () => ["main-claude"] });
    view.setData(withRoster({ kind: "ok", rows: [], incomplete: true }));
    const text = sectionText(view);
    expect(text).not.toContain("No delegations found");
    expect(text).toContain("could not be read");
  });

  it("makes no such admission for a roster with no evidence of omission", () => {
    const { view } = mount({ getInitialExpandedRows: () => ["main-claude"] });
    view.setData(withRoster({ kind: "ok", rows: [{ name: "librarian", status: "completed", live: false }] }));
    expect(sectionText(view)).not.toContain("could not be read");
  });
});

// ── § 3.3: the disclosure, and the request behind it ──────────────────────

describe("asking the host what a row delegated", () => {
  function arow(view: WorktreeView): HTMLElement | null {
    return view.element.querySelector<HTMLElement>(".wt-arow");
  }

  it("offers the disclosure on a row with a session it has never read", () => {
    // Gating on children already held would leave nothing to click to cause the
    // read, so the row could never get any.
    const { view } = mount();
    view.setData(withRoster(undefined));
    expect(arow(view)?.querySelector(".wt-gutter")?.innerHTML).not.toBe("");
    expect(arow(view)?.getAttribute("aria-expanded")).toBe("false");
  });

  it("offers no disclosure on a row with no session", () => {
    const { view } = mount();
    view.setData(withRoster(undefined, { entryId: undefined }));
    expect(arow(view)?.querySelector(".wt-gutter")?.innerHTML).toBe("");
    expect(arow(view)?.hasAttribute("aria-expanded")).toBe(false);
  });

  it("asks once when the row is expanded, and nothing more when it is re-expanded", () => {
    const asked: string[] = [];
    const { view } = mount({ onRequestSubagents: (row) => asked.push(row.entryId ?? "") });
    view.setData(withRoster(undefined));
    expect(asked).toEqual([]);

    view.element.querySelector<HTMLElement>(".wt-arow .wt-gutter")?.click();
    expect(asked).toEqual(["claude:abc"]);

    view.element.querySelector<HTMLElement>(".wt-arow .wt-gutter")?.click();
    view.element.querySelector<HTMLElement>(".wt-arow .wt-gutter")?.click();
    expect(asked).toEqual(["claude:abc"]);
  });

  it("asks for a row restored into the expanded set, which was never toggled", () => {
    const asked: string[] = [];
    const { view } = mount({
      getInitialExpandedRows: () => ["main-claude"],
      onRequestSubagents: (row) => asked.push(row.entryId ?? ""),
    });
    view.setData(withRoster(undefined));
    expect(asked).toEqual(["claude:abc"]);
  });

  it("asks again for a row that left and returned under the same session", () => {
    // The host evicts its rosters against the rows it publishes, so a view that
    // remembers having asked leaves the returning row on "Reading…" forever (D14).
    const asked: string[] = [];
    const { view } = mount({
      getInitialExpandedRows: () => ["main-claude"],
      onRequestSubagents: (row) => asked.push(row.entryId ?? ""),
    });
    view.setData(withRoster({ kind: "ok", rows: [] }));
    expect(asked).toEqual(["claude:abc"]);

    // Gone, so the host drops its roster and the view drops the expansion.
    view.setData({ tree: singleRepoTree(), presence: { scannedAt: NOW, degradedSources: [], rowsByWorktreeId: {} } });
    // Back under the same identity, and the user expands it again. A permanent
    // asked-set posts nothing here and the row sits on "Reading…" with nothing
    // coming, because the host no longer holds the roster it once sent.
    view.setData(withRoster(undefined));
    view.element.querySelector<HTMLElement>(".wt-arow .wt-gutter")?.click();
    expect(asked).toEqual(["claude:abc", "claude:abc"]);
  });

  it("drops the expansion of a row that lost its session, which has no disclosure to collapse it", () => {
    const { view } = mount({ getInitialExpandedRows: () => ["main-claude"] });
    view.setData(withRoster({ kind: "ok", rows: [{ name: "librarian", status: "completed", live: false }] }));
    expect(view.element.querySelector(".wt-hist")).not.toBeNull();

    view.setData(withRoster(undefined, { entryId: undefined }));
    expect(view.element.querySelector(".wt-hist")).toBeNull();
    expect(view.element.querySelector(".wt-arow")?.hasAttribute("aria-expanded")).toBe(false);
  });

  it("asks again when the same row starts a different session", () => {
    const asked: string[] = [];
    const { view } = mount({
      getInitialExpandedRows: () => ["main-claude"],
      onRequestSubagents: (row) => asked.push(row.entryId ?? ""),
    });
    view.setData(withRoster({ kind: "ok", rows: [] }));
    view.setData(withRoster({ kind: "ok", rows: [] }, { entryId: "claude:second" }));
    expect(asked).toEqual(["claude:abc", "claude:second"]);
  });
});

// ── § 5: degraded data and action results ─────────────────────────────────

describe("notices", () => {
  it("[I8] names the failing source and reason for a degraded repo, and offers Retry", () => {
    const retried: string[] = [];
    const { view } = mount({ onRetryRepo: (id) => retried.push(id) });
    view.setData({ tree: twoRepoTree(), presence: null });
    const notice = view.element.querySelector(".wt-notice--warn");
    expect(notice?.querySelector("b")?.textContent).toBe("Worktree list may be stale.");
    expect(notice?.querySelector(".wt-reason")?.textContent).toContain("exit 128");
    notice?.querySelector<HTMLButtonElement>(".wt-link")?.click();
    expect(retried).toEqual(["/Users/dev/Projects/cyberk-skills/.git"]);
  });

  it("[I8] renders no stale affordance for a genuinely empty result", () => {
    const { view } = mount();
    view.setData(populated());
    expect(view.element.querySelector(".wt-notice")).toBeNull();
  });

  it("renders an indeterminate result distinctly from an error", () => {
    const { view } = mount();
    view.setData({ ...populated(), actionResults: [removeErrorResult, removeIndeterminateResult] });
    const error = view.element.querySelector(".wt-notice--error");
    const indeterminate = view.element.querySelector(".wt-notice--warn");
    expect(error?.querySelector("b")?.textContent).toBe("Couldn't remove this worktree.");
    expect(error?.querySelector(".wt-reason")?.textContent).toContain("use --force to delete it");
    expect(indeterminate?.querySelector("b")?.textContent).toBe("Remove partly applied.");
    expect(indeterminate?.querySelector(".wt-reason")?.textContent).toContain("list still reports the path");
  });

  it("attaches an action notice to the row it concerns", () => {
    const { view } = mount();
    view.setData({ ...populated(), actionResults: [removeErrorResult] });
    const notice = view.element.querySelector(".wt-notice--error");
    const previous = notice?.previousElementSibling as HTMLElement | null;
    expect(previous?.querySelector(".wt-branch")?.textContent).toBe("spike/hooks");
  });

  it("dismisses an action notice", () => {
    const dismissed: string[] = [];
    const { view } = mount({ onDismissActionResult: (r) => dismissed.push(r.action) });
    view.setData({ ...populated(), actionResults: [removeErrorResult] });
    view.element.querySelector<HTMLButtonElement>(".wt-notice--error .wt-dismiss")?.click();
    expect(dismissed).toEqual(["remove"]);
  });

  it("names the unreadable count and its deduplicated reasons separately", () => {
    const tree = singleRepoTree();
    tree.unreadable = { count: 5, reasons: ["EACCES: /a", "ENOENT: /b"] };
    const { view } = mount();
    view.setData({ tree, presence: null });
    const notice = view.element.querySelector(".wt-notice--warn");
    expect(notice?.querySelector("b")?.textContent).toBe("5 paths could not be read.");
    expect(notice?.querySelector(".wt-reason")?.textContent).toBe("EACCES: /a\nENOENT: /b");
  });
});

// ── § 6: search and keyboard ──────────────────────────────────────────────

describe("search", () => {
  it("keeps the ancestors of a match visible", () => {
    const { view } = mount();
    view.setData(populated());
    // "Backpressure" only appears on an agent row inside `main`.
    view.setQuery("backpressure");
    expect(rowFor(view, "main")).toBeDefined();
    expect(rowFor(view, "release/0.4.x")).toBeUndefined();
  });

  it("matches a subagent and keeps its worktree", () => {
    const { view } = mount();
    view.setData(populated());
    view.setQuery("locate the presence spec");
    expect(rowFor(view, "main")).toBeDefined();
  });

  it("matches on path even though no row shows one", () => {
    const { view } = mount();
    view.setData(populated());
    view.setQuery("/volumes/ext");
    expect(rowFor(view, "spike/hooks")).toBeDefined();
    expect(rowFor(view, "main")).toBeUndefined();
  });

  it("renders a no-match state distinct from the empty ones", () => {
    const { view } = mount();
    view.setData(populated());
    view.setQuery("zzzz-nothing");
    expect(view.element.querySelector(".vault-empty-title")?.textContent).toBe("No matching worktrees");
  });
});

describe("keyboard", () => {
  function press(view: WorktreeView, key: string): void {
    view.element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  }

  it("exposes one tab stop and moves within it", () => {
    const { view } = mount();
    view.setData(populated());
    const rows = Array.from(view.element.querySelectorAll<HTMLElement>(".wt-row, .wt-arow"));
    expect(rows.filter((r) => r.tabIndex === 0)).toHaveLength(1);

    rows[0]?.focus();
    press(view, "ArrowDown");
    expect(document.activeElement).toBe(rows[1]);
    press(view, "ArrowUp");
    expect(document.activeElement).toBe(rows[0]);
    press(view, "End");
    expect(document.activeElement).toBe(rows[rows.length - 1]);
    press(view, "Home");
    expect(document.activeElement).toBe(rows[0]);
  });

  it("collapses with ArrowLeft and expands with ArrowRight", () => {
    const { view } = mount();
    view.setData(populated());
    rowFor(view, "main")?.focus();
    press(view, "ArrowLeft");
    expect(view.element.querySelector(".wt-arow")).toBeNull();
    press(view, "ArrowRight");
    expect(view.element.querySelector(".wt-arow")).not.toBeNull();
  });

  it("keeps focus on the row that was toggled, across the re-render", () => {
    // The toggle replaces every child, so without restoration focus falls to
    // <body> and the user loses their place on each disclosure.
    const { view } = mount();
    view.setData(populated());
    rowFor(view, "main")?.focus();
    press(view, "ArrowLeft");
    expect(document.activeElement).toBe(rowFor(view, "main"));
    press(view, "ArrowRight");
    expect(document.activeElement).toBe(rowFor(view, "main"));
  });

  it("ArrowRight on an open node descends to its first child, and stops on a leaf", () => {
    const { view } = mount();
    view.setData(populated());
    const main = rowFor(view, "main");
    main?.focus();
    press(view, "ArrowRight");
    const firstAgent = view.element.querySelector<HTMLElement>(".wt-arow");
    expect(document.activeElement).toBe(firstAgent);

    // A leaf agent row (no subagents) offers nothing to descend into, so Right
    // must not slide sideways to the next row.
    const leaf = Array.from(view.element.querySelectorAll<HTMLElement>(".wt-arow")).find(
      (r) => !r.hasAttribute("aria-expanded"),
    );
    leaf?.focus();
    press(view, "ArrowRight");
    expect(document.activeElement).toBe(leaf);
  });

  it("ArrowLeft from a child goes to its PARENT, not the previous sibling", () => {
    const { view } = mount();
    view.setData(populated());
    const agents = Array.from(view.element.querySelectorAll<HTMLElement>(".wt-arow"));
    const second = agents[1];
    expect(second).toBeDefined();
    second?.focus();
    press(view, "ArrowLeft");
    expect(document.activeElement).toBe(rowFor(view, "main"));
    expect(document.activeElement).not.toBe(agents[0]);
  });
});

// ── § 6.1: the re-render guard ────────────────────────────────────────────

describe("persisted collapse", () => {
  it("treats an empty persisted list as 'everything expanded', not as 'never saved'", () => {
    // `[]` is a user who opened every worktree. Seeding defaults over it would
    // silently collapse the ones that are not workspace folders.
    const { view } = mount({ getInitialCollapsed: () => [] });
    view.setData(populated());
    const branches = Array.from(view.element.querySelectorAll<HTMLElement>(".wt-row")).length;
    expect(branches).toBeGreaterThan(0);
    // Every worktree that HAS agents is expanded, including the non-workspace one.
    expect(view.element.querySelectorAll(".wt-card")).toHaveLength(2);
  });

  it("seeds defaults when nothing was ever persisted", () => {
    const { view } = mount({ getInitialCollapsed: () => undefined });
    view.setData(populated());
    // Only the workspace worktree opens on a first run.
    expect(view.element.querySelectorAll(".wt-card")).toHaveLength(1);
  });

  it("ignores a collapsed repo id when no header exists to reopen it", () => {
    const tree = singleRepoTree();
    const repoId = tree.repos[0]?.repoId ?? "";
    const { view } = mount({ getInitialCollapsed: () => [repoId] });
    view.setData(populated({ tree }));
    // A single repo renders no header, so honouring the id would blank the view
    // with no control left to recover it.
    expect(view.element.querySelectorAll(".wt-row").length).toBeGreaterThan(0);
  });
});

describe("render guard", () => {
  it("does not repaint when only a spinner frame changed", () => {
    const { view } = mount();
    const presence = singleRepoPresence(NOW);
    const first = presence.rowsByWorktreeId[MAIN_PATH]?.[0];
    if (!first) {
      throw new Error("fixture lost its first row");
    }
    first.title = "⠋ INTEGRATE-WORKTREE";
    view.setData({ tree: singleRepoTree(), presence });
    const before = view.element.querySelector(".wt-arow");

    const next = singleRepoPresence(NOW);
    const nextFirst = next.rowsByWorktreeId[MAIN_PATH]?.[0];
    if (!nextFirst) {
      throw new Error("fixture lost its first row");
    }
    nextFirst.title = "⠙ INTEGRATE-WORKTREE";
    view.setData({ tree: singleRepoTree(), presence: next });
    expect(view.element.querySelector(".wt-arow")).toBe(before);
  });

  it("keeps collapse state across a push that changed nothing", () => {
    const { view } = mount();
    view.setData(populated());
    rowFor(view, "main")?.click();
    expect(view.element.querySelector(".wt-presence")).not.toBeNull();
    view.setData(populated());
    expect(view.element.querySelector(".wt-presence")).not.toBeNull();
  });

  it("repaints when a real field moved", () => {
    const { view } = mount();
    view.setData(populated());
    const tree = singleRepoTree();
    const wt = tree.repos[0]?.worktrees[1];
    if (wt) {
      wt.locked = true;
    }
    view.setData({ tree, presence: singleRepoPresence(NOW) });
    expect(view.element.querySelector(".wt-badge--locked")).not.toBeNull();
  });
});

// ── § 5 / § 11 / § 12: the dialogs, reached through the view ──────────────

describe("dialogs", () => {
  it("opens the create form from the view", () => {
    const { view, host } = mount({ createDialogDeps: () => ({ repos: [createDefaults()] }) });
    view.setData(populated());
    view.openCreateDialog();
    expect(host.querySelector(".wt-dialog")?.getAttribute("aria-label")).toBe("Create worktree");
  });

  it("supersedes an open launch dialog rather than stacking one over it", () => {
    // An untracked modal stays mounted under the next one, holding a focus trap
    // and a document listener nothing releases (round-1 W4).
    const { view, host } = mount({ createDialogDeps: () => ({ repos: [createDefaults()] }) });
    view.setData(populated());
    const agents = [{ id: "claude", label: "Claude Code", canSeedPrompt: true, permissionChoices: [] }];
    view.openLaunchDialog("feat/login", agents);
    expect(host.querySelectorAll(".wt-dialog").length).toBe(1);
    view.openCreateDialog();
    expect(host.querySelectorAll(".wt-dialog").length).toBe(1);
    expect(host.querySelector(".wt-dialog")?.getAttribute("aria-label")).toBe("Create worktree");
  });

  it("opens the remove confirmation with every blocker named", () => {
    const { view, host } = mount();
    view.setData(populated());
    const info = singleRepoTree().repos[0]?.worktrees[5];
    if (!info) {
      throw new Error("fixture lost the spike worktree");
    }
    view.openRemoveDialog({ info, blocker: confirmableBlocker });
    // dirty, untracked, idle panes, an external session, and the lock — all five.
    expect(host.querySelectorAll(".wt-blockers li").length).toBe(5);
    expect(host.querySelector(".wt-btn--danger")?.textContent).toBe("Force remove");
  });

  it("refuses instead of confirming when an agent is mid-turn", () => {
    const { view, host } = mount();
    view.setData(populated());
    const info = singleRepoTree().repos[0]?.worktrees[1];
    if (!info) {
      throw new Error("fixture lost the panel worktree");
    }
    view.openRemoveDialog({
      info,
      blocker: refusedBlocker,
      agentRows: [agentRow({ rowId: "busy", agent: "claude", activity: "waiting", title: "INTEGRATE-WORKTREE" })],
    });
    expect(host.querySelector(".wt-refusebox")).not.toBeNull();
    expect(host.querySelector(".wt-btn--danger")).toBeNull();
    expect(host.querySelector(".wt-blockers")).toBeNull();
  });

  it("reopens the confirmation from a blocked action result", () => {
    const { view, host } = mount();
    const info = singleRepoTree().repos[0]?.worktrees[5];
    if (!info) {
      throw new Error("fixture lost the spike worktree");
    }
    view.setData({
      ...populated(),
      actionResults: [{ ...removeErrorResult, needsConfirm: confirmableBlocker }],
    });
    view.element.querySelector<HTMLButtonElement>(".wt-notice--error .wt-link")?.click();
    expect(host.querySelector(".wt-dialog")?.getAttribute("aria-label")).toBe("Remove worktree");
  });
});

// ── § 6: row activation ───────────────────────────────────────────────────

describe("row activation", () => {
  /** A worktree holding exactly the rows a case needs, so ids stay legible. */
  function withRows(rows: WorktreeAgentRow[]): { tree: WorktreeTree; presence: WorktreePresence } {
    return {
      tree: singleRepoTree(),
      presence: { scannedAt: NOW, degradedSources: [], rowsByWorktreeId: { [PANEL_WT]: rows } },
    };
  }

  /** Open the presence pill, then activate one agent row by its id. */
  function activate(view: WorktreeView, rowId: string): void {
    view.element.querySelector<HTMLButtonElement>(".wt-presence")?.click();
    view.element.querySelector<HTMLElement>(`.wt-arow[data-row-id="${rowId}"]`)?.click();
  }

  it("gives a window row whatever the setting says", () => {
    for (const setting of ["focus", "preview"] as const) {
      const seen: Array<[string, string]> = [];
      const { view } = mount({
        rowActivation: () => setting,
        onActivateAgent: (row, activation) => seen.push([row.rowId, activation]),
      });
      view.setData(
        withRows([
          agentRow({ rowId: "w1", scope: "window", entryId: "claude:s1", agent: "claude", activity: "running" }),
        ]),
      );
      activate(view, "w1");
      expect(seen).toEqual([["w1", setting]]);
    }
  });

  it("[I3] opens the preview for an external row under either setting", () => {
    // No pane of that row exists in this window, so `focus` has nothing to name.
    for (const setting of ["focus", "preview"] as const) {
      const seen: string[] = [];
      const { view } = mount({
        rowActivation: () => setting,
        onActivateAgent: (_row, activation) => seen.push(activation),
      });
      view.setData(withRows([agentRow({ rowId: "x1", scope: "external", agent: "claude", activity: "running" })]));
      activate(view, "x1");
      expect(seen, `setting: ${setting}`).toEqual(["preview"]);
    }
  });

  it("focuses when the host supplied no setting at all", () => {
    const seen: string[] = [];
    const { view } = mount({ onActivateAgent: (_row, activation) => seen.push(activation) });
    view.setData(
      withRows([
        agentRow({ rowId: "w1", scope: "window", entryId: "claude:s1", agent: "claude", activity: "running" }),
      ]),
    );
    activate(view, "w1");
    expect(seen).toEqual(["focus"]);
  });

  it("focuses a window row with no session, whatever the setting says", () => {
    // `preview` would be a dead click: there is no vault entry to open, and the
    // row's pane is the one thing it always has (round-1 B3).
    const seen: string[] = [];
    const { view } = mount({
      rowActivation: () => "preview",
      onActivateAgent: (_row, activation) => seen.push(activation),
    });
    view.setData(withRows([agentRow({ rowId: "w1", scope: "window", agent: "claude", activity: "running" })]));
    activate(view, "w1");
    expect(seen).toEqual(["focus"]);
  });

  it("follows a setting that changes while the view is open", () => {
    // Read at the click, not captured at construction — a view already painted
    // must not need a reopen to obey the new value (design.md D5).
    let setting: WorktreeRowActivation = "focus";
    const seen: string[] = [];
    const { view } = mount({
      rowActivation: () => setting,
      onActivateAgent: (_row, activation) => seen.push(activation),
    });
    view.setData(
      withRows([
        agentRow({ rowId: "w1", scope: "window", entryId: "claude:s1", agent: "claude", activity: "running" }),
      ]),
    );
    activate(view, "w1");
    setting = "preview";
    activate(view, "w1");
    expect(seen).toEqual(["focus", "preview"]);
  });
});

describe("a mutation's outcome reads as what it was (design.md D11)", () => {
  it("renders a re-scoped notice under its repository, naming the row it outlived", () => {
    // The row is gone — that is what a successful removal means — so there is
    // nothing left for a worktree-scoped notice to hang on (round-3 B1).
    const { view } = mount();
    view.setData({
      ...populated(),
      actionResults: [
        {
          action: "remove",
          repoId: "/Users/dev/Projects/ai-oss/anywhere-terminal/.git",
          outcome: "ok",
          orphanedLabel: "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/worktree-panel",
        },
      ],
    });
    const notice = view.element.querySelector(".wt-notice");
    expect(notice?.textContent ?? "").toContain("Remove done.");
    expect(notice?.textContent ?? "").toContain("worktree-panel");
  });

  it("says nothing extra when the notice still has a row of its own", () => {
    const { view } = mount();
    view.setData({
      ...populated(),
      actionResults: [
        { action: "remove", worktreeId: "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/release", outcome: "ok" },
      ],
    });
    const notice = view.element.querySelector(".wt-notice");
    expect(notice?.textContent ?? "").toContain("Remove done.");
    expect(notice?.textContent ?? "").not.toContain("/release");
  });

  it("keeps a create that could not be opened a success, and says what failed", () => {
    const { view } = mount();
    view.setData({
      ...populated(),
      actionResults: [
        {
          action: "create",
          repoId: "/Users/dev/Projects/ai-oss/anywhere-terminal/.git",
          outcome: "ok",
          openFailed: "no window available",
        },
      ],
    });
    const notice = view.element.querySelector(".wt-notice");
    expect(notice?.textContent ?? "").toContain("Create done.");
    expect(notice?.textContent ?? "").toContain("no window available");
    expect(notice?.textContent ?? "").not.toMatch(/couldn.t create/i);
  });

  it("offers no retry on a failed mutation", () => {
    // worktree-actions.md § 5: retrying a partially applied git mutation is how
    // a recoverable error becomes an unrecoverable one. The only offered action
    // is the confirmation the blocker set demands.
    const { view } = mount();
    view.setData({ ...populated(), actionResults: [removeErrorResult] });
    const labels = [...view.element.querySelectorAll(".wt-notice--error button")].map((b) => b.textContent ?? "");
    expect(labels.some((l) => /retry|try again/i.test(l))).toBe(false);
  });

  it("offers no retry on an indeterminate one either", () => {
    // This is the case where retrying is most tempting and most dangerous — an
    // unknown fraction of the tree is already gone.
    const { view } = mount();
    view.setData({ ...populated(), actionResults: [removeIndeterminateResult] });
    const labels = [...view.element.querySelectorAll(".wt-notice--warn button")].map((b) => b.textContent ?? "");
    expect(labels.some((l) => /retry|try again/i.test(l))).toBe(false);
  });

  it("does not word an indeterminate result as a clean failure", () => {
    // "Couldn't remove" would claim nothing happened, which is the one thing
    // that is definitely not known.
    const { view } = mount();
    view.setData({ ...populated(), actionResults: [removeIndeterminateResult] });
    const warn = view.element.querySelector(".wt-notice--warn");
    expect(warn?.textContent ?? "").not.toMatch(/couldn.t|failed/i);
  });

  it("carries what was observed, not a generic message", () => {
    const { view } = mount();
    view.setData({ ...populated(), actionResults: [removeIndeterminateResult] });
    expect(view.element.querySelector(".wt-notice--warn .wt-reason")?.textContent ?? "").not.toBe("");
  });
});

describe("an outcome that could not be checked, and one that simply worked", () => {
  const unavailable: WorktreeActionResult = {
    action: "remove",
    worktreeId: "/Volumes/ext/anywhere-terminal-wt/spike-hooks",
    outcome: "unavailable",
    unreadable: ["status", "sessions"],
  };
  const ok: WorktreeActionResult = {
    action: "lock",
    worktreeId: "/Volumes/ext/anywhere-terminal-wt/spike-hooks",
    outcome: "ok",
  };

  it("offers a retry on an unreadable assessment — the one outcome retrying can change", () => {
    const retried: WorktreeActionResult[] = [];
    const { view } = mount({ onRetryAction: (r: WorktreeActionResult) => retried.push(r) });
    view.setData({ ...populated(), actionResults: [unavailable] });
    const button = [...view.element.querySelectorAll<HTMLButtonElement>(".wt-notice--warn button")].find((b) =>
      /retry|try again/i.test(b.textContent ?? ""),
    );
    button?.click();

    expect(retried).toEqual([unavailable]);
  });

  it("names which reads failed rather than saying it could not check", () => {
    const { view } = mount();
    view.setData({ ...populated(), actionResults: [unavailable] });

    expect(view.element.querySelector(".wt-notice--warn .wt-reason")?.textContent ?? "").toContain("status");
  });

  it("says nothing was changed, because nothing was attempted", () => {
    // The distinction that makes this not a failure and not an indeterminate:
    // the removal never ran, so there is no partial state to resolve.
    const { view } = mount();
    view.setData({ ...populated(), actionResults: [unavailable] });

    expect(view.element.querySelector(".wt-notice--warn")?.textContent ?? "").toMatch(/nothing was changed/i);
  });

  it("does not word it as a failure", () => {
    const { view } = mount();
    view.setData({ ...populated(), actionResults: [unavailable] });

    expect(view.element.querySelector(".wt-notice--error")).toBeNull();
  });

  it("still offers no retry on a failure or an indeterminate result", () => {
    // The negative that gives the retry above its meaning: only `unavailable`
    // gets one, so a wired-up retry cannot leak onto the destructive cases.
    const { view } = mount({ onRetryAction: () => {} });
    view.setData({ ...populated(), actionResults: [removeErrorResult, removeIndeterminateResult] });
    const labels = [...view.element.querySelectorAll("button")].map((b) => b.textContent ?? "");

    expect(labels.some((l) => /retry|try again/i.test(l))).toBe(false);
  });

  it("states a success instead of leaving the user to infer it from the tree", () => {
    const { view } = mount();
    view.setData({ ...populated(), actionResults: [ok] });

    expect(view.element.textContent ?? "").toMatch(/lock.*done/i);
  });

  it("offers no retry on a success", () => {
    const { view } = mount({ onRetryAction: () => {} });
    view.setData({ ...populated(), actionResults: [ok] });
    const labels = [...view.element.querySelectorAll("button")].map((b) => b.textContent ?? "");

    expect(labels.some((l) => /retry|try again/i.test(l))).toBe(false);
  });
});
