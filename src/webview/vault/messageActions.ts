// src/webview/vault/messageActions.ts — one shared per-message action bar,
// revealed on hover/focus by delegation (improve-vault-transcript-messages D6).

import type { VaultTimelineItem } from "../../vault/types";
import { type ForkPoint, resolveForkPoint } from "./forkPoint";
import { bindLatestSuccess } from "./latestSuccess";
import { actionSourceOf, type VaultActionSource } from "./renderAtoms";

export type MessageSource = Extract<VaultTimelineItem, { kind: "message" }>;

export interface MessageActionsDeps {
  /** Write to the clipboard. The owner routes this through its serialized chain;
   *  a rejection means the clipboard refused and must NOT be confirmed. */
  copy: (text: string, label: string) => void | Promise<void>;
  /**
   * Resolve a message's stored record through the host (D5) — the panel holds only
   * the bounded text, so Raw cannot be served locally. Rejects when the record is
   * missing or over the size cap; omit to leave the Raw action off entirely.
   */
  copyRaw?: (msgRef: string) => Promise<string>;
  /** The timeline currently rendered, in order — the fork point is read from it
   *  rather than from the hovered element alone (D9). */
  timeline?: () => VaultTimelineItem[];
  /** Open the continuation dialog for this fork point (D9, D10). Nothing launches
   *  here: the dialog owns that decision. Omit to leave the action off. */
  continueFrom?: (fork: ForkPoint) => void;
}

const MESSAGE_SELECTOR = ".vault-preview-message";

/** `**User** · <ISO>` then the body — a quotable message, not a screenshot of one. */
export function toMarkdown(src: MessageSource): string {
  const who = src.role === "assistant" ? "Assistant" : "User";
  const when = src.timestamp ? ` · ${new Date(src.timestamp).toISOString()}` : "";
  return `**${who}**${when}\n\n${src.text}`;
}

/** The timeline item as the panel holds it — bounded text included, so it is
 *  honestly the preview's view of the message, not the store's (Raw is that). */
export function toJson(src: MessageSource): string {
  return JSON.stringify(src, null, 2);
}

/**
 * Mount the bar inside `root` and return a disposer. ONE bar exists for the whole
 * transcript: hovering a message moves it into that message, so a 400-item preview
 * costs one element and two listeners rather than 400 of each.
 */
export function mountMessageActions(root: HTMLElement, deps: MessageActionsDeps): () => void {
  let current: VaultActionSource | undefined;
  const bar = document.createElement("div");
  bar.className = "vault-msg-actions";

  const disposeButtons: (() => void)[] = [];
  const add = (
    name: string,
    label: string,
    title: string,
    run: (src: VaultActionSource) => void | Promise<void>,
  ): void => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "vault-msg-actions-btn";
    btn.dataset.action = name;
    btn.textContent = label;
    btn.title = title;
    disposeButtons.push(
      bindLatestSuccess(
        btn,
        () => {
          if (current) {
            return run(current);
          }
        },
        { stopPropagation: true },
      ),
    );
    bar.appendChild(btn);
  };

  add("md", "MD", "Copy as Markdown", (src) => {
    if (src.kind === "message") {
      return deps.copy(toMarkdown(src), "Markdown");
    }
  });
  add("json", "JSON", "Copy as JSON", (src) => {
    if (src.kind === "message") {
      return deps.copy(toJson(src), "JSON");
    }
  });
  const resolveRaw = deps.copyRaw;
  if (resolveRaw) {
    add("raw", "RAW", "Copy the stored record", async (src) => {
      if (!src.msgRef) {
        return;
      }
      // A failed resolve must propagate: the caller's catch is what stops the tick
      // from claiming a copy that never reached the clipboard.
      await deps.copy(await resolveRaw(src.msgRef), "Raw record");
    });
  }
  const startContinue = deps.continueFrom;
  if (startContinue) {
    add("continue", "CONTINUE", "Continue in a new session from this turn", (src) => {
      if (src.kind === "message") {
        startContinue(resolveForkPoint(deps.timeline?.() ?? [], src));
      }
    });
  }

  const reveal = (ev: Event): void => {
    const target = ev.target;
    if (!(target instanceof Element)) {
      return;
    }
    const el = target.closest<HTMLElement>(MESSAGE_SELECTOR);
    const src = el ? actionSourceOf(el) : undefined;
    if (!el || !src) {
      return;
    }
    current = src;
    const isMessage = src.kind === "message";
    for (const name of ["md", "json", "continue"]) {
      const action = bar.querySelector<HTMLElement>(`[data-action="${name}"]`);
      if (action) {
        action.hidden = !isMessage;
      }
    }
    const raw = bar.querySelector<HTMLElement>('[data-action="raw"]');
    if (raw) {
      raw.hidden = !src.msgRef;
    }
    if (bar.parentElement !== el) {
      el.appendChild(bar);
    }
  };

  root.addEventListener("mouseover", reveal);
  root.addEventListener("focusin", reveal);

  return () => {
    root.removeEventListener("mouseover", reveal);
    root.removeEventListener("focusin", reveal);
    for (const disposeButton of disposeButtons) {
      disposeButton();
    }
    bar.remove();
    current = undefined;
  };
}
