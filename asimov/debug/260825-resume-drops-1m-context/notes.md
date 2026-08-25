# 260825-resume-drops-1m-context

## Symptom

Clicking Resume on a Claude session restores the right model but not the right context
window: a session run as `opus[1M]` comes back as plain opus (200k).

## Root cause

Claude persists only the **canonical** model id. A session started with
`--model claude-sonnet-5[1m]` writes `claude-sonnet-5` to its transcript; the window is
recorded nowhere in the session or its sidecars. AT reads that canonical id into
`entry.flags.model` and pins it as `--model`, so the resumed CLI runs at 200k.

## What the live CLI probes showed

| argv | `modelUsage.contextWindow` |
|---|---|
| `claude -p --model 'claude-sonnet-5[1m]'` | 1 000 000 |
| that session's transcript record | `claude-sonnet-5` — tag absent |
| `claude --resume <id> --fork-session` (no `--model`) | 200 000 |
| `claude --resume <id> --model 'claude-sonnet-5[1m]'` | 1 000 000 |

## Ruled out (evidence in state.json)

1. **Shell quoting mangles the tag** — launch is argv-based; the tag never reaches the argv.
2. **Stale first-assistant capture (model switched mid-session)** — 0 of 997 bracket-model
   hits across every transcript on disk sit in an assistant record; all are tool-result text.
3. **AT's `--model` pin overrides the configured `opus[1m]`** — a *bare* `claude --resume`
   also lands at 200k and ignores `settings.json`. Dropping the pin would not have fixed it.
   This bug bites plain terminal resume too; AT is simply positioned to correct it.
4. **The tag is recoverable from the session** — it is not. Assistant records carry `effort`
   but no window.

## Fix

`src/vault/claudeContextTag.ts` reads the window tag off the reader's configured default
model (`<config-root>/settings.local.json` then `settings.json`), and `LaunchBuilder`
restates it on the `--model` value it emits for Claude. Reporter's choice, asked and
answered: **re-tag unconditionally**, no model-family check.

The config root resolves entry-captured `configDir` → injected `hostEnv.CLAUDE_CONFIG_DIR` →
`hostEnv.HOME`. It never falls back to `os.homedir()`: the first cut did, and four existing
tests started reading the developer's real `~/.claude/settings.json`. The injected-env seam
made them deterministic again with no test edits.

### Corrected after review (B1)

The first cut read the wrong sources. Claude's actual model precedence is
`ANTHROPIC_MODEL` > `<project>/.claude/settings.local.json` > `<project>/.claude/settings.json`
> `<config-root>/settings.json` — verified against code.claude.com/docs/en/settings and
/model-config. The first cut read a `settings.local.json` at the CONFIG root (not a scope
Claude honours at that level) and ignored the project scope and the env var entirely, so a
project pinning `opus[1m]` still resumed at 200k, and an untagged project pin could be
overridden by a tagged user default — widening a session the CLI would have run narrow.

Now the first level that defines `model` wins outright, and the project root is found by
walking up from `entry.cwd`. That walk introduced a bug of its own: a cwd under the home dir
reaches `~/.claude` and would have adopted it as a project root — reading the very
`settings.local.json` non-scope just removed. Both the config root and `<home>/.claude` are
excluded from the walk, with a test pinning it.

## What this does NOT settle

- **The accepted risk of the unconditional re-tag.** Resuming a session on a model with no
  1M variant while configured for `opus[1m]` emits e.g.
  `--model claude-haiku-4-5-20251001[1m]`. Not exercised against a live CLI — the reporter
  chose this over a family check with the risk stated. If Claude rejects such an argv the
  resume fails loudly rather than silently, but that path is unverified.
- **The tag is the reader's *current* preference, not the session's.** Nothing records what
  the session actually ran under, so this is a proxy. Resuming an old 200k session while
  configured for 1M now widens it.
- Whether Claude will start persisting the tag in a later version, which would make this
  inference redundant.

## Verified

`verify --reconfirm`: repro RED with the fix stashed, GREEN with it. Full suite 2920 passed.
Probe sessions under `/tmp/at1m.*` and their `~/.claude/projects` dir were removed.
