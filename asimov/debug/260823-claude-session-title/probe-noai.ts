import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const root = path.join(os.homedir(), ".claude", "projects");
const dirs = await fs.readdir(root);
const rows: { p: string; size: number; mtime: number; ai: boolean; summary: boolean }[] = [];
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
    if (st.size < 20000) continue;
    rows.push({ p, size: st.size, mtime: st.mtimeMs, ai: false, summary: false });
  }
}
rows.sort((a, b) => b.mtime - a.mtime);
for (const r of rows.slice(0, 60)) {
  const buf = await fs.readFile(r.p, "utf8");
  r.ai = buf.includes('"type":"ai-title"');
  r.summary = buf.includes('"type":"summary"');
  console.log(
    `${new Date(r.mtime).toISOString().slice(0, 16)} ai=${r.ai ? "Y" : "n"} sum=${r.summary ? "Y" : "n"} size=${r.size} ${path.basename(path.dirname(r.p))}/${path.basename(r.p).slice(0, 8)}`,
  );
}
