// src/webview/worktree/worktreeAgentBox.ts — Agent, permission posture and seed
// prompt, as one block (worktree-actions.md § 4, design.md D7).
//
// Extracted so "create, then launch" and "launch here" are the SAME collection
// rather than two implementations of one contract. The truthfulness rules the
// design fixes all live here, once:
//
//  - The agents offered are the ones the host reported. Nothing is invented, and
//    an empty list renders as no offer at all rather than an empty picker.
//  - Postures are the CHOSEN agent's own — permission is agent-shaped, so a
//    shared list would show claude's postures for codex.
//  - A dangerous posture is labelled and never the initial selection.
//  - The prompt appears only for an agent the host said can be seeded; for one
//    that cannot, a field promising a seeded prompt would be a lie.

import { MAX_CONTINUATION_INSTRUCTION } from "../../vault/continuationLimits";
import { field, selectControl } from "./worktreeDialogShell";
import type { WorktreeLaunchAgent } from "./worktreeViewTypes";

export interface WorktreeAgentChoice {
  agentId?: string;
  permissionChoiceId?: string;
  prompt?: string;
}

export interface WorktreeAgentBox {
  readonly element: HTMLElement;
  /** Swap the offered agents — the create form does this when the repo changes. */
  setAgents(agents: readonly WorktreeLaunchAgent[], preferredAgentId?: string): void;
  /**
   * Whether the caller wants the block shown at all. Distinct from having
   * nothing to offer: the create form asks for it only in `agent` mode, and the
   * box hides itself regardless when no agent resolved.
   */
  setVisible(visible: boolean): void;
  /** What the box currently holds. `agentId` is undefined when nothing is offered. */
  read(): WorktreeAgentChoice;
  /**
   * A posture is offered and none is selected — true only where every choice the
   * agent declares is dangerous, since that is the one case with nothing safe to
   * open on. Both dialogs gate their submit on it: preselecting nothing is only
   * half the rule if the unselected state can still be submitted.
   */
  needsPosture(): boolean;
}

/**
 * The posture to start on: the first one that is not dangerous.
 *
 * Not simply `[0]` — an agent may declare its dangerous posture first, and
 * "never preselected" is a rule about the posture, not about its position.
 */
function initialPosture(agent: WorktreeLaunchAgent | undefined): string | undefined {
  return agent?.permissionChoices.find((c) => !c.dangerous)?.id;
}

export function createWorktreeAgentBox(
  agents: readonly WorktreeLaunchAgent[],
  onChange?: () => void,
  preferredAgentId?: string,
): WorktreeAgentBox {
  let offered: readonly WorktreeLaunchAgent[] = agents;
  let agentId: string | undefined;
  let permissionChoiceId: string | undefined;
  let wanted = true;

  const element = document.createElement("div");
  element.className = "wt-agentbox";

  const cols = document.createElement("div");
  cols.className = "wt-cols";

  const agentField = field("Agent", "wt-agent");
  const agentSelect = selectControl("wt-agent", []);
  agentField.appendChild(agentSelect);

  const permField = field("Permissions", "wt-perm");
  const permSelect = selectControl("wt-perm", []);
  permField.appendChild(permSelect);
  cols.append(agentField, permField);

  const promptField = field("First prompt", "wt-prompt", true);
  const promptInput = document.createElement("textarea");
  promptInput.className = "wt-textarea";
  promptInput.id = "wt-prompt";
  promptInput.placeholder = "Sent once the agent's composer is ready…";
  // The bound the HOST publishes, shown where it is typed: it refuses an
  // oversized prompt rather than truncating it, and a refusal after the dialog
  // has closed reads as the button doing nothing.
  promptInput.maxLength = MAX_CONTINUATION_INSTRUCTION;
  const promptCount = document.createElement("span");
  promptCount.className = "wt-fhint";
  const showCount = (): void => {
    promptCount.textContent = `${promptInput.value.length} / ${MAX_CONTINUATION_INSTRUCTION}`;
  };
  showCount();
  promptInput.addEventListener("input", showCount);
  promptField.append(promptInput, promptCount);

  const hint = document.createElement("span");
  hint.className = "wt-fhint";
  hint.append(document.createTextNode("Only agents whose executable resolves are listed."));
  const dangerTag = document.createElement("span");
  dangerTag.className = "wt-danger-tag";
  dangerTag.textContent = "dangerous";
  hint.append(dangerTag, document.createTextNode("choices are never preselected."));

  element.append(cols, promptField, hint);

  const current = (): WorktreeLaunchAgent | undefined => offered.find((a) => a.id === agentId);

  function renderPostures(): void {
    const agent = current();
    const choices = agent?.permissionChoices ?? [];
    // An agent declaring none exposes no axis to choose on, so the control is
    // absent rather than present and empty.
    permField.hidden = choices.length === 0;
    permSelect.replaceChildren();
    // "Never preselected" has to survive the rendering. With no safe choice to
    // open on, `initialPosture` leaves nothing selected — and a `<select>` whose
    // options all lack `selected` displays and submits its FIRST, which here is
    // dangerous. The unselected state needs something of its own to sit on, and
    // that something must not be choosable as a posture.
    if (choices.length > 0 && permissionChoiceId === undefined) {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Choose a permission mode…";
      placeholder.disabled = true;
      placeholder.selected = true;
      permSelect.appendChild(placeholder);
    }
    for (const choice of choices) {
      const opt = document.createElement("option");
      opt.value = choice.id;
      opt.textContent = choice.dangerous ? `${choice.label} (dangerous)` : choice.label;
      opt.selected = choice.id === permissionChoiceId;
      permSelect.appendChild(opt);
    }
    // A prompt field for an agent that cannot be seeded would promise delivery
    // nothing performs.
    promptField.hidden = agent === undefined || !agent.canSeedPrompt;
    if (promptField.hidden) {
      promptInput.value = "";
      showCount();
    }
  }

  function setAgents(next: readonly WorktreeLaunchAgent[], preferred?: string): void {
    offered = next;
    const preferredOffered = preferred !== undefined && next.some((a) => a.id === preferred) ? preferred : undefined;
    const keep = next.some((a) => a.id === agentId) ? agentId : (preferredOffered ?? next[0]?.id);
    agentId = keep;
    permissionChoiceId = initialPosture(next.find((a) => a.id === keep));
    agentSelect.replaceChildren();
    for (const agent of next) {
      const opt = document.createElement("option");
      opt.value = agent.id;
      opt.textContent = agent.label;
      opt.selected = agent.id === keep;
      agentSelect.appendChild(opt);
    }
    syncVisible();
    renderPostures();
  }

  function syncVisible(): void {
    element.hidden = !wanted || offered.length === 0;
  }

  agentSelect.addEventListener("change", () => {
    agentId = agentSelect.value;
    // The posture resets with the agent: an id means nothing to a different
    // agent, and carrying one across would launch under a posture the user
    // never saw offered.
    permissionChoiceId = initialPosture(current());
    renderPostures();
    onChange?.();
  });
  permSelect.addEventListener("change", () => {
    // The placeholder is disabled, so this cannot arrive from a user choice —
    // but a caller resetting the control by value would otherwise record "" as a
    // posture id and defeat the gate.
    permissionChoiceId = permSelect.value === "" ? undefined : permSelect.value;
    renderPostures();
    onChange?.();
  });
  promptInput.addEventListener("input", () => onChange?.());

  setAgents(agents, preferredAgentId);

  return {
    element,
    setAgents,
    setVisible: (visible) => {
      wanted = visible;
      syncVisible();
    },
    needsPosture: () => (current()?.permissionChoices.length ?? 0) > 0 && permissionChoiceId === undefined,
    read: () => ({
      agentId,
      ...(permissionChoiceId === undefined ? {} : { permissionChoiceId }),
      ...(promptField.hidden || promptInput.value.trim() === "" ? {} : { prompt: promptInput.value.trim() }),
    }),
  };
}
