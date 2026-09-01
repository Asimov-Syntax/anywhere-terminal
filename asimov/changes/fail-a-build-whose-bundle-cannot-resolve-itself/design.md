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

Every `require("<literal>")` surviving in the bundle is classified by its specifier:

| Specifier | Verdict | Why |
|---|---|---|
| A node builtin (`node:fs`, `process`, `buffer`, …) | ok | Always present |
| A declared `external` from `esbuild.js` (`vscode`, `node-pty`) | ok | Supplied by the host, deliberately unbundled |
| Relative or absolute (`./…`, `../…`, `/…`) | **fail unless it resolves from `dist/`** | This is the shipped defect |
| Any other bare specifier | **fail** | It should have been bundled; at runtime it resolves against a `node_modules` the VSIX does not carry |

The externals are READ FROM `esbuild.js` rather than copied here. A second hand-maintained list is a
list that drifts, and the drift direction is silent: an external removed from the build but left in
the gate's allowlist turns a real failure into a pass.

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

Only `require()` with a STRING LITERAL is detected. A computed require — `require(x)` — is exactly
what defeated esbuild in the first place, and it defeats a text scan for the same reason. This gate
catches the surviving literal call the UMD factory emits, which is the observable the failure
actually had. It is a tripwire, not a proof of loadability; the proof would be loading the bundle in
a real extension host, which is `vscode-test`'s job and a different task.
