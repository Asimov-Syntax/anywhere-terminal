# agent-session-index Spec Delta

## ADDED Requirements

### Requirement: Claude permission mode is the latest recorded mode

A Claude session's permission mode is session **state** — a transcript records it repeatedly and re-records it on every change — so the entry's `permissionMode` SHALL be the **most recently recorded** mode in the transcript, never the first one encountered.

Deriving it SHALL NOT require reading the whole transcript: bounded scans of the transcript's head and tail are sufficient, and WHERE neither contains a mode, `permissionMode` SHALL be omitted rather than guessed, so the resumed session falls back to the agent's own default.

WHEN this derivation changes, any persisted session-list cache holding entries derived under the previous rule SHALL be invalidated, so a cached entry cannot keep serving a stale or absent mode.

#### Scenario: Mode changed mid-session resumes under the latest mode

- **WHEN** a Claude transcript records `bypassPermissions` on an early record and later records `{"type":"permission-mode","permissionMode":"default"}`
- **THEN** the entry's `permissionMode` is `default`, and the resume command built from that entry carries `--permission-mode default`

#### Scenario: Mode first appears after the metadata head

- **WHEN** a Claude transcript's only `permissionMode` sits past the head scan bound but within the tail scan bound
- **THEN** the entry carries that mode instead of omitting `permissionMode`
