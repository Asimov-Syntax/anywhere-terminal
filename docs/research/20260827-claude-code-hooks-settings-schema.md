---
topic: claude-code-hooks-settings-schema
created-by: install-claude-hooks
date: 2026-08-27
verified: 2026-08-27
libraries: [Claude Code]
used-by: [install-claude-hooks]
---

# Research: claude-code-hooks-settings-schema

## Answers

### Settings root

- A Claude Code settings file is a strict JSON object. The published SchemaStore schema declares root `type: "object"` and `additionalProperties: true`; unknown top-level keys are schema-permitted. The official settings guide also shows the optional top-level `$schema` key:

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "hooks": {}
}
```

- `hooks` is a top-level settings key. The official hooks reference defines its runtime structure as an **object** whose keys are hook event names. It is not documented as an array, string, boolean, or null.
- The published schema can lag new CLI releases; official docs say a schema warning for a recently documented key does not itself prove that runtime configuration is invalid.

### Hooks nesting and shape

The documented settings shape has three required container levels:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/lint-check.sh"
          }
        ]
      }
    ]
  }
}
```

| Location | Required shape | Schema evidence |
|---|---|---|
| `hooks` | object keyed by event | Official hooks reference |
| `hooks.<Event>` | array of matcher-group objects | Official hooks reference |
| matcher group | object; `hooks` required; optional `matcher` string | Schema `$defs/hookMatcher`: `type: object`, `additionalProperties: false`, `required: ["hooks"]` |
| matcher group `.hooks` | array of handler objects | Schema `$defs/hookMatcher` |
| handler | object from a closed five-branch union | Each SchemaStore branch has `additionalProperties: false` |

`matcher` is a string, not an array. Omit it, use `""`, or use `"*"` for match-all. `|` or `,` go inside a string for alternatives; values containing other regex characters are unanchored JavaScript regular expressions.

### Handler schema

The handler union is closed to these documented `type` values:

| Type | Required fields | Optional fields documented/schema-defined |
|---|---|---|
| `command` | `type`, non-empty `command` | `timeout` (>0 number), `async`, `asyncRewake`, `shell` (`bash` or `powershell`), `if`, `statusMessage`, `args` (string array) |
| `http` | `type`, non-empty `url` | `headers` (string-valued object), `allowedEnvVars` (non-empty string array), `timeout`, `if`, `statusMessage` |
| `mcp_tool` | `type`, non-empty `server`, non-empty `tool` | `input` (object), `timeout`, `if`, `statusMessage` |
| `prompt` | `type`, non-empty `prompt` | `model`, `timeout`, `if`, `statusMessage`, `continueOnBlock` (boolean) |
| `agent` | `type`, non-empty `prompt` | `model`, `timeout`, `if`, `statusMessage` |

For `command`, providing `args` uses direct executable spawning; `shell` is ignored. For `http`, environment-variable interpolation in `headers` requires listing each variable in `allowedEnvVars`. The hooks reference identifies agent hooks as experimental.

### Validity evidence for non-object/array values

- Runtime/documented nesting requires `hooks` to be an object, each event value to be an array, each matcher group to be an object, and matcher-group `hooks` to be an array. The documented schema explicitly rejects extra matcher-group fields and extra handler fields (`additionalProperties: false`).
- The schema explicitly requires the matcher-group `hooks` property; no `minItems` is declared for that handler array.
- No array/string/boolean/null alternative is documented for `hooks`, an event value, a matcher group, or matcher-group `hooks`; treating any of those non-container shapes as supported lacks official evidence.
- `matcher` is only documented/schema-defined as a string. Arrays and boolean-expression syntax are not supported; `if` is one permission-rule string and does not support `&&`, `||`, or a list.
- Unknown hook events are reported as individual **Settings Warning** entries and skipped while remaining valid settings continue. Invalid JSON or a schema-rejected value produces a **Settings Error** for the file.

### Current event names and matcher support

Documented hook event keys:

```text
SessionStart, Setup, UserPromptSubmit, UserPromptExpansion, PreToolUse,
PermissionRequest, PermissionDenied, PostToolUse, PostToolUseFailure,
PostToolBatch, Notification, MessageDisplay, SubagentStart, SubagentStop,
TaskCreated, TaskCompleted, Stop, StopFailure, TeammateIdle,
InstructionsLoaded, ConfigChange, CwdChanged, DirectoryAdded, FileChanged,
WorktreeCreate, WorktreeRemove, PreCompact, PostCompact, Elicitation,
ElicitationResult, SessionEnd
```

`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, and `PermissionDenied` match tool names. `SessionStart`, `Setup`, `SessionEnd`, `Notification`, `SubagentStart`/`SubagentStop`, `PreCompact`/`PostCompact`, `ConfigChange`, `DirectoryAdded`, `FileChanged`, `StopFailure`, `InstructionsLoaded`, `UserPromptExpansion`, and `Elicitation`/`ElicitationResult` each have event-specific matcher values.

`CwdChanged`, `UserPromptSubmit`, `PostToolBatch`, `Stop`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`, `WorktreeCreate`, `WorktreeRemove`, and `MessageDisplay` have no matcher support; an included `matcher` is silently ignored.

### Other top-level keys affecting hook behavior

| Key | Officially stated effect / scope |
|---|---|
| `disableAllHooks` | Disables hooks, custom status line, and custom `@` file suggestion together; Any file |
| `allowManagedHooksOnly` | Runs only organization-deployed hooks; Managed only |
| `allowedHttpHookUrls` | Limits URLs HTTP hooks may target; Any file |
| `httpHookAllowedEnvVars` | Limits environment variables HTTP hooks may put in headers; Any file |
| `strictPluginOnlyCustomization.hooks` | Managed setting that locks hooks to plugin and managed sources |

Settings sources are ordered managed, command-line `--settings`, project-local, shared project, user. The settings guide separately states that list keys merge across settings files, but does not identify `hooks` as a list key; `hooks` is specified as an object event map. The retrieved official material does not give a recursive cross-file merge algorithm for event arrays.

### Local integration evidence

The existing project `.claude/settings.json` uses the documented form: top-level object `hooks`; event arrays; matcher-group objects; nested handler arrays. It uses `SubagentStart`, `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`, `SessionEnd`, and `SubagentStop` with `command` handlers and positive numeric `timeout` values.

## Gotchas & Constraints

- The published schema says unknown root keys are allowed, but matcher groups and handlers reject unknown fields. Thus top-level permissiveness must not be projected into hook internals.
- `hooks` is a map/object, not a documented list. Therefore an object-oriented merge needs event-level treatment; there is no official evidence that a concatenation designed for arrays represents the runtime's cross-file behavior.
- A matcher on an event without matcher support is accepted but ignored, not a filter.
- Hook configuration reloads when settings files change. Hook-related unknown event names are dropped as individual warnings rather than necessarily disabling all unrelated valid settings.

## Confidence

High — current official Claude Code hooks and settings documentation cross-checked with the published SchemaStore `claude-code-settings.json` schema; local settings usage matches the documented nesting. The only unresolved point is the official runtime's recursive cross-file merge algorithm for `hooks`, which was not specified in the retrieved sources.

## Sources

- [Claude Code hooks reference](https://code.claude.com/docs/en/hooks)
- [Claude Code settings](https://code.claude.com/docs/en/settings)
- [Claude Code settings reference](https://code.claude.com/docs/en/settings-reference)
- [Claude Code published JSON Schema](https://json.schemastore.org/claude-code-settings.json)
