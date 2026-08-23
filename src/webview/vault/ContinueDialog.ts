// src/webview/vault/ContinueDialog.ts — confirm a continuation before anything
// spawns (improve-vault-transcript-messages D10/D11/D12).
//
// Plain DOM, no dialog primitive in this codebase to reuse: `webview/ui/` holds a
// Tooltip and a BannerService, and FloatingWindow is a draggable window, not a
// modal. Everything untrusted goes in through textContent / input value.

import { MAX_CONTINUATION_INSTRUCTION } from "../../vault/continuationLimits";
import type { AgentPermissionChoice, VaultLaunchTarget } from "../../vault/types";
import type { ForkPoint } from "./forkPoint";

export interface ContinueDialogResult {
  /** What the reader confirmed — their own text, not transcript content. */
  instruction: string;
  /** Append the "state the goal and wait" block to the composed prompt (D12). */
  confirmIntent: boolean;
  agent: string;
  /** Id of the chosen posture, or undefined when the agent exposes none. */
  permissionChoiceId?: string;
  /** The assistant turn being continued from, for the prompt's anchor line. */
  anchorRef?: string;
}

export interface ContinueDialogDeps {
  /** "<session title> · <agent>" — what is being continued. */
  sourceLabel: string;
  cwd: string;
  /** The stored session's agent, preselected in the agent list. */
  agent: string;
  /** The posture the entry was captured under, preselected when the agent has it. */
  capturedPermission?: string;
  fork: ForkPoint;
  loadTargets: () => Promise<VaultLaunchTarget[]>;
  /** The untruncated instruction from the store. Until it resolves the editor is
   *  empty; a failure requires the reader to author the instruction themselves. */
  loadInstruction?: () => Promise<string>;
  onConfirm: (result: ContinueDialogResult) => void;
}

function row(parent: HTMLElement, label: string, name: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "vault-continue-row";
  wrap.dataset.row = name;
  const caption = document.createElement("label");
  caption.className = "vault-continue-label";
  caption.textContent = label;
  wrap.appendChild(caption);
  parent.appendChild(wrap);
  return wrap;
}

function option(value: string, label: string): HTMLOptionElement {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = label;
  return opt;
}

/**
 * Mount the dialog into `root` and return a disposer. Nothing launches here: the
 * owner's `onConfirm` runs only on Start, and dismissing resolves nothing at all.
 */
export function openContinueDialog(root: HTMLElement, deps: ContinueDialogDeps): () => void {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const overlay = document.createElement("div");
  overlay.className = "vault-continue";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Continue in New Session");

  const card = document.createElement("div");
  card.className = "vault-continue-card";
  overlay.appendChild(card);

  const title = document.createElement("div");
  title.className = "vault-continue-title";
  title.textContent = "Continue in New Session";
  card.appendChild(title);

  const source = document.createElement("div");
  source.className = "vault-continue-source";
  source.textContent = deps.sourceLabel;
  card.appendChild(source);

  if (deps.fork.anchorText) {
    const anchorRow = row(card, "Continuing after this reply", "anchor");
    // A read-only textarea rather than a div: same native resizer as the editor
    // below it, where a div's resizer paints a block over its own scrollbar.
    const quote = document.createElement("textarea");
    quote.className = "vault-continue-anchor";
    quote.readOnly = true;
    quote.tabIndex = -1;
    quote.rows = 8;
    quote.value = deps.fork.anchorText;
    anchorRow.appendChild(quote);
  }

  const instructionRow = row(card, "Your instruction", "instruction");
  const instruction = document.createElement("textarea");
  instruction.className = "vault-continue-instruction";
  instruction.rows = 5;
  instruction.maxLength = MAX_CONTINUATION_INSTRUCTION;
  instruction.value = "";
  instruction.placeholder = deps.loadInstruction
    ? "Loading complete instruction…"
    : "Type the instruction for the new session";
  instructionRow.appendChild(instruction);
  const instructionCount = document.createElement("div");
  instructionCount.className = "vault-continue-count";
  instructionCount.dataset.field = "instruction-count";
  instructionRow.appendChild(instructionCount);
  const syncInstructionCount = (): void => {
    instructionCount.textContent = `${instruction.value.length} / ${MAX_CONTINUATION_INSTRUCTION}`;
  };
  syncInstructionCount();

  // Once the reader touches the box, a late-arriving stored text must not
  // overwrite what they typed.
  let edited = false;
  instruction.addEventListener("input", () => {
    edited = true;
    syncInstructionCount();
    syncStart();
  });

  const intentRow = row(card, "", "intent");
  const intentLabel = document.createElement("label");
  intentLabel.className = "vault-continue-check";
  const intent = document.createElement("input");
  intent.type = "checkbox";
  intent.className = "vault-continue-intent";
  intent.checked = true; // D12 — a continuation starts cautiously by default
  const intentText = document.createElement("span");
  intentText.textContent = "Have it restate the goal and confirm with me before acting";
  intentLabel.append(intent, intentText);
  intentRow.appendChild(intentLabel);

  const agentRow = row(card, "Agent", "agent");
  const agentSelect = document.createElement("select");
  agentSelect.className = "vault-continue-select";
  agentSelect.dataset.field = "agent";
  agentRow.appendChild(agentSelect);

  const permissionRow = row(card, "Permission", "permission");
  permissionRow.hidden = true;
  const permissionSelect = document.createElement("select");
  permissionSelect.className = "vault-continue-select";
  permissionSelect.dataset.field = "permission";
  permissionRow.appendChild(permissionSelect);
  const dangerNote = document.createElement("div");
  dangerNote.className = "vault-continue-danger";
  dangerNote.textContent = "This session runs without permission checks.";
  dangerNote.hidden = true;
  permissionRow.appendChild(dangerNote);

  const where = document.createElement("div");
  where.className = "vault-continue-cwd";
  where.textContent = `Starts in ${deps.cwd}`;
  card.appendChild(where);

  const status = document.createElement("div");
  status.className = "vault-continue-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;
  card.appendChild(status);

  const actions = document.createElement("div");
  actions.className = "vault-continue-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "vault-continue-btn";
  cancel.dataset.action = "cancel";
  cancel.textContent = "Cancel";
  const startBtn = document.createElement("button");
  startBtn.type = "button";
  startBtn.className = "vault-continue-btn vault-continue-btn--primary";
  startBtn.dataset.action = "start";
  startBtn.textContent = "Start New Session";
  startBtn.disabled = true; // until the host says an agent is available
  actions.append(cancel, startBtn);
  card.appendChild(actions);

  let targets: VaultLaunchTarget[] = [];

  function currentTarget(): VaultLaunchTarget | undefined {
    return targets.find((t) => t.agent === agentSelect.value);
  }

  function currentChoice(): AgentPermissionChoice | undefined {
    return currentTarget()?.permissionChoices.find((c) => c.id === permissionSelect.value);
  }

  function syncStart(): void {
    startBtn.disabled = targets.length === 0 || instruction.value.trim() === "";
  }

  function syncPermission(): void {
    const choices = currentTarget()?.permissionChoices ?? [];
    permissionSelect.replaceChildren(...choices.map((c) => option(c.id, c.dangerous ? `${c.label} ⚠` : c.label)));
    permissionRow.hidden = choices.length === 0;
    if (choices.length > 0) {
      const preferred = choices.find((c) => c.id === deps.capturedPermission) ?? choices[0];
      permissionSelect.value = preferred.id;
    }
    dangerNote.hidden = !currentChoice()?.dangerous;
  }

  agentSelect.addEventListener("change", () => {
    syncPermission();
    syncStart();
  });
  permissionSelect.addEventListener("change", () => {
    dangerNote.hidden = !currentChoice()?.dangerous;
  });

  const focusable = (): HTMLElement[] =>
    Array.from(
      card.querySelectorAll<HTMLElement>(
        'textarea:not([readonly]), input, select, button, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.closest("[hidden]") && !(el instanceof HTMLButtonElement && el.disabled));

  let disposed = false;
  const dispose = (restoreFocus = true): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    document.removeEventListener("keydown", onKeyDown, true);
    overlay.remove();
    if (restoreFocus && opener?.isConnected) {
      opener.focus();
    }
  };

  function onKeyDown(ev: KeyboardEvent): void {
    if (ev.key === "Escape") {
      ev.stopPropagation(); // the preview's own Esc handler must not also fire
      dispose();
      return;
    }
    if (ev.key !== "Tab") {
      return;
    }
    const controls = focusable();
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first || !last) {
      ev.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (ev.shiftKey ? active === first || !overlay.contains(active) : active === last || !overlay.contains(active)) {
      ev.preventDefault();
      (ev.shiftKey ? last : first).focus();
    }
  }

  cancel.addEventListener("click", () => dispose());
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) {
      dispose();
    }
  });
  startBtn.addEventListener("click", () => {
    if (instruction.value.length > MAX_CONTINUATION_INSTRUCTION) {
      status.textContent = `Instruction exceeds ${MAX_CONTINUATION_INSTRUCTION} characters.`;
      status.hidden = false;
      return;
    }
    const text = instruction.value.trim();
    if (!text || targets.length === 0) {
      return;
    }
    const choice = currentChoice();
    deps.onConfirm({
      instruction: text,
      confirmIntent: intent.checked,
      agent: agentSelect.value,
      ...(choice ? { permissionChoiceId: choice.id } : {}),
      ...(deps.fork.anchorRef ? { anchorRef: deps.fork.anchorRef } : {}),
    });
    dispose(false);
  });

  document.addEventListener("keydown", onKeyDown, true);
  root.appendChild(overlay);

  void deps.loadTargets().then(
    (found) => {
      if (disposed) {
        return;
      }
      targets = found;
      if (found.length === 0) {
        status.textContent = "No agent on this host can start a seeded session.";
        status.hidden = false;
        syncStart();
        return;
      }
      agentSelect.replaceChildren(...found.map((t) => option(t.agent, t.displayName)));
      agentSelect.value = found.some((t) => t.agent === deps.agent) ? deps.agent : found[0].agent;
      syncPermission();
      syncStart();
    },
    () => {
      if (!disposed) {
        status.textContent = "Could not check which agents are available.";
        status.hidden = false;
      }
    },
  );

  void deps.loadInstruction?.().then(
    (text) => {
      if (disposed || edited) {
        return;
      }
      instruction.placeholder = "Type the instruction for the new session";
      if (text.trim()) {
        instruction.value = text.slice(0, MAX_CONTINUATION_INSTRUCTION);
        if (text.length > MAX_CONTINUATION_INSTRUCTION) {
          status.textContent = `The stored instruction exceeded ${MAX_CONTINUATION_INSTRUCTION} characters and was shortened. Review it before starting.`;
          status.hidden = false;
        }
      } else {
        status.textContent = "The complete stored instruction is unavailable. Type the instruction manually.";
        status.hidden = false;
      }
      syncInstructionCount();
      syncStart();
    },
    () => {
      if (!disposed) {
        instruction.placeholder = "Type the instruction for the new session";
        status.textContent = "The complete stored instruction is unavailable. Type the instruction manually.";
        status.hidden = false;
        syncStart();
      }
    },
  );

  instruction.focus();
  return dispose;
}
