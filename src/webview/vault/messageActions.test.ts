// @vitest-environment jsdom

// src/webview/vault/messageActions.test.ts — shared per-message action bar
// (improve-vault-transcript-messages 4_1).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContinueDialogResult } from "./ContinueDialog";
import { type MessageSource, mountMessageActions } from "./messageActions";
import { PreviewController } from "./PreviewController";
import { bindActionSource, bindMessageSource, previewMessage } from "./renderAtoms";

let root: HTMLElement;
let dispose: (() => void) | undefined;

function message(text: string, role: "user" | "assistant", msgRef?: string): HTMLElement {
  const el = document.createElement("div");
  el.className = `vault-preview-message vault-preview-message-${role}`;
  el.textContent = text;
  bindMessageSource(el, { kind: "message", role, text, timestamp: 1_700_000_000_000, ...(msgRef ? { msgRef } : {}) });
  root.appendChild(el);
  return el;
}

/** Mount an element already bound to `src`, so the bar resolves that exact item
 *  out of the timeline by identity. */
function bound(src: MessageSource): HTMLElement {
  const el = document.createElement("div");
  el.className = `vault-preview-message vault-preview-message-${src.role}`;
  el.textContent = src.text;
  bindMessageSource(el, src);
  root.appendChild(el);
  return el;
}

function hover(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
}

function bar(): HTMLElement | null {
  return root.querySelector(".vault-msg-actions");
}

function action(name: string): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>(`.vault-msg-actions [data-action="${name}"]`);
}

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
});

describe("mountMessageActions", () => {
  it("shows one bar, moved into whichever message is hovered", () => {
    const copy = vi.fn();
    dispose = mountMessageActions(root, { copy });
    const first = message("hello", "user", "u-1");
    const second = message("there", "assistant", "a-1");

    hover(first);
    expect(bar()?.parentElement).toBe(first);
    hover(second);
    expect(bar()?.parentElement).toBe(second);
    // Moved, not cloned — a 400-message transcript still owns exactly one bar.
    expect(root.querySelectorAll(".vault-msg-actions")).toHaveLength(1);
  });

  it("copies the hovered message as Markdown", () => {
    const copy = vi.fn();
    dispose = mountMessageActions(root, { copy });
    hover(message("do the thing", "user", "u-1"));

    action("md")?.click();
    expect(copy).toHaveBeenCalledTimes(1);
    const [text, label] = copy.mock.calls[0];
    expect(text).toContain("**User**");
    expect(text).toContain("do the thing");
    expect(label).toBe("Markdown");
  });

  it("copies the hovered message as the JSON of its timeline item", () => {
    const copy = vi.fn();
    dispose = mountMessageActions(root, { copy });
    hover(message("done", "assistant", "a-7"));

    action("json")?.click();
    expect(JSON.parse(copy.mock.calls[0][0])).toMatchObject({
      kind: "message",
      role: "assistant",
      text: "done",
      msgRef: "a-7",
    });
  });

  it("acts on the message hovered most recently, not the first one bound", () => {
    const copy = vi.fn();
    dispose = mountMessageActions(root, { copy });
    message("first", "user", "u-1");
    const second = message("second", "user", "u-2");

    hover(second);
    action("md")?.click();
    expect(copy.mock.calls[0][0]).toContain("second");
  });

  // A synthetic focusin fires on any element, focusable or not — so this focuses
  // for real and checks the element actually took focus first.
  it("reveals the bar when a message really takes focus", () => {
    dispose = mountMessageActions(root, { copy: vi.fn() });
    const el = message("hello", "user", "u-1");
    el.focus();
    expect(document.activeElement).toBe(el);
    expect(bar()?.parentElement).toBe(el);
  });

  it("ignores a hovered element that carries no bound source", () => {
    dispose = mountMessageActions(root, { copy: vi.fn() });
    const stray = document.createElement("div");
    stray.className = "vault-preview-message vault-preview-message-notice";
    root.appendChild(stray);

    hover(stray);
    expect(bar()).toBeNull();
  });

  it("confirms a copy only after the write resolves", async () => {
    let release: (() => void) | undefined;
    const copy = vi.fn(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    dispose = mountMessageActions(root, { copy });
    hover(message("hello", "user", "u-1"));

    const btn = action("md");
    btn?.click();
    await Promise.resolve();
    expect(btn?.classList.contains("is-copied")).toBe(false);
    release?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(btn?.classList.contains("is-copied")).toBe(true);
  });

  it("does not confirm a copy the clipboard refused", async () => {
    const copy = vi.fn(async () => {
      throw new Error("no user activation");
    });
    dispose = mountMessageActions(root, { copy });
    hover(message("hello", "user", "u-1"));

    const btn = action("md");
    btn?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(btn?.classList.contains("is-copied")).toBe(false);
  });

  it("detaches its listeners on dispose", () => {
    const copy = vi.fn();
    const stop = mountMessageActions(root, { copy });
    const el = message("hello", "user", "u-1");
    stop();

    hover(el);
    expect(bar()).toBeNull();
  });
});

// improve-vault-transcript-messages 4_2 — Raw goes through the host, because the
// panel only ever holds the bounded text.
describe("mountMessageActions — Raw", () => {
  it("copies whatever the host resolved, not the message's bounded text", async () => {
    const copy = vi.fn();
    const copyRaw = vi.fn(async () => '{"uuid":"u-1","message":{"content":"the untruncated body"}}');
    dispose = mountMessageActions(root, { copy, copyRaw });
    hover(message("bounded…", "user", "u-1"));

    action("raw")?.click();
    await vi.waitFor(() => expect(copy).toHaveBeenCalled());
    expect(copyRaw).toHaveBeenCalledWith("u-1");
    expect(copy.mock.calls[0][0]).toContain("the untruncated body");
  });

  it("offers Raw only for an injected item carrying a locator", async () => {
    const copy = vi.fn();
    const copyRaw = vi.fn(async () => '{"type":"user","isCompactSummary":true}');
    dispose = mountMessageActions(root, { copy, copyRaw, continueFrom: vi.fn() });
    const injected = document.createElement("div");
    injected.className = "vault-preview-message vault-preview-message-compaction";
    bindActionSource(injected, { kind: "compaction", text: "bounded…", msgRef: "compact-1" });
    root.appendChild(injected);

    hover(injected);
    expect(action("raw")?.hidden).toBe(false);
    expect(action("md")?.hidden).toBe(true);
    expect(action("json")?.hidden).toBe(true);
    expect(action("continue")?.hidden).toBe(true);
    action("raw")?.click();
    await vi.waitFor(() => expect(copyRaw).toHaveBeenCalledWith("compact-1"));
    expect(copy).toHaveBeenCalledWith('{"type":"user","isCompactSummary":true}', "Raw record");
  });

  it("offers no Raw action for a message the reader could not address", () => {
    dispose = mountMessageActions(root, { copy: vi.fn(), copyRaw: vi.fn() });
    hover(message("hello", "user"));
    expect(action("raw")?.hidden).toBe(true);
  });

  it("offers no Raw action at all when the owner wired no resolver", () => {
    dispose = mountMessageActions(root, { copy: vi.fn() });
    hover(message("hello", "user", "u-1"));
    expect(action("raw")).toBeNull();
  });

  it("leaves the clipboard untouched and does not confirm when the record is unavailable", async () => {
    const copy = vi.fn();
    const copyRaw = vi.fn(async () => {
      throw new Error("Message record not found.");
    });
    dispose = mountMessageActions(root, { copy, copyRaw });
    hover(message("hello", "user", "u-1"));

    const btn = action("raw");
    btn?.click();
    await vi.waitFor(() => expect(copyRaw).toHaveBeenCalled());
    await Promise.resolve();
    await Promise.resolve();
    expect(copy).not.toHaveBeenCalled();
    expect(btn?.classList.contains("is-copied")).toBe(false);
  });
});

// The controller side of the round-trip: request out, reply matched back.
describe("PreviewController message-record round-trip", () => {
  function controller(posted: unknown[]): PreviewController {
    return new PreviewController({
      postMessage: (m) => {
        posted.push(m);
      },
      isContextMenuOpen: () => false,
      closeContextMenu: () => {},
      getActiveRow: () => null,
      syncHighlight: () => {},
    });
  }

  it("asks the host once per message and resolves on the matching reply", async () => {
    const posted: unknown[] = [];
    const ctl = controller(posted);
    const raw = (
      ctl as unknown as { requestMessageRecord: (e: string, m: string) => Promise<string> }
    ).requestMessageRecord.bind(ctl);

    const first = raw("claude:s1", "u-1");
    const second = raw("claude:s1", "u-1");
    expect(posted).toEqual([{ type: "requestVaultMessageRecord", entryId: "claude:s1", msgRef: "u-1" }]);

    ctl.handleMessageRecordResponse({
      type: "vaultMessageRecordResponse",
      entryId: "claude:s1",
      msgRef: "u-1",
      record: '{"uuid":"u-1"}',
    });
    expect(await first).toBe('{"uuid":"u-1"}');
    expect(await second).toBe('{"uuid":"u-1"}');
  });

  it("rejects with the host's reason when the record is unavailable", async () => {
    const ctl = controller([]);
    const raw = (
      ctl as unknown as { requestMessageRecord: (e: string, m: string) => Promise<string> }
    ).requestMessageRecord.bind(ctl);

    const pending = raw("codex:t1", "#4");
    ctl.handleMessageRecordResponse({
      type: "vaultMessageRecordResponse",
      entryId: "codex:t1",
      msgRef: "#4",
      error: "That message is too large to copy.",
    });
    await expect(pending).rejects.toThrow("too large");
  });

  it("ignores a reply for a message nothing is waiting on", () => {
    const ctl = controller([]);
    expect(() =>
      ctl.handleMessageRecordResponse({
        type: "vaultMessageRecordResponse",
        entryId: "claude:other",
        msgRef: "u-9",
        record: "{}",
      }),
    ).not.toThrow();
  });
});

// improve-vault-transcript-messages 8_1 — Continue forks at an assistant turn and
// carries the user turn beside it, reachable from either side (D9).
describe("mountMessageActions — Continue", () => {
  const reply: MessageSource = { kind: "message", role: "assistant", text: "refactored it", msgRef: "a-1" };
  const followUp: MessageSource = { kind: "message", role: "user", text: "now codexReader", msgRef: "u-2" };
  const timeline = () => [reply, followUp];

  it("hands the resolved fork point to the owner", () => {
    const continueFrom = vi.fn();
    dispose = mountMessageActions(root, { copy: vi.fn(), timeline, continueFrom });
    hover(bound(reply));

    action("continue")?.click();
    expect(continueFrom).toHaveBeenCalledWith({
      anchorRef: "a-1",
      anchorText: "refactored it",
      seedRef: "u-2",
      seedText: "now codexReader",
    });
  });

  it("reaches the same fork point from the user turn", () => {
    const continueFrom = vi.fn();
    dispose = mountMessageActions(root, { copy: vi.fn(), timeline, continueFrom });
    hover(bound(followUp));

    action("continue")?.click();
    expect(continueFrom).toHaveBeenCalledWith(expect.objectContaining({ anchorRef: "a-1", seedRef: "u-2" }));
  });

  it("is offered on an assistant message", () => {
    dispose = mountMessageActions(root, { copy: vi.fn(), timeline, continueFrom: vi.fn() });
    hover(bound(reply));
    expect(action("continue")?.hidden).toBe(false);
  });

  it("is still offered on a message it cannot address, so the reader can type their own", () => {
    const continueFrom = vi.fn();
    dispose = mountMessageActions(root, { copy: vi.fn(), continueFrom });
    hover(message("do the thing", "user"));

    action("continue")?.click();
    expect(action("continue")?.hidden).toBe(false);
    expect(continueFrom).toHaveBeenCalledWith({});
  });

  it("is absent entirely when the owner wired no handler", () => {
    dispose = mountMessageActions(root, { copy: vi.fn() });
    hover(message("do the thing", "user", "u-1"));
    expect(action("continue")).toBeNull();
  });
});

// improve-vault-transcript-messages 6_2 — the overlay must not stay open over the
// tab the continue just created. 8_3 moved the launch behind the confirm dialog,
// so what posts and closes is the confirmed start, not the click.
describe("PreviewController continue", () => {
  it("posts the continue and closes the preview once confirmed", () => {
    const posted: unknown[] = [];
    const ctl = new PreviewController({
      postMessage: (m) => {
        posted.push(m);
      },
      isContextMenuOpen: () => false,
      closeContextMenu: () => {},
      getActiveRow: () => null,
      syncHighlight: () => {},
    });
    const closed = vi.spyOn(ctl as unknown as { closePreview: () => void }, "closePreview");

    (ctl as unknown as { startContinuation: (e: string, r: ContinueDialogResult) => void }).startContinuation(
      "claude:s1",
      {
        instruction: "carry on",
        confirmIntent: true,
        agent: "claude",
        anchorRef: "a-1",
      },
    );

    expect(posted[0]).toEqual({
      type: "vaultContinueSession",
      entryId: "claude:s1",
      instruction: "carry on",
      confirmIntent: true,
      agent: "claude",
      anchorRef: "a-1",
    });
    expect(closed).toHaveBeenCalledTimes(1);
    // The close drops the follow-watch too, so the closed preview stops streaming.
    expect(posted).toContainEqual({ type: "vaultWatchSession", entryId: null });
  });
});

// .reviews/round-1.md F1/F2 — keyboard reach and pending-request cleanup.
describe("keyboard reach and pending cleanup", () => {
  it("puts a source-bound message in the tab order", () => {
    const el = previewMessage("user", "User", "hello", true);
    bindMessageSource(el, { kind: "message", role: "user", text: "hello" });
    expect(el.tabIndex).toBe(0);
  });

  it("disposes the mounted action bar when the preview closes", () => {
    const ctl = new PreviewController({
      postMessage: () => {},
      isContextMenuOpen: () => false,
      closeContextMenu: () => {},
      getActiveRow: () => null,
      syncHighlight: () => {},
    });
    const stop = vi.fn();
    (ctl as unknown as { disposeMessageActions?: () => void }).disposeMessageActions = stop;

    (ctl as unknown as { closePreview: () => void }).closePreview();
    expect(stop).toHaveBeenCalledTimes(1);
    expect((ctl as unknown as { disposeMessageActions?: () => void }).disposeMessageActions).toBeUndefined();
  });

  it("settles pending Raw requests when the preview closes, rather than leaking them", async () => {
    const ctl = new PreviewController({
      postMessage: () => {},
      isContextMenuOpen: () => false,
      closeContextMenu: () => {},
      getActiveRow: () => null,
      syncHighlight: () => {},
    });
    const pending = (
      ctl as unknown as { requestMessageRecord: (e: string, m: string) => Promise<string> }
    ).requestMessageRecord("claude:s1", "u-1");
    const settled = expect(pending).rejects.toThrow(/closed/i);

    (ctl as unknown as { closePreview: () => void }).closePreview();
    await settled;
  });
});
