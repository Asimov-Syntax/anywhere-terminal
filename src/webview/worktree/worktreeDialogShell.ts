// src/webview/worktree/worktreeDialogShell.ts — The scrim + floating card the
// Worktree view's dialogs share, plus the focus trap and Esc handling.
//
// A sidebar is too narrow for a six-field form, so these float over the whole
// webview like the session preview does. Mirrors the mount/dispose contract of
// src/webview/vault/ContinueDialog.ts rather than inventing a second one.

export interface DialogShell {
  scrim: HTMLElement;
  dialog: HTMLElement;
  /** Row of buttons at the foot of the card. */
  actions: HTMLElement;
  dispose: (restoreFocus?: boolean) => void;
  /** Re-read which controls are focusable — call after enabling/disabling one. */
  refreshFocusTrap: () => void;
  /**
   * Land focus inside the card. Called by the owner once the card is populated —
   * the shell is returned empty, so it cannot do this itself. A modal that opens
   * with focus still outside it is silent to a screen reader.
   */
  focusInitial: (preferred?: HTMLElement) => void;
}

export interface DialogShellOptions {
  label: string;
  /** Clicking the scrim dismisses. Off for a confirmation the user must answer. */
  dismissOnScrim?: boolean;
  /** Widen the card past the reading measure — for a form, not a question. */
  wide?: boolean;

  onDismiss?: () => void;
  /**
   * First refusal on Escape. Return true to say the key was consumed by
   * something inside the card — an open popup, a listbox — and the dialog stays.
   *
   * A hook rather than a listener the owner adds itself: this shell binds
   * Escape on `document` in the CAPTURE phase before the form exists, so no
   * listener the form registers can run first. Two Escape owners racing on
   * registration order is the bug this avoids.
   */
  onEscape?: () => boolean;
}

/**
 * Mount an empty dialog card into `root` and return its parts. The caller fills
 * `dialog` above `actions`; nothing here decides what the dialog does.
 */
export function openDialogShell(root: HTMLElement, opts: DialogShellOptions): DialogShell {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const scrim = document.createElement("div");
  scrim.className = "wt-scrim";

  const dialog = document.createElement("div");
  dialog.className = opts.wide ? "wt-dialog wt-dialog--wide" : "wt-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", opts.label);

  const actions = document.createElement("div");
  actions.className = "wt-dialog-actions";

  const focusable = (): HTMLElement[] =>
    Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'textarea:not([readonly]), input, select, button, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.closest("[hidden]") && !(el instanceof HTMLButtonElement && el.disabled));

  let controls = focusable();
  let disposed = false;

  const dispose = (restoreFocus = true): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    document.removeEventListener("keydown", onKeyDown, true);
    dialog.remove();
    scrim.remove();
    if (restoreFocus && opener?.isConnected) {
      opener.focus();
    }
  };

  function onKeyDown(ev: KeyboardEvent): void {
    if (ev.key === "Escape") {
      // The tree's own Esc handler (and the preview's) must not also fire —
      // whether the card dismissed or something inside it consumed the key.
      ev.stopPropagation();
      if (opts.onEscape?.() === true) {
        return;
      }
      opts.onDismiss?.();
      dispose();
      return;
    }
    if (ev.key !== "Tab") {
      return;
    }
    controls = focusable();
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first || !last) {
      ev.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (ev.shiftKey ? active === first || !dialog.contains(active) : active === last || !dialog.contains(active)) {
      ev.preventDefault();
      (ev.shiftKey ? last : first).focus();
    }
  }

  if (opts.dismissOnScrim) {
    scrim.addEventListener("click", () => {
      opts.onDismiss?.();
      dispose();
    });
  }
  document.addEventListener("keydown", onKeyDown, true);
  root.append(scrim, dialog);

  return {
    scrim,
    dialog,
    actions,
    dispose,
    refreshFocusTrap: () => (controls = focusable()),
    focusInitial: (preferred) => {
      controls = focusable();
      (preferred ?? controls[0])?.focus();
    },
  };
}

/** `<h3>` title, optionally with a lighter subject after it (`Remove spike/hooks?`). */
export function dialogTitle(text: string, subject?: string, onDismiss?: () => void): HTMLElement {
  const title = document.createElement("h3");
  title.className = "wt-dialog-title";
  title.append(document.createTextNode(text));
  if (subject !== undefined) {
    const span = document.createElement("span");
    span.className = "wt-dialog-subject";
    span.textContent = subject;
    title.append(document.createTextNode(" "), span);
  }
  if (onDismiss) {
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "wt-dismiss";
    dismiss.setAttribute("aria-label", "Cancel");
    dismiss.textContent = "✕";
    dismiss.addEventListener("click", onDismiss);
    title.appendChild(dismiss);
  }
  return title;
}

/** A labelled field wrapper; returns the wrapper so the caller appends the control. */
export function field(labelText: string, controlId?: string, optional = false): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "wt-field";
  const label = controlId ? document.createElement("label") : document.createElement("span");
  label.className = "wt-flabel";
  label.append(document.createTextNode(labelText));
  if (label instanceof HTMLLabelElement && controlId) {
    label.htmlFor = controlId;
  }
  if (optional) {
    const opt = document.createElement("span");
    opt.className = "wt-flabel-opt";
    opt.textContent = "(optional)";
    label.append(document.createTextNode(" "), opt);
  }
  wrap.appendChild(label);
  return wrap;
}

export function selectControl(
  id: string,
  options: { value: string; label: string }[],
  selected?: string,
): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "wt-select";
  select.id = id;
  for (const opt of options) {
    const el = document.createElement("option");
    el.value = opt.value;
    el.textContent = opt.label;
    if (selected !== undefined && opt.value === selected) {
      el.selected = true;
    }
    select.appendChild(el);
  }
  return select;
}

export function textButton(
  label: string,
  kind: "plain" | "primary" | "danger",
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = kind === "plain" ? "wt-btn" : `wt-btn wt-btn--${kind}`;
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

/** The `⌘↵` hint the primary create button carries. */
export function keyHint(text: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "wt-kbd";
  el.textContent = text;
  return el;
}
