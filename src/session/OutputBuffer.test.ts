// src/session/OutputBuffer.test.ts — Unit tests for OutputBuffer
// See: specs/output-buffer/spec.md

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowControllable, MessageSender } from "./OutputBuffer";
import { OutputBuffer } from "./OutputBuffer";

// ─── Test Helpers ───────────────────────────────────────────────────

function createMockSender(): MessageSender & { messages: unknown[] } {
  const sender = {
    messages: [] as unknown[],
    postMessage(message: unknown): Thenable<boolean> {
      sender.messages.push(message);
      return Promise.resolve(true);
    },
  };
  return sender;
}

function createMockPty(): FlowControllable & { pauseCalls: number; resumeCalls: number } {
  return {
    pauseCalls: 0,
    resumeCalls: 0,
    pause() {
      this.pauseCalls++;
    },
    resume() {
      this.resumeCalls++;
    },
  };
}

/**
 * The flush observer fires from the `postMessage` resolution, so a test has to
 * let the microtask queue settle before asserting on it. Fake timers do not
 * advance microtasks, and `vi.waitFor` is absent under the bun runner the
 * task's Verify uses — plain turns work under both.
 */
async function drainMicrotasks(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
  }
}

// ─── Test Setup ─────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Output Buffer Coalescing ───────────────────────────────────────

describe("OutputBuffer coalescing", () => {
  it("flushes buffered chunks after 8ms timer fires", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("tab-1", sender, pty);

    buffer.append("a");
    buffer.append("b");
    buffer.append("c");

    // Not flushed yet
    expect(sender.messages).toHaveLength(0);

    // Advance 8ms → timer fires
    vi.advanceTimersByTime(8);

    expect(sender.messages).toHaveLength(1);
    expect(sender.messages[0]).toEqual({ type: "output", tabId: "tab-1", data: "abc" });

    buffer.dispose();
  });

  it("flushes immediately when buffer exceeds 64KB", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("tab-2", sender, pty);

    // Add 60KB of data
    const chunk60k = "x".repeat(60_000);
    buffer.append(chunk60k);
    expect(sender.messages).toHaveLength(0); // Not yet

    // Add 6KB more → total > 64KB
    const chunk6k = "y".repeat(6_000);
    buffer.append(chunk6k);

    // Should flush immediately
    expect(sender.messages).toHaveLength(1);
    expect((sender.messages[0] as { data: string }).data.length).toBe(66_000);

    buffer.dispose();
  });

  it("flushes immediately when buffer reaches MAX_CHUNKS (100)", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("tab-3", sender, pty);

    // Add 100 small chunks
    for (let i = 0; i < 100; i++) {
      buffer.append("x");
    }

    // Should flush on the 100th chunk
    expect(sender.messages).toHaveLength(1);
    expect((sender.messages[0] as { data: string }).data).toBe("x".repeat(100));

    buffer.dispose();
  });

  it("flushes remaining data on flush() call (PTY exit)", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("tab-4", sender, pty);

    buffer.append("remaining output");

    // Manual flush (simulating PTY exit)
    buffer.flush();

    expect(sender.messages).toHaveLength(1);
    expect(sender.messages[0]).toEqual({ type: "output", tabId: "tab-4", data: "remaining output" });

    buffer.dispose();
  });

  it("does not flush when buffer is empty", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("tab-5", sender, pty);

    buffer.flush();
    expect(sender.messages).toHaveLength(0);

    vi.advanceTimersByTime(8);
    expect(sender.messages).toHaveLength(0);

    buffer.dispose();
  });

  it("coalesces multiple flushes over time", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("tab-6", sender, pty);

    buffer.append("batch1");
    vi.advanceTimersByTime(8);

    buffer.append("batch2");
    vi.advanceTimersByTime(8);

    expect(sender.messages).toHaveLength(2);
    expect((sender.messages[0] as { data: string }).data).toBe("batch1");
    expect((sender.messages[1] as { data: string }).data).toBe("batch2");

    buffer.dispose();
  });
});

// ─── Flow Control via Watermarks ────────────────────────────────────

describe("OutputBuffer flow control", () => {
  it("pauses PTY when unacked chars exceed high watermark (100K)", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("fc-1", sender, pty);

    // Send > 100K chars in one flush
    const bigChunk = "x".repeat(101_000);
    buffer.append(bigChunk);
    // Immediate flush due to size > 64KB
    // unackedCharCount = 101,000 > 100,000 → pause

    expect(pty.pauseCalls).toBe(1);
    expect(buffer.isPaused).toBe(true);

    buffer.dispose();
  });

  it("resumes PTY when ack brings unacked below low watermark (5K)", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("fc-2", sender, pty);

    // Build up past high watermark
    const bigChunk = "x".repeat(101_000);
    buffer.append(bigChunk);
    expect(buffer.isPaused).toBe(true);

    // Ack most of it: 101K - 97K = 4K < 5K → resume
    buffer.handleAck(97_000);

    expect(pty.resumeCalls).toBe(1);
    expect(buffer.isPaused).toBe(false);
    expect(buffer.unackedCharCount).toBe(4_000);

    buffer.dispose();
  });

  it("does NOT resume when unacked is still above low watermark", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("fc-3", sender, pty);

    // Build up past high watermark
    const bigChunk = "x".repeat(101_000);
    buffer.append(bigChunk);
    expect(buffer.isPaused).toBe(true);

    // Partial ack: 101K - 90K = 11K, still > 5K → stay paused
    buffer.handleAck(90_000);

    expect(pty.resumeCalls).toBe(0);
    expect(buffer.isPaused).toBe(true);
    expect(buffer.unackedCharCount).toBe(11_000);

    buffer.dispose();
  });

  it("does NOT call resume when PTY is already flowing", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("fc-4", sender, pty);

    // Small data, not paused
    buffer.append("small");
    vi.advanceTimersByTime(8);

    // Ack — should NOT call resume because we're already flowing
    buffer.handleAck(5);
    expect(pty.resumeCalls).toBe(0);
    expect(buffer.isPaused).toBe(false);

    buffer.dispose();
  });

  it("clamps unackedCharCount to 0 on over-ack", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("fc-5", sender, pty);

    buffer.append("hello");
    vi.advanceTimersByTime(8);
    expect(buffer.unackedCharCount).toBe(5);

    // Ack more than what was sent
    buffer.handleAck(100);
    expect(buffer.unackedCharCount).toBe(0);

    buffer.dispose();
  });

  it("ignores negative charCount in handleAck", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("fc-7", sender, pty);

    buffer.append("hello");
    vi.advanceTimersByTime(8);
    expect(buffer.unackedCharCount).toBe(5);

    buffer.handleAck(-10);
    expect(buffer.unackedCharCount).toBe(5); // Unchanged

    buffer.dispose();
  });

  it("ignores NaN charCount in handleAck", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("fc-8", sender, pty);

    buffer.append("hello");
    vi.advanceTimersByTime(8);
    expect(buffer.unackedCharCount).toBe(5);

    buffer.handleAck(Number.NaN);
    expect(buffer.unackedCharCount).toBe(5); // Unchanged

    buffer.dispose();
  });

  it("ignores Infinity charCount in handleAck", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("fc-9", sender, pty);

    buffer.append("hello");
    vi.advanceTimersByTime(8);
    expect(buffer.unackedCharCount).toBe(5);

    buffer.handleAck(Number.POSITIVE_INFINITY);
    expect(buffer.unackedCharCount).toBe(5); // Unchanged

    buffer.dispose();
  });

  it("tracks unacked across multiple flushes", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("fc-6", sender, pty);

    buffer.append("aaa"); // 3 chars
    vi.advanceTimersByTime(8);
    expect(buffer.unackedCharCount).toBe(3);

    buffer.append("bbbbb"); // 5 chars
    vi.advanceTimersByTime(8);
    expect(buffer.unackedCharCount).toBe(8);

    buffer.handleAck(3);
    expect(buffer.unackedCharCount).toBe(5);

    buffer.dispose();
  });
});

// ─── Disposal ───────────────────────────────────────────────────────

describe("OutputBuffer disposal", () => {
  it("clears flush timer on dispose", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("d-1", sender, pty);

    buffer.append("data");
    buffer.dispose();

    // Advance time — no flush should occur after dispose
    const messageCountAfterDispose = sender.messages.length;
    vi.advanceTimersByTime(100);
    // The dispose flush may have sent one message, but no further ones
    expect(sender.messages.length).toBe(messageCountAfterDispose);
  });

  it("flushes remaining data on dispose (best-effort)", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("d-2", sender, pty);

    buffer.append("final data");
    buffer.dispose();

    // Should have flushed the remaining data
    expect(sender.messages).toHaveLength(1);
    expect(sender.messages[0]).toEqual({ type: "output", tabId: "d-2", data: "final data" });
  });

  it("resets all state on dispose", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("d-3", sender, pty);

    buffer.append("data");
    vi.advanceTimersByTime(8);
    buffer.dispose();

    expect(buffer.unackedCharCount).toBe(0);
    expect(buffer.isPaused).toBe(false);
  });

  it("ignores append after dispose", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("d-4", sender, pty);

    buffer.dispose();
    buffer.append("should be ignored");

    vi.advanceTimersByTime(100);
    expect(sender.messages).toHaveLength(0);
  });

  it("ignores handleAck after dispose", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("d-5", sender, pty);

    buffer.dispose();
    buffer.handleAck(1000); // Should not throw
    expect(buffer.unackedCharCount).toBe(0);
  });

  it("is idempotent (second dispose is no-op)", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("d-6", sender, pty);

    buffer.append("data");
    buffer.dispose();
    buffer.dispose(); // Should not throw or double-flush

    expect(sender.messages).toHaveLength(1); // Only one flush from first dispose
  });
});

// ─── postMessage error handling ─────────────────────────────────────

describe("OutputBuffer postMessage error handling", () => {
  it("does not throw when postMessage throws (webview disposed)", () => {
    const sender: MessageSender = {
      postMessage(): Thenable<boolean> {
        throw new Error("Webview disposed");
      },
    };
    const pty = createMockPty();
    const buffer = new OutputBuffer("err-1", sender, pty);

    buffer.append("data");

    // Should not throw
    expect(() => {
      vi.advanceTimersByTime(8);
    }).not.toThrow();

    buffer.dispose();
  });

  it("does not throw when postMessage throws during dispose", () => {
    const sender: MessageSender = {
      postMessage(): Thenable<boolean> {
        throw new Error("Webview disposed");
      },
    };
    const pty = createMockPty();
    const buffer = new OutputBuffer("err-2", sender, pty);

    buffer.append("data");

    // Dispose should not throw even though postMessage fails
    expect(() => {
      buffer.dispose();
    }).not.toThrow();
  });
});

// ─── Pause / Resume Output ─────────────────────────────────────────

describe("OutputBuffer pause/resume output", () => {
  it("pauseOutput stops flush timer — data accumulates but is not sent", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("pause-1", sender, pty);

    buffer.pauseOutput();
    buffer.append("data while paused");

    // Advance time — no flush should occur
    vi.advanceTimersByTime(100);
    expect(sender.messages).toHaveLength(0);

    buffer.dispose();
  });

  it("resumeOutput flushes accumulated data immediately", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("pause-2", sender, pty);

    buffer.pauseOutput();
    buffer.append("buffered");

    vi.advanceTimersByTime(100);
    expect(sender.messages).toHaveLength(0);

    buffer.resumeOutput();

    expect(sender.messages).toHaveLength(1);
    expect(sender.messages[0]).toEqual({ type: "output", tabId: "pause-2", data: "buffered" });

    buffer.dispose();
  });

  it("resumeOutput restarts flush timer for future data", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("pause-3", sender, pty);

    buffer.pauseOutput();
    buffer.resumeOutput();

    // Now append new data — should flush normally after timer
    buffer.append("new data");
    vi.advanceTimersByTime(8);

    expect(sender.messages).toHaveLength(1);
    expect(sender.messages[0]).toEqual({ type: "output", tabId: "pause-3", data: "new data" });

    buffer.dispose();
  });

  it("pauseOutput is idempotent", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("pause-4", sender, pty);

    buffer.pauseOutput();
    buffer.pauseOutput(); // Should not throw

    buffer.append("data");
    vi.advanceTimersByTime(100);
    expect(sender.messages).toHaveLength(0);

    buffer.dispose();
  });

  it("resumeOutput is a no-op when not paused", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("pause-5", sender, pty);

    buffer.resumeOutput(); // Should not throw or flush

    buffer.append("data");
    vi.advanceTimersByTime(8);
    expect(sender.messages).toHaveLength(1);

    buffer.dispose();
  });

  it("multiple pause/resume cycles work correctly", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("pause-6", sender, pty);

    // Cycle 1: pause, accumulate, resume
    buffer.pauseOutput();
    buffer.append("cycle1");
    buffer.resumeOutput();
    expect(sender.messages).toHaveLength(1);
    expect((sender.messages[0] as { data: string }).data).toBe("cycle1");

    // Cycle 2: pause, accumulate, resume
    buffer.pauseOutput();
    buffer.append("cycle2");
    buffer.resumeOutput();
    expect(sender.messages).toHaveLength(2);
    expect((sender.messages[1] as { data: string }).data).toBe("cycle2");

    buffer.dispose();
  });

  it("updateWebview changes the target for future flushes", () => {
    const sender1 = createMockSender();
    const sender2 = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("update-1", sender1, pty);

    buffer.append("to-sender1");
    vi.advanceTimersByTime(8);
    expect(sender1.messages).toHaveLength(1);

    buffer.updateWebview(sender2);
    buffer.append("to-sender2");
    vi.advanceTimersByTime(8);
    expect(sender2.messages).toHaveLength(1);
    expect(sender1.messages).toHaveLength(1); // No new messages to sender1

    buffer.dispose();
  });
});

// ─── Adaptive Flush Interval ───────────────────────────────────────

describe("OutputBuffer adaptive flush interval", () => {
  it("cold start uses default 8ms interval", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("adaptive-1", sender, pty);

    buffer.append("hello");

    // At 7ms, should not have flushed yet
    vi.advanceTimersByTime(7);
    expect(sender.messages).toHaveLength(0);

    // At 8ms, should flush
    vi.advanceTimersByTime(1);
    expect(sender.messages).toHaveLength(1);

    buffer.dispose();
  });

  it("high throughput increases interval to 16ms", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("adaptive-2", sender, pty);

    // Fill throughput window with 5 flushes of >32KB each
    const bigChunk = "x".repeat(40_000);
    for (let i = 0; i < 5; i++) {
      buffer.append(bigChunk);
      vi.advanceTimersByTime(8); // flush with default interval
    }
    expect(sender.messages).toHaveLength(5);

    // Now the interval should be 16ms. Append new data.
    buffer.append("after-high");

    // At 15ms, should not have flushed
    vi.advanceTimersByTime(15);
    expect(sender.messages).toHaveLength(5);

    // At 16ms, should flush
    vi.advanceTimersByTime(1);
    expect(sender.messages).toHaveLength(6);

    buffer.dispose();
  });

  it("low throughput decreases interval to 4ms", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("adaptive-3", sender, pty);

    // Fill throughput window with 5 flushes of <1KB each
    const smallChunk = "x".repeat(500);
    for (let i = 0; i < 5; i++) {
      buffer.append(smallChunk);
      vi.advanceTimersByTime(8); // flush with default interval
    }
    expect(sender.messages).toHaveLength(5);

    // Now the interval should be 4ms. Append new data.
    buffer.append("after-low");

    // At 3ms, should not have flushed
    vi.advanceTimersByTime(3);
    expect(sender.messages).toHaveLength(5);

    // At 4ms, should flush
    vi.advanceTimersByTime(1);
    expect(sender.messages).toHaveLength(6);

    buffer.dispose();
  });

  it("medium throughput uses default 8ms", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("adaptive-4", sender, pty);

    // Fill throughput window with 5 flushes of ~10KB each
    const medChunk = "x".repeat(10_000);
    for (let i = 0; i < 5; i++) {
      buffer.append(medChunk);
      vi.advanceTimersByTime(8);
    }
    expect(sender.messages).toHaveLength(5);

    // Interval should remain 8ms
    buffer.append("after-med");

    vi.advanceTimersByTime(7);
    expect(sender.messages).toHaveLength(5);

    vi.advanceTimersByTime(1);
    expect(sender.messages).toHaveLength(6);

    buffer.dispose();
  });

  it("existing flush triggers still work with adaptive interval", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("adaptive-5", sender, pty);

    // 64KB immediate flush trigger still works
    const chunk64k = "x".repeat(65_536);
    buffer.append(chunk64k);
    expect(sender.messages).toHaveLength(1);

    // 100 chunk trigger still works
    for (let i = 0; i < 100; i++) {
      buffer.append("y");
    }
    expect(sender.messages).toHaveLength(2);

    buffer.dispose();
  });
});

// ─── Buffer Overflow Protection ────────────────────────────────────

describe("OutputBuffer buffer overflow protection", () => {
  it("evicts oldest chunks when cap exceeded", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("overflow-1", sender, pty);

    // Pause output so data accumulates in the buffer without flushing
    buffer.pauseOutput();

    // Fill buffer to 900KB
    const chunk900k = "A".repeat(900_000);
    buffer.append(chunk900k);

    // Append 200KB → total 1.1MB > 1MB cap, oldest should be evicted
    const chunk200k = "B".repeat(200_000);
    buffer.append(chunk200k);

    // Resume and flush to see what's in the buffer
    buffer.resumeOutput();

    // The flushed data should be at most 1MB
    // We expect some of the "A" data was evicted to make room for "B" data
    const flushedData = (sender.messages[0] as { data: string }).data;
    expect(flushedData.length).toBeLessThanOrEqual(1_048_576);
    expect(flushedData.endsWith("B".repeat(200_000))).toBe(true);

    buffer.dispose();
  });

  it("single oversized chunk is truncated to 1MB", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("overflow-2", sender, pty);

    // Append 2MB chunk
    const chunk2m = "X".repeat(2_097_152);
    buffer.append(chunk2m);

    // Force flush
    buffer.flush();

    const flushedData = (sender.messages[0] as { data: string }).data;
    expect(flushedData.length).toBe(1_048_576);
    // Tail should be preserved — last chars should be "X"
    expect(flushedData).toBe("X".repeat(1_048_576));

    buffer.dispose();
  });

  it("normal operation unaffected", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("overflow-3", sender, pty);

    // Append small chunks — should not trigger any eviction
    buffer.append("hello");
    buffer.append(" world");

    buffer.flush();

    expect(sender.messages).toHaveLength(1);
    expect((sender.messages[0] as { data: string }).data).toBe("hello world");

    buffer.dispose();
  });
});

// ─── bufferSize Accessor ───────────────────────────────────────────

describe("OutputBuffer bufferSize accessor", () => {
  it("returns current buffer size", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("bs-1", sender, pty);

    buffer.append("hello"); // 5 chars
    expect(buffer.bufferSize).toBe(5);

    buffer.dispose();
  });

  it("resets to 0 after flush", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("bs-2", sender, pty);

    buffer.append("hello");
    expect(buffer.bufferSize).toBe(5);

    buffer.flush();
    expect(buffer.bufferSize).toBe(0);

    buffer.dispose();
  });

  it("reflects size after multiple appends", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("bs-3", sender, pty);

    // Pause output so data accumulates without timer-based flushing
    buffer.pauseOutput();

    buffer.append("aaa"); // 3 chars
    expect(buffer.bufferSize).toBe(3);

    buffer.append("bbbbb"); // 5 chars
    expect(buffer.bufferSize).toBe(8);

    buffer.append("cc"); // 2 chars
    expect(buffer.bufferSize).toBe(10);

    buffer.dispose();
  });
});

// ─── Flush Notification ─────────────────────────────────────────────

describe("OutputBuffer flush notification", () => {
  it("reports each flush the webview took delivery of, with the tab id", async () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const flushes: Array<{ tabId: string; at: number }> = [];
    const buffer = new OutputBuffer("fn-1", sender, pty, (tabId, at) => flushes.push({ tabId, at }));

    buffer.append("hello");
    vi.advanceTimersByTime(10);
    await drainMicrotasks();

    expect(sender.messages).toHaveLength(1);
    expect(flushes).toHaveLength(1);
    expect(flushes[0].tabId).toBe("fn-1");
    expect(typeof flushes[0].at).toBe("number");

    buffer.dispose();
  });

  it("does not report a flush that had nothing to post", async () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const flushes: string[] = [];
    const buffer = new OutputBuffer("fn-2", sender, pty, (tabId) => flushes.push(tabId));

    buffer.flush();
    vi.advanceTimersByTime(50);
    await drainMicrotasks();

    expect(sender.messages).toHaveLength(0);
    expect(flushes).toHaveLength(0);

    buffer.dispose();
  });

  it("reports the flush a paused buffer releases on resume, not the appends it held", async () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const flushes: string[] = [];
    const buffer = new OutputBuffer("fn-3", sender, pty, (tabId) => flushes.push(tabId));

    buffer.pauseOutput();
    buffer.append("held");
    vi.advanceTimersByTime(50);
    await drainMicrotasks();
    expect(flushes).toHaveLength(0);

    buffer.resumeOutput();
    vi.advanceTimersByTime(50);
    await drainMicrotasks();
    expect(flushes).toEqual(["fn-3"]);

    buffer.dispose();
  });

  it("does not report a post that threw synchronously", async () => {
    const pty = createMockPty();
    const flushes: string[] = [];
    // A synchronous throw is a disposed webview: nothing was handed over, so
    // there is no delivery to announce. See .reviews/round-1.md W1.
    const sender: MessageSender = {
      postMessage() {
        throw new Error("webview disposed");
      },
    };
    const buffer = new OutputBuffer("fn-5", sender, pty, (tabId) => flushes.push(tabId));

    buffer.append("hello");
    vi.advanceTimersByTime(10);
    await drainMicrotasks();

    expect(flushes).toEqual([]);

    buffer.dispose();
  });

  it("does not report a post the webview rejected", async () => {
    const pty = createMockPty();
    const flushes: string[] = [];
    const sender: MessageSender = {
      postMessage: () => Promise.reject(new Error("not deliverable")),
    };
    const buffer = new OutputBuffer("fn-6", sender, pty, (tabId) => flushes.push(tabId));

    buffer.append("hello");
    vi.advanceTimersByTime(10);
    await drainMicrotasks();

    expect(flushes).toEqual([]);

    buffer.dispose();
  });

  it("does not report a post the webview declined to deliver", async () => {
    const pty = createMockPty();
    const flushes: string[] = [];
    // VS Code resolves `false` when the message was dropped because the
    // webview could not receive it. Output the surface never got must not
    // read as activity on it. See .reviews/round-2.md W1.
    const sender: MessageSender = {
      postMessage: () => Promise.resolve(false),
    };
    const buffer = new OutputBuffer("fn-7", sender, pty, (tabId) => flushes.push(tabId));

    buffer.append("hello");
    vi.advanceTimersByTime(10);
    await drainMicrotasks();

    expect(flushes).toEqual([]);

    buffer.dispose();
  });

  it("stamps the flush time, not the time delivery was confirmed", async () => {
    const pty = createMockPty();
    const stamps: number[] = [];
    let settle: (delivered: boolean) => void = () => {};
    const sender: MessageSender = {
      postMessage: () =>
        new Promise<boolean>((resolve) => {
          settle = resolve;
        }),
    };
    const buffer = new OutputBuffer("fn-8", sender, pty, (_tabId, at) => stamps.push(at));

    const before = Date.now();
    buffer.append("hello");
    vi.advanceTimersByTime(10);
    // Confirmation arrives long after the pane actually produced the output.
    vi.advanceTimersByTime(60_000);
    settle(true);
    await drainMicrotasks();
    expect(stamps).toHaveLength(1);

    expect(stamps[0]).toBeLessThanOrEqual(before + 1000);

    buffer.dispose();
  });

  it("hands each flush its own timestamp, so a reordered confirmation is detectable", async () => {
    const pty = createMockPty();
    const stamps: number[] = [];
    const settlers: Array<(delivered: boolean) => void> = [];
    const sender: MessageSender = {
      postMessage: () => new Promise<boolean>((resolve) => settlers.push(resolve)),
    };
    const buffer = new OutputBuffer("fn-9", sender, pty, (_tabId, at) => stamps.push(at));

    buffer.append("first");
    vi.advanceTimersByTime(10);
    buffer.append("second");
    vi.advanceTimersByTime(10);
    expect(settlers).toHaveLength(2);

    // The second flush confirms first. The store is what refuses the older
    // stamp that follows — see PaneEvidenceStore. Here we only prove the two
    // stamps are distinct and each belongs to its own flush.
    settlers[1](true);
    settlers[0](true);
    await drainMicrotasks();

    expect(stamps).toHaveLength(2);
    expect(stamps[0]).toBeGreaterThanOrEqual(stamps[1]);

    buffer.dispose();
  });

  it("works without a callback", () => {
    const sender = createMockSender();
    const pty = createMockPty();
    const buffer = new OutputBuffer("fn-4", sender, pty);

    buffer.append("x");
    vi.advanceTimersByTime(10);

    expect(sender.messages).toHaveLength(1);
    buffer.dispose();
  });
});
