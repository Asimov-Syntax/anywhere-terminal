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

## D2 — The bare and absolute classes, after the round-7 scope cut

Four rounds asked how a require CALL is spelled, and four found another spelling. Round 5 moved the
relative class off call analysis entirely (D6), leaving this pass answering only the bare and
absolute classes — which § Coverage already makes no completeness claim for, and which round 5 made
WARNINGS that never fail a build.

Rounds 4, 5, 6 and 7 were then spent on the cost of that pass. Each produced a mechanism, and each
was refuted: a timing budget that passed while fanout was quadratic; a callee-side fix whose witness
could not fail on the mixed case; an argument-side fix whose witness could not see the path it
changed; and a work ceiling whose measure a 52 KB fixture reads at 0.12% of its true cost. The
propagation machinery is harder to keep correct than the output it protects is worth.

**So the pass is deleted.** `requireBindings`, `propagationStats`, `requireLiteral`, `specifiersIn`
and `checkerFor` go, and with them `ts.createProgram` and the type checker — the gate becomes a
single `createSourceFile` walk, which is the simplification D6 already earned for the class that
actually fails a build.

What the gate classifies afterwards:

| Specifier | Verdict | Found by |
|---|---|---|
| Relative (`./…`, `../…`, `.\…`, `..\…`) | **fail unless it resolves to a shipped file** | D6's literal sweep |
| A relative-headed template in a call argument | **fail** | D7's template pass |
| Absolute (`/…`) | **warn** | A `path.isAbsolute` test over the same literals D6 already visits |
| A bare specifier | *not reported* | — |

The absolute warning survives because it costs a predicate over literals the sweep visits anyway: no
checker, no fixed point, no ceiling. A machine path baked into a shipped bundle still names the build
machine, and that is worth a line of output.

**The bare class is the cost of this decision, and it is a real loss.** A package that should have
been bundled and was not will no longer be reported at all. There is no cheap replacement: deciding
that a string is a bare specifier rather than ordinary text is exactly the question that needed the
checker. What makes it affordable is that PLAN WT-011.12's acceptance never asked for it — it
requires a relative require that will not resolve to fail the build, and builtins and the editor host
not to be reported. Bare coverage was scope added past the acceptance, and every blocker that
survived seven rounds lived in it.

Externals are still READ FROM `esbuild.js` rather than copied here, by the config object whose
`outfile` is the extension bundle (D5), because a second hand-maintained list drifts silently.
Builtins come from `node:module`'s `builtinModules`. Both still matter: they are what keeps `vscode`
and `node:fs` out of the relative and absolute verdicts.

**Resolution is what the PACKAGED extension could load, not what exists on the build machine**
(.reviews/round-1.md F001). `scripts/` and `node_modules/` exist in the checkout and not in the VSIX,
so their presence proves nothing; and a directory that merely exists is not a module — Node throws
`MODULE_NOT_FOUND` for one with no index and no `package.json`. A relative specifier resolves only to
a real FILE (`.js`, `.json`, `.node`, a directory `index.*`, or a directory carrying its own
`package.json`) INSIDE the artifact directory.

### Coverage — what the gate claims, after round 7

The gate makes ONE completeness claim, for the relative class, and it is D6's: every relative string
literal in the artifact is swept, wherever it sits. Everything else is reported without a claim.

Round 5 established why, and round 7 finished the argument. Conditional aliases
(`typeof require === "function" ? require : f`) and `.call` factories escaped call detection, and
modelling every value branch of a minified artifact is the unbounded question rounds 1-4 lost four
times (.reviews/round-5.md F008, F009). Warning instead of failing kept the signal while removing the
guarantee. Round 7 then showed the machinery producing those warnings could not bound its own cost
across four attempts, and the user chose to delete it rather than fund a fifth.

Nothing that was promised is lost. What is lost is bare-specifier reporting, recorded above as the
price.

### Obligation ledger

| Claim | Semantics | Defeater | Witness | Disposition |
|---|---|---|---|---|
| Deleting the pass cannot change a verdict | For every bundle, the set of `severity: "fails"` verdicts is identical before and after the deletion | A relative specifier reachable only through a require call and not present as a bundle string literal | Structural: `requireLiteral` accepted an argument only when `ts.isStringLiteralLike(unwrap(arg))`, and `relativeLiterals` keeps every `ts.isStringLiteralLike` node of the same root under the same `isRelativeRequest`, so the sweep is a superset. Probed: minified UMD arriving only via propagation, parenthesized argument, no-substitution template argument, and `require("".concat("./x"))` all lose nothing. Task 8_3 pins it. | supported |
| The absolute warning survives the deletion | An absolute specifier present as a bundle string literal is reported as `warns` | An absolute path reaching the bundle only through a computed expression | A fixture carrying `/abs/path.js` as a literal is warned on; the computed case is a stated limit, unchanged from before — call analysis never saw it either | supported |
| Gate cost is bounded by the artifact | One `createSourceFile` and one walk per collector-set, with no fixed point | A collector that re-parses | Task 7_5's `parseCount()` witness, which stays: two parses per run, one of them the esbuild config | supported |
| A computed relative request in a call argument is reported | Every `TemplateExpression` with a relative head in call-argument position yields a failing verdict, through any number of enclosing parentheses | `` r((`./${name}`)) `` — round 7 F019, which yields no verdict at all today | Direct, parenthesized and UMD-parenthesized fixtures reported; path data and tagged templates still not; the `parent.arguments` membership test kept, because kind-only walking misreports `` `./${x}`() `` where the template is the CALLEE | refuted at HEAD, closed by task 8_1 |

## D6 — The relative class is swept, not analysed

Four rounds asked how a require CALL is spelled, and four found another spelling — a text scan, an
identifier match, a scope resolver, then binder-backed taint that still misses
`typeof require === "function" ? require : f` and `factory.call(null, require)`
(.reviews/round-4.md F008, F009). Over a minified artifact that question has no bounded answer.

The defect class is not a call shape. It is **a relative specifier that does not resolve beside the
bundle**. So every relative string LITERAL in the artifact is resolved, whatever it is passed to and
whoever calls it. That is sound over the shipped defect class by construction: any spelling of any
call still has to name its target, and a string literal is the only form this gate ever claimed to
see.

**What counts as relative.** Node accepts `./x`, `../x`, and on Win32 `.\\x` and `..\\x`. The first
draft of this decision recognised only `./` and `../`, so four spellings walked past it
(.reviews/round-5.md F014). The predicate covers all four prefixes.

**A bare prefix is not swept.** The six strings that are exactly a relative prefix and nothing more —
`.`, `..`, `./`, `../`, `.\\`, `..\\` — are excluded. They are legal requests, but in a bundle they are
overwhelmingly path DATA: on the real artifact they occur 95 times and never once as a specifier.
Sweeping them would report false failures to catch a `require("../")` that a bundled extension would
not contain.

This is a stated limit, not an allowlist and not an exemption. It is a property of six fixed strings,
decided once here, and it does not depend on where the string appears. That distinction is what makes
it safe: the value-keyed `NOT_SPECIFIERS` it replaces was refuted (.reviews/round-5.md F013), and so
was the occurrence-scoped exemption drafted to replace THAT — an oracle attack showed
`require("".concat("./missing"))` sits in a `String.prototype` argument position, so a role-based
exemption would have hidden a real request while call detection ignored the outer `CallExpression`
too. A syntax-only AST also cannot prove a method named `startsWith` is `String.prototype`'s.

So there is no exemption mechanism at all. A prefixed literal with anything after the prefix is
always swept, wherever it sits.

**Measured after correction**, on the real 1 MB `dist/extension.js`: the only prefixed literals are
`"../"` and `"..\\"`, both bare prefixes, so **zero** literals are swept — with no allowlist and no
exemption in the mechanism. The round-4 draft claimed a "noise floor of one string"; that number was
an artifact of the narrow predicate F014 reports, and is withdrawn.

**The trade-off, recorded rather than hidden.** The sweep is SOUND over the relative class but
IMPRECISE: it can flag a relative literal that was never a module load. The previous mechanism was
precise and demonstrably unsound, and four rounds did not make it sound. For a gate whose job is to
stop a shipped activation failure, soundness is the property worth buying. The price is paid in six
named strings, fixed in this decision, rather than in a list that grows per artifact.

**This sweep is the whole of what the gate GUARANTEES.** A bare specifier cannot be swept — every
string in the bundle would be a candidate — so no sound mechanism for that class exists here. D2 is
retained, but as a reporter without a coverage claim; see D2 § Coverage. Only the relative class
fails a build.

### One predicate decides the class, for detection AND for severity

`isRelativeRequest` covers four prefixes; `classify` asked `startsWith(".")`. Those disagree on a bare
package whose NAME begins with a dot — `require(".pkg")` resolves from `node_modules/.pkg/` at
runtime, and the gate called it a failing relative request (.reviews/round-6.md F016), which defeats
the warning-only scope cut D2 § Coverage records.

The class is decided ONCE, by the same predicate, and both discovery and severity read it. A
dot-prefixed name that is not one of the four relative spellings is a BARE specifier and takes the
bare path — reported, warned, never a build failure.

### A Win32 spelling is resolved as a spelling, never as the build host

`.\x` and `..\x` were detected by D6 and then handed to `resolveShipped`, which uses host-native
`node:path`. POSIX reads `.\foo` as a filename containing a backslash; Windows reads it as `foo`, so
the verdict depended on the release machine (.reviews/round-6.md F017) — the gate committing the
exact class of defect it exists to catch.

**Taken from a shipped sibling.** `orca/src/relay/git-handler.ts:128-134` and
`git-handler-worktree-ops.ts:133-136` both dispatch on the SPELLING and never on `process.platform`:
`path.win32.isAbsolute(value) ? path.win32.resolve(...) : path.posix.resolve(...)`. The property that
matters is the same one here — a verdict must be a fact about the specifier, not about the machine.

Applied with one adjustment. Resolving THROUGH `path.win32` would produce win32-shaped paths a POSIX
filesystem cannot stat. A Win32-spelled relative specifier names the same target as its POSIX
spelling — the separator is the only difference — so the specifier is normalized to its POSIX
equivalent and then resolved once, by the one resolver. Host-independent verdict, no target-platform
flag, and no second resolution path to keep in step with the first.

## D7 — A relative request that is computed is reported, not resolved

PLAN acceptance says "a relative `require`", not "a relative literal". An oracle attack on D6 found
the gap that wording exposes: esbuild preserves

```js
(function (factory) { factory(require) })(function (r) { r(`./${name}`); });
```

The argument is a `TemplateExpression`, so D6's literal sweep never sees it, and call detection
ignores it too — yet at runtime it is exactly the UMD-factory relative request this whole change
exists to catch.

A template whose HEAD starts with a relative prefix is provably a relative request whatever its
substitutions evaluate to. What it resolves to is not knowable without running the program, so the
gate does not try: it reports the request as unverifiable and fails the build, naming the head.

**Only where a module request can occur.** The first draft reported every relative-headed template
anywhere in the artifact, so ordinary path DATA and tagged templates failed the build as module
requests (.reviews/round-6.md F018). "Zero occurrences in today's artifact" is a measurement, not a
structural bound. A template is reported only in a CALL ARGUMENT position — the only place a require
can take one — and a tagged template is never a call argument in that sense.

**Through the parentheses.** "In a call-argument position" is a fact about the call, not about the
template's immediate parent. The first cut tested the parent directly, so one pair of parentheses —
`r((`./${name}`))` — put a `ParenthesizedExpression` in between and the template produced no verdict
at all (.reviews/round-7.md F019). Parentheses are syntax, not a value, exactly as `unwrap` already
holds for a callee; the position test walks out through them before asking which call it is in.

Failing rather than warning is affordable because it is not noisy: the real `dist/extension.js`
carries **zero** relative-headed templates. If one ever appears legitimately, the fix is to make the
specifier static, which is what a bundler needs anyway.

**A template that is an operand, not an argument, is a stated limit.** `` r(t + ".js") `` — where
`t` is a relative-headed template — is a real relative request, and the position rule misses it: its
parent is a `BinaryExpression`, not the call. Walking out through parentheses does not reach it, and
walking out through value-forming parents would report every relative-headed template that is merely
concatenated somewhere, which is the imprecision D7 exists to avoid. Recorded as a limit rather than
closed, on the same footing as the computed-argument limit D6 already carries.

A template with a NON-relative head is out of scope here, for the same reason a bare specifier is:
every template in the bundle would be a candidate.

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

The manifest is read BEFORE a sibling `index.*` is accepted. Taking the index first let a directory
holding both an index and a malformed `package.json` pass, while Node 18 and Node 24 both throw
resolving it (.reviews/round-3.md F001) — a parse error is fatal to the directory, not something an
index can rescue. Node's index fallback still applies to a VALID manifest whose `main` is absent or
unresolved.

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
computed property name, an accessor, or a SHORTHAND property is REFUSED with that reason. Shorthand
was the form the first guard missed: a trailing `{ external }` overrides an earlier literal at
runtime while a literal read keeps returning the stale value (.reviews/round-3.md F003). The rule is
every element form the extractor does not interpret, not a list of the ones remembered, rather than read as if those
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

### Plan attack that ended the pass — dispositions, 2026-09-02

| Row | Disposition | Evidence |
|---|---|---|
| Propagation work is bounded | **refuted** | `enqueue` (`scripts/bundleRequires.mjs:342-349`) pushes one item per `passedAs` entry on every growth, and none of those pushes is counted. When `targetsOf` returns `[]` — a callee holding no callable — the dequeued item costs zero counted units. Reproduced: a 52 KB fixture with no reassignment of any binding reads **2,400** work units, 0.12% of the ceiling, while the loop performs **1,442,400** queue pops in 767 ms. The proposed arm-check cannot see this, because the uncounted path never enters the target loop — round 6's failure mode one level further out. |
| The ceiling never fires on a real build | **refuted as argued** | My linearity measurement was methodologically wrong: concatenating the artifact with itself duplicates independent symbol graphs and never grows a single symbol's fact set, so it measured the wrong axis. Work is quadratic in per-symbol callable fanout, not in bytes — `flow`'s replay loop costs ~F²/2 for a symbol holding F callables. The ceiling is ~58 KB of a higher-order-helper shape, not ~200 MB. |
| Abandoning the pass cannot change a verdict | supported | Unchallenged; structural argument and four probes stand. |
| A computed relative request is reported | **refuted, and wider than F019** | Parens are the only transparent wrapper a bundler emits, so 8_1 closes the reported case. But `` r(t + ".js") `` is a real relative request with head `./` that is missed today — a `BinaryExpression` parent, which paren-walking does not address. Keep the `parent.arguments` membership test: kind-only walking misreports `` `./${x}`() ``, where the template is the CALLEE. |

Two refuted rows, and the first is the same mistake round 6 made, now in the design rather than the
code. That is the strongest available evidence about this mechanism: the ceiling is a new invariant
needing a counter on every path, an abandonment message, an above-ceiling fixture, an arm-check and a
headroom assertion — and its first two drafts were both wrong in the way its predecessor was wrong.

Resolved by the user, because it overturned their own Gate 1 answer: the propagation pass is
DELETED and the absolute warning is re-earned as a literal-sweep predicate. Bare-specifier reporting
is given up. D2 above is written to that decision; the two refuted rows are gone with the mechanism
they described, rather than fixed.
