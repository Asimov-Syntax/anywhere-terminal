# Design: make-the-create-dialog-explain-itself

## Decisions

### D1: Labels name the immediate effect, and hints name the consequence

The provisioning action reads **Save current choices as defaults** — no ellipsis, because it writes
immediately rather than opening another interface. Its note says the active source and selected copy/link choices become repository defaults; setup
and ports stay on this create.

The after-create select keeps its four short labels. One visible sentence below it changes with the
selection:

| Choice | Consequence sentence owns |
|---|---|
| Nothing | No terminal, folder, or agent is opened |
| Open a terminal here | A terminal opens in the created worktree |
| Start an agent | The selected agent starts in the created worktree; the existing setup-wait control owns sequencing |
| Open the folder | The secondary choice says add-to-workspace or new-window |

The mode and collision sentences already say create/reuse/repair/adopt and taken→suffix directly;
they remain visible and singular rather than being repeated in a new summary.

### D2: Useful defaults are bounded by the safe posture already offered

On the initial repository, select the first agent with an explicitly non-dangerous posture without
reordering the displayed list. If one exists, initialize `afterChoice` to `agent`; the existing
`initialPosture` selects that posture. An agent with no posture axis is UNKNOWN, not safe evidence.
If no explicit safe posture exists, initialize to `terminal`.

A repository switch preserves the current after-create choice while it remains offered. If it
withdraws the agent choice, the existing rebuild falls back to terminal rather than Nothing. The
agent box keeps a selected agent id where the next repository also offers it; otherwise it selects
that repository's first explicit-safe agent, without changing display order.

No agent executable, provider, or posture is invented: the dialog consumes the host's existing
launchable-agent list, and the existing placeholder still blocks submission where only dangerous
postures exist and the user manually selects that agent.

### D3: The submit gate has one priority-ordered explanation

Compute the disabled reason from the same booleans that set `createBtn.disabled`, in this order:

1. branch held or branch/ref validation error;
2. required branch/ref missing;
3. branch/destination selection not yet checked by the host;
4. destination absent or stale;
5. debris assessment/authorization pending;
6. base ref unresolved;
7. permission posture unchosen.

A `.wt-create-disabled-reason` line is visible only while disabled, carries `role="status"` with a
polite live region, and is the button's `aria-describedby`. This is one derivation beside the
existing gate, not a second validation system.

### D4: The destructive label describes deletion; the internal mode remains recover

The checkbox reads **Clear existing folder and create here**. The note continues to name the exact
path and bounded entry list from the host-issued debris evidence. `recover` remains the internal wire
mode; changing its name would churn a safety-reviewed protocol without improving what the user sees.
The checkbox continues to reset unchecked when its offer disappears or changes.

### D5: Repository-derived suggestions are a dependent change

This change deliberately consumes only host-issued provisioning and agent offers. Detecting `.env`
files or package-manager lockfiles creates a new evidence source and a new host-held suggestion
lifecycle, so `suggest-worktree-initialization` follows this change rather than hiding that owner in a
label patch.

## Obligation Ledger

| Claim | Semantics | Defeater | Witness/check | Disposition |
|---|---|---|---|---|
| The default never grants dangerous launch authority | `agent` is the initial action only when the selected agent has an explicitly non-dangerous posture; no-axis is unknown and ineligible | First agent is no-axis or dangerous-only while a later agent is safe; every agent is unknown/dangerous-only; no agents exist | Dialog tests for mixed order, no-axis-only, dangerous-only, no-agent, safe posture, and repo-switch withdrawal; agent-box placeholder tests remain green | supported |
| Destructive clearance remains explicit | The user-facing label says clear, the exact path/content warning remains visible, and the checkbox starts/reset unchecked; host-issued authorization remains mandatory | Rename makes the action sound safe; default checking bypasses deliberation; note loses the exact path | Dialog test asserts direct label, unchecked state, path and entries; existing debris authorization/service tests run unchanged | supported |
| A disabled reason cannot disagree with the gate | The reason is selected from the same local predicates immediately before assigning `createBtn.disabled` | A second validation path enables or explains a different state | Parameterized dialog test exercises each gate and the enabled state, asserting both button and associated reason | supported |

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| Initial after-create choice | An unknown or dangerous posture becomes an implicit default | Choose agent mode only from an agent with an explicitly non-dangerous posture; retain the dangerous placeholder for manual choices (D2) |
| Repository switch | A later repo silently reapplies defaults over a user's choice | Default only at construction; preserve available choice and use terminal only when agent is withdrawn (D2) |
| Recover checkbox | Clearer wording accidentally weakens the existing authorization boundary | Change text only; keep the unchecked/reset logic and exact evidence-derived note; run debris authorization integration tests (D4) |
| Disabled CTA | Explanation drifts from actual enablement | Derive both from one predicate block and cover each arm in one parameterized suite (D3) |
| Dialog height | Default agent mode reveals agent, permission, prompt and setup-wait controls and can move actions below a short viewport | Keep one dynamic after-action line and one disabled reason, and make the existing dialog action row sticky inside the scroll container; test the action row remains present in a short-height fixture |
