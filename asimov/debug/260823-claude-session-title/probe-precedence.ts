import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const root = path.join(os.homedir(), ".claude", "projects");
const dirs = await fs.readdir(root);
const rows: { p: string; size: number; mtime: number }[] = [];
for (const d of dirs) {
  let names: string[];
  try {
    names = await fs.readdir(path.join(root, d));
  } catch {
    continue;
  }
  for (const n of names.filter((x) => x.endsWith(".jsonl"))) {
    const p = path.join(root, d, n);
    const st = await fs.stat(p);
    if (st.size < 5000) continue;
    rows.push({ p, size: st.size, mtime: st.mtimeMs });
  }
}
rows.sort((a, b) => b.mtime - a.mtime);
let custom = 0;
let lastOnly = 0;
for (const r of rows.slice(0, 100)) {
  const buf = await fs.readFile(r.p, "utf8");
  const hasCustom = buf.includes('"type":"custom-title"');
  const hasAi = buf.includes('"type":"ai-title"');
  const hasLast = buf.includes('"type":"last-prompt"');
  if (hasCustom) {
    custom++;
    const m = buf.match(/\{"type":"custom-title","customTitle":"[^"]*"[^\n]*/g);
    console.log(`CUSTOM ai=${hasAi ? "Y" : "n"} ${path.basename(r.p).slice(0, 8)} ${m?.[m.length - 1]?.slice(0, 140)}`);
  } else if (!hasAi && hasLast) {
    lastOnly++;
    const m = buf.match(/\{"type":"last-prompt","lastPrompt":"[^"]*"/g);
    console.log(`LASTONLY ${path.basename(r.p).slice(0, 8)} ${m?.[m.length - 1]?.slice(0, 140)}`);
  }
}
console.log({ scanned: Math.min(100, rows.length), custom, lastOnly });
