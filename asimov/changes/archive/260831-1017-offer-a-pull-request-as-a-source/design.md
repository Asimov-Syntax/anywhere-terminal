# Design — offer a pull request as a source

> Blueprint: `docs/design/worktree-create.md` § 4.1, § 5; `docs/design/worktree-rpc.md` § 2.1, § 2.2.
> Those documents own the rule. This file records only what building it decides.

## D1 — The forge is the `gh` CLI, and its absence is a state rather than an error

Chosen by the user at Gate 1 over VS Code's built-in GitHub authentication and over adding octokit.

What comes with the choice, stated so it is not rediscovered as a defect:

- **No credential of ours.** `gh` holds the token. Nothing in this change reads, stores, forwards, or
  logs one, and no token ever crosses the wire to the webview.
- **A machine without `gh` has no pull requests.** That is not a failure path bolted on afterwards —
  § 5 already requires "one quiet row" for an unauthenticated or unreachable forge, and a missing
  client resolves to the *same* row. One state, not three.
- **A forge that is not GitHub has no pull requests either.** The row says pull requests are
  unavailable; it does not say the repository is broken.

## D2 — `gh` runs through the existing runner, with `executable: "gh"`

`createGitCommandRunner` is already parameterised on the executable, already resolves with an outcome
instead of rejecting, and already distinguishes `failedToSpawn` (ENOENT / EACCES / EPERM) from a
non-zero exit and from a timeout. That is precisely the classification this feature needs, and its
`LC_ALL=C` environment is what keeps a stderr match from depending on the user's language.

A second process seam would duplicate all of it to gain nothing. The name is git-flavoured and the
runner is not; that is a naming debt to note, not a reason to fork the module.

The call is `gh pr list --json number,title,headRefName,baseRefName,headRepositoryOwner,isCrossRepository --limit <cap>`, run with the repository's main worktree as cwd so `gh` resolves the repository from the checkout rather than from a name we assemble.

**Bounded like the refs read.** `readRepoRefs` caps at `MAX_REFS` and asks one over the cap so a full
page is distinguishable from a repository that has exactly that many. Pull requests take the same
shape and the same treatment: a cap, one over it, and a `truncated` flag the row count states.

## D3 — Pull requests travel on their own message and never delay the refs

The read is started from the same `requestWorktreeRefs` handler that starts the refs read — one user
gesture, one place — but it is a **separate promise posting a separate message**. Folding it into
`worktreeRefs` would make the ref list wait for a network call, which is the exact behaviour § 4.1
forbids: "a slow or unauthenticated forge never blocks branch search underneath it."

Failure is silence plus a stated row, never a thrown error:

| Outcome | What the form is told |
|---|---|
| `failedToSpawn` | pull requests unavailable — the client is not installed |
| non-zero exit, or unparseable JSON | pull requests unavailable |
| timed out | pull requests unavailable |
| ok | the rows, and whether the list was truncated |

All four collapse to one row in the list. The distinction is kept on the host for the log, not
rendered as four different messages the user has to tell apart.

## D4 — `pr/<number>` is minted from the number alone

§ 5 fixes the branch name as `pr/<number>`, and the determinism is the whole mechanism: it is what
makes the same pull request twice a reuse rather than a second worktree. So the name is derived from
the number and nothing else — never from the title, never from the head ref name, both of which can
change under a pull request without the pull request becoming a different one.

Resolution then goes through the **existing** create resolution path rather than a parallel one: a
selected pull request produces the same typed-name-shaped input the combobox already produces, so
"that branch exists" is answered by the machinery that already answers it for refs, including the
held-by refusal. A pull request whose branch is held by another worktree is refused for the same
reason and with the same words as a ref that is.

## D5 — The fork remote is stated, and stating it is all this change does

`isCrossRepository` plus `headRepositoryOwner` answer whether the head is on a fork and whose it is.
Where it is, the form states the remote that would be configured, before the create is authorized.

This change **does not configure the remote**. § 5 requires the announcement — "configuring a fork
remote is a repository-level side effect and is not something to discover afterwards" — and the
announcement is what makes the eventual write legitimate. Performing a repository-level write is a
separate obligation with its own failure surface, and folding it in here would put an unannounced
mutation inside a task whose acceptance is about announcing.

## Failure-surface inventory

The mutable resource this change touches is **none**: it reads a forge and renders rows.

| Question | Answer |
|---|---|
| Who owns writes | Nothing. This change performs no write — not to disk, not to git config, not to the forge. D5 states the fork remote rather than configuring it. |
| What serializes concurrent access | n/a — no shared mutable state. Two dialogs each run their own read; neither observes the other. |
| What a crash mid-write leaves behind | n/a — no write. A killed `gh` leaves the form in the "pull requests unavailable" row it already has to render. |
| Failed / malformed read | Fails **closed** and quiet: a non-zero exit, a timeout, a missing client, or JSON that does not parse all resolve to the one unavailable row. No partial list is rendered as if complete — a truncated list says so. |
| Two racing hosts | Two windows on one repository each ask `gh` independently and may see different lists a moment apart. Nothing is derived from the difference: the list is discovery, and the create re-resolves against git at submit time regardless of which row was clicked. |
