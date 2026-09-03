# Proposal: make-the-create-dialog-explain-itself

## Why

The create dialog currently hides consequence behind vocabulary: **Configure…** immediately writes
repository defaults, **Recover** authorizes deletion, a disabled Create button says nothing, and the
form opens on **Nothing** even when a safe agent is ready.

| Priority | Pain point | Consequence |
|---|---|---|
| P0 | `Recover <name>` sounds restorative | A destructive clear can be mistaken for data recovery |
| P0 | Disabled Create has no adjacent reason | A correct safety gate looks like a broken button |
| P1 | `Configure…` opens no configuration UI | The user cannot predict that it saves the current file choices |
| P1 | `After creating` opens on Nothing | The dominant “make a worktree and start work” path needs extra discovery and input |
| P1 | After-create choices have labels but no consequence text | Terminal, agent, folder and no-op differ more than the dropdown communicates |
| P2 | Mode and collision explanations are split across nearby lines | Keep the existing direct mode/collision sentences, but do not add a second summary or move them into Advanced |

## Appetite

M (≤3d)

## Scope

### In scope

- Make the existing dialog actions name what they do and explain their consequence at the point of choice.
- Open on Start an agent only when a non-dangerous launch default exists; otherwise open a terminal.
- Name debris clearance as deletion, keep it unchecked, and retain the exact path/content warning.
- Explain the first submit gate beside the disabled primary action.
- Preserve the existing mode, collision, Advanced, provisioning, migration, setup, port, adopt, and authorization contracts.

### Out of scope

- Detecting undeclared `.env` files or package-manager setup suggestions; the dependent
  `suggest-worktree-initialization` change owns that new evidence source and offer lifecycle.
- Changing what files, ports, setup commands, migrations, agents, or permission postures the host offers.
- Persisting setup commands or ports as repository defaults.
- Changing create, clear, adopt, repair, migration, provisioning, setup, or launch execution order.

### Must not

- Preselect a dangerous permission posture or a destructive clearance.
- Let webview labels or hints become authority to delete, provision, migrate, run setup, or launch.
- Hide a current mode/collision/destructive warning inside Advanced.
- Call a save action “Configure” when it performs a write immediately.

## Risk Level

MEDIUM — the code change is local to one dialog, but one default spawns a process and one renamed
control authorizes deletion, so misleading fallback or stale state would have user-visible cost.
