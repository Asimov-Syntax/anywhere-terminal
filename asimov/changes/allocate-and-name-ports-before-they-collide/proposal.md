# Proposal: allocate-and-name-ports-before-they-collide

## Why

A free-port probe does not prevent two VS Code processes from choosing the same value, and it does not see ports sibling worktrees already claim in configuration. Port provisioning needs one repository-wide allocation boundary and an honest preview/result path.

## Appetite

M (≤3d)

## Scope

### In scope

- Show a numeric preview beside each configured port name in the create form.
- Allocate selected names after file materialization, under one repository-wide cross-process lock.
- Reuse and extend `.env.worktree` without replacing existing assignments.
- Keep `.env.worktree` out of tracked ignore rules and report per-name outcomes, including preview changes.

### Out of scope

- Reserving a port against unrelated processes between allocation and setup.
- Running setup or writing the provisioning manifest; WT-012.11 owns both.
- Changing provider detection, parsing, merge, or configuration-file writing.

### Must not

- Fail or roll back a successful worktree create because a port could not be allocated.
- Overwrite an unreadable or ambiguous existing `.env.worktree`.
- Write `.env.worktree` into `.gitignore`.
- Claim that a preview is a reservation.

## Risk Level

MEDIUM — the change serializes multiple processes and mutates a worktree-local claim file plus the repository's local exclude file.
