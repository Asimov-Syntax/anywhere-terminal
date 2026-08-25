// src/vault/claudeContextTag.ts — Recover the context-window tag a resumed
// Claude session should run under.
//
// Claude writes only the CANONICAL model id to a transcript: a session started
// as `claude-opus-5[1m]` records `claude-opus-5`, and nothing in the session or
// its sidecars carries the window. So `claude --resume <id>` — ours or the
// user's own — comes back at 200k, never the 1M the session ran under. The tag
// survives only when the resume argv restates it, and the one place it is still
// written down is the user's configured default model.
//
// Which file that is follows Claude's own model precedence, because a resume
// that reads a lower level than the CLI would pin the wrong window:
//   ANTHROPIC_MODEL  >  <project>/.claude/settings.local.json
//                    >  <project>/.claude/settings.json
//                    >  <config-root>/settings.json
// The config root has no `settings.local.json` scope — only a project does.
// See https://code.claude.com/docs/en/settings (precedence) and
//     https://code.claude.com/docs/en/model-config (`[1m]` suffix).

import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Trailing `[...]` on a model string, e.g. `opus[1m]` -> `[1m]`. */
const CONTEXT_TAG_RE = /\[[^\]\s]+\]$/;

export function contextTagOf(model: string): string | undefined {
  return CONTEXT_TAG_RE.exec(model)?.[0];
}

/** `claude-opus-5` + `[1m]` -> `claude-opus-5[1m]`; a model that already names a
 *  window keeps its own. */
export function applyContextTag(model: string, tag: string | undefined): string {
  if (!tag || contextTagOf(model)) {
    return model;
  }
  return `${model}${tag}`;
}

async function readModelSetting(file: string): Promise<string | undefined> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    const model = (parsed as { model?: unknown } | null)?.model;
    return typeof model === "string" ? model : undefined;
  } catch {
    return undefined; // absent or malformed settings → fall through to the next level
  }
}

/**
 * The nearest ancestor of `cwd` holding a `.claude` directory — Claude's project
 * settings live at the project root, which is an ancestor when the session was
 * started from a subdirectory. `configRoot` is excluded: a cwd under the home dir
 * would otherwise walk into the USER config and read its `settings.local.json`,
 * which is not a scope Claude honours at that level.
 */
async function findProjectClaudeDir(cwd: string, userRoots: (string | undefined)[]): Promise<string | undefined> {
  const excluded = new Set(userRoots.filter((r): r is string => !!r).map((r) => path.resolve(r)));
  let dir = path.resolve(cwd);
  for (;;) {
    const candidate = path.join(dir, ".claude");
    if (!excluded.has(candidate)) {
      try {
        if ((await fs.stat(candidate)).isDirectory()) {
          return candidate;
        }
      } catch {
        // keep walking up
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

export interface ClaudeContextTagOptions {
  /** `$CLAUDE_CONFIG_DIR` for this entry, already resolved by the caller. */
  configDir?: string;
  /** Home dir; the config root is skipped when the caller supplies neither. */
  home?: string;
  /** The session's cwd, from which the project scope is discovered. */
  cwd?: string;
  /** `$ANTHROPIC_MODEL`, which outranks the `model` key in every settings file. */
  envModel?: string;
}

/**
 * The context tag the model Claude would actually pick carries. The FIRST level
 * that defines `model` wins outright — so a project pinning an untagged `sonnet`
 * over a user-level `opus[1m]` correctly yields no tag, rather than widening a
 * session the CLI would have run narrow.
 */
export async function readClaudeContextTag(options: ClaudeContextTagOptions = {}): Promise<string | undefined> {
  if (options.envModel) {
    return contextTagOf(options.envModel);
  }

  const configRoot = options.configDir ?? (options.home ? path.join(options.home, ".claude") : undefined);
  const files: string[] = [];
  const homeRoot = options.home ? path.join(options.home, ".claude") : undefined;
  const projectDir = options.cwd ? await findProjectClaudeDir(options.cwd, [configRoot, homeRoot]) : undefined;
  if (projectDir) {
    files.push(path.join(projectDir, "settings.local.json"), path.join(projectDir, "settings.json"));
  }
  if (configRoot) {
    files.push(path.join(configRoot, "settings.json"));
  }

  for (const file of files) {
    const model = await readModelSetting(file);
    if (model !== undefined) {
      return contextTagOf(model);
    }
  }
  return undefined;
}
