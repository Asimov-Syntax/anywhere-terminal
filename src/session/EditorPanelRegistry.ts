// src/session/EditorPanelRegistry.ts — Live editor-panel registry.
//
// Tracks which editor WebviewPanels exist so the hydrate-on-activate flow can
// match restored session buffers back to their owning panel by `panelId`.
// Persisted via workspaceState alongside the snapshot index.
//
// See: restore-terminal-sessions design.md D10.

import type { LiveEditorPanelEntry, LiveEditorPanelsRecord } from "./SessionSnapshot";

export class EditorPanelRegistry {
  private panels: Map<string, LiveEditorPanelEntry> = new Map();

  /**
   * `onChange` fires whenever a panel is added/removed/mutated. The owner
   * (SessionManager) wires this to `SessionStorage.scheduleLivePanelsWrite`
   * when `restoreEnabled === true`; tests can leave it undefined.
   */
  constructor(private readonly onChange?: (record: LiveEditorPanelsRecord) => void) {}

  /** Record a new panel. Idempotent — second call with the same panelId is a no-op. */
  register(panelId: string): void {
    if (this.panels.has(panelId)) {
      return;
    }
    const now = Date.now();
    this.panels.set(panelId, { panelId, sessionIds: [], createdAt: now, updatedAt: now });
    this.notify();
  }

  /** Attach a session to a panel. Idempotent. Silent no-op for unknown panelIds. */
  attachSession(panelId: string, sessionId: string): void {
    const entry = this.panels.get(panelId);
    if (!entry) {
      return;
    }
    if (entry.sessionIds.includes(sessionId)) {
      return;
    }
    entry.sessionIds.push(sessionId);
    entry.updatedAt = Date.now();
    this.notify();
  }

  /** Remove a panel from the registry. Called after a grace-period destroy actually fires. */
  unregister(panelId: string): void {
    if (!this.panels.delete(panelId)) {
      return;
    }
    this.notify();
  }

  /** Hydrate from the persisted record (post-restart). */
  hydrate(record?: LiveEditorPanelsRecord): void {
    this.panels.clear();
    if (record?.version !== 1 || !Array.isArray(record.panels)) {
      return;
    }
    for (const entry of record.panels) {
      if (!entry || typeof entry.panelId !== "string") {
        continue;
      }
      this.panels.set(entry.panelId, {
        panelId: entry.panelId,
        sessionIds: Array.isArray(entry.sessionIds) ? entry.sessionIds.slice() : [],
        createdAt: typeof entry.createdAt === "number" ? entry.createdAt : Date.now(),
        updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : Date.now(),
      });
    }
  }

  /** Build a `LiveEditorPanelsRecord` for persistence. */
  toRecord(): LiveEditorPanelsRecord {
    return { version: 1, panels: Array.from(this.panels.values()) };
  }

  /** Look up the panelId that owns a given sessionId, or undefined. */
  findPanelForSession(sessionId: string): string | undefined {
    for (const entry of this.panels.values()) {
      if (entry.sessionIds.includes(sessionId)) {
        return entry.panelId;
      }
    }
    return undefined;
  }

  /** Clear all panels in memory (used when restore is toggled off and on purge). */
  clear(): void {
    this.panels.clear();
  }

  private notify(): void {
    this.onChange?.(this.toRecord());
  }
}
