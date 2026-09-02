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

So the callee is identified by **what it is bound to, not what it is called**.

Round 3 then found three more spellings that ship and were still missed or misjudged, and they were
one defect rather than three: the hand-rolled lexical resolver behind that idea was wrong about
function declarations (F004), about taint through an assignment (F005), and about telling an ambient
`require` from a local binding that merely shares the name (F007 — a FALSE REJECTION of a legitimate
build, caused by the spelling seed this section previously argued for).

Three rounds, three hand-rolled detectors, three misses: a text scan, then an identifier match, then
a scope resolver. The lesson is not to write a fourth. **TypeScript's own binder already resolves
lexical identity**, it is the same `typescript` devDependency the parse already uses, and its answers
were verified against every disputed case before this paragraph was written:

| Callee | `getSymbolAtLocation().declarations` | What it settles |
|---|---|---|
| `r` in `var r = require; r("./x")` | `VariableDeclaration` | follow the initializer — F005 |
| `req` in `function factory(req){…}` | `Parameter` | follow the call site |
| `factory` | `FunctionDeclaration` | a callable target, invisible before — F004 |
| `require` declared as a parameter | `Parameter` | DECLARED, so not ambient — F007 |
| ambient `require` | `null` | the ambient test, exactly |

`declarations === null` is the precise ambient test the previous cut approximated with "nothing in
this bundle declares it", and it is why the spelling seed can now be **dropped**: a binding named
`require` that is genuinely ambient has no declaration, and one that is a local callback does. The
round-1 fixture the seed existed to preserve is source-only — an uninvoked factory that never reaches
a bundle — so the fixture is what changes, not the detector.

The fixed point runs over SYMBOLS rather than node identity:

1. Seed: an identifier resolving to a symbol with no declarations and spelled `require`.
2. A symbol's declarations give its value — a variable initializer, a parameter bound at a call site,
   or a function declaration — so a callee resolves to the functions it may hold.
3. Bind parameters positionally to arguments, and propagate through identifier initializers and
   assignments, both monotonically.
4. Worklist with reverse indexes — symbol → the assignments and argument/parameter edges that depend
   on it — so a new fact enqueues the edges that read it rather than triggering a whole re-scan. What
   this pass is obliged to guarantee about its own cost is § Cost, below; three rounds were spent
   trying to discharge a stronger claim that is not true of the artifact.

D2's reach narrows accordingly: after D6 it answers for the bare and absolute classes, and the
relative class — the one that actually shipped — no longer depends on it.

A call is a require call when its callee is a tainted identifier and it has exactly one
string-literal argument. This catches the direct `require("./x")` spelling — `require` is tainted by
seed — and the minified UMD spelling, without matching `loader.require`, comments, or strings.

Each surviving specifier is then classified:

| Specifier | Verdict | Why |
|---|---|---|
| A node builtin (`node:fs`, `process`, `buffer`, …) | ok | Always present |
| A declared `external` from `esbuild.js` (`vscode`, `node-pty`) | ok | Supplied by the host, deliberately unbundled |
| Absolute (`/…`) | **warn** | A machine path baked into a shipped bundle names the BUILD machine — reported, but see § Coverage |
| Relative (`./…`, `../…`) | **fail unless it resolves to a shipped file** | This is the shipped defect |
| Any other bare specifier | **warn** | It should have been bundled; at runtime it resolves against a `node_modules` the VSIX does not carry — reported, but see § Coverage |

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

### Coverage — what D2 claims, after round 5

D2 makes **no completeness claim** for the bare and absolute classes, and its findings there **do not
fail the build**; they are reported as warnings.

Five rounds established the reason. Conditional aliases (`typeof require === "function" ? require : f`)
and `.call` factories still escape the taint, and modelling every value branch of a minified artifact
is the same unbounded question rounds 1-4 already lost four times (.reviews/round-5.md F008, F009).
The reviewer's own remedy offered exactly this alternative: model the branches, or remove the classes
from the coverage claim.

Removing them costs nothing that was promised. PLAN WT-011.12 Acceptance requires a relative require
that will not resolve to fail the build, and node builtins and the editor host not to be reported. It
never required a bare or absolute specifier to be reported at all — that coverage was scope added past
the acceptance, and every blocker surviving five rounds lived in it.

Warning rather than failing is the load-bearing half of this decision. An incomplete detector that
fails builds can reject a legitimate build (.reviews/round-5.md F010: a context-insensitive union
flags innocent bare strings) in exchange for a guarantee the gate no longer makes. As a warning the
signal is kept, and the cost of its imprecision is a message instead of a blocked release.

### Cost — a bound the artifact evidences, after round 7

Rounds 4, 5 and 6 each tried to establish "each propagation edge is applied exactly once", and round 7
measured that it is **false on the shipped artifact**: 3555 applications for 3489 distinct pairs. It
was never true; rounds 5 and 6 asserted it on synthetic fixtures built to exhibit one topology each,
and round 6's witness could not even see the path round 6 changed. An obligation that three rounds
could not discharge, and that the artifact refutes, is the wrong obligation.

What is actually at risk is unbounded package-time work, so that is what is bounded. Instrumented
over `dist/extension.js` (1,908,308 bytes):

| Counter | Real artifact | Synthetic mixed fanout, n=160 |
|---|---:|---:|
| `flows` — a fact offered to a symbol | 13,823 | 52,000 |
| `factVisits` — a prior fact replayed | **22** | **4,121,600** |
| `argScans` — a target scanned for an argument arrival | 52 | 25,600 |
| total work | 13,897 | 4,199,200 |

The Θ(N²)/Θ(N³) growth round 7 measured is real, and it is **187,000x removed from what the shipped
bundle does**. Its defeater is N identical reassignments of one binding, which no bundler emits.

So D2 obliges a **ceiling**, not an asymptotic shape:

- Propagation counts every unit of work it performs, on every path — the argument-delivery path
  included. Counting only the `applyCall` path is what made round 6's assertions vacuous.
- Work above `PROPAGATION_CEILING` abandons the pass. The gate says so, loudly, in the same voice D5
  uses for a config it cannot read. A silent skip would be the one outcome worse than the cost.
- The ceiling is 2,000,000 work units — 144x the shipped artifact's 13,897, and about 60 ms.

**Abandoning the pass cannot change a build's verdict.** After D6, the only class that FAILS is the
relative one, and it is answered by D6's literal sweep and D7's template pass, neither of which
propagates. Every relative specifier a require call can carry is a string literal in the bundle, so
the sweep is a superset of what propagation contributes to that class; propagation now feeds only the
bare and absolute WARNINGS, which § Coverage already makes no completeness claim for. Abandoning it
therefore costs warnings the gate never promised, and never a guarantee it did.

This is a bound that can be checked rather than argued: the artifact's headroom is a number, a bundle
that trips the ceiling is a fixture, and the subsumption is a witness.

### Obligation ledger

| Claim | Semantics | Defeater | Witness | Disposition |
|---|---|---|---|---|
| Propagation work is bounded | Every run either completes under `PROPAGATION_CEILING` or abandons the pass | A path whose work the counter does not observe — round 6's `deliverArgument` was exactly this | Counter arm-checked by making `deliverArgument` do extra work and observing the count rise; a fixture above the ceiling is abandoned rather than ground through | supported |
| Abandoning the pass cannot change a verdict | For every bundle, the set of `severity: "fails"` verdicts is identical with the pass run and with it abandoned | A relative specifier reachable only through a require call and not present as a bundle string literal | A minified-UMD fixture whose relative request arrives only through propagation, asserted present in `relativeLiterals` too; and equal failing verdicts with the pass abandoned | supported |
| A computed relative request in a call argument is reported | Every `TemplateExpression` with a relative head in call-argument position yields a failing verdict, through any number of enclosing parentheses | `r((`./${name}`))` — round 7 F019, which yields no verdict at all today | Direct, parenthesized and UMD-parenthesized fixtures all reported; path data and tagged templates still not | refuted at HEAD, closed by task 8_1 |
| The ceiling never fires on a real build | `dist/extension.js` stays far below the ceiling | A future dependency whose bundled shape explodes the fanout | The artifact's own work counted against the ceiling in the suite, so the headroom is asserted rather than remembered | supported |

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
