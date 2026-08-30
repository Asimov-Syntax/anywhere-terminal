# Proposal: land-one-wire-contract-for-create-and-removal

## Why

Every UI and execution task in Phase 12 and Phase 13 reads the same three message shapes — the
create mode, the provisioning offer, and the removal assessment — and today's wire cannot express
any of them. Landing the contract first is what stops it being discovered, differently, three
tasks in.

Two of its properties are safety rules expressed as types rather than as validators that can be
forgotten: `baseRef` is structurally absent from the modes that must refuse it, and a provisioning
selection carries host-issued ids against a host-held offer rather than command text.

## Appetite

M (≤3d)

## Scope

### In scope

- The create request's branch mode, destination disposition, and after-create value, as unions
  that travel unflattened from the webview to the mutation service.
- Mode- and disposition-dependent path validation, replacing today's blanket
  "must not exist or be empty".
- The provisioning offer and its ids-only selection, as types with the offer-id round trip stated.
- The removal assessment as per-check class and outcome, projected from the assessment the host
  already computes, with the legacy boolean record deleted.
- The branch-delete offer and request shapes.

### Out of scope

- **Any new create mode reaching the UI.** `reuse`, `reattach` and `adopt` become expressible; the
  dialog still produces `fresh` and `fresh-detached` only. WT-012.7, WT-012.8 and WT-012.15 build
  the surfaces.
- **Producing a provisioning offer.** No provider is read here and no offer is issued; WT-012.1 and
  WT-012.3 do that. The types land without a producer, which is the point of a contract task.
- **New removal checks.** Ignored runtime material (removal § 2.3), the orphan proofs (§ 4) and the
  merge proof are WT-013.1's and WT-013.2's. This change projects the checks that exist today.
- **Rendering a passed or `notApplicable` check.** The panel keeps showing exactly the lines it
  shows now; WT-013.4 makes the report legible.

### Must not

- Flatten a union at a boundary. A mode that arrives as `{ kind: "reuse" }` and is handed on as
  `{ branch, baseRef: undefined }` has had its safety property deleted in transit, and the task
  that adds the reuse UI would have to re-establish it.
- Keep the legacy blocker record beside the check model. Two encodings of one safety rule will
  disagree, and the one that disagrees silently is the one on the destructive action.
- Hand-roll path containment. `src/utils/pathBoundary.ts` is the only definition in `src/`.
- Change what the user sees, beyond the one repair the contract forces. A new-branch create with no
  base ref starts working (design.md D2, `specs/worktree-panel/spec.md`). Everything else is
  invisible: a diff in the rendered removal list is a defect, not a bonus.

## Risk Level

MEDIUM — the diff is wide (the create path from dialog to git, and the whole removal report) and
one step is deliberately behaviour-changing: it repairs a create that fails today. Everything else
is covered by suites that already exist. The two risks are a silent render regression in the removal
dialog — which is why the projection is verified against the current rendered output rather than
against the new types — and the repair being landed without a test that would catch its return.
