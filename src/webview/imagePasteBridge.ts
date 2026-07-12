// Webview helpers for AI-CLI image paste (Claude Code, Codex, Grok).
// CLIs read images from the OS clipboard out-of-band; the webview must (1) cache
// the blob for hover preview and (2) ask the extension host to sync it to the OS
// clipboard and signal the PTY. The host picks the PTY trigger — it knows both
// the running CLI and its platform (see clipboardImageSync).

import type { PasteClipboardImageMessage } from "../types/messages";

/** First image/* item from a paste event, if any. */
export function extractImageBlobFromClipboardItems(items: DataTransferItemList): File | null {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type.startsWith("image/")) {
      return item.getAsFile();
    }
  }
  return null;
}

/**
 * Whether the paste event carries non-empty plain text. Used to keep text paste
 * on the native xterm path (instant) instead of waiting for a host OS-clipboard
 * image probe.
 */
export function clipboardEventHasPlainText(data: DataTransfer | null | undefined): boolean {
  if (!data) {
    return false;
  }
  return (data.getData("text/plain") ?? "").length > 0;
}

/**
 * Windows-only: when the webview paste event has neither `image/*` nor plain
 * text, the OS clipboard may still hold a DIB/CF_BITMAP that only the host can
 * read. Linux never needs this (host `readImageFromOsClipboard` is a no-op);
 * macOS uses the native paste / Ctrl+V preview paths instead.
 */
export function shouldHostReadOsClipboardImage(opts: {
  isWindows: boolean;
  hasImageBlob: boolean;
  hasPlainText: boolean;
}): boolean {
  return opts.isWindows && !opts.hasImageBlob && !opts.hasPlainText;
}

/** Whether the key event is a paste shortcut we should capture for preview. */
export function isPasteShortcut(event: KeyboardEvent, isMac: boolean): boolean {
  if (event.type !== "keydown" || event.altKey || event.shiftKey) {
    return false;
  }
  // macOS: accept BOTH Cmd+V (the OS paste accelerator — fires a `paste` event)
  // and Ctrl+V (no `paste` event; xterm sends \x16, which OpenCode/Codex use to
  // read the OS clipboard themselves). Without the Ctrl+V branch the preview
  // blob is never captured for those CLIs. Elsewhere, Ctrl+V is the OS paste.
  const modifier = isMac ? event.metaKey || event.ctrlKey : event.ctrlKey;
  return modifier && event.key.toLowerCase() === "v";
}

/** Encode a Blob as base64 for the extension-host clipboard sync RPC. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** Decode host-supplied base64 image bytes into a Blob for the preview cache. */
export function base64ToBlob(data: string, mimeType: string): Blob | null {
  try {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType || "image/png" });
  } catch {
    return null;
  }
}

export type { PasteClipboardImageMessage };

/**
 * Re-encode a non-PNG image as PNG. Every target CLI reads the OS clipboard as
 * PNG (osascript «class PNGf», arboard, `-t image/png`), so a pasted
 * JPEG/GIF/WebP would otherwise land as corrupt PNG-labeled bytes (or not decode
 * at all). Falls back to the original blob when the canvas APIs are unavailable
 * (e.g. the test env) or re-encoding fails.
 */
export async function ensurePngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") {
    return blob;
  }
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") {
    return blob;
  }
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return blob;
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return await canvas.convertToBlob({ type: "image/png" });
  } catch {
    return blob;
  }
}

/**
 * Ask the extension host to mirror a captured image to the OS clipboard and
 * signal the PTY for the active pane. The image is normalized to PNG first; the
 * host resolves the PTY trigger from the running CLI + platform.
 */
export async function forwardImagePaste(
  blob: File,
  tabId: string,
  postMessage: (msg: PasteClipboardImageMessage) => void,
): Promise<void> {
  const png = await ensurePngBlob(blob);
  const data = await blobToBase64(png);
  postMessage({
    type: "pasteClipboardImage",
    tabId,
    mimeType: png.type || "image/png",
    data,
  });
}

/** Dedup window so keydown async probe + paste handler don't double-fire. */
export class ImagePasteDeduper {
  private handled = false;

  markHandled(): void {
    this.handled = true;
  }

  wasHandled(): boolean {
    return this.handled;
  }

  reset(): void {
    this.handled = false;
  }
}

/**
 * Fallback when the paste event never fires: probe navigator.clipboard for an
 * image item after the paste shortcut keydown.
 */
export async function probeClipboardForImageBlob(): Promise<Blob | null> {
  if (!navigator.clipboard?.read) {
    return null;
  }
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find((t) => t.startsWith("image/"));
      if (imageType) {
        return item.getType(imageType);
      }
    }
  } catch {
    // Permission denied or unsupported in this webview context.
  }
  return null;
}
