// src/webview/terminal/paneEvidenceReporter.ts — Reports what only this surface
// can see about its panes: the title, and whether the pane is waiting.
//
// The host owns every other presence signal already. These two are xterm state,
// known nowhere else, so the surface has to push them — and push them the way
// the host can trust: normalized, deduplicated, and only when they change.
//
// See: docs/design/worktree-agent-presence.md § 3.3 "The host evidence seam";
//      asimov/changes/add-host-pane-evidence/design.md D3, D7, D8.

import { MAX_REPORTED_TITLE_CHARS } from "../../shared/paneEvidence";
import type { PaneEvidenceMessage } from "../../types/messages";
import { boundedTitleSignature, hasDecorativeFrame } from "./titleSignature";

export interface PaneEvidenceReporter {
  /** Feed a raw xterm title. Sends only when the signature or decoration moved. */
  reportTitle(paneId: string, rawTitle: string): void;
  /** Feed a waiting flip. Sends only when the value moved. */
  reportWaiting(paneId: string, waiting: boolean): void;
  /** Drop local dedup state for a pane this surface no longer renders. */
  forget(paneId: string): void;
}

/** What was last sent for a pane. `undefined` = never sent, so the next send is due. */
interface LastSent {
  title?: string;
  decorated?: boolean;
  waiting?: boolean;
}

export function createPaneEvidenceReporter(post: (msg: PaneEvidenceMessage) => void): PaneEvidenceReporter {
  const sent = new Map<string, LastSent>();

  function last(paneId: string): LastSent {
    let entry = sent.get(paneId);
    if (!entry) {
      entry = {};
      sent.set(paneId, entry);
    }
    return entry;
  }

  return {
    reportTitle(paneId, rawTitle) {
      // Bounded at the point of production rather than by slicing either end of
      // the work: `titleSignature(raw).slice(...)` builds two full-size
      // intermediates of a payload xterm allows up to 10 MB (.reviews/round-1.md
      // W2), and slicing the raw string first reports a different value than the
      // contract names (round-2 B3).
      const title = boundedTitleSignature(rawTitle, MAX_REPORTED_TITLE_CHARS);
      // A separate native regex, and measurably the cheap way round — folding it
      // into the loop above costs 200x on a large undecorated title (round-3 W2).
      // It reads the WHOLE raw title, as the spec defines it: whether the title
      // carried a frame, not whether its first 1024 characters did.
      const decorated = hasDecorativeFrame(rawTitle);
      const entry = last(paneId);
      // Decoration is part of the compared state, not just stripped from it:
      // `⠙ Fix tests` → `Fix tests` leaves the signature identical while proving
      // the spinner stopped, which is exactly the evidence the host wants.
      if (entry.title === title && entry.decorated === decorated) {
        return;
      }
      entry.title = title;
      entry.decorated = decorated;
      // Waiting is deliberately absent: it changes on its own schedule, and
      // restating it here would report evidence this call never observed.
      post({ type: "paneEvidence", paneId, title, decorated });
    },

    reportWaiting(paneId, waiting) {
      const entry = last(paneId);
      if (entry.waiting === waiting) {
        return;
      }
      entry.waiting = waiting;
      post({ type: "paneEvidence", paneId, waiting });
    },

    forget(paneId) {
      // Local only. The host discards evidence when the PANE closes, which it
      // learns from its own session lifecycle — a surface tearing down its DOM
      // must never retract what it reported, because the pane outlives it.
      sent.delete(paneId);
    },
  };
}
