// src/webview/vault/forkPoint.ts — where a continuation forks from
// (improve-vault-transcript-messages D9).
//
// Continuing means picking up where the previous agent had just replied, so the
// fork point is an ASSISTANT turn and the reader's instruction is the user turn
// that follows it. Both entry points on the action bar — the reply itself, or
// the user message after it — resolve to that same pair here.

import type { VaultTimelineItem } from "../../vault/types";

type Message = Extract<VaultTimelineItem, { kind: "message" }>;

export interface ForkPoint {
  /** Locator of the anchoring assistant reply; absent when none precedes. */
  anchorRef?: string;
  /** The reply's text as the panel holds it — a preview for the dialog, bounded. */
  anchorText?: string;
  /** Locator of the user turn to seed the editor from; absent when there is none. */
  seedRef?: string;
  /** That turn's text as the panel holds it — the dialog replaces it with the
   *  untruncated record text once the host resolves `seedRef`. */
  seedText?: string;
}

function isMessage(item: VaultTimelineItem): item is Message {
  return item.kind === "message";
}

/** Scan one direction for the nearest message of `role`, ignoring tools, notices
 *  and every other kind between them. */
function nearest(
  timeline: VaultTimelineItem[],
  from: number,
  step: 1 | -1,
  role: Message["role"],
): Message | undefined {
  for (let i = from; i >= 0 && i < timeline.length; i += step) {
    const item = timeline[i];
    if (item.kind === "gap") {
      return undefined;
    }
    if (isMessage(item) && item.role === role) {
      return item;
    }
  }
  return undefined;
}

function parts(anchor: Message | undefined, seed: Message | undefined): ForkPoint {
  return {
    ...(anchor?.msgRef ? { anchorRef: anchor.msgRef } : {}),
    ...(anchor ? { anchorText: anchor.text } : {}),
    ...(seed?.msgRef ? { seedRef: seed.msgRef } : {}),
    ...(seed ? { seedText: seed.text } : {}),
  };
}

export function resolveForkPoint(timeline: VaultTimelineItem[], chosen: Message): ForkPoint {
  const at = timeline.indexOf(chosen);
  if (at < 0) {
    return {};
  }
  if (chosen.role === "assistant") {
    return parts(chosen, nearest(timeline, at + 1, 1, "user"));
  }
  const anchor = nearest(timeline, at - 1, -1, "assistant");
  return anchor ? parts(anchor, chosen) : {};
}
