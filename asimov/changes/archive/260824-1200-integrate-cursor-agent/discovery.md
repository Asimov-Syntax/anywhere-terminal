# Discovery: integrate-cursor-agent

## Context

AnyWhere Terminal already treats Claude Code, Codex, and OpenCode as provider-neutral Vault agents: per-agent readers normalize local history, a data registry supplies launch commands, `VaultService` aggregates/cache-watches entries, and `VaultLauncher` spawns argv directly into a PTY. Cursor Agent should extend those seams rather than create a second chat product inside the terminal extension.

Cursor exposes three materially different integration surfaces. The interactive CLI (`agent`, with `cursor-agent` as a compatibility alias) is the terminal-first surface. ACP (`agent acp`) is a structured application-provider protocol. Cursor Agent CLI history uses a content-addressed SQLite graph under `~/.cursor/chats/` plus project transcript JSONL mirrors, while Cursor IDE Composer history uses editor `state.vscdb`; the identifier domains have no stable cross-store Resume bridge.

The revised direction keeps the terminal-first integration but adds local transcript parity: validated CLI stores and their JSONL mirrors feed one resumable CLI row, Cursor IDE Composer feeds a separate non-resumable row, and activation always opens the existing Vault preview. Structural inspection of the installed Cursor bundle and local stores proved a bounded decoder feasible; the integration still detects a user-installed CLI and never bundles the proprietary binary.

## Options

### Option A — Terminal-first hybrid with local transcript parity (Selected)

Add Cursor as a fourth Vault provider, index schema-gated CLI and IDE history, render both through the existing bounded preview, continue through verified executable aliases, and use native hooks plus bounded terminal-tail evidence for working/done/action-required state. Selected Resume is explicit and CLI-only; incompatible detail sources degrade to metadata without affecting other providers.

### Option B — Vault-only MVP

Add metadata listing and continuation without hooks or semantic status; selected Resume remains proof-gated. This is smaller, but leaves Cursor integration visibly shallower than Orca/cmux and cannot distinguish working from waiting for approval.

### Option C — ACP embedded provider

Launch `agent acp`, normalize JSON-RPC/NDJSON, render assistant/tool/approval/question/model state in application UI, and persist an application-owned transcript as t3code does. This is a different product boundary and requires a provider runtime, scoped process lifecycle, protocol recovery, and durable event model far beyond the existing terminal/Vault architecture.

### Option D — Unbounded private-store mirroring

Copy or broadly scan `~/.cursor/chats/**/store.db`, persist raw blobs, or expose the full private graph as a stable application contract. Rejected because the graph is private, version-fragile, sensitive, and broader than preview requires. The selected option instead follows validated root references, enforces strict bounds, returns normalized records only, and fails closed to metadata.

## Reuse — existing code to build on

- `src/vault/types.ts` — closed agent id list and shared entry/detail contracts; adding an id compile-forces the registry, reader maps, and icon map.
- `src/vault/registry.ts` — data-driven resume/continue definitions and installed-target probing; extend executable detection to ordered candidates rather than branch in launch code.
- `src/vault/VaultService.ts` — provider-isolated concurrent reads, last-known-good cache retention, point lookup, native capability routing, and store/session watch targets.
- `src/vault/cacheTypes.ts` — per-file stamps and derived-entry reuse; Cursor `meta.json` files fit the existing `files` cache shape.
- `src/vault/LaunchBuilder.ts` and `src/vault/VaultLauncher.ts` — injection-safe argv launch and fresh-terminal fallback-shell behavior.
- `src/vault/readers/detail.ts` — bounded shared partial-detail contract; Cursor can return an explicit metadata-only limited detail without inventing transcript records.
- `src/providers/VaultWatchCoordinator.ts` — shared debounced list/follow watcher lifecycle; Cursor only contributes targets.
- `src/session/SessionManager.ts` — PTY env injection point and per-session lifecycle; a small environment contributor can register hook correlation data without changing launch callers.
- `src/webview/terminal/TerminalActivityTracker.ts` — existing 1.5-second PTY-output fallback; extend its state inputs instead of replacing the tab-bar pipeline.
- `src/webview/terminal/titleSignature.ts` — existing decoration-stripped title handling; strict Cursor identity can reuse the title call site without spinner render churn.

## Key Findings

### Orca — strongest terminal reference

Orca keeps stable agent id `cursor` separate from executable `cursor-agent`; tests pin that bare `cursor` can open the desktop application and must never be used as the CLI. One descriptor drives installed detection, launch command, expected process, positional prompt mode, and workspace-trust preflight (`orca/src/shared/tui-agent-config.ts:20-50,249-255`).

Its semantic status combines independent evidence rather than flattening them: native title proves identity, hooks prove working/done/tool state, bounded terminal-tail structure detects approval dialogs hooks do not report, and foreground process proves liveness. Hook `done` waits through a 1.5-second quiet window before completion, renewed activity cancels it, and a live approval menu outranks spinner/title evidence.

Orca manages `~/.cursor/hooks.json` surgically and correlates events with pane identity plus a per-launch token. Cursor hooks never directly produce `waiting`; Orca recognizes `Run this command?` only when multiple known choice rows occupy the bottom eight retained lines. It also deliberately avoids auto-submitting orchestration text into Cursor.

Orca main scans Cursor project `agent-transcripts` JSONL with an append-aware cache and keeps row activation preview-first; its unmerged sidecar branch reconciles CLI metadata without opening `store.db`. Project transcript location alone does not prove IDE identity: a matching validated CLI sidecar may bind the JSONL to a resumable CLI chat, while Cursor IDE Composer remains a separate `state.vscdb` domain.

### cmux — hook-driven restoration, not embedded chat

cmux integrates Cursor through native hooks, terminal/process attribution, durable sanitized resume metadata, and `cursor-agent --resume <id>`. Cursor is absent from cmux's embedded-provider list and history transcript readers. The key boundary is explicit: lifecycle/session identity is not conversation history.

Its strongest reusable safety rules are selective hook ownership, fail-open observers, PID/TTY-backed terminal attribution, launch-CWD preservation, positive-list argv/environment sanitization, locked atomic state, and fresh validation before resume. Its large generic hook handler and provider policy spread across many files are pitfalls to avoid.

### t3code — ACP reference for a future embedded mode

t3code launches `cursor-agent acp`, authenticates with `cursor_login`, persists an opaque versioned ACP session id, and maps core plus Cursor-extension RPCs into provider-neutral assistant/tool/approval/plan/question events. Each active application thread owns a scoped ACP process and t3code persists its own transcript rather than reading Cursor-native history.

The reusable lessons are provider-instance identity, process/session scope alignment, handler registration before startup, single-flight startup, serialized prompts, bounded diagnostics, and explicit health states. The full event-sourced architecture is intentionally deferred because AT currently renders a real terminal rather than an application-owned chat.

### Official Cursor CLI and hooks

- Primary executable: `agent`; compatibility alias: `cursor-agent`. Resolve configured override first if one is introduced, then verify `agent`, then fall back to `cursor-agent`.
- Interactive launch accepts a positional prompt; resume uses `--resume <chat-id>`; `--continue` resumes the latest chat; no supported non-interactive fork was found.
- `~/.cursor/chats/<workspace-bucket>/<chat-id>/meta.json` exposes list metadata; validated `store.db` roots can supply bounded detail, and matching project JSONL can supply an incremental mirror/fallback. Raw blobs and private metadata remain forbidden outputs.
- Native hooks use `~/.cursor/hooks.json`, schema version `1`, with official `conversation_id`, `generation_id`, `workspace_roots`, model, optional transcript path, and event-specific fields. There is no documented pid or generic cwd.
- Headless CLI currently omits several lifecycle hooks and Linux parity is uncertain. Hooks are best-effort observability; the existing PTY-output tracker remains the fallback.
- `conversation_id`, hook `session_id`, generation id, local chat-directory UUID, IDE transcript id, and ACP session id are not documented as interchangeable.

### Current AnyWhere Terminal shape

`VaultService` is already a large facade, but adding Cursor requires one typed reader row per map and one watch branch; refactoring the class during this behavior change would mix structural and product work. `registry.ts` is structurally unremarkable and is the correct place to extend the provider record.

AT has no semantic agent turn-state model today. `TerminalActivityTracker` marks any PTY output running and decays to idle after 1.5 seconds. The hybrid integration should layer fresh hook/approval evidence over that fallback, not persist status and not infer completion from terminal titles.

## Gap Analysis

| Component | Have | Need | Gap |
|---|---|---|---|
| Agent identity | Closed `claude | codex | opencode` union | Stable `cursor` id distinct from executable | Add id, registry/icon/CSS rows, typed reader maps |
| Executable resolution | One basename per provider, `--version` probe | Ordered `agent` / `cursor-agent` candidates with collision-safe capability probe | Extend detect rule and launch-time resolver |
| Cursor history | Metadata-only CLI reader | Previewable CLI `store.db`/JSONL and IDE Composer history | Add bounded detail decoders, source-qualified identities, deduplication, and limited fallback |
| Cursor launch | Generic argv builder | Positional continuation and proof-gated selected Resume, no fork | Add executable resolver, `canResume`, and explicit capability boundaries |
| Hook setup | No coding-agent hook installer/server | Opt-in, owned, atomic Cursor hook observer | New Cursor-specific installer/runtime; no generic multi-provider framework yet |
| Hook correlation | PTY has stable session id but no hook token | Session-scoped token + loopback validation | Add per-session env contributor and unregister lifecycle |
| Semantic status | PTY-output `idle | running` only | `working`, `action required`, `done` evidence with fallback | Extend tracker inputs and tab status rendering |
| Approval state | None | Structural current-screen Cursor approval detector | Pure bounded detector over bottom terminal rows |
| Transcript preview | Rich provider readers plus limited Cursor detail | CLI and IDE timelines through the same preview contract | Decode normalized records locally; keep Resume CLI-only and fail closed to metadata |
| ACP | None | Not required for chosen direction | Explicitly deferred follow-up |
