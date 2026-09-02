import * as vscode from "vscode";
import type { Pty } from "../../pty/PtyManager";

const TRANSCRIPT_LIMIT = 1024 * 1024;

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
  private tail = "";
  private retainedOutput: { id: string; origin: string } | undefined;

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
    if (this.openPromise) return this.openPromise;
    const pseudoterminal: PseudoterminalLike = {
      onDidWrite: this.writerForLiveTerminal().event,
      open: () => {
        if (this.closed) return;
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
    this.childData?.dispose();
    this.childData = undefined;
    this.child = child;
    this.connectChild();
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
    if (this.retainedOutput?.id !== outputId || this.retainedOutput.origin !== origin) return false;
    if (!this.closed && this.terminal) {
      this.terminal.show(true);
      return true;
    }
    const transcript = this.tail;
    const emitter = this.createEmitter();
    const terminal = this.createTerminal({
      name: `${this.name} output`,
      pty: {
        onDidWrite: emitter.event,
        open: () => {
          if (transcript) emitter.fire(transcript);
        },
        close: () => emitter.dispose(),
      },
    });
    terminal.show(true);
    return true;
  }

  transcript(): string {
    return this.tail;
  }

  private writerForLiveTerminal(): EmitterLike {
    if (!this.writer) this.writer = this.createEmitter();
    return this.writer;
  }

  private connectChild(): void {
    if (!this.opened || this.closed || !this.child || this.childData) return;
    this.childData = this.child.onData((data) => {
      this.append(data);
      this.writer?.fire(data);
    });
  }

  private append(data: string): void {
    const bytes = Buffer.from(this.tail + data);
    if (bytes.length <= TRANSCRIPT_LIMIT) {
      this.tail = this.tail + data;
      return;
    }
    let start = bytes.length - TRANSCRIPT_LIMIT;
    // Do not turn a multi-byte character split at the tail boundary into U+FFFD.
    while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start += 1;
    this.tail = bytes.subarray(start).toString("utf8");
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.resolveOpen?.(false);
    this.child?.kill();
    this.childData?.dispose();
    this.childData = undefined;
    for (const listener of this.closeListeners) listener();
    this.closeListeners.clear();
    this.writer?.dispose();
  }
}
