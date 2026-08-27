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

/** One character at a time, matching the `\s+` class the signature collapses. */
const SINGLE_WHITESPACE = /\s/;

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

/**
 * The first `max` characters of `title`'s signature, produced in one pass that
 * stops emitting once the cap is reached.
 *
 * Equal to `titleSignature(title).slice(0, max)` — that equivalence is the
 * point, because the pane-evidence contract defines the reported title as the
 * signature of the pane's title, with the cap a limit on the value and not a
 * redefinition of it. Bounding the RAW string first is cheaper still and gives
 * a different answer: a spinner run longer than the cap would report nothing
 * where the signature reports the text behind it (.reviews/round-2.md B3).
 *
 * What this bounds is allocation: `titleSignature` builds two full-size
 * intermediates, and xterm accepts OSC payloads up to 10 MB. Nothing larger
 * than `max` is ever held, and an ordinary title stops the loop at `max`
 * characters. A title that emits few signature characters is still read to the
 * end — the value is specified against the whole title.
 *
 * Deliberately does NOT also report decoration, though it passes every
 * character needed to. `hasDecorativeFrame` is a native regex running at
 * memory bandwidth; folding it in here would replace it with interpreted work
 * over the same range and lose this loop's early exit. Measured over 20 events
 * on an 8 MB undecorated title: 1.6 ms split, 326 ms fused (.reviews/round-3.md W2).
 */
export function boundedTitleSignature(title: string, max: number): string {
  const out: string[] = [];
  let pendingSpace = false;
  for (let i = 0; i < title.length && out.length < max; i++) {
    const code = title.charCodeAt(i);
    if ((code >= 0x2800 && code <= 0x28ff) || (code >= 0x25d0 && code <= 0x25d3)) {
      continue;
    }
    const ch = title[i];
    if (SINGLE_WHITESPACE.test(ch)) {
      // Never leading, never trailing: a run is only ever emitted once a
      // following non-space arrives, which is what `trim()` does downstream.
      pendingSpace = out.length > 0;
      continue;
    }
    if (pendingSpace) {
      out.push(" ");
      pendingSpace = false;
      if (out.length === max) {
        break;
      }
    }
    out.push(ch);
  }
  return out.join("");
}

/**
 * Whether a raw title carries a decorative frame.
 *
 * Exported for the host evidence report, which sends the SIGNATURE and so
 * destroys this bit on the way out: a spinner proves something is running, and
 * the host cannot recover that from a stripped string. Derived from the same
 * source as the signature, so a glyph family added to one is added to both.
 *
 * See: asimov/changes/add-host-pane-evidence/design.md D7.
 */
export function hasDecorativeFrame(title: string): boolean {
  return HAS_DECORATIVE_FRAME.test(title);
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
 *
 * An empty title is a title, not a non-event. A program that clears its OSC
 * title has stopped claiming to be anything, and leaving the last one on the
 * tab is the same frozen-signal bug the decoration bit above exists to prevent.
 * `buildTabBarData` supplies the visible fallback, so nothing renders blank.
 * See .reviews/round-2.md B2.
 */
export function applyTitleChange(instance: TitleTrackedInstance, newTitle: string, requestRender: () => void): void {
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
