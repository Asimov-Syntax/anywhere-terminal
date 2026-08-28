import fs from "node:fs";

export async function removeTree(dir: string): Promise<void> {
  await (fs.promises as any).rm(dir, { recursive: true });
}
