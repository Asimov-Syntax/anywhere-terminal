// Extension-host: mirror a pasted image into the OS clipboard so PTY children
// (Claude Code, Codex, Grok) can read it via arboard/xclip/wl-paste.

import { execFile, spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { getImagePastePtyTrigger, MAX_PASTE_IMAGE_BYTES } from "../shared/imagePasteTrigger";

const execFileAsync = promisify(execFile);

function fileExtensionForMime(mimeType: string): string {
  if (mimeType.includes("png")) {
    return "png";
  }
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
    return "jpg";
  }
  if (mimeType.includes("gif")) {
    return "gif";
  }
  if (mimeType.includes("webp")) {
    return "webp";
  }
  return "img";
}

function writeWlCopy(mimeType: string, data: Buffer): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (ok: boolean): void => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };
    const proc = spawn("wl-copy", ["--type", mimeType], { stdio: ["pipe", "ignore", "ignore"] });
    proc.on("error", () => settle(false));
    proc.on("close", (code) => settle(code === 0));
    // wl-copy may read partially then die (selection busy); without a stdin error
    // handler the resulting EPIPE escapes as an uncaught exception and takes down
    // the extension host. Swallow it into a clean sync failure.
    proc.stdin.on("error", () => settle(false));
    proc.stdin.write(data, (err) => {
      if (err) {
        settle(false);
        return;
      }
      proc.stdin.end();
    });
  });
}

/**
 * xclip forks into a clipboard-owner process by default. Its inherited stdout
 * keeps `execFile` waiting even after the launcher has set the selection, which
 * put a two-second timeout directly on the image-paste path. Give the launcher
 * no inherited output pipes and wait only for it to report selection ownership.
 */
function writeXclip(mimeType: string, data: Buffer): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const settle = (ok: boolean): void => {
      if (!settled) {
        settled = true;
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
        resolve(ok);
      }
    };

    const proc = spawn("xclip", ["-selection", "clipboard", "-t", mimeType, "-i"], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    // A broken X server must not indefinitely delay the PTY trigger. The normal
    // xclip launcher exits as soon as it has installed the clipboard owner.
    timeout = setTimeout(() => {
      proc.kill();
      settle(false);
    }, 2000);
    proc.on("error", () => settle(false));
    proc.on("exit", (code) => settle(code === 0));
    proc.stdin.on("error", () => settle(false));
    proc.stdin.end(data);
  });
}

async function writeLinuxClipboard(mimeType: string, data: Buffer): Promise<boolean> {
  if (process.env.WAYLAND_DISPLAY) {
    if (await writeWlCopy(mimeType, data)) {
      return true;
    }
  }

  if (process.env.DISPLAY) {
    if (await writeXclip(mimeType, data)) {
      return true;
    }
  }

  return false;
}

async function writeDarwinClipboard(tmpPath: string): Promise<boolean> {
  try {
    await execFileAsync("osascript", ["-e", `set the clipboard to (read (POSIX file "${tmpPath}") as «class PNGf»)`], {
      timeout: 2000,
    });
    return true;
  } catch {
    return false;
  }
}

// Known limitation: `Clipboard::SetImage` places a Bitmap/DIB, which carries no
// alpha — a CLI reading it back via arboard loses PNG transparency. Acceptable
// for the current CLIs; switch to a `PNG` DataObject format if fidelity matters.
async function writeWindowsClipboard(tmpPath: string): Promise<boolean> {
  const ps = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "$img = [System.Drawing.Image]::FromFile($env:AWT_CLIP_PATH)",
    "[System.Windows.Forms.Clipboard]::SetImage($img)",
    "$img.Dispose()",
  ].join("; ");
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
      env: { ...process.env, AWT_CLIP_PATH: tmpPath },
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Write image bytes to the OS clipboard. Returns false when no supported tool
 * is available — callers should still send the PTY paste trigger (the image may
 * already be on the clipboard from an external copy).
 */
export async function writeImageToOsClipboard(mimeType: string, data: Buffer): Promise<boolean> {
  if (data.length === 0) {
    return false;
  }

  const normalizedMime = mimeType.trim() || "image/png";
  if (process.platform === "linux") {
    try {
      return await writeLinuxClipboard(normalizedMime, data);
    } catch {
      return false;
    }
  }

  let dir: string | undefined;
  try {
    // Private per-write dir (mkdtemp is 0700) instead of a predictable name in the
    // shared tmpdir — closes the symlink-swap race on multi-user /tmp (CWE-377).
    // Inside the try so an fs failure (ENOSPC/EMFILE/EACCES) resolves to false —
    // the caller still fires the PTY trigger — instead of an unhandled rejection
    // (the call site is `void handlePasteClipboardImage(...)`, which can't catch).
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "awt-clipboard-"));
    const tmpPath = path.join(dir, `image.${fileExtensionForMime(normalizedMime)}`);
    switch (process.platform) {
      case "darwin":
        await fs.writeFile(tmpPath, data);
        return await writeDarwinClipboard(tmpPath);
      case "win32":
        await fs.writeFile(tmpPath, data);
        return await writeWindowsClipboard(tmpPath);
      default:
        return false;
    }
  } catch {
    return false;
  } finally {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  heif: "image/heif",
};

function imageMimeFromPath(filePath: string): string | null {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return IMAGE_MIME_BY_EXT[ext] ?? null;
}

/**
 * POSIX path of a single image FILE on the clipboard (a Finder Cmd+C), or null.
 * Coercing such a file-URL to «class PNGf» yields the generic file ICON, not the
 * image — so we must read the file's real bytes instead.
 */
async function readDarwinClipboardFileUrl(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("osascript", ["-e", "POSIX path of (the clipboard as «class furl»)"], {
      timeout: 2000,
    });
    const filePath = stdout.trim();
    return filePath.length > 0 ? filePath : null;
  } catch {
    // No file-URL on the clipboard (bitmap image, text, or multiple files).
    return null;
  }
}

async function readDarwinClipboardPngf(): Promise<Buffer | null> {
  let dir: string | undefined;
  try {
    // mkdtemp inside the try: a rejection here must resolve to "no image", not
    // escape as an unhandled rejection on the host (callers use void .then).
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "awt-clipread-"));
    const tmpPath = path.join(dir, "clip.png");
    // `the clipboard as «class PNGf»` coerces any pasteboard bitmap (incl. TIFF
    // screenshots) to PNG, and throws when the clipboard holds no image — which
    // is exactly our "is there an image?" probe.
    await execFileAsync(
      "osascript",
      [
        "-e",
        `set f to open for access (POSIX file "${tmpPath}") with write permission`,
        "-e",
        "set eof f to 0",
        "-e",
        "write (the clipboard as «class PNGf») to f",
        "-e",
        "close access f",
      ],
      { timeout: 2000 },
    );
    const data = await fs.readFile(tmpPath);
    return data.length > 0 ? data : null;
  } catch {
    // No image on the clipboard, or osascript unavailable.
    return null;
  } finally {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function readDarwinClipboardImage(): Promise<{ mimeType: string; buffer: Buffer } | null> {
  // Prefer a copied image FILE: the pasteboard holds a file-URL, and coercing it
  // to «class PNGf» would give the generic file icon rather than the content.
  const filePath = await readDarwinClipboardFileUrl();
  if (filePath) {
    const mimeType = imageMimeFromPath(filePath);
    if (!mimeType) {
      // A non-image file — don't fall back to the generic icon.
      return null;
    }
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile() || stat.size === 0 || stat.size > MAX_PASTE_IMAGE_BYTES) {
        return null;
      }
      const buffer = await fs.readFile(filePath);
      return buffer.length > 0 ? { mimeType, buffer } : null;
    } catch {
      return null;
    }
  }
  // Bitmap clipboard content (screenshot-to-clipboard, copy-image-in-browser):
  // «class PNGf» coercion is the correct read here.
  const buffer = await readDarwinClipboardPngf();
  return buffer ? { mimeType: "image/png", buffer } : null;
}

async function readWindowsClipboardImage(): Promise<Buffer | null> {
  let dir: string | undefined;
  try {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "awt-clipread-"));
    const tmpPath = path.join(dir, "clip.png");
    const ps = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "Add-Type -AssemblyName System.Drawing",
      "if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) { exit 1 }",
      "$img = [System.Windows.Forms.Clipboard]::GetImage()",
      "$img.Save($env:AWT_CLIP_PATH, [System.Drawing.Imaging.ImageFormat]::Png)",
      "$img.Dispose()",
    ].join("; ");
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
      env: { ...process.env, AWT_CLIP_PATH: tmpPath },
      timeout: 5000,
    });
    const data = await fs.readFile(tmpPath);
    return data.length > 0 ? data : null;
  } catch {
    return null;
  } finally {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/**
 * Read the current OS clipboard image. Needed when the webview Clipboard API can't
 * see the image (macOS Ctrl+V TIFF/screenshot formats; Windows DIB/CF_BITMAP that
 * never surfaces as `image/*` in the webview paste event). Returns null when no
 * image is present or the platform isn't supported here (Linux: webview probe).
 */
export async function readImageFromOsClipboard(): Promise<{ mimeType: string; data: string } | null> {
  let buffer: Buffer | null = null;
  let mimeType = "image/png";

  if (process.platform === "darwin") {
    const result = await readDarwinClipboardImage();
    if (!result) {
      return null;
    }
    buffer = result.buffer;
    mimeType = result.mimeType;
  } else if (process.platform === "win32") {
    buffer = await readWindowsClipboardImage();
  } else {
    return null;
  }

  if (!buffer || buffer.length === 0 || buffer.length > MAX_PASTE_IMAGE_BYTES) {
    return null;
  }
  return { mimeType, data: buffer.toString("base64") };
}

/**
 * Host-read fallback when the webview paste event has no image/* and no text
 * (Windows DIB/CF_BITMAP). Read from the OS clipboard, emit the PTY trigger,
 * and return the bytes so the webview can cache them for hover preview.
 *
 * Does NOT re-write the image to the OS clipboard — it is already there (we
 * just read it). Re-writing would spawn a second PowerShell on Windows for no
 * functional gain and made image paste noticeably slower.
 */
export async function handlePasteOsClipboardImage(
  tabId: string,
  writeToSession: (tabId: string, data: string) => void,
  context: PasteClipboardImageContext = {},
): Promise<{ mimeType: string; data: string } | null> {
  if (!tabId) {
    return null;
  }
  const img = await readImageFromOsClipboard();
  if (!img?.data) {
    return null;
  }
  const platform = context.platform ?? process.platform;
  writeToSession(tabId, getImagePastePtyTrigger(context.agentKind, platform));
  return img;
}

export interface PasteClipboardImagePayload {
  tabId: string;
  mimeType: string;
  data: string;
}

export interface PasteClipboardImageContext {
  /** Running CLI in this session, when it is a vault agent launch. */
  agentKind?: string;
  /** Platform of the extension host (where the CLI runs). Picks the PTY trigger. */
  platform?: NodeJS.Platform;
}

/**
 * Mirror a webview-captured image to the OS clipboard, then emit the PTY paste
 * trigger so the running CLI reads it via arboard/xclip/wl-paste. The trigger is
 * resolved from the CLI + host platform (Codex/OpenCode need Ctrl+V even on
 * macOS; Claude uses its OS-native signal) — never from the webview.
 */
export async function handlePasteClipboardImage(
  payload: PasteClipboardImagePayload,
  writeToSession: (tabId: string, data: string) => void,
  context: PasteClipboardImageContext = {},
): Promise<void> {
  const { tabId, data } = payload;
  if (!tabId || !data) {
    return;
  }

  const trimmed = data.trim();
  if (!trimmed || !/^[A-Za-z0-9+/]*={0,2}$/.test(trimmed)) {
    return;
  }

  const buffer = Buffer.from(trimmed, "base64");
  if (buffer.length === 0 || buffer.length > MAX_PASTE_IMAGE_BYTES) {
    return;
  }

  const mimeType = payload.mimeType?.trim() || "image/png";
  await writeImageToOsClipboard(mimeType, buffer);

  const platform = context.platform ?? process.platform;
  writeToSession(tabId, getImagePastePtyTrigger(context.agentKind, platform));
}
