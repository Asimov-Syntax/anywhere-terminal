# Design: fail-a-build-whose-bundle-cannot-resolve-itself

## Context

A dependency whose package `main` is a UMD bundle calls its factory with `require` as a PARAMETER,
and the factory then requires a relative path. esbuild cannot follow a require reached through a
parameter, so the call survives into the output and resolves against `dist/` at runtime — where
nothing is. The extension failed to activate with `Cannot find module './impl/format'`.

The whole test suite stayed green throughout, because vitest resolves the dependency's ESM entry and
never loads the bundle at all. That is the shape of the problem: **no suite that imports sources can
catch it, because the defect is in the artifact.**

The immediate instance was fixed in `esbuild.js` by aliasing `jsonc-parser` to its ESM build. This
change is the tripwire that would have caught it — and it must catch the CLASS, not that package.

## D1 — The gate reads `dist/extension.js`, and nothing else

It runs after `esbuild.js --production` in the `package` script, beside the three
`scripts/check-*.mjs` gates already there. Reading sources would reproduce exactly the blindness that
let this ship: the source is fine, the bundle is not.

## D2 — What counts as a require the runtime cannot satisfy

Requires are found **syntactically**, by walking a TypeScript AST for a bare `require` identifier
called with one string-literal argument. `typescript` is already a direct devDependency and already
carries a gate here (`src/test/invariants/fsDeletionGate.ts`), so this is the repo's own idiom rather
than a new one.

A text scan was tried first and was wrong in both directions (.reviews/round-1.md F002): it reported
`require("./x")` written inside a comment or quoted in a diagnostic STRING, and it reported
`loader.require("./x")` — a method that merely shares the name. It also missed a call whose `require`
and `(` were separated. Each surviving specifier is then classified:

| Specifier | Verdict | Why |
|---|---|---|
| A node builtin (`node:fs`, `process`, `buffer`, …) | ok | Always present |
| A declared `external` from `esbuild.js` (`vscode`, `node-pty`) | ok | Supplied by the host, deliberately unbundled |
| Absolute (`/…`) | **fail** | A machine path baked into a shipped bundle names the BUILD machine |
| Relative (`./…`, `../…`) | **fail unless it resolves to a shipped file** | This is the shipped defect |
| Any other bare specifier | **fail** | It should have been bundled; at runtime it resolves against a `node_modules` the VSIX does not carry |

The externals are READ FROM `esbuild.js` rather than copied here. A second hand-maintained list is a
list that drifts, and the drift direction is silent: an external removed from the build but left in
the gate's allowlist turns a real failure into a pass.

They are read off the config object whose `outfile` is the extension bundle, and the gate throws
unless exactly one such object exists. `esbuild.js` configures the extension AND the webview, so
taking the first `external:` array in the file allowlists the wrong build's externals; and a
commented-out entry is not a member of an array, though a text scan counted it as one — which
allowlisted a package the build had STOPPED declaring external (.reviews/round-1.md F003).

**Resolution is what the PACKAGED extension could load, not what exists on the build machine**
(.reviews/round-1.md F001). Two things the builder's filesystem cannot answer directly: `scripts/`
and `node_modules/` exist in the checkout and are not in the VSIX, so their presence proves nothing;
and a directory that merely exists is not a module — Node throws `MODULE_NOT_FOUND` for one with no
index and no `package.json`. So a relative specifier resolves only to a real FILE (`.js`, `.json`,
`.node`, a directory `index.*`, or a directory carrying its own `package.json`) that lies INSIDE the
artifact directory.

Builtins come from `node:module`'s `builtinModules`, not a literal list, so a new builtin in a future
Node does not become a false failure.

## D3 — Detection is a function, so the gate can be proven non-vacuous

`scripts/bundleRequires.mjs` exports the classifier; `scripts/check-bundle-requires.mjs` is the CLI
that reads the artifact and exits non-zero. The unit suite drives the classifier over the defect's
own signature — `require("./impl/format")` — and over each ok row.

A gate nobody has seen fail is a gate nobody knows works, and PLAN WT-011.12's acceptance demands a
deliberately reintroduced instance be caught. That reintroduction is a fixture string, not an edit to
`esbuild.js`: a test that rewrites the build config to prove a point is a test that can leave the
build broken.

## Adoption

`clean-now`. The current bundle passes: its only surviving requires are node builtins and `vscode`
(verified against `dist/extension.js` at planning time). No baseline, no ratchet.

## Known limit, stated rather than hidden

Only `require()` with a STRING LITERAL is detected. A computed require — `require(x)` — cannot be
resolved without evaluating the program, and this repo has a legitimate one: the lazy `node-pty`
load goes through `module.require(fullPath)`.

That limit is about the ARGUMENT, and the first draft of this paragraph quietly used it to excuse a
text scan whose problem was different: a scan cannot tell a call from a comment, a string, or a
method of the same name, and that is not a limit of static analysis — it is a limit of not parsing.
The AST removes it. What remains is the honest limit: a computed specifier is invisible.

That is acceptable here because the shipped failure left a DIRECT literal call —
`require("./impl/format")` — which is the observable the defect actually had. This is a tripwire, not
a proof of loadability; the proof would be loading the bundle in a real extension host, which is
`vscode-test`'s job and a different task.
