# 260827-webview-js-missing

## Symptom (verbatim)

> sau wire-worktree-mutating-actions có vẻ bị lỗi
> `ERR Webview.loadLocalResource - Error using fileReader. requestUri=file:///…/media/webview.js?v%3Db408bfe3905ff319b749b2cb80098f2e, resourceToLoad=…`
> plus `ExperimentalWarning: SQLite is an experimental feature` from the extension host.

## Repro

`bash asimov/debug/260827-webview-js-missing/repro.sh` — deletes `media/webview.js`, runs
`node esbuild.js`, asserts the file came back.

Baseline output:

```
OBSERVES 1: RED — media/webview.js was not produced (esbuild exit 1)
✘ [ERROR] Could not resolve "node:path"
src/worktree/createPath.ts:7:26: ERROR: Could not resolve "node:path"
```

## Root cause

`src/webview/worktree/WorktreeCreateDialog.ts:16` imported `sanitizeBranchForPath` from
`src/worktree/createPath.ts:7`, which opens with `import * as nodePath from "node:path"`.

`esbuild.js:92` builds the webview bundle with `platform: "browser"`, which has no resolution
for `node:*` specifiers. One import edge from a browser-bundled file into a Node-only module
therefore failed the **whole** webview build. `esbuild.build()` writes nothing on error, so
`media/webview.js` was never created — and VS Code's `loadLocalResource` reported it as a
fileReader error rather than a missing file, which is what made this read like a webview bug.

Both files arrived in the same commit, `aeb447f wire-worktree-mutating-actions` — the commit the
reporter named.

The two bundles fail asymmetrically and that is why this shipped: `dist/extension.js`
(`platform: "node"`) built fine, and `esbuild.js:127` runs both targets under one
`Promise.all`, so a green extension bundle sits next to a webview bundle that was never
emitted.

## Why the type checker did not catch it

`pnpm run check-types` was green at baseline and is green now. `tsc` resolves `node:path`
happily — the constraint that this module may not reach Node is a *bundler platform*
constraint, invisible to type checking. Only `node esbuild.js` can see it.

## Fix

Extracted the rule to `src/worktree/branchSlug.ts` — pure string work, zero imports, safe from
either bundle. `createPath.ts` no longer defines it; `WorktreeHost.ts` (host) and
`WorktreeCreateDialog.ts` (webview) both import from the new module, so the single-definition
property the original comment was protecting (round-3 B12) is preserved without the Node
coupling.

Prose corrected in the same patch: the rationale block in `createPath.ts` and the re-export
comment at `WorktreeCreateDialog.ts:79`, both of which asserted the rule "lives beside the
other path rules". Removing the function also reattached the orphaned `ORDER IS THE POINT`
doc comment to `validateCreatePath`, which is what it describes.

## Verified

`verify --reconfirm`: repro RED with the fix stashed, GREEN with it restored. Regression
(`pnpm run check-types && pnpm run test:unit`) green, same as its exit-0 baseline.
`media/webview.js` is now emitted (4.9 MB, 13:40).

## Eliminated

| Hypothesis | Evidence that killed it |
|---|---|
| `media/` missing or unwritable | `media/xterm.css` present and rewritten 11:38 by the copy plugin, same target dir |
| Extension-host bundle, or the SQLite warning in the report | `dist/extension.js` builds clean; the SQLite line is a Node `ExperimentalWarning` from the Antigravity host, unrelated to `loadLocalResource` |
| Stale or corrupt `webview.js` on disk | `ls media/` showed only `xterm.css`; `.gitignore:8` confirms it is a never-committed build artifact |

## Scope

`src` — the fix spans `src/worktree/` and `src/webview/worktree/`, whose narrowest common
parent is `src`.

## Side-effect risk

Low, and bounded by the import graph. `sanitizeBranchForPath` has exactly two call sites
(`WorktreeHost.ts:723`, `WorktreeCreateDialog.ts:335`); its body is unchanged, so behavior is
identical on both sides. The public surface is unchanged too —
`WorktreeCreateDialog.ts` still re-exports it, which is how
`WorktreeCreateDialog.test.ts:7` reaches it.

## What this did not settle

Nothing stops the next Node-only import from re-entering the webview bundle the same way, and
`check-types` will stay green when it does. A guard — an esbuild-level check, or a lint rule
forbidding `src/webview/**` from importing modules that pull `node:*` — would turn this class
of fault into a fast failure instead of a broken artifact discovered at runtime. Out of scope
for this session; worth raising as its own change.
