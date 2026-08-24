// src/utils/posixShellQuote.ts — POSIX single-argument shell quoting.
//
// Wraps a value in single quotes for safe use as one `/bin/sh` argument,
// preserving every byte of the input (no character stripping). Extracted
// from `src/pty/ShellIntegrationInjector.ts` so callers that must emit a
// literal path (e.g. a Cursor hook command) share one proven implementation
// instead of re-deriving the escape sequence.
//
// See: asimov/changes/integrate-cursor-agent/.reviews/round-2.md W4.

/** POSIX shell single-quote escape: ' → '\'' */
export function posixShellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
