# Claude inline hook real-CLI spike

## Result

`bun scripts/verify-claude-inline-hook.mjs` passed on 2026-08-28.

- Claude Code: `2.1.250 (Claude Code)`
- Hook shell: `/bin/sh`, GNU bash `3.2.57(1)-release (arm64-apple-darwin25)`
- Exported `CLAUDE_HOOK_COMMAND`: 1,046 UTF-8 bytes; SHA-256 `a2a47005c04f2bcc870ef97f16f8a64a42bdcb1075586234e62c300e05a00e6a`
- The non-interactive, bounded CLI invocation exited 0 and delivered `SessionStart` and `Stop` to the uniquely tokened `127.0.0.1` recorder through the literal loaded from the explicit settings file.
- The `SessionStart` payload carried `source: "startup"`; the listener was accepting requests before Claude Code started.

## Isolation and privacy checks

The harness gives the child process a disposable `HOME` and `CLAUDE_CONFIG_DIR`, supplies the settings file with `--settings`, and uses `--setting-sources project`. The scratch user and local settings each register a `SessionStart`/`Stop` sentinel that writes a marker when loaded. Neither marker appeared, proving the explicitly excluded `user` and `local` sources did not run.

It fingerprints the explicit, project, local, and scratch-user settings before and after the CLI run. It separately fingerprints the real user's `~/.claude/settings.json` before and after without modifying it. All fingerprints remained unchanged. Scratch state is removed in a `finally` block.

The recorder accepts only the generated loopback route. The harness rejects any lifecycle body reproduced on Claude stderr and rejects stderr that exposes the recorder coordinate. The passing invocation produced no payload on stderr.
