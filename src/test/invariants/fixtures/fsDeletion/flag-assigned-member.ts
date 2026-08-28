import fs from "node:fs";

const wipe = fs.promises.rm;

export async function removeTree(dir: string): Promise<void> {
  await wipe(dir, { recursive: true });
}
