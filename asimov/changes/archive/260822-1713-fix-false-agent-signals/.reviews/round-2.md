# Review round 2 — fix-false-agent-signals

- **Date (UTC)**: 2026-08-22T17:05:00Z
- **Input**: change-id `fix-false-agent-signals`, working tree (`git diff HEAD` + untracked)
- **Round-1 disposition**: W1, W2, S1, S2 accepted and fixed; S3 deferred with rationale; nothing rebutted
- **Agents spawned**: logic, contracts, frontend, performance + chair self-review
- **Agents skipped**: data-security — nothing in its domain changed. `winsDedupe` reorders already-parsed, already-validated in-memory entries; no new parsing, I/O, auth, or external-data surface. The scan loop is byte-identical to the round-1 version it cleared.
- **Gates**: `tsc --noEmit` clean; `biome check` clean on all 7 changed files; `vitest run` 134 files / 2282 tests pass (+5 vs round 1)
- **Verdict**: WARN
- **Counts**: BLOCK 0 | WARN 2 | SUGGEST 4 | suppressed 1

---

## Round-1 carry-forward

| ID | Round-1 severity | Round-2 status |
|---|---|---|
| W1 | WARN P2 | **fixed — verified**, see below |
| W2 | WARN P3 | **fixed — verified**, see below |
| S1 | SUGGEST P4 | **fixed — verified**, and a net performance win |
| S2 | SUGGEST P4 | **fixed** — `export` dropped, set is module-private |
| S3 | SUGGEST P4 | deferred, rationale accepted — not re-reported |
| (suppressed) `TitleTrackedInstance` structural drift | P5 | **materialised** — now finding R2-1 |

### W1 verified fixed

Removing the last decorative glyph always flips `decorated`, so the agent-finished transition
renders unconditionally. I enumerated every raw-title pair that still collides on **both**
`titleSignature` and decoration-presence: glyph count, glyph position, family switch, all-glyph
titles, and whitespace-only differences. Every residual collision holds `decorated === true` on
both sides, so it can only freeze the *animation* of a still-running pane — never a finished one.

The whitespace collisions are invisible: `.tab-item { white-space: nowrap }`
(`src/providers/webviewHtml.ts:137`) collapses whitespace runs and edge space, so `Fix  tests`
and `Fix tests` render identically. Suppressing them is correct.

Independently reached by chair, logic, and frontend.

### W2 verified fixed

`winsDedupe` sorts on the lexicographic key `(interactive ? 1 : 0, startedAt ?? 0)` with strict
`>`, which is a valid strict weak ordering, so a fold computes the true maximum regardless of
`readdir` order. I confirmed this by exhaustive permutation over six configurations — 1
interactive + 2 headless, 2 interactive + 1 headless, all headless, interactive with absent
`startedAt` against a newer headless, an unknown-`entrypoint` entry against a headless one, and an
exact tie. The interactive entry wins in **every ordering** of every mixed case. Whenever
headless-ness differs the branch returns `!candidateHeadless`, ignoring `startedAt` in both
directions.

The only order-dependent case is an exact tie on both components — see R2-6.

### S1 verified fixed, and a net win

The oversized branch is strictly fail-open: `titleSignature()` always returns a string and
`.test()` always returns a boolean, so after the reset the guard compares `undefined === <string>`,
which is structurally unsatisfiable. The first in-range title after any oversized title always
renders and repopulates both fields consistently. Boundary matches the spec exactly — 1024 is
gated, 1025 bypasses.

It is also cheaper than round 1 for the pathological case: round 1 ran three full-payload scans
and *retained* a ~10 MB `lastTitleSignature`; round 2 does an O(1) length check and clears the
field. The fail-open's cost profile depends on the `nameSpan.textContent !== renderedName` guard
at `TabBarUtils.ts:180`, which this change neither owns nor tests.

---

## Findings

### R2-1 — `TerminalInstance` declares only half the title-gate state

- **Severity**: WARN | **Confidence**: HIGH | **Priority**: P2
- **Agent**: chair + contracts + logic + frontend + performance (5 of 6, independently)
- **File**: `src/webview/state/WebviewStateStore.ts:41`
- **Status**: accepted (fixed) | **Triage**: Real, and exactly the gap I let be suppressed in round 1. FIXED — `lastTitleDecorated?: boolean` declared beside `lastTitleSignature` in `WebviewStateStore.ts` with the reason in its docblock; test helper typed `TitleTrackedInstance`; tasks.md:24 rewritten to name both halves.

**Evidence.** `TerminalInstance` declares `lastTitleSignature?: string` at line 41, with a docblock
describing the gate, but has no `lastTitleDecorated?: boolean`. A repo-wide grep finds
`lastTitleDecorated` in exactly one file — `titleSignature.ts` (lines 45, 63, 74, 78).
`tsc --noEmit` exits 0: `TitleTrackedInstance.lastTitleDecorated` is optional, so `TerminalInstance`
is structurally assignable at the `applyTitleChange(instance, ...)` call
(`TerminalFactory.ts:452`), and `instance` there is a variable rather than a fresh literal, so no
excess-property check fires. The write at `titleSignature.ts:78` lands on the real object at
runtime, invisible to every declared reader.

The test helper repeats the omission: `titleSignature.test.ts:40` returns
`{ name: string; lastTitleSignature?: string }`.

This is the exact gap round 1 suppressed as "`TitleTrackedInstance` structural drift", now
materialised for the new field.

**Impact.** No runtime bug today — the field is reachable through the widened seam and every path
that could drop it leaves it `undefined`, which fails open (an extra render). The damage is
contract, and it is asymmetric: `lastTitleDecorated` is **unreadable** through the declared type
(`instance.lastTitleDecorated` on a `TerminalInstance` is TS2339) and **uninitialisable** at the
construction literal `TerminalFactory.ts:436`, where an excess-property check *would* fire. The
decoration bit is the entire W1 fix, so any future code built from the declared shape — a state
projection, a typed `{...instance}` rebuild, a rehydration path, an explicit key list — silently
drops it and `applyTitleChange` falls back to signature-only comparison. That re-lands W1 with no
type error and no failing test, because the existing tests pass an untyped literal.

**Suggested fix.** Add `lastTitleDecorated?: boolean` to `TerminalInstance` beside line 41, folded
into one docblock covering the pair and noting that the label renders the raw `name`. Type the test
helper as `TitleTrackedInstance` so helper and production type cannot diverge again. Update
`tasks.md:24`, which still names only `lastTitleSignature`.

---

### R2-2 — The W2 dedupe rule is absent from the reader's contract and from the spec

- **Severity**: WARN | **Confidence**: HIGH | **Priority**: P2
- **Agent**: chair + contracts + logic
- **File**: `src/vault/readers/runningSessions.ts:102-104` and
  `asimov/changes/fix-false-agent-signals/specs/claude-running-session-map/spec.md:9`
- **Status**: accepted (fixed) | **Triage**: Correct that the spec is what survives archive, and the exported docstring still described the pre-fix rule. FIXED — interactive-over-headless, the `startedAt` ordering and the pid tie-break are now normative under the reader's own requirement, with the `claude -p --resume` scenario as the stated reason; `listRunningClaudeSessions`'s docstring matches.

**Evidence.** Two locations, one root cause — the behaviour deliberately changed by the W2 fix was
never written down.

1. The exported function's doc comment still states the pre-fix rule: *"Deduped by sessionId (a
   resumed session rewrites its pid file in place; on the rare collision the entry with the newer
   `startedAt` wins)"*. `winsDedupe` (lines 85-91) consults `startedAt` only as a tie-break **after**
   headless-ness. The correct rule appears in `winsDedupe`'s own comment (77-83) and nowhere on the
   exported API, which has two provider call sites (`TerminalEditorProvider.ts:720`,
   `TerminalViewProvider.ts:788`).
2. The spec requirement "Detect running Claude sessions" specifies liveness, malformed-file
   skipping, `entrypoint` pass-through, and "The result SHALL be keyed by `sessionId`" — then stops.
   The interactive-beats-headless preference, pinned by two tests
   (`runningSessions.test.ts:147-172`), appears in no requirement and no scenario. The spec's only
   headless language (lines 33-43) sits under the *caller's* requirement, reinforcing the wrong
   reading: that the reader stays neutral and the caller does all headless handling.

**Impact.** The stale docstring is the published contract of an exported reader; a caller reasoning
from it gets the precedence backwards — the same reasoning error that produced W2. The spec gap is
the more durable one: this preference is the sole reason a `claude -p --resume` cannot erase a live
interactive session, nothing in the spec stops a future edit reverting `winsDedupe` to
newest-wins, and specs are the artifact that survives `asm archive`.

**Suggested fix.** Replace the docstring parenthetical with the real rule — interactive beats
headless, `startedAt` breaks ties only between entries of the same kind — and state plainly that
the loser's live pid is discarded. Add a matching sentence plus a scenario to the "Detect running
Claude sessions" requirement, mirroring the "keeps the interactive entry even when the headless one
started later" test.

---

### R2-3 — Stale instructions left in `tasks.md` and the design diagram

- **Severity**: SUGGEST | **Confidence**: HIGH | **Priority**: P3
- **Agent**: chair + contracts
- **File**: `asimov/changes/fix-false-agent-signals/tasks.md:24,39`;
  `asimov/changes/fix-false-agent-signals/design.md:23`
- **Status**: accepted (fixed) | **Triage**: Verified all three. tasks.md:39 was the worst — replaying the plan would have re-exported `HEADLESS_ENTRYPOINTS` and re-opened the hazard S2 closed. FIXED: tasks.md:24, tasks.md:39, design.md mermaid gate label.

**Evidence.** All three verified directly:

- `tasks.md:24` — "Add a `lastTitleSignature?: string` field to the terminal-instance type" — names
  only one of the two fields the gate now uses.
- `tasks.md:39` — "Export `HEADLESS_ENTRYPOINTS` as a `ReadonlySet<string>`" — instructs the exact
  thing S2 removed.
- `design.md:23` — the mermaid gate node still reads `"NEW: signature changed?"`, superseded by
  D4's prose at lines 97-106.

**Impact.** Low individually, but `tasks.md:39` now instructs the opposite of what was deliberately
done, and these files are the archived record. Someone replaying the plan re-introduces the
mutation hazard S2 closed.

**Suggested fix.** Three one-line edits. The rest of `design.md` is in good shape — D4 covers both
new rules with the round-1 rationale, the Interfaces block records `lastTitleDecorated` and the
dropped export with the correct reason, and the Risk Map has a `winsDedupe` row.

---

### R2-4 — The 1024-char rule has no scenario, and its state-clearing side effect is unspecified

- **Severity**: SUGGEST | **Confidence**: HIGH | **Priority**: P3
- **Agent**: contracts
- **File**: `asimov/changes/fix-false-agent-signals/specs/process-title-tracking/spec.md:15-16`
- **Status**: accepted (fixed) | **Triage**: The state-clearing is load-bearing and was only implicit. FIXED — the spec now requires both stored values to be cleared on the oversized path and says why, plus an oversized-title scenario.

**Evidence.** The requirement says an oversized title "SHALL bypass the comparison and always
render", but all three scenarios (lines 24-39) cover decoration only; the oversized case is tested
(`titleSignature.test.ts:121-128`) with no scenario behind it. The implementation additionally
clears `lastTitleSignature` and `lastTitleDecorated` (`titleSignature.ts:62-63`) — and that
clearing is precisely what makes the *next* in-range title render rather than compare against
pre-oversize state. The spec does not mention it.

**Impact.** A rule with no scenario is the one most likely to be re-tuned without noticing the
contract — e.g. someone "optimising" by preserving the last good signature across an oversized
title, silently reintroducing a suppressed-change window.

**Suggested fix.** Extend line 15 with "…and SHALL clear the stored comparison state, so the next
in-range title always renders", and add a scenario: two identical oversized titles in a row MUST
each trigger a render.

---

### R2-5 — Optional: a sentinel signature would remove the duplicated regex and the second field

- **Severity**: SUGGEST | **Confidence**: MEDIUM | **Priority**: P4
- **Agent**: logic (chair-corrected)
- **File**: `src/webview/terminal/titleSignature.ts:17,20,38,73`
- **Status**: accepted (fixed) | **Triage**: Took the chair's minimal trade over the specialist's sentinel, for the chair's stated reason: the sentinel does not close the residual collisions its table implied, and would break an existing assertion plus the spec wording. FIXED — `HAS_DECORATIVE_FRAME = new RegExp(DECORATIVE_FRAME_GLYPHS.source)`; one source of truth, zero behaviour change.

**Evidence.** `HAS_DECORATIVE_FRAME` (line 20) duplicates the character class of
`DECORATIVE_FRAME_GLYPHS` (line 17). If the two ever drift, the failure is silent and asymmetric: a
glyph present in the stripping class but absent from the presence class is removed from the
signature while `decorated` stays `false` — W1 re-lands for that glyph family only. Replacing each
glyph with a sentinel instead of deleting it collapses both into one regex and one compared field.

**Chair correction to the specialist's analysis.** The sentinel does **not** close every residual
collision, as the specialist's table implied. Each glyph maps to exactly one sentinel, so
equal-length glyph runs still collide — the canonical progress bar (three glyphs before, three
after) is unchanged. It does distinguish glyph *count* and *position* changes, and it correctly
preserves both the churn collision and the W1 finish transition. It also changes
`titleSignature`'s output, breaking the assertion `titleSignature("<braille> Fix tests") === "Fix
tests"` (`titleSignature.test.ts:23`) and the spec's "removing every character in the braille
range" wording.

**Impact.** Hygiene, not correctness. Suppressing progress-bar animation is desirable anyway, so
the residual collisions this would close are ones the gate arguably *should* keep closed. The real
value is one regex and one field instead of two of each — which would also dissolve R2-1
structurally.

**Suggested fix.** Either adopt the sentinel (and update the test + spec wording), or take the
minimal version: `const HAS_DECORATIVE_FRAME = new RegExp(DECORATIVE_FRAME_GLYPHS.source);` —
single source of truth, no behaviour change, no spec edit. The minimal form is the better trade
unless the count/position cases are wanted.

---

### R2-6 — `winsDedupe` omits the stable tie-break its sibling resolver already establishes

- **Severity**: SUGGEST | **Confidence**: MEDIUM | **Priority**: P4
- **Agent**: logic + chair
- **File**: `src/vault/readers/runningSessions.ts:85-91`
- **Status**: accepted (fixed) | **Triage**: Fair — new code declining a pattern its immediate sibling already establishes. FIXED — `winsDedupe` falls back to the higher pid with a comment pointing at `pickNewest`, plus an exact-tie test.

**Evidence.** Two entries with identical headless-ness and identical `startedAt` keep whichever
`readdir` yields first, so the surviving `pid`/`cwd` is nondeterministic across calls. My
permutation sweep isolates this as the single order-dependent case. The codebase already treats
this as worth fixing in the immediate sibling: `pickNewest` at `resolveClaudeSession.ts:40-42`
carries a lexical `sessionId` secondary key with the comment *"so equal mtimes resolve the same way
regardless of readdir/scan order"*. The new `winsDedupe` has no equivalent.

The strict `>` is inherited from the pre-fix code, so the tie behaviour is not a regression — but
`winsDedupe` is new code that declines an established local pattern.

**Impact.** Low. Requires two live same-`sessionId` processes with equal headless-ness and
same-millisecond `startedAt`. If it occurred, the surviving `pid` could flip between calls and
step 1's pid-subtree match would intermittently miss, degrading to the cwd fallback.

**Suggested fix.** Add a deterministic final key — `return candidate.pid > existing.pid;` after the
`startedAt` comparison — and a test with two `cli` entries at equal `startedAt` asserting a fixed
pid. Both existing dedupe tests differ on a compared component, so neither exercises the tie.

---

## Suppressed (1)

- **Gate still suppresses visibly-different glyph variations** (frontend, WARN) — glyph count,
  position, and family-switch pairs do collide and do differ on screen. Downgraded and dropped as a
  standalone finding: these are decoration-only differences, which is exactly the suppression
  target, and both logic and performance independently concluded they can only freeze the animation
  of a still-running pane, never a finished one. The specialist's suggested fix (preserve glyph
  count/position in the compared shape) would re-introduce per-frame renders for spinner families
  that vary count or position — a net loss against the metric this change exists to improve.
  Retained as the optional half of R2-5.

## Notes (not findings)

- **Pre-existing, unchanged by this diff**: `if (!newTitle) return` (`titleSignature.ts:57`) means
  an agent that finishes by *clearing* its title (`ESC]0;BEL`) leaves the frozen spinner — the same
  visible symptom as W1. `git show HEAD:src/webview/terminal/TerminalFactory.ts` confirms the old
  inline handler carried the identical guard. Natural follow-up alongside S3.
- **S3's margin is thinner.** Performance notes the gate's hit rate is now
  `P(signature unchanged) x P(decoration unchanged)`, so round 2 adds a second independent way for
  it to fall. For today's corpus the product is unchanged — braille spinners use `U+2800` BRAILLE
  PATTERN BLANK for empty frames, which is inside the stripped range, so `decorated` stays `true`
  across a blank frame. But that safety now rests on an unstated invariant (every frame of every
  spinner contains an in-set glyph) that neither code nor tests enforce. Strengthens the case for
  the deferred rAF latch.
- **Layering** (contracts, folded into R2-2's fix): `winsDedupe` puts headless knowledge in the
  reader while `resolveClaudeSession.ts:58` also filters on it, so two layers must stay in sync, and
  the module header still presents the function as neutral enumeration. Defensible — dedupe by
  `sessionId` over a pid-keyed registry *is* a policy, and `winsDedupe` is the only place both
  entries exist — but a future consumer wanting the raw registry (count concurrent `claude -p` runs,
  kill a runaway one-shot) cannot recover the discarded pid. Worth one sentence in the module
  header; the cleaner long-term seam is return-all-then-filter-then-dedupe in the caller.

## Phase 2.5 — support code (inline)

- +5 tests since round 1, all green. No `.only` / `.skip`; async paths awaited.
- The three new title tests cover disappear / appear / churn-still-suppressed, and the test whose
  comment carried the false "nothing the tab renders has changed" premise was correctly rewritten.
- Two new dedupe tests pin both orderings. Neither exercises the exact tie (R2-6), and the oversized
  test uses length 1025 without covering the 1024 boundary — minor, not filed.
