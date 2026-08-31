# Proposal — offer a pull request as a source

## Why

The create dialog can start a worktree from any local branch, and from a new one. It cannot start
one from the thing people actually work off in a review-driven repository: an open pull request.
Today that means leaving the dialog, finding the PR, working out its head branch, fetching it, and
coming back to type the name — which is the exact detour § 4.1 built one combobox to delete.

`worktree-create.md` § 5 already settles what this should look like. What it does not settle is how
the forge is reached, which is what Gate 1 closed: the `gh` CLI.

## Scope

- Pull requests are read for the repository the dialog was opened on, bounded and capped.
- They render as rows in the existing branch list, ordered after prefix matches and before
  create-new, per § 4.1.
- Selecting one resolves to `pr/<number>` and to the pull request's own base ref, reusing the
  existing branch where that name already exists.
- A head on a fork states the remote that would be configured, before the create is authorized.
- An unauthenticated, unreachable, slow, or absent forge is one quiet row, and never delays or
  disables local ref search or the create.

## Non-goals, and must-nots

- **Must not** configure the fork remote. § 5 requires the announcement; the write is a separate
  obligation with its own failure surface (design.md D5). Announcing and writing in one task would
  put an unannounced mutation inside a task whose acceptance is about announcing.
- **Must not** hold, read, forward, or log a credential. `gh` owns the token; nothing here sees it,
  and no token reaches the webview.
- **Must not** let the pull-request read delay, gate, or fail the ref list, the create-new row, or
  the create itself.
- **Must not** add a tab, a mode switch, or a second search input — the reason § 4.1 exists.
- Issue-driven and URL-driven creation stay out of scope, as the recorded deferral has them.
- Forges other than GitHub stay out of scope: they resolve to the same unavailable row.

## Appetite

Size L, one change. The dialog work is additive to a list that already has a row union, and the read
reuses the existing bounded runner, so the weight is in the states rather than in the mechanism:
unavailable, truncated, held-by, fork, and reuse each have to be visible and testable.

## Risk

The load-bearing risk is **a network dependency inside a control that must stay responsive**. It is
answered structurally rather than by care: the pull-request read is a separate promise posting a
separate message (design.md D3), so there is no code path on which refs wait for the forge. The
second risk is a **wrong branch under a right-looking name** — mitigated by minting `pr/<number>`
from the number alone (D4), never from a title or head ref that can change under the pull request.
