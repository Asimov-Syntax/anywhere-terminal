// src/webview/terminal/titleSignature.ts — Decorative-frame-insensitive title
// comparison for the tab bar.
//
// Agent TUIs rewrite the OSC title once per spinner frame, so `⠋ Fix tests` and
// `⠙ Fix tests` arrive as two distinct titles describing one unchanged state.
// Re-rendering the whole tab bar on each is pure churn (`renderTabBar` rebuilds
// a Map, runs `querySelectorAll`, and writes `className` / `dataset.status`
// unconditionally — see TabBarUtils.ts).
//
// See: asimov/changes/fix-false-agent-signals/design.md D4;
//      docs/research/20260822-orca-deep-dive/06-completion-notifications.md §4.

/**
 * Braille (`U+2800`–`U+28FF`) covers the common spinner families; the
 * quarter circles (`U+25D0`–`U+25D3`) are Claude 2.1's frame set.
 */
const DECORATIVE_FRAME_GLYPHS = /[⠀-⣿◐-◓]/g;

/**
 * Same class, non-global (`.test()` on a `/g` regex advances `lastIndex`).
 * Derived from the source above so the two can't drift: a glyph stripped from
 * the signature but missing here would silently re-open the frozen-spinner gap.
 */
const HAS_DECORATIVE_FRAME = new RegExp(DECORATIVE_FRAME_GLYPHS.source);

/**
 * Titles longer than this skip the gate and always render. xterm accepts OSC
 * payloads up to 10 MB, and any program can emit one; scanning it twice per
 * frame to save a render is a bad trade.
 */
const MAX_GATED_TITLE_CHARS = 1024;

/**
 * Frame-insensitive identity of a terminal title: decorative glyphs removed,
 * whitespace runs collapsed, trimmed.
 *
 * Collapsing is not cosmetic — stripping a leading `⠋ ` leaves the string
 * starting with a space, so without it the decorated and undecorated forms of
 * the same title would compare as different.
 */
export function titleSignature(title: string): string {
  return title.replace(DECORATIVE_FRAME_GLYPHS, "").replace(/\s+/g, " ").trim();
}

/** The subset of `TerminalInstance` this module reads and writes. */
export interface TitleTrackedInstance {
  name: string;
  lastTitleSignature?: string;
  lastTitleDecorated?: boolean;
}

/**
 * Apply an xterm `onTitleChange` payload to an instance, requesting a tab-bar
 * render only when the title changed by more than a decorative frame.
 *
 * `name` is always assigned the RAW title, never the signature: the tab must
 * show the newest text the moment any other change forces a render, and
 * `buildTabBarData` / custom-name resolution must never see a stripped string.
 */
export function applyTitleChange(instance: TitleTrackedInstance, newTitle: string, requestRender: () => void): void {
  if (!newTitle) {
    return;
  }
  instance.name = newTitle;
  if (newTitle.length > MAX_GATED_TITLE_CHARS) {
    instance.lastTitleSignature = undefined;
    instance.lastTitleDecorated = undefined;
    requestRender();
    return;
  }
  const signature = titleSignature(newTitle);
  // Decoration presence is part of the compared state, not just stripped from
  // it: the label is rendered from the RAW name, so `⠋ Fix tests` → `Fix tests`
  // changes what the tab shows even though the signature is identical. Without
  // this bit a finished agent leaves a frozen spinner on its tab — the exact
  // false signal this gate exists to remove. See .reviews/round-1.md [W1].
  const decorated = HAS_DECORATIVE_FRAME.test(newTitle);
  if (instance.lastTitleSignature === signature && instance.lastTitleDecorated === decorated) {
    return;
  }
  instance.lastTitleSignature = signature;
  instance.lastTitleDecorated = decorated;
  requestRender();
}
