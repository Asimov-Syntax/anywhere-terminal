// Repro: the AI Vault list title for a Claude session must match what Claude
// itself displays. Claude's own precedence (observed in the 2.1.239 binary's
// session-summary builder) is:
//     customTitle || aiTitle || lastPrompt || summaryHint || firstPrompt
// The reader currently implements only `aiTitle || firstPrompt`, so a session
// the user named (`custom-title`) and a session with no ai-title both fall back
// to the first message.
//
// Layer: the entry the vault list serves to the webview (readClaudeSessions).

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { readClaudeSessions } from "../../../src/vault/readers/claudeReader";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "vault-claude-title-"));
const projectDir = path.join(root, "projects", "-Users-me-proj");
await fs.mkdir(projectDir, { recursive: true });

const user = (id: string, text: string) =>
  JSON.stringify({
    type: "user",
    cwd: "/Users/me/proj",
    sessionId: id,
    timestamp: "2026-05-01T00:00:00Z",
    message: { role: "user", content: [{ type: "text", text }] },
  });
const assistant = JSON.stringify({
  type: "assistant",
  message: { role: "assistant", model: "claude-opus-4-7", content: [{ type: "text", text: "On it." }] },
});

// OBSERVES 1 — a session the user named in Claude (`/rename` → custom-title).
// Claude shows "add-command-receipt-replay"; the vault shows the first prompt.
await fs.writeFile(
  path.join(projectDir, "sess-named.jsonl"),
  [
    user("sess-named", "first message that is definitely not the session name the user chose in claude"),
    assistant,
    JSON.stringify({ type: "ai-title", aiTitle: "An auto-generated title", sessionId: "sess-named" }),
    JSON.stringify({ type: "last-prompt", lastPrompt: "carry on please", sessionId: "sess-named" }),
    JSON.stringify({ type: "custom-title", customTitle: "add-command-receipt-replay", sessionId: "sess-named" }),
  ].join("\n") + "\n",
);

// OBSERVES 2 — a session with no ai-title yet (half of a real store): Claude
// shows the last prompt; the vault shows the first prompt.
await fs.writeFile(
  path.join(projectDir, "sess-lastprompt.jsonl"),
  [
    user("sess-lastprompt", "first message that is definitely not what claude displays for this session"),
    assistant,
    JSON.stringify({ type: "last-prompt", lastPrompt: "/asimov-plan land the receipt contract", sessionId: "sess-lastprompt" }),
  ].join("\n") + "\n",
);

const { entries } = await readClaudeSessions({ configDir: root });
const titleOf = (id: string) => entries.find((e) => e.sessionId === id)?.title;

const named = titleOf("sess-named");
const lastPrompt = titleOf("sess-lastprompt");

const ok1 = named === "add-command-receipt-replay";
const ok2 = lastPrompt === "/asimov-plan land the receipt contract";

console.log(`OBSERVES 1: ${ok1 ? "GREEN" : "RED"} — custom-title session titled ${JSON.stringify(named)}`);
console.log(`OBSERVES 2: ${ok2 ? "GREEN" : "RED"} — no-ai-title session titled ${JSON.stringify(lastPrompt)}`);

await fs.rm(root, { recursive: true, force: true });
process.exit(ok1 && ok2 ? 0 : 1);
