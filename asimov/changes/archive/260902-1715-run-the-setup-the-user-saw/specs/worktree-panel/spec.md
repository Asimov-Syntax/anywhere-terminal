## ADDED Requirements

### Requirement: Only setup the user selected runs

After a worktree is created, the extension SHALL run only the setup steps selected from the provisioning offer shown in that create form.

- Setup steps start unselected on every opening.
- A stale, unknown, or replaced offer runs nothing and requires a fresh offer and submission.
- Selected steps run in offer order after selected material and named ports have been applied.

#### Scenario: A checked-in command was not selected

- **WHEN** a provisioning offer contains a setup command and the user creates the worktree without selecting it
- **THEN** the worktree is created and that command does not run

### Requirement: Setup runs in the created worktree through one shell argument

Each selected setup step SHALL run sequentially in the created worktree, carrying the displayed script in one non-concatenated shell payload argument.

- An encoded payload decodes to the exact displayed script.
- Scripts are not interpolated into a command line.

#### Scenario: A script contains shell operators and line breaks

- **WHEN** a selected script contains quotes, operators, or line breaks
- **THEN** one shell payload produces that complete script rather than text assembled into a command line

### Requirement: Task-file setup does not use the task system

A selected setup step originating in `.vscode/tasks.json` SHALL run through the setup shell and SHALL NOT be dispatched through the VS Code task system.

### Requirement: Setup receives the worktree paths and branch

Every setup process SHALL inherit the extension-host environment and receive `ANYWHERE_TERMINAL_WORKTREE_PATH`, `ANYWHERE_TERMINAL_MAIN_PATH`, and `ANYWHERE_TERMINAL_BRANCH` for its create.

### Requirement: Setup receives authoritative named ports

A provider port name SHALL be offerable only when it is a portable environment identifier and is outside the case-insensitive `ANYWHERE_TERMINAL_` and `ASIMOV_` namespaces. Each successfully allocated or reused offerable port SHALL be set in setup under its configured environment-variable name with its authoritative value; host-owned setup variables SHALL win any later collision.

#### Scenario: A provider declares a reserved setup variable

- **WHEN** a provider declares `ANYWHERE_TERMINAL_WORKTREE_PATH`, `ASIMOV_CHANGE_ID`, or a case variant as a port name
- **THEN** the declaration is reported as malformed and is not offered or applied

### Requirement: Asimov setup receives its compatibility environment

WHERE the selected model was supplied by the asimov adapter, setup SHALL receive `ASIMOV_WORKTREE_PATH`, `ASIMOV_MAIN_ROOT`, and `ASIMOV_BRANCH` matching the Anywhere Terminal values. The extension SHALL NOT set `ASIMOV_CHANGE_ID`.

### Requirement: Setup failure leaves the successful create standing

WHERE a setup step exits non-zero, times out, or cannot start, the extension SHALL stop later setup steps, keep the worktree and earlier provisioning results, and report the setup failure on that worktree's row.

- The failure offers its captured output and a retry.
- Retry runs setup only and does not repeat materialization or port allocation.
- Retry is unavailable after the extension can no longer prove the row names the worktree for which the steps were selected.

#### Scenario: The second selected step fails

- **WHEN** the first selected step succeeds and the second exits non-zero
- **THEN** later steps do not run, the worktree and first step remain standing, and the row offers setup-only retry

### Requirement: Agent startup honours the setup wait choice

WHERE a create will start an agent and at least one setup step is selected, the form SHALL offer an off-by-default choice to wait for setup.

- With the choice off, agent startup begins after materialization and port allocation without waiting for setup to exit.
- With the choice on, the agent starts only after every selected setup step succeeds.
- A failed gated setup starts no agent and reports the failure.
- Where no setup step is selected, the wait control remains visible but disabled.
