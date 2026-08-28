// src/agentHooks/opencodeConfigDir.ts — The configuration directory AnyWhere
// Terminal owns, holding exactly one plugin.
//
// OpenCode reads `OPENCODE_CONFIG_DIR` as one MORE configuration directory, not
// as a replacement (measured on 1.18: `config/paths.ts` returns the global dir,
// the project `.opencode` dirs, and this one), and scans every one of them for
// `{plugin,plugins}/*.{ts,js}`. So a directory holding one plugin file is the
// whole mechanism — the user's own configuration is never read, copied, or
// mirrored.
//
// See: asimov/changes/agent-session-hook-identity/design.md D2.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildOpenCodePluginSource, OPENCODE_PLUGIN_FILE } from "./opencodePlugin";

export const OPENCODE_CONFIG_DIR_ENV = "OPENCODE_CONFIG_DIR";

type FileSystem = {
  mkdir: typeof mkdir;
  readFile: typeof readFile;
  writeFile: typeof writeFile;
};

export interface OpenCodeConfigDirOptions {
  /** Extension-owned root; the directory and its `plugin/` child are created here. */
  storagePath: string;
  env?: NodeJS.ProcessEnv;
  fs?: Partial<FileSystem>;
}

/**
 * Write the plugin, and say what to add to a terminal's environment.
 *
 * Returns no contribution when the environment already selects a configuration
 * directory: that selection is the user's, and `OPENCODE_CONFIG_DIR` holds one
 * value, so the only alternatives are to keep theirs or to hide it. Identity
 * for that terminal falls back to whatever presence can prove without a report.
 */
export async function installOpenCodePlugin(options: OpenCodeConfigDirOptions): Promise<Record<string, string>> {
  const env = options.env ?? process.env;
  if (typeof env[OPENCODE_CONFIG_DIR_ENV] === "string" && env[OPENCODE_CONFIG_DIR_ENV].trim() !== "") {
    return {};
  }
  const fs: FileSystem = {
    mkdir: options.fs?.mkdir ?? mkdir,
    readFile: options.fs?.readFile ?? readFile,
    writeFile: options.fs?.writeFile ?? writeFile,
  };

  const configDir = join(options.storagePath, "opencode-config");
  const pluginDir = join(configDir, "plugin");
  const pluginPath = join(pluginDir, OPENCODE_PLUGIN_FILE);
  const source = buildOpenCodePluginSource();

  try {
    // Rewritten only when it differs, so an OpenCode already watching the file
    // is not restarted by every terminal this window opens.
    const existing = await fs.readFile(pluginPath, "utf8").catch(() => undefined);
    if (existing !== source) {
      await fs.mkdir(pluginDir, { recursive: true });
      await fs.writeFile(pluginPath, source, "utf8");
    }
  } catch {
    // Fail open: an unwritable storage path costs the report, not the terminal.
    return {};
  }
  return { [OPENCODE_CONFIG_DIR_ENV]: configDir };
}
