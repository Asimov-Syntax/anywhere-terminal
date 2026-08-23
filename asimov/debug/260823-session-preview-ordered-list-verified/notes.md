# 260823-session-preview-ordered-list-verified

## Symptom — IMMUTABLE
The reporter's words, unedited. If this needs changing, the report was
misrecorded; open a new session rather than rewriting history.

> session preview bị lỗi index bullet: ở session 1c10513a-99b7-41e7-be98-1d6043a4221a phản hồi cuối của AI có ordered list 1, 2, 3 với nested bullets nhưng preview hiển thị cả ba mục là 1 và làm mất indentation của nested bullets

## Current focus — OVERWRITE
Verified fix: nested list indentation now controls DOM nesting, and blank separators keep ordered items in one sequence.

## Evidence — APPEND ONLY
- The session-local repro prints `OBSERVES 1: RED` and `OBSERVES 2: RED` against the original parser.
- `bun run asm debug verify --reconfirm` proved the repro RED without the patch and GREEN with it; `src/webview/vault/markdownLite.test.ts` also passes.
- `node esbuild.js` completed after the source fix, updating the runnable extension bundle. The open Extension Host still requires reload to execute that bundle.

## Eliminated — APPEND ONLY
- Transcript reader normalization: direct `renderMarkdownLite` input reproduces both failures.
- Vault preview CSS: the broken structure exists in the DOM before styling.

## Root cause — OVERWRITE
`src/webview/vault/markdownLite.ts` captured list indentation but discarded it. Nested `-` markers ended each ordered list, became sibling `<ul>` elements, and caused each following numbered item to start a fresh `<ol>` at 1. The recursive list builder now nests greater indentation under the current `<li>` and skips blank separators before same-level items.

## Scope
- `src/webview/vault/markdownLite.ts`
- `src/webview/vault/markdownLite.test.ts`

## Side-effect risk
All vault transcript lists share this parser. The existing marker-switch test and full focused regression suite remain green; headings, tables, code fences, inline safety, and paragraphs are separate branches.
