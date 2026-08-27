// @vitest-environment jsdom
// src/webview/vault/ContinueDialog.test.ts — the continuation confirm dialog
// (improve-vault-transcript-messages 8_3, design.md D10/D11/D12).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CONTINUATION_INSTRUCTION } from "../../vault/continuationLimits";
import type { VaultLaunchTarget } from "../../vault/types";
import { type ContinueDialogResult, openContinueDialog } from "./ContinueDialog";

let root: HTMLElement;
let close: (() => void) | undefined;

const targets: VaultLaunchTarget[] = [
  {
    canSeedPrompt: true,
    agent: "claude",
    displayName: "Claude Code",
    permissionChoices: [
      { id: "default", label: "Ask for permission" },
      { id: "bypassPermissions", label: "Bypass permission checks", dangerous: true },
    ],
  },
  { canSeedPrompt: true, agent: "opencode", displayName: "OpenCode", permissionChoices: [] },
];

function open(over: Partial<Parameters<typeof openContinueDialog>[1]> = {}): ReturnType<typeof vi.fn> {
  const onConfirm = vi.fn();
  close = openContinueDialog(root, {
    sourceLabel: "Fix the vault preview · Claude Code",
    cwd: "/repo/app",
    agent: "claude",
    capturedPermission: "bypassPermissions",
    fork: { anchorRef: "a-1", anchorText: "I refactored the reader", seedRef: "u-2", seedText: "now do codexReader" },
    loadTargets: async () => targets,
    loadInstruction: async () => "now do codexReader, the untruncated one",
    onConfirm,
    ...over,
  });
  return onConfirm;
}

const el = <T extends HTMLElement>(sel: string): T | null => root.querySelector<T>(sel);
const instruction = (): HTMLTextAreaElement | null => el<HTMLTextAreaElement>(".vault-continue-instruction");
const intent = (): HTMLInputElement | null => el<HTMLInputElement>(".vault-continue-intent");
const start = (): HTMLButtonElement | null => el<HTMLButtonElement>('[data-action="start"]');

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  close?.();
  close = undefined;
  root.remove();
});

describe("openContinueDialog", () => {
  it("starts nothing on open — the reader has to confirm", () => {
    const onConfirm = open();
    expect(el(".vault-continue")).not.toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows the source, the anchoring reply and the working directory", () => {
    open();
    const text = root.textContent ?? "";
    expect(text).toContain("Fix the vault preview");
    expect(text).toContain("/repo/app");
    // The reply sits in a read-only box so its resizer matches the editor's.
    const reply = el<HTMLTextAreaElement>("textarea.vault-continue-anchor");
    expect(reply?.value).toContain("I refactored the reader");
    expect(reply?.readOnly).toBe(true);
    expect(reply?.tabIndex).toBe(-1);
  });

  it("starts empty, then fills the editor from the complete stored record", async () => {
    open();
    expect(instruction()?.value).toBe("");
    await vi.waitFor(() => expect(instruction()?.value).toBe("now do codexReader, the untruncated one"));
  });

  it("shows and enforces the shared instruction cap", () => {
    open();
    expect(instruction()?.maxLength).toBe(MAX_CONTINUATION_INSTRUCTION);
    expect(root.querySelector('[data-field="instruction-count"]')?.textContent).toBe(
      `0 / ${MAX_CONTINUATION_INSTRUCTION}`,
    );
  });

  it("visibly shortens an over-cap stored instruction before it can be confirmed", async () => {
    open({ loadInstruction: async () => "x".repeat(MAX_CONTINUATION_INSTRUCTION + 50) });
    await vi.waitFor(() => expect(instruction()?.value).toHaveLength(MAX_CONTINUATION_INSTRUCTION));
    expect(root.textContent).toMatch(/shortened/i);
    expect(root.querySelector('[data-field="instruction-count"]')?.textContent).toBe(
      `${MAX_CONTINUATION_INSTRUCTION} / ${MAX_CONTINUATION_INSTRUCTION}`,
    );
  });

  it("never falls back to capped timeline text when record resolution fails", async () => {
    open({ loadInstruction: async () => Promise.reject(new Error("too large")) });
    await vi.waitFor(() => expect(root.textContent).toMatch(/type the instruction manually/i));
    expect(root.querySelector(".vault-continue-status")?.getAttribute("role")).toBe("status");
    expect(instruction()?.value).toBe("");
    expect(start()?.disabled).toBe(true);
  });

  it("starts empty when a timeline seed has no resolvable locator", async () => {
    open({ fork: { seedText: "bounded preview only" }, loadInstruction: undefined });
    await vi.waitFor(() => expect(el('[data-field="agent"]')).not.toBeNull());
    expect(instruction()?.value).toBe("");
    expect(start()?.disabled).toBe(true);
  });

  it("leaves an editor the reader already typed into alone when the record arrives", async () => {
    let release: (v: string) => void = () => {};
    open({ loadInstruction: () => new Promise<string>((r) => (release = r)) });
    const box = instruction();
    if (box) {
      box.value = "something else entirely";
      box.dispatchEvent(new Event("input", { bubbles: true }));
    }
    release("the stored text");
    await vi.waitFor(() => expect(instruction()?.value).toBe("something else entirely"));
  });

  it("confirms with what the reader wrote, the intent flag and the chosen posture", async () => {
    const onConfirm = open();
    await vi.waitFor(() => expect(el('[data-field="agent"]')).not.toBeNull());
    const box = instruction();
    if (box) {
      box.value = "do it differently this time";
      box.dispatchEvent(new Event("input", { bubbles: true }));
    }
    start()?.click();

    const result = onConfirm.mock.calls[0]?.[0] as ContinueDialogResult;
    expect(result).toMatchObject({
      instruction: "do it differently this time",
      confirmIntent: true,
      agent: "claude",
      permissionChoiceId: "bypassPermissions",
      anchorRef: "a-1",
    });
  });

  it("has the intent check on by default and reports it cleared", async () => {
    const onConfirm = open();
    await vi.waitFor(() => expect(el('[data-field="agent"]')).not.toBeNull());
    expect(intent()?.checked).toBe(true);
    const box = intent();
    if (box) {
      box.checked = false;
      box.dispatchEvent(new Event("change", { bubbles: true }));
    }
    start()?.click();
    const confirmed = onConfirm.mock.calls[0]?.[0] as ContinueDialogResult | undefined;
    expect(confirmed?.confirmIntent).toBe(false);
  });

  it("preselects the captured posture and marks it as bypassing checks", async () => {
    open();
    const select = await vi.waitFor(() => {
      const s = el<HTMLSelectElement>('[data-field="permission"]');
      expect(s).not.toBeNull();
      return s as HTMLSelectElement;
    });
    expect(select.value).toBe("bypassPermissions");
    expect(select.selectedOptions[0]?.textContent).toMatch(/bypass/i);
    expect(root.querySelector(".vault-continue-danger")).not.toBeNull();
  });

  it("hides the permission control for an agent that exposes none", async () => {
    open();
    const agentSelect = await vi.waitFor(() => {
      const s = el<HTMLSelectElement>('[data-field="agent"]');
      expect(s).not.toBeNull();
      return s as HTMLSelectElement;
    });
    agentSelect.value = "opencode";
    agentSelect.dispatchEvent(new Event("change", { bubbles: true }));
    expect(el<HTMLElement>('[data-row="permission"]')?.hidden).toBe(true);
  });

  it("confirms nothing when dismissed", async () => {
    const onConfirm = open();
    await vi.waitFor(() => expect(el('[data-field="agent"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-action="cancel"]')?.click();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(el(".vault-continue")).toBeNull();
  });

  it("closes on Escape without confirming", async () => {
    const onConfirm = open();
    await vi.waitFor(() => expect(el('[data-field="agent"]')).not.toBeNull());
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(el(".vault-continue")).toBeNull();
  });

  it("refuses to start on an empty instruction", async () => {
    const onConfirm = open({ fork: {}, loadInstruction: async () => "" });
    await vi.waitFor(() => expect(el('[data-field="agent"]')).not.toBeNull());
    expect(start()?.disabled).toBe(true);
    start()?.click();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("reports when no agent on this host can be continued into", async () => {
    open({ loadTargets: async () => [] });
    await vi.waitFor(() => expect(root.textContent).toMatch(/no agent/i));
    expect(start()?.disabled).toBe(true);
  });

  it("traps Tab and Shift+Tab inside the modal", async () => {
    open();
    await vi.waitFor(() => expect(start()?.disabled).toBe(false));
    const first = instruction();
    const last = start();
    last?.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(first);
    first?.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(last);
  });

  it("restores the invoking control when dismissed", async () => {
    const opener = document.createElement("button");
    root.appendChild(opener);
    opener.focus();
    open();
    await vi.waitFor(() => expect(document.activeElement).toBe(instruction()));
    el<HTMLButtonElement>('[data-action="cancel"]')?.click();
    expect(document.activeElement).toBe(opener);
  });
});

// User feedback — the dialog mounts outside the preview card, so the card's
// outside-click dismissal was tearing it down on every click inside it.
describe("openContinueDialog — staying open", () => {
  it("does not dismiss on a click inside the card", () => {
    open();
    el<HTMLElement>(".vault-continue-card")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(el(".vault-continue")).not.toBeNull();
  });

  it("carries the marker the preview shell excludes from its outside-click close", () => {
    open();
    const card = el<HTMLElement>(".vault-continue-card");
    expect(card?.closest(".vault-continue")).not.toBeNull();
  });
});
