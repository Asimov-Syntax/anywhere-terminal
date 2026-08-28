import { rm as wipe } from "node:fs/promises";

export async function removeTree(dir: string): Promise<void> {
  await wipe(dir, { recursive: true });
}
