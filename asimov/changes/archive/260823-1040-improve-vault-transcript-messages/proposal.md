# Proposal: improve-vault-transcript-messages

## Why

The session preview shows records the human never typed as USER messages — raw `<task-notification>` markup, 25 KB compaction blobs, injected `<system-reminder>` envelopes — so the transcript reads as noise and a background command finishing looks like the user shouting XML. Separately, a reader who finds the right moment in a transcript has no way to act on it: no way to lift a single message out, and no way to carry it into a fresh session.

## Appetite

M (≤3d)

## Scope

### In scope

- Classifying every user-role transcript record: real prompt, plumbing to drop, background-task notification, context compaction — one classifier shared by the timeline, the session title and `firstPrompt`.
- Rendering notifications and compaction summaries as their own collapsed timeline items.
- A per-message copy affordance offering Markdown, JSON, and the original untruncated record.
- **Continue in New Session** from any user message: a host-composed handoff prompt seeding a new session of the same agent, leaving the stored session untouched.
- A reader-assigned message locator carried on message timeline items, for the two features that must address a single message.

### Out of scope

- Choosing a *different* agent for the continued session (orca offers a picker; nothing asked for one).
- Forking a transcript at a message by rewriting the agent's own store — considered and rejected at Gate 1.
- Editing a message before continuing from it.
- Codex and OpenCode envelope taxonomies: their user records carry no equivalent injected envelopes today; the shared classifier is agent-neutral, but only Claude's envelopes are enumerated.
- Any change to the row context menu or the session list layout.

## Risk Level

MEDIUM — a tightened prompt filter can silently drop real user messages, and Continue adds a fourth launch path that puts transcript text on a command line; both are contained by existing invariants (argv-array launch, whole-block anchoring) and by the existing reader/preview test suites.
