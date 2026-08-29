# Activity Confirmation Ceiling

> **Ref**: docs/DESIGN.md § 8.4 (its invariant is registered by WT-008.2), § 9 D27
> **Consumer**: `asimov-plan` reads this to turn a PLAN.md task into spec deltas and builder tasks.

A worktree agent row can claim `running` forever on evidence that proves only that bytes are
moving. This document defines the ceiling that stops it, what the ceiling deliberately does
*not* change, and why the terminal tab is not part of it.

## 1. The problem

At HEAD the chain has no upper bound:

1. `explainLiveActivity` returns `running` when `semanticWorking || outputActive`
   (`src/shared/paneEvidence.ts:113-127`).
2. `outputActive` is *any* output inside `OUTPUT_IDLE_WINDOW_MS = 1500`
   (`src/shared/paneEvidence.ts:19`, `src/session/PaneEvidenceStore.ts:250`).
3. A fresh hook report overrides inference, but only while it is fresh — 60 s
   (`src/worktree/presenceProjector.ts:629-635`). After that, inference takes control back.
4. The row's `running` treatment is an infinite animation
   (`src/webview/worktree/worktreePanel.css:210-214`).

An agent TUI that animates its own spinner emits output continuously, so `outputActive` never
falls. Nothing in `src/` caps how long a row may claim `running`. Past the hook window, the row
is spinning on **the agent's animation**, not on evidence of work — the exact class of false
claim the evidence model exists to prevent, and the one WT-004.1's acceptance names for
identity ("never from a spinner") but never enforced for activity.

## 2. The rule

```ts
/** How long an inferred `running` may stand unchanged before it stops claiming confirmation. */
export const CONFIRMATION_CEILING_MS = 5 * 60_000;

/** Whether a row's activity is still backed by something that moved. */
export type ActivityConfidence = "confirmed" | "unconfirmed";
```

A row is `unconfirmed` when **all three** hold:

| # | Condition | Why it is in the rule |
|---|-----------|-----------------------|
| 1 | `activity === "running"` | The ceiling is about a claim of work in progress. No other state animates, and no other state overstates |
| 2 | `activitySource === "output"` | The only source whose evidence a self-animating TUI can manufacture. `hook` is a declaration, `registry` is a different claim (§ 3), `title` never produces `running`, `none` has no claim to degrade |
| 3 | `now - stateStartedAt >= CONFIRMATION_CEILING_MS` | § 2.1 |

Everything else is `confirmed`. A row with no `stateStartedAt` is `confirmed` — an absent clock
is not proof of staleness.

### 2.1 The clock is unchanged-activity age, and it is not confirmation age

`stateStartedAt` moves only when the projected activity **changes**
(`src/worktree/presenceProjector.ts:691-702`). It therefore measures exactly one thing: **how
long this row has been claiming the same activity.** The ceiling is defined on that, and the rule
is stated in those words — "the state has stood unchanged for N minutes".

**It is not a confirmation clock, and must not be described as one.** The source can switch
between `output` and `hook` while the activity stays `running`, and `stateStartedAt` does not
move when it does. The consequence is concrete, and this design accepts it:

> A row runs on output inference for ten minutes, a hook report arrives and confirms it, and that
> report ages out sixty seconds later — the row is unconfirmed **immediately**, because the
> activity has stood unchanged for eleven minutes. A hook expiry grants no fresh grace period.

That is defensible rather than merely cheap: at the moment the report expires nothing is
confirming the claim, and the state has not changed in eleven minutes. The row says so, and the
hint names the elapsed time honestly. What it is **not** is "five minutes since confirmation was
lost" — that rule needs a source-transition clock the projector does not keep, and adding one is
a host change the accepted option (audit § E3 option 1) rules out. If that rule is ever wanted it
needs its own change and its own field; `stateStartedAt` cannot implement it.

`lastActivityAt` is the wrong clock and must not be substituted. It is
`max(pane.lastOutputAt, stateStartedAt)` (`presenceProjector.ts:704`), so it advances on every
byte — including the bytes of the animation the ceiling exists to see through. A ceiling on
`lastActivityAt` would never fire in exactly the case it was written for.

### 2.2 What it renders

`running (unconfirmed)` is a **member of the presented state vocabulary**, not a footnote on
`running` ([worktree-panel-ui.md](worktree-panel-ui.md) § 7.2). It is presentation only: the
activity value stays `running`, and nothing on the wire changes.

- A **static** glyph, distinguishable by shape from the animated `running` one, so the change
  is legible without colour and survives reduced motion.
- A hint naming the gap in the user's terms — how long the state has stood unchanged, and that
  it was inferred from terminal output rather than reported. Delivered through the delegated
  tooltip widget, like every other hint in this view. Phrased as a **lower bound** ("at least
  N"), because the attribute is written at render and read at hover, which may be an hour later
  and after no repaint: an exact figure would be false by the time anyone saw it. The bound also
  has to be true at the instant it is written, which is why it is "at least" and not "over" —
  the deadline fires *at* the ceiling, so the first hint a crossing writes carries the exact
  figure.
- The hint reaches the **row**, not only the marker. The tooltip widget resolves
  `closest('[data-tip]')` and keyboard focus lands on the row, which walks upward and can never
  reach a descendant span; and while a worktree is collapsed the pill is `aria-hidden`,
  unfocusable and outside the arrow-key set, so the worktree row carries the qualification
  belonging to the longest-standing agent row that produced its glyph.
- The worktree row's leading glyph shows the strongest state among its agents
  (§ 7.2 precedence). `unconfirmed` is a **confidence on `running`, not a rank of its own**: a
  worktree whose only `running` agent is unconfirmed reads as unconfirmed-running, and one
  waiting agent still outranks it.
- **`unknown` outranks it.** A source the presence data reports as failed cannot support a claim
  of running *at all*, so there is nothing left to qualify as merely unconfirmed: the degraded
  check runs before the ceiling and yields `unknown`. The clock never pauses while it does — when
  the failure clears, the row lands on `running (unconfirmed)` on that same update.
- The **collapsed presence pill groups by exact presented state**, so an unconfirmed row is
  counted under its own state. Grouping by the wire value instead would have dropped those rows
  from the pill entirely. This is why the presented vocabulary and the aggregate rank are two
  separate orders: the pill needs every member, the worktree glyph needs a precedence.

## 3. What the ceiling does not change

| Not changed | Why |
|-------------|-----|
| The `activity` value | It stays `running`. The pane *is* producing output; that is true and stays true. Downgrading to `idle` would trade an overstatement for a different false claim, and would move a wire value every other consumer reads |
| The evidence tuple | `activitySource` is unchanged. Confidence is derived, never a field (D20) |
| The protocol | `stateStartedAt` and `activitySource` already reach the view (`src/webview/worktree/worktreeFormat.ts:40-42`). No message, no host, and no shared-rule change |
| `OUTPUT_IDLE_WINDOW_MS` | Untouched. The ceiling sits above it, not inside it |
| External rows | `activitySource: "registry"` is a claim that a session is live, not that a turn is in progress. It carries its own scope marker and is exempt. Applying the ceiling there would mark nearly every external row permanently unconfirmed, which trains the user to ignore the marker — the failure § 4.5 of the panel design warns about |

## 4. Why the terminal tab keeps its pulse

WT-004.0's acceptance reads "the worktree row and the terminal tab derive running from the same
rules and cannot disagree" (`docs/PLAN.v4.md`). **This design narrows that clause, and says so
rather than claiming to satisfy it whole.**

### 4.1 The clause was already narrower than it reads

The two surfaces can already disagree at HEAD, before any ceiling exists. They share the
*inference rule* in `src/shared/paneEvidence.ts`, but not their *inputs*:

- The presence projector lets a fresh hook report override inference outright
  (`src/worktree/presenceProjector.ts:658-665`), so a hook-backed row can read `running` or
  `waiting` on evidence the tab never sees.
- That evidence structurally cannot reach the tab. `src/extension.ts:418` returns early for any
  agent that is not `cursor`, and `AgentActivityStatusMessage.agent` is typed `"cursor" | null`
  (`src/types/messages.ts:1682`).

A Claude pane mid-turn is therefore already capable of a `running` row beside an `idle` tab. The
ceiling does not create that; it inherits it.

### 4.2 What this design preserves, and what it gives up

**Preserved — the narrowed invariant, which is testable:** where activity is *output-inferred*,
both surfaces run the one shared rule and hold the same wire activity value. Neither surface
computes `running` its own way.

**Given up — presentation equivalence:** the two surfaces may render the same running pane
differently, because they are making different claims. The tab's indicator means "this terminal
is producing output" — its own tooltip says exactly that
(`src/webview/TabBarUtils.ts:198-208`) — and that stays true past the ceiling. The worktree row
means "an agent is working in this worktree", which does not.

DESIGN.md § 9 D27 records this as a narrowing, and WT-004.0's acceptance is amended to match
rather than left reading as though nothing changed.

### 4.3 The rejected alternative

Giving the tab the same confidence would mean widening a shipped protocol union and adding an
emitter, so hook evidence reaches a surface whose claim is not false in the first place. It would
also close the § 4.1 gap — which is its real attraction, and why it is deferred rather than
dismissed (PLAN.md Deferred). Revisit it if the tab's indicator is ever restated as a claim about
work rather than about output.

### 4.4 Where the rule lives


The ceiling is a projection over a **presence row**, so it lives with the worktree row's
derivations, not in `src/shared/paneEvidence.ts`. That module is the single home of "what does
`running` mean", shared by the tab and the host precisely so the two cannot answer it
differently; putting a row-only presentation rule inside it would couple the tab to a rule it
does not apply and invite a later change to "fix" the asymmetry by making the tab lie less
usefully. The separation is deliberate and is the reason it is written down.

## 5. Edge Cases

| Condition | Behavior |
|-----------|----------|
| A hook report arrives while unconfirmed | `activitySource` becomes `hook`; the row is confirmed again on the same push. No hysteresis, no cooldown |
| Activity changes (`running` → `idle` → `running`) | `stateStartedAt` resets, so the clock restarts. A genuinely busy pane that goes quiet for 1.5 s and resumes is confirmed again |
| Hook goes stale mid-turn | Inference resumes with `activitySource: "output"`. `stateStartedAt` did not move when the hook took over, so a run already older than the ceiling is unconfirmed **immediately** — no grace period (§ 2.1). Nothing is confirming it, and the state has not changed in that long |
| `waiting` | Never unconfirmed. It is the state that needs a human and it is not derived from output volume |
| `exited` | Never unconfirmed; the process is gone and the row is history |
| Reduced motion | Already static. The unconfirmed shape must still differ from the running shape, so the two are not identical under reduced motion |
| A row crosses the ceiling with no push | The view re-derives confidence on a clock of its own; a row must not stay animated only because nothing else changed. That re-derivation is a render-signature input, so it is the *only* thing that repaints |
| Clock skew or a `stateStartedAt` in the future | `now - stateStartedAt` is negative, so the row is confirmed. A future timestamp never manufactures staleness |

## 6. Testing

### Test Cases

- [ ] `running` + `output` + state older than the ceiling renders the unconfirmed glyph, statically
- [ ] The same row one millisecond under the ceiling still renders the animated running glyph
- [ ] `running` + `hook`, at any age, is never unconfirmed
- [ ] `running` + `registry` (external row), at any age, is never unconfirmed
- [ ] `waiting` and `exited` are never unconfirmed at any age
- [ ] A row with no `stateStartedAt` is confirmed
- [ ] A `stateStartedAt` in the future is confirmed, not unconfirmed
- [ ] A hook report arriving on a row past the ceiling restores the confirmed glyph on that push
- [ ] A row past the ceiling, confirmed by a hook, then aged out of hook freshness is unconfirmed on the very next push — the source change grants no grace period
- [ ] Where activity is output-inferred, the row and the terminal tab hold the same activity value (the narrowed WT-004.0 clause, § 4.2)
- [ ] Activity changing resets the clock, so the row is confirmed again
- [ ] The unconfirmed hint names the elapsed gap and that the state was inferred from output
- [ ] The unconfirmed and running glyphs remain distinguishable under reduced motion
- [ ] A worktree whose only running agent is unconfirmed reads unconfirmed; one waiting agent still outranks it
- [ ] Crossing the ceiling with no tree push still re-renders the row, and re-deriving confidence with no crossing does not
- [ ] The activity value, `activitySource`, and every message shape are unchanged by the ceiling

---

> **Registry**: `CONFIRMATION_CEILING_MS` and the source it applies to are registered in [DESIGN.md](../DESIGN.md) § 10 — do not keep a second copy here.
