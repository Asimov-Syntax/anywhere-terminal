// src/webview/fileTree/Tree.ts — Generic Tree<T> wrapped over the vendored
// VS Code listWidget. Drives a flat virtualised List from a pluggable
// ITreeDataSource and ITreeRenderer, with identity-stable per-element cache
// and stale-async dropping.
//
// Scope of THIS file is per task `2_2` of asimov change
// `port-vscode-async-data-tree`. It covers ONLY:
//   - the public read-only API surface (setInput / expand / collapse /
//     refresh / selection / events / dispose)
//   - the identity-keyed (reference-equality) child cache
//   - stale-async dropping: a getChildren() promise whose result arrives
//     AFTER the caller collapsed/refreshed the element is silently dropped
//   - splice-based diff into the underlying listWidget
//
// Task 2_3 additions (ARIA + keyboard navigation):
//   - role="tree" on container, role="treeitem" + aria-level/aria-selected/
//     aria-expanded on each visible row. ARIA stamping happens in the
//     internal renderer wrapper — the user-supplied ITreeRenderer never sees
//     ARIA concerns.
//   - WAI-ARIA Tree keyboard pattern: ArrowUp/Down move selection,
//     ArrowRight expands-or-descends, ArrowLeft collapses-or-ascends,
//     Home/End jump to first/last visible row, Enter fires onDidActivate.
//   - aria-expanded updates SYNCHRONOUSLY on expand/collapse (re-stamped
//     after rebuildRows() commits the splice).
//
// See: asimov/changes/port-vscode-async-data-tree/design.md D3,
//      asimov/changes/port-vscode-async-data-tree/specs/file-tree-widget/spec.md

import type { IListRenderer, IListVirtualDelegate } from "vs/base/browser/ui/list/list";
import { List } from "vs/base/browser/ui/list/listWidget";
import { Emitter, type Event } from "vs/base/common/event";
import type { IDisposable } from "vs/base/common/lifecycle.js";

import type { ITreeDataSource } from "./ITreeDataSource";
import type { ITemplateData, ITreeMatch, ITreeMatchData, ITreeRenderer } from "./ITreeRenderer";

/** Default row height for tree items (matches existing file-tree styling). */
const DEFAULT_ROW_HEIGHT = 22;

/** Re-exported aliases — the canonical types live in `ITreeRenderer.ts`. */
export type IMatch = ITreeMatch;
export type IMatchData = ITreeMatchData;

/**
 * Internal flat row record. The Tree synthesizes one of these per visible
 * element by walking the expanded-node sub-tree depth-first.
 *
 * Consumers never see this type — the wrapper renderer unwraps `element`
 * and `depth` before invoking the user-supplied `ITreeRenderer<T>`.
 */
interface FlatRow<T> {
  readonly element: T;
  readonly depth: number;
  readonly expanded: boolean;
  readonly hasChildren: boolean;
  /**
   * Per-row match metadata from `setFlatItems`'s matchMap. Passed through to
   * the renderer for highlight rendering. Undefined for rows with no
   * associated match data — renderers MUST treat `undefined` as "no highlights".
   */
  readonly matchData?: ITreeMatchData;
}

/**
 * Two FlatRows are "equal" only when EVERY field that drives rendering
 * matches by identity / value. Used by `rebuildRows`' prefix/suffix diff
 * to skip splicing rows whose DOM is already correct.
 */
function flatRowEquals<T>(a: FlatRow<T>, b: FlatRow<T>): boolean {
  return (
    a.element === b.element &&
    a.depth === b.depth &&
    a.expanded === b.expanded &&
    a.hasChildren === b.hasChildren &&
    a.matchData === b.matchData
  );
}

/**
 * Cache entry keyed on REFERENCE identity of each tree element. Replacing
 * the parent (a fresh object) drops the cached children for that key — any
 * concurrent `getChildren` promise still in flight is also abandoned because
 * the `Tree` only commits a resolved value when the in-flight promise
 * reference matches `node.childrenPromise`.
 */
interface NodeState<T> {
  expanded: boolean;
  children?: T[];
  childrenPromise?: Promise<T[]>;
}

/**
 * Internal template wrapper. Carries a reference to the row's DOM container
 * (the `.monaco-list-row` element) so the wrapper renderer can stamp ARIA
 * attributes on the row itself without the user-renderer having to know.
 */
interface InnerTemplate<TTemplate extends ITemplateData> {
  readonly container: HTMLElement;
  readonly user: TTemplate;
}

/** Payload emitted by `onDidChangeExpansion`. */
export interface ITreeExpansionEvent<T> {
  readonly element: T;
  readonly expanded: boolean;
}

/**
 * Construction options for `Tree<T>`.
 */
export interface ITreeOptions {
  /** Row height in pixels. Defaults to 22 (matches existing file-tree row). */
  readonly rowHeight?: number;
  /** Identifier passed to the underlying List widget (used in error messages). */
  readonly identifier?: string;
  /**
   * When true, the root element passed to `setInput` is NOT rendered as a row.
   * Its expanded children become the first visible rows at depth 0. Use for
   * consumers that surface the root in a separate header (e.g. file-tree
   * showing the workspace name above the list). Root expansion state still
   * controls whether children appear — collapsing the root via `collapse()`
   * empties the list.
   */
  readonly hideRoot?: boolean;
}

/**
 * Generic tree wrapped over the vendored VS Code listWidget.
 *
 * Identity model: every element is cached by REFERENCE in `Map<T, ...>`.
 * Two structurally equal objects with different identities are treated as
 * distinct nodes — this matches VS Code's AsyncDataTree contract and lets
 * `refresh()` cheaply invalidate just one branch by allocating a new parent
 * object for that branch.
 */
export class Tree<T extends object, TTemplate extends ITemplateData = ITemplateData> implements IDisposable {
  private readonly list: List<FlatRow<T>>;
  private readonly nodes = new Map<T, NodeState<T>>();
  /** Reverse-edge map: child element -> its parent element. Maintained by
   * `loadChildren` when children resolve. Used by ArrowLeft (move-to-parent). */
  private readonly parents = new Map<T, T>();
  private rows: FlatRow<T>[] = [];
  private root: T | null = null;
  /** Live map of element -> the row's `.monaco-list-row` DOM container, so
   * ARIA attributes can be re-stamped synchronously on expand/collapse. */
  private readonly elementToRowDom = new Map<T, HTMLElement>();
  /**
   * Per-row render context for currently-materialised rows. Populated in
   * `innerRenderer.renderElement`, evicted in `disposeElement`. Used by
   * `rerenderRows()` to re-invoke the user renderer in place — necessary
   * because the vendored `listView.rerender()` is a no-op when
   * `supportDynamicHeights` is false (our setup), so we cannot lean on the
   * built-in re-render path for in-place data mutations like git status
   * deltas. Holds (depth, template, matchData) per visible element. */
  private readonly elementToRenderContext = new Map<
    T,
    { container: HTMLElement; depth: number; template: TTemplate; matchData?: ITreeMatchData }
  >();

  private readonly _onDidChangeSelection = new Emitter<T | null>();
  readonly onDidChangeSelection: Event<T | null> = this._onDidChangeSelection.event;

  private readonly _onDidChangeExpansion = new Emitter<ITreeExpansionEvent<T>>();
  readonly onDidChangeExpansion: Event<ITreeExpansionEvent<T>> = this._onDidChangeExpansion.event;

  private readonly _onDidActivate = new Emitter<T>();
  readonly onDidActivate: Event<T> = this._onDidActivate.event;

  private readonly listDisposables: IDisposable[] = [];
  private disposed = false;
  private readonly hideRoot: boolean;
  /**
   * Flat-list override — when non-null, the underlying List renders these
   * items directly at depth 0 (no tree walk, no filter, no expansion). Used
   * for in-panel search result display. `setFlatItems(null)` restores normal
   * tree rendering. See: add-file-tree-search design D3.
   */
  private _flatItems: T[] | null = null;
  /** Optional matchData map for flat-list items. */
  private _flatMatchData: ReadonlyMap<T, ITreeMatchData> | null = null;
  /**
   * Snapshot of the selected element at the moment flat-list mode was
   * entered. Restored on `setFlatItems(null)` so the tree's pre-search
   * selection survives a round-trip into the search results list and back.
   * `undefined` means no snapshot is held (we're not in flat-list mode).
   */
  private _preFlatSelection: T | null | undefined;

  constructor(
    container: HTMLElement,
    private readonly dataSource: ITreeDataSource<T>,
    readonly renderer: ITreeRenderer<T, TTemplate>,
    options: ITreeOptions = {},
  ) {
    const rowHeight = options.rowHeight ?? DEFAULT_ROW_HEIGHT;
    const identifier = options.identifier ?? "tree";
    this.hideRoot = options.hideRoot ?? false;

    // The List itself sees only FlatRow<T>. We synthesize a delegate +
    // renderer pair that unwraps to T before delegating to the user's
    // ITreeRenderer. The inner template wraps the user's template with a
    // reference to the row container so we can stamp ARIA attrs on it.
    const delegate: IListVirtualDelegate<FlatRow<T>> = {
      getHeight: () => rowHeight,
      getTemplateId: () => renderer.templateId,
    };

    const innerRenderer: IListRenderer<FlatRow<T>, InnerTemplate<TTemplate>> = {
      templateId: renderer.templateId,
      renderTemplate: (c: HTMLElement): InnerTemplate<TTemplate> => {
        // The vendored rowCache passes the `.monaco-list-row` element as `c`.
        // We hold that reference on the template so renderElement can stamp
        // role/aria-* on it before/after delegating to the user renderer.
        const user = renderer.renderTemplate(c);
        return { container: c, user };
      },
      renderElement: (row: FlatRow<T>, _i: number, t: InnerTemplate<TTemplate>) => {
        // ARIA stamping happens BEFORE the user renderer runs so that any
        // attribute the user wants to override (none today) still wins.
        this.stampAriaOnRow(t.container, row);
        // Track row-container so synchronous re-stamping (on expand/collapse,
        // or selection change) can find it without walking the DOM.
        this.elementToRowDom.set(row.element, t.container);
        // Track full render context so `rerenderRows()` can re-invoke the
        // user renderer in place for in-place data mutations (git status
        // deltas mutate the cached FileNode by reference — the listView
        // can't detect that and won't re-render on its own).
        this.elementToRenderContext.set(row.element, {
          container: t.container,
          depth: row.depth,
          template: t.user,
          matchData: row.matchData,
        });
        renderer.renderElement(row.element, row.depth, t.user, row.matchData);
      },
      disposeElement: (element: FlatRow<T>) => {
        // listView calls this when a row scrolls out OR is removed via
        // splice. Evict the render context so stale templates (about to be
        // recycled to another element) don't keep getting re-rendered.
        this.elementToRenderContext.delete(element.element);
      },
      disposeTemplate: (t: InnerTemplate<TTemplate>) => renderer.disposeTemplate(t.user),
    };

    this.list = new List<FlatRow<T>>(identifier, container, delegate, [innerRenderer], {
      // Multi-select is out of scope for the file-tree port. Single-row
      // selection only — keeps the wiring to onDidChangeSelection trivial.
      multipleSelectionSupport: false,
    });

    // Mark the container element as a WAI-ARIA Tree. The vendored List sets
    // role="list" on its inner `view.domNode` (child of `container`); we set
    // role="tree" on the user-supplied container so the host element itself
    // identifies as the tree widget. Set ONCE — never re-stamped.
    container.setAttribute("role", "tree");

    // Forward selection. List emits `IListEvent<FlatRow<T>>` with .elements —
    // map back to T (or null when cleared).
    this.listDisposables.push(
      this.list.onDidChangeSelection((e) => {
        const first = e.elements[0];
        this._onDidChangeSelection.fire(first ? first.element : null);
      }),
    );

    // Forward activation. SINGLE click activates — folders toggle expand,
    // files post `openFile`. Matches the VS Code Explorer's default on macOS
    // (`workbench.list.openMode = singleClick`) and what users expect from a
    // sidebar tree. Enter on keyboard also activates (handled in onKeyDown
    // below). We deliberately do NOT wire `onMouseDblClick` — the browser
    // fires two `click` events before `dblclick`, so double-clicking a
    // folder would toggle it twice (back to the original state).
    this.listDisposables.push(
      this.list.onMouseClick((e) => {
        if (e.element) {
          this._onDidActivate.fire(e.element.element);
        }
      }),
    );

    // When list selection changes, re-stamp aria-selected on the affected
    // rows so screen readers see the updated state. The selection event from
    // listWidget gives us the NEW selected element; we re-stamp all currently
    // rendered rows because we don't track previously-selected separately —
    // O(visible-rows) per selection change, which is fine for v0 row counts.
    this.listDisposables.push(
      this.list.onDidChangeSelection(() => {
        this.refreshAriaSelectedOnAllRows();
      }),
    );

    // Keyboard navigation. The vendored KeyboardController inside listWidget
    // already handles ArrowUp/ArrowDown (sets focus only) and Enter (sets
    // selection). We add the missing tree behaviour on top:
    //   - ArrowUp/Down: also sync selection to the newly-focused row.
    //   - ArrowRight: expand-or-descend.
    //   - ArrowLeft: collapse-or-ascend.
    //   - Home/End: focus + select first/last visible row.
    //   - Enter: fire onDidActivate (KeyboardController has already set
    //     selection to the focused row by the time our handler runs because
    //     it registers first via the constructor sequence).
    //
    // We hook onKeyDown on the underlying list (which dispatches on the
    // view.domNode keydown event). Running AFTER KeyboardController is fine
    // because both handlers are added to the same DomEmitter — the order
    // matches subscription order, and KeyboardController is constructed
    // before us.
    this.listDisposables.push(this.list.onKeyDown((e) => this.onKeyDown(e)));
  }

  // -- ARIA helpers ---------------------------------------------------------

  /**
   * Stamp WAI-ARIA Tree attributes onto the row's `.monaco-list-row`
   * container DOM node. Called from the inner renderer on every
   * renderElement (which the vendored listView invokes for every row
   * materialised or recycled).
   *
   * - `role="treeitem"` (overrides the listView's default `role="listitem"`).
   * - `aria-level` is 1-based per the WAI-ARIA spec — root rows are level 1,
   *   their direct children are level 2, etc.
   * - `aria-selected` reflects the current List selection state.
   * - `aria-expanded` is only set on rows with children. Leaf rows have the
   *   attribute removed entirely (per WAI-ARIA: leaves have no aria-expanded).
   */
  private stampAriaOnRow(rowEl: HTMLElement, row: FlatRow<T>): void {
    rowEl.setAttribute("role", "treeitem");
    rowEl.setAttribute("aria-level", String(row.depth + 1));
    const selected = this.isSelected(row.element);
    rowEl.setAttribute("aria-selected", selected ? "true" : "false");
    if (row.hasChildren) {
      rowEl.setAttribute("aria-expanded", row.expanded ? "true" : "false");
    } else {
      rowEl.removeAttribute("aria-expanded");
    }
  }

  /**
   * Re-stamp `aria-selected` on every currently rendered row. Called after
   * the underlying List fires a selection change event so screen readers see
   * the new state without waiting for the next renderElement.
   */
  private refreshAriaSelectedOnAllRows(): void {
    if (this.disposed) {
      return;
    }
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i];
      const dom = this.elementToRowDom.get(row.element);
      if (!dom) {
        continue;
      }
      // Skip stale entries from recycled DOM (see refreshAriaExpandedOn).
      const idxAttr = dom.getAttribute("data-index");
      if (idxAttr === null || Number(idxAttr) !== i) {
        continue;
      }
      dom.setAttribute("aria-selected", this.isSelected(row.element) ? "true" : "false");
    }
  }

  /**
   * Re-stamp `aria-expanded` on the row for `element` (if it's currently
   * materialised). Called synchronously after expand()/collapse() so tests
   * (and assistive tech) see the updated state before the next animation
   * frame.
   *
   * The vendored List recycles row DOM nodes, so `elementToRowDom` may hold
   * a stale entry whose DOM container is now bound to a different element.
   * Guard by confirming the row's current `data-index` still maps to
   * `element` in our flat row list.
   */
  private refreshAriaExpandedOn(element: T): void {
    if (this.disposed) {
      return;
    }
    const dom = this.elementToRowDom.get(element);
    if (!dom) {
      return;
    }
    const idxAttr = dom.getAttribute("data-index");
    if (idxAttr === null) {
      return;
    }
    const idx = Number(idxAttr);
    if (Number.isNaN(idx) || idx < 0 || idx >= this.rows.length) {
      return;
    }
    if (this.rows[idx].element !== element) {
      return; // stale (recycled to other row)
    }
    const node = this.nodes.get(element);
    if (!node) {
      return;
    }
    const hasChildren = this.dataSource.hasChildren(element);
    if (hasChildren) {
      dom.setAttribute("aria-expanded", node.expanded ? "true" : "false");
    } else {
      dom.removeAttribute("aria-expanded");
    }
  }

  private isSelected(element: T): boolean {
    if (this.disposed) {
      return false;
    }
    const indexes = this.list.getSelection();
    for (const i of indexes) {
      if (i >= 0 && i < this.rows.length && this.rows[i].element === element) {
        return true;
      }
    }
    return false;
  }

  // -- keyboard navigation --------------------------------------------------

  /**
   * Single-source dispatch for the WAI-ARIA Tree pattern keys we own. Some
   * keys (Up/Down/Enter) are partially handled by the vendored
   * KeyboardController; we extend or complete them. Other keys (Left, Right,
   * Home, End) are owned entirely here.
   */
  private onKeyDown(e: KeyboardEvent): void {
    if (this.disposed) {
      return;
    }
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        // KeyboardController already moved focus and called preventDefault.
        // We additionally sync selection so getSelection() / aria-selected
        // track the focused row — single-select tree pattern.
        const idx = this.getFocusedIndex();
        if (idx >= 0) {
          this.list.setSelection([idx]);
        }
        return;
      }
      case "ArrowRight": {
        e.preventDefault();
        e.stopPropagation();
        const idx = this.getSelectionOrFocusIndex();
        if (idx < 0) {
          return;
        }
        const row = this.rows[idx];
        if (!row.hasChildren) {
          // Leaf — no-op per WAI-ARIA Tree pattern.
          return;
        }
        if (!row.expanded) {
          // Expand in place. expand() re-stamps aria-expanded synchronously.
          this.expand(row.element);
        } else {
          // Already expanded — move selection to first child if any.
          const firstChildIdx = idx + 1;
          if (firstChildIdx < this.rows.length && this.rows[firstChildIdx].depth === row.depth + 1) {
            this.list.setFocus([firstChildIdx]);
            this.list.setSelection([firstChildIdx]);
          }
        }
        return;
      }
      case "ArrowLeft": {
        e.preventDefault();
        e.stopPropagation();
        const idx = this.getSelectionOrFocusIndex();
        if (idx < 0) {
          return;
        }
        const row = this.rows[idx];
        if (row.expanded && row.hasChildren) {
          // Collapse in place.
          this.collapse(row.element);
        } else {
          // Move selection up to the parent (if any).
          const parent = this.parents.get(row.element);
          if (parent) {
            const parentIdx = this.indexOf(parent);
            if (parentIdx >= 0) {
              this.list.setFocus([parentIdx]);
              this.list.setSelection([parentIdx]);
            }
          }
        }
        return;
      }
      case "Home": {
        e.preventDefault();
        e.stopPropagation();
        if (this.rows.length === 0) {
          return;
        }
        this.list.setFocus([0]);
        this.list.setSelection([0]);
        return;
      }
      case "End": {
        e.preventDefault();
        e.stopPropagation();
        if (this.rows.length === 0) {
          return;
        }
        const last = this.rows.length - 1;
        this.list.setFocus([last]);
        this.list.setSelection([last]);
        return;
      }
      case "Enter": {
        // KeyboardController has already set selection to the focused row by
        // the time this fires. Fire onDidActivate on the selected element.
        const idx = this.getSelectionOrFocusIndex();
        if (idx >= 0 && idx < this.rows.length) {
          this._onDidActivate.fire(this.rows[idx].element);
        }
        return;
      }
    }
  }

  private getFocusedIndex(): number {
    const f = this.list.getFocus();
    return f.length > 0 ? f[0] : -1;
  }

  private getSelectionOrFocusIndex(): number {
    const focused = this.getFocusedIndex();
    if (focused >= 0) {
      return focused;
    }
    const selected = this.list.getSelection();
    return selected.length > 0 ? selected[0] : -1;
  }

  // -- public API -----------------------------------------------------------

  /**
   * Replace the tree's root element. Drops the entire cache and the in-flight
   * children promise (if any) for the previous root — stale resolutions are
   * dropped via the promise-reference check in `loadChildren`.
   */
  setInput(root: T): void {
    this.assertNotDisposed();
    this.root = root;
    this.nodes.clear();
    this.parents.clear();
    this.elementToRowDom.clear();
    this.elementToRenderContext.clear();
    // The root is always considered "expanded" in our flat-row model — its
    // children form the top of the visible list — but we still call it out
    // explicitly so the cache entry is present for refresh() lookups.
    this.nodes.set(root, { expanded: true });
    // Kick off the children load (if hasChildren) and render placeholder
    // (just the root row alone) until they arrive.
    this.rebuildRows();
    void this.loadChildren(root);
  }

  /**
   * Expand `element`. Triggers a single `getChildren` call (cached by
   * reference). If children are already cached the row list is rebuilt
   * synchronously; otherwise it rebuilds again when the promise resolves
   * (assuming the same promise reference is still current).
   */
  expand(element: T): void {
    this.assertNotDisposed();
    const node = this.nodes.get(element);
    if (!node) {
      // Element not currently in the tree — silently ignore. Matches VS Code
      // AsyncDataTree behaviour where `expand` on an unknown node is a no-op.
      return;
    }
    if (node.expanded) {
      return;
    }
    node.expanded = true;
    void this.loadChildren(element);
    this.rebuildRows();
    // Re-stamp aria-expanded on the expanded row SYNCHRONOUSLY — the spec
    // requires this be observable in unit tests without waiting for any
    // future render tick. rebuildRows() already triggered an internal
    // renderElement for the row, but we re-stamp defensively in case the
    // List skipped re-rendering an unchanged row.
    this.refreshAriaExpandedOn(element);
    this._onDidChangeExpansion.fire({ element, expanded: true });
  }

  /**
   * Collapse `element`. Drops any in-flight children promise reference so a
   * later resolution is treated as stale and discarded.
   */
  collapse(element: T): void {
    this.assertNotDisposed();
    const node = this.nodes.get(element);
    if (!node?.expanded) {
      return;
    }
    node.expanded = false;
    // Drop the in-flight promise reference — any pending resolution becomes
    // stale and the resolved value is dropped in loadChildren's then-handler.
    node.childrenPromise = undefined;
    this.rebuildRows();
    // Re-stamp aria-expanded SYNCHRONOUSLY — see expand() for rationale.
    this.refreshAriaExpandedOn(element);
    this._onDidChangeExpansion.fire({ element, expanded: false });
  }

  /**
   * Force a re-fetch of `element`'s children (or the root if omitted). The
   * previous cached children are discarded immediately; any in-flight promise
   * for that element is abandoned (stale-async drop).
   */
  /**
   * Re-run `renderElement` for every currently-materialised row WITHOUT
   * re-fetching children. Use this after mutating row data in place (e.g.
   * a git status update on a cached `FileNode`) so the visible DOM reflects
   * the new state. Far cheaper than `refresh()` — no read-directory RPC,
   * no `getChildren` call, just one pass through the recycled row pool.
   *
   * Why not `list.rerender()`: the vendored listView's public `rerender()`
   * only executes its body when `supportDynamicHeights` is enabled (it
   * exists to re-probe row heights, not to re-run the renderer). Our tree
   * uses fixed heights, so calling it is a silent no-op. We iterate the
   * tracked render context map instead — it holds (template, depth,
   * matchData) per currently visible row, captured during the listView's
   * own renderElement invocations.
   */
  rerenderRows(): void {
    this.assertNotDisposed();
    for (const [element, ctx] of this.elementToRenderContext) {
      this.renderer.renderElement(element, ctx.depth, ctx.template, ctx.matchData);
    }
  }

  refresh(element?: T): void {
    this.assertNotDisposed();
    const target = element ?? this.root;
    if (!target) {
      return;
    }
    const node = this.nodes.get(target);
    if (!node) {
      return;
    }
    node.children = undefined;
    // Clearing childrenPromise here is what makes the previous promise
    // stale — when it resolves, loadChildren's identity check `node.childrenPromise === p`
    // is false and the result is dropped.
    node.childrenPromise = undefined;
    // Deliberately DO NOT rebuild rows here. Doing so would render an
    // intermediate "children-cleared" frame (the refreshed subtree would
    // briefly vanish from the DOM) before `loadChildren` resolves and a
    // second rebuildRows fills them back in. That two-step splice is the
    // visible blink users see on every fs-watcher-driven refresh. Keep the
    // existing rows in place; the diff-splice inside `rebuildRows` (called
    // from `loadChildren`) will patch only what actually changed.
    void this.loadChildren(target);
  }

  /**
   * Whether `element` is currently expanded in this tree. Reads the
   * internal node-cache state — the source of truth that `expand()` and
   * `collapse()` mutate. Callers that previously mirrored expansion in
   * their own Set (e.g. for persistence) should query this instead so the
   * two stores stay aligned even when persisted paths haven't been
   * re-applied to the live tree yet.
   *
   * Returns `false` for unknown elements (not yet loaded into the tree).
   */
  isExpanded(element: T): boolean {
    if (this.disposed) {
      return false;
    }
    return this.nodes.get(element)?.expanded === true;
  }

  /**
   * Return `element`'s children, loading them from the data source if they
   * haven't been fetched yet. Used by reveal-by-path logic that needs to
   * walk down through ancestors and look up each segment by name. Unlike
   * `expand()` which only kicks off loading in the background, this
   * resolves once children are actually available.
   *
   * Resolves to an empty array if `element` is unknown to the tree or has
   * no children.
   */
  async getOrLoadChildren(element: T): Promise<readonly T[]> {
    if (this.disposed) {
      return [];
    }
    const node = this.nodes.get(element);
    if (!node) {
      return [];
    }
    if (node.children) {
      return node.children;
    }
    await this.loadChildren(element);
    return this.nodes.get(element)?.children ?? [];
  }

  /**
   * Scroll `element` into view in the underlying list widget. No-op when the
   * element isn't currently visible (its ancestors are collapsed). Caller
   * is responsible for expanding ancestors first — see `revealPath` flows
   * in `FileTreePanel`.
   *
   * `relativeTop` (0-1): fractional position to anchor the row at in the
   * viewport. `0` = top edge, `0.5` = center, `1` = bottom. When omitted, the
   * underlying list widget uses a minimum-scroll algorithm that lands the row
   * at whichever edge is closer — which can land the row hugging the viewport
   * edge. Pass `0.5` for auto-reveal flows to match VS Code's explorer.
   */
  revealElement(element: T, relativeTop?: number): void {
    if (this.disposed) {
      return;
    }
    // Walk the current flat row list to find `element`'s index. The flat
    // representation is materialised in `rebuildRows` on every change, so
    // walking it here is O(visible-rows). Acceptable for reveal frequency.
    const length = this.list.length;
    for (let i = 0; i < length; i++) {
      const row = this.list.element(i);
      if (row.element === element) {
        // If the row is ALREADY in the viewport, do not scroll. Centering or
        // re-anchoring a visible row on every auto-reveal yanks the viewport
        // around as the user clicks through files in VS Code Explorer — very
        // disorienting. The visible-range check uses the listWidget's
        // strict `firstVisibleIndex` / `lastVisibleIndex` so a row that's
        // only partially in view (clipped at the edge) is still considered
        // off-screen and gets scrolled in.
        if (i >= this.list.firstVisibleIndex && i <= this.list.lastVisibleIndex) {
          return;
        }
        this.list.reveal(i, relativeTop);
        return;
      }
    }
  }

  /** Return the first selected element, or `null` if nothing is selected. */
  getSelection(): T | null {
    if (this.disposed) {
      return null;
    }
    const indexes = this.list.getSelection();
    if (indexes.length === 0) {
      return null;
    }
    const row = this.list.element(indexes[0]);
    return row.element;
  }

  /**
   * Programmatically select `element`. If `element` isn't currently visible
   * (its parent isn't expanded), this is a no-op — callers should expand
   * ancestors first. Matches VS Code's List.setSelection contract which
   * operates on visible-row indices.
   */
  setSelection(element: T): void {
    this.assertNotDisposed();
    const index = this.indexOf(element);
    if (index >= 0) {
      this.list.setSelection([index]);
      // WAI-ARIA Tree pattern: in a single-select tree, focus and selection
      // are coupled — pressing ArrowDown from the selected row should move
      // to the row BELOW it, not jump back to index 0. The vendored
      // KeyboardController.onDownArrow uses getFocus() as the cursor, so we
      // must keep focus in sync with our selection.
      this.list.setFocus([index]);
    }
  }

  /**
   * Render `items` as a flat list at depth 0, bypassing the tree walk.
   * Each item gets `matchMap?.get(item)` as its renderer `matchData`
   * arg. Use for search-result display.
   *
   * Pass `null` to restore normal tree rendering — the previous selection +
   * expansion set (held internally) are preserved because `setFlatItems` does
   * NOT mutate the data source or the node cache, only the row presentation.
   *
   * Selection is cleared when entering and exiting flat-list mode; callers
   * that need to restore selection MUST do so via `setSelection` after.
   *
   * See: asimov/changes/add-file-tree-search/specs/file-tree-widget/spec.md
   */
  setFlatItems(items: T[] | null, matchMap?: ReadonlyMap<T, ITreeMatchData>): void {
    if (this.disposed) {
      return;
    }
    const enteringFlat = items !== null && this._flatItems === null;
    const exitingFlat = items === null && this._flatItems !== null;

    if (enteringFlat) {
      // Snapshot the pre-flat selection so `setFlatItems(null)` can restore
      // it after the tree rebuild. The element reference survives because
      // flat-list mode does NOT mutate the node cache.
      this._preFlatSelection = this.getSelection();
    }

    this._flatItems = items;
    this._flatMatchData = items ? (matchMap ?? null) : null;
    // Selection / focus are cleared because the underlying List's row
    // indices change; we re-apply selection AFTER the rebuild below for the
    // exitingFlat case.
    this.list.setSelection([]);
    this.list.setFocus([]);
    this.rebuildRows();

    if (exitingFlat) {
      const sel = this._preFlatSelection;
      this._preFlatSelection = undefined;
      if (sel) {
        const index = this.indexOf(sel);
        if (index >= 0) {
          this.list.setSelection([index]);
          this.list.setFocus([index]);
        }
      }
    }
  }

  /**
   * Re-layout the underlying list. Wraps `List.layout(height, width)` so
   * callers don't need to reach through the public surface. In JSDOM the
   * container's bounding rect is 0x0 at construction time — tests MUST call
   * `layout()` explicitly to give the virtualiser a non-zero render height,
   * otherwise no rows will be materialised in the DOM.
   */
  layout(height?: number, width?: number): void {
    if (this.disposed) {
      return;
    }
    this.list.layout(height, width);
  }

  /** Focus the underlying list's DOM container (keyboard focus). */
  domFocus(): void {
    if (this.disposed) {
      return;
    }
    this.list.domFocus();
  }

  /**
   * Move the row focus down by one. Used by search-mode keyboard navigation
   * where the input element keeps DOM focus and arrow keys drive the list
   * focus index via this method. Also scrolls the focused row into view.
   * See: asimov/changes/add-file-tree-search/design.md D8.
   */
  focusNext(): void {
    if (this.disposed || this.rows.length === 0) {
      return;
    }
    this.list.focusNext();
    const focused = this.list.getFocus();
    if (focused.length > 0) {
      this.list.reveal(focused[0]);
    }
  }

  /** Move the row focus up by one. Counterpart to `focusNext`. */
  focusPrevious(): void {
    if (this.disposed || this.rows.length === 0) {
      return;
    }
    this.list.focusPrevious();
    const focused = this.list.getFocus();
    if (focused.length > 0) {
      this.list.reveal(focused[0]);
    }
  }

  /**
   * Return the currently-focused element, or `null` when nothing has row
   * focus. Distinct from `getSelection()` — the search input keeps DOM
   * focus while the user navigates results via arrow keys, so we use this
   * to read the row the user wants to open with Enter.
   */
  getFocused(): T | null {
    if (this.disposed) {
      return null;
    }
    const indexes = this.list.getFocus();
    if (indexes.length === 0) {
      return null;
    }
    const idx = indexes[0];
    if (idx < 0 || idx >= this.rows.length) {
      return null;
    }
    return this.rows[idx].element;
  }

  /** Tear down the widget and clear emitters. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const d of this.listDisposables) {
      d.dispose();
    }
    this.listDisposables.length = 0;
    this.list.dispose();
    this._onDidChangeSelection.dispose();
    this._onDidChangeExpansion.dispose();
    this._onDidActivate.dispose();
    this.nodes.clear();
    this.parents.clear();
    this.elementToRowDom.clear();
    this.elementToRenderContext.clear();
    this.rows = [];
    this.root = null;
  }

  // -- internals ------------------------------------------------------------

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("Tree<T> has been disposed");
    }
  }

  /**
   * Fire off (or reuse) the dataSource.getChildren promise for `element` and
   * rebuild the row list when it resolves IF the same promise is still
   * current.
   *
   * "Still current" means `node.childrenPromise === p` at resolution time —
   * collapse/refresh/setInput all clear `childrenPromise` so they invalidate
   * any pending load. This is the stale-async drop guarantee from the
   * specs/file-tree-widget/spec.md#requirement-pluggable-data-source
   * stale-async scenario.
   */
  private loadChildren(element: T): Promise<void> {
    const node = this.nodes.get(element);
    if (!node) {
      return Promise.resolve();
    }
    // Already loaded synchronously — nothing to do.
    if (node.children) {
      return Promise.resolve();
    }
    // Already loading — piggy-back on the in-flight promise.
    if (node.childrenPromise) {
      return node.childrenPromise.then(() => undefined).catch(() => undefined);
    }
    if (!this.dataSource.hasChildren(element)) {
      // No children to load — treat as empty.
      node.children = [];
      return Promise.resolve();
    }
    const p = this.dataSource.getChildren(element);
    node.childrenPromise = p;
    return p.then(
      (children) => {
        // STALE-ASYNC DROP: if the promise reference no longer matches what's
        // stored on the node, the caller collapsed/refreshed mid-flight. The
        // resolved value MUST be discarded — both from the cache and from
        // any row recomputation. Compare by reference, not by element.
        const current = this.nodes.get(element);
        if (!current || current.childrenPromise !== p) {
          return;
        }
        current.children = children;
        current.childrenPromise = undefined;
        // Register cache entries for the new children (collapsed by default)
        // and record the reverse-edge for ArrowLeft (move-to-parent).
        for (const child of children) {
          if (!this.nodes.has(child)) {
            this.nodes.set(child, { expanded: false });
          }
          this.parents.set(child, element);
        }
        this.rebuildRows();
      },
      () => {
        // On rejection, drop the in-flight reference but leave any cached
        // value (likely undefined) intact. We do NOT surface errors via the
        // public event surface for this task — error handling is a v2
        // concern (see design.md Risk Map).
        const current = this.nodes.get(element);
        if (current && current.childrenPromise === p) {
          current.childrenPromise = undefined;
        }
      },
    );
  }

  /**
   * Recompute the flat row list from the current root + expansion + cache
   * state and splice it into the underlying List.
   *
   * Uses a common-prefix + common-suffix diff (O(N), identity-keyed) so a
   * single create/delete from the fs watcher only re-splices the affected
   * row range instead of wholesale-replacing every DOM row — which would
   * cause a visible blink, scroll-jump, and selection loss. Rows whose
   * FlatRow shape (element identity + depth + expanded + hasChildren +
   * matchData) is unchanged keep their existing DOM untouched.
   *
   * For pathological inputs (interleaved changes across many indices) the
   * algorithm falls back to splicing the full middle range — equivalent to
   * the prior wholesale splice. LCS could shave that further but isn't
   * needed for typical file-tree workloads (hundreds, not thousands, of
   * visible rows; common edit is 1 added or 1 removed).
   */
  private rebuildRows(): void {
    if (this.disposed) {
      return;
    }
    const rows: FlatRow<T>[] = [];
    if (this._flatItems) {
      // Flat-list mode: bypass tree walk entirely. Emit one row per item at
      // depth 0, attach matchData from the map (if any). Filter is NOT
      // applied in this mode — callers are expected to have pre-filtered
      // their input list. `hasChildren` is always false here.
      for (const item of this._flatItems) {
        const matchData = this._flatMatchData?.get(item);
        rows.push({ element: item, depth: 0, expanded: false, hasChildren: false, matchData });
      }
    } else if (this.root) {
      if (this.hideRoot) {
        // Root is surfaced elsewhere (e.g. in the consumer's header). Skip
        // the root row itself and emit its expanded children at depth 0.
        // When the root is collapsed, the list is empty.
        const rootNode = this.nodes.get(this.root);
        if (rootNode?.expanded && rootNode.children) {
          for (const child of rootNode.children) {
            this.appendRows(child, 0, rows);
          }
        }
      } else {
        this.appendRows(this.root, 0, rows);
      }
    }
    const oldRows = this.rows;
    this.rows = rows;

    // Common-prefix + common-suffix diff. Equality requires the FULL FlatRow
    // shape to match — otherwise a row whose expanded/hasChildren toggled
    // (e.g. directory expanded) would slip through unchanged and render
    // stale chevron/aria state.
    const oldLen = oldRows.length;
    const newLen = rows.length;
    const commonMax = Math.min(oldLen, newLen);
    let start = 0;
    while (start < commonMax && flatRowEquals(oldRows[start], rows[start])) {
      start++;
    }
    let oldEnd = oldLen;
    let newEnd = newLen;
    while (oldEnd > start && newEnd > start && flatRowEquals(oldRows[oldEnd - 1], rows[newEnd - 1])) {
      oldEnd--;
      newEnd--;
    }
    if (oldEnd === start && newEnd === start) {
      // Nothing changed; skip the splice entirely so the listWidget never
      // even fires a buffered event. This is the steady-state path for
      // refresh() calls where the listing came back identical.
      return;
    }
    this.list.splice(start, oldEnd - start, rows.slice(start, newEnd));
  }

  /**
   * Depth-first walk emitting `FlatRow`s for the visible sub-tree rooted at
   * `element`. The root itself IS included — task 3_3 (the file-tree-only
   * scope) can hide it via a renderer-level check if needed; the generic
   * Tree<T> shows everything below `setInput`'s element.
   *
   * When `_filter` is installed, elements where `shouldRender` returns false
   * are excluded — but their descendants ARE still walked (rebuildRows can
   * filter at the leaf level even when an ancestor doesn't render). Match
   * data, if the filter provides it, is attached to each emitted FlatRow.
   */
  private appendRows(element: T, depth: number, out: FlatRow<T>[]): void {
    const node = this.nodes.get(element);
    if (!node) {
      return;
    }
    const hasChildren = this.dataSource.hasChildren(element);
    out.push({ element, depth, expanded: node.expanded, hasChildren });
    if (!node.expanded || !node.children) {
      return;
    }
    for (const child of node.children) {
      this.appendRows(child, depth + 1, out);
    }
  }

  private indexOf(element: T): number {
    // Linear scan — fine for the v0 file-tree row counts. If we ever need
    // O(1), swap to a parallel Map<T, number> kept in sync with rebuildRows.
    for (let i = 0; i < this.rows.length; i++) {
      if (this.rows[i].element === element) {
        return i;
      }
    }
    return -1;
  }
}
