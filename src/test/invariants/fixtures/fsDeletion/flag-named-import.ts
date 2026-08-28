import { rm } from "node:fs/promises";

export async function removeTree(dir: string): Promise<void> {
  await rm(dir, { recursive: true });
}
