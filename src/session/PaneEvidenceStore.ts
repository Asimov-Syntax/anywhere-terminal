// src/session/PaneEvidenceStore.ts — What the host knows about each pane.
//
// The Worktree view's scope is the WINDOW, but two of the six signals it needs
// live only inside individual webviews, and each webview sees only the panes on
// its own surface. This store is where the host assembles the window-wide view:
// surfaces report what only they can see, the host writes what it already owns,
// and everything is keyed by pane so the surface a fact arrived from stops
// mattering the moment it lands.
//
// It is also THE pane registry. `SessionManager` drops a naturally-exited
// session from its maps while the tab is still on screen showing
// `[Process exited]`, so a projection enumerating panes from there would delete
// the row that must keep reading `exited` until the pane closes. This store's
// lifetime is the pane's, which is the lifetime the projection needs, so the
// pane's own facts live here beside the evidence about it.
//
// See: docs/design/worktree-agent-presence.md § 3.3 "The host evidence seam";
//      asimov/changes/add-host-pane-evidence/design.md D1, D2, D3, D10;
//      asimov/changes/project-worktree-agent-presence/design.md D2, D3.

import type { AgentTurnReport } from "../agentHooks/AgentHookRuntime";
import {
  type ActivityRule,
  classifyTitle,
  explainPaneActivity,
  MAX_REPORTED_TITLE_CHARS,
  OUTPUT_IDLE_WINDOW_MS,
  type PaneActivity,
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
  /** Best-known working directory — spawn directory, then every OSC 7 update. */
  cwd?: string;
  /** The pane's pty pid, re-written when a fallback shell replaces the process. */
  ptyPid?: number;
  /** The pane's root executable. */
  shell?: string;
  /** True while an agent CLI is the root process; cleared on fallback respawn. */
  isAgentLaunch?: boolean;
  /** Which view holds the pane. */
  viewId?: string;
  /** The agent's own report of its turn, if it has made one. */
  turn?: PaneTurn;
}

/**
 * A turn report, stamped with when it arrived here.
 *
 * Freshness is measured from `receivedAt` because there is nothing else to
 * measure it from: hook payloads carry no clock of their own.
 */
export interface PaneTurn {
  report: AgentTurnReport;
  receivedAt: number;
}

/**
 * How long a report decides a pane's activity (DESIGN.md § 15).
 *
 * Only its authority expires. The identity a report carried stays until a newer
 * report supersedes it or the pane is destroyed — dropping that at the same
 * moment would take the row's identity away along with its activity.
 */
export const TURN_FRESHNESS_MS = 60_000;

/** Timer seam, so idle expiry is testable without waiting. */
export interface PaneEvidenceTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface PaneEvidenceStoreOptions {
  now?: () => number;
  /**
   * Fired when something a presence projection would render has moved.
   *
   * Output is the exception that shapes this: it arrives per flush, so
   * announcing every timestamp would drive a rebuild at flush rate for a pane
   * that has simply been `running` the whole time. `markOutput` therefore
   * announces only when the pane's PROJECTED activity moved.
   *
   * The cost of that is an edge nothing else would ever report: output going
   * idle is a clock event, and `activityFor` only discovers it when read. So
   * the store arms its own per-pane deadline and announces that transition
   * too — without it a worktree row reads `running` forever while the terminal
   * tab, which runs its own idle timer, reads `idle` (design.md D3).
   */
  onChange?: (paneId: string) => void;
  timers?: PaneEvidenceTimers;
}

export interface PaneEvidenceStore {
  /** The only entry-creating call. */
  create(
    paneId: string,
    init?: {
      exited?: boolean;
      viewId?: string;
      cwd?: string;
      ptyPid?: number;
      shell?: string;
      isAgentLaunch?: boolean;
    },
  ): void;
  /** Every open pane, in creation order. The projection's pane set. */
  panes(): readonly (PaneEvidence & { paneId: string })[];
  markCwd(paneId: string, cwd: string): void;
  markProcess(paneId: string, facts: { ptyPid?: number; shell?: string; isAgentLaunch?: boolean }): void;
  /** Assigns only the fields the message carries. No-op for an unknown pane. */
  report(msg: PaneEvidenceMessage): void;
  markOutput(paneId: string, at: number): void;
  markExited(paneId: string, exited: boolean): void;
  setSemantic(paneId: string, state: "working" | "idle" | null): void;
  /** Records what a pane's agent reported about its own turn. No-op for an unknown pane. */
  reportTurn(paneId: string, report: AgentTurnReport): void;
  delete(paneId: string): void;
  /** Discard every pane a closing view held, whether or not its process is still alive. */
  deleteForView(viewId: string): void;
  clear(): void;
  read(paneId: string): PaneEvidence | undefined;
  activityFor(paneId: string, now?: number): PaneActivity | undefined;
  /**
   * The same answer, plus the rule that produced it.
   *
   * A caller that has to name its evidence source cannot recover the rule from
   * the activity — `idle` is reached three different ways — and re-deriving it
   * outside would be a second copy of the projection (.reviews/round-1.md W2).
   */
  explainActivityFor(paneId: string, now?: number): { activity: PaneActivity; rule: ActivityRule } | undefined;
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
  /** Pending idle deadline per pane. */
  const idleTimers = new Map<string, unknown>();
  /** Pending turn-freshness deadline per pane. */
  const turnTimers = new Map<string, unknown>();
  /** The activity each pane was last announced as, so a no-op stays silent. */
  const announced = new Map<string, PaneActivity>();
  const timers = options.timers ?? {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };

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

  function explainOf(evidence: PaneEvidence, stamp: number): { activity: PaneActivity; rule: ActivityRule } {
    return explainPaneActivity({
      exited: evidence.exited,
      // Unknown waiting projects as not-waiting; the distinction is preserved
      // in the evidence itself, for the caller that has to qualify the source.
      waiting: evidence.waiting === true,
      semanticWorking: evidence.semantic === "working",
      outputActive: evidence.lastOutputAt !== undefined && stamp - evidence.lastOutputAt < OUTPUT_IDLE_WINDOW_MS,
      titleClass: classifyTitle(evidence.title),
    });
  }

  function activityOf(evidence: PaneEvidence, stamp: number): PaneActivity {
    return explainOf(evidence, stamp).activity;
  }

  function cancelIdleTimer(paneId: string): void {
    const handle = idleTimers.get(paneId);
    if (handle !== undefined) {
      timers.clearTimeout(handle);
      idleTimers.delete(paneId);
    }
  }

  function cancelTurnTimer(paneId: string): void {
    const handle = turnTimers.get(paneId);
    if (handle !== undefined) {
      timers.clearTimeout(handle);
      turnTimers.delete(paneId);
    }
  }

  /**
   * Schedule the moment this report stops deciding the pane's activity.
   *
   * A report going stale is a clock event: nothing else would ever announce it,
   * so a row would sit on a report's authority indefinitely while every other
   * surface had moved on. The record itself is left alone — only its authority
   * lapses.
   */
  function armTurnDeadline(paneId: string, receivedAt: number): void {
    cancelTurnTimer(paneId);
    turnTimers.set(
      paneId,
      timers.setTimeout(
        () => {
          turnTimers.delete(paneId);
          if (panes.has(paneId)) {
            changed(paneId);
          }
        },
        Math.max(0, receivedAt + TURN_FRESHNESS_MS - now()),
      ),
    );
  }

  function changed(paneId: string): void {
    const evidence = panes.get(paneId);
    if (evidence) {
      announced.set(paneId, activityOf(evidence, now()));
    }
    options.onChange?.(paneId);
  }

  /** Announce only if the pane's projected activity actually moved. */
  function announceIfActivityMoved(paneId: string): void {
    const evidence = panes.get(paneId);
    if (!evidence) {
      return;
    }
    if (activityOf(evidence, now()) !== announced.get(paneId)) {
      changed(paneId);
    }
  }

  /**
   * Schedule the moment this pane's output stops counting as recent. Re-armed on
   * every flush, so the deadline always follows the LAST one.
   */
  function armIdleDeadline(paneId: string, evidence: PaneEvidence): void {
    cancelIdleTimer(paneId);
    if (evidence.lastOutputAt === undefined) {
      return;
    }
    const remaining = evidence.lastOutputAt + OUTPUT_IDLE_WINDOW_MS - now();
    idleTimers.set(
      paneId,
      timers.setTimeout(
        () => {
          idleTimers.delete(paneId);
          announceIfActivityMoved(paneId);
        },
        Math.max(0, remaining),
      ),
    );
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
      cancelIdleTimer(paneId);
      panes.set(paneId, {
        exited: init?.exited === true,
        ...(init?.cwd !== undefined ? { cwd: init.cwd } : {}),
        ...(init?.ptyPid !== undefined ? { ptyPid: init.ptyPid } : {}),
        ...(init?.shell !== undefined ? { shell: init.shell } : {}),
        ...(init?.isAgentLaunch !== undefined ? { isAgentLaunch: init.isAgentLaunch } : {}),
        ...(init?.viewId !== undefined ? { viewId: init.viewId } : {}),
      });
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
      const evidence = panes.get(paneId);
      if (!evidence) {
        return;
      }
      // Monotonic, because flush confirmations are not ordered: each flush
      // carries the time it was produced and lands when its own postMessage
      // resolves, so an older one confirming last would otherwise age the
      // pane and let it read idle while output had just been delivered
      // (.reviews/round-3.md W4).
      if (evidence.lastOutputAt !== undefined && at <= evidence.lastOutputAt) {
        return;
      }
      evidence.lastOutputAt = at;
      armIdleDeadline(paneId, evidence);
      // Only the TRANSITION is worth announcing. A pane that was already
      // running stays running, and saying so per flush is what would drive a
      // rebuild at animation rate (design.md D3.2).
      announceIfActivityMoved(paneId);
    },

    markCwd(paneId, cwd) {
      mutate(paneId, (evidence) => {
        if (evidence.cwd === cwd) {
          return false;
        }
        evidence.cwd = cwd;
        return true;
      });
    },

    markProcess(paneId, facts) {
      mutate(paneId, (evidence) => {
        let wrote = false;
        if (facts.ptyPid !== undefined && evidence.ptyPid !== facts.ptyPid) {
          evidence.ptyPid = facts.ptyPid;
          wrote = true;
        }
        if (facts.shell !== undefined && evidence.shell !== facts.shell) {
          evidence.shell = facts.shell;
          wrote = true;
        }
        if (facts.isAgentLaunch !== undefined && evidence.isAgentLaunch !== facts.isAgentLaunch) {
          evidence.isAgentLaunch = facts.isAgentLaunch;
          wrote = true;
        }
        return wrote;
      });
    },

    panes() {
      return [...panes].map(([paneId, evidence]) => ({ paneId, ...evidence }));
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

    reportTurn(paneId, report) {
      const receivedAt = now();
      mutate(paneId, (evidence) => {
        evidence.turn = { report, receivedAt };
        return true;
      });
      if (panes.has(paneId)) {
        armTurnDeadline(paneId, receivedAt);
      }
    },

    delete(paneId) {
      unindex(paneId);
      cancelIdleTimer(paneId);
      cancelTurnTimer(paneId);
      announced.delete(paneId);
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
        cancelIdleTimer(paneId);
        cancelTurnTimer(paneId);
        announced.delete(paneId);
        if (panes.delete(paneId)) {
          changed(paneId);
        }
      }
    },

    clear() {
      for (const paneId of [...idleTimers.keys()]) {
        cancelIdleTimer(paneId);
      }
      for (const paneId of [...turnTimers.keys()]) {
        cancelTurnTimer(paneId);
      }
      panes.clear();
      paneView.clear();
      viewPanes.clear();
      announced.clear();
    },

    read(paneId) {
      return panes.get(paneId);
    },

    activityFor(paneId, at) {
      const evidence = panes.get(paneId);
      if (!evidence) {
        return undefined;
      }
      return activityOf(evidence, at ?? now());
    },

    explainActivityFor(paneId, at) {
      const evidence = panes.get(paneId);
      if (!evidence) {
        return undefined;
      }
      return explainOf(evidence, at ?? now());
    },
  };
}
