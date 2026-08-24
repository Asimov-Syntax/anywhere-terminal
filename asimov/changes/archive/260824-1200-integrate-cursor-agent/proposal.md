# Proposal: integrate-cursor-agent

## Why

Cursor users expect the AI Vault to behave consistently across Claude, Codex, OpenCode, Cursor Agent CLI, and Cursor IDE: activating a history row opens its conversation preview, while Resume remains a separate action. The initial metadata-only Cursor implementation and later click-to-resume workaround violate that contract even though current local storage is structurally readable with bounded, local-only readers.

## Appetite

L (≤2w)

## Scope

### In scope

- Add Cursor as a fourth AI Vault provider using a user-installed `agent` or `cursor-agent` executable.
- Preview Cursor Agent CLI history from its validated local `store.db`, using project transcript JSONL as an incremental mirror/fallback and suppressing duplicate rows.
- Preview Cursor IDE Composer history from its local `globalStorage/state.vscdb` store as a distinct, non-resumable source.
- Keep row click, Enter, and Space preview-first; expose selected Resume only as an explicit action for validated CLI chats.
- Support cross-agent Continue in New Session while keeping Cursor IDE and CLI identifier domains separate.
- Add opt-in, non-blocking Cursor native-hook observation for semantic working/done status and bounded current-screen approval detection.
- Preserve existing Cursor hook configuration and degrade safely when hooks, transcript schemas, databases, or optional capabilities are unavailable.

### Out of scope

- Embedding Cursor through ACP or rendering an application-owned Cursor chat surface.
- Resuming Cursor IDE Composer sessions through Cursor Agent CLI, merging IDE and CLI identifiers, or treating project transcript filenames as universal session IDs.
- Cursor fork, native session rename, token/cost reconstruction, automatic live-session recovery, hibernation, or orchestration.
- Exposing hidden reasoning, database encryption keys, raw SQLite blobs, raw hook payloads, account identity, or shell output outside normalized transcript records explicitly requested for local preview.
- Bundling, mirroring, auto-updating, or redistributing the proprietary Cursor CLI.

## Risk Level

HIGH — the change reads version-fragile private local stores containing transcript content, maps three Cursor storage domains, edits an external hook configuration after explicit opt-in, and introduces local status transport. Readers must be bounded, read-only, WAL-aware, schema-gated, containment-checked, source-qualified, and fail closed to limited metadata without logging or persisting sensitive payloads.
