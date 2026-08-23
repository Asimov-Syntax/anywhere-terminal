# 260823-session-preview-ordered-list

## Symptom — IMMUTABLE
The reporter's words, unedited. If this needs changing, the report was
misrecorded; open a new session rather than rewriting history.

> session preview bị lỗi index bullet: ở session 1c10513a-99b7-41e7-be98-1d6043a4221a phản hồi cuối của AI có ordered list 1, 2, 3 với nested bullets nhưng preview hiển thị cả ba mục là 1 và làm mất indentation của nested bullets

## Current focus — OVERWRITE
Fix `renderMarkdownLite` list construction so indentation determines nesting and blank separators do not split one ordered sequence.

## Evidence — APPEND ONLY
- `bunx vitest run --config asimov/debug/260823-session-preview-ordered-list/vitest.config.ts` fails on the exact reported list block.
- The repro prints `OBSERVES 1: RED` for the 1/2/3 sequence and `OBSERVES 2: RED` for nested bullet ownership.
- The repro calls `renderMarkdownLite` directly, so the failure exists in the DOM structure before transcript normalization or CSS.

## Eliminated — APPEND ONLY
- Transcript reader normalization: bypassing readers reproduces both failures.
- Vault preview CSS: the DOM already contains split top-level lists and lacks nested bullet lists.

## Root cause — OVERWRITE
`src/webview/vault/markdownLite.ts:149-169` captures indentation but never uses it. An indented `-` marker terminates the current ordered list as a marker-type switch and becomes a sibling `<ul>`; each following `2.`/`3.` therefore starts a new `<ol>` whose browser counter defaults to 1.

## Scope
- `src/webview/vault/markdownLite.ts`
- `src/webview/vault/markdownLite.test.ts`

## Side-effect risk
All vault transcript ordered/unordered list rendering shares this parser; headings, tables, code fences, inline text safety, and plain paragraphs are separate branches and should remain unchanged.

## Closed unresolved

Forced past: no validated reproduction yet (`bun run asm debug repro-validate`)
