# Orca's git worktree mechanics — what to port, what to reject

> **Change**: `enumerate-git-worktrees` (WT-001.1)
> **Source**: `/Users/huybuidac/Projects/ai-oss/orca` @ 2026-08-26, plus an empirical git probe
> **Why this doc**: `docs/research/20260822-orca-deep-dive/` covers agent detection, hooks, and
> orchestration. It does not cover orca's git layer, which is the part WT-001 actually reuses.

Orca ships a working `git worktree list` reader. The value is not its code — it is the four
behaviours it learned that a first implementation gets wrong.

## 1. Capability detection is by exit code, not by message text

`src/shared/git-worktree-command-capabilities.ts`:

| Capability | Signal | Why the obvious approach fails |
|---|---|---|
| `worktree list -z` (git ≥ 2.36) | **exit code 129**, with a message regex only as backup | 129 is git's usage-error code and is locale-independent. Matching `unknown option` fails on a non-English git |
| `rev-parse --path-format` (git ≥ 2.31) | **exit 0**, with `--path-format` echoed as an output line | Old git does not fail. It *succeeds* and prints the flag back. Anything treating exit 0 as success reads the flag itself as a path |

The `--path-format` case is the one that bites: `hasUnsupportedRevParsePathFormatEcho` exists
because the failure is invisible to normal error handling.

## 2. Non-`-z` porcelain does not quote paths — verified

Probed against git 2.50.1 with a worktree at `…/we\nird`:

```
### --porcelain          ### --porcelain -z
worktree /tmp/x/we       worktree /tmp/x/we
ird                 <──  ird\0            <── same bytes, unambiguous terminator
HEAD 598fc1e8…          HEAD 598fc1e8…
```

The path is emitted **raw**. There is no c-quoting to decode, so a newline in a path is
genuinely ambiguous in the line-delimited form — the parser sees a block whose first line is
`worktree /tmp/x/we` and a stray line `ird`, and a naive parser silently records the wrong path.

**Consequence**: the fallback must *detect and skip*, not decode. Detection = a line inside a
record matching no known token. Orca's own parser does not do this and would record `/tmp/x/we`.

C-quoting *does* apply to `locked <reason>` and `prunable <reason>` in the non-`-z` form —
orca decodes exactly those two and nothing else (`git-handler-utils.ts:170,176`).

## 3. A capability cache should expire, not be permanent

`GitCapabilityCache` (`src/shared/git-capability-cache.ts:3`) re-probes after 30 minutes:

> suppress hot-loop failures while still detecting an in-place Git upgrade during a long Orca
> session without requiring a restart

It also dedupes concurrent probes so a burst of repos does not each pay the failing call.

This contradicts `docs/design/worktree-model.md` § 3.6 ("Never — a git downgrade mid-session is
not modelled"). The doc reasons about downgrades; orca reasons about **upgrades**, which is the
direction users actually move — especially the user who was just told their git is too old.

## 4. Orca's path normalizer is a counter-example, not a source

`git-handler-worktree-ops.ts:122` normalizes lexically — `path.resolve` + `path.normalize`, no
realpath, no NFC, no case folding. `docs/DESIGN.md` D4 rejects exactly this, because macOS
reports `/private/var` from the process table and `/var` from git. Do not port it.

## Verdict

| Orca artifact | Port? |
|---|---|
| Exit-129 and exit-zero-echo detection | **Yes** — as two tested predicates |
| Skip-don't-decode rule for ambiguous fallback records | **Yes**, strengthened past orca's own parser |
| Capability retry interval + in-flight probe dedup | **Behaviour yes**, class no |
| `GitCapabilityCache` class | **No** — two capabilities today; a `Map` + one function is the rung |
| `annotatePrunableWorktreesByExistence` worker-pool shape | **Yes** — concurrency 8, skip main/locked |
| One parser + `{ nulDelimited }` option, not two entry points | **Yes** |
| Lexical path normalizer | **No** — see § 4 |
