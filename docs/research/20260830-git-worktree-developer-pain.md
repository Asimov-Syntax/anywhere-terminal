---
topic: git-worktree-developer-pain
created-by: user research request
date: 2026-08-30
verified: 2026-08-30
libraries: [git, pnpm, worktrunk, conductor, cursor, claude-code]
used-by: [create-worktree-feature]
---

# Research: git worktree developer pain

## Answers

### The fundamental boundary

`git worktree add` creates another checkout from **tracked Git state**. It shares Git's object/ref database, but does not copy untracked or ignored filesystem state. That is intentional, not a missing Git option. Thus a fast new checkout can be an un-runnable application. Git offers no `post-worktree-add` or removal hook; its documented closest hook is `post-checkout`, which runs for `git worktree add` (unless `--no-checkout`) with `$1` as the all-zero ref and `$3=1`. A wrapper or a `post-checkout` script is necessary for lifecycle automation. [Git hooks](https://git-scm.com/docs/githooks) [git-worktree](https://git-scm.com/docs/git-worktree)

### Ranked pains — qualitative frequency × severity

Rank is based on repeated first-class support and issue reports across Conductor, Cursor, Claude Code, Vibe Kanban, Worktrunk, pnpm, and Claude Squad; it is not a representative telemetry survey.

| Rank | Pain | Frequency × severity | Why it actually hurts / scope |
|---:|---|---|---|
| 1 | Ignored runtime config: `.env*`, local secrets, certificates, `.npmrc`, `.envrc`, local agent/MCP settings | **Very high × blocking** | App/startup/auth/database commands fail immediately; agents commonly cannot infer or recreate secret values. A new worktree cannot include this state from Git. Conductor, Claude Code, and Vibe Kanban all added explicit copy mechanisms for it. |
| 2 | Dependencies absent: `node_modules`, Python venv, Rust target cache, Ruby/Bundler, generated toolchains | **Very high × high** | Cold install can be slow, bandwidth-heavy, and may run native builds. A package or lockfile change means the directory is branch-specific. This is most visible when multiple agent worktrees start concurrently. |
| 3 | Parallel runtime collisions: HTTP/HMR ports, debugger ports, Docker Compose project/container/volume/network names, databases | **High × blocking/confusing** | Separate directories do not namespace OS resources. One server either refuses to bind or attaches a browser/agent to the wrong branch; shared DB mutation invalidates isolation. Worktrunk provides deterministic hashed ports; Conductor exposes a workspace port. |
| 4 | Per-worktree bootstrap: migrations, generated clients, submodules, Git LFS/filter output, build steps | **High × high** | The tracked source may not be directly runnable. Git submodules need initialization; local Git filter config can matter. A setup script is the only general solution because these actions are commands, not files. |
| 5 | Build/tool caches: `.next`, Vite/Webpack cache, `dist`, `.turbo`, `target`, `__pycache__`, language servers | **High × medium** | Cold starts and disk use are painful, but cache keys commonly include absolute paths, source/lockfile state, platform, or configuration; stale/shared cache causes confusing misbuilds. Prefer tool-managed/shared content caches, not a linked output directory. |
| 6 | Editor/LSP state and window state | **Medium × medium** | VS Code opens a different folder; language servers re-index and workspace-local settings/extensions may differ. `.vscode/settings.json` is tracked in many repositories, but locally ignored settings are not. It is latency, not normally correctness. |
| 7 | Agent-specific local state | **Medium and rapidly rising × high** | Gitignored `CLAUDE.md`/`AGENTS.md`, `.claude/`, `.cursor/`, `.mcp.json`, credentials, permissions, and noninteractive environment loading may be absent. Agent instructions and MCP configuration determine behavior, while credentials must not be indiscriminately copied. |
| 8 | Git config/hooks assumptions | **Medium × medium** | Linked worktrees share common Git metadata and normally share hooks, but config may be conditioned on path, `core.hooksPath` can override it, and `extensions.worktreeConfig` allows per-worktree config. A repo-local hook might not bootstrap the way a team expects. |
| 9 | Disk growth, stale worktrees, and process cleanup | **Medium × medium/high over time** | Each worktree retains source, dependency layout, outputs, terminals, and possibly containers. Git can identify/prune stale metadata, but cannot safely stop arbitrary processes or know external resources. Worktrunk and agent products add explicit cleanup lifecycle. |
| 10 | Lockfiles | **Low as a missing-file problem; high if mishandled** | Lockfiles are normally tracked and arrive automatically. They must **not** be copied from another checkout. If branch lockfile differs, copying/install sharing can silently produce a dependency tree that does not match the branch. |

Other recurring constraints: only one linked worktree may check out a given branch; submodules and LFS may need explicit initialization; each `direnv`/`mise` path needs a trust decision; and worktree locations/path names can affect source maps, test snapshots, Docker mounts, and tools that bake absolute paths.

## Symlink vs copy vs reinstall

The winning rule is not “always link” or “always copy”: classify the thing by mutability, branch dependence, secret sensitivity, and whether its producer already supplies a safe shared cache.

| Class | Default | Why | Link failure modes | Copy failure modes | Reinstall/regenerate failure modes |
|---|---|---|---|---|---|
| `.env`, `.env.local`, certificates, local secret JSON | **Copy**, with an explicit opt-in “share by symlink” | A worktree should own a mutable local overlay; copying preserves isolation. Commit only the pattern list, never secret data. | An agent editing an apparent local `.env` edits the primary checkout through the link. A branch can require different endpoint/port/feature values. Deleting/rewriting can affect all worktrees. | Secrets are duplicated on disk; rotation drifts across trees; a stale file can point at the wrong DB. Avoid overwrite of an already-worktree-specific file. | Impossible without a secret manager or developer input; fetching can prompt/authenticate. |
| Ignored dot-config dirs: `.claude/`, `.cursor/`, `.vscode/`, `.mcp.json`, `.envrc`, `.tool-versions`, `.npmrc` | **Copy small mutable config; commit portable config; script/fetch credentials; optional selected symlinks** | Configuration often has path, port, permission, or agent-specific state. Tracked `CLAUDE.md`, `AGENTS.md`, `.vscode/settings.json`, `mise.toml`, `.tool-versions` need no special treatment. | Shared agent permissions/config can leak a dangerous approval or have one agent change another agent’s behavior; `$PWD` and relative path assumptions can resolve to the primary tree. A shared `.envrc` gives a real shell access to shared secrets. | Local machine config and credential material proliferate; ignored config can be stale when schemas change. | Can safely render deterministic config, run `direnv allow` / `mise trust`, or retrieve secrets; cannot safely reconstruct personal preferences. |
| `node_modules` | **Do not manually symlink the root. Run the package manager per worktree; share its store/cache.** For pnpm 11.23+ use its global virtual store when all agents share a trust boundary. | Each branch needs dependency resolution matching its lockfile, while package bytes can be shared. `pnpm install` creates correct branch layout cheaply from a content-addressable store. | Root link fails when lockfiles, workspace topology, package-manager version, Node version, optional/native dependencies, or generated `.bin` shims differ. npm/Yarn hoisted resolution and workspace-root paths can make a dependency resolve from the primary tree; a branch adding/removing a dependency mutates every branch. Vite/Vitest/Webpack cache/module resolution can key the real/symlink path and become stale or fail. Bun has its own install/cache layout—use `bun install`, not a foreign directory. | Full tree copy is huge; hardlinked files can be safe only if package managers do atomic replace rather than in-place mutation, but copied executable shims/native modules may still not fit Node/OS/CPU. | Correct and conventional; slow without a warm package cache/store. Run with a frozen/immutable lockfile where appropriate. |
| pnpm specifically | **Safe to share the pnpm store; safe to use `virtualStoreType: global`; not a reason to link a worktree’s whole `node_modules`.** | pnpm uses a content-addressable store plus symlinked virtual layout. Its worktree guide says enable `virtualStoreType: global` in `pnpm-workspace.yaml`, then execute `pnpm install` in each worktree. Nodes then link to a global virtual store and branch-specific project registration/layout stays correct. Before pnpm 11.23.0, the setting was `enableGlobalVirtualStore: true`. [pnpm worktrees](https://pnpm.io/git-worktrees) | Manual root linking defeats pnpm’s per-project virtual-store and lockfile resolution. Sharing a mutable store with untrusted agents/users violates pnpm’s documented trust assumption. Native optional packages still must match platform/runtime. | Usually unnecessary: pnpm already uses hardlinks/reflinks where supported for its store import. | A warm global store makes it near-instant and updates correct links. `pnpm store prune` reclaims unreachable content. |
| Build outputs/caches (`.next`, `dist`, `.turbo`, `target`, Vite/Webpack cache) | **Rebuild; use the producer’s remote/content-addressable cache where available.** Optionally clone/copy disposable cache as an advanced speed optimization. | Outputs are branch/path/config dependent; correctness matters more than a warm cache. | A shared output path lets one branch overwrite another; absolute paths, compiler options, HMR state, source maps, and cache keys commonly invalidate. | Cloning/copying stale caches costs disk and can defer a bad-cache diagnosis; cache directories may include sockets/locks. | Safe but expensive; remote build caches, pnpm store, Cargo registry cache, and compiler caches solve the byte reuse at the right abstraction. |
| Lockfiles | **Leave tracked; never list them as copy/link material.** | Worktree checkout supplies the branch’s authoritative lockfile. | Linking makes branch changes mutate primary and other worktrees. | Copying overwrites the checkout’s dependency contract. | Installer reads checked-out lockfile. |
| Local SQLite database | **Copy a small disposable fixture or create per-worktree DB; do not link.** | It is mutable application state, not a cache. | Concurrent writes, corrupted/locked DB, data cross-contamination. | Large/inconsistent WAL/SHM sidecar copies; must quiesce/checkpoint or copy all required sidecars. | Migrate/seed gives reliable isolation but costs time. |

### Hardlinks and CoW clones are a useful third option, but not a semantic fix

On APFS, macOS `cp -c` uses copy-on-write clone support; GNU `cp --reflink=auto` can use filesystem reflinks. They make an initial independent copy cheap **when source and destination support it**, unlike a symlink: later writes should diverge. pnpm itself imports package files using hardlinks/reflinks as supported. These are good advanced optimizations for known-disposable, immutable-at-rest artifacts; detect/fallback to normal copy and never promise cross-platform availability (NTFS, network volumes, and filesystem permissions differ).

They do not make a snapshot coherent: copying a running database/cache with locks or sidecars is unsafe; hardlinks are especially bad for an application that edits files in place because the source and destination share inodes. For `node_modules`, prefer package-manager-managed hardlink/reflink/store behavior rather than a generic file copier. [pnpm architecture](https://deepwiki.com/pnpm/pnpm/2.5-content-addressable-store-cafs)

## Existing tooling

### Native Git and general-purpose worktree tools

| Tool | Worktree setup mechanism | Config shape / gap |
|---|---|---|
| `git worktree` | Native checkout only; shared Git metadata | **No copy/symlink/setup lifecycle API.** `post-checkout` is the workaround; `worktree add --no-checkout` skips it. `git worktree prune` only prunes stale administrative entries; it cannot clean application processes. |
| `wt` / **Worktrunk** (`max-sixty/worktrunk`) | Lifecycle shell hooks; `wt step copy-ignored`; `wt step tether` owns process tree | Project/global TOML, named concurrent or ordered script stages, template variables and `hash_port`; supports `pre/post-start`, `pre/post-remove`. Strongest general configurability found. [docs](https://worktrunk.dev/tips-patterns/) |
| `git-worktree-wrapper` (`lu0/git-worktree-wrapper`) | Wraps `git checkout`/`branch`, invokes checkout so ordinary Git `post-checkout` can run | No declarative copy/setup layer of its own; use Git hook. [repository](https://github.com/lu0/git-worktree-wrapper) |
| `worktree.nvim` (`ThePrimeagen/git-worktree.nvim`) | Neovim branch/worktree switching integration | Does not solve ignored files/deps itself; issue #92 requests copying ignored files. It is editor navigation, not bootstrap. [issue](https://github.com/ThePrimeagen/git-worktree.nvim/issues/92) |
| `gwq` (`d-kuro/gwq`) | CLI creates/switches/removes/executes in worktrees; fuzzy finder and path template | No verified bootstrap/copy hook in documentation found; solve via repo hook/script. [repository](https://github.com/d-kuro/gwq) |
| `phantom` (`phantompane/phantom`) | Worktree CLI, tmux/editor/MCP worktree management | No verified ignored-file/dependency declarative setup found; agents can invoke its MCP tools but project bootstrap remains external. Do not confuse with `zruss11/Phantom`, a separate multi-agent app. [repository](https://github.com/phantompane/phantom) |
| `git-wt` | Ambiguous name: multiple unrelated projects. `k1LoW/git-wt` is a location/navigation wrapper; `shhac/git-wt` advertises auto config sync. | Require an exact repository before integrating. Do not design against the package name alone. [k1LoW](https://github.com/k1LoW/git-wt) [shhac](https://git-wt.paulie.app/) |
| `git-worktree-runner` / `gtr` (`coderabbitai`) | Wrapper advertises config copying, dependency install and post-add/remove hooks; can launch coding agents | Shell-oriented wrapper; useful precedent, but do not make its private convention a universal project standard. [repository](https://github.com/coderabbitai/git-worktree-runner) |
| Graphite | Worktree/stacked-branch workflow | No official evidence found of a `.env` copy/list or setup-script feature in this pass; treat it as Git/branch workflow, externalize bootstrap. |
| GitButler | Alternative: virtual/parallel branches in **one shared working directory** | Avoids repeated install/copy because ignored/runtime state is shared, but is not runtime isolation: filesystem, dependencies, generated files, and app state collide. Choose native worktrees when separate runtime state matters. [docs](https://docs.gitbutler.com/ai-agents/parallel-agents) |

### Agent-focused products

| Tool | Setup / configuration model | Implication |
|---|---|---|
| **Conductor** | `.worktreeinclude` (Gitignore syntax; copies only listed-and-ignored files) or `file_include_globs` TOML; setup/run/archive scripts for commands, symlinks, secret fetches. Local workspace copy support is distinct from cloud setup. | The clearest “both declarative copy list and imperative setup” precedent. Workspace isolation is not a security boundary. [reference](https://www.conductor.build/docs/reference/worktreeinclude) |
| **Claude Code** | `.worktreeinclude` (same listed-and-ignored semantics) plus normal setup; `WorktreeCreate`/`WorktreeRemove` hooks replace its default Git logic for custom VCS. | Documents fresh checkout pain directly. Project plugins and saved approvals can be shared; agent hooks must read `cwd`, because `CLAUDE_PROJECT_DIR` can remain the primary path. [docs](https://code.claude.com/docs/en/worktrees) |
| **Cursor** | `.cursor/worktrees.json`: Unix/Windows/generic ordered shell commands or a script; `ROOT_WORKTREE_PATH` points to primary checkout. Docs explicitly show copy `.env` then install. | No default copy list or port allocator; docs discourage symlinked dependencies and suggest pnpm/bun/uv. Has machine cleanup interval/max count. [docs](https://cursor.com/docs/configuration/worktrees) |
| **Vibe Kanban** | Per-project Copy Files comma list, then setup script, agent, cleanup script. | Explicit ordered lifecycle. Copied targets should be ignored or an agent can commit them. Project is being open-sourced/sunset, so treat as product precedent not dependency. [docs](https://www.vibekanban.com/docs/core-features/creating-projects) |
| **Claude Squad** | Creates Git worktree + tmux session and removes it on instance termination/reset. | No verified post-create setup, ignored-file copying, dependency setup, or port allocation configuration. Open issue #260 requests exactly that. [DeepWiki](https://deepwiki.com/smtg-ai/claude-squad/4.3-git-worktree-management) [issue](https://github.com/smtg-ai/claude-squad/issues/260) |
| **Sculptor** (`imbue-ai/sculptor`) | Parallel local agent workspaces/worktrees and terminal; setup behavior not verified from its public docs in this pass. | Verify product version/API before relying on an integration. [repository](https://github.com/imbue-ai/sculptor) |
| **Terragon** | Cloud/background sandbox product rather than a verified local-Git-worktree bootstrap mechanism. | Environment/image/secret management is service-side; no local copy/symlink pattern found. |
| **cmux** / container-use | Terminal multiplexing / container isolation rather than a Git ignored-file transfer solution. | Containers solve runtime/port/dependency isolation when correctly namespaced, but need mounts, image setup, credential injection, and cleanup. |
| Codex/Devin sandboxes | Sandboxed/remote environment model, not a portable local worktree setup API in sources reviewed. | Treat as an alternative isolation boundary; users still need reproducible bootstrap/secrets strategy. |

### Package/environment tools

| Tool | What it solves | What it does not |
|---|---|---|
| pnpm store / global virtual store | Correct per-worktree dependency layout with shared package bytes; `pnpm store prune` GC | Secrets, ports, generated files, branch-specific configuration |
| direnv | Loads committed or copied `.envrc` after `cd`; every new path must be trusted with `direnv allow` | Noninteractive agent shells may not source shell hooks; do not expect it to carry primary-tree environment into a sibling automatically |
| mise | Committed `mise.toml` is checked out; `{{ config_root }}` resolves to each worktree root; requires per-path `mise trust` | Secret copying and port/database isolation |
| devbox / Nix | Declarative, reproducible tool/dependency environment; cache/store reuse can eliminate host install drift | Local `.env`, databases, containers, and mutable build output still need policy |

## Config file patterns

Real, established schemas show a clear result: **both** a constrained declarative copy-list and an idempotent setup script win. A list is reviewable, safe-ish, and suitable for static ignored files; it cannot install dependencies, allocate ports, migrate a DB, create a per-worktree symlink, or fetch secrets. A script is universal, but opaque, OS-sensitive, harder to preview, and can silently copy too much or overwrite local work. Use list-before-script ordering.

### 1. Conductor: committed glob list plus TOML override

```text
# .worktreeinclude — .gitignore pattern syntax
.env.local
config/secrets.json
certs/local/**
```

```toml
# .conductor/settings.toml
"$schema" = "https://conductor.build/schemas/settings.repo.schema.json"
file_include_globs = """
.env.local
config/local.json
"""
```

Only existing files that are also Git-ignored are copied; a root `.worktreeinclude` wins over the personal/repo TOML setting. [Conductor reference](https://www.conductor.build/docs/reference/worktreeinclude)

### 2. Cursor: platform-aware imperative JSON

```json
{
  "setup-worktree-unix": [
    "npm ci",
    "cp \"$ROOT_WORKTREE_PATH/.env\" .env"
  ],
  "setup-worktree-windows": [
    "npm ci",
    "Copy-Item \"$env:ROOT_WORKTREE_PATH/.env\" .env"
  ]
}
```

Each value may instead be a script path relative to `.cursor/worktrees.json`. It has no separate glob-copy schema. [Cursor worktrees](https://cursor.com/docs/configuration/worktrees)

### 3. Worktrunk: declarative TOML lifecycle plus script commands

```toml
[[post-start]]
copy = "wt step copy-ignored"

[[post-start]]
install = "pnpm install"

[post-start]
server = "wt step tether -- npm run dev -- --port {{ branch | hash_port }}"

[pre-remove]
db-stop = "docker stop {{ vars.container }} 2>/dev/null || true"
```

It can limit `copy-ignored` with `.worktreeinclude`; setup/removal commands remain explicit. [Worktrunk patterns](https://worktrunk.dev/tips-patterns/)

### 4. pnpm: workspace YAML describes package-store behavior, not file copying

```yaml
# pnpm-workspace.yaml; pnpm >= 11.23.0
packages:
  - 'packages/*'
virtualStoreType: global
```

Before 11.23.0 use `enableGlobalVirtualStore: true`. This is the correct dependency-space optimization, not a replacement for an include list. [pnpm worktrees](https://pnpm.io/git-worktrees)

### 5. Vibe Kanban: UI-backed list and scripts

Its project settings hold a comma-delimited **Copy Files** field and setup/dev-server/cleanup scripts. Semantics are create → copy → setup → agent → cleanup. It is a useful UX precedent, though the schema is product/database/UI rather than a portable repository file. [Vibe Kanban docs](https://www.vibekanban.com/docs/core-features/creating-projects)

## Gotchas & constraints

- Never glob-copy all ignored files by default. It can copy token files, SSH material, databases, sockets, gigabytes of outputs, or an agent's mutable state. Conductor/Claude Code’s “pattern **and** Git-ignored” gate is a good safety floor, not complete secret policy.
- Include list entries should be individually selectable and shown with source, destination, mode, size, secrecy warning, and overwrite policy. Default: skip existing destination; never overwrite unprompted.
- A symlink is a live shared mutable resource, not an optimization. Label it “shared; edits affect source worktree,” require an explicit opt-in, and avoid it for `.env`, DBs, generated output, or generic agent config.
- `node_modules` must follow **the worktree’s lockfile**. Identify package manager from committed files, then run its frozen install command. Offer a pnpm global virtual-store hint only after detecting pnpm and compatible version/config.
- Allocate ports before running setup/agent. A deterministic branch/worktree-name hash is human-reproducible but needs collision handling and per-service namespace; write the selected values to a generated ignored local file or command environment. Namespace Docker Compose project names, database names, volumes, and containers too.
- Agent startup should check: required files copied/generated; Git LFS/submodules initialized if applicable; dependency bootstrap completed; agent instruction files are present; MCP config is present but credentials are not blindly replicated; and the agent receives the allocated ports/URLs. Agents in noninteractive shells may need `direnv export`/explicit environment injection rather than relying on a prompt hook.
- Display cleanup separately from Git cleanup: `git worktree remove` handles the checkout; processes/containers/ports/cache/DB teardown requires a configured cleanup script. Offer stale-worktree discovery and `git worktree prune`, but never remove modified/untracked worktrees without confirmation.

## Recommended Approach

1. **Default dialog: safe, fast, inspectable.** Create the Git worktree; detect `.worktreeinclude` and show its matched *ignored* files; copy only those selected small files (default `.env*` only when declared, never discover-and-copy everything); generate per-worktree runtime values; run an idempotent project setup command; then open VS Code/agent in that directory. State clearly that copied secrets are independent snapshots and dependencies will be installed.
2. **Package-aware default.** Detect lockfile/package manager. Run per-worktree install, reusing the manager’s cache/store. For pnpm, recommend/add `virtualStoreType: global` only with explicit consent and same-user/trust-boundary warning. Do not offer “symlink `node_modules`” as the normal button. Keep caches build-tool-managed/rebuilt by default.
3. **Advanced panel: explicit escape hatches.** Ordered setup and cleanup scripts (platform-aware), copy/link/reflink lists with per-path mode and overwrite policy, port/Docker/database templates, submodule/LFS steps, and a visible “shared symlink” danger badge. Persist repository defaults in a portable committed config; preserve personal paths/secrets in user settings. Show preview/dry-run and per-step logs before launching an agent.

## Confidence

**High** — Git, pnpm, Conductor, Claude Code, Cursor, Vibe Kanban, Worktrunk, and GitButler claims were checked against official documentation or source-backed DeepWiki. **Medium** for the long-tail survey (Graphite, Sculptor, Terragon, cmux/container-use, and ambiguous `git-wt` projects): public setup APIs were absent or insufficiently documented, and those gaps are labelled rather than inferred.
