// src/worktree/errorMessage.ts — one answer to "what do I show the user for this
// thrown thing".
//
// Extracted on round-1 F011, which found the third copy in this subsystem and
// found it had already drifted: two answered `String(error)` for a non-Error and
// the newest answered the literal `"unknown error"` — in a string that reaches
// the panel on the wire. A user-visible message with three owners is a message
// with none.

/** The displayable text of a thrown value, whatever it turned out to be. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
