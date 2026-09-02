import * as vscode from "vscode";
import type { Pty } from "../../pty/PtyManager";

const TRANSCRIPT_LIMIT = 1024 * 1024;
const MAX_TRANSCRIPT_CHUNKS = 256;
const LIVE_FLUSH_CHARS = 64 * 1024;
const LIVE_FLUSH_MS = 8;

interface EmitterLike {
  readonly event: vscode.Event<string>;
  fire(data: string): void;
  dispose(): void;
}

interface TerminalLike {
  show(preserveFocus?: boolean): void;
  dispose(): void;
}

interface PseudoterminalLike {
  readonly onDidWrite: vscode.Event<string>;
  open(initialDimensions?: vscode.TerminalDimensions): void;
  close(): void;
  handleInput?(data: string): void;
}

export interface SetupTerminalDependencies {
  readonly createTerminal?: (options: { name: string; pty: PseudoterminalLike }) => TerminalLike;
  readonly createEmitter?: () => EmitterLike;
  readonly newId?: () => string;
  readonly name?: string;
}

/** One setup run's write-through terminal and retained, origin-bound output. */
export class SetupTerminal {
  private readonly createTerminal: (options: { name: string; pty: PseudoterminalLike }) => TerminalLike;
  private readonly createEmitter: () => EmitterLike;
  private readonly newId: () => string;
  private readonly name: string;
  private readonly closeListeners = new Set<() => void>();
  private terminal: TerminalLike | undefined;
  private writer: EmitterLike | undefined;
  private child: Pty | undefined;
  private childData: { dispose(): void } | undefined;
  private opened = false;
  private closed = false;
  private openPromise: Promise<boolean> | undefined;
  private resolveOpen: ((opened: boolean) => void) | undefined;
  private tailChunks: Buffer[] = [];
  private tailHead = 0;
  private tailBytes = 0;
  private liveChunks: string[] = [];
  private liveChars = 0;
  private liveFlush: ReturnType<typeof setTimeout> | undefined;
  private replayTerminal: TerminalLike | undefined;
  private retainedOutput: { id: string; origin: string } | undefined;
  private disposed = false;

  constructor(dependencies: SetupTerminalDependencies = {}) {
    this.createTerminal =
      dependencies.createTerminal ??
      ((options) => vscode.window.createTerminal({ name: options.name, pty: options.pty }));
    this.createEmitter = dependencies.createEmitter ?? (() => new vscode.EventEmitter<string>());
    this.newId = dependencies.newId ?? (() => crypto.randomUUID());
    this.name = dependencies.name ?? "Worktree setup";
  }

  /** Show the terminal and wait until VS Code accepts output. */
  open(): Promise<boolean> {
    if (this.disposed) {
      return Promise.resolve(false);
    }
    if (this.openPromise) {
      return this.openPromise;
    }
    const pseudoterminal: PseudoterminalLike = {
      onDidWrite: this.writerForLiveTerminal().event,
      open: () => {
        if (this.closed) {
          return;
        }
        this.opened = true;
        this.resolveOpen?.(true);
        this.connectChild();
      },
      close: () => this.close(),
      handleInput: (data) => this.child?.write(data),
    };
    this.openPromise = new Promise((resolve) => {
      this.resolveOpen = resolve;
    });
    this.terminal = this.createTerminal({ name: this.name, pty: pseudoterminal });
    this.terminal.show(true);
    return this.openPromise;
  }

  /** Attach the runner's current child. It is not observed until the terminal is open. */
  attach(child: Pty): void {
    this.detach(this.child);
    this.child = child;
    this.connectChild();
  }

  detach(child: Pty | undefined): void {
    if (child === undefined || this.child !== child) {
      return;
    }
    this.childData?.dispose();
    this.childData = undefined;
    this.child = undefined;
  }

  onClose(listener: () => void): { dispose(): void } {
    if (this.closed) {
      listener();
      return { dispose: () => undefined };
    }
    this.closeListeners.add(listener);
    return { dispose: () => this.closeListeners.delete(listener) };
  }

  /** Mint exactly one opaque handle for this run's output and owning surface. */
  outputId(origin: string): string {
    if (!this.retainedOutput) {
      this.retainedOutput = { id: this.newId(), origin };
    }
    return this.retainedOutput.id;
  }

  /** Reveal live output or recreate a read-only terminal from the bounded tail. */
  reveal(outputId: string, origin: string): boolean {
    if (this.disposed || this.retainedOutput?.id !== outputId || this.retainedOutput.origin !== origin) {
      return false;
    }
    if (!this.closed && this.terminal) {
      this.terminal.show(true);
      return true;
    }
    if (this.replayTerminal) {
      this.replayTerminal.show(true);
      return true;
    }
    const transcript = this.transcript();
    const emitter = this.createEmitter();
    this.replayTerminal = this.createTerminal({
      name: `${this.name} output`,
      pty: {
        onDidWrite: emitter.event,
        open: () => {
          if (transcript) {
            emitter.fire(transcript);
          }
        },
        close: () => emitter.dispose(),
      },
    });
    this.replayTerminal.show(true);
    return true;
  }

  transcript(): string {
    return Buffer.concat(this.tailChunks.slice(this.tailHead), this.tailBytes).toString("utf8");
  }

  private writerForLiveTerminal(): EmitterLike {
    if (!this.writer) {
      this.writer = this.createEmitter();
    }
    return this.writer;
  }

  private connectChild(): void {
    if (!this.opened || this.closed || !this.child || this.childData) {
      return;
    }
    this.childData = this.child.onData((data) => {
      this.append(data);
      this.queueLiveWrite(data);
    });
  }

  private append(data: string): void {
    let chunk: Buffer = Buffer.from(data);
    if (chunk.length >= TRANSCRIPT_LIMIT) {
      chunk = utf8Tail(chunk, TRANSCRIPT_LIMIT);
      this.tailChunks = [chunk];
      this.tailHead = 0;
      this.tailBytes = chunk.length;
      return;
    }
    this.tailChunks.push(chunk);
    this.tailBytes += chunk.length;
    this.evictTranscript();
    if (this.tailChunks.length - this.tailHead > MAX_TRANSCRIPT_CHUNKS) {
      this.tailChunks = [Buffer.concat(this.tailChunks.slice(this.tailHead), this.tailBytes)];
      this.tailHead = 0;
    }
  }

  private evictTranscript(): void {
    let excess = this.tailBytes - TRANSCRIPT_LIMIT;
    while (excess > 0 && this.tailHead < this.tailChunks.length) {
      const oldest = this.tailChunks[this.tailHead];
      if (oldest.length <= excess) {
        this.tailHead += 1;
        this.tailBytes -= oldest.length;
        excess -= oldest.length;
        continue;
      }
      const retained = utf8Tail(oldest, oldest.length - excess);
      this.tailChunks[this.tailHead] = retained;
      this.tailBytes -= oldest.length - retained.length;
      excess = 0;
    }
    if (this.tailHead >= MAX_TRANSCRIPT_CHUNKS) {
      this.tailChunks = this.tailChunks.slice(this.tailHead);
      this.tailHead = 0;
    }
  }

  private queueLiveWrite(data: string): void {
    this.liveChunks.push(data);
    this.liveChars += data.length;
    if (this.liveChars >= LIVE_FLUSH_CHARS) {
      this.flushLiveWrites();
      return;
    }
    this.liveFlush ??= setTimeout(() => this.flushLiveWrites(), LIVE_FLUSH_MS);
  }

  private flushLiveWrites(): void {
    if (this.liveFlush !== undefined) {
      clearTimeout(this.liveFlush);
      this.liveFlush = undefined;
    }
    if (this.liveChars === 0 || this.closed || this.disposed) {
      this.liveChunks = [];
      this.liveChars = 0;
      return;
    }
    const output = this.liveChunks.join("");
    this.liveChunks = [];
    this.liveChars = 0;
    for (let start = 0; start < output.length; start += LIVE_FLUSH_CHARS) {
      this.writer?.fire(output.slice(start, start + LIVE_FLUSH_CHARS));
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.close();
    this.terminal?.dispose();
    this.terminal = undefined;
    this.replayTerminal?.dispose();
    this.replayTerminal = undefined;
    this.retainedOutput = undefined;
    this.tailChunks = [];
    this.tailHead = 0;
    this.tailBytes = 0;
  }

  private close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.resolveOpen?.(false);
    const child = this.child;
    if (child !== undefined) {
      try {
        child.kill();
      } catch {
        // The child may already have exited; close still releases every owner.
      }
      this.detach(child);
    }
    if (this.liveFlush !== undefined) {
      clearTimeout(this.liveFlush);
      this.liveFlush = undefined;
    }
    this.liveChunks = [];
    this.liveChars = 0;
    for (const listener of this.closeListeners) {
      listener();
    }
    this.closeListeners.clear();
    this.writer?.dispose();
    this.writer = undefined;
  }
}

function utf8Tail(bytes: Buffer, limit: number): Buffer {
  let start = Math.max(0, bytes.length - limit);
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) {
    start += 1;
  }
  return bytes.subarray(start);
}
