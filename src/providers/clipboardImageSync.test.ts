import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALT_V_PASTE, BRACKETED_EMPTY_PASTE, CTRL_V_PASTE } from "../shared/imagePasteTrigger";
import { handlePasteClipboardImage, handlePasteOsClipboardImage, readImageFromOsClipboard } from "./clipboardImageSync";

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
  stat: vi.fn(),
  readFile: vi.fn(),
  mkdtemp: vi.fn(),
  writeFile: vi.fn(),
  rm: vi.fn(),
}));

vi.mock("node:child_process", () => ({ execFile: mocks.execFile, spawn: mocks.spawn }));
vi.mock("node:fs/promises", () => ({
  mkdtemp: mocks.mkdtemp,
  writeFile: mocks.writeFile,
  readFile: mocks.readFile,
  stat: mocks.stat,
  rm: mocks.rm,
}));

// Default fs/exec behaviour so the OS-clipboard *write* path (exercised by the
// handlePasteClipboardImage tests) resolves without touching the real system.
beforeEach(() => {
  mocks.mkdtemp.mockResolvedValue("/tmp/awt-test");
  mocks.writeFile.mockResolvedValue(undefined);
  mocks.rm.mockResolvedValue(undefined);
  mocks.readFile.mockResolvedValue(Buffer.alloc(0));
  mocks.stat.mockResolvedValue({ isFile: () => true, size: 0 });
  mocks.execFile.mockImplementation((...args: unknown[]) => {
    (args[args.length - 1] as (e: unknown, r: unknown) => void)(null, { stdout: "", stderr: "" });
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

const PNG_BASE64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");

describe("handlePasteClipboardImage", () => {
  const origPlatform = process.platform;
  const origDisplay = process.env.DISPLAY;
  const origWaylandDisplay = process.env.WAYLAND_DISPLAY;
  const setPlatform = (value: string): void => {
    Object.defineProperty(process, "platform", { value });
  };

  beforeEach(() => {
    setPlatform("darwin");
  });

  afterEach(() => {
    setPlatform(origPlatform);
    if (origDisplay === undefined) {
      delete process.env.DISPLAY;
    } else {
      process.env.DISPLAY = origDisplay;
    }
    if (origWaylandDisplay === undefined) {
      delete process.env.WAYLAND_DISPLAY;
    } else {
      process.env.WAYLAND_DISPLAY = origWaylandDisplay;
    }
  });

  it("emits the CLI-specific PTY trigger after attempting OS clipboard sync", async () => {
    const writeToSession = vi.fn();

    // Codex keys off a fixed Ctrl+V even on macOS.
    await handlePasteClipboardImage({ tabId: "session-a", mimeType: "image/png", data: PNG_BASE64 }, writeToSession, {
      agentKind: "codex",
      platform: "darwin",
    });

    expect(writeToSession).toHaveBeenCalledWith("session-a", CTRL_V_PASTE);
  });

  it("uses the OS-native trigger for Claude / unknown sessions", async () => {
    const writeToSession = vi.fn();

    await handlePasteClipboardImage({ tabId: "session-a", mimeType: "image/png", data: PNG_BASE64 }, writeToSession, {
      agentKind: "claude",
      platform: "darwin",
    });

    expect(writeToSession).toHaveBeenCalledWith("session-a", BRACKETED_EMPTY_PASTE);
  });

  it("sends Alt+V for Claude on Windows (Ctrl+V there is a plain paste)", async () => {
    const writeToSession = vi.fn();

    await handlePasteClipboardImage({ tabId: "session-a", mimeType: "image/png", data: PNG_BASE64 }, writeToSession, {
      agentKind: "claude",
      platform: "win32",
    });

    expect(writeToSession).toHaveBeenCalledWith("session-a", ALT_V_PASTE);
  });

  it("still fires the PTY trigger when the OS clipboard write fails", async () => {
    // Guards the write-path unhandled-rejection fix: an fs failure must resolve to
    // "write failed" (trigger still fires — the image may be on the clipboard from
    // an external copy), not reject out of the void-called handler.
    const writeToSession = vi.fn();
    mocks.mkdtemp.mockRejectedValue(new Error("ENOSPC"));

    await handlePasteClipboardImage({ tabId: "session-a", mimeType: "image/png", data: PNG_BASE64 }, writeToSession, {
      agentKind: "codex",
      platform: "darwin",
    });

    expect(writeToSession).toHaveBeenCalledWith("session-a", CTRL_V_PASTE);
  });

  it("uses xclip without waiting for its background clipboard owner on Linux X11", async () => {
    setPlatform("linux");
    process.env.DISPLAY = ":1";
    delete process.env.WAYLAND_DISPLAY;
    expect(process.platform).toBe("linux");
    expect(process.env.DISPLAY).toBe(":1");
    const proc = Object.assign(new EventEmitter(), {
      stdin: Object.assign(new EventEmitter(), { end: vi.fn() }),
      kill: vi.fn(),
    });
    mocks.spawn.mockReturnValue(proc);
    const writeToSession = vi.fn();

    const paste = handlePasteClipboardImage(
      { tabId: "session-a", mimeType: "image/png", data: PNG_BASE64 },
      writeToSession,
      { platform: "linux" },
    );
    await vi.waitFor(() => expect(proc.listenerCount("exit")).toBe(1));
    proc.emit("exit", 0);
    await paste;

    expect(mocks.mkdtemp).not.toHaveBeenCalled();
    expect(mocks.spawn).toHaveBeenCalledWith("xclip", ["-selection", "clipboard", "-t", "image/png", "-i"], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    expect(proc.stdin.end).toHaveBeenCalledWith(Buffer.from(PNG_BASE64, "base64"));
    expect(writeToSession).toHaveBeenCalledWith("session-a", CTRL_V_PASTE);
  });

  it("ignores invalid base64", async () => {
    const writeToSession = vi.fn();

    await handlePasteClipboardImage(
      { tabId: "session-a", mimeType: "image/png", data: "%%%not-base64%%%" },
      writeToSession,
      { platform: "win32" },
    );

    expect(writeToSession).not.toHaveBeenCalled();
  });

  it("ignores empty fields", async () => {
    const writeToSession = vi.fn();

    await handlePasteClipboardImage({ tabId: "", mimeType: "image/png", data: "" }, writeToSession);

    expect(writeToSession).not.toHaveBeenCalled();
  });
});

describe("readImageFromOsClipboard", () => {
  const origPlatform = process.platform;
  const FURL_QUERY = "POSIX path of (the clipboard as «class furl»)";
  const setPlatform = (value: string): void => {
    Object.defineProperty(process, "platform", { value });
  };

  afterEach(() => {
    setPlatform(origPlatform);
  });

  it("returns null on Linux (webview captures the blob from its paste event)", async () => {
    setPlatform("linux");
    expect(await readImageFromOsClipboard()).toBeNull();
  });

  it("reads a DIB/CF_BITMAP image from the Windows clipboard via PowerShell", async () => {
    setPlatform("win32");
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    mocks.execFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (e: unknown, r: unknown) => void;
      cb(null, { stdout: "", stderr: "" });
    });
    mocks.readFile.mockResolvedValue(png);

    const result = await readImageFromOsClipboard();

    expect(result).toEqual({ mimeType: "image/png", data: png.toString("base64") });
    // execFile(cmd, args, opts, cb) — binary is the first positional arg.
    expect(mocks.execFile.mock.calls[0]?.[0]).toBe("powershell.exe");
    const argv = mocks.execFile.mock.calls[0]?.[1] as string[];
    expect(argv[0]).toBe("-NoProfile");
  });

  it("returns null on Windows when the clipboard holds no image", async () => {
    setPlatform("win32");
    mocks.execFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (e: unknown, r: unknown) => void;
      cb(new Error("exit 1"), null);
    });

    expect(await readImageFromOsClipboard()).toBeNull();
  });

  it("reads the real file bytes when a copied image FILE is on the clipboard", async () => {
    // The regression: coercing a file-URL to «class PNGf» yields the generic file
    // icon, not the image. We must read the file the pasteboard points to instead.
    setPlatform("darwin");
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const filePath = "/Users/me/Desktop/Screenshot at 12.19.53.png";
    mocks.execFile.mockImplementation((...args: unknown[]) => {
      const argv = args[1] as string[];
      const cb = args[args.length - 1] as (e: unknown, r: unknown) => void;
      if (argv.includes(FURL_QUERY)) {
        cb(null, { stdout: `${filePath}\n`, stderr: "" });
      } else {
        cb(new Error("must not coerce to PNGf when a file-URL is present"), null);
      }
    });
    mocks.stat.mockResolvedValue({ isFile: () => true, size: png.length });
    mocks.readFile.mockResolvedValue(png);

    const result = await readImageFromOsClipboard();

    expect(result).toEqual({ mimeType: "image/png", data: png.toString("base64") });
    expect(mocks.readFile).toHaveBeenCalledWith(filePath);
  });

  it("returns null for a non-image file rather than falling back to its icon", async () => {
    setPlatform("darwin");
    mocks.execFile.mockImplementation((...args: unknown[]) => {
      const argv = args[1] as string[];
      const cb = args[args.length - 1] as (e: unknown, r: unknown) => void;
      if (argv.includes(FURL_QUERY)) {
        cb(null, { stdout: "/Users/me/notes.txt\n", stderr: "" });
      } else {
        cb(new Error("must not coerce a non-image file"), null);
      }
    });

    expect(await readImageFromOsClipboard()).toBeNull();
    expect(mocks.stat).not.toHaveBeenCalled();
  });

  it("falls back to «class PNGf» for bitmap clipboard content (no file-URL)", async () => {
    setPlatform("darwin");
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    let coerced = false;
    mocks.execFile.mockImplementation((...args: unknown[]) => {
      const argv = args[1] as string[];
      const cb = args[args.length - 1] as (e: unknown, r: unknown) => void;
      if (argv.includes(FURL_QUERY)) {
        cb(new Error("no file-URL on the clipboard"), null);
      } else {
        coerced = true;
        cb(null, { stdout: "", stderr: "" });
      }
    });
    mocks.readFile.mockResolvedValue(png);

    const result = await readImageFromOsClipboard();

    expect(coerced).toBe(true);
    expect(result).toEqual({ mimeType: "image/png", data: png.toString("base64") });
  });

  it("resolves to null (never rejects) when the temp dir can't be created", async () => {
    // Guards the mkdtemp-inside-try fix: providers call this as `void .then(...)`
    // with no `.catch`, so a rejection here would surface as an unhandled rejection.
    setPlatform("darwin");
    mocks.execFile.mockImplementation((...args: unknown[]) => {
      const argv = args[1] as string[];
      const cb = args[args.length - 1] as (e: unknown, r: unknown) => void;
      cb(argv.includes(FURL_QUERY) ? new Error("no file-URL") : null, { stdout: "", stderr: "" });
    });
    mocks.mkdtemp.mockRejectedValue(new Error("EACCES"));

    await expect(readImageFromOsClipboard()).resolves.toBeNull();
  });
});

describe("handlePasteOsClipboardImage", () => {
  const origPlatform = process.platform;
  const setPlatform = (value: string): void => {
    Object.defineProperty(process, "platform", { value });
  };

  afterEach(() => {
    setPlatform(origPlatform);
  });

  it("reads from the OS clipboard and emits the PTY trigger without re-writing", async () => {
    setPlatform("win32");
    const writeToSession = vi.fn();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    mocks.execFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (e: unknown, r: unknown) => void;
      cb(null, { stdout: "", stderr: "" });
    });
    mocks.readFile.mockResolvedValue(png);

    const result = await handlePasteOsClipboardImage("session-a", writeToSession, {
      agentKind: "claude",
      platform: "win32",
    });

    expect(result).toEqual({ mimeType: "image/png", data: png.toString("base64") });
    expect(writeToSession).toHaveBeenCalledWith("session-a", ALT_V_PASTE);
    // Read path only: no second PowerShell SetImage (writeImageToOsClipboard).
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("returns null when the OS clipboard holds no image", async () => {
    setPlatform("win32");
    const writeToSession = vi.fn();
    mocks.execFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (e: unknown, r: unknown) => void;
      cb(new Error("no image"), null);
    });

    expect(await handlePasteOsClipboardImage("session-a", writeToSession)).toBeNull();
    expect(writeToSession).not.toHaveBeenCalled();
  });
});
