No external capability changes. Every behaviour this change touches is already specified and
already implemented — the render cap by `worktree-panel` § "A capped listing says it is capped",
which passes today at `src/webview/worktree/WorktreeView.ts:56,618` and `WorktreeView.test.ts:217`;
the rebuild and second-surface bounds by `worktree-tree-protocol`. This change proves those
contracts and publishes the cap's value; it does not alter either. The latency and cost budgets
are proof-only quality targets owned by the design docs, not externally mandated constraints.
