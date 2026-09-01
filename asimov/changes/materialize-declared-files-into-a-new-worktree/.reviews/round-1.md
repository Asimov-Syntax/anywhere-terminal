# Review round 1 — materialize-declared-files-into-a-new-worktree

- Date: 2026-09-01
- Cycle: 1
- Mode: discovery
- Scope: range `50e6428d..HEAD` (9 commits), change context from this change's artifacts
- Head: `1c024d6c0827cfdd61b818f1abb4d1d801971b4d` (tree clean apart from `analytics.json`)
- Reviewable lines: ~719 (src, excluding tests and change artifacts); test lines ~836 reviewed inline
- Agents spawned: 6 (data-security ×1, logic ×2, contracts ×1, performance ×1, reuse ×1) + chair self-review and full-flow trace
- Agents skipped: frontend (no React/rendering surface in the diff; the webview half of this flow does not exist — see F005)
- Verify gate evidence: `asm change verify-status` — 1_1…1_5 all exit 0; biome at the pre-existing 3/14/1 baseline; I10 fs-deletion gate ok. Not re-run by review.
- Verdict: **REJECT**
- Counts: 4 BLOCK / 8 WARN / 4 SUGGEST
- Split over gating blockers: 4 feature / 0 machinery

Deliberate decisions recorded in design.md and NOT reported: the intermediate-component `lstat`→`open`
window (D5 residual, unclosable in Node); no unwinding of a partial directory copy (D9); `refused`
rather than `skipped` for a lockfile (D8, contradicts worktree-apply.md § 2.1 on purpose); the
re-present-a-fresh-model half of rpc § 2.4 (D3 follow-up); D6's destination-side rule not applying to
a link entry's own target (D7).

---

## F001 — A stale offer id refuses the create in total silence

- Severity: BLOCK · Confidence: HIGH · Priority: P1 · Class: feature
- Agent: chair + asm-review-contracts + asm-review-logic (three-way corroboration)
- File: `src/providers/WorktreeHost.ts:1884-1888`
- Status: accepted · Triage:

Accepted. D3 says the refusal is stated "on the existing `worktreeMutationResult` error arm" and
the code returns bare — the implementation contradicts the accepted design, so implementing what
D3 already says is remediation and needs no artifact change. The triage note about my own test is
correct and is the more useful half: `expect(creates(calls)).toEqual([])` witnesses only the
safety clause and is structurally blind to the reporting clause, so the fix ships with an
assertion on the posted message, not just on the absent create.

**Evidence.** The `worktreeCreate` case looks the selection's `offerId` up in the surface-scoped
store and, when it is absent, executes a bare `return`. Nothing is posted: no
`worktreeMutationResult`, no error, no re-enable signal. Accepted design D3 states the opposite in
so many words — *"the host refuses the create with a stated reason, on the existing
`worktreeMutationResult` error arm."* The `{ kind: "error", message }` arm is an established pattern
in this subsystem (`worktreeMutationService.ts:391,543,586,643,657,676,687,693`).

The new test (`WorktreeHost.actions.test.ts`, "creates NOTHING against an offer the store no longer
holds") asserts only `expect(creates(calls)).toEqual([])`. It witnesses the safety half and is blind
to the reporting half, so the gate passes over the divergence.

**Impact.** A user whose offer was evicted presses Create and the dialog goes silent — no worktree,
no message, no stated reason. D3's own note says the interim recovery is "reopening the dialog",
which the user has no way to know is required.

**Fix.** Post a `worktreeMutationResult` with `verb: "create"`, `repoId: msg.repoId` and
`result: { kind: "error", message: … }` to `surface` before returning, and extend the test to assert
that post.

---

## F002 — The walk's budget is observed only between nodes, so no single operation is bounded

- Severity: BLOCK · Confidence: HIGH · Priority: P1 · Class: feature
- Agent: chair + asm-review-logic + asm-review-performance
- File: `src/worktree/provisioning/applyEntries.ts:136-166, 220-223, 257`
- Status: accepted · Triage:

Accepted at all three boundaries the finding lists, and the invariant is per-OPERATION, not
per-node: a budget that is only sampled between nodes bounds the count of operations and not the
work of any one of them. (1) `spend()` must charge the file's size — already known from the
`fstat` D5 makes the walk do — BEFORE the copy, and refuse a single file that would exceed the
remaining budget. (2) the deadline must be readable synchronously rather than through a floating
`.then`, so an already-expired budget stops node 1; the probe confirming node 1 proceeds is
accepted as given. (3) `readdir` is charged for the listing it materializes. Acceptance is an
invariant-level test per boundary, not a rerun of the existing 50-file fixture, which is exactly
why all three were unwitnessed. Remediation: D10 already claims the bound, so this is the code
failing to be D10 rather than D10 changing.

**Invariant.** D10: *"Every walk stops at a node count, a byte cap, or a wall-clock deadline,
whichever comes first."* Obligation-ledger row recorded `supported`. The mechanism that falsifies it
is single: **the budget is polled at node boundaries only, and a node's own cost is added after its
check**, so nothing inside one awaited operation is bounded.

**Boundary categories searched:** node count, byte volume, wall clock, directory fanout, recursion
depth, `details` accumulation, aggregate across entries.

**Boundaries affected (same mechanism, one finding):**

1. *Bytes.* `spend()` tests `bytes > budget.maxBytes` at the top of `walk`, and
   `bytes += await deps.copyFileNoFollow(...)` runs afterwards. A single regular file of any size is
   streamed in full and reported `copied`. For a one-node (file) entry — the `.env` case the feature
   exists for, and the "data fixture" the proposal names — the 512 MiB cap never applies at all.
2. *Wall clock.* `expired` is set by a floating `deadline.elapsed.then(...)` and read only in
   `spend()`. `pipeline()` carries no `AbortSignal`, so a slow or stalled copy runs past 60 s
   unbounded. Worse, an **already-expired** deadline does not stop node 1: the only `await` before
   the watch is registered is `admitEntry`, and `walk()` is then invoked synchronously, so the
   `.then` microtask has not run when the first `spend()` reads `expired`. Verified with a probe
   replicating the ordering — node 1 sees `expired=false`, and the copy then proceeds.
3. *Directory fanout.* `await deps.readdir(source)` at `:257` materializes an entire directory
   listing before any `spend()` sees a child. Memory and elapsed time for that one call are outside
   every budget.

**Verified safe:** recursion depth (each level awaits `lstat` before recursing, so the synchronous
stack unwinds between levels; a `RangeError` would in any case surface as a `failed` step);
`details` row *count* (bounded by `maxNodes` per entry — but see F009 for its wire size).

**Test coverage gap.** Every budget test in `applyEntries.test.ts:211-254` uses the same 50-file
`wide()` directory. No test exercises a single-file entry, so all three boundaries above are
unwitnessed.

**Impact.** `applyEntry` runs inside the per-repository mutation queue, ahead of the create result,
`afterCreate`, and any queued removal. An entry that crosses a budget mid-operation holds that queue
for as long as the operation takes.

**Fix.** Admit a regular file only when `bytes + node.size <= maxBytes`; drive the copy from an
`AbortController` wired to the deadline and pass its signal to `pipeline`; check `expired` after the
watch is armed (or read the deadline synchronously rather than via a promise); enumerate directories
incrementally (`opendir`) with a budget check between reads.

---

## F003 — Production deps omit `realpath`, so D6's symlink check runs on lexical dirnames — and a committed symlink escapes the worktree

- Severity: BLOCK · Confidence: HIGH · Priority: P1 · Class: feature
- Agent: asm-review-data-security + chair (independently derived, chair reproduced on disk)
- File: `src/worktree/provisioning/applyEntries.ts:147-153` (helper), `:184-193` (use), `:335-340`
  (`nodeApplyFsDeps`); `src/extension.ts:584`
- Status: accepted · Triage:

Accepted, and it is the same failure mode twice: a witness that proves the fake.
`applyEntries.fake.ts:73` supplies `realpath`, so every test in the suite ran the corrected path
while `extension.ts` handed production the object that does not. The `?? p` fallback is what let
the omission read as a design choice rather than a hole. Verified independently before triage.
Two fixes, because either alone leaves the trap armed: bind `realpath` on `nodeApplyFsDeps`, AND
make the helper fall back to `fs.realpath` — the way `resolvedPathBoundary.ts:63,99` already does —
so an omitted dep degrades to CORRECT resolution rather than to lexical. The invariant-level
witness is the one this suite structurally could not have: a test that exercises
`nodeApplyFsDeps` itself against a real temp tree. Remediation, not a handback — D6 already says
"resolved from real directories"; the code failed to be what D6 says, and no `D#` moves.

**Evidence.** The local helper is `(await deps.realpath?.(p)) ?? p`. `nodeApplyFsDeps` is typed
`ApplyFsDeps` and declares no `realpath`; `extension.ts` passes exactly that object. In production
the helper therefore returns the *spelled* dirname, and `sourceDir` / `destinationDir` at `:184-187`
are lexical. `applyEntries.fake.ts:73` supplies `realpath`, so every test runs the fixed path and
production runs the unfixed one.

This is the defect design.md's own build notes record as found and repaired — *"`copyLink` resolved a
symlink's target from the LEXICAL dirname … Both sides now resolve from real directories"* — present
again because the fix lives in an optional dep the production binding does not provide. Note what
hides it: `isResolvedPathInsideRoot(…, deps)` still falls back to `fs.realpath` internally, so the
containment predicate looks correct; only the base directory handed to `path.resolve` is wrong.

**Worked escape, reproduced on disk by the chair.** Committed in the repo: `pkg/deep/alias ->
../../shared` and `shared/tree/link -> ../../../outside.txt`. Provider file declares entry
`pkg/deep/alias/tree`, admitted because it realpath-resolves to `<main>/shared/tree`, inside the main
checkout. Walking it reaches the child `link`:

```
target             ../../../outside.txt
lexical srcdir     <main>/pkg/deep/alias/tree -> <main>/pkg/outside.txt   inside main? true   <- check passes
real    srcdir     <main>/shared/tree         -> /outside.txt             inside main? false  <- correct answer
lexical dstdir     <wt>/pkg/deep/alias/tree   -> <wt>/pkg/outside.txt     inside wt?   true   <- check passes
link LANDED at     <wt>/shared/tree/link  (kernel resolved the intermediate `alias`)
it resolves to     /outside.txt                                           inside wt?   false
```

Both halves of D6's two-sided check pass, and the symlink that lands resolves outside the worktree.
With real dirnames the source-side check answers `false` and the entry is refused — which is exactly
what D6 exists to do.

**Impact.** Falsifies the ledger row *"A symlinked component cannot smuggle a read or a write out —
supported"*. A pull-request author can have provisioning materialize an attacker-chosen symlink,
pointing at an arbitrary absolute path, inside a freshly created worktree — into which `afterCreate`
then launches an agent or a terminal. Anything that later writes through that link writes outside the
worktree.

**Fix.** Give `nodeApplyFsDeps` `realpath: (p) => fs.realpath(p)` and widen its type to
`ApplyFsDeps & ResolvedPathInsideDeps`; make `realpath` a **required** member of `ApplyFsDeps` so a
production binding cannot omit it again, and drop the `?? p` fallback so the omission cannot degrade
silently. Add a test whose fake supplies no `realpath` and which must then fail.

---

## F004 — A backslash spelling defeats the lockfile and `node_modules` refusals on Windows

- Severity: BLOCK · Confidence: HIGH · Priority: P2 · Class: feature
- Agent: asm-review-data-security + chair
- File: `src/worktree/provisioning/entryGate.ts:108`
- Status: accepted · Triage:

Accepted. `path.posix.basename` is the wrong instrument for a spelling that `path.resolve` will
later split on Windows, and the provider file is attacker-influenced, so the two Acceptance
clauses it bypasses are exactly the ones the security-privacy flag exists for. Fixed at the gate
by refusing any `\` in `entry.path` outright rather than by normalizing it — a refusal cannot be
half-right about which separator a platform honours, and WT-012.2 refuses rather than clamps by
standing rule.

**Evidence.** `refusedMaterial` computes `const base = path.posix.basename(entry.path)`.
`path.posix` splits on `/` only, so `entry.path = "tools\\pnpm-lock.yaml"` yields the base
`tools\pnpm-lock.yaml`, which matches neither `LOCKFILES` nor `"node_modules"`. `isAbsoluteSpelling`
does not reject it (`isWindowsAbsPath` wants `X:[\\/]` or a UNC prefix). Admission then uses
`path.resolve` at `:137-138`, which on Windows is `path.win32.resolve` and *does* treat `\` as a
separator — so the entry resolves to `C:\main\tools\pnpm-lock.yaml`, passes both containment checks,
and is copied. `x\node_modules` with `mode: "link"` walks past the `node_modules` rule the same way.

Windows is a supported platform for this subsystem — this module branches on it
(`isWindowsAbsPath`, the `NO_SYMLINK` EPERM set, `constants.O_NOFOLLOW ?? 0`), and PLAN carries a
Windows spike (WT-012.14). The provider file is attacker-influenced, so the spelling is chosen.

**Impact.** Two Acceptance clauses of WT-012.2 — *"a lockfile is refused with its reason whether it
was named for copy or for link; a `node_modules` link is refused with its reason"* — are bypassable
by spelling on a supported platform. Main's lockfile becomes the branch's, and a shared
`node_modules` link is created, which this module's own reason string says "corrupts concurrent
installs".

**Fix.** Refuse any `entry.path` containing `\` at the gate (a repo-relative POSIX path has no legal
backslash), or match the rule on `entry.path.split(/[\\/]/).pop()`. Refusing is the better fit for
this module's stated posture.

---

## F005 — The flow is inert end to end: no producer sends `provision`, no consumer reads `worktreeProvisionResult`

- Severity: WARN · Confidence: HIGH · Priority: P1 · Class: feature
- Agent: chair (full-flow trace; no specialist held both ends)
- File: `src/webview/worktree/WorktreeController.ts:646-673`;
  `src/webview/messaging/MessageRouter.ts:292, 328-331`
- Status: accepted · Triage:

Accepted, and NOT scope-cut. Checked before triaging: the dialog already holds the selection —
`WorktreeCreateDialog.ts:828` keeps `checkedByOffer: Map<offerId, Set<itemId>>` and re-ticks it
across offers at `:870-880`. What is missing is only the last hop (surfacing that set onto the
draft and spreading `provision` into the `worktreeCreate` post) and one `MessageRouter` case. So
the option that satisfies the spec delta is small, and the option that would need YOUR decision —
cutting the ADDED requirement — is the one I would have had to ask about. Landing the two halves
adds tasks inside the accepted contract; the wire types for both already exist from task 1_1.
The `TerminalViewProvider.ts:1021` precedent is the right one to cite and is why this is treated
as gating-in-practice despite its WARN severity.

**Evidence.** The webview's `worktreeCreate` post carries `repoId, opening, path, mode, disposition,
afterCreate` and no `provision` field — the dialog holds no per-entry selection state
(`frozenCreateOffer` carries only an `offerId`, and only onto the agent launch variant). At the other
end, `MessageRouter` has a case for `worktreeProvisionOffer` but none for `worktreeProvisionResult`;
its `default` arm at `:328` is `// Silently ignore unknown message types`. There is no
router-completeness test. `check-types` is clean because the union grew a member the switch is not
required to handle exhaustively.

So the host branch added at `WorktreeHost.ts:1884` is unreachable from the shipped UI, and the
message the host posts at `:3231` is dropped.

**Impact.** The accepted spec delta's ADDED requirement *"The material a worktree was promised is
actually put there"*, and its scenarios ("each of those files exists in the new worktree, and each is
reported as copied"; "the create's success is reported first, and the per-entry outcomes follow it"),
cannot be exercised. `asm change apply` would write those requirements into the project spec as
satisfied. This repo has a recorded precedent for exactly this class — the comment at
`TerminalViewProvider.ts:1021-1023`: *"a declared, posted, handled type reached neither provider and
its feature shipped inert"*.

**Fix.** Either land the two webview halves (selection on the create post; a router case and a
consumer for `worktreeProvisionResult`) before archive, or scope the spec delta down to what this
change actually delivers and carry the end-to-end requirement on the task that adds the dialog
selection. A router-completeness test over `ExtensionToWebViewMessage["type"]` would have caught the
consumer half mechanically.

---

## F006 — Malformed inbound `provision` throws out of the message handler, uncaught

- Severity: WARN · Confidence: HIGH · Priority: P2 · Class: feature
- Agent: asm-review-contracts + chair (chair verified the try/catch boundary)
- File: `src/providers/WorktreeHost.ts:1884-1890`; `src/providers/TerminalViewProvider.ts:1024-1032`
- Status: accepted · Triage:

Accepted. The code comment at that site already cites worktree-rpc.md § 4's "check every inbound
message" rule and then exempts the one field added last; `provision` gets an `isKnownProvision`
guard like its three neighbours. The containment analysis is the load-bearing part and I verified
it: the worktree dispatch at `TerminalViewProvider.ts:1024-1031` returns before the `try {` at
`:1033`, so this genuinely escapes rather than failing closed.

**Evidence.** The handler's own comment says *"worktree-rpc.md § 4 asks for the check on every
inbound message"*, and `mode` / `afterCreate` / `disposition` are each guarded by an `isKnown*`
predicate before use. `msg.provision` gets only `!== undefined`, then `msg.provision.offerId` and
`new Set(msg.provision.itemIds)` are dereferenced. `provision: null` passes the guard and throws on
`.offerId`; `itemIds` as a non-iterable object throws `TypeError: object is not iterable`.

The chair verified the containment boundary: in `TerminalViewProvider.ts` the worktree dispatch at
`:1024-1031` runs and returns **before** the `try {` at `:1033`. A throw here escapes into VS Code's
`onDidReceiveMessage` callback rather than failing closed with a `return`, unlike every neighbouring
field.

**Fix.** Guard the shape before use — object-ness plus `Array.isArray(msg.provision.itemIds)` —
consistent with the `isKnown*` predicates beside it.

---

## F007 — Per-entry budgets multiply; nothing bounds the apply as a whole

- Severity: WARN · Confidence: HIGH · Priority: P2 · Class: feature
- Agent: asm-review-performance + asm-review-logic
- File: `src/extension.ts:578-586`
- Status: accepted · Triage:

Accepted. One budget for the whole apply, created once in `extension.ts` and threaded through the
loop, is both the fix and the simpler code — the per-iteration `afterDelay(60_000)` was an
oversight in the binding, not a decision. D10's bound is stated over the apply, so multiplying it
by the entry count falsified it arithmetically.

**Evidence.** `{ maxNodes: 20_000, maxBytes: 512 * 1024 * 1024, deadline: afterDelay(60_000) }` is
constructed inside the `for (const entry of ordered)` loop, so each entry gets a fresh full budget,
and entries are awaited serially. Growth axis: **entries per create**, capped by the provider model's
~200-row structural cap. Worst case for one create: ~4M node attempts, ~101 GiB copied, ~199 minutes
of deadline allowance — all inside the per-repository mutation queue.

**Fix.** Construct one apply-wide budget outside the loop (or add an aggregate cap on top of the
per-entry ones) so the bound the design argues for applies to the operation the queue is holding.

---

## F008 — `details` has no wire-size bound

- Severity: WARN · Confidence: MEDIUM · Priority: P3 · Class: feature
- Agent: asm-review-performance + chair
- File: `src/worktree/provisioning/applyEntries.ts:260-262`; `src/types/messages.ts` (`ProvisionStepResult.details`)
- Status: accepted · Triage:

Accepted. `details` is documented as bounded and display-ready and only the first is true; capped
with an explicit truncation row so a caller can tell a short list from a trimmed one.

**Evidence.** One `details` row is pushed per non-`written` child of every directory walked, and all
of them ride one `postMessage`. The type documents `details` as *"Bounded and display-ready"*; the
only enforced bound is indirect — `maxNodes` per entry (≈19,999 rows), multiplied by the entry count
(F007). Growth axis: skipped/refused descendants per selected directory. No row cap, no byte cap, no
truncation summary.

**Fix.** Cap detail rows per entry (and per apply) with an explicit "and N more" summary row.

---

## F009 — A selection with no `applyProvision` binding is indistinguishable from no selection

- Severity: WARN · Confidence: HIGH · Priority: P3 · Class: feature
- Agent: asm-review-logic
- File: `src/worktree/worktreeMutationService.ts:936`
- Status: accepted · Triage:

Accepted. A silently-dropped selection is the worst of the three possible outcomes because it is
byte-identical to the honest one. Reported as a step outcome rather than made unrepresentable in
the type: `applyProvision` is optional so that the service stays constructible without the
filesystem, and that is worth keeping.

**Evidence.** The guard is
`request.provision !== undefined && request.provision.length > 0 && deps.applyProvision !== undefined`.
When entries were selected but the host wired no `applyProvision`, `provisioned` stays `undefined`,
the create reports `ok` with no `provision` field, and the outcome is byte-identical to "the user
selected nothing".

**Impact.** A misconfigured or partially wired host silently drops every selected entry. Given F005,
this arm is currently the only way the feature can be exercised at all in an embedding that supplies
its own deps.

**Fix.** Synthesize one `failed` step per selected entry when the binding is absent, or make
`applyProvision` required for any caller that can carry `provision`.

---

## F010 — Duplicate `provision` spread in the create outcome literal

- Severity: WARN · Confidence: HIGH · Priority: P3 · Class: feature
- Agent: asm-review-contracts + asm-review-reuse + chair
- File: `src/worktree/worktreeMutationService.ts:958-959`
- Status: accepted · Triage:

Accepted, and the second sentence is the finding: check-types, 6311 tests and the biome baseline
all passed over a literally duplicated line. Noted rather than defended.

**Evidence.** The identical expression appears on two consecutive lines:

```ts
...(provisioned === undefined ? {} : { provision: { path: check.path, steps: provisioned } }),
...(provisioned === undefined ? {} : { provision: { path: check.path, steps: provisioned } }),
```

Harmless at runtime; dead, copy-pasted code. Worth recording beyond the nit: `check-types`, the full
6311-test suite and the biome baseline all passed over it, so this class is invisible to the gate.

**Fix.** Delete one line.

---

## F011 — `messageOf` is now a third copy, and it has already drifted

- Severity: WARN · Confidence: HIGH · Priority: P3 · Class: feature
- Agent: asm-review-reuse
- File: `src/worktree/provisioning/applyEntries.ts:104-105`; existing copies at
  `src/worktree/clearDebris.ts:222-224` and `src/worktree/worktreeMutationService.ts:1051-1053`
- Status: accepted · Triage:

Accepted. Third copy, and it has already drifted — `"unknown error"` versus `String(error)` — in a
string that reaches the user on the wire. One shared helper, per the repo's reuse-first rule;
extracting is the fix, not adding a fourth.

**Evidence.** Three local error-message helpers in one subsystem, and the new one already differs:
it answers `"unknown error"` for a nullish or unsupported value where both existing copies use
`String(error)`. Error text from this module reaches the user on the wire, so the drift is
observable.

**Fix.** Extract one helper beside `deadline.ts` and import it in all three, choosing the fallback
deliberately.

---

## F012 — An entry whose destination parent does not exist fails with a raw errno

- Severity: SUGGEST · Confidence: HIGH · Priority: P4 · Class: feature
- Agent: chair
- File: `src/worktree/provisioning/applyEntries.ts:220-230`, `:276-291`
- Status: accepted · Triage:

Accepted and promoted above its severity: a declared entry under a gitignored subdirectory is an
ORDINARY case, not an edge one — the worktree has no `.cache/` until something makes it — and it
currently fails with a raw errno the user cannot act on. Recursive destination-parent creation,
each component created no-follow and containment-checked exactly as the walk's own descent is, so
this does not become a second path into the tree with weaker rules than D5's.

**Evidence.** `mkdir` is non-recursive and nothing creates a file entry's intermediate destination
directories. A declared entry like `config/local/.env`, whose `config/local` is itself untracked and
so absent from the fresh worktree, reaches `copyFileNoFollow`, gets `ENOENT` from the destination
open, and is reported `failed` with the raw errno string. A `link` entry fails the same way.

**Impact.** A legitimate declaration is unmaterializable, and the reason the user reads is an errno
rather than a rule. This is not the same class as D9's accepted partial copy.

**Fix.** Either create missing destination parents component-by-component under the same
EEXIST→`lstat`→refuse-symlink discipline the walk already uses, or refuse the entry at the gate with
a reason that names the missing parent.

---

## F013 — `shown()` mixes platform separators into a POSIX join

- Severity: SUGGEST · Confidence: HIGH · Priority: P5 · Class: feature
- Agent: chair
- File: `src/worktree/provisioning/applyEntries.ts:169-170`
- Status: accepted · Triage:

Accepted. `path.relative` answers in the platform's separator and `path.posix.join` does not
re-split it, so the display path is wrong on Windows in the one place the user reads to find out
what was refused.

**Evidence.** `path.posix.join(entry.path, path.relative(entryDestination, absolute) || "")` —
`path.relative` is platform-aware and returns backslash-separated output on Windows, which
`path.posix.join` then treats as one component. `ProvisionStepResult.path` and `details[].path` are
documented as repo-relative POSIX for display.

**Fix.** Use `path.relative(...).split(path.sep).join("/")` before the posix join.

---

## F014 — Full `.sort()` for what is a two-group partition

- Severity: SUGGEST · Confidence: HIGH · Priority: P5 · Class: feature
- Agent: asm-review-logic
- File: `src/extension.ts:577`
- Status: rejected · Triage:

Rejected. `.sort()` with a boolean-difference comparator is the clearer statement of "links after
copies", the entry count is bounded by the provider cap in the low hundreds, and a hand-rolled
partition would be more code for no observable difference. Recorded as a preference, not a
defect — no spec, design or Acceptance clause is engaged either way.

**Evidence.** `[...entries].sort((a, b) => Number(a.mode === "link") - Number(b.mode === "link"))`
copies and sorts to express "all copies before all links". Correct — `Array.prototype.sort` is
stable per ES2019, so provider order is preserved within each group — but a single-pass partition and
concat says the same thing without the copy.

**Fix.** Build two arrays in one pass and concatenate.

---

## F015 — `worktreeId` on the provision result is not proven to match the id the tree will assign

- Severity: SUGGEST · Confidence: MEDIUM · Priority: P4 · Class: feature
- Agent: asm-review-contracts
- File: `src/extension.ts` (`provisionResult` mapping); `src/worktree/worktreeMutationService.ts:958`
- Status: accepted · Triage:

Accepted. The result message keys a webview lookup, so a `worktreeId` that is merely usually equal
to the id consumers hold is a latent mismatch rather than a style point — the repo already learned
this at round-1 B5 of a sibling change. Normalized through the same helper the tree uses, so the
two cannot diverge by construction.

**Evidence.** `worktreeId` is populated from `check.path`, the raw validated create path, while
`WorktreeInfo.id` (`src/worktree/types.ts:9-10`) is documented as a *normalized* absolute path and is
the key every other `worktreeId` consumer matches against. Whether `check.path` and the id the
subsequent tree rebuild stamps are byte-identical was not established.

**Fix.** Run `check.path` through the same normalizer the tree build uses, or assert equality in a
test. (Currently unobservable — see F005.)

---

## Notes for the next round

- F002 is an invariant finding. A further boundary that violates *"the budget is polled at node
  boundaries only"* through that same mechanism appends here rather than opening a new ID.
- No `audit-backlog`, `external-blocker` or `risk-accepted` entries exist for this change.
- The webview lens (`asm-review-frontend`) was skipped deliberately; if F005 is closed by landing the
  dialog halves, the next discovery round must include it.
