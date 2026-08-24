// Orchestrates the floating session-preview overlay: open/close lifecycle,
// detail pagination (load-more + scroll-to-first), nested subagent/teammate
// lazy-loading, and header tooltip mapping. Owns the preview STATE and delegates
// all window chrome (card, resize/move/maximize, scroll FABs, close-listeners,
// tooltip disposal) to FloatingPreviewShell — the same shell the subagent popup
// uses, so the two previews cannot visually diverge.
//
// Security: every host message carries `entryId` only (D9); untrusted strings go
// through textContent; the only innerHTML lives in the closed-map icon builders.

import type {
  VaultLaunchTargetsMessage,
  VaultMessageRecordResponseMessage,
  VaultSessionDetailResponseMessage,
} from "../../types/messages";
import { extractMessageText } from "../../vault/messageText";
import type { VaultLaunchTarget, VaultSessionDetail, VaultSessionEntry, VaultTimelineItem } from "../../vault/types";
import type { VaultPreviewGeometry } from "../state/WebviewState";
import { getAgentAccent, getAgentIcon, VAULT_ACCENTS } from "./agentIcons";
import { type ContinueDialogResult, openContinueDialog } from "./ContinueDialog";
import { FloatingPreviewShell } from "./FloatingPreviewShell";
import type { ForkPoint } from "./forkPoint";
import { agentLabel } from "./format";
import { mountMessageActions } from "./messageActions";
import { buildPreviewHeader as buildPreviewHeaderDom } from "./previewHeader";
import {
  type BoardSelection,
  type NestedInvocationFallback,
  type PreviewTimelineBag,
  renderNestedInto,
  renderNestedInvocationFallback,
  renderTimelineInto,
} from "./previewTimeline";
import { buildPreviewMeta, loadingBody, type MetaCopyTarget } from "./renderAtoms";
import type { VaultPanelPostMessage } from "./VaultPanel";
import { beginInlineRename, canResumeVaultEntry, cursorSourceLabel } from "./vaultListView";

/** Timeline items requested on the first open, and the step added per load-more. */
const PREVIEW_LIMIT_DEFAULT = 400;
const PREVIEW_LIMIT_STEP = 400;

/** Lowest viewport y the floating preview may occupy: the bottom of the terminal
 *  tab bar when it's shown (2+ terminals), else 0 (its rect is empty when hidden).
 *  Keeps the card from covering the tab strip; re-read live so it tracks toggles. */
function terminalTabBarBottom(): number {
  const tabBar = document.getElementById("tab-bar");
  return tabBar ? Math.max(0, tabBar.getBoundingClientRect().bottom) : 0;
}

export interface PreviewControllerDeps {
  postMessage: VaultPanelPostMessage;
  /** Whether the row context menu is open (Esc layering — one Esc shouldn't close both). */
  isContextMenuOpen: () => boolean;
  /** Close the context menu when a preview opens. */
  closeContextMenu: () => void;
  /** Live-resolve the list row for the open preview's entryId (anchoring). The
   *  controller stores no row ref — VaultPanel owns the list DOM (no rebind seam). */
  getActiveRow: () => HTMLElement | null;
  /** Ask VaultPanel to re-apply the selection highlight from `activeEntryId`
   *  (called after open/close, since an internal close has no VaultPanel call). */
  syncHighlight: () => void;
  getInitialPreviewGeometry?: () => VaultPreviewGeometry | null;
  persistPreviewGeometry?: (geometry: VaultPreviewGeometry) => void;
}

export class PreviewController {
  private readonly deps: PreviewControllerDeps;
  /** Window chrome (card + FloatingWindow + scroll FABs + close-listeners + tooltips). */
  private readonly shell: FloatingPreviewShell;
  private readonly timelineBag: PreviewTimelineBag;

  /** The entry id whose detail the open preview is for — stale responses (≠ this) are dropped. */
  private activePreviewEntryId: string | null = null;
  private activePreviewEntry: VaultSessionEntry | null = null;
  /** The header currently mounted, held so an open rename editor can survive a
   *  repaint (D7). */
  private headerEl: HTMLElement | null = null;
  /** True while the title's inline editor is open. */
  private titleEditing = false;
  /** Handle to the open title editor, so it can be ended without relying on blur. */
  private titleEdit: { end: () => void } | null = null;
  /** Serializes clipboard writes so the LAST affordance activated is the one that
   *  ends up on the clipboard. `writeText` calls run in parallel and the Clipboard
   *  API specifies no cross-call ordering, so concurrent writes could otherwise
   *  land in completion order rather than activation order (review B2). */
  private clipboardChain: Promise<void> = Promise.resolve();
  /** Detaches the shared per-message action bar from the previously rendered body. */
  private disposeMessageActions: (() => void) | undefined;
  /** Closes the open continuation dialog, if one is up. */
  private disposeContinueDialog: (() => void) | undefined;
  /** Resolvers for launch-target queries awaiting the host's reply (D11). */
  private pendingTargets: ((targets: VaultLaunchTarget[]) => void)[] = [];
  /** Raw copies awaiting a host reply, keyed `<entryId> <msgRef>`. */
  private readonly pendingRecords = new Map<
    string,
    { promise: Promise<string>; resolve: (v: string) => void; reject: (e: Error) => void }
  >();
  /** The detail currently shown — kept so "show more" can re-render in place. */
  private activePreviewDetail: VaultSessionDetail | null = null;
  /** Keys (`<prefix>#<runIndex>`) of AI-runs expanded past the per-run cap. */
  private readonly expandedRuns = new Set<string>();
  /** Timeline-item limit for the open preview (grows when older msgs are loaded). */
  private previewLimit = PREVIEW_LIMIT_DEFAULT;
  /** True while a load-more request is in flight (debounces the scroll trigger). */
  private previewLoadingMore = false;
  /** Set while a "scroll to first message" gesture loads every older window. */
  private previewScrollToTopPending = false;
  /** Timeline length seen on the previous load-all step (terminates the loop when a
   *  capped, still-`truncated` response stops growing). */
  private previewScrollToTopLastCount = 0;
  /** Nested expansion state, keyed by CARD (its place in the timeline, so two cards
   *  addressing one child open independently) and stable across re-renders;
   *  `nestedDetails` caches fetched child transcripts; `pendingNested` routes an
   *  in-flight detail response to its block. All reset when the preview closes. */
  private readonly expandedNested = new Set<string>();
  private readonly nestedDetails = new Map<string, VaultSessionDetail>();
  /** Source-recorded invocation fallback, keyed by the child view-only identity. */
  private readonly nestedFallbacks = new WeakMap<HTMLElement, NestedInvocationFallback>();
  /** Child entryId → every open block awaiting that detail, plus the preview
   *  generation that asked. A Set (not one element) so two blocks sharing a child
   *  entryId both resolve from ONE request, and collapsing one leaves the others
   *  waiting (W15). The generation drops a reply that outlived its preview (W16). */
  private readonly pendingNested = new Map<string, { generation: number; bodies: Set<HTMLElement> }>();
  /** Bumped whenever the open preview changes (open / switch / close), so a nested
   *  reply for a previous preview can never populate a card in the current one. */
  private previewGeneration = 0;
  /** Child entryId → replies still owed to previews that are already gone. The host
   *  echoes only `entryId`, so a reply for a dead request is otherwise
   *  indistinguishable from the reopened preview's own; replies arrive in order, so
   *  the first N for that id are the dead ones and are dropped (W16). */
  private readonly orphanedNested = new Map<string, number>();
  /** Child entryIds whose cached detail is mid-render — breaks a self-referential
   *  cycle (a child that nests its own id) before it overflows the stack. */
  private readonly renderingNested = new Set<string>();
  /** Per-workflow-board selection (open phases + open agent), keyed by run id.
   *  A board's selection is local DOM, so a re-render would lose it — persisting it
   *  here lets the rebuilt board reopen the same agent (and its now-expanded run).
   *  Reset when the preview closes. */
  private readonly boardSelections = new Map<string, BoardSelection>();
  /** Live-follow (enhance-vault-sessions D5): fingerprint of the currently-rendered
   *  timeline's tail, so a follow push that changed nothing no-ops. Null until the
   *  first render. */
  private followTailFingerprint: string | null = null;
  /** New messages appended by follow pushes while the reader is scrolled up — the
   *  count shown on the "N new messages" pill. Reset to 0 when caught up (at bottom). */
  private followPillCount = 0;

  constructor(deps: PreviewControllerDeps) {
    this.deps = deps;
    this.shell = new FloatingPreviewShell({
      ariaLabel: "Session preview",
      getAnchorRow: deps.getActiveRow,
      getMinTop: terminalTabBarBottom,
      initialGeometry: deps.getInitialPreviewGeometry,
      persistGeometry: deps.persistPreviewGeometry,
      onScrollTop: () => this.scrollPreviewToTop(),
      onRequestClose: () => this.closePreview(),
      shouldCloseOnEscape: () => !deps.isContextMenuOpen(),
      // The continuation dialog mounts on <body>, outside the card — without this
      // every click inside it reads as a click outside the preview and closes both.
      outsideCloseExclude: [".vault-row", ".vault-continue"],
      onKeyDown: (e) => this.handleKeyDown(e),
    });
    this.timelineBag = {
      isRunExpanded: (key) => this.expandedRuns.has(key),
      // Record only — `renderRun` reveals the hidden items in place (no rebuild), so
      // the scroll position and any nested board state are untouched (#4). The flag
      // is read on a later full rebuild (load-more / board restore) to stay expanded.
      onExpandRun: (key) => {
        this.expandedRuns.add(key);
      },
      isNestedExpanded: (_entryId, cardKey) => this.expandedNested.has(cardKey),
      setNestedExpanded: (entryId, expanded, cardKey, body) => {
        if (expanded) {
          this.expandedNested.add(cardKey);
          return;
        }
        // Collapse drops THIS card's share of the in-flight request so a late
        // response can't populate the now-hidden body (R4 stale-guard) — the
        // request itself survives while another open card still awaits it (W15).
        this.expandedNested.delete(cardKey);
        const pending = this.pendingNested.get(entryId);
        if (pending) {
          pending.bodies.delete(body);
          if (pending.bodies.size === 0) {
            this.pendingNested.delete(entryId);
          }
        }
      },
      populateNested: (entryId, body, fallback) => this.populateNested(entryId, body, fallback),
      getBoardSelection: (boardKey) => this.boardSelections.get(boardKey),
      // Record only — the board already updated its own DOM; a re-render here would
      // be the very thing this persistence exists to avoid (D4).
      setBoardSelection: (boardKey, selection) => {
        this.boardSelections.set(boardKey, selection);
      },
    };
  }

  /** The overlay element — appended into the panel host by VaultPanel. */
  get element(): HTMLElement {
    return this.shell.el;
  }

  /** Entry id of the open preview (or null) — VaultPanel reads it to re-anchor selection. */
  get activeEntryId(): string | null {
    return this.activePreviewEntryId;
  }

  /** Keep the active entry reference live when a host push skips the DOM re-render. */
  refreshActiveEntry(entry: VaultSessionEntry): void {
    this.activePreviewEntry = entry;
    // A rename commits through the host and lands back here. Patch the mounted
    // title rather than rebuilding the header — a repaint would re-track tooltips
    // and disturb the open card (W1).
    if (!this.titleEditing) {
      const titleEl = this.headerEl?.querySelector<HTMLElement>(".vault-preview-title");
      if (titleEl) {
        titleEl.textContent = previewTitleOf(entry);
      }
    }
  }

  /** Tear down all owned resources. Closing the preview detaches the document
   *  listeners, disposes header tooltips, cancels any in-flight drag, and resets
   *  the scroll-nav timer. Idempotent — safe when nothing is open. */
  dispose(): void {
    this.closePreview();
  }

  /**
   * Activate a row → open the floating preview in a loading state, anchor it near
   * the row, request the session detail. `activePreviewEntryId` is the guard the
   * response handler checks so a slow response for a row the user has left is dropped.
   */
  open(entry: VaultSessionEntry): void {
    this.deps.closeContextMenu();
    // Belt and braces with closePreview(): opening straight from one session to
    // another must never inherit the previous entry's header (B1).
    this.endTitleEdit();

    this.activePreviewEntryId = entry.id;
    this.activePreviewEntry = entry;
    this.activePreviewDetail = null;
    this.previewGeneration++; // opening/switching supersedes every in-flight nested reply
    this.retirePendingNested();
    this.expandedRuns.clear();
    this.expandedNested.clear();
    this.nestedDetails.clear();
    this.pendingNested.clear();
    this.boardSelections.clear();
    this.previewLimit = PREVIEW_LIMIT_DEFAULT;
    this.previewLoadingMore = false;
    this.previewScrollToTopPending = false;
    this.previewScrollToTopLastCount = 0;
    this.followTailFingerprint = null;
    this.followPillCount = 0;
    this.shell.scrollNav.reset(); // also clears any prior follow pill

    this.applyPreviewAgentAccent(entry.agent);
    this.renderPreviewLoading(entry);
    this.shell.show(); // is-open + anchor via getActiveRow + attach close-listeners
    this.deps.syncHighlight(); // VaultPanel sets aria-selected on the active row
    this.deps.postMessage({ type: "requestVaultSessionDetail", entryId: entry.id });
    // Live-follow: ask the host to watch this session's store; a switch re-points
    // the single follow watcher, close releases it (enhance-vault-sessions D5).
    this.deps.postMessage({ type: "vaultWatchSession", entryId: entry.id });
  }

  /** Tint the preview's user messages with the session's agent accent (D: #3). */
  private applyPreviewAgentAccent(agent: string): void {
    for (const a of VAULT_ACCENTS) {
      this.shell.el.classList.remove(`vault-preview--${a}`);
    }
    // Only a known, closed accent may become a class — never a raw session-derived
    // agent string (W6 / the injection rule).
    const accent = getAgentAccent(agent);
    if (accent) {
      this.shell.el.classList.add(`vault-preview--${accent}`);
    }
  }

  private disposeCurrentMessageActions(): void {
    this.disposeMessageActions?.();
    this.disposeMessageActions = undefined;
  }

  private closePreview(): void {
    // Shell teardown: cancel any in-flight drag, clear content, reset the scroll
    // nav, dispose header tooltips, detach the document close-listeners. Geometry +
    // maximized survive in FloatingWindow so the next open restores them (#1).
    this.endTitleEdit(); // before hide(): the editor must not outlive the card (B1)
    this.disposeCurrentMessageActions();
    this.shell.hide();
    this.activePreviewEntryId = null;
    this.activePreviewEntry = null;
    this.activePreviewDetail = null;
    this.previewGeneration++;
    this.retirePendingNested();
    this.expandedRuns.clear();
    this.expandedNested.clear();
    this.nestedDetails.clear();
    this.pendingNested.clear();
    this.boardSelections.clear();
    this.previewScrollToTopPending = false;
    this.previewScrollToTopLastCount = 0;
    this.followTailFingerprint = null;
    this.followPillCount = 0;
    this.disposeContinueDialog?.();
    this.disposeContinueDialog = undefined;
    this.pendingTargets = [];
    // No response will ever arrive for these now — settle them so the Raw
    // buttons awaiting them unfreeze instead of hanging on a dead preview.
    for (const pending of this.pendingRecords.values()) {
      pending.reject(new Error("Preview closed"));
    }
    this.pendingRecords.clear();
    // Release the host's live-follow watcher (at most one active, D5).
    this.deps.postMessage({ type: "vaultWatchSession", entryId: null });
    this.deps.syncHighlight(); // clears aria-selected (activeEntryId is now null)
  }

  /** Scroll to the session's FIRST message; loads every older window first when
   *  the timeline is still truncated (driven by `previewScrollToTopPending` below). */
  private scrollPreviewToTop(): void {
    if (this.activePreviewDetail?.truncated) {
      this.previewScrollToTopPending = true;
      this.previewScrollToTopLastCount = this.activePreviewDetail.timeline?.length ?? 0;
      this.requestMorePreview();
      return;
    }
    this.shell.scrollNav.scrollBody(0);
  }

  /**
   * Host → webview detail reply. Drops a response whose `entryId` is no longer the
   * active preview (stale-render guard). Renders the detail, a partial notice, or
   * an inline error; a nested reply routes to its expanded block independently.
   */
  /**
   * Settle the Raw copy waiting on this record (D5). Keyed by entry + locator so a
   * reply for a message the user has since navigated away from resolves nothing.
   */
  handleMessageRecordResponse(msg: VaultMessageRecordResponseMessage): void {
    const key = `${msg.entryId} ${msg.msgRef}`;
    const pending = this.pendingRecords.get(key);
    if (!pending) {
      return;
    }
    this.pendingRecords.delete(key);
    if (msg.record !== undefined) {
      pending.resolve(msg.record);
    } else {
      pending.reject(new Error(msg.error ?? "Message record unavailable."));
    }
  }

  /** Hand the message to the host and get out of the way — the new session opens
   *  as a tab, and leaving the overlay up would cover it. */
  /** Open the confirm dialog (D10). Nothing spawns until the reader starts it —
   *  a continuation can run without permission checks, so one click is not enough. */
  private continueFromMessage(entryId: string, fork: ForkPoint): void {
    const entry = this.activePreviewEntry;
    if (!entry || entry.id !== entryId) {
      return;
    }
    this.disposeContinueDialog?.();
    this.disposeContinueDialog = openContinueDialog(document.body, {
      sourceLabel: `${entry.customName || entry.title} · ${agentLabel(entry.agent)}`,
      cwd: entry.cwd,
      agent: entry.agent,
      ...(this.capturedPermissionOf(entry) ? { capturedPermission: this.capturedPermissionOf(entry) } : {}),
      fork,
      loadTargets: () => this.requestLaunchTargets(),
      ...(fork.seedRef ? { loadInstruction: () => this.instructionTextOf(entryId, fork.seedRef as string) } : {}),
      onConfirm: (result) => this.startContinuation(entryId, result),
    });
  }

  /** The posture the stored session was running under, on whichever axis its
   *  agent's choices are keyed (D11): Claude's permission mode, Codex's sandbox. */
  private capturedPermissionOf(entry: VaultSessionEntry): string | undefined {
    return entry.flags.permissionMode ?? entry.flags.sandbox;
  }

  /** The seed turn's untruncated text; the dialog falls back to the timeline's
   *  capped text when this rejects. */
  private async instructionTextOf(entryId: string, msgRef: string): Promise<string> {
    const record = await this.requestMessageRecord(entryId, msgRef);
    const parsed: unknown = JSON.parse(record);
    return typeof parsed === "object" && parsed !== null
      ? (extractMessageText(entryId.split(":")[0], record) ?? "")
      : "";
  }

  private requestLaunchTargets(): Promise<VaultLaunchTarget[]> {
    return new Promise((resolve) => {
      this.pendingTargets.push(resolve);
      this.deps.postMessage({ type: "requestVaultLaunchTargets" });
    });
  }

  handleLaunchTargets(msg: VaultLaunchTargetsMessage): void {
    const waiting = this.pendingTargets;
    this.pendingTargets = [];
    for (const resolve of waiting) {
      resolve(msg.targets);
    }
  }

  private startContinuation(entryId: string, result: ContinueDialogResult): void {
    this.deps.postMessage({
      type: "vaultContinueSession",
      entryId,
      instruction: result.instruction,
      confirmIntent: result.confirmIntent,
      agent: result.agent,
      ...(result.permissionChoiceId ? { permissionChoiceId: result.permissionChoiceId } : {}),
      ...(result.anchorRef ? { anchorRef: result.anchorRef } : {}),
    });
    this.closePreview();
  }

  /** Ask the host for one message's stored record; rejects if none comes back. */
  private requestMessageRecord(entryId: string, msgRef: string): Promise<string> {
    const key = `${entryId} ${msgRef}`;
    const existing = this.pendingRecords.get(key);
    if (existing) {
      return existing.promise;
    }
    let resolve!: (value: string) => void;
    let reject!: (err: Error) => void;
    const promise = new Promise<string>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.pendingRecords.set(key, { promise, resolve, reject });
    this.deps.postMessage({ type: "requestVaultMessageRecord", entryId, msgRef });
    return promise;
  }

  handleSessionDetailResponse(msg: VaultSessionDetailResponseMessage): void {
    const orphaned = this.orphanedNested.get(msg.entryId);
    if (orphaned) {
      // Owed to a preview that has since closed or switched — consume one and drop.
      if (orphaned > 1) {
        this.orphanedNested.set(msg.entryId, orphaned - 1);
      } else {
        this.orphanedNested.delete(msg.entryId);
      }
      return;
    }
    const nested = this.pendingNested.get(msg.entryId);
    if (nested) {
      this.pendingNested.delete(msg.entryId);
      if (nested.generation !== this.previewGeneration) {
        return; // the preview that asked is gone — never paint a superseded reply
      }
      const nestedContainers = nested.bodies;
      const usableDetail =
        msg.detail && !msg.error && msg.detail.contentKind !== "metadata-only" && msg.detail.partial !== true
          ? msg.detail
          : undefined;
      if (usableDetail) {
        this.nestedDetails.set(msg.entryId, usableDetail);
        for (const container of nestedContainers) {
          renderNestedInto(container, usableDetail, msg.entryId, this.timelineBag);
          scrollBoardDetailToEnd(container);
        }
      } else {
        for (const container of nestedContainers) {
          const fallback = this.nestedFallbacks.get(container);
          if (fallback) {
            renderNestedInvocationFallback(container, fallback);
          } else {
            container.textContent = msg.error ?? "Couldn't read this sub-session.";
          }
        }
      }
      return;
    }
    // Live-follow push (D5) — handled BEFORE the normal open/load-more path so it
    // never force-scrolls to the bottom. Own stale-guard + no-op detection inside.
    if (msg.followUpdate) {
      this.handleFollowUpdate(msg);
      return;
    }
    if (msg.entryId !== this.activePreviewEntryId || !this.activePreviewEntry) {
      return; // stale — ignore
    }
    const wasLoadingMore = this.previewLoadingMore;
    this.previewLoadingMore = false;
    if (msg.error || !msg.detail) {
      // Clear an in-flight "scroll to first message" walk — otherwise the flag
      // stays stale and the next successful reply jumps to the top unexpectedly.
      this.previewScrollToTopPending = false;
      this.previewScrollToTopLastCount = 0;
      this.renderPreviewError(this.activePreviewEntry, msg.error ?? "Couldn't read this session.");
      return;
    }
    // On load-more, older items are prepended → keep the viewport anchored to the
    // same content by preserving the distance from the bottom across the re-render.
    const bodyBefore = this.shell.el.querySelector<HTMLElement>(".vault-preview-body");
    const fromBottom = wasLoadingMore && bodyBefore ? bodyBefore.scrollHeight - bodyBefore.scrollTop : null;
    // A load-more re-render prepends older items to the ROOT timeline, shifting its
    // run indices → drop root run-expansions only. Nested transcripts didn't change,
    // so their `<entryId>#…` expansions stay valid (must not be cleared).
    if (wasLoadingMore) {
      for (const k of this.expandedRuns) {
        if (k.startsWith("root#")) {
          this.expandedRuns.delete(k);
        }
      }
    }
    this.renderPreviewDetail(this.activePreviewEntry, msg.detail);
    if (this.previewScrollToTopPending) {
      // A "scroll to first message" gesture is walking older windows. Keep loading
      // while the timeline still GROWS; stop once fully loaded OR the host stops
      // returning more (it clamps at MAX_DETAIL_LIMIT, so a >cap session stays
      // `truncated` forever — without the growth check this would loop). Then jump
      // to the very top instantly (a smooth scroll across full history would be jarring).
      const count = this.activePreviewDetail?.timeline?.length ?? 0;
      const grew = count > this.previewScrollToTopLastCount;
      this.previewScrollToTopLastCount = count;
      if (this.activePreviewDetail?.truncated && grew) {
        this.requestMorePreview();
      } else {
        this.previewScrollToTopPending = false;
        this.previewScrollToTopLastCount = 0;
        const bodyAfter = this.shell.el.querySelector<HTMLElement>(".vault-preview-body");
        if (bodyAfter) {
          bodyAfter.scrollTop = 0;
        }
      }
    } else if (fromBottom !== null) {
      const bodyAfter = this.shell.el.querySelector<HTMLElement>(".vault-preview-body");
      if (bodyAfter) {
        bodyAfter.scrollTop = Math.max(0, bodyAfter.scrollHeight - fromBottom);
      }
    } else {
      // Initial open: jump to the latest message (bottom); scroll up for history (#1).
      this.shell.scrollNav.scrollToEnd();
    }
  }

  /**
   * Live-follow push (D5): the host re-read the followed session after a file
   * change. Detect a real change via a tail fingerprint (NOT length/timestamp);
   * if the reader is at/near the bottom, re-render + re-pin to the newest message
   * (auto-scroll); otherwise preserve the viewport and raise a "N new messages"
   * pill. A no-change push, an error, or an in-flight load-more/scroll-walk no-ops.
   */
  private handleFollowUpdate(msg: VaultSessionDetailResponseMessage): void {
    if (msg.entryId !== this.activePreviewEntryId || !this.activePreviewEntry) {
      return; // the user switched/closed before this follow push landed — stale.
    }
    if (msg.error || !msg.detail) {
      return; // a follow re-read error keeps the current view (silent).
    }
    if (this.previewLoadingMore || this.previewScrollToTopPending) {
      return; // don't fight an in-progress load-more / scroll-to-first walk.
    }
    const detail = msg.detail;
    const fingerprint = tailFingerprint(detail.timeline ?? []);
    if (fingerprint === this.followTailFingerprint) {
      return; // tail unchanged — nothing new to show (D5: fingerprint, not length).
    }

    const body = this.shell.el.querySelector<HTMLElement>(".vault-preview-body");
    const atBottom = body ? isNearBottom(body) : true;
    const prevScrollTop = body?.scrollTop ?? 0;
    const prevCount = this.activePreviewDetail?.timeline?.length ?? 0;
    const newCount = detail.timeline?.length ?? 0;

    // The reader is up in loaded history and this bounded re-read would return a
    // SHORTER window (they had loaded older messages) — leave their view intact;
    // they'll catch up when they scroll back down.
    if (!atBottom && newCount < prevCount) {
      return;
    }

    this.renderPreviewDetail(this.activePreviewEntry, detail); // updates followTailFingerprint
    const bodyAfter = this.shell.el.querySelector<HTMLElement>(".vault-preview-body");
    // The tail genuinely changed → flash the newest message so a new reply is easy
    // to spot without stealing focus. Only on this live-follow path — never on the
    // initial open or a load-more (those aren't "new chat arrived" events).
    this.flashNewestMessage(bodyAfter);
    if (atBottom) {
      // Following the tail → keep pinned to the newest message.
      this.followPillCount = 0;
      this.shell.scrollNav.clearNewMessages();
      if (bodyAfter) {
        bodyAfter.scrollTop = bodyAfter.scrollHeight;
      }
    } else {
      // Scrolled up → keep the viewport (new items appended below) + raise the pill.
      if (bodyAfter) {
        bodyAfter.scrollTop = prevScrollTop;
      }
      const delta = newCount - prevCount;
      this.followPillCount += delta > 0 ? delta : 1; // content changed even at equal length
      this.shell.scrollNav.setNewMessages(this.followPillCount, () => this.scrollFollowToLatest());
    }
  }

  /** Pill click / caught-up: jump to the newest message and dismiss the pill. */
  private scrollFollowToLatest(): void {
    this.followPillCount = 0;
    this.shell.scrollNav.clearNewMessages();
    this.shell.scrollNav.scrollBody("end");
  }

  /** Add a one-shot "just arrived" flash to the newest real message in the preview
   *  body (CSS fades the accent overlay out). Prefers a non-thinking message so the
   *  reply — not a thinking block — is what lights up; falls back to the last message
   *  of any kind. No-op when the body has no message element. */
  private flashNewestMessage(body: HTMLElement | null): void {
    if (!body) {
      return;
    }
    const messages = Array.from(body.querySelectorAll<HTMLElement>(".vault-preview-message"));
    if (messages.length === 0) {
      return;
    }
    // Newest real message: scan from the end, skipping thinking blocks so the reply
    // lights up rather than a thinking block; fall back to the last message.
    let target = messages[messages.length - 1];
    for (let k = messages.length - 1; k >= 0; k--) {
      if (!messages[k].classList.contains("vault-preview-message-thinking")) {
        target = messages[k];
        break;
      }
    }
    target.classList.add("is-fresh");
  }

  private buildPreviewHeader(entry: VaultSessionEntry, detail?: VaultSessionDetail): HTMLElement {
    // A live-follow update repaints on every new message. Rebuilding the header
    // mid-rename would replace the editor and discard what was typed, so the open
    // one is handed back untouched — which also skips the tooltip re-track (D7).
    if (this.titleEditing && this.headerEl) {
      return this.headerEl;
    }
    // Tear down the prior build's tooltips before the new build attaches its own.
    this.shell.disposeTooltips();
    const label = agentLabel(entry.agent);
    const meta = buildPreviewMeta(entry, detail, (target) => this.copyMeta(entry, target));
    const sourceLabel = cursorSourceLabel(entry);
    if (sourceLabel) {
      const term = document.createElement("dt");
      term.textContent = "Source";
      const value = document.createElement("dd");
      value.className = "vault-preview-meta-text";
      value.textContent = `Cursor ${sourceLabel}`;
      meta.element.append(term, value);
    }
    const { element, disposers } = buildPreviewHeaderDom(
      {
        badge: { icon: getAgentIcon(entry.agent), ariaLabel: label, fallbackText: label.slice(0, 2) },
        title: previewTitleOf(entry),
        meta: meta.element,
      },
      {
        isMaximized: () => this.shell.floatingWindow.isMaximized(),
        onMovePointerDown: (ev) => this.shell.floatingWindow.startMove(ev),
        ...(canResumeVaultEntry(entry)
          ? {
              onResume: () => {
                this.deps.postMessage({ type: "vaultResume", entryId: entry.id });
                this.closePreview();
              },
            }
          : {}),
        onToggleMaximize: () => this.shell.floatingWindow.toggleMaximize(),
        onClose: () => this.closePreview(),
        onRenameTitle: (titleEl) => this.renameTitle(entry, titleEl),
      },
    );
    this.shell.trackTooltips([...disposers, ...meta.disposers]);
    this.headerEl = element;
    return element;
  }

  /** Open the inline rename editor on the preview title. Same editor and same
   *  commit as the session list's rename — one path, not two (D7). */
  private renameTitle(entry: VaultSessionEntry, titleEl: HTMLElement): void {
    this.titleEditing = true;
    this.titleEdit = beginInlineRename(titleEl, entry, {
      commit: (name) => this.deps.postMessage({ type: "vaultRenameSession", entryId: entry.id, name }),
      onDone: () => {
        this.titleEditing = false;
        this.titleEdit = null;
      },
    });
  }

  /**
   * End any open title edit and drop the retained header. MUST run before the
   * card is hidden or bound to another entry: `buildPreviewHeader` hands back
   * `headerEl` while `titleEditing` is set, so a stale flag would remount the
   * PREVIOUS session's header — with its Resume, copy and rename callbacks still
   * closed over that entry (review B1). Not left to `blur`, which is not
   * guaranteed when a focused node is removed — the assumption that caused it.
   */
  private endTitleEdit(): void {
    this.titleEdit?.end();
    this.titleEdit = null;
    this.titleEditing = false;
    this.headerEl = null;
  }

  /**
   * Alt+ArrowUp / Alt+ArrowDown jump to the previous / next user message — the
   * keyboard replacement for the title row's removed jump buttons. Claimed in the
   * capture phase and stopped dead, otherwise the pty key router (or xterm, when
   * the terminal holds focus) delivers the key to the running agent instead.
   * Declined while a text field owns the caret or the row context menu owns the
   * layer, so it can never fight an inline rename.
   */
  private handleKeyDown(e: KeyboardEvent): void {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) {
      return;
    }
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") {
      return;
    }
    // A text field owns the caret: Alt+Arrow is word/line movement there, so it
    // passes through untouched.
    if (isTextEntryFocused()) {
      return;
    }
    // Claimed before the context-menu check: the menu suppresses navigation but
    // never handles arrows, and the key must still not reach the terminal while
    // the overlay is open (W3).
    e.preventDefault();
    e.stopPropagation();
    if (this.deps.isContextMenuOpen()) {
      return;
    }
    this.shell.scrollNav.scrollToAdjacentUser(e.key === "ArrowUp" ? -1 : 1);
  }

  /**
   * A meta-block copy affordance was activated: write that value straight to the
   * clipboard from here (D4). The value is text this preview already rendered,
   * so asking the host for it bought nothing — and cost everything: each click
   * ran a full uncached `VaultService.list()`, two quick clicks raced with no
   * ordering, and a resolve miss returned silently and left the previous
   * clipboard content in place. A local write is instant and ordered.
   *
   * D9 is untouched: it exists to stop the host ACTING on a webview-supplied
   * path (opening, revealing, executing it). No host privilege is used here.
   */
  private copyMeta(entry: VaultSessionEntry, target: MetaCopyTarget): Promise<void> {
    const value = {
      cwd: entry.cwd,
      gitBranch: entry.gitBranch,
      sessionId: entry.sessionId,
      sessionPath: entry.sessionPath,
    }[target];
    if (!value) {
      return Promise.reject(new Error(`no ${target} recorded`));
    }
    // Queued behind earlier activations so the clipboard holds the LAST value
    // activated, not whichever write finished last (B2). Kept rejection-safe: one
    // refused write must not wedge every copy after it.
    return this.copyText(value);
  }

  /** Queue one clipboard write behind the earlier ones (B2), rejection-safe. */
  private copyText(value: string): Promise<void> {
    const write = this.clipboardChain.then(() => navigator.clipboard.writeText(value));
    this.clipboardChain = write.catch(() => {});
    return write;
  }

  private renderPreviewLoading(entry: VaultSessionEntry): void {
    this.disposeCurrentMessageActions();
    this.shell.render(this.buildPreviewHeader(entry), loadingBody());
  }

  private renderPreviewError(entry: VaultSessionEntry, message: string): void {
    this.disposeCurrentMessageActions();
    const body = document.createElement("div");
    body.className = "vault-preview-error";
    body.textContent = message;
    this.shell.render(this.buildPreviewHeader(entry), body);
  }

  private renderPreviewDetail(entry: VaultSessionEntry, detail: VaultSessionDetail): void {
    this.activePreviewDetail = detail; // kept so "Show more" can re-render in place
    // Track the tail so the next live-follow push can no-op when nothing changed (D5).
    this.followTailFingerprint = tailFingerprint(detail.timeline ?? []);
    const body = document.createElement("div");
    body.className = "vault-preview-body";

    const metadataOnly =
      detail.contentKind === "metadata-only" || (detail.contentKind === undefined && entry.agent === "cursor");
    if (!metadataOnly && detail.truncated) {
      const loadMore = document.createElement("button");
      loadMore.type = "button";
      loadMore.className = "vault-preview-loadmore";
      loadMore.title = "Load older messages in this session";
      loadMore.textContent = this.previewLoadingMore ? "Loading older messages…" : "↑ Load older messages";
      loadMore.disabled = this.previewLoadingMore;
      loadMore.addEventListener("click", () => this.requestMorePreview());
      body.appendChild(loadMore);
    }
    if (detail.partial && detail.limitedReason) {
      const notice = document.createElement("div");
      notice.className = "vault-preview-notice";
      notice.textContent = detail.limitedReason;
      body.appendChild(notice);
    }

    if (metadataOnly) {
      // Limited metadata has no transcript or message anchor. Continue starts an
      // independent session, so it deliberately carries no fork point.
      const continueBtn = document.createElement("button");
      continueBtn.type = "button";
      continueBtn.className = "vault-preview-continue";
      continueBtn.textContent = "Continue in New Session";
      continueBtn.addEventListener("click", () => this.continueFromMessage(entry.id, {}));
      body.appendChild(continueBtn);
    } else {
      // Full chronological transcript, run-grouped + capped. The same renderer is
      // reused for nested transcripts so capping + pinned conclusions match (D14).
      renderTimelineInto(body, detail.timeline ?? [], "root", this.timelineBag);
    }

    // Metadata-only details never expose transcript-derived copy, raw, or
    // anchored continuation controls.
    this.disposeCurrentMessageActions();
    if (!metadataOnly) {
      this.disposeMessageActions = mountMessageActions(body, {
        copy: (text) => this.copyText(text),
        copyRaw: (msgRef) => this.requestMessageRecord(entry.id, msgRef),
        timeline: () => this.activePreviewDetail?.timeline ?? [],
        continueFrom: (fork) => this.continueFromMessage(entry.id, fork),
      });
    }

    // Scroll to the top → load older messages (incremental, while more remain).
    // Scroll back to the bottom → the reader is caught up: dismiss the follow pill.
    body.addEventListener("scroll", () => {
      if (body.scrollTop <= 48 && this.activePreviewDetail?.truncated && !this.previewLoadingMore) {
        this.requestMorePreview();
      }
      if (this.followPillCount > 0 && isNearBottom(body)) {
        this.followPillCount = 0;
        this.shell.scrollNav.clearNewMessages();
      }
    });

    this.shell.render(this.buildPreviewHeader(entry, detail), body);
  }

  /** Request the next-older window of timeline items (grows the limit). */
  private requestMorePreview(): void {
    if (this.previewLoadingMore || !this.activePreviewEntryId || !this.activePreviewDetail?.truncated) {
      return;
    }
    this.previewLoadingMore = true;
    this.previewLimit += PREVIEW_LIMIT_STEP;
    const btn = this.shell.el.querySelector<HTMLButtonElement>(".vault-preview-loadmore");
    if (btn) {
      btn.textContent = "Loading older messages…";
      btn.disabled = true;
    }
    this.deps.postMessage({
      type: "requestVaultSessionDetail",
      entryId: this.activePreviewEntryId,
      limit: this.previewLimit,
    });
  }

  /** Move every in-flight nested request onto the orphan ledger: its preview is
   *  gone, so the reply it will still receive must be dropped rather than painted
   *  into whatever card holds that child id next (W16). */
  private retirePendingNested(): void {
    for (const entryId of this.pendingNested.keys()) {
      this.orphanedNested.set(entryId, (this.orphanedNested.get(entryId) ?? 0) + 1);
    }
  }

  /** Fill a subagent block's body: from cache, or lazily fetch the child detail. */
  private populateNested(entryId: string, body: HTMLElement, fallback?: NestedInvocationFallback): void {
    if (fallback) {
      this.nestedFallbacks.set(body, fallback);
    }
    const cached = this.nestedDetails.get(entryId);
    if (cached) {
      // Cached render is synchronous; if this id is already on the render stack the
      // detail nests itself — stop rather than recurse into a stack overflow.
      if (this.renderingNested.has(entryId)) {
        body.replaceChildren();
        return;
      }
      this.renderingNested.add(entryId);
      try {
        renderNestedInto(body, cached, entryId, this.timelineBag);
        scrollBoardDetailToEnd(body);
      } finally {
        this.renderingNested.delete(entryId);
      }
      return;
    }
    body.replaceChildren(loadingBody());
    const pending = this.pendingNested.get(entryId);
    if (pending && pending.generation === this.previewGeneration) {
      pending.bodies.add(body); // every open card sharing this entryId resolves together
      return;
    }
    this.pendingNested.set(entryId, { generation: this.previewGeneration, bodies: new Set([body]) });
    this.deps.postMessage({ type: "requestVaultSessionDetail", entryId });
  }
}

/** Whether the caret currently sits in a text field (the inline rename editor, a
 *  search box) — a keyboard binding must stand down rather than steal the key. */
/** A user rename overrides the derived title everywhere it's shown (D1). */
function previewTitleOf(entry: VaultSessionEntry): string {
  return entry.customName || entry.title || "(untitled session)";
}

function isTextEntryFocused(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) {
    return false;
  }
  return el.isContentEditable || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

/** Whether a scroll container is at/near its bottom edge — the "following the
 *  tail" threshold that decides auto-scroll vs. the "N new messages" pill (D5). */
function isNearBottom(el: HTMLElement, threshold = 60): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

/** A stable fingerprint over the last K timeline items — `kind|role|timestamp|
 *  text-prefix` per item, plus the total length. Detects new/changed tail content
 *  where a bounded window can shift at equal length, so live-follow (D5) can no-op
 *  a push that changed nothing. NOT length/timestamp alone (both are unreliable). */
function tailFingerprint(timeline: readonly VaultTimelineItem[], k = 8): string {
  return `${timeline.slice(-k).map(itemTail).join("§")}#${timeline.length}`;
}

/** One timeline item's tail signature. Reads the common discriminating fields
 *  (role/timestamp/text|title|preview) generically so every item kind contributes.
 *  Includes the text length + a trailing slice (not just a 48-char prefix) so an
 *  assistant message assembled IN PLACE across re-reads — same item, growing text,
 *  unchanged prefix — still changes the fingerprint and live-follow keeps up (W3). */
function itemTail(item: VaultTimelineItem): string {
  const it = item as Record<string, unknown>;
  const role = typeof it.role === "string" ? it.role : "";
  const ts = typeof it.timestamp === "number" ? String(it.timestamp) : "";
  const text =
    typeof it.text === "string"
      ? it.text
      : typeof it.title === "string"
        ? it.title
        : typeof it.preview === "string"
          ? it.preview
          : "";
  return `${item.kind}|${role}|${ts}|${text.length}|${text.slice(0, 32)}|${text.slice(-24)}`;
}

/** After a workflow-board agent's transcript renders into `container`, jump its
 *  scroll pane to the last message so the conclusion is the immediate preview (#3).
 *  No-op for any other nested container (or a detached one with no board pane). */
function scrollBoardDetailToEnd(container: HTMLElement): void {
  if (!container.classList.contains("vault-wfboard-detail-body")) {
    return;
  }
  const pane = container.closest<HTMLElement>(".vault-wfboard-right");
  if (pane) {
    pane.scrollTop = pane.scrollHeight;
  }
}
