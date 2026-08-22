# Workflow State: fix-false-agent-signals

> **Source of truth:** Workflow stages/gates → this file · Task completion → `tasks.md`
>
> **Checkbox states:** `[ ]` pending · `[/]` in progress · `[x]` done · `[-]` skipped/N/A

## Plan

- [x] 1. Context + Triage
  - [x] Read `asimov/project.md`, run `bun run asm change list` + `bun run asm spec list`
  - [x] Choose `change-id`, run `bun run asm change new`
  - [x] Classify complexity + escalation flags → record in Notes
- [x] 2. Discovery
  - [x] Execute workstreams (parallel finder/librarian subagents)
  - [x] Fill `discovery.md` — findings, gap analysis, options, risks
  - [x] **GATE 1: user approved direction** _(skip for trivial)_
- [x] 3-6. Artifact Generation (batch)
  - [x] Fill proposal.md (why, appetite, scope, risk, E2E decision)
  - [x] Fill specs/ — scenarios only when they pin acceptance beyond the requirement (default = none)
  - [x] Fill design.md _(standard or escalation-forced — skip if LOW risk + no escalation flags)_
  - [x] Fill tasks.md (deps, refs, done, test, files, approach)
- [ ] 7. Validation
  - [x] `bun run asm change validate` passes
  - [x] Oracle review _(1 round, user-requested; triage below)_
  - [x] **GATE 2: fastlane — auto-approved**

## Implement

<!-- RULE: NEVER delete or overwrite ## Implement, ## Archive, ## Notes, or ## Revision Log sections.
     Use `edit` (not `write`) on workflow.md — only update checkboxes, Notes, or Revision Log. -->
<!-- RULE: After completing each task, immediately mark it [x] in tasks.md AND log in Revision Log below. -->
- [x] 1. Read all change artifacts that exist (workflow.md, specs/, proposal.md, design.md, tasks.md)
- [x] 2. Execute tasks sequentially in dependency order
- [x] 3. Update: mark `- [x]` in tasks.md + log in Revision Log after EACH task
- [x] 4. Verify Gate — run commands from `asimov/project.md` § Commands, **MUST execute and observe pass** _(mark `[-]` if N/A)_:
  - [x] Type check
  - [x] Lint
  - [x] Test
  - [-] E2E — not defined in project.md
- [x] 5. Review _(round 1 done — WARN, 0 BLOCK)_:
  - [x] Code Review
- [x] 6. Findings triage: 4 accepted + fixed, 1 deferred with rationale (.reviews/round-1.md)
- [x] 7. Review Fix Loop _(2 rounds — user-set budget; exited with 0 BLOCK)_
- [ ] 8. Validation
  - [ ] **Gate: user approved implementation**
  - [ ] Extract knowledge

## Archive

- [ ] Deploy Gate _(skip if `asimov/project.md` § Commands → Deploy is N/A)_:
  - [ ] Run deploy command
  - [ ] Run smoke test
- [x] Apply deltas: `bun run asm change apply`
- [x] Archive change: `bun run asm change archive`
- [ ] Commit all changes

## Notes

Complexity: standard — cross-cutting across pty, session, webview, and provider wiring.
Escalation flags: cross-boundary (extension host ↔ webview ↔ vendored shell scripts).

Scope decided at GATE 1 after verification, NOT taken from the research doc as written:
- A1 (sessionBoundary) and A2 (restoredUnconfirmed) VERIFIED NOT LIVE in AT and dropped —
  AT has no turn-state model, no completion event, no OS notification, and persists no
  activity field. See discovery.md §2-3. They become real only once upgrade C1 (hook
  status pipeline) lands.
- A6 verified not live (no combined text+CR write path) → regression guard test only.
- A7 has no live call site → ships as the token matcher A4 needs, not as its own fix.
- Live set: A3 (title render churn), A4 (headless `claude -p` mis-mapping), A5 (nested
  shell OSC 633 leak).

GATE 1 user decisions:
- Scope: "Chỉ A3+A4+A5" — fix the verified-live set only. (A5 later retired by oracle round, see triage below.)
- A5 approach: "Env fix + parser guard" (discovery.md Option C). Realised as design.md D1
  (alt-screen gate, chosen over orca's process probe because OscParser must stay pure and
  synchronous) + D2 (trailer appended to the COPIED .zlogin, never to the vendored source).


### Oracle review — 1 round, triage (all findings verified independently before acting)

| # | Finding | Verdict | Action |
|---|---|---|---|
| 1 | A1/A2 correctly dropped; no missed activity consumer | ACCEPT | none — confirms discovery §2-3 |
| 2 | D1 alt-screen gate unsound: rc.zsh emits D from precmd with no screen check, so a command entering alt-screen and dying latches the scanner and the real D is dropped | ACCEPT | D1 deleted with A5 (see #3) |
| 3 | D2 premise wrong: login.zsh:6 restores ZDOTDIR unconditionally | ACCEPT — verified directly | **A5 dropped from change.** discovery §9.1 |
| 4 | A4 depends on `claude -p` registering a live PID file — unconfirmed | ACCEPT the doubt, REJECT the conclusion | Measured live: it DOES register. A4 stays. discovery §9.2 |
| 5 | Prefer registry metadata over argv; use `kind` | Direction ACCEPT, mechanism REJECT | `kind` is `"interactive"` for headless too. Used `entrypoint` (`sdk-cli` vs `cli`) instead — measured. Removed the whole ps-argv widening, `parseProcessTableWithArgs`, dep-shape change, and both provider edits |
| 6 | Task scope omissions (extension.ts for InjectorFs; TerminalFactory/DragDropHandler for A6) | Partly MOOT, partly ACCEPT | InjectorFs change gone with A5. A6 rescoped per design.md D5 |
| 7 | `/.+\r$/` also matches `"\x1b\r"` | ACCEPT | Predicate is now `/[^\x00-\x1f]\r$/`, with an explicit allowed-case assertion |

Net: §A's 7 candidates → **2 live** (A3, A4). Appetite dropped M → S; 7 tasks → 3.

Fastlane enabled by user mid-run: choose the best option, no further questions.
GATE 2 auto-approved under fastlane.

## Revision Log

<!-- Format: YYYY-MM-DDTHH:MM:SSZ (ISO 8601 UTC). Get timestamp: date -u +%Y-%m-%dT%H:%M:%SZ -->
<!-- Author: git user. Get it: git config user.name -->

| DateTime (UTC) | Author | Phase | What Changed | Why |
| -------------- | ------ | ----- | ------------ | --- |
| 2026-08-22T16:18:54Z | huybuidac | Plan | Stages 1-6 complete: discovery, proposal, 3 spec deltas, design, 7 tasks | Section A triaged against real code; 3 of 7 candidates confirmed live |
| 2026-08-22T16:37:59Z | huybuidac | Plan | Oracle round 1 triaged: A5 dropped (premise disproven), A4 confirmed by live measurement and re-designed onto `entrypoint`; artifacts rewritten | Two of three planned fixes survived verification; A4's cheaper classifier removes 4 files of churn |
| 2026-08-22T16:43:38Z | huybuidac | Build | 1_1/1_2 title signature gate; 2_1/2_2 headless entrypoint exclusion; 3_1 injection guard | All 3 tasks done via RED→GREEN |
| 2026-08-22T16:43:38Z | huybuidac | Build | Verify gate: check-types pass, lint 0 errors (13 warnings pre-existing, identical on clean tree), test:unit 2277 pass / 0 fail (+22) | Gate evidence |
| 2026-08-22T16:43:38Z | huybuidac | Build | Two scope deviations recorded in tasks.md (1_2 tested via extracted `applyTitleChange`; 3_1 moved to DragDropHandler where text payloads actually originate) | Planned test targets did not exist / did not carry text |
| 2026-08-22T16:58:40Z | huybuidac | Review | Triage round 1: 4 accepted, 1 deferred, 0 rebutted. Details: .reviews/round-1.md | W1 was a real regression of this change's own goal — signature-only gate froze a spinner on a finished agent's tab |
| 2026-08-22T16:58:40Z | huybuidac | Review | Fixes: decoration-presence bit + 1024-char fail-open gate (W1/S1); `winsDedupe` interactive-over-headless (W2); un-exported HEADLESS_ENTRYPOINTS (S2). Spec + design D4 + Interfaces + Risk Map synced | Re-verify: tsc clean, lint 0 errors, 2282 tests pass |
| 2026-08-22T16:59:26Z | huybuidac | Review | Triage round 1: 4 accepted, 1 deferred, 0 rebutted. Details: .reviews/round-1.md | W1 was a real regression of this change's own goal — a signature-only gate froze a spinner on a finished agent's tab |
| 2026-08-22T16:59:26Z | huybuidac | Review | Fixes: decoration-presence bit + 1024-char fail-open (W1/S1); `winsDedupe` interactive-over-headless (W2); un-exported HEADLESS_ENTRYPOINTS (S2). Spec, design D4, Interfaces and Risk Map synced | Re-verify: tsc clean, lint 0 errors, 2282 tests pass |
| 2026-08-22T17:13:25Z | huybuidac | Review | Round 2 (resumed round-1 chair): WARN, 0 BLOCK. Both round-1 fixes independently confirmed correct — W1 by enumerating residual collisions, W2 by exhaustive permutation | Findings were declaration/spec/doc drift, not logic |
| 2026-08-22T17:13:25Z | huybuidac | Review | Triage round 2: 6 accepted + fixed, 0 rebutted. Details: .reviews/round-2.md | R2-3 was the sharpest: tasks.md still instructed a builder to re-export HEADLESS_ENTRYPOINTS, undoing S2 |
| 2026-08-22T17:13:25Z | huybuidac | Review | Final gate: tsc clean, lint 0 errors, 2283 tests pass, asm validate 0 errors. Review budget (2 rounds) exhausted — no round 3 | Exit condition met: 0 BLOCK outstanding |
