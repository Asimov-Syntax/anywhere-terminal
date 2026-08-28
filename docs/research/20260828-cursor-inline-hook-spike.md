# Cursor inline hook hardening spike — 2026-08-28

## Purpose

Execute the exact POSIX command that `inline-cursor-hooks` freezes as both runtime behavior and ownership identity. This is a real-agent gate, not a string comparison: a literal that `/bin/sh` accepts but Cursor silently refuses is not shippable.

Reproducible harness: `bun scripts/verify-cursor-inline-hook.mjs`.

## Environment

- Host: Darwin 25.4.0, arm64
- Cursor Agent: `2026.08.25-3e8eec8`
- Hook shell observed: GNU bash `3.2.57(1)-release` (`/bin/sh`)
- Exact command: 836 UTF-8 bytes
- SHA-256: `24f7c4b159e6312d8bb128442a0daf9d74d42ea953271d9ead395aab8d053b37`
- Scratch configuration: project `.cursor/hooks.json`, version 1, `sessionStart` and `sessionEnd`
- Listener: OS-assigned `127.0.0.1` port, UUID session segment, 64-lowercase-hex token

## Result

The exact frozen bytes executed through `cursor-agent --trust -p` and the process exited 0. The loopback listener received valid JSON payloads for:

- `sessionStart`
- `sessionEnd`

The scratch project hook file was byte-identical before and after the run. The user's `~/.cursor/hooks.json` was hashed before and after and remained byte-identical. No user configuration was written.

The harness also injected exported `command` and `awk` functions plus inherited `SHELLOPTS=xtrace`; neither imported function ran and the hook payload did not appear in Cursor's stderr.

## Cursor grammar admission found during the spike

The first approved validator was valid POSIX shell but Cursor ignored the whole hook before a prefixed marker executed. Bounded component and length probes isolated the cause:

- simple hook commands from 300 through 1,500 bytes executed, ruling out command length;
- the command executed through `url=${ANYWHERE_TERMINAL_CURSOR_URL:-}`;
- adding shell pattern-removal expansion (`${url#http://127.0.0.1:}`) made Cursor silently ignore it;
- a replacement whole-string validator using `command -p awk` executed under the real agent.

The frozen generation therefore uses POSIX awk to admit exactly:

```
http://127.0.0.1:<1..65535>/<lowercase UUID>/<64 lowercase hex>
```

and then gives curl `--disable --noproxy '*' --globoff --proto '=http' --` before the URL operand.

## Shell startup boundary

The harness supplied a benign `BASH_ENV` marker. Cursor's selected bash sourced it **before** the managed command (`shellStartupFileSourced: true`). No command text can sanitize code that has already executed with the process's stdin authority, so the capability spec now places arbitrary shell/loader startup code outside the AnyWhere Terminal-controlled privacy boundary. Proxy variables, curl startup files, imported utility functions, URL authority, and network routing remain inside and are closed by the literal/tests.

## Direct-shell evidence retained by the unit suite

`src/cursor/CursorHookInstaller.test.ts` runs the same exported bytes through `/bin/sh -c` and pins:

- neutral JSON and semantic JSON delivery;
- missing, non-loopback, malformed-port, query, token, and userinfo-authority rejection;
- inherited PATH and exported `command`/`awk` function refusal;
- inherited xtrace suppression;
- `http_proxy` and `.curlrc`/`CURL_HOME` sensitivity controls plus hardened bypass;
- failed trusted `awk`/`cat` lookup draining stdin without fallback;
- closed stdout via ignored `PIPE`, unread-stdin EPIPE control, and bounded listener failure.

## Re-run output

```json
{
  "agentExitCode": 0,
  "commandBytes": 836,
  "commandSha256": "24f7c4b159e6312d8bb128442a0daf9d74d42ea953271d9ead395aab8d053b37",
  "cursorAgentVersion": "2026.08.25-3e8eec8",
  "deliveredEvents": ["sessionStart", "sessionEnd"],
  "projectConfigUnchanged": true,
  "shellStartupFileSourced": true,
  "shellVersion": "GNU bash, version 3.2.57(1)-release (arm64-apple-darwin25)",
  "userConfigState": "sha256-unchanged"
}
```
