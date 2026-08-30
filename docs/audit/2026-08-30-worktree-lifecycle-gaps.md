# Audit — worktree lifecycle gaps beyond create

**Date**: 2026-08-30
**Companion to**: `2026-08-29-worktree-ui-vs-orca.md` — that audit covers the tree view and the
create dialog's *visuals*; this one covers lifecycle *behaviours* the create redesign does not reach.
**Evidence**: `docs/research/20260830-worktree-creation-experience.md`,
`20260830-git-worktree-developer-pain.md`, `20260830-create-worktree-dialog-ux.md`, plus source reads.

Each item states the current behaviour, the prior art, and the decision that is actually open.
Nothing here is scheduled; this is a list of things we have not decided.

---

## A. Removal has no safety model

**Current.** `removeWorktree` shells out to `git worktree remove`, adding `--force` on request and a
second `--force` for a locked worktree (`src/worktree/worktreeMutations.ts:125-164`). Confirmation
names a count parsed from git's stderr dry run (`:83-96`). That is the whole model: git refuses, or
git obeys.

**Prior art the research turned up.**

| Source | Rule |
|---|---|
| get-shit-done `bin/lib/worktree-safety.cjs:577-799` | An orphan is reaped only with **three** proofs: lock old enough, owning PID provably dead, branch merged into the real default branch. Failure to prove any one preserves the worktree — **fail closed**. |
| cmux `Sources/ExtensionWorktreePrototype.swift:91-325` | Validates device/inode identity, top-level checkout, expected branch ref *and* commit, clean tracked state, and that only its own generated files are untracked. **Revalidates after every await**, restores moved artifacts on failure, then deletes the branch with an expected-old-value guard. |
| gsd-core `workflows/remove-workspace.md:39-100` | Blocks on dirty children, requires typing the workspace name, and refuses to delete the parent if any child unregister failed. |

**Open decisions.**

- **A1.** What must be proven before the UI *offers* delete versus requires force? We have none of
  the three proofs today.
- **A2.** Do we delete the branch too? If so, an expected-old-value guard is the difference between
  removing a merged branch and silently discarding someone's commits.
- **A3.** A worktree may host running terminals and a live agent. Git cannot know this; we can. No
  current check.
- **A4.** Partial failure. gsd-core's rule — do not delete the parent when a child failed — has a
  direct analogue if we ever remove more than one worktree at a time.

Note this is the *more* dangerous surface and it has had less design attention than create.

---

## B. Reuse and recovery are not modelled

**Current.** The only outcome for a taken destination is a numeric suffix: the host resolves the
first free `<base>-N` and the form states it (`src/providers/WorktreeHost.ts:962-978`). Every
create is a fresh create.

**What is missing**, each of which the research found treated as a distinct first-class state:

| State | Prior art |
|---|---|
| **Reuse an existing branch** rather than making a near-duplicate | spec-kitty `worktree_allocator.py:473-500`; claudekit attaches an existing remote feature branch (`worktree.cjs:935-1004`) |
| **Reattach a pruned registration** — the branch survived, the registration did not | spec-kitty `worktree_allocator.py:522-562` |
| **Recover crash debris** — a directory exists with no `.git` pointer | gsd-2 removes it as debris and continues (`worktree-manager.ts:231-340`) |
| **Branch already checked out elsewhere** — git permits one worktree per branch | Refused by git at submit today; cmux surfaces the owning directory in the picker (`CLI/cmux_open.swift:2031-2173`) |

**Open decision.** Which of fresh / reuse / recover are first-class in the UI, and which stay as
error messages? Today all four land as a git failure after the user has committed to the action.

spec-kitty's related rule is worth naming: **`--base` is contractual** — it is *refused* for reuse,
recovery, and ancestry-incompatible bases rather than silently ignored (`worktree_allocator.py:134-160`).
Our Base ref field is currently free text with no such validation.

---

## C. No branch-name generation

**Current.** The user types a branch name or there is no worktree.

**Prior art.** VS Code's own Git API exposes `generateRandomBranchName()`
(`extensions/git/src/api/git.d.ts:333`). gsd-2 generates adjective–verb–noun names
(`worktree-name-gen.ts:1-48`); Warp uses collision-checked desert words
(`crates/warp_util/src/worktree_names.rs:215-258`); orca generates creature names and **retires used
ones** so they do not recur; botmux offers optional AI naming that is bounded by a timeout, sanitised,
and falls back deterministically (`services/worktree-slug-ai.ts:31-82`).

**Open decision.** Do we want generation at all — and if so, is it a placeholder the user overwrites,
or an explicit action? Botmux's bounded-with-deterministic-fallback shape is the safe pattern if the
answer involves a model.

---

## D. `[Configure…]` has no target

The redesign brief adds a **Bring over** section whose empty state offers `[Set up…]`. Nothing exists
behind it.

**What exists.** The asimov skill already implements the full model — `asimov/worktree.yaml` with
`copy` / `link` / `ports` / `setup`, strict-validated
(`.agents/skills/asimov/lib/git/worktree-config.ts:23-32`), injecting `ASIMOV_CHANGE_ID`,
`ASIMOV_BRANCH`, `ASIMOV_WORKTREE_PATH`, `ASIMOV_MAIN_ROOT` (`worktree-setup.ts:127-132`). Separately,
`worktree link` auto-symlinks agent-tooling containers only — `.agents/skills`, `.claude/skills`,
`.claude/agents`, `.claude/commands`, `.opencode/agents`, `.opencode/plugins` — deliberately *not*
all of `.claude`, so `settings.json` is never touched (`worktree-link.ts:21-28`).

**But this repo has no `asimov/worktree.yaml`.** The mechanism is unused here, which is why the
setup steps are run by hand today.

**Open decision.** What does the extension read?

1. `asimov/worktree.yaml` — richest, already built, but makes a VS Code extension depend on a skill
   that is gitignored in worktrees (`docs/research/` note in memory: `.claude/skills/asimov-*` is
   excluded, so a fresh worktree does not contain it).
2. A VS Code task with `runOn: "worktreeCreated"` — **native**, already in the task schema
   (`vscode/src/vs/workbench/contrib/tasks/common/jsonSchema_v2.ts:387`), no new schema to invent,
   and portable to any project.
3. Our own extension setting.

Option 2 is the one the research recommends precisely because it avoids inventing a bootstrap schema.
Options 1 and 2 are not exclusive — detect either and name the source in the UI.

---

## E. Copy-vs-link default — RESOLVED

**Decision (2026-08-30, user):** `.env`-class files are **copied** by default; symlink is an explicit
per-path opt-in.

**Rationale.** An agent editing a linked `.env` inside a worktree writes through to the main
checkout and every other worktree sees it; branches also legitimately need different ports and
endpoints. Safest known default is claudekit's: auto-copy `.env*.example` → `.env*`, and require an
explicit allowlist for real secret files (`worktree.cjs:418-459`).

**Follow-up.** Whatever config surface D settles on must default to copy, and the UI must mark linked
paths as writing through to main. `node_modules` is the deliberate exception where linking is the
point — but the better answer there is pnpm's `virtualStoreType: global` plus a per-worktree
`pnpm install`, not a linked directory.

---

## F. Ports are allocated but never surfaced

`worktree-ports.ts` allocates a free TCP port per configured name, writes `.env.worktree`, and
exports `ASIMOV_PORT_<NAME>`. Port collision is ranked pain **#3** in the research — high frequency,
blocking severity, because separate directories do not namespace OS resources.

Nothing in the extension surfaces this, and nothing warns when two worktrees will fight over a port.

**Open decision.** Does the extension own port allocation, or only display what the config allocated?

---

## G. Path scheme — deferred, not resolved

`resolveCreateRoot` defaults the root to `<repo>/.claude/worktrees`
(`src/worktree/createPath.ts:220`) while the host prefixes the directory with the repo label
(`src/providers/WorktreeHost.ts:970`), so the repo name appears twice:
`…/cyberk-skills/.claude/worktrees/cyberk-skills-huy`.

The prefix is only meaningful when the root is a *shared* parent — which is exactly the case
`modeOfParents` detects (`createPath.ts:246-268`). Orca's equivalent repetition is a **settings
outcome** (`nestWorkspaces`), not a hard rule (`worktree-logic.ts:79-179`).

**Status.** Explicitly deferred by the user on 2026-08-30 to keep the redesign moving. Recorded here
so the redesign is not blamed for it later.

---

## H. PR-driven creation — a reversed deferral

`2026-08-29-worktree-ui-vs-orca.md` §C records create-from-issue/PR/URL as **deferred by design, not
debt**, citing `PLAN.md:390-405`.

On 2026-08-30 the user asked for a PR flow in the create-dialog design brief. That reverses the
deferral for the PR case specifically (issue/URL creation remains deferred).

**Prior art.** `opencode pr <number>` checks out a deterministic `pr/<number>`, configures a fork
remote when needed, and imports a session share URL from the PR body
(`opencode/packages/opencode/src/cli/cmd/pr.ts:54-113`). oh-my-pi probes both registered worktrees
and on-disk paths, trying `-2` through `-100`, and sanitises fork remote names
(`packages/coding-agent/src/tools/gh-pr-checkout.ts:48-115`).

**Action required.** PLAN.md's Deferred section must be updated, or the brief's PR screen is
exploration only and must not be read as an accepted scope change.

---

## Summary — what is actually open

| # | Item | Kind |
|---|---|---|
| A | Removal safety model (proofs, branch deletion, live processes, partial failure) | Design + behaviour, none exists |
| B | Reuse / reattach / recover as first-class states; contractual `--base` | Behaviour |
| C | Branch-name generation | Product decision |
| D | What config the Bring-over section reads | Architecture — blocks the redesign |
| E | Copy default | **Resolved**; config must follow |
| F | Port allocation ownership | Product decision |
| G | Path scheme repetition | Known bug, deferred |
| H | PR flow reverses a recorded deferral | Plan bookkeeping |

**D is the only one that blocks the create-dialog redesign.** The rest can be sequenced after it.
