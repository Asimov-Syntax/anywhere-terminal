# Review Round 1

- Date: 2026-09-02
- Cycle: 1
- Round: 1
- Mode: discovery
- Review profile: fastlane
- Scope: range `d711d6cf~1..HEAD`
- Head: `073af935f46cadff0dfa5c13577d9ce2c0831351` (working tree dirty after review accounting updated `asimov/changes/offer-a-yielding-declaration-as-yielding/analytics.json`; review content was taken from the committed range)
- Reviewable lines: 109
- Intent context: no `proposal.md`; reviewed against the approved delta spec, task Acceptance fields, parent design D4, parent round-2 F005, parent round-3 F007, and the caller's intent brief
- Escalation flags: none declared; mandatory split-child round
- Agents spawned:
  - `asm-review-frontend` — dialog offer truthfulness and accessibility — `gpt-5.6-sol[1M]`
  - `asm-review-logic` — contender mapping, defaults, selection, and submission — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — accepted offer and model contracts — `sonnet[1M]`
  - `asm-review-reuse` — contender helper ownership and duplication — `gpt-5.6-luna[1M]`
  - `asm-review-data-security` — provider text and opaque-id authority boundaries — `gpt-5.6-luna[1M]`
- Supporting trace: `asm-finder` — producer-to-apply and post-result flow — `gpt-5.6-luna[1M]`
- Agents skipped:
  - `asm-review-performance` — no persistence, list endpoint, derived-history recompute, hot path, or growth-axis change; the new projections are linear in the rows already rendered
- Recorded verification: `bun run asm change verify-status offer-a-yielding-declaration-as-yielding` reports tasks 1_1 and 1_2 at exit 0. The review ran no project verification command.
- Verdict: WARN
- Counts: BLOCK 0 | WARN 1 | SUGGEST 0
- Blocking split: 0 feature | 0 machinery

## Findings

### F001

- ID: F001
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, `asm-review-frontend`, `asm-review-contracts`
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:460`
- title: Selection-dependent promises remain frozen at the initial offer
- evidence: `bringSummary(model)` derives copied/linked counts once from the model and `yieldsTo(model)`, and `bringRow()` renders the new live-sounding note `refused while ${row.yields} is selected`. The checkbox change handler at lines 1037-1048 updates only `checkedByOffer`; it neither refreshes the summary nor updates the note. In the changed pair, the supported action of unticking favoured copy `i1` and ticking held link `i2` submits only `i2`. `applyProvisioning.contestsOf()` recomputes from selected entries, finds no favoured member, and applies `i2` ordinarily, while the dialog still says `1 copied` and still says `refused while MixedCase is selected`.
- impact: The explicit escape hatch that lets the user choose the inherited declaration presents the opposite materialization mode and a refusal condition that is no longer true immediately before Create. The initial default is truthful, but the changed offer is not truthful for a supported user-modified selection.
- suggestedFix: Refresh the copied/linked summary from the current selected entry ids, excluding a held entry only while its favoured member is also selected. Either update the yielding note from the same state or make it permanently conditional, such as `yields to MixedCase when both are selected`. Add a witness that turns the favoured row off, turns the held row on, and checks both the summary/note and submitted ids.
- status: accepted (author triage: accepted in full, both boundaries fixed)
- author triage: Accepted. Confirmed against the code: `bringSum.textContent` was written once per offer id and the redraw guard returns early on a tick, so neither statement could move. Fixed at BOTH listed boundaries rather than only the count — the note was arguably still literally true ("refused WHILE MixedCase is selected" states a condition that had lapsed), but a standing refusal notice on the row the user has just chosen describes a refusal that will not happen, and the finding's invariant covers it. `bringSummary` now takes the live selection; the note carries the id it depends on and is hidden while that id is unticked; both are restated from the change handler, which touches text and one hidden flag only, so W2's "a redraw resets every checkbox" does not reopen. Ports and setup steps deliberately still count what the offer DECLARES — a setup step is offered unticked and counted, pre-existing behaviour this change does not own; recorded here so the boundary is a decision rather than an oversight.
- author witnesses: `[round-1 F001] restates the counts when the user reverses the pair` (favoured off / held on: summary reads `1 linked`, submitted ids `["i2"]`), `[round-1 F001] withdraws the refusal note once the counterpart is unticked`, `[round-1 F001] drops a row from the counts the moment it is unticked`. All three arm-checked by reverting the production line and observing the failure.
- triage: New discovery warning. The changed initial state closes parent F007, but the same changed statements need one live selection owner to remain true after the supported substitution interaction.
- invariant: Every pre-apply copied/linked and refusal statement about a contender reflects the currently selected contender set, not only its initial defaults.
- boundary inventory:
  - affected: copied/linked summary after checkbox changes; yielding note after the favoured checkbox is cleared
  - verified safe: initial favoured-only defaults; favoured plus held selected; groups with no favoured member; opaque-id submission; apply-time contest recomputation; post-apply result notice
  - not safe: favoured off and held on, where the held member becomes ordinary but the initial favoured operation and refusal note remain displayed

## Full-flow trace

- `providerKit.contendersOf()` builds connected contender components and names a favoured id only when exactly one repository-native member exists; `readProvisioning()` carries the groups into the normalized model.
- `offerStore.remint()` remints every entry id and translates group membership/favoured ids before the opening-scoped offer reaches the webview.
- `WorktreeCreateDialog` initializes favoured groups with only the favoured entry selected, preserves checkbox ids per offer, and submits only the current host-issued ids. Initial rows, initial counts, no-favoured groups, three-member groups, multiple groups, and untrusted-text rendering are coherent.
- `WorktreeHost` redeems the offer against the host-held model; `worktreeMutationService` applies selected entries after ordinary create. There is no persistence or cache split in this path.
- `applyProvisioning()` recomputes contests from the selected entries. Favoured plus held refuses the held member on every volume; favoured absent leaves the selected held member uncontested and applicable. The post-apply contest/result notice reflects that actual apply result.
- The only open gap is the dialog's static summary/note between a checkbox substitution and submit, recorded as F001.

## Inline support review

- Changed tests contain no `.only` or `.skip`, preserve awaited behavior where asynchronous work exists, and exercise the accepted default, no-favoured, summary, and submission contracts.
- No fixture, seed, secret, or unsafe behavioral-source issue was found.
