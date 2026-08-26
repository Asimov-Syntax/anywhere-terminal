// src/session/OutputBuffer.ts — Output buffering + flow control for PTY → WebView
// See: docs/design/output-buffering.md, specs/output-buffer/spec.md

// ─── Interfaces ─────────────────────────────────────────────────────

/** Minimal interface for PTY flow control (pause/resume). */
export interface FlowControllable {
  pause(): void;
  resume(): void;
}

/** Minimal interface for sending messages to the webview. */
export interface MessageSender {
  postMessage(message: unknown): Thenable<boolean>;
}

/** Notified when a flush delivers output to the webview. `at` is epoch ms. */
export type OnFlush = (tabId: string, at: number) => void;

// ─── Constants ──────────────────────────────────────────────────────

/** Minimum adaptive flush interval (high-frequency, low-throughput). */
const MIN_FLUSH_INTERVAL_MS = 4;

/** Maximum adaptive flush interval (batching, high-throughput). */
const MAX_FLUSH_INTERVAL_MS = 16;

/** Default flush interval in milliseconds. Compromise between VS Code (5ms) and reference (16ms). */
const DEFAULT_FLUSH_INTERVAL_MS = 8;

/** Number of recent flush sizes to track for throughput estimation. */
const THROUGHPUT_WINDOW_SIZE = 5;

/** Average flush size (chars) above which interval increases to MAX. */
const HIGH_THROUGHPUT_THRESHOLD = 32_768;

/** Average flush size (chars) below which interval decreases to MIN. */
const LOW_THROUGHPUT_THRESHOLD = 1_024;

/** Hard cap on total buffered characters (1MB). FIFO eviction when exceeded. */
const MAX_TOTAL_BUFFER_CHARS = 1_048_576;

/** Maximum buffer size in characters (string .length). Triggers immediate flush. */
const MAX_BUFFER_SIZE = 65_536;

/** Maximum number of chunks in the buffer array. Safety cap. */
const MAX_CHUNKS = 100;

/** Pause PTY when this many chars are unacknowledged by the webview. */
const HIGH_WATERMARK_CHARS = 100_000;

/** Resume PTY when unacked drops below this. */
const LOW_WATERMARK_CHARS = 5_000;

// ─── OutputBuffer ───────────────────────────────────────────────────

/**
 * Coalesces rapid PTY output into fewer, larger postMessage calls
 * and implements watermark-based flow control.
 *
 * Lifecycle: created per PTY session, disposed when session ends.
 *
 * See: docs/design/output-buffering.md
 */
export class OutputBuffer {
  /** Buffer of PTY output chunks, joined on flush. */
  private _chunks: string[] = [];
  /** Total character count of all chunks in buffer. */
  private _bufferSize = 0;

  /** Characters sent to webview but not yet acknowledged. */
  private _unackedCharCount = 0;
  /** Whether the PTY is currently paused due to backpressure. */
  private _isPaused = false;

  /** Whether output flushing is paused (view hidden). */
  private _isOutputPaused = false;

  /** One-shot flush timer. Started on first append, cleared after flush or on dispose. */
  private _flushTimer: ReturnType<typeof setTimeout> | undefined;
  /** Whether this buffer has been disposed. */
  private _disposed = false;

  /** Rolling window of recent flush sizes for throughput estimation. */
  private _throughputWindow: number[] = [];
  /** Current adaptive flush interval (ms). */
  private _currentInterval: number = DEFAULT_FLUSH_INTERVAL_MS;

  /** Accessor for testing: current unacked char count. */
  get unackedCharCount(): number {
    return this._unackedCharCount;
  }

  /** Accessor: current total buffered character count. */
  get bufferSize(): number {
    return this._bufferSize;
  }

  /** Accessor for testing: whether PTY is paused. */
  get isPaused(): boolean {
    return this._isPaused;
  }

  /** Whether output flushing is paused (view hidden / restore replay pending). */
  get isOutputPaused(): boolean {
    return this._isOutputPaused;
  }

  constructor(
    /** Tab/session ID for output messages. */
    private readonly _tabId: string,
    /** Webview to send output messages to. */
    private _webview: MessageSender,
    /** PTY process for pause/resume flow control. */
    private readonly _pty: FlowControllable,
    /**
     * Called once per flush that actually posts output, with the moment the
     * webview was handed it.
     *
     * The delivery instant, not the arrival of the bytes from the pty, is what
     * an out-of-band observer of pane activity has to use: `pauseOutput()` can
     * hold a buffer for the whole of a snapshot-restore replay, and a clock
     * started when the pty produced the data would call a pane idle while the
     * surface has not been shown a byte of it. See:
     * asimov/changes/add-host-pane-evidence/design.md D6.
     */
    private readonly _onFlush?: OnFlush,
  ) {}

  // ─── Public API ─────────────────────────────────────────────────

  /**
   * Append PTY output data to the buffer.
   * May trigger immediate flush if buffer exceeds size or chunk limits.
   */
  append(data: string): void {
    if (this._disposed) {
      return;
    }

    // Buffer overflow protection
    let chunk = data;
    if (chunk.length > MAX_TOTAL_BUFFER_CHARS) {
      // Single oversized chunk: truncate to cap (keep tail), clear buffer
      chunk = chunk.slice(chunk.length - MAX_TOTAL_BUFFER_CHARS);
      this._chunks = [];
      this._bufferSize = 0;
    } else if (this._bufferSize + chunk.length > MAX_TOTAL_BUFFER_CHARS) {
      // Evict oldest chunks (FIFO) until new data fits
      let excess = this._bufferSize + chunk.length - MAX_TOTAL_BUFFER_CHARS;
      while (excess > 0 && this._chunks.length > 0) {
        const oldest = this._chunks[0];
        if (oldest.length <= excess) {
          // Drop entire chunk
          this._chunks.shift();
          this._bufferSize -= oldest.length;
          excess -= oldest.length;
        } else {
          // Slice the oldest chunk to remove only the excess portion
          this._chunks[0] = oldest.slice(excess);
          this._bufferSize -= excess;
          excess = 0;
        }
      }
    }

    this._chunks.push(chunk);
    this._bufferSize += chunk.length;

    // When output is paused, accumulate data but don't start flush timer
    if (this._isOutputPaused) {
      // Coalesce chunks to prevent unbounded array growth while paused
      if (this._chunks.length >= MAX_CHUNKS) {
        this._chunks = [this._chunks.join("")];
      }
      return;
    }

    // Start a one-shot flush timer on first data (or if no timer is pending)
    if (!this._flushTimer) {
      this._flushTimer = setTimeout(() => {
        this._flushTimer = undefined;
        this._flush();
      }, this._currentInterval);
    }

    // Immediate flush if buffer exceeds size or chunk limits
    if (this._bufferSize >= MAX_BUFFER_SIZE || this._chunks.length >= MAX_CHUNKS) {
      this._flush();
    }
  }

  /**
   * Force-flush all buffered data. Used on PTY exit.
   */
  flush(): void {
    this._flush();
  }

  /**
   * Handle acknowledgment from the webview (flow control).
   * Decreases unacked count and resumes PTY if below low watermark.
   */
  handleAck(charCount: number): void {
    if (this._disposed) {
      return;
    }

    // Validate input: must be a finite number >= 0
    const safeCount = Number.isFinite(charCount) && charCount > 0 ? charCount : 0;
    if (safeCount === 0) {
      return;
    }

    this._unackedCharCount = Math.max(0, this._unackedCharCount - safeCount);

    // Resume PTY if we've drained enough
    if (this._isPaused && this._unackedCharCount < LOW_WATERMARK_CHARS) {
      this._isPaused = false;
      this._pty.resume();
    }
  }

  /**
   * Pause output flushing. Stops the flush timer.
   * Data appended via append() is still buffered but not flushed to the webview.
   * Flow control (PTY pause/resume) continues to operate independently.
   */
  pauseOutput(): void {
    if (this._disposed || this._isOutputPaused) {
      return;
    }
    this._isOutputPaused = true;

    // Stop the flush timer — data will accumulate but not be sent
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = undefined;
    }
  }

  /**
   * Resume output flushing. Restarts the flush timer.
   * If there is buffered data, flush immediately.
   */
  resumeOutput(): void {
    if (this._disposed || !this._isOutputPaused) {
      return;
    }
    this._isOutputPaused = false;

    // Flush any accumulated data immediately
    if (this._chunks.length > 0) {
      this._flush();
    }
  }

  /**
   * Update the webview reference. Used when a webview is re-created
   * but the session (and its OutputBuffer) survives.
   */
  updateWebview(webview: MessageSender): void {
    this._webview = webview;
  }

  /**
   * Dispose the buffer. Flushes remaining data (best-effort), clears timer.
   * Pass `{ flush: false }` to discard still-buffered data instead — used when a
   * caller is swapping in a replacement buffer and the pending (paused) chunks
   * must not reach the webview out of order.
   */
  dispose(opts?: { flush?: boolean }): void {
    if (this._disposed) {
      return;
    }

    this._disposed = true;

    // Clear the flush timer
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = undefined;
    }

    // Best-effort final flush (skipped when the caller is discarding paused data).
    if (opts?.flush !== false) {
      this._flush();
    }

    // Reset state
    this._chunks = [];
    this._bufferSize = 0;
    this._unackedCharCount = 0;
    this._isPaused = false;
    this._throughputWindow = [];
    this._currentInterval = DEFAULT_FLUSH_INTERVAL_MS;
  }

  // ─── Private ────────────────────────────────────────────────────

  /**
   * Flush all buffered chunks to the webview as a single output message.
   */
  private _flush(): void {
    // Cancel pending timer since we're flushing now
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = undefined;
    }

    if (this._chunks.length === 0) {
      return;
    }

    const data = this._chunks.join("");
    this._chunks = [];
    this._bufferSize = 0;

    // Record flush size for adaptive interval
    this._throughputWindow.push(data.length);
    if (this._throughputWindow.length > THROUGHPUT_WINDOW_SIZE) {
      this._throughputWindow.shift();
    }
    if (this._throughputWindow.length === THROUGHPUT_WINDOW_SIZE) {
      const avg = this._throughputWindow.reduce((sum, v) => sum + v, 0) / THROUGHPUT_WINDOW_SIZE;
      if (avg > HIGH_THROUGHPUT_THRESHOLD) {
        this._currentInterval = MAX_FLUSH_INTERVAL_MS;
      } else if (avg < LOW_THROUGHPUT_THRESHOLD) {
        this._currentInterval = MIN_FLUSH_INTERVAL_MS;
      } else {
        this._currentInterval = DEFAULT_FLUSH_INTERVAL_MS;
      }
    }

    // Track unacked chars for flow control
    this._unackedCharCount += data.length;

    // The observer is told when the webview TOOK this output, not when we tried
    // to hand it over: VS Code resolves `false` for a message dropped as
    // undeliverable, and output the surface never received must not read as
    // activity on it (.reviews/round-2.md W1). The stamp is taken here, so a
    // slow confirmation still dates the output to the moment it was produced.
    //
    // No generation token guards a late resolution: the store mutates existing
    // entries and never creates one, so a stamp arriving for a pane that has
    // since been deleted is already a no-op (design.md D2).
    const producedAt = Date.now();
    const notify = (delivered: boolean): void => {
      if (!delivered || !this._onFlush) {
        return;
      }
      try {
        this._onFlush(this._tabId, producedAt);
      } catch {
        /* best-effort — an observer must never break the output path */
      }
    };

    // Send to webview (best-effort — may fail if webview disposed)
    try {
      void this._webview.postMessage({ type: "output", tabId: this._tabId, data }).then(notify, () => {
        // Async rejection — webview may be disposed
      });
    } catch {
      // Sync throw — webview may be disposed
    }

    // Check high watermark — pause PTY if needed (skip during dispose)
    if (!this._disposed && !this._isPaused && this._unackedCharCount > HIGH_WATERMARK_CHARS) {
      this._isPaused = true;
      this._pty.pause();
    }
  }
}
