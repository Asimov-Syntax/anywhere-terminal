# Review round 5 — fail-a-build-whose-bundle-cannot-resolve-itself

- Date: 2026-09-02
- Cycle: 4
- Mode: discovery
- Operating mode: fastlane
- Round extension: accepted by the review protocol; `asm review round-start` proceeded with round 5.
- Head reviewed: `e5a47f264f7f85b3da9935bd2a21d42e2370a2d4` (explicit range Head). The checkout later advanced to an unrelated plan commit; all target files remain byte-identical to `e5a47f26`.
- Diff scope: `git diff 1c7412ff..e5a47f26`
- Working tree: protocol-generated analytics changes and unrelated paths were outside the explicit range.
- Reviewable lines: 121 additions and 13 deletions across the implementation/declaration files; 52 additions and 8 deletions of generated analytics metadata inspected; 70 test additions reviewed inline.
- Intent context: Gate 2 approved after the round-4 handback; D2, D6, and tasks 5_1–5_2 applied. No `proposal.md` exists (light-lane change).
- Verify evidence: `bun run asm change verify-status fail-a-build-whose-bundle-cannot-resolve-itself` reports tasks 1_1 through 5_2 exit 0 and records 51 assertions. The author recorded clean type-check, 6763 passing unit tests, the Biome 3/14/1 baseline, a roughly 0.56-second real-artifact gate, four simultaneous artifact arms, and deep-chain timings. The chair ran no project verify command.
- Verdict: **REJECT**
- Counts: 4 BLOCK · 3 WARN · 2 SUGGEST
- Split over gating blockers: 4 feature / 0 machinery

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-logic | D6 sweep and D2 seam | relative soundness, call-class seams, and taint precision | `opus[1M]` |
| asm-review-performance | worklist and sweep | fanout growth, deep-chain cost, and noise growth axis | `gpt-5.6-terra[1M]` |
| asm-review-contracts | relative-specifier contract | Node spellings, cross-platform paths, and allowlist authority | `sonnet[1M]` |
| chair | full range | all applicable lenses and package full-flow trace | `gpt-5.6-sol[1M]` |

Skipped: `asm-review-data-security`, `asm-review-frontend`, and `asm-review-reuse` — the range adds no data/auth or UI surface and reuses the existing parser/resolver mechanisms.

---

## Findings

### [F006] Callable fanout still reprocesses prior targets quadratically

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: asm-review-performance (corroborated by chair)
- Class: feature
- File: `scripts/bundleRequires.mjs:239`
- Status: accepted — persists from round 4
- Triage: The reverse-chain boundary is fixed, but task 5_2's “each propagation edge once” invariant remains false under callable fanout.

**Evidence.** When a symbol gains a new function holding, `calledAs` re-enqueues each call of that symbol. `applyCall()` then rebuilds and traverses the complete set of functions held so far, and lines 275–279 re-enqueue parameters for all targets whenever any flow grows. With K functions flowing into one called symbol, target processing is `1 + 2 + … + K`. Focused measurements were approximately 14 ms at K=100, 34 ms at 200, 124 ms at 400, and 502 ms at 800. The deep reverse chain now scales linearly — 1,000 to 8,000 links measured roughly 6 to 31 ms — but it exercises no callable fanout.

**Impact.** Generated/minified bundles commonly reuse one wrapper symbol for many factories; that is the exact topology earlier rounds observed. Package time can again grow quadratically despite the worklist and the accepted edge-once claim.

**Suggested fix.** Queue fact-specific work such as `(call, newly-added-target-function)` and process only that target. Deduplicate pending/processed work by edge-plus-fact identity, and enqueue downstream parameter edges only when that specific flow adds a fact.

**Invariant inventory.** Verified safe: deep acyclic/cyclic scalar propagation and finite monotone termination. Affected: multiple callable facts on one callee symbol and repeated parameter-edge queueing.

### [F008] Conditional-alias detection remains open for bare and absolute requests

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: asm-review-logic (corroborated by chair)
- Class: feature
- File: `scripts/bundleRequires.mjs:149`
- Status: accepted — persists from round 4, narrowed to bare/absolute
- Triage: D6 closes F008's relative boundary only; D2 explicitly retains authority for bare and absolute classes.

**Evidence.** `valueOf()` is unchanged and still returns no source for conditional/logical/sequence expressions. `var r = typeof require === "function" ? require : f; r("missing-package")` and the absolute equivalent both produce no call-detected candidates. The sweep ignores them because their strings are not relative.

**Impact.** An unbundled bare dependency or machine-specific absolute path behind a standard guarded alias can reach runtime and fail activation while the gate reports clean. The consequence is unchanged even though D6 removed the historical relative boundary.

**Suggested fix.** Extend `valueOf()` to union conditional, logical, and sequence value branches for the bare/absolute classes, or explicitly remove those classes from the gate's claimed coverage.

### [F009] `.call` factories remain open for bare and absolute requests

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: asm-review-logic (corroborated by chair)
- Class: feature
- File: `scripts/bundleRequires.mjs:185`
- Status: accepted — persists from round 4, narrowed to bare/absolute
- Triage: D6 closes F009's relative boundary only; the invocation mechanism remains unchanged.

**Evidence.** `targetsOf()` still rejects a `PropertyAccessExpression`. Both `factory.call(null, require)` with `factory` requesting `"missing-package"` and the absolute-path variant return no candidates. The relative form is now caught only because D6 sees its literal.

**Impact.** UMD wrappers using `.call(root, require, exports, module)` can carry bare/absolute runtime failures through the class D2 says it continues to own.

**Suggested fix.** Resolve `.call` from its receiver and shift parameters past `thisArg`; either support or explicitly delimit `.apply` and `.bind`.

### [F013] An exact-text non-specifier entry globally suppresses a valid module request

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: asm-review-contracts (corroborated by asm-review-logic and chair)
- Class: feature
- File: `scripts/bundleRequires.mjs:311`
- Status: accepted — new in round 5
- Triage: D6's soundness claim is falsified by the allowlist mechanism itself.

**Evidence.** `NOT_SPECIFIERS` is keyed only by decoded text. Its sole entry, `"../"`, is justified by one `.startsWith("../")` argument, but `"../"` is also a complete Node relative request. A loader occurrence reached through a call shape D6 exists to cover, such as `box.r("../")` or a `.call` factory, is removed from the sweep solely because another occurrence has the same text. Direct call detection can rescue a plain `require("../")`, but not the previously accepted unsupported call shapes.

**Impact.** The visible price of one false-positive suppression becomes a global blind spot for that string. Every future exact-text entry widens the same fail-open surface, contradicting “whatever it is passed to and whoever calls it.”

**Suggested fix.** Scope exemptions to the justified AST occurrence or structural role, not the text value — for example, an identified argument position of a known non-module predicate. Ensure another occurrence with the same text is still classified, and fail when an exemption's justified occurrence disappears.

**Invariant inventory.** Verified safe: the current `../` occurrence as a path-prefix test. Affected: any genuine module occurrence sharing an allowlisted string, especially through call shapes not recognized by D2.

### [F010] Context-insensitive union still rejects innocent bare strings

- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: asm-review-logic (corroborated by chair)
- Class: feature
- File: `scripts/bundleRequires.mjs:274`
- Status: open — persists from round 4, narrowed to bare/absolute
- Triage: Non-gating false-rejection warning.

**Evidence.** A shared `invoke(fn, value)` helper called once with a require factory and once with an unrelated callback merges target and value facts across call sites. A focused witness reported both the real request and `"diagnostic"`, although the innocent callback never received require. D6 does not cross-check bare strings, so the false candidate fails classification as an unbundled package.

**Impact.** A shared invocation helper can fail a valid package build with a misleading bare dependency.

**Suggested fix.** Pair target functions with arguments from the same call site, or explicitly record the conservative false-positive boundary in D2.

### [F012] The declared computed/data-structure limits persist outside the relative class

- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: chair
- Class: feature
- File: `scripts/bundleRequires.mjs:290`
- Status: open — persists from round 4 with reduced reach
- Triage: Relative literal instances are fixed by D6; bare/absolute and non-literal relative values remain outside both mechanisms.

**Evidence.** `var p="missing-package"; require(p)` is ignored because the call argument is not a literal and the sweep ignores bare strings. `var box={r:require}; box.r("missing-package")` is ignored because the callee is a property access and the sweep again ignores bare strings. A template expression such as `` `./${name}` `` remains invisible as the declared computed relative case. Constant concatenations are usually folded by esbuild, while dynamic concatenation/template substitution remains outside D6.

**Impact.** The two mechanisms are a tripwire, not proof that all surviving bare/absolute or computed relative requests resolve.

**Suggested fix.** Resolve statically constant argument symbols for bare/absolute values, and keep genuinely dynamic/data-structure cases explicit as accepted limits rather than completeness claims.

### [F014] The sweep omits Node-relative boundary spellings and Windows separators

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: asm-review-logic (corroborated by asm-review-contracts and chair)
- Class: feature
- File: `scripts/bundleRequires.mjs:332`
- Status: open — new in round 5
- Triage: Non-gating cross-platform boundary warning.

**Evidence.** The predicate accepts only `./` and `../`. Node also treats `"."`, `".."`, `".\\x"`, and `"..\\x"` as relative requests. Those forms are not swept, and through `.call`/object-carried loaders they escape call detection too. The current artifact already contains literal values `"."`, `".."`, and `"..\\"`, demonstrating that widening the predicate changes the observed noise floor. Escaped forward-slash literals and no-substitution templates are correctly surfaced because TypeScript exposes their cooked text.

**Impact.** D6's “every relative string literal” claim is not cross-platform complete, and a Windows-only sidecar request can escape or be resolved against the build host's path semantics instead of the runtime's.

**Suggested fix.** Use one platform-independent Node-relative predicate for both sweeping and classification: `text === "."`, `text === ".."`, or a `.`/`..` prefix followed by either slash. Resolve Windows-form requests with target-platform semantics rather than the packager host's separators.

**Noise trade-off.** The one-entry allowlist is an observed property of today's predicate, not a structural bound. Correcting the predicate immediately exposes three additional current path-helper literals; future extension-side route/asset/path strings can grow this set. The webview bundle itself is not scanned, but extension code that embeds or manipulates such paths is.

### [F011] Default-parameter and return-value flows remain outside bare/absolute detection

- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: chair
- Class: feature
- File: `scripts/bundleRequires.mjs:107`
- Status: open — persists from round 4 with reduced reach
- Triage: Relative literals are now swept; uncommon bare/absolute scalar flows remain.

**Evidence.** Parameter initializers and return values are still not represented in D2. D6 catches their relative literal bodies, but `function f(r=require){r("missing-package")} f()` remains invisible to bare call detection.

**Suggested fix.** Add parameter-initializer edges if a production dependency witness appears; otherwise name this narrower limit.

### [F015] The artifact is parsed twice per gate run

- Severity: SUGGEST
- Confidence: HIGH
- Priority: P5
- Agent: asm-review-logic
- Class: feature
- File: `scripts/bundleRequires.mjs:325`
- Status: open — new in round 5
- Triage: Non-gating efficiency suggestion.

**Evidence.** `checkerFor()` builds a Program/source file for `requiredSpecifiers`, while `relativeLiterals()` independently parses the same bundle again. Focused measurement on the current large artifact put the extra parse/walk at roughly one-third of call-detection time.

**Suggested fix.** Build the source file once in `unresolvableRequires` and pass it to both mechanisms, retaining the string-taking exports as thin wrappers for tests.

---

## Prior finding dispositions

- **F001–F005 and F007 — fixed.** Their manifest/config/parser/binder witnesses remain closed.
- **F006 — persists.** Reverse-chain propagation is now linear, but callable fanout still violates edge-once processing.
- **F008/F009 — persist with narrowed reach.** D6 closes their relative instances only; bare/absolute remain under unchanged D2 mechanics.
- **F010 — persists with narrowed reach.** False union candidates now matter primarily for bare/absolute strings.
- **F011 — persists as a suggestion for bare/absolute flows.**
- **F012 — persists as a warning outside the relative-literal class.**

## Full-flow trace

`vscode:prepublish` → `pnpm run package` → production esbuild writes `dist/extension.js` → `build:check-requires` parses the artifact into a checker-backed call detector and separately into the D6 literal sweep → worklist propagation finds supported bare/absolute calls → relative-looking literals are filtered through `NOT_SPECIFIERS` → both candidate sets are deduplicated by text → externals are read from the matching esbuild config → each candidate is classified through builtin/external/bare/absolute/relative and shipped-file/manifest rules → failures exit nonzero → size and VSIX checks run afterward. F008/F009 leave bare/absolute requests before union; F013/F014 leave relative requests before classification; F006 can amplify the call-detector path under fanout.

---

## Author triage — round 5

| Finding | Severity | Author status | Rationale |
|---|---|---|---|
| F006 | BLOCK | **accepted** | Task 5_2 claims each propagation edge is processed once. Callable fanout falsifies it. My round-4 answer quoted 0.47s on the real artifact, which measured the input's shallowness, not the algorithm. |
| F008 | BLOCK | **accepted** | Taking the second fix line the finding itself offers: remove bare/absolute from the gate's coverage claim rather than continue modelling value branches. |
| F009 | BLOCK | **accepted** | Same disposition as F008; same class, same mechanism. |
| F013 | BLOCK | **accepted** | `NOT_SPECIFIERS` suppresses by decoded string value globally, so an unrelated `.startsWith("../")` hides a real `box.r("../")`. Reproduced. |
| F014 | WARN → **must-fix** | **accepted, escalated** | Escalated because it falsifies the soundness of D6, which after F008/F009 is the gate's only remaining guarantee. A WARN against the sole load-bearing claim is not non-gating. |
| F010, F011, F012 | WARN/SUGGEST | **carried** | Each is scoped to the bare/absolute class. Their disposition follows from the D2 decision the handback settles; triaging them before that decision would be premature. |
| F015 | SUGGEST | **accepted, deferred** | Single-parse refactor is correct but lands with whatever replaces D6's predicate, not before it. |

### Verification I ran before accepting

Every escape reproduced against the built gate — empty result means the request was not reported:

```
F014 dot ("." )        => []
F014 dotdot ("..")     => []
F014 win sep (".\x")   => []
F014 win updir ("..\x")=> []
F013 shadowed          => []
```

### The round-4 premise that did not survive

Round-4 triage justified D6 with a measured "noise floor of one string" on the real
`dist/extension.js`. That number was an artifact of the same narrow predicate F014 reports.
Re-measured against `dist/extension.js` with a predicate that actually covers Node's relative
spellings:

| Predicate | In a String.prototype-method role | Swept |
|---|---|---|
| `.` `..` `./` `../` `.\` `..\` | `.`×20, `..`×23, `../`×1, `..\`×1 | `.`×32, `..`×20 |
| `./` `../` `.\` `..\` only | `../`×1, `..\`×1 | **none** |

So the one-string floor was false, and role-based exclusion alone does not rescue the broad
predicate: `.` and `..` are ubiquitous as path data. Excluding them is a stated limit — a bundled
`require(".")` would be extraordinary — not an allowlist. With that limit plus occurrence-scoped
role exclusion, the real artifact sweeps clean with **no value allowlist at all**, which is what
retires F013 rather than patching it.

### Disposition

Cycle 4. The cycle cap makes option 1 mandatory: no further fix loop opens on this change.
Accepting F008/F009 changes D2's coverage claim and rewriting D6's predicate changes D6 — both are
`D#` changes, so under the remediation boundary they are not remediation either way. **Artifact
handback to `asimov-plan`.**

The accepted scope is narrower than what I built. PLAN WT-011.12 Acceptance reads: *"A build whose
output holds a relative `require` that will not resolve at runtime fails the build … node builtins
and the editor host module are not reported."* It requires the relative class to fail and the
builtin/host classes not to be reported. It never required a bare or absolute specifier to be
reported. D2's bare/absolute coverage was scope I added past the acceptance, and every blocker that
survived five rounds lives in it.
