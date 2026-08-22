# Review round 1 — fix-false-agent-signals

- **Date (UTC)**: 2026-08-22T16:50:37Z
- **Input**: change-id `fix-false-agent-signals`, working tree (`git diff HEAD` + untracked)
- **Reviewable lines**: ~115 production lines added (199 added total incl. tests)
- **Reviewable files**: `src/webview/terminal/titleSignature.ts` (new), `src/webview/terminal/TerminalFactory.ts`, `src/webview/state/WebviewStateStore.ts`, `src/session/resolveClaudeSession.ts`, `src/vault/readers/runningSessions.ts`
- **Test files (Phase 2.5, inline)**: `titleSignature.test.ts` (new), `resolveClaudeSession.test.ts`, `runningSessions.test.ts`, `DragDropHandler.test.ts`
- **Agents spawned**: data-security, logic, contracts, frontend, performance (all 5) + chair self-review
- **Agents skipped**: none
- **Gates**: `tsc --noEmit` clean; `biome check` clean on all 7 changed files; `vitest run` 134 files / 2277 tests pass
- **Verdict**: WARN
- **Counts**: BLOCK 0 | WARN 2 | SUGGEST 3 | suppressed 2

---

## Findings

### W1 — Decorated↔undecorated title transition is suppressed, freezing a spinner glyph on the tab label

- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: chair + frontend + contracts + logic (4 of 6 independently)
- **File**: `src/webview/terminal/titleSignature.ts:51-53`
- **Status**: accepted
- **Triage**: Confirmed independently: `titleSignature("⠋ Fix tests") === titleSignature("Fix tests")` and `TabBarUtils.ts:178` renders the raw `name`, so the suppressed transition leaves the old glyph in the DOM. My own test encoded the false premise. FIXED — compared state is now `(signature, decorationPresent)` via a non-global `HAS_DECORATIVE_FRAME`; spec gained a third scenario, design.md D4 a paragraph, and three tests cover disappear / appear / churn-still-suppressed.

**Evidence.** `applyTitleChange` assigns `instance.name = newTitle` (line 49) and then returns
without rendering when `titleSignature(newTitle)` equals the stored signature. Because the
signature strips the glyph, `titleSignature("⠋ Fix tests") === titleSignature("Fix tests")`.
The tab label is written verbatim from the raw name — `TabBarUtils.ts:178`:

```ts
const displayName = instance.customName ?? instance.name;
```

Sequence: render fires on `⠋ Fix tests` → frames advance, suppressed → the agent finishes and
writes `Fix tests` → identical signature → **no render**. `instance.name` is `Fix tests` but the
DOM still shows `⠋ Fix tests`.

`titleSignature.test.ts:88-98` locks this in with the rationale *"nothing the tab renders has
changed"*. That premise is false: `TabBarUtils.ts:178` renders exactly the string that changed.

It also contradicts this change's own spec, `specs/process-title-tracking/spec.md:12-14`:
"`TerminalInstance.name` SHALL always be assigned the raw title (never the signature), **so the
tab label still shows what the agent last wrote**." The label does not.

**Impact.** A frozen spinner glyph reads as "agent still working" after the agent finished — the
exact false-signal class this change is named for. The rescue path is not as tight as it looks:
`TerminalActivityTracker` is **edge-triggered** (`TerminalActivityTracker.ts:31-35` fires only on
`idle→running`; further output merely resets the 1500 ms idle timer). So the label self-corrects
only ~1.5 s after the pane goes quiet — while any output continues, the stale glyph persists
unbounded. Not a correctness bug, hence WARN rather than BLOCK.

**Suggested fix.** Keep the signature gate; add a decoration-presence bit so start/finish
transitions render exactly once while frame-to-frame churn stays suppressed:

```ts
const HAS_DECORATION = /[⠀-⣿◐-◓]/; // non-global: .test() on a /g regex is lastIndex-stateful

const decorated = HAS_DECORATION.test(newTitle);
if (instance.lastTitleSignature === signature && instance.lastTitleDecorated === decorated) return;
instance.lastTitleDecorated = decorated;
```

Then add the missing third scenario to `specs/process-title-tracking/spec.md` ("spinner
disappears when the agent finishes → re-render MUST be triggered"), add a sentence to
`design.md` D4, and correct the inaccurate comments at `titleSignature.ts:41-43` and
`titleSignature.test.ts:88-90`.

---

### W2 — Dedupe-then-filter can erase the only entry for a live interactive session

- **Severity**: WARN
- **Confidence**: MEDIUM
- **Priority**: P3
- **Agent**: chair + logic
- **File**: `src/vault/readers/runningSessions.ts:131-133` (interacting with `src/session/resolveClaudeSession.ts:58`)
- **Status**: accepted
- **Triage**: Took the fix rather than the measure-first alternative: making classification survive the dedupe is cheaper than characterising `claude -p --resume`, and is correct regardless of what Claude does. FIXED — `winsDedupe` prefers interactive over headless before comparing `startedAt`; two tests pin both orderings. This also restores discovery.md §9.3's premise about step-3 reachability.

**Evidence.** `listRunningClaudeSessions` collapses entries by `sessionId` **inside the reader**,
before `resolveClaudeSession` ever sees them, preferring the later `startedAt`:

```ts
const existing = bySession.get(sessionId);
if (!existing || (startedAt ?? 0) > (existing.startedAt ?? 0)) {
  bySession.set(sessionId, entry);
}
```

Both entries have already passed the liveness probe at `:119`. A hook-spawned
`claude -p --resume <id>` (or `--continue` / `--session-id <id>`) writes its own pid file carrying
the interactive session's `sessionId`, a distinct pid, and a newer `startedAt`. It wins the
dedupe, so the surviving entry for `<id>` carries `entrypoint: "sdk-cli"` — and the interactive
entry (`entrypoint: "cli"`, the pid actually in the pane's subtree) is already gone. The new
up-front `.filter()` at `resolveClaudeSession.ts:58` then removes the survivor, so `<id>` is
absent from `running` entirely.

**Impact.** Steps 1 and 2 both miss for a pane that previously resolved correctly by exact pid.
Resolution falls to step 3 `newestSessionUnderCwd`, which returns `null` when `getCwd` is
undefined (Windows, unknown pane) and can return a *different* session when the shell has
`cd`'d. It also routes this case into the step-3 hole that `discovery.md` §9.3 accepts on the
premise that step 3 is "only reachable when nothing is running for that pane at all" — that
premise no longer holds. MEDIUM confidence: it depends on `claude -p --resume` reusing the
sessionId in its registry file, which the §9.2 measurement (plain `claude -p`) did not cover.

**Suggested fix.** Make the classification survive the dedupe — prefer a non-headless entry
regardless of `startedAt`:

```ts
const existing = bySession.get(sessionId);
const supersedes =
  !existing ||
  (isHeadlessSession(existing) && !isHeadlessSession(entry)) ||
  (isHeadlessSession(existing) === isHeadlessSession(entry) &&
    (startedAt ?? 0) > (existing.startedAt ?? 0));
if (supersedes) bySession.set(sessionId, entry);
```

Add a test: two live entries sharing one sessionId, the headless one newer → the interactive
entry survives and step 1 still resolves. **Cheaper alternative**: measure whether
`claude -p --resume` writes a fresh sessionId; if it does, record that in `discovery.md` §9.2 and
close this with no code change.

---

### S1 — No length cap on the title scanned per OSC event

- **Severity**: SUGGEST
- **Confidence**: MEDIUM
- **Priority**: P4
- **Agent**: performance (chair downgraded from WARN/P2)
- **File**: `src/webview/terminal/titleSignature.ts:28`
- **Status**: accepted
- **Triage**: Cheap, and the payload is externally controlled (xterm PAYLOAD_LIMIT is 10 MB; any program can emit one). FIXED as fail-OPEN rather than a truncated signature: titles over `MAX_GATED_TITLE_CHARS = 1024` skip the gate and always render, so a long title can never have a real change suppressed by a shared prefix.

**Evidence.** xterm delivers OSC title payloads up to `PAYLOAD_LIMIT = 10000000` (10 MB) verbatim
to `onTitleChange` — verified at `node_modules/@xterm/xterm/src/common/parser/Constants.ts:58`.
`titleSignature` runs two full regex scans plus `trim()` (three intermediate allocations) on that
string, at up to ~10 title-writes/sec/pane. `lastTitleSignature` also retains a second copy of the
title for the pane's lifetime alongside `instance.name`.

**Impact.** Downgraded from the specialist's P2 because the exposure is largely **pre-existing and
only marginally amplified**: the old code already assigned the full title to `instance.name` and
called `renderTabBar`, whose `nameSpan.textContent !== renderedName` guard (`TabBarUtils.ts:180`)
is itself an O(n) compare on the same string. The new cost is ~2 extra scans plus one extra
retained copy. Cannot produce a wrong result — cost only.

**Suggested fix.** Cheap structural cap; treat oversized titles as an ordinary change:

```ts
const MAX_TITLE_SIGNATURE_CHARS = 1024;
if (title.length > MAX_TITLE_SIGNATURE_CHARS) return title;
```

---

### S2 — `HEADLESS_ENTRYPOINTS` is exported with no consumer and is not runtime-immutable

- **Severity**: SUGGEST
- **Confidence**: MEDIUM
- **Priority**: P4
- **Agent**: contracts (chair downgraded from WARN)
- **File**: `src/vault/readers/runningSessions.ts:39`
- **Status**: accepted
- **Triage**: The `ReadonlySet`-over-live-`Set` hazard is real and defeats D2's entire purpose. FIXED by dropping the `export` — no consumer existed, so this removes the dead export and the mutation hazard together. design.md Interfaces records why.

**Evidence.** Repo-wide, `HEADLESS_ENTRYPOINTS` appears only at its definition (`:39`) and its sole
use inside `isHeadlessSession` (`:54`). The tests import `isHeadlessSession`, not the set
(`runningSessions.test.ts:7`). `ReadonlySet<string>` is an erased compile-time view over a live
`Set`: `(HEADLESS_ENTRYPOINTS as Set<string>).add("cli")` from any future module would silently
reclassify every interactive session as headless process-wide — precisely the failure mode
design.md D2's allow-list exists to prevent.

**Impact.** Public surface carrying a mutable-shared-singleton hazard, with no consumer. Low
likelihood; the change's D2 contract depends on this set being fixed.

**Suggested fix.** Either drop the `export` (the predicate is the whole contract, and both spec and
tests already treat it that way), or make the runtime object agree with its type:
`export const HEADLESS_ENTRYPOINTS: readonly string[] = Object.freeze([...])`. Update
`design.md:133` to match.

---

### S3 — Signature gate is a content-equality check, not a render coalescer

- **Severity**: SUGGEST
- **Confidence**: MEDIUM
- **Priority**: P4
- **Agent**: performance (chair downgraded from WARN/P3)
- **File**: `src/webview/terminal/titleSignature.ts:55`
- **Status**: deferred
- **Triage**: Valid robustness gap, not a present cost — the TUIs in scope emit stable text behind a glyph, so nothing produces a per-frame-varying signature today. The proposed rAF latch sits at the `main.ts` `updateTabBar` seam, a different seam from this change's scope (the OSC title handler), and would need its own before/after measurement. Recorded as follow-up, not fixed here.

**Evidence.** The gate suppresses only when the stripped text is byte-identical. Any TUI whose
title carries a per-frame-varying non-glyph token (elapsed seconds, token count, percentage)
produces a fresh signature every frame and `requestRender()` fires at the original ~10 Hz. Each
render costs `buildTabBarData` (fresh `Map` plus a `getAllSessionIds(layout).some(...)` tree walk
per branch tab, `TabBarUtils.ts:44-47`) followed by a full `renderTabBar` pass.

**Impact.** Robustness gap, not a measured present cost — the agent title corpus in scope today
(`⠋ Fix tests`, `◐ Claude Code`, `⣿ Cursor Agent`) is stable text behind a glyph, with no
counters, so the gate's hit rate is high and the design's perf claim holds.

**Suggested fix.** Optional follow-up: wrap `updateTabBar` at the `main.ts:326` seam in a
`requestAnimationFrame` latch. That caps *every* driver at ≤1 render/frame independent of title
content, and subsumes the signature gate rather than competing with it.

---

## Suppressed (2)

- **`TitleTrackedInstance` structural drift** (contracts, SUGGEST P5) — TypeScript will not error
  if `lastTitleSignature` is later removed or renamed on `TerminalInstance`; `applyTitleChange`
  would silently write an undeclared expando. A one-line type assertion pins it. The structural
  seam itself is the correct house pattern (matches `ActivityTerminal` in
  `TerminalActivityTracker.ts:1-4` and `TabInfo` in `TabBarUtils.ts:14-20`).
- **Decorative glyph coverage breadth** (chair + frontend, SUGGEST P4) — the set covers braille
  `U+2800`–`U+28FF` and quarter circles `U+25D0`–`U+25D3` only; other spinner families (block
  elements, asterisk frames) fall through and simply do not benefit. Fail-open, matches the spec
  character-for-character, and the observed corpus is covered.

---

## Clean areas

- **Data & security** — no findings. `entrypoint` is read with the same `typeof === "string"` guard
  as the existing fields, adds no throw path, is never interpolated/logged/executed, and does not
  change the `EPERM`-as-alive cross-user behaviour. `sessionId` path construction is already
  guarded by `resolveClaudeSessionPath` (`claudePaths.ts:65-67, 77-80`).
- **Contracts** — both specs match the implementation, including the details easy to get wrong:
  filter applied once before step 1 so it covers step 2; an emptied candidate set falls through
  rather than returning null; step 3 left unfiltered; `entrypoint` carried verbatim, never
  defaulted; the regex ranges match the spec character-for-character. No layering or cycle issue —
  `resolveClaudeSession.ts` is reached only from the two extension-host providers, never from the
  webview iife entry.
- **Logic** — `session.entrypoint !== undefined` is load-bearing (required for
  `ReadonlySet<string>.has` under `strict: true`), not redundant. Empty-string and non-string cases
  behave exactly as documented. No async/ordering hazard from the added `.filter()`.
- **Performance** — the fix is real, not a deferral. The OSC title path was the **only**
  high-frequency `onTabBarUpdate` driver; `TerminalActivityTracker` is edge-triggered and `onOutput`
  (`main.ts:479-481`) never calls `updateTabBar` directly. The `/g` regex is safe as written
  (`String.replace` resets `lastIndex`; the constant is not exported and never used with `.test()`).
  `entrypoint` adds zero new I/O. The `resolveClaudeSession` filter is a net improvement — it shrinks
  the candidate list feeding `pickNewest`, which issues one `sessionMtime` stat per candidate.

## Phase 2.5 — support code (inline)

- Every new production path has a corresponding test; no `.only` / `.skip`; async paths awaited.
- No PII or secrets in fixtures; registry fixtures match `RunningClaudeSession`.
- `titleSignature.test.ts:88-98` asserts a *rationale* that the render path contradicts — see W1.
- The A6 injection guard (`DragDropHandler.test.ts`) is structurally trivially satisfied: both
  insert paths (`DragDropHandler.ts:277` and `:303`) always append a trailing space and can never
  emit `\r`. That is what design.md D5 claims ("guard, not a fix"), so it is honest — but its
  regression value is limited to that one file. The two documented scope deviations (1_2 tested via
  the extracted `applyTitleChange`; 3_1 moved off `InputHandler`, which posts only `\x15`) are
  recorded in `tasks.md` and are reasonable.
