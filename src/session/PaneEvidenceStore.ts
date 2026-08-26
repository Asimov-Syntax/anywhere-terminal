// src/session/PaneEvidenceStore.ts — What the host knows about each pane.
//
// The Worktree view's scope is the WINDOW, but two of the six signals it needs
// live only inside individual webviews, and each webview sees only the panes on
// its own surface. This store is where the host assembles the window-wide view:
// surfaces report what only they can see, the host writes what it already owns,
// and everything is keyed by pane so the surface a fact arrived from stops
// mattering the moment it lands.
//
// Nothing reads this yet — WT-004.1 projects the rows. The seam is built and
// verified first, on purpose (docs/PLAN.md WT-004.0).
//
// See: docs/design/worktree-agent-presence.md § 3.3 "The host evidence seam";
//      asimov/changes/add-host-pane-evidence/design.md D1, D2, D3, D10.

import {
  MAX_REPORTED_TITLE_CHARS,
  OUTPUT_IDLE_WINDOW_MS,
  type PaneActivity,
  projectPaneActivity,
} from "../shared/paneEvidence";
import type { PaneEvidenceMessage } from "../types/messages";

/**
 * Everything known about one pane.
 *
 * Optionality is load-bearing. `undefined` means *nothing has told us*, and it
 * is NOT the same claim as `waiting: false` or an empty title — a pane no
 * surface has reported yet has unknown title evidence, which falls through to
 * the next identity rank rather than resolving to "no agent". A parallel
 * `titleReported: boolean` would say the same thing in a second place and drift
 * from the value it describes; the optionality cannot.
 */
export interface PaneEvidence {
  /** Decorative signature of the last reported title. `undefined` = never reported. */
  title?: string;
  /** Whether the last reported raw title carried a decorative frame. */
  decorated?: boolean;
  /** `undefined` = never reported; `false` = reported as not waiting. */
  waiting?: boolean;
  /** Epoch ms output was last delivered to the surface. `undefined` = none yet. */
  lastOutputAt?: number;
  /** The pty has exited and the pane is still open. */
  exited: boolean;
  /** Last agent-reported semantic state; `null` cleared, `undefined` never set. */
  semantic?: "working" | "idle" | null;
}

export interface PaneEvidenceStoreOptions {
  now?: () => number;
  /**
   * Fired on any mutation. Nothing subscribes in WT-004.0: the presence rebuild
   * this eventually drives is coalesced into the tree's 150 ms debounce, which
   * `worktree-agent-presence.md` § 3.7 owns. Output *going* idle is a clock
   * event, not a mutation, so it fires nothing — a store running its own idle
   * timer would be a second debounce competing with that one.
   */
  onChange?: (paneId: string) => void;
}

export interface PaneEvidenceStore {
  /** The only entry-creating call. */
  create(paneId: string, init?: { exited?: boolean; viewId?: string }): void;
  /** Assigns only the fields the message carries. No-op for an unknown pane. */
  report(msg: PaneEvidenceMessage): void;
  markOutput(paneId: string, at: number): void;
  markExited(paneId: string, exited: boolean): void;
  setSemantic(paneId: string, state: "working" | "idle" | null): void;
  delete(paneId: string): void;
  /** Discard every pane a closing view held, whether or not its process is still alive. */
  deleteForView(viewId: string): void;
  clear(): void;
  read(paneId: string): PaneEvidence | undefined;
  activityFor(paneId: string, now?: number): PaneActivity | undefined;
}

/** What survives validation: the fields a report may assign. */
interface ReportedFields {
  title?: string;
  decorated?: boolean;
  waiting?: boolean;
}

/**
 * Validate an inbound report. Providers hand this through after a discriminant
 * check only, so every field is untrusted here.
 *
 * `title` and `decorated` are a pair by contract — the host cannot recompute
 * decoration from a stripped title, so half the pair is not evidence, it is a
 * bug — and a message carrying neither title nor waiting asserts nothing and is
 * dropped rather than recorded as an empty update.
 */
function validateReport(msg: PaneEvidenceMessage): ReportedFields | undefined {
  const { title, decorated, waiting } = msg;

  if (title !== undefined) {
    if (typeof title !== "string" || typeof decorated !== "boolean") {
      return undefined;
    }
  } else if (decorated !== undefined) {
    return undefined;
  }
  if (waiting !== undefined && typeof waiting !== "boolean") {
    return undefined;
  }
  if (title === undefined && waiting === undefined) {
    return undefined;
  }

  const fields: ReportedFields = {};
  if (title !== undefined) {
    fields.title = title.slice(0, MAX_REPORTED_TITLE_CHARS);
    fields.decorated = decorated;
  }
  if (waiting !== undefined) {
    fields.waiting = waiting;
  }
  return fields;
}

export function createPaneEvidenceStore(options: PaneEvidenceStoreOptions = {}): PaneEvidenceStore {
  const now = options.now ?? Date.now;
  const panes = new Map<string, PaneEvidence>();
  /**
   * Which view holds each pane, kept here rather than read back from
   * `SessionManager.viewSessions`, which is the wrong lifetime for the same
   * reason the session map is: a natural pty exit removes the pane from it
   * while the tab is still on screen, so a view close that walked it would
   * leave exactly the durable `exited` evidence behind (.reviews/round-1.md B1).
   */
  const paneView = new Map<string, string>();
  /** The reverse index, so closing a view never scans a pane it does not hold. */
  const viewPanes = new Map<string, Set<string>>();

  /** Drop a pane from whichever view currently holds it. */
  function unindex(paneId: string): void {
    const held = paneView.get(paneId);
    if (held === undefined) {
      return;
    }
    paneView.delete(paneId);
    const siblings = viewPanes.get(held);
    if (siblings?.delete(paneId) && siblings.size === 0) {
      viewPanes.delete(held);
    }
  }

  function changed(paneId: string): void {
    options.onChange?.(paneId);
  }

  /** Mutate an existing pane, announcing only a write that actually happened. */
  function mutate(paneId: string, apply: (evidence: PaneEvidence) => boolean): void {
    const evidence = panes.get(paneId);
    if (!evidence) {
      return;
    }
    if (apply(evidence)) {
      changed(paneId);
    }
  }

  return {
    create(paneId, init) {
      // Replaces rather than merges: the id belongs to a pane that has just come
      // into existence, so anything held under it is from a previous life.
      panes.set(paneId, { exited: init?.exited === true });
      unindex(paneId);
      if (init?.viewId !== undefined) {
        paneView.set(paneId, init.viewId);
        const siblings = viewPanes.get(init.viewId);
        if (siblings) {
          siblings.add(paneId);
        } else {
          viewPanes.set(init.viewId, new Set([paneId]));
        }
      }
      changed(paneId);
    },

    report(msg) {
      // No create-on-write, deliberately. A webview naming ids the host never
      // issued cannot grow this map, so its bound is the window's open pane
      // count — the same rule DESIGN.md § 8.5 applies to every webview-supplied
      // id, enforced by construction rather than by a predicate that can go
      // stale against the session map.
      if (typeof msg.paneId !== "string" || msg.paneId === "" || !panes.has(msg.paneId)) {
        return;
      }
      const fields = validateReport(msg);
      if (!fields) {
        return;
      }
      mutate(msg.paneId, (evidence) => {
        let wrote = false;
        const titleMoved = evidence.title !== fields.title || evidence.decorated !== fields.decorated;
        if (fields.title !== undefined && titleMoved) {
          evidence.title = fields.title;
          evidence.decorated = fields.decorated;
          wrote = true;
        }
        if (fields.waiting !== undefined && evidence.waiting !== fields.waiting) {
          evidence.waiting = fields.waiting;
          wrote = true;
        }
        return wrote;
      });
    },

    markOutput(paneId, at) {
      mutate(paneId, (evidence) => {
        // Monotonic, because flush confirmations are not ordered: each flush
        // carries the time it was produced and lands when its own postMessage
        // resolves, so an older one confirming last would otherwise age the
        // pane and let it read idle while output had just been delivered
        // (.reviews/round-3.md W4).
        if (evidence.lastOutputAt !== undefined && at <= evidence.lastOutputAt) {
          return false;
        }
        evidence.lastOutputAt = at;
        return true;
      });
    },

    markExited(paneId, exited) {
      mutate(paneId, (evidence) => {
        if (evidence.exited === exited) {
          return false;
        }
        evidence.exited = exited;
        return true;
      });
    },

    setSemantic(paneId, state) {
      mutate(paneId, (evidence) => {
        if (evidence.semantic === state) {
          return false;
        }
        evidence.semantic = state;
        return true;
      });
    },

    delete(paneId) {
      unindex(paneId);
      if (panes.delete(paneId)) {
        changed(paneId);
      }
    },

    deleteForView(viewId) {
      const held = viewPanes.get(viewId);
      if (!held) {
        return;
      }
      viewPanes.delete(viewId);
      for (const paneId of held) {
        paneView.delete(paneId);
        if (panes.delete(paneId)) {
          changed(paneId);
        }
      }
    },

    clear() {
      panes.clear();
      paneView.clear();
      viewPanes.clear();
    },

    read(paneId) {
      return panes.get(paneId);
    },

    activityFor(paneId, at) {
      const evidence = panes.get(paneId);
      if (!evidence) {
        return undefined;
      }
      const stamp = at ?? now();
      return projectPaneActivity({
        exited: evidence.exited,
        // Unknown waiting projects as not-waiting; the distinction is preserved
        // in the evidence itself, for the caller that has to qualify the source.
        waiting: evidence.waiting === true,
        semanticWorking: evidence.semantic === "working",
        outputActive: evidence.lastOutputAt !== undefined && stamp - evidence.lastOutputAt < OUTPUT_IDLE_WINDOW_MS,
      });
    },
  };
}
