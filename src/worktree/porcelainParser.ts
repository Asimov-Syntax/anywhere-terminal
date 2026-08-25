// src/worktree/porcelainParser.ts — `git worktree list --porcelain [-z]` → records.
// See: docs/design/worktree-model.md § 3.3,
//      docs/research/20260826-orca-git-worktree-mechanics.md § 2

export interface ParsedWorktree {
  /** Path exactly as git reported it — not normalized here. */
  path: string;
  head?: string;
  branch?: string;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  lockReason?: string;
  prunable: boolean;
  kind: "main" | "linked";
}

export interface ParsedWorktreeList {
  worktrees: ParsedWorktree[];
  /** Deduplicated reasons for records that were skipped. */
  reasons: string[];
  /** One per skipped record, counted before the reasons are deduplicated. */
  skipped: number;
}

const UNPARSEABLE_REASON = "Unparseable `git worktree list` record (path may contain a newline)";
const UNDECODABLE_REASON = "`git worktree list` reported a path that is not valid UTF-8";
const PATHLESS_REASON = "`git worktree list` reported a record with no worktree path";

const RECORD_SEPARATOR_NUL = 0x00;
const RECORD_SEPARATOR_LF = 0x0a;
const CARRIAGE_RETURN = 0x0d;

const WORKTREE_PREFIX = "worktree ";

/**
 * Fatal so invalid bytes raise instead of becoming U+FFFD. Used for the path
 * alone: it is this module's identity key, and a substituted one names a
 * different file. `HEAD`, `branch` and the lock/prunable reasons are labels,
 * so they decode leniently — a replacement character in a label beats losing
 * a worktree the user actually has.
 */
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

function isDecodable(bytes: Buffer): boolean {
  try {
    strictUtf8.decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function isKnownField(field: string): boolean {
  return (
    field === "bare" ||
    field === "detached" ||
    field === "locked" ||
    field === "prunable" ||
    field.startsWith("worktree ") ||
    field.startsWith("HEAD ") ||
    field.startsWith("branch ") ||
    field.startsWith("locked ") ||
    field.startsWith("prunable ")
  );
}

/**
 * Decode git's c-quoting, used by the line-delimited form when a value carries
 * a newline, a quote, or a non-ASCII byte. The `-z` form never quotes.
 *
 * Lock reasons only — they are display text, so a malformed escape degrades to
 * a replacement character rather than dropping the whole worktree.
 */
function decodeCQuoted(raw: string): string {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) {
    return raw;
  }
  const body = raw.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "\\") {
      bytes.push(...Buffer.from(body[i], "utf8"));
      continue;
    }
    const escaped = body[++i];
    if (escaped === undefined) {
      break;
    }
    if (escaped >= "0" && escaped <= "7") {
      // Octal escapes carry raw bytes; collect them before decoding as UTF-8.
      bytes.push(Number.parseInt(body.slice(i, i + 3), 8));
      i += 2;
      continue;
    }
    const simple: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, "\\": 92 };
    bytes.push(simple[escaped] ?? escaped.charCodeAt(0));
  }
  return Buffer.from(bytes).toString("utf8");
}

/**
 * Split on the delimiter *byte*, before any decoding, so a field's bytes reach
 * the decoder exactly as git wrote them. An empty field closes the record.
 */
function splitRecords(payload: Buffer, nulDelimited: boolean): Buffer[][] {
  const separator = nulDelimited ? RECORD_SEPARATOR_NUL : RECORD_SEPARATOR_LF;
  const records: Buffer[][] = [];
  let current: Buffer[] = [];
  let start = 0;

  function pushField(end: number): void {
    let field = payload.subarray(start, end);
    if (!nulDelimited && field.length > 0 && field[field.length - 1] === CARRIAGE_RETURN) {
      field = field.subarray(0, field.length - 1);
    }
    if (field.length === 0) {
      if (current.length > 0) {
        records.push(current);
        current = [];
      }
      return;
    }
    current.push(field);
  }

  for (let i = 0; i < payload.length; i++) {
    if (payload[i] === separator) {
      pushField(i);
      start = i + 1;
    }
  }
  pushField(payload.length);
  if (current.length > 0) {
    records.push(current);
  }
  return records;
}

/**
 * Parse a porcelain worktree listing. A line-delimited record holding a field
 * that matches no known token is skipped rather than recorded: git emits paths
 * unquoted, so a newline in a path is indistinguishable from a field break and
 * the only honest options are "skip" and "invent a shorter path".
 *
 * `kind` follows the record's ordinal in git's output rather than the count of
 * records accepted so far — git always emits the main worktree first, and a
 * skipped leading record must not hand that role to the next one.
 */
export function parseWorktreeList(
  output: Buffer | string,
  options: { nulDelimited?: boolean } = {},
): ParsedWorktreeList {
  const nulDelimited = options.nulDelimited === true;
  const payload = Buffer.isBuffer(output) ? output : Buffer.from(output, "utf8");
  const worktrees: ParsedWorktree[] = [];
  const reasons = new Set<string>();
  let skipped = 0;
  let ordinal = -1;

  for (const rawFields of splitRecords(payload, nulDelimited)) {
    ordinal += 1;

    // Token prefixes are ASCII, so a lenient decode identifies every field
    // safely; only the path's own bytes then have to survive strict decoding.
    const fields = rawFields.map((raw) => raw.toString("utf8"));
    const undecodablePath = fields.some(
      (field, index) =>
        field.startsWith(WORKTREE_PREFIX) && !isDecodable(rawFields[index].subarray(WORKTREE_PREFIX.length)),
    );
    if (undecodablePath) {
      reasons.add(UNDECODABLE_REASON);
      skipped += 1;
      continue;
    }

    if (!nulDelimited && fields.some((field) => !isKnownField(field))) {
      reasons.add(UNPARSEABLE_REASON);
      skipped += 1;
      continue;
    }

    const record: ParsedWorktree = {
      path: "",
      bare: false,
      detached: false,
      locked: false,
      prunable: false,
      kind: ordinal === 0 ? "main" : "linked",
    };

    for (const field of fields) {
      if (field.startsWith(WORKTREE_PREFIX)) {
        record.path = field.slice(WORKTREE_PREFIX.length);
      } else if (field.startsWith("HEAD ")) {
        record.head = field.slice("HEAD ".length);
      } else if (field.startsWith("branch ")) {
        record.branch = field.slice("branch ".length).replace(/^refs\/heads\//, "");
      } else if (field === "bare") {
        record.bare = true;
      } else if (field === "detached") {
        record.detached = true;
      } else if (field === "locked" || field.startsWith("locked ")) {
        record.locked = true;
        const reason = field.slice("locked".length).trim();
        if (reason) {
          record.lockReason = nulDelimited ? reason : decodeCQuoted(reason);
        }
      } else if (field === "prunable" || field.startsWith("prunable ")) {
        record.prunable = true;
      }
    }

    if (record.path.length === 0) {
      reasons.add(PATHLESS_REASON);
      skipped += 1;
      continue;
    }
    worktrees.push(record);
  }

  return { worktrees, reasons: [...reasons], skipped };
}
