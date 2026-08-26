import { describe, expect, it, vi } from "vitest";
import type { PaneEvidenceMessage } from "../types/messages";
import { createPaneEvidenceStore } from "./PaneEvidenceStore";

function report(paneId: string, fields: Omit<PaneEvidenceMessage, "type" | "paneId">): PaneEvidenceMessage {
  return { type: "paneEvidence", paneId, ...fields };
}

describe("entry lifetime", () => {
  it("holds nothing for a pane that was never created", () => {
    const store = createPaneEvidenceStore();
    expect(store.read("ghost")).toBeUndefined();
    expect(store.activityFor("ghost")).toBeUndefined();
  });

  it("refuses to let a report bring a pane into existence", () => {
    const store = createPaneEvidenceStore();
    store.report(report("ghost", { title: "Fix tests", decorated: false }));
    expect(store.read("ghost")).toBeUndefined();
  });

  it("keeps evidence after the process exits, and drops it when the pane is deleted", () => {
    const store = createPaneEvidenceStore();
    store.create("p1");
    store.report(report("p1", { title: "Fix tests", decorated: false }));

    store.markExited("p1", true);
    expect(store.read("p1")?.title).toBe("Fix tests");
    expect(store.activityFor("p1")).toBe("exited");

    store.delete("p1");
    expect(store.read("p1")).toBeUndefined();
  });

  it("seeds a restored read-only pane as already exited", () => {
    const store = createPaneEvidenceStore();
    store.create("p1", { exited: true });
    expect(store.activityFor("p1")).toBe("exited");
  });

  it("clears every pane at once", () => {
    const store = createPaneEvidenceStore();
    store.create("p1");
    store.create("p2");
    store.clear();
    expect(store.read("p1")).toBeUndefined();
    expect(store.read("p2")).toBeUndefined();
  });

  it("does not resurrect a deleted pane by re-creating a stale entry", () => {
    const store = createPaneEvidenceStore();
    store.create("p1");
    store.report(report("p1", { waiting: true }));
    store.delete("p1");
    store.create("p1");
    expect(store.read("p1")?.waiting).toBeUndefined();
  });
});

describe("a whole view closing", () => {
  it("discards every pane it held and nothing else", () => {
    const store = createPaneEvidenceStore();
    store.create("a", { viewId: "editor-1" });
    store.create("b", { viewId: "editor-1" });
    store.create("c", { viewId: "sidebar" });

    store.deleteForView("editor-1");

    expect(store.read("a")).toBeUndefined();
    expect(store.read("b")).toBeUndefined();
    expect(store.read("c")).toBeDefined();
  });

  it("discards a pane whose process had already exited", () => {
    const store = createPaneEvidenceStore();
    store.create("a", { viewId: "editor-1" });
    store.markExited("a", true);

    store.deleteForView("editor-1");

    expect(store.read("a")).toBeUndefined();
  });

  it("stops tracking a pane's view once the pane is deleted on its own", () => {
    const store = createPaneEvidenceStore();
    store.create("a", { viewId: "editor-1" });
    store.delete("a");
    store.create("a", { viewId: "sidebar" });

    store.deleteForView("editor-1");

    expect(store.read("a")).toBeDefined();
  });

  it("announces each pane it discards", () => {
    const changed: string[] = [];
    const store = createPaneEvidenceStore({ onChange: (id) => changed.push(id) });
    store.create("a", { viewId: "editor-1" });
    store.create("b", { viewId: "editor-1" });
    changed.length = 0;

    store.deleteForView("editor-1");

    expect(changed.sort()).toEqual(["a", "b"]);
  });

  it("is a no-op for a view that holds nothing", () => {
    const store = createPaneEvidenceStore();
    store.create("a", { viewId: "sidebar" });

    expect(() => store.deleteForView("editor-9")).not.toThrow();
    expect(store.read("a")).toBeDefined();
  });
});

describe("unknown vs proven-absent", () => {
  it("reads unknown title and unknown waiting for a pane nothing reported", () => {
    const store = createPaneEvidenceStore();
    store.create("p1");
    const evidence = store.read("p1");
    expect(evidence?.title).toBeUndefined();
    expect(evidence?.decorated).toBeUndefined();
    expect(evidence?.waiting).toBeUndefined();
    expect(evidence?.semantic).toBeUndefined();
    expect(evidence?.exited).toBe(false);
  });

  it("keeps waiting unknown when only a title is reported", () => {
    const store = createPaneEvidenceStore();
    store.create("p1");
    store.report(report("p1", { title: "Fix tests", decorated: false }));
    expect(store.read("p1")?.waiting).toBeUndefined();
  });

  it("keeps the title unknown when only waiting is reported", () => {
    const store = createPaneEvidenceStore();
    store.create("p1");
    store.report(report("p1", { waiting: false }));
    expect(store.read("p1")?.title).toBeUndefined();
    expect(store.read("p1")?.waiting).toBe(false);
  });

  it("does not let a later title report overwrite held waiting evidence", () => {
    const store = createPaneEvidenceStore();
    store.create("p1");
    store.report(report("p1", { waiting: true }));
    store.report(report("p1", { title: "Fix tests", decorated: true }));
    expect(store.read("p1")?.waiting).toBe(true);
    expect(store.read("p1")?.title).toBe("Fix tests");
  });
});

describe("keyed by pane, not by surface", () => {
  it("holds one entry however many surfaces report it, last write winning", () => {
    const store = createPaneEvidenceStore();
    store.create("p1");
    store.report(report("p1", { title: "first", decorated: false }));
    store.report(report("p1", { title: "second", decorated: true }));
    expect(store.read("p1")?.title).toBe("second");
    expect(store.read("p1")?.decorated).toBe(true);
  });
});

describe("validation", () => {
  const bad: Array<[string, unknown]> = [
    ["empty paneId", { type: "paneEvidence", paneId: "", title: "x", decorated: false }],
    ["non-string paneId", { type: "paneEvidence", paneId: 7, title: "x", decorated: false }],
    ["title without decorated", { type: "paneEvidence", paneId: "p1", title: "x" }],
    ["decorated without title", { type: "paneEvidence", paneId: "p1", decorated: true }],
    ["non-string title", { type: "paneEvidence", paneId: "p1", title: 7, decorated: false }],
    ["non-boolean decorated", { type: "paneEvidence", paneId: "p1", title: "x", decorated: "yes" }],
    ["non-boolean waiting", { type: "paneEvidence", paneId: "p1", waiting: "yes" }],
    ["no evidence at all", { type: "paneEvidence", paneId: "p1" }],
  ];

  for (const [name, msg] of bad) {
    it(`drops a report with ${name}`, () => {
      const store = createPaneEvidenceStore();
      store.create("p1");
      store.report(msg as PaneEvidenceMessage);
      const evidence = store.read("p1");
      expect(evidence?.title).toBeUndefined();
      expect(evidence?.waiting).toBeUndefined();
    });
  }

  it("truncates an oversized title rather than holding it whole", () => {
    const store = createPaneEvidenceStore();
    store.create("p1");
    store.report(report("p1", { title: "x".repeat(5000), decorated: false }));
    expect(store.read("p1")?.title).toHaveLength(1024);
  });
});

describe("host-owned evidence", () => {
  it("projects running from output inside the idle window and idle past it", () => {
    let clock = 10_000;
    const store = createPaneEvidenceStore({ now: () => clock });
    store.create("p1");

    store.markOutput("p1", clock);
    expect(store.activityFor("p1")).toBe("running");

    clock += 1499;
    expect(store.activityFor("p1")).toBe("running");
    clock += 1;
    expect(store.activityFor("p1")).toBe("idle");
  });

  it("projects running from semantic evidence with no output at all", () => {
    const store = createPaneEvidenceStore();
    store.create("p1");
    store.setSemantic("p1", "working");
    expect(store.activityFor("p1")).toBe("running");

    store.setSemantic("p1", null);
    expect(store.activityFor("p1")).toBe("idle");
  });

  it("projects waiting over running", () => {
    const clock = 10_000;
    const store = createPaneEvidenceStore({ now: () => clock });
    store.create("p1");
    store.markOutput("p1", clock);
    store.report(report("p1", { waiting: true }));
    expect(store.activityFor("p1")).toBe("waiting");
  });

  it("is correct for a pane no surface ever reported", () => {
    const clock = 10_000;
    const store = createPaneEvidenceStore({ now: () => clock });
    store.create("p1");
    store.markOutput("p1", clock);
    expect(store.activityFor("p1")).toBe("running");
    store.markExited("p1", true);
    expect(store.activityFor("p1")).toBe("exited");
  });

  it("clears exit when a fresh process replaces the dead one", () => {
    const store = createPaneEvidenceStore();
    store.create("p1");
    store.markExited("p1", true);
    store.markExited("p1", false);
    expect(store.activityFor("p1")).toBe("idle");
  });

  it("ignores host signals for a pane it does not hold", () => {
    const store = createPaneEvidenceStore();
    expect(() => {
      store.markOutput("ghost", 1);
      store.markExited("ghost", true);
      store.setSemantic("ghost", "working");
      store.delete("ghost");
    }).not.toThrow();
    expect(store.read("ghost")).toBeUndefined();
  });
});

describe("out-of-order flush confirmations", () => {
  it("keeps the newest output time when an older flush confirms last", () => {
    const store = createPaneEvidenceStore({ now: () => 10_000 });
    store.create("a");

    store.markOutput("a", 9_500);
    store.markOutput("a", 9_000);

    // Each flush confirms on its own postMessage promise and nothing orders
    // them, so the store — not the caller — has to hold the line.
    expect(store.read("a")?.lastOutputAt).toBe(9_500);
    expect(store.activityFor("a")).toBe("running");
  });

  it("announces nothing for a stamp it refused", () => {
    const changed: string[] = [];
    const store = createPaneEvidenceStore({ onChange: (id) => changed.push(id) });
    store.create("a");
    store.markOutput("a", 9_500);
    changed.length = 0;

    store.markOutput("a", 9_000);
    store.markOutput("a", 9_500);

    expect(changed).toEqual([]);
  });

  it("still takes a newer stamp", () => {
    const store = createPaneEvidenceStore();
    store.create("a");
    store.markOutput("a", 9_000);

    store.markOutput("a", 9_600);

    expect(store.read("a")?.lastOutputAt).toBe(9_600);
  });
});

describe("change notification", () => {
  it("fires on every mutation that moves what a projection would render", () => {
    const onChange = vi.fn();
    const store = createPaneEvidenceStore({ onChange });

    store.create("p1");
    store.report(report("p1", { waiting: true }));
    store.markExited("p1", true);
    store.setSemantic("p1", "idle");
    store.delete("p1");

    expect(onChange.mock.calls.map(([id]) => id)).toEqual(["p1", "p1", "p1", "p1", "p1"]);
  });

  it("fires for output that changes the pane's activity, and not for output that does not", () => {
    // WT-004.1 D3.2: output arrives per flush, so announcing every timestamp
    // would drive a presence rebuild at flush rate for a pane that has been
    // `running` throughout. The transition is the event; the flush is not.
    const onChange = vi.fn();
    const store = createPaneEvidenceStore({ onChange, now: () => 1_000 });

    store.create("p1");
    onChange.mockClear();
    store.markOutput("p1", 1_000);
    expect(onChange).toHaveBeenCalledTimes(1); // idle → running

    store.markOutput("p1", 1_010);
    store.markOutput("p1", 1_020);
    expect(onChange).toHaveBeenCalledTimes(1); // still running — nothing moved
  });

  it("stays silent for output on a pane whose waiting state already outranks it", () => {
    const onChange = vi.fn();
    const store = createPaneEvidenceStore({ onChange, now: () => 1_000 });
    store.create("p1");
    store.report(report("p1", { waiting: true }));
    onChange.mockClear();

    store.markOutput("p1", 1_000);
    expect(onChange).not.toHaveBeenCalled();
    expect(store.activityFor("p1")).toBe("waiting");
  });

  it("does not fire for a dropped report or an unknown pane", () => {
    const onChange = vi.fn();
    const store = createPaneEvidenceStore({ onChange });
    store.create("p1");
    onChange.mockClear();

    store.report({ type: "paneEvidence", paneId: "p1" } as PaneEvidenceMessage);
    store.markOutput("ghost", 1);
    store.delete("ghost");

    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not fire when a report changes nothing", () => {
    const onChange = vi.fn();
    const store = createPaneEvidenceStore({ onChange });
    store.create("p1");
    store.report(report("p1", { title: "same", decorated: false }));
    onChange.mockClear();

    store.report(report("p1", { title: "same", decorated: false }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ─── WT-004.1 — the store as the pane registry ──────────────────────

/** A store with a fake clock and fake timers, so idle expiry needs no waiting. */
function harness() {
  let clock = 10_000;
  const fired: Array<{ at: number; fn: () => void }> = [];
  let nextHandle = 1;
  const handles = new Map<number, { at: number; fn: () => void }>();
  const changes: string[] = [];
  const store = createPaneEvidenceStore({
    now: () => clock,
    onChange: (paneId) => changes.push(paneId),
    timers: {
      setTimeout: (fn, ms) => {
        const handle = nextHandle++;
        handles.set(handle, { at: clock + ms, fn });
        return handle;
      },
      clearTimeout: (handle) => {
        handles.delete(handle as number);
      },
    },
  });
  return {
    store,
    changes,
    fired,
    advance(ms: number) {
      clock += ms;
      for (const [handle, timer] of [...handles]) {
        if (timer.at <= clock) {
          handles.delete(handle);
          timer.fn();
        }
      }
    },
    pending: () => handles.size,
  };
}

describe("pane enumeration", () => {
  it("enumerates every open pane with the facts a projection needs", () => {
    const { store } = harness();
    store.create("p1", { viewId: "sidebar", cwd: "/repo", ptyPid: 42, shell: "/bin/zsh" });
    store.create("p2", { viewId: "panel", cwd: "/repo/wt", ptyPid: 43, shell: "claude", isAgentLaunch: true });

    expect(store.panes()).toEqual([
      expect.objectContaining({ paneId: "p1", viewId: "sidebar", cwd: "/repo", ptyPid: 42, shell: "/bin/zsh" }),
      expect.objectContaining({ paneId: "p2", viewId: "panel", cwd: "/repo/wt", ptyPid: 43, isAgentLaunch: true }),
    ]);
  });

  it("still enumerates a pane whose process exited", () => {
    // The session leaves SessionManager on a natural exit while the tab is still
    // on screen — enumerating from there would drop the row that must read
    // `exited` until the pane closes.
    const { store } = harness();
    store.create("p1", { viewId: "sidebar", cwd: "/repo" });
    store.markExited("p1", true);
    expect(store.panes().map((p) => p.paneId)).toEqual(["p1"]);
    expect(store.activityFor("p1")).toBe("exited");

    store.delete("p1");
    expect(store.panes()).toEqual([]);
  });

  it("records a pane's later working directory", () => {
    const { store, changes } = harness();
    store.create("p1", { cwd: "/repo" });
    changes.length = 0;
    store.markCwd("p1", "/repo/wt");
    expect(store.read("p1")?.cwd).toBe("/repo/wt");
    expect(changes).toEqual(["p1"]);
  });

  it("says nothing when the working directory did not move", () => {
    const { store, changes } = harness();
    store.create("p1", { cwd: "/repo" });
    changes.length = 0;
    store.markCwd("p1", "/repo");
    expect(changes).toEqual([]);
  });

  it("updates process facts when a shell reclaims the pane", () => {
    const { store } = harness();
    store.create("p1", { ptyPid: 42, shell: "claude", isAgentLaunch: true });
    store.markProcess("p1", { ptyPid: 99, shell: "/bin/zsh", isAgentLaunch: false });
    expect(store.read("p1")).toMatchObject({ ptyPid: 99, shell: "/bin/zsh", isAgentLaunch: false });
  });

  it("ignores registry writes for a pane that does not exist", () => {
    const { store, changes } = harness();
    store.markCwd("ghost", "/repo");
    store.markProcess("ghost", { ptyPid: 1 });
    expect(store.read("ghost")).toBeUndefined();
    expect(changes).toEqual([]);
  });
});

describe("title classification", () => {
  it("classifies a shell title, forcing idle over live output", () => {
    const { store } = harness();
    store.create("p1");
    store.markOutput("p1", 10_000);
    expect(store.activityFor("p1")).toBe("running");
    store.report(report("p1", { title: "zsh", decorated: false }));
    expect(store.activityFor("p1")).toBe("idle");
  });

  it("leaves a neutral title alone", () => {
    const { store } = harness();
    store.create("p1");
    store.markOutput("p1", 10_000);
    store.report(report("p1", { title: "Terminal", decorated: false }));
    expect(store.activityFor("p1")).toBe("running");
  });

  it("leaves an agent title alone", () => {
    const { store } = harness();
    store.create("p1");
    store.markOutput("p1", 10_000);
    store.report(report("p1", { title: "claude", decorated: false }));
    expect(store.activityFor("p1")).toBe("running");
  });

  it("treats a title nobody reported exactly as before", () => {
    const { store } = harness();
    store.create("p1");
    store.markOutput("p1", 10_000);
    expect(store.activityFor("p1")).toBe("running");
  });
});

describe("output announces transitions, not flushes", () => {
  it("announces once when a pane starts producing output", () => {
    const { store, changes } = harness();
    store.create("p1");
    changes.length = 0;
    store.markOutput("p1", 10_000);
    store.markOutput("p1", 10_010);
    store.markOutput("p1", 10_020);
    store.markOutput("p1", 10_030);
    expect(changes).toEqual(["p1"]);
  });
});

describe("idle expiry", () => {
  it("announces when output ages out, with no further input", () => {
    const h = harness();
    h.store.create("p1");
    h.store.markOutput("p1", 10_000);
    h.changes.length = 0;

    h.advance(1_600);
    expect(h.changes).toEqual(["p1"]);
    expect(h.store.activityFor("p1")).toBe("idle");
  });

  it("re-arms on later output so the deadline follows the last flush", () => {
    const h = harness();
    h.store.create("p1");
    h.store.markOutput("p1", 10_000);
    h.advance(1_000);
    h.store.markOutput("p1", 11_000);
    h.changes.length = 0;

    h.advance(1_000); // 1s after the second flush — still inside the window
    expect(h.changes).toEqual([]);
    expect(h.store.activityFor("p1")).toBe("running");

    h.advance(600);
    expect(h.changes).toEqual(["p1"]);
  });

  it("does not announce an idle edge that changes nothing visible", () => {
    // The pane is waiting, which outranks running, so output ageing out moves
    // no observable state.
    const h = harness();
    h.store.create("p1");
    h.store.report(report("p1", { waiting: true }));
    h.store.markOutput("p1", 10_000);
    h.changes.length = 0;

    h.advance(1_600);
    expect(h.changes).toEqual([]);
    expect(h.store.activityFor("p1")).toBe("waiting");
  });

  it("leaves no timer behind when the pane goes away", () => {
    const h = harness();
    h.store.create("p1");
    h.store.markOutput("p1", 10_000);
    expect(h.pending()).toBe(1);
    h.store.delete("p1");
    expect(h.pending()).toBe(0);
  });

  it("leaves no timer behind when the whole view goes away", () => {
    const h = harness();
    h.store.create("p1", { viewId: "sidebar" });
    h.store.markOutput("p1", 10_000);
    h.store.deleteForView("sidebar");
    expect(h.pending()).toBe(0);
  });

  it("leaves no timer behind on clear", () => {
    const h = harness();
    h.store.create("p1");
    h.store.markOutput("p1", 10_000);
    h.store.clear();
    expect(h.pending()).toBe(0);
  });
});

// ─── The rule behind the activity (.reviews/round-1.md W2) ──────────

describe("explainActivityFor", () => {
  it("names the shell title only when it overruled live output", () => {
    const store = createPaneEvidenceStore({ now: () => 1_000 });
    store.create("a");
    store.markOutput("a", 1_000);
    store.report({ type: "paneEvidence", paneId: "a", title: "zsh", decorated: false });

    expect(store.explainActivityFor("a", 1_000)).toEqual({ activity: "idle", rule: "shell-title" });
  });

  it("reports a quiet pane as quiet, whatever its title says", () => {
    const store = createPaneEvidenceStore({ now: () => 1_000 });
    store.create("a");
    store.report({ type: "paneEvidence", paneId: "a", title: "zsh", decorated: false });

    expect(store.explainActivityFor("a", 1_000)).toEqual({ activity: "idle", rule: "quiet" });
  });

  it("agrees with activityFor, which is the same projection", () => {
    const store = createPaneEvidenceStore({ now: () => 1_000 });
    store.create("a");
    store.markOutput("a", 1_000);
    expect(store.explainActivityFor("a", 1_000)?.activity).toBe(store.activityFor("a", 1_000));
  });

  it("answers nothing for a pane it does not hold", () => {
    expect(createPaneEvidenceStore().explainActivityFor("ghost")).toBeUndefined();
  });
});
