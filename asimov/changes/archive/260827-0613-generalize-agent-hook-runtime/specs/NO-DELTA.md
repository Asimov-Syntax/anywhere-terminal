# NO-DELTA

Behavior-preserving generalization. The agent-facing contract is frozen (`ANYWHERE_TERMINAL_CURSOR_URL`, the `/<sessionId>/<token>/cursor` path, the installed wrapper script, the `anywhereTerminal.cursorAgent.hooks.enabled` key), and multi-agent capacity is unobservable until WT-006.2 registers a second agent.

The one wire change — `200 {}` becomes `204` with no body, per agent-hook-server.md § 4.1 — is not an external capability: the endpoint is loopback-only and its sole client is the extension's own managed wrapper, which discards the response (`curl --output /dev/null`, PowerShell `| Out-Null`). The `{}` an agent reads is the wrapper's own stdout and is unchanged.
