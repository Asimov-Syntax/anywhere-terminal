// The reusable chrome behind every floating preview card: the `.vault-preview`
// `<aside>` + FloatingWindow (resize/move/maximize/geometry) + PreviewScrollNav
// (top/bottom FABs) + the document close-listeners + the header tooltip disposers
// + the render assembly. Knows NOTHING about vault entries, transcripts, or the
// subagent popup — it only drives the element it owns, so both consumers route
// through one shell and cannot visually diverge.

import type { VaultPreviewGeometry } from "../state/WebviewState";
import { FloatingWindow } from "./FloatingWindow";
import { PreviewScrollNav } from "./previewScrollNav";

export interface FloatingPreviewShellDeps {
  ariaLabel: string;
  /** ARIA role (subagent popup → "dialog"; the vault preview omits it). */
  role?: string;
  /** Extra classes on the card; "vault-preview" is always present. */
  classNames?: string[];
  /** Row to anchor to when no geometry is remembered (re-queried live). */
  getAnchorRow?: () => HTMLElement | null;
  /** Lowest viewport y the card may occupy — e.g. below the terminal tab bar. */
  getMinTop?: () => number;
  /** Resolved once at construction — seeds FloatingWindow's restore geometry. */
  initialGeometry?: () => VaultPreviewGeometry | null;
  persistGeometry?: (geometry: VaultPreviewGeometry) => void;
  /** Top-FAB click — owner-driven so it can walk older windows before scrolling. */
  onScrollTop: () => void;
  /** The single close intent (header close button | Escape | outside click). The
   *  owner resets its own state and then calls hide(); the shell never closes itself. */
  onRequestClose: () => void;
  /** Escape guard (vault suppresses it while its context menu owns the layer). */
  shouldCloseOnEscape?: () => boolean;
  /** Outside-click targets that must NOT dismiss (vault keeps `.vault-row` clicks). */
  outsideCloseExclude?: string[];
  /**
   * Optional per-consumer key bindings, delivered while the card is open. Bound
   * in the CAPTURE phase — `main.ts` installs a capture-phase document router
   * that forwards keys to the pty, and xterm's own handler consumes them when
   * the terminal holds DOM focus — so a binding here must be able to claim the
   * key first. The handler decides whether to `preventDefault`/`stopPropagation`.
   * Kept separate from the close listeners so their phase is unaffected; a
   * consumer that passes nothing (the subagent popup) gets no listener at all.
   */
  onKeyDown?: (e: KeyboardEvent) => void;
  /** Listen in the capture phase (subagent popup) vs bubble (vault default). */
  captureCloseListeners?: boolean;
}

export class FloatingPreviewShell {
  readonly el: HTMLElement;
  readonly floatingWindow: FloatingWindow;
  readonly scrollNav: PreviewScrollNav;
  private readonly deps: FloatingPreviewShellDeps;
  private readonly tooltipDisposers: Array<() => void> = [];
  private onDocPointerDown?: (e: MouseEvent) => void;
  private onDocKeyDown?: (e: KeyboardEvent) => void;
  private onDocKeyDownCapture?: (e: KeyboardEvent) => void;

  constructor(deps: FloatingPreviewShellDeps) {
    this.deps = deps;
    const el = document.createElement("aside");
    el.className = ["vault-preview", ...(deps.classNames ?? [])].join(" ");
    el.setAttribute("aria-label", deps.ariaLabel);
    if (deps.role) {
      el.setAttribute("role", deps.role);
    }
    this.el = el;
    this.floatingWindow = new FloatingWindow({
      el,
      initialGeometry: deps.initialGeometry?.() ?? null,
      persistGeometry: deps.persistGeometry,
      getAnchorRow: deps.getAnchorRow ?? (() => null),
      getMinTop: deps.getMinTop,
    });
    this.scrollNav = new PreviewScrollNav({ el, onScrollTop: deps.onScrollTop });
  }

  /** Assemble content → resize handles → scroll-nav FABs, then (re)bind scroll. */
  render(...nodes: Node[]): void {
    this.el.replaceChildren(...nodes, ...this.floatingWindow.resizeHandles, this.scrollNav.element);
    this.scrollNav.wire();
  }

  /** Reveal the card: (re)attach close listeners, mark open, place via geometry/anchor. */
  show(): void {
    this.attachCloseListeners();
    this.el.classList.add("is-open");
    this.floatingWindow.place();
  }

  /** Hide + tear down owned resources. Does NOT call onRequestClose (the close path
   *  already routed through it); only cancelGesture — geometry is left intact so a
   *  reopen restores size/maximized. */
  hide(): void {
    this.floatingWindow.cancelGesture();
    this.el.classList.remove("is-open");
    this.el.replaceChildren();
    this.scrollNav.reset();
    this.disposeTooltips();
    this.detachCloseListeners();
  }

  trackTooltips(disposers: Array<() => void>): void {
    this.tooltipDisposers.push(...disposers);
  }

  disposeTooltips(): void {
    for (const dispose of this.tooltipDisposers) {
      dispose();
    }
    this.tooltipDisposers.length = 0;
  }

  isOpen(): boolean {
    return this.el.classList.contains("is-open");
  }

  dispose(): void {
    this.hide();
    this.el.remove();
  }

  private attachCloseListeners(): void {
    this.detachCloseListeners(); // idempotent: the vault reuses one shell across opens
    const capture = this.deps.captureCloseListeners ?? false;
    this.onDocPointerDown = (e) => {
      const target = e.target;
      if (target instanceof Node && this.el.contains(target)) {
        return;
      }
      if (target instanceof Element) {
        for (const sel of this.deps.outsideCloseExclude ?? []) {
          if (target.closest(sel)) {
            return;
          }
        }
      }
      this.deps.onRequestClose();
    };
    this.onDocKeyDown = (e) => {
      if (e.key === "Escape" && (this.deps.shouldCloseOnEscape?.() ?? true)) {
        this.deps.onRequestClose();
      }
    };
    document.addEventListener("mousedown", this.onDocPointerDown, capture);
    document.addEventListener("keydown", this.onDocKeyDown, capture);
    // Consumer key bindings ride their own ALWAYS-capture listener, so they can
    // claim a key before the pty router regardless of the close-listener phase.
    const onKeyDown = this.deps.onKeyDown;
    if (onKeyDown) {
      this.onDocKeyDownCapture = (e) => onKeyDown(e);
      document.addEventListener("keydown", this.onDocKeyDownCapture, true);
    }
  }

  private detachCloseListeners(): void {
    const capture = this.deps.captureCloseListeners ?? false;
    if (this.onDocPointerDown) {
      document.removeEventListener("mousedown", this.onDocPointerDown, capture);
      this.onDocPointerDown = undefined;
    }
    if (this.onDocKeyDown) {
      document.removeEventListener("keydown", this.onDocKeyDown, capture);
      this.onDocKeyDown = undefined;
    }
    if (this.onDocKeyDownCapture) {
      document.removeEventListener("keydown", this.onDocKeyDownCapture, true);
      this.onDocKeyDownCapture = undefined;
    }
  }
}
