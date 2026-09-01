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

## D2 — Finding the calls, when the callee is not named `require`

Requires are found by walking a TypeScript AST — `typescript` is already a direct devDependency and
already carries a gate here (`src/test/invariants/fsDeletionGate.ts`), so this is the repo's own
idiom rather than a new one.

A text scan was tried first and was wrong in both directions (.reviews/round-1.md F002): it reported
`require("./x")` written inside a comment or quoted in a diagnostic STRING, and it reported
`loader.require("./x")` — a method that merely shares the name. It also missed a call whose `require`
and `(` were separated. Parsing removes all four.

Matching the **identifier `require`** was the next thing to be wrong, and this is the load-bearing
correction (.reviews/round-2.md F002). The gate reads a bundle built `--production`, and minification
renames parameters. A UMD dependency's CJS branch receives `require` as a factory ARGUMENT, so after
minification the shipped defect reads:

```js
(function(e){ … var o=e(require,r); … })(function(e,o){ … var n=e("./impl/format"); … })
```

`require` still appears — passed as an argument — but it is never the callee. The callee is `e`.
A detector keyed on the name `require` returns nothing here and the gate passes clean on the only
artifact it ever inspects. Reproduced directly: `esbuild --bundle --platform=node --minify` over a
jsonc-parser-shaped UMD fixture emits exactly the line above.

So the callee is identified by **what it is bound to, not what it is called**. One intra-module
fixed point over the parsed bundle:

1. Seed the tainted set with the identifier `require`.
2. Record every binding — `var`/`let`/`const` initializer, or parameter bound at a call site — whose
   value is a function expression, so a callee identifier can be resolved back to a function.
3. For every call whose callee resolves to a known function expression, bind that function's
   parameters positionally to the call's arguments; a parameter bound to a tainted expression joins
   the tainted set.
4. Repeat to fixed point (the bundle is finite and each step only adds names).

A call is a require call when its callee is a tainted identifier and it has exactly one
string-literal argument. This catches the direct `require("./x")` spelling — `require` is tainted by
seed — and the minified UMD spelling, without matching `loader.require`, comments, or strings.

Each surviving specifier is then classified:

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
own signature and over each ok row.

The signature is the SHIPPED one. Feeding it `require("./impl/format")` proves only that the detector
handles the spelling the defect had in source — the spelling that never reaches the artifact. The
witness feeds production-minified UMD output, where the callee is a renamed parameter, because a
gate armed against a shape it will never see is the vacuous gate this round found.

A gate nobody has seen fail is a gate nobody knows works, and PLAN WT-011.12's acceptance demands a
deliberately reintroduced instance be caught. That reintroduction is a fixture string, not an edit to
`esbuild.js`: a test that rewrites the build config to prove a point is a test that can leave the
build broken.

## D4 — A directory resolves only when its manifest's `main` resolves

A `package.json` sitting in the directory is not resolution (.reviews/round-2.md F001). The manifest
names a `main`, and that `main` may point at a file the VSIX does not carry, or escape the artifact
directory, or be absent or malformed — Node throws `MODULE_NOT_FOUND` for each, while a check that
stops at "the manifest exists" returns ok.

So a directory resolves only when: its `package.json` parses; its effective `main` (absent ⇒ Node's
`index.*` fallback) resolves through the same shipped-FILE rule the relative case uses, extension
fallback included; and the resolved file lies INSIDE the artifact directory. A manifest that fails
any of those is a failure with the reason named, not a pass.

## D5 — A config the extractor cannot read is refused, never trusted

`declaredExternals` reads plain literal properties. An object can also be composed with a spread, a
computed key, or an accessor, and then the property esbuild consumes is not the one a literal read
returns: an earlier `external: ["stale"]` overridden by a later spread leaves the extractor reporting
`stale` while the build externalizes something else (.reviews/round-2.md F003). The direction of that
error is the dangerous one — it allowlists a dependency the VSIX does not carry.

The allowlist is an authority, so it fails closed: a candidate config object carrying a spread, a
computed property name, or an accessor is REFUSED with that reason, rather than read as if those
constructs were not there. The current `esbuild.js` is a plain literal and reads correctly; strictness
costs nothing today and the refusal is loud when it stops costing nothing.

## Adoption

`clean-now`. The current bundle passes: its only surviving requires are node builtins and `vscode`
(verified against `dist/extension.js` at planning time). No baseline, no ratchet.

## Known limit, stated rather than hidden

Only a call with a STRING LITERAL argument is detected. A computed require — `require(x)` — cannot be
resolved without evaluating the program, and this repo has a legitimate one: the lazy `node-pty` load
goes through `module.require(fullPath)`.

That limit is about the ARGUMENT. The first draft of this paragraph used it to excuse a text scan
whose problem was different, and the second used it to assert that the shipped defect "left a DIRECT
literal call" — which is true of the SOURCE and false of the shipped bundle, where the callee has
been renamed. Both mistakes were the same one: reasoning about the code that was written instead of
the artifact that ships. D2's fixed point is keyed on binding rather than spelling for that reason.

What remains honest: a computed specifier is invisible, and taint that flows through a data structure
rather than a call argument is invisible. That is acceptable because this is a tripwire, not a proof
of loadability; the proof is loading the bundle in a real extension host, which is `vscode-test`'s
job and a different task.

The gate is armed against the artifact, not the source: its non-vacuity witness feeds it
production-minified UMD output, because that is the shape the defect actually shipped in.
