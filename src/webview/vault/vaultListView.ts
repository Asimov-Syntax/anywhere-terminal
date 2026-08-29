// src/webview/vault/vaultListView.ts — Pure DOM builders for the vault session
// list: rows, group headers, the per-group "Show N more" affordance, and the
// empty / no-match status. None read panel state — interactivity is supplied via
// callbacks, so each builder is independently testable.
//
// Session-derived strings (title, cwd) are written via `textContent`; the only
// SVG inserted is the agent's real brand icon from the closed icon map (D1).

import type { VaultSessionEntry } from "../../vault/types";
import { getAgentAccent, getAgentIcon } from "./agentIcons";
import { agentLabel, formatRelativeTime, leafSegment } from "./format";
import type { GroupMode } from "./grouping";
import { ICON_ARCHIVE, ICON_CHEVRON_DOWN, ICON_FOLDER, ICON_RESUME, ICON_SEARCH } from "./icons";
import { emptyState } from "./renderAtoms";

/** Row interaction handlers — supplied by the panel so the row builder stays pure. */
export interface VaultRowCallbacks {
  onActivate: (entry: VaultSessionEntry, row: HTMLElement) => void;
  onContextMenu: (entry: VaultSessionEntry, ev: MouseEvent, row: HTMLElement) => void;
  /** Absent on a surface that cannot perform the resume it would offer (B4). */
  onResume?: (entryId: string) => void;
}

export function canResumeVaultEntry(entry: VaultSessionEntry): boolean {
  return entry.agent === "cursor" ? entry.source === "cli" && entry.canResume === true : entry.canResume !== false;
}

export function cursorSourceLabel(entry: VaultSessionEntry): string | undefined {
  if (entry.agent !== "cursor") {
    return undefined;
  }
  if (entry.source === "cli") {
    return "CLI";
  }
  if (entry.source === "ide") {
    return "IDE";
  }
  return entry.sessionId.startsWith("project:") ? "Project" : undefined;
}

/**
 * Single-line CSS-grid row: badge | title | cwd-chip | time, with an icon-only
 * Resume revealed on hover/focus (no fork — D8).
 */
export function renderRow(
  entry: VaultSessionEntry,
  opts: { hideCwd?: boolean; fresh?: boolean },
  cb: VaultRowCallbacks,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "vault-row";
  row.setAttribute("role", "option");
  row.tabIndex = 0;
  row.dataset.entryId = entry.id;

  // Right-click opens the context menu (no separate "⋯" trigger).
  row.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    cb.onContextMenu(entry, ev, row);
  });

  // Click / Enter / Space activates the row → open the session preview.
  row.addEventListener("click", () => cb.onActivate(entry, row));
  row.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      cb.onActivate(entry, row);
    }
  });

  // Agent marker — a small accent-colored dot. The real brand icon lives on
  // the Agent group header + preview header, not on every row (keeps rows
  // compact and scannable).
  const dot = document.createElement("span");
  dot.className = "vault-row-dot";
  dot.dataset.tip = agentLabel(entry.agent);
  dot.setAttribute("aria-label", agentLabel(entry.agent));
  // Known accents only — a session-derived agent string never becomes a class (W6).
  const accent = getAgentAccent(entry.agent);
  if (accent) {
    dot.classList.add(`vault-row-dot--${accent}`);
  }
  row.appendChild(dot);

  // Just-updated flash: the panel flags a row whose `modified` grew (or a newly
  // appeared session). The accent var feeds the `::after` overlay in CSS; only a
  // known, closed accent may become one (never a raw session-derived string, W6).
  if (opts.fresh) {
    row.classList.add("is-fresh");
    if (accent) {
      row.style.setProperty("--_accent", `var(--vault-accent-${accent})`);
    }
  }

  const titleEl = document.createElement("span");
  titleEl.className = "vault-row-title";
  // A user rename overrides the derived title (enhance-vault-sessions D1).
  const shownTitle = entry.customName || entry.title;
  titleEl.textContent = shownTitle || "(untitled session)";
  if (shownTitle) {
    titleEl.dataset.tip = shownTitle;
  }
  const sourceLabel = cursorSourceLabel(entry);
  if (sourceLabel) {
    const sourceBadge = document.createElement("span");
    sourceBadge.className = "vault-row-source";
    sourceBadge.textContent = sourceLabel;
    sourceBadge.setAttribute("aria-label", `Cursor ${sourceLabel}`);
    titleEl.appendChild(sourceBadge);
  }
  row.appendChild(titleEl);

  if (!opts.hideCwd) {
    const cwdEl = document.createElement("span");
    cwdEl.className = "vault-row-cwd";
    if (entry.cwd) {
      cwdEl.dataset.tip = entry.cwd;
    }
    const folderIcon = document.createElement("span");
    folderIcon.className = "vault-row-cwd-icon";
    folderIcon.innerHTML = ICON_FOLDER;
    const leaf = document.createElement("span");
    leaf.className = "vault-cwd-leaf";
    leaf.textContent = leafSegment(entry.cwd);
    cwdEl.append(folderIcon, leaf);
    row.appendChild(cwdEl);
  } else {
    // Keep the grid column count stable when the cwd chip is suppressed.
    const spacer = document.createElement("span");
    spacer.className = "vault-row-cwd vault-row-cwd--empty";
    row.appendChild(spacer);
  }

  const timeEl = document.createElement("span");
  timeEl.className = "vault-row-time";
  timeEl.textContent = formatRelativeTime(entry.modified);
  row.appendChild(timeEl);

  // An explicitly unsupported resume identifier must never be offered. Legacy
  // rows without the capability field retain their established Resume action.
  // A surface that cannot perform resume at all supplies no handler (B4).
  const onResume = cb.onResume;
  if (onResume && canResumeVaultEntry(entry)) {
    const actions = document.createElement("span");
    actions.className = "vault-row-actions";
    const resumeBtn = document.createElement("button");
    resumeBtn.type = "button";
    resumeBtn.className = "vault-action vault-action--resume";
    resumeBtn.dataset.tip = "Resume";
    resumeBtn.setAttribute("aria-label", "Resume");
    resumeBtn.innerHTML = ICON_RESUME;
    resumeBtn.addEventListener("click", (ev) => {
      ev.stopPropagation(); // don't also open the preview
      onResume(entry.id);
    });
    actions.appendChild(resumeBtn);
    row.appendChild(actions);
  }

  return row;
}

/**
 * Turn a title element into an inline rename editor (enhance-vault-sessions D1).
 * Enter (or blur) commits, Esc cancels, an empty value clears back to the derived
 * title (the host normalizes). Seeded with the current display name. Idempotent —
 * a no-op if that title is already being edited. The commit is fire-and-forget:
 * the host round-trips an overlaid list that re-renders with the new name.
 *
 * Takes the title ELEMENT rather than a row, so the preview header's own title
 * reuses this one editor and one commit path instead of growing a second (D7).
 *
 * Returns a handle that ends the edit the same way `blur` does. A caller that
 * tears down the surrounding DOM MUST call it: removing a focused node does not
 * reliably fire `blur`, so an owner relying on `onDone` alone can be left
 * believing an editor is still open (review B1).
 */
export function beginInlineRename(
  titleEl: HTMLElement,
  entry: VaultSessionEntry,
  cb: { commit: (name: string) => void; onDone?: () => void },
): { end: () => void } {
  // Already swapped for an editor — the title is detached until `finish` puts it
  // back, which is what makes a second call a no-op.
  if (!titleEl.isConnected) {
    return { end: () => {} };
  }
  const input = document.createElement("input");
  input.type = "text";
  input.className = "vault-row-rename-input";
  input.value = entry.customName || entry.title || "";
  input.setAttribute("aria-label", "Rename session");
  input.maxLength = 80;
  // Keep pointer/keyboard events inside the editor — a click must not activate the
  // row (open the preview) and keys must not reach the panel's collapse handler.
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("mousedown", (e) => e.stopPropagation());

  let done = false;
  const finish = (commitValue: boolean): void => {
    if (done) {
      return;
    }
    done = true;
    const value = input.value;
    input.replaceWith(titleEl);
    cb.onDone?.();
    if (commitValue) {
      cb.commit(value);
    }
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));

  titleEl.replaceWith(input);
  input.focus();
  input.select();
  // Commits, like blur — leaving the editor by any route saves; only Escape
  // cancels. `finish` is idempotent, so calling this after a real blur is a no-op.
  return { end: () => finish(true) };
}

/** "Show N more" affordance that expands a group past the per-group cap. */
export function renderShowMore(hidden: number, onExpand: () => void): HTMLElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "vault-show-more";
  btn.textContent = `Show ${hidden} more`;
  btn.addEventListener("click", onExpand);
  return btn;
}

/** A collapsible Agent/Folder group header (chevron + brand/folder icon + count). */
export function renderGroupHeader(
  mode: GroupMode,
  key: string,
  label: string,
  count: number,
  collapsed: boolean,
  onToggle: () => void,
): HTMLElement {
  const header = document.createElement("div");
  header.className = "vault-group-header";
  if (collapsed) {
    header.classList.add("is-collapsed");
  }
  // Both Agent and Folder groups collapse: a leading chevron rotates with the
  // state and the whole header toggles it (the row cap "Show more" is separate).
  const chevron = document.createElement("span");
  chevron.className = "vault-group-chevron";
  chevron.innerHTML = ICON_CHEVRON_DOWN;
  chevron.setAttribute("aria-hidden", "true");
  header.appendChild(chevron);
  if (mode === "agent") {
    // The agent's real brand icon (key is the agent id). SVG comes ONLY from
    // the closed agent-icon map (never session data) → safe innerHTML (D1).
    const badge = document.createElement("span");
    badge.className = "vault-badge vault-group-badge";
    const icon = getAgentIcon(key);
    if (icon) {
      badge.classList.add(`vault-badge--${icon.accent}`);
      badge.innerHTML = icon.svg;
    } else {
      badge.textContent = label.slice(0, 2);
    }
    header.appendChild(badge);
  } else {
    header.classList.add("vault-group-header--folder");
    const folderIcon = document.createElement("span");
    folderIcon.className = "vault-group-icon";
    folderIcon.innerHTML = ICON_FOLDER;
    header.appendChild(folderIcon);
  }
  const labelEl = document.createElement("span");
  labelEl.className = "vault-group-label";
  labelEl.textContent = label;
  const countEl = document.createElement("span");
  countEl.className = "vault-group-count";
  countEl.textContent = `· ${count}`;
  header.append(labelEl, countEl);
  // Interactive toggle: clickable + keyboard-operable, state announced.
  header.setAttribute("role", "button");
  header.tabIndex = 0;
  header.setAttribute("aria-expanded", collapsed ? "false" : "true");
  header.dataset.tip = collapsed ? `Expand ${label}` : `Collapse ${label}`;
  header.addEventListener("click", onToggle);
  header.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  });
  return header;
}

/** Build the empty / no-match status element, or null when the list has rows. */
export function buildListStatus(args: {
  totalCount: number;
  visibleCount: number;
  folderOnly: boolean;
  contextCwd: string | null;
  query: string;
}): HTMLElement | null {
  if (args.totalCount === 0) {
    return emptyState(
      ICON_ARCHIVE,
      "No AI sessions yet",
      "Sessions appear here after you run an AI agent in a terminal.",
    );
  }
  if (args.visibleCount === 0) {
    // Distinct no-match state (NOT the empty state) — actionable hint.
    const body =
      args.folderOnly && args.contextCwd && !args.query
        ? "No sessions in this folder. Turn off the This folder filter to see all."
        : "Try a shorter query or clear the This folder filter.";
    return emptyState(ICON_SEARCH, "No matching sessions", body);
  }
  return null;
}
