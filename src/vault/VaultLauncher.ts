// src/vault/VaultLauncher.ts — Resolve a vault entry into createSession options.
// See: specs/vault-session-launch/spec.md (Resume; Fork when supported),
//      design.md D5,D9.
//
// This resolves an entry id to the exact `{ shell, shellArgs, cwd, env }` shape
// SessionManager.createSession expects (shell = the agent executable, shellArgs =
// the argv from LaunchBuilder). It does NOT spawn — the provider owns the
// createSession call + the `tabCreated` post so the terminal becomes visible (D5).

import { isCursorCliResumableEntry } from "./cursorCapabilities";
import {
  build,
  buildResumeCommandString,
  type ContinuationTarget,
  type LaunchMode,
  resolveLaunchExecutable,
  VaultLaunchError,
} from "./LaunchBuilder";
import type { VaultSessionEntry } from "./types";
import type { VaultService } from "./VaultService";

export interface CreateSessionOptions {
  shell: string;
  shellArgs: string[];
  cwd: string;
  /** Present only for Claude (auth/config override); omitted otherwise. */
  env?: Record<string, string>;
  /**
   * Marks this session's root process as an agent CLI (claude/codex/opencode),
   * not a shell. The session manager arms "fall back to a shell on exit" so that
   * when the agent quits (Ctrl+C / done) the tab drops to a live shell prompt
   * instead of dying. Persisted so a window reload re-arms it after auto-resume.
   */
  isAgentLaunch: boolean;
}

export class VaultLauncher {
  constructor(
    private readonly vaultService: VaultService,
    private readonly hostEnv: Record<string, string | undefined> = process.env,
  ) {}

  async resolve(
    entryId: string,
    mode: LaunchMode,
    prompt?: string,
    target?: ContinuationTarget,
  ): Promise<CreateSessionOptions> {
    const entry = await this.resolveLaunchable(entryId, mode);
    if (mode === "fork" && !entry.canFork) {
      throw new VaultLaunchError(`Fork is not supported for ${entryId}`, "fork-unsupported");
    }

    const executable = await resolveLaunchExecutable(entry, mode, target);
    const spec = build(entry, mode, this.hostEnv, prompt, target, executable);
    // Spawn the agent CLI directly as the terminal's process (PTY root). This is
    // killed cleanly on window reload; on exit, the session manager respawns a
    // shell in the same tab so the user keeps an input prompt (see
    // SessionManager.respawnFallbackShell + isAgentLaunch).
    return {
      shell: spec.file,
      shellArgs: spec.args,
      cwd: spec.cwd,
      env: Object.keys(spec.env).length > 0 ? spec.env : undefined,
      isAgentLaunch: true,
    };
  }

  /** The shell-quoted resume command for an entry, gated by the same proof as
   *  `resolve(entryId, "resume")` so a copy can't hand out a command the launcher
   *  would refuse to run (spec: Cursor explicit Resume identity proof). */
  async buildResumeCommand(entryId: string): Promise<string> {
    const entry = await this.resolveLaunchable(entryId, "resume");
    return buildResumeCommandString(entry);
  }

  /** Resolve an entry and settle every host-side gate that must precede an
   *  executable probe or any external side effect: source capability first, then
   *  Cursor's bounded store-identity proof (D14). */
  private async resolveLaunchable(entryId: string, mode: LaunchMode): Promise<VaultSessionEntry> {
    // Resolve the single entry by id (point/locate-by-id lookup) instead of a full
    // `list()` over every agent store — launching must not block on scanning the
    // whole session index (e.g. the multi-GB opencode db). One resolution per
    // action: the target carries the proof for the exact location it resolved, so
    // discovery cannot run twice and land on a different candidate (D14).
    const target = await this.vaultService.getLaunchTarget(entryId);
    if (!target) {
      throw new VaultLaunchError(`No vault session: ${entryId}`, "unknown-entry");
    }
    const { entry } = target;
    if (mode !== "resume") {
      return entry;
    }
    if (entry.canResume === false || (entry.agent === "cursor" && !isCursorCliResumableEntry(entry))) {
      throw new VaultLaunchError(`Resume is not supported for ${entryId}`, "resume-unsupported");
    }
    if (!(await target.verify())) {
      throw new VaultLaunchError(`Couldn't verify the stored session identity for ${entryId}`, "resume-unsupported");
    }
    return entry;
  }
}
