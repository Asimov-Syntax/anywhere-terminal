import fs from "node:fs";

// biome-ignore format: the quoted key IS the fixture — formatting it away deletes the case
const { "rm": wipe } = fs.promises;

export async function removeTree(dir: string): Promise<void> {
  await wipe(dir, { recursive: true });
}
