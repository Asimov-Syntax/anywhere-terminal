// Shared PTY trigger bytes for AI-CLI image paste. Image bytes never traverse
// the PTY — CLIs read the OS clipboard out-of-band after detecting one of these
// signals (preview-pasted-images discovery §1).
//
// The trigger is CLI-specific, not just OS-specific: Codex binds image paste to
// a *fixed* Ctrl+V (codex-rs `fixed.paste_image = ctrl('v')`) and ignores an
// empty bracketed paste, so it needs Ctrl+V even on macOS; OpenCode accepts
// Ctrl+V on every OS too. Claude uses the OS-native signal — empty bracketed
// paste on macOS, Ctrl+V on Linux, and **Alt+V on Windows** (Claude Code binds
// image paste to Alt+V there; Ctrl+V is an ordinary paste and never reads the
// clipboard image — it just prints "No image found in clipboard. Use alt+v…").

import { AGENT_USES_CTRL_V } from "../vault/types";

/**
 * Upper bound on a single pasted image's decoded byte size. Guards against a
 * huge/accidental paste multiplying memory across webview → bridge → host
 * (base64 peaks at ~2.66x the bytes). Enforced webview-side (blob.size) and
 * host-side (decoded length).
 */
export const MAX_PASTE_IMAGE_BYTES = 20 * 1024 * 1024;

/** Bracketed-paste wrapper with empty payload (Claude on macOS Cmd+V). */
export const BRACKETED_EMPTY_PASTE = "\x1b[200~\x1b[201~";

/** Ctrl+V byte (Codex / OpenCode / Grok on every OS; Claude on Linux). */
export const CTRL_V_PASTE = "\x16";

/**
 * Alt+V sequence — ESC then 'v' — how a terminal encodes Alt/Meta+V. Claude Code
 * on Windows binds image paste to Alt+V (see module header). Ctrl+V would only do
 * a plain text paste there, so Windows+Claude must receive this instead.
 */
export const ALT_V_PASTE = "\x1bv";

// Derived from the REQUIRED per-agent record, so adding a vault agent without
// declaring its trigger is a compile error rather than a silent wrong trigger.
// "grok" is pre-wired ahead of its registry record — `agentKindForExecutable`
// cannot yet produce it, so it stays an explicit extra outside the record and is
// inert until grok becomes a launchable vault agent. The Set stays `string` so
// `.has(agentKind: string)` needs no cast.
const CTRL_V_AGENTS = new Set<string>([
  ...Object.entries(AGENT_USES_CTRL_V)
    .filter(([, usesCtrlV]) => usesCtrlV)
    .map(([id]) => id),
  "grok",
]);

/**
 * PTY bytes that tell the running AI CLI to read an image from the OS clipboard.
 * Codex/OpenCode/Grok always want Ctrl+V; Claude (and unknown/shell sessions)
 * use the OS-native signal — empty bracketed paste on macOS, Alt+V on Windows,
 * Ctrl+V on Linux.
 *
 * Known limitation: `agentKind` is only known for vault-LAUNCHED sessions (the
 * caller derives it from `session.shell`). A CLI the user starts by hand in a
 * plain shell reports `agentKind: undefined`, so a hand-launched Codex/OpenCode
 * on macOS falls to the OS-native branch (bracketed paste, which Codex ignores)
 * — the Cmd+V image-forward path then no-ops. macOS Ctrl+V is unaffected: there
 * xterm emits \x16 natively and the host never sends a trigger. Detecting the
 * foreground process (not `session.shell`) would close this; out of scope here.
 */
export function getImagePastePtyTrigger(agentKind: string | undefined, platform: NodeJS.Platform): string {
  if (agentKind && CTRL_V_AGENTS.has(agentKind)) {
    return CTRL_V_PASTE;
  }
  if (platform === "darwin") {
    return BRACKETED_EMPTY_PASTE;
  }
  if (platform === "win32") {
    return ALT_V_PASTE;
  }
  return CTRL_V_PASTE;
}
