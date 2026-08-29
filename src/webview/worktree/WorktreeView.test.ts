// @vitest-environment jsdom

// The Worktree body, state by state against docs/ui/worktree.html and the test
// cases in docs/design/worktree-panel-ui.md § 9. The assertions that matter most
// are the truthfulness ones — no path on a row, no icon without proven identity,
// no live dot on history, no focus offered on an external row.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetTooltipForTests } from "../ui/Tooltip";
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
import type { PresentedActivity } from "./worktreeFormat";
import { CONFIRMATION_CEILING_MS } from "./worktreeFormat";
import { unconfirmedHint } from "./worktreeTreeView";
import type {
  DelegationRoster,
  PresenceDegradation,
  WorktreeActionResult,
  WorktreeAgentRow,
  WorktreeInfo,
  WorktreePresence,
  WorktreeRowActivation,
  WorktreeTree,
} from "./worktreeViewTypes";

const NOW = 1_700_000_000_000;
const REPO_ID = "/Users/dev/Projects/ai-oss/anywhere-terminal/.git";
const MAIN_PATH = "/Users/dev/Projects/ai-oss/anywhere-terminal";
const PANEL_WT = "/Users/dev/Projects/ai-oss/anywhere-terminal-wt/worktree-panel";

afterEach(() => {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  resetTooltipForTests();
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
    // The shared fixture holds exactly four agentless worktrees, so it grows an
    // idle tail (§ 3.6). Tests about OTHER contracts get it already presented and
    // therefore open, which is the picture they were written against; the idle
    // tail's own tests mount with their own state.
    getInitialIdleSeeded: () => [REPO_ID],
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
    // Reachable from the tooltip instead — and asserted by hovering, not by reading
    // the attribute. This assertion used to read `.title`, which VS Code webviews
    // never render: it was green while the user saw nothing on hover.
    vi.useFakeTimers();
    try {
      const row = rowFor(view, "main");
      row?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      vi.advanceTimersByTime(300);
      const tip = document.body.querySelector<HTMLElement>(".webview-tooltip");
      expect(tip?.style.display).toBe("block");
      expect(tip?.textContent).toContain(MAIN_PATH);
    } finally {
      vi.useRealTimers();
    }
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

  it("reads unknown, not idle, when every source that decides a row is failing", () => {
    const { view } = mount();
    const presence = singleRepoPresence(NOW);
    view.setData(
      populated({
        presence: {
          ...presence,
          degradedSources: [
            { source: "hook", reason: "socket closed", since: NOW },
            { source: "panes", reason: "scan failed", since: NOW },
            { source: "registry", reason: "spawn ENOENT", since: NOW },
          ],
        },
      }),
    );
    const glyph = rowFor(view, "main")?.querySelector(".wt-glyph .wt-state");
    expect(glyph?.className).toContain("wt-state--unknown");
    expect(glyph?.getAttribute("aria-label")).toBe("An agent's activity is unknown");
    const dots = Array.from(view.element.querySelectorAll(".wt-arow .wt-state"));
    expect(dots.length).toBeGreaterThan(0);
    for (const dot of dots) {
      expect(dot.className).toContain("wt-state--unknown");
      expect(dot.getAttribute("aria-label")).toBe("activity unknown");
    }
  });

  it("turns unknown only the rows the failed source decided, never the whole tree", () => {
    const { view } = mount();
    const presence = singleRepoPresence(NOW);
    // `main` holds a waiting row the REGISTRY decided. The hook going down cannot
    // silence it — that would hide an attention state behind an unrelated outage.
    view.setData(
      populated({
        presence: { ...presence, degradedSources: [{ source: "hook", reason: "socket closed", since: NOW }] },
      }),
    );
    expect(rowFor(view, "main")?.querySelector(".wt-glyph .wt-state")?.className).toContain("wt-state--waiting");
    const dots = Array.from(view.element.querySelectorAll(".wt-arow .wt-state")).map((d) => d.className);
    expect(dots.some((c) => c.includes("wt-state--unknown"))).toBe(true);
    expect(dots.some((c) => c.includes("wt-state--waiting"))).toBe(true);
  });

  it("reads unknown when no source spoke for the row at all", () => {
    const { view } = mount();
    // `activitySource: "none"` is unknown on its own — nothing was degraded, and
    // nothing decided it either, so `idle` would be a claim with no evidence.
    view.setData(populated());
    const dots = Array.from(view.element.querySelectorAll(".wt-arow .wt-state")).map((d) => d.className);
    expect(dots.some((c) => c.includes("wt-state--unknown"))).toBe(true);
  });

  it("[I17] gives each presented state a shape that survives losing colour AND motion", () => {
    // jsdom loads no stylesheet, so the rules are read from source. Two passes:
    // colour tokens collapse to one word, then the animations are removed as the
    // reduced-motion override removes them. The second pass is the one that
    // matters — before this change `running` and `idle` were two hollow circles
    // separated by a border colour, and the first pass alone still passed on it.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const css = fs.readFileSync(path.join(here, "worktreePanel.css"), "utf8");
    // EVERY reduced-motion block, not the first. The file already holds two, and
    // reading only one is the ASSUMPTION — not a missing special case — behind
    // several of the escapes found across three review rounds.
    const reducedBlocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)].map(
      (m) => m[1] ?? "",
    );
    expect(reducedBlocks.length, "no reduced-motion block").toBeGreaterThan(0);
    const reduced = reducedBlocks.join("\n");
    expect(reduced, "no reduced-motion rule").toContain("animation: none");

    /**
     * Every rule targeting this state, in source order — the bare selector, a
     * contextual one like `.wt-glyph .wt-state--x`, a group, all of it. `.exec`
     * returned only the FIRST, so an override written in the pattern this very file
     * already uses for `.wt-glyph .wt-state` applied in the browser and was never
     * read here. `pseudo` keeps the layers apart.
     */
    const declsOf = (block: string, state: string, pseudo = ""): string[] => {
      // Anchored at the END of the class name: `running` is a PREFIX of
      // `running-unconfirmed`, so a substring test silently merged the two states
      // into one shape and collapsed the very distinction under test.
      const targets = new RegExp(`\\.wt-state--${state}(?![\\w-])`);
      const out: string[] = [];
      for (const m of block.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const selector = (m[1] ?? "").trim();
        if (!targets.test(selector)) {
          continue;
        }
        // A group can name the state twice at different layers; only the parts at
        // THIS layer contribute.
        const layerOf = (x: string): string => {
          const hit = /::?(after|before)\b/.exec(x);
          return hit ? `::${hit[1]}` : "";
        };
        const parts = selector
          .split(",")
          .map((x) => x.trim())
          .filter((x) => targets.test(x));
        if (!parts.some((x) => layerOf(x) === pseudo)) {
          continue;
        }
        out.push(
          ...(m[2] ?? "")
            .split(";")
            .map((d) => d.trim())
            .filter((d) => d.length > 0),
        );
      }
      return out;
    };
    // A hue is a colour; `transparent` is the absence of an edge, which is shape.
    // Collapsing both to one token is what let the pre-change tinted ring pass as
    // distinct from `idle` — it did not have to be, and it was not.
    const flatten = (value: string): string =>
      value
        // Innermost first: a `var()` inside a `color-mix()` has to collapse before
        // the mix does, or the mix's own closing paren is never reached and a
        // fragment of it survives as a false distinction.
        .replace(/var\(--[^)]*\)|#[0-9a-f]{3,8}/g, "C")
        .replace(/color-mix\([^)]*\)/g, "C")
        .replace(/\btransparent\b/g, "NONE")
        .trim();

    const SIDES = ["top", "right", "bottom", "left"] as const;
    type Edge = { width: string; style: string; colour: string };
    const BLANK: Edge = { width: "medium", style: "none", colour: "C" };
    /** An edge paints only when it has all three: a width, a style, and a colour. */
    const paints = (e: Edge): boolean =>
      !/^0\w*$/.test(e.width) && !/^(none|hidden)$/.test(e.style) && !e.colour.includes("NONE");
    /**
     * Apply one declaration to the four edges, in cascade order — `border` and
     * `border-<side>` set all three parts, the longhands set one. Modelling the
     * parts separately is what makes `border: 0` and `border-style: none` read as
     * no paint; treating any non-`transparent` value as ink did not.
     */
    const applyBorder = (edges: Map<string, Edge>, prop: string, value: string): boolean => {
      const side = SIDES.find((sd) => prop === `border-${sd}` || prop.startsWith(`border-${sd}-`));
      const targets = side === undefined ? SIDES : [side];
      const part = /-(width|style|color)$/.exec(prop)?.[1];
      if (prop !== "border" && side === undefined && part === undefined) {
        return false;
      }
      for (const sd of targets) {
        const cur = edges.get(sd) ?? { ...BLANK };
        if (part === "width") {
          cur.width = value;
        } else if (part === "style") {
          cur.style = value;
        } else if (part === "color") {
          cur.colour = value;
        } else {
          // Shorthand: `1.5px solid C`, or `0`. Unstated parts reset to initial.
          const [w = "medium", st = "none", ...c] = value.split(/\s+/);
          cur.width = w;
          cur.style = /^\d/.test(w) || w === "medium" || w === "thin" || w === "thick" ? st : w;
          cur.colour = c.join(" ") || (/^\d/.test(w) ? "C" : st);
          if (value.trim() === "0" || value.trim() === "none") {
            cur.style = "none";
          }
        }
        edges.set(sd, cur);
      }
      return true;
    };
    /**
     * What the rule actually draws: which of the four edges paint, whether it
     * carries a fill, and every non-colour declaration. Which EDGES exist is
     * shape; which hue an existing edge takes is not — the arc is two sides of
     * four, and the ring it replaced was four, which is why they must not compare
     * equal. Base and `::after` are kept apart: an `::after` that paints nothing
     * must not keep a state alive, and one that paints must not mask a base
     * collision, so the base layer is asserted on its own as well.
     */
    const shapeOf = (
      state: string,
      dropMotion: boolean,
    ): { key: string; base: string; baseInked: boolean; motion: string[] } => {
      const baseDecls = declsOf(css, state, "");
      expect(baseDecls, `no rule for .wt-state--${state}`).not.toEqual([]);
      // `::before` as well: an animated pseudo-element is an animated glyph
      // whichever side generates it, and only `::after` was ever looked at.
      const layers: [string, string[]][] = [
        ["", dropMotion ? [...baseDecls, ...declsOf(reduced, state)] : baseDecls],
        ...(["::after", "::before"] as const).map((pseudo): [string, string[]] => [
          pseudo,
          dropMotion
            ? [...declsOf(css, state, pseudo), ...declsOf(reduced, state, pseudo)]
            : declsOf(css, state, pseudo),
        ]),
      ];
      const keys = new Map<string, Map<string, string>>();
      let baseInked = false;
      // What the cascade ACTUALLY leaves running, as opposed to what the shape key
      // deliberately ignores. PER LAYER: one shared value let an `::after` the media
      // query names cancel a base animation it never touched, which is a different
      // element still moving.
      const motion = new Map<string, string>();
      for (const [layer, decls] of layers) {
        const kept = new Map<string, string>();
        const edges = new Map<string, Edge>();
        let fill = "none";
        for (const decl of decls) {
          const [rawProp = "", ...rest] = decl.split(":");
          const prop = rawProp.trim();
          const value = flatten(rest.join(":"));
          if (/^animation/.test(prop)) {
            // Motion is not shape, so it never enters the key — but a state that
            // keeps moving once the media query has spoken is a separate lie, and
            // the assertion below is the only thing that can see it. Deleting this
            // outright, as this guard used to, made that assertion unaskable: an
            // animated `running-unconfirmed` stayed green through every pass.
            if (prop === "animation-name" || prop === "animation") {
              motion.set(layer, value);
            }
            continue;
          }
          if (/^transition/.test(prop)) {
            continue;
          }
          if (prop === "background" || prop === "background-color") {
            fill = value.includes("NONE") ? "none" : "filled";
            continue;
          }
          if (prop.startsWith("border") && !prop.startsWith("border-radius") && applyBorder(edges, prop, value)) {
            continue;
          }
          if (/color|opacity/.test(prop)) {
            continue;
          }
          kept.set(prop, value);
        }
        const painted = SIDES.filter((sd) => paints(edges.get(sd) ?? BLANK));
        kept.set("edges", painted.map((sd) => `${sd}/${edges.get(sd)?.style ?? ""}`).join(",") || "none");
        kept.set("fill", fill);
        if (layer === "") {
          baseInked = fill === "filled" || painted.length > 0;
        }
        keys.set(layer, kept);
      }
      const render = (layer: string): string =>
        [...(keys.get(layer) ?? new Map())]
          .sort()
          .map(([k, v]) => `${k}:${v}`)
          .join(";");
      const stillMoving = [...motion.entries()].filter(([, v]) => v !== "none").map(([l, v]) => `${l || "base"}:${v}`);
      return {
        key: `${render("")}|${render("::after")}|${render("::before")}`,
        base: render(""),
        baseInked,
        motion: stillMoving,
      };
    };

    // Keyed by the presented vocabulary itself, so § 7.2's reserved sixth member
    // cannot ship without a shape: adding it to `PresentedActivity` fails to
    // compile here until it also has a rule.
    const STATE_RULES: Record<PresentedActivity, string> = {
      running: "running",
      "running-unconfirmed": "running-unconfirmed",
      waiting: "waiting",
      idle: "idle",
      unknown: "unknown",
      exited: "exited",
    };
    const STATES = Object.values(STATE_RULES);
    for (const dropMotion of [false, true]) {
      const shapes = STATES.map((st) => shapeOf(st, dropMotion));
      const where = `motion dropped: ${dropMotion}`;
      for (const [i, shape] of shapes.entries()) {
        // Distinct is not enough: a rule that draws nothing is distinct from every
        // other rule and invisible on screen. The BASE must paint on its own — a
        // decorative `::after` is not what makes a state legible.
        expect(shape.baseInked, `.wt-state--${STATES[i]} draws nothing (${where})`).toBe(true);
      }
      for (const layer of ["base", "full"] as const) {
        // Both, so an `::after` can neither mask a base collision nor create a
        // distinction the base does not have.
        const keys = shapes.map((sh) => (layer === "base" ? sh.base : sh.key));
        expect(new Set(keys).size, `two states share a ${layer} shape (${where})`).toBe(keys.length);
      }
      if (!dropMotion) {
        // Unconditional, because the invariant is: the state exists to be the one
        // that does NOT move. Naming it in the reduced-motion block would satisfy
        // the pass below while it still span for every viewer who never asked for
        // reduced motion — the majority — so the claim has to hold before the media
        // query is consulted at all.
        const still = shapes[STATES.indexOf("running-unconfirmed")];
        expect(
          still?.motion ?? [],
          "running-unconfirmed animates — it is the state whose whole purpose is to stand still",
        ).toEqual([]);
      }
      if (dropMotion) {
        // The distinctness passes above cannot ask this: they strip motion from the
        // key on purpose, so a state that animates and one that does not compare
        // equal, and the reduced-motion cascade is never consulted. The media query
        // names the states it stops BY HAND, so a new animated state is silently
        // exempt from it — which is exactly the shape of the defect this asserts
        // against. `running-unconfirmed` is the whole point of the ceiling: a claim
        // whose evidence ran out must stop moving.
        for (const [i, shape] of shapes.entries()) {
          expect(
            shape.motion,
            `.wt-state--${STATES[i]} still animates under prefers-reduced-motion — the media query does not name it`,
          ).toEqual([]);
        }
      }
    }
  });

  it("stops animating a run that outlived its evidence, and says so as a bound", () => {
    const { view } = mount();
    const presence: WorktreePresence = {
      scannedAt: NOW,
      degradedSources: [],
      rowsByWorktreeId: {
        [PANEL_WT]: [
          agentRow({
            rowId: "stale",
            agent: "claude",
            activity: "running",
            activitySource: "output",
            title: "worker",
            stateStartedAt: NOW - 9 * 60_000,
          }),
        ],
      },
    };
    view.setData({ tree: singleRepoTree(), presence });
    const glyph = rowFor(view, "feat/worktree-panel")?.querySelector(".wt-glyph .wt-state");
    expect(glyph?.className).toContain("wt-state--running-unconfirmed");
    expect(glyph?.getAttribute("aria-label")).toBe("An agent may be running, unconfirmed");
  });

  it("writes the elapsed gap as a bound, so a hint read an hour later is still true", () => {
    // The hint is written at render and read at hover. An exact figure would be
    // false by the time anyone sees it, and the row does not repaint again.
    expect(unconfirmedHint(9 * 60_000)).toContain("at least 9 minutes");
    expect(unconfirmedHint(3 * 60 * 60_000)).toContain("at least 3 hours");
    expect(unconfirmedHint(9 * 60_000)).toContain("not proof of a turn in progress");
    expect(unconfirmedHint(undefined)).not.toContain("Unchanged");
    // "at least", not "over": the timer fires AT the ceiling, so the very first
    // hint a crossing writes carries the exact figure — and "over 5 minutes"
    // would be false by a hair at the one moment the claim is newest.
    expect(unconfirmedHint(CONFIRMATION_CEILING_MS)).toContain("at least 5 minutes");
    expect(unconfirmedHint(CONFIRMATION_CEILING_MS)).not.toContain("over");
  });

  it("repaints a row that crosses the ceiling with no push, and does not when none crosses", () => {
    vi.useFakeTimers();
    try {
      let clock = NOW;
      const { view } = mount({ now: () => clock });
      const presence: WorktreePresence = {
        scannedAt: NOW,
        degradedSources: [],
        rowsByWorktreeId: {
          [PANEL_WT]: [
            agentRow({
              rowId: "soon",
              agent: "claude",
              activity: "running",
              activitySource: "output",
              title: "worker",
              stateStartedAt: NOW - 4 * 60_000,
            }),
          ],
        },
      };
      view.setData({ tree: singleRepoTree(), presence });
      const sel = () => rowFor(view, "feat/worktree-panel")?.querySelector(".wt-glyph .wt-state")?.className ?? "";
      expect(sel()).toContain("wt-state--running");
      expect(sel()).not.toContain("unconfirmed");

      // Nothing pushes; the row crosses on the view's own deadline.
      clock = NOW + 60_000;
      vi.advanceTimersByTime(60_000);
      expect(sel()).toContain("wt-state--running-unconfirmed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads the clock ONCE per cycle, so a row's glyph and its own hint agree", () => {
    // Every other test freezes `now`, which is exactly why the five re-reads in the
    // render path were invisible: a frozen clock makes them indistinguishable from
    // one reading. Here the clock advances on EVERY call, so any second read lands
    // at a different moment than the first.
    let ticks = 0;
    const { view } = mount({ now: () => NOW + ticks++ * CONFIRMATION_CEILING_MS });
    view.setData({
      tree: singleRepoTree(),
      presence: {
        scannedAt: NOW,
        degradedSources: [],
        rowsByWorktreeId: {
          [MAIN_PATH]: [
            agentRow({
              rowId: "one",
              agent: "claude",
              activity: "running",
              activitySource: "output",
              title: "worker",
              stateStartedAt: NOW,
            }),
          ],
        },
      },
    });
    const row = view.element.querySelector<HTMLElement>(".wt-arow");
    expect(row, "fixture drew no agent row").not.toBeNull();
    const glyph = row?.querySelector(".wt-state")?.className ?? "";
    // The FIRST reading is `NOW`, and the row started its activity at `NOW`: zero
    // elapsed, so the cycle must draw it confirmed. Any later read inside the
    // render is a whole ceiling further on and would draw the withdrawn glyph
    // instead — a row scheduled against one moment and drawn against another.
    expect(glyph).toContain("wt-state--running");
    expect(glyph).not.toContain("unconfirmed");
    expect(row?.querySelector<HTMLElement>(".wt-confidence")?.dataset.tip ?? "").not.toContain(
      "Unchanged for at least",
    );
  });

  it("arms no crossing for a row the render does not draw", () => {
    vi.useFakeTimers();
    try {
      const { view } = mount({ now: () => NOW });
      view.setData({
        tree: singleRepoTree(),
        presence: {
          scannedAt: NOW,
          degradedSources: [],
          rowsByWorktreeId: {
            [PANEL_WT]: [
              agentRow({
                rowId: "hidden",
                agent: "claude",
                activity: "running",
                activitySource: "output",
                title: "worker",
                stateStartedAt: NOW - 4 * 60_000,
              }),
            ],
          },
        },
      });
      expect(vi.getTimerCount()).toBe(1);
      // Filtered off screen. `render` opens with `replaceChildren()`, so waking for
      // this row would tear down and rebuild the whole list to change nothing
      // anybody can see.
      view.setQuery("no-such-branch-anywhere");
      expect(rowFor(view, "feat/worktree-panel")).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not spin when a start time lies in the future", () => {
    vi.useFakeTimers();
    try {
      let ticks = 0;
      const { view } = mount({
        now: () => {
          ticks++;
          return NOW;
        },
      });
      // Confirmed, per the spec — an impossible clock must not manufacture
      // staleness — which is precisely what makes it an accepted candidate. A year
      // out, `at - now` overflows setTimeout's 32-bit delay, fires immediately, and
      // re-derives the same crossing forever.
      view.setData({
        tree: singleRepoTree(),
        presence: {
          scannedAt: NOW,
          degradedSources: [],
          rowsByWorktreeId: {
            [PANEL_WT]: [
              agentRow({
                rowId: "future",
                agent: "claude",
                activity: "running",
                activitySource: "output",
                title: "worker",
                stateStartedAt: NOW + 365 * 24 * 60 * 60_000,
              }),
            ],
          },
        },
      });
      // Counting timers cannot see this: the loop re-arms, so the count is always
      // 1. What gives it away is the FIRING — an overflowed delay wraps to about a
      // millisecond, so a second of fake time is a thousand wake-ups, each one
      // re-reading the clock. A bounded delay fires not once in that second.
      const settled = ticks;
      vi.advanceTimersByTime(1_000);
      expect(ticks - settled, "the ceiling timer is re-firing in a tight loop").toBe(0);
      expect(vi.getTimerCount()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("plants no timer when data arrives after disposal", () => {
    vi.useFakeTimers();
    try {
      const { view } = mount({ now: () => NOW });
      view.dispose();
      view.setData({
        tree: singleRepoTree(),
        presence: {
          scannedAt: NOW,
          degradedSources: [],
          rowsByWorktreeId: {
            [PANEL_WT]: [
              agentRow({
                rowId: "late",
                agent: "claude",
                activity: "running",
                activitySource: "output",
                title: "worker",
                stateStartedAt: NOW - 4 * 60_000,
              }),
            ],
          },
        },
      });
      // Before the ceiling a late push wrote into a detached element and stopped.
      // It now installs a timer, which would repaint a view nobody holds.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers the confidence hint to the keyboard, not only to the pointer", () => {
    const { view } = mount({ now: () => NOW });
    view.setData({
      tree: singleRepoTree(),
      presence: {
        scannedAt: NOW,
        degradedSources: [],
        rowsByWorktreeId: {
          [MAIN_PATH]: [
            agentRow({
              rowId: "stale",
              agent: "claude",
              activity: "running",
              activitySource: "output",
              title: "worker",
              stateStartedAt: NOW - CONFIRMATION_CEILING_MS,
            }),
          ],
        },
      },
    });
    const row = view.element.querySelector<HTMLElement>(".wt-arow");
    // `Tooltip` resolves `closest('[data-tip]')`, and focus lands on the ROW —
    // which walks upward and can never reach the marker span inside it. The
    // elapsed figure and the evidence are mandatory parts of the statement, so a
    // keyboard user has to be able to get them.
    expect(row?.dataset.tip ?? "").toContain("Unchanged for at least");
    expect(row?.dataset.tip ?? "").toContain("not proof of a turn in progress");
  });

  it("still arms a crossing when git is unavailable but the listing was retained", () => {
    vi.useFakeTimers();
    try {
      const { view } = mount({ now: () => NOW });
      const tree = singleRepoTree();
      // The cache keeps the last good listing and lowers the flag; the view draws
      // those repos under a "Git is unavailable" notice. A scheduler that treats
      // this as an empty tree arms nothing, so every drawn row keeps animating a
      // withdrawn claim for as long as the outage lasts.
      const stale: WorktreeTree = { ...tree, gitAvailable: false };
      view.setData({
        tree: stale,
        presence: {
          scannedAt: NOW,
          degradedSources: [],
          rowsByWorktreeId: {
            [PANEL_WT]: [
              agentRow({
                rowId: "outage",
                agent: "claude",
                activity: "running",
                activitySource: "output",
                title: "worker",
                stateStartedAt: NOW - 4 * 60_000,
              }),
            ],
          },
        },
      });
      expect(rowFor(view, "feat/worktree-panel"), "the retained listing is drawn").toBeDefined();
      expect(vi.getTimerCount(), "a drawn row must be able to cross").toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("plants no timer when an interaction fires after disposal", () => {
    vi.useFakeTimers();
    try {
      const { view } = mount({ now: () => NOW });
      view.setData(populated());
      view.dispose();
      // Interaction handlers are still bound to DOM the view no longer owns.
      // Guarding `setData` alone left this path free to arm one.
      view.setQuery("main");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("qualifies the worktree row itself, the only row a collapsed worktree offers", () => {
    const { view } = mount({ now: () => NOW });
    view.setData({
      tree: singleRepoTree(),
      presence: {
        scannedAt: NOW,
        degradedSources: [],
        rowsByWorktreeId: {
          // PANEL_WT is not in the workspace, so it is first seen COLLAPSED: its
          // agent rows are never drawn and its pill is aria-hidden, tabIndex -1,
          // and outside the arrow-key set. This row is all a keyboard user gets.
          [PANEL_WT]: [
            agentRow({
              rowId: "stale",
              agent: "claude",
              activity: "running",
              activitySource: "output",
              title: "worker",
              stateStartedAt: NOW - CONFIRMATION_CEILING_MS,
            }),
          ],
        },
      },
    });
    const wt = rowFor(view, "feat/worktree-panel");
    expect(view.element.querySelectorAll(".wt-arow"), "fixture must be collapsed").toHaveLength(0);
    expect(wt?.querySelector(".wt-state")?.className).toContain("running-unconfirmed");
    expect(wt?.dataset.tip ?? "").toContain("Unchanged for at least");
    expect(wt?.dataset.tip ?? "").toContain("not proof of a turn in progress");
  });

  it("arms nothing for a worktree the view never drew, whatever the reason", () => {
    vi.useFakeTimers();
    try {
      const { view } = mount({ now: () => NOW });
      const presence: WorktreePresence = {
        scannedAt: NOW,
        degradedSources: [],
        rowsByWorktreeId: {
          [PANEL_WT]: [
            agentRow({
              rowId: "r",
              agent: "claude",
              activity: "running",
              activitySource: "output",
              title: "worker",
              stateStartedAt: NOW - 4 * 60_000,
            }),
          ],
        },
      };
      // `noFolder` returns from `render` before the tree is touched. The scheduler
      // used to restate the render's predicate and had drifted on this term as well
      // as on `gitAvailable`; reading the drawn rows back out of the DOM means there
      // is no predicate left to drift.
      view.setData({ tree: singleRepoTree(), presence, noFolder: true });
      expect(view.element.querySelectorAll("[data-worktree-id]")).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
      view.setData({ tree: singleRepoTree(), presence });
      expect(vi.getTimerCount()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not rebuild a disposed view's DOM, whose hints are already dead", () => {
    const { view } = mount({ now: () => NOW });
    view.setData(populated());
    const before = view.element.querySelector(".wt-row");
    view.dispose();
    // `dispose()` tore down the tooltip delegates. A rebuild after it yields rows
    // whose hints can never resolve — worse than leaving the stale ones alone.
    view.setQuery("main");
    expect(view.element.querySelector(".wt-row")).toBe(before);
  });

  it("performs no DOM work when a re-derivation moves nothing", () => {
    vi.useFakeTimers();
    try {
      let clock = NOW;
      const { view } = mount({ now: () => clock });
      view.setData(populated());
      const before = rowFor(view, "main");
      // A push carrying identical data, one second later: no row can have crossed,
      // so the tree must be the very same nodes — a guard that always repaints
      // would pass the crossing test above and defeat this one.
      clock = NOW + 1_000;
      view.setData(populated());
      expect(rowFor(view, "main")).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("arms no timer when no row can cross, and clears a pending one on disposal", () => {
    vi.useFakeTimers();
    try {
      const { view } = mount({ now: () => NOW });
      // Hook-backed and already past the ceiling: neither can cross, so neither
      // earns a timer. (The shared fixture does hold an output-inferred run, so
      // it is deliberately not used here.)
      view.setData({
        tree: singleRepoTree(),
        presence: {
          scannedAt: NOW,
          degradedSources: [],
          rowsByWorktreeId: {
            [PANEL_WT]: [
              agentRow({ rowId: "h", activity: "running", activitySource: "hook", stateStartedAt: NOW - 60 * 60_000 }),
              agentRow({
                rowId: "past",
                activity: "running",
                activitySource: "output",
                stateStartedAt: NOW - 60 * 60_000,
              }),
            ],
          },
        },
      });
      expect(vi.getTimerCount()).toBe(0);

      view.setData({
        tree: singleRepoTree(),
        presence: {
          scannedAt: NOW,
          degradedSources: [],
          rowsByWorktreeId: {
            [PANEL_WT]: [agentRow({ rowId: "s", activity: "running", activitySource: "output", stateStartedAt: NOW })],
          },
        },
      });
      expect(vi.getTimerCount()).toBe(1);
      view.dispose();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-arms after firing, so a second crossing behind the first is still drawn", () => {
    vi.useFakeTimers();
    try {
      let clock = NOW;
      const { view } = mount({ now: () => clock });
      view.setData({
        tree: singleRepoTree(),
        presence: {
          scannedAt: NOW,
          degradedSources: [],
          rowsByWorktreeId: {
            [PANEL_WT]: [
              agentRow({ rowId: "a", activity: "running", activitySource: "output", stateStartedAt: NOW - 4 * 60_000 }),
              agentRow({ rowId: "b", activity: "running", activitySource: "output", stateStartedAt: NOW - 60_000 }),
            ],
          },
        },
      });
      clock = NOW + 60_000;
      vi.advanceTimersByTime(60_000);
      // The first crossed; the second is still four minutes out and must be armed.
      expect(vi.getTimerCount()).toBe(1);
      clock = NOW + 4 * 60_000;
      vi.advanceTimersByTime(3 * 60_000);
      const dots = Array.from(view.element.querySelectorAll(".wt-arow .wt-state")).map((d) => d.className);
      expect(dots.every((c) => c.includes("running-unconfirmed"))).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a failed worktree LISTING out of it — that says nothing about any agent", () => {
    const { view } = mount();
    const tree = singleRepoTree();
    view.setData(
      populated({ tree: { ...tree, repos: tree.repos.map((r) => ({ ...r, degraded: "git ls-files failed" })) } }),
    );
    expect(rowFor(view, "main")?.querySelector(".wt-glyph .wt-state")?.className).toContain("wt-state--waiting");
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

  it("does not count a row no source could read into the pill's idle group", () => {
    const rows = [
      agentRow({ rowId: "a", agent: "claude", activity: "running", activitySource: "output" }),
      agentRow({ rowId: "b", agent: "claude", activity: "idle", activitySource: "none" }),
    ];
    const presence: WorktreePresence = {
      scannedAt: NOW,
      degradedSources: [{ source: "panes", reason: "scan failed", since: NOW }],
      rowsByWorktreeId: { [PANEL_WT]: rows },
    };
    const { view } = mount();
    view.setData({ tree: singleRepoTree(), presence });
    const dots = Array.from(view.element.querySelectorAll(".wt-presence .wt-pgroup .wt-state")).map((d) => d.className);
    // Both rows are unreadable — one from a failed source, one from no source at
    // all — so the pill must show one unknown group and no idle or running dot.
    expect(dots).toHaveLength(1);
    expect(dots[0]).toContain("wt-state--unknown");
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

  it("presents the agent's own content when keyboard focus lands on the row", () => {
    const { view } = mount();
    view.setData(populated());
    const first = agentRows(view)[0];
    if (!first) {
      throw new Error("fixture lost its first agent row");
    }
    // The roving tabindex focuses `.wt-arow` itself; its title and preview live
    // on non-focusable descendants, which closest() cannot reach from the row.
    vi.useFakeTimers();
    try {
      first.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      vi.advanceTimersByTime(300);
      const tip = document.body.querySelector<HTMLElement>(".webview-tooltip");
      expect(tip?.style.display).toBe("block");
      const shown = first.querySelector(".wt-atitle")?.textContent ?? "";
      expect(shown).not.toBe("");
      expect(tip?.textContent).toContain(shown);
    } finally {
      vi.useRealTimers();
    }
  });

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
    expect(icon?.dataset.tip).toBeUndefined();
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
    view.openRemoveDialog({ info, blocker: confirmableBlocker, degradedSources: [] });
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
      degradedSources: [],
    });
    expect(host.querySelector(".wt-refusebox")).not.toBeNull();
    expect(host.querySelector(".wt-btn--danger")).toBeNull();
    expect(host.querySelector(".wt-blockers")).toBeNull();
  });

  it("still refuses on an unreadable row, but stops claiming to know it is working", () => {
    const { view, host } = mount();
    view.setData(populated());
    const info = singleRepoTree().repos[0]?.worktrees[1];
    if (!info) {
      throw new Error("fixture lost the panel worktree");
    }
    view.openRemoveDialog({
      info,
      blocker: refusedBlocker,
      agentRows: [
        agentRow({ rowId: "busy", agent: "claude", activity: "waiting", activitySource: "hook", title: "worker" }),
      ],
      degradedSources: [{ source: "hook", reason: "socket closed", since: NOW }],
    });
    // The refusal holds — warning about a possibly-working agent is the safe side
    // of deleting a folder — but the copy and the glyph drop the certainty.
    expect(host.querySelector(".wt-btn--danger")).toBeNull();
    expect(host.querySelector(".wt-refusebox b")?.textContent).toContain("nothing can currently confirm it");
    expect(host.querySelector(".wt-dialog .wt-arow .wt-state")?.className).toContain("wt-state--unknown");
  });

  it("keeps the certain sentence when every listed row is confirmed", () => {
    const { view, host } = mount();
    view.setData(populated());
    const info = singleRepoTree().repos[0]?.worktrees[1];
    if (!info) {
      throw new Error("fixture lost the panel worktree");
    }
    // Pinned so a regression that hedges everything cannot pass by only ever
    // asserting the hedged string.
    view.openRemoveDialog({
      info,
      blocker: refusedBlocker,
      agentRows: [
        agentRow({ rowId: "busy", agent: "claude", activity: "waiting", activitySource: "hook", title: "worker" }),
      ],
      degradedSources: [{ source: "panes", reason: "scan failed", since: NOW }],
    });
    expect(host.querySelector(".wt-refusebox b")?.textContent).toBe("An agent is mid-turn in this worktree.");
  });

  it("says which part of a mixed list it can vouch for", () => {
    const { view, host } = mount();
    view.setData(populated());
    const info = singleRepoTree().repos[0]?.worktrees[1];
    if (!info) {
      throw new Error("fixture lost the panel worktree");
    }
    view.openRemoveDialog({
      info,
      blocker: refusedBlocker,
      agentRows: [
        agentRow({ rowId: "seen", agent: "claude", activity: "running", activitySource: "hook", title: "a" }),
        agentRow({ rowId: "blind", agent: "claude", activity: "running", activitySource: "output", title: "b" }),
      ],
      degradedSources: [{ source: "panes", reason: "scan failed", since: NOW }],
    });
    // One row draws a live dot and one draws unknown; a single sentence for both
    // would misdescribe whichever half it is not about.
    expect(host.querySelector(".wt-refusebox b")?.textContent).toBe(
      "An agent is mid-turn in this worktree, and another here cannot be read at all.",
    );
    const dots = Array.from(host.querySelectorAll(".wt-dialog .wt-arow .wt-state")).map((d) => d.className);
    expect(dots.some((c) => c.includes("wt-state--running"))).toBe(true);
    expect(dots.some((c) => c.includes("wt-state--unknown"))).toBe(true);
  });

  it("makes the weakest claim when the blocker counted an agent no row can show", () => {
    const { view, host } = mount();
    view.setData(populated());
    const info = singleRepoTree().repos[0]?.worktrees[1];
    if (!info) {
      throw new Error("fixture lost the panel worktree");
    }
    view.openRemoveDialog({ info, blocker: refusedBlocker, agentRows: [], degradedSources: [] });
    // The whole paragraph, not just the lead: "stop it first" presupposes a row
    // the sentence before it has just said cannot be shown.
    expect(host.querySelector(".wt-refusebox")?.textContent).toBe(
      "An agent was mid-turn in this worktree, and no row can be shown for it now." +
        " It is no longer listed here — retry the removal.",
    );
    expect(host.querySelector(".wt-dialog .wt-arow")).toBeNull();
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

// ── § 3.6: the idle tail ──────────────────────────────────────────────────

describe("the idle tail", () => {
  const REPO = "/repo/.git";

  function tree(branches: string[]): WorktreeTree {
    return {
      gitAvailable: true,
      unreadable: { count: 0, reasons: [] },
      repos: [
        {
          repoId: REPO,
          label: "repo",
          mainPath: "/repo",
          worktrees: branches.map((b) => worktree({ id: `/wt/${b}`, branch: b, head: "a".repeat(40) })),
        },
      ],
    };
  }

  function presence(withAgents: string[], degraded: PresenceDegradation[] = []): WorktreePresence {
    const rowsByWorktreeId: Record<string, WorktreeAgentRow[]> = {};
    for (const b of withAgents) {
      rowsByWorktreeId[`/wt/${b}`] = [agentRow({ rowId: `r-${b}`, agent: "claude", title: b })];
    }
    return { scannedAt: NOW, degradedSources: degraded, rowsByWorktreeId };
  }

  const branchesInOrder = (view: WorktreeView): string[] =>
    Array.from(view.element.querySelectorAll(".wt-row .wt-branch")).map((e) => e.textContent ?? "");

  const disclosure = (view: WorktreeView): HTMLElement | null => view.element.querySelector<HTMLElement>(".wt-idle");

  it("orders agent-holding worktrees first, keeping supplied order inside each part", () => {
    const { view } = mount({ now: () => NOW });
    view.setData({ tree: tree(["a", "b", "c", "d"]), presence: presence(["b", "d"]) });
    expect(branchesInOrder(view)).toEqual(["b", "d", "a", "c"]);
  });

  it("leaves a worktree of unknown presence in the leading part", () => {
    const { view } = mount({ now: () => NOW });
    // `a` has no rows, but a degraded source means the view cannot attribute that
    // absence to there being no agents — unknown is not agentless.
    // Four rowless worktrees — enough to fold, were the absence attributable.
    view.setData({
      tree: tree(["a", "b", "c", "d", "e"]),
      presence: presence(["b"], [{ source: "panes", reason: "scan failed", since: NOW }]),
    });
    expect(branchesInOrder(view)).toEqual(["a", "b", "c", "d", "e"]);
    expect(disclosure(view)).toBeNull();
  });

  it("keeps an agentless worktree's row duties — menu and keyboard reach", () => {
    const { view } = mount({ now: () => NOW });
    view.setData({ tree: tree(["a", "b"]), presence: presence(["a"]) });
    const live = view.element.querySelector<HTMLElement>('[data-worktree-id="/wt/a"]');
    const idle = view.element.querySelector<HTMLElement>('[data-worktree-id="/wt/b"]');
    expect(idle?.getAttribute("role")).toBe("treeitem");
    // Dim is a treatment, not a demotion: arrowing still reaches it.
    live?.focus();
    live?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(idle);
  });

  it("draws an agentless worktree as one dim line with no presence block", () => {
    const { view } = mount({ now: () => NOW });
    view.setData({ tree: tree(["a", "b"]), presence: presence(["a"]) });
    const idle = Array.from(view.element.querySelectorAll<HTMLElement>(".wt-row")).find(
      (r) => r.querySelector(".wt-branch")?.textContent === "b",
    );
    expect(idle?.className).toContain("wt-row--idle");
    expect(idle?.querySelector(".wt-glyph .wt-state")).toBeNull();
    expect(idle?.dataset.worktreeId).toBe("/wt/b");
  });

  it("folds from four agentless worktrees, stating an exact hidden count", () => {
    const { view } = mount({ now: () => NOW });
    view.setData({ tree: tree(["live", "a", "b", "c", "d"]), presence: presence(["live"]) });
    expect(disclosure(view)?.textContent).toContain("4");
    expect(branchesInOrder(view)).toEqual(["live"]);
  });

  it("leaves three visible, since a disclosure hiding two costs more than it saves", () => {
    const { view } = mount({ now: () => NOW });
    view.setData({ tree: tree(["live", "a", "b", "c"]), presence: presence(["live"]) });
    expect(disclosure(view)).toBeNull();
    expect(branchesInOrder(view)).toEqual(["live", "a", "b", "c"]);
  });

  it("never folds when presence has not arrived", () => {
    const { view } = mount({ now: () => NOW });
    view.setData({ tree: tree(["a", "b", "c", "d", "e"]), presence: null });
    expect(disclosure(view)).toBeNull();
    expect(branchesInOrder(view)).toHaveLength(5);
  });

  it("opens the tail for a filter match without spending the user's own choice", () => {
    const { view } = mount({ now: () => NOW });
    // Every idle branch matches, so the surviving tail is still long enough to
    // fold — the query cannot reveal these by shrinking them below the threshold,
    // only by the view declining to fold while a filter is up.
    view.setData({ tree: tree(["live", "spike-a", "spike-b", "spike-c", "spike-d"]), presence: presence(["live"]) });
    expect(branchesInOrder(view)).toEqual(["live"]);
    view.setQuery("spike");
    expect(branchesInOrder(view)).toEqual(["spike-a", "spike-b", "spike-c", "spike-d"]);
    view.setQuery("");
    // Back to folded: the query revealed the tail, it did not re-decide it.
    expect(branchesInOrder(view)).toEqual(["live"]);
  });

  it("keeps a folded tail folded across a push", () => {
    // The fold key is not a live repo or worktree id, so a rebuild that only
    // recognises those would silently unfold the tail on every push.
    const { view } = mount({ now: () => NOW });
    view.setData({ tree: tree(["live", "a", "b", "c", "d"]), presence: presence(["live"]) });
    expect(branchesInOrder(view)).toEqual(["live"]);
    // A push that MOVED something, so the view actually repaints against the
    // rebuilt state. An identical push is cheaper but proves less: it is dropped
    // at the render signature, so it could not observe the fold being lost.
    view.setData({ tree: tree(["live2", "a", "b", "c", "d"]), presence: presence(["live2"]) });
    expect(branchesInOrder(view)).toEqual(["live2"]);
  });

  it("keeps an opened tail open across a push", () => {
    const { view } = mount({ now: () => NOW });
    view.setData({ tree: tree(["live", "a", "b", "c", "d"]), presence: presence(["live"]) });
    view.element.querySelector<HTMLElement>(".wt-idle")?.click();
    expect(branchesInOrder(view)).toHaveLength(5);
    view.setData({ tree: tree(["live2", "a", "b", "c", "d"]), presence: presence(["live2"]) });
    expect(branchesInOrder(view)).toHaveLength(5);
  });

  it("defaults a first-seen tail folded even on persisted state that predates it", () => {
    // The trap: a restored collapse array treats every absent key as EXPANDED, so
    // the fold key alone would read as "the user opened it" for every existing
    // user — the feature would arrive unfolded for exactly the people it is for.
    const { view } = mount({ now: () => NOW, getInitialCollapsed: () => [], getInitialIdleSeeded: () => [] });
    view.setData({ tree: tree(["live", "a", "b", "c", "d"]), presence: presence(["live"]) });
    expect(disclosure(view)?.getAttribute("aria-expanded")).toBe("false");
  });

  it("restores a tail the user opened, rather than re-folding it", () => {
    const { view } = mount({
      now: () => NOW,
      getInitialCollapsed: () => [],
      getInitialIdleSeeded: () => [REPO],
    });
    view.setData({ tree: tree(["live", "a", "b", "c", "d"]), presence: presence(["live"]) });
    expect(disclosure(view)?.getAttribute("aria-expanded")).toBe("true");
  });

  it("counts only what the cap admitted, leaving the excluded to the cap's own affordance", () => {
    const agentHolders = Array.from({ length: MAX_WORKTREES_PER_REPO - 4 }, (_, i) => `live-${i}`);
    const idle = Array.from({ length: 8 }, (_, i) => `idle-${i}`);
    const { view } = mount({ now: () => NOW });
    view.setData({ tree: tree([...agentHolders, ...idle]), presence: presence(agentHolders) });
    // The cap admits four of the eight agentless worktrees, so the disclosure
    // hides four — not eight — and the four the cap excluded are the cap's to
    // report. Neither affordance describes the other's rows.
    expect(disclosure(view)?.textContent).toContain("4 idle worktrees");
    expect(view.element.querySelector(".wt-showall")?.textContent).toContain(String(agentHolders.length + idle.length));
  });

  it("gives the disclosure its own keyboard identity", () => {
    const { view } = mount({ now: () => NOW });
    view.setData({ tree: tree(["live", "a", "b", "c", "d"]), presence: presence(["live"]) });
    const row = disclosure(view);
    expect(row?.getAttribute("role")).toBe("treeitem");
    row?.focus();
    row?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(branchesInOrder(view)).toHaveLength(5);
    expect(document.activeElement?.className).toContain("wt-idle");
  });
});
