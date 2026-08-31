# Proposal: report-what-was-checked-before-confirming

## Why

`docs/design/worktree-removal.md` § 1 says removal is presented as **a report, not a form**. Today
it is neither. The context menu's `Remove Worktree…` posts an unforced `worktreeRemove` and the host
acts on it: when nothing needs confirming, the worktree is deleted on one click with no dialog at
all. The ellipsis in the label promises a dialog that does not exist.

A report is shown only on the unhappy path — the host answers `blocked`, the panel renders an error
notice with a `Force remove…` action, and that opens `WorktreeRemoveDialog`. So the user sees a
report exactly when they were going to be stopped anyway, and sees nothing when the deletion is
about to just happen.

The dialog that does exist renders a hand-picked blocker list — tracked files, untracked files, idle
panes, external agents, lock state. § 2.1 asks for the opposite: every check with its outcome,
passed ones included, so a warning is legible against what else was verified rather than floating
alone. The host already sends exactly that (`RemovalCheck { id, cls, outcome, count?, detail? }`);
the panel discards most of it.

There is also no typed confirmation anywhere in this webview, so § 2.4's rule — a speed bump for the
cases that earned one — has nothing to govern.

## Scope

- Assess without acting, so the report can be shown **before** anything is deleted.
- Render every check the host sent, with its outcome, passed and `notApplicable` included.
- Gate the typed confirmation on the check **class the host already puts on the wire**, so the
  safety rule is not re-derived in the webview.

## Non-goals and must-nots

- **Branch deletion is not in scope.** § 5 and its guard belong to WT-013.3, which depends on this.
- **No check is added, removed, or reclassified.** The assessment engine, its outcomes and its
  classes ship as they are; this change renders what it already produces.
- **The webview must never decide a removal is safe.** Refusal, confirmability and class come from
  the host on every path. A rule implemented in two places is a rule that will disagree with itself.
- **Typing never manufactures a proof** (§ 2.2). A typed confirmation authorizes confirmable risk
  and can never unlock a proof-gated option.
- **No `node:fs` deletion is introduced.** `pnpm run gate:fs-deletion` is part of this change's
  Verify Gate, not only the build's.

## Appetite

M. The assessment engine, the check catalogue, the classes and the dialog shell all exist. The work
is one read-only wire round trip, a rendering rewrite driven by the check list, and one new input.

## Risk

The sharpest one is that assessing mints force authority: the fingerprint that authorizes a forced
removal is issued today by the blocked path, and moving the report earlier means an assess issues
one. That is a deletion-authority door, and this project has twice shipped one that a retired or
replayed message could walk back through. It is carried as an obligation-ledger row in design.md
with a witness rather than an assertion, and the answer is that a fingerprint is not authority on
its own — § 3 re-evaluates against fresh evidence immediately before the destructive command, and
redemption is single-use.

Second: `worktreeRemoveAssess` / `worktreeRemoveAssessment` are documented in
[worktree-rpc.md](../../../docs/design/worktree-rpc.md) § 2.5 but were never implemented. This
change implements the documented contract rather than inventing one — but the doc and the code have
been out of step, so the doc is verified against what ships rather than trusted.
