// src/worktree/agentIdentity.ts — Which agent, if any, is in this pane.
//
// Pure: every source is resolved by the caller and handed in, so the precedence
// itself is testable without a process table or a registry.
//
// The rule the whole evidence model rests on: a rank that could not be READ is
// not a rank that found nothing. Falling through a failed read to a weaker rank
// silently demotes a proven agent to a plain terminal, so a failure short-
// circuits and the caller retains what it last proved.
//
// See: docs/design/worktree-agent-presence.md § 3.2, § 5;
//      asimov/changes/project-worktree-agent-presence/design.md D4, D5, D10.

import { matchTitleAgentName } from "../shared/agentNames";
import { agentKindForExecutable } from "../vault/registry";
import { formatEntryId, type VaultAgentId } from "../vault/types";
import type { PresenceDegradation, WorktreeAgentRow } from "./presenceTypes";

/** What rank 2 concluded for this pane. */
export type SessionLookup =
  | { kind: "resolved"; agent: VaultAgentId; sessionId: string }
  | { kind: "absent" }
  | { kind: "failed"; reason: string };

export interface IdentityInput {
  /** Set while an agent CLI is this pane's root process; cleared on fallback respawn. */
  isAgentLaunch?: boolean;
  /** The pane's root executable. */
  shell?: string;
  /** Decoration-stripped reported title. `undefined` = no surface has reported. */
  title?: string;
  session: SessionLookup;
}

export type IdentityOutcome =
  | { kind: "proven"; agent: VaultAgentId; source: WorktreeAgentRow["agentSource"]; entryId?: string }
  | { kind: "absent" }
  | { kind: "failed"; source: PresenceDegradation["source"]; reason: string };

/**
 * Resolve a pane's agent by the documented precedence: launch record, then live
 * session registry, then process recognition, then a committed title.
 *
 * Rank 3 (process recognition) has no source in this repo — it needs a
 * recognition table `docs/PLAN.md` defers — so it is skipped rather than faked.
 * Rank 2 answers `claude` only, which is why a Codex or OpenCode pane resolves
 * by rank 1 or rank 4 or not at all.
 */
export function resolveAgentIdentity(input: IdentityInput): IdentityOutcome {
  const { session } = input;

  // Available whichever rank wins the identity: the handle is a property of the
  // resolved session, not of the rank that happened to name the agent.
  const entryId =
    session.kind === "resolved" ? { entryId: formatEntryId(session.agent, session.sessionId) } : undefined;

  // Rank 1 — the launcher told us what it started. `agentKindForExecutable` is
  // the registry's own mapping, aliases included; a second matcher built from
  // VAULT_AGENT_IDS would not recognise the `agent` / `cursor-agent` binaries
  // Cursor actually launches under.
  if (input.isAgentLaunch === true) {
    const launched = agentKindForExecutable(input.shell);
    if (launched) {
      return { kind: "proven", agent: launched, source: "launch", ...entryId };
    }
  }

  // Rank 2 — a live agent session belonging to this pane.
  if (session.kind === "resolved") {
    return { kind: "proven", agent: session.agent, source: "registry", ...entryId };
  }
  if (session.kind === "failed") {
    return { kind: "failed", source: "panes", reason: session.reason };
  }

  // Rank 4 — the title commits to an agent. Weakest rank, so it is reached only
  // once the ranks above have conclusively found nothing.
  const titled = matchTitleAgentName(input.title);
  if (titled) {
    return { kind: "proven", agent: titled, source: "title" };
  }

  return { kind: "absent" };
}
