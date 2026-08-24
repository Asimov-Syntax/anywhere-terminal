interface BufferLine {
  readonly isWrapped?: boolean;
  translateToString(trimRight?: boolean): string;
}

interface CurrentScreenTerminal {
  rows: number;
  buffer: {
    active: {
      baseY: number;
      getLine(index: number): BufferLine | undefined;
    };
  };
}

const STRICT_CURSOR_TITLE = /^cursor(?: agent)?(?: cli)?$/i;
const APPROVAL_PROMPT = /^\s*(?:allow cursor agent to )?run this command\?\s*$/i;
const APPROVAL_CHOICE_KEY =
  /\((?:shift\+tab|ctrl\+[a-z]|esc(?:\s+or\s+[a-z])*|tab|enter|return|space|[a-z]|[↵⇧↹⎋⏎]{1,3})\)\s*$/i;
const APPROVAL_TAIL_ROWS = 8;

/** True only for an exact Cursor-owned terminal title, never a title substring. */
export function hasStrictCursorTitle(title: string | undefined): boolean {
  return STRICT_CURSOR_TITLE.test(title?.trim() ?? "");
}

function isApprovalChoice(line: string): boolean {
  if (!APPROVAL_CHOICE_KEY.test(line)) {
    return false;
  }
  const choice = line
    .trimStart()
    .replace(/^[→›❯>]\s*/, "")
    .toLowerCase();
  return (
    choice.startsWith("run (once)") ||
    (choice.startsWith("add shell(") && choice.includes("to allowlist?")) ||
    choice.startsWith("run everything") ||
    choice.startsWith("skip & tell the agent")
  );
}

/**
 * Classify an approval dialog from the visible xterm screen tail. The caller
 * invokes this only after a live write has committed to xterm.
 */
export function hasCurrentCursorApproval(
  terminal: CurrentScreenTerminal,
  hasValidatedHookIdentity: boolean,
  title?: string,
): boolean {
  if (!hasValidatedHookIdentity && !hasStrictCursorTitle(title)) {
    return false;
  }

  const screenTop = terminal.buffer.active.baseY;
  let contentBottom = screenTop + terminal.rows - 1;
  while (contentBottom >= screenTop) {
    const line = terminal.buffer.active.getLine(contentBottom);
    if ((line?.translateToString(true) ?? "").trim() !== "") {
      break;
    }
    contentBottom -= 1;
  }
  if (contentBottom < screenTop) {
    return false;
  }

  const top = Math.max(screenTop, contentBottom - (APPROVAL_TAIL_ROWS - 1));
  const lines: string[] = [];
  for (let index = top; index <= contentBottom; index += 1) {
    const line = terminal.buffer.active.getLine(index);
    const text = line?.translateToString(true) ?? "";
    if (line?.isWrapped && lines.length > 0) {
      lines[lines.length - 1] = `${lines.at(-1)} ${text.trimStart()}`;
    } else {
      lines.push(text);
    }
  }

  const promptIndex = lines.findIndex((line) => APPROVAL_PROMPT.test(line));
  if (promptIndex === -1) {
    return false;
  }

  const choiceIndexes: number[] = [];
  for (let index = promptIndex + 1; index < lines.length; index += 1) {
    if (isApprovalChoice(lines[index])) {
      choiceIndexes.push(index);
      continue;
    }
    if (index + 1 < lines.length && isApprovalChoice(`${lines[index].trimEnd()} ${lines[index + 1].trimStart()}`)) {
      choiceIndexes.push(index + 1);
      index += 1;
    }
  }
  return choiceIndexes.length >= 2 && choiceIndexes.at(-1) === lines.length - 1;
}
