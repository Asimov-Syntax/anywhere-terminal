# Review Round 9

- Date: 2026-08-28
- Cycle: 4
- Mode: discovery
- Scope: commit `e9504e391e0ab8dcd51255241ffcbbb499b519de` only, using the `verify-cross-layer-scale` change context
- Head: `e9504e391e0ab8dcd51255241ffcbbb499b519de` (reviewed commit; working tree also contains dirty analytics files and untracked round-8 review metadata outside the requested commit scope)
- Reviewable lines: 237 (plus 21 changed test/fixture lines; 193 skipped Markdown lines)
- Verification evidence: caller reports check-types clean; 234 files / 4,733 tests passing; `pnpm run gate:fs-deletion` exit 0 in 1.48 s over 29 scoped modules with 12 flag fixtures visible; scale bench passing at 0.1 ms presence / 32.4 ms model; lint equal to clean main under Biome 2.4.5; `verify-status` exit 0. Project verification commands were not rerun. Targeted probes used an in-memory TypeScript CompilerHost and wrote no repository files.
- Agents spawned: `asm-review-logic` (reference-type closure, `gpt-5.6-sol[1M]`); `asm-review-logic` (erased provenance, `gpt-5.6-terra[1M]`); `asm-review-contracts` (D10/task 10_1 contract and fixtures, `sonnet[1M]`)
- Agents skipped: data-security, frontend, performance, reuse — no persistence/auth/input boundary, UI, production hot path, or new duplicate capability is in the commit
- Verdict: REJECT
- Counts: BLOCK 3, WARN 2, SUGGEST 1

## Risk map

- Reference-set foundation: whether every runtime use/acquisition of a destructive fs function is represented by an `Identifier`, `PropertyAccessExpression`, or `ElementAccessExpression` whose own type retains the `@types/node/fs` symbol.
- Type provenance: contextual typing, structural parameters, generic constraints, expression results, and module export forms can preserve the runtime function while replacing or relocating its declaration symbol.
- Erased provenance: `any`/`unknown` values need narrow origin recovery without either laundering fs through unhandled sources or reviving W7 on unrelated APIs.
- Fixture truthfulness: each `flag-` filename must be satisfied by executable evidence for its intended reference path, and each `pass-` file must remain free of findings.
- Gate flow: package command → Bun entry point → tsconfig parse → real Program/checker → production/fixture scope classification → typed or erased-reference scan → offender/missed/false-positive aggregation → non-zero, success, or vacuity exit.

## Full-flow trace

1. `pnpm run gate:fs-deletion` runs `bun src/test/invariants/fsDeletionGate.ts`.
2. The gate reads the repository tsconfig and builds one Program, then filters declaration files.
3. Production sources enter only through `src/worktree/**` and `src/providers/WorktreeHost.ts`; fixtures enter through the fixed fixture prefix.
4. `scan()` traverses every AST child. The typed branch examines only identifiers and member accesses; the erased branch additionally walks owner chains and variable declaration initializers.
5. Production hits become offenders. A `flag-` fixture needs at least one hit; a `pass-` fixture needs none. Zero scope or zero proven flags fails vacuity.
6. The top-risk failures occur before aggregation: destructive values can reach executable calls while neither branch recognizes their provenance, and type-only syntax can create hits without an executable reference.

## Open findings

### B16

- ID: B16
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + `asm-review-logic`
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/invariants/fsDeletionGate.ts:150`
- title: The reference set is not closed over executable expressions
- evidence: `visit()` asks for types only on identifiers, property accesses, and element accesses. A destructive function can itself be the result of another expression: an in-scope `getRm()(path)` call has an inner `CallExpression` whose checker type is the real `@types/node/fs/promises` `rm` symbol, but the visitor never asks for that expression's type and the child identifier `getRm` is only a factory. An in-memory Program probe produced zero findings while confirming the inner call-result type symbol was `rm` declared in `fs/promises.d.ts`. Runtime star re-exports (`export * from "node:fs"` / `export * as filesystem from "node:fs"`) likewise expose destructive values without any of the three scanned reference nodes. Boundary inventory searched: direct/renamed identifiers, property/element access, unions, optional calls, call-result callees, tagged/result expressions, named exports, star exports. Affected: expression results and star re-exports. Verified safe: the checked-in direct identifier/member forms and union constituents.
- impact: An enumerated-scope module can invoke or expose a destructive fs function while the mandatory I10 gate remains green. This directly falsifies the redesign's foundation that every value use is a name or member selection.
- suggestedFix: Hand D10 back to planning. Either inspect every executable expression whose type can resolve to a destructive symbol and separately define export acquisition semantics, or narrow the invariant to a source subset that the gate can actually prove; do not patch another short AST-kind list.
- status: open — new in cycle 4 discovery
- triage: pending author triage

### B17

- ID: B17
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + `asm-review-logic`
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/invariants/fsDeletionGate.ts:61`
- title: Structural and contextual typing launders destructive fs values
- evidence: `isDestructiveFsType()` recognizes only a type whose current symbol is named by `DESTRUCTIVE` and declared under `@types/node/fs`. TypeScript can retain the runtime function while replacing that symbol with a local structural declaration. A same-file probe passed `fs` to a parameter typed `{ rmSync(path: string): void }` and invoked `owner.rmSync(path)`; the argument identifier was fs-bearing rather than destructive, while the member's symbol belonged to the local structural property, so the gate found nothing. Constrained generics and structural function aliases produce the same result; intersections and generic constraints are not traversed by the union-only `constituents()` helper. Boundary inventory searched: exact aliases, unions, intersections, structural object/function types, contextual destructuring, generic constraints, optional generic members. Affected: structural/contextual and constrained-generic references. Verified safe: exact `typeof fs.*` aliases and direct union constituents.
- impact: Direct filesystem deletion can execute entirely inside an enumerated-scope module while the reference nodes exist and the gate exits successfully. Reference-shape completeness cannot compensate for TypeScript's structural loss of nominal origin.
- suggestedFix: Redesign around value-flow provenance from fs-bearing expressions through local calls/assignments, or explicitly narrow D10 to exact symbol-preserving types. Extending only `constituents()` will not cover contextual and structural substitution.
- status: open — new in cycle 4 discovery
- triage: pending author triage

### B18

- ID: B18
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + `asm-review-logic`
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/invariants/fsDeletionGate.ts:125`
- title: Erased provenance can be laundered through ordinary in-scope value flows
- evidence: `fromFs()` strips casts/parentheses, walks member owners, and follows only an identifier whose `valueDeclaration` is a `VariableDeclaration` with an initializer. In-memory Program probes produced zero findings for each direct deletion: `function run(api: any = fs.promises) { api.rm(path) }`, a class field `api: any = fs.promises` followed by `this.api.rm(path)`, `function api(): any { return fs.promises }` followed by `api().rm(path)`, `let api: any; api = fs.promises; api.rm(path)`, and an erased import/re-export used as `api.rm(path)`. A mixed conditional/logical initializer with an `any` branch also erases the initializer and stops the walk. `const fs = require("node:fs")` is another erased `CallExpression` origin the chain does not recognize. Boundary inventory searched: direct cast chain, const initializer, parameter default, property initializer, function return, post-declaration assignment, conditional/logical initializer, object/array container, callback/factory result, import/re-export, CommonJS require, multiple aliases. Affected: every listed form except direct cast and simple const initializer. Verified safe: `(fs.promises as any).rm`, `const anyFs: any = fs.promises; anyFs.rm`, unrelated erased parameters, and unrelated erased member/index fixtures.
- impact: Common TypeScript forms can directly select and call an fs deletion member in the enforced source scope while the gate remains green. The new provenance mechanism is therefore not fail-closed at the boundary task 10_1 exists to protect.
- suggestedFix: Return the erased-provenance contract to planning and define which value-flow origins are proven. If the rule keeps provenance analysis, model initializer-bearing declarations and reaching assignments/call results explicitly, with fixtures for every accepted boundary; otherwise narrow the claim instead of treating one initializer hop as general provenance.
- status: open — new in cycle 4 discovery
- triage: pending author triage

### W8

- ID: W8
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair + `asm-review-logic`
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/invariants/fsDeletionGate.ts:150`
- title: Type-only and binding nodes are reported as executable references
- evidence: The traversal tests every `Identifier` without checking that it is an expression/value reference. In-memory probes containing only `import type { rm }`, `type Remove = typeof rm`, an ambient declaration, an unused parameter annotation, or an interface property typed `typeof fs.promises.rm` all produced findings despite having no runtime acquisition or call. The changed `flag-nested-assignment.ts` also declares `let wipe: typeof fs.promises.rm` at line 3, so its filename assertion can be satisfied by the type annotation even if executable nested assignment/use detection regresses. Boundary inventory searched: value references, declaration names, TypeQuery, type-only imports, ambient declarations, parameter/property signatures. Affected: all type/declaration-only forms. Verified safe: unrelated runtime identifiers and member accesses.
- impact: Harmless type declarations can fail the mandatory gate, and at least one `flag-` fixture can claim its runtime spelling is visible based on non-executable syntax instead.
- suggestedFix: Restrict the typed branch to executable value expressions and exclude type-only/ambient/declaration-name positions. Then make the nested-assignment fixture's success depend on its executable assignment/reference rather than its annotation.
- status: open — new in cycle 4 discovery
- triage: pending author triage

### W9

- ID: W9
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair + `asm-review-logic`
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/invariants/fsDeletionGate.ts:141`
- title: Declaration-time provenance revives W7 after reassignment
- evidence: The walker treats a variable initializer as permanent provenance and ignores later writes. `let api: any = fs.promises; api = cache; api.rm(key)` is reported as filesystem deletion even though the selected runtime member is the unrelated cache API. The recursive call at line 144 also follows arbitrary chains of variable initializers rather than the caller-described exactly one alias hop, so stale declaration provenance can be inherited through multiple aliases.
- impact: Valid mutable erased APIs in an in-scope module can fail the project gate, reintroducing W7's over-rejection direction.
- suggestedFix: Do not infer current-value provenance from a mutable declaration initializer without modeling reaching writes. At minimum restrict initializer provenance to immutable bindings and enforce the designed hop bound; add pass fixtures for direct and multi-hop reassignment.
- status: open — new in cycle 4 discovery; same false-positive impact direction as W7 through the new provenance mechanism
- triage: pending author triage

### S10

- ID: S10
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: `asm-review-contracts`
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/invariants/fsDeletionGate.ts:124`
- title: File-wide cycle state suppresses later diagnostics
- evidence: `seen` is allocated once per `scan()` and shared by independent `fromFs()` queries. For `const anyFs: any = fs.promises; anyFs.rm(a); anyFs.rmSync(b)`, the first query marks the declaration initializer and the second returns false at the same node, so only the first reference is reported. The file still fails because the first hit remains, so this does not create a green bypass by itself.
- impact: Diagnostic output is order-dependent and omits later destructive references through the same erased alias, making remediation inventories incomplete.
- suggestedFix: Use a fresh recursion-stack set for each top-level provenance query rather than file-wide state.
- status: open — new in cycle 4 discovery
- triage: pending author triage

## Prior finding adjudication

- B15's exact round-7 nested-assignment fixture now produces a gate hit under the redesigned reference rule, so the prior binding-enumeration mechanism is not carried as persistence. B16-B18 are new defects in the replacement mechanism.
- W7's exact unrelated `cache.rm` and `cache[key]` boundaries now pass via the two checked-in fixtures. W9 is a new false-positive mechanism caused by stale declaration provenance after reassignment.
- No audit-backlog or user-granted accepted-risk entries carry forward.

## Specialist adjudication

- The logic specialists' reference-closure, structural/contextual typing, erased-origin, reassignment, and type-only evidence is accepted and merged with the chair's independent in-memory probes.
- The contracts specialist's claim that any non-destructive member selected from an fs-derived erased owner is a BLOCK is rejected: task 10_1's approved Boundary and the caller's scope-lock explicitly judge an erased selection by its fs-bearing chain rather than by the member name. That fail-closed tradeoff is deliberate.
- The contracts specialist's file-wide `seen` finding is reduced to SUGGEST because a prior hit already makes the gate fail; it suppresses diagnostics but does not independently permit a destructive file to pass.
- The redesign's foundation has failed in discovery through expression forms, structural typing, and erased value flow. Another patch-level syntax expansion would repeat the mechanism that triggered the round-7 planning handback.

---

## Triage — author, round 9

| ID | Status | Rationale |
|---|---|---|
| B16 | **accepted** | The reference set is not closed. `getRm()(path)` puts the fs function type on a CallExpression, which is neither an identifier nor a member access. My round-8 claim that "a value is used by naming it or selecting a member of something" was wrong — a value is also produced by a call. |
| B17 | **accepted** | Decisive, and not an implementation gap. TypeScript's type identity is STRUCTURAL: `fs` passed to a parameter typed `{ rmSync(path: string): void }` resolves the member to the local declaration, not to `@types/node/fs`. No type-identity rule can be sound against this, because the language does not preserve the origin. |
| B18 | **accepted** | Provenance-following is unbounded. Parameter defaults, class fields, returns, post-declaration assignment, re-exports and `require()` all launder an erased value past `fromFs`. |
| W8 | **accepted, partly rebutted on its second clause** | The over-rejection is real: type-only imports and `typeof fs.rm` are flagged, and scanning should be restricted to executable positions. The second clause — that a fixture's visibility can be falsely asserted through its type annotation — does NOT hold for the current fixtures. Measured: with every node under a TypeNode/TypeQuery/ImportType ancestor skipped, all **12** `flag-` fixtures are still caught by executable syntax. The reported count was not inflated. |
| W9 | **accepted** | `let api: any = fs.promises; api = cache; api.rm(key)` is reported from a stale initializer, and the hop is recursive rather than the single bounded hop D10 describes. Both the false positive and the contradiction with the design's own wording are real. |
| S10 | **accepted** | One `seen` set shared across all provenance queries makes the diagnostic inventory order-dependent. |

### Thrash stop — declared, second time on this invariant

Trigger: the same invariant has now survived **three** fix attempts — tasks 8_2, 9_1 and 10_1 —
across four mechanisms:

| Mechanism | Defeated by |
|---|---|
| regex over text | renamed and named imports |
| AST binding walk | assigned member, element access, nested destructuring |
| checker over acquisition SHAPES | quoted key, destructuring assignment, `as any`, nested assignment |
| checker over reference TYPES | call expressions, **structural typing**, unbounded provenance |

### What B17 actually settles

The first three failures were mine — incomplete enumerations I could have done better. The fourth
is not the same kind. Structural typing means the language itself does not preserve where a
function came from, so *no* type-based rule can decide "this value is `fs.rm`". Soundness here needs
reaching-definitions value-flow analysis, which is a static analyzer, not a verification task.

Every round has widened the rule to chase soundness, and the widening has produced its own defects
in the opposite direction — W7, and now W9 — so the rule is converging on a bad static analyzer
while its actual product value is catching a contributor who types `fs.rmSync(dir)` in worktree code.

The defect is therefore not the mechanism. It is the CLAIM. D10 has been asserting a property no
cheap static rule can hold, and each round has been an attempt to make the implementation live up
to an unachievable sentence.

### Not risk-accepted

Recorded as author-triaged, not risk-accepted: only the user grants that status, and it has not
been granted.

### Standing fact, unchanged since round 6

There is no filesystem-deletion defect in production. All 29 in-scope modules are clean under every
mechanism tried. Every blocker in this round concerns whether the guard can be walked around, not
whether anything walked around it.
