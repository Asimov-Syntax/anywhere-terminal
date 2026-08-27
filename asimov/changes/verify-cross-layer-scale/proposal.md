# Proposal: verify-cross-layer-scale

## Why

Six phases of the worktree subsystem each verified their own behaviour, but nothing verifies the
sixteen truthfulness invariants of `docs/DESIGN.md` § 8.4 *as a set*: no test cites one, and no
check fails when one loses its coverage. Worse, the invariants that matter most are the ones no
single-layer test can prove — a hook event landing a pane idle without claiming a completed turn
crosses four layers, and unit tests at either end of that pipeline can both pass while the
composition is broken. The two design docs' Quality Criteria budgets have never been measured at
all.

## Appetite

L (≤2w)

## Scope

### In scope

- Executable traceability for the § 8.4 invariants: every invariant maps to a covering test, and
  losing that coverage fails a check rather than going unnoticed.
- The composed cross-layer scenarios the invariants actually span — the work the blueprint means
  by "cannot live inside any single feature task".
- Deterministic per-rebuild **cost** envelopes at the documented fixture sizes, in the unit suite.
- The two wall-clock **latency** budgets, as a separate bench command with a real fixture repo —
  not as timing assertions inside the unit suite.
- Publishing the render cap's value so other documents can reference it.
- The pre-existing `extension.worktreeAssembly` flake — diagnosed, then fixed or contained visibly.
- Removing the literal NUL bytes that make five sources opaque to every grep-based tool.

### Out of scope

- New presence, model, or protocol behaviour. Clauses 3, 4 and 5 already hold; this change proves
  them and closes the gaps, it does not redesign.
- Implementing the render cap. It works today (`WorktreeView.test.ts:217`); only its value is
  unpublished.
- Tree virtualization (DESIGN.md § 9 D14) — the cap is the accepted answer.
- `src/agentHooks/AgentHookController.ts` and `src/agentHooks/install/**`, change-wide. WT-006.2
  is rewriting that tree in another session.

## Risk Level

MEDIUM — mostly additive test surface, but WT-007.1 cannot honestly be marked `done` from inside
this change (see below), and a wall-clock budget can flake where a counting assertion cannot.

## Completion constraint

`docs/PLAN.md:358` — WT-006.3 depends on WT-006.2, which is `in_progress` in another session.
WT-007.1 therefore depends on it transitively, and its acceptance says *every* invariant. The
invariants owned by the peer's tree cannot be covered from here, so this change **must not set
WT-007.1 to `done`**. It lands the other nine tenths and leaves that task `in_progress` with the
frozen deferred set naming exactly what remains. Calling that "not a narrowing" would have been
false; it is a narrowing, and it is recorded as one.
