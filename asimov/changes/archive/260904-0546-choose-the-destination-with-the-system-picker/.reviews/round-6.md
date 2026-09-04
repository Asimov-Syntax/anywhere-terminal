# Review round 6 — choose-the-destination-with-the-system-picker

- Date: 2026-09-04
- Cycle: 3
- Mode: discovery
- Lane: fastlane
- Escalation flags: new-api-contract, security-privacy, cross-boundary
- Head reviewed: `03e2921a573c104827622cb6197b3e46437fd8b7`
- Current checkout Head: `661b0bdeb49f48ede8f80ec51aa3012c4ead77d8`; later and interleaved commits were excluded
- Diff scope: exact commits `e4e6033e 2d547f39 fa0a215d a151d3c6 a5acbecd 67d48740 9bb3eca0 1b2301be 26a7540b 44b4944b 3eb2c64c ec0ea842 03e2921a`; no range was used
- Tree: dirty only in this change's `analytics.json` after the already-recorded `round-start`; no working-tree source change was reviewed
- Reviewable lines: 1,033 added/modified across reviewable files, including 288 analytics lines and 745 production-source lines; 1,271 changed test lines were reviewed inline
- Note: Large change — accuracy may decrease
- Verdict: **WARN**
- Counts: 0 BLOCK · 2 WARN · 0 SUGGEST; F005 and F006 fixed, F007 persists, F008 new
- Split over gating blockers: 0 feature / 0 machinery

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-data-security | picker host, chosen-root authority, probe and downstream mutation cone | filesystem authority, destructive boundaries, fail-closed behavior | `opus[1M]` |
| asm-review-logic | picker/probe continuations and form state | async interleavings, replay, liveness | `gpt-5.6-terra[1M]` |
| asm-review-frontend | dialog/controller picker transaction | UI state, submit gating, stale answers, accessibility | `sonnet[1M]` |
| asm-review-contracts | request/reply/flag wire and routing | contract completeness, identity, amended requirement | `gpt-5.6-terra[1M]` |
| chair | full exact-commit scope | all applicable lenses and full-flow trace | current chair |

Skipped: `asm-review-performance` — every new datum is scalar or one record per live opening; no growing collection, scan, recomputation loop, duplicate accumulation, or hot-path growth was added. `asm-review-reuse` — the change reuses `PreparedRoot`, `resolveDestination`, the existing message/router seams, and the debris ask pattern; no duplicate repository capability or incohesive split was introduced. No changed test adds `.only` or `.skip`.

Verify-gate evidence is the caller's recorded `bun run asm change verify-status choose-the-destination-with-the-system-picker`: 7,715/7,715 tests, clean type checking, green I10 and bundle gates, and all eleven tasks stamped. Biome remains at the base's 1 error / 14 warnings / 1 info, none in a changed file. The chair ran no project verify command or test suite.

---

## Findings

### [F005] The single picker slot can lose an earlier confirmed pick

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-logic + asm-review-frontend + asm-review-contracts
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1467-1478,2045-2048,2707-2718,2946-2969,3034-3054`; `src/providers/WorktreeHost.ts:2123-2208`
- Status: fixed
- Triage: Commit `03e2921a` closes the round-4 composition at the shipped panel's entry point. The first activation sets `pickAsked` before posting, synchronously re-renders, and disables both Choose and Create; every UI submission path calls `submit()`, which refuses while Create is disabled. No second browser-delivered activation can open pick B while pick A remains the form's outstanding ask.
- Evidence: cancel, throw, an unwired capability, an unresolvable root, same-token `Opening` replacement, and a superseded confirmed pick all route through `release()` while the surface/token remain live and echo the exact `ask`. The dialog clears only the matching ask; unrelated probe answers do not release it. Typing, clearing, or switching repository deliberately withdraws the old ask, after which a new picker is safe because ask identity and `pickGeneration` discard the old completion. The `[5_1]` witness proves Choose is disabled and returned by a no-path terminal answer.
- Impact: closed for the supported panel flow and for the amended frozen requirement. The existing F007 retired-opening residual is a pre-admission silence, not a second admitted picker releasing this transaction.
- SuggestedFix: none — the round-4 witness closes.

---

### [F006] The approved repository-switch late-answer witness is missing

- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: asm-review-contracts + asm-review-frontend + chair
- Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.test.ts:5790-5812`
- Status: fixed
- Triage: The `[5_1] drops a pick answered after the form switched repository` test performs the required pick → repository switch → old answer schedule.
- Evidence: the witness proves repository B is current and the emitted selection carries no `useChosenFolder`; `stateDestination({ kind: "repoChanged" })` withdraws the old `pickAsked`, so the answer is discarded before it can mark B chosen.
- Impact: closed.
- SuggestedFix: none — the exact D7 defeater now has a regression tripwire.

---

### [F007] Retiring an Opening can leave its still-visible form waiting on a picker that never opens

- Severity: WARN
- Confidence: MEDIUM
- Priority: P3
- Agent: asm-review-logic + asm-review-data-security + chair
- Class: feature
- File: `src/providers/WorktreeHost.ts:1320-1328,2131-2140`; `src/webview/worktree/WorktreeCreateDialog.ts:1467-1478,2707-2718`
- Status: accepted
- Triage: persists from round 4 as the declared residual; no new evidence makes it gating. A predecessor form may remain visible after a successor retired its captured opening, and a repository can depart while its snapshotted form remains. In either case the click sets `pickAsked`, but `pickDestination` finds no Opening and returns before a terminal answer exists.
- Evidence: `openingFor(...) === undefined` is both the host's pre-admission refusal and its silence condition. The form is normally replaced by the successor already pending; a departed-repository form remains recoverable by closing it. Distinguishing a still-rendered retired form from a genuinely gone form changes D3's accepted meaning of “gone,” exactly as round 4 recorded.
- Impact: Choose and Create can remain disabled on that stale form until replacement, another destination transition where one remains possible, or dismissal. It derives no wrong path and mints no authority. This remains **non-gating**.
- SuggestedFix: none inside this cycle. Any change must return to plan and redefine how host opening retirement is made observable to a still-rendered form.

---

### [F008] Picker contract comments still describe superseded path and terminal-answer semantics

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair + asm-review-contracts
- Class: feature
- File: `src/types/messages.ts:1431-1435,2711-2719`; `src/providers/WorktreeHost.ts:2104-2117`
- Status: accepted
- Triage (author): ACCEPTED and fixed as 6_1, in code rather than through plan. The correction makes
  the comments say what the ALREADY-APPROVED D3 and D5 say; no `D#` moves and no contract is
  redefined, so it is remediation. The cycle exits at Re-Verify with 0 gating blockers, so this is a
  trivial WARN auto-fix and not a fix loop the cycle cap forbids. All three sites are corrected to
  the chair's own wording: the reply's path is presence-only, every admitted live-form outcome is
  terminally answered, and only a retirement that makes the form unreachable is silent — which is
  the distinction the third site was missing between a same-token `Opening` replacement (answered)
  and a gone form (silent).
- Triage: new in round 6. Runtime behavior matches D3–D7, but three changed contract comments describe earlier designs.
- Evidence: `WorktreePickDestinationMessage` says the answer is a suggestion into the typed override, while the form deliberately never reads the path and the host derives from its own `PreparedRoot`. `pickDestination`'s function comment says cancel/failure post nothing and the form is never disabled, while the implementation now answers both and gates the form. `WorktreeDestinationPickedMessage` says an “opening replaced” is silent without distinguishing a retired-token/gone form from the D3-required same-token `Opening` replacement, which receives a no-path answer.
- Impact: these are public/near-public contract statements on a security-sensitive wire. A future consumer or regression test following them can send the returned path back as a typed candidate or restore silence on cancel/replay, reintroducing the exact D3/D5 failures this cycle removed.
- SuggestedFix: if addressed, route the contract wording through plan for this capped cycle: state that the reply's path is presence-only, every admitted live-form outcome is terminally answered, and only retirement that makes the form/token unreachable is silent.

## Adjudication notes

- A contracts candidate that duplicate same-`ask` requests should keep F005 open was withdrawn after verification: no ordinary shipped-panel path or evidenced platform replay produces it; D7 makes `ask` form-minted correlation and explicitly leaves the host as an echoer. Host one-shot admission per ask is not an accepted obligation.
- The data/security review traced picked-root collisions through `debrisCandidate`, authorization issuance, redemption, and `clearDebris`. The proposed BLOCK was withdrawn: the accepted create contract deliberately preserves collision/occupancy parity under the chosen root, while the documented destructive bounds — host-published path, explicit ask, fingerprinted entries and identity, `.git` refusal, symlink-component refusal, and pre-delete rechecks — remain unchanged. Suppressing the candidate would contradict D1 and task 2_1. The design ledger's omission of that downstream consequence is context, not a concrete implementation defect.
- The data/security liveness finding for a departed repository is the same causal mechanism and impact already inventoried by F007, so it merges into F007 rather than receiving a new ID.
- A repository switch can withdraw ask A and permit a new pick B before A's host continuation finishes. This does not reopen F005: the user replaced the destination, distinct asks separate the completions, `pickGeneration` orders confirmed roots, and every traced ordering leaves the new repository state intact.
- F001 remains fixed: picker writes and probe publication require exact `Opening` object identity across every await. F002 remains fixed by the controller's per-dialog opening snapshot. F003 remains fixed by confirmation ordering. F004 remains fixed by mode-withdrawal clearing `usingChosen`.
- The declared `showOpenDialog`-never-settles ledger row remains unresolved by construction and is not a proved reachable defect; no timeout is recommended.

## Full-flow trace

1. **Entry and pending state:** Choose mints `ask`, sets `pickAsked`, posts the request, and synchronously disables both Create and Choose. Ctrl/Cmd+Enter reaches the same `submit()` guard as the button.
2. **Opening identity and consent:** the controller sends the opening snapshotted when that dialog was composed. The host validates `repoId`, token, and ask, captures the exact `Opening` object before the dialog, resolves a confirmed folder once into `PreparedRoot`, and writes only when object identity and confirmation generation still match.
3. **Terminal outcomes:** confirmed, cancelled, thrown, unwired, unresolvable, same-token-replaced, and superseded admitted picks all answer while the surface/token are live; gone/retired forms remain silent. F007 is the known boundary where a rendered form can outlive host admission state.
4. **Answer routing and state:** router → delegated handler → controller checks live token plus bound opening → dialog checks ask. No-path ends only the wait. Path presence enters the chosen state; its value is not read.
5. **Probe and authority:** the webview sends only `useChosenFolder: true`. Candidate-path field presence preserves typed-override precedence. The host reads only its own `Opening.chosenRoot`, derives synchronously, and keeps exact-object checks across later refs/base/branch awaits and publication.
6. **Output and side effect:** the host's `freePath` becomes the displayed and submitted `draft.path`; the existing create path passes it to `worktree add`. The assembly witness covers the shipped picker → host record → probe → form → create argv path. No chosen folder is persisted.
