// src/webview/vault/VaultPanel.ts — Flat, searchable AI-vault session list.
// See: asimov/changes/add-ai-coding-vault/specs/vault-panel/spec.md,
//      design.md D10 (mirrors FileTreePanel's composition, NOT its Tree).
//
// Renders the aggregated session list as a plain list with a client-side search
// box (no per-keystroke host round-trip). Session titles are UNTRUSTED (derived
// from agent transcripts) — every dynamic string is written via textContent,
// never innerHTML, so a crafted title cannot inject markup.

import type {
  RequestVaultLaunchTargetsMessage,
  RequestVaultMessageRecordMessage,
  RequestVaultSessionDetailMessage,
  RequestVaultSessionsMessage,
  VaultContinueSessionMessage,
  VaultCopyFilePathMessage,
  VaultCopyResumeCommandMessage,
  VaultLaunchTargetsMessage,
  VaultMessageRecordResponseMessage,
  VaultOpenSessionFileMessage,
  VaultOpenWorkingDirMessage,
  VaultRenameSessionMessage,
  VaultResumeMessage,
  VaultRevealInOSMessage,
  VaultSessionDetailResponseMessage,
  VaultWatchSessionMessage,
} from "../../types/messages";
import type { VaultListResult, VaultSessionEntry } from "../../vault/types";
import type { VaultPreviewGeometry } from "../state/WebviewState";
import { attachTooltip } from "../ui/Tooltip";
import { agentLabel, isWithin } from "./format";
import { type GroupMode, groupEntries } from "./grouping";
import { ICON_AGENT, ICON_CLOSE, ICON_FOLDER, ICON_RECENT, ICON_REFRESH, ICON_SEARCH } from "./icons";
import { PreviewController } from "./PreviewController";
import { VaultContextMenu } from "./VaultContextMenu";
import {
  beginInlineRename,
  buildListStatus,
  renderGroupHeader,
  renderRow,
  renderShowMore,
  type VaultRowCallbacks,
} from "./vaultListView";
import { entriesSignature } from "./vaultRenderSignature";

/** Every message the panel can post — all webview→host vault messages carry entryId only. */
export type VaultPanelPostMessage = (
  m:
    | RequestVaultSessionsMessage
    | VaultResumeMessage
    | RequestVaultSessionDetailMessage
    | RequestVaultMessageRecordMessage
    | RequestVaultLaunchTargetsMessage
    | VaultContinueSessionMessage
    | VaultRevealInOSMessage
    | VaultOpenSessionFileMessage
    | VaultOpenWorkingDirMessage
    | VaultCopyResumeCommandMessage
    | VaultCopyFilePathMessage
    | VaultRenameSessionMessage
    | VaultWatchSessionMessage,
) => void;

/** Rows shown per group before a "Show more" affordance keeps the list scannable. */
const MAX_VISIBLE_PER_GROUP = 10;

export interface VaultPanelDeps {
  /** DOM host element (`#vault-panel`). */
  host: HTMLElement;
  postMessage: VaultPanelPostMessage;
  /** Reserved for future active-session highlighting; mirrors FileTreePanel (D10). */
  getActiveSessionId?: () => string | null;
  /** Initial collapsed state (default true). Read once on construction. */
  getInitialCollapsed?: () => boolean;
  /** Persist the collapsed state whenever it changes. */
  persistCollapsed?: (collapsed: boolean) => void;
  /** Initial "This folder only" filter state (default false). Read once. */
  getInitialFolderOnly?: () => boolean;
  /** Persist the "This folder only" filter state whenever it changes. */
  persistFolderOnly?: (folderOnly: boolean) => void;
  /** Initial grouping mode (default "recent"). Read once on construction. */
  getInitialGroupMode?: () => GroupMode;
  /** Persist the grouping mode whenever it changes. */
  persistGroupMode?: (mode: GroupMode) => void;
  /**
   * Initial floating geometry of the session-preview overlay (size + position +
   * maximized). Read once on construction to restore the user's last layout
   * across reloads / restarts. Absent / null → auto-anchor to the row on open.
   */
  getInitialPreviewGeometry?: () => VaultPreviewGeometry | null;
  /**
   * Persist the preview overlay geometry whenever the user drags / resizes /
   * maximizes it (or `null` is never sent — geometry only grows once set). Wired
   * to `WebviewStateStore.updateState({ vaultPreviewGeometry })` in main.ts.
   */
  persistPreviewGeometry?: (geometry: VaultPreviewGeometry) => void;
  /**
   * Resolve the active terminal pane's CURRENT cwd on demand (live, OSC 7
   * tracked). Pulled on every render so "This folder only" reflects where the
   * focused terminal is right now — not a value captured before OSC 7 fired
   * (e.g. the user opening the vault and toggling the filter on a shell that
   * had already `cd`'d). Falls back to the pushed `setContextCwd` value in
   * tests where this getter is absent.
   */
  getContextCwd?: () => string | null;
  /**
   * Run the collapse animation around the visual state change. Receives an
   * `apply` callback that performs the actual class toggle; the implementation
   * (in `main.ts`) FLIP-animates the shared `#aux-region` in pixels so the
   * file tree (the in-region grow-sibling) doesn't bounce. Called only on
   * user-initiated toggles; the constructor seed applies the change directly.
   * When absent (tests), the change is applied synchronously with no animation.
   */
  animateCollapse?: (apply: () => void) => void;
}

export class VaultPanel {
  private readonly host: HTMLElement;
  private readonly postMessage: VaultPanelPostMessage;

  private readonly headerEl: HTMLElement;
  private readonly headerMainEl: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly searchInput: HTMLInputElement;
  private readonly searchBarEl: HTMLElement;
  private readonly searchBtnEl: HTMLButtonElement;
  private readonly refreshBtnEl: HTMLButtonElement;
  /** Safety timer that clears the refresh spinner if no fresh response arrives
   *  (e.g. the host hit an error and only logged it). */
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly folderToggleEl: HTMLLabelElement;
  private readonly folderCheckboxEl: HTMLInputElement;
  private readonly segmentedEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly persistCollapsed?: (collapsed: boolean) => void;
  private readonly persistFolderOnly?: (folderOnly: boolean) => void;
  private readonly persistGroupMode?: (mode: GroupMode) => void;
  private readonly getContextCwd?: () => string | null;
  private readonly animateCollapse?: (apply: () => void) => void;

  private entries: VaultSessionEntry[] = [];
  /** Signature of the entries last painted to the DOM. A response whose signature
   *  matches skips the re-render (cache-vault-load D6) so the cache→fresh refresh
   *  is invisible when nothing changed, preserving an open preview + scroll. */
  private lastRenderSig: string | null = null;
  /** Per-entry `modified` snapshot from the last painted render. A row whose
   *  `modified` grew — or a session id not in this map — gets a one-shot "just
   *  updated" flash. Empty until the first paint, so the initial list (incl. the
   *  cache paint) never flashes wholesale. */
  private readonly modifiedById = new Map<string, number>();
  /** Ids to flash on the NEXT renderList, computed in render() only on a real data
   *  change. renderList consumes and clears it, so a local re-render (search /
   *  folder / group) never re-flashes rows that didn't actually update. */
  private pendingFreshIds: Set<string> | null = null;
  private query = "";
  private collapsed = true;
  /** Whether the inline header search is open. Transient — never persisted. */
  private searchActive = false;
  /** "This folder only" filter — scope the list to `contextCwd` when on. */
  private folderOnly = false;
  /** Grouping mode for the list (client-side, persisted). */
  private groupMode: GroupMode = "recent";
  /** Collapsed group keys (`<mode>:<key>`) — Agent and Folder groups both
   *  collapse; mode-prefixed so an agent id can't clash with a folder cwd. */
  private readonly collapsedGroups = new Set<string>();
  /** Group keys the user has expanded past the per-group row cap ("Show more"). */
  private readonly expandedGroups = new Set<string>();
  /** Active terminal pane's cwd; the folder filter scopes to this. */
  private contextCwd: string | null = null;
  /** Entry id being inline-renamed (enhance-vault-sessions D1). While set, an
   *  incoming list push defers its DOM rebuild so it can't destroy the open
   *  editor mid-edit; the next render after the edit ends repaints. */
  private renamingEntryId: string | null = null;
  /** Right-click context menu (at most one open) — owns its own DOM + listeners. */
  private readonly contextMenu: VaultContextMenu;
  /** Row interaction handlers, passed to the pure `renderRow` builder. */
  private readonly rowCallbacks: VaultRowCallbacks;
  /** Floating session-preview overlay — owns its own DOM, state, and listeners. */
  private readonly preview: PreviewController;
  /** Disposers for resources owned directly by the panel (header tooltips). */
  private readonly disposers: Array<() => void> = [];

  constructor(deps: VaultPanelDeps) {
    this.host = deps.host;
    this.postMessage = deps.postMessage;
    this.contextMenu = new VaultContextMenu({
      host: this.host,
      postMessage: this.postMessage,
      beginRename: (entry, row) => this.beginRename(entry, row),
    });
    this.rowCallbacks = {
      onActivate: (entry) => this.preview.open(entry),
      onContextMenu: (entry, ev, row) => this.contextMenu.open(entry, ev, row),
      onResume: (entryId) => {
        if (this.entries.find((entry) => entry.id === entryId)?.canResume === false) {
          return;
        }
        this.postMessage({ type: "vaultResume", entryId });
      },
    };
    this.preview = new PreviewController({
      postMessage: this.postMessage,
      isContextMenuOpen: () => this.contextMenu.isOpen(),
      closeContextMenu: () => this.contextMenu.close(),
      // VaultPanel owns the list DOM: it resolves the active row live (anchoring)
      // and owns the selection highlight (no cross-module rebind seam).
      getActiveRow: () => this.findRow(this.preview.activeEntryId),
      syncHighlight: () => this.applyActiveHighlight(),
      getInitialPreviewGeometry: deps.getInitialPreviewGeometry,
      persistPreviewGeometry: deps.persistPreviewGeometry,
    });
    this.persistCollapsed = deps.persistCollapsed;
    this.persistFolderOnly = deps.persistFolderOnly;
    this.persistGroupMode = deps.persistGroupMode;
    this.getContextCwd = deps.getContextCwd;
    this.animateCollapse = deps.animateCollapse;
    this.groupMode = deps.getInitialGroupMode?.() ?? "recent";

    this.host.classList.add("vault-panel");
    this.host.replaceChildren();

    // Header doubles as the collapse toggle (chevron + title + session count).
    // In search mode the title row is swapped for an inline input — the search
    // button toggles it (file-tree header parity); the input is hidden until then.
    const header = document.createElement("div");
    header.className = "vault-header";
    header.setAttribute("role", "button");
    header.setAttribute("tabindex", "0");
    header.setAttribute("aria-label", "Toggle AI Vault");
    header.setAttribute("aria-expanded", "false");

    const mainRow = document.createElement("div");
    mainRow.className = "vault-header__main";

    const chevron = document.createElement("span");
    chevron.className = "vault-header__chevron";
    chevron.textContent = "›";
    chevron.setAttribute("aria-hidden", "true");

    const title = document.createElement("span");
    title.className = "vault-title";
    title.textContent = "AI Vault";

    this.countEl = document.createElement("span");
    this.countEl.className = "vault-header__count";

    mainRow.append(chevron, title, this.countEl);
    this.headerMainEl = mainRow;

    const toggle = () => this.toggleCollapsed();
    header.addEventListener("click", toggle);
    header.addEventListener("keydown", (ev) => {
      if (this.searchActive) {
        return; // search input owns the keyboard while open
      }
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        toggle();
      }
    });
    this.headerEl = header;

    // Inline search bar — lives in the header, hidden until the button is
    // clicked. Clicks/keys inside must not bubble to the collapse toggle.
    const searchBar = document.createElement("div");
    searchBar.className = "vault-header__search";
    searchBar.style.display = "none";
    searchBar.addEventListener("click", (ev) => ev.stopPropagation());
    const searchIcon = document.createElement("span");
    searchIcon.className = "vault-search-icon";
    searchIcon.innerHTML = ICON_SEARCH;
    searchIcon.setAttribute("aria-hidden", "true");
    this.searchInput = document.createElement("input");
    this.searchInput.type = "text";
    this.searchInput.className = "vault-search-input";
    this.searchInput.placeholder = "Search sessions…";
    this.searchInput.setAttribute("aria-label", "Search sessions");
    this.searchInput.addEventListener("input", () => {
      this.query = this.searchInput.value.trim().toLowerCase();
      this.renderList();
    });
    this.searchInput.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Escape") {
        ev.preventDefault();
        this.exitSearch({ focusButton: true });
      }
    });
    searchBar.append(searchIcon, this.searchInput);
    this.searchBarEl = searchBar;

    const searchBtn = document.createElement("button");
    searchBtn.type = "button";
    searchBtn.className = "vault-header__search-btn";
    searchBtn.innerHTML = ICON_SEARCH;
    searchBtn.setAttribute("aria-label", "Search sessions");
    searchBtn.addEventListener("click", (ev) => {
      ev.stopPropagation(); // don't toggle the panel collapse
      this.toggleSearch();
    });
    this.searchBtnEl = searchBtn;

    // Manual refresh — re-reads the agents' stores now. Covers the case the
    // auto-refresh-on-reveal (main.ts onViewShow) misses: the vault is open AND
    // visible while an agent writes in a terminal in the same view (no viewShow,
    // no cwd change). stopPropagation so the click doesn't toggle the collapse.
    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "vault-header__refresh-btn";
    refreshBtn.innerHTML = ICON_REFRESH;
    refreshBtn.setAttribute("aria-label", "Refresh sessions");
    refreshBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.setRefreshing(true);
      this.requestRefresh();
    });
    this.refreshBtnEl = refreshBtn;

    header.append(mainRow, searchBar, refreshBtn, searchBtn);

    // Reliable hover/focus tooltips — native `title` doesn't render dependably in
    // VSCode webviews (see fileTree/Tooltip). `getText` for search so the hint
    // tracks the open/close toggle WITHOUT a `title` attribute that would
    // reintroduce the native tooltip. The panel lives for the webview's lifetime
    // (never rebuilt), so these aren't leaked in practice — but `dispose()` still
    // releases them for tests / hot-reload / a future rebuild.
    this.disposers.push(
      attachTooltip(searchBtn, {
        getText: () => (this.searchActive ? "Close search" : "Search sessions by title, folder, or agent"),
      }),
      attachTooltip(refreshBtn, { text: "Refresh — re-read sessions from disk now" }),
    );

    // Toolbar: grouping segmented control (left) + "This folder only" (right).
    const toolbar = document.createElement("div");
    toolbar.className = "vault-toolbar";
    this.segmentedEl = document.createElement("div");
    this.segmentedEl.className = "vault-segmented";
    this.segmentedEl.setAttribute("role", "tablist");
    this.segmentedEl.setAttribute("aria-label", "Group by");
    for (const [mode, label, icon, hint] of [
      ["recent", "Recent", ICON_RECENT, "Group by most recently used"],
      ["agent", "Agent", ICON_AGENT, "Group by agent (Claude / Codex / OpenCode)"],
      ["folder", "Folder", ICON_FOLDER, "Group by working folder"],
    ] as const) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.mode = mode;
      btn.title = hint;
      btn.setAttribute("role", "tab");
      const iconSpan = document.createElement("span");
      iconSpan.className = "vault-segmented-icon";
      iconSpan.innerHTML = icon;
      iconSpan.setAttribute("aria-hidden", "true");
      const labelSpan = document.createElement("span");
      labelSpan.textContent = label;
      btn.append(iconSpan, labelSpan);
      btn.addEventListener("click", () => this.setGroupMode(mode));
      this.segmentedEl.appendChild(btn);
    }
    toolbar.appendChild(this.segmentedEl);

    // "This folder only" — a checkbox; when checked, scope the list to the
    // active terminal pane's cwd.
    this.folderToggleEl = document.createElement("label");
    this.folderToggleEl.className = "vault-folder-toggle";
    this.folderCheckboxEl = document.createElement("input");
    this.folderCheckboxEl.type = "checkbox";
    this.folderCheckboxEl.className = "vault-folder-toggle-cb";
    const folderText = document.createElement("span");
    folderText.textContent = "This folder only";
    this.folderToggleEl.append(this.folderCheckboxEl, folderText);
    this.folderCheckboxEl.addEventListener("change", () => this.setFolderOnly(this.folderCheckboxEl.checked));
    toolbar.appendChild(this.folderToggleEl);

    this.statusEl = document.createElement("div");
    this.statusEl.className = "vault-status";

    this.bodyEl = document.createElement("div");
    this.bodyEl.className = "vault-body";
    this.listEl = document.createElement("div");
    this.listEl.className = "vault-list";
    this.listEl.setAttribute("role", "listbox");
    this.listEl.setAttribute("aria-label", "Sessions");
    this.bodyEl.appendChild(this.listEl);

    this.host.append(header, toolbar, this.statusEl, this.bodyEl, this.preview.element);

    // Seed collapsed state (default collapsed) — reconciles the HTML's
    // `vault-collapsed` default with any persisted preference.
    this.setCollapsed(deps.getInitialCollapsed?.() ?? true, { persist: false });
    this.setFolderOnly(deps.getInitialFolderOnly?.() ?? false, { persist: false });
    this.syncSegmented();
  }

  /** Set the grouping mode (segmented control). Persists unless seeding. */
  setGroupMode(mode: GroupMode, opts: { persist?: boolean } = {}): void {
    if (mode === this.groupMode) {
      return;
    }
    this.groupMode = mode;
    this.syncSegmented();
    if (opts.persist !== false) {
      this.persistGroupMode?.(mode);
    }
    this.renderList();
  }

  private syncSegmented(): void {
    // role="tab" → active state is communicated via aria-selected, not aria-pressed (W7).
    for (const btn of Array.from(this.segmentedEl.querySelectorAll<HTMLButtonElement>("button"))) {
      btn.setAttribute("aria-selected", btn.dataset.mode === this.groupMode ? "true" : "false");
    }
  }

  /** Whether the vault section is collapsed to its header strip. */
  isCollapsed(): boolean {
    return this.collapsed;
  }

  /** Whether the "This folder only" filter is active (gates the cwd re-query). */
  isFolderOnly(): boolean {
    return this.folderOnly;
  }

  /** Collapse/expand the section. Persists unless `persist: false`. */
  setCollapsed(collapsed: boolean, opts: { persist?: boolean } = {}): void {
    const wasCollapsed = this.collapsed;
    this.collapsed = collapsed;
    // The class toggle is what changes the flex layout; the animator FLIPs the
    // region around it (pixel basis, no grow tween → the file tree doesn't
    // bounce). User-initiated toggles animate; the constructor seed (persist:
    // false) and the no-animator case (tests) apply the change instantly.
    const applyVisual = (): void => {
      this.host.classList.toggle("vault-collapsed", collapsed);
    };
    if (collapsed !== wasCollapsed && opts.persist !== false && this.animateCollapse) {
      this.animateCollapse(applyVisual);
    } else {
      applyVisual();
    }
    this.headerEl.setAttribute("aria-expanded", collapsed ? "false" : "true");
    if (opts.persist !== false) {
      this.persistCollapsed?.(collapsed);
    }
    // Becoming visible → re-read the session list (the agents' on-disk files
    // are the source of truth, D2; matches the "refresh on open" spec). Only
    // on the collapsed→expanded transition so re-collapsing doesn't fetch and
    // an already-open panel isn't re-fetched on a no-op.
    if (!collapsed && wasCollapsed) {
      // Drop the render-guard key so the first response after re-expand always
      // paints, rather than being skipped as "unchanged" against a pre-collapse
      // signature (the list DOM may have been cleared/altered while hidden).
      this.lastRenderSig = null;
      this.requestRefresh();
    }
  }

  /** Toggle collapsed state (header click / file-tree toolbar button). */
  toggleCollapsed(): void {
    this.setCollapsed(!this.collapsed);
  }

  /** Expand the section if collapsed (the `openVault` command path). */
  expand(): void {
    if (this.collapsed) {
      this.setCollapsed(false);
    }
  }

  /** Header search button: open the inline search, or close it if already open. */
  private toggleSearch(): void {
    if (this.searchActive) {
      this.exitSearch({ focusButton: true });
    } else {
      this.enterSearch();
    }
  }

  /**
   * Open the inline header search: expand the panel if collapsed, swap the
   * title row for the input, and focus it. Mirrors the file-tree header search.
   */
  private enterSearch(): void {
    if (this.searchActive) {
      return;
    }
    if (this.collapsed) {
      this.setCollapsed(false);
    }
    this.searchActive = true;
    this.headerEl.classList.add("is-searching");
    this.headerMainEl.style.display = "none";
    this.searchBarEl.style.display = "flex";
    this.searchBtnEl.innerHTML = ICON_CLOSE;
    this.searchBtnEl.setAttribute("aria-label", "Close search");
    this.searchInput.value = "";
    this.searchInput.focus();
  }

  /** Close the inline search: restore the title row and clear any active query. */
  private exitSearch(opts: { focusButton?: boolean } = {}): void {
    if (!this.searchActive) {
      return;
    }
    this.searchActive = false;
    this.headerEl.classList.remove("is-searching");
    this.searchBarEl.style.display = "none";
    this.headerMainEl.style.display = "";
    this.searchBtnEl.innerHTML = ICON_SEARCH;
    this.searchBtnEl.setAttribute("aria-label", "Search sessions");
    this.searchInput.value = "";
    if (this.query) {
      this.query = "";
      this.renderList();
    }
    if (opts.focusButton) {
      this.searchBtnEl.focus();
    }
  }

  /**
   * Update the active terminal pane's cwd that the "This folder only" filter
   * scopes to. Re-renders only when the filter is on (otherwise nothing visible
   * changes). Called when the user selects a different pane / switches tabs.
   */
  setContextCwd(cwd: string | null): void {
    if (cwd === this.contextCwd) {
      return;
    }
    this.contextCwd = cwd;
    this.syncFolderToggleTitle();
    if (this.folderOnly) {
      this.renderList();
    }
  }

  /** Toggle the "This folder only" filter (the search-row toggle button). */
  toggleFolderOnly(): void {
    this.setFolderOnly(!this.folderOnly);
  }

  /** Set the "This folder only" filter. Persists unless `persist: false`. */
  setFolderOnly(folderOnly: boolean, opts: { persist?: boolean } = {}): void {
    this.folderOnly = folderOnly;
    this.folderCheckboxEl.checked = folderOnly;
    this.folderToggleEl.classList.toggle("is-active", folderOnly);
    this.syncFolderToggleTitle();
    if (opts.persist !== false) {
      this.persistFolderOnly?.(folderOnly);
    }
    this.renderList();
  }

  private syncFolderToggleTitle(): void {
    this.folderToggleEl.title =
      this.folderOnly && this.contextCwd
        ? `Showing sessions in ${this.contextCwd}`
        : "Show only sessions in the active terminal's folder";
  }

  /** Ask the host to (re-)read the agents' session stores. */
  requestRefresh(): void {
    this.postMessage({ type: "requestVaultSessions" });
  }

  /**
   * Toggle the manual-refresh spinner. Spinning is purely a click affordance for
   * the header refresh button (other refresh triggers — expand, viewShow, cwd
   * change — don't spin). A safety timer clears it if no fresh response ever
   * arrives (the host hit an error and only logged it, leaving the cache shown).
   */
  private setRefreshing(on: boolean): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.refreshBtnEl.classList.toggle("is-refreshing", on);
    this.refreshBtnEl.setAttribute("aria-busy", on ? "true" : "false");
    if (on) {
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = null;
        this.refreshBtnEl.classList.remove("is-refreshing");
        this.refreshBtnEl.setAttribute("aria-busy", "false");
      }, 4000);
    }
  }

  /**
   * Render the aggregated result; preserves the current search query. `this.entries`
   * is ALWAYS updated (so client-side search/filter never operate on stale data),
   * but the DOM re-render is skipped when the entries are equivalent to what is
   * already painted (cache-vault-load D6) — the common case for the cache→fresh
   * refresh — so an open preview, scroll position, and selection are undisturbed.
   */
  render(result: VaultListResult, fromCache = false): void {
    // The authoritative (non-cache) response completes a manual refresh — stop the
    // spinner here, BEFORE the no-op guard, so it clears even when nothing changed.
    if (!fromCache) {
      this.setRefreshing(false);
    }
    this.entries = result.entries;
    // Keep the open preview's entry reference live even when the DOM re-render is
    // skipped below — preview re-render paths (e.g. "show more steps") read
    // `activePreviewEntry` directly, so a skipped render must not leave it stale.
    const activeId = this.preview.activeEntryId;
    if (activeId) {
      const fresh = result.entries.find((e) => e.id === activeId);
      if (fresh) {
        this.preview.refreshActiveEntry(fresh);
      }
    }
    // An inline rename is open: defer the DOM rebuild so an auto-refresh push
    // can't destroy the editor mid-edit. Drop the guard key so the next render
    // (after the edit commits/cancels) repaints against the fresh entries.
    if (this.renamingEntryId) {
      this.lastRenderSig = null;
      return;
    }
    // Guard on the full rendered projection (entries + the live filter state
    // renderList consumes). renderList() updates lastRenderSig to match what it
    // actually painted, so a render triggered by a LOCAL UI change (search /
    // folder toggle / group mode, which call renderList directly) also refreshes
    // the key — a later unchanged host response then correctly no-ops instead of
    // rebuilding the DOM and disturbing scroll + the open preview (D6).
    if (this.currentSignature() === this.lastRenderSig) {
      return;
    }
    // A real data change reached the DOM — flag rows whose `modified` grew (or
    // brand-new sessions) so renderList paints them with a one-shot flash. Empty on
    // the first paint (empty snapshot) so the initial list never flashes wholesale.
    this.pendingFreshIds = this.computeFreshIds();
    this.renderList();
  }

  /** Ids whose `modified` increased since the last painted snapshot, plus sessions
   *  not previously seen — the set renderList flashes. Empty on the first paint so
   *  the initial list (including the cache paint) doesn't flash every row. */
  private computeFreshIds(): Set<string> {
    const fresh = new Set<string>();
    if (this.modifiedById.size === 0) {
      return fresh;
    }
    for (const e of this.entries) {
      const prev = this.modifiedById.get(e.id);
      if (prev === undefined || e.modified > prev) {
        fresh.add(e.id);
      }
    }
    return fresh;
  }

  /** Signature of the full rendered projection: entries + every input renderList
   *  consumes (search query, folder-only + the live context cwd it re-pulls,
   *  group mode). Read by the render() no-op guard; stored by renderList() so the
   *  key always reflects what is actually on screen (cache-vault-load D6). */
  private currentSignature(): string {
    const liveCwd = this.getContextCwd ? this.getContextCwd() : this.contextCwd;
    return JSON.stringify([
      entriesSignature(this.entries),
      this.query,
      this.folderOnly,
      liveCwd ?? null,
      this.groupMode,
    ]);
  }

  private matchesQuery(entry: VaultSessionEntry): boolean {
    if (!this.query) {
      return true;
    }
    return (
      entry.title.toLowerCase().includes(this.query) ||
      entry.cwd.toLowerCase().includes(this.query) ||
      agentLabel(entry.agent).toLowerCase().includes(this.query) ||
      entry.agent.toLowerCase().includes(this.query)
    );
  }

  /** When "This folder only" is on, scope to the active pane's cwd subtree. */
  private matchesFolder(entry: VaultSessionEntry): boolean {
    if (!this.folderOnly || !this.contextCwd) {
      return true;
    }
    return isWithin(entry.cwd, this.contextCwd);
  }

  private renderStatus(visibleCount: number): void {
    const status = buildListStatus({
      totalCount: this.entries.length,
      visibleCount,
      folderOnly: this.folderOnly,
      contextCwd: this.contextCwd,
      query: this.query,
    });
    this.statusEl.replaceChildren(...(status ? [status] : []));
  }

  private renderList(): void {
    // Pull the freshest active-pane cwd before filtering so "This folder only"
    // reflects where the focused terminal is NOW. The pushed `setContextCwd`
    // value is captured at mount / pane-change, which can be null if OSC 7
    // hadn't fired yet — without this live pull the toggle is a no-op (the
    // filter falls through to "show all" on a null contextCwd).
    if (this.getContextCwd) {
      this.contextCwd = this.getContextCwd();
      this.syncFolderToggleTitle();
    }
    const visible = this.entries.filter((e) => this.matchesFolder(e) && this.matchesQuery(e));
    // The badge reflects what the list actually shows (folder + search scoped),
    // not the unfiltered total — otherwise it over-reports under an active
    // filter. See .reviews/round-2.md [W2].
    this.countEl.textContent = visible.length > 0 ? String(visible.length) : "";
    this.renderStatus(visible.length);

    // Preserve the scroll position across the rebuild so an auto-refresh push (or
    // any re-render) doesn't jump the list back to the top (enhance-vault-sessions
    // D4 — non-disruptive auto-update). The selection highlight is re-derived from
    // the preview's active entryId below, and the preview overlay is separate DOM
    // (untouched here), so an open preview also survives.
    const prevScrollTop = this.bodyEl.scrollTop;
    this.listEl.replaceChildren();
    // Recent → flat list (no group headers). Agent/Folder → grouped headers.
    for (const group of groupEntries(visible, this.groupMode)) {
      if (group.mode !== "recent") {
        const collapsed = this.collapsedGroups.has(`${group.mode}:${group.key}`);
        this.listEl.appendChild(
          renderGroupHeader(group.mode, group.key, group.label, group.entries.length, collapsed, () =>
            this.toggleGroup(group.mode, group.key),
          ),
        );
        if (collapsed) {
          continue; // group collapsed → skip its rows
        }
      }
      // Cap each group at MAX_VISIBLE_PER_GROUP rows; the rest hide behind a
      // "Show N more" button (per group, so one busy agent/folder can't bury
      // the others). Newest-first ordering means the cap keeps the most recent.
      const expanded = this.expandedGroups.has(group.key);
      const overflow = group.entries.length - MAX_VISIBLE_PER_GROUP;
      const shown = expanded || overflow <= 0 ? group.entries : group.entries.slice(0, MAX_VISIBLE_PER_GROUP);
      for (const entry of shown) {
        const fresh = this.pendingFreshIds?.has(entry.id) ?? false;
        this.listEl.appendChild(renderRow(entry, { hideCwd: group.hideCwd, fresh }, this.rowCallbacks));
      }
      if (!expanded && overflow > 0) {
        const key = group.key;
        this.listEl.appendChild(
          renderShowMore(overflow, () => {
            this.expandedGroups.add(key);
            this.renderList();
          }),
        );
      }
    }

    // A re-render rebuilds every row, so the open preview's selection highlight
    // lands on a now-detached node. Re-derive it from the active entryId against
    // the fresh rows (W4). If that row is gone (filtered / collapsed / behind "show
    // more"), nothing is highlighted — the preview stays open, just unanchored.
    this.applyActiveHighlight();

    // Restore the pre-rebuild scroll position (clamped by the browser to the new
    // content height). Keeps an auto-refresh update from scrolling the list.
    this.bodyEl.scrollTop = prevScrollTop;

    // Record what we just painted so the render() guard compares host responses
    // against the ACTUAL DOM projection — including renders triggered by local UI
    // changes (search/filter/group), which call renderList directly.
    this.lastRenderSig = this.currentSignature();

    // Snapshot the painted `modified` values so the NEXT data change can detect
    // grown / new rows; clear the one-shot flash set so a following local re-render
    // (search / folder / group) doesn't re-flash rows that didn't actually update.
    this.modifiedById.clear();
    for (const e of this.entries) {
      this.modifiedById.set(e.id, e.modified);
    }
    this.pendingFreshIds = null;
  }

  /** The list row for an entryId (or null). Matches on `dataset.entryId` rather
   *  than a `[data-entry-id="…"]` selector so the `:` separator needs no CSS escaping. */
  private findRow(entryId: string | null): HTMLElement | null {
    if (!entryId) {
      return null;
    }
    return (
      Array.from(this.listEl.querySelectorAll<HTMLElement>(".vault-row")).find((r) => r.dataset.entryId === entryId) ??
      null
    );
  }

  /** Re-derive the selection highlight from the preview's active entryId: clear any
   *  stale `aria-selected`, then mark the active row if it is currently visible.
   *  Single owner of the highlight (the panel owns the list DOM). */
  private applyActiveHighlight(): void {
    for (const r of Array.from(this.listEl.querySelectorAll<HTMLElement>('.vault-row[aria-selected="true"]'))) {
      r.removeAttribute("aria-selected");
    }
    this.findRow(this.preview.activeEntryId)?.setAttribute("aria-selected", "true");
  }

  private toggleGroup(mode: GroupMode, key: string): void {
    const groupKey = `${mode}:${key}`;
    if (this.collapsedGroups.has(groupKey)) {
      this.collapsedGroups.delete(groupKey);
    } else {
      this.collapsedGroups.add(groupKey);
    }
    this.renderList();
  }

  /** Begin an inline rename of a row (context-menu "Rename"). Guards the row from
   *  a concurrent list rebuild while editing, then commits by posting the rename —
   *  the host round-trips an overlaid list that repaints the row (D1). */
  private beginRename(entry: VaultSessionEntry, row: HTMLElement): void {
    const titleEl = row.querySelector<HTMLElement>(".vault-row-title");
    if (!titleEl) {
      return;
    }
    this.renamingEntryId = entry.id;
    beginInlineRename(titleEl, entry, {
      commit: (name) => this.postMessage({ type: "vaultRenameSession", entryId: entry.id, name }),
      onDone: () => {
        this.renamingEntryId = null;
        // render() deferred rebuilds while editing (lastRenderSig = null). A commit
        // round-trips a fresh push that repaints; an Esc-cancel does not, so if an
        // auto-refresh landed mid-edit the DOM is stale — repaint now against the
        // stored entries (W4).
        if (this.lastRenderSig === null) {
          this.renderList();
        }
      },
    });
  }

  /** Host → webview session-detail reply — forwarded to the preview controller. */
  handleSessionDetailResponse(msg: VaultSessionDetailResponseMessage): void {
    this.preview.handleSessionDetailResponse(msg);
  }

  handleLaunchTargets(msg: VaultLaunchTargetsMessage): void {
    this.preview.handleLaunchTargets(msg);
  }

  handleMessageRecordResponse(msg: VaultMessageRecordResponseMessage): void {
    this.preview.handleMessageRecordResponse(msg);
  }

  /** Release every owned resource: the refresh safety-timer, the context menu and
   *  preview controller (each detaches its own document listeners), and the header
   *  tooltips. Not wired to a teardown today (the panel lives for the webview's
   *  lifetime) — present so tests / hot-reload / a future rebuild don't leak. */
  dispose(): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.contextMenu.close();
    this.preview.dispose();
    for (const dispose of this.disposers) {
      dispose();
    }
    this.disposers.length = 0;
  }
}
