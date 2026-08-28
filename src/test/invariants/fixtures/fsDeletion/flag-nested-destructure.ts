import fs from "node:fs";

const {
  promises: { rm },
} = fs;

export async function removeTree(dir: string): Promise<void> {
  await rm(dir, { recursive: true });
}
