// src/webview/ui/Tooltip.ts — Shared custom hover tooltip widget.
//
// Native browser `title` tooltips don't render reliably inside VSCode webviews
// (long OS-dependent delays; some platforms suppress them). This module owns
// a single shared widget mounted on `document.body` so it isn't clipped by
// any panel's `overflow: hidden`. Used by both the file-tree and vault panels.
// Styled with `--vscode-editorHoverWidget-*` theme vars (see ui/tooltip.css
// `.webview-tooltip`).
//
// Usage:
//   const dispose = attachTooltip(btn);                            // reads & strips btn.title
//   const dispose = attachTooltip(btn, { text });                  // explicit text
//   const dispose = attachTooltip(btn, { getText: () => ... });    // dynamic text (re-read on each show)
//   dispose();                                                     // on panel.dispose()
//
// Accessibility:
//   - Widget has `role="tooltip"` and a shared id; targets get `aria-describedby`.
//   - Focus/blur show the tooltip in addition to mouse — WCAG 1.4.13.

const SHOW_DELAY_MS = 300;
const WIDGET_ID = "webview-tooltip-widget";

interface Singleton {
  doc: Document;
  el: HTMLDivElement;
}

let widget: Singleton | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let currentTarget: HTMLElement | null = null;

function ensureWidget(doc: Document): HTMLDivElement {
  if (widget && widget.doc === doc && doc.body.contains(widget.el)) {
    return widget.el;
  }
  widget?.el.remove();
  const el = doc.createElement("div");
  el.className = "webview-tooltip";
  el.setAttribute("role", "tooltip");
  el.id = WIDGET_ID;
  el.style.display = "none";
  doc.body.appendChild(el);
  widget = { doc, el };
  return el;
}

function show(target: HTMLElement, text: string): void {
  const doc = target.ownerDocument;
  if (!doc?.body.contains(target)) {
    return;
  }
  const el = ensureWidget(doc);
  el.textContent = text;
  el.style.left = "0px";
  el.style.top = "0px";
  el.style.display = "block";
  const rect = target.getBoundingClientRect();
  const ttRect = el.getBoundingClientRect();
  const view = doc.defaultView;
  const viewportW = view?.innerWidth ?? 0;
  const viewportH = view?.innerHeight ?? 0;
  let left = rect.left + rect.width / 2 - ttRect.width / 2;
  let top = rect.bottom + 6;
  if (viewportH > 0 && top + ttRect.height > viewportH - 4) {
    top = rect.top - ttRect.height - 6;
  }
  if (viewportW > 0) {
    left = Math.max(4, Math.min(left, viewportW - ttRect.width - 4));
  }
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

function hide(): void {
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  currentTarget = null;
  if (widget) {
    widget.el.style.display = "none";
  }
}

function scheduleShow(target: HTMLElement, resolveText: () => string): void {
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
  }
  currentTarget = target;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    if (currentTarget !== target) {
      return;
    }
    const live = resolveText();
    if (live) {
      show(target, live);
    }
  }, SHOW_DELAY_MS);
}

export interface AttachTooltipOptions {
  /** Overrides `target.title`. When omitted, target's title is used and then stripped. */
  text?: string;
  /** Dynamic text — called on each show. Use when the trigger's hint changes
   * with component state (e.g. the search button alternates between
   * "Search files in tree" and "Close search" as search-mode toggles). Takes
   * precedence over `text`. The closure is re-evaluated on every show so
   * callers don't have to re-attach. */
  getText?: () => string;
}

export function attachTooltip(target: HTMLElement, opts: AttachTooltipOptions = {}): () => void {
  const fromTitle = target.title;
  const staticText = (opts.text ?? fromTitle ?? "").trim();
  // Strip native title so the OS tooltip doesn't double up. This strip
  // happens once at attach — callers that re-assign `target.title` later
  // would reintroduce the native tooltip. Prefer `getText` for stateful
  // labels so the title attribute never gets re-set.
  if (fromTitle) {
    target.removeAttribute("title");
  }
  const resolveText = (): string => (opts.getText ? opts.getText() : staticText).trim();
  if (!resolveText()) {
    return () => {};
  }

  // Eagerly create the widget so `aria-describedby` resolves immediately
  // (lazy creation would leave the id reference dangling until first show,
  // which some screen readers don't re-resolve).
  const doc = target.ownerDocument;
  if (doc) {
    ensureWidget(doc);
  }
  target.setAttribute("aria-describedby", WIDGET_ID);

  const onEnter = (): void => scheduleShow(target, resolveText);
  const onLeave = (): void => {
    if (currentTarget === target) {
      hide();
    }
  };
  const onDown = (): void => {
    if (currentTarget === target) {
      hide();
    }
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") {
      hide();
    }
  };
  // WCAG 1.4.13 — keyboard-focus must also expose the hint, not just mouse.
  const onFocus = (): void => onEnter();
  const onBlur = (): void => onLeave();

  target.addEventListener("mouseenter", onEnter);
  target.addEventListener("mouseleave", onLeave);
  target.addEventListener("mousedown", onDown);
  target.addEventListener("keydown", onKey);
  target.addEventListener("focus", onFocus);
  target.addEventListener("blur", onBlur);

  return () => {
    target.removeEventListener("mouseenter", onEnter);
    target.removeEventListener("mouseleave", onLeave);
    target.removeEventListener("mousedown", onDown);
    target.removeEventListener("keydown", onKey);
    target.removeEventListener("focus", onFocus);
    target.removeEventListener("blur", onBlur);
    if (target.getAttribute("aria-describedby") === WIDGET_ID) {
      target.removeAttribute("aria-describedby");
    }
    if (currentTarget === target) {
      hide();
    }
  };
}

/** Attribute a descendant carries to be served by `attachTooltipDelegate`. */
export const TOOLTIP_ATTR = "data-tip";

/**
 * Serve hints for a whole subtree from one listener set on `container`.
 *
 * For containers that rebuild their children wholesale: a row only has to set
 * `data-tip`, so nothing needs attaching when it is recreated and nothing needs
 * disposing when it is thrown away. Per-element `attachTooltip` in such a
 * container leaks a showing tooltip every time the subtree is replaced under a
 * stationary cursor, because the removed node never fires `mouseleave`.
 *
 * Uses the same widget, delay, and positioning as `attachTooltip`; the two
 * coexist on one page and share the single active target.
 */
export function attachTooltipDelegate(container: HTMLElement): () => void {
  const doc = container.ownerDocument;
  if (doc) {
    ensureWidget(doc);
  }
  let described: HTMLElement | null = null;

  const clearDescribed = (): void => {
    if (described?.getAttribute("aria-describedby") === WIDGET_ID) {
      described.removeAttribute("aria-describedby");
    }
    described = null;
  };
  const leave = (): void => {
    clearDescribed();
    hide();
  };
  const hintFor = (node: EventTarget | null): HTMLElement | null => {
    if (!(node instanceof Element)) {
      return null;
    }
    const el = node.closest<HTMLElement>(`[${TOOLTIP_ATTR}]`);
    return el && container.contains(el) ? el : null;
  };
  // `mouseover`/`focusin` rather than `mouseenter`/`focus`: only the bubbling
  // pair reaches a delegate on the container.
  const onOver = (ev: Event): void => {
    const target = hintFor(ev.target);
    if (target === currentTarget) {
      return;
    }
    leave();
    if (!target) {
      return;
    }
    described = target;
    target.setAttribute("aria-describedby", WIDGET_ID);
    scheduleShow(target, () => target.getAttribute(TOOLTIP_ATTR)?.trim() ?? "");
  };
  const onOut = (ev: Event): void => {
    const from = hintFor(ev.target);
    if (from === null || from !== currentTarget) {
      return;
    }
    // Moving onto a child of the same hinted element is not leaving it. Without
    // this the tooltip hides and the re-entry pays the delay again, so an
    // already-visible hint flickers across every composed row.
    if (hintFor((ev as MouseEvent | FocusEvent).relatedTarget) === from) {
      return;
    }
    leave();
  };
  const onDown = (ev: Event): void => {
    if (hintFor(ev.target) !== null) {
      leave();
    }
  };
  const onKey = (ev: Event): void => {
    if ((ev as KeyboardEvent).key === "Escape") {
      leave();
    }
  };
  // A rebuilt subtree removes the hovered row without a `mouseout`, so the
  // widget would stay open over a row that no longer exists.
  const observer = new MutationObserver(() => {
    if (currentTarget !== null && !currentTarget.isConnected) {
      leave();
    }
  });
  observer.observe(container, { childList: true, subtree: true });

  container.addEventListener("mouseover", onOver);
  container.addEventListener("mouseout", onOut);
  container.addEventListener("mousedown", onDown);
  container.addEventListener("focusin", onOver);
  container.addEventListener("focusout", onOut);
  container.addEventListener("keydown", onKey);

  return () => {
    observer.disconnect();
    container.removeEventListener("mouseover", onOver);
    container.removeEventListener("mouseout", onOut);
    container.removeEventListener("mousedown", onDown);
    container.removeEventListener("focusin", onOver);
    container.removeEventListener("focusout", onOut);
    container.removeEventListener("keydown", onKey);
    if (currentTarget !== null && container.contains(currentTarget)) {
      leave();
    } else {
      clearDescribed();
    }
  };
}

/** Visible-for-tests. Hides + detaches the singleton widget. */
export function resetTooltipForTests(): void {
  hide();
  widget?.el.remove();
  widget = null;
}
