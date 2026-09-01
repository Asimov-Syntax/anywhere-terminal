# Review round 2 — materialize-declared-files-into-a-new-worktree

- Date: 2026-09-01
- Cycle: 1
- Mode: verification
- Scope: range `d7766fae~1..HEAD` (the round-1 remediation), change context from this change's artifacts
- Head: `4bd18c8b` (tree clean apart from `analytics.json`)
- Reviewable lines: ~503 src (+~510 test) in range
- Agents spawned: 4 — data-security (the walk), logic (budget/deadline/async), contracts (host + service arms), frontend (the new webview surface, unreviewed in round 1)
- Agents skipped: performance, reuse — round 1's findings in those lenses (F007, F008, F011) are inside the contracts/logic cone this round and were verified there
- Verify gate evidence: `asm change verify-status` exit 0 for all 8 tasks; check-types clean, 6350/6350 tests, I10 fs-deletion gate ok, biome at the 3/14/1 baseline. Not re-run by review.
- Verdict: **BLOCK**
- Counts: 1 BLOCK / 6 WARN / 5 SUGGEST

## Scope lock — checked, not tripped

`tasks.md` changed inside the range, which is the signal that most often supersedes a cycle. It does
not here:

- The three fix-task ENTRIES (2_1–2_3) were committed at `c6c963e1`, **before** the reviewed range
  (`d7766fae~1` = `a1496f56`), as an artifact-only commit. That is the discipline that keeps a fix
  task from tripping the monotonicity guard, and it was followed.
- In-range `tasks.md` edits are (a) completion metadata — explicitly not scope — and (b) path leases
  added to 2_2 step 5/6 and 2_3 steps 4–6. Those name where already-accepted remediation lands
  (`errorMessage.ts`, `worktreeMessageHandlers.ts`, `worktreeViewTypes.ts`, `WorktreeView.ts`); both
  Boundaries are unchanged ("no new error arm", "no new wire type").
- `design.md`, `specs/worktree-panel/spec.md`, `proposal.md`, `workflow.md` are byte-identical in
  range. No new D#, no new contract, no new invariant owner — `ensureParents` is a second write path
  but owns no durable state, lock, lifecycle or external contract, and lives under the same budget
  and containment discipline as the walk.

## Round-1 disposition summary

| ID | Round-1 severity | This round | Witness |
|---|---|---|---|
| F001 | BLOCK | **closed** | stale offer now posts `worktreeMutationResult` `{kind:"error"}`; test asserts the post, fails on revert |
| F002 | BLOCK | **partially closed** → WARN, see below | bytes and already-expired-deadline boundaries closed (chair probe); in-flight operation and `readdir` fanout persist |
| F003 | BLOCK | **closed** | chair + data-security both reproduced against the production binding: escape refused, innocent sibling still copied |
| F004 | BLOCK | **REOPENS — gating** | new spellings admitted, see below |
| F005 | WARN | **closed** (fix carries a new defect, F017) | selection posts, message routes through the shared table |
| F006 | WARN | **closed** | `isKnownProvision` guards every dereference, shaped like its three neighbours |
| F007 | WARN | **partially closed**, persists | deadline is now apply-wide; node and byte counters are still per entry |
| F008 | WARN | **closed** (producer); consumer never existed, F018 | `MAX_DETAILS` 100 + counted truncation row |
| F009 | WARN | **closed** | a selection with no binding reports `failed` per entry |
| F010 | WARN | **closed** | duplicate spread removed |
| F011 | WARN | **closed** | one `errorMessage.ts`, three consumers, no local copy left |
| F012 | SUGGEST | **closed** in production; latent fragility as F019 | `ensureParents` creates missing parents |
| F013 | SUGGEST | **closed** | `.split(path.sep).join("/")` |
| F014 | SUGGEST | **rejected, stands** | reasoning accepted — a preference, no clause engaged |
| F015 | SUGGEST | **closed**; placement cost as F023 | `normalizeWorktreeId` bound to the tree's own call |
| A016 | BLOCK (author) | **closed** | chair probe: a 4096-byte copy completes and lands; handle paths enumerated |

---

## F004 — REOPENED: the material refusals are still bypassable by spelling

- Severity: BLOCK · Confidence: HIGH · Priority: P2 · Class: feature
- Agent: asm-review-data-security + chair (chair reproduced independently)
- File: `src/worktree/provisioning/entryGate.ts:107-116, 150-153`
- Status: accepted (reopened under its original ID) · Triage:

Accepted, and the triage that matters is why my round-1 fix was wrong rather than incomplete.
I fixed the SPELLING the finding quoted — a backslash — and left the instrument that made the
spelling work: a refusal matched on `path.posix.basename` while admission resolves with
`path.resolve`. Any spelling those two disagree about reopens it, and `pnpm-lock.yaml/.` is only
the next one. That is the "fixed at every listed boundary, acceptance is an invariant-level test"
rule, and I applied it to the example instead of the invariant.
The fix classifies on the RESOLVED destination's basename — the same string `path.resolve`
produced and the walk will actually write — so the two cannot disagree by construction, with the
lockfile set folded for case. Acceptance is per SPELLING, not per rule: every variant the chair
ran, plus the round-1 backslash cases, against both the lockfile and the `node_modules` rule.

**Why this is F004 and not a new ID.** The invariant is unchanged: *the refusal is matched on one
spelling of the path while admission resolves a different one.* Round 1's instance was `\`; the fix
added `hasBackslash` and left the instrument — `path.posix.basename(entry.path)` — disagreeing with
`path.resolve` on other inputs. Same causal mechanism, so it appends here rather than opening a new
finding.

**Evidence.** Chair ran the real `admitEntry` against real roots:

```
"pnpm-lock.yaml"       copy -> refused: a lockfile is never brought over …
"pnpm-lock.yaml/."     copy -> ADMITTED  dest=pnpm-lock.yaml
"pnpm-lock.yaml/././"  copy -> ADMITTED  dest=pnpm-lock.yaml
"node_modules"         link -> refused: node_modules is never linked …
"node_modules/."       link -> ADMITTED  dest=node_modules
"a/../node_modules"    link -> refused: node_modules is never linked …
"PNPM-LOCK.YAML"       copy -> ADMITTED  dest=PNPM-LOCK.YAML
```

`path.posix.basename("pnpm-lock.yaml/.")` is `"."`, which is in neither `LOCKFILES` nor the
`node_modules` rule, while `path.resolve` collapses the trailing segment and lands on the real file.
`a/../node_modules` is correctly refused, which is what makes the trailing-`.` case a spelling gap
rather than a general normalization gap. Data-security carried both variants end to end through
`nodeApplyFsDeps`: `pnpm-lock.yaml/.` reports `copied` with main's lockfile in the worktree, and
`node_modules/.` reports `linked` with `<wt>/node_modules` a symlink into the main checkout.

The case variant is the same instrument mismatch: `LOCKFILES` is compared case-sensitively, so
`PNPM-LOCK.YAML` is admitted, and on a case-insensitive filesystem (APFS default, NTFS) it reads and
writes the real lockfile.

**Impact.** Both WT-012.2 Acceptance clauses F004 was raised for are open again, against an
attacker-influenced provider file: main's lockfile lands in the branch worktree, and `node_modules`
becomes a shared tree — the concurrent-install corruption the module's own reason string names.

**Fix.** Classify on a normalized form rather than the raw spelling — derive the basename from the
already-computed resolved destination, or `path.posix.normalize` first — and compare lockfile names
case-insensitively. Consistent with the standing refuse-don't-clamp rule, the smallest change is to
refuse any `.`, `..` or empty segment outright beside `hasBackslash`, and fold case for the lockfile
set. A test per spelling, not per rule: the round-1 fix passed its own test and left the instrument
in place.

---

## F002 — Partially closed; the in-flight operation and the directory listing remain unbounded

- Severity: WARN (downgraded from BLOCK — evidence delta below) · Confidence: HIGH · Priority: P2 · Class: feature
- Agent: asm-review-logic + chair
- File: `src/worktree/provisioning/applyEntries.ts:315-355, 467`
- Status: accepted, persists at two boundaries · Triage:

Accepted, and fixed rather than recorded. The chair offered "name it as a residual in design.md
the way D5 names the `openat` window", and for the in-flight copy that would be documenting
something Node can express: `pipeline` takes an `AbortSignal`, so the deadline can abort a copy
already running instead of only refusing the next one. Doing that is remediation; writing it into
the ledger as unclosable would be a false residual, and D5's residual earns its place by there
being no Node primitive at all.
The listing half is different and I am NOT closing it: `readdir` materializes before anything can
be charged, and switching to `opendir` would change `ApplyFsDeps`' shape for every caller and the
fake. Recorded as a build note rather than a ledger row — the walk stays bounded in time and node
count, and one directory listing is a memory cost, not the unbounded backlog D10's row is about.

**Boundaries closed** (chair probe against the production binding):

```
single file larger than the whole byte cap -> failed "too large to bring over — stopped after 1024 bytes", nothing written
already-expired deadline, single-node entry -> failed "provisioning took too long…",            nothing written
directory listing over the node budget      -> failed "too many files to bring over…",          0 children written
```

The byte precharge and the synchronous `Deadline.expired` getter genuinely close boundary 1 and the
node-1 microtask hole in boundary 2.

**Boundaries that persist.** `spend(children.length)` is charged *after* `await deps.readdir(source)`
has already materialized the full listing, so the read that produced it is still outside every
budget. And no awaited operation is abortable: `pipeline`, `lstat`, `mkdir` and `readdir` all run to
completion once started, so a deadline that expires mid-operation is not observed until the next
node.

**Evidence delta justifying WARN rather than BLOCK.** In round 1 a single file entry was *entirely*
unbounded — a 20 GB fixture copied in full and D10's ledger row was flatly false. The byte precharge
means an over-cap copy can no longer start, so the residual is now a *legal-sized* operation that is
slow (a stalled network mount) or one directory listing held in memory before the entry stops. That
is a material reduction in exposure, not a re-labelling.

**Fix.** Wire an `AbortController` to the deadline and pass its signal to `pipeline`; enumerate with
`opendir` and check the budget between reads. If Node cannot make these abortable at this seam, say
so in design.md as a named residual the way D5 names the `openat` window — an unbounded operation
recorded as a residual is honest; one recorded as `supported` is not.

---

## F007 — Partially closed: the shared budget shares only the deadline

- Severity: WARN · Confidence: HIGH · Priority: P2 · Class: feature
- Agent: asm-review-logic + chair
- File: `src/worktree/provisioning/applyEntries.ts:140-143`; `src/extension.ts:585-596`
- Status: accepted, persists · Triage:

Accepted, and the correction is exact: I moved the deadline to apply scope and called the whole
object shared, when `nodes` and `bytes` are locals inside `applyEntry` and reset per entry. The
counters move onto the budget so the three bounds have one lifetime, which is what "one budget for
the whole apply" was supposed to mean in the first place.

**Evidence.** `extension.ts` now mints one `budget` outside the loop, and its comment says "ONE
budget for the whole apply, shared by every entry". `ApplyBudget` carries only the immutable limits
and the `Deadline`; the *counters* live in `applyEntry` as `let nodes = 0; let bytes = 0`, so they
reset on every call. Entry 2 starts with a fresh 20,000 nodes and 512 MiB after entry 1 exhausted
both.

Wall clock — the dominant queue-holding axis — IS now apply-wide, which is the larger half of F007.
Bytes and nodes still multiply by the entry count (≈101 GiB against the provider's ~200-row cap).

**Fix.** Move consumed nodes and bytes onto the shared budget object and mutate them from
`spend`/`spendBytes`, so a later entry reports `failed` against the remaining budget rather than
against a fresh one.

---

## F016 — The node budget charges every directory child twice, halving usable capacity

- Severity: WARN · Confidence: HIGH · Priority: P3 · Class: feature
- Agent: asm-review-logic + chair (chair reproduced)
- File: `src/worktree/provisioning/applyEntries.ts:351-355` with `:315`
- Status: open · Triage:

Accepted. The reserve-then-spend pair double-charges every child, so `maxNodes: 20_000` admits
~10,000 files and the failure text names a number the walk can never reach — a bound that lies in
the user's direction AND in the message. Checked against the budget without adding, so the listing
is still refused before it is walked and each child is charged exactly once. The chair's 9-node
probe becomes the witness, at the exact boundary.

**Evidence.** After `readdir`, `spend(children.length)` reserves one node per child; the loop then
calls `walk()` per child, whose first statement is another unconditional `spend()`. A directory with
N children costs `1 + 2N`. Chair probe on a tree of exactly 9 real nodes (1 directory + 8 files):

```
maxNodes= 9 -> failed  children copied 0/8
maxNodes=12 -> failed  children copied 3/8
maxNodes=16 -> failed  children copied 7/8
maxNodes=17 -> copied  children copied 8/8      <- 1 + 2*8 = 17
```

At the production `maxNodes: 20_000` the real capacity is ~10,000 files, and the failure text —
`"too many files to bring over — stopped after 20000"` — names a number the walk never reached.

A second accounting mismatch on the same invariant: a successful `link` entry returns through
`makeLink` without ever calling `spend()`, so it consumes no node budget at all.

**Fix.** Let the reservation be the charge — have each child consume the unit already reserved for it
rather than calling a second unconditional `spend()` — or track the listing reservation separately
from node consumption. Either way the reported budget number should be the one actually enforced.

---

## F017 — Provisioning never merges onto the create notice, because the create result carries no `worktreeId`

- Severity: WARN · Confidence: HIGH · Priority: P2 · Class: feature
- Agent: asm-review-frontend + chair (chair verified the producer side)
- File: `src/webview/worktree/WorktreeController.ts:1364-1370`; `src/worktree/worktreeMutationService.ts:973-984`; `src/extension.ts:227`
- Status: open · Triage:

Accepted, and it is the sharpest finding in the round because it names my own witness as the
reason I did not see it. The merge keys on `worktreeId` and the create outcome literal never sets
one, so in production the two never match and every create synthesizes a SECOND notice carrying a
fabricated `outcome: "ok"` — the exact behaviour the test was written to prove impossible. The
test passed because I built its create message with a `worktreeId` production does not emit.
Both halves are fixed: the create outcome carries the normalized id it already computes, and the
witness is rebuilt from what the service actually emits rather than from a literal I chose.

**Evidence.** `handleProvisionResult` merges by
`this.actionResults.find((r) => r.action === "create" && r.worktreeId === msg.worktreeId)`. The
create branch's outcome literal (`worktreeMutationService.ts:973-984`) sets `kind`, `verb`, `repoId`,
`openFailed`, `provision`, `openTerminalAt` — and **no `worktreeId`**. `toResultMessage`
(`extension.ts:227`) spreads `worktreeId: outcome.worktreeId`, which is `undefined`. The provisioning
message, by contrast, carries the normalized id. So the comparison is `undefined === "<path>"` for
every real create: `existing` is never found, and the controller synthesizes a fresh notice with a
fabricated `outcome: "ok"` for a create it never observed.

**The test does not catch this because it constructs a state production never produces.** The new
`[F005] folds provisioning onto the create notice instead of replacing it` builds a
`worktreeMutationResult` with `worktreeId` set by hand. That is the round's own lesson recurring —
a witness that passes because the fixture is kinder than reality.

**Impact.** The user gets two create notices, the second claiming success on its own authority. The
merge that the `provisionKey` signature work and the "a second notice would REPLACE the first"
reasoning were built for never runs.

**Fix.** Put the normalized created-worktree id on the successful create outcome — the same value
`provisionedAt` already computes — so both messages carry one identity, and keep exact-id matching.
Rebuild the test from a real create through the service, with a path whose normalization changes its
spelling.

---

## F018 — The `details` the host bounded and sent are never rendered

- Severity: WARN · Confidence: HIGH · Priority: P3 · Class: feature
- Agent: asm-review-frontend
- File: `src/webview/worktree/WorktreeView.ts:1816-1825`
- Status: open · Triage:

Accepted. The host bounds `details` and sends them and the panel drops them, so a directory
reporting `copied` hides every skipped descendant — which is the case D8 minted the field for and
F008 spent a fix capping. Rendered in the same notice, under the same warn rule.

**Evidence.** `provisionSummary` reads only top-level steps whose outcome is `refused` or `failed`.
It never reads `s.details`. A directory entry reports ONE outcome — `copied` — with its skipped and
refused descendants in `details`; that is the entire reason D8 minted the field and F008's fix capped
it at 100 rows plus a counted truncation row.

**Impact.** A directory copied into an existing destination reports "copied" while the files inside
it that were skipped or refused are invisible, including the "and N more not listed" row. The accepted
spec requirement *"that file is left untouched and reported"* is satisfied on the wire and lost at the
last hop — F005's own failure shape, one layer further in.

**Fix.** Render the detail rows with their paths and reasons under the step they belong to, and add a
view test for a top-level `copied` step carrying descendant details.

---

## F023 — `provisionedAt` is computed on every create, on the one unguarded await in the create body

- Severity: WARN · Confidence: MEDIUM · Priority: P3 · Class: feature
- Agent: asm-review-contracts + chair
- File: `src/worktree/worktreeMutationService.ts:958`
- Status: open · Triage:

Accepted. D1's whole point is that nothing provisioning does may turn a successful git create into
a create error, and I put an injectable, uncaught await in the one body that rule is about — then
ran it on every create, reattach included. Moved inside the `wanted.length > 0` guard and given
its own `.catch()` falling back to the resolved path, so the interface cannot reintroduce the
class even if a caller's binding throws.

**Evidence.** `const provisionedAt = (await deps.normalizeWorktreeId?.(check.path)) ?? check.path;`
sits outside the `if (wanted.length > 0)` guard, so every create — including a reattach that
provisions nothing — pays an extra `fs.realpath` round-trip inside the mutation queue, on a path this
feature's own comment says provisioning "rides ... only".

More consequential: it is the only await in that stretch without a local `.catch()`. `applyProvision`
has one and `afterCreate` has one, both because a rejection there reaches the create body's outer arm
at `:988-989` and reports a **successful git create as a create error** — the defect the plan attack
found and D1 exists to prevent. The production binding is safe (`normalizeWorktreePath` is documented
"Never throws" and degrades to the lexical form), but `normalizeWorktreeId` is a public, injectable
member of `MutationServiceDeps`, so the interface now permits a binding that reintroduces that class.

**Fix.** Compute it only when `provisioned !== undefined`, and give it the same local `.catch(() =>
null)` its two neighbours have.

---

## F019 — `ensureParents` mixes the resolved root with the spelled destination and silently no-ops when they differ

- Severity: SUGGEST (downgraded from the specialist's WARN — see reachability) · Confidence: HIGH · Priority: P4 · Class: feature
- Agent: asm-review-data-security + chair
- File: `src/worktree/provisioning/applyEntries.ts:294-297`
- Status: open · Triage:

Accepted as fragility rather than as a live defect — the chair's downgrade is right that
`validateCreatePath` makes it unreachable today. A silent no-op whose correctness rests on an
invariant three modules away is still the wrong failure mode: it now refuses rather than skipping
when the two disagree.

**Evidence.** `relative` is computed from `roots.destination.prepared.resolved` (realpath'd) while
`entryDestination` comes from `path.resolve(roots.destination.path, …)` (spelled). Where the two
differ, `relative` starts with `..` and the guard returns `WRITTEN` having created nothing — F012's
original symptom, a raw ENOENT, returning. Data-security reproduced it by building roots directly.

**Why SUGGEST and not WARN.** It is unreachable through the production create path.
`validateCreatePath` refuses any raw path with a symlinked component
(`createPath.ts:158-162`, *"is a symbolic link, so it cannot hold a worktree"*) and then returns the
normalized form as `check.path` (`:213-215`), which is what `applyProvision` hands to
`prepareEntryGate`. So `roots.destination.path` is already its own realpath and the two agree.
Chair verified that chain.

The finding that survives is fragility, not a defect: correctness here rests on an invariant enforced
three modules away, and the failure mode when it lapses is a silent no-op rather than a refusal. A
directory literally named `..foo` directly under the root also trips `startsWith("..")`.

**Fix.** Derive both sides from one root — preferably build `entryDestination` from
`prepared.resolved` in `admitEntry`, since the containment check already speaks resolved — and guard
on split segments (`seg === ".."`) rather than `startsWith("..")`.

---

## F020 — A skipped destination keeps its byte precharge

- Severity: SUGGEST · Confidence: HIGH · Priority: P4 · Class: feature
- Agent: asm-review-logic
- File: `src/worktree/provisioning/applyEntries.ts:324-331`
- Status: open · Triage:

Accepted. A destination that was already there costs no bytes, so keeping the precharge makes the
cap arbitrarily tighter on a re-run than on a first run.

`spendBytes(node.size)` is charged before `copyFileNoFollow`; an `EEXIST` destination returns
`skipped` having written nothing, and the charge is not refunded. Enough pre-existing destinations in
one directory can exhaust `maxBytes` and stop a later file that would have fit. Refund on the known
no-write `EEXIST` path; keep the precharge, which is what closes F002's first boundary.

---

## F021 — The byte budget charges an `lstat` size and never reconciles against what was written

- Severity: SUGGEST · Confidence: HIGH · Priority: P4 · Class: feature
- Agent: asm-review-data-security
- File: `src/worktree/provisioning/applyEntries.ts:324, 467`
- Status: open · Triage:

Accepted, and it pairs with F020: the precharge is what bounds the operation, and the returned
count is what actually happened. Both are used — precharge to authorize, returned bytes to
reconcile — so the `ApplyFsDeps` contract stops promising a value nobody reads.

The walk charges `node.size` from its `lstat`; `copyFileNoFollow` fstats the no-follow fd and returns
`stat.size`, and the call site now discards that return. The interface still documents the primitive
as answering "the bytes written". The cap therefore bounds the plan, not the writes. Bounded in
practice — the source is the repo's own checkout — so this is accounting honesty. Count bytes through
the pipeline and reconcile, or drop the unread return value from the contract.

---

## F022 — `realpath` is still structurally optional on `ApplyFsDeps`

- Severity: SUGGEST · Confidence: MEDIUM · Priority: P5 · Class: feature
- Agent: asm-review-data-security
- File: `src/worktree/provisioning/applyEntries.ts:45-59`
- Status: open · Triage:

Accepted. `realpath` optional on `ApplyFsDeps` is the SHAPE that produced F003; the round-1 fix
made the fallback correct and left the shape that allowed the omission. Required, so a binding
that forgets it fails to compile rather than silently resolving lexically.

`ApplyFsDeps` does not declare `realpath`; it arrives only via the optional
`ResolvedPathInsideDeps.realpath` in the intersection, so a binding can still omit it and typecheck.
It no longer degrades silently — the fallback is now `fs.realpath` — but the type still does not say
the walk's security decisions depend on it, and that shape is what produced F003. Declare it required
and drop the `??`.

---

## F024 — `applyEntry` cancels a deadline its caller owns

- Severity: SUGGEST · Confidence: HIGH · Priority: P5 · Class: feature
- Agent: asm-review-logic + chair
- File: `src/worktree/provisioning/applyEntries.ts:423`; `src/extension.ts:594-596`
- Status: open · Triage:

Accepted. `applyEntry` cancelling a deadline it did not create is a lifetime it does not own, and
after F007 the same deadline is reused by every later entry — cancelling it in entry one is
actively wrong now, not merely untidy. The caller already cancels in a `finally`.

The budget is now shared across entries and the caller cancels it in its own `finally`, but
`applyEntry`'s `finally` also calls `budget.deadline.cancel()`. Currently harmless: `expired` is a
getter over `Date.now()`, so cancelling the timer does not affect it, and nothing reads `elapsed` on
this budget (the three `.elapsed` consumers in `src/worktree/` each build their own deadline). It
leaves `elapsed` permanently pending after entry 1 for any future consumer. Let the caller own the
cancel.

---

## Notes for the next round

- F004 is reopened under its original ID; its inventory is now `\`, a trailing `.`/`./` segment, and
  case. A further spelling admitted through the same basename-vs-resolve mismatch appends here. If a
  third round has to extend this inventory again, patch-level fixing has failed and the classification
  should move onto the resolved path once, as a single instrument.
- F002 and F007 are both recorded as partially closed. Their remaining halves are the same shape —
  a bound that is claimed apply-wide or operation-wide and is enforced somewhere narrower.
- F017 and F018 are both the last hop of a chain that is correct everywhere upstream. The frontend
  lens ran for the first time this round; if that surface changes again it must run again.
- No `audit-backlog`, `external-blocker` or `risk-accepted` entries exist for this change.
