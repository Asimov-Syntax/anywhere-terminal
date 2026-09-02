// src/worktree/provisioning/vscodeTasksProvider.ts — Read the tasks a
// repository declares to run when a worktree is created
// (worktree-provisioning.md § 3.3).
//
// The file is JSONC and is parsed by `jsonc-parser`, the parser VS Code itself
// uses for it, so this adapter agrees with the editor by construction rather
// than by our coverage of comment-and-escape edge cases (design.md D1).
//
// Nothing here runs anything. `script` is display text now and one argument to a
// shell later, and the quoting below is what keeps those two the same command.

import type { ParseError } from "jsonc-parser";
import { posixShellQuote } from "../../utils/posixShellQuote";
import {
  type AdapterRead,
  type Authorized,
  addSetup,
  type Draft,
  modelFromDraft,
  newDraft,
  openProviderFile,
  type ProviderAdapter,
  type ProviderBudget,
  type ProviderContext,
  type ProviderDeps,
  problem,
  readJsonc,
  report,
} from "./providerKit";

export const VSCODE_TASKS_FILE = ".vscode/tasks.json";

/** The `runOptions.runOn` value that declares a task as worktree setup. */
const RUN_ON_CREATE = "worktreeCreated";

const TASKS: ProviderContext = { id: "vscodeTasks", file: VSCODE_TASKS_FILE };

/**
 * One POSIX single-quoted word.
 *
 * `'` is the only character with meaning inside single quotes, and closing,
 * escaping and reopening is the one rendering nothing escapes — `;`, `$(id)`,
 * a newline and a space all become literal.
 */

/**
 * A task's command line, on the terms the task declared.
 *
 * A `shell` task's `command` is already shell text and stays verbatim. Every
 * other kind — including a task with no `type` — runs with NO shell, so its
 * `command` is a literal executable name: `./bin/build; touch /tmp/x` is a file
 * with a semicolon in it, and rendering that into text a later task hands to
 * `sh -c` turns one safe task into two commands (design.md D4). Quoting it keeps
 * the semantics the file declared, and keeps an executable path containing a
 * space working. An absent `type` is quoted rather than guessed: a wrong guess
 * that way is a step that fails visibly, the other way it is the injection.
 */
function scriptFor(entry: Record<string, unknown>, label: string, draft: Draft): string | null {
  const command = entry.command;
  if (typeof command !== "string" || command.trim() === "") {
    report(draft, label, problem(TASKS, "malformed", `${label} declares no command.`));
    return null;
  }
  const head = entry.type === "shell" ? command : posixShellQuote(command);
  const declared = entry.args;
  if (declared === undefined) {
    return head;
  }
  if (!Array.isArray(declared)) {
    report(draft, label, problem(TASKS, "malformed", `${label} has \`args\` that is not a list.`));
    return head;
  }
  const words: string[] = [];
  for (const raw of declared) {
    // VS Code also allows `{ value, quoting }`; the value is the argument and
    // the quoting is advice about a shell this does not run.
    const value =
      typeof raw === "string"
        ? raw
        : typeof (raw as { value?: unknown } | null)?.value === "string"
          ? (raw as { value: string }).value
          : null;
    if (value === null) {
      report(draft, label, problem(TASKS, "malformed", `${label} has an argument that is not text.`));
      continue;
    }
    // Always quoted, in both task kinds: an argument is one word to VS Code, and
    // it stays one word here.
    words.push(posixShellQuote(value));
  }
  return words.length === 0 ? head : `${head} ${words.join(" ")}`;
}

/**
 * What the step would need that this cannot supply.
 *
 * Both are offered anyway and neither is filled in. A `${...}` token is VS
 * Code's variable syntax and substituting a value we chose would run something
 * other than what the file says; `options.cwd` asks for a directory other than
 * the new worktree, which is the one thing the step is for. Named, so the user
 * sees which task it is.
 */
function reportUnsubstituted(entry: Record<string, unknown>, label: string, script: string, draft: Draft): void {
  if (script.includes("${")) {
    report(draft, label, problem(TASKS, "unsubstituted", `${label} holds a \`\${...}\` this does not resolve.`));
  }
  const options = entry.options;
  if (typeof options === "object" && options !== null && !Array.isArray(options)) {
    if ((options as Record<string, unknown>).cwd !== undefined) {
      report(draft, label, problem(TASKS, "unsubstituted", `${label} asks to run in a directory of its own.`));
    }
  }
}

export const vscodeTasksAdapter: ProviderAdapter = {
  id: "vscodeTasks",
  files: [VSCODE_TASKS_FILE],

  async read(
    deps: ProviderDeps,
    repoRoot: string,
    budget: ProviderBudget,
    authorized?: Authorized,
  ): Promise<AdapterRead | null> {
    const opened = await openProviderFile(deps, repoRoot, TASKS, undefined, authorized);
    if (opened.kind === "absent" || (opened.kind === "problem" && opened.at === "root")) {
      // Root failure is neither presence nor absence, and the dispatcher reads
      // any model as detection — so answering with one elected this adapter for
      // a checkout whose task file was never opened (.reviews/round-1.md F003).
      // The other two adapters already answer `null` here.
      return null;
    }
    const draft = newDraft(TASKS, budget);
    const nextId = draft.budget.nextId;

    if (opened.kind === "problem") {
      // Present and refused — reported, never read as "this repository declared
      // nothing".
      report(draft, `\`${VSCODE_TASKS_FILE}\``, opened.problem);
      return { model: modelFromDraft(draft) };
    }

    const errors: ParseError[] = [];
    const parsed: unknown = readJsonc(opened.text, errors);
    if (errors.length > 0) {
      report(
        draft,
        `\`${VSCODE_TASKS_FILE}\``,
        problem(TASKS, "malformed", `\`${VSCODE_TASKS_FILE}\` is not valid JSON with comments.`),
      );
      return { model: modelFromDraft(draft) };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      if (parsed !== undefined) {
        report(draft, `\`${VSCODE_TASKS_FILE}\``, problem(TASKS, "malformed", "The file is not a mapping of keys."));
      }
      return { model: modelFromDraft(draft) };
    }
    const declared = (parsed as Record<string, unknown>).tasks;
    if (declared === undefined) {
      return { model: modelFromDraft(draft) };
    }
    if (!Array.isArray(declared)) {
      report(draft, "`tasks`", problem(TASKS, "malformed", "`tasks` must be a list."));
      return { model: modelFromDraft(draft) };
    }

    // File order, so the section lists the steps in the order the repository
    // wrote them rather than one this module invented.
    for (const raw of declared) {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        continue;
      }
      const entry = raw as Record<string, unknown>;
      const runOptions = entry.runOptions;
      const runOn =
        typeof runOptions === "object" && runOptions !== null && !Array.isArray(runOptions)
          ? (runOptions as Record<string, unknown>).runOn
          : undefined;
      // Only what the repository declared as worktree setup. Every other task
      // is something the user runs when they choose to.
      if (runOn !== RUN_ON_CREATE) {
        continue;
      }
      const label = typeof entry.label === "string" && entry.label.trim() !== "" ? `\`${entry.label}\`` : "a task";
      const script = scriptFor(entry, label, draft);
      if (script === null) {
        continue;
      }
      reportUnsubstituted(entry, label, script, draft);
      if (!addSetup(draft, { id: nextId(), kind: "shell", script, source: VSCODE_TASKS_FILE })) {
        // Refused, so the rest are too: the budget is model-wide and one honest
        // message beats one per remaining task.
        break;
      }
    }
    return { model: modelFromDraft(draft) };
  },
};
