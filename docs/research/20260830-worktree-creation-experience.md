---
topic: worktree-creation-experience
created-by: user-requested local-source research
date: 2026-08-30
verified: 2026-08-30
libraries: [orca, spec-kitty]
used-by: []
---

# Research: worktree creation experience

**Scope:** creation ergonomics and initialization only. This deliberately excludes Orca's porcelain/capability/path-normalization parsing layer, already covered by `20260826-orca-git-worktree-mechanics.md`. Sources are the checked-out revisions Orca `9062494f` and Spec Kitty `59e7bea`.

## Answers

### 1. Orca composer controls

| Control (default) | What code does | User problem solved | Anywhere Terminal disposition |
|---|---|---|---|
| **Project selector** (current eligible project) | Project combobox selects the repo context; it also has an **Add project** action and reports empty/missing-project errors. Selecting refocuses the source field. `NewWorkspaceComposerProjectSection.tsx:83-138` | Create into the right repository rather than the currently visible terminal by accident. | **Adopt only when the extension can create across multiple discovered repos.** A single-repo dialog already has its answer. |
| **Run on** (project’s current execution target) | Only appears when host setup/VM recipes make a choice meaningful. It selects local/connected remote host, can start SSH/server/location setup, and can select an ephemeral-VM recipe. `NewWorkspaceComposerCard.tsx:88-104`; `NewWorkspaceComposerProjectSection.tsx:139-164` | Put compute and checkout where the repo/agent actually lives. | **Orca-specific now.** Keep the current local-only dialog until remote worktrees exist. |
| **“Name or Create From” Smart field** (empty; a generated creature name is the final fallback) | A single picker accepts a plain name or a typed selection from GitHub/GitLab review, local branch, Linear/Jira issue; the selected source determines base/link/prompt metadata. The fallback excludes existing and retired generated names. `NewWorkspaceComposerNameSection.tsx:74-105`; `derived-composer-state.ts:160-188` | Avoid separately filling branch, title, issue, and base when work already starts from a ticket/review/branch. | **Adopt incrementally:** branch search first; issue/PR sources only if those integrations exist. |
| **Smart tabs: Smart / GitHub / Branch / Name** (Smart) and **search box** (empty) | Tabs constrain the source dataset; searching and selecting emits a typed source callback (`onGitHubItemSelect`, `onGitLabItemSelect`, `onBranchSelect`, etc.). `NewWorkspaceComposerNameSection.tsx:16-31,86-105` | Fast, intent-led creation rather than memorising branch names. | **Worth adopting:** “Branch / Name” is a strong low-cost improvement; provider tabs are orchestration/product-integration features. |
| **Reuse selected branch** (off, offered only when safe) | Lets an eligible selected local branch be checked out rather than creating a sibling; runtime preserves the exact branch across path retries. `NewWorkspaceComposerNameSection.tsx:35-37`; `orca-runtime.ts:25474-25484` | Resume an existing feature worktree without hand-entering its branch. | **Worth adopting.** |
| **Agent selector** (no agent unless creation path preselects one) | Determines `effectiveCreatedWithAgent` and startup command; the setup wait gate is relevant only when an agent startup is requested. `orca-runtime.ts:25858-25860,26007-26020` | Create a ready-to-work session, not merely a directory. | **Already represented** by “Start an agent”; retain as a clear post-create choice. |
| **Advanced → Name** (empty; shown for Smart-source selection) | Overrides the workspace display/name seed, separate from branch naming. `NewWorkspaceComposerAdvancedSection.tsx:152-168` | Give a human-readable workspace label even when source metadata is terse. | **Worth adopting** only if display name and branch name are distinct concepts. |
| **Advanced → Branch name** (empty; derived name otherwise) | Overrides derived branch naming for Git branch/Smart branch flows. The runtime sanitizes names, checks local/remote conflicts, and retries suffixed name/path candidates up to a bound. `NewWorkspaceComposerAdvancedSection.tsx:170-192`; `orca-runtime.ts:25371-25380,25444-25566` | Preserve team branch conventions or choose a precise branch. | **Already present; retain.** |
| **Advanced → Note** (empty) | Persists a short workspace comment/metadata (`args.comment`). `NewWorkspaceComposerAdvancedSection.tsx:194-209`; `orca-runtime.ts:25865-25867` | Record why a worktree exists without polluting Git. | **Worth adopting** if the worktree list can display/search notes; otherwise skip. |
| **Setup script preview + provenance** (only if effective setup exists) | Displays the resolved command and whether it came from `orca.yaml`, local settings, or both. `NewWorkspaceComposerAdvancedSection.tsx:211-232`; `hooks.ts:86-112` | Prevent a hidden project script from surprising the creator. | **Worth adopting.** Show exact command and source before running arbitrary repo code. |
| **Run setup command** (repo policy default: **run**; alternatives ask/skip) | `run-by-default` resolves to run, `skip-by-default` to skip, `ask` requires an explicit button choice. `derived-composer-state.ts:127,143-151`; `orca-yaml-hook-types.ts:1-3` | Choose dependency/config provisioning without editing config each time. | **Worth adopting** as a tri-state policy/explicit per-create choice; safer than a permanently implicit init. |
| **Wait for setup before starting agent** (**off** / `start-immediately`) | Disabled unless setup will run. When on, setup runner and agent command are sequenced; the agent command is wrapped to wait for completion rather than merely spawned later. `NewWorkspaceComposerAdvancedSection.tsx:248-285`; `setup-policy-decisions.ts:7-11`; `orca-runtime.ts:26007-26020` | Stop an agent racing `npm install`, MCP provisioning, or generated config. | **Worth adopting** with transparent failure state. |
| **Sparse checkout preset** (**Off** / full checkout) | A saved per-repo preset picker: **Off** clears sparse, otherwise it submits its normalized newline-separated directories and matching preset ID; unavailable in the UI for non-local/non-Git projects. `SparseCheckoutPresetSelect.tsx:50-79,139-182`; `NewWorkspaceComposerAdvancedSection.tsx:330-352` | Make a huge monorepo workspace cheaper/smaller. | **Defer** until saved presets and safe sparse lifecycle exist. |
| **Create more** (**off**) | Queues the background creation, keeps the composer open, and resets identity fields; otherwise it closes. `NewWorkspaceComposerFooter.tsx:53-85`; `quick-creation-execution.ts:243-249` | Batch-create several workers/workspaces. | **Nice-to-have; adopt only after main create flow is solid.** |

**Controls intentionally not presented as a path override:** Orca derives the path; its path controls are project/settings-level `worktreeBasePath`, not an arbitrary form field. `configured-worktree-base-path.ts:24-38`; `orca-runtime.ts:25426,25549-25555`. This is a useful guardrail for Anywhere Terminal: show the derived destination, but reserve arbitrary path override for an explicit advanced escape hatch with containment/collision validation.

### 2. Orca setup/init mechanism

| Area | Verified behavior |
|---|---|
| **Where/config schema** | Orca reads **`<repo-root>/orca.yaml`** synchronously; missing, unreadable, or invalid YAML yields no hooks. `hooks.ts:31-45`. Supported top-level schema: `scripts.setup`, `scripts.archive`; `issueCommand`; `defaultTabs[]` (`title`, `color`, `command`); `environmentRecipes[]` (`id`, `name`, `create`/`command`, optional `checkoutMode`, `description`, `suspend`, `resume`, `destroy`/`cleanup`); `worktree.sharedDirectories[]`. `orca-yaml-hook-types.ts:5-42`; `orca-yaml.ts:196-260`. |
| **Project vs local policy** | Script content can be shared YAML, private per-repo local settings, or both; `commandSourcePolicy` chooses `shared-only`, `local-only`, or `run-both`. `hooks.ts:86-112`; `orca-yaml-hook-types.ts:50-60`. The checked source does **not** define a global `orca.yaml`; the project YAML is per repo, while user-local override/policy is persisted per repo. |
| **Environment** | Setup receives `ORCA_ROOT_PATH`, `ORCA_WORKTREE_PATH`, `ORCA_WORKSPACE_NAME`, plus compatibility aliases `CONDUCTOR_ROOT_PATH` and `GHOSTX_ROOT_PATH`; the unattended runner also forces the terminal Git credential-guard policy. `setup-hook-env-vars.ts:7-30`. It runs with the process environment plus these values, with credential prompting suppressed. `hooks.ts:190-202`. |
| **Execution / diagnostics** | Setup is generated under the worktree Git dir as `orca/setup-runner.sh` or `.cmd`, then run in a Setup terminal. Native macOS/Linux uses `/bin/bash`; Windows `ComSpec`/`cmd.exe`; WSL uses Bash in the distro with path-translated env. The in-process fallback times out at two minutes and returns combined stdout/stderr/exit or timeout text; failures log `[hooks] … failed`. `worktree-runner-script.ts:86-158`; `hooks.ts:19-27,157-187,190-219`. The composer previews resolved command/source. `NewWorkspaceComposerAdvancedSection.tsx:211-232`. |
| **Failure semantics** | A setup runner-generation or in-process setup failure does **not** roll back the already-created worktree: it is logged and creation remains successful. `orca-runtime.ts:25957-25962,25964-25975`. This argues for Anywhere Terminal surfacing a persistent “setup failed—open output/retry” state, not falsely reporting failed creation. |
| **Exact wait semantics** | With an agent startup and `wait-for-setup`, Orca makes a setup runner, then replaces the agent startup with a sequenced command that starts only after the runner exits. Without it, setup launches in an inactive Setup tab (or configured split) while the agent starts as soon as Git/metadata creation completes. `orca-runtime.ts:25938-25956,26007-26020`; `worktree-remote.ts:285-304,306-402`. It is a startup gate, not a promise that setup succeeds; runner/startup failures become warnings rather than a rollback. |

### 3. What makes the checkout usable?

| System | Built-in materialization | Consequence for `.env`, `.claude/`, `.vscode/`, `.mcp.json`, local config, `node_modules` |
|---|---|---|
| **Orca** | **Not setup-script-only.** Per-user **Worktree Shared Paths** materializes configured relative paths from the primary: APFS clone-copy on macOS where possible, otherwise symlink; it is free-text and can include files or directories. `WorktreeSymlinksSection.tsx:85-108,133-137`; `worktree-symlinks.ts:309-316`. Repo-shared `orca.yaml: worktree.sharedDirectories` symlinks only existing, gitignored directories—explicitly intended for one-install-serves-all `node_modules`. `worktree-shared-directories.ts:59-109`; `worktree-symlinks.ts:335-345`. A project `.worktreeinclude` is copied (not linked) per worktree, skipping configured links; copy-budget refusals become a warning. `orca-runtime.ts:25879-25910`; `worktree-symlinks.ts:318-333`. | `.env`, `.claude/`, `.vscode/`, `.mcp.json`, etc. are **not automatically copied by filename**. Add each as a local shared path (clone/link), put private-per-worktree material in `.worktreeinclude`, or create it in setup. `node_modules` is best declared in `worktree.sharedDirectories`, but only if it exists and is gitignored. |
| **Spec Kitty** | Active lane creation is principally Git topology plus a per-worktree ownership pre-commit guard and lane test env metadata. `implement_support.py:134-211`. Its older general feature-worktree provisioner seeds docs/templates and links (Windows copies) shared `.kittify/memory` and `AGENTS.md`, then adds overlays to that worktree’s Git exclude. `core/worktree.py:350-431,434-594`. It also merges home and repo `.kitty.env` with precedence real environment > repo > home; the migration seeds a governed non-secret `.kittify/.kitty.env` and comments secret values. `bootstrap/env_file.py:20-29,245-285`; `m_3_2_8_provision_kitty_env.py:102-152,173-199`. | No comparable universal built-in list for arbitrary `.env`/editor/agent config or `node_modules` was found on the modern lane allocator. Its distinctive mechanism is managed `.kitty.env` and workflow overlays, not dependency sharing. |

### 4. Orca path and naming

- **Default placement:** `computeWorkspaceRoot(repo.path, settings)` plus `computeWorktreePath(sanitizedName, repo.path, settings)`; a configured per-project base path resolves either absolute or relative to the repo. Desktop layout is `<workspaceDir>/<name>` or, when `nestWorkspaces` is enabled, `<workspaceDir>/<repoName>/<name>`—so repo-name repetition is optional, not inherent. WSL maps the absolute desktop root to `~/orca/workspaces`; remote default is a sibling `<repo-parent>/<repoName>-<name>`. There is no create-form destination override. `worktree-logic.ts:79-179,181-219`; `orca-runtime.ts:25426,25549-25555`.
- **Name:** sanitize requested name; derive branch from explicit override or configured prefix/username policy. If blank, a globally unique generated creature name is chosen and retired generated names are avoided. `orca-runtime.ts:25371-25380,25436-25463`; `derived-composer-state.ts:160-188`.
- **Collision:** it retries suffixed branch/name candidates, checks local and remote branch conflicts, optionally reuses a safe selected branch, and requires the derived path not to exist; exhaustion reports a clear error. `orca-runtime.ts:25444-25566`.
- **Repo-name duplication:** it is a **layout setting outcome**, not a hard-coded “repo/repo-name” rule. The runtime asks `computeWorktreePath` using repo + settings; do not infer a fixed path shape from the dialog. `orca-runtime.ts:25426,25549-25552`.

### 5. Sparse checkout

- Orca exposes a per-repo saved-preset picker whose exact options are **Off** (full checkout) plus configured presets; a selected preset supplies its normalized repo-relative directories and ID. Names are case-insensitively unique and <=80 characters. `SparseCheckoutPresetSelect.tsx:50-79,139-182`; `branch-start-point-actions.ts:75-88`; `worktree-remote.ts:1686-1705`.
- Creation uses `worktree add --no-checkout`, cone sparse init/set, then branch checkout; sparse failure rolls back the newly created worktree/branch (or explicitly reports manual cleanup needed). `worktree-remote.ts:2368-2456`; `git/worktree.ts:1074-1140`. Its purpose is checkout reduction, not a security boundary. **Do not port yet**: one-off directory entry without preset management, cleanup/remediation, and visible “what is missing?” affordance creates fragile worktrees.

### 6. Spec Kitty: genuine differences worth stealing

| Difference | Why it matters / portability |
|---|---|
| **Identity-stable paths/branches** use a mission slug plus ULID fragment and lane suffix, rather than a local incrementing name. `branch_naming.py:195-217,389-432,440-485` | **Adopt the idea:** collision-resistant stable identifiers (or a short random suffix) beat retry-only names when concurrent creators are likely. |
| **Fresh / reuse / recovery are separate states.** A missing directory with surviving branch is pruned and reattached; failed planning merge removes only the new worktree but retains its branch for recovery. `worktree_allocator.py:473-500,522-562,946-966,984-1027` | **Adopt:** expose “reuse existing branch,” “recover registration,” and preserve evidence on failure rather than blindly retrying `git worktree add`. |
| **`--base` is contractual.** It is refused for reuse, recovery, dependency-bearing lanes, or an ancestry-incompatible base rather than silently ignored. `worktree_allocator.py:134-160,293-402`; `implement.py:1893-1946` | **Adopt:** validate and explain mutually exclusive base/source choices in the dialog. |
| **Lane ownership/coordination topology.** One clean lane worktree can be reused across sequential work packages; a separate coordination worktree owns status. `implement_support.py:55-105,159-225`; `coordination/workspace.py:191-281` | **Skip for a VS Code worktree dialog.** This is a workflow engine, not creation ergonomics. |
| **Sparse is authorization, not performance.** Non-cone sparse checkout hides two mission status files from lane worktrees; managed state is classified and safely remediated. `coordination/workspace.py:317-399`; `git/sparse_checkout.py:56-95,130-225`; `git/sparse_checkout_remediation.py:223-314` | **Skip unless Anywhere Terminal introduces a separate write-authority control plane.** The managed-vs-user sparse-state distinction is worth copying if sparse support is later built. |

### 7. Worth adopting vs Orca-specific skip

**Worth adopting next**

1. **Setup lifecycle, not just “after creating”:** detect/show repo setup command and source; per-create Run/Skip; persist output and offer retry; optional agent-start gate. `hooks.ts:86-112,190-219`; `orca-runtime.ts:25913-26020`.
2. **Materialization policy:** per-repo, validated lists for **link/clone-copy** and **copy-private** paths. Start with `.env` and `.mcp.json` suggestions, never auto-share secrets; explicitly offer `node_modules` sharing only as an opt-in, gitignored directory. `WorktreeSymlinksSection.tsx:85-108`; `worktree-shared-directories.ts:59-109`; `worktree-symlinks.ts:318-345`.
3. **Create-from branch + reuse branch:** one searchable branch picker and an explicit reuse/new-branch decision, backed by clear collision resolution. `NewWorkspaceComposerNameSection.tsx:86-105`; `orca-runtime.ts:25444-25566`.
4. **Clear derived-path safety:** keep a visible destination preview; apply strict containment/existence checks and controlled suffixing. `orca-runtime.ts:25549-25566`.

**Orca-specific / skip**

- Project selector, remote execution host, provider-specific GitHub/GitLab/Linear/Jira creation, VM recipes, default terminal tabs, and batch “Create more” optimise Orca as a multi-project orchestrator. `orca-yaml-hook-types.ts:24-42`; `NewWorkspaceComposerNameSection.tsx:16-31`.
- Spec Kitty’s lanes, dependency merge graph, coordination branch/worktree, and sparse status-file access boundary are workflow-engine architecture, not a single-workspace VS Code extension feature. `worktree_allocator.py:405-430,611-728`; `coordination/status_transition.py:193-314`.

## Recommended Approach

- Add **Setup** to the current dialog’s Advanced section: read a repo-scoped config, preview command/source, Run/Skip default, output panel/retry, and a disabled-until-Run “wait before agent” toggle.
- Add a **Materialize local files** repo setting, split into link/share versus copy-per-worktree; suggest rather than automatically carry `.env`, editor, or MCP files.
- Replace bare branch text with **Create from: new name / existing branch**, retain the path preview, and make collision/reuse behavior explicit before adding ticket/PR integrations or sparse checkout.

## Confidence

**High** — claims are traced to the checked-out UI, runtime, schema, and tests/source paths above. Spec Kitty’s legacy provisioner is explicitly separated from its active lane allocator to avoid overstating its role.
