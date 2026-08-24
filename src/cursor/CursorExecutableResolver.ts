import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentVaultDefinition } from "../vault/types";

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 2000;

export interface ExecutableProbeDeps {
  exec(file: string, args: string[], options: { timeout: number }): Promise<{ stdout: string; stderr: string }>;
}

const defaultDeps: ExecutableProbeDeps = {
  exec: (file, args, options) =>
    execFileAsync(file, args, { timeout: options.timeout }).then(({ stdout, stderr }) => ({
      stdout: stdout.toString(),
      stderr: stderr.toString(),
    })),
};

function hasOptionOperand(line: string, option: string): boolean {
  const optionPrefix = `^\\s*(?:-[a-z0-9?],\\s*)?${option}`;
  return new RegExp(`${optionPrefix}(?:=|\\s+)(<[^>]+>|\\[[^\\]]+\\]|[^\\s,]+)`, "i").test(line);
}

function hasFlag(line: string, option: string): boolean {
  return new RegExp(`^\\s*(?:-[a-z0-9?],\\s*)?${option}(?:\\s|,|$)`, "i").test(line);
}

function hasPositionalPrompt(usageTail: string): boolean {
  const tokens = usageTail.match(/\[[^\]]+\]|<[^>]+>|\S+/g) ?? [];
  return tokens.some((token, index) => {
    if (!/^\[prompt(?:\.\.\.)?\]$|^<prompt(?:\.\.\.)?>$/i.test(token)) {
      return false;
    }
    return !/^\[?--prompt(?:=|\]?$)/i.test(tokens[index - 1] ?? "");
  });
}

function isCursorHelp(output: string): boolean {
  const lines = output.split(/\r?\n/);
  const usageMatch = lines
    .map((line) => line.match(/^\s*usage:\s+(\S+)\s+(.+)$/i))
    .find((match): match is RegExpMatchArray => match !== null);
  if (!usageMatch || !hasPositionalPrompt(usageMatch[2])) {
    return false;
  }

  const usageCommand = usageMatch[1].split(/[\\/]/).at(-1)?.toLowerCase();
  const identifiesCursor =
    usageCommand === "cursor-agent" ||
    lines.some((line) => /^\s*(?:cursor agent|start the cursor agent)\s*$/i.test(line));
  if (!identifiesCursor) {
    return false;
  }

  const resumeLine = lines.find((line) => hasOptionOperand(line, "--resume"));
  const modeLine = lines.find((line) => hasOptionOperand(line, "--mode") && /\bplan\b/i.test(line));
  const forceLine = lines.find((line) => hasFlag(line, "--force"));
  return resumeLine !== undefined && modeLine !== undefined && forceLine !== undefined;
}

export async function resolveAgentExecutable(
  definition: AgentVaultDefinition,
  deps: ExecutableProbeDeps = defaultDeps,
): Promise<string | null> {
  const candidates = [definition.detect.executable, ...(definition.detect.aliases ?? [])];
  const requiredTokens = definition.detect.requiredHelpTokens?.map((token) => token.toLowerCase());
  const probeArgs = requiredTokens ? ["--help"] : ["--version"];

  for (const candidate of candidates) {
    try {
      const result = await deps.exec(candidate, probeArgs, { timeout: PROBE_TIMEOUT_MS });
      if (!requiredTokens) {
        return candidate;
      }
      const output = `${result.stdout}\n${result.stderr}`;
      const normalizedOutput = output.toLowerCase();
      if (
        requiredTokens.every((token) => normalizedOutput.includes(token)) &&
        (definition.id !== "cursor" || isCursorHelp(output))
      ) {
        return candidate;
      }
    } catch {
      // Try the next configured executable.
    }
  }

  return null;
}
