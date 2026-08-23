// src/webview/vault/markdownLite.ts — safe, minimal Markdown renderer for the
// vault transcript preview (nest-workflow-team-sessions D17).
//
// SECURITY: every character of the (untrusted) transcript reaches the DOM ONLY
// via `textContent` / `createTextNode` — NEVER innerHTML/insertAdjacentHTML. The
// parser interprets Markdown *structure* (code fences, tables, lists, headings)
// and emits the corresponding elements, but it never interprets HTML, so there
// is no script/markup injection surface. This is the textContent-only rule the
// rest of the panel follows, kept intact while still rendering structure.
//
// Scope is deliberately small (NOT CommonMark-complete) — the high-value blocks
// for AI transcripts: fenced code, pipe tables, ATX headings, ordered/unordered
// lists, and paragraphs with preserved line breaks. Inline: `code` and **bold**.
// All regexes are linear (no nested quantifiers) → ReDoS-safe on hostile input.

/** Split a table row into trimmed cells: strip the outer pipes, split on `|`. */
function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) {
    s = s.slice(1);
  }
  if (s.endsWith("|")) {
    s = s.slice(0, -1);
  }
  return s.split("|").map((c) => c.trim());
}

/** A `| --- | :--: |` delimiter row: every cell is dashes with optional colons. */
function isTableDelimiter(line: string): boolean {
  if (!line.includes("|") && !line.trim().startsWith("-")) {
    return false;
  }
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c));
}

/** Append `text` to `parent`, rendering inline `code` and **bold** as elements
 *  (everything else literal). Linear scan; unmatched markers stay literal. */
function appendInline(parent: Node, text: string): void {
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null = re.exec(text);
  while (m !== null) {
    if (m.index > last) {
      parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    }
    if (m[1]) {
      const code = document.createElement("code");
      code.className = "md-code-inline";
      code.textContent = m[1].slice(1, -1);
      parent.appendChild(code);
    } else if (m[2]) {
      const strong = document.createElement("strong");
      strong.textContent = m[2].slice(2, -2);
      parent.appendChild(strong);
    }
    last = re.lastIndex;
    m = re.exec(text);
  }
  if (last < text.length) {
    parent.appendChild(document.createTextNode(text.slice(last)));
  }
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const LIST_RE = /^(\s*)([-*+]|\d{1,9}\.)\s+(.*)$/;
const FENCE_RE = /^(```|~~~)/;

function renderList(lines: string[], start: number): { list: HTMLOListElement | HTMLUListElement; next: number } {
  const first = LIST_RE.exec(lines[start]);
  if (!first) {
    throw new Error("renderList requires a list item");
  }

  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const list = document.createElement(ordered ? "ol" : "ul");
  list.className = "md-list";
  if (ordered) {
    list.start = Number.parseInt(first[2], 10);
  }

  let i = start;
  while (i < lines.length) {
    const item = LIST_RE.exec(lines[i]);
    if (!item || item[1].length !== baseIndent || /\d/.test(item[2]) !== ordered) {
      break;
    }

    const li = document.createElement("li");
    appendInline(li, item[3]);
    i++;

    while (i < lines.length) {
      let next = i;
      while (next < lines.length && lines[next].trim() === "") {
        next++;
      }
      const following = next < lines.length ? LIST_RE.exec(lines[next]) : null;
      if (!following) {
        break;
      }

      const followingIndent = following[1].length;
      if (followingIndent > baseIndent) {
        const nested = renderList(lines, next);
        li.appendChild(nested.list);
        i = nested.next;
        continue;
      }
      if (followingIndent === baseIndent && /\d/.test(following[2]) === ordered) {
        i = next;
      }
      break;
    }

    list.appendChild(li);
  }

  return { list, next: i };
}

/**
 * Render markdown-lite `text` into a DocumentFragment of block elements. Safe by
 * construction (textContent only). The caller appends the fragment into a block
 * container styled by `.vault-md` (paragraphs keep line breaks via `white-space:
 * pre-wrap`).
 */
export function renderMarkdownLite(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block — collect verbatim until the closing fence (or EOF).
    if (FENCE_RE.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // consume the closing fence (no-op past EOF)
      const pre = document.createElement("pre");
      pre.className = "md-pre";
      const code = document.createElement("code");
      code.textContent = body.join("\n");
      pre.appendChild(code);
      frag.appendChild(pre);
      continue;
    }

    // Pipe table — header row + delimiter row, then body rows until a non-row.
    if (line.includes("|") && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) {
      const header = splitTableRow(line);
      i += 2; // skip header + delimiter
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      const table = document.createElement("table");
      table.className = "md-table";
      const thead = document.createElement("thead");
      const htr = document.createElement("tr");
      for (const h of header) {
        const th = document.createElement("th");
        appendInline(th, h);
        htr.appendChild(th);
      }
      thead.appendChild(htr);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      for (const r of rows) {
        const tr = document.createElement("tr");
        // Pad/truncate to the header width so the grid stays rectangular.
        for (let c = 0; c < header.length; c++) {
          const td = document.createElement("td");
          appendInline(td, r[c] ?? "");
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      frag.appendChild(table);
      continue;
    }

    // ATX heading.
    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = heading[1].length;
      const el = document.createElement("div");
      el.className = `md-h md-h${level}`;
      appendInline(el, heading[2]);
      frag.appendChild(el);
      i++;
      continue;
    }

    // List — indentation determines nesting; blank lines may separate items.
    if (LIST_RE.test(line)) {
      const rendered = renderList(lines, i);
      frag.appendChild(rendered.list);
      i = rendered.next;
      continue;
    }

    // Blank line — paragraph separator.
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph — consecutive plain lines; line breaks preserved (pre-wrap).
    const para = document.createElement("p");
    para.className = "md-p";
    let firstLine = true;
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === "" || FENCE_RE.test(l) || HEADING_RE.test(l) || LIST_RE.test(l)) {
        break;
      }
      if (l.includes("|") && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) {
        break;
      }
      if (!firstLine) {
        para.appendChild(document.createTextNode("\n"));
      }
      appendInline(para, l);
      firstLine = false;
      i++;
    }
    frag.appendChild(para);
  }

  return frag;
}
